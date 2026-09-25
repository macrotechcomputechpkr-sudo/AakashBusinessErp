// =============================================
// StockReport.jsx
// Stock Report in three views over the same stock ledger (server:
// utils/stockReport.js), valued by the same engine as Stock Movement and
// the financial statements:
//   Summary    - per item / item + batch / item + warehouse: Opening | In |
//                Out | Closing, with subtotals by class, group, company ...
//   Detail     - every stock line: date, document, party, warehouse, batch,
//                expiry, serial no, in / out qty, rate, amount, balance
//   Party-wise - per party + item: purchase / sales (and returns) qty,
//                amount and average rate
//   Opening    - opening stock only: Product Opening Entry (batches, serial
//                nos) or stock on hand at the start of a date
// Filters: item class (Inventory / Assets / Service), item type, product
// group, company, category, base unit, item, search, tracking, warehouse,
// batch, serial, party, module, stock status; qty in any unit.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import SavedViewsBar from '../components/SavedViewsBar';

const iso = d => d.toISOString().slice(0, 10);
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q4 = n => { const v = Number(n || 0); return Math.abs(v) < 1e-9 ? '' : String(Math.round(v * 10000) / 10000); };
const amt = n => (Number(n) ? fmt(n) : '');

const MODES = [{ key: 'summary', label: '📊 Summary' }, { key: 'detail', label: '📄 Detail' }, { key: 'party', label: '👥 Party-wise' }, { key: 'opening', label: '🟢 Opening' }];
const CLASSES = [{ key: 'inventory', label: 'Inventory' }, { key: 'assets', label: 'Assets' }, { key: 'service', label: 'Service' }];
const ITEM_TYPES = [
    { key: 'raw_material', label: 'Raw Material', cls: 'inventory' }, { key: 'semi_finished', label: 'Semi-Finished', cls: 'inventory' },
    { key: 'finished_good', label: 'Finished Good', cls: 'inventory' }, { key: 'trading_item', label: 'Trading Item', cls: 'inventory' },
    { key: 'fixed_asset', label: 'Fixed Asset', cls: 'assets' }, { key: 'service', label: 'Service', cls: 'service' }, { key: 'non_inventory', label: 'Non-Inventory', cls: 'service' }
];
const MODULES = [{ key: 'purchase', label: 'Purchase' }, { key: 'purchase_return', label: 'Purchase Return' }, { key: 'sales', label: 'Sales' },
    { key: 'sales_return', label: 'Sales Return' }, { key: 'production', label: 'Production' }, { key: 'stock_transfer', label: 'Stock Transfer' }];
const METHOD_LABELS = { weighted_average: 'Weighted Average (periodic)', moving_average: 'Moving Average (perpetual)', fifo: 'FIFO', lifo: 'LIFO (not NFRS - comparison)', last_purchase: 'Last Purchase Rate' };
// Optional item-attribute columns (Summary / Party-wise).
const ATTR_COLS = [
    { key: 'product_code', label: 'Code' }, { key: 'item_class_label', label: 'Class' }, { key: 'item_type_label', label: 'Item Type' },
    { key: 'group_name', label: 'Group' }, { key: 'company_name', label: 'Company' }, { key: 'categories', label: 'Category' },
    { key: 'unit', label: 'Unit' }, { key: 'hs_code', label: 'HS Code' }
];
const SUBTOTAL_BY = [{ key: '', label: 'None' }, { key: 'item_class_label', label: 'Item Class' }, { key: 'item_type_label', label: 'Item Type' },
    { key: 'group_name', label: 'Product Group' }, { key: 'company_name', label: 'Product Company' }, { key: 'categories', label: 'Category' }];

const PARAM_KEYS = ['mode', 'opening_basis', 'date_from', 'date_to', 'stock_method', 'group_by', 'item_type', 'product_group_id', 'product_company_id', 'product_category_id',
    'unit_id', 'display_unit_id', 'product_id', 'search', 'tracking', 'warehouse_id', 'batch_no', 'serial_no', 'party_key', 'stock_status'];
const defaultConfig = () => ({
    mode: 'summary', opening_basis: 'entry', date_from:`${new Date().getFullYear()}-01-01`, date_to: iso(new Date()), stock_method: 'weighted_average', group_by: 'item',
    item_class: [], item_type: '', product_group_id: '', product_company_id: '', product_category_id: '', unit_id: '', display_unit_id: '', product_id: '',
    search: '', tracking: '', warehouse_id: '', batch_no: '', serial_no: '', party_key: '', modules: [], stock_status: '',
    include_inactive: false, hide_zero: true, show_value: true, subtotal_by: '', columns: ['product_code', 'group_name', 'unit']
});

