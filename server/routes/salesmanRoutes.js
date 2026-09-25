// =============================================
// routes/salesmanRoutes.js
//   /api/mobile/...            the salesman's mobile app: day sheet (planned
//                              route customers), order entry, visits, party
//                              list / detail, stock
//   /api/route-plans/...       route plan by date / weekday per salesman
//   /api/salesman-agents/:id/login   create / reset the salesman's login
//   /api/order-billing/...     pending orders -> sales bills (single or many)
//   /api/salesman-reports/:view plan vs visit, visits, not visited, order
//                              register, fill rate, pending orders, agent /
//                              route / area sales
// A logged-in user linked to a salesman (salesman_agents.linked_user_id)
// sees only their own data; office users pass agent_id and need the usual
// ledger permission.
// =============================================
const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const S = require('../utils/salesman');
const { provisionLogin } = require('../utils/loginProvision');
const { createSalesOrder, changeSalesOrderStatus } = require('./salesOrderRoutes');
const { createSalesBill, changeSalesBillStatus } = require('./salesBillRoutes');

const view = [requireAuth, loadUserPermissions, requirePermission('ledger', 'view')];
const edit = [requireAuth, loadUserPermissions, requirePermission('ledger', 'edit')];
const create = [requireAuth, loadUserPermissions, requirePermission('ledger', 'create')];
const reports = [requireAuth, loadUserPermissions, requirePermission('reports', 'view')];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });

// Runs an existing route handler (req, res) in-process and returns its JSON.
async function invoke(handler, req, { body, params = {} }) {
    let code = 200, payload = null;
    const res = { status(c) { code = c; return this; }, json(b) { payload = b; return this; } };
    await handler({ ...req, body, params, query: {} }, res);
    return { code, ...(payload || {}) };
}

