// =============================================
// routes/journalVoucherRoutes.js
// Direct multi-line Dr/Cr entries - the SUM(debit) = SUM(credit) rule
// is validated here before save, matching the same balance the shared
// ledger_transaction_lines table enforces at commit. A posted JV's own
// lines are copied straight into that shared table - the single place
// every document's accounting effect lands (GRN, Bill, and now JV).
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!Array.isArray(b.details) || b.details.length < 2) return 'A Journal Voucher needs at least two lines';
    let totalDr = 0, totalCr = 0;
    for (const d of b.details) {
        if (!d.ledger_id) return 'Every line needs a Ledger';
        const dr = Number(d.debit_amount) || 0, cr = Number(d.credit_amount) || 0;
        if (dr > 0 && cr > 0) return 'A line cannot be both Debit and Credit';
        if (dr === 0 && cr === 0) return 'Every line needs either a Debit or a Credit amount';
        totalDr += dr; totalCr += cr;
    }
    if (Math.abs(totalDr - totalCr) > 0.01) return `Voucher does not balance - Debit ${totalDr.toFixed(2)} vs Credit ${totalCr.toFixed(2)}`;
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle()
    ];
    const [costCenter, businessUnit] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

async function captureDetailSnapshots(tenantClient, d) {
    const lookups = [
        d.ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', d.ledger_id).maybeSingle(),
        d.sub_ledger_id && tenantClient.from('sub_ledgers').select('sub_ledger_name').eq('id', d.sub_ledger_id).maybeSingle(),
        d.agent_id && tenantClient.from('salesman_agents').select('agent_name').eq('id', d.agent_id).maybeSingle()
    ];
    const [ledger, subLedger, agent] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        ledger_name_snapshot: ledger.data?.account_name || null,
        sub_ledger_name_snapshot: subLedger.data?.sub_ledger_name || null,
        agent_name_snapshot: agent.data?.agent_name || null
    };
}

async function syncDetails(tenantClient, tenantId, jvId, details) {
    await tenantClient.from('journal_voucher_details').delete().eq('jv_id', jvId);
    if (!Array.isArray(details) || details.length === 0) return { totalDebit: 0, totalCredit: 0 };
    const rows = await Promise.all(details.map(async (d, i) => {
        const snapshots = await captureDetailSnapshots(tenantClient, d);
        const debit = Number(d.debit_amount) || 0, credit = Number(d.credit_amount) || 0;
        return {
            tenant_id: tenantId, jv_id: jvId, display_order: i + 1,
            ledger_id: d.ledger_id, sub_ledger_id: d.sub_ledger_id || null, product_company_id: d.product_company_id || null, agent_id: d.agent_id || null,
            debit_amount: debit, credit_amount: credit, tds_percent: d.tds_percent || null,
            narration: d.narration || null,
            cost_center_id: d.cost_center_id || null, business_unit_id: d.business_unit_id || null,
            ...snapshots
        };
    }));
    const { error } = await tenantClient.from('journal_voucher_details').insert(rows);
    if (error) throw error;
    return {
        totalDebit: rows.reduce((s, r) => s + Number(r.debit_amount), 0),
        totalCredit: rows.reduce((s, r) => s + Number(r.credit_amount), 0)
    };
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function postJvToLedger(tenantClient, tenantId, jv, details, userId) {
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'journal_voucher', document_id: jv.id, batch_date: jv.doc_date, narration: jv.narration || `JV ${jv.doc_no}`, created_by: userId })
        .select().single();
    if (error) throw error;
    const rows = details.map(d => ({
        tenant_id: tenantId, batch_id: batch.id, ledger_account_id: d.ledger_id, sub_ledger_id: d.sub_ledger_id || null, product_company_id: d.product_company_id || null,
        debit_amount: d.debit_amount || 0, credit_amount: d.credit_amount || 0, narration: d.narration || jv.narration
    }));
    const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
    if (lineErr) throw lineErr;
}

