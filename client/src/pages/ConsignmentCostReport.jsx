// =============================================
// ConsignmentCostReport.jsx
// Consignment-wise cost (purchase) and consignment-wise sales, with the GL
// check of the purchase / sales accounts (server: utils/consignmentCost.js).
// Views:
//   Bill-wise     - each bill: basic, discount, terms, VAT, additional
//                   expenses / entries, total, landed cost; expands to its
//                   product lines (landed rate, account posted to)
//   Product-wise  - per item: qty, net, terms, additional, landed cost / rate
//   Ledger Summary- per purchase / sales ledger: what the bills should post,
//                   GL for those bills, difference, other GL entries
//   Mismatches    - documents whose GL on those ledgers differs
//   Other GL      - entries on those ledgers from other documents
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useUdfColumns } from '../components/UdfColumns';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtQ = n => (Number(n) ? (Math.round(Number(n) * 10000) / 10000).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '');
const VIEWS = [['bill', '🧾 Bill-wise'], ['product', '📦 Product-wise'], ['ledger', '📒 Ledger Summary'], ['mismatch', '⚠ Mismatches'], ['other', '📝 Other GL']];

const defaultConfig = () => {
    const d = new Date();
    return { side: 'purchase', date_from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, date_to: iso(d), include_returns: false, include_additional: true,
        party_ids: [], product_ids: [], product_group_ids: [], product_company_ids: [], ledger_ids: [], doc_no: '' };
};

