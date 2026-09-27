// =============================================
// DocActions.jsx
// Modify / Copy / Reverse / Remove on every transaction list row, and the
// Hold / Recall buttons of the entry form (server: documentActionRoutes.js).
//   Modify  - draft: opens it. Otherwise it is cancelled by the module's own
//             status route (ledger, stock and progress reversed), reopened as
//             a draft with the same number and opened for edit - post again
//             after changing it.
//   Remove  - draft: deleted. Otherwise cancelled, reopened, then deleted.
//   Reverse - the module's cancel (every effect reversed, document kept).
// System Control "IRD Billing" on: Sales Bill / Sales Return show only
// Cancel - never Modify or Remove once posted.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const policyCache = {};
const LINE_ARRAYS = ['details', 'lines', 'expense_lines', 'raw_materials', 'outputs', 'items'];
const today = () => new Date().toISOString().slice(0, 10);

export function useDocPolicy(type) {
    const { authFetch } = useAuth();
    const [policy, setPolicy] = useState(policyCache[type] || null);
    useEffect(() => {
        let alive = true;
        if (policyCache[type]) { setPolicy(policyCache[type]); return undefined; }
        authFetch(`/api/document-actions/policy?type=${type}`)
            .then(r => { policyCache[type] = r.data; if (alive) setPolicy(r.data); })
            .catch(() => { if (alive) setPolicy({ locked: false }); });
        return () => { alive = false; };
    }, [authFetch, type]);
    return policy;
}
export const clearDocPolicy = () => { Object.keys(policyCache).forEach(k => delete policyCache[k]); };

/** a loaded document turned into a new, unsaved entry (ids, number, status and links removed) */
export function asNewCopy(form, sourceId) {
    const f = { ...form };
    ['id', 'doc_no', 'created_at', 'updated_at', 'created_by', 'updated_by', 'posted_at', 'posted_by', 'cancelled_at', 'cancelled_by', 'cancellation_reason',
        'approved_at', 'approved_by', 'ird_synced', 'ird_sync_status', 'audit_locked'].forEach(k => { delete f[k]; });
    f.status = 'draft';
    if ('doc_date' in f) f.doc_date = today();
    LINE_ARRAYS.forEach(k => {
        if (!Array.isArray(f[k])) return;
        f[k] = f[k].map(line => {
            const d = { ...line };
            delete d.id;
            Object.keys(d).forEach(x => {
                if (sourceId && d[x] === sourceId) delete d[x];
                if (/^qty_(billed|delivered|ordered|received|returned|quoted)$/.test(x)) delete d[x];
            });
            return d;
        });
    });
    return f;
}

const btn = 'px-2 py-1 text-white rounded text-xs';

