// =============================================
// NotificationCenter.tsx
// The 🔔 bell (sidebar + phone top bar), its drop-down list and the popup
// toasts for new notifications (task assigned, comment, due / overdue,
// darta / chalani assigned ...). Polls /api/notifications every 30 s;
// when the ERP tab is in the background it also shows a desktop
// notification (if the browser allowed it). Email / SMS / WhatsApp /
// Viber copies are sent by the server per the user's settings
// (/notification-settings).
// =============================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { AuthFetch } from '../types/erp';

export interface Note { id: string; kind: string; title: string; body: string | null; link: string | null; priority: string; is_read: boolean; created_at: string }
interface State { rows: Note[]; unread: number; open: boolean; toasts: Note[] }
export interface NotificationApi extends State {
    toggle: () => void; close: () => void; openNote: (n: Note) => void; readAll: () => void; dismiss: (id: string) => void; refresh: () => void;
}

const POLL = 30000;
const ICON: Record<string, string> = { task_assigned: '📝', task_status: '🔄', task_comment: '💬', task_due: '⏰', task_overdue: '🚨', darta_assigned: '📨', darta_due: '⏰', darta_overdue: '🚨', general: '🔔' };
const ago = (s: string) => {
    const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(s).toLocaleDateString();
};

export function useNotifications(): NotificationApi {
    const { authFetch, user } = useAuth() as { authFetch: AuthFetch; user: { id?: string } | null };
    const navigate = useNavigate();
    const [st, setSt] = useState<State>({ rows: [], unread: 0, open: false, toasts: [] });
    const seen = useRef<Set<string> | null>(null);
    const popupOn = useRef(true);

    const refresh = useCallback(async () => {
        if (!user) return;
        try {
            const r = await authFetch<{ rows: Note[]; unread: number }>('/api/notifications?limit=30');
            const rows = r.data.rows || [];
            const first = seen.current === null;
            const fresh = first ? [] : rows.filter(n => !n.is_read && !seen.current!.has(n.id));
            seen.current = new Set(rows.map(n => n.id));
            setSt(s => ({ ...s, rows, unread: r.data.unread, toasts: popupOn.current ? [...fresh, ...s.toasts].slice(0, 4) : s.toasts }));
            if (fresh.length && popupOn.current && typeof document !== 'undefined' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
                fresh.slice(0, 3).forEach(n => { try { new Notification(n.title, { body: n.body || '', tag: n.id }); } catch { /* not allowed */ } });
            }
        } catch { /* offline or not signed in - try again next time */ }
    }, [authFetch, user]);

    useEffect(() => {
        authFetch<{ popup: boolean }>('/api/notifications/settings').then(r => { popupOn.current = r.data.popup !== false; }).catch(() => undefined);
        refresh();
        const id = setInterval(refresh, POLL);
        const onFocus = () => refresh();
        window.addEventListener('focus', onFocus);
        return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
    }, [refresh, authFetch]);

    // toasts close themselves
    useEffect(() => {
        if (!st.toasts.length) return undefined;
        const id = setTimeout(() => setSt(s => ({ ...s, toasts: s.toasts.slice(0, -1) })), 9000);
        return () => clearTimeout(id);
    }, [st.toasts]);

    const markRead = useCallback(async (ids?: string[]) => {
        try { await authFetch('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }); } catch { /* ignore */ }
        setSt(s => {
            const rows = s.rows.map(n => (!ids || ids.includes(n.id) ? { ...n, is_read: true } : n));
            return { ...s, rows, unread: ids ? Math.max(0, s.unread - s.rows.filter(n => ids.includes(n.id) && !n.is_read).length) : 0 };
        });
    }, [authFetch]);

    return {
        ...st,
        refresh,
        toggle: () => {
            setSt(s => ({ ...s, open: !s.open }));
            if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => undefined);
        },
        close: () => setSt(s => ({ ...s, open: false })),
        openNote: n => { if (!n.is_read) markRead([n.id]); setSt(s => ({ ...s, open: false, toasts: s.toasts.filter(x => x.id !== n.id) })); if (n.link) navigate(n.link); },
        readAll: () => markRead(),
        dismiss: id => setSt(s => ({ ...s, toasts: s.toasts.filter(x => x.id !== id) }))
    };
}

export function BellButton({ api, className = '' }: { api: NotificationApi; className?: string }) {
    return (
        <button type="button" data-enter-skip onClick={e => { e.stopPropagation(); api.toggle(); }} aria-label={`Notifications (${api.unread} unread)`}
            className={`relative px-2 py-1 rounded hover:bg-gray-100 text-lg leading-none ${className}`} title="Notifications">
            🔔{api.unread > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">{api.unread > 99 ? '99+' : api.unread}</span>}
        </button>
    );
}

/** The drop-down list and the popup toasts (render once, in Layout). */
export function NotificationOverlay({ api }: { api: NotificationApi }) {
    const navigate = useNavigate();
    return (
        <>
            {api.open && (
                <div className="fixed inset-0 z-[60]" onClick={api.close} data-enter-nav="off">
                    <div className="absolute left-2 md:left-64 top-12 md:top-3 w-[min(380px,calc(100vw-16px))] max-h-[75vh] bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-3 py-2 border-b">
                            <p className="font-semibold text-sm">Notifications {api.unread > 0 && <span className="text-xs text-red-600">({api.unread} new)</span>}</p>
                            <div className="flex gap-2 text-xs">
                                {api.unread > 0 && <button type="button" className="text-blue-700 hover:underline" onClick={api.readAll}>Mark all read</button>}
                                <button type="button" className="text-gray-600 hover:underline" onClick={() => { api.close(); navigate('/notification-settings'); }}>⚙ Settings</button>
                            </div>
                        </div>
                        <div className="overflow-y-auto">
                            {api.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No notifications yet</p>}
                            {api.rows.map(n => (
                                <button type="button" key={n.id} onClick={() => api.openNote(n)} className={`w-full text-left px-3 py-2 border-b last:border-0 hover:bg-slate-50 flex gap-2 ${n.is_read ? '' : 'bg-blue-50/60'}`}>
                                    <span className="text-lg leading-none mt-0.5">{ICON[n.kind] || '🔔'}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className={`block text-sm truncate ${n.is_read ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>{n.title}</span>
                                        {n.body && <span className="block text-xs text-gray-500 line-clamp-2 whitespace-pre-line">{n.body}</span>}
                                        <span className="block text-[11px] text-gray-400 mt-0.5">{ago(n.created_at)}</span>
                                    </span>
                                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-600 mt-2 shrink-0" />}
                                </button>
                            ))}
                        </div>
                        <div className="border-t px-3 py-2 flex justify-between text-xs">
                            <button type="button" className="text-blue-700 hover:underline" onClick={() => { api.close(); navigate('/tasks'); }}>My tasks</button>
                            <button type="button" className="text-blue-700 hover:underline" onClick={() => { api.close(); navigate('/work-dashboard'); }}>Work dashboard</button>
                        </div>
                    </div>
                </div>
            )}
            <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 w-[min(360px,calc(100vw-32px))] no-print" aria-live="polite">
                {api.toasts.map(n => (
                    <div key={n.id} role="status" className={`bg-white border-l-4 ${['task_overdue', 'darta_overdue'].includes(n.kind) || n.priority === 'urgent' ? 'border-red-600' : 'border-blue-600'} rounded-lg shadow-xl px-3 py-2 flex gap-2 animate-[fadeIn_.2s_ease-out]`}>
                        <span className="text-lg leading-none mt-0.5">{ICON[n.kind] || '🔔'}</span>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => api.openNote(n)}>
                            <span className="block text-sm font-semibold text-gray-900">{n.title}</span>
                            {n.body && <span className="block text-xs text-gray-600 line-clamp-3 whitespace-pre-line">{n.body}</span>}
                        </button>
                        <button type="button" className="text-gray-400 hover:text-gray-700 text-lg leading-none self-start" aria-label="Dismiss" onClick={() => api.dismiss(n.id)}>×</button>
                    </div>
                ))}
            </div>
        </>
    );
}
