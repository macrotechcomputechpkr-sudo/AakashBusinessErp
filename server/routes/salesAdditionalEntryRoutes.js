// =============================================
// routes/salesAdditionalEntryRoutes.js
// Extra charges billed to the customer - Dr Customer (net), Cr Income
// ledger per 'add' line, Dr Income ledger per 'deduct' line, and
// creates a 'dr' bill-wise reference for the customer, exactly like a
// Sales Bill.
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const { checkProductCompany } = require('../utils/productCompanyRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { isBillWiseTrackingEnabled, createReferenceAndSettle, reverseReferenceAndSettlements, checkCanCancelIfSettled } = require('../utils/billWiseSettlement');

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!b.customer_ledger_id) return 'Customer is required';
    if (!Array.isArray(b.lines) || b.lines.length === 0) return 'At least one line item is required';
    for (const l of b.lines) {
        if (!l.income_ledger_id) return 'Every line needs a Ledger';
        if (!l.amount || Number(l.amount) <= 0) return 'Every line needs an Amount greater than zero';
    }
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.customer_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.customer_ledger_id).maybeSingle(),
        b.customer_sub_ledger_id && tenantClient.from('sub_ledgers').select('sub_ledger_name').eq('id', b.customer_sub_ledger_id).maybeSingle(),
        b.agent_id && tenantClient.from('salesman_agents').select('agent_name').eq('id', b.agent_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle()
    ];
    const [customer, subLedger, agent, costCenter, businessUnit] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        customer_name_snapshot: customer.data?.account_name || null,
        customer_sub_ledger_name_snapshot: subLedger.data?.sub_ledger_name || null,
        agent_name_snapshot: agent.data?.agent_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

function netTotal(lines) {
    return lines.reduce((s, l) => s + (l.entry_sign === 'deduct' ? -Number(l.amount) : Number(l.amount)), 0);
}

async function syncLines(tenantClient, tenantId, entryId, lines) {
    await tenantClient.from('sales_additional_entry_lines').delete().eq('entry_id', entryId);
    if (!Array.isArray(lines) || lines.length === 0) return 0;
    const rows = lines.map((l, i) => ({
        tenant_id: tenantId, entry_id: entryId, display_order: i + 1,
        income_ledger_id: l.income_ledger_id, description: l.description || null,
        entry_sign: l.entry_sign || 'add', rate_percent: l.rate_percent || null, amount: Number(l.amount) || 0
    }));
    const { error } = await tenantClient.from('sales_additional_entry_lines').insert(rows);
    if (error) throw error;
    return netTotal(rows);
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function postEntryToLedger(tenantClient, tenantId, entry, lines, userId) {
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'sales_additional', document_id: entry.id, batch_date: entry.doc_date, narration: entry.narration || `Sales Additional Entry ${entry.doc_no}`, created_by: userId })
        .select().single();
    if (error) throw error;

    const rows = [{ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.customer_ledger_id, debit_amount: entry.total_amount, credit_amount: 0 }];
    for (const l of lines) {
        if (l.entry_sign === 'deduct') rows.push({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: l.income_ledger_id, debit_amount: Number(l.amount), credit_amount: 0 });
        else rows.push({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: l.income_ledger_id, debit_amount: 0, credit_amount: Number(l.amount) });
    }
    const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
    if (lineErr) throw lineErr;
}

