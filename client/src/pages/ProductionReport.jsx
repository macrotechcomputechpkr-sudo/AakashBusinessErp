// =============================================
// ProductionReport.jsx
// Production reports (server/utils/productionReport.js):
//   Register · Details · Output summary · Raw material consumption ·
//   By-product recovery · BOM standard vs actual (variance)
// Filters: date, status, branch, output product, raw material / by-product,
// product group, BOM template, search. Custom fields (UDF) of the
// production entry as extra columns.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useUdfColumns } from '../components/UdfColumns';

const fmt2 = n => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtQ = n => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 4 }));
const iso = d => d.toISOString().slice(0, 10);
const VIEWS = [
    ['register', '📋 Register'], ['details', '📄 Details'], ['output', '📦 Output'], ['consumption', '🧪 Raw Material Consumption'],
    ['byproduct', '♻ By-products'], ['variance', '⚖ BOM vs Actual'], ['cost_trend', '📉 Cost Trend'], ['batch', '🏷 Batch Traceability'],
    ['bom_cost', '🧾 BOM Standard Cost'], ['pending', '⏳ Pending (Draft)']
];
const GROUPED = ['output', 'consumption', 'byproduct'];
const LINE_TYPE = { output: 'Output', input: 'Raw material', byproduct: 'By-product' };
const defaultConfig = () => {
    const d = new Date();
    return { view: 'register', from_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to_date: iso(d), statuses: ['posted'], group_by: ['product'],
        branch_ids: [], output_product_ids: [], product_ids: [], product_group_ids: [], bom_template_ids: [], search: '' };
};

