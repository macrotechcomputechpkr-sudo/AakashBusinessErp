// =============================================
// utils/dimensionReports.js
// General-ledger reports cut by the accounting dimensions:
//   ledger, account group, statement (P&L / Balance Sheet), sub-ledger,
//   cost center, unit (business unit), branch, document type, document
//   class (the numbering category a doc no belongs to), product company,
//   month.
// Every GL line gets its dimensions from its own row (ledger, sub-ledger,
// product company) and from its document: the document header's cost
// center / unit / branch, a Journal Voucher line's own cost center / unit,
// and the doc no -> numbering category (prefix / suffix match).
//
// Views
//   pivot       rows = up to 3 dimensions, optional column dimension
//               (month, or any other); opening / debit / credit / closing
//   pl          Profit & Loss with one column per cost center / unit /
//               branch / doc class ... and a net profit row
//   statement   transactions of one dimension value (e.g. a cost center or
//               a sub-ledger) with running balance and contra ledgers
//   exceptions  lines missing a dimension - P&L lines without cost center /
//               unit, ledgers that need a sub-ledger posted without one
//   doc_class   document class register from the documents themselves:
//               count, amount, first / last no, cancelled, drafts, and
//               gaps / duplicates in the numbering sequence
// =============================================

const { loadGroups, sectionOf } = require('./financialEngine');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
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

