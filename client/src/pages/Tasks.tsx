// =============================================
// Tasks.tsx  (/tasks?view=mine|assigned_by_me|watching|overdue|all&id=&new=1&darta=&title=)
// Task management: list or board (by status), new task (assign, watchers,
// priority, due date + time, repeat, tags, link to a darta / chalani),
// task detail with status / progress, comments and the change history.
// Everyone involved is notified (bell + popup + their chosen email / SMS /
// WhatsApp / Viber). Server: utils/tasks.js.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import NotifyLinks from '../components/NotifyLinks';
import type { AuthFetch, NotifyLink, TaskRow, WorkUser } from '../types/erp';

const STATUS: [TaskRow['status'], string, string][] = [
    ['todo', 'To do', 'bg-slate-100'], ['in_progress', 'In progress', 'bg-blue-50'], ['on_hold', 'On hold', 'bg-amber-50'], ['done', 'Done', 'bg-green-50'], ['cancelled', 'Cancelled', 'bg-gray-100']
];
const PRI: Record<string, string> = { low: 'bg-gray-100 text-gray-600', normal: 'bg-slate-100 text-slate-700', high: 'bg-orange-100 text-orange-800', urgent: 'bg-red-100 text-red-700' };
const VIEWS: [string, string][] = [['mine', 'My tasks'], ['assigned_by_me', 'Given by me'], ['watching', 'Watching'], ['overdue', 'Overdue'], ['all', 'All I can see']];
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const blank = () => ({ title: '', description: '', assigned_to: '', watchers: [] as string[], priority: 'normal', due_at: '', start_date: '', recurrence: 'none', tags: '', darta_chalani_id: '', related_label: '' });
type Form = ReturnType<typeof blank> & { id?: string };

