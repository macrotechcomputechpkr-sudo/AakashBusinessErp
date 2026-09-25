// =============================================
// routes/ledgerCategoryRoutes.js
// IMPORTANT: this "Ledger Category" is a completely SEPARATE, optional,
// tenant-renameable classification - it has nothing to do with
// ledger_accounts.category_type (sales/purchase/both/cash/bank/others),
// which continues to drive Customer/Supplier/Cash/Bank logic exactly as
// before and is untouched by this file. This one is off by default -
// GET /company/ledger-category-setting tells the frontend whether to
// even show the feature; once enabled, a tenant can create/rename these
// custom categories, and picking one on the ledger form is OPTIONAL.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/company/ledger-category-setting', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('company_profile').select('enable_custom_ledger_categories, custom_ledger_category_label').eq('tenant_id', req.auth.tenantId).single();
        if (error) throw error;
        res.json({ success: true, data: { enabled: !!data?.enable_custom_ledger_categories, label: data?.custom_ledger_category_label || 'Ledger Category' } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/company/ledger-category-setting', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const { enabled, label } = req.body;
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const update = { enable_custom_ledger_categories: !!enabled };
        // FEATURE: the FEATURE'S OWN LABEL is renameable too, not just the
        // individual category values inside it - e.g. a tenant might want
        // to call this "Customer Segment" or "Business Type" instead of
        // the generic "Ledger Category", and have that show on the ledger
        // create form itself.
        if (label !== undefined && label.trim()) update.custom_ledger_category_label = label.trim();
        const { error } = await tenantClient
            .from('company_profile').update(update).eq('tenant_id', tenantId);
        if (error) throw error;

        // FEATURE: the first time a tenant enables this, seed 5 starter
        // categories (not an empty list) - the tenant can rename, remove,
        // or add to them afterward. Only seeds if there are truly zero
        // categories yet, so re-enabling later never duplicates them.
        if (enabled) {
            const { count } = await tenantClient.from('ledger_categories').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
            if (!count || count === 0) {
                const defaults = ['Regular', 'Wholesale', 'Corporate', 'VIP', 'Walk-in'];
                for (let i = 0; i < defaults.length; i++) {
                    const prefix = defaults[i].slice(0, 4).toUpperCase();
                    const { data: codeRow } = await tenantClient.rpc('next_ledger_category_code', { prefix });
                    await tenantClient.from('ledger_categories').insert({
                        tenant_id: tenantId, category_code: codeRow, category_name: defaults[i],
                        display_order: i + 1, created_by: req.auth.userId, updated_by: req.auth.userId
                    });
                }
            }
        }

        // FIX: a company-wide feature toggle is worth a record of who
        // flipped it and when.
        await logAudit(tenantId, req.auth.userId, 'toggle_ledger_category_feature', 'company_setting', null, { enabled: !!enabled, label: update.custom_ledger_category_label });
        res.json({ success: true, message: `Custom ledger categories ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/ledger-categories', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('ledger_categories').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('display_order');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/ledger-categories', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { category_name, description, display_order } = req.body;
        if (!category_name || !category_name.trim()) return res.status(400).json({ success: false, error: 'Category name is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = category_name.trim().slice(0, 4).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_ledger_category_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('ledger_categories')
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
        await logAudit(tenantId, req.auth.userId, 'create_ledger_category', 'ledger_category', data.id, { new_data: data });
        res.json({ success: true, message: 'Ledger category created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: renaming an existing category is a first-class action (the
// user's whole point is "enable it, then rename to fit how you think").
router.put('/ledger-categories/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('ledger_categories').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { category_name, description, display_order, is_active } = req.body;
        const update = { updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        if (category_name !== undefined) update.category_name = category_name.trim();
        if (description !== undefined) update.description = description;
        if (display_order !== undefined) update.display_order = display_order;
        if (is_active !== undefined) update.is_active = !!is_active;

        const { data, error } = await tenantClient
            .from('ledger_categories').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A category with this name already exists' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_ledger_category', 'ledger_category', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/ledger-categories/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('ledger_categories').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient
            .from('ledger_categories').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_ledger_category', 'ledger_category', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Ledger category deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
