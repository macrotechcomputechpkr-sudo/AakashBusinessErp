// =============================================
// routes/productOfferRateRoutes.js
// Time-bound promotional pricing per product - either a Discount (tied
// to a Billing Term) or a flat override Rate, for a From/To date range.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/product-offer-rates', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient
            .from('product_offer_rates')
            .select('*, product:product_id(product_name, product_code), billing_term:billing_term_id(term_name)')
            .eq('tenant_id', req.auth.tenantId).eq('is_active', true)
            .order('from_date', { ascending: false });
        if (req.query.product_id) query = query.eq('product_id', req.query.product_id);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/product-offer-rates', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { product_id, from_date, to_date, offer_kind, billing_term_id, offer_rate } = req.body;
        if (!product_id || !from_date || !to_date) return res.status(400).json({ success: false, error: 'Product, From Date, and To Date are required' });
        if (new Date(from_date) > new Date(to_date)) return res.status(400).json({ success: false, error: 'From Date must be on or before To Date' });
        if (offer_kind === 'discount' && !billing_term_id) return res.status(400).json({ success: false, error: 'A Billing Term is required when the offer is a Discount' });
        if (offer_kind === 'rate' && (offer_rate === undefined || offer_rate === null || offer_rate === '')) {
            return res.status(400).json({ success: false, error: 'An Offer Rate is required when the offer is a Rate' });
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data, error } = await tenantClient
            .from('product_offer_rates')
            .insert({
                tenant_id: tenantId, product_id, from_date, to_date,
                offer_kind: offer_kind || 'discount',
                billing_term_id: offer_kind === 'discount' ? billing_term_id : null,
                offer_rate: offer_kind === 'rate' ? offer_rate : null,
                created_by: req.auth.userId
            })
            .select().single();
        if (error) {
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the offer fields' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_offer_rate', 'product_offer_rate', data.id, { new_data: data });
        res.json({ success: true, message: 'Offer rate created', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/product-offer-rates/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { error } = await tenantClient.from('product_offer_rates').update({ is_active: false }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_offer_rate', 'product_offer_rate', req.params.id, {});
        res.json({ success: true, message: 'Offer rate removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
