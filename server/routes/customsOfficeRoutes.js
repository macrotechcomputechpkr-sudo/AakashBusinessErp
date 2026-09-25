// =============================================
// routes/customsOfficeRoutes.js
// Simple master - which Customs Office (Bhansar Office) an import
// Purchase Bill's declaration was filed at.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/customs-offices', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('customs_offices').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('office_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/customs-offices', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { office_name, office_code, location } = req.body;
        if (!office_name || !office_name.trim()) return res.status(400).json({ success: false, error: 'Office Name is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data, error } = await tenantClient
            .from('customs_offices')
            .insert({ tenant_id: tenantId, office_name: office_name.trim(), office_code: office_code || null, location: location || null, created_by: req.auth.userId })
            .select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A Customs Office with this name already exists' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_customs_office', 'customs_office', data.id, { new_data: data });
        res.json({ success: true, message: 'Customs Office created', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/customs-offices/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data, error } = await tenantClient.from('customs_offices').update(req.body).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_customs_office', 'customs_office', req.params.id, { new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/customs-offices/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { error } = await tenantClient.from('customs_offices').update({ is_active: false }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_customs_office', 'customs_office', req.params.id, {});
        res.json({ success: true, message: 'Customs Office removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
