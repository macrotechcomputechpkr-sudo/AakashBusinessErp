// =============================================
// routes/salesReturnRoutes.js
// Customer returns goods - Dr Sales Account / Dr VAT (reversing both),
// Cr Customer (a 'cr' bill-wise reference, like a Credit Note - settles
// against outstanding 'dr' bills), goods physically come back IN to
// stock, qty_returned progress tracked on the source Sales Bill.
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
const { toBaseUnitQty } = require('../utils/unitConversion');
const { isBillWiseTrackingEnabled, getOutstandingReferences, computeFifoAllocation, createReferenceAndSettle, reverseReferenceAndSettlements, checkCanCancelIfSettled } = require('../utils/billWiseSettlement');
const { toBaseQtyFromDual, computeDualAmount, getDualUomMode } = require('../utils/dualUomCalculation');

async function getDualUomConfig(tenantClient, productId) {
    const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', productId).maybeSingle();
    if (product?.uom_mode !== 'fixed_dual') return null;
    const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', productId).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
    return { conversionFactor: Number(unitRate?.conversion_factor) || 1 };
}

async function resolveBaseQtyAndCost(tenantClient, d) {
    const dualConfig = d.alt_qty ? await getDualUomConfig(tenantClient, d.product_id) : null;
    if (dualConfig) {
        const baseQty = toBaseQtyFromDual(d.qty, d.alt_qty, dualConfig.conversionFactor, await getDualUomMode(tenantClient));
        const unitCost = d.rate_basis === 'primary' ? Number(d.rate || 0) / dualConfig.conversionFactor : Number(d.rate || 0);
        return { baseQty, unitCost };
    }
    const baseQty = await toBaseUnitQty(tenantClient, d.product_id, d.qty, d.uom_id);
    return { baseQty, unitCost: d.rate || 0 };
}

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!b.customer_ledger_id) return 'Customer is required';
    if (!b.warehouse_id) return 'Warehouse is required';
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

async function lineAmount(tenantClient, d) {
    let gross;
    if (d.alt_qty) {
        const dualConfig = await getDualUomConfig(tenantClient, d.product_id);
        gross = dualConfig ? computeDualAmount(d.qty, d.alt_qty, d.rate, d.rate_basis || 'primary', dualConfig.conversionFactor, await getDualUomMode(tenantClient)) : Number(d.qty) * Number(d.rate);
    } else {
        gross = Number(d.qty) * Number(d.rate);
    }
    const discountAmount = d.discount_amount ? Number(d.discount_amount) : gross * (Number(d.discount_percent) || 0) / 100;
    const afterDiscount = gross - discountAmount;
    const taxAmount = d.tax_amount ? Number(d.tax_amount) : afterDiscount * (Number(d.tax_percent) || 0) / 100;
    return { discountAmount, taxAmount, amount: afterDiscount + taxAmount };
}

