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

// every voucher type the catalog allows (database CHECK on voucher_field_catalog)
const VOUCHER_TYPE_LABELS = {
    sales_quotation: 'Sales Quotation', sales_order: 'Sales Order', sales_delivery: 'Sales Delivery / Challan', sales_bill: 'Sales Bill',
    sales_return: 'Sales Return', sales_nonsalable_return: 'Sales Non-saleable Return', sales_additional: 'Sales Additional Expense',
    purchase_requisition: 'Purchase Requisition', purchase_quotation: 'Purchase Quotation', purchase_order: 'Purchase Order', purchase_grn: 'Purchase GRN',
    purchase_bill: 'Purchase Bill', purchase_return: 'Purchase Return', purchase_nonsalable_return: 'Purchase Non-saleable Return', purchase_additional: 'Purchase Additional Expense',
    cash_bank_entry: 'Cash / Bank Receipt & Payment', journal: 'Journal Voucher', cash: 'Cash Voucher', bank: 'Bank Voucher', pdc: 'PDC (Post-Dated Cheque)',
    debit_note: 'Debit Note', credit_note: 'Credit Note', stock_transfer: 'Stock Transfer', production: 'Production Entry'
};
const VOUCHER_TYPES = Object.keys(VOUCHER_TYPE_LABELS);
const MODES = ['enabled', 'disabled', 'compulsory', 'readonly'];
const FIELD_KEY = /^[a-z][a-z0-9_]{0,59}$/;
const labelOf = k => k.replace(/_id$/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

router.get('/voucher-types', requireAuth, (req, res) => res.json({ success: true, data: VOUCHER_TYPES.map(v => ({ value: v, label: VOUCHER_TYPE_LABELS[v] })) }));

// Entry screens report the fields they show; any not yet in the catalog are
// added, so Entry Field Control always lists what the screen really has.
router.post('/voucher-field-catalog/register', requireAuth, async (req, res) => {
    try {
        const { voucher_type: vt, fields } = req.body || {};
        if (!VOUCHER_TYPES.includes(vt)) return res.status(400).json({ success: false, error: 'Invalid voucher_type' });
        const list = (Array.isArray(fields) ? fields : []).slice(0, 120)
            .map(f => (typeof f === 'string' ? { key: f } : f || {}))
            .filter(f => FIELD_KEY.test(f.key || '') && ['master', 'detail', undefined].includes(f.section));
        if (!list.length) return res.json({ success: true, data: { added: 0 } });
        const c = await getTenantClient(req.auth.tenantId);
        const { data: have, error } = await c.from('voucher_field_catalog').select('section, field_key').eq('voucher_type', vt);
        if (error) throw error;
        const known = new Set((have || []).map(h => `${h.section}:${h.field_key}`));
        const rows = [];
        list.forEach((f, i) => {
            const section = f.section || 'master';
            if (known.has(`${section}:${f.key}`)) return;
            known.add(`${section}:${f.key}`);
            rows.push({ voucher_type: vt, section, field_key: f.key, field_label: String(f.label || labelOf(f.key)).slice(0, 100), field_data_type: 'text', is_system_required: false, display_order: 500 + i, auto_added: true });
        });
        if (rows.length) {
            const { error: e2 } = await c.from('voucher_field_catalog').insert(rows);
            if (e2 && e2.code !== '23505') throw e2; // another screen added them at the same moment
        }
        res.json({ success: true, data: { added: rows.length } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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

// Save a whole screen of modes at once for one scope (Global / a User Group /
// a User). modes: { field_key: 'enabled'|'disabled'|'compulsory'|'readonly'|null }
// null (or 'inherit') removes that scope's rule, so the next level applies.
router.put('/entry-field-controls/bulk', requireAuth, loadUserPermissions, requirePermission('security', 'edit'), async (req, res) => {
    try {
        const { voucher_type: vt, scope, user_group_id: groupId, user_id: userId, modes } = req.body || {};
        if (!VOUCHER_TYPES.includes(vt)) return res.status(400).json({ success: false, error: 'Invalid voucher_type' });
        if (!['global', 'user_group', 'user'].includes(scope)) return res.status(400).json({ success: false, error: 'Invalid scope' });
        if (scope === 'user_group' && !groupId) return res.status(400).json({ success: false, error: 'Pick a User Group' });
        if (scope === 'user' && !userId) return res.status(400).json({ success: false, error: 'Pick a User' });
        if (!modes || typeof modes !== 'object') return res.status(400).json({ success: false, error: 'modes is required' });
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const { data: catalog } = await c.from('voucher_field_catalog').select('field_key, field_label, is_system_required').eq('voucher_type', vt);
        const byKey = {};
        (catalog || []).forEach(f => { byKey[f.field_key] = byKey[f.field_key] || f; if (f.is_system_required) byKey[f.field_key] = f; });
        const entries = Object.entries(modes);
        for (const [key, raw] of entries) {
            const mode = raw === 'inherit' ? null : raw;
            if (!byKey[key]) return res.status(400).json({ success: false, error: `Unknown field "${key}"` });
            if (mode !== null && !MODES.includes(mode)) return res.status(400).json({ success: false, error: `Invalid mode for "${key}"` });
            if (mode === 'disabled' && byKey[key].is_system_required) return res.status(400).json({ success: false, error: `"${byKey[key].field_label}" is a required system field and cannot be hidden` });
        }
        let q = c.from('entry_field_controls').select('*').eq('tenant_id', t).eq('voucher_type', vt).eq('scope', scope);
        if (scope === 'user_group') q = q.eq('user_group_id', groupId);
        if (scope === 'user') q = q.eq('user_id', userId);
        const { data: existing, error } = await q;
        if (error) throw error;
        const have = Object.fromEntries((existing || []).map(r => [r.field_key, r]));
        let saved = 0, removed = 0;
        for (const [key, raw] of entries) {
            const mode = raw === 'inherit' ? null : raw;
            const cur = have[key];
            // Global "enabled" is the default - no row needed
            const wanted = scope === 'global' && mode === 'enabled' ? null : mode;
            if (wanted === null) {
                if (cur) { const { error: e } = await c.from('entry_field_controls').delete().eq('id', cur.id); if (e) throw e; removed++; }
            } else if (!cur || cur.mode !== wanted) {
                const row = { tenant_id: t, voucher_type: vt, field_key: key, scope, user_group_id: scope === 'user_group' ? groupId : null, user_id: scope === 'user' ? userId : null,
                    mode: wanted, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
                const { error: e } = cur ? await c.from('entry_field_controls').update(row).eq('id', cur.id) : await c.from('entry_field_controls').insert(row);
                if (e) throw e;
                saved++;
            }
        }
        await logAudit(t, req.auth.userId, 'set_entry_field_controls', 'entry_field_control', null, { voucher_type: vt, scope, user_group_id: groupId || null, user_id: userId || null, saved, removed });
        res.json({ success: true, data: { saved, removed } });
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
module.exports.VOUCHER_TYPES = VOUCHER_TYPES;
