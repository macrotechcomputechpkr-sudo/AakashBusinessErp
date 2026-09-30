// =============================================
// utils/setupCheck.js - why the server cannot reach its global database
// Turns a Supabase / network error into a plain setup hint (no secrets):
// wrong key, wrong URL, tables not created, JWT secret missing.
// Used by the login error and GET /api/health/setup.
// =============================================
function setupHint(err, status) {
    const m = typeof err === 'string' ? err : String(err?.message || err?.details || err?.hint || '');
    const code = String(err?.code || '');
    if (status === 401 || status === 403) return 'Server setup: GLOBAL_MASTER_KEY is not accepted by the global Supabase project (use its service_role key from Settings > API).';
    if (status === 404) return 'Server setup: the global tables are missing - run database/01_global_master_schema.sql and database/124_default_admin_logins_schema.sql in the global Supabase project (SQL Editor).';
    if (/invalid api key|jwt|JWS|No API key/i.test(m) || code === '401') return 'Server setup: GLOBAL_MASTER_KEY is not a valid key of the global Supabase project (use the service_role key from Settings > API).';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo|network|Invalid URL|supabaseUrl/i.test(m)) return 'Server setup: cannot reach Supabase - check GLOBAL_MASTER_URL (https://<project-ref>.supabase.co).';
    if (/does not exist|PGRST205|PGRST106|schema cache|relation/i.test(m) || ['42P01', 'PGRST205', 'PGRST106'].includes(code)) return 'Server setup: the global tables are missing - run database/01_global_master_schema.sql and database/124_default_admin_logins_schema.sql in the global Supabase project (SQL Editor).';
    if (/permission denied/i.test(m) || code === '42501') return 'Server setup: the key has no access to the global tables - use the service_role key.';
    return null;
}
module.exports = { setupHint };
