// =============================================
// routes/securityGroupRoutes.js
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { loadUserPermissions } = require('../utils/dbHelpers');

router.get('/security-groups', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('security_rights_groups')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('group_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/security-groups', requireAuth, loadUserPermissions, requirePermission('security_groups', 'create'), async (req, res) => {
    try {
        const { group_name, group_description, permissions } = req.body;
        if (!group_name || !group_name.trim()) {
            return res.status(400).json({ success: false, error: 'Group name is required' });
        }
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const group_code = group_name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 40) + '_' + Date.now().toString().slice(-4);

        const { data, error } = await tenantClient
            .from('security_rights_groups')
            .insert({
                tenant_id: tenantId,
                group_code,
                group_name: group_name.trim(),
                group_description,
                group_type: 'custom',
                permissions: permissions || undefined,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_security_group', 'security_group', data.id, { new_data: data });
        res.json({ success: true, message: 'Security group created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/security-groups/:id', requireAuth, loadUserPermissions, requirePermission('security_groups', 'edit'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient
            .from('security_rights_groups')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (existing?.is_system) {
            return res.status(400).json({ success: false, error: 'System security groups cannot be edited' });
        }
        const { data, error } = await tenantClient
            .from('security_rights_groups')
            .update({ ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId)
            .select()
            .single();
        if (error) throw error;
        // FIX: security group edits (especially permission changes) are
        // high-stakes - always audit-logged, with the full old/new
        // permissions JSON captured for traceability.
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_security_group', 'security_group', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/security-groups/:id', requireAuth, loadUserPermissions, requirePermission('security_groups', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient
            .from('security_rights_groups')
            .select('*')
            .eq('id', req.params.id)
            .eq('tenant_id', tenantId)
            .single();
        if (!existing) return res.status(404).json({ success: false, error: 'Security group not found' });
        if (existing.is_system) {
            return res.status(400).json({ success: false, error: 'System security groups cannot be deleted' });
        }
        // FEATURE: refuse to remove a group that users are still
        // assigned to - deleting it out from under them would silently
        // strip their permissions rather than give an obvious error.
        const { count: assignedUserCount } = await tenantClient
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('security_group_id', req.params.id);
        if (assignedUserCount > 0) {
            return res.status(400).json({ success: false, error: `Cannot delete - ${assignedUserCount} user(s) are still assigned to this group. Reassign them first.` });
        }
        const { error } = await tenantClient
            .from('security_rights_groups')
            .update({ is_active: false, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_security_group', 'security_group', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Security group removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
