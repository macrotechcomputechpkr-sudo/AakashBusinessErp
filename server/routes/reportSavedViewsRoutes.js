// =============================================
// routes/reportSavedViewsRoutes.js
// Named, reusable report configurations (visible columns, formula
// columns, filters), one of which can be the Default a report_type
// opens with.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/report-saved-views', requireAuth, async (req, res) => {
    try {
        const { report_type } = req.query;
        if (!report_type) return res.status(400).json({ success: false, error: 'report_type is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('report_saved_views').select('*').eq('tenant_id', req.auth.tenantId).eq('report_type', report_type).order('view_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/report-saved-views', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { report_type, view_name, is_default, config } = req.body;
        if (!report_type || !view_name || !view_name.trim()) return res.status(400).json({ success: false, error: 'report_type and view_name are required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data, error } = await tenantClient
            .from('report_saved_views')
            .insert({ tenant_id: tenantId, report_type, view_name: view_name.trim(), is_default: !!is_default, config: config || {}, created_by: req.auth.userId })
            .select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: `A view named "${view_name}" already exists for this report` });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_report_saved_view', 'report_saved_view', data.id, { report_type, view_name });
        res.json({ success: true, message: 'View saved', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/report-saved-views/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { view_name, is_default, config } = req.body;
        const update = {};
        if (view_name !== undefined) update.view_name = view_name.trim();
        if (is_default !== undefined) update.is_default = !!is_default;
        if (config !== undefined) update.config = config;
        const { data, error } = await tenantClient.from('report_saved_views').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_report_saved_view', 'report_saved_view', req.params.id, { new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/report-saved-views/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { error } = await tenantClient.from('report_saved_views').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_report_saved_view', 'report_saved_view', req.params.id, {});
        res.json({ success: true, message: 'View deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