async function reverseJvLedgerBatch(tenantClient, jvId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', 'journal_voucher').eq('document_id', jvId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

router.get('/journal-vouchers', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('journal_vouchers').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/journal-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('journal_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Journal Voucher not found' });
        const { data: details } = await tenantClient.from('journal_voucher_details').select('*').eq('jv_id', req.params.id).order('display_order');
        data.details = details || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/journal-vouchers', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'journal', req.body, isDraft);
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
                tenantId, voucherType: 'journal', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'journal_vouchers',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_journal_voucher_code', type_prefix: 'JV' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('journal_vouchers')
            .insert({
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                ref_doc_no: b.ref_doc_no || null, ref_doc_date: b.ref_doc_date || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                is_memo: !!b.is_memo,
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const { totalDebit, totalCredit } = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave);
            await tenantClient.from('journal_vouchers').update({ total_debit: totalDebit, total_credit: totalCredit }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('journal_voucher_details').delete().eq('jv_id', doc.id);
            await tenantClient.from('journal_vouchers').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save voucher lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_journal_voucher', 'journal_voucher', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'journal_voucher', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Journal Voucher ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/journal-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('journal_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Journal Voucher not found' });
        if (existing.audit_locked) return res.status(400).json({ success: false, error: 'This voucher is audit-locked and cannot be edited' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} voucher` });
        }

        const isDraft = b.status === 'draft' && b.save_as_draft === true;
        const validationError = validateBody(b, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'journal', b, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        // Readonly / disabled header fields keep their stored value (before snapshots + update).
        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'journal', b, existing);

        const snapshots = (b.cost_center_id || b.business_unit_id) ? await captureMasterSnapshots(tenantClient, b) : {};        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.details;
        delete update.save_as_draft;

        const { data, error } = await tenantClient.from('journal_vouchers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const { totalDebit, totalCredit } = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            await tenantClient.from('journal_vouchers').update({ total_debit: totalDebit, total_credit: totalCredit }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_journal_voucher', 'journal_voucher', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'journal_voucher', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/journal-vouchers/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('journal_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Journal Voucher not found' });
        if (existing.audit_locked) return res.status(400).json({ success: false, error: 'This voucher is audit-locked' });
        if (existing.is_memo && status === 'posted') return res.status(400).json({ success: false, error: 'A Memo voucher is never posted to the ledger' });

        if (status === 'posted' && existing.status !== 'posted') {
            const { data: existingDetails } = await tenantClient.from('journal_voucher_details').select('*').eq('jv_id', req.params.id);
            const bodyErr = validateBody({ ...existing, details: existingDetails || [] }, false);
            if (bodyErr) return res.status(400).json({ success: false, error: bodyErr });
        }

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') {
            update.cancellation_reason = cancellation_reason;
            update.cancelled_at = new Date().toISOString();
            update.cancelled_by = req.auth.userId;
        }
        if (status === 'posted') {
            update.posted_by = req.auth.userId;
            update.posted_at = new Date().toISOString();
        }
        const { data, error } = await tenantClient.from('journal_vouchers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (status === 'posted' && existing.status !== 'posted') {
            const { data: details } = await tenantClient.from('journal_voucher_details').select('*').eq('jv_id', req.params.id);
            await postJvToLedger(tenantClient, tenantId, data, details || [], req.auth.userId);
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseJvLedgerBatch(tenantClient, req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'change_jv_status', 'journal_voucher', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'journal_voucher', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/journal-vouchers/:id/audit-lock', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { locked } = req.body;
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const update = locked
            ? { audit_locked: true, audit_locked_by: req.auth.userId, audit_locked_at: new Date().toISOString() }
            : { audit_locked: false, audit_locked_by: null, audit_locked_at: null };
        const { data, error } = await tenantClient.from('journal_vouchers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, locked ? 'audit_lock_jv' : 'audit_unlock_jv', 'journal_voucher', req.params.id, {});
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/journal-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('journal_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Journal Voucher not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted voucher' });
        const { error } = await tenantClient.from('journal_vouchers').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_jv', 'journal_voucher', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/journal-vouchers/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'journal_voucher').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
