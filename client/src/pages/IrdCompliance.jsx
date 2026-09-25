// =============================================
// IrdCompliance.jsx  (/ird)
// IRD Nepal e-billing (server: utils/ird.js, migration 118 triggers):
//   Materialized View  one row per posted sales bill / sales return in the
//                      IRD column layout, kept by database triggers
//                      (printed, active, synced flags; posted bills cannot
//                      be deleted or edited - cancel only)
//   Sales Book         sales register (returns negative) for VAT filing
//   CBMS Sync          push to the IRD Central Billing Monitoring System
//                      (api/bill, api/billreturn), queue with retry
//   Audit Log          post / cancel / print / blocked edits
//   Settings           CBMS credentials, realtime, auto-sync on posting
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);
const TABS = [['mat', 'Materialized View'], ['book', 'Sales Book'], ['sync', 'CBMS Sync'], ['audit', 'Audit Log'], ['settings', 'Settings']];
const MAT_COLS = ['Fiscal_Year', 'Bill_no', 'Ref_Bill_no', 'Customer_name', 'Customer_pan', 'Bill_Date', 'Bill_Date_BS', 'Amount', 'Discount', 'Taxable_Amount', 'Non_Taxable_Amount', 'Tax_Amount', 'Total_Amount', 'Sync_with_IRD', 'IS_Bill_Printed', 'Print_Count', 'Is_Bill_Active', 'Printed_Time', 'Entered_By', 'Printed_By', 'Is_realtime', 'Payment_Method', 'VAT_Refund_Amount', 'Transaction_Id'];
const MONEY = new Set(['Amount', 'Discount', 'Taxable_Amount', 'Non_Taxable_Amount', 'Tax_Amount', 'Total_Amount', 'VAT_Refund_Amount']);

function csv(name, head, rows) {
    const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = name; a.click();
}

