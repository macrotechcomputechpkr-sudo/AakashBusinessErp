// =============================================
// utils/controlReports.js
// Reports built on the masters that were missing:
//   day_book            every posted voucher of the period, Dr / Cr lines
//   cash_bank_book      cash + bank ledgers, day-wise receipts / payments with
//                       running balance
//   customer_master     customers with PAN, contact, area / route / salesman,
//                       credit limit / days, balance, last sale, overdue
//   supplier_master     the same for suppliers (last purchase)
//   price_list          products with unit, SR1-SR5, MRP, purchase rate, VAT,
//                       group / company, stock
//   route_customers     area -> route -> planned salesman -> customers in order
//   credit_exceed       customers above credit limit or beyond credit days
//   inactive_customers  no sale for N days (with balance)
//   non_moving_items    no sale for N days (with stock)
//   master_exceptions   data gaps: party without PAN / area / route /
//                       salesman, product without HS code / sales account /
//                       rate / barcode, ledger in an unmapped group
//   cancelled_docs      every cancelled document with reason, by and when
//   draft_docs          documents still in draft (not posted)
// =============================================
const { loadGroups, sectionOf } = require('./financialEngine');
const { stockReport } = require('./stockReport');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const today = () => new Date().toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`)) / 86400000);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}
const safe = p => p.catch(() => []);

const DOC_TABLES = {
    sales_quotation: ['sales_quotations', 'Sales Quotation', 'customer_name_snapshot'], sales_order: ['sales_orders', 'Sales Order', 'customer_name_snapshot'],
    sales_delivery: ['sales_deliveries', 'Sales Delivery', 'customer_name_snapshot'], sales_bill: ['sales_bills', 'Sales Bill', 'customer_name_snapshot'],
    sales_return: ['sales_returns', 'Sales Return', 'customer_name_snapshot'], purchase_order: ['purchase_orders', 'Purchase Order', 'vendor_name_snapshot'],
    purchase_grn: ['purchase_grns', 'Purchase GRN', 'vendor_name_snapshot'], purchase_bill: ['purchase_bills', 'Purchase Bill', 'vendor_name_snapshot'],
    purchase_return: ['purchase_returns', 'Purchase Return', 'vendor_name_snapshot'], journal_voucher: ['journal_vouchers', 'Journal Voucher', null],
    cash_bank_entry: ['cash_bank_entries', 'Cash / Bank Entry', null], debit_note: ['debit_notes', 'Debit Note', null], credit_note: ['credit_notes', 'Credit Note', null],
    pdc: ['pdc_vouchers', 'PDC', 'party_name_snapshot'], stock_transfer: ['stock_transfers', 'Stock Transfer', null], production: ['production_orders', 'Production', null]
};
const GL_LABEL = {
    sales_bill: 'Sales Bill', sales_return: 'Sales Return', sales_nonsalable_return: 'Sales Non-saleable Return', sales_additional: 'Sales Additional', sales_delivery: 'Sales Delivery',
    purchase_grn: 'Purchase GRN', purchase_bill: 'Purchase Bill', purchase_return: 'Purchase Return', purchase_nonsalable_return: 'Purchase Non-saleable Return',
    purchase_additional_expense: 'Purchase Additional Expense', cash_bank_entry: 'Cash / Bank Entry', pdc: 'PDC', journal_voucher: 'Journal Voucher', credit_note: 'Credit Note',
    debit_note: 'Debit Note', production: 'Production', stock_transfer: 'Stock Transfer', interest_posting: 'Interest Posting', depreciation: 'Depreciation', asset_disposal: 'Asset Disposal',
    agent_commission: 'Agent Commission', ledger_opening: 'Opening'
};
const HEADER = { sales_bill: 'sales_bills', sales_return: 'sales_returns', purchase_bill: 'purchase_bills', purchase_grn: 'purchase_grns', purchase_return: 'purchase_returns',
    cash_bank_entry: 'cash_bank_entries', pdc: 'pdc_vouchers', journal_voucher: 'journal_vouchers', credit_note: 'credit_notes', debit_note: 'debit_notes', production: 'production_orders',
    stock_transfer: 'stock_transfers', sales_additional: 'sales_additional_entries', purchase_additional_expense: 'purchase_additional_expenses', interest_posting: 'interest_runs',
    depreciation: 'depreciation_runs', asset_disposal: 'depreciation_runs', agent_commission: 'agent_commission_postings', sales_nonsalable_return: 'sales_nonsaleable_returns',
    purchase_nonsalable_return: 'purchase_nonsaleable_returns', sales_delivery: 'sales_deliveries' };

async function ledgersById(c, t) {
    const rows = await fetchAll(() => c.from('ledger_accounts').select('*').eq('tenant_id', t).order('id'));
    return Object.fromEntries(rows.map(l => [l.id, l]));
}
async function glLines(c, t, { from, to, ledgerIds }) {
    return fetchAll(() => {
        let q = c.from('ledger_transaction_lines').select('id, batch_id, ledger_account_id, sub_ledger_id, debit_amount, credit_amount, narration, batch:batch_id!inner(batch_date, document_type, document_id, narration)').eq('tenant_id', t);
        if (from) q = q.gte('batch.batch_date', from);
        if (to) q = q.lte('batch.batch_date', to);
        if (ledgerIds) q = q.in('ledger_account_id', ledgerIds);
        return q.order('id');
    });
}
async function docNos(c, lines) {
    const byType = {};
    lines.forEach(l => { const ty = l.batch.document_type; if (HEADER[ty]) (byType[ty] = byType[ty] || new Set()).add(l.batch.document_id); });
    const out = {};
    for (const [ty, set] of Object.entries(byType)) {
        const rows = await safe(inChunks([...set], async ch => (await c.from(HEADER[ty]).select('id, doc_no').in('id', ch)).data || []));
        rows.forEach(r => { out[`${ty}:${r.id}`] = r.doc_no; });
    }
    return out;
}
// customers (sales / both) or suppliers (purchase / both)
async function parties(c, t, side) {
    const cats = side === 'customer' ? ['sales', 'both'] : ['purchase', 'both'];
    return fetchAll(() => c.from('ledger_accounts').select('*').eq('tenant_id', t).in('category_type', cats).order('account_name').order('id'));
}
async function balancesOf(c, t, ids, to = today()) {
    const bal = {};
    const lines = await inChunks(ids, ch => fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)')
        .eq('tenant_id', t).in('ledger_account_id', ch).lte('batch.batch_date', to).order('id')), 100);
    lines.forEach(l => { bal[l.ledger_account_id] = (bal[l.ledger_account_id] || 0) + Number(l.debit_amount || 0) - Number(l.credit_amount || 0); });
    return bal;
}
async function names(c, t) {
    const [areas, routes, agents] = await Promise.all([
        safe(fetchAll(() => c.from('areas').select('id, area_name').eq('tenant_id', t).order('id'))),
        safe(fetchAll(() => c.from('routes').select('id, route_name, area_id, default_agent_id').eq('tenant_id', t).order('id'))),
        safe(fetchAll(() => c.from('salesman_agents').select('id, agent_name').eq('tenant_id', t).order('id')))
    ]);
    const m = rows => Object.fromEntries(rows.map(r => [r.id, r]));
    return { areas: m(areas), routes: m(routes), agents: m(agents) };
}
async function lastDocDates(c, t, table, col, ids) {
    const rows = await inChunks(ids, ch => fetchAll(() => c.from(table).select(`${col}, doc_date, total_amount`).eq('tenant_id', t).eq('status', 'posted').in(col, ch).order('id')));
    const last = {}, value = {};
    rows.forEach(r => { const d = String(r.doc_date).slice(0, 10); if (!last[r[col]] || d > last[r[col]]) last[r[col]] = d; value[r[col]] = (value[r[col]] || 0) + Number(r.total_amount || 0); });
    return { last, value };
}

// base-unit purchase rate / barcode per product (they live on product_unit_rates)
async function unitRates(c, t) {
    const rows = await safe(fetchAll(() => c.from('product_unit_rates').select('product_id, is_base_unit, purchase_rate, last_purchase_rate, barcode').eq('tenant_id', t).order('id')));
    const out = {};
    rows.forEach(r => { const x = (out[r.product_id] = out[r.product_id] || { purchase_rate: 0, barcode: false }); if (r.is_base_unit || !x.purchase_rate) x.purchase_rate = Number(r.purchase_rate || r.last_purchase_rate) || x.purchase_rate; if (r.barcode) x.barcode = true; });
    return out;
}

async function controlReport(c, t, view, q) {
    const from = q.date_from || `${today().slice(0, 4)}-01-01`, to = q.date_to || today();
    if (view === 'day_book') {
        const L = await ledgersById(c, t);
        let lines = await glLines(c, t, { from, to });
        if (q.doc_type) lines = lines.filter(l => l.batch.document_type === q.doc_type);
        const nos = await docNos(c, lines);
        const batches = {};
        lines.forEach(l => {
            const b = (batches[l.batch_id] = batches[l.batch_id] || { batch_id: l.batch_id, date: String(l.batch.batch_date).slice(0, 10), doc_type: l.batch.document_type, doc_label: GL_LABEL[l.batch.document_type] || l.batch.document_type,
                doc_id: l.batch.document_id, doc_no: nos[`${l.batch.document_type}:${l.batch.document_id}`] || '', narration: l.batch.narration || '', lines: [], debit: 0, credit: 0 });
            b.lines.push({ ledger: L[l.ledger_account_id]?.account_name || '?', debit: round2(l.debit_amount), credit: round2(l.credit_amount), narration: l.narration || '' });
            b.debit += Number(l.debit_amount || 0); b.credit += Number(l.credit_amount || 0);
        });
        const rows = Object.values(batches).map(b => ({ ...b, debit: round2(b.debit), credit: round2(b.credit) })).sort((a, b) => a.date.localeCompare(b.date) || String(a.doc_no).localeCompare(String(b.doc_no)));
        const byType = {};
        rows.forEach(r => { const x = (byType[r.doc_label] = byType[r.doc_label] || { doc_label: r.doc_label, vouchers: 0, amount: 0 }); x.vouchers++; x.amount = round2(x.amount + r.debit); });
        return { from, to, rows, by_type: Object.values(byType), totals: { debit: round2(rows.reduce((s, r) => s + r.debit, 0)), credit: round2(rows.reduce((s, r) => s + r.credit, 0)), vouchers: rows.length } };
    }
    if (view === 'cash_bank_book') {
        const [groups, L] = await Promise.all([loadGroups(c, t), ledgersById(c, t)]);
        let ids = Object.values(L).filter(l => groups[l.account_group_id]?.anchor === 'CASH_BANK' || ['cash', 'bank'].includes(l.category_type)).map(l => l.id);
        if (q.ledger_id) ids = ids.filter(id => id === q.ledger_id);
        if (!ids.length) return { from, to, books: [] };
        const [before, lines] = await Promise.all([
            inChunks(ids, ch => fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)').eq('tenant_id', t).in('ledger_account_id', ch).lt('batch.batch_date', from).order('id')), 100),
            glLines(c, t, { from, to, ledgerIds: ids })
        ]);
        // contra side of each voucher
        const batchIds = [...new Set(lines.map(l => l.batch_id))];
        const others = await inChunks(batchIds, async ch => (await c.from('ledger_transaction_lines').select('batch_id, ledger_account_id, debit_amount, credit_amount').in('batch_id', ch)).data || []);
        const nos = await docNos(c, lines);
        const books = ids.map(id => {
            const l = L[id];
            let run = (l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0) + before.filter(x => x.ledger_account_id === id).reduce((s, x) => s + Number(x.debit_amount || 0) - Number(x.credit_amount || 0), 0);
            const opening = round2(run);
            const entries = lines.filter(x => x.ledger_account_id === id).sort((a, b) => String(a.batch.batch_date).localeCompare(String(b.batch.batch_date)) || String(a.id).localeCompare(String(b.id))).map(x => {
                run += Number(x.debit_amount || 0) - Number(x.credit_amount || 0);
                const contra = [...new Set(others.filter(o => o.batch_id === x.batch_id && o.ledger_account_id !== id).map(o => L[o.ledger_account_id]?.account_name || '?'))];
                return { date: String(x.batch.batch_date).slice(0, 10), doc_label: GL_LABEL[x.batch.document_type] || x.batch.document_type, doc_no: nos[`${x.batch.document_type}:${x.batch.document_id}`] || '',
                    particulars: contra.join(', '), narration: x.narration || x.batch.narration || '', receipt: round2(x.debit_amount), payment: round2(x.credit_amount), balance: round2(run) };
            });
            return { ledger_id: id, ledger_name: l.account_name, opening, receipts: round2(entries.reduce((s, e) => s + e.receipt, 0)), payments: round2(entries.reduce((s, e) => s + e.payment, 0)), closing: round2(run), entries };
        }).filter(b => b.entries.length || Math.abs(b.opening) > 0.005);
        return { from, to, books };
    }
    if (view === 'customer_master' || view === 'supplier_master') {
        const side = view === 'customer_master' ? 'customer' : 'supplier';
        const [rows, N] = await Promise.all([parties(c, t, side), names(c, t)]);
        const ids = rows.map(r => r.id);
        const [bal, lastDoc, refs] = await Promise.all([
            balancesOf(c, t, ids),
            side === 'customer' ? lastDocDates(c, t, 'sales_bills', 'customer_ledger_id', ids) : lastDocDates(c, t, 'purchase_bills', 'vendor_ledger_id', ids),
            inChunks(ids, async ch => (await c.from('bill_wise_references').select('ledger_id, source_date, remaining_amount, nature').in('ledger_id', ch).gt('remaining_amount', 0)).data || [])
        ]);
        const d = today();
        return { rows: rows.map(l => {
            const open = (Number(l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0)) + (bal[l.id] || 0);
            const dueOf = r => new Date(Date.parse(`${String(r.source_date).slice(0, 10)}T00:00:00Z`) + (Number(l.credit_days) || 0) * 86400000).toISOString().slice(0, 10);
            const overdue = refs.filter(r => r.ledger_id === l.id && r.nature === (side === 'customer' ? 'dr' : 'cr') && dueOf(r) < d).reduce((s, r) => s + Number(r.remaining_amount || 0), 0);
            return { id: l.id, code: l.account_code, name: l.account_name, billing_name: l.billing_name || '', pan: l.vat_pan_number || l.pan_number || '', vat_type: l.vat_pan_type || '',
                phone: l.phone_office || l.contact_person_mobile || '', contact_person: l.contact_person || '', email: l.email || '', address: [l.billing_address, l.city].filter(Boolean).join(', '),
                area: N.areas[l.area_id]?.area_name || '', route: N.routes[l.route_id]?.route_name || '', agent: N.agents[l.agent_id]?.agent_name || '',
                credit_limit: round2(l.credit_limit), credit_days: l.credit_days || 0, interest_rate: Number(l.interest_rate) || 0, balance: round2(open), overdue: round2(overdue),
                last_doc_date: lastDoc.last[l.id] || '', total_value: round2(lastDoc.value[l.id] || 0), active: l.is_active !== false };
        }) };
    }
    if (view === 'price_list') {
        const [products, groups, comps, units, st, R] = await Promise.all([
            fetchAll(() => c.from('products').select('*').eq('tenant_id', t).eq('is_active', true).order('product_name').order('id')),
            safe(fetchAll(() => c.from('product_groups').select('id, group_name').eq('tenant_id', t).order('id'))),
            safe(fetchAll(() => c.from('product_companies').select('id, company_name').eq('tenant_id', t).order('id'))),
            safe(fetchAll(() => c.from('product_units').select('id, unit_name').eq('tenant_id', t).order('id'))),
            q.with_stock === 'false' ? Promise.resolve({ rows: [] }) : stockReport(c, t, { mode: 'summary', date_from: today(), date_to: today(), group_by: 'item', hide_zero: 'false' }).catch(() => ({ rows: [] })),
            unitRates(c, t)
        ]);
        const G = Object.fromEntries(groups.map(x => [x.id, x.group_name])), C = Object.fromEntries(comps.map(x => [x.id, x.company_name])), U = Object.fromEntries(units.map(x => [x.id, x.unit_name]));
        const S = Object.fromEntries((st.rows || []).map(r => [r.product_id, r.closing_qty]));
        let rows = products.map(p => ({ id: p.id, code: p.product_code, name: p.product_name, hs_code: p.hs_code || '', unit: U[p.base_unit_id] || '', group: G[p.product_group_id] || '', company: C[p.product_company_id] || '',
            mrp: round2(p.mrp), sr1: round2(p.sales_rate_sr1), sr2: round2(p.sales_rate_sr2), sr3: round2(p.sales_rate_sr3), sr4: round2(p.sales_rate_sr4), sr5: round2(p.sales_rate_sr5),
            purchase_rate: round2(R[p.id]?.purchase_rate), vat: p.vat_applicable === false ? 'No' : 'Yes', discount: Number(p.default_discount_percent) || 0, stock: S[p.id] ?? null, blocked: !!p.is_blocked }));
        if (q.product_group_id) rows = rows.filter(r => products.find(p => p.id === r.id).product_group_id === q.product_group_id);
        if (q.product_company_id) rows = rows.filter(r => products.find(p => p.id === r.id).product_company_id === q.product_company_id);
        return { rows };
    }
    if (view === 'route_customers') {
        const N = await names(c, t);
        const links = await safe(fetchAll(() => c.from('route_customers').select('route_id, ledger_account_id, sequence_order, is_active').eq('tenant_id', t).order('id')));
        const L = await ledgersById(c, t);
        const rows = links.filter(l => l.is_active !== false).map(l => {
            const r = N.routes[l.route_id] || {}, led = L[l.ledger_account_id] || {};
            return { area: N.areas[r.area_id]?.area_name || '', route: r.route_name || '?', salesman: N.agents[r.default_agent_id]?.agent_name || '', seq: l.sequence_order, customer: led.account_name || '?',
                pan: led.pan_number || '', phone: led.phone_office || led.contact_person_mobile || '', address: [led.billing_address, led.city].filter(Boolean).join(', '), credit_limit: round2(led.credit_limit) };
        }).sort((a, b) => a.area.localeCompare(b.area) || a.route.localeCompare(b.route) || a.seq - b.seq);
        const onRoute = new Set(links.map(l => l.ledger_account_id));
        const custs = await parties(c, t, 'customer');
        return { rows, not_on_any_route: custs.filter(x => !onRoute.has(x.id) && x.is_active !== false).map(x => ({ customer: x.account_name, area: N.areas[x.area_id]?.area_name || '' })) };
    }
    if (view === 'credit_exceed' || view === 'inactive_customers') {
        const r = await controlReport(c, t, 'customer_master', q);
        if (view === 'credit_exceed') {
            const rows = r.rows.filter(x => (x.credit_limit > 0 && x.balance > x.credit_limit) || x.overdue > 0.005)
                .map(x => ({ ...x, excess: x.credit_limit > 0 ? round2(Math.max(0, x.balance - x.credit_limit)) : 0, used_pct: x.credit_limit > 0 ? round2(x.balance * 100 / x.credit_limit) : null }))
                .sort((a, b) => b.excess - a.excess || b.overdue - a.overdue);
            return { rows };
        }
        const n = Number(q.days) || 60, d = today();
        return { days: n, rows: r.rows.filter(x => x.active && (!x.last_doc_date || days(x.last_doc_date, d) >= n)).map(x => ({ ...x, idle_days: x.last_doc_date ? days(x.last_doc_date, d) : null }))
            .sort((a, b) => (b.idle_days ?? 99999) - (a.idle_days ?? 99999)) };
    }
    if (view === 'non_moving_items') {
        const n = Number(q.days) || 90, d = today();
        const since = new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
        const bills = await fetchAll(() => c.from('sales_bills').select('id, doc_date').eq('tenant_id', t).eq('status', 'posted').order('id'));
        const B = Object.fromEntries(bills.map(b => [b.id, String(b.doc_date).slice(0, 10)]));
        const lines = await inChunks(bills.map(b => b.id), async ch => (await c.from('sales_bill_details').select('bill_id, product_id').in('bill_id', ch)).data || []);
        const last = {};
        lines.forEach(l => { const dt = B[l.bill_id]; if (!last[l.product_id] || dt > last[l.product_id]) last[l.product_id] = dt; });
        const st = await stockReport(c, t, { mode: 'summary', date_from: d, date_to: d, group_by: 'item', hide_zero: 'true' });
        const rows = (st.rows || []).filter(r => !last[r.product_id] || last[r.product_id] < since).map(r => ({ code: r.product_code, name: r.product_name, group: r.group_name, company: r.company_name, unit: r.unit,
            stock: r.closing_qty, value: r.closing_value, last_sale: last[r.product_id] || '', idle_days: last[r.product_id] ? days(last[r.product_id], d) : null }))
            .sort((a, b) => b.value - a.value);
        return { days: n, rows, totals: { value: round2(rows.reduce((s, r) => s + r.value, 0)) } };
    }
    if (view === 'master_exceptions') {
        const [groups, L, products, N, R] = await Promise.all([loadGroups(c, t), ledgersById(c, t), fetchAll(() => c.from('products').select('*').eq('tenant_id', t).eq('is_active', true).order('id')), names(c, t), unitRates(c, t)]);
        const out = [];
        const add = (type, check, name, detail) => out.push({ type, check, name, detail: detail || '' });
        Object.values(L).filter(l => l.is_active !== false).forEach(l => {
            const party = ['sales', 'purchase', 'both'].includes(l.category_type);
            if (sectionOf(groups[l.account_group_id]) === 'unmapped') add('Ledger', 'Group not mapped to P&L / Balance Sheet', l.account_name, groups[l.account_group_id]?.group_name);
            if (!party) return;
            if (!l.pan_number && !l.vat_pan_number) add('Party', 'No PAN / VAT number', l.account_name);
            if (['sales', 'both'].includes(l.category_type)) {
                if (!l.area_id) add('Customer', 'No area', l.account_name);
                if (!l.route_id) add('Customer', 'No route', l.account_name);
                if (!l.agent_id) add('Customer', 'No salesman / agent', l.account_name);
                if (!(Number(l.credit_limit) > 0)) add('Customer', 'No credit limit', l.account_name);
            }
            if (!l.phone_office && !l.contact_person_mobile) add('Party', 'No phone', l.account_name);
        });
        products.forEach(p => {
            if (!p.hs_code) add('Product', 'No HS code', p.product_name);
            if (!p.sales_account_ledger_id) add('Product', 'No sales account (uses the default)', p.product_name);
            if (!p.product_group_id) add('Product', 'No product group', p.product_name);
            if (!p.product_company_id) add('Product', 'No product company', p.product_name);
            if (!(Number(p.sales_rate_sr1) > 0)) add('Product', 'No sales rate (SR1)', p.product_name);
            if (!R[p.id]?.barcode) add('Product', 'No barcode', p.product_name);
        });
        Object.values(N.routes).forEach(r => { if (!r.default_agent_id) add('Route', 'No salesman assigned', r.route_name); });
        const summary = {};
        out.forEach(x => { const k = `${x.type}: ${x.check}`; summary[k] = (summary[k] || 0) + 1; });
        return { rows: q.check ? out.filter(x => `${x.type}: ${x.check}` === q.check) : out, summary: Object.entries(summary).map(([check, count]) => ({ check, count })).sort((a, b) => b.count - a.count) };
    }
    if (view === 'cancelled_docs' || view === 'draft_docs') {
        const rows = [];
        for (const [type, [table, label, partyCol]] of Object.entries(DOC_TABLES)) {
            const cols = ['id', 'doc_no', 'doc_date', 'status', view === 'cancelled_docs' ? 'cancellation_reason, cancelled_at, cancelled_by' : 'created_at, created_by', partyCol, 'total_amount'].filter(Boolean).join(', ');
            let data = await safe(fetchAll(() => c.from(table).select(cols).eq('tenant_id', t).eq('status', view === 'cancelled_docs' ? 'cancelled' : 'draft').gte('doc_date', from).lte('doc_date', to).order('id')));
            if (!data.length && view === 'cancelled_docs') data = [];
            data.forEach(d => rows.push({ doc_type: type, doc_label: label, id: d.id, doc_no: d.doc_no, doc_date: String(d.doc_date).slice(0, 10), party: partyCol ? d[partyCol] || '' : '',
                amount: round2(d.total_amount), reason: d.cancellation_reason || '', at: d.cancelled_at || d.created_at || '', by: d.cancelled_by || d.created_by || null, age_days: days(d.doc_date, today()) }));
        }
        const users = [...new Set(rows.map(r => r.by).filter(Boolean))];
        const { data: us } = users.length ? await c.from('users').select('id, full_name').in('id', users) : { data: [] };
        const U = Object.fromEntries((us || []).map(u => [u.id, u.full_name]));
        rows.forEach(r => { r.by = U[r.by] || ''; });
        rows.sort((a, b) => a.doc_date.localeCompare(b.doc_date));
        const byType = {};
        rows.forEach(r => { const x = (byType[r.doc_label] = byType[r.doc_label] || { doc_label: r.doc_label, count: 0, amount: 0 }); x.count++; x.amount = round2(x.amount + r.amount); });
        return { from, to, rows, by_type: Object.values(byType) };
    }
    throw httpError('Unknown report');
}

module.exports = { controlReport };
