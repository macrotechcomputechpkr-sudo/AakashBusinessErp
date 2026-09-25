// =============================================
// utils/loginProvision.js
// Login happens against public.global_users (see authRoutes /login) while
// permissions are read from the tenant's own users row with the SAME id
// (loadUserPermissions). A user created from User Management (or a
// salesman's mobile login) therefore needs a matching global_users row, or
// they can never sign in. These helpers keep the two in step.
// =============================================
const { globalMasterDb } = require('./dbHelpers');

const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });

// Create or refresh the login for tenant user `user` (id, email, full_name, phone).
async function provisionLogin(tenantId, user, passwordHash, { active = true, role = 'user', fallbackHash = null } = {}) {
    const email = String(user.email || '').trim().toLowerCase();
    const { data: clash } = await globalMasterDb.from('global_users').select('id').eq('email', email).eq('tenant_id', tenantId);
    if ((clash || []).some(r => r.id !== user.id)) throw httpError('This email already has a login in this company', 409);
    const row = { id: user.id, tenant_id: tenantId, email, full_name: user.full_name || null, phone: user.phone || null, role, status: active ? 'active' : 'inactive' };
    if (passwordHash) row.password_hash = passwordHash;
    const { data: existing } = await globalMasterDb.from('global_users').select('id').eq('id', user.id).maybeSingle();
    const { error } = existing
        ? await globalMasterDb.from('global_users').update({ ...row, updated_at: new Date().toISOString() }).eq('id', user.id)
        : await globalMasterDb.from('global_users').insert({ ...row, password_hash: passwordHash || fallbackHash });
    if (error) throw error;
    return true;
}

async function setLoginStatus(userId, active) {
    const { error } = await globalMasterDb.from('global_users').update({ status: active ? 'active' : 'inactive', updated_at: new Date().toISOString() }).eq('id', userId);
    if (error) throw error;
}

module.exports = { provisionLogin, setLoginStatus };