export default function ConsignmentCostReport() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [view, setView] = useState('bill');
    const [meta, setMeta] = useState(null);
    const [ledgers, setLedgers] = useState([]);
    const [data, setData] = useState(null);
    const [open, setOpen] = useState(() => new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    useEffect(() => { authFetch(`/api/reports/trade-meta?side=${config.side}`).then(r => setMeta(r.data)).catch(e => setError(e.message)); }, [authFetch, config.side]);
    useEffect(() => {
        authFetch('/api/ledger-accounts?pageSize=1000&sortBy=account_name&sortDir=asc').then(r => setLedgers((r.data || []).map(l => ({ id: l.id, name: l.account_code ? `${l.account_name} · ${l.account_code}` : l.account_name })))).catch(() => setLedgers([]));
    }, [authFetch]);

    const udf = useUdfColumns(`consignment-${config.side}`, config.side === 'purchase' ? ['purchase_bill', 'purchase_return', 'purchase_nonsaleable_return'] : ['sales_bill', 'sales_return', 'sales_nonsaleable_return']);
    const udfLoad = udf.load;
    useEffect(() => { if (data) udfLoad(data.docs); }, [data, udfLoad]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ side: cfg.side, date_from: cfg.date_from, date_to: cfg.date_to, include_returns: String(cfg.include_returns), include_additional: String(cfg.include_additional) });
            ['party_ids', 'product_ids', 'product_group_ids', 'product_company_ids', 'ledger_ids'].forEach(k => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            if (cfg.doc_no) p.set('doc_no', cfg.doc_no);
            setData((await authFetch(`/api/reports/consignment-cost?${p}`)).data); setOpen(new Set());
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const isPurchase = (data?.side || config.side) === 'purchase';
    const party = isPurchase ? 'Supplier' : 'Customer';
    const acctWord = isPurchase ? 'Goods / Purchase Account' : 'Sales Account';
    const termNames = data?.term_names || [];
    const toggleOpen = k => setOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    const sg = d => (d.kind === 'main' ? '' : '-');

    const exportCsv = () => {
        if (!data) return;
        let head, rows;
        if (view === 'bill') {
            head = ['Date', 'Document', 'Doc No', 'Party Bill No', party, 'Account', 'Code', 'Item', 'Qty', 'Unit', 'Base Qty', 'Rate', 'Basic', 'Discount', 'Net', ...termNames, 'VAT', 'Additional', 'Landed', 'Landed Rate', 'Posted to'];
            rows = data.docs.flatMap(d => d.lines.map(l => [d.doc_date, d.doc_type, d.doc_no, d.party_bill_no || '', d.party_name, d.doc_account_name, l.product_code, l.product_name, l.qty, l.unit, l.base_qty, l.rate,
                l.basic, l.discount, l.net, ...termNames.map(n => l.terms[n] || 0), l.vat, l.additional, l.landed, l.landed_rate, l.account_name]));
        } else if (view === 'product') {
            head = ['Code', 'Item', 'Group', 'Company', 'Base Qty', 'Unit', 'Free', 'Basic', 'Discount', 'Net', ...termNames, 'VAT', 'Additional', 'Landed', 'Landed Rate', 'Bills', 'Accounts'];
            rows = data.products.map(p => [p.product_code, p.product_name, p.group_name, p.company_name, p.base_qty, p.base_unit, p.free_qty, p.basic, p.discount, p.net, ...termNames.map(n => p.terms[n] || 0), p.vat, p.additional, p.landed, p.landed_rate, p.docs, p.accounts]);
        } else if (view === 'ledger') {
            head = ['Ledger', 'Should post (bills)', 'GL for these bills', 'Difference', 'Other GL entries', 'GL total in period'];
            rows = data.ledger_summary.map(s => [s.ledger_name, s.expected, s.gl, s.difference, s.other_gl, s.gl_total]);
        } else if (view === 'mismatch') {
            head = ['Date', 'Documents', party, 'Ledger', 'Should post', 'GL', 'Difference', 'Reason'];
            rows = data.mismatches.map(m => [m.doc_date, m.doc_nos, m.party_name, m.ledger_name, m.expected, m.gl, m.difference, m.reason]);
        } else {
            head = ['Date', 'Document Type', 'Doc No', 'Ledger', 'Amount', 'Narration'];
            rows = data.other_gl.map(o => [o.date, o.document_type, o.doc_no, o.ledger_name, o.amount, o.narration]);
        }
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `consignment_${data.side}_${view}_${data.from}_${data.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">🧮 Consignment-wise Cost / Sales</span></div>
            <div className="erp-tab-content">
                <div className="print:hidden">
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        <div className="erp-field"><label className="erp-label">Type</label>
                            <select className="erp-select" value={config.side} onChange={e => { setConfig(c => ({ ...c, side: e.target.value, party_ids: [] })); setData(null); }}>
                                <option value="purchase">Purchase (consignment cost)</option><option value="sales">Sales</option>
                            </select></div>
                        <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                        <div className="erp-field md:col-span-3"><label className="erp-label">Include</label>
                            <div className="flex flex-wrap gap-3 items-center min-h-9 text-sm">
                                <label className="flex items-center gap-1"><input type="checkbox" checked={config.include_returns} onChange={e => set('include_returns', e.target.checked)} /> Returns</label>
                                <label className="flex items-center gap-1"><input type="checkbox" checked={config.include_additional} onChange={e => set('include_additional', e.target.checked)} /> {config.side === 'purchase' ? 'Purchase Additional Expenses' : 'Sales Additional Entries'}</label>
                            </div></div>
                        {meta && <MultiPick label={config.side === 'purchase' ? 'Supplier' : 'Customer'} items={config.side === 'purchase' ? meta.vendors : meta.customers} value={config.party_ids} onChange={v => set('party_ids', v)} />}
                        {meta && <MultiPick label="Item" items={meta.products} value={config.product_ids} onChange={v => set('product_ids', v)} />}
                        {meta && <MultiPick label="Product Group (+ sub)" items={meta.product_groups} value={config.product_group_ids} onChange={v => set('product_group_ids', v)} />}
                        {meta && <MultiPick label="Product Company" items={meta.product_companies} value={config.product_company_ids} onChange={v => set('product_company_ids', v)} />}
                        <MultiPick label={acctWord} items={ledgers} value={config.ledger_ids} onChange={v => set('ledger_ids', v)} />
                        <div className="erp-field"><label className="erp-label">Bill No contains</label><input className="erp-input" value={config.doc_no} onChange={e => set('doc_no', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                        <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                        {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                        {udf.picker}
                        {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                        {data && view === 'bill' && <button className="erp-btn" onClick={() => setOpen(open.size ? new Set() : new Set(data.docs.map(d => d.key)))}>{open.size ? '▸ Collapse all' : '▾ Expand all'}</button>}
                    </div>
                    {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                    {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}
                </div>

                {data && (
                    <>
                        <div className="flex flex-wrap gap-1 mb-2 border-b print:hidden">
                            {VIEWS.map(([k, l]) => (
                                <button key={k} className={`px-3 py-2 text-sm ${view === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => setView(k)}>
                                    {l}{k === 'mismatch' ? ` (${data.mismatches.length})` : k === 'other' ? ` (${data.other_gl.length})` : ''}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-gray-600 mb-2">
                            {isPurchase ? 'Purchase' : 'Sales'} {data.from} to {data.to} · {data.totals.docs} documents · Net {fmt2(data.totals.net)} · Terms {fmt2(data.totals.terms_total)} · VAT {fmt2(data.totals.vat)} · Additional {fmt2(data.totals.additional_total)} ·
                            {isPurchase ? ' Landed cost ' : ' Net sales incl. terms '}{fmt2(data.totals.landed)} · <span className={data.mismatches.length ? 'text-red-600 font-semibold' : 'text-green-700'}>{data.mismatches.length ? `${data.mismatches.length} GL mismatch(es)` : 'GL matches'}</span>
                        </p>
                        <div className="overflow-x-auto text-sm">
                            {view === 'bill' && (
                                <table className="erp-grid-table w-full">
                                    <thead><tr>
                                        <th className="text-left">Date</th><th className="text-left">Document</th><th className="text-left">{party}</th><th className="text-left">{acctWord}</th>
                                        <th className="text-right">Basic</th><th className="text-right">Discount</th><th className="text-right">Net</th><th className="text-right">Terms</th><th className="text-right">VAT</th>
                                        <th className="text-right">Additional</th><th className="text-right">Bill Total</th><th className="text-right bg-blue-50">{isPurchase ? 'Landed Cost' : 'Net incl. terms'}</th>
                                        {udf.headers('text-left')}
                                    </tr></thead>
                                    <tbody>
                                        {data.docs.map(d => (
                                            <React.Fragment key={d.key}>
                                                <tr className={`cursor-pointer hover:bg-blue-50 ${d.kind !== 'main' ? 'text-red-700' : ''}`} onClick={() => toggleOpen(d.key)}>
                                                    <td>{d.doc_date}</td>
                                                    <td><span className="text-gray-400 mr-1">{open.has(d.key) ? '▾' : '▸'}</span>{d.doc_no}{d.party_bill_no ? <span className="text-xs text-gray-400"> ({d.party_bill_no})</span> : null}{d.kind !== 'main' && <span className="text-[10px] ml-1">{d.doc_type.replace(/_/g, ' ')}</span>}</td>
                                                    <td>{d.party_name}</td><td className="text-xs">{d.doc_account_name}</td>
                                                    {['basic', 'discount', 'net', 'terms_total', 'vat', 'additional_total', 'bill_total'].map(k => <td key={k} className="text-right tabular-nums">{d[k] ? sg(d) : ''}{fmt2(d[k])}</td>)}
                                                    <td className="text-right tabular-nums font-semibold bg-blue-50">{sg(d)}{fmt2(d.landed)}</td>
                                                    {udf.cells(d, undefined, '')}
                                                </tr>
                                                {open.has(d.key) && (
                                                    <tr><td colSpan={12 + udf.count} className="p-0 bg-gray-50">
                                                        <table className="w-full text-xs">
                                                            <thead><tr className="text-gray-500">
                                                                <th className="text-left pl-6">Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Basic</th><th className="text-right">Disc</th><th className="text-right">Net</th>
                                                                {termNames.map(n => <th key={n} className="text-right">{n}</th>)}<th className="text-right">VAT</th><th className="text-right">Addl</th><th className="text-right">Landed</th><th className="text-right">Rate / base</th><th className="text-left">Posted to</th>
                                                            </tr></thead>
                                                            <tbody>
                                                                {d.lines.map((l, i) => (
                                                                    <tr key={i}>
                                                                        <td className="pl-6">{l.product_name}</td><td className="text-right">{fmtQ(l.qty)} {l.unit}{l.base_unit && l.unit !== l.base_unit ? ` (${fmtQ(l.base_qty)} ${l.base_unit})` : ''}</td>
                                                                        <td className="text-right">{fmt2(l.rate)}</td><td className="text-right">{fmt2(l.basic)}</td><td className="text-right">{fmt2(l.discount)}</td><td className="text-right">{fmt2(l.net)}</td>
                                                                        {termNames.map(n => <td key={n} className="text-right">{fmt2(l.terms[n])}</td>)}
                                                                        <td className="text-right">{fmt2(l.vat)}</td><td className="text-right">{fmt2(l.additional)}</td><td className="text-right font-semibold">{fmt2(l.landed)}</td>
                                                                        <td className="text-right">{fmt2(l.landed_rate)}</td><td>{l.account_name}</td>
                                                                    </tr>
                                                                ))}
                                                                {(d.doc_terms.length > 0 || d.additional.length > 0) && (
                                                                    <tr><td colSpan={10 + termNames.length} className="pl-6 text-gray-600">
                                                                        {d.doc_terms.map((x, i) => <span key={i} className="mr-3">Bill term: {x.name} {fmt2(x.amount)}{x.vat ? ' (VAT)' : ''}</span>)}
                                                                        {d.additional.map((x, i) => <span key={`a${i}`} className="mr-3">{x.doc_no}: {x.name} {fmt2(x.amount)}</span>)}
                                                                    </td></tr>
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </td></tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                        {data.docs.length === 0 && <tr><td colSpan={12} className="text-center text-gray-400 py-4">No posted documents.</td></tr>}
                                    </tbody>
                                    {data.docs.length > 0 && <tfoot><tr className="font-bold bg-blue-50"><td colSpan={4} className="text-right">Total</td>
                                        {['basic', 'discount', 'net', 'terms_total', 'vat', 'additional_total', 'bill_total', 'landed'].map(k => <td key={k} className="text-right tabular-nums">{fmt2(data.totals[k])}</td>)}</tr></tfoot>}
                                </table>
                            )}
                            {view === 'product' && (
                                <table className="erp-grid-table w-full">
                                    <thead><tr>
                                        <th className="text-left">Item</th><th className="text-right">Qty</th><th className="text-right">Free</th><th className="text-right">Basic</th><th className="text-right">Discount</th><th className="text-right">Net</th>
                                        {termNames.map(n => <th key={n} className="text-right">{n}</th>)}<th className="text-right">VAT</th><th className="text-right">Additional</th>
                                        <th className="text-right bg-blue-50">{isPurchase ? 'Landed Cost' : 'Net incl. terms'}</th><th className="text-right">Rate / base</th><th className="text-right">Bills</th><th className="text-left">{acctWord}</th>
                                    </tr></thead>
                                    <tbody>
                                        {data.products.map(p => (
                                            <tr key={p.product_id}>
                                                <td>{p.product_name} <span className="text-xs text-gray-400">{p.product_code}</span></td><td className="text-right">{fmtQ(p.base_qty)} {p.base_unit}</td><td className="text-right">{fmtQ(p.free_qty)}</td>
                                                {['basic', 'discount', 'net'].map(k => <td key={k} className="text-right tabular-nums">{fmt2(p[k])}</td>)}
                                                {termNames.map(n => <td key={n} className="text-right tabular-nums">{fmt2(p.terms[n])}</td>)}
                                                <td className="text-right tabular-nums">{fmt2(p.vat)}</td><td className="text-right tabular-nums">{fmt2(p.additional)}</td>
                                                <td className="text-right tabular-nums font-semibold bg-blue-50">{fmt2(p.landed)}</td><td className="text-right tabular-nums">{fmt2(p.landed_rate)}</td>
                                                <td className="text-right">{p.docs}</td><td className="text-xs">{p.accounts}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            {view === 'ledger' && (
                                <table className="erp-grid-table w-full">
                                    <thead><tr>
                                        <th className="text-left">Ledger</th><th className="text-right">Should post (these bills)</th><th className="text-right">GL for these bills</th>
                                        <th className="text-right">Difference</th><th className="text-right">Other GL entries</th><th className="text-right bg-blue-50">GL total in period</th>
                                    </tr></thead>
                                    <tbody>
                                        {data.ledger_summary.map(s => (
                                            <tr key={s.ledger_id} className={Math.abs(s.difference) > 0.01 ? 'bg-red-50' : ''}>
                                                <td>{s.ledger_name}</td><td className="text-right tabular-nums">{fmt2(s.expected)}</td><td className="text-right tabular-nums">{fmt2(s.gl)}</td>
                                                <td className={`text-right tabular-nums font-semibold ${Math.abs(s.difference) > 0.01 ? 'text-red-600' : 'text-green-700'}`}>{Math.abs(s.difference) > 0.01 ? fmt2(s.difference) : '✓'}</td>
                                                <td className="text-right tabular-nums">{fmt2(s.other_gl)}</td><td className="text-right tabular-nums bg-blue-50">{fmt2(s.gl_total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot><tr className="font-bold bg-blue-50"><td>Total</td>
                                        {['expected', 'gl', 'difference', 'other_gl', 'gl_total'].map(k => <td key={k} className="text-right tabular-nums">{fmt2(data.ledger_summary.reduce((a, s) => a + s[k], 0))}</td>)}</tr></tfoot>
                                </table>
                            )}
                            {view === 'mismatch' && (
                                <table className="erp-grid-table w-full">
                                    <thead><tr><th className="text-left">Date</th><th className="text-left">Documents</th><th className="text-left">{party}</th><th className="text-left">Ledger</th>
                                        <th className="text-right">Should post</th><th className="text-right">GL</th><th className="text-right">Difference</th><th className="text-left">Reason</th></tr></thead>
                                    <tbody>
                                        {data.mismatches.map((m, i) => (
                                            <tr key={i}><td>{m.doc_date}</td><td>{m.doc_nos}</td><td>{m.party_name}</td><td>{m.ledger_name}</td>
                                                <td className="text-right tabular-nums">{fmt2(m.expected)}</td><td className="text-right tabular-nums">{fmt2(m.gl)}</td>
                                                <td className="text-right tabular-nums text-red-600 font-semibold">{fmt2(m.difference)}</td><td className="text-xs">{m.reason}</td></tr>
                                        ))}
                                        {data.mismatches.length === 0 && <tr><td colSpan={8} className="text-center text-green-700 py-4">✓ Every document's GL matches its {isPurchase ? 'purchase' : 'sales'} accounts.</td></tr>}
                                    </tbody>
                                </table>
                            )}
                            {view === 'other' && (
                                <table className="erp-grid-table w-full">
                                    <thead><tr><th className="text-left">Date</th><th className="text-left">Document</th><th className="text-left">Doc No</th><th className="text-left">Ledger</th><th className="text-right">Amount</th><th className="text-left">Narration</th></tr></thead>
                                    <tbody>
                                        {data.other_gl.map((o, i) => (
                                            <tr key={i}><td>{o.date}</td><td>{o.document_type.replace(/_/g, ' ')}</td><td>{o.doc_no}</td><td>{o.ledger_name}</td><td className="text-right tabular-nums">{fmt2(o.amount)}</td><td className="text-xs">{o.narration}</td></tr>
                                        ))}
                                        {data.other_gl.length === 0 && <tr><td colSpan={6} className="text-center text-gray-400 py-4">No other entries on these ledgers in the period.</td></tr>}
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