async function syncDetails(tenantClient, tenantId, returnId, details) {
    await tenantClient.from('sales_return_details').delete().eq('return_id', returnId);
    if (!Array.isArray(details) || details.length === 0) return { total: 0, totalTax: 0 };
    const rows = await Promise.all(details.map(async (d, i) => {
        const snapshots = await captureDetailSnapshots(tenantClient, d);
        const { discountAmount, taxAmount, amount } = await lineAmount(tenantClient, d);
        return {
            tenant_id: tenantId, return_id: returnId, display_order: i + 1,
            source_bill_detail_id: d.source_bill_detail_id || null,
            product_id: d.product_id, qty: Number(d.qty), uom_id: d.uom_id || null,
            alt_qty: d.alt_qty || null, alt_unit_id: d.alt_unit_id || null, rate_basis: d.rate_basis || 'primary',
            rate: Number(d.rate) || 0, amount, discount_percent: d.discount_percent || 0, discount_amount: discountAmount,
            tax_percent: d.tax_percent || 0, tax_amount: taxAmount,
            warehouse_id: d.warehouse_id || null, batch_no: d.batch_no || null, serial_no: d.serial_no || null,
            ...snapshots
        };
    }));
    const { error } = await tenantClient.from('sales_return_details').insert(rows);
    if (error) throw error;
    return { total: rows.reduce((s, r) => s + Number(r.amount), 0), totalTax: rows.reduce((s, r) => s + Number(r.tax_amount), 0) };
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function adjustSourceQtyReturned(tenantClient, d, delta, direction = 0) {
    if (!d.source_bill_detail_id) return;
    const { data: row } = await tenantClient.from('sales_bill_details').select('qty_returned').eq('id', d.source_bill_detail_id).maybeSingle();
    if (row) await tenantClient.from('sales_bill_details').update({ qty_returned: Math.max(0, Number(row.qty_returned) + delta) }).eq('id', d.source_bill_detail_id);
    await bumpAltCounter(tenantClient, 'sales_bill_details', d.source_bill_detail_id, 'alt_qty_returned', direction * Number(d.alt_qty || 0));
}

async function postReturnStockMovements(tenantClient, tenantId, returnDoc, details) {
    const rows = [];
    for (const d of details) {
        const wh = d.warehouse_id || returnDoc.warehouse_id;
        const { baseQty, unitCost } = await resolveBaseQtyAndCost(tenantClient, d);
        rows.push({ tenant_id: tenantId, product_id: d.product_id, warehouse_id: wh, batch_no: d.batch_no, movement_date: returnDoc.doc_date, qty_in: baseQty, qty_out: 0, unit_cost: unitCost, source_type: 'sales_return', source_id: returnDoc.id, source_detail_id: d.id, narration: `Sales Return ${returnDoc.doc_no}` });
    }
    if (rows.length > 0) {
        const { error } = await tenantClient.from('stock_movements').insert(rows);
        if (error) throw error;
    }
}

async function reverseReturnStockMovements(tenantClient, returnId) {
    await tenantClient.from('stock_movements').delete().eq('source_type', 'sales_return').eq('source_id', returnId);
}

// Sales-side accounts per line: Product account -> the document's Sales
// Account -> System Control default (utils/accountResolver). The entry
// screen now has a Sales Account picker; blank means System default.
async function salesSplit(tenantClient, tenantId, doc, postVat) {
    const { data: lines } = await tenantClient.from('sales_return_details').select('product_id, amount, tax_amount').eq('return_id', doc.id);
    const netTotal = Number(doc.total_amount) - (postVat ? Number(doc.total_tax_amount) : 0);
    return splitByAccount(tenantClient, tenantId, 'sales', doc, lines || [], netTotal, { isReturn: true });
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

async function postReturnToLedger(tenantClient, tenantId, returnDoc, userId) {
    // VAT ledger: System Control's, else the sales VAT billing term's ledger (utils/vatLedger).
    const sysControl = { vat_ledger_id: await defaultVatLedger(tenantClient, tenantId, 'sales') };
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'sales_return', document_id: returnDoc.id, batch_date: returnDoc.doc_date, narration: returnDoc.narration || `Sales Return ${returnDoc.doc_no}`, created_by: userId })
        .select().single();
    if (error) throw error;

    // FIX: same as Sales Bill - with no VAT ledger the VAT stays in Sales
    // so the batch still balances.
    const postVat = Number(returnDoc.total_tax_amount) > 0 && !!sysControl?.vat_ledger_id;
    const netReturn = Number(returnDoc.total_amount) - (postVat ? Number(returnDoc.total_tax_amount) : 0);
    const parts = await salesSplit(tenantClient, tenantId, returnDoc, postVat);
    const rows = [{ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: returnDoc.customer_ledger_id, sub_ledger_id: returnDoc.customer_sub_ledger_id || null, debit_amount: 0, credit_amount: returnDoc.total_amount }];
    parts.forEach(p => rows.push({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: p.ledgerId, sub_ledger_id: p.subLedgerId, debit_amount: p.amount > 0 ? p.amount : 0, credit_amount: p.amount < 0 ? -p.amount : 0 }));
    if (postVat) {
        rows.push({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: sysControl.vat_ledger_id, debit_amount: returnDoc.total_tax_amount, credit_amount: 0 });
    }
    // Every line of this document belongs to its Product Company (company-wise
    // party ledger / ageing read it from the GL).
    rows.forEach(r => { if (r.product_company_id === undefined) r.product_company_id = returnDoc.product_company_id || null; });
    if (rows.length > 1) {
        const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
        if (lineErr) throw lineErr;
    }
}

