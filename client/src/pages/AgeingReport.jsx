// =============================================
// AgeingReport.jsx
// Ageing (server: utils/ageing.js) - customer / supplier-wise and
// bill-wise, as on a date:
//   Customer Ageing (receivable) / Supplier Ageing (payable) - ledger
//     outstanding split into bills: bill-to-bill for parties with bill-wise
//     tracking on (System Control / party), FIFO otherwise, or FIFO for all
//     when asked; optionally with unbilled challans and pending orders
//   Goods Delivery Ageing / Goods Receipt Ageing - GDN / GRN not yet billed
//     (orders optional)
// Company-wise per System Control (Product Company compulsory) or as chosen.
// Buckets are free (e.g. 30,60,90,120); age from the bill date or the due
// date (with "Not Due"). Filters like the other reports.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

const TYPES = [
    { key: 'customer', label: '👥 Customer Ageing', side: 'receivable', kinds: ['bills'] },
    { key: 'supplier', label: '🏭 Supplier Ageing', side: 'payable', kinds: ['bills'] },
    { key: 'delivery', label: '🚚 Goods Delivery Ageing', side: 'receivable', kinds: ['challans'] },
    { key: 'receipt', label: '📥 Goods Receipt Ageing', side: 'payable', kinds: ['challans'] }
];
const PARTY_COLS = [
    { key: 'area_name', label: 'Area' }, { key: 'route_name', label: 'Route' }, { key: 'agent_name', label: 'Agent' }, { key: 'phone', label: 'Phone' },
    { key: 'credit_days', label: 'Credit Days', num: true, int: true }, { key: 'credit_limit', label: 'Credit Limit', num: true },
    { key: 'method', label: 'Method' }, { key: 'oldest_days', label: 'Oldest (days)', num: true, int: true }
];
const AMOUNT_COLS = [
    { key: 'bills_total', label: 'Bills' }, { key: 'on_account', label: 'On Account (-)' }, { key: 'unallocated', label: 'Unallocated' },
    { key: 'challan_total', label: 'Challans' }, { key: 'order_total', label: 'Orders' }, { key: 'overdue', label: 'Overdue' }
];
const KIND_LABEL = { bill: 'Bill', opening: 'Opening', on_account: 'On Account', challan: 'Challan', order: 'Order' };

const defaultConfig = type => ({
    type, view: 'party', as_on: iso(new Date()), method: 'auto', age_basis: 'doc_date', buckets: '30,60,90,120', company_wise: 'auto',
    include_challans: false, include_orders: false, party_ids: [], party_group_ids: [], area_ids: [], route_ids: [], agent_ids: [], product_company_ids: [],
    search: '', min_amount: '', only_overdue: false, hide_zero: true, sort_by: 'name',
    cols: ['area_name', 'credit_days', 'oldest_days'], amounts: ['bills_total', 'on_account', 'unallocated', 'challan_total', 'order_total', 'overdue']
});

