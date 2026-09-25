// =============================================
// utils/vatLedger.js
// ONE rule for "which ledger does this VAT go to", used by every
// posting (sales bill/return, purchase bill/return) and by the VAT
// reports, so GL and reports never disagree:
//
//   * VAT that comes from a VAT billing term (tax_type = 'vat'):
//       bill   -> that term's Billing Ledger
//       return -> that term's Return Ledger, else its Billing Ledger
//   * VAT typed on the line (tax %, no term) and any term without a
//     ledger -> the DEFAULT VAT ledger for that side:
//       System Control's VAT ledger, else the Billing Ledger of the
//       first enabled VAT term applicable to that side (display order).
//   * If nothing resolves, that VAT stays where it was (no VAT line).
// =============================================

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function getVatTerms(tenantClient, tenantId) {
    const { data } = await tenantClient.from('billing_terms')
        .select('id, term_name, billing_ledger_id, return_ledger_id, applicable_sales_entry, applicable_purchase_entry, is_enabled, is_active, display_order')
        .eq('tenant_id', tenantId).eq('tax_type', 'vat');
    return (data || []).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
}

async function defaultVatLedger(tenantClient, tenantId, side, terms) {
    const { data: sys } = await tenantClient.from('system_control_settings').select('vat_ledger_id').eq('tenant_id', tenantId).maybeSingle();
    if (sys?.vat_ledger_id) return sys.vat_ledger_id;
    const list = terms || await getVatTerms(tenantClient, tenantId);
    const t = list.find(x => x.is_enabled !== false && x.is_active !== false && x.billing_ledger_id
        && (side === 'sales' ? x.applicable_sales_entry : x.applicable_purchase_entry));
    return t?.billing_ledger_id || null;
}

// Every ledger VAT can land in - used by reports to recognise VAT lines
// on credit/debit notes and to reconcile the GL.
async function allVatLedgerIds(tenantClient, tenantId) {
    const terms = await getVatTerms(tenantClient, tenantId);
    const { data: sys } = await tenantClient.from('system_control_settings').select('vat_ledger_id').eq('tenant_id', tenantId).maybeSingle();
    return [...new Set([sys?.vat_ledger_id, ...terms.flatMap(t => [t.billing_ledger_id, t.return_ledger_id])].filter(Boolean))];
}

// Split a purchase document's VAT by destination ledger.
// Returns [{ ledgerId, subLedgerId, amount }] (resolvable ledgers, amounts > 0).
async function purchaseVatByLedger(tenantClient, tenantId, documentType, documentId) {
    const cfg = { purchase_bill: ['purchase_bill_details', 'bill_id', false], purchase_return: ['purchase_return_details', 'return_id', true] }[documentType];
    if (!cfg) return [];
    const [detailTable, fk, isReturn] = cfg;
    const terms = await getVatTerms(tenantClient, tenantId);
    const fallback = await defaultVatLedger(tenantClient, tenantId, 'purchase', terms);
    // key = ledger|subLedger so one ledger can carry several sub-ledgers
    const byKey = {};
    const add = (ledgerId, subLedgerId, amt) => {
        if (!ledgerId || !amt) return;
        const k = `${ledgerId}|${subLedgerId || ''}`;
        byKey[k] = round2((byKey[k] || 0) + amt);
    };

    const { data: lines } = await tenantClient.from(detailTable).select('tax_amount').eq(fk, documentId);
    add(fallback, null, (lines || []).reduce((s, l) => s + Number(l.tax_amount || 0), 0));

    const termById = Object.fromEntries(terms.map(t => [t.id, t]));
    const ids = Object.keys(termById);
    if (ids.length) {
        const { data: dt } = await tenantClient.from('document_billing_terms').select('billing_term_id, computed_amount, sub_ledger_id').eq('document_type', documentType).eq('document_id', documentId).in('billing_term_id', ids);
        const { data: lt } = await tenantClient.from('document_line_billing_terms').select('billing_term_id, computed_amount, sub_ledger_id').eq('document_type', documentType).eq('document_id', documentId).in('billing_term_id', ids);
        [...(dt || []), ...(lt || [])].forEach(r => {
            const t = termById[r.billing_term_id];
            const own = isReturn ? (t.return_ledger_id || t.billing_ledger_id) : t.billing_ledger_id;
            // The chosen sub-ledger belongs to the term's OWN ledger, so it is
            // only used when the VAT actually goes there (not the fallback).
            if (own) add(own, r.sub_ledger_id || null, Number(r.computed_amount || 0));
            else add(fallback, null, Number(r.computed_amount || 0));
        });
    }
    return Object.entries(byKey).filter(([, a]) => a > 0).map(([k, amount]) => {
        const [ledgerId, subLedgerId] = k.split('|');
        return { ledgerId, subLedgerId: subLedgerId || null, amount };
    });
}

module.exports = { getVatTerms, defaultVatLedger, allVatLedgerIds, purchaseVatByLedger };