export default function ProductionReport() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(() => { const v = new URLSearchParams(window.location.search).get('view'); return { ...defaultConfig(), ...(VIEWS.some(x => x[0] === v) ? { view: v } : {}) }; });
    const [meta, setMeta] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const udf = useUdfColumns('production-report', ['production_order']);
    const udfLoad = udf.load;
    useEffect(() => { if (data?.rows) udfLoad(data.rows); }, [data, udfLoad]);

    useEffect(() => { authFetch('/api/reports/production/meta').then(r => setMeta(r.data)).catch(e => setError(e.message)); }, [authFetch]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ view: cfg.view, from_date: cfg.from_date, to_date: cfg.to_date, statuses: cfg.statuses.join(','), group_by: cfg.group_by.join(',') });
            ['branch_ids', 'output_product_ids', 'product_ids', 'product_group_ids', 'bom_template_ids'].forEach(k => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            if (cfg.search) p.set('search', cfg.search);
            setData((await authFetch(`/api/reports/production?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const switchView = v => { const next = { ...config, view: v }; setConfig(next); setData(null); run(next); };
    const groupLabel = useMemo(() => Object.fromEntries((meta?.groups || []).map(g => [g.key, g.label])), [meta]);
    const udfKeys = { doc: 'doc_id', line: 'line_id' };

    // table definition per view: [label, getter, numeric]
    const cols = useMemo(() => {
        if (!data) return [];
        switch (data.view) {
            case 'register': return [
                ['Date', r => r.doc_date], ['Order No', r => r.doc_no], ['Branch', r => r.branch_name], ['Output Product', r => r.output_product_name],
                ['Qty', r => `${fmtQ(r.output_qty)} ${r.output_unit}`, true], ['Base Qty', r => `${fmtQ(r.output_base_qty)} ${r.base_unit}`, true], ['Batch', r => r.output_batch_no],
                ['Input Qty (base)', r => fmtQ(r.input_base_qty), true], ['Yield %', r => (r.yield_pct === null ? '' : `${r.yield_pct}%`), true],
                ['Raw Material Cost', r => fmt2(r.raw_material_cost), true, 'raw_material_cost'], ['of which Terms', r => fmt2(r.term_amount), true, 'term_amount'],
                ['By-product Value', r => fmt2(r.byproduct_value), true, 'byproduct_value'], ['Net Output Cost', r => fmt2(r.net_output_cost), true, 'net_output_cost'],
                ['Unit Cost / base', r => fmt2(r.unit_cost), true], ['Status', r => r.status]
            ];
            case 'details': return [
                ['Date', r => r.doc_date], ['Order No', r => r.doc_no], ['Type', r => LINE_TYPE[r.line_type]], ['Product', r => `${r.product_name}${r.product_code ? ` (${r.product_code})` : ''}`],
                ['Process', r => r.process], ['Warehouse', r => r.warehouse_name], ['Batch', r => r.batch_no], ['Qty', r => `${fmtQ(r.qty)} ${r.unit}`, true],
                ['Base Qty', r => `${fmtQ(r.base_qty)} ${r.base_unit}`, true], ['Rate', r => fmt2(r.rate), true], ['Terms', r => fmt2(r.term_amount), true], ['Amount', r => fmt2(r.amount), true]
            ];
            case 'variance': return [
                ['Date', r => r.doc_date], ['Order No', r => r.doc_no], ['BOM', r => r.template], ['Output', r => `${r.output_product_name} · ${fmtQ(r.output_base_qty)}`],
                ['Raw Material', r => r.product_name], ['Standard Qty', r => `${fmtQ(r.standard_qty)} ${r.base_unit}`, true], ['Actual Qty', r => fmtQ(r.actual_qty), true],
                ['Variance Qty', r => fmtQ(r.variance_qty), true], ['Variance %', r => (r.variance_pct === null ? '' : `${r.variance_pct}%`), true], ['Rate', r => fmt2(r.rate), true],
                ['Variance Value', r => fmt2(r.variance_value), true, 'variance_value'], ['Remark', r => r.remark]
            ];
            case 'cost_trend': return [
                ['Output Product', r => r.output_product_name], ['Month', r => r.month], ['Orders', r => r.orders, true], ['Qty (base)', r => `${fmtQ(r.base_qty)} ${r.base_unit}`, true],
                ['Raw Material', r => fmt2(r.raw_material_cost), true, 'raw_material_cost'], ['By-products', r => fmt2(r.byproduct_value), true, 'byproduct_value'],
                ['Net Cost', r => fmt2(r.net_cost), true, 'net_cost'], ['Unit Cost', r => fmt2(r.unit_cost), true], ['Prev. Month', r => fmt2(r.prev_unit_cost), true],
                ['Change %', r => (r.change_pct === null ? '' : `${r.change_pct > 0 ? '▲' : r.change_pct < 0 ? '▼' : ''} ${r.change_pct}%`), true]
            ];
            case 'batch': return [
                ['Output Batch', r => r.output_batch_no || '(no batch)'], ['Mfg', r => r.output_mfg_date], ['Expiry', r => r.output_exp_date], ['Date', r => r.doc_date], ['Order No', r => r.doc_no],
                ['Output', r => `${r.output_product_name} · ${fmtQ(r.output_base_qty)} ${r.base_unit}`],
                ['Raw materials used (batch · qty)', r => r.inputs.map(x => `${x.product_name}${x.batch_no ? ` [${x.batch_no}]` : ''} ${fmtQ(x.base_qty)} ${x.base_unit}`).join('; ')],
                ['By-products', r => r.byproducts.map(x => `${x.product_name}${x.batch_no ? ` [${x.batch_no}]` : ''} ${fmtQ(x.base_qty)} ${x.base_unit}`).join('; ')],
                ['Net Cost', r => fmt2(r.net_output_cost), true, 'net_output_cost']
            ];
            case 'bom_cost': return [
                ['BOM', r => `${r.template}${r.is_active ? '' : ' (inactive)'}`], ['Output', r => r.output_product_name], ['Std Output', r => `${fmtQ(r.standard_output_base_qty)} ${r.base_unit}`, true],
                ['Raw Material Cost', r => fmt2(r.raw_material_cost), true], ['By-product Recovery', r => fmt2(r.byproduct_recovery), true], ['Standard Cost', r => fmt2(r.standard_cost), true],
                ['Std Unit Cost', r => fmt2(r.standard_unit_cost), true], ['Actual Unit Cost (period)', r => fmt2(r.actual_unit_cost), true],
                ['Difference %', r => (r.difference_pct === null ? '' : `${r.difference_pct}%`), true],
                ['Rates', r => (r.missing_rates.length ? `no rate: ${r.missing_rates.join(', ')}` : r.lines.map(l => `${l.product_name} ${fmtQ(l.base_qty)}×${fmt2(l.rate)}${l.rate_source === 'consumption' ? '*' : ''}`).join('; '))]
            ];
            case 'pending': return [
                ['Date', r => r.doc_date], ['Order No', r => r.doc_no], ['Branch', r => r.branch_name], ['Output Product', r => r.output_product_name],
                ['Qty', r => `${fmtQ(r.output_qty)} ${r.output_unit}`, true], ['Raw Material Cost', r => fmt2(r.raw_material_cost), true, 'raw_material_cost'],
                ['Age (days)', r => r.age_days, true], ['Narration', r => r.narration]
            ];
            default: return [
                ...(data.group_by || []).map(g => [groupLabel[g] || g, r => r.groups[g]]),
                ['Orders', r => r.orders, true], ['Qty (base)', r => `${fmtQ(r.base_qty)} ${r.base_unit}`, true], [data.view === 'output' ? 'Net Cost' : 'Amount', r => fmt2(r.amount), true, 'amount'],
                ...(data.view === 'consumption' ? [['of which Terms', r => fmt2(r.term_amount), true, 'term_amount']] : []),
                [data.view === 'output' ? 'Avg Unit Cost' : 'Avg Rate', r => fmt2(r.avg_rate), true]
            ];
        }
    }, [data, groupLabel]);
    const rows = data ? data.rows || [] : [];
    const withUdf = data && ['register', 'details', 'variance', 'batch', 'pending'].includes(data.view);

    const exportCsv = () => {
        if (!data) return;
        const head = [...cols.map(c => c[0]), ...(withUdf ? udf.columns.map(c => c.label) : [])];
        const body = rows.map(r => [...cols.map(c => c[1](r)), ...(withUdf ? udf.values(r, udfKeys).map(x => x.value) : [])]);
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...body].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `production_${data.view}_${config.from_date}_${config.to_date}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">🏭 Production Reports</span></div>
            <div className="erp-tab-content">
                <div className="print:hidden">
                    <div className="flex flex-wrap gap-1 mb-3 border-b">
                        {VIEWS.map(([k, l]) => (
                            <button key={k} className={`px-3 py-2 text-sm ${config.view === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => switchView(k)}>{l}</button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-3">
                        <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.from_date} onChange={e => set('from_date', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.to_date} onChange={e => set('to_date', e.target.value)} /></div>
                        {config.view !== 'pending' && <MultiPick label="Status" items={[{ id: 'posted', name: 'Posted' }, { id: 'draft', name: 'Draft' }, { id: 'cancelled', name: 'Cancelled' }]} value={config.statuses} onChange={v => set('statuses', v.length ? v : ['posted'])} />}
                        <MultiPick label="Branch" items={meta?.branches || []} value={config.branch_ids} onChange={v => set('branch_ids', v)} />
                        <MultiPick label="Output Product" items={meta?.products || []} value={config.output_product_ids} onChange={v => set('output_product_ids', v)} />
                        <MultiPick label="Raw Material / By-product" items={meta?.products || []} value={config.product_ids} onChange={v => set('product_ids', v)} />
                        <MultiPick label="Product Group" items={meta?.product_groups || []} value={config.product_group_ids} onChange={v => set('product_group_ids', v)} />
                        <MultiPick label="BOM Template" items={meta?.templates || []} value={config.bom_template_ids} onChange={v => set('bom_template_ids', v)} />
                        <div className="erp-field"><label className="erp-label">Search (order no / batch / narration)</label>
                            <input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                        {GROUPED.includes(config.view) && [0, 1, 2].map(i => (
                            <div key={i} className="erp-field"><label className="erp-label">Group by {i + 1}</label>
                                <select className="erp-select" value={config.group_by[i] || ''} onChange={e => set('group_by', e.target.value ? Object.assign(config.group_by.slice(0, 3), { [i]: e.target.value }) : config.group_by.slice(0, i))}>
                                    {i > 0 && <option value="">(none)</option>}
                                    {(meta?.groups || []).filter(g => g.key !== 'output_product' || config.view !== 'output').map(g => (
                                        <option key={g.key} value={g.key} disabled={config.group_by.includes(g.key) && config.group_by[i] !== g.key}>{g.label}</option>
                                    ))}
                                </select></div>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                        <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                        {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                        {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                        {udf.picker}
                        <button className="erp-btn" onClick={() => { setConfig(defaultConfig()); setData(null); }}>↺ Reset</button>
                    </div>
                    {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                </div>

                {data && (
                    <>
                        <div className="flex flex-wrap gap-4 text-xs text-gray-600 mb-2">
                            <span>{VIEWS.find(v => v[0] === data.view)?.[1]} · {config.from_date} to {config.to_date}</span>
                            <span>Orders <b>{data.totals.orders}</b></span>
                            <span>Raw material <b>{fmt2(data.totals.raw_material_cost)}</b></span>
                            <span>By-products <b>{fmt2(data.totals.byproduct_value)}</b></span>
                            <span>Net output cost <b>{fmt2(data.totals.net_output_cost)}</b></span>
                            {data.view === 'variance' && <span>Orders without BOM: {data.orders_without_bom}</span>}
                            {data.view === 'bom_cost' && <span>Standard cost at the latest purchase rate (* = average consumption rate of the period, no purchase rate)</span>}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table w-full text-sm">
                                <thead><tr>{cols.map(c => <th key={c[0]} className={c[2] ? 'text-right' : 'text-left'}>{c[0]}</th>)}{withUdf && udf.headers('text-left')}</tr></thead>
                                <tbody>
                                    {rows.map((r, i) => (
                                        <tr key={r.key || `${r.doc_id}-${r.line_id || r.product_id || ''}-${i}`} className={r.line_type === 'output' ? 'bg-green-50' : r.line_type === 'byproduct' ? 'bg-amber-50' : r.variance_value > 0 ? 'text-red-700' : ''}>
                                            {cols.map(c => <td key={c[0]} className={c[2] ? 'text-right tabular-nums' : ''}>{c[1](r)}</td>)}
                                            {withUdf && udf.cells(r, udfKeys, '')}
                                        </tr>
                                    ))}
                                    {!rows.length && <tr><td colSpan={cols.length + (withUdf ? udf.count : 0)} className="text-center text-gray-400 py-4">No production for these filters.</td></tr>}
                                </tbody>
                                {rows.length > 0 && cols.some(c => c[3]) && (
                                    <tfoot><tr className="font-bold bg-blue-50">
                                        {cols.map((c, i) => <td key={c[0]} className="text-right tabular-nums">{c[3] ? fmt2(rows.reduce((s, r) => s + (Number(r[c[3]]) || 0), 0)) : i === 0 ? 'Total' : ''}</td>)}
                                        {withUdf && udf.columns.map(c => <td key={c.key} />)}
                                    </tr></tfoot>
                                )}
                            </table>
                        </div>
                        {data.view === 'variance' && data.by_product?.length > 0 && (
                            <div className="mt-4">
                                <div className="text-sm font-semibold mb-1">Raw material-wise variance</div>
                                <table className="erp-grid-table w-full text-sm">
                                    <thead><tr><th className="text-left">Raw Material</th><th className="text-right">Orders</th><th className="text-right">Standard</th><th className="text-right">Actual</th>
                                        <th className="text-right">Variance</th><th className="text-right">Variance %</th><th className="text-right">Variance Value</th></tr></thead>
                                    <tbody>{data.by_product.map(p => (
                                        <tr key={p.product_id} className={p.variance_value > 0 ? 'text-red-700' : 'text-green-700'}>
                                            <td>{p.product_name}</td><td className="text-right">{p.orders}</td><td className="text-right tabular-nums">{fmtQ(p.standard_qty)} {p.base_unit}</td>
                                            <td className="text-right tabular-nums">{fmtQ(p.actual_qty)}</td><td className="text-right tabular-nums">{fmtQ(p.variance_qty)}</td>
                                            <td className="text-right">{p.variance_pct === null ? '' : `${p.variance_pct}%`}</td><td className="text-right tabular-nums">{fmt2(p.variance_value)}</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
