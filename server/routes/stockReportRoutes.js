// =============================================
// routes/stockReportRoutes.js
// Stock Report (summary / detail / party-wise) - see utils/stockReport.js.
// Stock In / Out (qty: opening, receipt, issue, balance) - utils/stockInOut.js.
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { stockReport, stockReportMeta } = require('../utils/stockReport');
const { stockInOut } = require('../utils/stockInOut');

const guard = [requireAuth, loadUserPermissions, requirePermission('reports', 'view')];
const wrap = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(req, await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.query) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.get('/stock/report/meta', ...guard, wrap((req, c, t) => stockReportMeta(c, t)));

router.get('/stock/report', ...guard, wrap((req, c, t, q) => {
    const miss = ['date_from', 'date_to'].filter(k => !q[k]);
    if (miss.length) { const e = new Error(`Missing: ${miss.join(', ')}`); e.status = 400; throw e; }
    if (q.date_to < q.date_from) { const e = new Error('To date must be on or after From date'); e.status = 400; throw e; }
    return stockReport(c, t, q);
}));

router.get('/stock/in-out', ...guard, wrap((req, c, t, q) => {
    const miss = ['date_from', 'date_to'].filter(k => !q[k]);
    if (miss.length) { const e = new Error(`Missing: ${miss.join(', ')}`); e.status = 400; throw e; }
    if (q.date_to < q.date_from) { const e = new Error('To date must be on or after From date'); e.status = 400; throw e; }
    return stockInOut(c, t, q);
}));

module.exports = router;
