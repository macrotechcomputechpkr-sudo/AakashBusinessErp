// =============================================
// routes/billWiseSettlementRoutes.js
// FIFO settlement preview (before saving a Bill/Return) and the
// Ageing Report (every reference still carrying an outstanding
// balance, bucketed by age).
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { isBillWiseTrackingEnabled, getOutstandingReferences, computeFifoAllocation } = require('../utils/billWiseSettlement');

// FEATURE: "kun doc ma kati balance xa kati adjust garne milaune" -
// called live while filling a Bill (nature='dr' outstanding to clear)
// or a Return (nature='cr' outstanding to clear), before the document
// is even saved, so the user sees the suggested breakdown up front.
router.get('/bill-wise-settlement-preview', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { ledger_id, nature, amount } = req.query;
        if (!ledger_id || !nature || !amount) return res.status(400).json({ success: false, error: 'ledger_id, nature, and amount are required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);

        const enabled = await isBillWiseTrackingEnabled(tenantClient, req.auth.tenantId, ledger_id);
        if (!enabled) return res.json({ success: true, data: { enabled: false, allocations: [], unallocated: Number(amount) } });

        const outstanding = await getOutstandingReferences(tenantClient, ledger_id, nature, req.query.product_company_id || null);
        const { allocations, unallocated } = computeFifoAllocation(outstanding, amount);
        res.json({ success: true, data: { enabled: true, allocations, unallocated, outstanding_count: outstanding.length } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "Ageing Report" - every still-outstanding reference,
// bucketed by age, filterable by vendor and date range.
router.get('/bill-wise-ageing-report', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { vendor_name, nature, from_date, to_date } = req.query;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient.from('v_bill_wise_ageing').select('*').eq('tenant_id', req.auth.tenantId);
        if (vendor_name) query = query.ilike('vendor_name', `%${vendor_name}%`);
        if (nature) query = query.eq('nature', nature);
        if (req.query.product_company_id) query = query.eq('product_company_id', req.query.product_company_id);
        if (from_date) query = query.gte('source_date', from_date);
        if (to_date) query = query.lte('source_date', to_date);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
