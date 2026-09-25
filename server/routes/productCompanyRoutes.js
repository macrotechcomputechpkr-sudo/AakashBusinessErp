// =============================================
// routes/productCompanyRoutes.js
// "Product Company" = manufacturer/brand (e.g. Unilever, Samsung) -
// distinct from tenant_master.company_profile which is the TENANT's own
// company record. Carries defaults (vendor, area, product group, agent)
// that a future Products/Items module would inherit when tagging a
// product with this manufacturer.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/product-companies', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('product_companies')
            .select('*, default_vendor:default_vendor_id(account_name), default_area:default_area_id(area_name), default_product_group:default_product_group_id(group_name), default_agent:default_agent_id(agent_name), default_sub_ledger:default_sub_ledger_id(sub_ledger_name)')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('company_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/product-companies', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { company_name, default_vendor_id, default_area_id, default_product_group_id, default_agent_id, default_sub_ledger_id,
                print_barcode, allow_rate_change_on_mobile_order, description } = req.body;

        if (!company_name || !company_name.trim()) return res.status(400).json({ success: false, error: 'Company name is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        if (default_vendor_id) {
            const { data: vendor } = await tenantClient.from('ledger_accounts').select('id, category_type').eq('id', default_vendor_id).eq('tenant_id', tenantId).single();
            if (!vendor) return res.status(404).json({ success: false, error: 'Default vendor ledger account not found' });
            if (!['purchase', 'both'].includes(vendor.category_type)) {
                return res.status(400).json({ success: false, error: 'Default vendor must be a Purchase (or Both) category ledger account' });
            }
        }

        const prefix = company_name.trim().slice(0, 4).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_product_company_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('product_companies')
            .insert({
                tenant_id: tenantId,
                company_code: codeRow,
                company_name: company_name.trim(),
                default_vendor_id: default_vendor_id || null,
                default_area_id: default_area_id || null,
                default_product_group_id: default_product_group_id || null,
                default_agent_id: default_agent_id || null,
                default_sub_ledger_id: default_sub_ledger_id || null,
                print_barcode: print_barcode !== undefined ? !!print_barcode : true,
                allow_rate_change_on_mobile_order: !!allow_rate_change_on_mobile_order,
                description,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_product_company', 'product_company', data.id, { new_data: data });
        res.json({ success: true, message: 'Product company created successfully', data });
    } catch (error) {
        console.error('Create product company error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-companies/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('product_companies').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();

        if (req.body.default_vendor_id) {
            const { data: vendor } = await tenantClient.from('ledger_accounts').select('id, category_type').eq('id', req.body.default_vendor_id).eq('tenant_id', tenantId).single();
            if (!vendor) return res.status(404).json({ success: false, error: 'Default vendor ledger account not found' });
            if (!['purchase', 'both'].includes(vendor.category_type)) {
                return res.status(400).json({ success: false, error: 'Default vendor must be a Purchase (or Both) category ledger account' });
            }
        }

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        const { data, error } = await tenantClient
            .from('product_companies').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_product_company', 'product_company', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/product-companies/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('product_companies').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient
            .from('product_companies').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_product_company', 'product_company', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Product company deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
