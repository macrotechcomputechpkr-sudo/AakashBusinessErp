// =============================================
// routes/salesDeliveryRoutes.js
// Goods physically leave here - OUT movement to the shared stock
// ledger on posting, same negative-stock-control pattern Stock
// Transfer uses, qty_delivered progress tracked back on the source
// Sales Order.
// =============================================

const express = require('express');
const { bumpAltCounter, rollHeaderStatus } = require('../utils/progressCounters');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const { checkProductCompany } = require('../utils/productCompanyRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { toBaseUnitQty } = require('../utils/unitConversion');
const { toBaseQtyFromDual, computeDualAmount, getDualUomMode } = require('../utils/dualUomCalculation');

async function resolveBaseQtyAndCost(tenantClient, d) {
    const dualConfig = d.alt_qty ? await (async () => {
        const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
        if (product?.uom_mode !== 'fixed_dual') return null;
        const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
        return { conversionFactor: Number(unitRate?.conversion_factor) || 1 };
    })() : null;
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

async function syncDetails(tenantClient, tenantId, deliveryId, details) {
    await tenantClient.from('sales_delivery_details').delete().eq('delivery_id', deliveryId);
    if (!Array.isArray(details) || details.length === 0) return 0;
    const rows = await Promise.all(details.map(async (d, i) => {
        const snapshots = await captureDetailSnapshots(tenantClient, d);
        const qty = Number(d.qty) || 0, rate = Number(d.rate) || 0;
        let amount;
        if (d.alt_qty) {
            const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
            if (product?.uom_mode === 'fixed_dual') {
                const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
                amount = computeDualAmount(d.qty, d.alt_qty, d.rate, d.rate_basis || 'primary', Number(unitRate?.conversion_factor) || 1, await getDualUomMode(tenantClient));
            } else {
                amount = qty * rate;
            }
        } else {
            amount = qty * rate;
        }
        return {
            tenant_id: tenantId, delivery_id: deliveryId, display_order: i + 1,
            source_order_detail_id: d.source_order_detail_id || null,
            product_id: d.product_id, qty, uom_id: d.uom_id || null,
            alt_qty: d.alt_qty || null, alt_unit_id: d.alt_unit_id || null, rate_basis: d.rate_basis || 'primary',
            rate, amount,
            warehouse_id: d.warehouse_id || null, batch_no: d.batch_no || null, serial_no: d.serial_no || null,
            mfg_date: d.mfg_date || null, exp_date: d.exp_date || null,
            ...snapshots
        };
    }));
    const { error } = await tenantClient.from('sales_delivery_details').insert(rows);
    if (error) throw error;
    return rows.reduce((s, r) => s + Number(r.amount), 0);
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function updateOrderDeliveredProgress(tenantClient, details, delta) {
    for (const d of details) {
        if (!d.source_order_detail_id) continue;
        const { data: oDetail } = await tenantClient.from('sales_order_details').select('qty_delivered').eq('id', d.source_order_detail_id).maybeSingle();
        if (!oDetail) continue;
        await tenantClient.from('sales_order_details').update({ qty_delivered: Math.max(0, Number(oDetail.qty_delivered) + delta * Number(d.qty)) }).eq('id', d.source_order_detail_id);
    await bumpAltCounter(tenantClient, 'sales_order_details', d.source_order_detail_id, 'alt_qty_delivered', delta * Number(d.alt_qty || 0));
    }
    // Sales Order status in BASE units (loose pieces count). This status was
    // never set before - orders stayed 'confirmed' however much was delivered.
    const ids = [...new Set((details || []).map(d => d.source_order_detail_id).filter(Boolean))];
    if (!ids.length) return;
    const { data: src } = await tenantClient.from('sales_order_details').select('order_id').in('id', ids);
    for (const orderId of [...new Set((src || []).map(r => r.order_id))]) {
        await rollHeaderStatus(tenantClient, { headerTable: 'sales_orders', detailTable: 'sales_order_details', fk: 'order_id', headerId: orderId,
            counter: 'qty_delivered', altCounter: 'alt_qty_delivered',
            statuses: { none: 'confirmed', partial: 'partially_delivered', full: 'fully_delivered' }, rollable: ['confirmed', 'partially_delivered', 'fully_delivered'] });
    }
}

async function checkNegativeStock(tenantClient, tenantId, details) {
    const { data: sysControl } = await tenantClient.from('system_control_settings').select('negative_stock_control').eq('tenant_id', tenantId).maybeSingle();
    const control = sysControl?.negative_stock_control || 'warn';
    if (control === 'none') return { blocked: false, warnings: [] };
    const warnings = [];
    for (const d of details) {
        if (!d.warehouse_id) continue;
        let query = tenantClient.from('v_current_stock').select('on_hand_qty').eq('tenant_id', tenantId).eq('product_id', d.product_id).eq('warehouse_id', d.warehouse_id);
        query = d.batch_no ? query.eq('batch_no', d.batch_no) : query.is('batch_no', null);
        const { data: stockRow } = await query.maybeSingle();
        const available = Number(stockRow?.on_hand_qty) || 0;
        const { baseQty } = await resolveBaseQtyAndCost(tenantClient, d);
        if (available - baseQty < 0) {
            warnings.push(`${d.product_name_snapshot || d.product_id}: available ${available} (base unit), delivering ${baseQty} - would go negative`);
        }
    }
    return { blocked: warnings.length > 0 && control === 'block', warnings };
}

async function postDeliveryStockMovements(tenantClient, tenantId, delivery, details) {
    const rows = [];
    for (const d of details) {
        const wh = d.warehouse_id || delivery.warehouse_id;
        const { baseQty, unitCost } = await resolveBaseQtyAndCost(tenantClient, d);
        rows.push({ tenant_id: tenantId, product_id: d.product_id, warehouse_id: wh, batch_no: d.batch_no, movement_date: delivery.doc_date, qty_out: baseQty, qty_in: 0, unit_cost: unitCost, source_type: 'sales_delivery', source_id: delivery.id, source_detail_id: d.id, narration: `Delivery ${delivery.doc_no}` });
    }
    if (rows.length > 0) {
        const { error } = await tenantClient.from('stock_movements').insert(rows);
        if (error) throw error;
    }
}

async function reverseDeliveryStockMovements(tenantClient, deliveryId) {
    await tenantClient.from('stock_movements').delete().eq('source_type', 'sales_delivery').eq('source_id', deliveryId);
}

router.get('/sales-deliveries', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_deliveries').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-deliveries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('sales_deliveries').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Sales Delivery not found' });
        const { data: details } = await tenantClient.from('sales_delivery_details').select('*').eq('delivery_id', req.params.id).order('display_order');
        data.details = details || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sales-deliveries', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_delivery', req.body, isDraft);
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
                tenantId, voucherType: 'sales_delivery', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'sales_deliveries',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_sales_delivery_code', type_prefix: 'DC' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('sales_deliveries')
            .insert({
                product_company_id: b.product_company_id || null,
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null, source_order_id: b.source_order_id || null,
                customer_ledger_id: b.customer_ledger_id || null, customer_sub_ledger_id: b.customer_sub_ledger_id || null, agent_id: b.agent_id || null,
                warehouse_id: b.warehouse_id || null,
                vehicle_no: b.vehicle_no || null, driver_name: b.driver_name || null, transport_master_id: b.transport_master_id || null, delivery_address: b.delivery_address || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null, area_id: b.area_id || null, route_id: b.route_id || null,
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const total = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave);
            await tenantClient.from('sales_deliveries').update({ total_amount: total }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('sales_delivery_details').delete().eq('delivery_id', doc.id);
            await tenantClient.from('sales_deliveries').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save delivery lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_sales_delivery', 'sales_delivery', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'sales_delivery', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Sales Delivery ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-deliveries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('sales_deliveries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Delivery not found' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} delivery` });
        }

        const isDraft = b.status === 'draft' && b.save_as_draft === true;
        const validationError = validateBody(b, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_delivery', b, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'sales', b, isDraft);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'sales_delivery', b, existing);

        const snapshots = await captureMasterSnapshots(tenantClient, { ...existing, ...b });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.details;
        delete update.save_as_draft;

        const { data, error } = await tenantClient.from('sales_deliveries').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const total = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            await tenantClient.from('sales_deliveries').update({ total_amount: total }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_sales_delivery', 'sales_delivery', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'sales_delivery', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sales-deliveries/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_deliveries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Delivery not found' });

        const { data: deliveryDetails } = await tenantClient.from('sales_delivery_details').select('*').eq('delivery_id', req.params.id);

        let stockWarnings = [];
        if (status === 'posted' && existing.status !== 'posted') {
            const stockCheck = await checkNegativeStock(tenantClient, tenantId, deliveryDetails || []);
            if (stockCheck.blocked && !req.body.override_negative_stock_warning) {
                return res.status(400).json({ success: false, error: 'Insufficient stock to post this delivery', warnings: stockCheck.warnings });
            }
            stockWarnings = stockCheck.warnings;
        }

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') {
            update.cancellation_reason = cancellation_reason;
            update.cancelled_at = new Date().toISOString();
            update.cancelled_by = req.auth.userId;
        }
        if (status === 'posted') { update.posted_by = req.auth.userId; update.posted_at = new Date().toISOString(); }

        const { data, error } = await tenantClient.from('sales_deliveries').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (status === 'posted' && existing.status !== 'posted') {
            await postDeliveryStockMovements(tenantClient, tenantId, data, deliveryDetails || []);
            await updateOrderDeliveredProgress(tenantClient, deliveryDetails || [], 1);
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseDeliveryStockMovements(tenantClient, req.params.id);
            await updateOrderDeliveredProgress(tenantClient, deliveryDetails || [], -1);
        }

        await logAudit(tenantId, req.auth.userId, 'change_sales_delivery_status', 'sales_delivery', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'sales_delivery', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data, warnings: stockWarnings.length > 0 ? stockWarnings : undefined });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sales-deliveries/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sales_deliveries').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sales Delivery not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted delivery' });
        const { error } = await tenantClient.from('sales_deliveries').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_sales_delivery', 'sales_delivery', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sales-deliveries/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'sales_delivery').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
