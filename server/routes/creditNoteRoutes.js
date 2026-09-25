// =============================================
// routes/creditNoteRoutes.js
// A Credit Note reduces what a customer owes us - pure ledger lines, no
// products. Uses the SAME bill-wise settlement engine (a CN is a 'cr'
// reference, settling outstanding 'dr' customer references FIFO -
// today that means whatever a future Sales Bill creates; the CN itself
// works correctly even before that module exists, it will simply have
// nothing outstanding to settle against yet).
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const router = express.Router();

// Party-side amounts grouped by the detail lines' product company. Any
// rounding gap vs the header total stays on the no-company bucket.
function partyLinesByCompany(details, headerTotal) {
    const by = {};
    (details || []).forEach(d => { const k = d.product_company_id || ''; by[k] = Math.round(((by[k] || 0) + Number(d.amount || 0)) * 100) / 100; });
    const gap = Math.round((Number(headerTotal) - Object.values(by).reduce((a, b) => a + b, 0)) * 100) / 100;
    if (gap) by[''] = Math.round(((by[''] || 0) + gap) * 100) / 100;
    return Object.entries(by).filter(([, a]) => a !== 0).map(([k, a]) => [k || null, a]);
}

const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { isBillWiseTrackingEnabled, getOutstandingReferences, computeFifoAllocation, createReferenceAndSettle, reverseReferenceAndSettlements, checkCanCancelIfSettled } = require('../utils/billWiseSettlement');

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!b.party_ledger_id) return 'A Party is required';
    if (!Array.isArray(b.details) || b.details.length === 0) return 'At least one line is required';
    for (const d of b.details) {
        if (!d.ledger_id) return 'Every line needs a Ledger';
        if (!d.amount || Number(d.amount) <= 0) return 'Every line needs an amount greater than zero';
    }
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.party_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.party_ledger_id).maybeSingle(),
        b.party_sub_ledger_id && tenantClient.from('sub_ledgers').select('sub_ledger_name').eq('id', b.party_sub_ledger_id).maybeSingle(),
        b.agent_id && tenantClient.from('salesman_agents').select('agent_name').eq('id', b.agent_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle()
    ];
    const [party, subLedger, agent, costCenter, businessUnit] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        party_name_snapshot: party.data?.account_name || null,
        party_sub_ledger_name_snapshot: subLedger.data?.sub_ledger_name || null,
        agent_name_snapshot: agent.data?.agent_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

async function syncDetails(tenantClient, tenantId, cnId, details) {
    await tenantClient.from('credit_note_details').delete().eq('credit_note_id', cnId);
    if (!Array.isArray(details) || details.length === 0) return 0;
    const rows = await Promise.all(details.map(async (d, i) => {
        const { data: ledger } = await tenantClient.from('ledger_accounts').select('account_name').eq('id', d.ledger_id).maybeSingle();
        return { tenant_id: tenantId, credit_note_id: cnId, display_order: i + 1, ledger_id: d.ledger_id, sub_ledger_id: d.sub_ledger_id || null, product_company_id: d.product_company_id || null, amount: Number(d.amount) || 0, narration: d.narration || null, ledger_name_snapshot: ledger?.account_name || null };
    }));
    const { error } = await tenantClient.from('credit_note_details').insert(rows);
    if (error) throw error;
    return rows.reduce((s, r) => s + Number(r.amount), 0);
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function postCnToLedger(tenantClient, tenantId, cn, details, userId) {
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'credit_note', document_id: cn.id, batch_date: cn.doc_date, narration: cn.narration || `Credit Note ${cn.doc_no}`, created_by: userId })
        .select().single();
    if (error) throw error;
    const rows = [
        ...details.map(d => ({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: d.ledger_id, sub_ledger_id: d.sub_ledger_id || null, product_company_id: d.product_company_id || null, debit_amount: d.amount, credit_amount: 0, narration: d.narration || cn.narration })),
        // FIX: one party line PER product company of the detail lines, so a
        // company-wise party ledger / ageing sees this note (a single party
        // line had no company and belonged to none).
        ...partyLinesByCompany(details, cn.total_amount).map(([companyId, amt]) => ({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: cn.party_ledger_id, sub_ledger_id: cn.party_sub_ledger_id || null, product_company_id: companyId, debit_amount: 0, credit_amount: amt, narration: cn.narration }))
    ];
    const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
    if (lineErr) throw lineErr;
}

