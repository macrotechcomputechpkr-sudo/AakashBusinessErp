// =============================================
// LoadingSheet.jsx
// Loading Sheet (server: utils/loadingSheet.js) - items to load on the
// vehicle for chosen sales documents, the bill list for the delivery man
// and an optional bill x item detail, ready to print.
// Lines from Goods Delivery and / or Sales Bill (a bill made from a
// delivery is not counted twice); returns optional (own column, deducted
// from Net). Filters: date range, customer, bill, agent, area, route, item,
// group, company, branch, warehouse, vehicle, draft.
// Qty shown as chosen: base unit, as entered (5 Box + 12 Pcs), split into
// chosen units (2 Ctn 3 Box 4 Pcs), one chosen unit, alt qty, dual qty,
// free qty separate or added.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtQ = n => (Number(n) ? (Math.round(Number(n) * 10000) / 10000).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '');
const parts = list => (list || []).map(p => `${fmtQ(p.qty)} ${p.unit}`).join(' + ');

const QTY_VIEWS = [
    { key: 'breakdown', label: 'Split into units (2 Ctn 3 Box 4 Pcs)' }, { key: 'entered', label: 'As entered (5 Box + 12 Pcs)' },
    { key: 'base', label: 'Base unit qty' }, { key: 'in_unit', label: 'Qty in one unit' }, { key: 'alt', label: 'Alt qty' },
    { key: 'dual', label: 'Dual qty (Crt + Pcs)' }, { key: 'free', label: 'Free qty' }, { key: 'value', label: 'Value' }
];
const FILTERS = [
    ['party_ids', 'Customer', m => m.customers], ['agent_ids', 'Salesman / Agent', m => m.agents], ['area_ids', 'Area (+ sub)', m => m.areas],
    ['route_ids', 'Route', m => m.routes], ['product_ids', 'Item', m => m.products], ['product_group_ids', 'Product Group (+ sub)', m => m.product_groups],
    ['product_company_ids', 'Product Company', m => m.product_companies], ['branch_ids', 'Branch', m => m.branches], ['warehouse_ids', 'Warehouse', m => m.warehouses]
];
const defaultConfig = () => ({
    date_from: iso(new Date()), date_to: iso(new Date()), sources: ['bill'], include_returns: false, include_draft: false,
    doc_ids: [], vehicle_no: '', search: '', ...Object.fromEntries(FILTERS.map(([k]) => [k, []])),
    views: ['breakdown', 'entered', 'free'], breakdown_unit_ids: [], display_unit_id: '', free: 'separate',
    group_by: 'none', sort_by: 'name', sections: ['items', 'bills']
});

