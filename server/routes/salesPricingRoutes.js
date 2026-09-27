// =============================================
// routes/salesPricingRoutes.js
// Rate Category (which SR tier a customer sees) + Discount Group x
// Company matrix (auto-applied discount), plus the sales-history
// lookup a keyboard shortcut can pop open during entry.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const pricing = require('../utils/pricing');

const fail = (res, error) => res.status(error.status || 500).json({ success: false, error: error.message });

// Multiple Rate Type: Sr1..Sr5 fixed - caption + enable (Product Master shows only enabled ones)
router.get('/rate-types', requireAuth, async (req, res) => {
    try { res.json({ success: true, data: await pricing.rateTypes(await getTenantClient(req.auth.tenantId), req.auth.tenantId) }); } catch (error) { fail(res, error); }
});
router.put('/rate-types', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const data = await pricing.saveRateTypes(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, (req.body || {}).rate_types);
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_rate_types', 'system_control_settings', null, { rate_types: data });
        res.json({ success: true, data });
    } catch (error) { fail(res, error); }
});

router.get('/rate-categories/:id', requireAuth, async (req, res) => {
    try { res.json({ success: true, data: await pricing.rateCategory(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.params.id) }); } catch (error) { fail(res, error); }
});
router.get('/discount-groups/:id', requireAuth, async (req, res) => {
    try { res.json({ success: true, data: await pricing.discountGroup(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.params.id) }); } catch (error) { fail(res, error); }
});

