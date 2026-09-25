// =============================================
// routes/pdcRoutes.js
// A post-dated cheque doesn't move money until it actually clears - so
// GL posting and bill-wise settlement only happen at REALIZED, never at
// creation or deposit. voucher_type='received' realizes like a Credit
// Note (nature='cr', settling outstanding 'dr' customer bills);
// voucher_type='issued' realizes like a Debit Note (nature='dr',
// settling outstanding 'cr' vendor bills) - the same ledger-direction
// logic already established for DN/CN, since a cleared PDC has exactly
// the same accounting effect as one.
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { isBillWiseTrackingEnabled, getOutstandingReferences, computeFifoAllocation, createReferenceAndSettle, reverseReferenceAndSettlements, checkCanCancelIfSettled } = require('../utils/billWiseSettlement');

function validateBody(b) {
    if (!b.doc_date) return 'Date is required';
    if (!b.voucher_type || !['received', 'issued'].includes(b.voucher_type)) return 'Received/Issued is required';
    if (!b.party_ledger_id) return 'A Party is required';
    if (!b.cheque_no) return 'Cheque No is required';
    if (!b.cheque_date) return 'Cheque Date is required';
    if (!b.amount || Number(b.amount) <= 0) return 'Amount greater than zero is required';
    return null;
}

async function captureSnapshots(tenantClient, b) {
    const lookups = [
        b.party_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.party_ledger_id).maybeSingle(),
        b.party_sub_ledger_id && tenantClient.from('sub_ledgers').select('sub_ledger_name').eq('id', b.party_sub_ledger_id).maybeSingle(),
        b.bank_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.bank_ledger_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle()
    ];
    const [party, subLedger, bank, costCenter, businessUnit] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        party_name_snapshot: party.data?.account_name || null,
        party_sub_ledger_name_snapshot: subLedger.data?.sub_ledger_name || null,
        bank_ledger_name_snapshot: bank.data?.account_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function postPdcToLedger(tenantClient, tenantId, pdc, userId) {
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'pdc', document_id: pdc.id, batch_date: pdc.posting_date || pdc.doc_date, narration: pdc.narration || `PDC ${pdc.doc_no} posted - cheque ${pdc.cheque_no}`, created_by: userId })
        .select().single();
    if (error) throw error;
    const rows = pdc.voucher_type === 'received'
        ? [
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: pdc.bank_ledger_id, debit_amount: pdc.amount, credit_amount: 0, narration: pdc.narration },
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: pdc.party_ledger_id, debit_amount: 0, credit_amount: pdc.amount, narration: pdc.narration }
        ]
        : [
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: pdc.party_ledger_id, debit_amount: pdc.amount, credit_amount: 0, narration: pdc.narration },
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: pdc.bank_ledger_id, debit_amount: 0, credit_amount: pdc.amount, narration: pdc.narration }
        ];
    const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
    if (lineErr) throw lineErr;
}

