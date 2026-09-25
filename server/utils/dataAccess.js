// =============================================
// utils/dataAccess.js
// Which ledgers, sub-ledgers, products, product companies, product
// groups, customer categories and areas the current user may see
// (rules: database/122_data_access_rules_schema.sql).
//
// Enforced centrally, so no route has to remember it:
//   guard()        runs inside requireAuth for every API call:
//                  - refuses a save / filter that uses an id the user may
//                    not see (403);
//                  - filters every JSON response: master lists and
//                    pickers, document lists, report rows, option lists;
//                    a single document whose party is hidden -> 403.
//                    Lines inside a visible document are left intact.
//   reportScope()  used by the trade-line and stock-report engines so
//                  report totals are computed only from visible items
//                  (GET requests only - postings are never filtered).
// Company admins and super admins are never restricted.
// =============================================
const { getTenantClient } = require('./dbHelpers');
const { currentContext } = require('./requestContext');

const DIMS = {
    ledger: { label: 'Ledgers', table: 'ledger_accounts', name: 'account_name' },
    sub_ledger: { label: 'Sub-ledgers', table: 'sub_ledgers', name: 'sub_ledger_name' },
    product: { label: 'Products', table: 'products', name: 'product_name' },
    product_company: { label: 'Product Companies', table: 'product_companies', name: 'company_name' },
    product_group: { label: 'Product Groups', table: 'product_groups', name: 'group_name', parent: 'parent_group_id' },
    ledger_category: { label: 'Customer Categories', table: 'ledger_categories', name: 'category_name' },
    area: { label: 'Areas', table: 'areas', name: 'area_name', parent: 'parent_area_id' }
};

// field name -> dimension of the id it holds
const REF_KEYS = {
    ledger_id: 'ledger', ledger_account_id: 'ledger', party_id: 'ledger', party_ledger_id: 'ledger',
    customer_ledger_id: 'ledger', vendor_ledger_id: 'ledger', supplier_ledger_id: 'ledger',
    customer_id: 'ledger', supplier_id: 'ledger', vendor_id: 'ledger',
    sub_ledger_id: 'sub_ledger', product_id: 'product', product_group_id: 'product_group',
    product_company_id: 'product_company', area_id: 'area', ledger_category_id: 'ledger_category'
};
// arrays whose items' own `id` is one of these (option lists in report meta)
const LIST_KEYS = {
    parties: 'ledger', customers: 'ledger', suppliers: 'ledger', vendors: 'ledger', ledgers: 'ledger', party_list: 'ledger',
    products: 'product', items: 'product', product_groups: 'product_group', groups: 'product_group',
    companies: 'product_company', product_companies: 'product_company', areas: 'area', sub_ledgers: 'sub_ledger',
    ledger_categories: 'ledger_category'
};
// master list endpoints: the rows' `id` is this dimension
const PATH_DIMS = [
    [/^\/(ledger-accounts|bank-reco\/ledgers|ledger-opening\/ledgers|mobile\/parties)(\/|$)/, 'ledger'],
    [/^\/sub-ledgers(\/|$)/, 'sub_ledger'],
    [/^\/(products|mobile\/products|product-opening\/products)(\/|$)/, 'product'],
    [/^\/product-groups(\/|$)/, 'product_group'],
    [/^\/product-companies(\/|$)/, 'product_company'],
    [/^\/areas(\/|$)/, 'area'],
    [/^\/ledger-categories(\/|$)/, 'ledger_category']
];
// never filtered (the rules screen itself needs full lists)
const EXEMPT = /^\/(data-access|audit-log|me|auth|login|notifications)(\/|$)/;
const DOC_KEYS = ['doc_no', 'voucher_no', 'entry_no', 'reg_no', 'task_no'];

const TTL = 60000;
const cache = new Map();                                  // `${tenant}|${user}` -> { at, scope }
const clearCache = tenantId => { for (const k of cache.keys()) if (k.startsWith(`${tenantId}|`)) cache.delete(k); };

async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
const missingTable = e => /data_access_rules/.test(e?.message || '') && /(does not exist|schema cache|not find)/i.test(e.message);

function withChildren(ids, rows, parentKey) {
    const out = new Set(ids);
    for (let grew = true; grew;) {
        grew = false;
        rows.forEach(r => { if (r[parentKey] && out.has(r[parentKey]) && !out.has(r.id)) { out.add(r.id); grew = true; } });
    }
    return out;
}