// GL document_type -> header table and numbering voucher type
const DOCS = {
    sales_bill: ['sales_bills', 'sales_bill', 'Sales Bill'], sales_return: ['sales_returns', 'sales_return', 'Sales Return'],
    sales_nonsalable_return: ['sales_nonsaleable_returns', 'sales_nonsalable_return', 'Sales Non-saleable Return'], sales_additional: ['sales_additional_entries', 'sales_additional', 'Sales Additional'],
    purchase_grn: ['purchase_grns', 'purchase_grn', 'Purchase GRN'], purchase_bill: ['purchase_bills', 'purchase_bill', 'Purchase Bill'], purchase_return: ['purchase_returns', 'purchase_return', 'Purchase Return'],
    purchase_nonsalable_return: ['purchase_nonsaleable_returns', 'purchase_nonsalable_return', 'Purchase Non-saleable Return'],
    purchase_additional_expense: ['purchase_additional_expenses', 'purchase_additional', 'Purchase Additional Expense'],
    cash_bank_entry: ['cash_bank_entries', 'cash_bank_entry', 'Cash / Bank Entry'], pdc: ['pdc_vouchers', 'pdc', 'PDC'], journal_voucher: ['journal_vouchers', 'journal', 'Journal Voucher'],
    credit_note: ['credit_notes', 'credit_note', 'Credit Note'], debit_note: ['debit_notes', 'debit_note', 'Debit Note'], production: ['production_orders', 'production', 'Production'],
    stock_transfer: ['stock_transfers', 'stock_transfer', 'Stock Transfer'], interest_posting: ['interest_runs', null, 'Interest Posting'],
    depreciation: ['depreciation_runs', null, 'Depreciation'], asset_disposal: ['depreciation_runs', null, 'Asset Disposal']
};
// document tables for the doc-class register (all documents, posted or not)
const CLASS_TABLES = {
    sales_quotation: 'sales_quotations', sales_order: 'sales_orders', sales_delivery: 'sales_deliveries', sales_bill: 'sales_bills', sales_return: 'sales_returns',
    sales_nonsalable_return: 'sales_nonsaleable_returns', sales_additional: 'sales_additional_entries', purchase_requisition: 'purchase_requisitions', purchase_quotation: 'purchase_quotations',
    purchase_order: 'purchase_orders', purchase_grn: 'purchase_grns', purchase_bill: 'purchase_bills', purchase_return: 'purchase_returns', purchase_nonsalable_return: 'purchase_nonsaleable_returns',
    purchase_additional: 'purchase_additional_expenses', cash_bank_entry: 'cash_bank_entries', pdc: 'pdc_vouchers', journal: 'journal_vouchers', credit_note: 'credit_notes', debit_note: 'debit_notes',
    production: 'production_orders', stock_transfer: 'stock_transfers'
};
const DIMS = {
    ledger: 'Ledger', group: 'Account Group', statement: 'P&L / Balance Sheet', sub_ledger: 'Sub-ledger', cost_center: 'Cost Center', business_unit: 'Unit',
    branch: 'Branch', doc_type: 'Document Type', doc_class: 'Document Class', product_company: 'Product Company', month: 'Month'
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Which numbering category a doc no belongs to: same voucher type, doc no
// starts with its prefix and ends with its suffix - the longest prefix wins.
function classOf(categories, voucherType, docNo) {
    const no = String(docNo || '');
    let best = null;
    categories.filter(cat => cat.voucher_type === voucherType).forEach(cat => {
        const p = cat.prefix || '', s = cat.suffix || '';
        if (no.startsWith(p) && no.endsWith(s) && no.length >= p.length + s.length && (!best || p.length + s.length > (best.prefix || '').length + (best.suffix || '').length)) best = cat;
    });
    return best;
}

async function masters(c, t) {
    const all = (table, cols) => fetchAll(() => c.from(table).select(cols).eq('tenant_id', t).order('id')).catch(() => []);
    const [groups, ledgers, subs, ccs, bus, branches, companies, cats] = await Promise.all([
        loadGroups(c, t), all('ledger_accounts', '*'), all('sub_ledgers', 'id, sub_ledger_code, sub_ledger_name, main_ledger_id, sub_ledger_type'),
        all('cost_centers', 'id, cost_center_code, cost_center_name'), all('business_units', 'id, unit_code, unit_name'), all('branches', 'id, branch_name'),
        all('product_companies', 'id, company_name'), all('document_numbering_categories', 'id, voucher_type, category_name, prefix, suffix, digit_count, start_number, include_fiscal_year, is_active')
    ]);
    const byId = rows => Object.fromEntries(rows.map(r => [r.id, r]));
    return { groups, ledgers: byId(ledgers), subs: byId(subs), ccs: byId(ccs), bus: byId(bus), branches: byId(branches), companies: byId(companies), cats };
}

// GL lines with every dimension resolved. `from` null = everything up to `to`.
async function dimLines(c, t, M, { from = null, to, ledgerIds = [] }) {
    const lines = await fetchAll(() => {
        let q = c.from('ledger_transaction_lines').select('id, ledger_account_id, sub_ledger_id, product_company_id, debit_amount, credit_amount, narration, batch_id, batch:batch_id!inner(batch_date, document_type, document_id, narration)')
            .eq('tenant_id', t).lte('batch.batch_date', to);
        if (ledgerIds.length) q = q.in('ledger_account_id', ledgerIds);
        return q.order('id');
    });
    // documents
    const byType = {};
    lines.forEach(l => { if (DOCS[l.batch.document_type]) (byType[l.batch.document_type] = byType[l.batch.document_type] || new Set()).add(l.batch.document_id); });
    const heads = {};
    for (const [type, set] of Object.entries(byType)) {
        (await inChunks([...set], async ch => { const { data } = await c.from(DOCS[type][0]).select('*').in('id', ch); return data || []; }))
            .forEach(h => { heads[`${type}:${h.id}`] = h; });
    }
    // JV lines carry their own cost center / unit
    const jvIds = [...(byType.journal_voucher || [])];
    const jvLines = await inChunks(jvIds, async ch => { const { data } = await c.from('journal_voucher_details').select('jv_id, ledger_id, debit_amount, credit_amount, cost_center_id, business_unit_id, display_order').in('jv_id', ch); return data || []; });
    const jvPool = {};
    jvLines.forEach(d => { const k = `${d.jv_id}|${d.ledger_id}|${round2(d.debit_amount)}|${round2(d.credit_amount)}`; (jvPool[k] = jvPool[k] || []).push(d); });
    return lines.map(l => {
        const type = l.batch.document_type, h = heads[`${type}:${l.batch.document_id}`] || {};
        const dr = round2(l.debit_amount), cr = round2(l.credit_amount);
        let cc = h.cost_center_id || null, bu = h.business_unit_id || null;
        if (type === 'journal_voucher') { const pool = jvPool[`${l.batch.document_id}|${l.ledger_account_id}|${dr}|${cr}`]; const d = pool && pool.shift(); if (d) { cc = d.cost_center_id || cc; bu = d.business_unit_id || bu; } }
        const led = M.ledgers[l.ledger_account_id] || {}, g = M.groups[led.account_group_id];
        const section = sectionOf(g);
        const date = String(l.batch.batch_date).slice(0, 10);
        const cat = DOCS[type] && DOCS[type][1] ? classOf(M.cats, DOCS[type][1], h.doc_no) : null;
        return {
            id: l.id, date, month: date.slice(0, 7), dr, cr, narration: l.narration || l.batch.narration || '', doc_type: type, doc_label: DOCS[type]?.[2] || type, doc_id: l.batch.document_id, doc_no: h.doc_no || '', batch_id: l.batch_id,
            ledger: l.ledger_account_id, ledger_name: led.account_name || '', group: led.account_group_id || null, group_name: g?.group_name || '', section,
            statement: section === 'unmapped' ? 'unmapped' : /income|expense/.test(section) ? 'pl' : 'bs',
            sub_ledger: l.sub_ledger_id || null, cost_center: cc, business_unit: bu, branch: h.branch_id || null, product_company: l.product_company_id || h.product_company_id || null,
            doc_class: cat ? cat.id : null
        };
    });
}

function dimValue(M, dim, l) {
    switch (dim) {
        case 'ledger': return [l.ledger, l.ledger_name];
        case 'group': return [l.group, l.group_name || '(no group)'];
        case 'statement': return [l.statement, { pl: 'Profit & Loss', bs: 'Balance Sheet', unmapped: 'Unmapped' }[l.statement]];
        case 'sub_ledger': return [l.sub_ledger, l.sub_ledger ? M.subs[l.sub_ledger]?.sub_ledger_name || '?' : '(no sub-ledger)'];
        case 'cost_center': return [l.cost_center, l.cost_center ? M.ccs[l.cost_center]?.cost_center_name || '?' : '(no cost center)'];
        case 'business_unit': return [l.business_unit, l.business_unit ? M.bus[l.business_unit]?.unit_name || '?' : '(no unit)'];
        case 'branch': return [l.branch, l.branch ? M.branches[l.branch]?.branch_name || '?' : '(no branch)'];
        case 'doc_type': return [l.doc_type, l.doc_label];
        case 'doc_class': { const cat = M.cats.find(x => x.id === l.doc_class); return [l.doc_class, cat ? `${cat.category_name} (${cat.voucher_type})` : '(no class)']; }
        case 'product_company': return [l.product_company, l.product_company ? M.companies[l.product_company]?.company_name || '?' : '(none)'];
        case 'month': return [l.month, `${MONTHS[Number(l.month.slice(5, 7)) - 1]} ${l.month.slice(0, 4)}`];
        default: return [null, ''];
    }
}
function applyFilters(lines, q) {
    const f = k => csv(q[k]);
    let r = lines;
    [['ledger', 'ledger_ids'], ['group', 'group_ids'], ['sub_ledger', 'sub_ledger_ids'], ['cost_center', 'cost_center_ids'], ['business_unit', 'business_unit_ids'], ['branch', 'branch_ids'],
        ['doc_type', 'doc_types'], ['doc_class', 'doc_class_ids'], ['product_company', 'product_company_ids']].forEach(([dim, key]) => {
        const v = f(key);
        if (v.length) r = r.filter(l => v.includes(l[dim] === null ? '__none__' : l[dim]));
    });
    if (q.statement) r = r.filter(l => l.statement === q.statement);
    return r;
}

// ---------- pivot ----------
async function pivot(c, t, q) {
    const from = q.from, to = q.to;
    if (!to) throw httpError('Choose the To date');
    const rowsDims = csv(q.rows).filter(d => DIMS[d]).slice(0, 3);
    if (!rowsDims.length) rowsDims.push('ledger');
    const colDim = DIMS[q.columns] && !rowsDims.includes(q.columns) ? q.columns : null;
    const M = await masters(c, t);
    const all = applyFilters(await dimLines(c, t, M, { to }), q);
    // opening only makes sense where the balance belongs to the rows (ledger / sub-ledger / group ...)
    const withOpening = q.with_opening !== 'false';
    const tree = new Map();
    const colSet = new Map();
    const node = () => ({ opening: 0, dr: 0, cr: 0, cols: {} });
    all.forEach(l => {
        const inPeriod = !from || l.date >= from;
        if (!inPeriod && !withOpening) return;
        const keys = rowsDims.map(d => dimValue(M, d, l));
        const k = keys.map(x => x[0] || '__none__').join('|');
        if (!tree.has(k)) tree.set(k, { key: k, labels: Object.fromEntries(rowsDims.map((d, i) => [d, keys[i][1]])), ids: Object.fromEntries(rowsDims.map((d, i) => [d, keys[i][0]])), ...node() });
        const n = tree.get(k);
        if (!inPeriod) { n.opening += l.dr - l.cr; return; }
        n.dr += l.dr; n.cr += l.cr;
        if (colDim) { const [cid, clabel] = dimValue(M, colDim, l); const ck = cid || '__none__'; colSet.set(ck, clabel); n.cols[ck] = round2((n.cols[ck] || 0) + l.dr - l.cr); }
    });
    // ledger masters' opening balances when the rows are ledger-based
    if (withOpening && rowsDims[0] === 'ledger' && rowsDims.length === 1) {
        tree.forEach(n => { const led = M.ledgers[n.ids.ledger]; if (led) n.opening += (led.opening_balance_type === 'cr' ? -1 : 1) * (Number(led.opening_balance) || 0); });
    }
    const rows = [...tree.values()].map(n => ({ ...n, opening: round2(n.opening), dr: round2(n.dr), cr: round2(n.cr), net: round2(n.dr - n.cr), closing: round2(n.opening + n.dr - n.cr) }))
        .filter(n => q.hide_zero === 'false' || n.opening || n.dr || n.cr)
        .sort((a, b) => rowsDims.map(d => String(a.labels[d]).localeCompare(String(b.labels[d]))).find(x => x) || 0);
    const columns = [...colSet.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => colDim === 'month' ? a.key.localeCompare(b.key) : String(a.label).localeCompare(String(b.label)));
    const sum = k => round2(rows.reduce((s, r) => s + r[k], 0));
    return { from, to, rows_dims: rowsDims.map(d => ({ key: d, label: DIMS[d] })), column_dim: colDim ? { key: colDim, label: DIMS[colDim] } : null, columns, rows,
        totals: { opening: sum('opening'), dr: sum('dr'), cr: sum('cr'), closing: sum('closing'), cols: Object.fromEntries(columns.map(cl => [cl.key, round2(rows.reduce((s, r) => s + (r.cols[cl.key] || 0), 0))])) } };
}

// ---------- P&L by dimension ----------
async function plByDimension(c, t, q) {
    if (!q.from || !q.to) throw httpError('Choose From and To dates');
    const dim = DIMS[q.dimension] && !['ledger', 'group', 'statement'].includes(q.dimension) ? q.dimension : 'cost_center';
    const M = await masters(c, t);
    const lines = applyFilters(await dimLines(c, t, M, { to: q.to }), q).filter(l => l.date >= q.from && l.statement === 'pl');
    const cols = new Map(), rows = new Map();
    lines.forEach(l => {
        const [cid, clabel] = dimValue(M, dim, l); const ck = cid || '__none__'; cols.set(ck, clabel);
        const income = /income/.test(l.section);
        const rk = `${income ? '1' : '2'}|${q.detail === 'group' ? l.group : l.ledger}`;
        if (!rows.has(rk)) rows.set(rk, { key: rk, side: income ? 'income' : 'expense', section: l.section, name: q.detail === 'group' ? l.group_name : l.ledger_name, group_name: l.group_name, cols: {}, total: 0 });
        const r = rows.get(rk), v = income ? l.cr - l.dr : l.dr - l.cr;
        r.cols[ck] = round2((r.cols[ck] || 0) + v); r.total = round2(r.total + v);
    });
    const columns = [...cols.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => (a.key === '__none__') - (b.key === '__none__') || String(a.label).localeCompare(String(b.label)));
    const list = [...rows.values()].sort((a, b) => a.side.localeCompare(b.side) || a.section.localeCompare(b.section) || String(a.group_name).localeCompare(String(b.group_name)) || String(a.name).localeCompare(String(b.name)));
    const tot = side => Object.fromEntries(columns.map(cl => [cl.key, round2(list.filter(r => r.side === side).reduce((s, r) => s + (r.cols[cl.key] || 0), 0))]));
    const inc = tot('income'), exp = tot('expense');
    const net = Object.fromEntries(columns.map(cl => [cl.key, round2((inc[cl.key] || 0) - (exp[cl.key] || 0))]));
    const sumAll = o => round2(Object.values(o).reduce((a, b) => a + b, 0));
    return { from: q.from, to: q.to, dimension: { key: dim, label: DIMS[dim] }, columns, rows: list, income: inc, expense: exp, net,
        totals: { income: sumAll(inc), expense: sumAll(exp), net: sumAll(net) } };
}

// ---------- statement of one dimension value ----------
async function statement(c, t, q) {
    const dim = DIMS[q.dimension] ? q.dimension : 'ledger';
    if (!q.value) throw httpError(`Choose the ${DIMS[dim]}`);
    if (!q.to) throw httpError('Choose the To date');
    const M = await masters(c, t);
    const all = applyFilters(await dimLines(c, t, M, { to: q.to }), q).filter(l => (l[dim] || '__none__') === q.value);
    const before = q.from ? all.filter(l => l.date < q.from) : [];
    let opening = round2(before.reduce((s, l) => s + l.dr - l.cr, 0));
    if (dim === 'ledger') { const led = M.ledgers[q.value]; if (led) opening = round2(opening + (led.opening_balance_type === 'cr' ? -1 : 1) * (Number(led.opening_balance) || 0)); }
    const period = (q.from ? all.filter(l => l.date >= q.from) : all).sort((a, b) => a.date.localeCompare(b.date) || String(a.doc_no).localeCompare(String(b.doc_no)));
    // contra ledgers of each batch
    const batchIds = [...new Set(period.map(l => l.batch_id))];
    const others = await inChunks(batchIds, async ch => { const { data } = await c.from('ledger_transaction_lines').select('batch_id, ledger_account_id, id').in('batch_id', ch); return data || []; });
    const contraOf = {};
    others.forEach(o => (contraOf[o.batch_id] = contraOf[o.batch_id] || []).push(o));
    let run = opening;
    const rows = period.map(l => {
        run = round2(run + l.dr - l.cr);
        const contra = [...new Set((contraOf[l.batch_id] || []).filter(o => o.id !== l.id && o.ledger_account_id !== l.ledger).map(o => M.ledgers[o.ledger_account_id]?.account_name).filter(Boolean))].slice(0, 3).join(', ');
        return { ...l, contra, balance: run, cost_center_name: dimValue(M, 'cost_center', l)[1], unit_name: dimValue(M, 'business_unit', l)[1], sub_ledger_name: dimValue(M, 'sub_ledger', l)[1] };
    });
    const [, label] = all[0] ? dimValue(M, dim, all[0]) : [null, q.value];
    return { dimension: { key: dim, label: DIMS[dim] }, value: q.value, value_label: label, from: q.from || null, to: q.to, opening, rows,
        totals: { dr: round2(rows.reduce((s, r) => s + r.dr, 0)), cr: round2(rows.reduce((s, r) => s + r.cr, 0)), closing: run } };
}

// ---------- exceptions ----------
async function exceptions(c, t, q) {
    if (!q.to) throw httpError('Choose the To date');
    const M = await masters(c, t);
    const lines = applyFilters(await dimLines(c, t, M, { to: q.to }), q).filter(l => !q.from || l.date >= q.from);
    const needSub = new Set(Object.values(M.ledgers).filter(l => l.sub_ledger_mandatory || (l.is_sub_ledger_enabled && q.strict_sub_ledger === 'true')).map(l => l.id));
    const checks = [
        ['pl_no_cost_center', 'Profit & Loss entry without Cost Center', l => l.statement === 'pl' && !l.cost_center],
        ['pl_no_unit', 'Profit & Loss entry without Unit', l => l.statement === 'pl' && !l.business_unit],
        ['no_branch', 'Entry without Branch', l => !l.branch && !['interest_posting', 'depreciation', 'asset_disposal'].includes(l.doc_type)],
        ['sub_ledger_missing', 'Ledger needs a sub-ledger but none posted', l => needSub.has(l.ledger) && !l.sub_ledger],
        ['sub_ledger_wrong_ledger', 'Sub-ledger belongs to another ledger', l => l.sub_ledger && M.subs[l.sub_ledger] && M.subs[l.sub_ledger].main_ledger_id !== l.ledger],
        ['no_doc_class', 'Document number matches no numbering class', l => DOCS[l.doc_type]?.[1] && l.doc_no && !l.doc_class && M.cats.some(cat => cat.voucher_type === DOCS[l.doc_type][1])],
        ['unmapped_group', 'Ledger group has no NFRS category (not in P&L or Balance Sheet)', l => l.statement === 'unmapped']
    ];
    const want = csv(q.checks);
    const out = checks.filter(([k]) => !want.length || want.includes(k)).map(([key, label, fn]) => {
        const hit = lines.filter(fn);
        return { key, label, count: hit.length, amount: round2(hit.reduce((s, l) => s + l.dr + l.cr, 0)),
            rows: hit.slice(0, 500).map(l => ({ date: l.date, doc_label: l.doc_label, doc_no: l.doc_no, ledger_name: l.ledger_name, dr: l.dr, cr: l.cr, narration: l.narration,
                sub_ledger_name: l.sub_ledger ? M.subs[l.sub_ledger]?.sub_ledger_name : '' })) };
    });
    return { from: q.from || null, to: q.to, checks: out };
}

// ---------- document class register ----------
function numberOf(cat, docNo) {
    const p = cat.prefix || '', s = cat.suffix || '';
    const core = String(docNo).slice(p.length, String(docNo).length - s.length);
    const m = /(\d+)$/.exec(core);                              // fiscal-year part (if any) comes before the running number
    const digits = m ? m[1] : '';
    const run = cat.digit_count && digits.length > cat.digit_count ? digits.slice(-cat.digit_count) : digits;
    return { series: core.slice(0, core.length - run.length), num: run ? Number(run) : null };
}
async function docClassRegister(c, t, q) {
    const M = await masters(c, t);
    const types = csv(q.voucher_types).filter(v => CLASS_TABLES[v]);
    const list = types.length ? types : Object.keys(CLASS_TABLES);
    const out = [];
    for (const vt of list) {
        const docs = await fetchAll(() => {
            let x = c.from(CLASS_TABLES[vt]).select('*').eq('tenant_id', t);
            if (q.from) x = x.gte('doc_date', q.from);
            if (q.to) x = x.lte('doc_date', q.to);
            return x.order('id');
        }).catch(() => []);
        if (!docs.length) continue;
        const cats = M.cats.filter(cat => cat.voucher_type === vt);
        const groups = new Map();
        docs.forEach(d => {
            const cat = classOf(cats, vt, d.doc_no);
            const k = cat ? cat.id : '__none__';
            if (!groups.has(k)) groups.set(k, { cat, docs: [] });
            groups.get(k).docs.push(d);
        });
        groups.forEach(({ cat, docs: ds }, k) => {
            const amount = ds.filter(d => d.status !== 'cancelled').reduce((s, d) => s + (Number(d.total_amount ?? d.net_amount ?? d.amount ?? d.grand_total ?? 0) || 0), 0);
            const bySeries = {};
            const seen = {};
            const dups = [];
            ds.forEach(d => { if (seen[d.doc_no]) dups.push(d.doc_no); seen[d.doc_no] = true;
                if (!cat) return; const n = numberOf(cat, d.doc_no); if (n.num === null) return; (bySeries[n.series] = bySeries[n.series] || []).push(n.num); });
            const gaps = [];
            Object.entries(bySeries).forEach(([series, nums]) => {
                const sorted = [...new Set(nums)].sort((a, b) => a - b);
                for (let i = 1; i < sorted.length && gaps.length < 200; i++) if (sorted[i] - sorted[i - 1] > 1) {
                    const a = sorted[i - 1] + 1, b = sorted[i] - 1;
                    const fmt = n => `${cat.prefix || ''}${series}${String(n).padStart(cat.digit_count || 1, '0')}${cat.suffix || ''}`;
                    gaps.push(a === b ? fmt(a) : `${fmt(a)} … ${fmt(b)} (${b - a + 1})`);
                }
            });
            const sortedNos = [...ds].sort((a, b) => String(a.doc_no).localeCompare(String(b.doc_no), undefined, { numeric: true }));
            out.push({ voucher_type: vt, class_id: cat ? cat.id : null, class_name: cat ? cat.category_name : '(no class)', prefix: cat?.prefix || '', count: ds.length,
                posted: ds.filter(d => ['posted', 'received', 'approved', 'confirmed', 'completed'].includes(d.status)).length, drafts: ds.filter(d => d.status === 'draft').length,
                cancelled: ds.filter(d => d.status === 'cancelled').length, amount: round2(amount), first_no: sortedNos[0]?.doc_no || '', last_no: sortedNos[sortedNos.length - 1]?.doc_no || '',
                first_date: ds.map(d => String(d.doc_date || '').slice(0, 10)).sort()[0] || '', last_date: ds.map(d => String(d.doc_date || '').slice(0, 10)).sort().pop() || '',
                gaps, duplicate_nos: [...new Set(dups)] });
        });
    }
    return { from: q.from || null, to: q.to || null, rows: out.sort((a, b) => a.voucher_type.localeCompare(b.voucher_type) || a.class_name.localeCompare(b.class_name)) };
}

async function dimensionMeta(c, t) {
    const M = await masters(c, t);
    const list = (obj, name) => Object.values(obj).map(x => ({ id: x.id, name: x[name] })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return {
        dimensions: Object.entries(DIMS).map(([key, label]) => ({ key, label })),
        ledgers: list(M.ledgers, 'account_name'), groups: Object.values(M.groups).map(g => ({ id: g.id, name: g.group_name })).sort((a, b) => a.name.localeCompare(b.name)),
        sub_ledgers: Object.values(M.subs).map(s => ({ id: s.id, name: `${s.sub_ledger_name} · ${M.ledgers[s.main_ledger_id]?.account_name || ''}`, main_ledger_id: s.main_ledger_id, type: s.sub_ledger_type })),
        cost_centers: list(M.ccs, 'cost_center_name'), business_units: list(M.bus, 'unit_name'), branches: list(M.branches, 'branch_name'), product_companies: list(M.companies, 'company_name'),
        doc_classes: M.cats.map(cat => ({ id: cat.id, name: `${cat.category_name} (${cat.voucher_type})`, voucher_type: cat.voucher_type })),
        doc_types: Object.entries(DOCS).map(([id, d]) => ({ id, name: d[2] })), voucher_types: Object.keys(CLASS_TABLES).map(v => ({ id: v, name: v.replace(/_/g, ' ') }))
    };
}

module.exports = { pivot, plByDimension, statement, exceptions, docClassRegister, dimensionMeta, classOf, numberOf, DIMS };
