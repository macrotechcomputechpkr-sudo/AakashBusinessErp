// =============================================
// DimensionReports.jsx
// Ledger / sub-ledger, cost center, unit, branch and document-class reports
// from the general ledger (server/utils/dimensionReports.js):
//   Sub-ledger summary      each ledger's sub-ledgers: opening, Dr, Cr, closing
//   Statement               any ledger / sub-ledger / cost center / unit /
//                           branch / doc class - entries with running balance
//   P&L by cost center / unit / branch / doc class - one column each + net
//   Summary by cost center  cost center x ledger
//   Monthly trend           any dimension x month
//   Custom pivot            up to 3 row dimensions, any column dimension
//   Doc class register      documents per numbering class: count, amount,
//                           first / last no, drafts, cancelled, gaps, duplicates
//   Missing dimensions      P&L entries without cost center / unit, sub-ledger
//                           missing or wrong, unclassified doc nos, unmapped groups
// =============================================
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';

const fmt2 = n => (n === null || n === undefined || n === 0 ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const iso = d => d.toISOString().slice(0, 10);
const fyStart = () => { const d = new Date(); const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-07-17`; };
const PRESETS = [
    ['sub_summary', 'Sub-ledger Summary', { view: 'pivot', rows: ['ledger', 'sub_ledger'], columns: '', statement: '' }],
    ['statement', 'Statement (ledger / sub-ledger / cost center …)', { view: 'statement', dimension: 'sub_ledger' }],
    ['pl_cc', 'P&L by Cost Center', { view: 'pl', dimension: 'cost_center' }],
    ['pl_unit', 'P&L by Unit', { view: 'pl', dimension: 'business_unit' }],
    ['pl_branch', 'P&L by Branch', { view: 'pl', dimension: 'branch' }],
    ['pl_class', 'P&L by Doc Class', { view: 'pl', dimension: 'doc_class' }],
    ['cc_summary', 'Cost Center x Ledger', { view: 'pivot', rows: ['cost_center', 'ledger'], columns: '', statement: 'pl' }],
    ['monthly', 'Monthly Trend', { view: 'pivot', rows: ['cost_center'], columns: 'month', statement: 'pl' }],
    ['pivot', 'Custom Pivot', { view: 'pivot', rows: ['group', 'ledger'], columns: '', statement: '' }],
    ['doc_class', 'Doc Class Register (gaps)', { view: 'doc_class' }],
    ['exceptions', 'Missing Dimensions', { view: 'exceptions' }]
];
const FILTERS = [['ledger_ids', 'Ledger', 'ledgers'], ['group_ids', 'Group', 'groups'], ['sub_ledger_ids', 'Sub-ledger', 'sub_ledgers'], ['cost_center_ids', 'Cost center', 'cost_centers'],
    ['business_unit_ids', 'Unit', 'business_units'], ['branch_ids', 'Branch', 'branches'], ['doc_types', 'Document type', 'doc_types'], ['doc_class_ids', 'Doc class', 'doc_classes'], ['product_company_ids', 'Product company', 'product_companies']];
const VALUE_LIST = { ledger: 'ledgers', sub_ledger: 'sub_ledgers', cost_center: 'cost_centers', business_unit: 'business_units', branch: 'branches', doc_class: 'doc_classes', product_company: 'product_companies', group: 'groups' };

export default function DimensionReports() {
    const { authFetch } = useAuth();
    const [preset, setPreset] = useState('sub_summary');
    const [meta, setMeta] = useState(null);
    const [cfg, setCfg] = useState(() => ({ ...PRESETS[0][2], from: fyStart(), to: iso(new Date()), value: '', detail: 'ledger', voucher_types: [], ...Object.fromEntries(FILTERS.map(([k]) => [k, []])) }));
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
    useEffect(() => { authFetch('/api/dimension-reports/meta').then(r => setMeta(r.data)).catch(e => setError(e.message)); }, [authFetch]);
    const choose = key => { const p = PRESETS.find(x => x[0] === key); setPreset(key); setCfg(c => ({ ...c, ...p[2], value: '' })); setData(null); };

    const run = async () => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ to: cfg.to });
            if (cfg.from) p.set('from', cfg.from);
            FILTERS.forEach(([k]) => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            let url;
            if (cfg.view === 'pivot') { p.set('rows', cfg.rows.filter(Boolean).join(',')); if (cfg.columns) p.set('columns', cfg.columns); if (cfg.statement) p.set('statement', cfg.statement); url = 'pivot'; }
            if (cfg.view === 'pl') { p.set('dimension', cfg.dimension); p.set('detail', cfg.detail); url = 'pl'; }
            if (cfg.view === 'statement') { p.set('dimension', cfg.dimension); p.set('value', cfg.value); url = 'statement'; }
            if (cfg.view === 'doc_class') { if (cfg.voucher_types.length) p.set('voucher_types', cfg.voucher_types.join(',')); url = 'doc-class'; }
            if (cfg.view === 'exceptions') url = 'exceptions';
            const r = await authFetch(`/api/dimension-reports/${url}?${p}`);
            setData({ view: cfg.view, ...r.data });
        } catch (e) { setError(e.message); setData(null); }
        setLoading(false);
    };
    const exportCsv = () => {
        const table = document.querySelector('#dim-report-table');
        if (!table) return;
        const rows = [...table.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th,td')].map(td => td.innerText.replace(/\n/g, ' ')));
        const esc = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${preset}_${cfg.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };
    const valueItems = useMemo(() => (meta && VALUE_LIST[cfg.dimension] ? [{ id: '__none__', name: '(none)' }, ...meta[VALUE_LIST[cfg.dimension]]] : []), [meta, cfg.dimension]);
    const dims = meta?.dimensions || [];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">🧭 Ledger / Sub-ledger / Cost Center / Unit / Doc Class Reports</span></div>
            <div className="erp-tab-content">
                <div className="flex flex-wrap gap-1 mb-3 print:hidden">
                    {PRESETS.map(([k, l]) => <button key={k} className={`px-3 py-1.5 text-xs rounded ${preset === k ? 'bg-blue-600 text-white' : 'bg-gray-100'}`} onClick={() => choose(k)}>{l}</button>)}
                </div>
                {meta && (
                    <div className="print:hidden">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-2">
                            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={cfg.from} onChange={e => set('from', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={cfg.to} onChange={e => set('to', e.target.value)} /></div>
                            {cfg.view === 'pivot' && [0, 1, 2].map(i => (
                                <div key={i} className="erp-field"><label className="erp-label">Rows {i + 1}</label>
                                    <select className="erp-select" value={cfg.rows[i] || ''} onChange={e => set('rows', e.target.value ? Object.assign([...cfg.rows], { [i]: e.target.value }).slice(0, 3) : cfg.rows.slice(0, i))}>
                                        {i > 0 && <option value="">(none)</option>}{dims.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>
                            ))}
                            {cfg.view === 'pivot' && <div className="erp-field"><label className="erp-label">Columns</label><select className="erp-select" value={cfg.columns} onChange={e => set('columns', e.target.value)}><option value="">(none)</option>{dims.filter(d => !cfg.rows.includes(d.key)).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>}
                            {cfg.view === 'pivot' && <div className="erp-field"><label className="erp-label">Ledgers of</label><select className="erp-select" value={cfg.statement} onChange={e => set('statement', e.target.value)}><option value="">All</option><option value="pl">Profit &amp; Loss</option><option value="bs">Balance Sheet</option></select></div>}
                            {['pl', 'statement'].includes(cfg.view) && <div className="erp-field"><label className="erp-label">Dimension</label><select className="erp-select" value={cfg.dimension} onChange={e => { set('dimension', e.target.value); set('value', ''); }}>
                                {dims.filter(d => cfg.view === 'statement' ? !['statement', 'month', 'doc_type'].includes(d.key) : !['ledger', 'group', 'statement'].includes(d.key)).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>}
                            {cfg.view === 'pl' && <div className="erp-field"><label className="erp-label">Rows</label><select className="erp-select" value={cfg.detail} onChange={e => set('detail', e.target.value)}><option value="ledger">Ledgers</option><option value="group">Groups</option></select></div>}
                            {cfg.view === 'statement' && <div className="erp-field md:col-span-2"><label className="erp-label">{dims.find(d => d.key === cfg.dimension)?.label}</label>
                                <select className="erp-select" value={cfg.value} onChange={e => set('value', e.target.value)}><option value="">— choose —</option>{valueItems.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>}
                            {cfg.view === 'doc_class' && <div className="md:col-span-2"><MultiPick label="Voucher types" items={meta.voucher_types} value={cfg.voucher_types} onChange={v => set('voucher_types', v)} /></div>}
                        </div>
                        {['pivot', 'pl', 'statement', 'exceptions'].includes(cfg.view) && (
                            <details className="mb-2"><summary className="text-sm text-blue-700 cursor-pointer">Filters</summary>
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-2">{FILTERS.map(([k, l, list]) => <MultiPick key={k} label={l} items={meta[list] || []} value={cfg[k]} onChange={v => set(k, v)} />)}</div>
                            </details>
                        )}
                        <div className="flex gap-2 mb-3">
                            <button className="erp-btn primary" onClick={run} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                            {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                            {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print</button>}
                        </div>
                    </div>
                )}
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

                {data?.view === 'pivot' && (
                    <div className="overflow-x-auto">
                        <table id="dim-report-table" className="erp-grid-table w-full text-sm">
                            <thead><tr>{data.rows_dims.map(d => <th key={d.key} className="text-left">{d.label}</th>)}<th className="text-right">Opening</th>
                                {data.column_dim ? data.columns.map(c => <th key={c.key} className="text-right whitespace-nowrap">{c.label}</th>) : <><th className="text-right">Debit</th><th className="text-right">Credit</th></>}<th className="text-right">Net</th><th className="text-right">Closing</th></tr></thead>
                            <tbody>{data.rows.map((r, i) => {
                                const prev = data.rows[i - 1];
                                return (
                                    <tr key={r.key}>{data.rows_dims.map((d, j) => <td key={d.key} className={j === 0 && prev && prev.labels[d.key] === r.labels[d.key] ? 'text-gray-300' : ''}>{r.labels[d.key]}</td>)}
                                        <td className="text-right tabular-nums">{fmt2(r.opening)}</td>
                                        {data.column_dim ? data.columns.map(c => <td key={c.key} className="text-right tabular-nums">{fmt2(r.cols[c.key])}</td>) : <><td className="text-right tabular-nums">{fmt2(r.dr)}</td><td className="text-right tabular-nums">{fmt2(r.cr)}</td></>}
                                        <td className="text-right tabular-nums">{fmt2(r.net)}</td><td className="text-right tabular-nums font-semibold">{fmt2(r.closing)}</td></tr>
                                );
                            })}</tbody>
                            <tfoot><tr className="font-bold bg-blue-50"><td colSpan={data.rows_dims.length}>Total</td><td className="text-right tabular-nums">{fmt2(data.totals.opening)}</td>
                                {data.column_dim ? data.columns.map(c => <td key={c.key} className="text-right tabular-nums">{fmt2(data.totals.cols[c.key])}</td>) : <><td className="text-right tabular-nums">{fmt2(data.totals.dr)}</td><td className="text-right tabular-nums">{fmt2(data.totals.cr)}</td></>}
                                <td className="text-right tabular-nums">{fmt2(data.totals.dr - data.totals.cr)}</td><td className="text-right tabular-nums">{fmt2(data.totals.closing)}</td></tr></tfoot>
                        </table>
                        <p className="text-xs text-gray-500 mt-1">Debit positive, credit negative in Net / Closing.</p>
                    </div>
                )}
                {data?.view === 'pl' && (
                    <div className="overflow-x-auto">
                        <table id="dim-report-table" className="erp-grid-table w-full text-sm">
                            <thead><tr><th className="text-left">{cfg.detail === 'group' ? 'Group' : 'Ledger'}</th>{data.columns.map(c => <th key={c.key} className="text-right whitespace-nowrap">{c.label}</th>)}<th className="text-right">Total</th></tr></thead>
                            <tbody>
                                {['income', 'expense'].map(side => (
                                    <React.Fragment key={side}>
                                        <tr className="bg-gray-100 font-semibold"><td colSpan={data.columns.length + 2}>{side === 'income' ? 'Income' : 'Expenses'}</td></tr>
                                        {data.rows.filter(r => r.side === side).map(r => <tr key={r.key}><td className="pl-4">{r.name}{cfg.detail !== 'group' ? <span className="text-[10px] text-gray-400 ml-1">{r.group_name}</span> : null}</td>{data.columns.map(c => <td key={c.key} className="text-right tabular-nums">{fmt2(r.cols[c.key])}</td>)}<td className="text-right tabular-nums font-semibold">{fmt2(r.total)}</td></tr>)}
                                        <tr className="font-semibold"><td>Total {side === 'income' ? 'income' : 'expenses'}</td>{data.columns.map(c => <td key={c.key} className="text-right tabular-nums">{fmt2(data[side][c.key])}</td>)}<td className="text-right tabular-nums">{fmt2(data.totals[side])}</td></tr>
                                    </React.Fragment>
                                ))}
                            </tbody>
                            <tfoot><tr className="font-bold bg-blue-50"><td>Net profit / (loss)</td>{data.columns.map(c => <td key={c.key} className={`text-right tabular-nums ${data.net[c.key] < 0 ? 'text-red-600' : ''}`}>{fmt2(data.net[c.key])}</td>)}<td className="text-right tabular-nums">{fmt2(data.totals.net)}</td></tr></tfoot>
                        </table>
                    </div>
                )}
                {data?.view === 'statement' && (
                    <table id="dim-report-table" className="erp-grid-table w-full text-sm">
                        <thead><tr><th className="text-left">Date</th><th className="text-left">Document</th><th className="text-left">Ledger</th><th className="text-left">Contra</th><th className="text-left">Sub-ledger</th><th className="text-left">Cost center</th><th className="text-left">Narration</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
                        <tbody>
                            <tr className="bg-gray-50"><td colSpan={9}>{data.dimension.label}: <b>{data.value_label}</b> · opening</td><td className="text-right tabular-nums">{fmt2(Math.abs(data.opening))} {data.opening >= 0 ? 'Dr' : 'Cr'}</td></tr>
                            {data.rows.map(r => <tr key={r.id}><td>{r.date}</td><td>{r.doc_no} <span className="text-[10px] text-gray-400">{r.doc_label}</span></td><td>{r.ledger_name}</td><td className="text-xs">{r.contra}</td><td className="text-xs">{r.sub_ledger ? r.sub_ledger_name : ''}</td><td className="text-xs">{r.cost_center ? r.cost_center_name : ''}</td><td className="text-xs">{r.narration}</td>
                                <td className="text-right tabular-nums">{fmt2(r.dr)}</td><td className="text-right tabular-nums">{fmt2(r.cr)}</td><td className="text-right tabular-nums">{Number(Math.abs(r.balance)).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {r.balance >= 0 ? 'Dr' : 'Cr'}</td></tr>)}
                        </tbody>
                        <tfoot><tr className="font-bold bg-blue-50"><td colSpan={7}>Total / closing</td><td className="text-right tabular-nums">{fmt2(data.totals.dr)}</td><td className="text-right tabular-nums">{fmt2(data.totals.cr)}</td><td className="text-right tabular-nums">{Number(Math.abs(data.totals.closing)).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {data.totals.closing >= 0 ? 'Dr' : 'Cr'}</td></tr></tfoot>
                    </table>
                )}
                {data?.view === 'doc_class' && (
                    <table id="dim-report-table" className="erp-grid-table w-full text-sm">
                        <thead><tr><th className="text-left">Voucher type</th><th className="text-left">Class</th><th className="text-right">Docs</th><th className="text-right">Posted</th><th className="text-right">Draft</th><th className="text-right">Cancelled</th><th className="text-right">Amount</th><th className="text-left">First no</th><th className="text-left">Last no</th><th className="text-left">Missing numbers</th><th className="text-left">Duplicates</th></tr></thead>
                        <tbody>{data.rows.map((r, i) => <tr key={i} className={r.gaps.length || r.duplicate_nos.length ? 'bg-orange-50' : ''}><td>{r.voucher_type.replace(/_/g, ' ')}</td><td>{r.class_name}{r.prefix ? <span className="text-[10px] text-gray-400 ml-1">{r.prefix}</span> : null}</td>
                            <td className="text-right">{r.count}</td><td className="text-right">{r.posted}</td><td className="text-right">{r.drafts}</td><td className="text-right">{r.cancelled}</td><td className="text-right tabular-nums">{fmt2(r.amount)}</td><td>{r.first_no}</td><td>{r.last_no}</td>
                            <td className="text-xs text-red-700">{r.gaps.join(', ')}</td><td className="text-xs text-red-700">{r.duplicate_nos.join(', ')}</td></tr>)}{!data.rows.length && <tr><td colSpan={11} className="text-center text-gray-400 py-3">No documents.</td></tr>}</tbody>
                    </table>
                )}
                {data?.view === 'exceptions' && (
                    <div className="space-y-3">
                        {data.checks.map(ch => (
                            <details key={ch.key} open={ch.count > 0 && ch.count < 50}><summary className={`cursor-pointer text-sm ${ch.count ? 'text-red-700 font-semibold' : 'text-green-700'}`}>{ch.count ? '⚠' : '✔'} {ch.label} - {ch.count} entr(ies){ch.count ? `, ${fmt2(ch.amount)}` : ''}</summary>
                                {ch.count > 0 && <table className="erp-grid-table w-full text-xs mt-1"><thead><tr><th className="text-left">Date</th><th className="text-left">Document</th><th className="text-left">Ledger</th><th className="text-left">Sub-ledger</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-left">Narration</th></tr></thead>
                                    <tbody>{ch.rows.map((r, i) => <tr key={i}><td>{r.date}</td><td>{r.doc_no} {r.doc_label}</td><td>{r.ledger_name}</td><td>{r.sub_ledger_name}</td><td className="text-right">{fmt2(r.dr)}</td><td className="text-right">{fmt2(r.cr)}</td><td>{r.narration}</td></tr>)}</tbody></table>}
                            </details>
                        ))}
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
