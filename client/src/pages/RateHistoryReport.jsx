// =============================================
// RateHistoryReport.jsx
// Rate History - sales (customer-wise) or purchase (supplier-wise) rates
// per item (server: rateHistory in utils/tradeAnalysis.js):
//   Summary - per customer / supplier + item (or item / party only): last
//             rate and date, last net rate per base unit, min / max / avg,
//             change % from the first to the last rate in the period
//   History - every bill line: date, bill, party bill no, party, item, qty,
//             alt qty, free, rate (and its unit), discount %, net rate
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

const defaultConfig = () => {
    const d = new Date();
    return { side: 'sales', date_from: `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, date_to: iso(d), group_by: 'party_product', kinds: ['main'],
        party_ids: [], product_ids: [], product_group_ids: [], product_company_ids: [], area_ids: [], search: '' };
};

export default function RateHistoryReport() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [meta, setMeta] = useState(null);
    const [data, setData] = useState(null);
    const [view, setView] = useState('summary');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [focus, setFocus] = useState(null);             // summary row -> its history
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const udf = useUdfColumns('rate-history', config.side === 'purchase' ? ['purchase_bill', 'purchase_return', 'purchase_nonsaleable_return'] : ['sales_bill', 'sales_return', 'sales_nonsaleable_return']);
    const udfLoad = udf.load;
    useEffect(() => { if (data) udfLoad(data.history); }, [data, udfLoad]);

    useEffect(() => { authFetch(`/api/reports/trade-meta?side=${config.side}`).then(r => setMeta(r.data)).catch(e => setError(e.message)); }, [authFetch, config.side]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError(''); setFocus(null);
        try {
            const p = new URLSearchParams({ side: cfg.side, date_from: cfg.date_from, date_to: cfg.date_to, group_by: cfg.group_by, kinds: cfg.kinds.join(',') });
            ['party_ids', 'product_ids', 'product_group_ids', 'product_company_ids', 'area_ids'].forEach(k => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            if (cfg.search) p.set('search', cfg.search);
            setData((await authFetch(`/api/reports/rate-history?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const partyWord = (data?.side || config.side) === 'purchase' ? 'Supplier' : 'Customer';
    const history = useMemo(() => {
        if (!data) return [];
        if (!focus) return data.history;
        return data.history.filter(h => (!focus.party_id || h.party_id === focus.party_id) && (!focus.product_id || h.product_id === focus.product_id));
    }, [data, focus]);

    const exportCsv = () => {
        if (!data) return;
        let head, rows;
        if (view === 'summary') {
            head = [partyWord, 'Code', 'Item', 'Bills', 'Qty (base)', 'Base Unit', 'Value', 'Last Date', 'Last Bill', 'Last Rate', 'Rate Unit', 'Last Disc %', 'Last Net Rate (base)', 'Min', 'Max', 'Avg', 'Change %'];
            rows = data.summary.map(s => [s.party_name, s.product_code, s.product_name, s.count, s.qty, s.base_unit, s.value, s.last_date, s.last_doc_no, s.last_rate, s.last_unit, s.last_discount_percent, s.last_net_rate_base, s.min_rate, s.max_rate, s.avg_rate, s.change_pct]);
        } else {
            head = ['Date', 'Document', 'Bill No', 'Party Bill No', partyWord, 'Code', 'Item', 'Qty', 'Unit', 'Alt Qty', 'Alt Unit', 'Free (base)', 'Base Qty', 'Base Unit', 'Rate', 'Rate per', 'Disc %', 'Gross', 'Discount', 'Net', 'Net Rate (base)', 'Area', 'Agent', ...udf.columns.map(c => c.label)];
            rows = history.map(h => [h.doc_date, h.doc_label, h.doc_no, h.party_bill_no || '', h.party_name, h.product_code, h.product_name, h.qty, h.unit, h.alt_qty || '', h.alt_unit || '', h.free_qty || '', h.base_qty, h.base_unit, h.rate, h.rate_unit, h.discount_percent, h.gross, h.discount, h.net, h.net_rate_base, h.area_name, h.agent_name, ...udf.values(h).map(x => x.value)]);
        }
        const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `rate_history_${data.side}_${view}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };
    const toggleKind = k => set('kinds', config.kinds.includes(k) ? config.kinds.filter(x => x !== k) : [...config.kinds, k]);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">🏷 Rate History</span></div>
            <div className="erp-tab-content">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                    <div className="erp-field"><label className="erp-label">Type</label>
                        <select className="erp-select" value={config.side} onChange={e => setConfig(c => ({ ...c, side: e.target.value, party_ids: [] }))}>
                            <option value="sales">Sales (customer rates)</option><option value="purchase">Purchase (supplier rates)</option>
                        </select></div>
                    <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">Summary per</label>
                        <select className="erp-select" value={config.group_by} onChange={e => set('group_by', e.target.value)}>
                            <option value="party_product">{config.side === 'purchase' ? 'Supplier' : 'Customer'} + Item</option>
                            <option value="product">Item</option><option value="party">{config.side === 'purchase' ? 'Supplier' : 'Customer'}</option>
                        </select></div>
                    <div className="erp-field md:col-span-2"><label className="erp-label">Include</label>
                        <div className="flex flex-wrap gap-3 items-center min-h-9 text-sm">{KINDS.map(k => <label key={k.key} className="flex items-center gap-1"><input type="checkbox" checked={config.kinds.includes(k.key)} onChange={() => toggleKind(k.key)} /> {k.label}</label>)}</div></div>
                    {meta && <MultiPick label={config.side === 'purchase' ? 'Supplier' : 'Customer'} items={config.side === 'purchase' ? meta.vendors : meta.customers} value={config.party_ids} onChange={v => set('party_ids', v)} />}
                    {meta && <MultiPick label="Item" items={meta.products} value={config.product_ids} onChange={v => set('product_ids', v)} />}
                    {meta && <MultiPick label="Product Group (+ sub)" items={meta.product_groups} value={config.product_group_ids} onChange={v => set('product_group_ids', v)} />}
                    {meta && <MultiPick label="Product Company" items={meta.product_companies} value={config.product_company_ids} onChange={v => set('product_company_ids', v)} />}
                    {meta && <MultiPick label="Area (+ sub)" items={meta.areas} value={config.area_ids} onChange={v => set('area_ids', v)} />}
                    <div className="erp-field"><label className="erp-label">Search item / code</label>
                        <input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                    <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                    {udf.picker}
                    {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                    <button className="erp-btn" onClick={() => { setConfig(defaultConfig()); setData(null); }}>↺ Reset</button>
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

                {data && (
                    <>
                        <div className="flex gap-1 mb-2 border-b">
                            {[['summary', `📊 Summary (${data.summary.length})`], ['history', `📄 History (${history.length}${data.truncated ? '+' : ''})`]].map(([k, l]) => (
                                <button key={k} className={`px-4 py-2 text-sm ${view === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => setView(k)}>{l}</button>
                            ))}
                            {focus && <button className="ml-auto text-xs text-blue-600" onClick={() => setFocus(null)}>✕ {[focus.party_name, focus.product_name].filter(Boolean).join(' · ')}</button>}
                        </div>
                        <div className="overflow-x-auto">
                            {view === 'summary' ? (
                                <table className="erp-grid-table w-full text-sm">
                                    <thead><tr>
                                        {data.group_by !== 'product' && <th className="text-left">{partyWord}</th>}
                                        {data.group_by !== 'party' && <><th className="text-left">Code</th><th className="text-left">Item</th></>}
                                        <th className="text-right">Bills</th><th className="text-right">Qty (base)</th><th className="text-right">Value</th>
                                        <th className="text-left">Last Date</th><th className="text-left">Last Bill</th><th className="text-right">Last Rate</th><th className="text-right">Last Disc %</th>
                                        <th className="text-right bg-blue-50">Last Net Rate / base unit</th><th className="text-right">Min</th><th className="text-right">Max</th><th className="text-right">Avg</th><th className="text-right">Change %</th>
                                    </tr></thead>
                                    <tbody>
                                        {data.summary.map(s => (
                                            <tr key={s.key} className="cursor-pointer hover:bg-blue-50" title="Show its history" onClick={() => { setFocus(s); setView('history'); }}>
                                                {data.group_by !== 'product' && <td>{s.party_name}</td>}
                                                {data.group_by !== 'party' && <><td className="text-gray-500">{s.product_code}</td><td>{s.product_name}</td></>}
                                                <td className="text-right">{s.count || ''}</td>
                                                <td className="text-right tabular-nums">{fmtQ(s.qty)} <span className="text-[10px] text-gray-400">{data.group_by !== 'party' ? s.base_unit : ''}</span></td>
                                                <td className="text-right tabular-nums">{fmt2(s.value)}</td>
                                                <td>{s.last_date}</td><td>{s.last_doc_no}</td>
                                                <td className="text-right tabular-nums">{fmt2(s.last_rate)} <span className="text-[10px] text-gray-400">{s.last_unit}</span></td>
                                                <td className="text-right">{s.last_discount_percent ? `${s.last_discount_percent}%` : ''}</td>
                                                <td className="text-right tabular-nums bg-blue-50 font-semibold">{fmt2(s.last_net_rate_base)}</td>
                                                <td className="text-right tabular-nums">{fmt2(s.min_rate)}</td><td className="text-right tabular-nums">{fmt2(s.max_rate)}</td>
                                                <td className="text-right tabular-nums">{fmt2(s.avg_rate)}</td>
                                                <td className={`text-right ${s.change_pct > 0 ? 'text-red-600' : s.change_pct < 0 ? 'text-green-700' : ''}`}>{s.change_pct ? `${s.change_pct > 0 ? '▲' : '▼'} ${Math.abs(s.change_pct)}%` : ''}</td>
                                            </tr>
                                        ))}
                                        {data.summary.length === 0 && <tr><td colSpan={15} className="text-center text-gray-400 py-4">No posted bills for these filters.</td></tr>}
                                    </tbody>
                                </table>
                            ) : (
                                <table className="erp-grid-table w-full text-sm">
                                    <thead><tr>
                                        <th className="text-left">Date</th><th className="text-left">Document</th><th className="text-left">Party Bill</th><th className="text-left">{partyWord}</th><th className="text-left">Item</th>
                                        <th className="text-right">Qty</th><th className="text-right">Alt Qty</th><th className="text-right">Free (base)</th><th className="text-right">Rate</th><th className="text-right">Disc %</th>
                                        <th className="text-right">Net</th><th className="text-right bg-blue-50">Net Rate / base unit</th>
                                        {udf.headers('text-left')}
                                    </tr></thead>
                                    <tbody>
                                        {history.map((h, i) => (
                                            <tr key={i} className={h.kind !== 'main' ? 'text-red-700' : ''}>
                                                <td>{h.doc_date}</td><td>{h.doc_no} <span className="text-[10px] text-gray-400">{h.kind !== 'main' ? h.doc_label : ''}</span></td>
                                                <td className="text-gray-500">{h.party_bill_no || ''}</td><td>{h.party_name}</td><td>{h.product_name}</td>
                                                <td className="text-right tabular-nums">{fmtQ(h.qty)} <span className="text-[10px] text-gray-400">{h.unit}</span></td>
                                                <td className="text-right tabular-nums">{fmtQ(h.alt_qty)} <span className="text-[10px] text-gray-400">{h.alt_qty ? h.alt_unit : ''}</span></td>
                                                <td className="text-right tabular-nums">{fmtQ(h.free_qty)}</td>
                                                <td className="text-right tabular-nums">{fmt2(h.rate)} <span className="text-[10px] text-gray-400">/{h.rate_unit}</span></td>
                                                <td className="text-right">{h.discount_percent ? `${h.discount_percent}%` : ''}</td>
                                                <td className="text-right tabular-nums">{fmt2(h.net)}</td>
                                                <td className="text-right tabular-nums bg-blue-50 font-semibold">{fmt2(h.net_rate_base)} <span className="text-[10px] text-gray-400">/{h.base_unit}</span></td>
                                                {udf.cells(h, undefined, '')}
                                            </tr>
                                        ))}
                                        {history.length === 0 && <tr><td colSpan={12 + udf.count} className="text-center text-gray-400 py-4">No lines.</td></tr>}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