async function reverseReturnGlBatch(tenantClient, returnId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', 'sales_return').eq('document_id', returnId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

router.get('/sales-returns', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_returns').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-returns/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_returns').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Sales Return not found' });
        const { data: details } = await tenantClient.from('sales_return_details').select('*').eq('return_id', req.params.id).order('display_order');
        data.details = details || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sales-returns', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_return', req.body, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'sales', req.body, isDraft);
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
                tenantId, voucherType: 'sales_return', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'sales_returns',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_sales_return_code', type_prefix: 'SR' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('sales_returns')
            .insert({
                product_company_id: b.product_company_id || null,
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null, source_bill_id: b.source_bill_id || null,
                customer_ledger_id: b.customer_ledger_id || null, customer_sub_ledger_id: b.customer_sub_ledger_id || null, sales_sub_ledger_id: b.sales_sub_ledger_id || null, agent_id: b.agent_id || null,
                warehouse_id: b.warehouse_id || null, sales_account_ledger_id: b.sales_account_ledger_id || null, sales_sub_ledger_id: b.sales_sub_ledger_id || null,
                return_reason: b.return_reason || 'other', settlement_type: b.settlement_type || 'credit_note',
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null, area_id: b.area_id || null, route_id: b.route_id || null,
                pending_bill_wise_settlements: b.bill_wise_settlements ? JSON.stringify(b.bill_wise_settlements) : null,
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const { total, totalTax } = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave);
            await tenantClient.from('sales_returns').update({ total_amount: total, total_tax_amount: totalTax }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('sales_return_details').delete().eq('return_id', doc.id);
            await tenantClient.from('sales_returns').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save return lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_sales_return', 'sales_return', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'sales_return', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Sales Return ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-returns/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('sales_returns').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Return not found' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} return` });
        }

        const isDraft = b.status === 'draft' && b.save_as_draft === true;
        const validationError = validateBody(b, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_return', b, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'sales', b, isDraft);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_return', b, existing);

        const snapshots = await captureMasterSnapshots(tenantClient, { ...existing, ...b });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.details;
        delete update.save_as_draft;
        delete update.bill_wise_settlements;
        if (b.bill_wise_settlements) update.pending_bill_wise_settlements = JSON.stringify(b.bill_wise_settlements);

        const { data, error } = await tenantClient.from('sales_returns').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const { total, totalTax } = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            await tenantClient.from('sales_returns').update({ total_amount: total, total_tax_amount: totalTax }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_sales_return', 'sales_return', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'sales_return', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-returns/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_returns').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Return not found' });

        if (status === 'cancelled' && existing.status === 'posted') {
            const blockMsg = await checkCanCancelIfSettled(tenantClient, tenantId, 'sales_return', req.params.id);
            if (blockMsg) return res.status(400).json({ success: false, error: blockMsg });
        }

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
        const { data, error } = await tenantClient.from('sales_returns').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        const { data: returnDetails } = await tenantClient.from('sales_return_details').select('*').eq('return_id', req.params.id);

        if (status === 'posted' && existing.status !== 'posted') {
            for (const d of (returnDetails || [])) await adjustSourceQtyReturned(tenantClient, d, Number(d.qty), 1);
            await postReturnStockMovements(tenantClient, tenantId, data, returnDetails || []);
            await postReturnToLedger(tenantClient, tenantId, data, req.auth.userId);

            if (data.customer_ledger_id) {
                const bwEnabled = await isBillWiseTrackingEnabled(tenantClient, tenantId, data.customer_ledger_id);
                if (bwEnabled) {
                    let settlements = req.body.bill_wise_settlements || data.pending_bill_wise_settlements;
                    if (!settlements) {
                        const outstanding = await getOutstandingReferences(tenantClient, data.customer_ledger_id, 'dr', data.product_company_id || null);
                        settlements = computeFifoAllocation(outstanding, data.total_amount).allocations;
                    }
                    await createReferenceAndSettle(tenantClient, tenantId, { productCompanyId: data.product_company_id || null,
                        ledgerId: data.customer_ledger_id, sourceType: 'sales_return', sourceId: data.id,
                        docNo: data.doc_no, date: data.doc_date, nature: 'cr', totalAmount: data.total_amount, settlements
                    });
                }
            }
        } else if (status === 'cancelled' && existing.status === 'posted') {
            for (const d of (returnDetails || [])) await adjustSourceQtyReturned(tenantClient, d, -Number(d.qty), -1);
            await reverseReturnStockMovements(tenantClient, req.params.id);
            await reverseReturnGlBatch(tenantClient, req.params.id);
            await reverseReferenceAndSettlements(tenantClient, 'sales_return', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'change_sales_return_status', 'sales_return', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'sales_return', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sales-returns/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_returns').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Return not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted return' });
        const { error } = await tenantClient.from('sales_returns').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_sales_return', 'sales_return', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-returns/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'sales_return').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
