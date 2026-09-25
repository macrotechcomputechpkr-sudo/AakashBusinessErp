// =============================================
// routes/bulkSettlementRoutes.js
// "Bulk Cash Receipt Payment" - search outstanding credit Sales/
// Purchase bills by optional filters (Agent, Area, Route, Product
// Company, Date Range), tick individually or select-all, and settle
// each selected bill across one or more payment modes in a single
// action. Supports PARTIAL settlement: e.g. a 3000 bill can take 1000
// Cash + 200 QR + 500 PDC, leaving 1300 still on Credit.
//
// Cash/Bank/QR immediately create a cash_bank_entry and bill-wise
// settle against the bill. PDC follows the SAME convention the
// standalone PDC Voucher module already uses: it creates a linked
// voucher now, but bill-wise settlement only happens later when that
// cheque actually REALIZES (never at receipt) - see pdcRoutes.js's own
// comment on this. This file never duplicates that accounting logic;
// it only creates the linked pdc_vouchers row the same way the PDC
// module's own POST endpoint does.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { createReferenceAndSettle } = require('../utils/billWiseSettlement');

const PAYMENT_MODE_MAP = { cash: 'cash', bank: 'bank_transfer', qr: 'online' };

// Same GL posting shape as cashBankEntryRoutes.js's own (private,
// unexported) postCashBankToLedger - replicated here rather than
// importing a non-exported function.
async function postCashBankToLedger(tenantClient, tenantId, entry, userId) {
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'cash_bank_entry', document_id: entry.id, batch_date: entry.doc_date, narration: entry.narration || `${entry.entry_type} ${entry.doc_no}`, created_by: userId })
        .select().single();
    if (error) throw error;
    const rows = entry.entry_type === 'receipt'
        ? [
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.cash_bank_ledger_id, debit_amount: entry.amount, credit_amount: 0 },
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.party_ledger_id, debit_amount: 0, credit_amount: entry.amount }
        ]
        : [
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.party_ledger_id, debit_amount: entry.amount, credit_amount: 0 },
            { tenant_id: tenantId, batch_id: batch.id, ledger_account_id: entry.cash_bank_ledger_id, debit_amount: 0, credit_amount: entry.amount }
        ];
    const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
    if (lineErr) throw lineErr;
}