/** Effective rule per dimension for a user (own rule wins over the group's). */
async function effectiveRules(c, t, userId) {
    const { data: user } = await c.from('users').select('id, security_group_id, is_company_admin').eq('tenant_id', t).eq('id', userId).maybeSingle();
    if (!user || user.is_company_admin) return { admin: !!user?.is_company_admin, rules: {} };
    const cols = 'user_id, security_group_id, dimension, mode, ids, applies_to';
    const [mine, grp] = await Promise.all([
        c.from('data_access_rules').select(cols).eq('tenant_id', t).eq('user_id', userId),
        user.security_group_id ? c.from('data_access_rules').select(cols).eq('tenant_id', t).eq('security_group_id', user.security_group_id) : { data: [] }
    ]);
    const error = mine.error || grp.error;
    if (error) { if (missingTable(error)) return { admin: false, rules: {} }; throw error; }
    const data = [...(grp.data || []), ...(mine.data || [])];
    const rules = {};
    (data || []).filter(r => r.security_group_id).forEach(r => { rules[r.dimension] = r; });
    (data || []).filter(r => r.user_id).forEach(r => { rules[r.dimension] = r; });
    Object.keys(rules).forEach(k => { if (rules[k].mode === 'all') delete rules[k]; });
    return { admin: false, rules };
}

/** Build the scope (null = unrestricted). */
async function buildScope(c, t, userId) {
    const { rules } = await effectiveRules(c, t, userId);
    if (!Object.keys(rules).length) return null;
    const sets = {};
    for (const [dim, r] of Object.entries(rules)) {
        let ids = new Set((r.ids || []).map(String));
        if (DIMS[dim].parent && ids.size) {
            const rows = await fetchAll(() => c.from(DIMS[dim].table).select(`id, ${DIMS[dim].parent}`).eq('tenant_id', t).order('id'));
            ids = withChildren(ids, rows, DIMS[dim].parent);
        }
        sets[dim] = { mode: r.mode, ids, applies_to: r.applies_to || 'parties' };
    }
    const base = (dim, id) => {
        const s = sets[dim];
        if (!s || id === null || id === undefined || id === '') return true;
        return s.mode === 'only' ? s.ids.has(String(id)) : !s.ids.has(String(id));
    };

    // ledgers hidden through their area / category, or by an 'only' list on parties
    let hiddenLedgers = null;
    if (sets.area || sets.ledger_category || (sets.ledger && sets.ledger.mode === 'only' && sets.ledger.applies_to === 'parties')) {
        hiddenLedgers = new Set();
        const [leds, links] = await Promise.all([
            fetchAll(() => c.from('ledger_accounts').select('id, area_id, ledger_category_id, category_type').eq('tenant_id', t).order('id')),
            sets.ledger_category ? fetchAll(() => c.from('ledger_account_categories').select('ledger_account_id, ledger_category_id').eq('tenant_id', t).order('id')) : []
        ]);
        const cats = {};
        leds.forEach(l => { cats[l.id] = l.ledger_category_id ? [l.ledger_category_id] : []; });
        links.forEach(x => { (cats[x.ledger_account_id] = cats[x.ledger_account_id] || []).push(x.ledger_category_id); });
        leds.forEach(l => {
            const party = ['sales', 'purchase', 'both'].includes(l.category_type);
            if (sets.ledger && sets.ledger.mode === 'only' && sets.ledger.applies_to === 'parties' && party && !sets.ledger.ids.has(l.id)) hiddenLedgers.add(l.id);
            if (l.area_id && !base('area', l.area_id)) hiddenLedgers.add(l.id);
            const lc = cats[l.id] || [];
            if (sets.ledger_category && lc.length) {
                const s = sets.ledger_category;
                const ok = s.mode === 'only' ? lc.some(x => s.ids.has(x)) : !lc.some(x => s.ids.has(x));
                if (!ok) hiddenLedgers.add(l.id);
            }
        });
    }
    // products hidden through their group / company
    let hiddenProducts = null;
    if (sets.product_group || sets.product_company) {
        hiddenProducts = new Set();
        const prods = await fetchAll(() => c.from('products').select('id, product_group_id, product_company_id').eq('tenant_id', t).order('id'));
        prods.forEach(p => { if (!base('product_group', p.product_group_id) || !base('product_company', p.product_company_id)) hiddenProducts.add(p.id); });
    }
    const strictLedger = sets.ledger && !(sets.ledger.mode === 'only' && sets.ledger.applies_to === 'parties');
    const allow = {
        ledger: id => (id === null || id === undefined || id === '' || /^cash:/.test(String(id))) ? true
            : !(hiddenLedgers && hiddenLedgers.has(String(id))) && (strictLedger ? base('ledger', id) : true),
        product: id => base('product', id) && !(hiddenProducts && hiddenProducts.has(String(id))),
        sub_ledger: id => base('sub_ledger', id),
        product_group: id => base('product_group', id),
        product_company: id => base('product_company', id),
        area: id => base('area', id),
        ledger_category: id => base('ledger_category', id)
    };
    return { rules: sets, allow, dims: Object.keys(sets) };
}

