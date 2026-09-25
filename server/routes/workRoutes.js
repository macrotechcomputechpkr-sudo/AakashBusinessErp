// =============================================
// routes/workRoutes.js
// Darta / Chalani register, Task management, Notifications (bell +
// popup + email / SMS / WhatsApp / Viber copies) and the Work dashboard.
// Rights (Security Groups): darta_chalani (view / create / edit / delete),
// tasks (view = see everyone's tasks; create; edit; delete). Every user
// may read their own notifications and work on tasks given to them.
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const DC = require('../utils/dartaChalani');
const TK = require('../utils/tasks');
const N = require('../utils/notifications');
const { workDashboard } = require('../utils/workDashboard');

const auth = [requireAuth, loadUserPermissions];
const dc = a => [...auth, requirePermission('darta_chalani', a)];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

// ---- darta / chalani
router.get('/darta-chalani', ...dc('view'), send((c, t, req) => DC.list(c, t, req, req.query)));
router.get('/darta-chalani/next-number', ...dc('view'), send(async (c, t, req) => {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const type = req.query.entry_type === 'chalani' ? 'chalani' : 'darta';
    const fy = await DC.fiscalYear(c, t, date);
    const { data } = await c.from('darta_chalani').select('serial_no').eq('tenant_id', t).eq('entry_type', type).eq('fiscal_year_label', fy.label).order('serial_no', { ascending: false }).limit(1);
    const n = ((data && data[0] && data[0].serial_no) || 0) + 1;
    return { reg_no: `${type === 'darta' ? 'D' : 'C'}-${fy.label}-${String(n).padStart(4, '0')}`, fiscal_year_label: fy.label, date_bs: DC.bsOf(date) };
}));
router.get('/darta-chalani/:id', ...dc('view'), send((c, t, req) => DC.get(c, t, req, req.params.id)));
router.post('/darta-chalani', ...dc('create'), send((c, t, req) => DC.create(c, t, req, req.body || {})));
router.put('/darta-chalani/:id', ...dc('edit'), send((c, t, req) => DC.update(c, t, req, req.params.id, req.body || {})));
router.delete('/darta-chalani/:id', ...dc('delete'), send((c, t, req) => DC.remove(c, t, req, req.params.id)));

// ---- tasks (visibility and edit rules inside utils/tasks.js)
router.get('/tasks', ...auth, send((c, t, req) => TK.list(c, t, req, req.query)));
router.get('/tasks/:id', ...auth, send((c, t, req) => TK.get(c, t, req, req.params.id)));
router.post('/tasks', ...auth, send((c, t, req) => TK.create(c, t, req, req.body || {})));
router.put('/tasks/:id', ...auth, send((c, t, req) => TK.update(c, t, req, req.params.id, req.body || {})));
router.post('/tasks/:id/comments', ...auth, send((c, t, req) => TK.comment(c, t, req, req.params.id, (req.body || {}).body)));
router.delete('/tasks/:id', ...auth, send((c, t, req) => TK.remove(c, t, req, req.params.id)));

// people a task / letter can be given to
router.get('/work/users', ...auth, send(async (c, t) => {
    const { data, error } = await c.from('users').select('id, full_name, email, department_id, department_name, is_active').eq('tenant_id', t).order('full_name');
    if (error) throw error;
    return (data || []).filter(u => u.is_active !== false).map(u => ({ id: u.id, name: u.full_name || u.email, department_id: u.department_id, department_name: u.department_name }));
}));
router.get('/work/dashboard', ...auth, send((c, t, req) => workDashboard(c, t, req, req.query)));

// ---- notifications (own only); polling also runs the due / overdue reminders
router.get('/notifications', ...auth, send(async (c, t, req) => {
    N.runDue(c, t).catch(e => console.error('reminders:', e.message));
    return N.list(c, t, req.auth.userId, req.query);
}));
router.post('/notifications/read', ...auth, send((c, t, req) => N.markRead(c, t, req.auth.userId, (req.body || {}).ids)));
router.get('/notifications/settings', ...auth, send(async (c, t, req) => ({ ...(await N.getSettings(c, t, req.auth.userId)), kinds: N.KINDS })));
router.put('/notifications/settings', ...auth, send((c, t, req) => N.saveSettings(c, t, req.auth.userId, req.body || {})));
router.post('/notifications/test', ...auth, send((c, t, req) => N.notify(c, t, { userIds: [req.auth.userId], includeActor: true, actor: req.auth.userId, kind: 'general',
    title: 'Test notification', body: 'Notifications are working.', link: '/work-dashboard' })));

module.exports = router;
