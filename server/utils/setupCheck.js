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
/**
 * What kind of key GLOBAL_MASTER_KEY is - never the key itself:
 * legacy JWT keys carry their role (anon / service_role) and project ref;
 * new keys start with sb_secret_ / sb_publishable_.
 */
function describeKey(key, url) {
    const k = String(key || '').trim();
    const urlRef = (String(url || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1] || null;
    const out = { key_length: k.length, url_project_ref: urlRef };
    if (/^sb_secret_/.test(k)) return { ...out, key_type: 'secret (new)' };
    if (/^sb_publishable_/.test(k)) return { ...out, key_type: 'publishable (new) - not allowed, use a secret / service_role key' };
    const parts = k.split('.');
    if (parts.length !== 3) return { ...out, key_type: 'not a Supabase key (expected eyJ… with 3 parts, or sb_secret_…) - probably cut short when copied' };
    try {
        const p = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        return { ...out, key_type: 'legacy JWT', key_role: p.role || null, key_project_ref: p.ref || null,
            key_matches_url: !!(urlRef && p.ref && urlRef === p.ref) };
    } catch { return { ...out, key_type: 'unreadable JWT - probably cut short when copied' }; }
}
module.exports = { setupHint, describeKey };
