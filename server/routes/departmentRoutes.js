// =============================================
// routes/departmentRoutes.js
// FIX: previously this logic only existed in a separate Python/Flask
// service that can't run in the same process as the Node server. Rewritten
// here in Express so "Add New Department" from the frontend modal
// actually persists to the database instead of only living in browser memory.
// Also uses the atomic tenant_master.next_department_code() DB function
// instead of "read last row, add 1" (which could double-assign codes under
// concurrent requests). GET is open to any authenticated tenant user
// (needed to populate dropdowns everywhere); create/edit/delete require
// the user_management permission, matching where this master data is
// managed in the UI.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/departments', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('departments')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('display_order', { ascending: true })
            .order('department_name', { ascending: true });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/departments', requireAuth, loadUserPermissions, requirePermission('user_management', 'create'), async (req, res) => {
    try {
        const { department_name, department_short_name, department_head, department_head_phone,
                department_head_email, description, parent_department_id, cost_center_code } = req.body;

        if (!department_name || !department_name.trim()) {
            return res.status(400).json({ success: false, error: 'Department name is required' });
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: dup } = await tenantClient
            .from('departments')
            .select('id')
            .eq('tenant_id', tenantId)
            .ilike('department_name', department_name.trim())
            .maybeSingle();
        if (dup) return res.status(409).json({ success: false, error: 'A department with this name already exists' });

        const prefix = department_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_department_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('departments')
            .insert({
                tenant_id: tenantId,
                department_code: codeRow,
                department_name: department_name.trim(),
                department_short_name,
                department_head,
                department_head_phone,
                department_head_email,
                description,
                parent_department_id: parent_department_id || null,
                cost_center_code: cost_center_code || null,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_department', 'department', data.id, { new_data: data });
        res.json({ success: true, message: 'Department created successfully', data });
    } catch (error) {
        console.error('Create department error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/departments/:id', requireAuth, loadUserPermissions, requirePermission('user_management', 'edit'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('departments').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { data, error } = await tenantClient
            .from('departments')
            .update({ ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId)
            .select()
            .single();
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_department', 'department', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/departments/:id', requireAuth, loadUserPermissions, requirePermission('user_management', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('departments').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        // Soft delete only - a hard delete would orphan any user pointing at this department.
        const { error } = await tenantClient
            .from('departments')
            .update({ is_active: false, updated_by: req.auth.userId })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'delete_department', 'department', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Department deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