export default function DocActions({ type, api, row, onOpen, onCopy, onReverse, onDone, canReverse = true, removable = true }) {
    const { authFetch } = useAuth();
    const policy = useDocPolicy(type);
    const [busy, setBusy] = useState(false);
    const locked = !!policy?.locked;
    const status = row.status;
    const isDraft = status === 'draft';
    const isClosed = ['cancelled', 'rejected'].includes(status);

    const run = useCallback(async (fn) => {
        setBusy(true);
        try { await fn(); } catch (e) { window.alert(e.message); } finally { setBusy(false); }
    }, []);

    // cancel (if still live) and reopen as a draft
    const reopen = async (why) => {
        if (!isClosed) {
            await authFetch(`/api/${api}/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled', cancellation_reason: why }) });
        }
        await authFetch(`/api/document-actions/${type}/${row.id}/reopen`, { method: 'POST' });
    };

    const modify = () => run(async () => {
        if (!isDraft) {
            if (!window.confirm(`Modify ${row.doc_no || ''}?\n\nIts ledger / stock effect is reversed and it becomes a draft with the same number. Change it and Post again.`)) return;
            await reopen('Reopened for modification');
            onDone && onDone();
        }
        await onOpen({ ...row, status: 'draft' });
    });

    const remove = () => run(async () => {
        if (!window.confirm(`Remove ${row.doc_no || 'this entry'} completely? ${isDraft ? '' : 'Its ledger / stock effect is reversed first. '}This cannot be undone.`)) return;
        if (!isDraft) await reopen('Removed');
        await authFetch(`/api/${api}/${row.id}`, { method: 'DELETE' });
        onDone && onDone();
    });

    const canModify = isDraft || (!locked && status !== 'closed');
    const canRemove = removable && (isDraft || !locked);
    return (
        <>
            {canModify && <button type="button" disabled={busy} onClick={modify} className={`${btn} bg-sky-700`} title={isDraft ? 'Edit this draft' : 'Reverse, reopen as draft and edit'}>✏️ Modify</button>}
            {onCopy && <button type="button" disabled={busy} onClick={() => onCopy(row)} className={`${btn} bg-teal-600`} title="Copy into a new entry">⧉ Copy</button>}
            {canReverse && onReverse && !isDraft && !isClosed && status !== 'closed' && (
                <button type="button" disabled={busy} onClick={() => onReverse(row)} className={`${btn} bg-red-600`} title={locked ? 'IRD billing: cancel with a reason' : 'Reverse every ledger / stock effect'}>{locked ? 'Cancel' : '↩ Reverse'}</button>
            )}
            {canRemove && <button type="button" disabled={busy} onClick={remove} className={`${btn} bg-red-800`} title="Delete this entry">🗑 Remove</button>}
        </>
    );
}

/** Hold the entry being typed and recall it later (per user, per screen); hotkey: F8 opens the held list */
export function HoldButtons({ voucherType, form, label, onRecall, disabled, hotkey }) {
    const { authFetch } = useAuth();
    const [list, setList] = useState(null);
    const [count, setCount] = useState(0);
    const load = useCallback(async () => {
        try { const r = await authFetch(`/api/held-entries?voucher_type=${voucherType}`); setCount((r.data || []).length); return r.data || []; } catch { return []; }
    }, [authFetch, voucherType]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!hotkey) return undefined;
        const onKey = async e => { if (e.key === 'F8') { e.preventDefault(); setList(await load()); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [hotkey, load]);

    const hold = async () => {
        try {
            await authFetch('/api/held-entries', { method: 'POST', body: JSON.stringify({ voucher_type: voucherType, label: label || `Held ${new Date().toLocaleString()}`, payload: form }) });
            await load();
            onRecall && onRecall(null);
        } catch (e) { window.alert(e.message); }
    };
    const recall = async (h) => {
        try {
            await authFetch(`/api/held-entries/${h.id}`, { method: 'DELETE' });
            setList(null); load();
            onRecall && onRecall(h.payload);
        } catch (e) { window.alert(e.message); }
    };
    const discard = async (h) => {
        if (!window.confirm('Discard this held entry?')) return;
        try { await authFetch(`/api/held-entries/${h.id}`, { method: 'DELETE' }); setList(await load()); } catch (e) { window.alert(e.message); }
    };
    return (
        <>
            <button type="button" className="erp-btn" disabled={disabled} onClick={hold} title="Park this entry and start a new one">⏸ Hold</button>
            <button type="button" className="erp-btn" onClick={async () => setList(await load())} title="Bring back a held entry">▶ Recall{count ? ` (${count})` : ''}</button>
            {list && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setList(null)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-auto p-4" onClick={e => e.stopPropagation()} data-enter-nav="off">
                        <div className="flex justify-between items-center mb-3"><h3 className="font-semibold">Held entries</h3><button type="button" onClick={() => setList(null)}>✕</button></div>
                        {list.length === 0 ? <p className="text-sm text-gray-500">Nothing on hold.</p> : list.map(h => (
                            <div key={h.id} className="flex items-center gap-2 border rounded px-3 py-2 mb-2 text-sm">
                                <div className="flex-1 min-w-0"><div className="truncate font-medium">{h.label || 'Held entry'}</div><div className="text-xs text-gray-500">{new Date(h.created_at).toLocaleString()}</div></div>
                                <button type="button" className="px-2 py-1 bg-blue-600 text-white rounded text-xs" onClick={() => recall(h)}>Recall</button>
                                <button type="button" className="px-2 py-1 bg-gray-200 rounded text-xs" onClick={() => discard(h)}>Discard</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
