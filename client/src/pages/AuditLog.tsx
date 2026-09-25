// =============================================
// AuditLog.tsx  (/audit-log?tab=log|coverage&table=&record_id=)
// Every create / change / delete on masters and entries, from the
// database audit trigger (database/121): who, when, from which IP,
// and each changed field's old -> new value.
//   Log      - filter by date, module, table, action, user, source, text
//   Coverage - every table and whether it is audited; purge old entries
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import RecordHistory, { ACTION_STYLE, ChangeDetail, when } from '../components/RecordHistory';
import type { AuditEntry, AuthFetch } from '../types/erp';

interface TableInfo { table_name: string; label: string; module: string; audited: boolean; excluded: boolean; parent_table: string | null }
interface Page { rows: AuditEntry[]; page: number; has_more: boolean }
const MODULES = ['Masters', 'Sales', 'Purchase', 'Accounts', 'Inventory', 'Setup & Users'];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function AuditLog() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const tab = params.get('tab') === 'coverage' ? 'coverage' : 'log';
    const [f, setF] = useState({
        date_from: params.get('record_id') ? '2000-01-01' : daysAgo(7), date_to: today(), module: '', table: params.get('table') || '',
        action: '', user_id: '', source: '', q: '', record_id: params.get('record_id') || ''
    });
    const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
    const [rows, setRows] = useState<AuditEntry[]>([]);
    const [page, setPage] = useState(1);
    const [more, setMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [history, setHistory] = useState<{ table: string; id: string; title?: string } | null>(null);
    const [purgeBefore, setPurgeBefore] = useState('');
    const [msg, setMsg] = useState('');

    useEffect(() => {
        authFetch<TableInfo[]>('/api/audit-log/tables').then(r => setTables(r.data || [])).catch((e: Error) => setError(e.message));
        authFetch<{ id: string; name: string }[]>('/api/audit-log/users').then(r => setUsers(r.data || [])).catch(() => undefined);
    }, [authFetch]);

    const load = useCallback(async (p = 1) => {
        setLoading(true); setError('');
        try {
            const qs = new URLSearchParams(Object.entries({ ...f, page: String(p), page_size: '200' }).filter(([, v]) => v !== '') as [string, string][]);
            const r = await authFetch<Page>(`/api/audit-log?${qs}`);
            setRows(prev => (p === 1 ? r.data.rows : [...prev, ...r.data.rows]));
            setPage(p); setMore(r.data.has_more);
        } catch (e) { setError((e as Error).message); }
        finally { setLoading(false); }
    }, [authFetch, f]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (tab === 'log') load(1); }, [tab]);

    const tableOptions = useMemo(() => tables.filter(t => t.audited && (!f.module || t.module === f.module)), [tables, f.module]);
    const counts = useMemo(() => ({ audited: tables.filter(t => t.audited).length, excluded: tables.filter(t => t.excluded).length, missing: tables.filter(t => !t.audited && !t.excluded) }), [tables]);

    const purge = async () => {
        if (!purgeBefore || !window.confirm(`Remove audit entries older than ${purgeBefore}? This cannot be undone.`)) return;
        try { const r = await authFetch<{ removed: number }>('/api/audit-log/purge', { method: 'POST', body: JSON.stringify({ before: purgeBefore }) }); setMsg(`${r.data.removed} old entries removed`); }
        catch (e) { setError((e as Error).message); }
    };
    const openHistory = (e: AuditEntry) => setHistory(e.parent_id && e.parent_table
        ? { table: e.parent_table, id: e.parent_id, title: e.parent_label || undefined }
        : { table: e.table_name, id: e.record_id || '', title: e.record_label || undefined });

    return (
        <Layout>
            <div className="p-4 md:p-6">
                <div className="erp-card">
                    <div className="erp-header flex items-center justify-between">
                        <span>🕘 Audit Log</span>
                        <div className="flex gap-1 text-sm">
                            {(['log', 'coverage'] as const).map(t => (
                                <button key={t} type="button" onClick={() => setParams(t === 'log' ? {} : { tab: t })}
                                    className={`px-3 py-1 rounded ${tab === t ? 'bg-white text-slate-800' : 'text-white/80 hover:bg-white/10'}`}>{t === 'log' ? 'Changes' : 'Coverage'}</button>
                            ))}
                        </div>
                    </div>
                    <div className="erp-tab-content">
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}

                        {tab === 'log' && (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-enter-scope>
                                    <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Module</label>
                                        <select className="erp-select" value={f.module} onChange={e => { set('module', e.target.value); set('table', ''); }}><option value="">All</option>{MODULES.map(m => <option key={m}>{m}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Master / Entry</label>
                                        <select className="erp-select" value={f.table} onChange={e => set('table', e.target.value)}><option value="">All</option>{tableOptions.map(t => <option key={t.table_name} value={t.table_name}>{t.label}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Action</label>
                                        <select className="erp-select" value={f.action} onChange={e => set('action', e.target.value)}><option value="">All</option><option value="I">Created</option><option value="U">Changed</option><option value="D">Deleted</option></select></div>
                                    <div className="erp-field"><label className="erp-label">User</label>
                                        <select className="erp-select" value={f.user_id} onChange={e => set('user_id', e.target.value)}><option value="">All</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Made from</label>
                                        <select className="erp-select" value={f.source} onChange={e => set('source', e.target.value)}><option value="">All</option><option value="api">ERP screens</option><option value="db">Directly in the database</option></select></div>
                                    <div className="erp-field"><label className="erp-label">Doc no / name</label><input className="erp-input" value={f.q} onChange={e => set('q', e.target.value)} placeholder="e.g. SB-12 or party name" /></div>
                                    <div className="erp-field"><label className="erp-label">Record id</label><input className="erp-input" value={f.record_id} onChange={e => set('record_id', e.target.value)} /></div>
                                    <div className="flex items-end"><button type="button" className="erp-btn primary w-full" onClick={() => load(1)} disabled={loading}>🔍 Show</button></div>
                                </div>
                                <div className="overflow-x-auto mt-4">
                                    <table className="w-full text-sm">
                                        <thead><tr className="text-left text-xs uppercase text-gray-500 bg-slate-50">
                                            <th className="px-2 py-2">When</th><th className="px-2">User</th><th className="px-2">Module</th><th className="px-2">Master / Entry</th>
                                            <th className="px-2">Record</th><th className="px-2">Action</th><th className="px-2">What changed</th><th className="px-2">IP</th><th className="px-2"></th>
                                        </tr></thead>
                                        <tbody>
                                            {rows.map(e => (
                                                <tr key={e.id} className="border-t align-top">
                                                    <td className="px-2 py-1.5 whitespace-nowrap">{when(e.changed_at)}</td>
                                                    <td className="px-2">{e.user_name}</td>
                                                    <td className="px-2">{e.module}</td>
                                                    <td className="px-2">{e.table_label}</td>
                                                    <td className="px-2">{e.parent_label ? `${e.parent_label} › ` : ''}{e.record_label || (e.record_id || '').slice(0, 8)}</td>
                                                    <td className="px-2"><span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${ACTION_STYLE[e.action]}`}>{e.action_label}</span></td>
                                                    <td className="px-2 max-w-md"><ChangeDetail e={e} compact /></td>
                                                    <td className="px-2 text-xs text-gray-500">{e.ip_address || ''}</td>
                                                    <td className="px-2"><button type="button" data-enter-skip className="text-xs text-blue-700 hover:underline whitespace-nowrap" onClick={() => openHistory(e)}>History</button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {!loading && rows.length === 0 && <p className="text-center text-gray-400 py-8">No changes in this period.</p>}
                                    {loading && <p className="text-center text-gray-400 py-4">Loading…</p>}
                                    {more && !loading && <div className="text-center mt-3"><button type="button" className="erp-btn" onClick={() => load(page + 1)}>Load more</button></div>}
                                    <p className="text-xs text-gray-400 mt-2">{rows.length} change(s) shown</p>
                                </div>
                            </>
                        )}

                        {tab === 'coverage' && (
                            <>
                                <div className="flex flex-wrap gap-3 text-sm mb-3">
                                    <span className="px-3 py-1 border rounded">Audited: <b>{counts.audited}</b> tables</span>
                                    <span className="px-3 py-1 border rounded">Not needed (logs / caches rebuilt from documents): <b>{counts.excluded}</b></span>
                                    <span className={`px-3 py-1 border rounded ${counts.missing.length ? 'border-red-400 text-red-700' : ''}`}>Missing: <b>{counts.missing.length}</b>
                                        {counts.missing.length > 0 && ' - run: SELECT tenant_master.audit_attach_all();'}</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead><tr className="text-left text-xs uppercase text-gray-500 bg-slate-50"><th className="px-2 py-2">Table</th><th className="px-2">Module</th><th className="px-2">Audited</th><th className="px-2">Belongs to (line rows)</th></tr></thead>
                                        <tbody>{tables.map(t => (
                                            <tr key={t.table_name} className="border-t">
                                                <td className="px-2 py-1">{t.label} <span className="text-xs text-gray-400">{t.table_name}</span></td>
                                                <td className="px-2">{t.module}</td>
                                                <td className="px-2">{t.audited ? <span className="text-green-700">✔ Yes</span> : t.excluded ? <span className="text-gray-400">Not needed</span> : <span className="text-red-600">✖ No</span>}</td>
                                                <td className="px-2 text-gray-500">{t.parent_table || ''}</td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>
                                <div className="mt-6 border-t pt-4" data-enter-scope>
                                    <p className="text-sm font-semibold mb-1">Remove old entries</p>
                                    <p className="text-xs text-gray-500 mb-2">Only entries older than 12 months can be removed (needs Audit Log delete right). The log itself cannot be edited.</p>
                                    <div className="flex gap-2 items-end">
                                        <div className="erp-field"><label className="erp-label">Remove entries before</label><input type="date" className="erp-input" value={purgeBefore} onChange={e => setPurgeBefore(e.target.value)} /></div>
                                        <button type="button" className="erp-btn" onClick={purge}>Remove</button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
            {history && history.id && <RecordHistory table={history.table} id={history.id} title={history.title} onClose={() => setHistory(null)} />}
        </Layout>
    );
}
