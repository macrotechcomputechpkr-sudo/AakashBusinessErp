// =============================================
// routes/cashBankEntryRoutes.js
// A receipt clears like a Credit Note (nature='cr', settling
// outstanding 'dr'); a payment clears like a Debit Note (nature='dr',
// settling outstanding 'cr') - posted immediately (unlike PDC, there's
// no future-dated clearing step here, the money moves today).
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const { onDocumentEvent } = require('../utils/messaging');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { isBillWiseTrackingEnabled, getOutstandingReferences, computeFifoAllocation, createReferenceAndSettle, reverseReferenceAndSettlements } = require('../utils/billWiseSettlement');

function validateBody(b) {
    if (!b.doc_date) return 'Date is required';
    if (!b.entry_type || !['receipt', 'payment'].includes(b.entry_type)) return 'Receipt/Payment is required';
    if (!b.cash_bank_ledger_id) return 'Cash/Bank Ledger is required';
    if (!b.party_ledger_id) return 'A Party is required';
    if (!b.amount || Number(b.amount) <= 0) return 'Amount greater than zero is required';
    return null;
}

async function captureSnapshots(tenantClient, b) {
    const lookups = [
        b.cash_bank_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.cash_bank_ledger_id).maybeSingle(),
        b.party_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.party_ledger_id).maybeSingle(),
        b.party_sub_ledger_id && tenantClient.from('sub_ledgers').select('sub_ledger_name').eq('id', b.party_sub_ledger_id).maybeSingle(),
        b.agent_id && tenantClient.from('salesman_agents').select('agent_name').eq('id', b.agent_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle()
    ];
    const [cashBank, party, subLedger, agent, costCenter, businessUnit] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        cash_bank_name_snapshot: cashBank.data?.account_name || null,
        party_name_snapshot: party.data?.account_name || null,
        party_sub_ledger_name_snapshot: subLedger.data?.sub_ledger_name || null,
        agent_name_snapshot: agent.data?.agent_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function postCashBankToLedger(tenantClient, tenantId, entry, userId) {
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'cash_bank_entry', document_id: entry.id, batch_date: entry.doc_date, narration: entry.narration || `${entry.entry_type} ${entry.doc_no}`, created_by: userId })
        .select().single();
    if (error) throw error;
    const rows = entry.entry_type === 'receipt'
        ? [
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.cash_bank_ledger_id, debit_amount: entry.amount, credit_amount: 0 },
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.party_ledger_id, sub_ledger_id: entry.party_sub_ledger_id || null, product_company_id: entry.product_company_id || null, debit_amount: 0, credit_amount: entry.amount }
        ]
        : [
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.party_ledger_id, sub_ledger_id: entry.party_sub_ledger_id || null, product_company_id: entry.product_company_id || null, debit_amount: entry.amount, credit_amount: 0 },
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.cash_bank_ledger_id, debit_amount: 0, credit_amount: entry.amount }
        ];
    const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
    if (lineErr) throw lineErr;
}