async function reversePdcLedgerBatch(tenantClient, pdcId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', 'pdc').eq('document_id', pdcId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

router.get('/pdc-vouchers', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('pdc_vouchers').select('*').eq('tenant_id', req.auth.tenantId).order('cheque_date', { ascending: true });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/pdc-vouchers/register', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('v_pdc_register').select('*').eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/pdc-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('pdc_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'PDC not found' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/pdc-vouchers', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const validationError = validateBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'pdc', req.body, false);
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
                tenantId, voucherType: 'pdc', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'pdc_vouchers',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_pdc_code', type_prefix: 'PDC' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('pdc_vouchers')
            .insert({
                product_company_id: b.product_company_id || null,
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                voucher_type: b.voucher_type,
                party_ledger_id: b.party_ledger_id, party_sub_ledger_id: b.party_sub_ledger_id || null, bank_ledger_id: b.bank_ledger_id || null,
                cheque_no: b.cheque_no, cheque_date: b.cheque_date,
                bank_name: b.bank_name || null, bank_branch: b.bank_branch || null, bank_account_name: b.bank_account_name || null,
                bank_account_no: b.bank_account_no || null, beneficiary_name: b.beneficiary_name || null, amount: Number(b.amount),
                is_online_pdc: !!b.is_online_pdc, is_opening_balance: !!b.is_opening_balance,
                ref_doc_no: b.ref_doc_no || null, ref_doc_date: b.ref_doc_date || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                pending_bill_wise_settlements: b.bill_wise_settlements ? JSON.stringify(b.bill_wise_settlements) : null,
                ...snapshots,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        await logAudit(tenantId, req.auth.userId, 'create_pdc', 'pdc', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'pdc', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `PDC ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/pdc-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('pdc_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'PDC not found' });
        if (existing.status !== 'pending') return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} PDC` });

        const validationError = validateBody(b);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'pdc', b, false);

        if (fieldError) return res.status(400).json({ success: false, error: fieldError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'pdc', b, existing);

        const snapshots = await captureSnapshots(tenantClient, { ...existing, ...b });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.bill_wise_settlements;
        if (b.bill_wise_settlements) update.pending_bill_wise_settlements = JSON.stringify(b.bill_wise_settlements);

        const { data, error } = await tenantClient.from('pdc_vouchers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        await logAudit(tenantId, req.auth.userId, 'update_pdc', 'pdc', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'pdc', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/pdc-vouchers/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, posting_date, posting_no, return_reason, cancellation_reason } = req.body;
        if (!['pending', 'posted', 'returned', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });
        if (status === 'returned' && !return_reason) return res.status(400).json({ success: false, error: 'A return reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('pdc_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'PDC not found' });
        // FEATURE: a POSTED PDC can still move to 'returned' - correcting
        // a mistaken posting (bank later reports it actually bounced) -
        // which reverses both the GL batch and the settlement it made.
        // Every other status is terminal.
        const allowedFromPosted = status === 'returned';
        if (['posted', 'returned', 'cancelled'].includes(existing.status) && !(existing.status === 'posted' && allowedFromPosted)) {
            return res.status(400).json({ success: false, error: `Cannot change a ${existing.status} PDC` });
        }
        // The Bank Ledger may be chosen at posting time (PDC dashboard) when the PDC has none yet.
        if (status === 'posted' && req.body.bank_ledger_id && existing.status === 'pending' && req.body.bank_ledger_id !== existing.bank_ledger_id) {
            const { data: bank } = await tenantClient.from('ledger_accounts').select('account_name').eq('id', req.body.bank_ledger_id).eq('tenant_id', tenantId).maybeSingle();
            if (!bank) return res.status(400).json({ success: false, error: 'Bank Ledger not found' });
            await tenantClient.from('pdc_vouchers').update({ bank_ledger_id: req.body.bank_ledger_id, bank_ledger_name_snapshot: bank.account_name }).eq('id', existing.id).eq('tenant_id', tenantId);
            existing.bank_ledger_id = req.body.bank_ledger_id;
        }
        if (status === 'posted' && !existing.bank_ledger_id) return res.status(400).json({ success: false, error: 'A Bank Ledger is required before posting this PDC' });
        if (status === 'returned' && existing.status === 'posted') {
            const blockMsg = await checkCanCancelIfSettled(tenantClient, tenantId, 'pdc', req.params.id);
            if (blockMsg) return res.status(400).json({ success: false, error: blockMsg });
        }

        const update = { status, updated_by: req.auth.userId };
        if (status === 'posted') { update.posting_date = posting_date || new Date().toISOString().slice(0, 10); update.posting_no = posting_no || null; update.posted_by = req.auth.userId; }
        if (status === 'returned' && existing.status === 'posted') {
            await reversePdcLedgerBatch(tenantClient, req.params.id);
            await reverseReferenceAndSettlements(tenantClient, 'pdc', req.params.id);
        }
        if (status === 'returned') { update.return_reason = return_reason; update.returned_at = new Date().toISOString(); update.returned_by = req.auth.userId; }
        if (status === 'cancelled') { update.cancellation_reason = cancellation_reason; update.cancelled_at = new Date().toISOString(); update.cancelled_by = req.auth.userId; }

        const { data, error } = await tenantClient.from('pdc_vouchers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        // FEATURE: "account effect happens when cash is received / the
        // cheque clears" - GL posting and bill-wise settlement happen
        // ONLY here, at Post, never at creation.
        if (status === 'posted') {
            await postPdcToLedger(tenantClient, tenantId, data, req.auth.userId);

            if (data.party_ledger_id) {
                const bwEnabled = await isBillWiseTrackingEnabled(tenantClient, tenantId, data.party_ledger_id);
                if (bwEnabled) {
                    const ownNature = data.voucher_type === 'received' ? 'cr' : 'dr';
                    const outstandingNature = data.voucher_type === 'received' ? 'dr' : 'cr';
                    let settlements = req.body.bill_wise_settlements || data.pending_bill_wise_settlements;
                    if (!settlements) {
                        const outstanding = await getOutstandingReferences(tenantClient, data.party_ledger_id, outstandingNature, data.product_company_id || null);
                        settlements = computeFifoAllocation(outstanding, data.amount).allocations;
                    }
                    await createReferenceAndSettle(tenantClient, tenantId, { productCompanyId: data.product_company_id || null,
                        ledgerId: data.party_ledger_id, sourceType: 'pdc', sourceId: data.id,
                        docNo: data.doc_no, date: data.posting_date, nature: ownNature, totalAmount: data.amount, settlements
                    });
                }
            }
        }

        await logAudit(tenantId, req.auth.userId, 'change_pdc_status', 'pdc', req.params.id, { new_status: status });
        await logDocumentAudit(tenantClient, tenantId, 'pdc', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/pdc-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('pdc_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'PDC not found' });
        if (existing.status !== 'pending') return res.status(400).json({ success: false, error: 'Only a Pending PDC can be deleted - use Cancel otherwise' });
        const { error } = await tenantClient.from('pdc_vouchers').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_pdc', 'pdc', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'PDC deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/pdc-vouchers/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'pdc').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
