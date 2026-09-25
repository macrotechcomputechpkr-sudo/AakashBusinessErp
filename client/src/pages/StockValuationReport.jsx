// =============================================
// StockValuationReport.jsx
// Stock Valuation as on a date under several methods side by side (server:
// utils/stockValuation.js): Weighted Average, Moving Average, FIFO, LIFO,
// Last Purchase Rate (stock ledger), and Master Purchase Rate / MRP / Sales
// Rate on the same qty. Rows by item, item + warehouse or item + batch, with
// subtotals by group / company / class and a difference column.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtQ = n => (Number(n) ? (Math.round(Number(n) * 10000) / 10000).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '');

const METHODS = [
    { key: 'weighted_average', label: 'Weighted Average' }, { key: 'moving_average', label: 'Moving Average' }, { key: 'fifo', label: 'FIFO' },
    { key: 'lifo', label: 'LIFO (not NFRS)' }, { key: 'last_purchase', label: 'Last Purchase Rate' },
    { key: 'master_purchase', label: 'Master Purchase Rate' }, { key: 'mrp', label: 'MRP' }, { key: 'sales_rate', label: 'Sales Rate (SR1)' }
];
const CLASSES = [{ key: 'inventory', label: 'Inventory' }, { key: 'assets', label: 'Assets' }, { key: 'service', label: 'Service' }];
const SUBTOTAL_BY = [{ key: '', label: 'None' }, { key: 'group_name', label: 'Product Group' }, { key: 'company_name', label: 'Product Company' },
    { key: 'item_class_label', label: 'Item Class' }, { key: 'item_type_label', label: 'Item Type' }, { key: 'warehouse_name', label: 'Warehouse' }];
const PARAM_KEYS = ['as_on', 'group_by', 'product_group_id', 'product_company_id', 'product_category_id', 'product_id', 'warehouse_id', 'stock_status', 'search', 'display_unit_id'];

const defaultConfig = () => ({
    as_on: iso(new Date()), methods: ['weighted_average', 'fifo', 'moving_average'], group_by: 'item', item_class: [],
    product_group_id: '', product_company_id: '', product_category_id: '', product_id: '', warehouse_id: '', stock_status: '', search: '', display_unit_id: '',
    hide_zero: true, include_inactive: false, subtotal_by: 'group_name', show_rate: true, show_diff: true
});

