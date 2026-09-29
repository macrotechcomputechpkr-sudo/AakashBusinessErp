// =============================================
// routes/customsOfficeRoutes.js
// Simple master - which Customs Office (Bhansar Office) an import
// Purchase Bill's declaration / a Purchase Additional customs row was
// filed at. Nepal's offices are seeded with a code (utils/customsOffices.js);
// ?all=1 lists inactive ones too (Customs Offices screen).
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ensureDefaults } = require('../utils/customsOffices');

router.get('/customs-offices', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        // Nepal's customs offices (with a code) are created the first time the list is read
        try { await ensureDefaults(tenantClient, req.auth.tenantId); } catch (e) { /* list still works without the defaults */ }
        let q = tenantClient.from('customs_offices').select('*').eq('tenant_id', req.auth.tenantId);
        if (req.query.all !== '1') q = q.eq('is_active', true);
        const { data, error } = await q.order('office_code');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/customs-offices', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { office_name, office_code, location, office_name_np, district, border_point } = req.body;
        if (!office_name || !office_name.trim()) return res.status(400).json({ success: false, error: 'Office Name is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data, error } = await tenantClient
            .from('customs_offices')
            .insert({ tenant_id: tenantId, office_name: office_name.trim(), office_code: office_code ? String(office_code).trim().toUpperCase() : null, location: location || district || null, office_name_np: office_name_np || null, district: district || null, border_point: border_point || null, created_by: req.auth.userId })
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
        const { id, tenant_id, created_at, created_by, ...patch } = req.body || {};
        if (patch.office_code) patch.office_code = String(patch.office_code).trim().toUpperCase();
        const { data, error } = await tenantClient.from('customs_offices').update(patch).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
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
