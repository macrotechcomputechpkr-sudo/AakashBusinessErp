// =============================================
// LoadingSheet.jsx
// Loading Sheet (server: utils/loadingSheet.js) - items to load on the
// vehicle for chosen sales documents, the bill list for the delivery man
// and an optional bill x item detail, ready to print.
// Lines from Goods Delivery and / or Sales Bill (a bill made from a
// delivery is not counted twice); returns optional (own column, deducted
// from Net). Filters: date range, customer, bill, agent, area, route, item,
// group, company, branch, warehouse, vehicle, draft.
// Qty shown as chosen: by the item's UOM mode (fixed dual "5 Crt 2 Pcs ·
// Total 62 Pcs", flexible "5 Crt = 10 Pcs"), base unit, as entered, split
// into chosen units (2 Ctn 3 Box 4 Pcs), one chosen unit, alt qty, dual
// qty, free qty separate or added.
// Amounts per item: basic, discount, VAT, each bill-level term (Sales
// Additional Entries of the bill, spread over its lines), term total and
// net amount - item net amounts add up to the bill totals. Optional Bill
// Summary with the fields the user picks.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useUdfColumns } from '../components/UdfColumns';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtQ = n => (Number(n) ? (Math.round(Number(n) * 10000) / 10000).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '');
const parts = list => (list || []).map(p => `${fmtQ(p.qty)} ${p.unit}`).join(' + ');

