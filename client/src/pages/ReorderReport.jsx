// =============================================
// ReorderReport.jsx
// Re-order and Over-stock (server: reorderReport in utils/stockHealth.js).
//   Re-order - items whose projected stock (on hand + pending purchase
//     orders - pending sales orders, optional) is at or below the re-order
//     level, with the suggested qty, vendor and last purchase rate. Tick
//     items, adjust qty / rate / vendor and "Create Purchase Order": one
//     DRAFT Purchase Order per vendor through the normal Purchase Order API
//     (numbering, snapshots, totals as usual) - review and confirm it there.
//   Over-stock - items above their maximum stock, with the excess qty/value.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtQ = n => (Number(n) ? (Math.round(Number(n) * 10000) / 10000).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '');

const defaultConfig = () => ({ warehouse_ids: [], product_group_id: '', product_company_id: '', vendor_ids: [], search: '', sales_days: '90',
    deduct_sales_orders: false, include_lead_time: false, sort_by: 'vendor', include_inactive: false });

export default function ReorderReport() {
    const { authFetch } = useAuth();
    const [mode, setMode] = useState('reorder');
    const [config, setConfig] = useState(defaultConfig());
    const [masters, setMasters] = useState({ groups: [], companies: [], warehouses: [], suppliers: [] });
    const [data, setData] = useState(null);
    const [edits, setEdits] = useState({});                 // product_id -> { selected, qty, rate, vendor_id }
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [created, setCreated] = useState([]);
    const [creating, setCreating] = useState(false);
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    useEffect(() => {
        const load = async u => { try { return (await authFetch(u)).data || []; } catch { return []; } };
        Promise.all([load('/api/product-groups'), load('/api/product-companies'), load('/api/warehouses'), authFetch('/api/reports/ageing/meta').then(r => r.data?.suppliers || []).catch(() => [])])
            .then(([groups, companies, warehouses, suppliers]) => setMasters({ groups, companies, warehouses: warehouses.map(w => ({ id: w.id, name: w.warehouse_name })), suppliers }));
    }, [authFetch]);

    const run = useCallback(async (cfg = config, m = mode) => {
        setLoading(true); setError(''); setCreated([]);
        try {
            const p = new URLSearchParams({ mode: m, sales_days: cfg.sales_days || '90', deduct_sales_orders: String(cfg.deduct_sales_orders),
                include_lead_time: String(cfg.include_lead_time), sort_by: cfg.sort_by, include_inactive: String(cfg.include_inactive) });
            ['warehouse_ids', 'vendor_ids'].forEach(k => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            ['product_group_id', 'product_company_id', 'search'].forEach(k => { if (cfg[k]) p.set(k, cfg[k]); });
            const res = (await authFetch(`/api/reports/reorder?${p}`)).data;
            setData(res);
            setEdits(Object.fromEntries(res.rows.map(r => [r.product_id, { selected: m === 'reorder' && r.suggested_qty > 0 && !!r.vendor_id, qty: r.suggested_qty, rate: r.rate, vendor_id: r.vendor_id || '' }])));
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config, mode]);

    const edit = (pid, patch) => setEdits(e => ({ ...e, [pid]: { ...e[pid], ...patch } }));
    const chosen = useMemo(() => (data?.rows || []).filter(r => edits[r.product_id]?.selected && Number(edits[r.product_id]?.qty) > 0), [data, edits]);
    const byVendor = useMemo(() => {
        const g = {};
        chosen.forEach(r => { const v = edits[r.product_id].vendor_id || ''; (g[v] = g[v] || []).push(r); });
        return g;
    }, [chosen, edits]);

    const createOrders = async () => {
        if (!chosen.length) return;
        if (byVendor['']) { setError('Choose a vendor for every ticked item'); return; }
        const vendors = Object.keys(byVendor);
        if (!window.confirm(`Create ${vendors.length} draft Purchase Order(s) for ${chosen.length} item(s)?`)) return;
        setCreating(true); setError('');
        const done = [];
        for (const v of vendors) {
            try {
                const body = { doc_date: iso(new Date()), vendor_ledger_id: v, status: 'draft', save_as_draft: true, narration: 'Created from Re-order Report',
                    details: byVendor[v].map(r => ({ product_id: r.product_id, qty: Number(edits[r.product_id].qty), uom_id: r.base_unit_id || '', rate: Number(edits[r.product_id].rate) || 0 })) };
                const res = await authFetch('/api/purchase-orders', { method: 'POST', body: JSON.stringify(body) });
                done.push({ vendor: masters.suppliers.find(s => s.id === v)?.name || byVendor[v][0].vendor_name, doc_no: res.data?.doc_no, items: byVendor[v].length, ok: true });
            } catch (e) { done.push({ vendor: masters.suppliers.find(s => s.id === v)?.name || v, error: e.message, ok: false }); }
        }
        setCreated(done); setCreating(false);
    };

    const exportCsv = () => {
        if (!data) return;
        const head = mode === 'reorder'
            ? ['Code', 'Item', 'Unit', 'On Hand', 'Pending PO', 'Pending SO', 'Projected', 'Re-order Level', 'Max', 'Re-order Qty', 'Avg Daily Sales', 'Days Cover', 'Suggested Qty', 'Rate', 'Value', 'Vendor']
            : ['Code', 'Item', 'Unit', 'On Hand', 'Max', 'Excess Qty', 'Excess Value', 'Stock Value', 'Avg Daily Sales', 'Days Cover'];
        const rows = data.rows.map(r => (mode === 'reorder'
            ? [r.product_code, r.product_name, r.unit, r.on_hand, r.pending_po, r.pending_so, r.projected, r.reorder_level, r.maximum_stock, r.reorder_qty, r.avg_daily_sales, r.days_cover ?? '', edits[r.product_id]?.qty, edits[r.product_id]?.rate, Math.round(Number(edits[r.product_id]?.qty) * Number(edits[r.product_id]?.rate) * 100) / 100, r.vendor_name]
            : [r.product_code, r.product_name, r.unit, r.on_hand, r.maximum_stock, r.excess_qty, r.excess_value, r.stock_value, r.avg_daily_sales, r.days_cover ?? '']));
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${mode}_${iso(new Date())}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };
    const opts = (rows, v, l) => rows.map(r => <option key={r[v]} value={r[v]}>{r[l]}</option>);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">🔔 Re-order & Over-stock</span></div>
            <div className="erp-tab-content">
                <div className="print:hidden">
                    <div className="flex gap-1 mb-3 border-b">
                        {[['reorder', '🔔 Re-order'], ['overstock', '📦 Over-stock']].map(([k, l]) => (
                            <button key={k} className={`px-4 py-2 text-sm ${mode === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => { setMode(k); setData(null); }}>{l}</button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        <MultiPick label="Warehouses" allLabel="All (company)" items={masters.warehouses} value={config.warehouse_ids} onChange={v => set('warehouse_ids', v)} />
                        <div className="erp-field"><label className="erp-label">Product Group (+ sub)</label><select className="erp-select" value={config.product_group_id} onChange={e => set('product_group_id', e.target.value)}><option value="">All</option>{opts(masters.groups, 'id', 'group_name')}</select></div>
                        <div className="erp-field"><label className="erp-label">Product Company</label><select className="erp-select" value={config.product_company_id} onChange={e => set('product_company_id', e.target.value)}><option value="">All</option>{opts(masters.companies, 'id', 'company_name')}</select></div>
                        <MultiPick label="Vendor" items={masters.suppliers} value={config.vendor_ids} onChange={v => set('vendor_ids', v)} />
                        <div className="erp-field"><label className="erp-label">Sales average over (days)</label><input type="number" className="erp-input" value={config.sales_days} onChange={e => set('sales_days', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">Search item / code</label><input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                    </div>
                    <div className="flex flex-wrap gap-4 items-center text-sm mb-3">
                        {mode === 'reorder' && <label className="flex items-center gap-2"><input type="checkbox" checked={config.deduct_sales_orders} onChange={e => set('deduct_sales_orders', e.target.checked)} /> Deduct pending sales orders</label>}
                        {mode === 'reorder' && <label className="flex items-center gap-2"><input type="checkbox" checked={config.include_lead_time} onChange={e => set('include_lead_time', e.target.checked)} /> Also items that won't last the lead time</label>}
                        <label className="flex items-center gap-2"><input type="checkbox" checked={config.include_inactive} onChange={e => set('include_inactive', e.target.checked)} /> Include inactive items</label>
                        <label className="flex items-center gap-2">Sort by <select className="erp-select w-auto" value={config.sort_by} onChange={e => set('sort_by', e.target.value)}><option value="vendor">Vendor</option><option value="name">Item</option>{mode === 'overstock' && <option value="value">Excess value</option>}</select></label>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                        <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                        {data && mode === 'reorder' && <button className="erp-btn primary" disabled={!chosen.length || creating} onClick={createOrders}>{creating ? 'Creating…' : `🧾 Create Purchase Order (${Object.keys(byVendor).length} vendor, ${chosen.length} items)`}</button>}
                        {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                        {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                    </div>
                    {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                    {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}
                    {created.length > 0 && (
                        <div className="mb-3 border rounded p-2 bg-green-50 text-sm">
                            {created.map((x, i) => <div key={i} className={x.ok ? 'text-green-800' : 'text-red-700'}>{x.ok ? `✓ Draft Purchase Order ${x.doc_no} - ${x.vendor} (${x.items} items)` : `✗ ${x.vendor}: ${x.error}`}</div>)}
                            <a href="/purchase-order" className="text-blue-600 text-xs">Open Purchase Orders to review and confirm →</a>
                        </div>
                    )}
                </div>

                {data && (
                    <div className="overflow-x-auto text-sm">
                        {mode === 'reorder' ? (
                            <table className="erp-grid-table w-full">
                                <thead><tr>
                                    <th className="print:hidden"><input type="checkbox" checked={data.rows.length > 0 && data.rows.every(r => edits[r.product_id]?.selected)} onChange={e => setEdits(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { ...v, selected: e.target.checked }])))} /></th>
                                    <th className="text-left">Item</th><th className="text-left">Unit</th><th className="text-right">On Hand</th><th className="text-right">Pending PO</th>
                                    {config.deduct_sales_orders && <th className="text-right">Pending SO</th>}<th className="text-right">Projected</th><th className="text-right">Level</th>
                                    <th className="text-right">Max</th><th className="text-right">Daily Sales</th><th className="text-right">Days Cover</th>
                                    <th className="text-right bg-blue-50">Order Qty</th><th className="text-right">Rate</th><th className="text-right">Value</th><th className="text-left">Vendor</th>
                                </tr></thead>
                                <tbody>
                                    {data.rows.map(r => {
                                        const e = edits[r.product_id] || {};
                                        return (
                                            <tr key={r.product_id} className={r.projected <= 0 ? 'bg-red-50' : ''}>
                                                <td className="print:hidden"><input type="checkbox" checked={!!e.selected} onChange={ev => edit(r.product_id, { selected: ev.target.checked })} /></td>
                                                <td>{r.product_name} <span className="text-xs text-gray-400">{r.product_code}</span></td><td className="text-gray-500">{r.unit}</td>
                                                <td className="text-right tabular-nums">{fmtQ(r.on_hand) || 0}</td><td className="text-right tabular-nums">{fmtQ(r.pending_po)}</td>
                                                {config.deduct_sales_orders && <td className="text-right tabular-nums">{fmtQ(r.pending_so)}</td>}
                                                <td className="text-right tabular-nums font-semibold">{fmtQ(r.projected) || 0}</td><td className="text-right tabular-nums">{fmtQ(r.reorder_level)}</td>
                                                <td className="text-right tabular-nums">{fmtQ(r.maximum_stock)}</td><td className="text-right tabular-nums">{fmtQ(r.avg_daily_sales)}</td><td className="text-right">{r.days_cover ?? ''}</td>
                                                <td className="bg-blue-50"><input type="number" min="0" step="0.0001" className="erp-input text-right" style={{ width: 90 }} value={e.qty ?? ''} onChange={ev => edit(r.product_id, { qty: ev.target.value })} /></td>
                                                <td><input type="number" min="0" step="0.01" className="erp-input text-right" style={{ width: 80 }} value={e.rate ?? ''} onChange={ev => edit(r.product_id, { rate: ev.target.value })} /></td>
                                                <td className="text-right tabular-nums">{fmt2(Number(e.qty) * Number(e.rate))}</td>
                                                <td>
                                                    <select className="erp-select" style={{ minWidth: 150 }} value={e.vendor_id || ''} onChange={ev => edit(r.product_id, { vendor_id: ev.target.value })}>
                                                        <option value="">Choose vendor</option>
                                                        {r.vendor_id && !masters.suppliers.some(s => s.id === r.vendor_id) && <option value={r.vendor_id}>{r.vendor_name}</option>}
                                                        {masters.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                    </select>
                                                    {r.vendor_source && <div className="text-[10px] text-gray-400">{r.vendor_source}</div>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {data.rows.length === 0 && <tr><td colSpan={15} className="text-center text-gray-400 py-4">Nothing to re-order.</td></tr>}
                                </tbody>
                                {data.rows.length > 0 && <tfoot><tr className="font-bold bg-blue-50"><td colSpan={config.deduct_sales_orders ? 13 : 12} className="text-right">Ticked total</td>
                                    <td className="text-right tabular-nums">{fmt2(chosen.reduce((s, r) => s + Number(edits[r.product_id].qty) * Number(edits[r.product_id].rate), 0))}</td><td /></tr></tfoot>}
                            </table>
                        ) : (
                            <table className="erp-grid-table w-full">
                                <thead><tr>
                                    <th className="text-left">Item</th><th className="text-left">Unit</th><th className="text-right">On Hand</th><th className="text-right">Max</th>
                                    <th className="text-right bg-red-50">Excess Qty</th><th className="text-right bg-red-50">Excess Value</th><th className="text-right">Stock Value</th>
                                    <th className="text-right">Daily Sales</th><th className="text-right">Days Cover</th>
                                </tr></thead>
                                <tbody>
                                    {data.rows.map(r => (
                                        <tr key={r.product_id}>
                                            <td>{r.product_name} <span className="text-xs text-gray-400">{r.product_code}</span></td><td className="text-gray-500">{r.unit}</td>
                                            <td className="text-right tabular-nums">{fmtQ(r.on_hand)}</td><td className="text-right tabular-nums">{fmtQ(r.maximum_stock)}</td>
                                            <td className="text-right tabular-nums font-semibold">{fmtQ(r.excess_qty)}</td><td className="text-right tabular-nums">{fmt2(r.excess_value)}</td>
                                            <td className="text-right tabular-nums">{fmt2(r.stock_value)}</td><td className="text-right tabular-nums">{fmtQ(r.avg_daily_sales)}</td><td className="text-right">{r.days_cover ?? ''}</td>
                                        </tr>
                                    ))}
                                    {data.rows.length === 0 && <tr><td colSpan={9} className="text-center text-gray-400 py-4">Nothing over-stocked.</td></tr>}
                                </tbody>
                                {data.rows.length > 0 && <tfoot><tr className="font-bold bg-blue-50"><td colSpan={5} className="text-right">Total</td><td className="text-right tabular-nums">{fmt2(data.totals.excess_value)}</td><td colSpan={3} /></tr></tfoot>}
                            </table>
                        )}
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
