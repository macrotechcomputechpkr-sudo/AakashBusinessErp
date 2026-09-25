// =============================================
// RecordHistory.tsx
// "History" of one master / entry record from the audit log
// (database/121): who created it, every change with the old -> new value
// of each field, deletes - including the document's line rows.
// legacyUrl: the older action-only trail (/api/<doc>/:id/audit-trail),
// shown under "Earlier history" for changes made before the audit log.
// Also exports the small pieces the Audit Log page reuses.
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { AuditEntry, AuthFetch } from '../types/erp';

// bookkeeping columns nobody needs to read in a history
const HIDDEN = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'display_order']);

export const fieldLabel = (k: string): string => k.replace(/_snapshot$/, '').replace(/_id$/, '').replace(/_/g, ' ');
export function showValue(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 200);
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}T/.test(s) ? new Date(s).toLocaleString() : s.slice(0, 200);
}
export const when = (s: string): string => new Date(s).toLocaleString();
export const ACTION_STYLE: Record<string, string> = {
    I: 'bg-green-100 text-green-800', U: 'bg-amber-100 text-amber-800', D: 'bg-red-100 text-red-700'
};

/** The field-level detail of one audit entry. */
export function ChangeDetail({ e, compact = false }: { e: AuditEntry; compact?: boolean }) {
    if (e.action === 'U') {
        const keys = (e.changed_fields || []).filter(k => k !== 'updated_at' && k !== 'updated_by');
        const list = compact ? keys.slice(0, 3) : keys;
        return (
            <div className="text-xs">
                {list.map(k => (
                    <div key={k} className="flex flex-wrap gap-1">
                        <span className="text-gray-500 capitalize">{fieldLabel(k)}:</span>
                        <span className="line-through text-red-600">{showValue(e.old_data?.[k])}</span>
                        <span>→</span>
                        <span className="text-green-700 font-medium">{showValue(e.new_data?.[k])}</span>
                    </div>
                ))}
                {compact && keys.length > 3 && <span className="text-gray-400">+{keys.length - 3} more</span>}
            </div>
        );
    }
    const row = (e.action === 'I' ? e.new_data : e.old_data) || {};
    const keys = Object.keys(row).filter(k => !HIDDEN.has(k) && row[k] !== null && row[k] !== '' && row[k] !== false);
    if (compact) return <span className="text-xs text-gray-500">{keys.length} field(s) {e.action === 'I' ? 'entered' : 'removed'}</span>;
    return (
        <details className="text-xs">
            <summary className="cursor-pointer text-gray-500">{keys.length} field(s) {e.action === 'I' ? 'entered' : 'at the time of deleting'}</summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-1">
                {keys.map(k => <div key={k}><span className="text-gray-500 capitalize">{fieldLabel(k)}:</span> {showValue(row[k])}</div>)}
            </div>
        </details>
    );
}

interface LegacyEntry { id: string; action: string; performed_at: string; performer?: { full_name?: string } | null }

export default function RecordHistory({ table, id, title, legacyUrl, onClose }: { table: string; id: string; title?: string; legacyUrl?: string; onClose: () => void }) {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [rows, setRows] = useState<AuditEntry[] | null>(null);
    const [legacy, setLegacy] = useState<LegacyEntry[]>([]);
    const [error, setError] = useState('');
    const [lines, setLines] = useState(true);

    useEffect(() => {
        let live = true;
        authFetch<{ rows: AuditEntry[] }>(`/api/audit-log/record/${table}/${id}`)
            .then(r => { if (live) setRows(r.data.rows); })
            .catch((e: Error) => { if (live) { setRows([]); setError(e.message); } });
        if (legacyUrl) authFetch<LegacyEntry[]>(legacyUrl).then(r => { if (live) setLegacy(r.data || []); }).catch(() => undefined);
        return () => { live = false; };
    }, [authFetch, table, id, legacyUrl]);

    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [onClose]);

    const shown = (rows || []).filter(r => lines || r.table_name === table);
    const hasLines = (rows || []).some(r => r.table_name !== table);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" data-enter-nav="off" onClick={onClose}>
            <div className="bg-white rounded-xl p-5 w-full max-w-3xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                        <h3 className="font-semibold text-lg">History — {title || id}</h3>
                        <p className="text-xs text-gray-500">Every change with the old and new value, who made it and when.</p>
                    </div>
                    <button type="button" className="text-gray-500 text-xl leading-none" onClick={onClose} aria-label="Close">×</button>
                </div>
                {hasLines && <label className="text-xs flex items-center gap-1 mb-2"><input type="checkbox" checked={lines} onChange={e => setLines(e.target.checked)} /> Include line / detail rows</label>}
                {rows === null && <p className="text-sm text-gray-400">Loading…</p>}
                {error && <p className="text-sm text-red-600">{error}</p>}
                {rows !== null && !error && shown.length === 0 && <p className="text-sm text-gray-400">No changes recorded yet.</p>}
                <div className="space-y-2">
                    {shown.map(e => (
                        <div key={e.id} className="border rounded-lg px-3 py-2 text-sm">
                            <div className="flex flex-wrap items-center gap-2 text-xs mb-1">
                                <span className={`px-1.5 py-0.5 rounded font-semibold ${ACTION_STYLE[e.action]}`}>{e.action_label}</span>
                                {e.table_name !== table && <span className="text-gray-600">{e.table_label}{e.record_label ? ` · ${e.record_label}` : ''}</span>}
                                <span className="ml-auto text-gray-500">{e.user_name || 'Unknown'} · {when(e.changed_at)}{e.ip_address ? ` · ${e.ip_address}` : ''}</span>
                            </div>
                            <ChangeDetail e={e} />
                        </div>
                    ))}
                </div>
                {legacy.length > 0 && (
                    <details className="mt-4">
                        <summary className="text-sm text-gray-600 cursor-pointer">Earlier history (actions only, {legacy.length})</summary>
                        <div className="space-y-1 mt-2">
                            {legacy.map(e => (
                                <div key={e.id} className="flex justify-between border rounded px-3 py-1 text-xs text-gray-600">
                                    <span className="capitalize">{String(e.action).replace(/_/g, ' ')}</span>
                                    <span>{e.performer?.full_name || 'Unknown'} · {when(e.performed_at)}</span>
                                </div>
                            ))}
                        </div>
                    </details>
                )}
                <div className="flex justify-end mt-4">
                    <a className="text-sm text-blue-700 hover:underline mr-auto self-center" href={`/audit-log?table=${table}&record_id=${id}`}>Open in Audit Log</a>
                    <button type="button" className="px-4 py-2 border rounded-lg" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
