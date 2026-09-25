// =============================================
// routes/entryFieldControlRoutes.js
// Field-level entry control: for each (voucher type, field), a mode -
// Enabled / Disabled / Compulsory / ReadOnly - settable at Global,
// User Group, or User scope. Resolution priority when asking "what mode
// for THIS user": User-specific > User-Group-specific > Global.
//
// is_system_required fields (Party, Date, core amounts) can never be
// set to 'disabled' at any scope - that would make the voucher type
// physically impossible to complete, which is different from every
// other field this module protects being merely inconvenient to hide.
// =============================================

const express = require('express');
const { resolveFieldModes } = require('../utils/entryFieldRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const VOUCHER_TYPES = [
    'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
    'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
    'journal', 'cash', 'bank', 'pdc', 'production',
    'purchase_requisition', 'purchase_quotation'
];

router.get('/voucher-field-catalog', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient.from('voucher_field_catalog').select('*').order('section').order('display_order');
        if (req.query.voucher_type) query = query.eq('voucher_type', req.query.voucher_type);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/entry-field-controls', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient
            .from('entry_field_controls')
            .select('*, user_group:user_group_id(group_name)')
            .eq('tenant_id', req.auth.tenantId);
        if (req.query.voucher_type) query = query.eq('voucher_type', req.query.voucher_type);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: what an entry screen (once built) or this settings page's own
// "preview as" tool would call - resolves the EFFECTIVE mode for every
// field of a voucher type, for one specific user, applying User >
// User Group > Global priority.
router.get('/entry-field-controls/resolve', requireAuth, async (req, res) => {
    try {
        const { voucher_type } = req.query;
        if (!voucher_type) return res.status(400).json({ success: false, error: 'voucher_type is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        // FIX: entry screens only send voucher_type, so user / user-group
        // rules were never applied. Work out WHO is asking from the login
        // itself. A caller may pass user_id to PREVIEW another user's view
        // (the Entry Field Control page does), and that user's group is
        // then looked up server-side too - never trusted from the browser.
        const user_id = req.query.user_id || req.auth.userId;
        const { data: userRow } = await tenantClient.from('users').select('security_group_id').eq('id', user_id).maybeSingle();
        const user_group_id = req.query.user_id ? (userRow?.security_group_id || null) : (req.query.user_group_id || userRow?.security_group_id || null);

        const resolved = await resolveFieldModes(tenantClient, req.auth.tenantId, voucher_type, user_id, user_group_id);

        res.json({ success: true, data: resolved });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/entry-field-controls', requireAuth, loadUserPermissions, requirePermission('security', 'edit'), async (req, res) => {
    try {
        const { voucher_type, field_key, scope, user_group_id, user_id, mode } = req.body;
        if (!VOUCHER_TYPES.includes(voucher_type)) return res.status(400).json({ success: false, error: 'Invalid voucher_type' });
        if (!['global', 'user_group', 'user'].includes(scope)) return res.status(400).json({ success: false, error: 'Invalid scope' });
        if (!['enabled', 'disabled', 'compulsory', 'readonly'].includes(mode)) return res.status(400).json({ success: false, error: 'Invalid mode' });
        if (scope === 'user_group' && !user_group_id) return res.status(400).json({ success: false, error: 'user_group_id is required for scope=user_group' });
        if (scope === 'user' && !user_id) return res.status(400).json({ success: false, error: 'user_id is required for scope=user' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        // FIX: is_system_required fields can never be disabled - that's a
        // structural break of the voucher, not a mere inconvenience.
        // (a field_key can exist in BOTH master and detail sections, so read
        //  all rows - .single() used to error there and skip this check)
        const { data: fieldRows } = await tenantClient
            .from('voucher_field_catalog').select('is_system_required').eq('voucher_type', voucher_type).eq('field_key', field_key);
        if ((fieldRows || []).some(f => f.is_system_required) && mode === 'disabled') {
            return res.status(400).json({ success: false, error: `"${field_key}" is a required system field on this voucher type and cannot be disabled` });
        }

        // FIX: explicit find-then-update/insert. The old upsert relied on a
        // UNIQUE over nullable group/user columns, which never matched Global
        // rules (NULL <> NULL) and kept inserting duplicates.
        let findQ = tenantClient.from('entry_field_controls').select('id')
            .eq('tenant_id', tenantId).eq('voucher_type', voucher_type).eq('field_key', field_key).eq('scope', scope);
        if (scope === 'user_group') findQ = findQ.eq('user_group_id', user_group_id);
        if (scope === 'user') findQ = findQ.eq('user_id', user_id);
        const { data: existingRows } = await findQ.limit(1);
        const row = {
            tenant_id: tenantId, voucher_type, field_key, scope,
            user_group_id: scope === 'user_group' ? user_group_id : null,
            user_id: scope === 'user' ? user_id : null,
            mode, updated_by: req.auth.userId, updated_at: new Date().toISOString()
        };
        const { data, error } = existingRows && existingRows[0]
            ? await tenantClient.from('entry_field_controls').update(row).eq('id', existingRows[0].id).select().single()
            : await tenantClient.from('entry_field_controls').insert(row).select().single();
        if (error) throw error;

        await logAudit(tenantId, req.auth.userId, 'set_entry_field_control', 'entry_field_control', data.id, { new_data: data });
        res.json({ success: true, message: 'Field control saved', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/entry-field-controls/:id', requireAuth, loadUserPermissions, requirePermission('security', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('entry_field_controls').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient.from('entry_field_controls').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_entry_field_control', 'entry_field_control', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Override removed - reverts to the next applicable rule' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
