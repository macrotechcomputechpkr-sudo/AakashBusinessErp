// =============================================
// StockAgeingReport.jsx
// Two stock reports (server: utils/stockHealth.js):
//   Stock Ageing - stock on hand as on a date split by how long it has been
//     in (FIFO receipt layers), qty and value per bucket, average and
//     oldest age; by item, item + warehouse or item + batch
//   Near Expiry / Expired - batches on hand with their expiry date:
//     expired, expiring within N days, or all; optionally per warehouse
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtQ = n => (Number(n) ? (Math.round(Number(n) * 10000) / 10000).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '');
const STATE = { expired: ['Expired', 'text-red-700 bg-red-50'], near: ['Near expiry', 'text-amber-700 bg-amber-50'], ok: ['OK', 'text-green-700'], no_expiry: ['No expiry date', 'text-gray-500'] };

const defaultConfig = () => ({
    as_on: iso(new Date()), group_by: 'item', buckets: '30,60,90,180,365', warehouse_id: '', product_group_id: '', product_company_id: '', product_id: '', search: '',
    min_age_days: '', sort_by: 'name', show_qty: true, show_value: true, hide_zero: true, include_inactive: false, display_unit_id: '',
    within_days: '90', status: 'near_and_expired', by_warehouse: false
});

export default function StockAgeingReport() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState('ageing');
    const [config, setConfig] = useState(defaultConfig());
    const [masters, setMasters] = useState({ groups: [], companies: [], units: [], products: [], warehouses: [] });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    useEffect(() => {
        const load = async u => { try { return (await authFetch(u)).data || []; } catch { return []; } };
        Promise.all([load('/api/product-groups'), load('/api/product-companies'), load('/api/product-units'), load('/api/products?pageSize=5000'), load('/api/warehouses')])
            .then(([groups, companies, units, products, warehouses]) => setMasters({ groups, companies, units, products, warehouses }));
    }, [authFetch]);

    const run = useCallback(async (cfg = config, which = tab) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ as_on: cfg.as_on, hide_zero: String(cfg.hide_zero), include_inactive: String(cfg.include_inactive) });
            ['product_group_id', 'product_company_id', 'product_id', 'search', 'display_unit_id'].forEach(k => { if (cfg[k]) p.set(k, cfg[k]); });
            if (which === 'ageing') {
                p.set('group_by', cfg.group_by); p.set('buckets', cfg.buckets); p.set('sort_by', cfg.sort_by);
                if (cfg.warehouse_id) p.set('warehouse_id', cfg.warehouse_id);
                if (cfg.min_age_days) p.set('min_age_days', cfg.min_age_days);
                setData({ tab: which, ...(await authFetch(`/api/reports/stock-ageing?${p}`)).data });
            } else {
                p.set('within_days', cfg.within_days || '0'); p.set('status', cfg.status); p.set('by_warehouse', String(cfg.by_warehouse));
                if (cfg.warehouse_id) p.set('warehouse_ids', cfg.warehouse_id);
                setData({ tab: which, ...(await authFetch(`/api/reports/stock-expiry?${p}`)).data });
            }
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config, tab]);

    const switchTab = k => { setTab(k); setData(null); };
    const sel = (label, key, options, all = 'All') => (
        <div className="erp-field"><label className="erp-label">{label}</label>
            <select className="erp-select" value={config[key]} onChange={e => set(key, e.target.value)}>
                {all !== null && <option value="">{all}</option>}
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></div>
    );
    const opts = (rows, v, l) => rows.map(r => ({ value: r[v], label: typeof l === 'function' ? l(r) : r[l] }));
    const rowLabel = r => [r.batch_no, r.warehouse_name].filter(Boolean).join(' · ');

    const exportCsv = () => {
        if (!data) return;
        let head, rows;
        if (data.tab === 'ageing') {
            head = ['Code', 'Item', 'Batch / Warehouse', 'Unit', 'Qty', 'Value', 'Avg Age (days)', 'Oldest Date', ...data.buckets.flatMap(b => [`${b.label} Qty`, `${b.label} Value`])];
            rows = data.rows.map(r => [r.product_code, r.product_name, rowLabel(r), r.unit, r.qty, r.value, r.avg_age_days ?? '', r.oldest_date || '', ...data.buckets.flatMap(b => [r.buckets[b.key].qty, r.buckets[b.key].value])]);
        } else {
            head = ['Code', 'Item', 'Batch', 'Warehouse', 'Mfg Date', 'Expiry', 'Days Left', 'Status', 'Unit', 'Qty', 'Rate', 'Value'];
            rows = data.rows.map(r => [r.product_code, r.product_name, r.batch_no, r.warehouse_name || '', r.mfg_date || '', r.exp_date || '', r.days_left ?? '', STATE[r.state][0], r.unit, r.qty, r.rate, r.value]);
        }
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${data.tab === 'ageing' ? 'stock_ageing' : 'stock_expiry'}_${data.as_on}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">⌛ Stock Ageing & Expiry</span></div>
            <div className="erp-tab-content">
                <div className="print:hidden">
                    <div className="flex gap-1 mb-3 border-b">
                        {[['ageing', '⌛ Stock Ageing'], ['expiry', '☠ Near Expiry / Expired']].map(([k, l]) => (
                            <button key={k} className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => switchTab(k)}>{l}</button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        <div className="erp-field"><label className="erp-label">As on</label><input type="date" className="erp-input" value={config.as_on} onChange={e => set('as_on', e.target.value)} /></div>
                        {tab === 'ageing' ? (<>
                            {sel('Rows by', 'group_by', [{ value: 'item', label: 'Item' }, { value: 'item_warehouse', label: 'Item + Warehouse' }, { value: 'item_batch', label: 'Item + Batch' }], null)}
                            <div className="erp-field"><label className="erp-label">Buckets (days)</label><input className="erp-input" value={config.buckets} onChange={e => set('buckets', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">Oldest at least (days)</label><input type="number" className="erp-input" value={config.min_age_days} onChange={e => set('min_age_days', e.target.value)} /></div>
                            {sel('Sort by', 'sort_by', [{ value: 'name', label: 'Name' }, { value: 'oldest', label: 'Oldest first' }, { value: 'value', label: 'Value (high first)' }], null)}
                        </>) : (<>
                            {sel('Show', 'status', [{ value: 'near_and_expired', label: 'Expired + near expiry' }, { value: 'expired', label: 'Expired only' }, { value: 'near', label: 'Near expiry only' }, { value: 'all', label: 'All batches' }], null)}
                            <div className="erp-field"><label className="erp-label">Near = expiring within (days)</label><input type="number" className="erp-input" value={config.within_days} onChange={e => set('within_days', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">Warehouse-wise</label>
                                <label className="flex items-center gap-2 h-9 text-sm"><input type="checkbox" checked={config.by_warehouse} onChange={e => set('by_warehouse', e.target.checked)} /> Show per warehouse</label></div>
                        </>)}
                        {sel('Warehouse', 'warehouse_id', opts(masters.warehouses, 'id', 'warehouse_name'))}
                        {sel('Product Group (+ sub)', 'product_group_id', opts(masters.groups, 'id', 'group_name'))}
                        {sel('Product Company', 'product_company_id', opts(masters.companies, 'id', 'company_name'))}
                        {sel('Item', 'product_id', opts(masters.products.filter(p => !config.product_company_id || p.product_company_id === config.product_company_id), 'id', p => (p.product_code ? `${p.product_name} · ${p.product_code}` : p.product_name)))}
                        {sel('Show qty in unit', 'display_unit_id', opts(masters.units, 'id', 'unit_name'), 'Base unit of each item')}
                        <div className="erp-field"><label className="erp-label">Search item / code</label>
                            <input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                    </div>
                    <div className="flex flex-wrap gap-4 items-center text-sm mb-3">
                        {tab === 'ageing' && <label className="flex items-center gap-2"><input type="checkbox" checked={config.show_qty} onChange={e => set('show_qty', e.target.checked)} /> Bucket qty</label>}
                        {tab === 'ageing' && <label className="flex items-center gap-2"><input type="checkbox" checked={config.show_value} onChange={e => set('show_value', e.target.checked)} /> Bucket value</label>}
                        <label className="flex items-center gap-2"><input type="checkbox" checked={config.hide_zero} onChange={e => set('hide_zero', e.target.checked)} /> Hide zero stock</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={config.include_inactive} onChange={e => set('include_inactive', e.target.checked)} /> Include inactive items</label>
                    </div>
                    <div className="flex gap-2 mb-3">
                        <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                        {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                        {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                        <button className="erp-btn" onClick={() => { setConfig(defaultConfig()); setData(null); }}>↺ Reset</button>
                    </div>
                    {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                    {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}
                </div>

                {data?.tab === 'ageing' && (
                    <div className="overflow-x-auto text-sm">
                        <p className="text-xs text-gray-600 mb-1">Stock Ageing as on {data.as_on} · FIFO receipt layers · value at each layer's cost</p>
                        <table className="erp-grid-table w-full">
                            <thead>
                                <tr>
                                    <th rowSpan={2} className="text-left">Code</th><th rowSpan={2} className="text-left">Item</th><th rowSpan={2} className="text-left">Unit</th>
                                    <th rowSpan={2} className="text-right">Qty</th><th rowSpan={2} className="text-right">Value</th><th rowSpan={2} className="text-right">Avg Age</th><th rowSpan={2} className="text-left">Oldest</th>
                                    {data.buckets.map(b => <th key={b.key} colSpan={(config.show_qty ? 1 : 0) + (config.show_value ? 1 : 0)} className="text-center bg-amber-50">{b.label} days</th>)}
                                </tr>
                                <tr>{data.buckets.map(b => <React.Fragment key={b.key}>{config.show_qty && <th className="text-right">Qty</th>}{config.show_value && <th className="text-right">Value</th>}</React.Fragment>)}</tr>
                            </thead>
                            <tbody>
                                {data.rows.map(r => (
                                    <tr key={r.key}>
                                        <td className="text-gray-500">{r.product_code}</td><td>{r.product_name}{rowLabel(r) && <span className="text-xs text-gray-500"> · {rowLabel(r)}</span>}</td><td className="text-gray-500">{r.unit}</td>
                                        <td className="text-right tabular-nums">{fmtQ(r.qty)}</td><td className="text-right tabular-nums font-semibold">{fmt2(r.value)}</td>
                                        <td className="text-right">{r.avg_age_days ?? ''}</td><td>{r.oldest_date === '0000-01-01' ? 'Opening' : r.oldest_date || ''}</td>
                                        {data.buckets.map(b => <React.Fragment key={b.key}>{config.show_qty && <td className="text-right tabular-nums">{fmtQ(r.buckets[b.key].qty)}</td>}{config.show_value && <td className="text-right tabular-nums">{fmt2(r.buckets[b.key].value)}</td>}</React.Fragment>)}
                                    </tr>
                                ))}
                                {data.rows.length === 0 && <tr><td colSpan={7 + data.buckets.length * 2} className="text-center text-gray-400 py-4">No stock.</td></tr>}
                            </tbody>
                            {data.rows.length > 0 && (
                                <tfoot><tr className="font-bold bg-blue-50">
                                    <td colSpan={4} className="text-right">Total</td><td className="text-right tabular-nums">{fmt2(data.totals.value)}</td><td /><td />
                                    {data.buckets.map(b => <React.Fragment key={b.key}>{config.show_qty && <td />}{config.show_value && <td className="text-right tabular-nums">{fmt2(data.totals.buckets[b.key])}</td>}</React.Fragment>)}
                                </tr></tfoot>
                            )}
                        </table>
                    </div>
                )}

                {data?.tab === 'expiry' && (
                    <div className="overflow-x-auto text-sm">
                        <p className="text-xs text-gray-600 mb-1">As on {data.as_on} · near = within {data.within_days} days · Expired {fmt2(data.totals.expired)} · Near expiry {fmt2(data.totals.near)}</p>
                        <table className="erp-grid-table w-full">
                            <thead><tr>
                                <th className="text-left">Code</th><th className="text-left">Item</th><th className="text-left">Batch</th>{data.by_warehouse && <th className="text-left">Warehouse</th>}
                                <th className="text-left">Mfg</th><th className="text-left">Expiry</th><th className="text-right">Days Left</th><th className="text-left">Status</th>
                                <th className="text-left">Unit</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Value</th>
                            </tr></thead>
                            <tbody>
                                {data.rows.map(r => (
                                    <tr key={r.key} className={STATE[r.state][1]}>
                                        <td>{r.product_code}</td><td>{r.product_name}</td><td>{r.batch_no}</td>{data.by_warehouse && <td>{r.warehouse_name}</td>}
                                        <td>{r.mfg_date || ''}</td><td>{r.exp_date || ''}</td><td className="text-right">{r.days_left ?? ''}</td><td>{STATE[r.state][0]}</td>
                                        <td>{r.unit}</td><td className="text-right tabular-nums">{fmtQ(r.qty)}</td><td className="text-right tabular-nums">{fmt2(r.rate)}</td><td className="text-right tabular-nums font-semibold">{fmt2(r.value)}</td>
                                    </tr>
                                ))}
                                {data.rows.length === 0 && <tr><td colSpan={12} className="text-center text-gray-400 py-4">No batches for these filters.</td></tr>}
                            </tbody>
                            {data.rows.length > 0 && <tfoot><tr className="font-bold bg-blue-50"><td colSpan={data.by_warehouse ? 11 : 10} className="text-right">Total</td><td className="text-right tabular-nums">{fmt2(data.totals.value)}</td></tr></tfoot>}
                        </table>
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
