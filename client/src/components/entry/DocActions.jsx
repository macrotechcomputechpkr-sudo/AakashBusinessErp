// =============================================
// DocActions.jsx
// Modify / Copy / Cancel / Remove on every transaction list row
// (server: documentActionRoutes.js); Print sits beside them on each screen.
//   Modify  - draft: opens it. Otherwise it is cancelled by the module's own
//             status route (ledger, stock and progress reversed), reopened as
//             a draft with the same number and opened for edit - post again
//             after changing it.
//   Remove  - draft: deleted. Otherwise cancelled, reopened, then deleted.
//   Cancel  - the module's cancel (every effect reversed, document kept).
//   Copy    - a posted entry into a new one (a draft is opened with Modify
//             instead, so finishing it does not leave the draft behind).
// System Control "Computerized (IRD) Billing" on: a posted Sales Bill /
// Sales Return shows only Reverse - never Modify or Remove.
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
            {onCopy && !isDraft && <button type="button" disabled={busy} onClick={() => onCopy(row)} className={`${btn} bg-teal-600`} title="Copy into a new entry">⧉ Copy</button>}
            {canReverse && onReverse && !isDraft && !isClosed && status !== 'closed' && (
                <button type="button" disabled={busy} onClick={() => onReverse(row)} className={`${btn} bg-red-600`} title={locked ? 'Computerized billing: reverse this bill (kept, marked reversed)' : 'Cancel: every ledger / stock effect is reversed'}>{locked ? '↩ Reverse' : '⊘ Cancel'}</button>
            )}
            {canRemove && <button type="button" disabled={busy} onClick={remove} className={`${btn} bg-red-800`} title="Delete this entry">🗑 Remove</button>}
        </>
    );
}

/**
 * Save (not Save as Draft) makes the entry a transaction: the saved document is posted by its
 * module's own status route (ledger / stock effect), so a draft that was finished does not stay
 * a draft. A posting refusal (credit limit, stock ...) leaves it saved as a draft and says why.
 */
export async function finalizeEntry(authFetch, api, id, status = 'posted') {
    if (!id) return true;
    try {
        await authFetch(`/api/${api}/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
        return true;
    } catch (e) {
        window.alert(`Saved as a draft, but it could not be ${status}: ${e.message}\n\nOpen it from the Draft list to finish it.`);
        return false;
    }
}