const QTY_VIEWS = [
    { key: 'uom', label: 'By UOM mode (5 Crt 2 Pcs · Total 62 Pcs / 5 Crt = 10 Pcs)' }, { key: 'breakdown', label: 'Split into units (2 Ctn 3 Box 4 Pcs)' },
    { key: 'entered', label: 'As entered (5 Box + 12 Pcs)' }, { key: 'base', label: 'Base unit qty' }, { key: 'in_unit', label: 'Qty in one unit' },
    { key: 'alt', label: 'Alt qty' }, { key: 'dual', label: 'Dual qty (Crt + Pcs)' }, { key: 'free', label: 'Free qty' }
];
const AMOUNT_VIEWS = [
    { key: 'basic', label: 'Basic Amount' }, { key: 'discount', label: 'Discount' }, { key: 'vat', label: 'VAT' },
    { key: 'other', label: 'Bill terms (each)' }, { key: 'term', label: 'Term Amount (total)' }, { key: 'net_amount', label: 'Net Amount' }
];
const BILL_FIELDS = [
    { key: 'doc_no', label: 'Bill No' }, { key: 'doc_date', label: 'Date' }, { key: 'party_name', label: 'Customer' }, { key: 'agent_name', label: 'Agent' },
    { key: 'party_address', label: 'Address' }, { key: 'party_phone', label: 'Phone' }, { key: 'route_name', label: 'Route' }, { key: 'area_name', label: 'Area' },
    { key: 'vehicle_no', label: 'Vehicle' }, { key: 'items', label: 'Items' }, { key: 'basic', label: 'Basic Amount', amt: true },
    { key: 'discount', label: 'Discount', amt: true }, { key: 'vat', label: 'VAT', amt: true }, { key: 'other', label: 'Bill terms (each)', amt: true },
    { key: 'term', label: 'Term Amount', amt: true }, { key: 'net_amount', label: 'Net Amount', amt: true }, { key: 'sign', label: 'Received / Sign' }
];
const FILTERS = [
    ['party_ids', 'Customer', m => m.customers], ['agent_ids', 'Salesman / Agent', m => m.agents], ['area_ids', 'Area (+ sub)', m => m.areas],
    ['route_ids', 'Route', m => m.routes], ['product_ids', 'Item', m => m.products], ['product_group_ids', 'Product Group (+ sub)', m => m.product_groups],
    ['product_company_ids', 'Product Company', m => m.product_companies], ['branch_ids', 'Branch', m => m.branches], ['warehouse_ids', 'Warehouse', m => m.warehouses]
];
const defaultConfig = () => ({
    date_from: iso(new Date()), date_to: iso(new Date()), sources: ['bill'], include_returns: false, include_draft: false,
    doc_ids: [], vehicle_no: '', search: '', ...Object.fromEntries(FILTERS.map(([k]) => [k, []])),
    views: ['uom', 'free'], amounts: ['basic', 'term', 'net_amount'], breakdown_unit_ids: [], display_unit_id: '', free: 'separate',
    group_by: 'none', sort_by: 'name', sections: ['items', 'bills'],
    bill_fields: ['doc_no', 'doc_date', 'party_name', 'agent_name', 'party_address', 'party_phone', 'route_name', 'area_name', 'basic', 'term', 'net_amount', 'sign']
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

    const udf = useUdfColumns('loading-sheet', ['sales_bill', 'sales_delivery', 'sales_return', 'sales_nonsaleable_return']);
    const udfLoad = udf.load;
    useEffect(() => { if (data) udfLoad(data.bills); }, [data, udfLoad]);
    const V = k => config.views.includes(k);
    const R = !!data?.with_returns;
    // Qty cells of one presentation block (load / returned / net).
    const A = k => config.amounts.includes(k);
    const termNames = data?.term_names || [];
    const qtyCols = [
        V('uom') && { key: 'uom', label: 'Qty (UOM)', get: q => q.uom, strong: true },
        V('breakdown') && { key: 'breakdown', label: `Qty${data?.breakdown_units?.length ? ` (${data.breakdown_units.join(' / ')})` : ' (split)'}`, get: q => q.breakdown, strong: !V('uom') },
        V('entered') && { key: 'entered', label: 'As entered', get: q => parts(q.entered) },
        V('base') && { key: 'base', label: 'Base Qty', get: q => `${fmtQ(q.base_qty)} ${q.base_unit}` },
        V('in_unit') && data?.display_unit && { key: 'in_unit', label: `Qty (${data.display_unit})`, get: q => (q.in_unit ? `${fmtQ(q.in_unit.qty)}${q.in_unit.fallback ? ` ${q.in_unit.unit}` : ''}` : '') },
        V('alt') && { key: 'alt', label: 'Alt Qty', get: q => parts(q.alt) },
        V('dual') && { key: 'dual', label: 'Dual Qty', get: q => q.dual || '' },
        V('free') && data?.free === 'separate' && { key: 'free', label: 'Free (base)', get: q => fmtQ(q.free) },
        A('basic') && { key: 'basic', label: 'Basic Amt', get: q => fmt2(q.basic), num: true },
        A('discount') && { key: 'discount', label: 'Discount', get: q => fmt2(q.discount), num: true },
        A('vat') && { key: 'vat', label: 'VAT', get: q => fmt2(q.vat), num: true },
        ...(A('other') ? termNames.map(n => ({ key: `o:${n}`, label: n, get: q => fmt2(q.other?.[n]), num: true })) : []),
        A('term') && { key: 'term', label: 'Term Amt', get: q => fmt2(q.term), num: true },
        A('net_amount') && { key: 'net_amount', label: 'Net Amount', get: q => fmt2(q.net_amount), num: true, strong: true }
    ].filter(Boolean);
    // Bill summary columns.
    const billCols = BILL_FIELDS.filter(f => config.bill_fields.includes(f.key)).flatMap(f => (f.key === 'other' ? termNames.map(n => ({ key: `o:${n}`, label: n, amt: true, get: b => b.other?.[n] })) : [{ ...f, get: b => b[f.key] }]))
        .concat(udf.columns.map(col => ({ key: `udf:${col.key}`, label: col.label, get: b => udf.valueOf(b, col) })));
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
        const bc = billCols.filter(f => f.key !== 'sign');
        rows.push(['Document', ...bc.map(f => f.label)]);
        data.bills.forEach(b => { const sg = b.kind === 'main' || b.kind === 'delivery' ? 1 : -1; rows.push([b.doc_label, ...bc.map(f => (f.amt ? sg * (Number(f.get(b)) || 0) : f.get(b) ?? ''))]); });
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
                    <div className="erp-field mb-2"><label className="erp-label">Item amounts</label>
                        <div className="flex flex-wrap gap-3 text-sm items-center">
                            {AMOUNT_VIEWS.map(v => <label key={v.key} className="flex items-center gap-1"><input type="checkbox" checked={config.amounts.includes(v.key)} onChange={() => toggle('amounts', v.key)} /> {v.label}</label>)}
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
                                {[['items', 'Items'], ['bills', 'Bill Summary'], ['detail', 'Bill x Item']].map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={config.sections.includes(k)} onChange={() => toggle('sections', k)} /> {l}</label>)}
                            </div></div>
                    </div>

                    {config.sections.includes('bills') && (
                        <div className="erp-field mb-2"><label className="erp-label">Bill Summary fields</label>
                            <div className="flex flex-wrap gap-3 text-sm items-center">
                                {BILL_FIELDS.map(f => <label key={f.key} className="flex items-center gap-1"><input type="checkbox" checked={config.bill_fields.includes(f.key)} onChange={() => toggle('bill_fields', f.key)} /> {f.label}</label>)}
                                {udf.picker}
                            </div></div>
                    )}

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
                            <p className="text-xs text-gray-600">{data.totals.bills} documents · {data.totals.customers} customers · {data.totals.items} items · Net Amount {fmt2(data.totals.load.net_amount)}{data.with_returns ? ` · Returns ${data.totals.returns} (${fmt2(data.totals.returned.net_amount)}) · Net after returns ${fmt2(data.totals.net_amount)}` : ''}</p>
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
                                    {data.items.length > 0 && qtyCols.some(c => c.num) && (
                                        <tfoot><tr className="font-bold bg-blue-50">
                                            <td colSpan={3} className="text-right">Total</td>
                                            {blocks.map(([k]) => qtyCols.map(c => {
                                                if (!c.num) return <td key={`${k}${c.key}`} />;
                                                const field = c.key.startsWith('o:') ? null : c.key;
                                                const v = data.items.reduce((s, r) => s + (Number(field ? r[k]?.[field] : r[k]?.other?.[c.key.slice(2)]) || 0), 0);
                                                return <td key={`${k}${c.key}`} className="text-right tabular-nums">{fmt2(v)}</td>;
                                            }))}
                                            <td />
                                        </tr></tfoot>
                                    )}
                                </table>
                            </div>
                        )}

                        {config.sections.includes('bills') && (
                            <div className="overflow-x-auto mb-4">
                                <p className="font-semibold mb-1">Bill Summary</p>
                                <table className="erp-grid-table w-full">
                                    <thead><tr>
                                        <th className="text-left w-8">#</th>
                                        {billCols.map(f => <th key={f.key} className={`${f.amt ? 'text-right' : 'text-left'} whitespace-nowrap ${f.key === 'sign' ? 'w-28' : ''}`}>{f.label}</th>)}
                                    </tr></thead>
                                    <tbody>
                                        {data.bills.map((b, i) => {
                                            const ret = b.kind === 'return' || b.kind === 'nonsalable';
                                            return (
                                                <tr key={b.doc_id} className={ret ? 'text-red-700' : ''}>
                                                    <td className="text-gray-400">{i + 1}</td>
                                                    {billCols.map(f => (
                                                        <td key={f.key} className={f.amt ? 'text-right tabular-nums whitespace-nowrap' : ''}>
                                                            {f.key === 'sign' ? '' : f.amt ? `${ret && Number(f.get(b)) ? '-' : ''}${fmt2(f.get(b))}` : f.get(b) ?? ''}
                                                            {f.key === 'doc_no' && <span className="text-[10px] text-gray-500 ml-1">{b.kind === 'delivery' ? 'GDN' : ret ? b.doc_label : ''}{b.status === 'draft' ? ' (draft)' : ''}</span>}
                                                        </td>
                                                    ))}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    {billCols.some(f => f.amt) && (
                                        <tfoot><tr className="font-bold bg-blue-50">
                                            <td />
                                            {billCols.map((f, i) => {
                                                if (!f.amt) return <td key={f.key} className="text-right">{i === billCols.findIndex(x => x.amt) - 1 ? 'Total' : ''}</td>;
                                                const v = data.bills.reduce((s, b) => s + (b.kind === 'return' || b.kind === 'nonsalable' ? -1 : 1) * (Number(f.get(b)) || 0), 0);
                                                return <td key={f.key} className="text-right tabular-nums">{fmt2(v)}</td>;
                                            })}
                                        </tr></tfoot>
                                    )}
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
                                                        <td>{l.uom}</td>
                                                        <td className="text-gray-500">{l.free_qty ? `Free ${fmtQ(l.free_qty)}` : ''}</td>
                                                        <td className="text-gray-500">{l.batch_no || ''}</td>
                                                        <td className="text-right tabular-nums text-gray-500">{fmt2(l.basic)}</td>
                                                        <td className="text-right tabular-nums font-semibold">{fmt2(l.net_amount)}</td>
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
