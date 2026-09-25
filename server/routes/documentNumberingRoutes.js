// =============================================
// routes/documentNumberingRoutes.js
// CRUD for Document Numbering Categories - Manual/Auto, Global/Branch-
// wise/User-wise scope, Prefix/Suffix/Digit-count/Start-End/FY.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const VOUCHER_TYPES = [
    'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
    'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
    'journal', 'cash', 'bank', 'pdc', 'production',
    'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return', 'stock_transfer',
    'debit_note', 'credit_note', 'cash_bank_entry', 'sales_quotation', 'sales_nonsalable_return'
];

function validateBody(b) {
    if (!VOUCHER_TYPES.includes(b.voucher_type)) return 'Invalid voucher_type';
    if (!b.category_name || !b.category_name.trim()) return 'Category Name is required';
    if (!['manual', 'auto'].includes(b.numbering_mode)) return 'Invalid numbering_mode';
    if (!['global', 'branch_wise', 'user_wise'].includes(b.scope)) return 'Invalid scope';
    if (b.digit_count && (b.digit_count < 1 || b.digit_count > 12)) return 'Digit Count must be between 1 and 12';
    if (b.end_number && b.start_number && Number(b.end_number) < Number(b.start_number)) return 'End Number must be greater than or equal to Start Number';
    return null;
}

router.get('/document-numbering-categories', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient.from('document_numbering_categories').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('category_name');
        if (req.query.voucher_type) query = query.eq('voucher_type', req.query.voucher_type);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "login User, Branch maa jun jun DocumentNumbering set
// gareko xa tyo list show garne" - a transaction entry screen calls
// this (not the plain list above) to get exactly the categories this
// logged-in user is allowed to pick from for this voucher_type: every
// globally-scoped category (no branch/user restriction at all) PLUS
// any category explicitly scoped to their own branch or their own
// user id.
router.get('/document-numbering-categories/applicable', requireAuth, async (req, res) => {
    try {
        const { voucher_type } = req.query;
        if (!voucher_type) return res.status(400).json({ success: false, error: 'voucher_type is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: currentUser } = await tenantClient.from('users').select('default_branch_id').eq('id', req.auth.userId).maybeSingle();
        const branchId = currentUser?.default_branch_id || null;

        const { data: categories, error } = await tenantClient.from('document_numbering_categories').select('*').eq('tenant_id', tenantId).eq('voucher_type', voucher_type).eq('is_active', true).order('category_name');
        if (error) throw error;
        if (!categories || categories.length === 0) return res.json({ success: true, data: [] });

        const categoryIds = categories.map(c => c.id);
        const { data: scopes } = await tenantClient.from('document_numbering_category_scopes').select('category_id, branch_id, user_id').in('category_id', categoryIds);
        const scopedCategoryIds = new Set((scopes || []).map(s => s.category_id));

        const applicable = categories.filter(c => {
            if (!scopedCategoryIds.has(c.id)) return true;
            return (scopes || []).some(s => s.category_id === c.id && (s.branch_id === branchId || s.user_id === req.auth.userId));
        });

        res.json({ success: true, data: applicable });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/document-numbering-categories/:id/scopes', requireAuth, loadUserPermissions, requirePermission('company_settings', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_numbering_category_scopes').select('*, branch:branch_id(branch_name), scoped_user:user_id(full_name)')
            .eq('category_id', req.params.id).eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/document-numbering-categories/:id/scopes', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const { branch_ids, user_ids } = req.body;
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('document_numbering_categories').select('id').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
        if (!existing) return res.status(404).json({ success: false, error: 'Category not found' });

        await tenantClient.from('document_numbering_category_scopes').delete().eq('category_id', req.params.id).eq('tenant_id', tenantId);
        const rows = [
            ...(branch_ids || []).map(branch_id => ({ tenant_id: tenantId, category_id: req.params.id, branch_id, user_id: null })),
            ...(user_ids || []).map(user_id => ({ tenant_id: tenantId, category_id: req.params.id, branch_id: null, user_id }))
        ];
        if (rows.length > 0) {
            const { error } = await tenantClient.from('document_numbering_category_scopes').insert(rows);
            if (error) throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_numbering_category_scopes', 'document_numbering_category', req.params.id, { branch_ids, user_ids });
        res.json({ success: true, message: rows.length > 0 ? `Restricted to ${rows.length} branch/user assignment(s)` : 'Now globally available (no restriction)' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/document-numbering-categories', requireAuth, loadUserPermissions, requirePermission('company_settings', 'create'), async (req, res) => {
    try {
        const validationError = validateBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;

        // FEATURE: making this one "default" un-defaults whichever one
        // currently holds that spot for the same voucher_type - only one
        // default per voucher type, enforced here (matches the partial
        // unique index in the DB as a second line of defense).
        if (b.is_default) {
            await tenantClient.from('document_numbering_categories').update({ is_default: false }).eq('tenant_id', tenantId).eq('voucher_type', b.voucher_type).eq('is_default', true);
        }

        const { data, error } = await tenantClient
            .from('document_numbering_categories')
            .insert({
                tenant_id: tenantId, voucher_type: b.voucher_type, category_name: b.category_name.trim(),
                numbering_mode: b.numbering_mode || 'auto', scope: b.scope || 'global',
                prefix: b.prefix || '', suffix: b.suffix || '', digit_count: b.digit_count || 6,
                start_number: b.start_number || 1, end_number: b.end_number || null,
                include_fiscal_year: b.include_fiscal_year !== undefined ? !!b.include_fiscal_year : true,
                fy_digit_format: b.fy_digit_format || 'short',
                is_default: !!b.is_default,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A category with this name already exists for this voucher type' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the fields' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_numbering_category', 'document_numbering_category', data.id, { new_data: data });
        res.json({ success: true, message: 'Numbering category created', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/document-numbering-categories/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('document_numbering_categories').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Category not found' });

        const merged = { ...existing, ...req.body };
        const validationError = validateBody(merged);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        if (req.body.is_default) {
            await tenantClient.from('document_numbering_categories').update({ is_default: false }).eq('tenant_id', tenantId).eq('voucher_type', existing.voucher_type).eq('is_default', true).neq('id', req.params.id);
        }

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        const { data, error } = await tenantClient.from('document_numbering_categories').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A category with this name already exists for this voucher type' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_numbering_category', 'document_numbering_category', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/document-numbering-categories/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('document_numbering_categories').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient.from('document_numbering_categories').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_numbering_category', 'document_numbering_category', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Numbering category removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
