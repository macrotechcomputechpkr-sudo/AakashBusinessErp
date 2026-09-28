// =============================================
// TaxReconciliation.jsx
// Do the registers and the books agree? Document by document, for the same
// dates (server: utils/taxReconciliation.js via /api/vat-reports/reconciliation):
//   Overview          the four checks side by side - Tallied / Not tallied
//   VAT               VAT register (bills, returns, notes, expense bills,
//                     taxable JVs)                      <-> VAT ledgers
//   Sales Account     sales register incl. JV sales      <-> sales accounts
//   Purchase Account  purchase register incl. expense bills and JV
//                     purchases (bills from a GRN with that GRN) <-> purchase accounts
//   TDS               TDS on bills, JVs, expense bills   <-> TDS ledgers
// Each row: Register, Books, Difference and why (Matched / Difference /
// Only in register / Only in books). The accounts compared are found
// automatically and can be changed (add / remove) for a check.
// =============================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import ReportGrid from '../components/ReportGrid';
import SearchablePopupSelect from '../components/SearchablePopupSelect';

const TABS = [['overview', 'Overview'], ['vat', 'VAT'], ['sales', 'Sales Account'], ['purchase', 'Purchase Account'], ['tds', 'TDS']];
const STATUS = {
    matched: ['Matched', 'bg-green-100 text-green-800'], difference: ['Difference', 'bg-red-100 text-red-800'],
    register_only: ['Only in register', 'bg-amber-100 text-amber-800'], books_only: ['Only in books', 'bg-blue-100 text-blue-800']
};
const money = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const today = () => new Date().toISOString().slice(0, 10);

function Tally({ s }) {
    return s.tallied
        ? <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800">✔ Tallied</span>
        : <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">✖ Not tallied</span>;
}

