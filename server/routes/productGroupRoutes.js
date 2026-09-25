// =============================================
// routes/productGroupRoutes.js
// Product Group is preparatory master data for a future Products/Items
// module. Mirrors the Area hierarchy pattern (optional parent group,
// tree endpoint) plus type-driven conditional fields:
//   - product_type = 'asset'   -> depreciation_method + depreciation_rate required
//   - default_discount_percentage != 0 -> billing_term_id required
//     (Billing Term module doesn't exist yet - this field is accepted and
//     stored as a plain UUID for now; validation only checks it's present,
//     not that it resolves to a real row, until that module is built.)
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/product-groups', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('product_groups')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('display_order');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/product-groups/tree', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('product_groups')
            .select('id, group_code, group_name, product_type, parent_group_id')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('display_order');
        if (error) throw error;

        const buildTree = (items, parentId = null) =>
            items.filter(i => (i.parent_group_id || null) === parentId)
                 .map(i => ({ ...i, children: buildTree(items, i.id) }));

        res.json({ success: true, data: buildTree(data, null) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

function validateProductGroupBody(body) {
    const { product_type, depreciation_method, depreciation_rate, default_discount_percentage, billing_term_id, is_branch_wise, branch_id } = body;

    if (!product_type || !['asset', 'service', 'inventory'].includes(product_type)) {
        return 'product_type must be one of: asset, service, inventory';
    }
    if (product_type === 'asset') {
        if (!depreciation_method) return 'Depreciation method is required for an Asset product group';
        if (depreciation_rate === undefined || depreciation_rate === null || depreciation_rate === '') {
            return 'Depreciation rate is required for an Asset product group';
        }
    }
    const discount = Number(default_discount_percentage) || 0;
    if (discount !== 0 && !billing_term_id) {
        return 'A non-zero default discount requires a billing term to be selected';
    }
    if (is_branch_wise && !branch_id) {
        return 'A Branch is required when this group is Branch Wise';
    }
    return null;
}

router.post('/product-groups', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { group_name, parent_group_id, product_type, depreciation_method, depreciation_rate,
                default_discount_percentage, default_profit_margin_percentage, billing_term_id,
                print_barcode, allow_rate_change_on_mobile_order, description, display_order,
                is_branch_wise, branch_id } = req.body;

        if (!group_name || !group_name.trim()) return res.status(400).json({ success: false, error: 'Group name is required' });
        const validationError = validateProductGroupBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        if (parent_group_id) {
            const { data: parent } = await tenantClient.from('product_groups').select('id').eq('id', parent_group_id).eq('tenant_id', tenantId).single();
            if (!parent) return res.status(404).json({ success: false, error: 'Parent product group not found' });
        }

        const prefix = group_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_product_group_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('product_groups')
            .insert({
                tenant_id: tenantId,
                group_code: codeRow,
                group_name: group_name.trim(),
                parent_group_id: parent_group_id || null,
                product_type,
                depreciation_method: product_type === 'asset' ? depreciation_method : null,
                depreciation_rate: product_type === 'asset' ? depreciation_rate : null,
                default_discount_percentage: default_discount_percentage || 0,
                default_profit_margin_percentage: default_profit_margin_percentage || 0,
                billing_term_id: (Number(default_discount_percentage) || 0) !== 0 ? billing_term_id : null,
                print_barcode: print_barcode !== undefined ? !!print_barcode : true,
                allow_rate_change_on_mobile_order: !!allow_rate_change_on_mobile_order,
                is_branch_wise: !!is_branch_wise,
                branch_id: is_branch_wise ? branch_id : null,
                description,
                display_order: display_order || 1,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_product_group', 'product_group', data.id, { new_data: data });
        res.json({ success: true, message: 'Product group created successfully', data });
    } catch (error) {
        console.error('Create product group error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-groups/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('product_groups').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Product group not found' });
        if (existing.is_system) return res.status(403).json({ success: false, error: 'Cannot modify a system product group' });

        if (req.body.parent_group_id === req.params.id) {
            return res.status(400).json({ success: false, error: 'A group cannot be its own parent' });
        }

        const merged = { ...existing, ...req.body };
        const validationError = validateProductGroupBody(merged);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const update = {
            ...req.body,
            depreciation_method: merged.product_type === 'asset' ? merged.depreciation_method : null,
            depreciation_rate: merged.product_type === 'asset' ? merged.depreciation_rate : null,
            billing_term_id: (Number(merged.default_discount_percentage) || 0) !== 0 ? merged.billing_term_id : null,
            branch_id: merged.is_branch_wise ? merged.branch_id : null,
            updated_by: req.auth.userId,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await tenantClient
            .from('product_groups').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_product_group', 'product_group', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/product-groups/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('product_groups').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Product group not found' });
        if (existing.is_system) return res.status(403).json({ success: false, error: 'Cannot delete a system product group' });

        const { data: children } = await tenantClient.from('product_groups').select('id').eq('parent_group_id', req.params.id);
        if (children && children.length > 0) return res.status(400).json({ success: false, error: 'Cannot delete a group that has sub-groups' });

        const { error } = await tenantClient.from('product_groups').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_product_group', 'product_group', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Product group deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
