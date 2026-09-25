// =============================================
// routes/bomTemplateRoutes.js
// A reusable recipe - Production Order pulls this forward and SCALES
// every line by (desired_output_qty / standard_output_qty), rather
// than the user re-typing the same raw material list every run.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

function validateBody(b) {
    if (!b.template_name) return 'Template Name is required';
    if (!b.output_product_id) return 'Output Product is required';
    if (!b.standard_output_qty || Number(b.standard_output_qty) <= 0) return 'Standard Output Qty greater than zero is required';
    if (!Array.isArray(b.raw_materials) || b.raw_materials.length === 0) return 'At least one Raw Material line is required';
    for (const r of b.raw_materials) {
        if (!r.product_id) return 'Every raw material line needs a Product';
        if (!r.qty || Number(r.qty) <= 0) return 'Every raw material line needs a Qty greater than zero';
    }
    return null;
}

async function captureLineSnapshot(tenantClient, product_id, uom_id) {
    const [prod, uom] = await Promise.all([
        product_id ? tenantClient.from('products').select('product_name').eq('id', product_id).maybeSingle() : Promise.resolve({ data: null }),
        uom_id ? tenantClient.from('product_units').select('unit_name').eq('id', uom_id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    return { product_name_snapshot: prod.data?.product_name || null, uom_name_snapshot: uom.data?.unit_name || null };
}

async function syncLines(tenantClient, tenantId, templateId, rawMaterials, byproducts) {
    await tenantClient.from('bom_template_raw_materials').delete().eq('template_id', templateId);
    await tenantClient.from('bom_template_byproducts').delete().eq('template_id', templateId);

    if (Array.isArray(rawMaterials) && rawMaterials.length > 0) {
        const rows = await Promise.all(rawMaterials.map(async (r, i) => {
            const snap = await captureLineSnapshot(tenantClient, r.product_id, r.uom_id);
            return { tenant_id: tenantId, template_id: templateId, display_order: i + 1, product_id: r.product_id, qty: Number(r.qty) || 0, uom_id: r.uom_id || null, process_name: r.process_name || null, ...snap };
        }));
        const { error } = await tenantClient.from('bom_template_raw_materials').insert(rows);
        if (error) throw error;
    }
    if (Array.isArray(byproducts) && byproducts.length > 0) {
        const rows = await Promise.all(byproducts.map(async (bp, i) => {
            const snap = await captureLineSnapshot(tenantClient, bp.product_id, bp.uom_id);
            return { tenant_id: tenantId, template_id: templateId, display_order: i + 1, product_id: bp.product_id, qty: Number(bp.qty) || 0, uom_id: bp.uom_id || null, allocation_basis: bp.allocation_basis || 'fixed_recovery', recovery_rate: Number(bp.recovery_rate) || 0, relative_value: Number(bp.relative_value) || 0, ...snap };
        }));
        const { error } = await tenantClient.from('bom_template_byproducts').insert(rows);
        if (error) throw error;
    }
}

router.get('/bom-templates', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('bom_templates').select('*').eq('tenant_id', req.auth.tenantId).order('template_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/bom-templates/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('bom_templates').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'BOM Template not found' });
        const { data: rawMaterials } = await tenantClient.from('bom_template_raw_materials').select('*').eq('template_id', req.params.id).order('display_order');
        const { data: byproducts } = await tenantClient.from('bom_template_byproducts').select('*').eq('template_id', req.params.id).order('display_order');
        data.raw_materials = rawMaterials || [];
        data.byproducts = byproducts || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/bom-templates/:id/scale', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const desiredQty = Number(req.query.output_qty);
        if (!desiredQty || desiredQty <= 0) return res.status(400).json({ success: false, error: 'output_qty is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: template, error } = await tenantClient.from('bom_templates').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'BOM Template not found' });
        const { data: rawMaterials } = await tenantClient.from('bom_template_raw_materials').select('*').eq('template_id', req.params.id).order('display_order');
        const { data: byproducts } = await tenantClient.from('bom_template_byproducts').select('*').eq('template_id', req.params.id).order('display_order');

        const factor = desiredQty / Number(template.standard_output_qty);
        const scale = (rows) => (rows || []).map(r => ({ ...r, qty: Math.round(Number(r.qty) * factor * 10000) / 10000 }));

        res.json({ success: true, data: { template, raw_materials: scale(rawMaterials), byproducts: scale(byproducts), scale_factor: factor } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/bom-templates', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const validationError = validateBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;

        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_bom_template_code', type_prefix: 'BOM' });
        if (codeErr) throw codeErr;

        const snap = await captureLineSnapshot(tenantClient, b.output_product_id, b.output_uom_id);

        const { data: doc, error } = await tenantClient
            .from('bom_templates')
            .insert({
                tenant_id: tenantId, template_code: codeRow, template_name: b.template_name, description: b.description || null,
                output_product_id: b.output_product_id, standard_output_qty: Number(b.standard_output_qty), output_uom_id: b.output_uom_id || null,
                output_relative_value: Number(b.output_relative_value) || 0,
                is_active: b.is_active !== false,
                output_product_name_snapshot: snap.product_name_snapshot, output_uom_name_snapshot: snap.uom_name_snapshot,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            await syncLines(tenantClient, tenantId, doc.id, b.raw_materials, b.byproducts);
        } catch (syncErr) {
            await tenantClient.from('bom_template_raw_materials').delete().eq('template_id', doc.id);
            await tenantClient.from('bom_template_byproducts').delete().eq('template_id', doc.id);
            await tenantClient.from('bom_templates').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save template lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_bom_template', 'bom_template', doc.id, { template_code: doc.template_code });
        res.json({ success: true, message: `BOM Template ${doc.template_code} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/bom-templates/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('bom_templates').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'BOM Template not found' });

        const validationError = validateBody(b);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const snap = await captureLineSnapshot(tenantClient, b.output_product_id, b.output_uom_id);
        const update = {
            template_name: b.template_name, description: b.description || null,
            output_product_id: b.output_product_id, standard_output_qty: Number(b.standard_output_qty), output_uom_id: b.output_uom_id || null,
            output_relative_value: Number(b.output_relative_value) || 0,
            is_active: b.is_active !== false,
            output_product_name_snapshot: snap.product_name_snapshot, output_uom_name_snapshot: snap.uom_name_snapshot,
            updated_by: req.auth.userId, updated_at: new Date().toISOString()
        };

        const { data, error } = await tenantClient.from('bom_templates').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        await syncLines(tenantClient, tenantId, req.params.id, b.raw_materials, b.byproducts);

        await logAudit(tenantId, req.auth.userId, 'update_bom_template', 'bom_template', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/bom-templates/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('bom_templates').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'BOM Template not found' });
        const { error } = await tenantClient.from('bom_templates').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_bom_template', 'bom_template', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'BOM Template deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
