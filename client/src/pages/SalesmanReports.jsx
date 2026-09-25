// =============================================
// SalesmanReports.jsx  (/salesman-reports)
// Route / order / salesman reports (server: /api/salesman-reports/:view):
//   Plan vs Visit     planned customers, visited, productive, strike rate
//   Not Visited       planned customers nobody called on
//   Visit Log         every call with outcome and no-order reason
//   Order Register    orders (desk / mobile) with billed % (fill rate)
//   Pending Orders    unbilled order lines with ageing
//   Fill Rate         ordered vs billed by salesman / customer / product / route
//   Product-wise Orders
//   Salesman / Route / Area Sales   net sales (bills - returns)
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);
const money = k => ({ k, money: true });
const VIEWS = {
    plan_vs_visit: { label: 'Plan vs Visit (productive calls)', cols: [['date', 'Date'], ['agent_name', 'Salesman'], ['routes', 'Route(s)'], ['planned', 'Planned'], ['visited', 'Visited'], ['off_route', 'Off-route'], ['productive', 'Productive'], ['no_order', 'No order'], ['orders', 'Orders'], [money('order_value'), 'Order Value'], ['coverage_pct', 'Coverage %'], ['strike_rate_pct', 'Strike rate %']] },
    not_visited: { label: 'Planned but Not Visited', cols: [['date', 'Date'], ['agent_name', 'Salesman'], ['route_name', 'Route'], ['customer', 'Customer'], ['phone', 'Phone'], ['address', 'Address']] },
    visits: { label: 'Visit Log (no-order reasons)', cols: [['visit_date', 'Date'], ['agent_name', 'Salesman'], ['route_name', 'Route'], ['customer', 'Customer'], ['outcome', 'Outcome'], ['no_order_reason', 'Reason'], ['remarks', 'Remarks'], ['latitude', 'Lat'], ['longitude', 'Long']] },
    order_register: { label: 'Order Register (desk + mobile)', cols: [['doc_no', 'Order'], ['doc_date', 'Date'], ['customer', 'Customer'], ['agent', 'Salesman'], ['route', 'Route'], ['source', 'Source'], ['status', 'Status'], ['lines', 'Lines'], [money('amount'), 'Amount'], ['ordered_qty', 'Ordered Qty'], ['billed_qty', 'Billed Qty'], ['fill_pct', 'Fill %']] },
    pending_orders: { label: 'Pending Orders (unbilled) with ageing', cols: [['doc_no', 'Order'], ['doc_date', 'Date'], ['age_days', 'Age (days)'], ['status', 'Status'], ['source', 'Source'], ['customer', 'Customer'], ['agent', 'Salesman'], ['route', 'Route'], ['product', 'Item'], ['ordered_qty', 'Ordered'], ['billed_qty', 'Billed'], ['pending_qty', 'Pending'], [money('rate'), 'Rate'], [money('pending_value'), 'Pending Value']] },
    fill_rate: { label: 'Order Fill Rate (ordered vs billed)', group: true, cols: [['name', 'Name'], ['orders', 'Orders'], ['ordered_qty', 'Ordered Qty'], ['billed_qty', 'Billed Qty'], ['pending_qty', 'Pending Qty'], [money('ordered_value'), 'Ordered Value'], [money('billed_value'), 'Billed Value'], [money('pending_value'), 'Pending Value'], ['fill_pct', 'Fill %']] },
    order_products: { label: 'Product-wise Orders', cols: [['name', 'Product'], ['orders', 'Orders'], ['ordered_qty', 'Ordered Qty'], ['billed_qty', 'Billed Qty'], ['pending_qty', 'Pending Qty'], [money('ordered_value'), 'Ordered Value'], [money('pending_value'), 'Pending Value'], ['fill_pct', 'Fill %']] },
    agent_sales: { label: 'Salesman-wise Net Sales', cols: [['name', 'Salesman'], ['bills', 'Bills'], ['customers', 'Customers'], [money('sales'), 'Sales'], [money('returns'), 'Returns'], [money('net'), 'Net Sales'], [money('vat'), 'VAT']] },
    route_sales: { label: 'Route-wise Net Sales', cols: [['name', 'Route'], ['bills', 'Bills'], ['customers', 'Customers'], [money('sales'), 'Sales'], [money('returns'), 'Returns'], [money('net'), 'Net Sales'], [money('vat'), 'VAT']] },
    area_sales: { label: 'Area-wise Net Sales', cols: [['name', 'Area'], ['bills', 'Bills'], ['customers', 'Customers'], [money('sales'), 'Sales'], [money('returns'), 'Returns'], [money('net'), 'Net Sales'], [money('vat'), 'VAT']] }
};