async function scopeFor(tenantId, userId, client) {
    if (!tenantId || !userId) return null;
    const k = `${tenantId}|${userId}`, hit = cache.get(k);
    if (hit && Date.now() - hit.at < TTL) return hit.scope;
    const c = client || await getTenantClient(tenantId);
    const scope = await buildScope(c, tenantId, userId);
    cache.set(k, { at: Date.now(), scope });
    return scope;
}

/** Scope of the current request, for report engines (GET only). */
async function reportScope() {
    const ctx = currentContext();
    if (!ctx || ctx.method !== 'GET' || ctx.isSuperAdmin || ctx.noDataScope) return null;
    try { return await scopeFor(ctx.tenantId, ctx.userId); } catch { return null; }
}

// ---------- checking / filtering ----------
function violation(obj, scope, idDim, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    if (Array.isArray(obj)) { for (const x of obj) { const v = violation(x, scope, idDim, depth + 1); if (v) return v; } return null; }
    for (const [k, v] of Object.entries(obj)) {
        const dim = REF_KEYS[k];
        if (dim && (typeof v === 'string' || typeof v === 'number') && !scope.allow[dim](v)) return dim;
        if (dim && Array.isArray(v) && v.some(x => typeof x === 'string' && !scope.allow[dim](x))) return dim;
        if (k.endsWith('_ids') && REF_KEYS[k.replace(/_ids$/, '_id')] && Array.isArray(v)) {
            const d = REF_KEYS[k.replace(/_ids$/, '_id')];
            if (v.some(x => !scope.allow[d](x))) return d;
        }
        if (v && typeof v === 'object') { const inner = violation(v, scope, null, depth + 1); if (inner) return inner; }
    }
    if (idDim && obj.id && !scope.allow[idDim](obj.id)) return idDim;
    return null;
}
function rowAllowed(row, scope, idDim) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
    for (const [k, dim] of Object.entries(REF_KEYS)) if (k in row && (typeof row[k] === 'string' || typeof row[k] === 'number') && !scope.allow[dim](row[k])) return false;
    if (idDim && row.id !== undefined && !scope.allow[idDim](row.id)) return false;
    return true;
}
const isDoc = o => DOC_KEYS.some(k => o[k] !== undefined && o[k] !== null);
function filterNode(node, scope, idDim) {
    if (Array.isArray(node)) return node.filter(x => rowAllowed(x, scope, idDim)).map(x => filterNode(x, scope, null));
    if (!node || typeof node !== 'object') return node;
    if (isDoc(node)) return node;                              // a document's own lines stay intact
    const out = Array.isArray(node) ? [] : {};
    for (const [k, v] of Object.entries(node)) {
        if (Array.isArray(v)) out[k] = filterNode(v, scope, LIST_KEYS[k] || (k === 'children' ? idDim : null));
        else if (v && typeof v === 'object') out[k] = filterNode(v, scope, null);
        else out[k] = v;
    }
    return out;
}
const dimOfPath = p => (PATH_DIMS.find(([re]) => re.test(p)) || [])[1] || null;
const DIM_LABEL = { ledger: 'ledger / party', sub_ledger: 'sub-ledger', product: 'product', product_group: 'product group', product_company: 'product company', area: 'area', ledger_category: 'customer category' };

/** Filter a response body ({ success, data }) for this scope and path. */
function filterBody(body, scope, path) {
    if (!body || typeof body !== 'object' || !('data' in body)) return body;
    const idDim = dimOfPath(path);
    const d = body.data;
    if (d && typeof d === 'object' && !Array.isArray(d) && isDoc(d) && !rowAllowed(d, scope, null)) return { denied: true };
    if (d && typeof d === 'object' && !Array.isArray(d) && idDim && d.id !== undefined && !Array.isArray(d.children) && !rowAllowed(d, scope, idDim)) return { denied: true };
    return { ...body, data: filterNode(d, scope, idDim) };
}

