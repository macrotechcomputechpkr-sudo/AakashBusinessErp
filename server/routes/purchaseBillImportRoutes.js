// =============================================
// routes/purchaseBillImportRoutes.js
//   POST /purchase-bill-import/extract  { file_name, media_type, data (base64) }
//        -> the bill read + vendor / product matches (utils/purchaseBillImport.js)
//   POST /purchase-bill-import/rematch  { vendor_ledger_id, items }
//   POST /purchase-bill-import/learn    { vendor_ledger_id, mappings: [{ item_text, product_id, unit_id }] }
//   GET  /reports/pdc                   PDC register / dashboard (utils/pdcReport.js)
// The upload body is large, so this router is mounted with its own JSON
// limit ahead of the global parser (server.js).
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { extractPurchaseBill, rematchLines, learnMappings } = require('../utils/purchaseBillImport');
const { pdcReport } = require('../utils/pdcReport');

const wrap = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(req, await getTenantClient(req.auth.tenantId), req.auth.tenantId) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.post('/purchase-bill-import/extract', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), wrap((req, c, t) => extractPurchaseBill(c, t, req.body || {})));
router.post('/purchase-bill-import/rematch', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), wrap((req, c, t) => rematchLines(c, t, req.body || {})));
router.post('/purchase-bill-import/learn', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), wrap((req, c, t) => learnMappings(c, t, req.auth.userId, req.body || {})));
router.get('/reports/pdc', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), wrap((req, c, t) => pdcReport(c, t, req.query)));

module.exports = router;
