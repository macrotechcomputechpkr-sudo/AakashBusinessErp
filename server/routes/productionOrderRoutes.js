// =============================================
// routes/productionOrderRoutes.js
// Raw materials OUT, finished output (+ by-products) IN - all through
// the same stock_movements ledger and base-unit conversion Stock
// Transfer already uses.
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { evaluateAllTerms } = require('../utils/formulaEvaluator');
const { toBaseUnitQty } = require('../utils/unitConversion');
const { toBaseQtyFromDual, computeDualAmount, getDualUomMode } = require('../utils/dualUomCalculation');

async function resolveDualAwareBaseQty(tenantClient, productId, qty, uomId, altQty, rateBasis) {
    if (altQty) {
        const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', productId).maybeSingle();
        if (product?.uom_mode === 'fixed_dual') {
            const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', productId).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
            return toBaseQtyFromDual(qty, altQty, Number(unitRate?.conversion_factor) || 1, await getDualUomMode(tenantClient));
        }
    }
    return toBaseUnitQty(tenantClient, productId, qty, uomId);
}
const { computeJointAllocation } = require('../utils/jointCostAllocation');

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!b.output_product_id) return 'Output Product is required';
    if (!b.output_qty || Number(b.output_qty) <= 0) return 'Output Qty greater than zero is required';
    if (!b.output_warehouse_id) return 'Output Warehouse is required';
    if (!b.source_warehouse_id) return 'Source Warehouse (for raw materials) is required';
    if (!Array.isArray(b.raw_materials) || b.raw_materials.length === 0) return 'At least one Raw Material line is required';
    for (const r of b.raw_materials) {
        if (!r.product_id) return 'Every raw material line needs a Product';
        if (!r.qty || Number(r.qty) <= 0) return 'Every raw material line needs a Qty greater than zero';
    }
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.output_product_id && tenantClient.from('products').select('product_name').eq('id', b.output_product_id).maybeSingle(),
        b.output_uom_id && tenantClient.from('product_units').select('unit_name').eq('id', b.output_uom_id).maybeSingle(),
        b.output_warehouse_id && tenantClient.from('warehouses').select('warehouse_name').eq('id', b.output_warehouse_id).maybeSingle(),
        b.source_warehouse_id && tenantClient.from('warehouses').select('warehouse_name').eq('id', b.source_warehouse_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle()
    ];
    const [prod, uom, outWh, srcWh, costCenter, businessUnit] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        output_product_name_snapshot: prod.data?.product_name || null,
        output_uom_name_snapshot: uom.data?.unit_name || null,
        output_warehouse_name_snapshot: outWh.data?.warehouse_name || null,
        source_warehouse_name_snapshot: srcWh.data?.warehouse_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

async function captureLineSnapshots(tenantClient, product_id, uom_id, warehouse_id) {
    const [prod, uom, wh] = await Promise.all([
        product_id ? tenantClient.from('products').select('product_name').eq('id', product_id).maybeSingle() : Promise.resolve({ data: null }),
        uom_id ? tenantClient.from('product_units').select('unit_name').eq('id', uom_id).maybeSingle() : Promise.resolve({ data: null }),
        warehouse_id ? tenantClient.from('warehouses').select('warehouse_name').eq('id', warehouse_id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    return { product_name_snapshot: prod.data?.product_name || null, uom_name_snapshot: uom.data?.unit_name || null, warehouse_name_snapshot: wh.data?.warehouse_name || null };
}

async function syncLines(tenantClient, tenantId, productionId, rawMaterials, byproducts, mainOutput) {
    await tenantClient.from('production_raw_materials').delete().eq('production_id', productionId);
    await tenantClient.from('production_byproducts').delete().eq('production_id', productionId);

    let totalRmCost = 0;

    if (Array.isArray(rawMaterials) && rawMaterials.length > 0) {
        const allTermIds = new Set();
        rawMaterials.forEach(r => (r.billing_term_ids || []).forEach(id => allTermIds.add(id)));
        let termsById = {};
        if (allTermIds.size > 0) {
            const { data: terms } = await tenantClient
                .from('billing_terms').select('*').in('id', Array.from(allTermIds)).eq('is_enabled', true).eq('applicable_production_entry', true).order('display_order');
            termsById = Object.fromEntries((terms || []).map(t => [t.id, t]));
        }

        const rows = await Promise.all(rawMaterials.map(async (r, i) => {
            const snapshots = await captureLineSnapshots(tenantClient, r.product_id, r.uom_id, r.warehouse_id);
            const qty = Number(r.qty) || 0, costRate = Number(r.cost_rate) || 0;
            let baseAmount;
            if (r.alt_qty) {
                const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', r.product_id).maybeSingle();
                if (product?.uom_mode === 'fixed_dual') {
                    const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', r.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
                    baseAmount = computeDualAmount(r.qty, r.alt_qty, r.cost_rate, r.rate_basis || 'primary', Number(unitRate?.conversion_factor) || 1, await getDualUomMode(tenantClient));
                } else {
                    baseAmount = qty * costRate;
                }
            } else {
                baseAmount = qty * costRate;
            }
            // FEATURE: "Production Term Ko Accounting Effect Hunu
            // Pardaina, Production Costing Ra Production Report Ma
            // Matrai" - a Production billing term adjusts THIS costing
            // amount (which feeds totalRmCost -> joint allocation ->
            // output_unit_cost) but never touches billing_ledger_id or
            // any other GL field the same terms carry for Purchase.
            const lineTerms = (r.billing_term_ids || []).map(id => termsById[id]).filter(Boolean);
            const amount = lineTerms.length > 0 ? evaluateAllTerms(lineTerms, { basic_amount: baseAmount, quantity: qty }).total : baseAmount;
            return {
                tenant_id: tenantId, production_id: productionId, display_order: i + 1,
                product_id: r.product_id, batch_no: r.batch_no || null, warehouse_id: r.warehouse_id || null,
                qty, uom_id: r.uom_id || null, alt_qty: r.alt_qty || null, alt_unit_id: r.alt_unit_id || null, rate_basis: r.rate_basis || 'primary',
                process_name: r.process_name || null,
                cost_rate: costRate, amount, _baseAmount: baseAmount, _lineTerms: lineTerms,
                ...snapshots
            };
        }));
        const rowsForInsert = rows.map(({ _baseAmount, _lineTerms, ...row }) => row);
        const { data: insertedRows, error } = await tenantClient.from('production_raw_materials').insert(rowsForInsert).select('id, display_order').order('display_order');
        if (error) throw error;
        totalRmCost = rows.reduce((s, r) => s + Number(r.amount), 0);

        // Persist which terms applied to which line, for the Production
        // Report - purely informational, no GL entries created from this.
        await tenantClient.from('document_line_billing_terms').delete().eq('tenant_id', tenantId).eq('document_type', 'production').eq('document_id', productionId);
        const termRows = [];
        rows.forEach((r, i) => {
            if (r._lineTerms.length === 0) return;
            const { lines } = evaluateAllTerms(r._lineTerms, { basic_amount: r._baseAmount, quantity: r.qty });
            r._lineTerms.forEach((term, ti) => {
                termRows.push({ tenant_id: tenantId, document_type: 'production', document_id: productionId, detail_id: insertedRows[i]?.id, billing_term_id: term.id, computed_amount: lines[ti]?.amount ?? 0 });
            });
        });
        if (termRows.length > 0) {
            const { error: termErr } = await tenantClient.from('document_line_billing_terms').insert(termRows);
            if (termErr) throw termErr;
        }
    }

    // FEATURE: "1 chicken becomes many sellable parts" - the actual
    // Joint Cost Allocation happens HERE, now that totalRmCost is known,
    // BEFORE the byproduct rows are written - each joint line's `amount`
    // is its ALLOCATED share (Relative Sales Value Method), not just
    // qty*recovery_rate like a plain minor by-product.
    const byproductDefs = (byproducts || []).map((bp, i) => ({
        _idx: i,
        product_id: bp.product_id, batch_no: bp.batch_no || null, warehouse_id: bp.warehouse_id || null,
        qty: Number(bp.qty) || 0, uom_id: bp.uom_id || null, alt_qty: bp.alt_qty || null, alt_unit_id: bp.alt_unit_id || null, rate_basis: bp.rate_basis || 'primary',
        allocation_basis: bp.allocation_basis || 'fixed_recovery', recovery_rate: Number(bp.recovery_rate) || 0, relative_value: Number(bp.relative_value) || 0
    }));
    const allocation = computeJointAllocation(totalRmCost, { qty: Number(mainOutput.qty) || 0, relative_value: Number(mainOutput.relative_value) || 0 }, byproductDefs);

    let totalBpValue = 0;
    if (byproductDefs.length > 0) {
        const rows = await Promise.all(byproductDefs.map(async (bp) => {
            const snapshots = await captureLineSnapshots(tenantClient, bp.product_id, bp.uom_id, bp.warehouse_id);
            const isFixed = bp.allocation_basis === 'fixed_recovery';
            const jointMatch = !isFixed ? allocation.jointAllocations.find(a => a._idx === bp._idx) : null;
            let amount;
            if (isFixed && bp.alt_qty) {
                const { data: bpProduct } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', bp.product_id).maybeSingle();
                if (bpProduct?.uom_mode === 'fixed_dual') {
                    const { data: bpUnitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', bp.product_id).eq('unit_id', bpProduct.dual_uom_primary_unit_id).maybeSingle();
                    amount = computeDualAmount(bp.qty, bp.alt_qty, bp.recovery_rate, bp.rate_basis || 'primary', Number(bpUnitRate?.conversion_factor) || 1, await getDualUomMode(tenantClient));
                } else {
                    amount = bp.qty * bp.recovery_rate;
                }
            } else {
                amount = isFixed ? bp.qty * bp.recovery_rate : (jointMatch?.allocatedCost || 0);
            }
            return {
                tenant_id: tenantId, production_id: productionId, display_order: bp._idx + 1,
                product_id: bp.product_id, batch_no: bp.batch_no, warehouse_id: bp.warehouse_id,
                qty: bp.qty, uom_id: bp.uom_id, alt_qty: bp.alt_qty, alt_unit_id: bp.alt_unit_id, rate_basis: bp.rate_basis, recovery_rate: bp.recovery_rate,
                allocation_basis: bp.allocation_basis, relative_value: bp.relative_value,
                amount,
                ...snapshots
            };
        }));
        const { error } = await tenantClient.from('production_byproducts').insert(rows);
        if (error) throw error;
        totalBpValue = rows.reduce((s, r) => s + Number(r.amount), 0);
    }

    return { totalRmCost, totalBpValue, mainOutputUnitCost: allocation.mainOutputUnitCost };
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function postProductionMovements(tenantClient, tenantId, production, rawMaterials, byproducts) {
    const rows = [];
    for (const r of rawMaterials) {
        const wh = r.warehouse_id || production.source_warehouse_id;
        const baseQty = await resolveDualAwareBaseQty(tenantClient, r.product_id, r.qty, r.uom_id, r.alt_qty, r.rate_basis);
        rows.push({ tenant_id: tenantId, product_id: r.product_id, warehouse_id: wh, batch_no: r.batch_no, movement_date: production.doc_date, qty_out: baseQty, qty_in: 0, unit_cost: r.cost_rate || 0, source_type: 'production', source_id: production.id, source_detail_id: r.id, narration: `Production ${production.doc_no} - raw material consumed` });
    }
    const outputBaseQty = await resolveDualAwareBaseQty(tenantClient, production.output_product_id, production.output_qty, production.output_uom_id, production.output_alt_qty, production.output_rate_basis);
    rows.push({ tenant_id: tenantId, product_id: production.output_product_id, warehouse_id: production.output_warehouse_id, batch_no: production.output_batch_no, movement_date: production.doc_date, qty_in: outputBaseQty, qty_out: 0, unit_cost: production.output_unit_cost || 0, source_type: 'production', source_id: production.id, narration: `Production ${production.doc_no} - output` });
    for (const bp of byproducts) {
        const wh = bp.warehouse_id || production.output_warehouse_id;
        const baseQty = await resolveDualAwareBaseQty(tenantClient, bp.product_id, bp.qty, bp.uom_id, bp.alt_qty, bp.rate_basis);
        rows.push({ tenant_id: tenantId, product_id: bp.product_id, warehouse_id: wh, batch_no: bp.batch_no, movement_date: production.doc_date, qty_in: baseQty, qty_out: 0, unit_cost: Number(bp.qty) > 0 ? Number(bp.amount) / Number(bp.qty) : 0, source_type: 'production', source_id: production.id, source_detail_id: bp.id, narration: `Production ${production.doc_no} - by-product` });
    }
    if (rows.length > 0) {
        const { error } = await tenantClient.from('stock_movements').insert(rows);
        if (error) throw error;
    }
}

async function reverseProductionMovements(tenantClient, productionId) {
    await tenantClient.from('stock_movements').delete().eq('source_type', 'production').eq('source_id', productionId);
}

router.get('/production-orders', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('production_orders').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/production-orders/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('production_orders').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Production Order not found' });
        const { data: rawMaterials } = await tenantClient.from('production_raw_materials').select('*').eq('production_id', req.params.id).order('display_order');
        const { data: byproducts } = await tenantClient.from('production_byproducts').select('*').eq('production_id', req.params.id).order('display_order');
        data.raw_materials = rawMaterials || [];
        data.byproducts = byproducts || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/production-orders', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'production', req.body, isDraft);
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
                tenantId, voucherType: 'production', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'production_orders',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_production_code', type_prefix: 'PRD' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('production_orders')
            .insert({
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                output_product_id: b.output_product_id || null, output_qty: b.output_qty || 0, output_uom_id: b.output_uom_id || null,
                output_alt_qty: b.output_alt_qty || null, output_alt_unit_id: b.output_alt_unit_id || null, output_rate_basis: b.output_rate_basis || 'primary',
                output_batch_no: b.output_batch_no || null, output_mfg_date: b.output_mfg_date || null, output_exp_date: b.output_exp_date || null,
                output_relative_value: b.output_relative_value || 0,
                output_warehouse_id: b.output_warehouse_id || null, source_warehouse_id: b.source_warehouse_id || null, bom_template_id: b.bom_template_id || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const { totalRmCost, totalBpValue, mainOutputUnitCost } = await syncLines(tenantClient, tenantId, doc.id, b.raw_materials, b.byproducts, { qty: b.output_qty, relative_value: b.output_relative_value });
            await tenantClient.from('production_orders').update({ total_raw_material_cost: totalRmCost, total_byproduct_value: totalBpValue, output_unit_cost: mainOutputUnitCost }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('production_raw_materials').delete().eq('production_id', doc.id);
            await tenantClient.from('production_byproducts').delete().eq('production_id', doc.id);
            await tenantClient.from('production_orders').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save production lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_production_order', 'production_order', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'production_order', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Production Order ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/production-orders/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('production_orders').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Production Order not found' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} production order` });
        }

        const isDraft = b.status === 'draft' && b.save_as_draft === true;
        const validationError = validateBody(b, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'production', b, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'production', b, existing);

        const snapshots = await captureMasterSnapshots(tenantClient, { ...existing, ...b });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.raw_materials;
        delete update.byproducts;
        delete update.save_as_draft;

        const { data, error } = await tenantClient.from('production_orders').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.raw_materials || b.byproducts) {
            const { totalRmCost, totalBpValue, mainOutputUnitCost } = await syncLines(tenantClient, tenantId, req.params.id, b.raw_materials, b.byproducts, { qty: data.output_qty, relative_value: data.output_relative_value });
            await tenantClient.from('production_orders').update({ total_raw_material_cost: totalRmCost, total_byproduct_value: totalBpValue, output_unit_cost: mainOutputUnitCost }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_production_order', 'production_order', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'production_order', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/production-orders/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('production_orders').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Production Order not found' });
        if (existing.status === 'cancelled' || (existing.status === 'posted' && status === 'posted')) {
            return res.status(400).json({ success: false, error: `Cannot change a ${existing.status} production order` });
        }

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') { update.cancellation_reason = cancellation_reason; update.cancelled_at = new Date().toISOString(); update.cancelled_by = req.auth.userId; }
        if (status === 'posted') { update.posted_by = req.auth.userId; update.posted_at = new Date().toISOString(); }

        const { data, error } = await tenantClient.from('production_orders').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (status === 'posted' && existing.status !== 'posted') {
            const { data: rawMaterials } = await tenantClient.from('production_raw_materials').select('*').eq('production_id', req.params.id);
            const { data: byproducts } = await tenantClient.from('production_byproducts').select('*').eq('production_id', req.params.id);
            await postProductionMovements(tenantClient, tenantId, data, rawMaterials || [], byproducts || []);
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseProductionMovements(tenantClient, req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'change_production_status', 'production_order', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'production_order', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/production-orders/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('production_orders').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Production Order not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted order' });
        const { error } = await tenantClient.from('production_orders').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_production_order', 'production_order', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/production-orders/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'production_order').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
