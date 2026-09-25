// =============================================
// utils/dbHelpers.js (FIXED)
// FIX 1: getUserTenants() and the login response NO LONGER include
//        master_db_service_key or master_db_anon_key in anything sent to
//        the browser. The tenant Supabase client is only ever created
//        server-side. The frontend talks to OUR API, never Supabase
//        directly, so the anon key never needs to leave the server either.
// FIX 2: added loadUserPermissions() + paginate() helpers used by the
//        new department/designation/security-group/user routes.
// =============================================

const { createClient } = require('@supabase/supabase-js');

const GLOBAL_MASTER_URL = process.env.GLOBAL_MASTER_URL;
const GLOBAL_MASTER_KEY = process.env.GLOBAL_MASTER_KEY;
const globalMasterDb = createClient(GLOBAL_MASTER_URL, GLOBAL_MASTER_KEY);

// Cache tenant clients per-process so we are not re-creating a Supabase
// client object on every single request.
const tenantClientCache = new Map();

const getTenantClient = async (tenantId) => {
    if (tenantClientCache.has(tenantId)) return tenantClientCache.get(tenantId);

    const { data: tenant, error } = await globalMasterDb
        .from('tenants')
        .select('master_db_host, master_db_anon_key')
        .eq('id', tenantId)
        .single();

    if (error || !tenant) {
        throw new Error('Tenant not found');
    }

    const client = createClient(tenant.master_db_host, tenant.master_db_anon_key);
    tenantClientCache.set(tenantId, client);
    clientTenantIds.set(client, tenantId);
    return client;
};

// Which tenant a cached client belongs to - lets deep helpers (e.g. the
// dual-UOM base-qty calc) read tenant settings with only the client.
const clientTenantIds = new WeakMap();
const tenantIdOfClient = (client) => clientTenantIds.get(client) || null;

// Returns tenants WITHOUT any db credentials - safe to serialize to the client.
const toPublicTenant = (t) => ({
    id: t.id,
    tenant_code: t.tenant_code,
    company_name: t.company_name,
    subscription_status: t.subscription_status,
    is_company_created: t.is_company_created
});

const getUserTenants = async (userId, isSuperAdmin) => {
    if (isSuperAdmin) {
        const { data: tenants, error } = await globalMasterDb
            .from('tenants')
            .select('*')
            .eq('is_active', true)
            .order('company_name');
        if (error) throw error;
        return (tenants || []).map(toPublicTenant);
    }

    const { data: user, error: userError } = await globalMasterDb
        .from('global_users')
        .select('tenant_id')
        .eq('id', userId)
        .single();
    if (userError) throw userError;

    const { data: primaryTenant } = await globalMasterDb
        .from('tenants')
        .select('*')
        .eq('id', user.tenant_id)
        .eq('is_active', true)
        .single();

    const { data: additionalAccess } = await globalMasterDb
        .from('user_tenant_access')
        .select('tenant_id')
        .eq('user_id', userId)
        .eq('is_active', true);

    let tenants = [];
    if (primaryTenant) tenants.push(primaryTenant);

    if (additionalAccess && additionalAccess.length > 0) {
        const ids = additionalAccess.map(a => a.tenant_id);
        const { data: additionalTenants } = await globalMasterDb
            .from('tenants')
            .select('*')
            .in('id', ids)
            .eq('is_active', true);
        if (additionalTenants) tenants = [...tenants, ...additionalTenants];
    }

    return tenants.map(toPublicTenant);
};

const logAudit = async (tenantId, userId, action, entityType, entityId, details = {}) => {
    try {
        await globalMasterDb.from('global_audit_log').insert({
            tenant_id: tenantId,
            user_id: userId,
            action,
            entity_type: entityType,
            entity_id: entityId,
            details,
            ip_address: details.ip || null,
            user_agent: details.userAgent || null
        });
    } catch (error) {
        console.error('Audit log error:', error);
    }
};

