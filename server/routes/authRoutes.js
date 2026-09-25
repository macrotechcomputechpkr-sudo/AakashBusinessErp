// =============================================
// routes/authRoutes.js (FIXED)
// FIX 1: login no longer sends db_host/db_anon_key/db_service_key to the
//        browser - the frontend now calls OUR api, never Supabase directly.
// FIX 2: if the same email exists in more than one tenant, login now
//        requires tenant_code to disambiguate instead of crashing on
//        `.single()` with multiple matches.
// FIX 3: bcrypt.compare wrapped so a malformed/placeholder hash in the DB
//        produces a clean 401 instead of an unhandled rejection.
// =============================================

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { globalMasterDb, getUserTenants, logAudit } = require('../utils/dbHelpers');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const JWT_EXPIRY = '24h';

router.post('/login', async (req, res) => {
    const { email, password, tenant_code } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }

        let query = globalMasterDb
            .from('global_users')
            .select('*')
            .eq('email', email.toLowerCase().trim())
            .eq('status', 'active');

        if (tenant_code) {
            const { data: tenantRow } = await globalMasterDb
                .from('tenants')
                .select('id')
                .eq('tenant_code', tenant_code.toLowerCase().trim())
                .single();
            if (!tenantRow) {
                return res.status(404).json({ success: false, error: 'Tenant not found' });
            }
            query = query.eq('tenant_id', tenantRow.id);
        }

        const { data: matches, error: userError } = await query;

        if (userError) throw userError;

        // FIX: same email can legitimately exist under different tenants.
        if (!matches || matches.length === 0) {
            await logAudit(null, null, 'login_failed', 'user', null, { reason: 'invalid_user', email });
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        if (matches.length > 1) {
            return res.status(409).json({
                success: false,
                error: 'This email exists in multiple companies. Please also provide tenant_code.'
            });
        }

        const user = matches[0];

        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(403).json({
                success: false,
                error: `Account locked until ${new Date(user.locked_until).toLocaleString()}`
            });
        }

        let match = false;
        try {
            match = await bcrypt.compare(password, user.password_hash);
        } catch (e) {
            match = false; // malformed hash in DB -> treat as invalid credentials, not a crash
        }

        if (!match) {
            const attempts = (user.login_attempts || 0) + 1;
            const updateData = { login_attempts: attempts };
            if (attempts >= 5) {
                updateData.locked_until = new Date(Date.now() + 30 * 60 * 1000);
            }
            await globalMasterDb.from('global_users').update(updateData).eq('id', user.id);
            await logAudit(user.tenant_id, user.id, 'login_failed', 'user', null, { reason: 'invalid_password', attempts });
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        if (user.is_global_admin && !user.tenant_id) {
            const token = jwt.sign(
                { userId: user.id, email: user.email, isSuperAdmin: true, tenantId: null },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRY }
            );
            return res.json({
                success: true,
                token,
                user: { id: user.id, email: user.email, full_name: user.full_name, is_global_admin: true, role: 'super_admin', must_change_password: !!user.must_change_password },
                must_change_password: !!user.must_change_password,
                is_super_admin: true,
                tenants: await getUserTenants(user.id, true)
            });
        }

        const { data: tenant, error: tenantError } = await globalMasterDb
            .from('tenants')
            .select('id, tenant_code, company_name, subscription_status, is_company_created')
            .eq('id', user.tenant_id)
            .single();

        if (tenantError || !tenant) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }
        if (tenant.subscription_status !== 'active') {
            return res.status(403).json({ success: false, error: `Tenant subscription is ${tenant.subscription_status}` });
        }

        const accessibleTenants = await getUserTenants(user.id, false);

        await globalMasterDb.from('global_users').update({
            last_login: new Date().toISOString(),
            login_attempts: 0,
            locked_until: null
        }).eq('id', user.id);

        const token = jwt.sign(
            { userId: user.id, email: user.email, isSuperAdmin: false, tenantId: tenant.id },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );

        await logAudit(user.tenant_id, user.id, 'login', 'user', user.id, {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        // FIX: no db_host / db_anon_key / db_service_key sent to the browser.
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                is_global_admin: false,
                role: user.role,
                tenant_id: tenant.id,
                must_change_password: !!user.must_change_password
            },
            must_change_password: !!user.must_change_password,
            tenant: {
                id: tenant.id,
                tenant_code: tenant.tenant_code,
                company_name: tenant.company_name,
                is_company_created: tenant.is_company_created || false
            },
            tenants: accessibleTenants,
            requires_company_creation: !tenant.is_company_created
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
    }
});

