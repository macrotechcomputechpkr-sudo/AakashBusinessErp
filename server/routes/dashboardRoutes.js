// =============================================
// routes/dashboardRoutes.js
// FIX: the original Dashboard.jsx called
//   GET /api/tenant/:id/dashboard
// which never existed on the backend (always 404). This adds it.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient } = require('../utils/dbHelpers');
const { requireAuth } = require('../middleware/auth');

router.get('/tenant/:id/dashboard', requireAuth, async (req, res) => {
    try {
        const tenantId = req.params.id;
        if (!req.auth.isSuperAdmin && req.auth.tenantId !== tenantId) {
            return res.status(403).json({ success: false, error: 'Access denied for this tenant' });
        }
        const tenantClient = await getTenantClient(tenantId);

        const { count: total_users } = await tenantClient
            .from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true);

        const { count: total_fiscal_years } = await tenantClient
            .from('fiscal_years').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);

        const { data: current_fiscal_year } = await tenantClient
            .from('fiscal_years').select('*').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();

        res.json({ success: true, data: { total_users, total_fiscal_years, current_fiscal_year } });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
