// =============================================
// routes/productUnitRoutes.js
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/product-units', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('product_units').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('display_order');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/product-units', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { unit_name, unit_symbol, unit_type, display_order } = req.body;
        if (!unit_name || !unit_name.trim()) return res.status(400).json({ success: false, error: 'Unit Name is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = unit_name.trim().slice(0, 3).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_product_unit_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('product_units')
            .insert({
                tenant_id: tenantId, unit_code: codeRow, unit_name: unit_name.trim(),
                unit_symbol, unit_type: unit_type || 'simple', display_order: display_order || 1,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A unit with this name already exists' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_product_unit', 'product_unit', data.id, { new_data: data });
        res.json({ success: true, message: 'Unit created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-units/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('product_units').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Unit not found' });

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        const { data, error } = await tenantClient
            .from('product_units').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A unit with this name already exists' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_product_unit', 'product_unit', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/product-units/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('product_units').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient.from('product_units').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_product_unit', 'product_unit', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Unit deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
