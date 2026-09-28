// =============================================
// routes/constructionRoutes.js
// Construction management - only when System Control > Business Nature is
// "Construction". Rights: security group module "construction".
// Logic: utils/construction.js.
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const K = require('../utils/construction');

const can = a => [requireAuth, loadUserPermissions, requirePermission('construction', a)];
const send = fn => async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId;
        await K.requireOn(c, t);
        res.json({ success: true, data: await fn(c, t, req, req.auth.userId, req.body || {}) });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message, warnings: error.warnings }); }
};

router.get('/construction/settings', ...can('view'), send((c, t) => K.getSettings(c, t)));
router.put('/construction/settings', ...can('edit'), send((c, t, req, u, b) => K.saveSettings(c, t, u, b)));
router.get('/construction/dashboard', ...can('view'), send((c, t) => K.dashboard(c, t)));
router.get('/construction/reports/:view', ...can('view'), send((c, t, req) => K.report(c, t, req.params.view, req.query)));

router.get('/construction/sites', ...can('view'), send((c, t, req) => K.listSites(c, t, req.query)));
router.get('/construction/sites/:id', ...can('view'), send((c, t, req) => K.siteDetail(c, t, req.params.id)));
router.post('/construction/sites', ...can('create'), send((c, t, req, u, b) => K.saveSite(c, t, u, b)));
router.put('/construction/sites/:id', ...can('edit'), send((c, t, req, u, b) => K.saveSite(c, t, u, b, req.params.id)));
router.put('/construction/sites/:id/boq', ...can('edit'), send((c, t, req, u, b) => K.saveBoq(c, t, req.params.id, b.items)));

router.post('/construction/sites/:id/ra-bills', ...can('create'), send((c, t, req, u, b) => K.saveRaBill(c, t, u, req.params.id, b)));
router.get('/construction/ra-bills/:id', ...can('view'), send((c, t, req) => K.raBillDetail(c, t, req.params.id)));
router.put('/construction/ra-bills/:id', ...can('edit'), send(async (c, t, req, u, b) => K.saveRaBill(c, t, u, (await K.raBillDetail(c, t, req.params.id)).site_id, b, req.params.id)));
router.put('/construction/ra-bills/:id/status', ...can('edit'), send((c, t, req, u, b) => K.setRaStatus(c, t, u, req.params.id, b)));
router.delete('/construction/ra-bills/:id', ...can('delete'), send((c, t, req) => K.deleteRaBill(c, t, req.params.id)));

router.get('/construction/purchase-bills', ...can('view'), send((c, t, req) => K.sitePurchaseBills(c, t, req.query)));
router.get('/construction/purchase-bills/:id', ...can('view'), send((c, t, req) => K.purchaseLinesForSite(c, t, req.params.id)));
router.post('/construction/sites/:id/materials', ...can('create'), send((c, t, req, u, b) => K.issueMaterial(c, t, u, req.params.id, b)));
router.delete('/construction/materials/:id', ...can('delete'), send((c, t, req, u) => K.deleteIssue(c, t, u, req.params.id)));

router.post('/construction/sites/:id/wage-sheets', ...can('create'), send((c, t, req, u, b) => K.saveWageSheet(c, t, u, req.params.id, b)));
router.get('/construction/wage-sheets/:id', ...can('view'), send((c, t, req) => K.wageDetail(c, t, req.params.id)));
router.put('/construction/wage-sheets/:id', ...can('edit'), send(async (c, t, req, u, b) => K.saveWageSheet(c, t, u, (await K.wageDetail(c, t, req.params.id)).site_id, b, req.params.id)));
router.put('/construction/wage-sheets/:id/status', ...can('edit'), send((c, t, req, u, b) => K.setWageStatus(c, t, u, req.params.id, b)));
router.delete('/construction/wage-sheets/:id', ...can('delete'), send((c, t, req) => K.deleteWage(c, t, req.params.id)));

router.post('/construction/sites/:id/subcontracts', ...can('create'), send((c, t, req, u, b) => K.saveSubcontract(c, t, u, req.params.id, b)));
router.put('/construction/subcontracts/:id', ...can('edit'), send(async (c, t, req, u, b) => {
    const { data } = await c.from('construction_subcontracts').select('site_id').eq('tenant_id', t).eq('id', req.params.id).maybeSingle();
    if (!data) throw Object.assign(new Error('Sub-contract not found'), { status: 404 });
    return K.saveSubcontract(c, t, u, data.site_id, b, req.params.id);
}));
router.post('/construction/subcontracts/:id/bills', ...can('create'), send((c, t, req, u, b) => K.saveSubBill(c, t, u, req.params.id, b)));
router.put('/construction/subcontract-bills/:id/status', ...can('edit'), send((c, t, req, u, b) => K.setSubBillStatus(c, t, u, req.params.id, b)));
router.delete('/construction/subcontract-bills/:id', ...can('delete'), send((c, t, req) => K.deleteSubBill(c, t, req.params.id)));

module.exports = router;
