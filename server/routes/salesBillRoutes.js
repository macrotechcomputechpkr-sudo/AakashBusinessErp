// =============================================
// routes/salesBillRoutes.js
// The customer invoice - posts Dr Customer / Cr Sales Account / Cr VAT
// Payable, creates a 'dr' bill-wise reference for the customer, credit-
// checked like Sales Order, and writes an OUT stock movement ONLY for
// lines with no source delivery (a direct/cash bill).
// =============================================

const express = require('express');
const { bumpAltCounter } = require('../utils/progressCounters');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const { checkProductCompany } = require('../utils/productCompanyRules');
const { splitByAccount } = require('../utils/accountResolver');
const { defaultVatLedger } = require('../utils/vatLedger');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { checkCustomerCredit } = require('../utils/creditControl');
const { toBaseUnitQty } = require('../utils/unitConversion');
const { toBaseQtyFromDual, computeDualAmount, getDualUomMode } = require('../utils/dualUomCalculation');
const { isBillWiseTrackingEnabled, createReferenceAndSettle, reverseReferenceAndSettlements } = require('../utils/billWiseSettlement');

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!b.customer_ledger_id) return 'Customer is required';
    if (!Array.isArray(b.details) || b.details.length === 0) return 'At least one line item is required';
    for (const d of b.details) {
        if (!d.product_id) return 'Every line needs a Product';
        // Dual-unit lines may be secondary-only (0 Carton + 7 Pcs); neither may be negative.
        if (Number(d.qty) < 0 || Number(d.alt_qty) < 0) return 'Qty cannot be negative';
        if (!(Number(d.qty) > 0) && !(Number(d.alt_qty) > 0)) return 'Every line needs a Qty greater than zero';
    }
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.customer_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.customer_ledger_id).maybeSingle(),
        b.customer_sub_ledger_id && tenantClient.from('sub_ledgers').select('sub_ledger_name').eq('id', b.customer_sub_ledger_id).maybeSingle(),
        b.agent_id && tenantClient.from('salesman_agents').select('agent_name').eq('id', b.agent_id).maybeSingle(),
        b.warehouse_id && tenantClient.from('warehouses').select('warehouse_name').eq('id', b.warehouse_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle(),
        b.area_id && tenantClient.from('areas').select('area_name').eq('id', b.area_id).maybeSingle(),
        b.route_id && tenantClient.from('routes').select('route_name').eq('id', b.route_id).maybeSingle()
    ];
    const [customer, subLedger, agent, warehouse, costCenter, businessUnit, area, route] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        customer_name_snapshot: customer.data?.account_name || null,
        customer_sub_ledger_name_snapshot: subLedger.data?.sub_ledger_name || null,
        agent_name_snapshot: agent.data?.agent_name || null,
        warehouse_name_snapshot: warehouse.data?.warehouse_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null,
        area_name_snapshot: area.data?.area_name || null,
        route_name_snapshot: route.data?.route_name || null
    };
}