export default function AgeingReport() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig('customer'));
    const [meta, setMeta] = useState(null);
    const [data, setData] = useState(null);
    const [open, setOpen] = useState(() => new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const toggle = (k, v) => setConfig(c => ({ ...c, [k]: c[k].includes(v) ? c[k].filter(x => x !== v) : [...c[k], v] }));
    const type = TYPES.find(x => x.key === config.type);
    const isParty = type.kinds.includes('bills');

    useEffect(() => { authFetch('/api/reports/ageing/meta').then(r => setMeta(r.data)).catch(e => setError(e.message)); }, [authFetch]);

    const run = useCallback(async (cfg = config) => {
        const ty = TYPES.find(x => x.key === cfg.type);
        const kinds = [...ty.kinds, ...(ty.kinds.includes('bills') && cfg.include_challans ? ['challans'] : []), ...(cfg.include_orders ? ['orders'] : [])];
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ side: ty.side, as_on: cfg.as_on, method: cfg.method, age_basis: cfg.age_basis, buckets: cfg.buckets,
                company_wise: cfg.company_wise === 'auto' ? '' : cfg.company_wise, kinds: kinds.join(','), sort_by: cfg.sort_by,
                hide_zero: String(cfg.hide_zero), only_overdue: String(cfg.only_overdue) });
            ['party_ids', 'party_group_ids', 'area_ids', 'route_ids', 'agent_ids', 'product_company_ids'].forEach(k => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            if (cfg.search) p.set('search', cfg.search);
            if (cfg.min_amount) p.set('min_amount', cfg.min_amount);
            setData((await authFetch(`/api/reports/ageing?${p}`)).data); setOpen(new Set());
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const switchType = k => { setConfig(c => ({ ...defaultConfig(k), view: c.view, as_on: c.as_on, buckets: c.buckets, age_basis: c.age_basis })); setData(null); };
    const partyWord = type.side === 'payable' ? 'Supplier' : 'Customer';
    const showCol = k => config.cols.includes(k);
    const amountCols = AMOUNT_COLS.filter(c => config.amounts.includes(c.key) && (isParty || ['challan_total', 'order_total'].includes(c.key))
        && (c.key !== 'challan_total' || !isParty || data?.kinds?.includes('challans')) && (c.key !== 'order_total' || data?.kinds?.includes('orders'))
        && (!['on_account', 'unallocated', 'overdue'].includes(c.key) || isParty));
    const partyCols = PARTY_COLS.filter(c => showCol(c.key));
    const buckets = data?.buckets || [];
    const nameCell = r => `${r.party_name}${r.company_name ? ` [${r.company_name}]` : ''}`;
    const toggleOpen = k => setOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    const cellVal = (r, c) => (c.int ? r[c.key] || '' : c.num ? fmt2(r[c.key]) : c.key === 'method' ? (r.method === 'bill_wise' ? 'Bill to bill' : r.method === 'fifo' ? 'FIFO' : '') : r[c.key] || '');

    const exportCsv = () => {
        if (!data) return;
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        let head, rows;
        if (config.view === 'party') {
            head = [partyWord, ...(data.company_wise ? ['Company'] : []), ...partyCols.map(c => c.label), ...buckets.map(b => b.label), ...amountCols.map(c => c.label), 'Total'];
            rows = data.rows.map(r => [r.party_name, ...(data.company_wise ? [r.company_name] : []), ...partyCols.map(c => r[c.key] ?? ''), ...buckets.map(b => r.buckets[b.key]), ...amountCols.map(c => r[c.key]), r.total]);
        } else {
            head = [partyWord, ...(data.company_wise ? ['Company'] : []), 'Type', 'Document', 'Doc No', 'Party Bill No', 'Date', 'Due Date', 'Days', 'Amount', 'Settled', 'Pending', ...buckets.map(b => b.label)];
            rows = data.rows.flatMap(r => r.docs.map(d => [r.party_name, ...(data.company_wise ? [r.company_name] : []), KIND_LABEL[d.kind] || d.kind, d.doc_label, d.doc_no, d.party_bill_no || '', d.doc_date || '', d.due_date || '', d.days ?? '',
                d.amount, d.settled, d.remaining, ...buckets.map(b => (d.bucket === b.key ? d.remaining : ''))]));
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `ageing_${config.type}_${config.view}_${data.as_on}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    const docRows = (r, indent) => r.docs.map((d, i) => (
        <tr key={`${r.key}-${i}`} className={`text-xs ${d.kind === 'on_account' ? 'text-green-700' : d.kind === 'challan' || d.kind === 'order' ? 'text-blue-700' : ''}`}>
            <td style={{ paddingLeft: indent }}>{KIND_LABEL[d.kind] || d.kind} · {d.doc_no}{d.party_bill_no ? <span className="text-gray-400"> ({d.party_bill_no})</span> : null} <span className="text-gray-400">{d.doc_label}</span></td>
            <td>{d.doc_date || ''}</td><td>{d.due_date || ''}</td><td className="text-right">{d.days ?? ''}</td>
            <td className="text-right tabular-nums">{fmt2(d.amount)}</td><td className="text-right tabular-nums">{fmt2(d.settled)}</td>
            <td className="text-right tabular-nums font-semibold">{fmt2(d.remaining)}</td>
            {buckets.map(b => <td key={b.key} className="text-right tabular-nums">{d.bucket === b.key ? fmt2(d.remaining) : ''}</td>)}
        </tr>
    ));
    const totalsRow = useMemo(() => data?.totals, [data]);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">⏳ Ageing Report</span></div>
            <div className="erp-tab-content">
                <div className="print:hidden">
                    <div className="flex flex-wrap gap-1 mb-3 border-b">
                        {TYPES.map(x => <button key={x.key} className={`px-3 py-2 text-sm ${config.type === x.key ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => switchType(x.key)}>{x.label}</button>)}
                        <div className="ml-auto flex gap-1 items-center text-sm">
                            {[['party', `${partyWord}-wise`], ['bill', 'Bill-wise']].map(([k, l]) => (
                                <button key={k} className={`px-3 py-1 rounded ${config.view === k ? 'bg-blue-600 text-white' : 'bg-gray-100'}`} onClick={() => set('view', k)}>{l}</button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        <div className="erp-field"><label className="erp-label">As on</label><input type="date" className="erp-input" value={config.as_on} onChange={e => set('as_on', e.target.value)} /></div>
                        {isParty && (
                            <div className="erp-field"><label className="erp-label">Method {data && <span className="hint">(bill-to-bill {data.bill_wise_setting ? 'on' : 'off'} in System Control)</span>}</label>
                                <select className="erp-select" value={config.method} onChange={e => set('method', e.target.value)}>
                                    <option value="auto">Auto - bill to bill where on, else FIFO</option><option value="fifo">FIFO for all</option><option value="bill_wise">Bill to bill for all</option>
                                </select></div>
                        )}
                        <div className="erp-field"><label className="erp-label">Age from</label>
                            <select className="erp-select" value={config.age_basis} onChange={e => set('age_basis', e.target.value)}>
                                <option value="doc_date">Bill / document date</option><option value="due_date">Due date (Not Due column)</option>
                            </select></div>
                        <div className="erp-field"><label className="erp-label">Buckets (days)</label><input className="erp-input" value={config.buckets} placeholder="30,60,90,120" onChange={e => set('buckets', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">Company-wise {data && <span className="hint">(System Control: {data.company_wise_setting ? 'on' : 'off'})</span>}</label>
                            <select className="erp-select" value={config.company_wise} onChange={e => set('company_wise', e.target.value)}>
                                <option value="auto">As System Control</option><option value="yes">Yes</option><option value="no">No</option>
                            </select></div>
                        <div className="erp-field"><label className="erp-label">Include</label>
                            <div className="flex flex-wrap gap-3 items-center min-h-9 text-sm">
                                {isParty && <label className="flex items-center gap-1"><input type="checkbox" checked={config.include_challans} onChange={e => set('include_challans', e.target.checked)} /> Unbilled {type.side === 'payable' ? 'GRN' : 'challans'}</label>}
                                <label className="flex items-center gap-1"><input type="checkbox" checked={config.include_orders} onChange={e => set('include_orders', e.target.checked)} /> Pending orders</label>
                            </div></div>
                    </div>

                    {meta && (
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                            <MultiPick label={partyWord} items={type.side === 'payable' ? meta.suppliers : meta.customers} value={config.party_ids} onChange={v => set('party_ids', v)} />
                            <MultiPick label={`${partyWord} Group`} items={type.side === 'payable' ? meta.supplier_groups : meta.customer_groups} value={config.party_group_ids} onChange={v => set('party_group_ids', v)} />
                            <MultiPick label="Area (+ sub)" items={meta.areas} value={config.area_ids} onChange={v => set('area_ids', v)} />
                            <MultiPick label="Route" items={meta.routes} value={config.route_ids} onChange={v => set('route_ids', v)} />
                            <MultiPick label="Salesman / Agent" items={meta.agents} value={config.agent_ids} onChange={v => set('agent_ids', v)} />
                            <MultiPick label="Product Company" items={meta.companies} value={config.product_company_ids} onChange={v => set('product_company_ids', v)} />
                            <div className="erp-field"><label className="erp-label">Search {partyWord.toLowerCase()} / code</label>
                                <input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                            <div className="erp-field"><label className="erp-label">Min total</label><input type="number" className="erp-input" value={config.min_amount} onChange={e => set('min_amount', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">Sort by</label>
                                <select className="erp-select" value={config.sort_by} onChange={e => set('sort_by', e.target.value)}>
                                    <option value="name">Name</option><option value="total">Total (high first)</option><option value="oldest">Oldest first</option>
                                </select></div>
                            <div className="erp-field md:col-span-2"><label className="erp-label">Show</label>
                                <div className="flex flex-wrap gap-3 items-center min-h-9 text-sm">
                                    <label className="flex items-center gap-1"><input type="checkbox" checked={config.only_overdue} onChange={e => set('only_overdue', e.target.checked)} /> Only overdue</label>
                                    <label className="flex items-center gap-1"><input type="checkbox" checked={config.hide_zero} onChange={e => set('hide_zero', e.target.checked)} /> Hide zero</label>
                                </div></div>
                        </div>
                    )}

                    <div className="flex flex-wrap gap-3 text-sm items-center mb-2">
                        <span className="text-gray-500">Columns:</span>
                        {PARTY_COLS.map(c => <label key={c.key} className="flex items-center gap-1"><input type="checkbox" checked={showCol(c.key)} onChange={() => toggle('cols', c.key)} /> {c.label}</label>)}
                        {AMOUNT_COLS.map(c => <label key={c.key} className="flex items-center gap-1"><input type="checkbox" checked={config.amounts.includes(c.key)} onChange={() => toggle('amounts', c.key)} /> {c.label}</label>)}
                    </div>

                    <div className="flex gap-2 mb-3">
                        <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                        {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                        {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                        {data && config.view === 'party' && <button className="erp-btn" onClick={() => setOpen(open.size ? new Set() : new Set(data.rows.map(r => r.key)))}>{open.size ? '▸ Collapse all' : '▾ Expand all'}</button>}
                        <button className="erp-btn" onClick={() => { setConfig(defaultConfig(config.type)); setData(null); }}>↺ Reset</button>
                    </div>
                    {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                    {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}
                </div>

                {data && (
                    <div className="overflow-x-auto text-sm">
                        <p className="text-xs text-gray-600 mb-1">
                            {type.label.replace(/^\S+ /, '')} as on {data.as_on} · age from {data.basis === 'due_date' ? 'due date' : 'document date'}
                            {isParty && ` · ${data.method === 'auto' ? 'bill to bill where on, else FIFO' : data.method === 'fifo' ? 'FIFO' : 'bill to bill'}`}
                            {data.company_wise && ' · company-wise'} · {data.totals.parties} {partyWord.toLowerCase()}s
                        </p>
                        {config.view === 'party' ? (
                            <table className="erp-grid-table w-full">
                                <thead><tr>
                                    <th className="text-left min-w-[200px]">{partyWord}{data.company_wise ? ' [Company]' : ''}</th>
                                    {partyCols.map(c => <th key={c.key} className={c.num ? 'text-right' : 'text-left'}>{c.label}</th>)}
                                    {buckets.map(b => <th key={b.key} className="text-right bg-amber-50 whitespace-nowrap">{b.label}</th>)}
                                    {amountCols.map(c => <th key={c.key} className="text-right whitespace-nowrap">{c.label}</th>)}
                                    <th className="text-right bg-blue-50">Total</th>
                                </tr></thead>
                                <tbody>
                                    {data.rows.map(r => (
                                        <React.Fragment key={r.key}>
                                            <tr className={`cursor-pointer hover:bg-blue-50 ${r.over_limit ? 'bg-red-50' : ''}`} onClick={() => toggleOpen(r.key)}>
                                                <td><span className="text-gray-400 mr-1">{open.has(r.key) ? '▾' : '▸'}</span>{nameCell(r)}{r.over_limit && <span className="ml-1 text-[10px] text-red-600">over limit</span>}</td>
                                                {partyCols.map(c => <td key={c.key} className={c.num ? 'text-right' : ''}>{cellVal(r, c)}</td>)}
                                                {buckets.map(b => <td key={b.key} className="text-right tabular-nums">{fmt2(r.buckets[b.key])}</td>)}
                                                {amountCols.map(c => <td key={c.key} className={`text-right tabular-nums ${c.key === 'overdue' && r.overdue ? 'text-red-600' : ''}`}>{fmt2(r[c.key])}</td>)}
                                                <td className="text-right tabular-nums font-semibold bg-blue-50">{fmt2(r.total)}</td>
                                            </tr>
                                            {open.has(r.key) && (
                                                <tr><td colSpan={2 + partyCols.length + buckets.length + amountCols.length} className="p-0">
                                                    <table className="w-full"><tbody>{docRows(r, 24)}</tbody></table>
                                                </td></tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                    {data.rows.length === 0 && <tr><td colSpan={2 + partyCols.length + buckets.length + amountCols.length} className="text-center text-gray-400 py-4">Nothing outstanding.</td></tr>}
                                </tbody>
                                {data.rows.length > 0 && totalsRow && (
                                    <tfoot><tr className="font-bold bg-blue-50">
                                        <td>Total</td>{partyCols.map(c => <td key={c.key} />)}
                                        {buckets.map(b => <td key={b.key} className="text-right tabular-nums">{fmt2(totalsRow.buckets[b.key])}</td>)}
                                        {amountCols.map(c => <td key={c.key} className="text-right tabular-nums">{fmt2(totalsRow[c.key])}</td>)}
                                        <td className="text-right tabular-nums">{fmt2(totalsRow.total)}</td>
                                    </tr></tfoot>
                                )}
                            </table>
                        ) : (
                            <table className="erp-grid-table w-full">
                                <thead><tr>
                                    <th className="text-left min-w-[240px]">Document</th><th className="text-left">Date</th><th className="text-left">Due Date</th><th className="text-right">Days</th>
                                    <th className="text-right">Amount</th><th className="text-right">Settled</th><th className="text-right">Pending</th>
                                    {buckets.map(b => <th key={b.key} className="text-right bg-amber-50 whitespace-nowrap">{b.label}</th>)}
                                </tr></thead>
                                <tbody>
                                    {data.rows.map(r => (
                                        <React.Fragment key={r.key}>
                                            <tr className="bg-gray-100 font-semibold">
                                                <td colSpan={4}>{nameCell(r)}
                                                    <span className="font-normal text-xs text-gray-500 ml-2">{partyCols.map(c => (cellVal(r, c) ? `${c.label}: ${cellVal(r, c)}` : null)).filter(Boolean).join(' · ')}</span></td>
                                                <td colSpan={3} className="text-right text-xs font-normal">
                                                    {r.on_account ? `On account ${fmt2(-r.on_account)} · ` : ''}{r.unallocated ? `Unallocated ${fmt2(r.unallocated)} · ` : ''}Total <b>{fmt2(r.total)}</b>
                                                </td>
                                                {buckets.map(b => <td key={b.key} className="text-right tabular-nums">{fmt2(r.buckets[b.key])}</td>)}
                                            </tr>
                                            {docRows(r, 16)}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                                {data.rows.length > 0 && totalsRow && (
                                    <tfoot><tr className="font-bold bg-blue-50">
                                        <td colSpan={6} className="text-right">Total</td><td className="text-right tabular-nums">{fmt2(totalsRow.total)}</td>
                                        {buckets.map(b => <td key={b.key} className="text-right tabular-nums">{fmt2(totalsRow.buckets[b.key])}</td>)}
                                    </tr></tfoot>
                                )}
                            </table>
                        )}
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
