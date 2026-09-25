// =============================================
// routes/dashboardRoutes.js
// FIX: the original Dashboard.jsx called
//   GET /api/tenant/:id/dashboard
// which never existed on the backend (always 404). This adds it.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth } = require('../middleware/auth');
const W = require('../utils/dashboardWidgets');

// Dashboard widgets: anyone who may see the dashboard or the reports.
const canSee = (req, res, next) => {
    const p = req.userPermissions || {};
    if (req.auth.isSuperAdmin || p.dashboard?.view || p.reports?.view) return next();
    return res.status(403).json({ success: false, error: 'Permission denied: dashboard.view' });
};
const guard = [requireAuth, loadUserPermissions, canSee];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.get('/dashboard/widgets', ...guard, send(() => W.catalog()));
router.get('/dashboard/widgets/:key', ...guard, send((c, t, req) => W.widgetData(c, t, req.params.key, req.query)));
router.get('/dashboard/layout', ...guard, send((c, t, req) => W.getLayout(c, t, req.auth.userId)));
router.put('/dashboard/layout', ...guard, send((c, t, req) => {
    const companyDefault = !!req.body?.company_default;
    if (companyDefault && !req.auth.isSuperAdmin && !req.userPermissions?.security_groups?.edit) {
        const e = new Error('Only an administrator can save the company default dashboard'); e.status = 403; throw e;
    }
    return W.saveLayout(c, t, req.auth.userId, req.body?.layout, companyDefault);
}));
router.delete('/dashboard/layout', ...guard, send((c, t, req) => W.resetLayout(c, t, req.auth.userId)));

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
