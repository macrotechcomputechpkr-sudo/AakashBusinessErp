// =============================================
// routes/performanceRoutes.js
//   /api/ird/...              IRD settings, materialized sales register,
//                             sales book, audit log, CBMS sync (push / retry)
//   /api/agent-targets/...    targets (single / generated), achievement,
//                             performance, commission posting + register
//   /api/control-reports/:view day book, cash / bank book, customer / supplier
//                             master, price list, credit exceed, exceptions ...
//   /api/budget-reports/:view budget variance by ledger / sub-ledger /
//                             cost center / unit / branch / doc class
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const IRD = require('../utils/ird');
const AT = require('../utils/agentTargets');
const { budgetReport } = require('../utils/budgetReports');
const { controlReport } = require('../utils/controlReports');

const view = [requireAuth, loadUserPermissions, requirePermission('ledger', 'view')];
const edit = [requireAuth, loadUserPermissions, requirePermission('ledger', 'edit')];
const create = [requireAuth, loadUserPermissions, requirePermission('ledger', 'create')];
const reports = [requireAuth, loadUserPermissions, requirePermission('reports', 'view')];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};
const audit = (req, action, type, id, details) => logAudit(req.auth.tenantId, req.auth.userId, action, type, id, details || {});

// ---------------- IRD ----------------
router.get('/ird/settings', ...view, send(async (c, t) => { const s = await IRD.settings(c, t); return { ...s, password: s.password ? '********' : '' }; }));
router.put('/ird/settings', requireAuth, loadUserPermissions, requirePermission('security_groups', 'edit'), send(async (c, t, req) => {
    const out = await IRD.saveSettings(c, t, req.auth.userId, req.body || {});
    await audit(req, 'update_ird_settings', 'ird_settings', null, { enabled: out.enabled, seller_pan: out.seller_pan });
    return out;
}));
router.get('/ird/materialized', ...reports, send((c, t, req) => IRD.materializedReport(c, t, req.query)));
router.get('/ird/sales-book', ...reports, send((c, t, req) => IRD.salesBook(c, t, req.query)));
router.get('/ird/audit-log', ...reports, send((c, t, req) => IRD.auditLog(c, t, req.query)));
router.get('/ird/sync-log', ...reports, send((c, t, req) => IRD.syncLog(c, t, req.query)));
router.get('/ird/print-info/:docType/:id', requireAuth, send((c, t, req) => IRD.printInfo(c, t, req.params.docType, req.params.id)));
router.post('/ird/sync/:docType/:id', ...edit, send(async (c, t, req) => {
    if (!['sales_bill', 'sales_return'].includes(req.params.docType)) throw Object.assign(new Error('Only sales bills and returns are synced'), { status: 400 });
    const out = await IRD.pushOne(c, t, req.params.docType, req.params.id, { force: !!req.body?.force });
    await audit(req, 'ird_sync', req.params.docType, req.params.id, out);
    return out;
}));
router.post('/ird/sync-pending', ...edit, send(async (c, t, req) => {
    const out = await IRD.syncPending(c, t, { limit: Math.min(Number(req.body?.limit) || 200, 1000), force: !!req.body?.force });
    await audit(req, 'ird_sync_pending', 'ird', null, { attempted: out.attempted, success: out.success, failed: out.failed });
    return out;
}));

// ---------------- agent targets ----------------
router.get('/agent-targets', ...view, send(async (c, t, req) => {
    let q = c.from('agent_targets').select('*').eq('tenant_id', t);
    if (req.query.agent_id) q = q.eq('agent_id', req.query.agent_id);
    if (req.query.date_from) q = q.gte('period_to', req.query.date_from);
    if (req.query.date_to) q = q.lte('period_from', req.query.date_to);
    const { data, error } = await q.order('period_from').order('agent_id');
    if (error) throw error; return data || [];
}));
router.post('/agent-targets', ...create, send((c, t, req) => AT.saveTarget(c, t, req.auth.userId, req.body || {})));
router.post('/agent-targets/generate', ...create, send((c, t, req) => AT.generateTargets(c, t, req.auth.userId, req.body || {})));
router.get('/agent-targets/periods', ...view, send((c, t, req) => AT.periodsFor(c, t, req.query.period_type || 'month', req.query.date_from, req.query.date_to)));
router.delete('/agent-targets/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), send(async (c, t, req) => {
    const { data: posted } = await c.from('agent_commission_postings').select('id').eq('target_id', req.params.id).limit(1);
    if ((posted || []).length) throw Object.assign(new Error('This target has commission postings - it cannot be deleted (make it inactive instead)'), { status: 400 });
    const { error } = await c.from('agent_targets').delete().eq('id', req.params.id).eq('tenant_id', t);
    if (error) throw error; return { deleted: true };
}));
router.get('/agent-targets/achievement', ...reports, send((c, t, req) => AT.achievement(c, t, req.query)));
router.get('/agent-targets/performance', ...reports, send((c, t, req) => AT.agentPerformance(c, t, req.query)));
router.post('/agent-targets/post-commission', ...edit, send(async (c, t, req) => {
    const out = await AT.postCommission(c, t, req.auth.userId, req.body || {});
    await audit(req, 'post_agent_commission', 'agent_commission', null, { posted: out.posted, total: out.total });
    return out;
}));
router.post('/agent-commission/:id/cancel', ...edit, send(async (c, t, req) => {
    const out = await AT.cancelPosting(c, t, req.auth.userId, req.params.id, req.body?.reason);
    await audit(req, 'cancel_agent_commission', 'agent_commission', req.params.id, { reason: req.body?.reason });
    return out;
}));
router.get('/agent-commission/register', ...reports, send((c, t, req) => AT.commissionRegister(c, t, req.query)));

// ---------------- master / control reports (day book, cash book, masters, exceptions) ----------------
router.get('/control-reports/:view', ...reports, send((c, t, req) => controlReport(c, t, req.params.view, req.query)));

// ---------------- budgets ----------------
router.get('/budget-reports/:view', ...reports, send((c, t, req) => budgetReport(c, t, req.params.view, req.query)));

module.exports = router;