async function captureDetailSnapshots(tenantClient, d) {
    const [product, uom, warehouse] = await Promise.all([
        d.product_id ? tenantClient.from('products').select('product_name').eq('id', d.product_id).maybeSingle() : Promise.resolve({ data: null }),
        d.uom_id ? tenantClient.from('product_units').select('unit_name').eq('id', d.uom_id).maybeSingle() : Promise.resolve({ data: null }),
        d.warehouse_id ? tenantClient.from('warehouses').select('warehouse_name').eq('id', d.warehouse_id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    return { product_name_snapshot: product.data?.product_name || null, uom_name_snapshot: uom.data?.unit_name || null, warehouse_name_snapshot: warehouse.data?.warehouse_name || null };
}

// FEATURE: "Fixed Dual UOM" - when a product uses this mode, qty is
// the PRIMARY unit's count (e.g. Carton) and alt_qty is an
// INDEPENDENT secondary-unit count (e.g. loose Pieces) - not an
// alternate display of the same total. rate_basis says which unit the
// entered rate actually prices; the combined total (via
// computeDualAmount) is what the amount is based on either way.
async function lineAmount(tenantClient, d) {
    const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
    if (product?.uom_mode === 'fixed_dual' && d.alt_qty) {
        const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
        const conversionFactor = Number(unitRate?.conversion_factor) || 1;
        const gross = computeDualAmount(d.qty, d.alt_qty, d.rate, d.rate_basis || 'primary', conversionFactor, await getDualUomMode(tenantClient));
        const discountAmount = d.discount_amount ? Number(d.discount_amount) : gross * (Number(d.discount_percent) || 0) / 100;
        const afterDiscount = gross - discountAmount;
        const taxAmount = d.tax_amount ? Number(d.tax_amount) : afterDiscount * (Number(d.tax_percent) || 0) / 100;
        return { discountAmount, taxAmount, amount: afterDiscount + taxAmount, conversionFactor };
    }
    const gross = Number(d.qty) * Number(d.rate);
    const discountAmount = d.discount_amount ? Number(d.discount_amount) : gross * (Number(d.discount_percent) || 0) / 100;
    const afterDiscount = gross - discountAmount;
    const taxAmount = d.tax_amount ? Number(d.tax_amount) : afterDiscount * (Number(d.tax_percent) || 0) / 100;
    return { discountAmount, taxAmount, amount: afterDiscount + taxAmount, conversionFactor: null };
}

async function syncDetails(tenantClient, tenantId, billId, details) {
    await tenantClient.from('sales_bill_details').delete().eq('bill_id', billId);
    if (!Array.isArray(details) || details.length === 0) return { total: 0, totalTax: 0 };
    const rows = await Promise.all(details.map(async (d, i) => {
        const snapshots = await captureDetailSnapshots(tenantClient, d);
        const { discountAmount, taxAmount, amount } = await lineAmount(tenantClient, d);
        return {
            tenant_id: tenantId, bill_id: billId, display_order: i + 1,
            source_delivery_detail_id: d.source_delivery_detail_id || null, source_order_detail_id: d.source_order_detail_id || null,
            product_id: d.product_id, qty: Number(d.qty), uom_id: d.uom_id || null,
            alt_qty: d.alt_qty || null, alt_unit_id: d.alt_unit_id || null, rate_basis: d.rate_basis || 'primary',
            rate: Number(d.rate) || 0, amount, discount_percent: d.discount_percent || 0, discount_amount: discountAmount,
            tax_percent: d.tax_percent || 0, tax_amount: taxAmount, free_qty: d.free_qty || 0, free_alt_qty: d.free_alt_qty || 0,
            warehouse_id: d.warehouse_id || null, batch_no: d.batch_no || null, serial_no: d.serial_no || null,
            ...snapshots
        };
    }));
    const { error } = await tenantClient.from('sales_bill_details').insert(rows);
    if (error) throw error;
    return { total: rows.reduce((s, r) => s + Number(r.amount), 0), totalTax: rows.reduce((s, r) => s + Number(r.tax_amount), 0) };
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function updateBilledProgress(tenantClient, details, delta) {
    for (const d of details) {
        if (d.source_delivery_detail_id) {
            const { data: row } = await tenantClient.from('sales_delivery_details').select('qty_billed').eq('id', d.source_delivery_detail_id).maybeSingle();
            if (row) await tenantClient.from('sales_delivery_details').update({ qty_billed: Math.max(0, Number(row.qty_billed) + delta * Number(d.qty)) }).eq('id', d.source_delivery_detail_id);
            await bumpAltCounter(tenantClient, 'sales_delivery_details', d.source_delivery_detail_id, 'alt_qty_billed', delta * Number(d.alt_qty || 0));
        }
    }
}

async function postBillStockMovements(tenantClient, tenantId, bill, details) {
    const rows = [];
    for (const d of details) {
        if (d.source_delivery_detail_id) continue;
        const wh = d.warehouse_id || bill.warehouse_id;
        const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
        let baseQty, unitCost;
        if (product?.uom_mode === 'fixed_dual' && d.alt_qty) {
            const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
            const conversionFactor = Number(unitRate?.conversion_factor) || 1;
            baseQty = toBaseQtyFromDual(d.qty, d.alt_qty, conversionFactor, await getDualUomMode(tenantClient));
            // unit_cost must always be PER BASE UNIT for the shared
            // stock ledger, regardless of which unit the rate was
            // actually quoted in.
            unitCost = d.rate_basis === 'primary' ? Number(d.rate) / conversionFactor : Number(d.rate);
        } else {
            baseQty = await toBaseUnitQty(tenantClient, d.product_id, d.qty, d.uom_id);
            unitCost = d.rate || 0;
        }
        rows.push({ tenant_id: tenantId, product_id: d.product_id, warehouse_id: wh, batch_no: d.batch_no, movement_date: bill.doc_date, qty_out: baseQty, qty_in: 0, unit_cost: unitCost, source_type: 'sales_bill', source_id: bill.id, source_detail_id: d.id, narration: `Bill ${bill.doc_no} - direct sale` });
    }
    if (rows.length > 0) {
        const { error } = await tenantClient.from('stock_movements').insert(rows);
        if (error) throw error;
    }
}

async function reverseBillStockMovements(tenantClient, billId) {
    await tenantClient.from('stock_movements').delete().eq('source_type', 'sales_bill').eq('source_id', billId);
}

// Sales-side accounts per line: Product account -> the document's Sales
// Account -> System Control default (utils/accountResolver). The entry
// screen now has a Sales Account picker; blank means System default.
async function salesSplit(tenantClient, tenantId, doc, postVat) {
    const { data: lines } = await tenantClient.from('sales_bill_details').select('product_id, amount, tax_amount').eq('bill_id', doc.id);
    const netTotal = Number(doc.total_amount) - (postVat ? Number(doc.total_tax_amount) : 0);
    return splitByAccount(tenantClient, tenantId, 'sales', doc, lines || [], netTotal, { isReturn: false });
}

// Checked BEFORE the status becomes 'posted', so a missing ledger can never
// leave a posted document with no (or an unbalanced) GL entry.
async function postingPreflight(tenantClient, tenantId, doc) {
    if (!doc.customer_ledger_id) return 'Choose a customer before posting';
    // same VAT decision as the posting itself, or VAT would look like an unassigned remainder
    const postVat = Number(doc.total_tax_amount) > 0 && !!(await defaultVatLedger(tenantClient, tenantId, 'sales'));
    const parts = await salesSplit(tenantClient, tenantId, doc, postVat);
    if (parts.some(p => !p.ledgerId)) return 'No Sales Account for some items: set it on the product, on this document, or as the default in System Control > Ledger Mapping';
    return null;
}

async function postBillToLedger(tenantClient, tenantId, bill, userId) {
    // VAT ledger: System Control's, else the sales VAT billing term's ledger (utils/vatLedger).
    const sysControl = { vat_ledger_id: await defaultVatLedger(tenantClient, tenantId, 'sales') };
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'sales_bill', document_id: bill.id, batch_date: bill.doc_date, narration: bill.narration || `Sales Bill ${bill.doc_no}`, created_by: userId })
        .select().single();
    if (error) throw error;

    // FIX: when no VAT ledger resolves, the VAT stays in Sales - otherwise
    // Dr (total) != Cr (total - VAT) and the batch-balance check rejects
    // the whole posting.
    const postVat = Number(bill.total_tax_amount) > 0 && !!sysControl?.vat_ledger_id;
    const netSales = Number(bill.total_amount) - (postVat ? Number(bill.total_tax_amount) : 0);
    const parts = await salesSplit(tenantClient, tenantId, bill, postVat);
    const rows = [{ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: bill.customer_ledger_id, sub_ledger_id: bill.customer_sub_ledger_id || null, debit_amount: bill.total_amount, credit_amount: 0 }];
    parts.forEach(p => rows.push({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: p.ledgerId, sub_ledger_id: p.subLedgerId, debit_amount: p.amount < 0 ? -p.amount : 0, credit_amount: p.amount > 0 ? p.amount : 0 }));
    if (postVat) {
        rows.push({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: sysControl.vat_ledger_id, debit_amount: 0, credit_amount: bill.total_tax_amount });
    }
    // Every line of this document belongs to its Product Company (company-wise
    // party ledger / ageing read it from the GL).
    rows.forEach(r => { if (r.product_company_id === undefined) r.product_company_id = bill.product_company_id || null; });
    if (rows.length > 1) {
        const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
        if (lineErr) throw lineErr;
    }
}

async function reverseBillGlBatch(tenantClient, billId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', 'sales_bill').eq('document_id', billId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

router.get('/sales-bills', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_bills').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-bills/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_bills').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Sales Bill not found' });
        const { data: details } = await tenantClient.from('sales_bill_details').select('*').eq('bill_id', req.params.id).order('display_order');
        data.details = details || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sales-bills', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_bill', req.body, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'sales', req.body, isDraft);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;

        let creditCheck = { result: 'passed', message: null };
        if (!isDraft && b.customer_ledger_id) {
            const lineAmounts = await Promise.all((b.details || []).map(d => lineAmount(tenantClient, d)));
            const grossTotal = lineAmounts.reduce((s, la) => s + la.amount, 0);
            creditCheck = await checkCustomerCredit(tenantClient, tenantId, b.customer_ledger_id, grossTotal);
            if (creditCheck.result === 'blocked' && !b.override_credit_block) {
                return res.status(400).json({ success: false, error: creditCheck.message, credit_blocked: true });
            }
            if (creditCheck.result === 'blocked' && b.override_credit_block) creditCheck.result = 'overridden';
        }

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
                tenantId, voucherType: 'sales_bill', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'sales_bills',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_sales_bill_code', type_prefix: 'INV' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('sales_bills')
            .insert({
                product_company_id: b.product_company_id || null,
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                source_delivery_id: b.source_delivery_id || null, source_order_id: b.source_order_id || null,
                customer_ledger_id: b.customer_ledger_id || null, customer_sub_ledger_id: b.customer_sub_ledger_id || null, sales_sub_ledger_id: b.sales_sub_ledger_id || null, agent_id: b.agent_id || null,
                invoice_type: b.invoice_type || 'credit', currency: b.currency || 'NPR', due_date: b.due_date || null, due_days: b.due_days || null,
                warehouse_id: b.warehouse_id || null, sales_account_ledger_id: b.sales_account_ledger_id || null, sales_sub_ledger_id: b.sales_sub_ledger_id || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                rate_type: b.rate_type || 'exclusive', cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                area_id: b.area_id || null, route_id: b.route_id || null,
                credit_check_result: isDraft ? null : creditCheck.result, credit_check_message: creditCheck.message,
                pending_bill_wise_settlements: b.bill_wise_settlements ? JSON.stringify(b.bill_wise_settlements) : null,
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const { total, totalTax } = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave);
            await tenantClient.from('sales_bills').update({ total_amount: total, total_tax_amount: totalTax }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('sales_bill_details').delete().eq('bill_id', doc.id);
            await tenantClient.from('sales_bills').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save bill lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_sales_bill', 'sales_bill', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'sales_bill', doc.id, 'create', req.auth.userId);
        const warning = creditCheck.result === 'warned' ? creditCheck.message : undefined;
        res.json({ success: true, message: `Sales Bill ${doc.doc_no} created`, data: doc, warning });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-bills/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('sales_bills').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Bill not found' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} bill` });
        }

        const isDraft = b.status === 'draft' && b.save_as_draft === true;
        const validationError = validateBody(b, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_bill', b, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'sales', b, isDraft);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_bill', b, existing);

        const snapshots = await captureMasterSnapshots(tenantClient, { ...existing, ...b });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.details;
        delete update.save_as_draft;
        delete update.override_credit_block;
        delete update.bill_wise_settlements;
        if (b.bill_wise_settlements) update.pending_bill_wise_settlements = JSON.stringify(b.bill_wise_settlements);

        const { data, error } = await tenantClient.from('sales_bills').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const { total, totalTax } = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            await tenantClient.from('sales_bills').update({ total_amount: total, total_tax_amount: totalTax }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_sales_bill', 'sales_bill', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'sales_bill', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-bills/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_bills').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Bill not found' });

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') {
            update.cancellation_reason = cancellation_reason;
            update.cancelled_at = new Date().toISOString();
            update.cancelled_by = req.auth.userId;
        }
        if (status === 'posted') { update.posted_by = req.auth.userId; update.posted_at = new Date().toISOString(); }

        if (status === 'posted' && existing.status !== 'posted') {
            const blocker = await postingPreflight(tenantClient, tenantId, existing);
            if (blocker) return res.status(400).json({ success: false, error: blocker });
        }
        const { data, error } = await tenantClient.from('sales_bills').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        const { data: billDetails } = await tenantClient.from('sales_bill_details').select('*').eq('bill_id', req.params.id);

        if (status === 'posted' && existing.status !== 'posted') {
            await postBillToLedger(tenantClient, tenantId, data, req.auth.userId);
            await postBillStockMovements(tenantClient, tenantId, data, billDetails || []);
            await updateBilledProgress(tenantClient, billDetails || [], 1);

            if (data.customer_ledger_id) {
                const bwEnabled = await isBillWiseTrackingEnabled(tenantClient, tenantId, data.customer_ledger_id);
                if (bwEnabled) {
                    await createReferenceAndSettle(tenantClient, tenantId, { productCompanyId: data.product_company_id || null,
                        ledgerId: data.customer_ledger_id, sourceType: 'sales_bill', sourceId: data.id,
                        docNo: data.doc_no, date: data.doc_date, nature: 'dr', totalAmount: data.total_amount,
                        settlements: req.body.bill_wise_settlements || data.pending_bill_wise_settlements || []
                    });
                }
            }
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseReferenceAndSettlements(tenantClient, 'sales_bill', req.params.id);
            await reverseBillGlBatch(tenantClient, req.params.id);
            await reverseBillStockMovements(tenantClient, req.params.id);
            await updateBilledProgress(tenantClient, billDetails || [], -1);
        }

        await logAudit(tenantId, req.auth.userId, 'change_sales_bill_status', 'sales_bill', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'sales_bill', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sales-bills/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_bills').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Bill not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted bill' });
        const { error } = await tenantClient.from('sales_bills').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_sales_bill', 'sales_bill', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-bills/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'sales_bill').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
