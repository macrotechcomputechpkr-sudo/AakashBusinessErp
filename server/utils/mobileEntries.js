// =============================================
// utils/mobileEntries.js
// Cash receipts and sales returns entered on the salesman's phone
// (routes/salesmanRoutes.js /api/mobile/receipts, /api/mobile/returns) and
// their approval in the office (/api/mobile-entries/...).
//   receipt  customer on a route planned for the salesman that day (or any
//            customer when "Allow Off-Route" is on) - a Cash / Bank Receipt
//            draft: Dr the salesman's mobile cash ledger (else System
//            Control's default cash ledger), Cr the customer on posting
//   return   customer of ANY area / route (goods come back wherever they
//            were sold) - a Sales Return draft at the customer's rate
//   both     entry_source = 'mobile', agent_id = the salesman (auto tagged),
//            area / route of the customer's route; they stay drafts with no
//            effect until the office posts them (tick one or all)
// The documents are made by the screens' own create / status handlers, so
// numbering, GL, stock, bill-wise settlement and IRD work as for any entry.
// =============================================
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

// the handler of one route of an express router (method + path)
function handlerOf(router, method, path) {
    const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
    if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
    const stack = layer.route.stack;
    return stack[stack.length - 1].handle;
}
// run a route handler in-process and return its JSON
async function invoke(handler, req, { body, params = {} }) {
    let code = 200, payload = null;
    const res = { status(c) { code = c; return this; }, json(b) { payload = b; return this; } };
    await handler({ ...req, body, params, query: {} }, res);
    return { code, ...(payload || {}) };
}
const H = {
    returnCreate: () => handlerOf(require('../routes/salesReturnRoutes'), 'post', '/sales-returns'),
    returnStatus: () => handlerOf(require('../routes/salesReturnRoutes'), 'put', '/sales-returns/:id/status'),
    receiptCreate: () => handlerOf(require('../routes/cashBankEntryRoutes'), 'post', '/cash-bank-entries'),
    receiptStatus: () => handlerOf(require('../routes/cashBankEntryRoutes'), 'put', '/cash-bank-entries/:id/status')
};

// the route (and its area) of a customer: a planned route of the day first, else any active route
async function routeOfCustomer(c, customerId, preferIds = []) {
    const { data: links } = await c.from('route_customers').select('route_id').eq('ledger_account_id', customerId).eq('is_active', true);
    const ids = (links || []).map(l => l.route_id);
    const routeId = ids.find(id => preferIds.includes(id)) || ids[0] || null;
    const { data: route } = routeId ? await c.from('routes').select('id, area_id').eq('id', routeId).maybeSingle() : { data: null };
    return { routeId, areaId: route?.area_id || null, onPlan: !!ids.find(id => preferIds.includes(id)) };
}

// b: customer_ledger_id, amount, payment_mode (cash / cheque / online), ref_no, remarks
async function createMobileReceipt(c, t, req, agent, isSalesman, b, S) {
    if (agent.allow_mobile_receipt === false) throw httpError('This salesman may not take receipts on the phone');
    const date = b.doc_date || today();
    if (isSalesman && date !== today()) throw httpError('A salesman can enter receipts only for today');
    if (!b.customer_ledger_id) throw httpError('Choose a customer');
    const amount = round2(b.amount);
    if (!(amount > 0)) throw httpError('Enter the amount received');
    const planned = await S.routeIdsFor(c, t, agent.id, date);
    const r = await routeOfCustomer(c, b.customer_ledger_id, planned);
    if (!r.onPlan && !agent.allow_off_route_orders) throw httpError(planned.length ? 'This customer is not on the route planned for today' : 'No route is planned for this salesman today');
    let cash = agent.mobile_cash_ledger_id;
    if (!cash) { const { data: sys } = await c.from('system_control_settings').select('default_cash_ledger_id').eq('tenant_id', t).maybeSingle(); cash = sys?.default_cash_ledger_id; }
    if (!cash) throw httpError('No cash ledger for mobile receipts - set it on the salesman (Mobile cash ledger) or System Control (default cash ledger)');
    const mode = ['cash', 'cheque', 'online'].includes(b.payment_mode) ? b.payment_mode : 'cash';
    const body = { doc_date: date, entry_type: 'receipt', cash_bank_ledger_id: cash, party_ledger_id: b.customer_ledger_id, agent_id: agent.id, amount,
        payment_mode: mode, ref_no: b.ref_no || null, remarks_text: b.remarks || null, narration: `Mobile receipt - ${agent.agent_name}${b.remarks ? ` - ${b.remarks}` : ''}`, status: 'draft' };
    const out = await invoke(H.receiptCreate(), req, { body });
    if (!out.success) throw httpError(out.error || 'Receipt not saved', out.code || 400);
    await c.from('cash_bank_entries').update({ entry_source: 'mobile', area_id: r.areaId, route_id: r.routeId }).eq('id', out.data.id);
    return { id: out.data.id, doc_no: out.data.doc_no, amount, status: 'draft' };
}