export default function SalesmanReports() {
    const { authFetch } = useAuth();
    const [view, setView] = useState(() => new URLSearchParams(window.location.search).get('view') || 'plan_vs_visit');
    const [f, setF] = useState({ date_from: iso(new Date(Date.now() - 6 * 86400000)), date_to: iso(new Date()), agent_id: '', route_id: '', source: '', group_by: 'agent' });
    const [agents, setAgents] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        authFetch('/api/salesman-agents').then(r => setAgents(r.data || [])).catch(() => {});
        authFetch('/api/routes').then(r => setRoutes(r.data || [])).catch(() => {});
    }, [authFetch]);
    const run = useCallback(async () => {
        setBusy(true); setError('');
        try { const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); setData((await authFetch(`/api/salesman-reports/${view}?${p}`)).data); }
        catch (e) { setError(e.message); setData(null); }
        setBusy(false);
    }, [authFetch, f, view]);
    useEffect(() => { run(); }, [run]);

    const cols = VIEWS[view].cols;
    const cell = (r, c) => { const key = typeof c[0] === 'string' ? c[0] : c[0].k; const v = r[key]; return typeof c[0] === 'object' && c[0].money ? fmt(v) : v === null || v === undefined ? '' : String(v).match(/^\d{4}-\d{2}-\d{2}T/) ? String(v).slice(0, 10) : v; };
    const exportCsv = () => {
        const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
        const lines = [cols.map(c => c[1]), ...(data?.rows || []).map(r => cols.map(c => cell(r, c)))];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + lines.map(l => l.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${view}_${f.date_from}_${f.date_to}.csv`; a.click();
    };

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">📊 Salesman / Route / Order Reports</span></div>
                    <div className="erp-tab-content">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3 no-print">
                            <div className="erp-field md:col-span-2"><label className="erp-label">Report</label>
                                <select className="erp-select" value={view} onChange={e => setView(e.target.value)}>{Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
                            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">Salesman</label>
                                <select className="erp-select" value={f.agent_id} onChange={e => setF({ ...f, agent_id: e.target.value })}><option value="">All</option>{agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}</select></div>
                            <div className="erp-field"><label className="erp-label">Route</label>
                                <select className="erp-select" value={f.route_id} onChange={e => setF({ ...f, route_id: e.target.value })}><option value="">All</option>{routes.map(a => <option key={a.id} value={a.id}>{a.route_name}</option>)}</select></div>
                            {['order_register', 'pending_orders', 'fill_rate', 'order_products'].includes(view) && <div className="erp-field"><label className="erp-label">Source</label>
                                <select className="erp-select" value={f.source} onChange={e => setF({ ...f, source: e.target.value })}><option value="">All</option><option value="mobile">Mobile</option><option value="desk">Desk</option></select></div>}
                            {VIEWS[view].group && <div className="erp-field"><label className="erp-label">Group by</label>
                                <select className="erp-select" value={f.group_by} onChange={e => setF({ ...f, group_by: e.target.value })}><option value="agent">Salesman</option><option value="customer">Customer</option><option value="product">Product</option><option value="route">Route</option></select></div>}
                        </div>
                        <div className="flex gap-2 mb-3 no-print">
                            <button className="erp-btn primary" onClick={run} disabled={busy}>{busy ? 'Loading…' : '🔍 Show'}</button>
                            {data?.rows?.length > 0 && <><button className="erp-btn" onClick={exportCsv}>⬇ Excel</button><button className="erp-btn" onClick={() => window.print()}>🖨 Print</button></>}
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {data?.totals && <div className="flex flex-wrap gap-3 mb-3 text-sm">{Object.entries(data.totals).map(([k, v]) => <div key={k} className="border rounded px-3 py-1"><span className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span> <b>{typeof v === 'number' && !Number.isInteger(v) ? fmt(v) : v}</b></div>)}</div>}
                        {data?.ageing && <div className="flex flex-wrap gap-3 mb-3 text-sm">{Object.entries(data.ageing).map(([k, v]) => <div key={k} className="border rounded px-3 py-1"><span className="text-gray-500">{k} days</span> <b>{fmt(v)}</b></div>)}</div>}
                        {data?.reasons?.length > 0 && <div className="flex flex-wrap gap-2 mb-3 text-xs">{data.reasons.map(r => <span key={r.reason} className="bg-amber-50 border border-amber-200 rounded px-2 py-1">{r.reason}: <b>{r.count}</b></span>)}</div>}
                        {data && (
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table text-sm">
                                    <thead><tr>{cols.map(c => <th key={c[1]}>{c[1]}</th>)}</tr></thead>
                                    <tbody>{(data.rows || []).map((r, i) => <tr key={i}>{cols.map(c => <td key={c[1]} className={typeof c[0] === 'object' ? 'text-right' : ''}>{cell(r, c)}</td>)}</tr>)}</tbody>
                                </table>
                                {(data.rows || []).length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nothing for these filters.</p>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