// FEATURE: finds every posted, credit-invoice Sales or Purchase Bill
// that still has an outstanding bill-wise reference, filtered by
// whichever of Agent/Area/Route/Product-Company/Date-range the caller
// actually supplied - every filter is optional.
router.get('/bulk-settlement/outstanding-bills', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { side, agent_id, area_id, route_id, product_company_id, date_from, date_to } = req.query;
        if (!['sales', 'purchase'].includes(side)) return res.status(400).json({ success: false, error: 'side must be "sales" or "purchase"' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const billTable = side === 'sales' ? 'sales_bills' : 'purchase_bills';
        const detailTable = side === 'sales' ? 'sales_bill_details' : 'purchase_bill_details';
        const partyField = side === 'sales' ? 'customer_ledger_id' : 'vendor_ledger_id';
        const partyNameField = side === 'sales' ? 'customer_name_snapshot' : 'vendor_name_snapshot';
        const sourceType = side === 'sales' ? 'sales_bill' : 'purchase_bill';

        let billQuery = tenantClient.from(billTable).select('*').eq('tenant_id', tenantId).eq('status', 'posted').eq('invoice_type', 'credit');
        if (agent_id) billQuery = billQuery.eq('agent_id', agent_id);
        if (area_id) billQuery = billQuery.eq('area_id', area_id);
        if (route_id) billQuery = billQuery.eq('route_id', route_id);
        if (date_from) billQuery = billQuery.gte('doc_date', date_from);
        if (date_to) billQuery = billQuery.lte('doc_date', date_to);
        const { data: bills, error: billErr } = await billQuery.order('doc_date', { ascending: false }).limit(300);
        if (billErr) throw billErr;
        if (!bills || bills.length === 0) return res.json({ success: true, data: [] });

        let candidateBills = bills;
        if (product_company_id) {
            const { data: matchingProducts } = await tenantClient.from('products').select('id').eq('product_company_id', product_company_id);
            const matchingProductIds = (matchingProducts || []).map(p => p.id);
            if (matchingProductIds.length === 0) return res.json({ success: true, data: [] });
            const billIds = bills.map(b => b.id);
            const { data: matchingDetails } = await tenantClient.from(detailTable).select('bill_id').in('bill_id', billIds).in('product_id', matchingProductIds);
            const billIdsWithMatch = new Set((matchingDetails || []).map(d => d.bill_id));
            candidateBills = bills.filter(b => billIdsWithMatch.has(b.id));
            if (candidateBills.length === 0) return res.json({ success: true, data: [] });
        }

        const candidateIds = candidateBills.map(b => b.id);
        const { data: references } = await tenantClient
            .from('bill_wise_references').select('id, source_id, total_amount, remaining_amount')
            .eq('tenant_id', tenantId).eq('source_type', sourceType).in('source_id', candidateIds).gt('remaining_amount', 0);
        const refByBillId = Object.fromEntries((references || []).map(r => [r.source_id, r]));

        const results = candidateBills
            .filter(b => refByBillId[b.id])
            .map(b => ({
                bill_id: b.id, doc_no: b.doc_no, doc_date: b.doc_date,
                party_ledger_id: b[partyField], party_name: b[partyNameField],
                // FIX: without these, a bulk-created cash_bank_entry
                // would silently drop the bill's own sub-ledger/cost-
                // center/business-unit context. Sales has a customer
                // sub-ledger; Purchase Bill has no vendor-side
                // equivalent (goods_sub_ledger_id is a different,
                // inventory-classification concept), so it stays null.
                party_sub_ledger_id: side === 'sales' ? (b.customer_sub_ledger_id || null) : null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                total_amount: refByBillId[b.id].total_amount, outstanding_amount: refByBillId[b.id].remaining_amount,
                reference_id: refByBillId[b.id].id
            }));

        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

async function createDocNo(tenantClient, tenantId, voucherType, tableName, seqName, prefix, userId, categoryId) {
    let docNo;
    try {
        const { data: currentFy } = await tenantClient.from('fiscal_years').select('id, fiscal_year_name').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();
        const { data: currentUser } = await tenantClient.from('users').select('default_branch_id').eq('id', userId).single();
        docNo = await resolveDocumentNumber(tenantClient, {
            tenantId, voucherType, userId, categoryId, tableName,
            currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
            userDefaultBranchId: currentUser?.default_branch_id
        });
    } catch { docNo = null; }
    if (!docNo) {
        const { data: codeRow } = await tenantClient.rpc('next_master_code', { seq_name: seqName, type_prefix: prefix });
        docNo = codeRow;
    }
    return docNo;
}

// FEATURE: partial, multi-mode settlement of one or more bills in a
// single action - "3000 Ko Bill Ko 1000 Cash In Hand aayo 200 qr Maa
// aayo. 500 Ko pdc aayo. Aru Credit Nai Rahyo."
router.post('/bulk-settlement/settle', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { side, settlements } = req.body;
        if (!['sales', 'purchase'].includes(side)) return res.status(400).json({ success: false, error: 'side must be "sales" or "purchase"' });
        if (!Array.isArray(settlements) || settlements.length === 0) return res.status(400).json({ success: false, error: 'No bills to settle' });

        const tenantId = req.auth.tenantId;
        const userId = req.auth.userId;
        const tenantClient = await getTenantClient(tenantId);
        // Sales settlement is a RECEIPT (reduces what the customer
        // owes -> 'cr'); Purchase settlement is a PAYMENT (reduces what
        // we owe the vendor -> 'dr') - the opposite nature from the
        // bill's own reference, exactly like a normal Cash/Bank entry.
        const settlementNature = side === 'sales' ? 'cr' : 'dr';
        const results = [];

        for (const s of settlements) {
            const { bill_id, reference_id, party_ledger_id, party_sub_ledger_id, cost_center_id, business_unit_id, allocations, pdc } = s;
            if (!bill_id || !reference_id || !party_ledger_id) continue;
            const billSettled = [];

            for (const alloc of (allocations || [])) {
                const amount = Number(alloc.amount) || 0;
                if (amount <= 0) continue;
                const mappedMode = PAYMENT_MODE_MAP[alloc.mode];
                if (!mappedMode) continue;

                const docNo = await createDocNo(tenantClient, tenantId, 'cash_bank_entry', 'cash_bank_entries', 'tenant_master.seq_cash_bank_code', 'CB', userId, null);
                const { data: currentFy } = await tenantClient.from('fiscal_years').select('id').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();
                const { data: entry, error: entryErr } = await tenantClient
                    .from('cash_bank_entries')
                    .insert({
                        tenant_id: tenantId, doc_no: docNo, doc_date: new Date().toISOString().slice(0, 10), fiscal_year_id: currentFy?.id || null,
                        entry_type: side === 'sales' ? 'receipt' : 'payment',
                        cash_bank_ledger_id: alloc.cash_bank_ledger_id, party_ledger_id, party_sub_ledger_id: party_sub_ledger_id || null,
                        amount, payment_mode: mappedMode, ref_doc_no: s.doc_no || null,
                        cost_center_id: cost_center_id || null, business_unit_id: business_unit_id || null,
                        narration: `Bulk settlement against ${s.doc_no || bill_id}`,
                        status: 'posted', posted_by: userId, posted_at: new Date().toISOString(),
                        created_by: userId, updated_by: userId
                    })
                    .select().single();
                if (entryErr) throw entryErr;
                await postCashBankToLedger(tenantClient, tenantId, entry, userId);

                await createReferenceAndSettle(tenantClient, tenantId, { productCompanyId: entry.product_company_id || null,
                    ledgerId: party_ledger_id, sourceType: 'cash_bank_entry', sourceId: entry.id,
                    docNo, date: entry.doc_date, nature: settlementNature, totalAmount: amount,
                    settlements: [{ against_reference_id: reference_id, settled_amount: amount }]
                });
                billSettled.push({ mode: alloc.mode, amount, entry_id: entry.id, doc_no: docNo });
            }

            // PDC portion: creates the linked voucher now, following
            // the SAME accounting convention as the standalone PDC
            // module - bill-wise settlement happens only when this
            // cheque later realizes, never at receipt.
            if (pdc && Number(pdc.amount) > 0) {
                const pdcDocNo = await createDocNo(tenantClient, tenantId, 'pdc', 'pdc_vouchers', 'tenant_master.seq_pdc_code', 'PDC', userId, null);
                const { data: currentFy } = await tenantClient.from('fiscal_years').select('id').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();
                const { data: pdcDoc, error: pdcErr } = await tenantClient
                    .from('pdc_vouchers')
                    .insert({
                        tenant_id: tenantId, doc_no: pdcDocNo, doc_date: new Date().toISOString().slice(0, 10), fiscal_year_id: currentFy?.id || null,
                        voucher_type: side === 'sales' ? 'receive' : 'issue',
                        party_ledger_id, party_sub_ledger_id: party_sub_ledger_id || null, bank_ledger_id: pdc.bank_ledger_id || null,
                        cheque_no: pdc.cheque_no, cheque_date: pdc.cheque_date,
                        bank_name: pdc.bank_name || null, bank_branch: pdc.bank_branch || null,
                        amount: Number(pdc.amount), ref_doc_no: s.doc_no || null,
                        cost_center_id: cost_center_id || null, business_unit_id: business_unit_id || null,
                        pending_bill_wise_settlements: JSON.stringify([{ against_reference_id: reference_id, settled_amount: Number(pdc.amount) }]),
                        narration: `Bulk settlement (PDC) against ${s.doc_no || bill_id}`,
                        created_by: userId, updated_by: userId
                    })
                    .select().single();
                if (pdcErr) throw pdcErr;
                billSettled.push({ mode: 'pdc', amount: Number(pdc.amount), pdc_id: pdcDoc.id, doc_no: pdcDocNo, pending_realization: true });
            }

            results.push({ bill_id, settled: billSettled });
        }

        await logAudit(tenantId, userId, 'bulk_settlement', side === 'sales' ? 'sales_bill' : 'purchase_bill', null, { settlements: results });
        res.json({ success: true, message: `${results.length} bill(s) processed`, data: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
