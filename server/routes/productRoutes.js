// =============================================
// routes/productRoutes.js
// Product Master - the item catalog. Handles the product row itself
// plus three related pieces synced together on every create/update:
//   - product_unit_rates: the multi-unit table (each unit's own
//     conversion factor, rates, and barcode - Odoo Packaging pattern)
//   - product_category_links: the multi-select custom Product Category
//   - product_bom_lines: raw materials for Finished/Semi-Finished items
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit, checkTransactionUsage } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

function validateUnitRates(unitRates, baseUnitId) {
    if (!Array.isArray(unitRates) || unitRates.length === 0) {
        return 'At least one unit (the Base Unit) is required';
    }
    const baseRows = unitRates.filter(u => u.is_base_unit);
    if (baseRows.length !== 1) return 'Exactly one unit must be marked as the Base Unit';
    if (baseRows[0].unit_id !== baseUnitId) return "The unit marked as Base Unit must match the product's Base Unit field";
    const unitIds = unitRates.map(u => u.unit_id);
    if (new Set(unitIds).size !== unitIds.length) return 'Each unit can only appear once in the multi-unit table';
    return null;
}

async function syncUnitRates(tenantClient, tenantId, productId, unitRates) {
    await tenantClient.from('product_unit_rates').delete().eq('product_id', productId);
    const rows = unitRates.map(u => ({
        tenant_id: tenantId, product_id: productId, unit_id: u.unit_id,
        is_base_unit: !!u.is_base_unit, conversion_factor: u.conversion_factor || 1,
        purchase_rate: u.purchase_rate || 0, mrp: u.mrp || 0,
        sales_rate_sr1: u.sales_rate_sr1 || 0, sales_rate_sr2: u.sales_rate_sr2 || 0,
        sales_rate_sr3: u.sales_rate_sr3 || 0, sales_rate_sr4: u.sales_rate_sr4 || 0, sales_rate_sr5: u.sales_rate_sr5 || 0,
        rate_inclusive_of_tax: !!u.rate_inclusive_of_tax, last_purchase_rate: u.last_purchase_rate || 0,
        barcode: u.barcode || null,
        purchase_eligible: u.purchase_eligible !== undefined ? !!u.purchase_eligible : true,
        sales_eligible: u.sales_eligible !== undefined ? !!u.sales_eligible : true
    }));
    const { error } = await tenantClient.from('product_unit_rates').insert(rows);
    if (error) throw error;
}

async function syncCategoryLinks(tenantClient, tenantId, productId, categoryIds) {
    await tenantClient.from('product_category_links').delete().eq('product_id', productId);
    if (Array.isArray(categoryIds) && categoryIds.length > 0) {
        const rows = categoryIds.map(cid => ({ tenant_id: tenantId, product_id: productId, product_category_id: cid }));
        const { error } = await tenantClient.from('product_category_links').insert(rows);
        if (error) throw error;
    }
}

async function syncBomLines(tenantClient, tenantId, productId, bomLines) {
    await tenantClient.from('product_bom_lines').delete().eq('parent_product_id', productId);
    if (Array.isArray(bomLines) && bomLines.length > 0) {
        const rows = bomLines.map((b, i) => ({
            tenant_id: tenantId, parent_product_id: productId, component_product_id: b.component_product_id,
            quantity_required: b.quantity_required, unit_id: b.unit_id || null, display_order: i + 1,
            // FEATURE: "Allow Buy/Sales Rate Auto Change while [the] Rate
            // Of [this] Used Product Changed" - per component line, since
            // some raw materials should drive a rate recalculation and
            // others (e.g. a cheap packaging item) shouldn't.
            auto_recalculate_on_component_rate_change: !!b.auto_recalculate_on_component_rate_change
        }));
        const { error } = await tenantClient.from('product_bom_lines').insert(rows);
        if (error) throw error;
    }
}