/**
 * Express step run by requireAuth (after the request context is set).
 * Unrestricted users cost one cached lookup.
 */
async function guard(req, res, next) {
    try {
        const path = String(req.path || req.originalUrl || '').replace(/^\/api/, '').split('?')[0];
        if (!req.auth || req.auth.isSuperAdmin || !req.auth.tenantId || EXEMPT.test(path)) return next();
        const scope = await scopeFor(req.auth.tenantId, req.auth.userId);
        if (!scope) return next();
        req.dataScope = scope;
        const bad = violation(req.method === 'GET' ? req.query : { ...req.query, ...(req.body || {}) }, scope, null);
        if (bad) return res.status(403).json({ success: false, error: `You do not have access to this ${DIM_LABEL[bad]} (data access rules)` });
        const json = res.json.bind(res);
        res.json = body => {
            if (res.statusCode >= 400) return json(body);
            const out = filterBody(body, scope, path);
            if (out && out.denied) { res.status(403); return json({ success: false, error: 'You do not have access to this record (data access rules)' }); }
            return json(out);
        };
        return next();
    } catch (e) {
        return res.status(500).json({ success: false, error: `Data access check failed: ${e.message}` });
    }
}

// ---------- rules screen ----------
async function listRules(c, t, { user_id, security_group_id }) {
    let q = c.from('data_access_rules').select('*').eq('tenant_id', t);
    q = user_id ? q.eq('user_id', user_id) : q.eq('security_group_id', security_group_id);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}
async function saveRules(c, t, actor, { user_id, security_group_id, rules }) {
    if (!!user_id === !!security_group_id) throw Object.assign(new Error('Choose a user or a security group'), { status: 400 });
    if (!Array.isArray(rules)) throw Object.assign(new Error('rules must be a list'), { status: 400 });
    const owner = user_id ? { user_id } : { security_group_id };
    for (const r of rules) {
        if (!DIMS[r.dimension]) throw Object.assign(new Error(`Unknown dimension ${r.dimension}`), { status: 400 });
        // inherit = no row (a user follows the security group); all = no restriction
        // (kept as a row for a user so it overrides a group restriction)
        const mode = ['inherit', 'all', 'only', 'except'].includes(r.mode) ? r.mode : 'inherit';
        let del = c.from('data_access_rules').delete().eq('tenant_id', t).eq('dimension', r.dimension);
        del = user_id ? del.eq('user_id', user_id) : del.eq('security_group_id', security_group_id);
        const { error: e1 } = await del;
        if (e1) throw e1;
        if (mode === 'inherit' || (mode === 'all' && security_group_id)) continue;
        const ids = mode === 'all' ? [] : [...new Set((r.ids || []).filter(x => /^[0-9a-f-]{36}$/i.test(x)))];
        const { error } = await c.from('data_access_rules').insert({ tenant_id: t, ...owner, dimension: r.dimension, mode, ids,
            applies_to: r.applies_to === 'all' ? 'all' : 'parties', updated_by: actor, updated_at: new Date().toISOString() });
        if (error) throw error;
    }
    clearCache(t);
    return listRules(c, t, { user_id, security_group_id });
}
async function options(c, t, dim) {
    const d = DIMS[dim];
    if (!d) throw Object.assign(new Error('Unknown dimension'), { status: 400 });
    const extra = dim === 'ledger' ? ', category_type, area_id' : d.parent ? `, ${d.parent}` : '';
    const rows = await fetchAll(() => c.from(d.table).select(`id, ${d.name}${extra}`).eq('tenant_id', t).order(d.name));
    return rows.map(r => ({ id: r.id, name: r[d.name], parent_id: d.parent ? r[d.parent] : null, party: dim === 'ledger' ? ['sales', 'purchase', 'both'].includes(r.category_type) : undefined }));
}
/** What a user would see: counts per dimension. */
async function preview(c, t, userId) {
    const scope = await buildScope(c, t, userId);
    const out = {};
    for (const [dim, d] of Object.entries(DIMS)) {
        const rows = await fetchAll(() => c.from(d.table).select('id').eq('tenant_id', t).order('id'));
        out[dim] = { total: rows.length, visible: scope ? rows.filter(r => scope.allow[dim](r.id)).length : rows.length };
    }
    return { restricted: !!scope, dims: out };
}

module.exports = { DIMS, REF_KEYS, guard, reportScope, scopeFor, buildScope, filterBody, violation, clearCache, listRules, saveRules, options, preview };