export default function Tasks() {
    const { authFetch, user } = useAuth() as { authFetch: AuthFetch; user: { id: string } | null };
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const view = params.get('view') || 'mine';
    const [mode, setMode] = useState<'list' | 'board'>(() => { try { return (localStorage.getItem('tasks_mode') as 'list' | 'board') || 'list'; } catch { return 'list'; } });
    const [status, setStatus] = useState('open');
    const [q, setQ] = useState('');
    const [rows, setRows] = useState<TaskRow[]>([]);
    const [users, setUsers] = useState<WorkUser[]>([]);
    const [form, setForm] = useState<Form | null>(null);
    const [open, setOpen] = useState<TaskRow | null>(null);
    const [comment, setComment] = useState('');
    const [links, setLinks] = useState<NotifyLink[]>([]);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setError('');
        try {
            const qs = new URLSearchParams({ view, ...(status && mode === 'list' ? { status } : {}), ...(q ? { q } : {}) });
            const r = await authFetch<TaskRow[]>(`/api/tasks?${qs}`);
            setRows(r.data);
        } catch (e) { setError((e as Error).message); }
    }, [authFetch, view, status, q, mode]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { authFetch<WorkUser[]>('/api/work/users').then(r => setUsers(r.data)).catch(() => undefined); }, [authFetch]);
    useEffect(() => { try { localStorage.setItem('tasks_mode', mode); } catch { /* private mode */ } }, [mode]);

    const openTask = useCallback(async (id: string) => {
        try { const r = await authFetch<TaskRow>(`/api/tasks/${id}`); setOpen(r.data); } catch (e) { setError((e as Error).message); }
    }, [authFetch]);
    useEffect(() => {
        const id = params.get('id');
        if (id) openTask(id);
        if (params.get('new')) setForm({ ...blank(), title: params.get('title') || '', darta_chalani_id: params.get('darta') || '' });
    }, [params, openTask]);

    const set = (k: keyof Form, v: string | string[]) => setForm(p => (p ? { ...p, [k]: v } : p));
    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form) return;
        setError('');
        const body = { ...form, due_at: form.due_at ? new Date(form.due_at).toISOString() : null, tags: form.tags, assigned_to: form.assigned_to || null };
        try {
            const r = form.id ? await authFetch<TaskRow>(`/api/tasks/${form.id}`, { method: 'PUT', body: JSON.stringify(body) })
                : await authFetch<TaskRow>('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
            setLinks(r.data.notify_links || []); setForm(null); setOpen(r.data); load();
            if (params.get('new')) setParams(view !== 'mine' ? { view } : {});
        } catch (e2) { setError((e2 as Error).message); }
    };
    const patch = async (t: TaskRow, p: Partial<TaskRow>) => {
        try {
            const r = await authFetch<TaskRow>(`/api/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify(p) });
            setLinks(r.data.notify_links || []);
            if (open && open.id === t.id) setOpen(r.data);
            load();
        } catch (e) { setError((e as Error).message); }
    };
    const addComment = async () => {
        if (!open || !comment.trim()) return;
        try { await authFetch(`/api/tasks/${open.id}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) }); setComment(''); openTask(open.id); }
        catch (e) { setError((e as Error).message); }
    };
    const remove = async (t: TaskRow) => {
        if (!window.confirm(`Delete ${t.task_no}?`)) return;
        try { await authFetch(`/api/tasks/${t.id}`, { method: 'DELETE' }); setOpen(null); load(); } catch (e) { setError((e as Error).message); }
    };
    const edit = (t: TaskRow) => setForm({ id: t.id, title: t.title, description: t.description || '', assigned_to: t.assigned_to || '', watchers: t.watchers || [], priority: t.priority,
        due_at: toLocal(t.due_at), start_date: t.start_date ? String(t.start_date).slice(0, 10) : '', recurrence: t.recurrence, tags: (t.tags || []).join(', '),
        darta_chalani_id: t.darta_chalani_id || '', related_label: t.related_label || '' });
    const board = useMemo(() => STATUS.map(([k, l, bg]) => ({ k, l, bg, items: rows.filter(r => r.status === k) })), [rows]);
    const [dragId, setDragId] = useState<string | null>(null);

    const card = (t: TaskRow) => (
        <div key={t.id} draggable onDragStart={() => setDragId(t.id)} onClick={() => openTask(t.id)}
            className={`bg-white border rounded-lg p-2 mb-2 cursor-pointer hover:shadow ${t.is_overdue ? 'border-red-400' : 'border-slate-200'}`}>
            <div className="flex justify-between gap-1 text-[11px] text-gray-500"><span>{t.task_no}</span><span className={`px-1 rounded ${PRI[t.priority]}`}>{t.priority}</span></div>
            <p className="text-sm font-medium text-gray-900 leading-snug">{t.title}</p>
            <p className="text-[11px] text-gray-500 mt-1">{t.assigned_to_name || 'Unassigned'} · <span className={t.is_overdue ? 'text-red-600 font-semibold' : ''}>{t.due_at ? when(t.due_at) : 'no due date'}</span></p>
            {t.progress > 0 && t.status !== 'done' && <div className="h-1 bg-slate-100 rounded mt-1"><div className="h-1 bg-blue-600 rounded" style={{ width: `${t.progress}%` }} /></div>}
        </div>
    );

    return (
        <Layout>
            <div className="p-4 md:p-6">
                <div className="erp-card">
                    <div className="erp-header flex flex-wrap items-center justify-between gap-2">
                        <span>📝 Tasks</span>
                        <div className="flex flex-wrap gap-1 text-sm">
                            {VIEWS.map(([k, l]) => <button key={k} type="button" onClick={() => setParams(k === 'mine' ? {} : { view: k })} className={`px-3 py-1 rounded ${view === k ? 'bg-white text-slate-800' : 'text-white/80 hover:bg-white/10'}`}>{l}</button>)}
                        </div>
                    </div>
                    <div className="erp-tab-content">
                        <div className="flex flex-wrap gap-2 items-end mb-3" data-enter-scope>
                            <button type="button" className="erp-btn primary" onClick={() => { setOpen(null); setForm(blank()); }}>➕ New task</button>
                            <div className="flex border rounded overflow-hidden text-sm">
                                <button type="button" onClick={() => setMode('list')} className={`px-3 py-1 ${mode === 'list' ? 'bg-slate-800 text-white' : ''}`}>☰ List</button>
                                <button type="button" onClick={() => setMode('board')} className={`px-3 py-1 ${mode === 'board' ? 'bg-slate-800 text-white' : ''}`}>▦ Board</button>
                            </div>
                            {mode === 'list' && <select className="erp-select !w-auto text-sm" value={status} onChange={e => setStatus(e.target.value)}><option value="open">Open (not done)</option><option value="">All</option>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
                            <input className="erp-input !w-56 text-sm" placeholder="Search title…" value={q} onChange={e => setQ(e.target.value)} />
                            <button type="button" className="erp-btn" onClick={load}>🔍 Show</button>
                            <button type="button" className="erp-btn ml-auto" onClick={() => navigate('/work-dashboard')}>📊 Dashboard</button>
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        <NotifyLinks links={links} onClose={() => setLinks([])} />

                        {form && (
                            <form onSubmit={save} className="border rounded-lg p-4 mb-4 bg-slate-50">
                                <h3 className="font-semibold mb-3">{form.id ? 'Edit task' : 'New task'}</h3>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                    <div className="erp-field md:col-span-4"><label className="erp-label">Title *</label><input className="erp-input" required value={form.title} onChange={e => set('title', e.target.value)} /></div>
                                    <div className="erp-field md:col-span-4"><label className="erp-label">Details</label><textarea className="erp-input" rows={3} value={form.description} onChange={e => set('description', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Assign to</label><select className="erp-select" value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}><option value="">— nobody yet —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === user?.id ? ' (me)' : ''}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Due (date & time)</label><input type="datetime-local" className="erp-input" value={form.due_at} onChange={e => set('due_at', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Priority</label><select className="erp-select" value={form.priority} onChange={e => set('priority', e.target.value)}>{['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Repeat</label><select className="erp-select" value={form.recurrence} onChange={e => set('recurrence', e.target.value)}><option value="none">No</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
                                    <div className="erp-field"><label className="erp-label">Start date</label><input type="date" className="erp-input" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Tags (comma separated)</label><input className="erp-input" value={form.tags} onChange={e => set('tags', e.target.value)} /></div>
                                    <div className="erp-field md:col-span-2"><label className="erp-label">Related to (bill no., party …)</label><input className="erp-input" value={form.related_label} onChange={e => set('related_label', e.target.value)} /></div>
                                    <div className="md:col-span-4">
                                        <p className="erp-label">Watchers (also notified)</p>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm max-h-24 overflow-y-auto">
                                            {users.map(u => (
                                                <label key={u.id} className="flex items-center gap-1"><input type="checkbox" checked={form.watchers.includes(u.id)}
                                                    onChange={e => set('watchers', e.target.checked ? [...form.watchers, u.id] : form.watchers.filter(x => x !== u.id))} /> {u.name}</label>
                                            ))}
                                        </div>
                                    </div>
                                    {form.darta_chalani_id && <p className="text-sm text-gray-600 md:col-span-4">Linked to a darta / chalani entry.</p>}
                                </div>
                                <div className="flex justify-end gap-2 mt-3">
                                    <button type="button" className="erp-btn" onClick={() => { setForm(null); if (params.get('new')) setParams({}); }}>Cancel</button>
                                    <button type="submit" className="erp-btn primary">💾 Save & notify</button>
                                </div>
                            </form>
                        )}

                        {open && (
                            <div className="border rounded-lg p-4 mb-4">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs text-gray-500">{open.task_no} · created by {open.created_by_name || '—'} · {when(open.created_at)}</p>
                                        <h3 className="text-lg font-semibold">{open.title}</h3>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        <select className="erp-select !w-auto text-sm" value={open.status} onChange={e => patch(open, { status: e.target.value as TaskRow['status'] })}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                                        <button type="button" className="erp-btn" onClick={() => edit(open)}>✎ Edit</button>
                                        <button type="button" className="erp-btn" onClick={() => remove(open)}>🗑</button>
                                        <button type="button" className="erp-btn" onClick={() => { setOpen(null); if (params.get('id')) setParams(view !== 'mine' ? { view } : {}); }}>✕</button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm mt-2">
                                    <p><span className="text-gray-500">Assigned to:</span> {open.assigned_to_name || '—'}</p>
                                    <p><span className="text-gray-500">By:</span> {open.assigned_by_name || '—'}</p>
                                    <p><span className="text-gray-500">Due:</span> <span className={open.is_overdue ? 'text-red-600 font-semibold' : ''}>{when(open.due_at)}</span></p>
                                    <p><span className="text-gray-500">Priority:</span> <span className={`px-1 rounded ${PRI[open.priority]}`}>{open.priority}</span></p>
                                    {open.watcher_names.length > 0 && <p className="col-span-2"><span className="text-gray-500">Watchers:</span> {open.watcher_names.join(', ')}</p>}
                                    {open.recurrence !== 'none' && <p><span className="text-gray-500">Repeats:</span> {open.recurrence}</p>}
                                    {open.tags.length > 0 && <p><span className="text-gray-500">Tags:</span> {open.tags.join(', ')}</p>}
                                    {open.related_label && <p className="col-span-2"><span className="text-gray-500">Related:</span> {open.related_label}</p>}
                                    {open.darta && <p className="col-span-2"><span className="text-gray-500">Darta / Chalani:</span> <button type="button" className="text-blue-700 underline" onClick={() => navigate(`/darta-chalani?id=${open.darta!.id}`)}>{open.darta.reg_no} {open.darta.subject}</button></p>}
                                </div>
                                {open.description && <p className="text-sm mt-2 whitespace-pre-line">{open.description}</p>}
                                <div className="flex items-center gap-2 mt-3 text-sm">
                                    <span className="text-gray-500">Progress</span>
                                    <input type="range" min={0} max={100} step={10} value={open.progress} onChange={e => setOpen({ ...open, progress: Number(e.target.value) })}
                                        onMouseUp={() => patch(open, { progress: open.progress })} onKeyUp={() => patch(open, { progress: open.progress })} className="w-48" aria-label="Progress" />
                                    <span>{open.progress}%</span>
                                </div>
                                <div className="mt-4">
                                    <p className="font-semibold text-sm mb-2">Comments & history</p>
                                    <div className="space-y-2 max-h-72 overflow-y-auto">
                                        {(open.comments || []).map(c => (
                                            <div key={c.id} className={`text-sm rounded px-3 py-2 ${c.kind === 'change' ? 'bg-slate-50 text-gray-600' : 'bg-blue-50'}`}>
                                                <p className="text-[11px] text-gray-500">{c.user_name} · {when(c.created_at)}{c.kind === 'change' ? ' · change' : ''}</p>
                                                <p className="whitespace-pre-line">{c.body}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 mt-2" data-enter-nav="off">
                                        <textarea className="erp-input flex-1" rows={2} placeholder="Write a comment… (Ctrl+Enter to send)" value={comment} onChange={e => setComment(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); addComment(); } }} />
                                        <button type="button" className="erp-btn primary self-end" onClick={addComment}>Send</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {mode === 'board' ? (
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                {board.map(col => (
                                    <div key={col.k} className={`rounded-lg p-2 ${col.bg} min-h-[200px]`} onDragOver={e => e.preventDefault()}
                                        onDrop={() => { const t = rows.find(r => r.id === dragId); if (t && t.status !== col.k) patch(t, { status: col.k }); setDragId(null); }}>
                                        <p className="text-xs font-semibold uppercase text-gray-600 mb-2">{col.l} ({col.items.length})</p>
                                        {col.items.map(card)}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead><tr className="text-left text-xs uppercase text-gray-500 bg-slate-50">
                                        <th className="px-2 py-2">No.</th><th className="px-2">Task</th><th className="px-2">Assigned to</th><th className="px-2">By</th><th className="px-2">Due</th>
                                        <th className="px-2">Priority</th><th className="px-2">Status</th><th className="px-2">Progress</th>
                                    </tr></thead>
                                    <tbody>{rows.map(t => (
                                        <tr key={t.id} className={`border-t hover:bg-blue-50 cursor-pointer ${t.is_overdue ? 'bg-red-50' : ''}`} onClick={() => openTask(t.id)}>
                                            <td className="px-2 py-1.5 whitespace-nowrap">{t.task_no}</td>
                                            <td className="px-2">{t.title}{t.recurrence !== 'none' ? ' 🔁' : ''}</td>
                                            <td className="px-2">{t.assigned_to_name || ''}</td>
                                            <td className="px-2">{t.assigned_by_name || t.created_by_name || ''}</td>
                                            <td className={`px-2 whitespace-nowrap ${t.is_overdue ? 'text-red-600 font-semibold' : ''}`}>{t.due_at ? when(t.due_at) : ''}</td>
                                            <td className="px-2"><span className={`px-1 rounded text-xs ${PRI[t.priority]}`}>{t.priority}</span></td>
                                            <td className="px-2">{t.status_label}</td>
                                            <td className="px-2">{t.progress}%</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                                {rows.length === 0 && <p className="text-center text-gray-400 py-8">No tasks here.</p>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
