// =============================================
// routes/ledgerPurposeRoutes.js
//   GET /api/ledger-purposes   every ledger with its P&L / Balance Sheet
//                              class and the purposes it may be used for
//                              (utils/ledgerPurpose.js) - feeds the pickers
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient } = require('../utils/dbHelpers');
const { requireAuth } = require('../middleware/auth');
const { ledgerPurposeMap, PURPOSES } = require('../utils/ledgerPurpose');

router.get('/ledger-purposes', requireAuth, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const ledgers = await ledgerPurposeMap(c, req.auth.tenantId);
        res.json({ success: true, data: { ledgers, purposes: Object.fromEntries(Object.entries(PURPOSES).map(([k, p]) => [k, { label: p.label, need: p.need }])) } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
