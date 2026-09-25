// =============================================
// SalesPurchaseAnalysis.jsx
// One screen for three reports (server: utils/tradeAnalysis.js):
//   mode="analysis" - Sales / Purchase Analysis: any 1-4 row levels
//                     (customer / supplier, product group, product, area,
//                     route, agent, branch, month, bill ...) and an optional
//                     column dimension (customer vs product group ...)
//   mode="monthly"  - the same with months as columns
//   mode="profit"   - Profitability: net sales vs cost of sales (valuation
//                     method of choice), product-wise / bill-wise / ...
// Bills, returns and non-saleable returns can be included or shown alone;
// measures: qty (sales / return / net, entered, alt, free, any unit, dual
// e.g. 5 CRT 3 PCS), value, gross, discount, VAT, amount, avg rate, counts.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useUdfColumns } from '../components/UdfColumns';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtQ = n => (Number(n) ? (Math.round(Number(n) * 10000) / 10000).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '');

const KINDS = [{ key: 'main', label: 'Bills' }, { key: 'return', label: 'Returns' }, { key: 'nonsalable', label: 'Non-saleable Returns' }];
const MEASURE_GROUPS = [
    { key: 'qty', label: 'Qty (bill / return / net)' }, { key: 'value', label: 'Value (bill / return / net)' },
    { key: 'entered', label: 'Entered / Alt / Free Qty' }, { key: 'unit', label: 'Qty in unit + Dual qty' },
    { key: 'amounts', label: 'Gross / Discount / VAT / Amount' }, { key: 'rate', label: 'Avg Rate' }, { key: 'counts', label: 'Counts' },
    { key: 'profit', label: 'Cost / Profit / Margin' }
];
const measureDefs = (side, displayUnit) => {
    const main = side === 'purchase' ? 'Purchase' : 'Sales';
    return [
        { key: 'main_qty', label: `${main} Qty`, grp: 'qty', q: true }, { key: 'return_qty', label: 'Return Qty', grp: 'qty', q: true },
        { key: 'net_qty', label: 'Net Qty', grp: 'qty', q: true, strong: true },
        { key: 'main_value', label: `${main} Value`, grp: 'value' }, { key: 'return_value', label: 'Return Value', grp: 'value' },
        { key: 'net_value', label: 'Net Value', grp: 'value', strong: true },
        { key: 'entered_qty', label: 'Entered Qty', grp: 'entered', q: true, unitKey: 'unit' }, { key: 'alt_qty', label: 'Alt Qty', grp: 'entered', q: true, unitKey: 'alt_unit' },
        ...(side === 'purchase' ? [{ key: 'alt1_qty', label: 'Alt Qty 2', grp: 'entered', q: true, unitKey: 'alt1_unit' }] : []),
        { key: 'free_qty', label: 'Free Qty', grp: 'entered', q: true },
        { key: 'display_qty', label: `Qty (${displayUnit || 'base unit'})`, grp: 'unit', q: true },
        { key: 'dual', label: 'Dual Qty', grp: 'unit', render: m => (m.dual ? `${m.dual.primary} ${m.dual.primary_unit} ${m.dual.secondary ? `${m.dual.secondary} ${m.dual.secondary_unit}` : ''}` : '') },
        { key: 'gross', label: 'Gross', grp: 'amounts' }, { key: 'discount', label: 'Discount', grp: 'amounts' },
        { key: 'tax', label: 'VAT', grp: 'amounts' }, { key: 'amount', label: 'Amount (incl. VAT)', grp: 'amounts' },
        { key: 'avg_rate', label: 'Avg Rate (per base unit)', grp: 'rate', q: true },
        { key: 'docs', label: 'Bills', grp: 'counts', int: true }, { key: 'parties', label: side === 'purchase' ? 'Suppliers' : 'Customers', grp: 'counts', int: true },
        { key: 'products', label: 'Items', grp: 'counts', int: true }, { key: 'lines', label: 'Lines', grp: 'counts', int: true },
        { key: 'cost', label: 'Cost of Sales', grp: 'profit' }, { key: 'profit', label: 'Profit', grp: 'profit', strong: true },
        { key: 'margin_pct', label: 'Margin %', grp: 'profit', pct: true }, { key: 'markup_pct', label: 'Markup %', grp: 'profit', pct: true }
    ];
};
const COLUMN_MEASURES = [
    { key: 'net_value', label: 'Net Value' }, { key: 'net_qty', label: 'Net Qty' }, { key: 'main_value', label: 'Bill Value' }, { key: 'main_qty', label: 'Bill Qty' },
    { key: 'return_value', label: 'Return Value' }, { key: 'return_qty', label: 'Return Qty' }, { key: 'amount', label: 'Amount (incl. VAT)' },
    { key: 'display_qty', label: 'Qty (chosen unit)' }, { key: 'profit', label: 'Profit' }, { key: 'margin_pct', label: 'Margin %' }
];
const METHOD_LABELS = { moving_average: 'Moving Average', weighted_average: 'Weighted Average', fifo: 'FIFO', lifo: 'LIFO', last_purchase: 'Last Purchase Rate' };
const FILTERS = [
    ['party_ids', side => (side === 'purchase' ? 'Supplier' : 'Customer'), m => m.__parties], ['product_ids', 'Item', m => m.products],
    ['product_group_ids', 'Product Group (+ sub)', m => m.product_groups], ['product_company_ids', 'Product Company', m => m.product_companies],
    ['product_category_ids', 'Product Category', m => m.product_categories], ['area_ids', 'Area (+ sub)', m => m.areas], ['route_ids', 'Route', m => m.routes],
    ['agent_ids', 'Salesman / Agent', m => m.agents], ['branch_ids', 'Branch', m => m.branches], ['warehouse_ids', 'Warehouse', m => m.warehouses],
    ['cost_center_ids', 'Cost Center', m => m.cost_centers], ['business_unit_ids', 'Business Unit', m => m.business_units]
];
const PRESETS = {
    analysis: { rows: ['party', 'product_group', 'product'], columns: '', measures: ['qty', 'value'] },
    monthly: { rows: ['party'], columns: 'month', measures: ['value'] },
    profit: { rows: ['product'], columns: '', measures: ['qty', 'value', 'profit'] }
};
const PROFIT_VIEWS = [['product', 'Product-wise'], ['doc', 'Bill-wise'], ['party', 'Customer-wise'], ['product_group', 'Group-wise'], ['area', 'Area-wise'], ['month', 'Month-wise'], ['batch', 'Batch-wise'], ['serial', 'Serial-wise']];
const TITLES = { analysis: '📈 Sales / Purchase Analysis', monthly: '🗓 Monthly Analysis', profit: '💹 Profitability' };

