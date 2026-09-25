// =============================================
// StockInOutReport.jsx
// Stock In / Out - quantity only: Opening | Receipt | Issue | Balance,
// branch-wise, warehouse-wise or product-wise (server: utils/stockInOut.js).
// Transfers inside a branch / warehouse net off; goods dispatched on a
// two-step branch transfer and not yet received show as "Goods in
// Transit", product opening stock with no warehouse as its own row.
// Filters: branch, warehouse, product group (with sub-groups), company,
// item, search, stock status on the balance qty, qty in any unit.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const iso = d => d.toISOString().slice(0, 10);
const q4 = n => { const v = Number(n || 0); return Math.abs(v) < 1e-9 ? '' : (Math.round(v * 10000) / 10000).toLocaleString('en-IN', { maximumFractionDigits: 4 }); };

const VIEWS = [{ key: 'branch', label: '🏢 Branch-wise' }, { key: 'warehouse', label: '🏬 Warehouse-wise' }, { key: 'product', label: '📦 Product-wise' }];
const STATUSES = [
    { value: 'in_stock', label: 'In stock (balance > 0)' }, { value: 'zero', label: 'Zero stock' },
    { value: 'negative', label: 'Negative stock' }, { value: 'below_minimum', label: 'Below minimum level' }
];
const PARAM_KEYS = ['view', 'date_from', 'date_to', 'branch_id', 'warehouse_id', 'product_group_id', 'product_company_id', 'product_id', 'search', 'stock_status', 'display_unit_id'];
const defaultConfig = () => ({
    view: 'branch', date_from: `${new Date().getFullYear()}-01-01`, date_to: iso(new Date()),
    branch_id: '', warehouse_id: '', product_group_id: '', product_company_id: '', product_id: '', search: '', stock_status: '', display_unit_id: '',
    hide_zero: true, include_inactive: false
});
const KIND_STYLE = { transit: 'text-orange-700', opening: 'text-gray-500' };

