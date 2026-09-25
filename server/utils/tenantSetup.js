// =============================================
// utils/tenantSetup.js
// Everything a new company (tenant) needs to be usable on day one:
//   * a default company admin login in public.global_users:
//       admin@businesserp.com.np / Admin@12345   (same for every company,
//       change with DEFAULT_TENANT_ADMIN_EMAIL / DEFAULT_TENANT_ADMIN_PASSWORD;
//       the ERP asks for a new password at the first sign-in)
//     Because the same email exists in every company, sign-in asks for the
//     company code (tenant code) as well.
//   * the ADMIN (all rights), MANAGER and USER security groups;
//   * a tenant_master.users row for every company admin login (same id as
//     the login - permissions are read from it), linked to ADMIN.
// Used by POST /company/create; safe to run again (nothing is duplicated).
// =============================================
const bcrypt = require('bcrypt');
const { globalMasterDb } = require('./dbHelpers');

const DEFAULT_ADMIN_EMAIL = () => String(process.env.DEFAULT_TENANT_ADMIN_EMAIL || 'admin@businesserp.com.np').trim().toLowerCase();
const DEFAULT_ADMIN_PASSWORD = () => String(process.env.DEFAULT_TENANT_ADMIN_PASSWORD || 'Admin@12345');

// every module the server checks with requirePermission() or reads from the group permissions
const ALL_MODULES = ['dashboard', 'ledger', 'product', 'sales', 'purchase', 'inventory', 'invoice', 'reports', 'user_management', 'security', 'security_groups',
    'company_settings', 'tax_settings', 'ocr_bill', 'backup', 'audit_log', 'data_access', 'darta_chalani', 'tasks'];
const ACTIONS = ['view', 'create', 'edit', 'delete', 'print', 'export'];
const permissionsFor = pick => Object.fromEntries(ALL_MODULES.map(m => [m, Object.fromEntries(ACTIONS.map(a => [a, pick(m, a)]))]));
const GROUPS = [
    { group_code: 'ADMIN', group_name: 'Administrators', is_default: false, permissions: permissionsFor(() => true) },
    { group_code: 'MANAGER', group_name: 'Managers', is_default: false,
      permissions: permissionsFor((m, a) => !['security', 'security_groups', 'user_management', 'backup', 'data_access', 'company_settings', 'tax_settings'].includes(m) || a === 'view') },
    { group_code: 'USER', group_name: 'Users', is_default: true,
      permissions: permissionsFor((m, a) => (['dashboard', 'ledger', 'product', 'sales', 'purchase', 'inventory', 'invoice', 'reports'].includes(m) && ['view', 'create', 'print'].includes(a)) || (m === 'tasks' && a === 'create')) }
];

/** Make sure the company has the default admin login. Returns the credentials when it was just created. */
async function ensureDefaultAdmin(tenantId) {
    const email = DEFAULT_ADMIN_EMAIL();
    const { data: existing, error } = await globalMasterDb.from('global_users').select('id').eq('tenant_id', tenantId).eq('email', email).maybeSingle();
    if (error) throw error;
    if (existing) return { id: existing.id, email, created: false };
    const password = DEFAULT_ADMIN_PASSWORD();
    const row = { tenant_id: tenantId, email, password_hash: await bcrypt.hash(password, 10), full_name: 'Company Administrator', role: 'admin', status: 'active', must_change_password: true };
    let res = await globalMasterDb.from('global_users').insert(row).select('id').single();
    if (res.error && /must_change_password/.test(res.error.message)) {      // migration 124 not run yet
        delete row.must_change_password;
        res = await globalMasterDb.from('global_users').insert(row).select('id').single();
    }
    if (res.error) throw res.error;
    return { id: res.data.id, email, password, created: true };
}

/** Default security groups + a tenant users row for every company admin login. */
async function setupTenantAccess(tenantClient, tenantId, companyId, actorId) {
    const { data: have } = await tenantClient.from('security_rights_groups').select('id, group_code, permissions').eq('tenant_id', tenantId);
    const byCode = Object.fromEntries((have || []).map(g => [g.group_code, g]));
    for (const g of GROUPS) {
        if (byCode[g.group_code]) {
            if (g.group_code === 'ADMIN') {               // an old ADMIN group gets the modules added since
                const merged = { ...permissionsFor(() => true), ...(byCode.ADMIN.permissions || {}) };
                ALL_MODULES.forEach(m => { if (!byCode.ADMIN.permissions?.[m]) merged[m] = Object.fromEntries(ACTIONS.map(a => [a, true])); });
                await tenantClient.from('security_rights_groups').update({ permissions: merged }).eq('id', byCode.ADMIN.id);
            }
            continue;
        }
        const { data, error } = await tenantClient.from('security_rights_groups').insert({ tenant_id: tenantId, company_id: companyId || null, group_code: g.group_code,
            group_name: g.group_name, group_type: 'system', is_system: true, is_default: g.is_default, permissions: g.permissions, created_by: actorId || null }).select('id, group_code').single();
        if (error) throw error;
        byCode[g.group_code] = data;
    }
    const adminGroup = byCode.ADMIN;
    const { data: admins, error } = await globalMasterDb.from('global_users').select('id, email, full_name, phone, password_hash').eq('tenant_id', tenantId).eq('role', 'admin');
    if (error) throw error;
    let linked = 0;
    for (const a of admins || []) {
        const { data: exists } = await tenantClient.from('users').select('id').eq('id', a.id).maybeSingle();
        if (exists) continue;
        const { error: e2 } = await tenantClient.from('users').insert({ id: a.id, tenant_id: tenantId, company_id: companyId || null, email: a.email,
            username: a.email.split('@')[0] + (linked ? `_${linked}` : ''), password_hash: a.password_hash, full_name: a.full_name || 'Company Administrator', phone: a.phone || null,
            security_group_id: adminGroup.id, security_group_code: 'ADMIN', security_group_name: 'Administrators', is_company_admin: true, is_active: true,
            force_password_change: false, created_by: actorId || null });
        if (e2) throw e2;
        linked++;
    }
    return { groups: Object.keys(byCode), admins_linked: linked };
}

module.exports = { ensureDefaultAdmin, setupTenantAccess, ALL_MODULES, GROUPS, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD };
