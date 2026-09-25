// =============================================
// utils/termSubLedgers.js
// Per-transaction sub-ledger for each billing term. The entry popup shows
// the term's ledger read-only and lets the user change the sub-ledger;
// that choice is stored on document_billing_terms /
// document_line_billing_terms.sub_ledger_id and used by GL posting.
// A term the user didn't touch gets the master's default:
// Return Sub-Ledger on return documents (else Billing Sub-Ledger),
// Billing Sub-Ledger everywhere else.
// =============================================

const RETURN_DOC_TYPES = new Set(['purchase_return', 'purchase_nonsalable_return']);

async function applyTermSubLedgers(tenantClient, tenantId, documentType, documentId, chosen) {
    const map = chosen && typeof chosen === 'object' ? chosen : {};
    const [{ data: dt }, { data: lt }] = await Promise.all([
        tenantClient.from('document_billing_terms').select('billing_term_id').eq('document_type', documentType).eq('document_id', documentId),
        tenantClient.from('document_line_billing_terms').select('billing_term_id').eq('document_type', documentType).eq('document_id', documentId)
    ]);
    const termIds = [...new Set([...(dt || []), ...(lt || [])].map(r => r.billing_term_id))];
    if (!termIds.length) return;
    const { data: terms } = await tenantClient.from('billing_terms').select('id, sub_ledger_id, return_sub_ledger_id').eq('tenant_id', tenantId).in('id', termIds);
    const isReturn = RETURN_DOC_TYPES.has(documentType);
    for (const t of terms || []) {
        const fallback = isReturn ? (t.return_sub_ledger_id || t.sub_ledger_id) : t.sub_ledger_id;
        const value = Object.prototype.hasOwnProperty.call(map, t.id) ? (map[t.id] || null) : (fallback || null);
        for (const table of ['document_billing_terms', 'document_line_billing_terms']) {
            const { error } = await tenantClient.from(table).update({ sub_ledger_id: value })
                .eq('document_type', documentType).eq('document_id', documentId).eq('billing_term_id', t.id);
            if (error) throw error;
        }
    }
}

async function loadTermSubLedgers(tenantClient, documentType, documentId) {
    const [{ data: dt }, { data: lt }] = await Promise.all([
        tenantClient.from('document_billing_terms').select('billing_term_id, sub_ledger_id').eq('document_type', documentType).eq('document_id', documentId),
        tenantClient.from('document_line_billing_terms').select('billing_term_id, sub_ledger_id').eq('document_type', documentType).eq('document_id', documentId)
    ]);
    const out = {};
    [...(dt || []), ...(lt || [])].forEach(r => { if (!(r.billing_term_id in out) || r.sub_ledger_id) out[r.billing_term_id] = r.sub_ledger_id || ''; });
    return out;
}

module.exports = { applyTermSubLedgers, loadTermSubLedgers, RETURN_DOC_TYPES };
