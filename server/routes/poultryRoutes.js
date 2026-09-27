// =============================================
// routes/poultryRoutes.js
// Poultry (broiler) & Hatchery. Only when System Control > Business
// Nature is "Poultry & Hatchery". Rights: security group module "poultry".
// Logic: utils/poultry.js, utils/hatchery.js.
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const P = require('../utils/poultry');
const H = require('../utils/hatchery');

const can = a => [requireAuth, loadUserPermissions, requirePermission('poultry', a)];
const send = (fn, part) => async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId;
        await P.requireFeature(c, t, part);
        res.json({ success: true, data: await fn(c, t, req) });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message, warnings: error.warnings }); }
};

// setup
router.get('/poultry/settings', ...can('view'), send(async (c, t) => ({ settings: await P.getSettings(c, t), items: await P.listItems(c, t), roles: P.ROLES })));
router.put('/poultry/settings', ...can('edit'), send((c, t, req) => P.saveSettings(c, t, req.auth.userId, req.body || {})));
router.put('/poultry/items', ...can('edit'), send((c, t, req) => P.saveItems(c, t, (req.body || {}).items)));
router.get('/poultry/sheds', ...can('view'), send((c, t, req) => P.listSheds(c, t, req.query)));
router.post('/poultry/sheds', ...can('create'), send((c, t, req) => P.saveShed(c, t, req.auth.userId, req.body || {})));
router.put('/poultry/sheds/:id', ...can('edit'), send((c, t, req) => P.saveShed(c, t, req.auth.userId, req.body || {}, req.params.id)));
router.get('/poultry/breed-standards', ...can('view'), send(async (c, t, req) => {
    let q = c.from('poultry_breed_standards').select('*').eq('tenant_id', t);
    if (req.query.breed) q = q.eq('breed', req.query.breed);
    const { data, error } = await q.order('breed').order('age_day');
    if (error) throw error;
    return data || [];
}));
router.put('/poultry/breed-standards', ...can('edit'), send(async (c, t, req) => {
    const { breed, rows } = req.body || {};
    if (!breed || !Array.isArray(rows)) throw Object.assign(new Error('breed and rows are required'), { status: 400 });
    await c.from('poultry_breed_standards').delete().eq('tenant_id', t).eq('breed', breed);
    const clean = rows.filter(r => Number.isInteger(Number(r.age_day)) && Number(r.age_day) >= 0 && Number(r.age_day) <= 120)
        .map(r => ({ tenant_id: t, breed, age_day: Number(r.age_day), body_weight_g: r.body_weight_g === '' ? null : Number(r.body_weight_g) || null,
            cum_feed_g: r.cum_feed_g === '' ? null : Number(r.cum_feed_g) || null, livability_pct: r.livability_pct === '' ? null : Number(r.livability_pct) || null }));
    const seen = new Set(), rowsU = clean.filter(r => !seen.has(r.age_day) && seen.add(r.age_day));
    if (rowsU.length) { const { error } = await c.from('poultry_breed_standards').insert(rowsU); if (error) throw error; }
    return { saved: rowsU.length };
}));

