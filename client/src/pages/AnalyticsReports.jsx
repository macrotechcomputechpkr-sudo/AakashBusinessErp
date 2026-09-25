// =============================================
// AnalyticsReports.jsx  (/analytics?view=...)
// Inventory classification, forecasting and comparison (server:
// utils/analytics.js - plain arithmetic, no external AI):
// FSN, ABC, XYZ, ABC-XYZ matrix, Stock Cover, Inventory Turnover, Dead
// Stock, Sales / Purchase Forecast, Purchase Plan, Cash Flow Forecast,
// Period Comparison (vs previous period / last year), Customer RFM.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt = n => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const q3 = n => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const iso = d => d.toISOString().slice(0, 10);
const pct = v => (v === null || v === undefined ? '—' : `${v}%`);
const M = k => ({ k, t: 'money' }), Q = k => ({ k, t: 'qty' }), P = k => ({ k, t: 'pct' });
export const ANALYTICS_VIEWS = {
    fsn: { label: 'Fast / Slow / Non-moving (FSN)', cols: [['product_code', 'Code'], ['product_name', 'Item'], ['group_name', 'Group'], ['fsn_label', 'Class'], [Q('qty'), 'Sold Qty'], [M('value'), 'Sales Value'], [Q('stock_qty'), 'Stock'], [M('stock_value'), 'Stock Value'], ['turnover', 'Turnover'], ['last_sale', 'Last Sale'], ['idle_days', 'Idle Days']] },
    abc: { label: 'ABC Analysis', cols: [['product_code', 'Code'], ['product_name', 'Item'], ['group_name', 'Group'], ['abc', 'Class'], [Q('qty'), 'Qty'], [M('value'), 'Sales Value'], [M('stock_value'), 'Stock Value'], [P('share_pct'), 'Share %'], [P('cum_pct'), 'Cumulative %']] },
    xyz: { label: 'XYZ Analysis (demand variability)', cols: [['product_code', 'Code'], ['product_name', 'Item'], ['xyz', 'Class'], ['xyz_label', 'Demand'], ['cv', 'Coeff. of Variation'], [Q('qty'), 'Sold Qty'], [M('value'), 'Sales Value']] },
    abc_xyz: { label: 'ABC-XYZ Matrix', cols: [['product_code', 'Code'], ['product_name', 'Item'], ['cell', 'Cell'], ['abc', 'ABC'], ['xyz', 'XYZ'], ['cv', 'CV'], [M('value'), 'Sales Value'], [P('cum_pct'), 'Cum %']] },
    stock_cover: { label: 'Stock Cover / Stock-out Forecast', cols: [['product_code', 'Code'], ['product_name', 'Item'], [Q('stock_qty'), 'Stock'], [Q('avg_daily_sales'), 'Avg Daily Sale'], ['cover_days', 'Cover Days'], ['stock_out_date', 'Stock-out On'], ['lead_time_days', 'Lead Days'], [Q('reorder_point'), 'Reorder Point'], ['status', 'Status'], [Q('suggested_qty'), 'Suggested Order']] },
    turnover: { label: 'Inventory Turnover', cols: [['product_code', 'Code'], ['product_name', 'Item'], ['group_name', 'Group'], [M('opening_value'), 'Opening'], [M('closing_value'), 'Closing'], [M('avg_inventory'), 'Avg Inventory'], [M('cogs'), 'Cost of Sales'], ['turnover', 'Turnover (x)'], ['days_in_stock', 'Days in Stock']] },
    dead_stock: { label: 'Dead Stock (no movement)', days: 180, cols: [['product_code', 'Code'], ['product_name', 'Item'], ['group_name', 'Group'], ['company_name', 'Company'], [Q('stock_qty'), 'Stock'], [M('stock_value'), 'Value'], ['last_movement', 'Last Movement'], ['idle_days', 'Idle Days']] },
    sales_forecast: { label: 'Sales / Purchase Forecast' },
    purchase_plan: { label: 'Purchase Plan (forecast based)', cols: [['product_code', 'Code'], ['product_name', 'Item'], ['vendor', 'Supplier'], [Q('forecast_month'), 'Forecast / Month'], [Q('daily_demand'), 'Daily Demand'], ['lead_time_days', 'Lead Days'], [Q('safety_stock'), 'Safety Stock'], [Q('requirement'), 'Requirement'], [Q('stock'), 'Stock'], [Q('on_order'), 'On Order'], [Q('suggested_qty'), 'Buy Qty'], ['method', 'Forecast Method']] },
    cash_forecast: { label: 'Cash Flow Forecast (weekly)' },
    period_compare: { label: 'Period Comparison (vs previous / last year)' },
    expense_compare: { label: 'Income & Expense Comparison (vs previous / last year)', cols: [['section', 'Section'], ['group', 'Group'], ['ledger', 'Ledger'], [M('current'), 'This Period'], [M('previous'), 'Compared Period'], [M('change'), 'Change'], [P('change_pct'), 'Change %']] },
    dso_dpo: { label: 'Collection & Payment Days (DSO / DPO)', cols: [['month', 'Month'], [M('sales'), 'Sales (incl. VAT)'], [M('receivables'), 'Receivables'], ['dso', 'DSO (days)'], [M('purchases'), 'Purchases (incl. VAT)'], [M('payables'), 'Payables'], ['dpo', 'DPO (days)']] },
    customer_rfm: { label: 'Customer RFM, New & Lost Customers', cols: [['name', 'Customer'], ['segment', 'Segment'], ['rfm', 'RFM'], ['recency_days', 'Days Since Last Bill'], ['bills', 'Bills'], [M('value'), 'Sales'], [M('prev_value'), 'Previous Period'], [M('change'), 'Change'], ['is_new', 'New?'], ['agent', 'Salesman'], ['area', 'Area']] }
};