export default function LoadingSheet() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [meta, setMeta] = useState(null);
    const [docs, setDocs] = useState([]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const toggle = (k, v) => setConfig(c => ({ ...c, [k]: c[k].includes(v) ? c[k].filter(x => x !== v) : [...c[k], v] }));

    useEffect(() => { authFetch('/api/reports/trade-meta?side=sales').then(r => setMeta(r.data)).catch(e => setError(e.message)); }, [authFetch]);

    const params = useCallback((cfg, withDocs = true) => {
        const p = new URLSearchParams({ date_from: cfg.date_from, date_to: cfg.date_to, sources: cfg.sources.join(','),
            include_returns: String(cfg.include_returns), include_draft: String(cfg.include_draft), free: cfg.free, group_by: cfg.group_by, sort_by: cfg.sort_by });
        FILTERS.forEach(([k]) => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
        if (withDocs && cfg.doc_ids.length) p.set('doc_ids', cfg.doc_ids.join(','));
        if (cfg.vehicle_no) p.set('vehicle_no', cfg.vehicle_no);
        if (cfg.search) p.set('search', cfg.search);
        if (cfg.breakdown_unit_ids.length) p.set('breakdown_unit_ids', cfg.breakdown_unit_ids.join(','));
        if (cfg.display_unit_id) p.set('display_unit_id', cfg.display_unit_id);
        return p;
    }, []);

    // Bill picker follows the other filters.
    const docKey = params({ ...config, doc_ids: [] }, false).toString();
    useEffect(() => {
        if (!config.date_from || !config.date_to || config.date_to < config.date_from) return undefined;
        let live = true;
        const timer = setTimeout(() => authFetch(`/api/reports/loading-sheet/docs?${docKey}`).then(r => live && setDocs(r.data || [])).catch(() => live && setDocs([])), 400);
        return () => { live = false; clearTimeout(timer); };
    }, [authFetch, docKey, config.date_from, config.date_to]);

    const run = useCallback(async (cfg = config) => {
        if (!cfg.sources.length) { setError('Choose Goods Delivery and / or Sales Bill'); return; }
        setLoading(true); setError('');
        try { setData((await authFetch(`/api/reports/loading-sheet?${params(cfg)}`)).data); }
        catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config, params]);

    const V = k => config.views.includes(k);
    const R = !!data?.with_returns;
    // Qty cells of one presentation block (load / returned / net).
    const qtyCols = [
        V('breakdown') && { key: 'breakdown', label: `Qty${data?.breakdown_units?.length ? ` (${data.breakdown_units.join(' / ')})` : ''}`, get: q => q.breakdown, strong: true },
        V('entered') && { key: 'entered', label: 'As entered', get: q => parts(q.entered) },
        V('base') && { key: 'base', label: 'Base Qty', get: q => `${fmtQ(q.base_qty)} ${q.base_unit}` },
        V('in_unit') && data?.display_unit && { key: 'in_unit', label: `Qty (${data.display_unit})`, get: q => (q.in_unit ? `${fmtQ(q.in_unit.qty)}${q.in_unit.fallback ? ` ${q.in_unit.unit}` : ''}` : '') },
        V('alt') && { key: 'alt', label: 'Alt Qty', get: q => parts(q.alt) },
        V('dual') && { key: 'dual', label: 'Dual Qty', get: q => q.dual || '' },
        V('free') && data?.free === 'separate' && { key: 'free', label: 'Free (base)', get: q => fmtQ(q.free) },
        V('value') && { key: 'value', label: 'Value', get: q => fmt2(q.value), num: true }
    ].filter(Boolean);
    const blocks = R ? [['load', 'Loaded'], ['returned', 'Returned'], ['net', 'Net']] : [['load', null]];

    const groups = (() => {
        if (!data) return [];
        if (data.group_by === 'none') return [{ name: null, rows: data.items }];
        const out = [];
        data.items.forEach(r => { let g = out[out.length - 1]; if (!g || g.name !== r.group_name) out.push(g = { name: r.group_name, rows: [] }); g.rows.push(r); });
        return out;
    })();

    const exportCsv = () => {
        if (!data) return;
        const head = ['Code', 'Item', ...(data.group_by !== 'none' ? ['Group'] : []), ...blocks.flatMap(([, bl]) => qtyCols.map(c => (bl ? `${bl} ${c.label}` : c.label))), 'Bills'];
        const rows = data.items.map(r => [r.product_code, r.product_name, ...(data.group_by !== 'none' ? [r.group_name] : []), ...blocks.flatMap(([k]) => qtyCols.map(c => c.get(r[k]))), r.docs]);
        rows.push([]);
        rows.push(['Document', 'No', 'Date', 'Customer', 'Area', 'Route', 'Agent', 'Vehicle', 'Items', 'Amount']);
        data.bills.forEach(b => rows.push([b.doc_label, b.doc_no, b.doc_date, b.party_name, b.area_name, b.route_name, b.agent_name, b.vehicle_no || '', b.items, b.kind === 'main' || b.kind === 'delivery' ? b.amount : -b.amount]));
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `loading_sheet_${data.from}_${data.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };
    const nameOf = (list, ids) => ids.map(id => (list || []).find(x => x.id === id)?.name).filter(Boolean).join(', ');

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">🚚 Loading Sheet</span></div>
            <div className="erp-tab-content">
                <div className="print:hidden">
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                        <div className="erp-field md:col-span-2"><label className="erp-label">Lines from</label>
                            <div className="flex flex-wrap gap-3 items-center min-h-9 text-sm">
                                <label className="flex items-center gap-1"><input type="checkbox" checked={config.sources.includes('delivery')} onChange={() => toggle('sources', 'delivery')} /> Goods Delivery</label>
                                <label className="flex items-center gap-1"><input type="checkbox" checked={config.sources.includes('bill')} onChange={() => toggle('sources', 'bill')} /> Sales Bill</label>
                            </div></div>
                        <div className="erp-field md:col-span-2"><label className="erp-label">Returns / Drafts</label>
                            <div className="flex flex-wrap gap-3 items-center min-h-9 text-sm">
                                <label className="flex items-center gap-1"><input type="checkbox" checked={config.include_returns} onChange={e => set('include_returns', e.target.checked)} /> Include returns (deduct)</label>
                                <label className="flex items-center gap-1"><input type="checkbox" checked={config.include_draft} onChange={e => set('include_draft', e.target.checked)} /> Include drafts</label>
                            </div></div>
                    </div>

                    {meta && (
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                            <MultiPick label={`Bill / GDN (${docs.length})`} items={docs} value={config.doc_ids} onChange={v => set('doc_ids', v)} />
                            {FILTERS.map(([k, label, items]) => <MultiPick key={k} label={label} items={items(meta) || []} value={config[k]} onChange={v => set(k, v)} />)}
                            <div className="erp-field"><label className="erp-label">Vehicle No</label><input className="erp-input" value={config.vehicle_no} placeholder="GDN vehicle" onChange={e => set('vehicle_no', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">Search item / code</label>
                                <input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                        </div>
                    )}

                    <div className="erp-field mb-2"><label className="erp-label">Show qty as</label>
                        <div className="flex flex-wrap gap-3 text-sm items-center">
                            {QTY_VIEWS.map(v => <label key={v.key} className="flex items-center gap-1"><input type="checkbox" checked={V(v.key)} onChange={() => toggle('views', v.key)} /> {v.label}</label>)}
                        </div></div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        {meta && V('breakdown') && <MultiPick label="Split into units" allLabel="All units of each item" items={meta.units || []} value={config.breakdown_unit_ids} onChange={v => set('breakdown_unit_ids', v)} />}
                        {meta && V('in_unit') && (
                            <div className="erp-field"><label className="erp-label">Qty in unit</label>
                                <select className="erp-select" value={config.display_unit_id} onChange={e => set('display_unit_id', e.target.value)}>
                                    <option value="">Choose unit</option>{(meta.units || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select></div>
                        )}
                        <div className="erp-field"><label className="erp-label">Free qty</label>
                            <select className="erp-select" value={config.free} onChange={e => set('free', e.target.value)}>
                                <option value="separate">Separate column</option><option value="add">Add to loading qty</option>
                            </select></div>
                        <div className="erp-field"><label className="erp-label">Group items by</label>
                            <select className="erp-select" value={config.group_by} onChange={e => set('group_by', e.target.value)}>
                                <option value="none">None</option><option value="product_group">Product Group</option><option value="main_group">Main Group</option>
                                <option value="company">Product Company</option><option value="warehouse">Warehouse (pick from)</option>
                            </select></div>
                        <div className="erp-field"><label className="erp-label">Sort items by</label>
                            <select className="erp-select" value={config.sort_by} onChange={e => set('sort_by', e.target.value)}><option value="name">Name</option><option value="code">Code</option></select></div>
                        <div className="erp-field"><label className="erp-label">Print sections</label>
                            <div className="flex flex-wrap gap-2 text-sm items-center min-h-9">
                                {[['items', 'Items'], ['bills', 'Bills'], ['detail', 'Bill x Item']].map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={config.sections.includes(k)} onChange={() => toggle('sections', k)} /> {l}</label>)}
                            </div></div>
                    </div>

                    <div className="flex gap-2 mb-3">
                        <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                        {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                        {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                        <button className="erp-btn" onClick={() => { setConfig(defaultConfig()); setData(null); }}>↺ Reset</button>
                    </div>
                    {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                    {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}
                </div>

                {data && (
                    <div className="text-sm">
                        <div className="mb-3 border-b pb-2">
                            <h2 className="text-lg font-bold">Loading Sheet</h2>
                            <p className="text-xs text-gray-600">
                                {data.from === data.to ? data.from : `${data.from} to ${data.to}`} · {data.sources.map(s => (s === 'delivery' ? 'Goods Delivery' : 'Sales Bill')).join(' + ')}{data.with_returns ? ' · returns deducted' : ''}
                                {config.agent_ids.length > 0 && ` · Agent: ${nameOf(meta?.agents, config.agent_ids)}`}
                                {config.area_ids.length > 0 && ` · Area: ${nameOf(meta?.areas, config.area_ids)}`}
                                {config.route_ids.length > 0 && ` · Route: ${nameOf(meta?.routes, config.route_ids)}`}
                                {data.vehicles.length > 0 && ` · Vehicle: ${data.vehicles.join(', ')}`}
                            </p>
                            <p className="text-xs text-gray-600">{data.totals.bills} documents · {data.totals.customers} customers · {data.totals.items} items · Amount {fmt2(data.totals.amount)}{data.with_returns ? ` · Returns ${data.totals.returns} (${fmt2(data.totals.return_amount)})` : ''}</p>
                        </div>

                        {config.sections.includes('items') && (
                            <div className="overflow-x-auto mb-4">
                                <table className="erp-grid-table w-full">
                                    <thead>
                                        {R && <tr><th colSpan={3} />{blocks.map(([k, l]) => <th key={k} colSpan={qtyCols.length} className={`text-center ${k === 'net' ? 'bg-blue-50' : k === 'returned' ? 'bg-red-50' : 'bg-green-50'}`}>{l}</th>)}<th /></tr>}
                                        <tr>
                                            <th className="text-left w-8">#</th><th className="text-left">Code</th><th className="text-left">Item</th>
                                            {blocks.map(([k]) => qtyCols.map(c => <th key={`${k}${c.key}`} className={`${c.num ? 'text-right' : 'text-left'} whitespace-nowrap`}>{c.label}</th>))}
                                            <th className="text-right">Bills</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {groups.map((g, gi) => (
                                            <React.Fragment key={g.name ?? gi}>
                                                {g.name !== null && <tr className="bg-gray-100"><td colSpan={4 + blocks.length * qtyCols.length} className="font-semibold">{g.name}</td></tr>}
                                                {g.rows.map((r, i) => (
                                                    <tr key={r.product_id}>
                                                        <td className="text-gray-400">{i + 1}</td><td className="text-gray-500">{r.product_code}</td><td>{r.product_name}</td>
                                                        {blocks.map(([k]) => qtyCols.map(c => (
                                                            <td key={`${k}${c.key}`} className={`${c.num ? 'text-right tabular-nums' : ''} ${c.strong ? 'font-semibold' : ''} whitespace-nowrap`}>{c.get(r[k])}</td>
                                                        )))}
                                                        <td className="text-right">{r.docs}</td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                        {data.items.length === 0 && <tr><td colSpan={4 + blocks.length * qtyCols.length} className="text-center text-gray-400 py-4">Nothing to load for these filters.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {config.sections.includes('bills') && (
                            <div className="overflow-x-auto mb-4">
                                <p className="font-semibold mb-1">Bills</p>
                                <table className="erp-grid-table w-full">
                                    <thead><tr>
                                        <th className="text-left w-8">#</th><th className="text-left">Document</th><th className="text-left">Date</th><th className="text-left">Customer</th>
                                        <th className="text-left">Area / Route</th><th className="text-left">Agent</th><th className="text-left">Vehicle</th><th className="text-right">Items</th>
                                        <th className="text-right">Amount</th><th className="text-left w-28">Received / Sign</th>
                                    </tr></thead>
                                    <tbody>
                                        {data.bills.map((b, i) => {
                                            const ret = b.kind === 'return' || b.kind === 'nonsalable';
                                            return (
                                                <tr key={b.doc_id} className={ret ? 'text-red-700' : ''}>
                                                    <td className="text-gray-400">{i + 1}</td>
                                                    <td>{b.doc_no} <span className="text-[10px] text-gray-500">{b.kind === 'delivery' ? 'GDN' : ret ? b.doc_label : ''}{b.status === 'draft' ? ' (draft)' : ''}</span></td>
                                                    <td>{b.doc_date}</td><td>{b.party_name}{b.delivery_address ? <div className="text-[10px] text-gray-500">{b.delivery_address}</div> : null}</td>
                                                    <td>{[b.area_name, b.route_name].filter(Boolean).join(' / ')}</td><td>{b.agent_name}</td><td>{b.vehicle_no || ''}</td>
                                                    <td className="text-right">{b.items}</td><td className="text-right tabular-nums">{ret ? '-' : ''}{fmt2(b.amount)}</td><td />
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot><tr className="font-bold bg-blue-50"><td colSpan={8} className="text-right">Total</td><td className="text-right tabular-nums">{fmt2(data.totals.amount - (data.with_returns ? data.totals.return_amount : 0))}</td><td /></tr></tfoot>
                                </table>
                            </div>
                        )}

                        {config.sections.includes('detail') && (
                            <div className="mb-4">
                                <p className="font-semibold mb-1">Bill x Item</p>
                                {data.bills.map(b => (
                                    <div key={b.doc_id} className="mb-2 break-inside-avoid">
                                        <p className="text-xs font-semibold bg-gray-100 px-2 py-1">{b.doc_no} · {b.doc_date} · {b.party_name}{b.kind !== 'main' && b.kind !== 'delivery' ? ` · ${b.doc_label}` : ''}</p>
                                        <table className="erp-grid-table w-full text-xs">
                                            <tbody>
                                                {b.lines.map((l, i) => (
                                                    <tr key={i}>
                                                        <td className="w-1/3">{l.product_name}</td>
                                                        <td>{fmtQ(l.qty)} {l.unit}{l.alt_qty ? ` + ${fmtQ(l.alt_qty)} ${l.alt_unit}` : ''}</td>
                                                        <td className="text-gray-500">{l.dual || `${fmtQ(l.base_qty)} ${l.base_unit}`}</td>
                                                        <td className="text-gray-500">{l.free_qty ? `Free ${fmtQ(l.free_qty)}` : ''}</td>
                                                        <td className="text-gray-500">{l.batch_no || ''}</td>
                                                        <td className="text-right tabular-nums">{fmt2(l.amount)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="grid grid-cols-4 gap-6 mt-10 text-xs text-center">
                            {['Prepared by', 'Loaded by', 'Checked by', 'Driver'].map(s => <div key={s} className="border-t pt-1">{s}</div>)}
                        </div>
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
