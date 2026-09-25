// =============================================
// ControlReports.jsx  (/control-reports?view=...)
// Master / control reports (server: utils/controlReports.js):
// Day Book, Cash & Bank Book, Customer / Supplier master, Price List,
// Route-wise Customers, Credit Limit Exceeded / Overdue, Inactive
// Customers, Non-moving Items, Master Data Exceptions, Cancelled and
// Draft (unposted) document registers.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt = n => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const iso = d => d.toISOString().slice(0, 10);
const M = k => ({ k, money: true });
export const CONTROL_VIEWS = {
    day_book: { label: 'Day Book', dates: true },
    cash_bank_book: { label: 'Cash & Bank Book', dates: true },
    customer_master: { label: 'Customer Master List', cols: [['code', 'Code'], ['name', 'Customer'], ['pan', 'PAN'], ['phone', 'Phone'], ['address', 'Address'], ['area', 'Area'], ['route', 'Route'], ['agent', 'Salesman'], [M('credit_limit'), 'Credit Limit'], ['credit_days', 'Cr. Days'], [M('balance'), 'Balance'], [M('overdue'), 'Overdue'], ['last_doc_date', 'Last Sale'], [M('total_value'), 'Total Sales']] },
    supplier_master: { label: 'Supplier Master List', cols: [['code', 'Code'], ['name', 'Supplier'], ['pan', 'PAN'], ['phone', 'Phone'], ['address', 'Address'], [M('credit_limit'), 'Credit Limit'], ['credit_days', 'Cr. Days'], [M('balance'), 'Balance'], [M('overdue'), 'Overdue'], ['last_doc_date', 'Last Purchase'], [M('total_value'), 'Total Purchase']] },
    price_list: { label: 'Product Price List', cols: [['code', 'Code'], ['name', 'Product'], ['hs_code', 'HS Code'], ['unit', 'Unit'], ['group', 'Group'], ['company', 'Company'], [M('mrp'), 'MRP'], [M('sr1'), 'SR1'], [M('sr2'), 'SR2'], [M('sr3'), 'SR3'], [M('sr4'), 'SR4'], [M('sr5'), 'SR5'], [M('purchase_rate'), 'Purchase Rate'], ['vat', 'VAT'], ['discount', 'Disc %'], ['stock', 'Stock']] },
    route_customers: { label: 'Route-wise Customer List', cols: [['area', 'Area'], ['route', 'Route'], ['salesman', 'Salesman'], ['seq', 'Seq'], ['customer', 'Customer'], ['pan', 'PAN'], ['phone', 'Phone'], ['address', 'Address'], [M('credit_limit'), 'Credit Limit']] },
    credit_exceed: { label: 'Credit Limit Exceeded / Overdue', cols: [['name', 'Customer'], ['agent', 'Salesman'], ['route', 'Route'], [M('credit_limit'), 'Credit Limit'], [M('balance'), 'Balance'], [M('excess'), 'Excess'], ['used_pct', 'Used %'], ['credit_days', 'Cr. Days'], [M('overdue'), 'Overdue'], ['phone', 'Phone']] },
    inactive_customers: { label: 'Inactive Customers (no sale in N days)', days: 60, cols: [['name', 'Customer'], ['agent', 'Salesman'], ['route', 'Route'], ['last_doc_date', 'Last Sale'], ['idle_days', 'Idle Days'], [M('balance'), 'Balance'], ['phone', 'Phone']] },
    non_moving_items: { label: 'Non-moving Items (no sale in N days)', days: 90, cols: [['code', 'Code'], ['name', 'Product'], ['group', 'Group'], ['company', 'Company'], ['unit', 'Unit'], ['stock', 'Stock'], [M('value'), 'Stock Value'], ['last_sale', 'Last Sale'], ['idle_days', 'Idle Days']] },
    master_exceptions: { label: 'Master Data Exceptions', cols: [['type', 'Type'], ['check', 'Missing'], ['name', 'Name'], ['detail', 'Detail']] },
    cancelled_docs: { label: 'Cancelled Documents Register', dates: true, cols: [['doc_label', 'Document'], ['doc_no', 'No'], ['doc_date', 'Date'], ['party', 'Party'], [M('amount'), 'Amount'], ['reason', 'Reason'], ['by', 'Cancelled By'], ['at', 'When']] },
    draft_docs: { label: 'Draft (Unposted) Documents', dates: true, cols: [['doc_label', 'Document'], ['doc_no', 'No'], ['doc_date', 'Date'], ['age_days', 'Age'], ['party', 'Party'], [M('amount'), 'Amount'], ['by', 'Created By']] }
};