function Bars({ history, forecast, labels }) {
    const all = [...history, ...forecast], max = Math.max(1, ...all);
    const w = 16, gap = 4, h = 90;
    return (
        <svg width={all.length * (w + gap)} height={h + 16} className="block">
            {all.map((v, i) => { const bh = (v / max) * h; const fc = i >= history.length; return (
                <g key={i}><rect x={i * (w + gap)} y={h - bh} width={w} height={bh} fill={fc ? '#f59e0b' : '#3b82f6'} opacity={fc ? 0.85 : 0.7}><title>{`${labels[i]}: ${fmt(v)}${fc ? ' (forecast)' : ''}`}</title></rect>
                    {i % 3 === 0 && <text x={i * (w + gap)} y={h + 12} fontSize="8" fill="#666">{labels[i]?.slice(2)}</text>}</g>); })}
        </svg>
    );
}

export default function AnalyticsReports() {
    const { authFetch } = useAuth();
    const [view, setView] = useState(() => new URLSearchParams(window.location.search).get('view') || 'fsn');
    const [f, setF] = useState({ date_from: iso(new Date(Date.now() - 364 * 86400000)), date_to: iso(new Date()), basis: 'value', group_by: 'product', measure: 'value', months: 3, method: '', side: 'sales',
        compare: 'last_year', weeks: 12, days: '', top: 50, product_group_id: '', product_company_id: '', service_level: 90, overdue_collection_pct: 50, start: iso(new Date()), cover_days: '', search: '' });
    const [groups, setGroups] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const V = ANALYTICS_VIEWS[view] || ANALYTICS_VIEWS.fsn;
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    useEffect(() => {
        authFetch('/api/product-groups').then(r => setGroups(r.data || [])).catch(() => {});
        authFetch('/api/product-companies').then(r => setCompanies(r.data || [])).catch(() => {});
    }, [authFetch]);
    const run = useCallback(async () => {
        setBusy(true); setError('');
        try {
            const p = new URLSearchParams();
            Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== null && k !== 'search') p.set(k, v); });
            setData((await authFetch(`/api/analytics/${view}?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        setBusy(false);
    }, [authFetch, f, view]);
    useEffect(() => { setData(null); }, [view]);

    const key = c => (typeof c[0] === 'string' ? c[0] : c[0].k);
    const cell = (r, c) => { const v = r[key(c)]; if (typeof c[0] === 'object') return c[0].t === 'money' ? fmt(v) : c[0].t === 'qty' ? q3(v) : pct(v); return v === true ? 'Yes' : v === false ? '' : v ?? ''; };
    const s = f.search.trim().toLowerCase();
    const rows = (data?.rows || []).filter(r => !s || Object.values(r).some(v => typeof v !== 'object' && String(v ?? '').toLowerCase().includes(s)));
    const exportCsv = () => {
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        let lines;
        if (view === 'sales_forecast') lines = [['Name', 'Method', ...data.history_months, ...data.forecast_months.map(m => `${m} (F)`)], ...rows.map(r => [r.name, r.method_label, ...r.history, ...r.forecast])];
        else if (view === 'cash_forecast') lines = [['Week', 'From', 'To', 'Opening', 'Receipts', 'PDC In', 'Payments', 'PDC Out', 'Net', 'Closing'], ...data.weeks.map(w => [w.week, w.from, w.to, w.opening, w.receipts, w.pdc_in, w.payments, w.pdc_out, w.net, w.closing])];
        else if (view === 'period_compare') lines = [['Month', 'Compared', 'Sales', 'Sales Prev', 'Change %', 'Purchase', 'Purchase Prev', 'Change %', 'Bills', 'Bills Prev'], ...data.rows.map(r => [r.month, r.compare_month, r.sales, r.sales_prev, r.sales_change_pct, r.purchase, r.purchase_prev, r.purchase_change_pct, r.bills, r.bills_prev])];
        else lines = [V.cols.map(c => c[1]), ...rows.map(r => V.cols.map(c => r[key(c)]))];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + lines.map(l => l.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${view}.csv`; a.click();
    };
    const needsDates = !['cash_forecast', 'sales_forecast', 'purchase_plan', 'dead_stock', 'dso_dpo'].includes(view);

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">🔮 {V.label}</span></div>
                    <div className="erp-tab-content">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3 no-print">
                            <div className="erp-field md:col-span-2"><label className="erp-label">Report</label>
                                <select className="erp-select" value={view} onChange={e => setView(e.target.value)}>{Object.entries(ANALYTICS_VIEWS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
                            {needsDates && <>
                                <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                            </>}
                            {['fsn', 'abc', 'xyz', 'abc_xyz', 'stock_cover', 'turnover', 'dead_stock', 'sales_forecast', 'purchase_plan'].includes(view) && <>
                                <div className="erp-field"><label className="erp-label">Product Group</label><select className="erp-select" value={f.product_group_id} onChange={e => set('product_group_id', e.target.value)}><option value="">All</option>{groups.map(g => <option key={g.id} value={g.id}>{g.group_name}</option>)}</select></div>
                                <div className="erp-field"><label className="erp-label">Product Company</label><select className="erp-select" value={f.product_company_id} onChange={e => set('product_company_id', e.target.value)}><option value="">All</option>{companies.map(g => <option key={g.id} value={g.id}>{g.company_name}</option>)}</select></div>
                            </>}
                            {view === 'abc' && <div className="erp-field"><label className="erp-label">ABC on</label><select className="erp-select" value={f.basis} onChange={e => set('basis', e.target.value)}><option value="value">Sales value</option><option value="qty">Sales qty</option><option value="stock">Stock value</option></select></div>}
                            {view === 'dead_stock' && <div className="erp-field"><label className="erp-label">No movement for (days)</label><input type="number" className="erp-input" placeholder="180" value={f.days} onChange={e => set('days', e.target.value)} /></div>}
                            {view === 'sales_forecast' && <>
                                <div className="erp-field"><label className="erp-label">Side</label><select className="erp-select" value={f.side} onChange={e => set('side', e.target.value)}><option value="sales">Sales</option><option value="purchase">Purchase</option></select></div>
                                <div className="erp-field"><label className="erp-label">By</label><select className="erp-select" value={f.group_by} onChange={e => set('group_by', e.target.value)}><option value="product">Item</option><option value="product_group">Product Group</option><option value="product_company">Product Company</option><option value="party">Customer / Supplier</option><option value="total">Total</option></select></div>
                                <div className="erp-field"><label className="erp-label">Measure</label><select className="erp-select" value={f.measure} onChange={e => set('measure', e.target.value)}><option value="value">Value</option><option value="qty">Qty</option></select></div>
                                <div className="erp-field"><label className="erp-label">Months ahead</label><input type="number" className="erp-input" value={f.months} onChange={e => set('months', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">Method</label><select className="erp-select" value={f.method} onChange={e => set('method', e.target.value)}><option value="">Best fit (auto)</option><option value="moving_average">Moving average</option><option value="weighted_average">Weighted average</option><option value="linear_trend">Linear trend</option><option value="seasonal">Seasonal</option><option value="holt">Holt smoothing</option></select></div>
                                <div className="erp-field"><label className="erp-label">Top</label><input type="number" className="erp-input" value={f.top} onChange={e => set('top', e.target.value)} /></div>
                            </>}
                            {view === 'purchase_plan' && <>
                                <div className="erp-field"><label className="erp-label">Service level</label><select className="erp-select" value={f.service_level} onChange={e => set('service_level', e.target.value)}><option value="90">90%</option><option value="95">95%</option><option value="99">99%</option></select></div>
                                <div className="erp-field"><label className="erp-label">Cover days after arrival</label><input type="number" className="erp-input" placeholder="30" value={f.cover_days} onChange={e => set('cover_days', e.target.value)} /></div>
                            </>}
                            {view === 'cash_forecast' && <>
                                <div className="erp-field"><label className="erp-label">Starting</label><input type="date" className="erp-input" value={f.start} onChange={e => set('start', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">Weeks</label><input type="number" className="erp-input" value={f.weeks} onChange={e => set('weeks', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">Overdue collected in week 1 (%)</label><input type="number" className="erp-input" value={f.overdue_collection_pct} onChange={e => set('overdue_collection_pct', e.target.value)} /></div>
                            </>}
                            {['period_compare', 'expense_compare'].includes(view) && <div className="erp-field"><label className="erp-label">Compare with</label><select className="erp-select" value={f.compare} onChange={e => set('compare', e.target.value)}><option value="last_year">Same period last year</option><option value="previous">Previous period</option></select></div>}
                            <div className="erp-field"><label className="erp-label">Search</label><input className="erp-input" value={f.search} onChange={e => set('search', e.target.value)} /></div>
                        </div>
                        <div className="flex gap-2 mb-3 no-print">
                            <button className="erp-btn primary" onClick={run} disabled={busy}>{busy ? 'Working…' : '🔍 Show'}</button>
                            {data && <><button className="erp-btn" onClick={exportCsv}>⬇ Excel</button><button className="erp-btn" onClick={() => window.print()}>🖨 Print</button></>}
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {data?.summary && <div className="flex flex-wrap gap-3 mb-3 text-sm">{data.summary.map(x => <div key={x.class} className="border rounded px-3 py-1">Class <b>{x.class}</b>: {x.items} items{x.items_pct !== undefined ? ` (${x.items_pct}%)` : ''} · {fmt(x.value ?? x.sales_value)}{x.stock_value !== undefined ? ` · stock ${fmt(x.stock_value)}` : ''}</div>)}</div>}
                        {data?.matrix && <div className="grid grid-cols-3 gap-2 mb-3 max-w-2xl text-xs">{['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'].map(k => { const m = data.matrix.find(x => x.cell === k); return <div key={k} className={`border rounded p-2 ${k[0] === 'A' ? 'bg-green-50' : k[0] === 'B' ? 'bg-yellow-50' : 'bg-red-50'}`}><b>{k}</b> · {m?.items || 0} items · {fmt(m?.value || 0)}<div className="text-gray-500">{m?.advice || ''}</div></div>; })}</div>}
                        {data?.totals && !['sales_forecast', 'period_compare'].includes(view) && <p className="text-sm mb-2">{Object.entries(data.totals).map(([k, v]) => <span key={k} className="mr-4 capitalize">{k.replace(/_/g, ' ')} <b>{typeof v === 'number' && !Number.isInteger(v) ? fmt(v) : v ?? '—'}</b></span>)}</p>}

                        {V.cols && data && (
                            <div className="overflow-x-auto"><table className="erp-grid-table text-sm">
                                <thead><tr>{V.cols.map(c => <th key={c[1]} className={typeof c[0] === 'object' ? 'text-right' : ''}>{c[1]}</th>)}</tr></thead>
                                <tbody>{rows.map((r, i) => <tr key={r.product_id || r.party_id || r.ledger_id || i} className={r.fsn === 'N' || r.status === 'order now' || r.adverse ? 'bg-red-50' : r.status === 'order soon' ? 'bg-amber-50' : ''}>{V.cols.map(c => <td key={c[1]} className={typeof c[0] === 'object' ? 'text-right' : ''}>{cell(r, c)}</td>)}</tr>)}</tbody>
                            </table><p className="text-xs text-gray-500 mt-1">{rows.length} row(s){data.from ? ` · ${data.from} to ${data.to}` : ''}</p></div>
                        )}
                        {view === 'expense_compare' && data?.sections && <div className="flex flex-wrap gap-3 my-3 text-sm">{data.sections.map(x => <span key={x.section} className="border rounded px-2 py-1 capitalize">{x.section.replace('_', ' ')}: <b>{fmt(x.current)}</b> vs {fmt(x.previous)}</span>)}<span className="border rounded px-2 py-1 bg-blue-50">Net profit: <b>{fmt(data.net.current)}</b> vs {fmt(data.net.previous)}</span></div>}
                        {view === 'customer_rfm' && data?.segments && (<>
                            <div className="flex flex-wrap gap-2 my-3 text-xs">{data.segments.map(x => <span key={x.segment} className="border rounded px-2 py-1">{x.segment}: <b>{x.customers}</b> · {fmt(x.value)}</span>)}</div>
                            {data.lost.length > 0 && <div className="border rounded p-2 text-sm"><b>Lost customers</b> (bought in {data.compare.from} – {data.compare.to}, not since): {data.lost.slice(0, 40).map(x => `${x.name} (${fmt(x.prev_value)})`).join(', ')}</div>}
                        </>)}

                        {view === 'sales_forecast' && data && (
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table text-xs">
                                    <thead><tr><th>Name</th><th>Trend (blue = actual, orange = forecast)</th><th>Method</th><th className="text-right">Last 12 m</th><th className="text-right">Growth</th>{data.forecast_months.map(m => <th key={m} className="text-right bg-amber-50">{m}</th>)}<th className="text-right bg-amber-50">Forecast Total</th></tr></thead>
                                    <tbody>{rows.map(r => <tr key={r.key}><td>{r.name}</td><td><Bars history={r.history} forecast={r.forecast} labels={[...data.history_months, ...data.forecast_months]} /></td><td>{r.method_label}<div className="text-gray-400">avg error {fmt(r.mae)}</div></td>
                                        <td className="text-right">{fmt(r.last_12)}</td><td className="text-right">{pct(r.growth_pct)}</td>{r.forecast.map((v, i) => <td key={i} className="text-right bg-amber-50">{data.measure === 'qty' ? q3(v) : fmt(v)}</td>)}<td className="text-right bg-amber-50 font-semibold">{fmt(r.forecast_total)}</td></tr>)}
                                        <tr className="font-semibold bg-slate-50"><td colSpan={5}>Total</td>{data.totals.forecast.map((v, i) => <td key={i} className="text-right">{fmt(v)}</td>)}<td className="text-right">{fmt(data.totals.forecast.reduce((a, b) => a + b, 0))}</td></tr></tbody>
                                </table>
                                <p className="text-xs text-gray-500 mt-1">History {data.history_months[0]} – {data.history_months[data.history_months.length - 1]}. "Best fit" back-tests every method on the last 3 months and keeps the one with the smallest error.</p>
                            </div>
                        )}
                        {view === 'cash_forecast' && data && (<>
                            <p className="text-sm mb-2">Cash & bank today <b>{fmt(data.opening_cash)}</b> · Overdue receivable {fmt(data.overdue.receipts)} ({data.overdue.collection_assumed_pct}% assumed in week 1) · Overdue payable {fmt(data.overdue.payments)} (all in week 1){data.lowest ? <> · Lowest: <b className={data.lowest.closing < 0 ? 'text-red-600' : ''}>{fmt(data.lowest.closing)}</b> in week {data.lowest.week}</> : ''}</p>
                            <table className="erp-grid-table text-sm"><thead><tr><th>Week</th><th>From</th><th>To</th><th className="text-right">Opening</th><th className="text-right">Receipts due</th><th className="text-right">PDC in</th><th className="text-right">Payments due</th><th className="text-right">PDC out</th><th className="text-right">Net</th><th className="text-right">Closing</th></tr></thead>
                                <tbody>{data.weeks.map(w => <tr key={w.week} className={w.closing < 0 ? 'bg-red-50' : ''}><td>{w.week}</td><td>{w.from}</td><td>{w.to}</td><td className="text-right">{fmt(w.opening)}</td><td className="text-right">{fmt(w.receipts)}</td><td className="text-right">{fmt(w.pdc_in)}</td><td className="text-right">{fmt(w.payments)}</td><td className="text-right">{fmt(w.pdc_out)}</td><td className={`text-right ${w.net < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(w.net)}</td><td className="text-right font-semibold">{fmt(w.closing)}</td></tr>)}</tbody></table>
                            <p className="text-xs text-gray-500 mt-1">Bills fall due on bill date + the party's credit days; PDCs on their cheque date.</p>
                        </>)}
                        {view === 'period_compare' && data && (<>
                            <p className="text-sm mb-2">{data.from} – {data.to} compared with {data.compare.label} ({data.compare.from} – {data.compare.to})</p>
                            <table className="erp-grid-table text-sm"><thead><tr><th>Month</th><th>vs</th><th className="text-right">Net Sales</th><th className="text-right">Previous</th><th className="text-right">Change %</th><th className="text-right">Net Purchase</th><th className="text-right">Previous</th><th className="text-right">Change %</th><th className="text-right">Bills</th><th className="text-right">Prev</th><th className="text-right">Avg Bill</th><th className="text-right">Prev</th><th className="text-right">Customers</th><th className="text-right">Prev</th></tr></thead>
                                <tbody>{data.rows.map(r => <tr key={r.month}><td>{r.month}</td><td className="text-gray-400">{r.compare_month}</td><td className="text-right">{fmt(r.sales)}</td><td className="text-right text-gray-500">{fmt(r.sales_prev)}</td><td className={`text-right ${(r.sales_change_pct || 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{pct(r.sales_change_pct)}</td>
                                    <td className="text-right">{fmt(r.purchase)}</td><td className="text-right text-gray-500">{fmt(r.purchase_prev)}</td><td className="text-right">{pct(r.purchase_change_pct)}</td><td className="text-right">{r.bills}</td><td className="text-right text-gray-500">{r.bills_prev}</td><td className="text-right">{fmt(r.avg_bill)}</td><td className="text-right text-gray-500">{fmt(r.avg_bill_prev)}</td><td className="text-right">{r.customers}</td><td className="text-right text-gray-500">{r.customers_prev}</td></tr>)}
                                    <tr className="font-semibold bg-slate-50"><td colSpan={2}>Total</td><td className="text-right">{fmt(data.totals.sales)}</td><td className="text-right">{fmt(data.totals.sales_prev)}</td><td className="text-right">{pct(data.totals.sales_change_pct)}</td><td className="text-right">{fmt(data.totals.purchase)}</td><td className="text-right">{fmt(data.totals.purchase_prev)}</td><td className="text-right">{pct(data.totals.purchase_change_pct)}</td><td className="text-right">{data.totals.bills}</td><td className="text-right">{data.totals.bills_prev}</td><td colSpan={4} /></tr></tbody></table>
                        </>)}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
