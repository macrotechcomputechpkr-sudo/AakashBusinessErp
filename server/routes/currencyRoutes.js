// =============================================
// routes/currencyRoutes.js
// Currency master: code, name, symbol, current exchange rate (1 unit = rate
// in local currency) and the local (base) currency, which always has rate 1.
// The first read creates the local currency (NPR) when there is none.
//   GET    /currencies            active currencies (local first)
//   POST   /currencies            { currency_code, currency_name, symbol, exchange_rate }
//   PUT    /currencies/:id        rate / name / symbol / active; is_base makes it the local one
//   DELETE /currencies/:id        deactivates (never the local currency)
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message });
const clean = b => {
    const out = {};
    if ('currency_code' in b) out.currency_code = String(b.currency_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if ('currency_name' in b) out.currency_name = String(b.currency_name || '').trim().slice(0, 80);
    if ('symbol' in b) out.symbol = String(b.symbol || '').trim().slice(0, 10) || null;
    if ('exchange_rate' in b) out.exchange_rate = Number(b.exchange_rate);
    if ('is_active' in b) out.is_active = b.is_active !== false;
    return out;
};

router.get('/currencies', requireAuth, async (req, res) => {
    try {
        const t = req.auth.tenantId, c = await getTenantClient(t);
        let { data, error } = await c.from('currencies').select('*').eq('tenant_id', t).order('currency_code');
        if (error) throw error;
        if (!(data || []).some(x => x.is_base)) {
            const { data: base, error: e2 } = await c.from('currencies').insert({ tenant_id: t, currency_code: 'NPR', currency_name: 'Nepalese Rupee', symbol: 'Rs', exchange_rate: 1, is_base: true }).select().single();
            if (e2) throw e2;
            data = [base, ...(data || [])];
        }
        const list = (data || []).filter(x => x.is_active !== false || req.query.all);
        res.json({ success: true, data: [...list.filter(x => x.is_base), ...list.filter(x => !x.is_base)] });
    } catch (e) { fail(res, e); }
});

router.post('/currencies', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const row = clean(req.body || {});
        if (!row.currency_code) return res.status(400).json({ success: false, error: 'Currency code is required' });
        if (!row.currency_name) return res.status(400).json({ success: false, error: 'Currency name is required' });
        if (!(row.exchange_rate > 0)) return res.status(400).json({ success: false, error: 'Exchange rate must be more than 0' });
        const { data, error } = await c.from('currencies').insert({ tenant_id: t, ...row, created_by: req.auth.userId, updated_by: req.auth.userId }).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'This currency code already exists' });
            throw error;
        }
        await logAudit(t, req.auth.userId, 'create_currency', 'currency', data.id, { new_data: data });
        res.json({ success: true, data });
    } catch (e) { fail(res, e); }
});

router.put('/currencies/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const { data: cur } = await c.from('currencies').select('*').eq('tenant_id', t).eq('id', req.params.id).maybeSingle();
        if (!cur) return res.status(404).json({ success: false, error: 'Currency not found' });
        const row = clean(req.body || {});
        if ('exchange_rate' in row && !(row.exchange_rate > 0)) return res.status(400).json({ success: false, error: 'Exchange rate must be more than 0' });
        if (req.body && req.body.is_base === true && !cur.is_base) {
            // a new local currency: the old one stops being local; rates of the others are left for the user to update
            await c.from('currencies').update({ is_base: false }).eq('tenant_id', t).eq('is_base', true);
            row.is_base = true;
        }
        if (row.is_base || cur.is_base) { row.exchange_rate = 1; row.is_active = true; }
        const { data, error } = await c.from('currencies').update({ ...row, updated_by: req.auth.userId, updated_at: new Date().toISOString() }).eq('tenant_id', t).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'This currency code already exists' });
            throw error;
        }
        await logAudit(t, req.auth.userId, 'update_currency', 'currency', data.id, { old_data: cur, new_data: data });
        res.json({ success: true, data });
    } catch (e) { fail(res, e); }
});

router.delete('/currencies/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const { data: cur } = await c.from('currencies').select('is_base').eq('tenant_id', t).eq('id', req.params.id).maybeSingle();
        if (!cur) return res.status(404).json({ success: false, error: 'Currency not found' });
        if (cur.is_base) return res.status(400).json({ success: false, error: 'The local currency cannot be removed' });
        const { error } = await c.from('currencies').update({ is_active: false, updated_by: req.auth.userId }).eq('tenant_id', t).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e) { fail(res, e); }
});

module.exports = router;
