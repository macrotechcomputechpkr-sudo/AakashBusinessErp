// =============================================
// utils/balanceWriteoff.js
// Small balance write-off (Journal Voucher type "Small Balance Write-off",
// pages/BalanceWriteoff.jsx, /api/balance-writeoff/...):
//   preview  customers / suppliers (or both) whose balance on a date is not
//            zero and at most the chosen amount (e.g. Rs 50) - Dr balances,
//            Cr balances or both; optional area / agent / party filter
//   post     ONE journal voucher (jv_type 'balance_writeoff') for the ticked
//            parties:
//              Dr balance  -> Cr the party, Dr the discount (allowed) ledger
//              Cr balance  -> Dr the party, Cr the discount (received) ledger
//            made and posted through the Journal Voucher screen's own
//            handlers (numbering, GL, audit), then each party's open bills
//            are settled (bill-wise, FIFO) against its write-off line so
//            ageing / outstanding clear too
//   cancel   cancelling the JV (Journal Voucher screen) reverses the GL and,
//            through reverseWriteoffSettlements, the bill-wise settlements
// =============================================
const { handlerOf } = require('./mobileEntries');
const { isBillWiseTrackingEnabled, getOutstandingReferences, computeFifoAllocation, createReferenceAndSettle, reverseReferenceAndSettlements } = require('./billWiseSettlement');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const csv = v => (Array.isArray(v) ? v : v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const today = () => new Date().toISOString().slice(0, 10);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
async function inChunks(ids, fn, size = 100) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}
async function invoke(handler, req, { body, params = {} }) {
    let code = 200, payload = null;
    const res = { status(c) { code = c; return this; }, json(b) { payload = b; return this; } };
    await handler({ ...req, body, params, query: {} }, res);
    return { code, ...(payload || {}) };
}

// q: side (customer / supplier / both), max_amount, min_amount, as_on, balance (dr / cr / both), area_ids, agent_ids, party_ids
async function previewWriteoff(c, t, q) {
    const max = Number(q.max_amount);
    if (!(max > 0)) throw httpError('Enter the amount - balances up to it are written off');
    const min = Math.max(0, Number(q.min_amount) || 0);
    const asOn = q.as_on || today();
    const side = ['customer', 'supplier', 'both'].includes(q.side) ? q.side : 'customer';
    const cats = side === 'customer' ? ['sales', 'both'] : side === 'supplier' ? ['purchase', 'both'] : ['sales', 'purchase', 'both'];
    let parties = await fetchAll(() => c.from('ledger_accounts').select('id, account_name, account_code, category_type, area_id, agent_id, opening_balance, opening_balance_type, is_active').eq('tenant_id', t).in('category_type', cats).order('id'));
    const areas = csv(q.area_ids), agents = csv(q.agent_ids), only = csv(q.party_ids);
    if (areas.length) parties = parties.filter(p => areas.includes(p.area_id));
    if (agents.length) parties = parties.filter(p => agents.includes(p.agent_id));
    if (only.length) parties = parties.filter(p => only.includes(p.id));
    const bal = {};
    const lines = await inChunks(parties.map(p => p.id), ch => fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)')
        .eq('tenant_id', t).in('ledger_account_id', ch).lte('batch.batch_date', asOn).order('id')));
    lines.forEach(l => { bal[l.ledger_account_id] = (bal[l.ledger_account_id] || 0) + Number(l.debit_amount || 0) - Number(l.credit_amount || 0); });
    const which = ['dr', 'cr'].includes(q.balance) ? q.balance : 'both';
    const rows = parties.map(p => {
        const b = round2((p.opening_balance_type === 'cr' ? -1 : 1) * (Number(p.opening_balance) || 0) + (bal[p.id] || 0));
        return { party_id: p.id, code: p.account_code, name: p.account_name, category: p.category_type, active: p.is_active !== false, balance: b, nature: b > 0 ? 'dr' : 'cr', amount: Math.abs(b) };
    }).filter(r => r.amount > 0.004 && r.amount <= max + 1e-9 && r.amount >= min && (which === 'both' || r.nature === which))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { as_on: asOn, max_amount: max, rows, totals: { parties: rows.length, dr: round2(rows.filter(r => r.nature === 'dr').reduce((s, r) => s + r.amount, 0)), cr: round2(rows.filter(r => r.nature === 'cr').reduce((s, r) => s + r.amount, 0)) } };
}

