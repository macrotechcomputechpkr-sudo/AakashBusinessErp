// =============================================
// routes/adminRoutes.js
// Super Admin panel (/admin, pages/AdminPanel.jsx): every company (tenant)
// with its users, last login and subscription; suspend / activate a
// company. A super admin opens a company from here VIEW ONLY
// (POST /api/auth/switch-tenant -> readOnly token, middleware/auth.js).
// =============================================
const express = require('express');
const router = express.Router();
const { globalMasterDb } = require('../utils/dbHelpers');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

const admin = [requireAuth, requireSuperAdmin];
const STATUSES = ['active', 'suspended', 'expired', 'pending'];

router.get('/admin/overview', ...admin, async (req, res) => {
    try {
        const { data: tenants, error } = await globalMasterDb.from('tenants')
            .select('id, tenant_code, company_name, pan_number, contact_person, contact_email, contact_phone, subscription_status, subscription_plan, subscription_end, max_users, is_company_created, is_active, created_at')
            .order('company_name');
        if (error) throw error;
        const { data: users } = await globalMasterDb.from('global_users').select('id, tenant_id, status, last_login, is_global_admin');
        const { data: access } = await globalMasterDb.from('user_tenant_access').select('tenant_id, is_active');
        const byTenant = {};
        (users || []).forEach(u => {
            if (!u.tenant_id) return;
            const b = byTenant[u.tenant_id] = byTenant[u.tenant_id] || { users: 0, active_users: 0, last_login: null };
            b.users += 1; if (u.status === 'active') b.active_users += 1;
            if (u.last_login && (!b.last_login || u.last_login > b.last_login)) b.last_login = u.last_login;
        });
        (access || []).filter(a => a.is_active).forEach(a => { const b = byTenant[a.tenant_id] = byTenant[a.tenant_id] || { users: 0, active_users: 0, last_login: null }; b.shared_users = (b.shared_users || 0) + 1; });
        const rows = (tenants || []).map(t => ({ ...t, ...(byTenant[t.id] || { users: 0, active_users: 0, last_login: null }) }));
        const today = new Date().toISOString().slice(0, 10);
        res.json({ success: true, data: { tenants: rows,
            totals: { tenants: rows.length, active: rows.filter(t => t.is_active !== false && t.subscription_status === 'active').length,
                suspended: rows.filter(t => t.subscription_status === 'suspended').length, expiring: rows.filter(t => t.subscription_end && String(t.subscription_end).slice(0, 10) <= today).length,
                without_company: rows.filter(t => !t.is_company_created).length, users: rows.reduce((s, t) => s + t.users, 0),
                super_admins: (users || []).filter(u => u.is_global_admin && !u.tenant_id).length } } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/admin/tenants/:id', ...admin, async (req, res) => {
    try {
        const b = req.body || {}, patch = {};
        if (b.subscription_status !== undefined) {
            if (!STATUSES.includes(b.subscription_status)) return res.status(400).json({ success: false, error: 'Invalid status' });
            patch.subscription_status = b.subscription_status;
        }
        if (b.subscription_end !== undefined) patch.subscription_end = b.subscription_end || null;
        if (b.subscription_plan !== undefined) patch.subscription_plan = b.subscription_plan || 'standard';
        if (b.max_users !== undefined) patch.max_users = Math.max(1, Number(b.max_users) || 1);
        if (b.is_active !== undefined) patch.is_active = !!b.is_active;
        if (!Object.keys(patch).length) return res.status(400).json({ success: false, error: 'Nothing to change' });
        const { data, error } = await globalMasterDb.from('tenants').update(patch).eq('id', req.params.id).select('id, tenant_code, company_name, subscription_status, subscription_plan, subscription_end, max_users, is_active').single();
        if (error) throw error;
        await globalMasterDb.from('global_audit_log').insert({ tenant_id: req.params.id, user_id: req.auth.userId, action: 'admin_update_tenant', entity_type: 'tenant', entity_id: req.params.id, details: patch });
        res.json({ success: true, data, message: `${data.company_name} updated` });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