// Mobile guard: a linked salesman, or an office user with ledger permission acting for agent_id.
async function mobileCtx(req) {
    const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId;
    const agentId = req.query.agent_id || req.body?.agent_id || null;
    const { agent, isSalesman } = await S.resolveAgent(c, t, req.auth.userId, agentId);
    if (!isSalesman) {
        const perms = req.userPermissions || {};
        if (!req.auth.isSuperAdmin && !perms.ledger?.view) throw httpError('Permission denied', 403);
    }
    if (!agent) throw httpError('This login is not linked to a salesman - choose a salesman', 400);
    return { c, t, agent, isSalesman };
}
const mobile = fn => async (req, res) => {
    try { const ctx = await mobileCtx(req); res.json({ success: true, data: await fn(ctx, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};
const mobileGuard = [requireAuth, async (req, res, next) => {
    // permissions are optional here (a salesman may have none); load them when present
    try {
        if (req.auth.isSuperAdmin) return next();
        const c = await getTenantClient(req.auth.tenantId);
        const { data: u } = await c.from('users').select('security_rights_groups(permissions)').eq('id', req.auth.userId).maybeSingle();
        req.userPermissions = u?.security_rights_groups?.permissions || {};
        next();
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
}];

// ---------------- mobile ----------------
router.get('/mobile/me', ...mobileGuard, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const { agent, isSalesman } = await S.resolveAgent(c, req.auth.tenantId, req.auth.userId, null);
        const { data: agents } = isSalesman ? { data: [] } : await c.from('salesman_agents').select('id, agent_name, agent_code').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('agent_name');
        res.json({ success: true, data: { is_salesman: isSalesman, agent: agent ? { id: agent.id, agent_name: agent.agent_name, agent_code: agent.agent_code, allow_rate_change: !!agent.allow_rate_change_on_mobile_order } : null,
            agents: agents || [], today: new Date().toISOString().slice(0, 10) } });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});
router.get('/mobile/day', ...mobileGuard, mobile(({ c, t, agent, isSalesman }, req) => S.daySheet(c, t, agent, isSalesman ? new Date().toISOString().slice(0, 10) : (req.query.date || new Date().toISOString().slice(0, 10)))));
router.get('/mobile/parties', ...mobileGuard, mobile(({ c, t, agent }, req) => S.agentParties(c, t, agent, req.query)));
router.get('/mobile/parties/:id', ...mobileGuard, mobile(async ({ c, t, agent }, req) => {
    const mine = await S.agentParties(c, t, agent, {});
    if (!mine.some(p => p.id === req.params.id)) throw httpError('This party is not on your routes', 403);
    return S.partyDetail(c, t, req.params.id);
}));
router.get('/mobile/products', ...mobileGuard, mobile(({ c, t, agent }, req) => S.mobileProducts(c, t, agent, req.query)));
router.get('/mobile/stock', ...mobileGuard, mobile(({ c, t, agent }, req) => S.mobileStock(c, t, agent, req.query)));
router.get('/mobile/orders', ...mobileGuard, mobile(async ({ c, t, agent }, req) => {
    const from = req.query.date_from || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to = req.query.date_to || new Date().toISOString().slice(0, 10);
    const { data, error } = await c.from('sales_orders').select('id, doc_no, doc_date, customer_name_snapshot, route_name_snapshot, total_amount, status, order_source')
        .eq('tenant_id', t).eq('agent_id', agent.id).gte('doc_date', from).lte('doc_date', to).order('doc_date', { ascending: false }).order('doc_no', { ascending: false });
    if (error) throw error;
    return { from, to, rows: data || [] };
}));
router.get('/mobile/orders/:id', ...mobileGuard, mobile(async ({ c, t, agent }, req) => {
    const { data: o } = await c.from('sales_orders').select('*').eq('id', req.params.id).eq('tenant_id', t).maybeSingle();
    if (!o || o.agent_id !== agent.id) throw httpError('Order not found', 404);
    const { data: lines } = await c.from('sales_order_details').select('*').eq('order_id', o.id).order('display_order');
    return { ...o, details: lines || [] };
}));
router.post('/mobile/orders', ...mobileGuard, async (req, res) => {
    try {
        const { c, t, agent, isSalesman } = await mobileCtx(req);
        const { bodies, route_id } = await S.buildMobileOrder(c, t, agent, isSalesman, req.body || {});
        const extra = { order_source: 'mobile', latitude: req.body.latitude ?? null, longitude: req.body.longitude ?? null };
        const saved = [], warnings = [];
        for (const body of bodies) {                        // one per product company when that is compulsory
            const out = await invoke(createSalesOrder, req, { body });
            if (!out.success) {
                if (!saved.length) return res.status(out.code || 400).json(out);
                warnings.push(out.error); continue;
            }
            const order = out.data;
            if (out.warning) warnings.push(out.warning);
            if (agent.mobile_order_status === 'confirmed') {
                const st = await invoke(changeSalesOrderStatus, req, { body: { status: 'confirmed' }, params: { id: order.id } });
                if (!st.success) warnings.push(`${order.doc_no} saved as draft: ${st.error}`);
            }
            let visit = null;
            try { visit = await S.recordVisit(c, t, req.auth.userId, agent, { ledger_account_id: body.customer_ledger_id, route_id, visit_date: body.doc_date, outcome: 'ordered', order_id: order.id, latitude: extra.latitude, longitude: extra.longitude }); }
            catch (e) { console.error('mobile visit log failed:', e.message); }
            await c.from('sales_orders').update({ ...extra, mobile_visit_id: visit?.id || null }).eq('id', order.id);
            saved.push({ id: order.id, doc_no: order.doc_no });
        }
        res.json({ success: true, message: `Order ${saved.map(o => o.doc_no).join(', ')} saved`, warning: warnings.join('; ') || undefined,
            data: { id: saved[0].id, doc_no: saved.map(o => o.doc_no).join(', '), orders: saved } });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});
router.post('/mobile/visits', ...mobileGuard, mobile(({ c, t, agent }, req) => S.recordVisit(c, t, req.auth.userId, agent, req.body || {})));

// ---------------- route plan ----------------
router.get('/route-plans', ...view, send((c, t, req) => S.planCalendar(c, t, req.query)));
router.post('/route-plans', ...create, send((c, t, req) => S.savePlans(c, t, req.auth.userId, req.body || {})));
router.delete('/route-plans/:id', ...edit, send(async (c, t, req) => {
    const { error } = await c.from('route_plans').delete().eq('id', req.params.id).eq('tenant_id', t);
    if (error) throw error; return { deleted: true };
}));
router.post('/route-plans/delete-many', ...edit, send(async (c, t, req) => {
    const ids = (req.body?.ids || []).slice(0, 2000);
    if (!ids.length) return { deleted: 0 };
    const { error } = await c.from('route_plans').delete().in('id', ids).eq('tenant_id', t);
    if (error) throw error; return { deleted: ids.length };
}));

// ---------------- salesman login ----------------
async function salesmanGroup(c, t, userId) {
    const { data: g } = await c.from('security_rights_groups').select('id, group_code, group_name').eq('tenant_id', t).eq('group_code', 'SALESMAN_MOBILE').maybeSingle();
    if (g) return g;
    const none = { view: false, create: false, edit: false, delete: false, print: false, export: false };
    const permissions = { dashboard: { ...none, view: true }, ledger: none, product: { ...none, view: true }, sales: { ...none, view: true, create: true },
        purchase: none, inventory: { ...none, view: true }, invoice: none, reports: none, user_management: none, security_groups: none };
    const { data, error } = await c.from('security_rights_groups').insert({ tenant_id: t, group_code: 'SALESMAN_MOBILE', group_name: 'Salesman (Mobile)', group_description: 'Mobile order taking - created automatically',
        group_type: 'custom', permissions, created_by: userId, updated_by: userId }).select('id, group_code, group_name').single();
    if (error) throw error;
    return data;
}
router.get('/salesman-agents/:id/login', requireAuth, loadUserPermissions, requirePermission('user_management', 'view'), send(async (c, t, req) => {
    const { data: a } = await c.from('salesman_agents').select('id, agent_name, email, phone, linked_user_id').eq('id', req.params.id).eq('tenant_id', t).maybeSingle();
    if (!a) throw httpError('Salesman not found', 404);
    const { data: u } = a.linked_user_id ? await c.from('users').select('id, email, full_name, is_active').eq('id', a.linked_user_id).maybeSingle() : { data: null };
    return { agent: a, user: u || null };
}));
router.post('/salesman-agents/:id/login', requireAuth, loadUserPermissions, requirePermission('user_management', 'create'), send(async (c, t, req) => {
    const b = req.body || {};
    const { data: a } = await c.from('salesman_agents').select('*').eq('id', req.params.id).eq('tenant_id', t).maybeSingle();
    if (!a) throw httpError('Salesman not found', 404);
    const password = String(b.password || '');
    if (password.length < 6) throw httpError('Password must be at least 6 characters');
    const hash = await bcrypt.hash(password, 10);
    if (a.linked_user_id) {                                   // reset password / re-activate
        const { data: u, error } = await c.from('users').update({ password_hash: hash, is_active: true, updated_by: req.auth.userId, updated_at: new Date().toISOString() }).eq('id', a.linked_user_id).select().single();
        if (error) throw error;
        await provisionLogin(t, u, hash, { active: true });
        await logAudit(t, req.auth.userId, 'reset_salesman_login', 'salesman_agent', a.id, { user_id: u.id });
        return { user_id: u.id, email: u.email, reset: true };
    }
    const email = String(b.email || a.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError('A valid email is required for the login');
    const { data: dup } = await c.from('users').select('id').eq('tenant_id', t).eq('email', email).maybeSingle();
    if (dup) throw httpError('A user with this email already exists - link that user instead', 409);
    const group = b.security_group_id ? { id: b.security_group_id } : await salesmanGroup(c, t, req.auth.userId);
    const { data: sg } = await c.from('security_rights_groups').select('id, group_code, group_name').eq('id', group.id).maybeSingle();
    const { data: code, error: codeErr } = await c.rpc('next_employee_code');
    if (codeErr) throw codeErr;
    const { data: me } = await c.from('users').select('default_branch_id, company_id').eq('id', req.auth.userId).maybeSingle();
    const { data: u, error } = await c.from('users').insert({
        tenant_id: t, company_id: me?.company_id || null, email, username: email.split('@')[0] + Date.now().toString().slice(-4), password_hash: hash,
        full_name: a.agent_name, phone: a.phone || null, employee_code: code, default_branch_id: me?.default_branch_id || null,
        security_group_id: sg.id, security_group_code: sg.group_code, security_group_name: sg.group_name, is_active: true,
        allow_sales_rate_change: !!a.allow_rate_change_on_mobile_order, force_password_change: false, created_by: req.auth.userId, updated_by: req.auth.userId
    }).select().single();
    if (error) throw error;
    try { await provisionLogin(t, u, hash, { active: true, role: 'salesman' }); }
    catch (e) { await c.from('users').delete().eq('id', u.id); throw e; }
    await c.from('salesman_agents').update({ linked_user_id: u.id, email, updated_by: req.auth.userId }).eq('id', a.id);
    await logAudit(t, req.auth.userId, 'create_salesman_login', 'salesman_agent', a.id, { user_id: u.id, email });
    return { user_id: u.id, email, created: true };
}));
router.put('/salesman-agents/:id/mobile-settings', ...edit, send(async (c, t, req) => {
    const b = req.body || {};
    const upd = {};
    ['allow_rate_change_on_mobile_order', 'allow_off_route_orders'].forEach(k => { if (b[k] !== undefined) upd[k] = !!b[k]; });
    if (b.mobile_order_status !== undefined) upd.mobile_order_status = b.mobile_order_status === 'confirmed' ? 'confirmed' : 'draft';
    ['default_warehouse_id', 'commission_expense_ledger_id', 'commission_payable_ledger_id', 'linked_user_id'].forEach(k => { if (b[k] !== undefined) upd[k] = b[k] || null; });
    const { data, error } = await c.from('salesman_agents').update({ ...upd, updated_by: req.auth.userId, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('tenant_id', t).select().single();
    if (error) throw error; return data;
}));

// ---------------- order -> bill ----------------
router.get('/order-billing/pending', ...view, send((c, t, req) => S.pendingOrderLines(c, t, req.query)));
router.post('/order-billing/preview', ...view, send(async (c, t, req) => (await S.planBills(c, t, req.body || {})).map(g => ({ orders: g.orders, customer_ledger_id: g.body.customer_ledger_id, lines: g.body.details.length }))));
router.post('/order-billing/convert', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const plan = await S.planBills(c, req.auth.tenantId, req.body || {});
        const results = [];
        for (const g of plan) {
            // a draft order must be confirmed first, or billing it would never move its progress
            let confirmError = null;
            for (const o of g.orders.filter(x => x.status === 'draft')) {
                const st = await invoke(changeSalesOrderStatus, req, { body: { status: 'confirmed' }, params: { id: o.id } });
                if (!st.success) { confirmError = `Could not confirm ${o.doc_no}: ${st.error}`; break; }
            }
            if (confirmError) { results.push({ orders: g.orders.map(x => x.doc_no), ok: false, error: confirmError }); continue; }
            const made = await invoke(createSalesBill, req, { body: g.body });
            if (!made.success) { results.push({ orders: g.orders.map(x => x.doc_no), ok: false, error: made.error, credit_blocked: !!made.credit_blocked }); continue; }
            const r = { orders: g.orders.map(x => x.doc_no), ok: true, bill_id: made.data.id, bill_no: made.data.doc_no, warning: made.warning || null, posted: false };
            if (req.body.post) {
                if (req.userPermissions && !req.auth.isSuperAdmin && !req.userPermissions.ledger?.edit) r.post_error = 'No permission to post - saved as draft';
                else {
                    const st = await invoke(changeSalesBillStatus, req, { body: { status: 'posted' }, params: { id: made.data.id } });
                    if (st.success) r.posted = true; else r.post_error = st.error;
                }
            }
            results.push(r);
        }
        await logAudit(req.auth.tenantId, req.auth.userId, 'convert_orders_to_bills', 'sales_order', null, { bills: results.filter(r => r.ok).map(r => r.bill_no) });
        res.json({ success: true, data: { results, bills: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length } });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});

// ---------------- reports ----------------
router.get('/salesman-reports/:view', ...reports, send((c, t, req) => S.salesmanReport(c, t, req.params.view, req.query)));

module.exports = router;
