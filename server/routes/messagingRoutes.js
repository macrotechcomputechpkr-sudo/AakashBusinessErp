// =============================================
// routes/messagingRoutes.js
//   /api/messaging/meta            channels, events, placeholders
//   /api/messaging/settings        SMTP / SMS gateway / WhatsApp / Viber
//   /api/messaging/templates       templates per channel + event (+ defaults)
//   /api/messaging/rules           auto-send per event + channel
//   /api/messaging/preview, /send  one message for a document or a party
//   /api/messaging/reminders       outstanding reminders to many parties
//   /api/messaging/log             sent / failed / waiting links
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const M = require('../utils/messaging');

const view = [requireAuth, loadUserPermissions, requirePermission('ledger', 'view')];
const edit = [requireAuth, loadUserPermissions, requirePermission('ledger', 'edit')];
const admin = [requireAuth, loadUserPermissions, requirePermission('security_groups', 'edit')];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.get('/messaging/meta', requireAuth, (req, res) => res.json({ success: true, data: {
    channels: Object.entries(M.CHANNELS).map(([key, label]) => ({ key, label })),
    events: Object.entries(M.EVENTS).map(([key, e]) => ({ key, label: e.label, document_type: e.doc })), placeholders: M.PLACEHOLDERS } }));
router.get('/messaging/settings', ...view, send(async (c, t) => M.masked(await M.settings(c, t))));
router.put('/messaging/settings', ...admin, send(async (c, t, req) => {
    const out = await M.saveSettings(c, t, req.auth.userId, req.body || {});
    await logAudit(t, req.auth.userId, 'update_message_settings', 'message_settings', null, { sms_gateway: out.sms_gateway, whatsapp_mode: out.whatsapp_mode });
    return out;
}));
router.get('/messaging/templates', ...view, send((c, t, req) => M.templates(c, t, req.query)));
router.post('/messaging/templates', ...edit, send((c, t, req) => M.saveTemplate(c, t, req.auth.userId, req.body || {})));
router.post('/messaging/templates/defaults', ...edit, send((c, t, req) => M.seedDefaults(c, t, req.auth.userId)));
router.delete('/messaging/templates/:id', ...edit, send(async (c, t, req) => {
    const { error } = await c.from('message_templates').delete().eq('id', req.params.id).eq('tenant_id', t);
    if (error) throw error; return { deleted: true };
}));
router.get('/messaging/rules', ...view, send((c, t) => M.autoRules(c, t)));
router.put('/messaging/rules', ...admin, send((c, t, req) => M.saveRules(c, t, req.body?.rules || [])));
router.post('/messaging/preview', ...view, send((c, t, req) => M.preview(c, t, req.body || {})));
router.post('/messaging/send', ...view, send(async (c, t, req) => {
    const out = await M.sendMessage(c, t, req.auth.userId, req.body || {});
    await logAudit(t, req.auth.userId, 'send_message', req.body?.document_type || 'party', req.body?.document_id || req.body?.party_id || null, { channel: req.body?.channel, to: out.to, status: out.status });
    return out;
}));
router.post('/messaging/reminders', ...edit, send((c, t, req) => M.bulkReminders(c, t, req.auth.userId, req.body || {})));
router.get('/messaging/log', ...view, send((c, t, req) => M.messageLog(c, t, req.query)));
// a link message the user opened: mark it sent
router.post('/messaging/log/:id/opened', ...view, send(async (c, t, req) => {
    const { error } = await c.from('message_log').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id).eq('tenant_id', t).eq('status', 'link');
    if (error) throw error; return { ok: true };
}));

module.exports = router;
