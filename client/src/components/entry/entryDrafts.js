// =============================================
// components/entry/entryDrafts.js
// Save as Draft keeps what is typed as a temporary draft (/api/entry-drafts):
// it gets no number and no ledger / stock effect, and never goes into the
// module's own table. The fill bar's Draft list opens it again; once the
// entry is saved for real the draft is deleted.
// The draft being finished is remembered per screen here (the fill bar sets
// it, the screen's Save clears it).
// =============================================
const current = {};

export const setCurrentDraft = (voucherType, id) => { current[voucherType] = id || null; };
export const currentDraft = voucherType => current[voucherType] || null;

const LINE_KEYS = ['details', 'lines', 'raw_materials', 'expense_lines', 'items'];
const lineCount = form => LINE_KEYS.reduce((n, k) => n + (Array.isArray(form[k]) ? form[k].filter(l => l && (l.product_id || l.ledger_id || l.account_id || Number(l.amount) || Number(l.debit) || Number(l.credit))).length : 0), 0);

/** Save as Draft: store (or update) the temporary draft of this screen; true when saved */
export async function saveEntryDraft(authFetch, voucherType, form) {
    const n = lineCount(form);
    const label = [form.doc_date || form.voucher_date || '', n ? `${n} line${n > 1 ? 's' : ''}` : '', form.narration || form.remarks_text || ''].filter(Boolean).join(' · ').slice(0, 200);
    try {
        const r = await authFetch('/api/entry-drafts', { method: 'POST', body: JSON.stringify({ voucher_type: voucherType, id: currentDraft(voucherType), label, payload: form }) });
        setCurrentDraft(voucherType, null);
        return r.data || true;
    } catch (e) {
        window.alert(`The draft was not saved: ${e.message}`);
        return false;
    }
}

/** the entry was saved for real: the draft it came from is finished and deleted */
export async function finishEntryDraft(authFetch, voucherType) {
    const id = currentDraft(voucherType);
    setCurrentDraft(voucherType, null);
    if (!id) return;
    try { await authFetch(`/api/entry-drafts/${id}`, { method: 'DELETE' }); } catch { /* left in the list; can be discarded there */ }
}
