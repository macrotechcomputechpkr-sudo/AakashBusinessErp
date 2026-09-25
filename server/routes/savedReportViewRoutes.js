// =============================================
// routes/savedReportViewRoutes.js
// "Save As Garne Option Dine. Tyo Multiple Rakhna Pawos" - named,
// reusable report configurations. Any report page identifies itself by
// a report_key (e.g. 'ledger_report', 'register:sales_bill') and stores
// its whole filter/option state as config_json. A person sees their
// own views plus any a colleague marked shared.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient } = require('../utils/dbHelpers');
const { requireAuth } = require('../middleware/auth');

router.get('/saved-report-views', requireAuth, async (req, res) => {
    try {
        const { report_key } = req.query;
        if (!report_key) return res.status(400).json({ success: false, error: 'report_key is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('saved_report_views').select('*')
            .eq('tenant_id', req.auth.tenantId).eq('report_key', report_key)
            .or(`user_id.eq.${req.auth.userId},is_shared.eq.true`)
            .order('view_name');
        if (error) throw error;
        res.json({ success: true, data: (data || []).map(v => ({ ...v, is_mine: v.user_id === req.auth.userId })) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/saved-report-views', requireAuth, async (req, res) => {
    try {
        const { report_key, view_name, config_json, is_shared, is_default } = req.body;
        if (!report_key || !view_name || !view_name.trim()) return res.status(400).json({ success: false, error: 'Report and view name are required' });
        const tenantId = req.auth.tenantId, userId = req.auth.userId;
        const tenantClient = await getTenantClient(tenantId);
        if (is_default) {
            await tenantClient.from('saved_report_views').update({ is_default: false }).eq('tenant_id', tenantId).eq('user_id', userId).eq('report_key', report_key);
        }
        const { data, error } = await tenantClient.from('saved_report_views').insert({
            tenant_id: tenantId, user_id: userId, report_key, view_name: view_name.trim(),
            config_json: config_json || {}, is_shared: !!is_shared, is_default: !!is_default
        }).select().single();
        if (error) {
            if (String(error.message).includes('unique_saved_view_name')) return res.status(400).json({ success: false, error: `You already have a view named "${view_name.trim()}" - choose another name or use Save to overwrite it` });
            throw error;
        }
        res.json({ success: true, message: `Saved as "${data.view_name}"`, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Only the owner can overwrite/rename/delete a view, even a shared one.
router.put('/saved-report-views/:id', requireAuth, async (req, res) => {
    try {
        const tenantId = req.auth.tenantId, userId = req.auth.userId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('saved_report_views').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
        if (!existing) return res.status(404).json({ success: false, error: 'View not found' });
        if (existing.user_id !== userId) return res.status(403).json({ success: false, error: 'Only the person who created this view can change it - use Save As to make your own copy' });
        const { view_name, config_json, is_shared, is_default } = req.body;
        if (is_default) {
            await tenantClient.from('saved_report_views').update({ is_default: false }).eq('tenant_id', tenantId).eq('user_id', userId).eq('report_key', existing.report_key);
        }
        const patch = { updated_at: new Date().toISOString() };
        if (view_name !== undefined) patch.view_name = view_name.trim();
        if (config_json !== undefined) patch.config_json = config_json;
        if (is_shared !== undefined) patch.is_shared = !!is_shared;
        if (is_default !== undefined) patch.is_default = !!is_default;
        const { data, error } = await tenantClient.from('saved_report_views').update(patch).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json({ success: true, message: `"${data.view_name}" updated`, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/saved-report-views/:id', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('saved_report_views').select('user_id').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).maybeSingle();
        if (!existing) return res.status(404).json({ success: false, error: 'View not found' });
        if (existing.user_id !== req.auth.userId) return res.status(403).json({ success: false, error: 'Only the person who created this view can delete it' });
        const { error } = await tenantClient.from('saved_report_views').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'View deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
