// =============================================
// FiscalYearManagement.jsx
// The backend (fiscalYearRoutes.js) already existed and was fixed earlier,
// but there was no frontend page calling it. This adds one: list fiscal
// years, create a new one (with the overlap-check error surfaced cleanly),
// set current, and close.
// Year Closing (server/utils/yearClosing.js): Close posts the closing voucher
// - every P&L ledger to nil against the Profit & Loss A/c, the closing stock
// carried forward as the next year's opening - and locks the year. A closed
// year can be re-opened, re-closed, or its closing cancelled. Year Re-closing
// Auto re-posts out-of-date closings by itself; Manual only marks them.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

export default function FiscalYearManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ fiscal_year_code: '', start_date_eng: '', end_date_eng: '' });
    const [yc, setYc] = useState(null);                 // year closing status
    const [preview, setPreview] = useState(null);       // { fy, data, method }
    const [carried, setCarried] = useState(null);
    const [busy, setBusy] = useState(false);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => {
        setAlert({ message, type });
        setTimeout(() => setAlert(null), 5000);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch('/api/fiscal-years');
            setRows(res.data || []);
            try { const st = await authFetch('/api/fiscal-years/closing/status'); setYc(st.data || null); } catch { setYc(null); }
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            await authFetch('/api/fiscal-years/create', { method: 'POST', body: JSON.stringify(form) });
            showAlert('Fiscal year created', 'success');
            setShowForm(false);
            setForm({ fiscal_year_code: '', start_date_eng: '', end_date_eng: '' });
            load();
        } catch (err) {
            // FIX (backend): overlapping date ranges now come back as a clean
            // 400 message instead of a raw Postgres exclusion-constraint error.
            showAlert(err.message, 'danger');
        }
    };

    const setCurrent = async (id) => {
        try {
            await authFetch(`/api/fiscal-years/${id}/set-current`, { method: 'PUT' });
            showAlert('Set as current fiscal year', 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const money = v => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const closingOf = id => (yc?.years || []).find(y => y.id === id) || {};

    const openPreview = async (row, method) => {
        setBusy(true);
        try {
            const m = method || closingOf(row.id).closing?.stock_method || yc?.stock_method || 'weighted_average';
            const res = await authFetch(`/api/fiscal-years/${row.id}/closing/preview?stock_method=${m}`);
            setPreview({ fy: row, data: res.data, method: m });
        } catch (err) { showAlert(err.message, 'danger'); }
        finally { setBusy(false); }
    };
    const act = async (fn, msg) => {
        setBusy(true);
        try { const res = await fn(); showAlert(typeof msg === 'function' ? msg(res.data || {}) : msg, 'success'); setPreview(null); load(); }
        catch (err) { showAlert(err.message, 'danger'); }
        finally { setBusy(false); }
    };
    const resultMsg = (verb) => d => `${verb}: net ${d.net_profit >= 0 ? 'profit' : 'loss'} ${money(Math.abs(d.net_profit))} to ${d.pl_ledger?.account_name || 'Profit & Loss A/c'}, closing stock ${money(d.closing_stock)} carried forward`
        + (d.later_reclosed ? ` - ${d.later_reclosed} later year(s) re-closed` : '') + (d.later_need_reclosing ? ` - ${d.later_need_reclosing} later year(s) need re-closing` : '')
        + (d.current_year ? ` - ${d.current_year} is now the current year` : '');
    const postClosing = () => act(() => authFetch(`/api/fiscal-years/${preview.fy.id}/closing`, { method: 'POST', body: JSON.stringify({ stock_method: preview.method }) }), resultMsg('Year closed'));
    const reclose = (row) => act(() => authFetch(`/api/fiscal-years/${row.id}/reclose`, { method: 'POST', body: JSON.stringify({}) }), resultMsg('Re-closed'));
    const reopen = (row) => {
        if (!window.confirm(`Re-open ${row.fiscal_year_code}? Entries can then be posted or changed in it again; its closing is re-posted when it is closed again${yc?.reclosing_mode === 'auto' ? ' (or automatically)' : ''}.`)) return;
        act(() => authFetch(`/api/fiscal-years/${row.id}/reopen`, { method: 'POST' }), d => `${d.reopened} is open again` + (d.later_closed_years?.length ? ` (later closed years: ${d.later_closed_years.join(', ')})` : ''));
    };
    const cancelClosing = (row) => {
        if (!window.confirm(`Cancel the year closing of ${row.fiscal_year_code}? The closing voucher is removed and the year is opened.`)) return;
        act(() => authFetch(`/api/fiscal-years/${row.id}/closing`, { method: 'DELETE' }), 'Year closing cancelled');
    };
    const setMode = (mode) => act(() => authFetch('/api/fiscal-years/closing/mode', { method: 'PUT', body: JSON.stringify({ mode }) }), `Year re-closing: ${mode === 'auto' ? 'Auto' : 'Manual'}`);
    const recloseAll = () => act(() => authFetch('/api/fiscal-years/closing/reclose-all', { method: 'POST' }), d => `${d.reclosed || 0} year(s) re-closed`);
    const showCarried = async (row) => {
        try { const res = await authFetch(`/api/fiscal-years/${row.id}/closing/stock`); setCarried(res.data); }
        catch (err) { showAlert(err.message, 'danger'); }
    };

    const columns = [
        { key: 'fiscal_year_code', label: 'Code', type: 'text' },
        { key: 'start_date_eng', label: 'Start Date', type: 'text' },
        { key: 'end_date_eng', label: 'End Date', type: 'text' },
        { key: 'start_date_nep', label: 'Start (BS)', type: 'text' },
        { key: 'end_date_nep', label: 'End (BS)', type: 'text' },
        {
            key: 'status', label: 'Status', type: 'text',
            render: (r) => r.is_closed
                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-700">Closed</span>
                : r.is_current
                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Current</span>
                : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Active</span>
        },
        {
            key: 'year_closing', label: 'Year Closing', type: 'text',
            render: (r) => {
                const c = closingOf(r.id).closing;
                if (!c) return <span className="text-xs text-gray-400">Not closed</span>;
                return (
                    <span className="text-xs">
                        {c.needs_reclosing
                            ? <span className="px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800" title={c.reclosing_reason || ''}>Re-closing required</span>
                            : <span className="px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-800">{c.doc_no || 'Closed'}</span>}
                        {' '}{c.net_profit >= 0 ? 'Profit' : 'Loss'} {money(Math.abs(c.net_profit))} · Stock c/f {money(c.closing_stock)}
                        {!r.is_closed && <span className="ml-1 text-red-600">(re-opened)</span>}
                    </span>
                );
            }
        }
    ];

    return (
        <Layout>
            <div className="max-w-5xl mx-auto p-4">
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-2xl font-bold">Fiscal Years</h1>
                    <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                        {showForm ? 'Close Form' : '➕ New Fiscal Year'}
                    </button>
                </div>

                {yc && (
                    <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
                        <b>Year Closing</b>
                        <span className="text-gray-500">P&amp;L heads to <b>{yc.pl_ledger?.account_name || 'Profit & Loss A/c'}</b>, closing stock to <b>{yc.stock_ledger?.account_name || 'Closing Stock A/c'}</b> and carried forward as opening stock.</span>
                        <span className="ml-auto flex items-center gap-2">
                            Re-closing after a change in an old year:
                            <label className="flex items-center gap-1"><input type="radio" checked={yc.reclosing_mode === 'auto'} onChange={() => setMode('auto')} disabled={busy} /> Auto</label>
                            <label className="flex items-center gap-1"><input type="radio" checked={yc.reclosing_mode === 'manual'} onChange={() => setMode('manual')} disabled={busy} /> Manual</label>
                            {(yc.years || []).some(y => y.closing?.needs_reclosing) && <button onClick={recloseAll} disabled={busy} className="px-2 py-1 bg-amber-600 text-white rounded text-xs">Re-close all</button>}
                        </span>
                        {yc.auto_reclosed > 0 && <span className="w-full text-xs text-emerald-700">{yc.auto_reclosed} out-of-date closing(s) were re-closed automatically.</span>}
                    </div>
                )}

                {alert && (
                    <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                        alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                        alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                        'bg-yellow-50 border-yellow-500 text-yellow-800'
                    }`}>
                        {alert.message}
                    </div>
                )}

                {showForm && (
                    <form ref={formRef} onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="erp-label">Fiscal Year Code *</label>
                                <input className="erp-input" placeholder="FY2082-83"
                                    value={form.fiscal_year_code} onChange={e => setForm({ ...form, fiscal_year_code: e.target.value })} required />
                            </div>
                            <div>
                                <label className="erp-label">Start Date *</label>
                                <input type="date" className="erp-input"
                                    value={form.start_date_eng} onChange={e => setForm({ ...form, start_date_eng: e.target.value })} required />
                            </div>
                            <div>
                                <label className="erp-label">End Date *</label>
                                <input type="date" className="erp-input"
                                    value={form.end_date_eng} onChange={e => setForm({ ...form, end_date_eng: e.target.value })} required />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">Create</button>
                        </div>
                    </form>
                )}

                <ReportGrid
                    columns={columns}
                    rows={rows}
                    getId={(r) => r.id}
                    storageKey="fiscal_year_grid"
                auditTable="fiscal_years"
                    rowActions={(row) => (
                        <div className="flex gap-2 justify-center">
                            {!row.is_current && !row.is_closed && (
                                <button onClick={() => setCurrent(row.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Set Current</button>
                            )}
                            {!closingOf(row.id).closing && (
                                <button onClick={() => openPreview(row)} disabled={busy} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Year Closing…</button>
                            )}
                            {closingOf(row.id).closing && (<>
                                <button onClick={() => reclose(row)} disabled={busy} className={`px-2 py-1 text-white rounded text-xs ${closingOf(row.id).closing.needs_reclosing ? 'bg-amber-600' : 'bg-gray-600'}`}>Re-close</button>
                                {!row.is_closed && <button onClick={() => openPreview(row)} disabled={busy} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Close &amp; Lock</button>}
                                {row.is_closed && <button onClick={() => reopen(row)} disabled={busy} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Re-open</button>}
                                <button onClick={() => showCarried(row)} className="px-2 py-1 bg-white border rounded text-xs">Stock c/f</button>
                                <button onClick={() => cancelClosing(row)} disabled={busy} className="px-2 py-1 bg-white border border-red-300 text-red-700 rounded text-xs">Cancel Closing</button>
                            </>)}
                        </div>
                    )}
                />

                {preview && (
                    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-auto p-4" onClick={() => setPreview(null)}>
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-5 mt-10" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-lg font-bold">Year Closing - {preview.data.fiscal_year_name}</h2>
                                <button onClick={() => setPreview(null)} className="text-gray-500">✕</button>
                            </div>
                            {preview.data.earlier_not_closed?.length > 0 && (
                                <div className="mb-3 px-3 py-2 rounded bg-red-50 text-red-800 text-sm">Close {preview.data.earlier_not_closed.join(', ')} first - years are closed in order.</div>
                            )}
                            <div className="flex items-center gap-2 mb-3 text-sm">
                                <span>Closing stock valued by</span>
                                <select className="erp-input" style={{ maxWidth: 260 }} value={preview.method} onChange={e => openPreview(preview.fy, e.target.value)}>
                                    {Object.entries(yc?.stock_methods || { weighted_average: 'Weighted Average (periodic)' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                                <span className="text-gray-500">on {preview.data.date}</span>
                            </div>
                            <table className="w-full text-sm mb-3">
                                <tbody>
                                    <tr><td>Income less expenses in the books ({preview.data.pl_ledgers.length} P&amp;L ledgers made nil)</td><td className="text-right">{money(preview.data.gl_result)}</td></tr>
                                    <tr><td>Opening stock</td><td className="text-right">{money(preview.data.opening_stock)}</td></tr>
                                    <tr><td>Closing stock (carried forward as next year's opening, {preview.data.stock_carried.length} items)</td><td className="text-right">{money(preview.data.closing_stock)}</td></tr>
                                    <tr><td>Stock entry: Closing Stock A/c {preview.data.stock_adjustment >= 0 ? 'Dr' : 'Cr'}</td><td className="text-right">{money(Math.abs(preview.data.stock_adjustment))}</td></tr>
                                    <tr className="font-bold border-t"><td>Net {preview.data.net_profit >= 0 ? 'profit to Profit & Loss A/c (Cr)' : 'loss to Profit & Loss A/c (Dr)'}</td><td className="text-right">{money(Math.abs(preview.data.net_profit))}</td></tr>
                                </tbody>
                            </table>
                            <details className="mb-3">
                                <summary className="cursor-pointer text-sm text-blue-700">P&amp;L ledgers brought to nil</summary>
                                <table className="w-full text-xs mt-2">
                                    <thead><tr className="text-left text-gray-500"><th>Ledger</th><th>Section</th><th className="text-right">Balance</th><th className="text-right">Closing entry</th></tr></thead>
                                    <tbody>{preview.data.pl_ledgers.map(l => (
                                        <tr key={l.ledger_id}><td>{l.name}</td><td>{l.section.replace('_', ' ')}</td><td className="text-right">{money(Math.abs(l.balance))} {l.balance >= 0 ? 'Dr' : 'Cr'}</td><td className="text-right">{money(Math.abs(l.balance))} {l.balance >= 0 ? 'Cr' : 'Dr'}</td></tr>
                                    ))}</tbody>
                                </table>
                            </details>
                            {preview.data.warnings?.length > 0 && <div className="mb-3 text-xs text-amber-700">{preview.data.warnings.slice(0, 5).join(' · ')}</div>}
                            <p className="text-xs text-gray-500 mb-3">The closing voucher is dated {preview.data.date}. The year is locked afterwards; it can be re-opened, re-closed or the closing cancelled later.</p>
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setPreview(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                                <button onClick={postClosing} disabled={busy || preview.data.earlier_not_closed?.length > 0} className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium disabled:opacity-50">
                                    {busy ? 'Posting…' : preview.data.already_closed ? 'Close again & Lock' : 'Post Year Closing'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {carried && (
                    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-auto p-4" onClick={() => setCarried(null)}>
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-5 mt-10" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-lg font-bold">Closing stock carried forward - {carried.fiscal_year_name}</h2>
                                <button onClick={() => setCarried(null)} className="text-gray-500">✕</button>
                            </div>
                            <table className="w-full text-sm">
                                <thead><tr className="text-left text-gray-500"><th>Code</th><th>Product</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Value</th></tr></thead>
                                <tbody>{carried.lines.map(l => (
                                    <tr key={l.product_id}><td>{l.product_code}</td><td>{l.product_name}</td><td className="text-right">{l.qty}</td><td className="text-right">{money(l.rate)}</td><td className="text-right">{money(l.value)}</td></tr>
                                ))}</tbody>
                                <tfoot><tr className="font-bold border-t"><td colSpan="4">Total</td><td className="text-right">{money(carried.closing_stock)}</td></tr></tfoot>
                            </table>
                        </div>
                    </div>
                )}
                {loading && <p className="text-sm text-gray-400 mt-2">Loading…</p>}
            </div>
        </Layout>
    );
}