// b: customer_ledger_id, route_id (optional), details [{ product_id, qty, rate? }], return_reason, remarks
async function createMobileReturn(c, t, req, agent, isSalesman, b, S) {
    if (agent.allow_mobile_return === false) throw httpError('This salesman may not enter returns on the phone');
    const date = b.doc_date || today();
    if (isSalesman && date !== today()) throw httpError('A salesman can enter returns only for today');
    if (!b.customer_ledger_id) throw httpError('Choose the customer (any area / route)');
    const lines = (b.details || []).filter(d => d.product_id && Number(d.qty) > 0);
    if (!lines.length) throw httpError('Add at least one item with a quantity');
    const products = await S.mobileProducts(c, t, agent, { customer_id: b.customer_ledger_id, limit: 100000 });
    const P = Object.fromEntries(products.map(p => [p.id, p]));
    const details = lines.map(d => {
        const p = P[d.product_id];
        if (!p) throw httpError('A product on this return is not available');
        const rate = p.rate_editable && d.rate !== undefined && d.rate !== '' ? Number(d.rate) : p.rate;
        return { product_id: p.id, qty: Number(d.qty), uom_id: p.unit_id, rate, tax_percent: p.tax_percent, discount_percent: p.discount_percent || 0, warehouse_id: agent.default_warehouse_id || null };
    });
    const r = b.route_id ? { routeId: b.route_id, areaId: (await c.from('routes').select('area_id').eq('id', b.route_id).maybeSingle()).data?.area_id || null } : await routeOfCustomer(c, b.customer_ledger_id);
    const reasons = ['damaged', 'expired', 'wrong_item', 'quality_issue', 'excess_supply', 'other'];
    const body = { doc_date: date, customer_ledger_id: b.customer_ledger_id, agent_id: agent.id, warehouse_id: agent.default_warehouse_id || null,
        area_id: r.areaId, route_id: r.routeId, return_reason: reasons.includes(b.return_reason) ? b.return_reason : 'other', settlement_type: 'credit_note',
        remarks_text: b.remarks || null, narration: `Mobile return - ${agent.agent_name}${b.remarks ? ` - ${b.remarks}` : ''}`,
        details, status: 'draft', save_as_draft: true };
    const out = await invoke(H.returnCreate(), req, { body });
    if (!out.success) throw httpError(out.error || 'Return not saved', out.code || 400);
    await c.from('sales_returns').update({ entry_source: 'mobile' }).eq('id', out.data.id);
    const { data: saved } = await c.from('sales_returns').select('total_amount').eq('id', out.data.id).maybeSingle();
    return { id: out.data.id, doc_no: out.data.doc_no, amount: round2(saved?.total_amount), status: 'draft' };
}

// The salesman's own mobile receipts / returns (phone "Entries" list).
async function myEntries(c, t, agent, q) {
    const from = q.date_from || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to = q.date_to || today();
    const [{ data: rec }, { data: ret }] = await Promise.all([
        c.from('cash_bank_entries').select('id, doc_no, doc_date, party_name_snapshot, amount, status').eq('tenant_id', t).eq('agent_id', agent.id).eq('entry_source', 'mobile').gte('doc_date', from).lte('doc_date', to),
        c.from('sales_returns').select('id, doc_no, doc_date, customer_name_snapshot, total_amount, status').eq('tenant_id', t).eq('agent_id', agent.id).eq('entry_source', 'mobile').gte('doc_date', from).lte('doc_date', to)
    ]);
    const rows = [
        ...(rec || []).map(x => ({ type: 'receipt', id: x.id, doc_no: x.doc_no, doc_date: String(x.doc_date).slice(0, 10), party: x.party_name_snapshot, amount: round2(x.amount), status: x.status })),
        ...(ret || []).map(x => ({ type: 'return', id: x.id, doc_no: x.doc_no, doc_date: String(x.doc_date).slice(0, 10), party: x.customer_name_snapshot, amount: round2(x.total_amount), status: x.status }))
    ].sort((a, b) => b.doc_date.localeCompare(a.doc_date) || String(b.doc_no).localeCompare(String(a.doc_no)));
    return { from, to, rows };
}

