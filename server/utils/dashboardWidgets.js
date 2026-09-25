// =============================================
// utils/dashboardWidgets.js
// Data for the customizable dashboard. Each widget returns one of:
//   series  { points: [{ label, value, value2? }], series_labels }
//   kpi     { value, previous, change_pct }
//   table   { columns, rows }
// Periods: this_month, last_month, last_30, this_quarter, this_year,
// last_12_months, fiscal_year (from the fiscal year that contains today),
// or custom (date_from / date_to). Comparisons are always with the period
// of the same length just before, or the same months last year for trends.
// =============================================
const { parseTradeQuery, loadTradeLines } = require('./tradeLines');
const { loadGroups, sectionOf, ledgerBalances } = require('./financialEngine');
const { stockReport } = require('./stockReport');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const DAY = 86400000;
const iso = n => new Date(n).toISOString().slice(0, 10);
const d2n = s => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
const today = () => new Date().toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = m => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); };
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

async function fyStart(c, t, date) {
    const { data } = await c.from('fiscal_years').select('start_date_eng, end_date_eng').eq('tenant_id', t);
    const hit = (data || []).find(y => String(y.start_date_eng).slice(0, 10) <= date && date <= String(y.end_date_eng).slice(0, 10));
    return hit ? String(hit.start_date_eng).slice(0, 10) : `${date.slice(0, 4)}-01-01`;
}
async function periodOf(c, t, q) {
    const to = q.date_to || today();
    const y = Number(to.slice(0, 4)), m = Number(to.slice(5, 7));
    let from;
    switch (q.period) {
        case 'custom': from = q.date_from || `${to.slice(0, 7)}-01`; break;
        case 'last_month': { const s = `${addMonths(to.slice(0, 7), -1)}-01`; return { from: s, to: iso(d2n(`${to.slice(0, 7)}-01`) - DAY) }; }
        case 'last_30': from = iso(d2n(to) - 29 * DAY); break;
        case 'this_quarter': from = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`; break;
        case 'this_year': from = `${y}-01-01`; break;
        case 'last_12_months': from = `${addMonths(to.slice(0, 7), -11)}-01`; break;
        case 'fiscal_year': from = await fyStart(c, t, to); break;
        default: from = `${to.slice(0, 7)}-01`;                  // this_month
    }
    return { from, to };
}
const previousOf = ({ from, to }) => { const len = d2n(to) - d2n(from); const pTo = d2n(from) - DAY; return { from: iso(pTo - len), to: iso(pTo) }; };

async function trade(c, t, side, from, to) {
    const f = parseTradeQuery({ side, date_from: from, date_to: to, kinds: 'main,return' });
    const { lines } = await loadTradeLines(c, t, f);
    return lines.map(l => ({ ...l, v: l.kind === 'main' ? l.net : -l.net }));
}
const sum = arr => round2(arr.reduce((s, x) => s + x, 0));
function topN(lines, keyOf, nameOf, n = 10) {
    const m = new Map();
    lines.forEach(l => { const k = keyOf(l) || '-'; const x = m.get(k) || { label: nameOf(l) || '(none)', value: 0 }; x.value += l.v; m.set(k, x); });
    const all = [...m.values()].sort((a, b) => b.value - a.value);
    const top = all.slice(0, n).map(x => ({ label: x.label, value: round2(x.value) }));
    const rest = all.slice(n).reduce((s, x) => s + x.value, 0);
    if (Math.abs(rest) > 0.005) top.push({ label: 'Other', value: round2(rest) });
    return top;
}
function monthly(lines, months) {
    const m = Object.fromEntries(months.map(k => [k, 0]));
    lines.forEach(l => { if (m[l.month] !== undefined) m[l.month] += l.v; });
    return months.map(k => round2(m[k]));
}
function monthsBetween(from, to) { const out = []; for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) out.push(m); return out; }

async function partyAgeing(c, t, nature) {
    const [refs, leds] = await Promise.all([
        fetchAll(() => c.from('bill_wise_references').select('ledger_id, source_date, remaining_amount').eq('tenant_id', t).eq('nature', nature).gt('remaining_amount', 0).order('id')),
        fetchAll(() => c.from('ledger_accounts').select('id, credit_days').eq('tenant_id', t).order('id'))
    ]);
    const cd = Object.fromEntries(leds.map(l => [l.id, Number(l.credit_days) || 0]));
    const b = { 'Not due': 0, '1-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0 };
    const now = d2n(today());
    refs.forEach(r => {
        const late = Math.round((now - (d2n(r.source_date) + (cd[r.ledger_id] || 0) * DAY)) / DAY);
        const k = late <= 0 ? 'Not due' : late <= 30 ? '1-30 days' : late <= 60 ? '31-60 days' : late <= 90 ? '61-90 days' : '90+ days';
        b[k] += Number(r.remaining_amount) || 0;
    });
    return Object.entries(b).map(([label, value]) => ({ label, value: round2(value) }));
}
async function balancesByAnchor(c, t, anchor, to) {
    const [groups, bals] = await Promise.all([loadGroups(c, t), ledgerBalances(c, t, { to })]);
    return Object.values(bals).filter(b => groups[b.account_group_id]?.anchor === anchor);
}

const WIDGETS = {
    // ---- KPIs
    kpi_sales: { label: 'Net Sales', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t, p) {
        const [a, b] = await Promise.all([trade(c, t, 'sales', p.from, p.to), trade(c, t, 'sales', previousOf(p).from, previousOf(p).to)]);
        return kpi('Net Sales', sum(a.map(l => l.v)), sum(b.map(l => l.v)), '/sales-purchase-analysis'); } },
    kpi_purchase: { label: 'Net Purchase', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t, p) {
        const [a, b] = await Promise.all([trade(c, t, 'purchase', p.from, p.to), trade(c, t, 'purchase', previousOf(p).from, previousOf(p).to)]);
        return kpi('Net Purchase', sum(a.map(l => l.v)), sum(b.map(l => l.v)), '/purchase-register-report'); } },
    kpi_bills: { label: 'Sales Bills (count)', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t, p) {
        const count = async r => (await fetchAll(() => c.from('sales_bills').select('id').eq('tenant_id', t).eq('status', 'posted').gte('doc_date', r.from).lte('doc_date', r.to).order('id'))).length;
        return { ...kpi('Sales Bills', await count(p), await count(previousOf(p))), unit: 'count' }; } },
    kpi_receivable: { label: 'Receivables (total due)', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t, p) {
        const rows = await balancesByAnchor(c, t, 'RECEIVABLES', p.to);
        return kpi('Receivables', sum(rows.map(r => r.closing)), null, '/outstanding-report'); } },
    kpi_payable: { label: 'Payables (total owed)', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t, p) {
        const rows = await balancesByAnchor(c, t, 'PAYABLES', p.to);
        return kpi('Payables', -sum(rows.map(r => r.closing)), null, '/outstanding-report'); } },
    kpi_cash: { label: 'Cash & Bank Balance', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t, p) {
        const rows = await balancesByAnchor(c, t, 'CASH_BANK', p.to);
        return kpi('Cash & Bank', sum(rows.map(r => r.closing)), null, '/control-reports?view=cash_bank_book'); } },
    kpi_overdue: { label: 'Overdue Receivable', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t) {
        const a = await partyAgeing(c, t, 'dr');
        return kpi('Overdue Receivable', sum(a.filter(x => x.label !== 'Not due').map(x => x.value)), null, '/control-reports?view=credit_exceed'); } },
    kpi_stock: { label: 'Stock Value', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t, p) {
        const r = await stockReport(c, t, { mode: 'summary', date_from: p.to, date_to: p.to, group_by: 'item', hide_zero: 'true' });
        return kpi('Stock Value', sum((r.rows || []).map(x => x.closing_value)), null, '/stock-report'); } },
    kpi_pending_orders: { label: 'Pending Sales Orders', group: 'KPI', kind: 'kpi', charts: ['kpi'], async data(c, t) {
        const rows = await fetchAll(() => c.from('sales_orders').select('total_amount').eq('tenant_id', t).in('status', ['draft', 'confirmed', 'partially_delivered']).order('id'));
        return kpi('Pending Orders', sum(rows.map(r => Number(r.total_amount) || 0)), null, '/order-billing'); } },
    // ---- trends
    sales_trend: { label: 'Sales Trend (vs last year)', group: 'Sales', kind: 'series', charts: ['bar', 'line', 'area'], async data(c, t, p) {
        const months = monthsBetween(p.from, p.to), ly = { from: `${Number(p.from.slice(0, 4)) - 1}${p.from.slice(4)}`, to: `${Number(p.to.slice(0, 4)) - 1}${p.to.slice(4)}` };
        const [a, b] = await Promise.all([trade(c, t, 'sales', `${months[0]}-01`, p.to), trade(c, t, 'sales', `${ly.from.slice(0, 7)}-01`, ly.to)]);
        const cur = monthly(a, months), prev = monthly(b.map(l => ({ ...l, month: `${Number(l.month.slice(0, 4)) + 1}${l.month.slice(4)}` })), months);
        return series('Sales Trend', months.map((m, i) => ({ label: monthLabel(m), value: cur[i], value2: prev[i] })), ['This year', 'Last year'], '/monthly-analysis'); } },
    purchase_trend: { label: 'Purchase Trend (vs last year)', group: 'Purchase', kind: 'series', charts: ['bar', 'line', 'area'], async data(c, t, p) {
        const months = monthsBetween(p.from, p.to);
        const ly = { from: `${Number(months[0].slice(0, 4)) - 1}${months[0].slice(4)}-01`, to: `${Number(p.to.slice(0, 4)) - 1}${p.to.slice(4)}` };
        const [a, b] = await Promise.all([trade(c, t, 'purchase', `${months[0]}-01`, p.to), trade(c, t, 'purchase', ly.from, ly.to)]);
        const prev = monthly(b.map(l => ({ ...l, month: `${Number(l.month.slice(0, 4)) + 1}${l.month.slice(4)}` })), months), cur = monthly(a, months);
        return series('Purchase Trend', months.map((m, i) => ({ label: monthLabel(m), value: cur[i], value2: prev[i] })), ['This year', 'Last year']); } },
    sales_vs_purchase: { label: 'Sales vs Purchase (monthly)', group: 'Sales', kind: 'series', charts: ['bar', 'line', 'area'], async data(c, t, p) {
        const months = monthsBetween(p.from, p.to);
        const [a, b] = await Promise.all([trade(c, t, 'sales', `${months[0]}-01`, p.to), trade(c, t, 'purchase', `${months[0]}-01`, p.to)]);
        const s = monthly(a, months), pu = monthly(b, months);
        return series('Sales vs Purchase', months.map((m, i) => ({ label: monthLabel(m), value: s[i], value2: pu[i] })), ['Sales', 'Purchase']); } },
    daily_sales: { label: 'Daily Sales', group: 'Sales', kind: 'series', charts: ['bar', 'line', 'area'], async data(c, t, p) {
        const a = await trade(c, t, 'sales', p.from, p.to);
        const days = []; for (let d = d2n(p.from); d <= d2n(p.to) && days.length < 92; d += DAY) days.push(iso(d));
        const m = Object.fromEntries(days.map(d => [d, 0])); a.forEach(l => { if (m[l.doc_date] !== undefined) m[l.doc_date] += l.v; });
        return series('Daily Sales', days.map(d => ({ label: d.slice(5), value: round2(m[d]) })), ['Sales']); } },
    top_customers: { label: 'Top 10 Customers', group: 'Sales', kind: 'series', charts: ['hbar', 'bar', 'pie', 'donut', 'table'], async data(c, t, p) {
        return series('Top Customers', topN(await trade(c, t, 'sales', p.from, p.to), l => l.party_id, l => l.party_name), ['Net sales'], '/sales-purchase-analysis'); } },
    top_products: { label: 'Top 10 Products', group: 'Sales', kind: 'series', charts: ['hbar', 'bar', 'pie', 'donut', 'table'], async data(c, t, p) {
        return series('Top Products', topN(await trade(c, t, 'sales', p.from, p.to), l => l.product_id, l => l.product_name), ['Net sales'], '/profitability'); } },
    sales_by_group: { label: 'Sales by Product Group', group: 'Sales', kind: 'series', charts: ['donut', 'pie', 'hbar', 'bar', 'table'], async data(c, t, p) {
        return series('Sales by Group', topN(await trade(c, t, 'sales', p.from, p.to), l => l.product_group_id, l => l.group_name, 7), ['Net sales']); } },
    sales_by_company: { label: 'Sales by Product Company', group: 'Sales', kind: 'series', charts: ['donut', 'pie', 'hbar', 'bar', 'table'], async data(c, t, p) {
        return series('Sales by Company', topN(await trade(c, t, 'sales', p.from, p.to), l => l.product_company_id, l => l.company_name, 7), ['Net sales']); } },
    sales_by_salesman: { label: 'Sales by Salesman', group: 'Sales', kind: 'series', charts: ['hbar', 'bar', 'pie', 'donut', 'table'], async data(c, t, p) {
        return series('Sales by Salesman', topN(await trade(c, t, 'sales', p.from, p.to), l => l.agent_id, l => l.agent_name), ['Net sales'], '/salesman-reports?view=agent_sales'); } },
    sales_by_area: { label: 'Sales by Area', group: 'Sales', kind: 'series', charts: ['hbar', 'bar', 'pie', 'donut', 'table'], async data(c, t, p) {
        return series('Sales by Area', topN(await trade(c, t, 'sales', p.from, p.to), l => l.area_id, l => l.area_name), ['Net sales']); } },
    top_suppliers: { label: 'Top 10 Suppliers', group: 'Purchase', kind: 'series', charts: ['hbar', 'bar', 'pie', 'donut', 'table'], async data(c, t, p) {
        return series('Top Suppliers', topN(await trade(c, t, 'purchase', p.from, p.to), l => l.party_id, l => l.party_name), ['Net purchase']); } },
    // ---- accounts
    receivable_ageing: { label: 'Receivable Ageing', group: 'Accounts', kind: 'series', charts: ['bar', 'donut', 'pie', 'hbar', 'table'], async data(c, t) {
        return series('Receivable Ageing', await partyAgeing(c, t, 'dr'), ['Outstanding'], '/ageing'); } },
    payable_ageing: { label: 'Payable Ageing', group: 'Accounts', kind: 'series', charts: ['bar', 'donut', 'pie', 'hbar', 'table'], async data(c, t) {
        return series('Payable Ageing', await partyAgeing(c, t, 'cr'), ['Outstanding'], '/ageing'); } },
    expense_breakdown: { label: 'Expenses by Group', group: 'Accounts', kind: 'series', charts: ['donut', 'pie', 'hbar', 'bar', 'table'], async data(c, t, p) {
        const [groups, bals] = await Promise.all([loadGroups(c, t), ledgerBalances(c, t, p)]);
        const m = new Map();
        Object.values(bals).forEach(b => { const g = groups[b.account_group_id]; if (!/expense/.test(sectionOf(g))) return; const x = m.get(g.id) || { label: g.group_name, value: 0 }; x.value += b.dr - b.cr; m.set(g.id, x); });
        const all = [...m.values()].filter(x => Math.abs(x.value) > 0.005).sort((a, b) => b.value - a.value);
        const pts = all.slice(0, 7).map(x => ({ label: x.label, value: round2(x.value) }));
        const rest = all.slice(7).reduce((s, x) => s + x.value, 0); if (rest) pts.push({ label: 'Other', value: round2(rest) });
        return series('Expenses', pts, ['Expense'], '/financial-reports?tab=pl'); } },
    income_expense: { label: 'Income vs Expense (monthly)', group: 'Accounts', kind: 'series', charts: ['bar', 'line', 'area'], async data(c, t, p) {
        const [groups, lines] = await Promise.all([loadGroups(c, t), fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)').eq('tenant_id', t).gte('batch.batch_date', p.from).lte('batch.batch_date', p.to).order('id'))]);
        const leds = await fetchAll(() => c.from('ledger_accounts').select('id, account_group_id').eq('tenant_id', t).order('id'));
        const sec = Object.fromEntries(leds.map(l => [l.id, sectionOf(groups[l.account_group_id])]));
        const months = monthsBetween(p.from, p.to), inc = Object.fromEntries(months.map(m => [m, 0])), exp = { ...inc };
        lines.forEach(l => { const m = String(l.batch.batch_date).slice(0, 7), s = sec[l.ledger_account_id] || ''; const v = Number(l.credit_amount || 0) - Number(l.debit_amount || 0); if (/income/.test(s)) inc[m] += v; else if (/expense/.test(s)) exp[m] -= v; });
        return series('Income vs Expense', months.map(m => ({ label: monthLabel(m), value: round2(inc[m]), value2: round2(exp[m]) })), ['Income', 'Expense']); } },
    cash_bank_balances: { label: 'Cash & Bank Balances', group: 'Accounts', kind: 'series', charts: ['hbar', 'bar', 'table'], async data(c, t, p) {
        const rows = await balancesByAnchor(c, t, 'CASH_BANK', p.to);
        return series('Cash & Bank', rows.filter(r => Math.abs(r.closing) > 0.005).map(r => ({ label: r.account_name, value: round2(r.closing) })).sort((a, b) => b.value - a.value), ['Balance']); } },
    cash_forecast: { label: 'Cash Forecast (next 8 weeks)', group: 'Accounts', kind: 'series', charts: ['line', 'area', 'bar'], async data(c, t) {
        const { analyticsReport } = require('./analytics');
        const r = await analyticsReport(c, t, 'cash_forecast', { weeks: 8 });
        return series('Cash Forecast', r.weeks.map(w => ({ label: `W${w.week}`, value: w.closing })), ['Closing cash'], '/analytics?view=cash_forecast'); } },
    // ---- inventory
    stock_by_group: { label: 'Stock Value by Group', group: 'Inventory', kind: 'series', charts: ['donut', 'pie', 'hbar', 'bar', 'table'], async data(c, t, p) {
        const r = await stockReport(c, t, { mode: 'summary', date_from: p.to, date_to: p.to, group_by: 'item', hide_zero: 'true' });
        const m = new Map(); (r.rows || []).forEach(x => { const k = x.group_name || '(no group)'; m.set(k, (m.get(k) || 0) + x.closing_value); });
        const all = [...m.entries()].map(([label, value]) => ({ label, value: round2(value) })).sort((a, b) => b.value - a.value);
        const pts = all.slice(0, 7); const rest = all.slice(7).reduce((s, x) => s + x.value, 0); if (rest) pts.push({ label: 'Other', value: round2(rest) });
        return series('Stock by Group', pts, ['Stock value'], '/stock-report'); } },
    // ---- tasks & darta / chalani (only what the viewer may see)
    kpi_my_tasks: { label: 'My Open Tasks', group: 'Tasks & Darta', kind: 'kpi', charts: ['kpi'], async data(c, t) {
        const d = await work(c, t);
        return { ...kpi('My Open Tasks', d.kpis.my_open_tasks, null, '/tasks'), unit: 'count' }; } },
    kpi_overdue_tasks: { label: 'Overdue Tasks', group: 'Tasks & Darta', kind: 'kpi', charts: ['kpi'], async data(c, t) {
        const d = await work(c, t);
        return { ...kpi('Overdue Tasks', d.kpis.overdue_tasks, null, '/tasks?view=overdue'), unit: 'count' }; } },
    kpi_pending_darta: { label: 'Pending Darta / Chalani', group: 'Tasks & Darta', kind: 'kpi', charts: ['kpi'], async data(c, t) {
        const d = await work(c, t);
        return { ...kpi('Pending Darta / Chalani', d.kpis.pending_darta, null, '/darta-chalani?status=pending'), unit: 'count' }; } },
    task_status: { label: 'Tasks by Status', group: 'Tasks & Darta', kind: 'series', charts: ['donut', 'pie', 'hbar', 'bar', 'table'], async data(c, t) {
        return series('Tasks by Status', (await work(c, t)).charts.task_status, ['Tasks'], '/work-dashboard'); } },
    task_weekly: { label: 'Tasks Created vs Done (8 weeks)', group: 'Tasks & Darta', kind: 'series', charts: ['bar', 'line', 'area'], async data(c, t) {
        return series('Tasks Created vs Done', (await work(c, t)).charts.task_weekly, ['Created', 'Done'], '/work-dashboard'); } },
    darta_monthly: { label: 'Darta vs Chalani (12 months)', group: 'Tasks & Darta', kind: 'series', charts: ['bar', 'line', 'area'], async data(c, t) {
        return series('Darta vs Chalani', (await work(c, t)).charts.darta_monthly, ['Darta', 'Chalani'], '/darta-chalani'); } },
    my_tasks: { label: 'My Tasks (by due date)', group: 'Tasks & Darta', kind: 'table', charts: ['table'], async data(c, t) {
        const rows = (await work(c, t)).lists.my_tasks.map(x => ({ ...x, due: x.due_at ? new Date(x.due_at).toISOString().slice(0, 16).replace('T', ' ') : '', task: `${x.task_no} ${x.title}` }));
        return table('My Tasks', [{ key: 'task', label: 'Task' }, { key: 'due', label: 'Due' }, { key: 'status_label', label: 'Status' }, { key: 'priority', label: 'Priority' }], rows, '/tasks'); } },
    pending_darta: { label: 'Pending Darta / Chalani', group: 'Tasks & Darta', kind: 'table', charts: ['table'], async data(c, t) {
        const rows = (await work(c, t)).lists.pending_darta;
        return table('Pending Darta / Chalani', [{ key: 'reg_no', label: 'No.' }, { key: 'subject', label: 'Subject' }, { key: 'party_name', label: 'From / To' }, { key: 'due_date', label: 'Due' }, { key: 'assigned_to_name', label: 'With' }], rows, '/darta-chalani'); } },
    // ---- tables
    recent_bills: { label: 'Recent Sales Bills', group: 'Lists', kind: 'table', charts: ['table'], async data(c, t) {
        const { data } = await c.from('sales_bills').select('doc_no, doc_date, customer_name_snapshot, total_amount, status').eq('tenant_id', t).order('doc_date', { ascending: false }).limit(10);
        return table('Recent Sales Bills', [{ key: 'doc_no', label: 'Bill' }, { key: 'doc_date', label: 'Date' }, { key: 'customer_name_snapshot', label: 'Customer' }, { key: 'total_amount', label: 'Amount', money: true }, { key: 'status', label: 'Status' }],
            (data || []).map(r => ({ ...r, doc_date: String(r.doc_date).slice(0, 10) })), '/sales-bill'); } },
    low_stock: { label: 'Low Stock Items', group: 'Lists', kind: 'table', charts: ['table'], async data(c, t, p) {
        const r = await stockReport(c, t, { mode: 'summary', date_from: p.to, date_to: p.to, group_by: 'item', hide_zero: 'false', stock_status: 'below_minimum' });
        return table('Low Stock', [{ key: 'product_name', label: 'Item' }, { key: 'closing_qty', label: 'Stock' }, { key: 'minimum_stock', label: 'Minimum' }],
            (r.rows || []).slice(0, 15).map(x => ({ product_name: x.product_name, closing_qty: x.closing_qty, minimum_stock: x.minimum_stock })), '/reorder'); } },
    pdc_due: { label: 'PDC due in 7 days', group: 'Lists', kind: 'table', charts: ['table'], async data(c, t) {
        const to = iso(d2n(today()) + 7 * DAY);
        const rows = await fetchAll(() => c.from('pdc_vouchers').select('doc_no, voucher_type, party_name_snapshot, cheque_no, cheque_date, amount').eq('tenant_id', t).eq('status', 'pending').lte('cheque_date', to).order('id'));
        return table('PDC Due', [{ key: 'cheque_date', label: 'Date' }, { key: 'party_name_snapshot', label: 'Party' }, { key: 'voucher_type', label: 'Type' }, { key: 'cheque_no', label: 'Cheque' }, { key: 'amount', label: 'Amount', money: true }],
            rows.sort((a, b) => String(a.cheque_date).localeCompare(String(b.cheque_date))).slice(0, 15).map(r => ({ ...r, cheque_date: String(r.cheque_date).slice(0, 10) })), '/lc-bg-dashboard'); } }
};
async function work(c, t) {
    const { workDashboard, contextRequest } = require('./workDashboard');
    try { return await workDashboard(c, t, await contextRequest(c, t)); }
    catch (e) { if (/tasks|darta_chalani/.test(e.message)) throw httpError('Run database/123_darta_chalani_tasks_notifications_schema.sql first', 500); throw e; }
}
function kpi(title, value, previous, link) {
    return { title, kind: 'kpi', value: round2(value), previous: previous === null ? null : round2(previous), change_pct: previous ? round2((value - previous) * 100 / Math.abs(previous)) : null, link };
}
function series(title, points, labels, link) { return { title, kind: 'series', points, series_labels: labels, link }; }
function table(title, columns, rows, link) { return { title, kind: 'table', columns, rows, link }; }

const DEFAULT_LAYOUT = [
    ['kpi_sales', 'kpi'], ['kpi_purchase', 'kpi'], ['kpi_receivable', 'kpi'], ['kpi_cash', 'kpi'],
    ['sales_trend', 'bar', 2, 'last_12_months'], ['top_customers', 'hbar', 1], ['sales_by_group', 'donut', 1], ['receivable_ageing', 'bar', 1],
    ['income_expense', 'line', 1, 'last_12_months'], ['recent_bills', 'table', 2], ['pdc_due', 'table', 1]
].map(([widget, chart, size = 1, period = 'this_month'], i) => ({ id: `d${i}`, widget, chart, size, period }));

function catalog() {
    return Object.entries(WIDGETS).map(([key, w]) => ({ key, label: w.label, group: w.group, kind: w.kind, charts: w.charts, default_chart: w.charts[0] }));
}
async function widgetData(c, t, key, q) {
    const w = WIDGETS[key];
    if (!w) throw httpError('Unknown widget', 404);
    const p = await periodOf(c, t, q || {});
    return { ...(await w.data(c, t, p)), from: p.from, to: p.to };
}

// ---------------- layouts (per user; a company default when user_id is null) ----------------
async function getLayout(c, t, userId) {
    try {
        const { data: mine } = await c.from('dashboard_layouts').select('layout').eq('tenant_id', t).eq('user_id', userId).maybeSingle();
        if (mine?.layout) return { layout: mine.layout, source: 'user' };
        const { data: co } = await c.from('dashboard_layouts').select('layout').eq('tenant_id', t).is('user_id', null).maybeSingle();
        if (co?.layout) return { layout: co.layout, source: 'company' };
    } catch { /* table missing (migration 120 not run): fall back to the default */ }
    return { layout: DEFAULT_LAYOUT, source: 'default' };
}
function cleanLayout(layout) {
    if (!Array.isArray(layout)) throw httpError('Layout must be a list of tiles');
    return layout.slice(0, 40).filter(x => WIDGETS[x.widget]).map((x, i) => ({
        id: String(x.id || `t${i}`).slice(0, 40), widget: x.widget, chart: WIDGETS[x.widget].charts.includes(x.chart) ? x.chart : WIDGETS[x.widget].charts[0],
        size: [1, 2, 3].includes(Number(x.size)) ? Number(x.size) : 1, period: String(x.period || 'this_month').slice(0, 20),
        title: x.title ? String(x.title).slice(0, 80) : undefined, date_from: x.date_from || undefined, date_to: x.date_to || undefined
    }));
}
async function saveLayout(c, t, userId, layout, companyDefault) {
    const row = { tenant_id: t, user_id: companyDefault ? null : userId, layout: cleanLayout(layout), updated_at: new Date().toISOString() };
    let q = c.from('dashboard_layouts').select('id').eq('tenant_id', t);
    q = companyDefault ? q.is('user_id', null) : q.eq('user_id', userId);
    const { data: ex } = await q.maybeSingle();
    const { error } = ex ? await c.from('dashboard_layouts').update(row).eq('id', ex.id) : await c.from('dashboard_layouts').insert(row);
    if (error) throw error;
    return { saved: row.layout.length };
}
async function resetLayout(c, t, userId) {
    const { error } = await c.from('dashboard_layouts').delete().eq('tenant_id', t).eq('user_id', userId);
    if (error) throw error;
    return getLayout(c, t, userId);
}

module.exports = { WIDGETS, catalog, widgetData, getLayout, saveLayout, resetLayout, periodOf, DEFAULT_LAYOUT };