export default function StockReport() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [masters, setMasters] = useState({ groups: [], companies: [], categories: [], units: [], products: [], warehouses: [], parties: [] });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showMore, setShowMore] = useState(true);
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const toggle = (k, v) => setConfig(c => ({ ...c, [k]: c[k].includes(v) ? c[k].filter(x => x !== v) : [...c[k], v] }));

    useEffect(() => {
        const load = async u => { try { return (await authFetch(u)).data || []; } catch { return []; } };
        Promise.all([load('/api/product-groups'), load('/api/product-companies'), load('/api/product-categories'), load('/api/product-units'),
            load('/api/products?pageSize=5000'), load('/api/warehouses'), authFetch('/api/stock/report/meta').then(r => r.data).catch(() => ({}))])
            .then(([groups, companies, categories, units, products, warehouses, meta]) =>
                setMasters({ groups, companies, categories, units, products, warehouses, parties: meta?.parties || [] }));
    }, [authFetch]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams();
            PARAM_KEYS.forEach(k => { if (cfg[k]) p.set(k, cfg[k]); });
            if (cfg.mode === 'opening') p.set('date_to', cfg.date_from);      // opening needs one date only
            if (cfg.item_class.length) p.set('item_class', cfg.item_class.join(','));
            if (cfg.modules.length) p.set('modules', cfg.modules.join(','));
            p.set('hide_zero', cfg.hide_zero ? 'true' : 'false');
            p.set('include_inactive', cfg.include_inactive ? 'true' : 'false');
            setData((await authFetch(`/api/stock/report?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const switchMode = m => { const next = { ...config, mode: m }; setConfig(next); if (data) run(next); else setData(null); };

    // Item picker narrowed by the item filters already chosen.
    const itemOptions = useMemo(() => masters.products.filter(p =>
        (!config.item_class.length || config.item_class.includes(ITEM_TYPES.find(t => t.key === p.item_type)?.cls)) &&
        (!config.item_type || p.item_type === config.item_type) &&
        (!config.product_company_id || p.product_company_id === config.product_company_id) &&
        (!config.unit_id || p.base_unit_id === config.unit_id) &&
        (!config.product_category_id || (p.product_category_ids || []).includes(config.product_category_id))), [masters.products, config]);
    const typeOptions = ITEM_TYPES.filter(t => !config.item_class.length || config.item_class.includes(t.cls));

    const mode = data?.mode || config.mode;
    const V = config.show_value;
    const attrCols = ATTR_COLS.filter(c => config.columns.includes(c.key));
    const rowLabel = r => [r.batch_no, r.warehouse_name].filter(Boolean).join(' · ');

    // ---------------- export ----------------
    const exportCsv = () => {
        if (!data) return;
        let head, rows;
        if (mode === 'summary') {
            head = ['Item', ...attrCols.map(c => c.label), data.group_by === 'item_batch' ? 'Batch' : data.group_by === 'item_warehouse' ? 'Warehouse' : null, data.group_by === 'item_batch' ? 'Expiry' : null,
                'Opening Qty', 'Opening Amount', ...data.modules_in.flatMap(m => [`IN ${m.label} Qty`, `IN ${m.label} Amount`]), 'Total In Qty', 'Total In Amount',
                ...data.modules_out.flatMap(m => [`OUT ${m.label} Qty`, `OUT ${m.label} Amount`]), 'Total Out Qty', 'Total Out Amount', 'Closing Qty', 'Closing Rate', 'Closing Amount'].filter(x => x !== null);
            const cell = (o, k) => o[k] ? [o[k].qty, o[k].value] : [0, 0];
            rows = data.rows.map(r => [r.product_name, ...attrCols.map(c => r[c.key] || ''), ...(data.group_by === 'item_batch' ? [r.batch_no, r.exp_date || ''] : data.group_by === 'item_warehouse' ? [r.warehouse_name] : []),
                r.opening_qty, r.opening_value, ...data.modules_in.flatMap(m => cell(r.in, m.key)), r.in_qty, r.in_value,
                ...data.modules_out.flatMap(m => cell(r.out, m.key)), r.out_qty, r.out_value, r.closing_qty, r.closing_rate, r.closing_value]);
        } else if (mode === 'detail') {
            head = ['Item', 'Code', 'Unit', 'Date', 'Module', 'Doc No', 'Party', 'Warehouse', 'Batch', 'Expiry', 'Serial No', 'In Qty', 'Out Qty', 'Rate', 'Amount', 'Balance Qty', 'Narration'];
            rows = data.items.flatMap(i => [
                [i.product_name, i.product_code, i.unit, '', 'Opening', '', '', i.warehouse_name || '', i.batch_no || '', '', '', '', '', '', i.opening_value, i.opening_qty, ''],
                ...i.lines.map(l => [i.product_name, i.product_code, i.unit, l.date, l.module_label, l.doc_no, l.party_name, l.warehouse_name, l.batch_no, l.exp_date || '', l.serial_no, l.in_qty, l.out_qty, l.rate, l.amount, l.balance_qty ?? '', l.narration]),
                [i.product_name, i.product_code, i.unit, '', 'Closing', '', '', '', '', '', '', i.in_qty, i.out_qty, i.closing_rate, i.closing_value, i.closing_qty, '']
            ]);
        } else if (mode === 'opening') {
            head = ['Item', ...attrCols.map(c => c.label), 'Batch', 'Mfg Date', 'Expiry', 'Warehouse', 'Qty', 'Unit', 'Rate', 'Amount', 'Serial Nos'];
            rows = data.rows.map(r => [r.product_name, ...attrCols.map(c => r[c.key] || ''), r.batch_no || '', r.mfg_date || '', r.exp_date || '', r.warehouse_name || '',
                r.qty, r.unit, r.rate, r.value, r.serial_nos.map(s => s.serial_no).join(' ')]);
        } else {
            head = ['Party', 'Item', ...attrCols.map(c => c.label), 'Purchase Qty', 'Purchase Amount', 'Avg Purchase Rate', 'Purchase Return Qty', 'Purchase Return Amount',
                'Sales Qty', 'Sales Amount', 'Avg Sales Rate', 'Sales Return Qty', 'Sales Return Amount', 'Net Qty', 'Documents'];
            rows = data.rows.map(r => [r.party_name, r.product_name, ...attrCols.map(c => r[c.key] || ''), r.purchase_qty, r.purchase_amount, r.purchase_rate,
                r.purchase_return_qty, r.purchase_return_amount, r.sales_qty, r.sales_amount, r.sales_rate, r.sales_return_qty, r.sales_return_amount, r.net_qty, r.doc_count]);
        }
        const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `stock_report_${mode}_${config.date_from}_${config.date_to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    // ---------------- filters ----------------
    const sel = (label, key, options, all = 'All') => (
        <div className="erp-field"><label className="erp-label">{label}</label>
            <select className="erp-select" value={config[key]} onChange={e => set(key, e.target.value)}>
                {all !== null && <option value="">{all}</option>}
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></div>
    );
    const txt = (label, key, placeholder) => (
        <div className="erp-field"><label className="erp-label">{label}</label>
            <input className="erp-input" value={config[key]} placeholder={placeholder} onChange={e => set(key, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
    );
    const opts = (rows, v, l) => rows.map(r => ({ value: r[v], label: typeof l === 'function' ? l(r) : r[l] }));
    const lineMode = config.mode === 'detail' || config.mode === 'party';
    const isOpening = config.mode === 'opening';
    const openingEntry = isOpening && config.opening_basis === 'entry';

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">📦 Stock Report</span></div>
            <div className="erp-tab-content">
                <SavedViewsBar reportKey="stock_report" getConfig={() => config} onApply={cfg => { const m = { ...defaultConfig(), ...cfg }; setConfig(m); run(m); }} onReset={() => { setConfig(defaultConfig()); setData(null); }} />

                <div className="flex gap-1 my-3 border-b">
                    {MODES.map(m => <button key={m.key} className={`px-4 py-2 text-sm ${config.mode === m.key ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => switchMode(m.key)}>{m.label}</button>)}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                    {isOpening && sel('Opening', 'opening_basis', [{ value: 'entry', label: 'Opening Entry (fiscal year start)' }, { value: 'as_on', label: 'Opening stock as on a date' }], null)}
                    {!openingEntry && <div className="erp-field"><label className="erp-label">{isOpening ? 'As on (start of day)' : 'From'}</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>}
                    {!isOpening && <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>}
                    {config.mode !== 'party' && !openingEntry && sel('Valuation method', 'stock_method', Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label })), null)}
                    {config.mode !== 'party' && sel('Show rows by', 'group_by', [{ value: 'item', label: 'Item' }, { value: 'item_batch', label: 'Item + Batch' },
                        ...(openingEntry ? [] : [{ value: 'item_warehouse', label: 'Item + Warehouse' }])], null)}
                    <div className="erp-field md:col-span-2"><label className="erp-label">Item Class</label>
                        <div className="flex gap-3 items-center h-9">
                            {CLASSES.map(c => <label key={c.key} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={config.item_class.includes(c.key)} onChange={() => toggle('item_class', c.key)} /> {c.label}</label>)}
                        </div></div>
                    {sel('Item Type', 'item_type', typeOptions.map(t => ({ value: t.key, label: t.label })))}
                    {sel('Product Group (incl. sub-groups)', 'product_group_id', opts(masters.groups, 'id', 'group_name'))}
                    {sel('Product Company', 'product_company_id', opts(masters.companies, 'id', 'company_name'))}
                    {sel('Product Category', 'product_category_id', opts(masters.categories, 'id', 'category_name'))}
                    {sel('Unit (base unit)', 'unit_id', opts(masters.units, 'id', u => u.unit_symbol ? `${u.unit_name} (${u.unit_symbol})` : u.unit_name))}
                    {sel('Item', 'product_id', opts(itemOptions, 'id', p => p.product_code ? `${p.product_name} · ${p.product_code}` : p.product_name))}
                </div>

                <button className="text-xs text-blue-700 mb-2" onClick={() => setShowMore(s => !s)}>{showMore ? '▾ Fewer filters' : '▸ More filters'}</button>
                {showMore && (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        {txt('Search item / code / HS', 'search', 'type and press Enter')}
                        {sel('Show qty in unit', 'display_unit_id', opts(masters.units, 'id', 'unit_name'), 'Base unit of each item')}
                        {sel('Tracking', 'tracking', [{ value: 'batch', label: 'Batch-wise items only' }, { value: 'serial', label: 'Serial-no items only' }])}
                        {!openingEntry && sel('Warehouse', 'warehouse_id', opts(masters.warehouses, 'id', 'warehouse_name'))}
                        {txt('Batch No', 'batch_no', 'exact batch')}
                        {sel('Stock Status (closing)', 'stock_status', [{ value: 'in_stock', label: 'In stock (> 0)' }, { value: 'zero', label: 'Zero stock' }, { value: 'negative', label: 'Negative stock' }, { value: 'below_minimum', label: 'Below minimum level' }])}
                        {(lineMode || openingEntry) && txt('Serial No', 'serial_no', 'contains')}
                        {lineMode && sel('Party', 'party_key', masters.parties.map(p => ({ value: p.key, label: `${p.name}${p.side === 'vendor' ? ' (Supplier)' : p.side === 'customer' ? ' (Customer)' : ''}` })))}
                        {lineMode && (
                            <div className="erp-field md:col-span-4"><label className="erp-label">Module</label>
                                <div className="flex flex-wrap gap-3 items-center min-h-9">
                                    {MODULES.filter(m => config.mode === 'detail' || ['purchase', 'purchase_return', 'sales', 'sales_return'].includes(m.key))
                                        .map(m => <label key={m.key} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={config.modules.includes(m.key)} onChange={() => toggle('modules', m.key)} /> {m.label}</label>)}
                                </div></div>
                        )}
                    </div>
                )}

                <div className="flex flex-wrap gap-4 items-center text-sm mb-3">
                    {config.mode !== 'party' && <label className="flex items-center gap-2"><input type="checkbox" checked={config.show_value} onChange={e => set('show_value', e.target.checked)} /> Show amounts</label>}
                    {config.mode !== 'party' && <label className="flex items-center gap-2"><input type="checkbox" checked={config.hide_zero} onChange={e => set('hide_zero', e.target.checked)} /> Hide items with no stock or movement</label>}
                    <label className="flex items-center gap-2"><input type="checkbox" checked={config.include_inactive} onChange={e => set('include_inactive', e.target.checked)} /> Include inactive items</label>
                    {(config.mode === 'summary' || isOpening) && (
                        <label className="flex items-center gap-2">Subtotal by
                            <select className="erp-select w-auto" value={config.subtotal_by} onChange={e => set('subtotal_by', e.target.value)}>{SUBTOTAL_BY.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
                    )}
                    {config.mode !== 'detail' && (
                        <details className="relative"><summary className="cursor-pointer">⚙️ Columns</summary>
                            <div className="absolute z-10 bg-white border rounded shadow p-2 mt-1 w-48">
                                {ATTR_COLS.map(c => <label key={c.key} className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={config.columns.includes(c.key)} onChange={() => toggle('columns', c.key)} /> {c.label}</label>)}
                            </div></details>
                    )}
                </div>

                <div className="flex gap-2 mb-3">
                    <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                    {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}

                {data && mode === 'summary' && <SummaryView data={data} V={V} attrCols={attrCols} subtotalBy={config.subtotal_by} />}
                {data && mode === 'detail' && <DetailView data={data} V={V} rowLabel={rowLabel} />}
                {data && mode === 'party' && <PartyView data={data} attrCols={attrCols} />}
                {data && mode === 'opening' && <OpeningView data={data} V={V} attrCols={attrCols} subtotalBy={config.subtotal_by} />}
            </div>
        </div>
        </div>
        </Layout>
    );
}

// ---------------- Summary ----------------
function SummaryView({ data, V, attrCols, subtotalBy }) {
    const extra = data.group_by === 'item_batch' ? ['Batch', 'Expiry'] : data.group_by === 'item_warehouse' ? ['Warehouse'] : [];
    const pair = b => <>{<td className="text-right">{b ? q4(b.qty) : ''}</td>}{V && <td className="text-right text-gray-600">{b && b.value ? fmt(b.value) : ''}</td>}</>;
    const groups = useMemo(() => {
        if (!subtotalBy) return [{ key: '', rows: data.rows }];
        const m = new Map();
        data.rows.forEach(r => { const k = r[subtotalBy] || '(none)'; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => ({ key, rows }));
    }, [data.rows, subtotalBy]);
    const lead = 1 + attrCols.length + extra.length;
    const totalRow = (label, rows, cls) => {
        const s = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
        const mod = (side, key) => rows.reduce((a, r) => a + (r[side][key]?.value || 0), 0);
        return (
            <tr className={cls}>
                <td colSpan={lead}>{label} ({rows.length})</td>
                <td /><td className="text-right">{fmt(s('opening_value'))}</td>
                {data.modules_in.map(m => <React.Fragment key={'i' + m.key}><td /><td className="text-right">{amt(mod('in', m.key))}</td></React.Fragment>)}
                <td /><td className="text-right">{fmt(s('in_value'))}</td>
                {data.modules_out.map(m => <React.Fragment key={'o' + m.key}><td /><td className="text-right">{amt(mod('out', m.key))}</td></React.Fragment>)}
                <td /><td className="text-right">{fmt(s('out_value'))}</td>
                <td /><td /><td className="text-right">{fmt(s('closing_value'))}</td>
            </tr>
        );
    };
    return (
        <>
            <p className="text-xs text-gray-500 mb-2">Valued by {data.method_label}. {data.reconciles ? '✓ Opening + In − Out = Closing for every row.' : '✗ Some rows do not reconcile - please report this.'}
                {data.warehouse_view && ' Warehouse view: stock transfers move stock in and out of each warehouse.'}</p>
            {V && data.class_totals?.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-3">
                    {data.class_totals.map(c => (
                        <div key={c.item_class} className="border rounded px-3 py-2 text-sm bg-slate-50">
                            <div className="font-semibold">{c.label} <span className="text-xs text-gray-500">({c.rows})</span></div>
                            <div className="text-xs text-gray-600">Opening {fmt(c.opening_value)} · In {fmt(c.in_value)} · Out {fmt(c.out_value)}</div>
                            <div>Closing <b>{fmt(c.closing_value)}</b></div>
                        </div>
                    ))}
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="erp-grid-table text-sm">
                    <thead>
                        <tr>
                            <th rowSpan={2}>Item</th>
                            {attrCols.map(c => <th key={c.key} rowSpan={2}>{c.label}</th>)}
                            {extra.map(x => <th key={x} rowSpan={2}>{x}</th>)}
                            <th colSpan={V ? 2 : 1} className="text-center">Opening</th>
                            {data.modules_in.map(m => <th key={'i' + m.key} colSpan={V ? 2 : 1} className="text-center bg-green-50">In: {m.label}</th>)}
                            <th colSpan={V ? 2 : 1} className="text-center bg-green-100">Total In</th>
                            {data.modules_out.map(m => <th key={'o' + m.key} colSpan={V ? 2 : 1} className="text-center bg-red-50">Out: {m.label}</th>)}
                            <th colSpan={V ? 2 : 1} className="text-center bg-red-100">Total Out</th>
                            <th colSpan={V ? 3 : 1} className="text-center">Closing</th>
                        </tr>
                        <tr>
                            {Array.from({ length: 1 + data.modules_in.length + 1 + data.modules_out.length + 1 }).map((_, i) => <React.Fragment key={i}><th className="text-right">Qty</th>{V && <th className="text-right">Amount</th>}</React.Fragment>)}
                            <th className="text-right">Qty</th>{V && <><th className="text-right">Rate</th><th className="text-right">Amount</th></>}
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map(g => (
                            <React.Fragment key={g.key}>
                                {subtotalBy && <tr className="bg-blue-50 font-semibold"><td colSpan={99}>{g.key}</td></tr>}
                                {g.rows.map(r => (
                                    <tr key={r.key} className={r.below_minimum ? 'bg-amber-50' : ''}>
                                        <td>{r.product_name}{r.below_minimum && <span className="text-xs text-amber-700" title={`Minimum ${r.minimum_stock}`}> ▼ min</span>}</td>
                                        {attrCols.map(c => <td key={c.key}>{r[c.key]}</td>)}
                                        {data.group_by === 'item_batch' && <><td>{r.batch_no || <span className="text-gray-400">(no batch)</span>}</td><td>{r.exp_date ? String(r.exp_date).slice(0, 10) : ''}</td></>}
                                        {data.group_by === 'item_warehouse' && <td>{r.warehouse_name}</td>}
                                        {pair({ qty: r.opening_qty, value: r.opening_value })}
                                        {data.modules_in.map(m => <React.Fragment key={'i' + m.key}>{pair(r.in[m.key])}</React.Fragment>)}
                                        {pair({ qty: r.in_qty, value: r.in_value })}
                                        {data.modules_out.map(m => <React.Fragment key={'o' + m.key}>{pair(r.out[m.key])}</React.Fragment>)}
                                        {pair({ qty: r.out_qty, value: r.out_value })}
                                        <td className={`text-right font-semibold ${r.closing_qty < 0 ? 'text-red-600' : ''}`}>{q4(r.closing_qty)}</td>
                                        {V && <><td className="text-right">{r.closing_rate ? fmt(r.closing_rate) : ''}</td><td className="text-right font-semibold">{fmt(r.closing_value)}</td></>}
                                    </tr>
                                ))}
                                {V && subtotalBy && totalRow(`Subtotal: ${g.key}`, g.rows, 'font-semibold bg-slate-50')}
                            </React.Fragment>
                        ))}
                        {V && data.rows.length > 0 && totalRow('Grand Total', data.rows, 'font-bold bg-slate-100')}
                    </tbody>
                </table>
                {data.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No stock or movement for these filters.</p>}
            </div>
        </>
    );
}

// ---------------- Detail ----------------
function DetailView({ data, V, rowLabel }) {
    const cols = 12 + (V ? 2 : 0);
    return (
        <>
            <p className="text-xs text-gray-500 mb-2">Valued by {data.method_label}. {data.totals.lines} lines in {data.items.length} items. Rate is the document rate per unit shown.
                {data.filtered && ' Party / serial / module filter on: only matching lines are listed, so the running balance is hidden.'}
                {!data.warehouse_view && ' Stock transfers between warehouses are left out here (they net to zero) - choose Item + Warehouse to see them.'}</p>
            <div className="overflow-x-auto">
                <table className="erp-grid-table text-sm">
                    <thead>
                        <tr>
                            <th>Date</th><th>Module</th><th>Doc No</th><th>Party</th><th>Warehouse</th><th>Batch</th><th>Expiry</th><th>Serial No</th>
                            <th className="text-right">In Qty</th><th className="text-right">Out Qty</th>
                            {V && <><th className="text-right">Rate</th><th className="text-right">Amount</th></>}
                            <th className="text-right">Balance</th><th>Narration</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.items.map(i => (
                            <React.Fragment key={i.key}>
                                <tr className="bg-blue-50 font-semibold">
                                    <td colSpan={cols}>{i.product_name}{i.product_code && <span className="text-xs text-gray-500"> · {i.product_code}</span>}
                                        {rowLabel(i) && <span className="text-xs text-gray-600"> · {rowLabel(i)}</span>}
                                        <span className="text-xs font-normal text-gray-500"> · {[i.item_class_label, i.item_type_label, i.group_name, i.company_name, i.categories, i.unit].filter(Boolean).join(' · ')}</span></td>
                                </tr>
                                <tr className="text-gray-600 italic">
                                    <td colSpan={8}>Opening</td><td /><td />
                                    {V && <><td /><td className="text-right">{amt(i.opening_value)}</td></>}
                                    <td className="text-right">{q4(i.opening_qty) || '0'}</td><td />
                                </tr>
                                {i.lines.map((l, n) => (
                                    <tr key={l.id + n}>
                                        <td className="whitespace-nowrap">{l.date}</td><td>{l.module_label}</td><td>{l.doc_no}</td><td>{l.party_name}</td><td>{l.warehouse_name}</td>
                                        <td>{l.batch_no}</td><td>{l.exp_date ? String(l.exp_date).slice(0, 10) : ''}</td><td>{l.serial_no}</td>
                                        <td className="text-right text-green-700">{q4(l.in_qty)}</td><td className="text-right text-red-700">{q4(l.out_qty)}</td>
                                        {V && <><td className="text-right">{amt(l.rate)}</td><td className="text-right">{amt(l.amount)}</td></>}
                                        <td className={`text-right ${l.balance_qty < 0 ? 'text-red-600' : ''}`}>{l.balance_qty === null ? '' : q4(l.balance_qty) || '0'}</td>
                                        <td className="text-xs text-gray-500">{l.narration}</td>
                                    </tr>
                                ))}
                                <tr className="font-semibold bg-slate-50">
                                    <td colSpan={8}>Closing {i.unit && <span className="text-xs font-normal">({i.unit})</span>}</td>
                                    <td className="text-right">{q4(i.in_qty)}</td><td className="text-right">{q4(i.out_qty)}</td>
                                    {V && <><td className="text-right">{amt(i.closing_rate)}</td><td className="text-right">{fmt(i.closing_value)}</td></>}
                                    <td className="text-right">{q4(i.closing_qty) || '0'}</td><td />
                                </tr>
                            </React.Fragment>
                        ))}
                        {V && data.items.length > 0 && (
                            <tr className="font-bold bg-slate-100">
                                <td colSpan={8}>Grand Total ({data.items.length} items) - Opening {fmt(data.totals.opening_value)}</td>
                                <td className="text-right" colSpan={2}>In {fmt(data.totals.in_amount)} / Out {fmt(data.totals.out_amount)}</td>
                                <td /><td className="text-right">{fmt(data.totals.closing_value)}</td><td /><td />
                            </tr>
                        )}
                    </tbody>
                </table>
                {data.items.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No stock lines for these filters.</p>}
            </div>
        </>
    );
}

// ---------------- Opening ----------------
function OpeningView({ data, V, attrCols, subtotalBy }) {
    const [open, setOpen] = useState({});
    const batchCols = data.group_by === 'item_batch';
    const whCol = data.basis === 'as_on' && data.group_by === 'item_warehouse';
    const serialCol = data.basis === 'entry';
    const groups = useMemo(() => {
        if (!subtotalBy) return [{ key: '', rows: data.rows }];
        const m = new Map();
        data.rows.forEach(r => { const k = r[subtotalBy] || '(none)'; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => ({ key, rows }));
    }, [data.rows, subtotalBy]);
    const lead = 1 + attrCols.length + (batchCols ? 3 : 0) + (whCol ? 1 : 0);
    const cols = lead + 1 + (V ? 2 : 0) + (serialCol ? 1 : 0);
    const total = (label, rows, cls) => (
        <tr className={cls}>
            <td colSpan={lead}>{label} ({rows.length})</td><td />
            {V && <><td /><td className="text-right">{fmt(rows.reduce((s, r) => s + r.value, 0))}</td></>}
            {serialCol && <td>{rows.reduce((s, r) => s + r.serial_count, 0) || ''}</td>}
        </tr>
    );
    return (
        <>
            <p className="text-xs text-gray-500 mb-2">
                {data.basis === 'entry'
                    ? <>As entered in Product Opening Entry{data.opening_date ? <> - stock on hand at the end of {data.opening_date}</> : null}. Rate and amount are the entered opening rate.</>
                    : <>Stock on hand at the start of {data.opening_date}, valued by {data.method_label}.</>}
            </p>
            {V && data.class_totals?.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-3">
                    {data.class_totals.map(c => (
                        <div key={c.item_class} className="border rounded px-3 py-2 text-sm bg-slate-50">
                            <div className="font-semibold">{c.label} <span className="text-xs text-gray-500">({c.rows})</span></div>
                            <div>Opening <b>{fmt(c.value)}</b></div>
                        </div>
                    ))}
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="erp-grid-table text-sm">
                    <thead>
                        <tr>
                            <th>Item</th>{attrCols.map(c => <th key={c.key}>{c.label}</th>)}
                            {batchCols && <><th>Batch</th><th>Mfg Date</th><th>Expiry</th></>}
                            {whCol && <th>Warehouse</th>}
                            <th className="text-right">Qty</th>
                            {V && <><th className="text-right">Rate</th><th className="text-right">Amount</th></>}
                            {serialCol && <th>Serial Nos</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map(g => (
                            <React.Fragment key={g.key}>
                                {subtotalBy && <tr className="bg-blue-50 font-semibold"><td colSpan={cols}>{g.key}</td></tr>}
                                {g.rows.map(r => (
                                    <React.Fragment key={r.key}>
                                        <tr>
                                            <td>{r.product_name}</td>{attrCols.map(c => <td key={c.key}>{r[c.key]}</td>)}
                                            {batchCols && <><td>{r.batch_no || <span className="text-gray-400">(no batch)</span>}</td><td>{r.mfg_date ? String(r.mfg_date).slice(0, 10) : ''}</td><td>{r.exp_date ? String(r.exp_date).slice(0, 10) : ''}</td></>}
                                            {whCol && <td>{r.warehouse_name}</td>}
                                            <td className={`text-right font-semibold ${r.qty < 0 ? 'text-red-600' : ''}`}>{q4(r.qty) || '0'} <span className="text-xs font-normal text-gray-500">{r.unit}</span></td>
                                            {V && <><td className="text-right">{amt(r.rate)}</td><td className="text-right">{fmt(r.value)}</td></>}
                                            {serialCol && <td>{r.serial_count > 0 && <button className="text-xs text-blue-700" onClick={() => setOpen(o => ({ ...o, [r.key]: !o[r.key] }))}>{open[r.key] ? '▾' : '▸'} {r.serial_count} serial{r.serial_count > 1 ? 's' : ''}</button>}</td>}
                                        </tr>
                                        {serialCol && open[r.key] && (
                                            <tr><td colSpan={cols} className="bg-slate-50 text-xs">
                                                {r.serial_nos.map(s => <span key={s.serial_no} className="inline-block border rounded px-2 py-0.5 mr-1 mb-1 bg-white" title={[s.status, s.warranty_expiry_date && `warranty ${String(s.warranty_expiry_date).slice(0, 10)}`].filter(Boolean).join(' · ')}>{s.serial_no}</span>)}
                                            </td></tr>
                                        )}
                                    </React.Fragment>
                                ))}
                                {subtotalBy && total(`Subtotal: ${g.key}`, g.rows, 'font-semibold bg-slate-50')}
                            </React.Fragment>
                        ))}
                        {data.rows.length > 0 && total('Grand Total', data.rows, 'font-bold bg-slate-100')}
                    </tbody>
                </table>
                {data.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No opening stock for these filters.</p>}
            </div>
        </>
    );
}

// ---------------- Party-wise ----------------
function PartyView({ data, attrCols }) {
    const parties = useMemo(() => {
        const m = new Map();
        data.rows.forEach(r => { if (!m.has(r.party_key)) m.set(r.party_key, { name: r.party_name, rows: [] }); m.get(r.party_key).rows.push(r); });
        return [...m.entries()];
    }, [data.rows]);
    const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
    const totals = (label, rows, cls) => (
        <tr className={cls}>
            <td colSpan={1 + attrCols.length}>{label}</td>
            <td /><td className="text-right">{fmt(sum(rows, 'purchase_amount'))}</td><td />
            <td /><td className="text-right">{fmt(sum(rows, 'purchase_return_amount'))}</td>
            <td /><td className="text-right">{fmt(sum(rows, 'sales_amount'))}</td><td />
            <td /><td className="text-right">{fmt(sum(rows, 'sales_return_amount'))}</td><td /><td />
        </tr>
    );
    return (
        <>
            <p className="text-xs text-gray-500 mb-2">Quantities and amounts at the document rate (per unit shown). Net Qty = Purchase − Purchase Return − Sales + Sales Return.</p>
            <div className="overflow-x-auto">
                <table className="erp-grid-table text-sm">
                    <thead>
                        <tr>
                            <th rowSpan={2}>Item</th>{attrCols.map(c => <th key={c.key} rowSpan={2}>{c.label}</th>)}
                            <th colSpan={3} className="text-center bg-green-50">Purchase</th><th colSpan={2} className="text-center bg-red-50">Purchase Return</th>
                            <th colSpan={3} className="text-center bg-red-50">Sales</th><th colSpan={2} className="text-center bg-green-50">Sales Return</th>
                            <th rowSpan={2} className="text-right">Net Qty</th><th rowSpan={2} className="text-right">Docs</th>
                        </tr>
                        <tr>
                            <th className="text-right">Qty</th><th className="text-right">Amount</th><th className="text-right">Avg Rate</th>
                            <th className="text-right">Qty</th><th className="text-right">Amount</th>
                            <th className="text-right">Qty</th><th className="text-right">Amount</th><th className="text-right">Avg Rate</th>
                            <th className="text-right">Qty</th><th className="text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {parties.map(([key, p]) => (
                            <React.Fragment key={key}>
                                <tr className="bg-blue-50 font-semibold"><td colSpan={99}>{p.name}</td></tr>
                                {p.rows.map(r => (
                                    <tr key={r.key}>
                                        <td>{r.product_name}</td>{attrCols.map(c => <td key={c.key}>{r[c.key]}</td>)}
                                        <td className="text-right">{q4(r.purchase_qty)}</td><td className="text-right">{amt(r.purchase_amount)}</td><td className="text-right">{amt(r.purchase_rate)}</td>
                                        <td className="text-right">{q4(r.purchase_return_qty)}</td><td className="text-right">{amt(r.purchase_return_amount)}</td>
                                        <td className="text-right">{q4(r.sales_qty)}</td><td className="text-right">{amt(r.sales_amount)}</td><td className="text-right">{amt(r.sales_rate)}</td>
                                        <td className="text-right">{q4(r.sales_return_qty)}</td><td className="text-right">{amt(r.sales_return_amount)}</td>
                                        <td className="text-right font-semibold">{q4(r.net_qty)}</td><td className="text-right">{r.doc_count}</td>
                                    </tr>
                                ))}
                                {totals(`Subtotal: ${p.name}`, p.rows, 'font-semibold bg-slate-50')}
                            </React.Fragment>
                        ))}
                        {data.rows.length > 0 && totals('Grand Total', data.rows, 'font-bold bg-slate-100')}
                    </tbody>
                </table>
                {data.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No party transactions for these filters.</p>}
            </div>
        </>
    );
}
