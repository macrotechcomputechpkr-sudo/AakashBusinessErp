// =============================================
// routes/salesQuotationRoutes.js
// A quote given to a customer - simpler than Sales Order (no credit
// check needed, nothing has been committed to yet), Draft/Copy pattern
// carried over.
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const { checkProductCompany } = require('../utils/productCompanyRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { toBaseQtyFromDual, computeDualAmount, getDualUomMode } = require('../utils/dualUomCalculation');

async function getDualUomConfig(tenantClient, productId) {
    const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', productId).maybeSingle();
    if (product?.uom_mode !== 'fixed_dual') return null;
    const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', productId).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
    return { conversionFactor: Number(unitRate?.conversion_factor) || 1 };
}

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

async function syncDetails(tenantClient, tenantId, quotationId, details) {
    await tenantClient.from('sales_quotation_details').delete().eq('quotation_id', quotationId);
    if (!Array.isArray(details) || details.length === 0) return 0;
    const rows = await Promise.all(details.map(async (d, i) => {
        const snapshots = await captureDetailSnapshots(tenantClient, d);
        const { discountAmount, taxAmount, amount } = await lineAmount(tenantClient, d);
        return {
            tenant_id: tenantId, quotation_id: quotationId, display_order: i + 1,
            product_id: d.product_id, qty: Number(d.qty), uom_id: d.uom_id || null,
            alt_qty: d.alt_qty || null, alt_unit_id: d.alt_unit_id || null, rate_basis: d.rate_basis || 'primary',
            rate: Number(d.rate) || 0, amount, discount_percent: d.discount_percent || 0, discount_amount: discountAmount,
            tax_percent: d.tax_percent || 0, tax_amount: taxAmount,
            warehouse_id: d.warehouse_id || null, batch_no: d.batch_no || null,
            ...snapshots
        };
    }));
    const { error } = await tenantClient.from('sales_quotation_details').insert(rows);
    if (error) throw error;
    return rows.reduce((s, r) => s + Number(r.amount), 0);
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

router.get('/sales-quotations', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_quotations').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-quotations/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_quotations').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Sales Quotation not found' });
        const { data: details } = await tenantClient.from('sales_quotation_details').select('*').eq('quotation_id', req.params.id).order('display_order');
        data.details = details || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sales-quotations', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_quotation', req.body, isDraft);
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
                tenantId, voucherType: 'sales_quotation', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'sales_quotations',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_sales_quotation_code', type_prefix: 'SQ' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('sales_quotations')
            .insert({
                product_company_id: b.product_company_id || null,
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null, valid_until: b.valid_until || null,
                customer_ledger_id: b.customer_ledger_id || null, customer_sub_ledger_id: b.customer_sub_ledger_id || null, agent_id: b.agent_id || null,
                currency: b.currency || 'NPR', warehouse_id: b.warehouse_id || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                rate_type: b.rate_type || 'exclusive', cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                area_id: b.area_id || null, route_id: b.route_id || null, terms_conditions_id: b.terms_conditions_id || null,
                priority: b.priority || 'normal',
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const total = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave);
            await tenantClient.from('sales_quotations').update({ total_amount: total }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('sales_quotation_details').delete().eq('quotation_id', doc.id);
            await tenantClient.from('sales_quotations').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save quotation lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_sales_quotation', 'sales_quotation', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'sales_quotation', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Sales Quotation ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-quotations/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('sales_quotations').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Quotation not found' });
        if (['accepted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit an ${existing.status} quotation` });
        }

        const isDraft = b.status === 'draft' && b.save_as_draft === true;
        const validationError = validateBody(b, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_quotation', b, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'sales', b, isDraft);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_quotation', b, existing);

        const snapshots = await captureMasterSnapshots(tenantClient, { ...existing, ...b });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.details;
        delete update.save_as_draft;

        const { data, error } = await tenantClient.from('sales_quotations').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const total = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            await tenantClient.from('sales_quotations').update({ total_amount: total }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_sales_quotation', 'sales_quotation', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'sales_quotation', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-quotations/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'sent', 'accepted', 'expired', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_quotations').select('status').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Quotation not found' });

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') {
            update.cancellation_reason = cancellation_reason;
            update.cancelled_at = new Date().toISOString();
            update.cancelled_by = req.auth.userId;
        }
        const { data, error } = await tenantClient.from('sales_quotations').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        await logAudit(tenantId, req.auth.userId, 'change_sales_quotation_status', 'sales_quotation', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'sales_quotation', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sales-quotations/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_quotations').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Quotation not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a sent quotation' });
        const { error } = await tenantClient.from('sales_quotations').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_sales_quotation', 'sales_quotation', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-quotations/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'sales_quotation').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