// Loads the caller's security-group permission JSON so requirePermission()
// middleware can check it without an extra DB round trip per check.
const loadUserPermissions = async (req, res, next) => {
    try {
        if (req.auth.isSuperAdmin) return next();
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: user, error } = await tenantClient
            .from('users')
            .select('security_group_id, security_rights_groups(permissions)')
            .eq('id', req.auth.userId)
            .single();
        if (error || !user) {
            return res.status(403).json({ success: false, error: 'User/permissions not found' });
        }
        req.userPermissions = user.security_rights_groups?.permissions || {};
        next();
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Simple, consistent pagination + sort + search helper for list endpoints.
// FIX: previously /api/users/list (and equivalents) always returned every
// row with no search/sort/pagination, which is what made "listing" feel
// broken on anything beyond a handful of rows.
const applyListQuery = (query, req, { searchColumns = [], defaultSort = 'created_at', allowedSort = [] } = {}) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 20, 1), 1000);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const sortBy = allowedSort.includes(req.query.sortBy) ? req.query.sortBy : defaultSort;
    const sortDir = req.query.sortDir === 'asc';

    let q = query.order(sortBy, { ascending: sortDir }).range(from, to);

    const search = (req.query.search || '').trim();
    if (search && searchColumns.length > 0) {
        // FIX: a raw comma (or parentheses) in the search text used to be
        // passed straight into the PostgREST `.or()` filter string, where
        // commas are the OR-clause separator - e.g. searching "Ram, Sita"
        // would silently turn into two unrelated filter clauses instead of
        // one literal search term. Strip characters that have special
        // meaning in the PostgREST filter grammar before building the
        // expression; the leftover text is still matched via ILIKE.
        const safeSearch = search.replace(/[(),]/g, ' ').trim();
        if (safeSearch) {
            const orExpr = searchColumns.map(col => `${col}.ilike.%${safeSearch}%`).join(',');
            q = q.or(orExpr);
        }
    }

    return { q, page, pageSize };
};

// FEATURE: "Remove option - if that master's ID is used somewhere in a
// transaction, say which document, don't delete." A single reusable
// check spanning every transaction table that might reference a given
// master id - extend the `checks` array as more transaction types get
// built (Purchase Order, GRN, Bill, etc.), so every master's Remove
// button stays correctly protected without rewriting this per master.
//
// Each check is either:
//   { table, column, label }                          - a MASTER-level
//     table (e.g. purchase_requisitions.vendor_ledger_id) that itself
//     carries doc_no.
//   { detailTable, parentTable, column, label }        - a DETAIL-level
//     child table (e.g. purchase_requisition_details.product_id) that
//     needs a join back to its parent for doc_no.
async function checkTransactionUsage(tenantClient, tenantId, masterId, checks) {
    for (const check of checks.filter(c => c.table)) {
        const { data, error } = await tenantClient
            .from(check.table).select('id, doc_no')
            .eq('tenant_id', tenantId).eq(check.column, masterId).limit(5);
        if (error) continue; // table/column genuinely doesn't apply here - skip, don't fail the whole check
        if (data && data.length > 0) {
            return { used: true, table: check.table, label: check.label, docNos: data.map(d => d.doc_no).filter(Boolean) };
        }
    }
    for (const check of checks.filter(c => c.detailTable)) {
        const { data, error } = await tenantClient
            .from(check.detailTable).select(`${check.parentTable}(doc_no)`)
            .eq(check.column, masterId).limit(5);
        if (error) continue;
        if (data && data.length > 0) {
            return { used: true, table: check.detailTable, label: check.label, docNos: data.map(d => d[check.parentTable]?.doc_no).filter(Boolean) };
        }
    }
    return { used: false };
}

module.exports = {
    tenantIdOfClient,
    globalMasterDb,
    getTenantClient,
    getUserTenants,
    logAudit,
    loadUserPermissions,
    applyListQuery,
    checkTransactionUsage
};
