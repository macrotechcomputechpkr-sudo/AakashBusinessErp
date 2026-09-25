// =============================================
// utils/billWiseSettlement.js
// "Vendor Master ma Bill to Bill enable xa ra balance Dr xa vane,
// Purchase Bill entry garda FIFO method ma kun doc ma kati balance xa
// kati adjust garne milaune ... Cr balance xa vane Purchase Return ma
// testai garne."
//
// A vendor's normal outstanding is Credit (a Bill). An abnormal Debit
// balance (advance/overpayment/over-return) means a new Bill should
// clear it first, FIFO, before any of it becomes a fresh outstanding.
// Symmetrically, a normal Cr balance means a new Return should clear
// outstanding Bills FIFO rather than floating unlinked.
// =============================================

// FEATURE: ledger-level override, falling back to System Control's own
// system-wide bill_wise_tracking default when the ledger says
// 'system_default'.
async function isBillWiseTrackingEnabled(tenantClient, tenantId, ledgerId) {
    const { data: ledger } = await tenantClient.from('ledger_accounts').select('bill_wise_tracking_control').eq('id', ledgerId).maybeSingle();
    const control = ledger?.bill_wise_tracking_control || 'system_default';
    if (control === 'enabled') return true;
    if (control === 'disabled') return false;
    const { data: sysControl } = await tenantClient.from('system_control_settings').select('bill_wise_tracking').eq('tenant_id', tenantId).maybeSingle();
    return sysControl?.bill_wise_tracking !== false; // defaults true if no row
}

// FEATURE: the actual outstanding balance, split by nature, oldest
// first (FIFO) - what a Bill or Return would need to know before
// offering a settlement suggestion.
// productCompanyId: when Product Company is compulsory, only that company's
// bills may be settled against each other (bill-to-bill by company).
async function getOutstandingReferences(tenantClient, ledgerId, nature, productCompanyId = null) {
    let q = tenantClient
        .from('bill_wise_references')
        .select('id, source_doc_no, source_date, source_type, remaining_amount, product_company_id')
        .eq('ledger_id', ledgerId).eq('nature', nature).gt('remaining_amount', 0);
    if (productCompanyId) q = q.eq('product_company_id', productCompanyId);
    const { data } = await q.order('source_date', { ascending: true });
    return data || [];
}

// FEATURE: the FIFO math itself - greedily consumes the oldest
// opposite-nature outstanding first; whatever's left over after all
// outstanding is exhausted becomes this transaction's own new
// outstanding balance.
function computeFifoAllocation(outstandingRefs, newAmount) {
    let remaining = Number(newAmount);
    const allocations = [];
    for (const ref of outstandingRefs) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(ref.remaining_amount));
        if (take > 0) {
            allocations.push({ against_reference_id: ref.id, source_doc_no: ref.source_doc_no, source_date: ref.source_date, settled_amount: Math.round(take * 100) / 100 });
            remaining -= take;
        }
    }
    return { allocations, unallocated: Math.round(remaining * 100) / 100 };
}

// FEATURE: creates this transaction's own reference row, then applies
// whichever settlement allocations were chosen (FIFO-suggested or
// manually adjusted by the user) - moving allocated_amount/
// remaining_amount on BOTH sides of every match together.
async function createReferenceAndSettle(tenantClient, tenantId, { ledgerId, sourceType, sourceId, docNo, date, nature, totalAmount, settlements, productCompanyId = null }) {
    const settledTotal = (settlements || []).reduce((s, a) => s + Number(a.settled_amount), 0);
    const { data: newRef, error } = await tenantClient
        .from('bill_wise_references')
        .insert({
            tenant_id: tenantId, ledger_id: ledgerId, source_type: sourceType, source_id: sourceId,
            source_doc_no: docNo, source_date: date, nature, product_company_id: productCompanyId || null,
            total_amount: totalAmount, allocated_amount: settledTotal, remaining_amount: totalAmount - settledTotal
        })
        .select().single();
    if (error) throw error;

    for (const a of (settlements || [])) {
        const { data: against } = await tenantClient.from('bill_wise_references').select('allocated_amount, total_amount').eq('id', a.against_reference_id).maybeSingle();
        if (!against) continue;
        const newAllocated = Number(against.allocated_amount) + Number(a.settled_amount);
        await tenantClient.from('bill_wise_references').update({ allocated_amount: newAllocated, remaining_amount: Number(against.total_amount) - newAllocated }).eq('id', a.against_reference_id);
        await tenantClient.from('bill_wise_settlements').insert({
            tenant_id: tenantId, ledger_id: ledgerId, new_reference_id: newRef.id, against_reference_id: a.against_reference_id, settled_amount: a.settled_amount
        });
    }
    return newRef;
}

