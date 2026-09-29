// =============================================
// routes/gridDimensionRoutes.js
//   GET /grid-dimensions   product and ledger attributes for the report grid
// Logic: utils/gridDimensions.js
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth } = require('../middleware/auth');
const { load } = require('../utils/gridDimensions');

router.get('/grid-dimensions', requireAuth, loadUserPermissions, async (req, res) => {
    try {
        res.json({ success: true, data: await load(await getTenantClient(req.auth.tenantId), req.auth.tenantId) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
