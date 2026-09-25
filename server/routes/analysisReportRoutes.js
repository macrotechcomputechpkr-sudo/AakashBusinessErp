// =============================================
// routes/analysisReportRoutes.js
//   GET /reports/stock-valuation     utils/stockValuation.js
//   GET /reports/trade-analysis      Sales / Purchase Analysis + Monthly (utils/tradeAnalysis.js)
//   GET /reports/profitability       product-wise / bill-wise ... profit
//   GET /reports/rate-history        customer / supplier / product-wise rates
//   GET /reports/trade-meta          filter pickers + dimension list
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { stockValuation, VALUATION_METHODS } = require('../utils/stockValuation');
const { tradeAnalysis, profitability, rateHistory, dimensionList } = require('../utils/tradeAnalysis');
const { tradeMeta } = require('../utils/tradeLines');

const guard = [requireAuth, loadUserPermissions, requirePermission('reports', 'view')];
const wrap = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.query) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};
const need = (q, keys) => {
    const miss = keys.filter(k => !q[k]);
    if (miss.length) { const e = new Error(`Missing: ${miss.join(', ')}`); e.status = 400; throw e; }
};

router.get('/reports/stock-valuation', ...guard, wrap((c, t, q) => { need(q, ['as_on']); return stockValuation(c, t, q); }));
router.get('/reports/trade-analysis', ...guard, wrap((c, t, q) => tradeAnalysis(c, t, q)));
router.get('/reports/profitability', ...guard, wrap((c, t, q) => profitability(c, t, q)));
router.get('/reports/rate-history', ...guard, wrap((c, t, q) => rateHistory(c, t, q)));
router.get('/reports/trade-meta', ...guard, wrap(async (c, t, q) => ({
    ...(await tradeMeta(c, t)),
    dimensions: dimensionList(q.side === 'purchase' ? 'purchase' : 'sales'),
    valuation_methods: Object.entries(VALUATION_METHODS).map(([key, label]) => ({ key, label }))
})));

module.exports = router;
