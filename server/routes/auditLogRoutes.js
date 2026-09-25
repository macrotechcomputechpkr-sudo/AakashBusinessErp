// =============================================
// routes/auditLogRoutes.js
// Audit Log screen: every create / change / delete on masters and entries
// (field-level old -> new values), per record history, coverage.
// Rights: security group module "audit_log" (view; delete = purge).
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const A = require('../utils/auditLog');

const view = [requireAuth, loadUserPermissions, requirePermission('audit_log', 'view')];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.get('/audit-log', ...view, send((c, t, req) => A.list(c, t, req.query)));
router.get('/audit-log/users', ...view, send((c, t) => A.users(c, t)));
router.get('/audit-log/tables', ...view, send(c => A.tables(c)));
router.get('/audit-log/record/:table/:id', ...view, send((c, t, req) => A.history(c, t, req.params.table, req.params.id)));
router.post('/audit-log/purge', requireAuth, loadUserPermissions, requirePermission('audit_log', 'delete'), send(async (c, t, req) => {
    const out = await A.purge(c, t, req.body?.before);
    await logAudit(t, req.auth.userId, 'PURGE_AUDIT_LOG', 'audit_log', null, { before: req.body?.before, removed: out.removed });
    return out;
}));

module.exports = router;
