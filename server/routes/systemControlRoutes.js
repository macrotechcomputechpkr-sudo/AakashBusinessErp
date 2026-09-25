// =============================================
// routes/systemControlRoutes.js
// System Control - one comprehensive company-configuration screen,
// modeled on Tally's F11/F12 and FACT's Nepal-specific features (see
// database/18_system_control_settings_schema.sql for the full list and
// research notes). Unlike every other master in this app, this is a
// SINGLE settings object per tenant, not a list - so it's just one GET
// (auto-creates defaults on first access) and one PUT (partial update).
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const VALID_POPUP_TERMS = ['sales', 'purchase', 'sales_return', 'purchase_return'];

router.get('/system-control', requireAuth, async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        let { data, error } = await tenantClient.from('system_control_settings').select('*').eq('tenant_id', tenantId).single();
        if (error && error.code === 'PGRST116') {
            // No row yet for this tenant - create one with defaults.
            const { error: rpcErr } = await tenantClient.rpc('ensure_system_control_settings', { p_tenant_id: tenantId });
            if (rpcErr) throw rpcErr;
            ({ data, error } = await tenantClient.from('system_control_settings').select('*').eq('tenant_id', tenantId).single());
        }
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/system-control', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        if (req.body.popup_product_wise_term_applicability) {
            const bad = req.body.popup_product_wise_term_applicability.filter(t => !VALID_POPUP_TERMS.includes(t));
            if (bad.length > 0) return res.status(400).json({ success: false, error: `Invalid applicability value(s): ${bad.join(', ')}` });
        }

        // Make sure a row exists first (same auto-create as GET), then update it.
        await tenantClient.rpc('ensure_system_control_settings', { p_tenant_id: tenantId });

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.tenant_id; // never let the client move a settings row to a different tenant

        const { data, error } = await tenantClient
            .from('system_control_settings').update(update).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the system control settings' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_system_control', 'system_control_settings', data.id, { new_data: data });
        res.json({ success: true, message: 'System control settings updated', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