export default function StockValuationReport() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [masters, setMasters] = useState({ groups: [], companies: [], categories: [], units: [], products: [], warehouses: [] });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const toggle = (k, v) => setConfig(c => ({ ...c, [k]: c[k].includes(v) ? c[k].filter(x => x !== v) : [...c[k], v] }));

    useEffect(() => {
        const load = async u => { try { return (await authFetch(u)).data || []; } catch { return []; } };
        Promise.all([load('/api/product-groups'), load('/api/product-companies'), load('/api/product-categories'), load('/api/product-units'),
            load('/api/products?pageSize=5000'), load('/api/warehouses')])
            .then(([groups, companies, categories, units, products, warehouses]) => setMasters({ groups, companies, categories, units, products, warehouses }));
    }, [authFetch]);

    const run = useCallback(async (cfg = config) => {
        if (!cfg.methods.length) { setError('Choose at least one valuation method'); return; }
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ methods: cfg.methods.join(','), hide_zero: cfg.hide_zero ? 'true' : 'false', include_inactive: cfg.include_inactive ? 'true' : 'false' });
            PARAM_KEYS.forEach(k => { if (cfg[k]) p.set(k, cfg[k]); });
            if (cfg.item_class.length) p.set('item_class', cfg.item_class.join(','));
            setData((await authFetch(`/api/reports/stock-valuation?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const methods = data?.methods || [];
    const first = methods[0]?.key;
    const R = config.show_rate, D = config.show_diff && methods.length > 1;
    const groups = useMemo(() => {
        if (!data) return [];
        const by = config.subtotal_by;
        if (!by) return [{ label: null, rows: data.rows }];
        const map = new Map();
        data.rows.forEach(r => { const k = r[by] || '(none)'; if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, rows]) => ({ label, rows }));
    }, [data, config.subtotal_by]);
    const sumOf = (rows, m) => rows.reduce((s, r) => s + (r.methods[m]?.value || 0), 0);
    const rowLabel = r => [r.batch_no, r.warehouse_name].filter(Boolean).join(' · ');
    const methodCells = (getValue, getRate) => methods.map((m, i) => (
        <React.Fragment key={m.key}>
            {R && <td className="text-right tabular-nums text-gray-500">{getRate ? fmt2(getRate(m.key)) : ''}</td>}
            <td className="text-right tabular-nums font-semibold">{fmt2(getValue(m.key))}</td>
            {D && i > 0 && <td className={`text-right tabular-nums text-xs ${getValue(m.key) - getValue(first) < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt2(getValue(m.key) - getValue(first))}</td>}
        </React.Fragment>
    ));

    const exportCsv = () => {
        if (!data) return;
        const head = ['Code', 'Item', data.group_by === 'item_batch' ? 'Batch' : data.group_by === 'item_warehouse' ? 'Warehouse' : null, 'Group', 'Company', 'Unit', 'Qty',
            ...methods.flatMap((m, i) => [`${m.label} Rate`, `${m.label} Value`, ...(i > 0 ? [`${m.label} - ${methods[0].label}`] : [])])].filter(x => x !== null);
        const rows = data.rows.map(r => [r.product_code || '', r.product_name, ...(data.group_by !== 'item' ? [rowLabel(r)] : []), r.group_name || '', r.company_name || '', r.unit || '', r.qty,
            ...methods.flatMap((m, i) => [r.methods[m.key]?.rate ?? '', r.methods[m.key]?.value ?? '', ...(i > 0 ? [Math.round(((r.methods[m.key]?.value || 0) - (r.methods[first]?.value || 0)) * 100) / 100] : [])])]);
        rows.push(['', 'Grand Total', ...(data.group_by !== 'item' ? [''] : []), '', '', '', '', ...methods.flatMap((m, i) => ['', data.totals[m.key], ...(i > 0 ? [Math.round((data.totals[m.key] - data.totals[first]) * 100) / 100] : [])])]);
        const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `stock_valuation_${data.as_on}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    const sel = (label, key, options, all = 'All') => (
        <div className="erp-field"><label className="erp-label">{label}</label>
            <select className="erp-select" value={config[key]} onChange={e => set(key, e.target.value)}>
                {all !== null && <option value="">{all}</option>}
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></div>
    );
    const opts = (rows, v, l) => rows.map(r => ({ value: r[v], label: typeof l === 'function' ? l(r) : r[l] }));
    const colCount = 4 + methods.reduce((s, m, i) => s + 1 + (R ? 1 : 0) + (D && i > 0 ? 1 : 0), 0);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">💰 Stock Valuation</span></div>
            <div className="erp-tab-content">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                    <div className="erp-field"><label className="erp-label">As on (end of day)</label><input type="date" className="erp-input" value={config.as_on} onChange={e => set('as_on', e.target.value)} /></div>
                    {sel('Rows by', 'group_by', [{ value: 'item', label: 'Item' }, { value: 'item_warehouse', label: 'Item + Warehouse' }, { value: 'item_batch', label: 'Item + Batch' }], null)}
                    {sel('Warehouse', 'warehouse_id', opts(masters.warehouses, 'id', 'warehouse_name'))}
                    {sel('Product Group (incl. sub)', 'product_group_id', opts(masters.groups, 'id', 'group_name'))}
                    {sel('Product Company', 'product_company_id', opts(masters.companies, 'id', 'company_name'))}
                    {sel('Product Category', 'product_category_id', opts(masters.categories, 'id', 'category_name'))}
                    {sel('Item', 'product_id', opts(masters.products.filter(p => !config.product_company_id || p.product_company_id === config.product_company_id), 'id', p => (p.product_code ? `${p.product_name} · ${p.product_code}` : p.product_name)))}
                    {sel('Stock Status', 'stock_status', [{ value: 'in_stock', label: 'In stock (> 0)' }, { value: 'zero', label: 'Zero stock' }, { value: 'negative', label: 'Negative stock' }, { value: 'below_minimum', label: 'Below minimum level' }])}
                    {sel('Show qty / rate in unit', 'display_unit_id', opts(masters.units, 'id', 'unit_name'), 'Base unit of each item')}
                    <div className="erp-field"><label className="erp-label">Search item / code</label>
                        <input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                    <div className="erp-field md:col-span-2"><label className="erp-label">Item Class</label>
                        <div className="flex gap-3 items-center h-9 text-sm">{CLASSES.map(c => <label key={c.key} className="flex items-center gap-1"><input type="checkbox" checked={config.item_class.includes(c.key)} onChange={() => toggle('item_class', c.key)} /> {c.label}</label>)}</div></div>
                </div>

                <div className="erp-field mb-2"><label className="erp-label">Valuation methods (first = base for the difference)</label>
                    <div className="flex flex-wrap gap-3 text-sm">
                        {METHODS.map(m => <label key={m.key} className="flex items-center gap-1"><input type="checkbox" checked={config.methods.includes(m.key)} onChange={() => toggle('methods', m.key)} /> {m.label}</label>)}
                    </div></div>

                <div className="flex flex-wrap gap-4 items-center text-sm mb-3">
                    <label className="flex items-center gap-2">Subtotal by
                        <select className="erp-select w-auto" value={config.subtotal_by} onChange={e => set('subtotal_by', e.target.value)}>{SUBTOTAL_BY.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={config.show_rate} onChange={e => set('show_rate', e.target.checked)} /> Show rates</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={config.show_diff} onChange={e => set('show_diff', e.target.checked)} /> Show difference</label>
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
                {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.slice(0, 10).join(' · ')}{data.warnings.length > 10 ? ` (+${data.warnings.length - 10} more)` : ''}</p>}

                {data && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table w-full text-sm">
                            <thead>
                                <tr>
                                    <th rowSpan={2} className="text-left">Code</th><th rowSpan={2} className="text-left">Item</th>
                                    <th rowSpan={2} className="text-left">Unit</th><th rowSpan={2} className="text-right">Qty</th>
                                    {methods.map((m, i) => <th key={m.key} colSpan={1 + (R ? 1 : 0) + (D && i > 0 ? 1 : 0)} className={`text-center ${m.ledger ? 'bg-green-50' : 'bg-yellow-50'}`}>{m.label}</th>)}
                                </tr>
                                <tr>
                                    {methods.map((m, i) => (
                                        <React.Fragment key={m.key}>
                                            {R && <th className="text-right">Rate</th>}<th className="text-right">Value</th>{D && i > 0 && <th className="text-right text-xs">± vs {methods[0].label}</th>}
                                        </React.Fragment>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map(g => (
                                    <React.Fragment key={g.label || 'all'}>
                                        {g.label !== null && <tr className="bg-gray-100"><td colSpan={colCount} className="font-semibold">{g.label}</td></tr>}
                                        {g.rows.map(r => (
                                            <tr key={r.key}>
                                                <td className="text-gray-500">{r.product_code}</td>
                                                <td>{r.product_name}{rowLabel(r) && <span className="text-xs text-gray-500"> · {rowLabel(r)}</span>}</td>
                                                <td className="text-gray-500">{r.unit}</td>
                                                <td className={`text-right tabular-nums ${r.qty < 0 ? 'text-red-600' : ''}`}>{fmtQ(r.qty)}</td>
                                                {methodCells(m => r.methods[m]?.value || 0, m => r.methods[m]?.rate)}
                                            </tr>
                                        ))}
                                        {g.label !== null && (
                                            <tr className="bg-gray-50 font-semibold border-b-2">
                                                <td colSpan={4} className="text-right">Total - {g.label}</td>
                                                {methodCells(m => sumOf(g.rows, m), null)}
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                                {data.rows.length === 0 && <tr><td colSpan={colCount} className="text-center text-gray-400 py-4">No stock for these filters.</td></tr>}
                            </tbody>
                            {data.rows.length > 0 && (
                                <tfoot><tr className="bg-blue-50 font-bold"><td colSpan={4} className="text-right">Grand Total</td>{methodCells(m => data.totals[m] || 0, null)}</tr></tfoot>
                            )}
                        </table>
                        <p className="text-xs text-gray-500 mt-2">Green = valued from the stock ledger (same engine as the financial statements) · Yellow = the same qty at the item master's rate.</p>
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