// FEATURE: reversing a CANCELLED posted transaction - undo every
// settlement it made (giving the old references their balance back),
// then remove its own reference row entirely.
async function reverseReferenceAndSettlements(tenantClient, sourceType, sourceId) {
    const { data: ref } = await tenantClient.from('bill_wise_references').select('id').eq('source_type', sourceType).eq('source_id', sourceId).maybeSingle();
    if (!ref) return;
    const { data: settlements } = await tenantClient.from('bill_wise_settlements').select('*').eq('new_reference_id', ref.id);
    for (const s of (settlements || [])) {
        const { data: against } = await tenantClient.from('bill_wise_references').select('allocated_amount, total_amount').eq('id', s.against_reference_id).maybeSingle();
        if (against) {
            const newAllocated = Math.max(0, Number(against.allocated_amount) - Number(s.settled_amount));
            await tenantClient.from('bill_wise_references').update({ allocated_amount: newAllocated, remaining_amount: Number(against.total_amount) - newAllocated }).eq('id', s.against_reference_id);
        }
    }
    await tenantClient.from('bill_wise_settlements').delete().eq('new_reference_id', ref.id);
    await tenantClient.from('bill_wise_references').delete().eq('id', ref.id);
}

// FEATURE: "Block Cancel if Settled" - a Bill (or Return/DN/CN/PDC)
// that some LATER document has already settled AGAINST shouldn't just
// silently disappear on cancel - the later document's own settlement
// row would be left pointing at a deleted reference. Checked before
// every cancellation, controlled by a system-wide setting so a tenant
// that doesn't need this rigor can turn it off. Deliberately checks
// whether anything settled AGAINST this reference (bill_wise_
// settlements.against_reference_id) - NOT this reference's own
// allocated_amount, since THIS document settling against an OLDER one
// at its own creation is fully reversible and not the risky case.
async function checkCanCancelIfSettled(tenantClient, tenantId, sourceType, sourceId) {
    const { data: sysControl } = await tenantClient.from('system_control_settings').select('block_cancel_if_settled').eq('tenant_id', tenantId).maybeSingle();
    if (sysControl?.block_cancel_if_settled === false) return null;
    const { data: ref } = await tenantClient.from('bill_wise_references').select('id').eq('source_type', sourceType).eq('source_id', sourceId).maybeSingle();
    if (!ref) return null;
    const { data: dependentSettlements } = await tenantClient.from('bill_wise_settlements').select('id, new_reference_id').eq('against_reference_id', ref.id).limit(1);
    if (!dependentSettlements || dependentSettlements.length === 0) return null;
    const { data: dependentRef } = await tenantClient.from('bill_wise_references').select('source_doc_no').eq('id', dependentSettlements[0].new_reference_id).maybeSingle();
    return `Voucher ${dependentRef?.source_doc_no || ''} has already settled against this document - cancel that first, or turn off "Block Cancel if Settled" in System Control.`;
}

module.exports = { isBillWiseTrackingEnabled, getOutstandingReferences, computeFifoAllocation, createReferenceAndSettle, reverseReferenceAndSettlements, checkCanCancelIfSettled };