async function reverseCashBankLedger(tenantClient, entryId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', 'cash_bank_entry').eq('document_id', entryId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

async function settleBillWise(tenantClient, tenantId, entry) {
    if (!entry.party_ledger_id) return;
    const bwEnabled = await isBillWiseTrackingEnabled(tenantClient, tenantId, entry.party_ledger_id);
    if (!bwEnabled) return;
    const ownNature = entry.entry_type === 'receipt' ? 'cr' : 'dr';
    const outstandingNature = entry.entry_type === 'receipt' ? 'dr' : 'cr';
    let settlements = entry.bill_wise_settlements || entry.pending_bill_wise_settlements;
    if (!settlements) {
        const outstanding = await getOutstandingReferences(tenantClient, entry.party_ledger_id, outstandingNature, entry.product_company_id || null);
        settlements = computeFifoAllocation(outstanding, entry.amount).allocations;
    }
    await createReferenceAndSettle(tenantClient, tenantId, { productCompanyId: entry.product_company_id || null,
        ledgerId: entry.party_ledger_id, sourceType: 'cash_bank_entry', sourceId: entry.id,
        docNo: entry.doc_no, date: entry.doc_date, nature: ownNature, totalAmount: entry.amount, settlements
    });
}

async function createDocNo(tenantClient, tenantId, userId, currentUser, currentFy, categoryId) {
    let docNo;
    try {
        docNo = await resolveDocumentNumber(tenantClient, {
            tenantId, voucherType: 'cash_bank_entry', userId, categoryId,
            tableName: 'cash_bank_entries',
            currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
            userDefaultBranchId: currentUser?.default_branch_id
        });
    } catch (numErr) { docNo = null; }
    if (!docNo) {
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_cash_bank_entry_code', type_prefix: 'CB' });
        if (codeErr) throw codeErr;
        docNo = codeRow;
    }
    return docNo;
}

router.get('/cash-bank-entries', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('cash_bank_entries').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/cash-bank-entries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('cash_bank_entries').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Entry not found' });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cash-bank-entries', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const validationError = validateBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'cash_bank_entry', req.body, false);
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
        const docNo = await createDocNo(tenantClient, tenantId, req.auth.userId, currentUser, currentFy, b.numbering_category_id);
        const snapshots = await captureSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('cash_bank_entries')
            .insert({
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                entry_type: b.entry_type, cash_bank_ledger_id: b.cash_bank_ledger_id, party_ledger_id: b.party_ledger_id,
                party_sub_ledger_id: b.party_sub_ledger_id || null, product_company_id: b.product_company_id || null, agent_id: b.agent_id || null, amount: Number(b.amount),
                payment_mode: b.payment_mode || 'cash', ref_no: b.ref_no || null, ref_doc_no: b.ref_doc_no || null, ref_doc_date: b.ref_doc_date || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                pending_bill_wise_settlements: b.bill_wise_settlements ? JSON.stringify(b.bill_wise_settlements) : null,
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        await logAudit(tenantId, req.auth.userId, 'create_cash_bank_entry', 'cash_bank_entry', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'cash_bank_entry', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `${doc.entry_type === 'receipt' ? 'Receipt' : 'Payment'} ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/cash-bank-entries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('cash_bank_entries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Entry not found' });
        if (['posted', 'cancelled'].includes(existing.status)) return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} entry` });

        const validationError = validateBody(b);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'cash_bank_entry', b, false);

        if (fieldError) return res.status(400).json({ success: false, error: fieldError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'cash_bank_entry', b, existing);

        const snapshots = await captureSnapshots(tenantClient, { ...existing, ...b });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.bill_wise_settlements;
        if (b.bill_wise_settlements) update.pending_bill_wise_settlements = JSON.stringify(b.bill_wise_settlements);

        const { data, error } = await tenantClient.from('cash_bank_entries').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        await logAudit(tenantId, req.auth.userId, 'update_cash_bank_entry', 'cash_bank_entry', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'cash_bank_entry', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/cash-bank-entries/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('cash_bank_entries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Entry not found' });

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') { update.cancellation_reason = cancellation_reason; update.cancelled_at = new Date().toISOString(); update.cancelled_by = req.auth.userId; }
        if (status === 'posted') { update.posted_by = req.auth.userId; update.posted_at = new Date().toISOString(); }
        const { data, error } = await tenantClient.from('cash_bank_entries').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (status === 'posted' && existing.status !== 'posted') {
            await postCashBankToLedger(tenantClient, tenantId, data, req.auth.userId);
            await settleBillWise(tenantClient, tenantId, { ...data, bill_wise_settlements: req.body.bill_wise_settlements });
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseCashBankLedger(tenantClient, req.params.id);
            await reverseReferenceAndSettlements(tenantClient, 'cash_bank_entry', req.params.id);
        }

        onDocumentEvent(tenantClient, tenantId, 'cash_bank_entry', status, req.params.id, req.auth.userId, { entry_type: existing.entry_type }); // auto Email / SMS / WhatsApp, never blocks
        await logAudit(tenantId, req.auth.userId, 'change_cash_bank_entry_status', 'cash_bank_entry', req.params.id, { new_status: status });
        await logDocumentAudit(tenantClient, tenantId, 'cash_bank_entry', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/cash-bank-entries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('cash_bank_entries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Entry not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted entry' });
        const { error } = await tenantClient.from('cash_bank_entries').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_cash_bank_entry', 'cash_bank_entry', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "Bulk Cash Receipt/Payment" - one call, many parties, one
// Cash/Bank ledger, immediately posted (bulk entry exists to save time
// on repetitive same-day collections/disbursements, not to sit as
// drafts).
router.post('/bulk-cash-bank-batches', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { batch_date, entry_type, cash_bank_ledger_id, narration, lines, numbering_category_id } = req.body;
        if (!batch_date) return res.status(400).json({ success: false, error: 'Date is required' });
        if (!entry_type || !['receipt', 'payment'].includes(entry_type)) return res.status(400).json({ success: false, error: 'Receipt/Payment is required' });
        if (!cash_bank_ledger_id) return res.status(400).json({ success: false, error: 'Cash/Bank Ledger is required' });
        if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ success: false, error: 'At least one line is required' });
        for (const l of lines) {
            if (!l.party_ledger_id) return res.status(400).json({ success: false, error: 'Every line needs a Party' });
            if (!l.amount || Number(l.amount) <= 0) return res.status(400).json({ success: false, error: 'Every line needs an amount greater than zero' });
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: currentUser } = await tenantClient.from('users').select('default_branch_id').eq('id', req.auth.userId).single();
        // Each line becomes its own Cash/Bank entry - hold every one to the
        // same Entry Field Control rules as a single entry.
        for (let li = 0; li < lines.length; li++) {
            const entryBody = { batch_date, doc_date: batch_date, entry_type, cash_bank_ledger_id, narration, ...lines[li] };
            const fieldError = await checkCompulsoryFields(tenantClient, tenantId, req.auth.userId, 'cash_bank_entry', entryBody, false);
            if (fieldError) return res.status(400).json({ success: false, error: `Line ${li + 1}: ${fieldError}` });
        }
        const { data: currentFy } = await tenantClient.from('fiscal_years').select('id, fiscal_year_name').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();

        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_bulk_cash_bank_code', type_prefix: 'BULK' });
        if (codeErr) throw codeErr;

        const { data: batch, error: batchErr } = await tenantClient
            .from('bulk_cash_bank_batches')
            .insert({ tenant_id: tenantId, batch_no: codeRow, batch_date, entry_type, cash_bank_ledger_id, narration: narration || null, total_amount: lines.reduce((s, l) => s + Number(l.amount), 0), entry_count: lines.length, created_by: req.auth.userId })
            .select().single();
        if (batchErr) throw batchErr;

        const createdEntries = [];
        for (const l of lines) {
            const docNo = await createDocNo(tenantClient, tenantId, req.auth.userId, currentUser, currentFy, numbering_category_id);
            const snapshots = await captureSnapshots(tenantClient, { cash_bank_ledger_id, party_ledger_id: l.party_ledger_id, party_sub_ledger_id: l.party_sub_ledger_id });
            const { data: entry, error: entryErr } = await tenantClient
                .from('cash_bank_entries')
                .insert({
                    tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null,
                    doc_no: docNo, doc_date: batch_date, fiscal_year_id: currentFy?.id || null,
                    entry_type, cash_bank_ledger_id, party_ledger_id: l.party_ledger_id, party_sub_ledger_id: l.party_sub_ledger_id || null,
                    amount: Number(l.amount), payment_mode: l.payment_mode || 'cash', narration: l.narration || narration || null,
                    bulk_batch_id: batch.id,
                    ...snapshots,
                    status: 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
                })
                .select().single();
            if (entryErr) throw entryErr;

            await tenantClient.from('cash_bank_entries').update({ status: 'posted', posted_by: req.auth.userId, posted_at: new Date().toISOString() }).eq('id', entry.id);
            const postedEntry = { ...entry, status: 'posted' };
            await postCashBankToLedger(tenantClient, tenantId, postedEntry, req.auth.userId);
            await settleBillWise(tenantClient, tenantId, postedEntry);
            createdEntries.push(postedEntry);
        }

        await logAudit(tenantId, req.auth.userId, 'create_bulk_cash_bank_batch', 'bulk_cash_bank_batch', batch.id, { batch_no: batch.batch_no, entry_count: lines.length });
        res.json({ success: true, message: `Bulk ${entry_type} ${batch.batch_no} posted - ${lines.length} entries`, data: { batch, entries: createdEntries } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/bulk-cash-bank-batches', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('bulk_cash_bank_batches').select('*').eq('tenant_id', req.auth.tenantId).order('batch_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/bulk-cash-bank-batches/:id/entries', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('cash_bank_entries').select('*').eq('bulk_batch_id', req.params.id).eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/cash-bank-entries/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'cash_bank_entry').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