// broiler batches
router.get('/poultry/dashboard', ...can('view'), send((c, t) => P.dashboard(c, t)));
router.get('/poultry/batches', ...can('view'), send((c, t, req) => P.listBatches(c, t, req.query), 'broiler'));
router.get('/poultry/batches/:id', ...can('view'), send((c, t, req) => P.batchDetail(c, t, req.params.id), 'broiler'));
router.post('/poultry/batches', ...can('create'), send((c, t, req) => P.createBatch(c, t, req.auth.userId, req.body || {}), 'broiler'));
router.put('/poultry/batches/:id', ...can('edit'), send((c, t, req) => P.updateBatch(c, t, req.auth.userId, req.params.id, req.body || {}), 'broiler'));
router.get('/poultry/chick-sources', ...can('view'), send((c, t, req) => P.chickSources(c, t, req.query), 'broiler'));
router.get('/poultry/chick-sources/purchase/:id', ...can('view'), send((c, t, req) => P.purchaseAvailability(c, t, req.params.id), 'broiler'));
router.get('/poultry/lot-purchases', ...can('view'), send((c, t, req) => P.lotPurchaseBills(c, t, req.query), 'broiler'));
router.get('/poultry/lot-purchases/:id', ...can('view'), send((c, t, req) => P.purchaseItemsAvailability(c, t, req.params.id), 'broiler'));
router.post('/poultry/batches/:id/purchase-receipts', ...can('create'), send((c, t, req) => P.receiveToLot(c, t, req.auth.userId, req.params.id, req.body || {}), 'broiler'));
router.delete('/poultry/purchase-receipts/:id', ...can('delete'), send((c, t, req) => P.deleteReceipt(c, t, req.auth.userId, req.params.id), 'broiler'));
router.post('/poultry/place-lots', ...can('create'), send((c, t, req) => P.placeLots(c, t, req.auth.userId, req.body || {}), 'broiler'));
router.post('/poultry/batches/:id/close', ...can('edit'), send((c, t, req) => P.closeBatch(c, t, req.auth.userId, req.params.id, req.body || {}), 'broiler'));
router.post('/poultry/batches/:id/reopen', ...can('edit'), send((c, t, req) => P.reopenBatch(c, t, req.auth.userId, req.params.id), 'broiler'));
router.delete('/poultry/batches/:id', ...can('delete'), send((c, t, req) => P.deleteBatch(c, t, req.auth.userId, req.params.id), 'broiler'));
router.post('/poultry/batches/:id/logs', ...can('create'), send((c, t, req) => P.saveLog(c, t, req.auth.userId, req.params.id, req.body || {}), 'broiler'));
router.delete('/poultry/logs/:id', ...can('delete'), send((c, t, req) => P.deleteLog(c, t, req.auth.userId, req.params.id), 'broiler'));
router.post('/poultry/batches/:id/liftings', ...can('create'), send((c, t, req) => P.addLifting(c, t, req.auth.userId, req.params.id, req.body || {}, req), 'broiler'));
router.delete('/poultry/liftings/:id', ...can('delete'), send((c, t, req) => P.deleteLifting(c, t, req.auth.userId, req.params.id), 'broiler'));
router.get('/poultry/reports/:view', ...can('view'), send((c, t, req) => P.report(c, t, req.params.view, req.query)));

// hatchery
router.get('/poultry/hatches', ...can('view'), send((c, t, req) => H.list(c, t, req.query), 'hatchery'));
router.get('/poultry/hatches/:id', ...can('view'), send((c, t, req) => H.detail(c, t, req.params.id), 'hatchery'));
router.post('/poultry/hatches', ...can('create'), send((c, t, req) => H.create(c, t, req.auth.userId, req.body || {}), 'hatchery'));
router.post('/poultry/hatches/:id/candle', ...can('edit'), send((c, t, req) => H.candle(c, t, req.auth.userId, req.params.id, req.body || {}), 'hatchery'));
router.post('/poultry/hatches/:id/hatch', ...can('edit'), send((c, t, req) => H.hatch(c, t, req.auth.userId, req.params.id, req.body || {}), 'hatchery'));
router.post('/poultry/hatches/:id/reopen', ...can('edit'), send((c, t, req) => H.hatch(c, t, req.auth.userId, req.params.id, {}, { reverse: true }), 'hatchery'));
router.post('/poultry/hatches/:id/place', ...can('create'), send((c, t, req) => H.placeInSheds(c, t, req.auth.userId, req.params.id, req.body || {}), 'hatchery'));
router.post('/poultry/hatches/:id/cancel', ...can('delete'), send((c, t, req) => H.cancel(c, t, req.auth.userId, req.params.id), 'hatchery'));

module.exports = router;
