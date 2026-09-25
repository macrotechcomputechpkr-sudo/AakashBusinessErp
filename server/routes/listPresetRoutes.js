// =============================================
// routes/listPresetRoutes.js
// Powers the popup picker's "save this column setup as a named preset"
// feature. Visibility is resolved server-side (never trust the client to
// filter which presets it's allowed to see):
//   scope='all'                                  -> visible to everyone
//   scope='me'       AND owner_user_id = caller   -> visible to owner only
//   scope='selected' AND caller IN allowed_user_ids -> visible to that list
// Creating an 'all' or 'selected' (shared) preset requires the
// company_settings.edit permission, since it changes what OTHER users see;
// anyone can save a personal ('me') preset.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth } = require('../middleware/auth');

router.get('/list-presets', requireAuth, async (req, res) => {
    try {
        const { list_key } = req.query;
        if (!list_key) return res.status(400).json({ success: false, error: 'list_key is required' });

        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('list_view_presets')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('list_key', list_key)
            .order('preset_name');
        if (error) throw error;

        // FIX/NOTE: filtering visibility here in JS (rather than a complex
        // PostgREST OR filter string) keeps the logic easy to verify and
        // avoids relying on exotic filter syntax for a security-relevant check.
        const visible = (data || []).filter(p =>
            p.scope === 'all' ||
            (p.scope === 'me' && p.owner_user_id === req.auth.userId) ||
            (p.scope === 'selected' && (p.allowed_user_ids || []).includes(req.auth.userId))
        );

        res.json({ success: true, data: visible });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/list-presets', requireAuth, loadUserPermissions, async (req, res) => {
    try {
        const { list_key, preset_name, columns, scope, allowed_user_ids, is_default } = req.body;
        if (!list_key || !preset_name || !Array.isArray(columns)) {
            return res.status(400).json({ success: false, error: 'list_key, preset_name and columns[] are required' });
        }
        const finalScope = scope || 'me';
        if (finalScope !== 'me' && !req.auth.isSuperAdmin) {
            const perms = req.userPermissions || {};
            if (!perms.company_settings || !perms.company_settings.edit) {
                return res.status(403).json({ success: false, error: 'Only users with company settings permission can create shared presets' });
            }
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data, error } = await tenantClient
            .from('list_view_presets')
            .insert({
                tenant_id: tenantId,
                list_key,
                preset_name: preset_name.trim(),
                columns,
                scope: finalScope,
                owner_user_id: finalScope === 'me' ? req.auth.userId : null,
                allowed_user_ids: finalScope === 'selected' ? (allowed_user_ids || []) : [],
                is_default: !!is_default,
                created_by: req.auth.userId
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A preset with this name already exists for this list' });
            throw error;
        }
        // FEATURE: only audit shared presets (all/selected) - a personal
        // ('me') preset is a private preference, not worth an audit trail
        // entry, but a shared one changes what OTHER users see.
        if (finalScope !== 'me') {
            await logAudit(tenantId, req.auth.userId, 'create_shared_list_preset', 'list_view_preset', data.id, { list_key, preset_name: data.preset_name, scope: finalScope });
        }
        res.json({ success: true, message: 'Preset saved', data });
    } catch (error) {
        console.error('Save preset error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/list-presets/:id', requireAuth, loadUserPermissions, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('list_view_presets').select('*').eq('id', req.params.id).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Preset not found' });

        const isOwner = existing.owner_user_id === req.auth.userId;
        const perms = req.userPermissions || {};
        const canEditShared = req.auth.isSuperAdmin || (perms.company_settings && perms.company_settings.edit);
        if (existing.scope === 'me' && !isOwner) {
            return res.status(403).json({ success: false, error: 'You can only edit your own personal presets' });
        }
        if (existing.scope !== 'me' && !canEditShared) {
            return res.status(403).json({ success: false, error: 'Only users with company settings permission can edit shared presets' });
        }

        const { columns, preset_name, is_default, allowed_user_ids } = req.body;
        const update = { updated_at: new Date().toISOString() };
        if (columns !== undefined) update.columns = columns;
        if (preset_name !== undefined) update.preset_name = preset_name.trim();
        if (is_default !== undefined) update.is_default = !!is_default;
        if (allowed_user_ids !== undefined && existing.scope === 'selected') update.allowed_user_ids = allowed_user_ids;

        const { data, error } = await tenantClient
            .from('list_view_presets').update(update).eq('id', req.params.id).select().single();
        if (error) throw error;
        if (existing.scope !== 'me') {
            await logAudit(req.auth.tenantId, req.auth.userId, 'update_shared_list_preset', 'list_view_preset', req.params.id, { old_data: existing, new_data: data });
        }
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/list-presets/:id', requireAuth, loadUserPermissions, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('list_view_presets').select('*').eq('id', req.params.id).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Preset not found' });

        const isOwner = existing.owner_user_id === req.auth.userId;
        const perms = req.userPermissions || {};
        const canEditShared = req.auth.isSuperAdmin || (perms.company_settings && perms.company_settings.edit);
        if (existing.scope === 'me' && !isOwner) {
            return res.status(403).json({ success: false, error: 'You can only delete your own personal presets' });
        }
        if (existing.scope !== 'me' && !canEditShared) {
            return res.status(403).json({ success: false, error: 'Only users with company settings permission can delete shared presets' });
        }

        const { error } = await tenantClient.from('list_view_presets').delete().eq('id', req.params.id);
        if (error) throw error;
        if (existing.scope !== 'me') {
            await logAudit(req.auth.tenantId, req.auth.userId, 'delete_shared_list_preset', 'list_view_preset', req.params.id, { old_data: existing });
        }
        res.json({ success: true, message: 'Preset deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
