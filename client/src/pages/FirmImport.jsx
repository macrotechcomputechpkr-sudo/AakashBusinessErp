// =============================================
// FirmImport.jsx (/firm-import) - Tools > Import from another Firm
// Copy masters and transactions from another firm (company / database) you
// can open into this one (server: routes/firmImportRoutes.js, utils/firmImport.js).
//   Masters      matched by code; new ones added (or existing updated), the
//                masters they need come along; opening balances on request
//   Transactions come in as DRAFTS with this firm's masters; "Post imported
//                drafts" posts them here (ledger / stock by this firm's rules)
// A record already imported is never imported twice (firm_import_log).
// =============================================
import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';

export default function FirmImport() {
    const { authFetch, tenant } = useAuth();
    const [meta, setMeta] = useState({ firms: [], masters: [], transactions: [] });
    const [f, setF] = useState({ source_tenant_id: '', date_from: '', date_to: '', posted_only: true, mode: 'skip', include_opening: false });
    const [masters, setMasters] = useState([]);
    const [txns, setTxns] = useState([]);
    const [prev, setPrev] = useState(null);
    const [report, setReport] = useState(null);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState(null);
    const [posting, setPosting] = useState(null);
    useEffect(() => { authFetch('/api/firm-import/sources').then(r => setMeta(r.data)).catch(e => setMsg({ t: 'danger', m: e.message })); }, [authFetch]);
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    const tick = (list, setList, k) => setList(list.includes(k) ? list.filter(x => x !== k) : [...list, k]);
    const needsOf = k => (meta.masters.find(m => m.key === k)?.needs || []);
    const withNeeds = list => { const out = new Set(); const add = k => { if (out.has(k)) return; needsOf(k).forEach(add); out.add(k); }; list.forEach(add); return out; };
    // transactions bring the masters they need (ledgers, sub-ledgers, products, billing terms)
    const auto = withNeeds([...masters, ...(txns.length ? (meta.txn_needs || []) : [])]);

    // after an import the counts are read again, keeping the result on screen
    const preview = async (keep = false) => {
        setBusy('preview'); if (!keep) { setMsg(null); setReport(null); }
        try {
            const p = new URLSearchParams({ source_tenant_id: f.source_tenant_id, ...(f.date_from ? { date_from: f.date_from } : {}), ...(f.date_to ? { date_to: f.date_to } : {}) });
            setPrev((await authFetch(`/api/firm-import/preview?${p}`)).data);
        } catch (e) { setMsg({ t: 'danger', m: e.message }); } finally { setBusy(''); }
    };
    const run = async () => {
        const firm = meta.firms.find(x => x.id === f.source_tenant_id);
        if (!window.confirm(`Import ${masters.length} master list(s) and ${txns.length} transaction type(s) from "${firm?.company_name}" into "${tenant?.company_name}"?\n\nTransactions come in as drafts.`)) return;
        setBusy('run'); setMsg(null);
        try {
            const r = await authFetch('/api/firm-import/run', { method: 'POST', body: JSON.stringify({ ...f, masters, transactions: txns }) });
            setReport(r.data); setMsg({ t: r.data.totals.failed ? 'warning' : 'success', m: r.message }); preview(true);
        } catch (e) { setMsg({ t: 'danger', m: e.message }); } finally { setBusy(''); }
    };
    // post the imported drafts one by one through each screen's own status route
    const postAll = async () => {
        const list = report.transactions.flatMap(t => (report.imported_ids[t.key] || []).map(d => ({ ...d, api: t.api, label: t.label })))
            .sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)));
        if (!list.length || !window.confirm(`Post ${list.length} imported draft(s) now (date order)? Their ledger / stock effect is made in this firm.`)) return;
        const st = { done: 0, total: list.length, failed: [] };
        setPosting({ ...st });
        for (const d of list) {
            try { await authFetch(`/api/${d.api}/${d.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'posted' }) }); }
            catch (e) { st.failed.push(`${d.label} ${d.doc_no}: ${e.message}`); }
            st.done += 1; setPosting({ ...st });
        }
    };

    return (
        <Layout>
            <div className="erp-shell px-4"><div className="erp-card">
                <div className="erp-header"><span className="erp-header-title">🔁 Import from another Firm (masters & transactions)</span></div>
                {msg && <div className={`mx-4 mt-2 px-3 py-2 text-sm border-l-4 ${msg.t === 'success' ? 'bg-green-50 border-green-500' : msg.t === 'warning' ? 'bg-amber-50 border-amber-500' : 'bg-red-50 border-red-500'}`}>{msg.m}</div>}
                <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                    <div className="erp-field md:col-span-2"><label className="erp-label">From firm *</label>
                        <select className="erp-select" value={f.source_tenant_id} onChange={e => { set('source_tenant_id', e.target.value); setPrev(null); setReport(null); }}>
                            <option value="">{meta.firms.length ? '— choose the firm to copy from —' : 'No other firm - ask for access to another company'}</option>
                            {meta.firms.map(x => <option key={x.id} value={x.id}>{x.company_name} ({x.tenant_code})</option>)}</select></div>
                    <div className="erp-field"><label className="erp-label">Into (this firm)</label><div className="erp-input bg-gray-100">{tenant?.company_name}</div></div>
                    <div className="erp-field"><label className="erp-label">Existing masters</label>
                        <select className="erp-select" value={f.mode} onChange={e => set('mode', e.target.value)}><option value="skip">Keep as they are (match by code)</option><option value="update">Update from the other firm</option></select></div>
                    <div className="erp-field"><label className="erp-label">Transactions from</label><input type="date" className="erp-input" value={f.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                    <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.posted_only} onChange={e => set('posted_only', e.target.checked)} /> Posted documents only</label>
                    <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.include_opening} onChange={e => set('include_opening', e.target.checked)} /> Copy opening balances / opening stock</label>
                    <div className="md:col-span-4"><button type="button" className="erp-btn primary" disabled={!f.source_tenant_id || !!busy} onClick={() => preview()}>{busy === 'preview' ? 'Reading…' : '🔍 Show what can be imported'}</button></div>
                </div>
                {prev && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 px-3 pb-3">
                        <div>
                            <div className="flex justify-between items-center mb-1"><b>Masters</b>
                                <span className="text-xs"><button type="button" className="underline" onClick={() => setMasters(prev.masters.filter(m => !m.error).map(m => m.key))}>all</button> · <button type="button" className="underline" onClick={() => setMasters([])}>none</button></span></div>
                            <table className="erp-grid-table" data-no-excel>
                                <thead><tr><th /><th>Master</th><th className="text-right">In that firm</th><th className="text-right">Already here</th><th className="text-right">New</th></tr></thead>
                                <tbody>{prev.masters.map(m => (
                                    <tr key={m.key} className={m.error ? 'text-gray-400' : ''}>
                                        <td><input type="checkbox" disabled={!!m.error} checked={masters.includes(m.key) || auto.has(m.key)} onChange={() => tick(masters, setMasters, m.key)} /></td>
                                        <td>{m.label}{!masters.includes(m.key) && auto.has(m.key) && <span className="text-[10px] text-blue-700"> (needed)</span>}{m.error && <span className="text-[10px]"> - {m.error}</span>}</td>
                                        <td className="text-right">{m.source ?? ''}</td><td className="text-right">{m.existing ?? ''}</td><td className="text-right font-semibold">{m.new ?? ''}</td>
                                    </tr>))}</tbody>
                            </table>
                            <p className="text-xs text-gray-500 mt-1">Matched by code (group code, ledger code, product code …). A master that is already here is kept (or updated, if chosen above); only new ones are added.</p>
                        </div>
                        <div>
                            <div className="flex justify-between items-center mb-1"><b>Transactions</b>
                                <span className="text-xs"><button type="button" className="underline" onClick={() => setTxns(prev.transactions.filter(t => !t.error).map(t => t.key))}>all</button> · <button type="button" className="underline" onClick={() => setTxns([])}>none</button></span></div>
                            <table className="erp-grid-table" data-no-excel>
                                <thead><tr><th /><th>Documents</th><th className="text-right">In that firm</th><th className="text-right">Posted</th><th className="text-right">Imported before</th></tr></thead>
                                <tbody>{prev.transactions.map(t => (
                                    <tr key={t.key} className={t.error ? 'text-gray-400' : ''}>
                                        <td><input type="checkbox" disabled={!!t.error} checked={txns.includes(t.key)} onChange={() => tick(txns, setTxns, t.key)} /></td>
                                        <td>{t.label}{t.error && <span className="text-[10px]"> - {t.error}</span>}</td>
                                        <td className="text-right">{t.source ?? ''}</td><td className="text-right">{t.posted ?? ''}</td><td className="text-right">{t.already ?? ''}</td>
                                    </tr>))}</tbody>
                            </table>
                            <p className="text-xs text-gray-500 mt-1">Documents come in as <b>drafts</b> with this firm's ledgers / products; the ledgers, sub-ledgers, products and billing terms they need come along (matched by code, new ones added). Posting them makes the ledger and stock effect here. A number already used here gets "-{'<firm code>'}".</p>
                        </div>
                        <div className="lg:col-span-2"><button type="button" className="erp-btn primary" disabled={!!busy || (!masters.length && !txns.length)} onClick={run}>{busy === 'run' ? 'Importing…' : `⬇ Import ${auto.size ? `${auto.size} master list(s)` : ''}${auto.size && txns.length ? ' + ' : ''}${txns.length ? `${txns.length} transaction type(s)` : ''}`}</button></div>
                    </div>
                )}
                {report && (
                    <div className="px-3 pb-4">
                        <b>Result</b>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-1">
                            {report.masters.length > 0 && <table className="erp-grid-table" data-no-excel><thead><tr><th>Master</th><th className="text-right">Added</th><th className="text-right">Matched</th><th className="text-right">Updated</th><th className="text-right">Failed</th></tr></thead>
                                <tbody>{report.masters.map(m => <tr key={m.key}><td>{m.label}</td><td className="text-right">{m.inserted}</td><td className="text-right">{m.matched}</td><td className="text-right">{m.updated}</td><td className={`text-right ${m.failed ? 'text-red-700 font-semibold' : ''}`}>{m.failed}</td></tr>)}</tbody></table>}
                            {report.transactions.length > 0 && <table className="erp-grid-table" data-no-excel><thead><tr><th>Documents</th><th className="text-right">Imported (draft)</th><th className="text-right">Skipped (before)</th><th className="text-right">Failed</th></tr></thead>
                                <tbody>{report.transactions.map(t => <tr key={t.key}><td>{t.label}</td><td className="text-right">{t.imported}</td><td className="text-right">{t.skipped}</td><td className={`text-right ${t.failed ? 'text-red-700 font-semibold' : ''}`}>{t.failed}</td></tr>)}</tbody></table>}
                        </div>
                        {report.totals.documents > 0 && (
                            <div className="mt-2 flex items-center gap-3">
                                <button type="button" className="erp-btn primary" disabled={posting && posting.done < posting.total} onClick={postAll}>✅ Post imported drafts</button>
                                {posting && <span className="text-sm">{posting.done} / {posting.total} posted{posting.failed.length ? ` · ${posting.failed.length} failed` : ''}</span>}
                            </div>
                        )}
                        {[...(report.errors || []), ...(posting?.failed || [])].length > 0 && (
                            <div className="mt-2 border border-red-200 bg-red-50 p-2 text-xs max-h-60 overflow-auto">{[...report.errors, ...(posting?.failed || [])].map((e, i) => <div key={i}>• {e}</div>)}</div>
                        )}
                    </div>
                )}
            </div></div>
        </Layout>
    );
}
