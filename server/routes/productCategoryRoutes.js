// =============================================
// routes/productCategoryRoutes.js
// Exact mirror of ledgerCategoryRoutes.js - separate, optional,
// multi-select, tenant-renameable classification for Products.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/company/product-category-setting', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('company_profile').select('enable_custom_product_categories, custom_product_category_label').eq('tenant_id', req.auth.tenantId).single();
        if (error) throw error;
        res.json({ success: true, data: { enabled: !!data?.enable_custom_product_categories, label: data?.custom_product_category_label || 'Product Category' } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/company/product-category-setting', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const { enabled, label } = req.body;
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const update = { enable_custom_product_categories: !!enabled };
        if (label !== undefined && label.trim()) update.custom_product_category_label = label.trim();
        const { error } = await tenantClient.from('company_profile').update(update).eq('tenant_id', tenantId);
        if (error) throw error;

        // Same "seed 5 defaults on first enable" behaviour as Ledger Category.
        if (enabled) {
            const { error: seedErr } = await tenantClient.rpc('seed_default_product_categories', { p_tenant_id: tenantId });
            if (seedErr) console.error('seed_default_product_categories error:', seedErr);
        }

        await logAudit(tenantId, req.auth.userId, 'toggle_product_category_feature', 'company_setting', null, { enabled: !!enabled, label: update.custom_product_category_label });
        res.json({ success: true, message: `Custom product categories ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/product-categories', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('product_categories').select('*').eq('tenant_id', req.auth.tenantId).order('display_order');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/product-categories', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { category_name, description, display_order } = req.body;
        if (!category_name || !category_name.trim()) return res.status(400).json({ success: false, error: 'Category name is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = category_name.trim().slice(0, 4).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_product_category_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('product_categories')
            .insert({
                tenant_id: tenantId, category_code: codeRow, category_name: category_name.trim(),
                description, display_order: display_order || 1,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A category with this name already exists' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_product_category', 'product_category', data.id, { new_data: data });
        res.json({ success: true, message: 'Category created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-categories/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { category_name, description } = req.body;
        const update = { updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        if (category_name !== undefined) update.category_name = category_name;
        if (description !== undefined) update.description = description;

        const { data, error } = await tenantClient
            .from('product_categories').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A category with this name already exists' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_product_category', 'product_category', req.params.id, { new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/product-categories/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { error } = await tenantClient.from('product_categories').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_product_category', 'product_category', req.params.id, {});
        res.json({ success: true, message: 'Category deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
