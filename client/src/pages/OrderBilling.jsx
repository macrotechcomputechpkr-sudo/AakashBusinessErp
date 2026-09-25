// =============================================
// OrderBilling.jsx  (/order-billing)
// Pending Sales Orders (desk and mobile) -> Sales Bills in one go.
//   * filter by customer / salesman / route / source / date
//   * tick orders (or single lines); Qty, Rate and Disc % are editable per
//     line (qty up to what is still pending)
//   * one bill per order, or one bill per customer (orders of the same
//     customer merged); save as draft or post straight away
// Draft orders are confirmed automatically before billing. Server:
// /api/order-billing (reuses the Sales Bill create / post handlers, so all
// validations, credit control, GL, stock and IRD register apply).
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);

export default function OrderBilling() {
    const { authFetch } = useAuth();
    // /order-billing?customer_id=..&date_from=.. opens straight on one customer's orders (Sales Order list "Bill" button)
    const [f, setF] = useState(() => {
        const u = new URLSearchParams(window.location.search);
        return { date_from: u.get('date_from') || iso(new Date(Date.now() - 30 * 86400000)), date_to: iso(new Date()), customer_id: u.get('customer_id') || '', agent_id: '', route_id: '', source: '' };
    });
    const [opts, setOpts] = useState({ mode: 'per_order', bill_date: iso(new Date()), post: false, invoice_type: '', override_credit_block: false });
    const [masters, setMasters] = useState({ customers: [], agents: [], routes: [] });
    const [data, setData] = useState(null);
    const [edits, setEdits] = useState({});             // line id -> { on, qty, rate, discount_percent }
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const load = u => authFetch(u).then(r => r.data || []).catch(() => []);
        Promise.all([load('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc'), load('/api/salesman-agents'), load('/api/routes')])
            .then(([customers, agents, routes]) => setMasters({ customers, agents, routes }));
    }, [authFetch]);

    const load = useCallback(async () => {
        setBusy(true); setError(''); setResult(null);
        try {
            const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
            const r = (await authFetch(`/api/order-billing/pending?${p}`)).data;
            setData(r);
            const e = {};
            r.orders.forEach(o => o.lines.forEach(l => { e[l.id] = { on: false, qty: l.pending_qty, alt_qty: l.pending_alt_qty, rate: Number(l.rate), discount_percent: Number(l.discount_percent || 0) }; }));
            setEdits(e);
        } catch (err) { setError(err.message); }
        setBusy(false);
    }, [authFetch, f]);
    useEffect(() => { load(); }, [load]);

    const setLine = (id, patch) => setEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }));
    const setOrder = (o, on) => setEdits(e => { const n = { ...e }; o.lines.forEach(l => { n[l.id] = { ...n[l.id], on }; }); return n; });
    const lineValue = (l, x) => { const g = Number(x.qty || 0) * Number(x.rate || 0); const net = g - g * Number(x.discount_percent || 0) / 100; return net * (1 + Number(l.tax_percent || 0) / 100); };
    const picked = useMemo(() => (data?.orders || []).map(o => ({ o, lines: o.lines.filter(l => edits[l.id]?.on && (Number(edits[l.id].qty) > 0 || Number(edits[l.id].alt_qty) > 0)) })).filter(x => x.lines.length), [data, edits]);
    const pickedValue = picked.reduce((s, x) => s + x.lines.reduce((t, l) => t + lineValue(l, edits[l.id]), 0), 0);
    const billCount = opts.mode === 'per_customer' ? new Set(picked.map(x => `${x.o.customer_ledger_id}`)).size : picked.length;

    const convert = async () => {
        if (!picked.length) return setError('Tick at least one order line');
        if (!window.confirm(`Create ${billCount} bill(s) for ${fmt(pickedValue)}${opts.post ? ' and POST them' : ' as draft'}?`)) return;
        setBusy(true); setError('');
        try {
            const body = { ...opts, invoice_type: opts.invoice_type || undefined, orders: picked.map(x => ({ order_id: x.o.id, lines: x.lines.map(l => ({ order_detail_id: l.id, qty: edits[l.id].qty, alt_qty: edits[l.id].alt_qty, rate: edits[l.id].rate, discount_percent: edits[l.id].discount_percent })) })) };
            const r = await authFetch('/api/order-billing/convert', { method: 'POST', body: JSON.stringify(body) });
            setResult(r.data);
            load().then(() => setResult(r.data));
        } catch (err) { setError(err.message); }
        setBusy(false);
    };

    const sel = (key, list, label, name) => (
        <div className="erp-field"><label className="erp-label">{label}</label>
            <select className="erp-select" value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })}><option value="">All</option>{list.map(i => <option key={i.id} value={i.id}>{i[name]}</option>)}</select></div>
    );

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">🧾 Sales Order → Bill (single / multiple)</span></div>
                    <div className="erp-tab-content">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
                            <div className="erp-field"><label className="erp-label">Order from</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">to</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
                            {sel('customer_id', masters.customers, 'Customer', 'account_name')}
                            {sel('agent_id', masters.agents, 'Salesman', 'agent_name')}
                            {sel('route_id', masters.routes, 'Route', 'route_name')}
                            <div className="erp-field"><label className="erp-label">Source</label>
                                <select className="erp-select" value={f.source} onChange={e => setF({ ...f, source: e.target.value })}><option value="">All</option><option value="mobile">Mobile</option><option value="desk">Desk</option></select></div>
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {result && (
                            <div className="border rounded-lg p-3 mb-3 bg-green-50 text-sm">
                                <p className="font-semibold">{result.bills} bill(s) created{result.failed ? `, ${result.failed} failed` : ''}</p>
                                {result.results.map((r, i) => <p key={i} className={r.ok ? '' : 'text-red-600'}>{r.orders.join(', ')} → {r.ok ? <>{r.bill_no} {r.posted ? '(posted)' : '(draft)'}{r.post_error ? <span className="text-red-600"> - post failed: {r.post_error}</span> : ''}{r.warning ? <span className="text-amber-700"> - {r.warning}</span> : ''} <a className="text-purple-600" href={`/print/sales_bill/${r.bill_id}`} target="_blank" rel="noopener noreferrer">🖨</a></> : r.error}</p>)}
                            </div>
                        )}
                        {data && (
                            <>
                                <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
                                    <span>{data.summary.orders} pending order(s) · {data.summary.lines} line(s) · {fmt(data.summary.pending_value)}</span>
                                    <button className="erp-btn" onClick={() => data.orders.forEach(o => setOrder(o, true))}>Tick all</button>
                                    <button className="erp-btn" onClick={() => data.orders.forEach(o => setOrder(o, false))}>Clear</button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="erp-grid-table text-sm">
                                        <thead><tr><th /><th>Order / Item</th><th>Customer</th><th>Salesman · Route</th><th className="text-right">Ordered</th><th className="text-right">Pending</th><th>Bill Qty</th><th>Rate</th><th>Disc %</th><th className="text-right">Value (incl. VAT)</th></tr></thead>
                                        <tbody>
                                            {data.orders.map(o => (
                                                <React.Fragment key={o.id}>
                                                    <tr className="bg-slate-50 font-semibold">
                                                        <td><input type="checkbox" checked={o.lines.every(l => edits[l.id]?.on)} onChange={e => setOrder(o, e.target.checked)} /></td>
                                                        <td>{o.doc_no} <span className="text-xs text-gray-500">{String(o.doc_date).slice(0, 10)} · {o.age_days}d {o.order_source === 'mobile' ? '📱' : ''} {o.status === 'draft' ? <span className="text-amber-600">draft</span> : ''}</span></td>
                                                        <td>{o.customer_name}</td><td className="text-xs">{o.agent_name || '—'} · {o.route_name || '—'}</td>
                                                        <td /><td className="text-right">{fmt(o.pending_value)}</td><td colSpan={4} />
                                                    </tr>
                                                    {o.lines.map(l => { const x = edits[l.id] || {}; return (
                                                        <tr key={l.id} className={x.on ? 'bg-blue-50' : ''}>
                                                            <td><input type="checkbox" checked={!!x.on} onChange={e => setLine(l.id, { on: e.target.checked })} /></td>
                                                            <td className="pl-4">{l.product_name_snapshot}</td><td /><td />
                                                            <td className="text-right">{Number(l.qty)}</td><td className="text-right">{l.pending_qty}{l.pending_alt_qty ? ` + ${l.pending_alt_qty}` : ''}</td>
                                                            <td><input type="number" className="erp-input" style={{ width: 90 }} value={x.qty} max={l.pending_qty} onChange={e => setLine(l.id, { qty: e.target.value, on: true })} />
                                                                {l.pending_alt_qty !== null && <input type="number" className="erp-input mt-1" style={{ width: 90 }} title="Secondary unit qty" value={x.alt_qty ?? ''} onChange={e => setLine(l.id, { alt_qty: e.target.value, on: true })} />}</td>
                                                            <td><input type="number" className="erp-input" style={{ width: 100 }} value={x.rate} onChange={e => setLine(l.id, { rate: e.target.value, on: true })} /></td>
                                                            <td><input type="number" className="erp-input" style={{ width: 70 }} value={x.discount_percent} onChange={e => setLine(l.id, { discount_percent: e.target.value, on: true })} /></td>
                                                            <td className="text-right">{fmt(lineValue(l, x))}</td>
                                                        </tr>); })}
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                    </table>
                                    {data.orders.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No pending orders for these filters.</p>}
                                </div>
                                <div className="sticky bottom-0 bg-white border-t mt-3 pt-3 flex flex-wrap items-end gap-3">
                                    <div className="erp-field"><label className="erp-label">Bills</label>
                                        <select className="erp-select" value={opts.mode} onChange={e => setOpts({ ...opts, mode: e.target.value })}><option value="per_order">One bill per order</option><option value="per_customer">One bill per customer (merge orders)</option></select></div>
                                    <div className="erp-field"><label className="erp-label">Bill date</label><input type="date" className="erp-input" value={opts.bill_date} onChange={e => setOpts({ ...opts, bill_date: e.target.value })} /></div>
                                    <div className="erp-field"><label className="erp-label">Invoice type</label>
                                        <select className="erp-select" value={opts.invoice_type} onChange={e => setOpts({ ...opts, invoice_type: e.target.value })}><option value="">As on order</option><option value="credit">Credit</option><option value="cash">Cash</option></select></div>
                                    <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={opts.post} onChange={e => setOpts({ ...opts, post: e.target.checked })} /> Post bills now</label>
                                    <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={opts.override_credit_block} onChange={e => setOpts({ ...opts, override_credit_block: e.target.checked })} /> Override credit block</label>
                                    <span className="text-sm ml-auto">{picked.length} order(s) → <b>{billCount}</b> bill(s) · <b>{fmt(pickedValue)}</b></span>
                                    <button className="erp-btn primary" disabled={busy || !picked.length} onClick={convert}>{busy ? 'Working…' : '⚡ Convert to Bill'}</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