export default function ControlReports() {
    const { authFetch } = useAuth();
    const [view, setView] = useState(() => new URLSearchParams(window.location.search).get('view') || 'day_book');
    const [f, setF] = useState({ date_from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), date_to: iso(new Date()), days: '', search: '' });
    const [data, setData] = useState(null);
    const [open, setOpen] = useState({});
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const V = CONTROL_VIEWS[view] || CONTROL_VIEWS.day_book;

    const run = useCallback(async () => {
        setBusy(true); setError('');
        try {
            const p = new URLSearchParams({ date_from: f.date_from, date_to: f.date_to });
            if (f.days) p.set('days', f.days);
            setData((await authFetch(`/api/control-reports/${view}?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        setBusy(false);
    }, [authFetch, view, f.date_from, f.date_to, f.days]);
    useEffect(() => { setData(null); run(); }, [run]);

    const key = c => (typeof c[0] === 'string' ? c[0] : c[0].k);
    const cell = (r, c) => (typeof c[0] === 'object' ? fmt(r[key(c)]) : r[key(c)] === null || r[key(c)] === undefined ? '' : String(r[key(c)]).replace(/T(\d\d:\d\d).*$/, ' $1'));
    const s = f.search.trim().toLowerCase();
    const rows = (data?.rows || []).filter(r => !s || Object.values(r).some(v => String(v ?? '').toLowerCase().includes(s)));
    const exportCsv = () => {
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        let lines;
        if (view === 'day_book') lines = [['Date', 'Document', 'No', 'Ledger', 'Debit', 'Credit', 'Narration'], ...rows.flatMap(r => r.lines.map(l => [r.date, r.doc_label, r.doc_no, l.ledger, l.debit, l.credit, l.narration || r.narration]))];
        else if (view === 'cash_bank_book') lines = [['Book', 'Date', 'Document', 'No', 'Particulars', 'Receipt', 'Payment', 'Balance'], ...(data?.books || []).flatMap(b => b.entries.map(e => [b.ledger_name, e.date, e.doc_label, e.doc_no, e.particulars, e.receipt, e.payment, e.balance]))];
        else lines = [V.cols.map(c => c[1]), ...rows.map(r => V.cols.map(c => r[key(c)]))];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(l => l.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${view}.csv`; a.click();
    };

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">📚 {V.label}</span></div>
                    <div className="erp-tab-content">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3 no-print">
                            <div className="erp-field md:col-span-2"><label className="erp-label">Report</label>
                                <select className="erp-select" value={view} onChange={e => setView(e.target.value)}>{Object.entries(CONTROL_VIEWS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
                            {(V.dates || ['customer_master', 'supplier_master'].includes(view)) && <>
                                <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></div>
                                <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
                            </>}
                            {V.days && <div className="erp-field"><label className="erp-label">Days without sale</label><input type="number" className="erp-input" placeholder={String(V.days)} value={f.days} onChange={e => setF({ ...f, days: e.target.value })} /></div>}
                            <div className="erp-field"><label className="erp-label">Search</label><input className="erp-input" value={f.search} onChange={e => setF({ ...f, search: e.target.value })} /></div>
                        </div>
                        <div className="flex gap-2 mb-3 no-print">
                            <button className="erp-btn primary" onClick={run} disabled={busy}>{busy ? 'Loading…' : '🔍 Show'}</button>
                            <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button><button className="erp-btn" onClick={() => window.print()}>🖨 Print</button>
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {data?.summary && <div className="flex flex-wrap gap-2 mb-3 text-xs">{data.summary.map(x => <span key={x.check} className="bg-amber-50 border border-amber-200 rounded px-2 py-1">{x.check}: <b>{x.count}</b></span>)}</div>}
                        {data?.by_type && <div className="flex flex-wrap gap-2 mb-3 text-xs">{data.by_type.map(x => <span key={x.doc_label} className="border rounded px-2 py-1">{x.doc_label}: <b>{x.vouchers ?? x.count}</b> · {fmt(x.amount)}</span>)}</div>}
                        {data?.totals && <p className="text-sm mb-2">{Object.entries(data.totals).map(([k, v]) => <span key={k} className="mr-4 capitalize">{k.replace('_', ' ')} <b>{k === 'vouchers' ? v : fmt(v)}</b></span>)}</p>}

                        {view === 'day_book' && data && (
                            <table className="erp-grid-table text-sm"><thead><tr><th>Date</th><th>Document</th><th>No</th><th>Narration</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
                                <tbody>{rows.map(r => <React.Fragment key={r.batch_id}>
                                    <tr className="cursor-pointer" onClick={() => setOpen(o => ({ ...o, [r.batch_id]: !o[r.batch_id] }))}><td>{r.date}</td><td>{open[r.batch_id] ? '▾' : '▸'} {r.doc_label}</td><td>{r.doc_no}</td><td className="text-xs">{r.narration}</td><td className="text-right">{fmt(r.debit)}</td><td className="text-right">{fmt(r.credit)}</td></tr>
                                    {open[r.batch_id] && r.lines.map((l, i) => <tr key={i} className="bg-slate-50 text-xs"><td /><td colSpan={3} className="pl-6">{l.ledger}{l.narration ? ` - ${l.narration}` : ''}</td><td className="text-right">{l.debit ? fmt(l.debit) : ''}</td><td className="text-right">{l.credit ? fmt(l.credit) : ''}</td></tr>)}
                                </React.Fragment>)}</tbody></table>
                        )}
                        {view === 'cash_bank_book' && data && data.books.map(b => (
                            <div key={b.ledger_id} className="mb-4">
                                <p className="font-semibold text-sm bg-slate-100 rounded px-3 py-1">{b.ledger_name} · Opening {fmt(b.opening)} · Receipts {fmt(b.receipts)} · Payments {fmt(b.payments)} · Closing {fmt(b.closing)}</p>
                                <table className="erp-grid-table text-sm"><thead><tr><th>Date</th><th>Document</th><th>No</th><th>Particulars</th><th>Narration</th><th className="text-right">Receipt</th><th className="text-right">Payment</th><th className="text-right">Balance</th></tr></thead>
                                    <tbody>{b.entries.filter(e => !s || Object.values(e).some(v => String(v).toLowerCase().includes(s))).map((e, i) => <tr key={i}><td>{e.date}</td><td className="text-xs">{e.doc_label}</td><td>{e.doc_no}</td><td>{e.particulars}</td><td className="text-xs">{e.narration}</td><td className="text-right">{e.receipt ? fmt(e.receipt) : ''}</td><td className="text-right">{e.payment ? fmt(e.payment) : ''}</td><td className="text-right">{fmt(e.balance)}</td></tr>)}</tbody></table>
                            </div>
                        ))}
                        {V.cols && data && (
                            <div className="overflow-x-auto"><table className="erp-grid-table text-sm">
                                <thead><tr>{V.cols.map(c => <th key={c[1]} className={typeof c[0] === 'object' ? 'text-right' : ''}>{c[1]}</th>)}</tr></thead>
                                <tbody>{rows.map((r, i) => <tr key={r.id || i}>{V.cols.map(c => <td key={c[1]} className={typeof c[0] === 'object' ? 'text-right' : ''}>{cell(r, c)}</td>)}</tr>)}</tbody>
                            </table>
                                <p className="text-xs text-gray-500 mt-1">{rows.length} row(s)</p>
                                {view === 'route_customers' && data.not_on_any_route?.length > 0 && <p className="text-xs text-amber-700 mt-2">Customers on no route ({data.not_on_any_route.length}): {data.not_on_any_route.slice(0, 50).map(x => x.customer).join(', ')}{data.not_on_any_route.length > 50 ? '…' : ''}</p>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