// Office: mobile entries waiting to be posted (or all). q: type (receipt / return / all), agent_id, date_from, date_to, status (pending / posted / all)
async function pendingEntries(c, t, q) {
    const type = q.type || 'all', status = q.status || 'pending';
    const agentIds = String(q.agent_id || '').split(',').filter(Boolean);
    const filt = x => {
        x = x.eq('tenant_id', t).eq('entry_source', 'mobile');
        if (status === 'pending') x = x.eq('status', 'draft'); else if (status === 'posted') x = x.eq('status', 'posted');
        if (agentIds.length) x = x.in('agent_id', agentIds);
        if (q.date_from) x = x.gte('doc_date', q.date_from);
        if (q.date_to) x = x.lte('doc_date', q.date_to);
        return x;
    };
    const [rec, ret, agents, routes] = await Promise.all([
        type === 'return' ? [] : (await filt(c.from('cash_bank_entries').select('id, doc_no, doc_date, party_name_snapshot, agent_id, route_id, amount, payment_mode, ref_no, remarks_text, status, created_at'))).data || [],
        type === 'receipt' ? [] : (await filt(c.from('sales_returns').select('id, doc_no, doc_date, customer_name_snapshot, agent_id, route_id, total_amount, return_reason, remarks_text, status, created_at'))).data || [],
        (await c.from('salesman_agents').select('id, agent_name').eq('tenant_id', t)).data || [],
        (await c.from('routes').select('id, route_name').eq('tenant_id', t)).data || []
    ]);
    const A = Object.fromEntries(agents.map(a => [a.id, a.agent_name])), R = Object.fromEntries(routes.map(r => [r.id, r.route_name]));
    const rows = [
        ...rec.map(x => ({ type: 'receipt', id: x.id, doc_no: x.doc_no, doc_date: String(x.doc_date).slice(0, 10), party: x.party_name_snapshot, agent_name: A[x.agent_id] || '', route_name: R[x.route_id] || '',
            amount: round2(x.amount), detail: [x.payment_mode, x.ref_no].filter(Boolean).join(' · '), remarks: x.remarks_text, status: x.status, created_at: x.created_at })),
        ...ret.map(x => ({ type: 'return', id: x.id, doc_no: x.doc_no, doc_date: String(x.doc_date).slice(0, 10), party: x.customer_name_snapshot, agent_name: A[x.agent_id] || '', route_name: R[x.route_id] || '',
            amount: round2(x.total_amount), detail: x.return_reason || '', remarks: x.remarks_text, status: x.status, created_at: x.created_at }))
    ].sort((a, b) => a.doc_date.localeCompare(b.doc_date) || String(a.doc_no).localeCompare(String(b.doc_no)));
    const sum = ty => round2(rows.filter(r => r.type === ty).reduce((s, r) => s + r.amount, 0));
    return { rows, totals: { receipts: rows.filter(r => r.type === 'receipt').length, receipt_amount: sum('receipt'), returns: rows.filter(r => r.type === 'return').length, return_amount: sum('return') } };
}

// Office: post the ticked entries (items [{ type, id }]); each goes through its own status route.
async function postEntries(c, t, req, items) {
    const list = (Array.isArray(items) ? items : []).filter(x => x && x.id && ['receipt', 'return'].includes(x.type));
    if (!list.length) throw httpError('Tick the entries to post');
    const results = [];
    for (const it of list) {
        const table = it.type === 'receipt' ? 'cash_bank_entries' : 'sales_returns';
        const { data: doc } = await c.from(table).select('id, doc_no, status, entry_source').eq('id', it.id).eq('tenant_id', t).maybeSingle();
        if (!doc || doc.entry_source !== 'mobile') { results.push({ ...it, ok: false, error: 'Not a mobile entry' }); continue; }
        if (doc.status !== 'draft') { results.push({ ...it, doc_no: doc.doc_no, ok: false, error: `Already ${doc.status}` }); continue; }
        const out = await invoke(it.type === 'receipt' ? H.receiptStatus() : H.returnStatus(), req, { body: { status: 'posted' }, params: { id: it.id } });
        results.push({ ...it, doc_no: doc.doc_no, ok: !!out.success, error: out.success ? null : out.error });
    }
    return { posted: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
}

module.exports = { createMobileReceipt, createMobileReturn, myEntries, pendingEntries, postEntries, routeOfCustomer, handlerOf };
