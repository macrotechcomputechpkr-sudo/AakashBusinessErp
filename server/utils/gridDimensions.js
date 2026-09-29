// =============================================
// utils/gridDimensions.js
// The attributes of every product and ledger in one small list, so the
// report grid (client hooks/useSmartTables.jsx) can add them as fields of
// any report that shows a product or a party: Product Group, Product
// Company, Product Category, Unit; Account Group, Area, Route, Salesman /
// Agent, Customer Category, PAN. They are then filtered, grouped and
// pivoted in the grid's Field Selector instead of a filter box on each
// report. GET /api/grid-dimensions (routes/gridDimensionRoutes.js); the
// data-access guard filters `products` / `ledgers` by the user's rules.
// =============================================
const PAGE = 1000;

/** every row of a table (paged; supabase returns 1000 at a time) */
async function all(c, table, tenantId) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await c.from(table).select('*').eq('tenant_id', tenantId).range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < PAGE) break;
    }
    return out;
}
const safe = async (fn, fallback = []) => { try { return await fn(); } catch { return fallback; } };
const byId = (rows, name) => new Map(rows.map(r => [r.id, r[name]]));

async function load(c, tenantId) {
    const get = t => safe(() => all(c, t, tenantId));
    const [products, groups, companies, catLinks, categories, units, ledgers, accGroups, areas, routes, agents, ledCatLinks, ledCats] = await Promise.all([
        get('products'), get('product_groups'), get('product_companies'), get('product_category_links'), get('product_categories'), get('product_units'),
        get('ledger_accounts'), get('account_groups'), get('areas'), get('routes'), get('salesman_agents'), get('ledger_account_categories'), get('ledger_categories')
    ]);
    const G = byId(groups, 'group_name'), C = byId(companies, 'company_name'), PC = byId(categories, 'category_name'), U = byId(units, 'unit_name');
    const AG = byId(accGroups, 'group_name'), A = byId(areas, 'area_name'), R = byId(routes, 'route_name'), S = byId(agents, 'agent_name'), LC = byId(ledCats, 'category_name');
    const multi = (links, key, ownerKey, names) => {
        const m = new Map();
        links.forEach(l => { const n = names.get(l[key]); if (!n) return; if (!m.has(l[ownerKey])) m.set(l[ownerKey], []); m.get(l[ownerKey]).push(n); });
        return m;
    };
    const pcats = multi(catLinks, 'product_category_id', 'product_id', PC);
    const lcats = multi(ledCatLinks, 'ledger_category_id', 'ledger_account_id', LC);
    return {
        products: products.map(p => ({
            id: p.id, code: p.product_code || '', name: p.product_name || '', short: p.short_name || '',
            group: G.get(p.product_group_id) || '', company: C.get(p.product_company_id) || '',
            category: (pcats.get(p.id) || []).join(', '), unit: U.get(p.base_unit_id) || ''
        })),
        ledgers: ledgers.map(l => ({
            id: l.id, code: l.account_code || '', name: l.account_name || '', short: l.short_name || '',
            group: AG.get(l.account_group_id) || '', area: A.get(l.area_id) || '', route: R.get(l.route_id) || '',
            agent: S.get(l.agent_id) || '', category: (lcats.get(l.id) || []).join(', '), pan: l.pan_number || l.vat_pan_number || ''
        }))
    };
}

module.exports = { load };
