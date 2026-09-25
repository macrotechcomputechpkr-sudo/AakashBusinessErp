// =============================================
// routes/designationRoutes.js
// Same fix rationale as departmentRoutes.js: brought over from the
// disconnected Flask service into Express, with atomic code generation
// and permission checks on write operations.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/designations', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('designations')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('hierarchy_level', { ascending: true });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/designations', requireAuth, loadUserPermissions, requirePermission('user_management', 'create'), async (req, res) => {
    try {
        const { designation_name, designation_short_name, description, hierarchy_level, default_department_id, grade } = req.body;
        if (!designation_name || !designation_name.trim()) {
            return res.status(400).json({ success: false, error: 'Designation name is required' });
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: dup } = await tenantClient
            .from('designations')
            .select('id')
            .eq('tenant_id', tenantId)
            .ilike('designation_name', designation_name.trim())
            .maybeSingle();
        if (dup) return res.status(409).json({ success: false, error: 'A designation with this name already exists' });

        const prefix = designation_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_designation_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('designations')
            .insert({
                tenant_id: tenantId,
                designation_code: codeRow,
                designation_name: designation_name.trim(),
                designation_short_name,
                description,
                hierarchy_level: hierarchy_level || 1,
                default_department_id: default_department_id || null,
                grade: grade || null,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_designation', 'designation', data.id, { new_data: data });
        res.json({ success: true, message: 'Designation created successfully', data });
    } catch (error) {
        console.error('Create designation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/designations/:id', requireAuth, loadUserPermissions, requirePermission('user_management', 'edit'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('designations').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { data, error } = await tenantClient
            .from('designations')
            .update({ ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId)
            .select()
            .single();
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_designation', 'designation', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/designations/:id', requireAuth, loadUserPermissions, requirePermission('user_management', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('designations').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { error } = await tenantClient
            .from('designations')
            .update({ is_active: false, updated_by: req.auth.userId })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'delete_designation', 'designation', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Designation deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