// FEATURE: "Rack Location" - branch-wise AND warehouse-wise, since one
// warehouse can serve several branches (branch_warehouse_mapping is
// many-to-many). Replace-all sync, same pattern as every other
// sub-table here.
async function syncRackLocations(tenantClient, tenantId, productId, rackLocations) {
    await tenantClient.from('product_rack_locations').delete().eq('product_id', productId);
    if (Array.isArray(rackLocations) && rackLocations.length > 0) {
        const rows = rackLocations.map(r => ({
            tenant_id: tenantId, product_id: productId,
            branch_id: r.branch_id, warehouse_id: r.warehouse_id, rack_location: r.rack_location
        }));
        const { error } = await tenantClient.from('product_rack_locations').insert(rows);
        if (error) {
            if (error.code === '23505') throw new Error('Only one rack location can be set per Branch + Warehouse combination for this product');
            throw error;
        }
    }
}

// FEATURE: "Term Mapping" tab on Product - which Billing Terms apply to
// this product by DEFAULT for Sales and for Purchase, with an optional
// per-product rate override, matching the Product creation concept.
async function syncTermMappings(tenantClient, tenantId, productId, termMappings) {
    await tenantClient.from('product_term_mappings').delete().eq('product_id', productId);
    if (Array.isArray(termMappings) && termMappings.length > 0) {
        const rows = termMappings.map(m => ({
            tenant_id: tenantId, product_id: productId, category_type: m.category_type,
            billing_term_id: m.billing_term_id, is_enabled_by_default: m.is_enabled_by_default !== undefined ? !!m.is_enabled_by_default : true,
            override_percentage: m.override_percentage !== '' && m.override_percentage !== undefined ? m.override_percentage : null
        }));
        const { error } = await tenantClient.from('product_term_mappings').insert(rows);
        if (error) throw error;
    }
}

// FEATURE: recalculates a Finished/Semi-Finished product's own Base
// Unit purchase_rate as the sum of (component's Base Unit purchase_rate
// x quantity_required) across every BOM line flagged
// auto_recalculate_on_component_rate_change - callable whenever a
// component's rate changes (e.g. from the Rate Change utility, or a
// future Purchase entry) so the assembled item's cost stays current
// without a person manually re-typing it. Uses purchase_rate (not
// opening_rate) since that's the actual cost driver for a BOM rollup.
async function recalculateAssembledProductRate(tenantClient, tenantId, parentProductId) {
    const { data: lines } = await tenantClient
        .from('product_bom_lines')
        .select('quantity_required, component_product_id')
        .eq('parent_product_id', parentProductId).eq('auto_recalculate_on_component_rate_change', true);
    if (!lines || lines.length === 0) return null;

    let newRate = 0;
    for (const line of lines) {
        const { data: baseUnitRate } = await tenantClient
            .from('product_unit_rates').select('purchase_rate').eq('product_id', line.component_product_id).eq('is_base_unit', true).maybeSingle();
        newRate += (Number(baseUnitRate?.purchase_rate) || 0) * (Number(line.quantity_required) || 0);
    }

    const { data: parentBaseUnit } = await tenantClient
        .from('product_unit_rates').select('id').eq('product_id', parentProductId).eq('is_base_unit', true).maybeSingle();
    if (parentBaseUnit) {
        await tenantClient.from('product_unit_rates').update({ purchase_rate: newRate }).eq('id', parentBaseUnit.id).eq('tenant_id', tenantId);
    }
    return newRate;
}

router.get('/products', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('products')
            .select(`*,
                product_groups(group_name),
                product_companies(company_name),
                base_unit:base_unit_id(unit_name, unit_symbol),
                product_unit_rates(*),
                product_category_links(product_category_id),
                product_rack_locations(id, branch_id, warehouse_id, rack_location, branches(branch_name), warehouses(warehouse_name)),
                product_term_mappings(id, category_type, billing_term_id, is_enabled_by_default, override_percentage)
            `)
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('product_name');
        if (error) throw error;

        const withCategoryIds = (data || []).map(row => ({
            ...row,
            product_category_ids: (row.product_category_links || []).map(l => l.product_category_id)
        }));
        res.json({ success: true, data: withCategoryIds });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/products', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const b = req.body;
        if (!b.product_name || !b.product_name.trim()) return res.status(400).json({ success: false, error: 'Product Name is required' });
        if (!b.base_unit_id) return res.status(400).json({ success: false, error: 'Base Unit is required' });

        const unitError = validateUnitRates(b.unit_rates, b.base_unit_id);
        if (unitError) return res.status(400).json({ success: false, error: unitError });

        if (['production', 'assembly'].includes(b.replenishment_method) && !['semi_finished', 'finished_good'].includes(b.item_type)) {
            return res.status(400).json({ success: false, error: `Replenishment Method "${b.replenishment_method === 'production' ? 'Production' : 'Assembly'}" requires Item Type to be Semi-Finished or Finished Good` });
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = b.product_name.trim().slice(0, 4).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_product_code', { prefix });
        if (codeErr) throw codeErr;

        const { data: product, error } = await tenantClient
            .from('products')
            .insert({
                tenant_id: tenantId,
                product_code: codeRow,
                product_name: b.product_name.trim(),
                short_name: b.short_name || null,
                item_type: b.item_type || 'trading_item',
                product_group_id: b.product_group_id || null,
                product_company_id: b.product_company_id || null,
                hs_code: b.hs_code || null,
                image_url: b.image_url || null,
                is_blocked: !!b.is_blocked,
                tags: b.tags || [],
                sales_account_ledger_id: b.sales_account_ledger_id || null,
                purchase_account_ledger_id: b.purchase_account_ledger_id || null,
                sales_sub_ledger_id: b.sales_sub_ledger_id || null,
                purchase_sub_ledger_id: b.purchase_sub_ledger_id || null,
                inventory_account_ledger_id: b.inventory_account_ledger_id || null,
                cogs_account_ledger_id: b.cogs_account_ledger_id || null,
                discount_account_ledger_id: b.discount_account_ledger_id || null,
                base_unit_id: b.base_unit_id,
                uom_mode: b.uom_mode || 'single', dual_uom_primary_unit_id: b.dual_uom_primary_unit_id || null,
                default_discount_percent: b.default_discount_percent || 0,
                default_vendor_id: b.default_vendor_id || null,
                vendor_item_code: b.vendor_item_code || null,
                lead_time_days: b.lead_time_days || 0,
                opening_qty: b.opening_qty || 0,
                opening_rate: b.opening_rate || 0,
                opening_value: (b.opening_qty || 0) * (b.opening_rate || 0),
                minimum_stock: b.minimum_stock || 0,
                maximum_stock: b.maximum_stock || 0,
                reorder_qty: b.reorder_qty || 0,
                allow_negative_stock: b.allow_negative_stock === undefined ? null : !!b.allow_negative_stock,
                costing_method: b.costing_method || 'average',
                maintain_batch: !!b.maintain_batch,
                track_expiry: !!b.track_expiry,
                track_mfg_date: !!b.track_mfg_date,
                track_serial_number: !!b.track_serial_number,
                is_vehicle_linked: !!b.is_vehicle_linked,
                free_qty_eligible: !!b.free_qty_eligible,
                replenishment_method: b.replenishment_method || 'purchase',
                routing_reference: b.routing_reference || null,
                scrap_percent: b.scrap_percent || 0,
                costing_approach: b.costing_approach || 'standard',
                overhead_absorption_basis: b.overhead_absorption_basis || null,
                overhead_absorption_rate: b.overhead_absorption_rate || 0,
                standard_labour_rate: b.standard_labour_rate || 0,
                weight: b.weight || null,
                weight_unit: b.weight_unit || null,
                dimensions: b.dimensions || null,
                vat_applicable: b.vat_applicable !== undefined ? !!b.vat_applicable : true,
                excise_applicable: !!b.excise_applicable,
                display_order: b.display_order || 1,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                if (error.message?.includes('barcode')) return res.status(409).json({ success: false, error: 'One of the barcodes is already used by another product' });
                return res.status(409).json({ success: false, error: 'A product with this name already exists' });
            }
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the product fields' });
            throw error;
        }

        try {
            await syncUnitRates(tenantClient, tenantId, product.id, b.unit_rates);
            await syncCategoryLinks(tenantClient, tenantId, product.id, b.product_category_ids);
            await syncBomLines(tenantClient, tenantId, product.id, b.bom_lines);
            await syncRackLocations(tenantClient, tenantId, product.id, b.rack_locations);
            await syncTermMappings(tenantClient, tenantId, product.id, b.term_mappings);
        } catch (syncErr) {
            // Roll back the product row if any related sync fails, so we
            // never leave a half-created product behind.
            await tenantClient.from('products').delete().eq('id', product.id);
            if (syncErr.code === '23505' && syncErr.message?.includes('barcode')) {
                return res.status(409).json({ success: false, error: 'One of the barcodes is already used by another product' });
            }
            throw syncErr;
        }

        await logAudit(tenantId, req.auth.userId, 'create_product', 'product', product.id, { new_data: product });
        res.json({ success: true, message: 'Product created successfully', data: product });
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/products/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('products').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Product not found' });

        const b = req.body;
        const merged = { ...existing, ...b };

        if (b.unit_rates) {
            const unitError = validateUnitRates(b.unit_rates, merged.base_unit_id);
            if (unitError) return res.status(400).json({ success: false, error: unitError });
        }
        if (['production', 'assembly'].includes(merged.replenishment_method) && !['semi_finished', 'finished_good'].includes(merged.item_type)) {
            return res.status(400).json({ success: false, error: `Replenishment Method "${merged.replenishment_method === 'production' ? 'Production' : 'Assembly'}" requires Item Type to be Semi-Finished or Finished Good` });
        }

        const update = { ...b, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.unit_rates;
        delete update.product_category_ids;
        delete update.bom_lines;
        delete update.rack_locations;
        delete update.term_mappings;
        delete update.product_unit_rates;
        delete update.product_category_links;
        delete update.product_groups;
        delete update.product_companies;
        delete update.base_unit;

        const { data, error } = await tenantClient
            .from('products').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A product with this name already exists' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the product fields' });
            throw error;
        }

        if (b.unit_rates) await syncUnitRates(tenantClient, tenantId, req.params.id, b.unit_rates);
        if (b.product_category_ids !== undefined) await syncCategoryLinks(tenantClient, tenantId, req.params.id, b.product_category_ids);
        if (b.bom_lines !== undefined) await syncBomLines(tenantClient, tenantId, req.params.id, b.bom_lines);
        if (b.rack_locations !== undefined) await syncRackLocations(tenantClient, tenantId, req.params.id, b.rack_locations);
        if (b.term_mappings !== undefined) await syncTermMappings(tenantClient, tenantId, req.params.id, b.term_mappings);

        await logAudit(tenantId, req.auth.userId, 'update_product', 'product', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/products/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('products').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient.from('products').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_product', 'product', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Product deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "Remove option - if used somewhere, say which document,
// don't delete" - permanent delete, only allowed when nothing
// references this product anywhere in the purchase transaction chain.
router.delete('/products/:id/permanent', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('products').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Product not found' });

        const usage = await checkTransactionUsage(tenantClient, tenantId, req.params.id, [
            { detailTable: 'purchase_requisition_details', parentTable: 'purchase_requisitions', column: 'product_id', label: 'Purchase Requisition' }
        ]);
        if (usage.used) {
            return res.status(409).json({ success: false, error: `Cannot delete - used in ${usage.label}: ${usage.docNos.join(', ')}${usage.docNos.length === 5 ? ' (and possibly more)' : ''}` });
        }

        const { error } = await tenantClient.from('products').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) {
            if (error.code === '23503') return res.status(409).json({ success: false, error: 'Cannot delete - this product is still referenced elsewhere' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'permanent_delete_product', 'product', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Product permanently deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
module.exports.recalculateAssembledProductRate = recalculateAssembledProductRate;