router.get('/rate-categories', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('rate_categories').select('*').eq('tenant_id', req.auth.tenantId).order('category_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/rate-categories', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { category_name, sr_tier } = req.body;
        if (sr_tier !== undefined && sr_tier !== null && sr_tier !== '' && !(Number(sr_tier) >= 1 && Number(sr_tier) <= 5)) return res.status(400).json({ success: false, error: 'Sales Rate tier must be SR1 to SR5' });
        if (!category_name) return res.status(400).json({ success: false, error: 'Category Name is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data, error } = await tenantClient.from('rate_categories').insert({ tenant_id: tenantId, category_name, sr_tier: sr_tier || 1, description: req.body.description || null }).select().single();
        if (error) throw error;
        if (Array.isArray(req.body.items)) {
            try { await pricing.saveRateCategoryItems(tenantClient, tenantId, data.id, req.body.items); } catch (e) { await tenantClient.from('rate_categories').delete().eq('id', data.id); throw e; }
        }
        await logAudit(tenantId, req.auth.userId, 'create_rate_category', 'rate_category', data.id, { category_name });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/rate-categories/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { category_name, sr_tier, is_active } = req.body;
        if (sr_tier !== undefined && sr_tier !== null && sr_tier !== '' && !(Number(sr_tier) >= 1 && Number(sr_tier) <= 5)) return res.status(400).json({ success: false, error: 'Sales Rate tier must be SR1 to SR5' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const patch = { category_name, sr_tier, is_active };
        if ('description' in req.body) patch.description = req.body.description || null;
        const { data, error } = await tenantClient.from('rate_categories').update(patch).eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).select().single();
        if (error) throw error;
        if (Array.isArray(req.body.items)) await pricing.saveRateCategoryItems(tenantClient, req.auth.tenantId, req.params.id, req.body.items);
        res.json({ success: true, data });
    } catch (error) {
        fail(res, error);
    }
});

router.delete('/rate-categories/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        // Customers still pointing here would make the DB reject the delete
        // with a raw foreign-key error - explain it instead.
        const { count } = await tenantClient.from('ledger_accounts').select('id', { count: 'exact', head: true }).eq('tenant_id', req.auth.tenantId).eq('rate_category_id', req.params.id);
        if (count > 0) return res.status(400).json({ success: false, error: `${count} customer(s) use this rate category. Change them first, then delete.` });
        const { error } = await tenantClient.from('rate_categories').delete().eq('id', req.params.id).eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        res.json({ success: true, message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/discount-groups', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('discount_groups').select('*').eq('tenant_id', req.auth.tenantId).order('group_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/discount-groups', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { group_name } = req.body;
        if (!group_name) return res.status(400).json({ success: false, error: 'Group Name is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data, error } = await tenantClient.from('discount_groups').insert({ tenant_id: tenantId, group_name, ...pricing.groupFields(req.body) }).select().single();
        if (error) throw error;
        if (Array.isArray(req.body.rules)) {
            try { await pricing.saveDiscountRules(tenantClient, tenantId, data.id, req.body.rules); } catch (e) { await tenantClient.from('discount_groups').delete().eq('id', data.id); throw e; }
        }
        await logAudit(tenantId, req.auth.userId, 'create_discount_group', 'discount_group', data.id, { group_name });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/discount-groups/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { group_name, is_active } = req.body;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('discount_groups').update({ group_name, is_active, ...pricing.groupFields(req.body) }).eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).select().single();
        if (error) throw error;
        if (Array.isArray(req.body.rules)) await pricing.saveDiscountRules(tenantClient, req.auth.tenantId, req.params.id, req.body.rules);
        res.json({ success: true, data });
    } catch (error) {
        fail(res, error);
    }
});

router.delete('/discount-groups/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        // Customers still pointing here would make the DB reject the delete
        // with a raw foreign-key error - explain it instead.
        const { count } = await tenantClient.from('ledger_accounts').select('id', { count: 'exact', head: true }).eq('tenant_id', req.auth.tenantId).eq('discount_group_id', req.params.id);
        if (count > 0) return res.status(400).json({ success: false, error: `${count} customer(s) use this discount group. Change them first, then delete.` });
        const { error } = await tenantClient.from('discount_groups').delete().eq('id', req.params.id).eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        res.json({ success: true, message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/discount-matrix', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { discount_group_id } = req.query;
        let query = tenantClient.from('discount_matrix').select('*, discount_groups(group_name), product_companies(company_name)').eq('tenant_id', req.auth.tenantId);
        if (discount_group_id) query = query.eq('discount_group_id', discount_group_id);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/discount-matrix/:discountGroupId', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { cells } = req.body;
        if (!Array.isArray(cells)) return res.status(400).json({ success: false, error: 'cells array is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        for (const cell of cells) {
            if (!cell.product_company_id) continue;
            await tenantClient.from('discount_matrix').upsert({
                tenant_id: tenantId, discount_group_id: req.params.discountGroupId, product_company_id: cell.product_company_id,
                discount_percent: Number(cell.discount_percent) || 0, updated_at: new Date().toISOString()
            }, { onConflict: 'tenant_id,discount_group_id,product_company_id' });
        }
        await logAudit(tenantId, req.auth.userId, 'update_discount_matrix', 'discount_group', req.params.discountGroupId, { cell_count: cells.length });
        res.json({ success: true, message: 'Discount matrix updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// rate + discount a sales line gets: rate category (product / unit rows, else the Sr tier)
// and discount category (qty / value slab rules, else the company matrix).
// Optional: unit_id, qty, payment_term.
router.get('/resolve-sales-price', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { customer_ledger_id, product_id } = req.query;
        if (!customer_ledger_id || !product_id) return res.status(400).json({ success: false, error: 'customer_ledger_id and product_id are required' });
        res.json({ success: true, data: await pricing.resolve(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.query) });
    } catch (error) {
        fail(res, error);
    }
});

// FEATURE: "product wise sales history" should reflect what was
// actually BILLED (the final invoiced rate/discount), not just what
// was quoted on an order - pulls from both, most recent first, so the
// F1/F2-style history a sales screen pops open shows the true history
// a cashier or salesman would trust.
router.get('/customer-product-history', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { customer_ledger_id, product_id } = req.query;
        if (!customer_ledger_id || !product_id) return res.status(400).json({ success: false, error: 'customer_ledger_id and product_id are required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);

        const { data: orders } = await tenantClient.from('sales_orders').select('id, doc_no, doc_date').eq('tenant_id', req.auth.tenantId).eq('customer_ledger_id', customer_ledger_id).order('doc_date', { ascending: false }).limit(20);
        const { data: bills } = await tenantClient.from('sales_bills').select('id, doc_no, doc_date').eq('tenant_id', req.auth.tenantId).eq('customer_ledger_id', customer_ledger_id).eq('status', 'posted').order('doc_date', { ascending: false }).limit(20);

        const orderIds = (orders || []).map(o => o.id);
        const billIds = (bills || []).map(b => b.id);

        const [orderDetailsRes, billDetailsRes] = await Promise.all([
            orderIds.length > 0 ? tenantClient.from('sales_order_details').select('order_id, qty, alt_qty, alt_unit_id, rate, rate_basis, batch_no, discount_percent, discount_amount, tax_percent, amount, free_qty, free_alt_qty, uom_name_snapshot').eq('product_id', product_id).in('order_id', orderIds) : Promise.resolve({ data: [] }),
            billIds.length > 0 ? tenantClient.from('sales_bill_details').select('bill_id, qty, alt_qty, alt_unit_id, rate, rate_basis, batch_no, discount_percent, discount_amount, tax_percent, amount, free_qty, free_alt_qty, uom_name_snapshot').eq('product_id', product_id).in('bill_id', billIds) : Promise.resolve({ data: [] })
        ]);

        const orderMap = Object.fromEntries((orders || []).map(o => [o.id, o]));
        const billMap = Object.fromEntries((bills || []).map(b => [b.id, b]));

        // Resolve alt_unit_id -> unit name for display (history rows
        // only store the id, not a name snapshot).
        const allAltUnitIds = [...new Set([...(orderDetailsRes.data || []), ...(billDetailsRes.data || [])].map(d => d.alt_unit_id).filter(Boolean))];
        let altUnitNameById = {};
        if (allAltUnitIds.length > 0) {
            const { data: altUnits } = await tenantClient.from('product_units').select('id, unit_name').in('id', allAltUnitIds);
            altUnitNameById = Object.fromEntries((altUnits || []).map(u => [u.id, u.unit_name]));
        }

        const orderHistory = (orderDetailsRes.data || []).map(d => ({ ...d, doc_no: orderMap[d.order_id]?.doc_no, doc_date: orderMap[d.order_id]?.doc_date, alt_unit_name: altUnitNameById[d.alt_unit_id] || null, source: 'Sales Order' }));
        const billHistory = (billDetailsRes.data || []).map(d => ({ ...d, doc_no: billMap[d.bill_id]?.doc_no, doc_date: billMap[d.bill_id]?.doc_date, alt_unit_name: altUnitNameById[d.alt_unit_id] || null, source: 'Sales Bill' }));

        const history = [...billHistory, ...orderHistory]
            .sort((a, b) => new Date(b.doc_date) - new Date(a.doc_date))
            .slice(0, 10);

        res.json({ success: true, data: history });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/vendor-product-history', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { vendor_ledger_id, product_id, any_vendor } = req.query;
        if (!product_id) return res.status(400).json({ success: false, error: 'product_id is required' });
        if (!vendor_ledger_id && any_vendor !== 'true') return res.status(400).json({ success: false, error: 'vendor_ledger_id is required (or set any_vendor=true)' });
        const tenantClient = await getTenantClient(req.auth.tenantId);

        // FEATURE: "[F1]: Last Purchase history, [F2]: Last Purchase
        // history (Any Supplier)" - matches the reference software's
        // own two-key distinction: F1 scopes to THIS vendor, F2 (via
        // any_vendor=true) shows the last purchase from ANY vendor.
        let billQuery = tenantClient.from('purchase_bills').select('id, doc_no, doc_date, vendor_name_snapshot').eq('tenant_id', req.auth.tenantId).eq('status', 'posted').order('doc_date', { ascending: false }).limit(20);
        if (any_vendor !== 'true') billQuery = billQuery.eq('vendor_ledger_id', vendor_ledger_id);
        const { data: bills } = await billQuery;
        const billIds = (bills || []).map(b => b.id);
        if (billIds.length === 0) return res.json({ success: true, data: [] });

        const { data: details } = await tenantClient.from('purchase_bill_details').select('bill_id, qty, alt_qty, alt_unit_id, rate, rate_basis, batch_no, discount_percent, discount_amount, free_qty, free_alt_qty, tax_percent, amount, uom_name_snapshot').eq('product_id', product_id).in('bill_id', billIds);
        const billMap = Object.fromEntries((bills || []).map(b => [b.id, b]));
        // Resolve alt_unit_id -> unit name for display (history rows
        // only store the id, not a name snapshot).
        const altUnitIds = [...new Set((details || []).map(d => d.alt_unit_id).filter(Boolean))];
        let altUnitNameById = {};
        if (altUnitIds.length > 0) {
            const { data: altUnits } = await tenantClient.from('product_units').select('id, unit_name').in('id', altUnitIds);
            altUnitNameById = Object.fromEntries((altUnits || []).map(u => [u.id, u.unit_name]));
        }
        const history = (details || [])
            .map(d => ({ ...d, doc_no: billMap[d.bill_id]?.doc_no, doc_date: billMap[d.bill_id]?.doc_date, vendor_name: billMap[d.bill_id]?.vendor_name_snapshot, alt_unit_name: altUnitNameById[d.alt_unit_id] || null, source: 'Purchase Bill' }))
            .sort((a, b) => new Date(b.doc_date) - new Date(a.doc_date))
            .slice(0, 10);

        res.json({ success: true, data: history });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "selective Products Choose Garda Tesko History Herna Milne" -
// a standalone multi-product browser, not tied to filling in one row
// of a live transaction. Accepts one or more product_ids and optional
// party/date-range filters; returns comprehensive rate/discount/free-
// qty history from posted Sales and Purchase Bills.
router.get('/product-rate-history', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { product_ids, side, customer_ledger_id, vendor_ledger_id, date_from, date_to } = req.query;
        const productIdList = (product_ids || '').split(',').map(s => s.trim()).filter(Boolean);
        if (productIdList.length === 0) return res.status(400).json({ success: false, error: 'Select at least one product' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const wantSales = side !== 'purchase';
        const wantPurchase = side !== 'sales';
        let history = [];

        if (wantSales) {
            let billQuery = tenantClient.from('sales_bills').select('id, doc_no, doc_date, customer_name_snapshot, customer_ledger_id').eq('tenant_id', req.auth.tenantId).eq('status', 'posted');
            if (customer_ledger_id) billQuery = billQuery.eq('customer_ledger_id', customer_ledger_id);
            if (date_from) billQuery = billQuery.gte('doc_date', date_from);
            if (date_to) billQuery = billQuery.lte('doc_date', date_to);
            const { data: bills } = await billQuery.order('doc_date', { ascending: false }).limit(200);
            const billIds = (bills || []).map(b => b.id);
            if (billIds.length > 0) {
                const { data: details } = await tenantClient
                    .from('sales_bill_details')
                    .select('bill_id, product_id, product_name_snapshot, qty, alt_qty, alt_unit_id, rate, rate_basis, batch_no, discount_percent, discount_amount, tax_percent, amount, free_qty, free_alt_qty, uom_name_snapshot')
                    .in('bill_id', billIds).in('product_id', productIdList);
                const billMap = Object.fromEntries((bills || []).map(b => [b.id, b]));
                history.push(...(details || []).map(d => ({
                    ...d, doc_no: billMap[d.bill_id]?.doc_no, doc_date: billMap[d.bill_id]?.doc_date,
                    party_name: billMap[d.bill_id]?.customer_name_snapshot, source: 'Sales Bill'
                })));
            }
        }

        if (wantPurchase) {
            let billQuery = tenantClient.from('purchase_bills').select('id, doc_no, doc_date, vendor_name_snapshot, vendor_ledger_id').eq('tenant_id', req.auth.tenantId).eq('status', 'posted');
            if (vendor_ledger_id) billQuery = billQuery.eq('vendor_ledger_id', vendor_ledger_id);
            if (date_from) billQuery = billQuery.gte('doc_date', date_from);
            if (date_to) billQuery = billQuery.lte('doc_date', date_to);
            const { data: bills } = await billQuery.order('doc_date', { ascending: false }).limit(200);
            const billIds = (bills || []).map(b => b.id);
            if (billIds.length > 0) {
                const { data: details } = await tenantClient
                    .from('purchase_bill_details')
                    .select('bill_id, product_id, product_name_snapshot, qty, alt_qty, alt_unit_id, rate, rate_basis, batch_no, discount_percent, discount_amount, tax_percent, amount, free_qty, free_alt_qty, uom_name_snapshot')
                    .in('bill_id', billIds).in('product_id', productIdList);
                const billMap = Object.fromEntries((bills || []).map(b => [b.id, b]));
                history.push(...(details || []).map(d => ({
                    ...d, doc_no: billMap[d.bill_id]?.doc_no, doc_date: billMap[d.bill_id]?.doc_date,
                    party_name: billMap[d.bill_id]?.vendor_name_snapshot, source: 'Purchase Bill'
                })));
            }
        }

        // Resolve alt_unit_id -> unit name for display.
        const altUnitIds = [...new Set(history.map(h => h.alt_unit_id).filter(Boolean))];
        if (altUnitIds.length > 0) {
            const { data: altUnits } = await tenantClient.from('product_units').select('id, unit_name').in('id', altUnitIds);
            const altUnitNameById = Object.fromEntries((altUnits || []).map(u => [u.id, u.unit_name]));
            history = history.map(h => ({ ...h, alt_unit_name: altUnitNameById[h.alt_unit_id] || null }));
        }

        history.sort((a, b) => new Date(b.doc_date) - new Date(a.doc_date));
        res.json({ success: true, data: history });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