async function reverseCnLedgerBatch(tenantClient, cnId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', 'credit_note').eq('document_id', cnId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

router.get('/credit-notes', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('credit_notes').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/credit-notes/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('credit_notes').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Credit Note not found' });
        const { data: details } = await tenantClient.from('credit_note_details').select('*').eq('credit_note_id', req.params.id).order('display_order');
        data.details = details || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/credit-notes', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'credit_note', req.body, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;

        const { data: currentUser } = await tenantClient.from('users').select('default_branch_id').eq('id', req.auth.userId).single();
        let branchNameSnapshot = null;
        if (currentUser?.default_branch_id) {
            const { data: branch } = await tenantClient.from('branches').select('branch_name').eq('id', currentUser.default_branch_id).maybeSingle();
            branchNameSnapshot = branch?.branch_name || null;
        }
        const { data: currentFy } = await tenantClient.from('fiscal_years').select('id, fiscal_year_name').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();

        let docNo;
        try {
            docNo = await resolveDocumentNumber(tenantClient, {
                tenantId, voucherType: 'credit_note', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'credit_notes',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_credit_note_code', type_prefix: 'CR' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('credit_notes')
            .insert({
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                party_ledger_id: b.party_ledger_id || null, party_sub_ledger_id: b.party_sub_ledger_id || null, agent_id: b.agent_id || null,
                ref_doc_no: b.ref_doc_no || null, ref_doc_date: b.ref_doc_date || null, reason: b.reason || 'other',
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null, priority: b.priority || 'normal',
                pending_bill_wise_settlements: b.bill_wise_settlements ? JSON.stringify(b.bill_wise_settlements) : null,
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const total = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave);
            await tenantClient.from('credit_notes').update({ total_amount: total }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('credit_note_details').delete().eq('credit_note_id', doc.id);
            await tenantClient.from('credit_notes').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_credit_note', 'credit_note', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'credit_note', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Credit Note ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/credit-notes/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('credit_notes').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Credit Note not found' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} credit note` });
        }

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'credit_note', b, existing);

        const snapshots = await captureMasterSnapshots(tenantClient, { ...existing, ...b });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'credit_note', b, !!(b.save_as_draft || b.status === 'draft'));
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.details;
        delete update.save_as_draft;
        delete update.bill_wise_settlements;
        if (b.bill_wise_settlements) update.pending_bill_wise_settlements = JSON.stringify(b.bill_wise_settlements);

        const { data, error } = await tenantClient.from('credit_notes').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const total = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            await tenantClient.from('credit_notes').update({ total_amount: total }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_credit_note', 'credit_note', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'credit_note', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/credit-notes/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('credit_notes').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Credit Note not found' });

        if (status === 'cancelled' && existing.status === 'posted') {
            const blockMsg = await checkCanCancelIfSettled(tenantClient, tenantId, 'credit_note', req.params.id);
            if (blockMsg) return res.status(400).json({ success: false, error: blockMsg });
        }

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') { update.cancellation_reason = cancellation_reason; update.cancelled_at = new Date().toISOString(); update.cancelled_by = req.auth.userId; }
        if (status === 'posted') { update.posted_by = req.auth.userId; update.posted_at = new Date().toISOString(); }
        const { data, error } = await tenantClient.from('credit_notes').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        const { data: details } = await tenantClient.from('credit_note_details').select('*').eq('credit_note_id', req.params.id);
        // A note's company = its lines' company when they all share one
        // (then FIFO only settles that company's bills); mixed/none -> null.
        const lineCompanies = [...new Set((details || []).map(d => d.product_company_id || null))];
        const noteCompany = lineCompanies.length === 1 ? lineCompanies[0] : null;

        if (status === 'posted' && existing.status !== 'posted') {
            await postCnToLedger(tenantClient, tenantId, data, details || [], req.auth.userId);

            if (data.party_ledger_id) {
                const bwEnabled = await isBillWiseTrackingEnabled(tenantClient, tenantId, data.party_ledger_id);
                if (bwEnabled) {
                    let settlements = req.body.bill_wise_settlements || data.pending_bill_wise_settlements;
                    if (!settlements) {
                        const outstanding = await getOutstandingReferences(tenantClient, data.party_ledger_id, 'dr', noteCompany);
                        settlements = computeFifoAllocation(outstanding, data.total_amount).allocations;
                    }
                    await createReferenceAndSettle(tenantClient, tenantId, { productCompanyId: noteCompany,
                        ledgerId: data.party_ledger_id, sourceType: 'credit_note', sourceId: data.id,
                        docNo: data.doc_no, date: data.doc_date, nature: 'cr', totalAmount: data.total_amount, settlements
                    });
                }
            }
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseCnLedgerBatch(tenantClient, req.params.id);
            await reverseReferenceAndSettlements(tenantClient, 'credit_note', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'change_credit_note_status', 'credit_note', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'credit_note', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/credit-notes/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('credit_notes').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Credit Note not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted credit note' });
        const { error } = await tenantClient.from('credit_notes').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_credit_note', 'credit_note', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/credit-notes/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'credit_note').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
