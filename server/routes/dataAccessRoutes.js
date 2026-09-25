// =============================================
// routes/dataAccessRoutes.js
// "Data Access" screen: which ledgers / sub-ledgers / products / product
// companies / product groups / customer categories / areas each user or
// security group may see. Rights: security group module "data_access".
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const DA = require('../utils/dataAccess');

const view = [requireAuth, loadUserPermissions, requirePermission('data_access', 'view')];
const edit = [requireAuth, loadUserPermissions, requirePermission('data_access', 'edit')];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.get('/data-access/meta', ...view, send(() => Object.entries(DA.DIMS).map(([key, d]) => ({ key, label: d.label, tree: !!d.parent }))));
router.get('/data-access/subjects', ...view, send(async (c, t) => {
    const [u, g] = await Promise.all([
        c.from('users').select('id, full_name, email, security_group_id, is_company_admin, is_active').eq('tenant_id', t).order('full_name'),
        c.from('security_rights_groups').select('id, group_name').eq('tenant_id', t).order('group_name')
    ]);
    if (u.error) throw u.error;
    if (g.error) throw g.error;
    return { users: u.data || [], groups: g.data || [] };
}));
router.get('/data-access/options/:dim', ...view, send((c, t, req) => DA.options(c, t, req.params.dim)));
router.get('/data-access/rules', ...view, send((c, t, req) => DA.listRules(c, t, req.query)));
router.get('/data-access/preview', ...view, send((c, t, req) => DA.preview(c, t, req.query.user_id)));
router.put('/data-access/rules', ...edit, send(async (c, t, req) => {
    const out = await DA.saveRules(c, t, req.auth.userId, req.body || {});
    await logAudit(t, req.auth.userId, 'SAVE_DATA_ACCESS', 'data_access_rules', req.body.user_id || req.body.security_group_id,
        { rules: (req.body.rules || []).map(r => ({ dimension: r.dimension, mode: r.mode, count: (r.ids || []).length })) });
    return out;
}));

module.exports = router;
