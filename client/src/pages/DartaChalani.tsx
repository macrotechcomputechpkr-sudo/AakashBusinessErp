// =============================================
// DartaChalani.tsx  (/darta-chalani?type=darta|chalani&id=&status=pending)
// Darta (incoming) / Chalani (outgoing) register: numbered per fiscal
// year (D-2082/83-0001), BS dates, sender / receiver, subject, assign to
// a user (notified), due date, status, reply link, make a task from it,
// print the slip, change history. Server: utils/dartaChalani.js.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import RecordHistory from '../components/RecordHistory';
import NotifyLinks from '../components/NotifyLinks';
import type { AuthFetch, DartaRow, NotifyLink, WorkUser } from '../types/erp';

const CHANNELS: [string, string][] = [['hand', 'By hand'], ['post', 'Post'], ['courier', 'Courier'], ['email', 'Email'], ['fax', 'Fax'], ['online', 'Online portal'], ['other', 'Other']];
const STATUSES: [string, string][] = [['open', 'Open'], ['in_progress', 'In progress'], ['replied', 'Replied'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];
const PRI: Record<string, string> = { low: 'text-gray-500', normal: 'text-gray-700', high: 'text-orange-600 font-semibold', urgent: 'text-red-600 font-bold' };
const today = () => new Date().toISOString().slice(0, 10);
const blank = (type: 'darta' | 'chalani') => ({
    entry_type: type, entry_date: today(), letter_no: '', letter_date: '', party_name: '', party_address: '', party_phone: '', party_email: '',
    subject: '', description: '', department_id: '', assigned_to: '', channel: 'hand', tracking_no: '', pages: '', priority: 'normal', status: 'open',
    due_date: '', reply_to_id: '', attachment_url: '', attachment_name: '', is_confidential: false, remarks: ''
});
type Form = ReturnType<typeof blank> & { id?: string };

export default function DartaChalani() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const type = (params.get('type') || '') as '' | 'darta' | 'chalani';
    const [f, setF] = useState({ date_from: '', date_to: '', status: params.get('status') || '', assigned_to: '', q: '' });
    const [rows, setRows] = useState<DartaRow[]>([]);
    const [users, setUsers] = useState<WorkUser[]>([]);
    const [depts, setDepts] = useState<{ id: string; department_name: string }[]>([]);
    const [form, setForm] = useState<Form | null>(null);
    const [nextNo, setNextNo] = useState<{ reg_no: string; date_bs: string | null } | null>(null);
    const [view, setView] = useState<DartaRow | null>(null);
    const [history, setHistory] = useState<DartaRow | null>(null);
    const [links, setLinks] = useState<NotifyLink[]>([]);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setError('');
        try {
            const qs = new URLSearchParams(Object.entries({ ...f, entry_type: type }).filter(([, v]) => v) as [string, string][]);
            const r = await authFetch<DartaRow[]>(`/api/darta-chalani?${qs}`);
            setRows(r.data);
        } catch (e) { setError((e as Error).message); }
    }, [authFetch, f, type]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [type]);
    useEffect(() => {
        authFetch<WorkUser[]>('/api/work/users').then(r => setUsers(r.data)).catch(() => undefined);
        authFetch<{ id: string; department_name: string }[]>('/api/departments').then(r => setDepts(Array.isArray(r.data) ? r.data : [])).catch(() => undefined);
    }, [authFetch]);
    const openView = useCallback(async (id: string) => {
        try { const r = await authFetch<DartaRow>(`/api/darta-chalani/${id}`); setView(r.data); } catch (e) { setError((e as Error).message); }
    }, [authFetch]);
    useEffect(() => { const id = params.get('id'); if (id) openView(id); }, [params, openView]);

    // number preview for a new entry
    useEffect(() => {
        if (!form || form.id) return;
        authFetch<{ reg_no: string; date_bs: string | null }>(`/api/darta-chalani/next-number?entry_type=${form.entry_type}&date=${form.entry_date}`).then(r => setNextNo(r.data)).catch(() => setNextNo(null));
    }, [authFetch, form?.entry_type, form?.entry_date, form?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const set = (k: keyof Form, v: string | boolean) => setForm(p => (p ? { ...p, [k]: v } : p));
    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form) return;
        setError('');
        try {
            const body = { ...form, pages: form.pages === '' ? null : form.pages };
            const r = form.id ? await authFetch<DartaRow>(`/api/darta-chalani/${form.id}`, { method: 'PUT', body: JSON.stringify(body) })
                : await authFetch<DartaRow>('/api/darta-chalani', { method: 'POST', body: JSON.stringify(body) });
            setMsg(`${r.data.reg_no} saved`); setLinks(r.data.notify_links || []); setForm(null); setView(r.data); load();
        } catch (e2) { setError((e2 as Error).message); }
    };
    const quickStatus = async (d: DartaRow, status: string) => {
        try { const r = await authFetch<DartaRow>(`/api/darta-chalani/${d.id}`, { method: 'PUT', body: JSON.stringify({ status }) }); setView(r.data); load(); }
        catch (e) { setError((e as Error).message); }
    };
    const remove = async (d: DartaRow) => {
        if (!window.confirm(`Delete ${d.reg_no}?`)) return;
        try { await authFetch(`/api/darta-chalani/${d.id}`, { method: 'DELETE' }); setView(null); load(); } catch (e) { setError((e as Error).message); }
    };
    const edit = (d: DartaRow) => setForm({
        ...blank(d.entry_type), ...Object.fromEntries(Object.entries(d).filter(([k]) => k in blank('darta')).map(([k, v]) => [k, v === null ? '' : typeof v === 'boolean' ? v : String(v).slice(0, k.endsWith('date') ? 10 : undefined)])), id: d.id
    } as Form);
    const reply = (d: DartaRow) => { setView(null); setForm({ ...blank('chalani'), party_name: d.party_name, party_address: d.party_address || '', party_email: d.party_email || '', subject: `Re: ${d.subject}`, reply_to_id: d.id, department_id: d.department_id || '' }); };
    const pending = useMemo(() => rows.filter(r => ['open', 'in_progress'].includes(r.status)).map(r => r), [rows]);
    const counts = useMemo(() => ({ d: rows.filter(r => r.entry_type === 'darta').length, c: rows.filter(r => r.entry_type === 'chalani').length, overdue: rows.filter(r => r.is_overdue).length }), [rows]);

    return (
        <Layout>
            <div className="p-4 md:p-6">
                <div className="erp-card">
                    <div className="erp-header flex flex-wrap items-center justify-between gap-2">
                        <span>📨 Darta / Chalani Register</span>
                        <div className="flex gap-1 text-sm">
                            {([['', 'All'], ['darta', 'Darta (incoming)'], ['chalani', 'Chalani (outgoing)']] as const).map(([k, l]) => (
                                <button key={k} type="button" onClick={() => setParams(k ? { type: k } : {})} className={`px-3 py-1 rounded ${type === k ? 'bg-white text-slate-800' : 'text-white/80 hover:bg-white/10'}`}>{l}</button>
                            ))}
                        </div>
                    </div>
                    <div className="erp-tab-content">
                        <div className="flex flex-wrap gap-2 mb-3">
                            <button type="button" className="erp-btn primary" onClick={() => { setView(null); setForm(blank('darta')); }}>➕ New Darta (incoming)</button>
                            <button type="button" className="erp-btn primary" onClick={() => { setView(null); setForm(blank('chalani')); }}>➕ New Chalani (outgoing)</button>
                            <button type="button" className="erp-btn" onClick={() => navigate('/work-dashboard')}>📊 Dashboard</button>
                            <span className="ml-auto text-sm text-gray-600 self-center">Darta {counts.d} · Chalani {counts.c} · Pending {pending.length}{counts.overdue ? <b className="text-red-600"> · Overdue {counts.overdue}</b> : null}</span>
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}
                        <NotifyLinks links={links} onClose={() => setLinks([])} />

                        {form && (
                            <form onSubmit={save} className="border rounded-lg p-4 mb-4 bg-slate-50">
                                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                                    <h3 className="font-semibold">{form.id ? 'Edit' : 'New'} {form.entry_type === 'darta' ? 'Darta (incoming)' : 'Chalani (outgoing)'}</h3>
                                    {!form.id && nextNo && <span className="text-sm">Number: <b>{nextNo.reg_no}</b>{nextNo.date_bs ? ` · ${nextNo.date_bs} BS` : ''}</span>}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                    <div className="erp-field"><label className="erp-label">Date *</label><input type="date" className="erp-input" required value={form.entry_date} onChange={e => set('entry_date', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Letter no. (patra sankhya)</label><input className="erp-input" value={form.letter_no} onChange={e => set('letter_no', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Letter date</label><input type="date" className="erp-input" value={form.letter_date} onChange={e => set('letter_date', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Channel</label><select className="erp-select" value={form.channel} onChange={e => set('channel', e.target.value)}>{CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                                    <div className="erp-field md:col-span-2"><label className="erp-label">{form.entry_type === 'darta' ? 'From (sender) *' : 'To (receiver) *'}</label><input className="erp-input" required value={form.party_name} onChange={e => set('party_name', e.target.value)} /></div>
                                    <div className="erp-field md:col-span-2"><label className="erp-label">Address</label><input className="erp-input" value={form.party_address} onChange={e => set('party_address', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Phone</label><input className="erp-input" value={form.party_phone} onChange={e => set('party_phone', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Email</label><input type="email" className="erp-input" value={form.party_email} onChange={e => set('party_email', e.target.value)} /></div>
                                    <div className="erp-field md:col-span-2"><label className="erp-label">Subject *</label><input className="erp-input" required value={form.subject} onChange={e => set('subject', e.target.value)} /></div>
                                    <div className="erp-field md:col-span-4"><label className="erp-label">Details</label><textarea className="erp-input" rows={2} value={form.description} onChange={e => set('description', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Department</label><select className="erp-select" value={form.department_id} onChange={e => set('department_id', e.target.value)}><option value="">—</option>{depts.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Give to (assign)</label><select className="erp-select" value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}><option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Action due by</label><input type="date" className="erp-input" value={form.due_date} onChange={e => set('due_date', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Priority</label><select className="erp-select" value={form.priority} onChange={e => set('priority', e.target.value)}>{['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Tracking / courier no.</label><input className="erp-input" value={form.tracking_no} onChange={e => set('tracking_no', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Pages</label><input type="number" min={0} className="erp-input" value={form.pages} onChange={e => set('pages', e.target.value)} /></div>
                                    {form.entry_type === 'chalani' && (
                                        <div className="erp-field md:col-span-2"><label className="erp-label">In reply to (darta)</label>
                                            <select className="erp-select" value={form.reply_to_id} onChange={e => set('reply_to_id', e.target.value)}><option value="">—</option>
                                                {rows.filter(r => r.entry_type === 'darta').map(r => <option key={r.id} value={r.id}>{r.reg_no} · {r.subject}</option>)}</select></div>
                                    )}
                                    {form.id && <div className="erp-field"><label className="erp-label">Status</label><select className="erp-select" value={form.status} onChange={e => set('status', e.target.value)}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
                                    <div className="erp-field md:col-span-2"><label className="erp-label">Scanned copy link (Drive / Dropbox / URL)</label><input className="erp-input" value={form.attachment_url} onChange={e => set('attachment_url', e.target.value)} /></div>
                                    <div className="erp-field md:col-span-2"><label className="erp-label">Remarks</label><input className="erp-input" value={form.remarks} onChange={e => set('remarks', e.target.value)} /></div>
                                    <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={form.is_confidential} onChange={e => set('is_confidential', e.target.checked)} /> Confidential (only me, the assignee and Darta editors can see it)</label>
                                </div>
                                <div className="flex justify-end gap-2 mt-3">
                                    <button type="button" className="erp-btn" onClick={() => setForm(null)}>Cancel</button>
                                    <button type="submit" className="erp-btn primary">💾 Save</button>
                                </div>
                            </form>
                        )}

                        {view && (
                            <div className="border rounded-lg p-4 mb-4 print-area">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="text-xs uppercase text-gray-500">{view.entry_type === 'darta' ? 'Darta (incoming)' : 'Chalani (outgoing)'} · FY {view.fiscal_year_label}</p>
                                        <h3 className="text-lg font-semibold">{view.reg_no} — {view.subject}</h3>
                                        <p className="text-sm text-gray-600">{view.entry_date_bs} BS ({String(view.entry_date).slice(0, 10)}) · {view.entry_type === 'darta' ? 'From' : 'To'} <b>{view.party_name}</b>{view.party_address ? `, ${view.party_address}` : ''}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-1 no-print">
                                        <select className="erp-select !w-auto text-sm" value={view.status} onChange={e => quickStatus(view, e.target.value)}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                                        <button type="button" className="erp-btn" onClick={() => edit(view)}>✎ Edit</button>
                                        {view.entry_type === 'darta' && <button type="button" className="erp-btn" onClick={() => reply(view)}>↩ Reply (chalani)</button>}
                                        <button type="button" className="erp-btn" onClick={() => navigate(`/tasks?new=1&darta=${view.id}&title=${encodeURIComponent(`${view.reg_no}: ${view.subject}`)}`)}>📝 Make a task</button>
                                        <button type="button" className="erp-btn" onClick={() => window.print()}>🖨 Print</button>
                                        <button type="button" className="erp-btn" onClick={() => setHistory(view)}>🕘 History</button>
                                        <button type="button" className="erp-btn" onClick={() => remove(view)}>🗑</button>
                                        <button type="button" className="erp-btn" onClick={() => { setView(null); setParams(type ? { type } : {}); }}>✕</button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm mt-3">
                                    <p><span className="text-gray-500">Letter no.:</span> {view.letter_no || '—'}</p>
                                    <p><span className="text-gray-500">Letter date:</span> {view.letter_date_bs || view.letter_date || '—'}</p>
                                    <p><span className="text-gray-500">Channel:</span> {CHANNELS.find(c => c[0] === view.channel)?.[1]}</p>
                                    <p><span className="text-gray-500">Tracking:</span> {view.tracking_no || '—'}</p>
                                    <p><span className="text-gray-500">Department:</span> {view.department_name || '—'}</p>
                                    <p><span className="text-gray-500">With:</span> {view.assigned_to_name || '—'}</p>
                                    <p><span className="text-gray-500">Due:</span> <span className={view.is_overdue ? 'text-red-600 font-semibold' : ''}>{view.due_date ? String(view.due_date).slice(0, 10) : '—'}</span></p>
                                    <p><span className="text-gray-500">Status:</span> {view.status_label}</p>
                                </div>
                                {view.description && <p className="text-sm mt-2 whitespace-pre-line">{view.description}</p>}
                                {view.attachment_url && <p className="text-sm mt-2"><a className="text-blue-700 underline" href={view.attachment_url} target="_blank" rel="noreferrer">📎 Scanned copy</a></p>}
                                {view.reply_to && <p className="text-sm mt-2">In reply to: <button type="button" className="text-blue-700 underline" onClick={() => openView(view.reply_to!.id)}>{view.reply_to.reg_no} {view.reply_to.subject}</button></p>}
                                {!!view.replies?.length && <p className="text-sm mt-1">Replies: {view.replies.map(r => <button key={r.id} type="button" className="text-blue-700 underline mr-2" onClick={() => openView(r.id)}>{r.reg_no}</button>)}</p>}
                                {!!view.tasks?.length && <p className="text-sm mt-1 no-print">Tasks: {view.tasks.map(t => <button key={t.id} type="button" className="text-blue-700 underline mr-2" onClick={() => navigate(`/tasks?id=${t.id}`)}>{t.task_no} {t.title} ({t.status})</button>)}</p>}
                            </div>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end mb-3 no-print" data-enter-scope>
                            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">Status</label><select className="erp-select" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">All</option><option value="pending">Pending (open / in progress)</option>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                            <div className="erp-field"><label className="erp-label">With</label><select className="erp-select" value={f.assigned_to} onChange={e => setF({ ...f, assigned_to: e.target.value })}><option value="">Anyone</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                            <div className="erp-field"><label className="erp-label">Search</label><input className="erp-input" placeholder="No., subject, party…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></div>
                            <button type="button" className="erp-btn primary" onClick={load}>🔍 Show</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead><tr className="text-left text-xs uppercase text-gray-500 bg-slate-50">
                                    <th className="px-2 py-2">No.</th><th className="px-2">Date (BS)</th><th className="px-2">Type</th><th className="px-2">From / To</th><th className="px-2">Subject</th>
                                    <th className="px-2">Letter no.</th><th className="px-2">Department</th><th className="px-2">With</th><th className="px-2">Due</th><th className="px-2">Priority</th><th className="px-2">Status</th>
                                </tr></thead>
                                <tbody>{rows.map(r => (
                                    <tr key={r.id} className={`border-t hover:bg-blue-50 cursor-pointer ${r.is_overdue ? 'bg-red-50' : ''}`} onClick={() => openView(r.id)}>
                                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.reg_no}{r.is_confidential ? ' 🔒' : ''}</td>
                                        <td className="px-2 whitespace-nowrap">{r.entry_date_bs || String(r.entry_date).slice(0, 10)}</td>
                                        <td className="px-2">{r.entry_type === 'darta' ? 'Darta' : 'Chalani'}</td>
                                        <td className="px-2">{r.party_name}</td>
                                        <td className="px-2">{r.subject}</td>
                                        <td className="px-2">{r.letter_no || ''}</td>
                                        <td className="px-2">{r.department_name || ''}</td>
                                        <td className="px-2">{r.assigned_to_name || ''}</td>
                                        <td className={`px-2 whitespace-nowrap ${r.is_overdue ? 'text-red-600 font-semibold' : ''}`}>{r.due_date ? String(r.due_date).slice(0, 10) : ''}</td>
                                        <td className={`px-2 ${PRI[r.priority] || ''}`}>{r.priority}</td>
                                        <td className="px-2">{r.status_label}</td>
                                    </tr>
                                ))}</tbody>
                            </table>
                            {rows.length === 0 && <p className="text-center text-gray-400 py-8">Nothing registered yet.</p>}
                        </div>
                    </div>
                </div>
            </div>
            {history && <RecordHistory table="darta_chalani" id={history.id} title={history.reg_no} onClose={() => setHistory(null)} />}
        </Layout>
    );
}