async function reverseEntryGlBatch(tenantClient, entryId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', 'sales_additional').eq('document_id', entryId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

router.get('/sales-additional-entries', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_additional_entries').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-additional-entries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_additional_entries').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Sales Additional Entry not found' });
        const { data: lines } = await tenantClient.from('sales_additional_entry_lines').select('*').eq('entry_id', req.params.id).order('display_order');
        data.lines = lines || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sales-additional-entries', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_additional', req.body, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'sales', { ...req.body, details: [] }, isDraft);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

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
                tenantId, voucherType: 'sales_additional', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'sales_additional_entries',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_sales_additional_code', type_prefix: 'SAE' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('sales_additional_entries')
            .insert({
                product_company_id: b.product_company_id || null,
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                source_order_id: b.source_order_id || null, source_delivery_id: b.source_delivery_id || null, source_bill_id: b.source_bill_id || null,
                customer_ledger_id: b.customer_ledger_id || null, customer_sub_ledger_id: b.customer_sub_ledger_id || null, agent_id: b.agent_id || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, cost_center_id: b.cost_center_id || null,
                business_unit_id: b.business_unit_id || null, narration: b.narration || null,
                pending_bill_wise_settlements: b.bill_wise_settlements ? JSON.stringify(b.bill_wise_settlements) : null,
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const linesToSave = Array.isArray(b.lines) ? b.lines : [];
            const total = await syncLines(tenantClient, tenantId, doc.id, linesToSave);
            await tenantClient.from('sales_additional_entries').update({ total_amount: total }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('sales_additional_entry_lines').delete().eq('entry_id', doc.id);
            await tenantClient.from('sales_additional_entries').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save entry lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_sales_additional_entry', 'sales_additional', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'sales_additional', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Sales Additional Entry ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-additional-entries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('sales_additional_entries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Additional Entry not found' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} entry` });
        }

        const isDraft = b.status === 'draft' && b.save_as_draft === true;
        const validationError = validateBody(b, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_additional', b, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'sales', { ...b, details: [] }, isDraft);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_additional', b, existing);

        const snapshots = await captureMasterSnapshots(tenantClient, { ...existing, ...b });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.lines;
        delete update.save_as_draft;
        delete update.bill_wise_settlements;
        if (b.bill_wise_settlements) update.pending_bill_wise_settlements = JSON.stringify(b.bill_wise_settlements);

        const { data, error } = await tenantClient.from('sales_additional_entries').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.lines) {
            const total = await syncLines(tenantClient, tenantId, req.params.id, b.lines);
            await tenantClient.from('sales_additional_entries').update({ total_amount: total }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_sales_additional_entry', 'sales_additional', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'sales_additional', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-additional-entries/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_additional_entries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Additional Entry not found' });

        if (status === 'cancelled' && existing.status === 'posted') {
            const blockMsg = await checkCanCancelIfSettled(tenantClient, tenantId, 'sales_additional', req.params.id);
            if (blockMsg) return res.status(400).json({ success: false, error: blockMsg });
        }

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') {
            update.cancellation_reason = cancellation_reason;
            update.cancelled_at = new Date().toISOString();
            update.cancelled_by = req.auth.userId;
        }
        if (status === 'posted') { update.posted_by = req.auth.userId; update.posted_at = new Date().toISOString(); }

        const { data, error } = await tenantClient.from('sales_additional_entries').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        const { data: entryLines } = await tenantClient.from('sales_additional_entry_lines').select('*').eq('entry_id', req.params.id);

        if (status === 'posted' && existing.status !== 'posted') {
            await postEntryToLedger(tenantClient, tenantId, data, entryLines || [], req.auth.userId);

            if (data.customer_ledger_id) {
                const bwEnabled = await isBillWiseTrackingEnabled(tenantClient, tenantId, data.customer_ledger_id);
                if (bwEnabled) {
                    await createReferenceAndSettle(tenantClient, tenantId, { productCompanyId: data.product_company_id || null,
                        ledgerId: data.customer_ledger_id, sourceType: 'sales_additional', sourceId: data.id,
                        docNo: data.doc_no, date: data.doc_date, nature: 'dr', totalAmount: data.total_amount,
                        settlements: req.body.bill_wise_settlements || data.pending_bill_wise_settlements || []
                    });
                }
            }
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseReferenceAndSettlements(tenantClient, 'sales_additional', req.params.id);
            await reverseEntryGlBatch(tenantClient, req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'change_sales_additional_entry_status', 'sales_additional', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'sales_additional', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sales-additional-entries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_additional_entries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Additional Entry not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted entry' });
        const { error } = await tenantClient.from('sales_additional_entries').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_sales_additional_entry', 'sales_additional', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-additional-entries/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'sales_additional').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