export default function IrdCompliance() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'mat');
    const [f, setF] = useState({ date_from: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), date_to: iso(new Date()), doc_type: '', sync: '', active: '' });
    const [data, setData] = useState(null);
    const [settings, setSettings] = useState(null);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setError(''); setBusy(true);
        const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
        try {
            if (tab === 'mat') setData((await authFetch(`/api/ird/materialized?${p}`)).data);
            if (tab === 'book') setData((await authFetch(`/api/ird/sales-book?${p}`)).data);
            if (tab === 'sync') setData({ rows: (await authFetch(`/api/ird/sync-log?${f.sync ? `status=${f.sync}` : ''}`)).data, mat: (await authFetch(`/api/ird/materialized?${new URLSearchParams({ date_from: f.date_from, date_to: f.date_to, ...(f.doc_type ? { doc_type: f.doc_type } : {}), sync: 'not_synced', active: 'active' })}`)).data });
            if (tab === 'audit') setData({ rows: (await authFetch(`/api/ird/audit-log?${p}`)).data });
            if (tab === 'settings') setSettings((await authFetch('/api/ird/settings')).data);
        } catch (e) { setError(e.message); setData(null); }
        setBusy(false);
    }, [authFetch, f, tab]);
    useEffect(() => { setData(null); load(); }, [load]);

    const push = async (docType, id, force) => {
        setMsg(''); setError('');
        try { const r = await authFetch(`/api/ird/sync/${docType}/${id}`, { method: 'POST', body: JSON.stringify({ force }) }); setMsg(`${r.data.status}: ${r.data.message || ''} ${r.data.code ? `(code ${r.data.code})` : ''}`); load(); }
        catch (e) { setError(e.message); }
    };
    const pushAll = async force => {
        setBusy(true); setMsg(''); setError('');
        try { const r = await authFetch('/api/ird/sync-pending', { method: 'POST', body: JSON.stringify({ force }) }); setMsg(`Attempted ${r.data.attempted}: ${r.data.success} synced, ${r.data.failed} failed`); load(); }
        catch (e) { setError(e.message); }
        setBusy(false);
    };
    const saveSettings = async () => {
        try { setSettings((await authFetch('/api/ird/settings', { method: 'PUT', body: JSON.stringify(settings) })).data); setMsg('Settings saved'); } catch (e) { setError(e.message); }
    };

    const filters = (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3 no-print">
            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></div>
            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
            {tab !== 'audit' && <div className="erp-field"><label className="erp-label">Document</label>
                <select className="erp-select" value={f.doc_type} onChange={e => setF({ ...f, doc_type: e.target.value })}><option value="">Bills + Returns</option><option value="sales_bill">Sales Bills</option><option value="sales_return">Sales Returns</option></select></div>}
            {tab === 'mat' && <>
                <div className="erp-field"><label className="erp-label">IRD sync</label>
                    <select className="erp-select" value={f.sync} onChange={e => setF({ ...f, sync: e.target.value })}><option value="">All</option><option value="synced">Synced</option><option value="not_synced">Not synced</option></select></div>
                <div className="erp-field"><label className="erp-label">Active</label>
                    <select className="erp-select" value={f.active} onChange={e => setF({ ...f, active: e.target.value })}><option value="">All</option><option value="active">Active</option><option value="cancelled">Cancelled</option></select></div>
            </>}
            {tab === 'sync' && <div className="erp-field"><label className="erp-label">Queue status</label>
                <select className="erp-select" value={f.sync} onChange={e => setF({ ...f, sync: e.target.value })}><option value="">All</option><option value="failed">Failed</option><option value="success">Success</option><option value="pending">Pending</option><option value="skipped">Skipped</option></select></div>}
        </div>
    );

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">🏛 IRD Compliance (Materialized View · Sales Book · CBMS)</span></div>
                    <div className="erp-tab-content">
                        <div className="flex flex-wrap gap-2 mb-3 no-print">{TABS.map(([k, l]) => <button key={k} className={`erp-btn ${tab === k ? 'primary' : ''}`} onClick={() => { setTab(k); setMsg(''); setF(x => ({ ...x, sync: '' })); }}>{l}</button>)}</div>
                        {tab !== 'settings' && filters}
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}
                        {busy && <p className="text-sm text-gray-400">Loading…</p>}

                        {tab === 'mat' && data && (<>
                            <div className="flex flex-wrap gap-3 mb-2 text-sm">
                                {Object.entries(data.counts).map(([k, v]) => <span key={k} className="border rounded px-2 py-1 capitalize">{k.replace('_', ' ')}: <b>{v}</b></span>)}
                                <button className="erp-btn no-print" onClick={() => csv(`ird_materialized_${f.date_from}_${f.date_to}.csv`, MAT_COLS, data.rows.map(r => MAT_COLS.map(c => (typeof r[c] === 'boolean' ? (r[c] ? 'TRUE' : 'FALSE') : r[c]))))}>⬇ Excel</button>
                                <button className="erp-btn no-print" onClick={() => window.print()}>🖨 Print</button>
                            </div>
                            <div className="overflow-x-auto"><table className="erp-grid-table text-xs">
                                <thead><tr>{MAT_COLS.map(c => <th key={c}>{c}</th>)}</tr></thead>
                                <tbody>{data.rows.map(r => <tr key={r.id} className={!r.Is_Bill_Active ? 'text-red-600' : r.doc_type === 'sales_return' ? 'bg-amber-50' : ''}>{MAT_COLS.map(c => <td key={c} className={MONEY.has(c) ? 'text-right' : ''}>{MONEY.has(c) ? fmt(r[c]) : typeof r[c] === 'boolean' ? (r[c] ? '✔' : '✘') : c === 'Printed_Time' && r[c] ? String(r[c]).replace('T', ' ').slice(0, 19) : r[c]}</td>)}</tr>)}
                                    <tr className="font-semibold bg-slate-50"><td colSpan={7}>Net of active (returns negative)</td>{['Amount', 'Discount', 'Taxable_Amount', 'Non_Taxable_Amount', 'Tax_Amount', 'Total_Amount'].map(k => <td key={k} className="text-right">{fmt(data.totals[k])}</td>)}<td colSpan={11} /></tr>
                                </tbody>
                            </table></div>
                            <p className="text-xs text-gray-500 mt-2">Rows are written by database triggers when a sales bill / return is posted or cancelled. A posted bill cannot be deleted or have its figures changed; every print is counted (re-prints show "Copy of Original").</p>
                        </>)}

                        {tab === 'book' && data && (<>
                            <button className="erp-btn mb-2 no-print" onClick={() => csv(`sales_book_${f.date_from}_${f.date_to}.csv`, ['Date', 'Date (BS)', 'Bill No', 'Ref Bill', 'Type', 'Buyer', 'PAN', 'Total', 'Non-taxable', 'Export', 'Taxable', 'VAT'], data.rows.map(r => [r.date, r.date_bs, r.bill_no, r.ref_bill_no, r.type, r.buyer, r.pan, r.total, r.non_taxable, r.export, r.taxable, r.vat]))}>⬇ Excel</button>
                            <table className="erp-grid-table text-sm">
                                <thead><tr><th>Date (BS)</th><th>Bill No</th><th>Type</th><th>Buyer</th><th>PAN</th><th className="text-right">Total</th><th className="text-right">Non-taxable</th><th className="text-right">Export</th><th className="text-right">Taxable</th><th className="text-right">VAT</th></tr></thead>
                                <tbody>{data.rows.map((r, i) => <tr key={i}><td>{r.date_bs} <span className="text-xs text-gray-400">{r.date}</span></td><td>{r.bill_no}{r.ref_bill_no ? <span className="text-xs text-gray-400"> ← {r.ref_bill_no}</span> : ''}</td><td>{r.type}</td><td>{r.buyer}</td><td>{r.pan}</td>
                                    <td className="text-right">{fmt(r.total)}</td><td className="text-right">{fmt(r.non_taxable)}</td><td className="text-right">{fmt(r.export)}</td><td className="text-right">{fmt(r.taxable)}</td><td className="text-right">{fmt(r.vat)}</td></tr>)}
                                    <tr className="font-semibold bg-slate-50"><td colSpan={5}>Total</td>{['total', 'non_taxable', 'export', 'taxable', 'vat'].map(k => <td key={k} className="text-right">{fmt(data.totals[k])}</td>)}</tr></tbody>
                            </table>
                        </>)}

                        {tab === 'sync' && data && (<>
                            <div className="border rounded-lg p-3 mb-3">
                                <p className="font-semibold text-sm mb-2">Not yet in CBMS ({data.mat.rows.length})</p>
                                <div className="flex gap-2 mb-2"><button className="erp-btn primary" disabled={busy || !data.mat.rows.length} onClick={() => pushAll(false)}>⬆ Sync all pending</button><button className="erp-btn" disabled={busy} onClick={() => pushAll(true)} title="Also retry documents that reached the maximum attempts">Force retry all</button></div>
                                <table className="erp-grid-table text-sm"><thead><tr><th>Bill No</th><th>Date</th><th>Customer</th><th className="text-right">Total</th><th /></tr></thead>
                                    <tbody>{data.mat.rows.slice(0, 200).map(r => <tr key={r.id}><td>{r.Bill_no}</td><td>{r.Bill_Date_BS}</td><td>{r.Customer_name}</td><td className="text-right">{fmt(r.Total_Amount)}</td><td><button className="text-xs text-blue-600" onClick={() => push(r.doc_type, r.source_id, true)}>Push</button></td></tr>)}</tbody></table>
                            </div>
                            <p className="font-semibold text-sm mb-1">Sync log</p>
                            <table className="erp-grid-table text-sm"><thead><tr><th>Bill No</th><th>Type</th><th>Status</th><th>Attempts</th><th>Code</th><th>Message</th><th>Last attempt</th><th /></tr></thead>
                                <tbody>{data.rows.map(r => <tr key={r.id} className={r.status === 'failed' ? 'text-red-700' : ''}><td>{r.bill_no}</td><td>{r.doc_type}</td><td>{r.status}</td><td>{r.attempts}</td><td>{r.response_code}</td><td className="text-xs">{r.response_message}</td><td className="text-xs">{String(r.last_attempt_at || '').replace('T', ' ').slice(0, 19)}</td>
                                    <td>{r.status !== 'success' && <button className="text-xs text-blue-600" onClick={() => push(r.doc_type, r.source_id, true)}>Retry</button>}</td></tr>)}</tbody></table>
                        </>)}

                        {tab === 'audit' && data && (
                            <table className="erp-grid-table text-sm"><thead><tr><th>When</th><th>Document</th><th>Bill No</th><th>Action</th><th>Status</th><th>Changed</th><th>User</th></tr></thead>
                                <tbody>{data.rows.map(r => <tr key={r.id} className={/blocked/.test(r.action) ? 'text-red-700' : ''}><td className="text-xs">{String(r.performed_at).replace('T', ' ').slice(0, 19)}</td><td>{r.doc_type}</td><td>{r.bill_no}</td><td>{r.action}</td><td>{r.old_status ? `${r.old_status} → ` : ''}{r.new_status || ''}</td><td className="text-xs">{r.changed_fields || ''}</td><td>{r.user}</td></tr>)}</tbody></table>
                        )}

                        {tab === 'settings' && settings && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl">
                                <label className="flex items-center gap-2 text-sm md:col-span-3"><input type="checkbox" checked={!!settings.enabled} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} /> Enable CBMS sync</label>
                                <div className="erp-field md:col-span-3"><label className="erp-label">CBMS API base URL</label><input className="erp-input" value={settings.api_base_url || ''} onChange={e => setSettings({ ...settings, api_base_url: e.target.value })} /></div>
                                <div className="erp-field"><label className="erp-label">Username</label><input className="erp-input" value={settings.username || ''} onChange={e => setSettings({ ...settings, username: e.target.value })} /></div>
                                <div className="erp-field"><label className="erp-label">Password {settings.password ? '(stored)' : ''}</label><input type="password" className="erp-input" placeholder={settings.password ? 'leave blank to keep' : ''} onChange={e => setSettings({ ...settings, password: e.target.value })} /></div>
                                <div className="erp-field"><label className="erp-label">Seller PAN</label><input className="erp-input" value={settings.seller_pan || ''} onChange={e => setSettings({ ...settings, seller_pan: e.target.value })} /></div>
                                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.is_realtime !== false} onChange={e => setSettings({ ...settings, is_realtime: e.target.checked })} /> Realtime</label>
                                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.auto_sync_on_post !== false} onChange={e => setSettings({ ...settings, auto_sync_on_post: e.target.checked })} /> Push automatically when a bill / return is posted</label>
                                <div className="erp-field"><label className="erp-label">Max attempts</label><input type="number" className="erp-input" value={settings.max_attempts || 5} onChange={e => setSettings({ ...settings, max_attempts: e.target.value })} /></div>
                                <div className="md:col-span-3"><button className="erp-btn primary" onClick={saveSettings}>💾 Save settings</button></div>
                                <p className="text-xs text-gray-500 md:col-span-3">CBMS codes: 200 saved · 100 credentials do not match · 101 bill already exists (treated as synced) · 102 exception while saving · 103 unknown exception · 104 model invalid · 105 bill does not exist (return).</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
