// =============================================
// routes/productionReportRoutes.js - Production reports (utils/productionReport.js)
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { productionReport, productionMeta } = require('../utils/productionReport');

const guard = [requireAuth, loadUserPermissions, requirePermission('reports', 'view')];
const wrap = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.query) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.get('/reports/production', ...guard, wrap((c, t, q) => productionReport(c, t, q)));
router.get('/reports/production/meta', ...guard, wrap((c, t) => productionMeta(c, t)));

module.exports = router;