const defaultConfig = mode => {
    const d = new Date();
    return {
        side: 'sales', date_from: `${d.getFullYear()}-01-01`, date_to: iso(d), kinds: ['main', 'return', 'nonsalable'],
        rows: PRESETS[mode].rows, columns: PRESETS[mode].columns, column_measure: mode === 'profit' ? 'profit' : 'net_value',
        measures: PRESETS[mode].measures, display_unit_id: '', sort_by: 'name', top: '', cost_method: 'moving_average',
        search: '', doc_no: '', udf_field: '', udf_text: '', compare: '', compare_from: '', compare_to: '', ...Object.fromEntries(FILTERS.map(([k]) => [k, []]))
    };
};

export default function SalesPurchaseAnalysis({ mode = 'analysis' }) {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(() => defaultConfig(mode));
    const [meta, setMeta] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [collapsed, setCollapsed] = useState(() => new Set());
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const isProfit = mode === 'profit';
    const udf = useUdfColumns(`analysis-${mode}`, (isProfit ? 'sales' : config.side) === 'purchase'
        ? ['purchase_bill', 'purchase_return', 'purchase_nonsaleable_return'] : ['sales_bill', 'sales_return', 'sales_nonsaleable_return', 'sales_delivery']);

    useEffect(() => { setConfig(defaultConfig(mode)); setData(null); }, [mode]);
    useEffect(() => {
        authFetch(`/api/reports/trade-meta?side=${config.side}`).then(r => setMeta(r.data)).catch(e => setError(e.message));
    }, [authFetch, config.side]);
    const masters = useMemo(() => (meta ? { ...meta, __parties: config.side === 'purchase' ? meta.vendors : meta.customers } : null), [meta, config.side]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ side: isProfit ? 'sales' : cfg.side, date_from: cfg.date_from, date_to: cfg.date_to, kinds: cfg.kinds.join(','),
                rows: cfg.rows.filter(Boolean).join(','), sort_by: cfg.sort_by });
            if (cfg.columns) p.set('columns', cfg.columns);
            if (cfg.top) p.set('top', cfg.top);
            if (cfg.display_unit_id) p.set('display_unit_id', cfg.display_unit_id);
            if (cfg.search) p.set('search', cfg.search);
            if (cfg.doc_no) p.set('doc_no', cfg.doc_no);
            if (cfg.udf_field && cfg.udf_text.trim()) p.set('udf_filter', `${cfg.udf_field}:${cfg.udf_text.trim()}`);
            if (isProfit) p.set('cost_method', cfg.cost_method);
            if (cfg.compare) { p.set('compare', cfg.compare); if (cfg.compare === 'custom') { p.set('compare_from', cfg.compare_from); p.set('compare_to', cfg.compare_to); } }
            FILTERS.forEach(([k]) => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            const res = await authFetch(`/api/reports/${isProfit ? 'profitability' : 'trade-analysis'}?${p}`);
            setData(res.data); setCollapsed(new Set());
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config, isProfit]);

    const side = data?.side || config.side;
    const defs = measureDefs(side, data?.display_unit).filter(m => config.measures.includes(m.grp) && (m.grp !== 'profit' || data?.with_cost));
    const colMeasure = COLUMN_MEASURES.find(m => m.key === config.column_measure) || COLUMN_MEASURES[0];
    // comparison columns: previous figure, change and change % for net value / qty (+ profit)
    const cmpKeys = data?.compare ? [['net_value', 'Net Value', true], ['net_qty', 'Net Qty', false], ...(data.with_cost ? [['profit', 'Profit', true]] : [])] : [];
    const n2 = (v, money) => (v === null || v === undefined ? '' : money ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
    const cmpCells = n => cmpKeys.map(([k, , money]) => [
        <td key={`${k}p`} className="text-right tabular-nums text-gray-500 bg-amber-50">{n2(n.prev?.[k], money)}</td>,
        <td key={`${k}c`} className={`text-right tabular-nums bg-amber-50 ${(n.change?.[k] || 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{n2(n.change?.[k], money)}</td>,
        <td key={`${k}%`} className={`text-right tabular-nums bg-amber-50 ${(n.change?.[k] || 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{n.change_pct?.[k] === null || n.change_pct?.[k] === undefined ? (n.prev?.[k] ? '' : 'new') : `${n.change_pct[k]}%`}</td>]);
    const cell = (m, def) => {
        if (!m) return '';
        if (def.render) return def.render(m);
        const v = m[def.key];
        if (def.pct) return v ? `${Number(v).toFixed(2)}%` : '';
        if (def.int) return v || '';
        return def.q ? fmtQ(v) : fmt2(v);
    };
    const colCell = m => (!m ? '' : colMeasure.key === 'margin_pct' ? (m.margin_pct ? `${m.margin_pct}%` : '') : ['net_qty', 'main_qty', 'return_qty', 'display_qty'].includes(colMeasure.key) ? fmtQ(m[colMeasure.key]) : fmt2(m[colMeasure.key]));

    // Flatten the tree for display, honouring collapsed nodes.
    const flat = useMemo(() => {
        if (!data) return [];
        const out = [];
        const walk = (n, path) => n.children.forEach(ch => {
            const id = `${path}/${ch.key}`;
            out.push({ ...ch, id });
            if (!collapsed.has(id)) walk(ch, id);
        });
        walk(data.tree, '');
        return out;
    }, [data, collapsed]);
    const toggleNode = id => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const collapseLevel = level => {
        if (!data) return;
        const ids = new Set();
        const walk = (n, path) => n.children.forEach(ch => { const id = `${path}/${ch.key}`; if (ch.level >= level && ch.children.length) ids.add(id); walk(ch, id); });
        walk(data.tree, '');
        setCollapsed(ids);
    };

    const exportCsv = () => {
        if (!data) return;
        const levels = data.rows.map(r => r.label);
        const head = [...levels, 'Code', 'Unit', ...(data.column_dim ? [...data.columns.map(c => `${c.label} ${colMeasure.label}`), `Total ${colMeasure.label}`] : []), ...defs.map(d => d.label)];
        const rows = [];
        const walk = (n, trail) => n.children.forEach(ch => {
            const t2 = [...trail]; t2[ch.level] = ch.label;
            rows.push([...levels.map((_, i) => (i <= ch.level ? t2[i] || '' : '')), ch.code || '', ch.measures.base_unit || '',
                ...(data.column_dim ? [...data.columns.map(c => ch.cols[c.key]?.[colMeasure.key] ?? ''), ch.measures[colMeasure.key] ?? ''] : []),
                ...defs.map(d => (d.render ? d.render(ch.measures) : ch.measures[d.key] ?? ''))]);
            walk(ch, t2);
        });
        walk(data.tree, []);
        rows.push(['Grand Total', ...levels.slice(1).map(() => ''), '', '', ...(data.column_dim ? [...data.columns.map(c => data.tree.cols[c.key]?.[colMeasure.key] ?? ''), data.tree.measures[colMeasure.key] ?? ''] : []),
            ...defs.map(d => (d.render ? '' : data.tree.measures[d.key] ?? ''))]);
        const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${mode}_${side}_${config.date_from}_${config.date_to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    // Custom fields (UDF) can be row / column levels too.
    const dims = [...(meta?.dimensions || []), ...udf.fields.map(f => ({ key: `udf:${f.id}`, label: `UDF: ${f.field_label}${f.section === 'detail' ? ' (line)' : ''}` }))];
    // Choosing "(none)" at a level drops it and every level below it.
    const setRow = (i, v) => setConfig(c => ({ ...c, rows: v ? Object.assign(c.rows.slice(0, 4), { [i]: v }) : c.rows.slice(0, i) }));
    const toggleList = (k, v) => setConfig(c => ({ ...c, [k]: c[k].includes(v) ? c[k].filter(x => x !== v) : [...c[k], v] }));

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">{TITLES[mode]}</span></div>
            <div className="erp-tab-content">
                {isProfit && (
                    <div className="flex flex-wrap gap-1 mb-3 border-b">
                        {PROFIT_VIEWS.map(([k, l]) => (
                            <button key={k} className={`px-3 py-2 text-sm ${config.rows[0] === k && config.rows.length === 1 ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`}
                                onClick={() => { const next = { ...config, rows: [k] }; setConfig(next); run(next); }}>{l}</button>
                        ))}
                    </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                    {!isProfit && (
                        <div className="erp-field"><label className="erp-label">Type</label>
                            <select className="erp-select" value={config.side} onChange={e => setConfig(c => ({ ...c, side: e.target.value, party_ids: [] }))}>
                                <option value="sales">Sales</option><option value="purchase">Purchase</option>
                            </select></div>
                    )}
                    <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                    <div className="erp-field md:col-span-2"><label className="erp-label">Include</label>
                        <div className="flex flex-wrap gap-3 items-center min-h-9 text-sm">
                            {KINDS.map(k => <label key={k.key} className="flex items-center gap-1"><input type="checkbox" checked={config.kinds.includes(k.key)} onChange={() => toggleList('kinds', k.key)} /> {k.label}</label>)}
                            <button type="button" className="text-xs text-blue-600" onClick={() => set('kinds', ['return', 'nonsalable'])}>only returns</button>
                        </div></div>
                    {isProfit && (
                        <div className="erp-field"><label className="erp-label">Cost method</label>
                            <select className="erp-select" value={config.cost_method} onChange={e => set('cost_method', e.target.value)}>
                                {Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                            <span className="text-[11px] text-gray-500">Batch / serial items follow System Control (FIFO / LIFO / batch-wise / serial-wise).</span></div>
                    )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                    {[0, 1, 2, 3].map(i => (i === 0 || config.rows[i - 1]) && (
                        <div key={i} className="erp-field"><label className="erp-label">Rows - level {i + 1}</label>
                            <select className="erp-select" value={config.rows[i] || ''} onChange={e => setRow(i, e.target.value)}>
                                {i > 0 && <option value="">(none)</option>}
                                {dims.map(d => <option key={d.key} value={d.key} disabled={config.rows.includes(d.key) && config.rows[i] !== d.key}>{d.label}</option>)}
                            </select></div>
                    ))}
                    <div className="erp-field"><label className="erp-label">Columns</label>
                        <select className="erp-select" value={config.columns} onChange={e => set('columns', e.target.value)}>
                            <option value="">(none - measures)</option>
                            {dims.filter(d => !config.rows.includes(d.key)).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                        </select></div>
                    <div className="erp-field"><label className="erp-label">Compare with</label>
                        <select className="erp-select" value={config.compare} onChange={e => set('compare', e.target.value)}>
                            <option value="">No comparison</option><option value="previous">Previous period (same length)</option><option value="last_year">Same period last year</option><option value="custom">Custom period</option>
                        </select></div>
                    {config.compare === 'custom' && <>
                        <div className="erp-field"><label className="erp-label">Compare from</label><input type="date" className="erp-input" value={config.compare_from} onChange={e => set('compare_from', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">Compare to</label><input type="date" className="erp-input" value={config.compare_to} onChange={e => set('compare_to', e.target.value)} /></div>
                    </>}
                    {config.columns && (
                        <div className="erp-field"><label className="erp-label">Column shows</label>
                            <select className="erp-select" value={config.column_measure} onChange={e => set('column_measure', e.target.value)}>
                                {COLUMN_MEASURES.filter(m => isProfit || !['profit', 'margin_pct'].includes(m.key)).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                            </select></div>
                    )}
                </div>

                {masters && (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        {FILTERS.map(([k, label, items]) => (
                            <MultiPick key={k} label={typeof label === 'function' ? label(config.side) : label} items={items(masters) || []} value={config[k]} onChange={v => set(k, v)} />
                        ))}
                        <div className="erp-field"><label className="erp-label">Search item / code</label>
                            <input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                        <div className="erp-field"><label className="erp-label">Bill No contains</label>
                            <input className="erp-input" value={config.doc_no} onChange={e => set('doc_no', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                        {udf.fields.length > 0 && (
                            <div className="erp-field"><label className="erp-label">Custom field (UDF) filter</label>
                                <div className="flex gap-1">
                                    <select className="erp-select" value={config.udf_field} onChange={e => set('udf_field', e.target.value)}>
                                        <option value="">—</option>
                                        {udf.fields.map(f => <option key={f.id} value={f.id}>{f.field_label}</option>)}
                                    </select>
                                    <input className="erp-input" placeholder="contains… / (blank)" value={config.udf_text} onChange={e => set('udf_text', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} />
                                </div></div>
                        )}
                        <div className="erp-field"><label className="erp-label">Show qty in unit</label>
                            <select className="erp-select" value={config.display_unit_id} onChange={e => set('display_unit_id', e.target.value)}>
                                <option value="">Base unit of each item</option>
                                {(masters.units || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select></div>
                        <div className="erp-field"><label className="erp-label">Sort by</label>
                            <select className="erp-select" value={config.sort_by} onChange={e => set('sort_by', e.target.value)}>
                                <option value="name">Name / date</option><option value="net_value">Net Value (high first)</option><option value="net_qty">Net Qty</option>
                                <option value="main_value">Bill Value</option><option value="return_value">Return Value</option><option value="amount">Amount</option>
                                {isProfit && <option value="profit">Profit</option>}{isProfit && <option value="margin_pct">Margin %</option>}
                            </select></div>
                        <div className="erp-field"><label className="erp-label">Top N per level</label>
                            <input type="number" min="0" className="erp-input" value={config.top} placeholder="all" onChange={e => set('top', e.target.value)} /></div>
                    </div>
                )}

                <div className="flex flex-wrap gap-4 items-center text-sm mb-3">
                    <span className="text-gray-500">Show:</span>
                    {MEASURE_GROUPS.filter(g => g.key !== 'profit' || isProfit).map(g => (
                        <label key={g.key} className="flex items-center gap-1"><input type="checkbox" checked={config.measures.includes(g.key)} onChange={() => toggleList('measures', g.key)} /> {g.label}</label>
                    ))}
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                    <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                    {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                    {data && data.rows.length > 1 && data.rows.slice(0, -1).map((r, i) => <button key={r.key} className="erp-btn" onClick={() => collapseLevel(i)}>▸ up to {r.label}</button>)}
                    {data && collapsed.size > 0 && <button className="erp-btn" onClick={() => setCollapsed(new Set())}>▾ Expand all</button>}
                    <button className="erp-btn" onClick={() => { setConfig(defaultConfig(mode)); setData(null); }}>↺ Reset</button>
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}

                {data && (
                    <div className="overflow-x-auto">
                        <p className="text-xs text-gray-500 mb-1">
                            {data.side === 'purchase' ? 'Purchase' : 'Sales'} · {data.from} to {data.to} · {data.kinds.map(k => KINDS.find(x => x.key === k)?.label).join(' + ')}
                            {data.with_cost && ` · Cost: ${data.cost_method_label}`} · {data.line_count} lines · Qty in base unit unless noted
                            {data.compare && ` · Compared with ${data.compare.label}: ${data.compare.from} to ${data.compare.to}`}
                            {data.tree?.lost?.length > 0 && <span className="block text-amber-700">Only in the comparison period ({data.tree.lost.length}): {data.tree.lost.slice(0, 15).map(x => x.label).join(', ')}{data.tree.lost.length > 15 ? ' …' : ''}</span>}
                        </p>
                        <table className="erp-grid-table w-full text-sm">
                            <thead>
                                <tr>
                                    <th className="text-left min-w-[240px]">{data.rows.map(r => r.label).join(' › ')}</th>
                                    <th className="text-left">Unit</th>
                                    {data.column_dim && data.columns.map(c => <th key={c.key} className="text-right whitespace-nowrap">{c.label}</th>)}
                                    {data.column_dim && <th className="text-right bg-blue-50">Total</th>}
                                    {defs.map(d => <th key={d.key} className={`text-right whitespace-nowrap ${d.grp === 'profit' ? 'bg-green-50' : ''}`}>{d.label}</th>)}
                                    {cmpKeys.map(([k, label]) => [<th key={`${k}p`} className="text-right whitespace-nowrap bg-amber-50">{label} (prev)</th>, <th key={`${k}c`} className="text-right bg-amber-50">Change</th>, <th key={`${k}%`} className="text-right bg-amber-50">Change %</th>])}
                                </tr>
                                {data.column_dim && <tr><th colSpan={2 + data.columns.length + 1 + defs.length} className="text-left text-xs font-normal text-gray-500">Columns: {data.column_dim.label} - {colMeasure.label}</th></tr>}
                            </thead>
                            <tbody>
                                {flat.map(n => {
                                    const last = n.level === data.rows.length - 1;
                                    return (
                                        <tr key={n.id} className={last ? '' : 'bg-gray-50 font-semibold'}>
                                            <td style={{ paddingLeft: `${8 + n.level * 18}px` }}>
                                                {!last && n.children.length > 0
                                                    ? <button className="mr-1 text-gray-500" onClick={() => toggleNode(n.id)}>{collapsed.has(n.id) ? '▸' : '▾'}</button>
                                                    : <span className="mr-1 inline-block w-3" />}
                                                {n.label}{n.code ? <span className="text-xs text-gray-400 ml-1">{n.code}</span> : null}
                                            </td>
                                            <td className="text-gray-500">{n.measures.base_unit || ''}</td>
                                            {data.column_dim && data.columns.map(c => <td key={c.key} className="text-right tabular-nums">{colCell(n.cols[c.key])}</td>)}
                                            {data.column_dim && <td className="text-right tabular-nums bg-blue-50 font-semibold">{colCell(n.measures)}</td>}
                                            {defs.map(d => (
                                                <td key={d.key} className={`text-right tabular-nums whitespace-nowrap ${d.strong ? 'font-semibold' : ''} ${(d.key === 'profit' || d.key === 'margin_pct') && n.measures[d.key] < 0 ? 'text-red-600' : ''}`}>
                                                    {cell(n.measures, d)}{d.unitKey && n.measures[d.unitKey] && Number(n.measures[d.key]) ? <span className="text-[10px] text-gray-400 ml-0.5">{n.measures[d.unitKey]}</span> : null}
                                                </td>
                                            ))}
                                            {cmpCells(n)}
                                        </tr>
                                    );
                                })}
                                {flat.length === 0 && <tr><td colSpan={2 + defs.length + (data.column_dim ? data.columns.length + 1 : 0)} className="text-center text-gray-400 py-4">No posted documents for these filters.</td></tr>}
                            </tbody>
                            {flat.length > 0 && (
                                <tfoot>
                                    <tr className="bg-blue-50 font-bold">
                                        <td>Grand Total</td><td />
                                        {data.column_dim && data.columns.map(c => <td key={c.key} className="text-right tabular-nums">{colCell(data.tree.cols[c.key])}</td>)}
                                        {data.column_dim && <td className="text-right tabular-nums">{colCell(data.tree.measures)}</td>}
                                        {defs.map(d => <td key={d.key} className="text-right tabular-nums whitespace-nowrap">{d.q && d.key !== 'net_qty' && d.key !== 'main_qty' && d.key !== 'return_qty' ? '' : cell(data.tree.measures, d)}</td>)}
                                        {cmpCells(data.tree)}
                                    </tr>
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