// Change my own password (also the forced change after a default login:
// superadmin@businesserp.com.np / admin@businesserp.com.np).
const STRONG = p => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
router.post('/change-password', requireAuth, async (req, res) => {
    try {
        const { current_password, new_password } = req.body || {};
        if (!STRONG(new_password)) return res.status(400).json({ success: false, error: 'New password: at least 8 characters with letters and numbers' });
        if (new_password === current_password) return res.status(400).json({ success: false, error: 'Choose a password different from the current one' });
        const { data: user, error } = await globalMasterDb.from('global_users').select('id, tenant_id, password_hash').eq('id', req.auth.userId).single();
        if (error || !user) return res.status(404).json({ success: false, error: 'User not found' });
        let ok = false;
        try { ok = await bcrypt.compare(String(current_password || ''), user.password_hash); } catch { ok = false; }
        if (!ok) return res.status(401).json({ success: false, error: 'The current password is wrong' });
        const hash = await bcrypt.hash(new_password, 10);
        const row = { password_hash: hash, must_change_password: false, password_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        let upd = await globalMasterDb.from('global_users').update(row).eq('id', user.id);
        if (upd.error && /must_change_password|password_changed_at/.test(upd.error.message)) upd = await globalMasterDb.from('global_users').update({ password_hash: hash }).eq('id', user.id);
        if (upd.error) throw upd.error;
        // keep the company's users row in step (it also stores the hash)
        if (user.tenant_id) {
            try {
                const { getTenantClient } = require('../utils/dbHelpers');
                const c = await getTenantClient(user.tenant_id);
                await c.from('users').update({ password_hash: hash, force_password_change: false, last_password_change: new Date().toISOString() }).eq('id', user.id);
            } catch (e) { console.error('tenant users password sync:', e.message); }
        }
        await logAudit(user.tenant_id, user.id, 'change_password', 'user', user.id, { ip: req.ip });
        res.json({ success: true, message: 'Password changed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FIX (added): the frontend's tenant-switch UI previously created a
// Supabase client directly in the browser using the target tenant's own
// anon key (a security leak). This endpoint re-issues a JWT scoped to the
// chosen tenant AFTER re-checking the caller actually has access to it, so
// no DB credentials ever need to reach the browser.
router.post('/switch-tenant', requireAuth, async (req, res) => {
    try {
        const { tenantId } = req.body;
        if (!tenantId) return res.status(400).json({ success: false, error: 'tenantId is required' });

        if (req.auth.isSuperAdmin) {
            const { data: tenant } = await globalMasterDb
                .from('tenants')
                .select('id, tenant_code, company_name, subscription_status, is_company_created')
                .eq('id', tenantId)
                .eq('is_active', true)
                .single();
            if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });

            const token = jwt.sign(
                { userId: req.auth.userId, email: req.auth.email, isSuperAdmin: true, tenantId: tenant.id },
                JWT_SECRET, { expiresIn: JWT_EXPIRY }
            );
            return res.json({ success: true, token, tenant, requires_company_creation: !tenant.is_company_created });
        }

        // Regular user: must be the primary tenant OR have an active user_tenant_access row.
        const { data: user } = await globalMasterDb.from('global_users').select('tenant_id').eq('id', req.auth.userId).single();
        let allowed = user && user.tenant_id === tenantId;
        if (!allowed) {
            const { data: access } = await globalMasterDb
                .from('user_tenant_access')
                .select('id')
                .eq('user_id', req.auth.userId)
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .maybeSingle();
            allowed = !!access;
        }
        if (!allowed) return res.status(403).json({ success: false, error: 'You do not have access to this tenant' });

        const { data: tenant } = await globalMasterDb
            .from('tenants')
            .select('id, tenant_code, company_name, subscription_status, is_company_created')
            .eq('id', tenantId)
            .eq('is_active', true)
            .single();
        if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });
        if (tenant.subscription_status !== 'active') {
            return res.status(403).json({ success: false, error: `Tenant subscription is ${tenant.subscription_status}` });
        }

        const token = jwt.sign(
            { userId: req.auth.userId, email: req.auth.email, isSuperAdmin: false, tenantId: tenant.id },
            JWT_SECRET, { expiresIn: JWT_EXPIRY }
        );

        await logAudit(tenant.id, req.auth.userId, 'switch_tenant', 'tenant', tenant.id, {});

        res.json({ success: true, token, tenant, requires_company_creation: !tenant.is_company_created });
    } catch (error) {
        console.error('Switch tenant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/logout', requireAuth, async (req, res) => {
    try {
        await logAudit(req.auth.tenantId, req.auth.userId, 'logout', 'user', req.auth.userId, {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/me', requireAuth, async (req, res) => {
    try {
        const { data: user, error } = await globalMasterDb
            .from('global_users')
            .select('id, email, full_name, is_global_admin, role, tenant_id')
            .eq('id', req.auth.userId)
            .single();

        if (error || !user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const tenants = await getUserTenants(user.id, user.is_global_admin);
        res.json({ success: true, user, tenants });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