export default function TaxReconciliation() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'overview');
    const [from, setFrom] = useState(monthStart());
    const [to, setTo] = useState(today());
    const [status, setStatus] = useState('');
    const [custom, setCustom] = useState({});          // section -> [ledger ids] chosen by the user
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [ledgers, setLedgers] = useState([]);

    useEffect(() => { authFetch('/api/ledger-accounts').then(r => setLedgers(r.data || [])).catch(() => {}); }, [authFetch]);

    const load = useCallback(async () => {
        setLoading(true); setErr('');
        try {
            const p = new URLSearchParams({ section: tab === 'overview' ? 'all' : tab });
            if (from) p.set('date_from', from);
            if (to) p.set('date_to', to);
            if (tab !== 'overview' && custom[tab]?.length) p.set('ledger_ids', custom[tab].join(','));
            setData((await authFetch(`/api/vat-reports/reconciliation?${p}`)).data);
        } catch (e) { setErr(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, tab, from, to, custom]);
    useEffect(() => { load(); }, [load]);

    const rows = useMemo(() => (data?.rows || []).filter(r => !status || r.status === status), [data, status]);
    const s = data?.summary;
    const setAccounts = ids => setCustom(c => ({ ...c, [tab]: ids }));
    const accountIds = tab !== 'overview' ? (custom[tab]?.length ? custom[tab] : (data?.ledgers || []).map(l => l.id)) : [];

    const columns = [
        { key: 'doc_date', label: 'Date', type: 'text' },
        { key: 'label', label: 'Type', type: 'text' },
        { key: 'doc_no', label: 'Doc No', type: 'text', render: r => r.doc_no || <span className="text-gray-400">{r.narration || '—'}</span> },
        { key: 'party_name', label: 'Party', type: 'text' },
        { key: 'register', label: 'Register', type: 'number' },
        { key: 'books', label: 'Books (GL)', type: 'number' },
        { key: 'difference', label: 'Difference', type: 'number', render: r => <span className={Math.abs(r.difference) >= 0.01 ? 'text-red-700 font-semibold' : ''}>{money(r.difference)}</span> },
        { key: 'status', label: 'Status', type: 'text', render: r => <span className={`px-1.5 rounded text-xs ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span> },
        { key: 'books_debit', label: 'Books Dr', type: 'number' },
        { key: 'books_credit', label: 'Books Cr', type: 'number' },
        { key: 'accounts', label: 'Posted to', type: 'text' }
    ];

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">⚖ Tax & Account Reconciliation</span></div>
                    <div className="erp-tabs">
                        {TABS.map(([k, l]) => <button key={k} type="button" className={`erp-tab ${tab === k ? 'active' : ''}`} onClick={() => { setTab(k); setStatus(''); setData(null); }}>{l}</button>)}
                    </div>
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={from} onChange={e => setFrom(e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={to} onChange={e => setTo(e.target.value)} /></div>
                        {tab !== 'overview' && (
                            <div className="erp-field"><label className="erp-label">Show</label>
                                <select className="erp-select" value={status} onChange={e => setStatus(e.target.value)}>
                                    <option value="">All documents</option>
                                    {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                                </select>
                            </div>
                        )}
                        <div className="erp-field justify-end"><button type="button" className="erp-btn primary" onClick={load}>🔍 Show</button></div>
                    </div>
                    {err && <div className="nav-msg err mx-3">{err}</div>}

                    {tab === 'overview' && data && !data.rows && (
                        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                            {Object.entries(data).map(([k, x]) => (
                                <div key={k} className="border rounded p-3 bg-white">
                                    <div className="flex items-center justify-between mb-1">
                                        <button type="button" className="font-semibold text-[#1a4a8a] hover:underline" onClick={() => setTab(k)}>{x.label} ▸</button>
                                        <Tally s={x.summary} />
                                    </div>
                                    <table className="w-full text-sm">
                                        <tbody>
                                            <tr><td>Register</td><td className="text-right font-mono">{money(x.summary.register)}</td></tr>
                                            <tr><td>Books (GL)</td><td className="text-right font-mono">{money(x.summary.books)}</td></tr>
                                            <tr className="font-semibold"><td>Difference</td><td className={`text-right font-mono ${Math.abs(x.summary.difference) >= 0.01 ? 'text-red-700' : ''}`}>{money(x.summary.difference)}</td></tr>
                                        </tbody>
                                    </table>
                                    <div className="text-xs text-gray-600 mt-1">
                                        {x.summary.count.matched} matched · {x.summary.count.difference} with difference · {x.summary.count.register_only} only in register · {x.summary.count.books_only} only in books
                                    </div>
                                    <div className="text-xs text-gray-400">{x.convention} · {x.ledgers.length} account(s): {x.ledgers.map(l => l.name).join(', ') || 'none found - set them in System Control'}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {tab !== 'overview' && data && data.rows && (
                        <div className="p-3">
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-2 text-sm">
                                <div className="border rounded p-2"><div className="text-xs text-gray-500">Register</div><div className="font-mono font-semibold">{money(s.register)}</div></div>
                                <div className="border rounded p-2"><div className="text-xs text-gray-500">Books (GL)</div><div className="font-mono font-semibold">{money(s.books)}</div></div>
                                <div className="border rounded p-2"><div className="text-xs text-gray-500">Difference</div><div className={`font-mono font-semibold ${Math.abs(s.difference) >= 0.01 ? 'text-red-700' : 'text-green-700'}`}>{money(s.difference)}</div></div>
                                <button type="button" className="border rounded p-2 text-left hover:bg-red-50" onClick={() => setStatus('difference')}><div className="text-xs text-gray-500">Differences ({s.count.difference})</div><div className="font-mono">{money(s.amount.difference)}</div></button>
                                <button type="button" className="border rounded p-2 text-left hover:bg-amber-50" onClick={() => setStatus('register_only')}><div className="text-xs text-gray-500">Only in register ({s.count.register_only})</div><div className="font-mono">{money(s.amount.register_only)}</div></button>
                                <button type="button" className="border rounded p-2 text-left hover:bg-blue-50" onClick={() => setStatus('books_only')}><div className="text-xs text-gray-500">Only in books ({s.count.books_only})</div><div className="font-mono">{money(s.amount.books_only)}</div></button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                                <Tally s={s} />
                                <span className="text-gray-500">{data.convention}. Difference = Books − Register.</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 mb-2 text-xs">
                                <span className="font-semibold">Accounts compared:</span>
                                {(data.ledgers || []).map(l => (
                                    <span key={l.id} className="px-1.5 py-0.5 bg-gray-100 border rounded">{l.name}
                                        <button type="button" className="ml-1 text-red-600" title="Leave out" onClick={() => setAccounts(accountIds.filter(x => x !== l.id))}>×</button></span>
                                ))}
                                <div style={{ width: 220 }}>
                                    <SearchablePopupSelect listKey="reco_add_ledger" items={ledgers.filter(l => !accountIds.includes(l.id))} getId={l => l.id} getLabel={l => l.account_name}
                                        columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']} searchKeys={['account_name', 'account_code']}
                                        value="" onChange={id => id && setAccounts([...accountIds, id])} placeholder="+ add an account" />
                                </div>
                                {custom[tab]?.length > 0 && <button type="button" className="nav-btn small" onClick={() => setAccounts([])}>Automatic</button>}
                            </div>
                            <details className="mb-2 text-sm"><summary className="cursor-pointer text-[#1a4a8a]">By document type</summary>
                                <table className="erp-grid-table mt-1" data-no-excel>
                                    <thead><tr><th>Type</th><th className="text-right">Docs</th><th className="text-right">Register</th><th className="text-right">Books</th><th className="text-right">Difference</th></tr></thead>
                                    <tbody>{s.by_type.map(x => (
                                        <tr key={x.label}><td>{x.label}</td><td className="text-right">{x.count}</td><td className="text-right">{money(x.register)}</td><td className="text-right">{money(x.books)}</td>
                                            <td className={`text-right ${Math.abs(x.difference) >= 0.01 ? 'text-red-700 font-semibold' : ''}`}>{money(x.difference)}</td></tr>
                                    ))}</tbody>
                                </table>
                            </details>
                            <div className="text-xs text-gray-500 mb-1">{loading ? 'Loading…' : `${rows.length} document(s)`}</div>
                            <ReportGrid columns={columns} rows={rows} getId={r => r.key} storageKey={`tax_reco_${tab}`} />
                        </div>
                    )}
                    {loading && !data && <p className="p-3 text-sm text-gray-500">Loading…</p>}
                </div>
            </div>
        </Layout>
    );
}
