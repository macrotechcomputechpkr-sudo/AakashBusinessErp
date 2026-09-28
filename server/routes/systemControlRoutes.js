// =============================================
// routes/systemControlRoutes.js
// System Control - one comprehensive company-configuration screen,
// modeled on Tally's F11/F12 and FACT's Nepal-specific features (see
// database/18_system_control_settings_schema.sql for the full list and
// research notes). Unlike every other master in this app, this is a
// SINGLE settings object per tenant, not a list - so it's just one GET
// (auto-creates defaults on first access) and one PUT (partial update).
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const VALID_POPUP_TERMS = ['sales', 'purchase', 'sales_return', 'purchase_return'];
// entries that show item charges (product-wise terms); the others show only the Charges Summary
const PRODUCT_TERM_TRANSACTIONS = ['sales_quotation', 'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_nonsaleable_return',
    'purchase_requisition', 'purchase_quotation', 'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_nonsaleable_return'];

router.get('/system-control', requireAuth, async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        let { data, error } = await tenantClient.from('system_control_settings').select('*').eq('tenant_id', tenantId).single();
        if (error && error.code === 'PGRST116') {
            // No row yet for this tenant - create one with defaults.
            const { error: rpcErr } = await tenantClient.rpc('ensure_system_control_settings', { p_tenant_id: tenantId });
            if (rpcErr) throw rpcErr;
            ({ data, error } = await tenantClient.from('system_control_settings').select('*').eq('tenant_id', tenantId).single());
        }
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/system-control', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        if (req.body.popup_product_wise_term_applicability) {
            const bad = req.body.popup_product_wise_term_applicability.filter(t => !VALID_POPUP_TERMS.includes(t));
            if (bad.length > 0) return res.status(400).json({ success: false, error: `Invalid applicability value(s): ${bad.join(', ')}` });
        }

        if ('product_term_transactions' in req.body) {
            const list = Array.isArray(req.body.product_term_transactions) ? req.body.product_term_transactions : [];
            req.body.product_term_transactions = [...new Set(list.filter(t => PRODUCT_TERM_TRANSACTIONS.includes(t)))];
        }

        // Make sure a row exists first (same auto-create as GET), then update it.
        await tenantClient.rpc('ensure_system_control_settings', { p_tenant_id: tenantId });

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        // Business Nature: which modules the company uses (poultry adds the Poultry & Hatchery menus)
        if ('poultry_features' in update) {
            const pf = update.poultry_features || {};
            update.poultry_features = { broiler: pf.broiler !== false, hatchery: !!pf.hatchery };
        }
        if ('rate_types' in update) update.rate_types = require('../utils/pricing').cleanRateTypes(update.rate_types);
        // Term mapping: which billing term is VAT / Excise / Product Discount 1-5 / Bill Discount,
        // separately for sales and purchase (replaces the "type" on each billing term)
        let termTypes = null;
        if ('term_mapping' in update) {
            const U = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const KEYS = ['vat', 'excise', 'disc1', 'disc2', 'disc3', 'disc4', 'disc5', 'bill_disc'];
            const src = update.term_mapping || {};
            const out = {};
            for (const side of ['sales', 'purchase']) {
                out[side] = {};
                KEYS.forEach(k => { const v = src[side] && src[side][k]; out[side][k] = U.test(v || '') ? v : null; });
                const used = KEYS.map(k => out[side][k]).filter(Boolean);
                if (new Set(used).size !== used.length) return res.status(400).json({ success: false, error: `${side === 'sales' ? 'Sales' : 'Purchase'}: one billing term is chosen for two purposes` });
            }
            update.term_mapping = out;
            const { data: prev } = await tenantClient.from('system_control_settings').select('term_mapping').eq('tenant_id', tenantId).maybeSingle();
            const prevIds = new Set(['sales', 'purchase'].flatMap(sd => Object.values((prev && prev.term_mapping && prev.term_mapping[sd]) || {})).filter(Boolean));
            termTypes = { __prev: prevIds };
            // the VAT / Excise slots give their term that Type; a discount slot keeps the term's own Type
            // (only a VAT / Excise type there is taken back to Normal)
            for (const side of ['sales', 'purchase']) KEYS.forEach(k => { const id = out[side][k]; if (id && !termTypes[id]) termTypes[id] = k === 'vat' ? 'vat' : k === 'excise' ? 'excise' : 'keep'; });
        }
        delete update.tenant_id; // never let the client move a settings row to a different tenant

        const { data, error } = await tenantClient
            .from('system_control_settings').update(update).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the system control settings' });
            throw error;
        }
        if (termTypes) {
            // keep each term's internal type in step with the mapping (VAT posting, VAT reports read it)
            const prevIds = termTypes.__prev;
            const { data: terms } = await tenantClient.from('billing_terms').select('id, tax_type').eq('tenant_id', tenantId);
            for (const tm of terms || []) {
                // a term taken out of the mapping loses the type the mapping gave it; others are left alone
                const mapped = termTypes[tm.id];
                let want = tm.tax_type;
                if (mapped === 'vat' || mapped === 'excise') want = mapped;
                else if (mapped === 'keep') want = ['vat', 'excise', 'discount'].includes(tm.tax_type) ? 'none' : tm.tax_type;
                else if (prevIds.has(tm.id) && ['vat', 'excise', 'discount'].includes(tm.tax_type)) want = 'none';
                if (want !== tm.tax_type) await tenantClient.from('billing_terms').update({ tax_type: want }).eq('id', tm.id);
            }
        }
        await logAudit(tenantId, req.auth.userId, 'update_system_control', 'system_control_settings', data.id, { new_data: data });
        res.json({ success: true, message: 'System control settings updated', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Which optional modules are on - read by every screen (menus), so any signed-in user may call it.
router.get('/app-features', requireAuth, async (req, res) => {
    try {
        if (!req.auth.tenantId) return res.json({ success: true, data: { business_nature: 'trading', poultry: { enabled: false, broiler: false, hatchery: false }, construction: { enabled: false }, automobile: { enabled: false } } });
        const { features } = require('../utils/poultry');
        res.json({ success: true, data: await features(await getTenantClient(req.auth.tenantId), req.auth.tenantId) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
module.exports.PRODUCT_TERM_TRANSACTIONS = PRODUCT_TERM_TRANSACTIONS;