// b: party_ids, as_on (the JV date), max_amount, dr_ledger_id (discount allowed - for Dr balances), cr_ledger_id (discount received - for Cr balances), narration, side, balance
async function postWriteoff(c, t, req, b) {
    const ids = csv(b.party_ids);
    if (!ids.length) throw httpError('Tick the parties to write off');
    const date = b.as_on || today();
    // balances are read again on the posting date - never more than shown / allowed
    const pv = await previewWriteoff(c, t, { ...b, as_on: date, party_ids: ids.join(','), side: 'both', balance: 'both', min_amount: 0 });
    const rows = pv.rows;
    if (!rows.length) throw httpError('None of the ticked parties has a balance within the amount any more');
    const drRows = rows.filter(r => r.nature === 'dr'), crRows = rows.filter(r => r.nature === 'cr');
    if (drRows.length && !b.dr_ledger_id) throw httpError('Choose the discount (allowed) ledger for Dr balances');
    if (crRows.length && !b.cr_ledger_id) throw httpError('Choose the discount (received) ledger for Cr balances');
    const text = b.narration || `Small balance write-off (up to ${pv.max_amount})`;
    const details = [];
    rows.forEach(r => details.push(r.nature === 'dr'
        ? { ledger_id: r.party_id, debit_amount: 0, credit_amount: r.amount, narration: `Balance written off ${r.amount}` }
        : { ledger_id: r.party_id, debit_amount: r.amount, credit_amount: 0, narration: `Balance written off ${r.amount}` }));
    const drTotal = round2(drRows.reduce((s, r) => s + r.amount, 0)), crTotal = round2(crRows.reduce((s, r) => s + r.amount, 0));
    if (drTotal) details.push({ ledger_id: b.dr_ledger_id, debit_amount: drTotal, credit_amount: 0, narration: `${text} - ${drRows.length} Dr balance(s)` });
    if (crTotal) details.push({ ledger_id: b.cr_ledger_id, debit_amount: 0, credit_amount: crTotal, narration: `${text} - ${crRows.length} Cr balance(s)` });
    if (details.length < 2) throw httpError('Nothing to write off');
    const jvRouter = require('../routes/journalVoucherRoutes');
    const created = await invoke(handlerOf(jvRouter, 'post', '/journal-vouchers'), req, { body: { doc_date: date, jv_type: 'balance_writeoff', narration: text, details } });
    if (!created.success) throw httpError(created.error || 'Write-off voucher not saved', created.code || 400);
    const jv = created.data;
    const posted = await invoke(handlerOf(jvRouter, 'put', '/journal-vouchers/:id/status'), req, { body: { status: 'posted' }, params: { id: jv.id } });
    if (!posted.success) throw httpError(`Voucher ${jv.doc_no} saved as draft - ${posted.error}`, posted.code || 400);
    // the parties of the voucher + their bill-wise settlement
    const { data: lines, error } = await c.from('balance_writeoff_lines').insert(rows.map(r => ({ tenant_id: t, jv_id: jv.id, party_ledger_id: r.party_id, balance_before: r.balance, amount: r.amount, nature: r.nature }))).select();
    if (error) throw error;
    let settled = 0;
    for (const l of lines || []) {
        if (!(await isBillWiseTrackingEnabled(c, t, l.party_ledger_id))) continue;
        // a Dr balance written off: a 'cr' reference settling the open 'dr' bills (and the other way round)
        const own = l.nature === 'dr' ? 'cr' : 'dr', against = l.nature === 'dr' ? 'dr' : 'cr';
        const outstanding = await getOutstandingReferences(c, l.party_ledger_id, against);
        const settlements = computeFifoAllocation(outstanding, l.amount).allocations;
        await createReferenceAndSettle(c, t, { ledgerId: l.party_ledger_id, sourceType: 'balance_writeoff', sourceId: l.id, docNo: jv.doc_no, date, nature: own, totalAmount: Number(l.amount), settlements });
        settled++;
    }
    return { jv_id: jv.id, doc_no: jv.doc_no, parties: rows.length, dr_total: drTotal, cr_total: crTotal, bill_wise_settled: settled };
}

// Journal Voucher cancelled: undo the bill-wise settlements of its write-off lines.
async function reverseWriteoffSettlements(c, jvId) {
    const { data: lines } = await c.from('balance_writeoff_lines').select('id').eq('jv_id', jvId);
    for (const l of lines || []) await reverseReferenceAndSettlements(c, 'balance_writeoff', l.id);
}

// Register of write-off vouchers with their parties.
async function writeoffRegister(c, t, q) {
    let jq = c.from('journal_vouchers').select('id, doc_no, doc_date, status, total_debit, narration').eq('tenant_id', t).eq('jv_type', 'balance_writeoff');
    if (q.date_from) jq = jq.gte('doc_date', q.date_from);
    if (q.date_to) jq = jq.lte('doc_date', q.date_to);
    const jvs = await fetchAll(() => jq.order('doc_date', { ascending: false }).order('id'));
    const lines = await inChunks(jvs.map(j => j.id), async ch => (await c.from('balance_writeoff_lines').select('jv_id, party_ledger_id, amount, nature').in('jv_id', ch)).data || []);
    const pids = [...new Set(lines.map(l => l.party_ledger_id))];
    const L = Object.fromEntries((await inChunks(pids, async ch => (await c.from('ledger_accounts').select('id, account_name').in('id', ch)).data || [])).map(x => [x.id, x.account_name]));
    return jvs.map(j => ({ ...j, parties: lines.filter(l => l.jv_id === j.id).map(l => ({ name: L[l.party_ledger_id] || '?', amount: round2(l.amount), nature: l.nature })) }));
}

module.exports = { previewWriteoff, postWriteoff, reverseWriteoffSettlements, writeoffRegister };