export default function StockInOutReport() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [masters, setMasters] = useState({ branches: [], warehouses: [], maps: [], groups: [], companies: [], units: [], products: [] });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    useEffect(() => {
        const load = async u => { try { return (await authFetch(u)).data || []; } catch { return []; } };
        Promise.all([load('/api/branches'), load('/api/warehouses'), load('/api/branch-warehouse-mapping'), load('/api/product-groups'),
            load('/api/product-companies'), load('/api/product-units'), load('/api/products?pageSize=5000')])
            .then(([branches, warehouses, maps, groups, companies, units, products]) => setMasters({ branches, warehouses, maps, groups, companies, units, products }));
    }, [authFetch]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams();
            PARAM_KEYS.forEach(k => { if (cfg[k]) p.set(k, cfg[k]); });
            p.set('hide_zero', cfg.hide_zero ? 'true' : 'false');
            p.set('include_inactive', cfg.include_inactive ? 'true' : 'false');
            setData((await authFetch(`/api/stock/in-out?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const switchView = v => { const next = { ...config, view: v }; setConfig(next); if (data) run(next); };

    // Warehouse picker narrowed to the chosen branch.
    const warehouseOptions = useMemo(() => {
        if (!config.branch_id) return masters.warehouses;
        const ids = masters.maps.filter(m => m.branch_id === config.branch_id).map(m => m.warehouse_id);
        return masters.warehouses.filter(w => ids.includes(w.id));
    }, [masters, config.branch_id]);
    const itemOptions = useMemo(() => masters.products.filter(p => !config.product_company_id || p.product_company_id === config.product_company_id),
        [masters.products, config.product_company_id]);

    const view = data?.view || config.view;
    const locLabel = view === 'warehouse' ? 'Warehouse' : 'Branch';

    const exportCsv = () => {
        if (!data) return;
        const head = [...(view === 'product' ? [] : [locLabel]), 'Code', 'Item', 'Group', 'Company', 'Unit', 'Opening', 'Receipt', 'Issue', 'Balance'];
        const line = r => [...(view === 'product' ? [] : [r.location_name]), r.product_code || '', r.product_name, r.group_name || '', r.company_name || '', r.unit || '', r.opening, r.receipt, r.issue, r.balance];
        const rows = view === 'product' ? data.rows.map(line) : data.groups.flatMap(g => [...g.rows.map(line),
            [`Total - ${g.location_name}`, '', '', '', '', '', g.totals.opening, g.totals.receipt, g.totals.issue, g.totals.balance]]);
        if (data.totals) rows.push([...(view === 'product' ? [] : ['Grand Total']), ...(view === 'product' ? ['Grand Total'] : ['']), '', '', '', '', data.totals.opening, data.totals.receipt, data.totals.issue, data.totals.balance]);
        const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `stock_in_out_${view}_${config.date_from}_${config.date_to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    const sel = (label, key, options, all = 'All') => (
        <div className="erp-field"><label className="erp-label">{label}</label>
            <select className="erp-select" value={config[key]} onChange={e => set(key, e.target.value)}>
                {all !== null && <option value="">{all}</option>}
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></div>
    );
    const opts = (rows, v, l) => rows.map(r => ({ value: r[v], label: typeof l === 'function' ? l(r) : r[l] }));

    const qtyCells = r => ['opening', 'receipt', 'issue', 'balance'].map(k => (
        <td key={k} className={`text-right tabular-nums ${k === 'balance' ? 'font-semibold' : ''} ${k === 'balance' && r[k] < 0 ? 'text-red-600' : ''}`}>{q4(r[k])}</td>
    ));
    const itemCells = r => (<>
        <td className="text-gray-500">{r.product_code}</td>
        <td>{r.product_name}{r.minimum_stock > 0 && r.balance < r.minimum_stock && <span className="ml-1 text-[10px] text-amber-700">▼ min</span>}</td>
        <td className="text-gray-500">{r.unit}</td>
    </>);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">🔁 Stock In / Out (Qty)</span></div>
            <div className="erp-tab-content">
                <div className="flex gap-1 mb-3 border-b">
                    {VIEWS.map(v => <button key={v.key} className={`px-4 py-2 text-sm ${config.view === v.key ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => switchView(v.key)}>{v.label}</button>)}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                    <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">Branch</label>
                        <select className="erp-select" value={config.branch_id} onChange={e => setConfig(c => ({ ...c, branch_id: e.target.value, warehouse_id: '' }))}>
                            <option value="">All</option>
                            {masters.branches.map(b => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
                        </select></div>
                    {sel('Warehouse', 'warehouse_id', opts(warehouseOptions, 'id', 'warehouse_name'))}
                    {sel('Stock Status (balance qty)', 'stock_status', STATUSES)}
                    {sel('Show qty in unit', 'display_unit_id', opts(masters.units, 'id', 'unit_name'), 'Base unit of each item')}
                    {sel('Product Group (incl. sub-groups)', 'product_group_id', opts(masters.groups, 'id', 'group_name'))}
                    {sel('Product Company', 'product_company_id', opts(masters.companies, 'id', 'company_name'))}
                    {sel('Item', 'product_id', opts(itemOptions, 'id', p => p.product_code ? `${p.product_name} · ${p.product_code}` : p.product_name))}
                    <div className="erp-field md:col-span-2"><label className="erp-label">Search item / code</label>
                        <input className="erp-input" value={config.search} placeholder="type and press Enter" onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                </div>

                <div className="flex flex-wrap gap-4 items-center text-sm mb-3">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={config.hide_zero} onChange={e => set('hide_zero', e.target.checked)} /> Hide items with no stock or movement</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={config.include_inactive} onChange={e => set('include_inactive', e.target.checked)} /> Include inactive items</label>
                </div>

                <div className="flex gap-2 mb-3">
                    <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                    {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                    {data && <button className="erp-btn" onClick={() => { setConfig(defaultConfig()); setData(null); }}>↺ Reset</button>}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}
                {data?.mixed_units && <p className="text-xs text-gray-500 mb-2">Items have different units, so qty totals are not added up - choose "Show qty in unit" to total them.</p>}

                {data && (
                    <div className="overflow-x-auto">
                        <p className="text-xs text-gray-500 mb-1">{data.from} to {data.to} · Opening + Receipt − Issue = Balance</p>
                        <table className="erp-grid-table w-full text-sm">
                            <thead>
                                <tr>
                                    {view !== 'product' && <th className="text-left">{locLabel}</th>}
                                    <th className="text-left">Code</th><th className="text-left">Item</th><th className="text-left">Unit</th>
                                    <th className="text-right">Opening</th><th className="text-right bg-green-50">Receipt</th><th className="text-right bg-red-50">Issue</th><th className="text-right">Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {view === 'product' && data.rows.map(r => <tr key={r.product_id}>{itemCells(r)}{qtyCells(r)}</tr>)}
                                {view !== 'product' && data.groups.map(g => (
                                    <React.Fragment key={g.location_id || g.location_name}>
                                        {g.rows.map((r, i) => (
                                            <tr key={r.product_id}>
                                                <td className={`${KIND_STYLE[g.location_kind] || ''} ${i === 0 ? 'font-semibold' : 'text-transparent select-none'}`}>{g.location_name}</td>
                                                {itemCells(r)}{qtyCells(r)}
                                            </tr>
                                        ))}
                                        {(!data.mixed_units || g.rows.length === 1) && (
                                            <tr className="bg-gray-50 font-semibold border-b-2">
                                                <td colSpan={4} className="text-right">Total - {g.location_name}</td>{qtyCells(g.totals)}
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                                {data.rows.length === 0 && <tr><td colSpan={8} className="text-center text-gray-400 py-4">No stock for these filters.</td></tr>}
                            </tbody>
                            {data.totals && data.rows.length > 0 && (
                                <tfoot>
                                    <tr className="bg-blue-50 font-bold"><td colSpan={view === 'product' ? 3 : 4} className="text-right">Grand Total</td>{qtyCells(data.totals)}</tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
