// =============================================
// grid/dimensions.js - product / party attributes as grid fields
// A report that shows an item or a party gets that item's Product Group,
// Product Company, Product Category and Unit, and that party's Account
// Group, Area, Route, Salesman / Agent, Customer Category and PAN as extra
// fields of its grid - hidden at first, ready in 📋 Columns (Field
// Selector) to show, filter (Filters area / ▾), group (Rows) or pivot
// (Columns). So a report needs only its dates up top; everything else is
// filtered in the grid.
// The lists come from GET /api/grid-dimensions (kept 10 minutes per company).
// A column is taken as the item / party column when at least half of its
// values are a product / ledger name or code ("Lux Soap SOAP" = name + code works).
// =============================================
const TTL = 10 * 60 * 1000;
let cache = { key: '', at: 0, promise: null };

export function loadDimensions(authFetch, tenantKey) {
    const now = Date.now();
    if (cache.promise && cache.key === tenantKey && now - cache.at < TTL) return cache.promise;
    cache = { key: tenantKey, at: now, promise: authFetch('/api/grid-dimensions').then(r => r.data || null).catch(() => null) };
    return cache.promise;
}
export const clearDimensions = () => { cache = { key: '', at: 0, promise: null }; };

export const PRODUCT_ATTRS = [['group', 'Product Group'], ['company', 'Product Company'], ['category', 'Product Category'], ['unit', 'Unit']];
export const LEDGER_ATTRS = [['group', 'Account Group'], ['area', 'Area'], ['route', 'Route'], ['agent', 'Salesman / Agent'], ['category', 'Customer Category'], ['pan', 'PAN']];

const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
function indexOf(list) {
    const m = new Map();
    (list || []).forEach(x => [x.name, x.code, x.short].forEach(k => { const n = norm(k); if (n && !m.has(n)) m.set(n, x); }));
    return m;
}
/** the item of a cell: its name or code, or "name code" / "code name" */
export function lookup(idx, text) {
    const t = norm(text);
    if (!t) return null;
    const hit = idx.get(t);
    if (hit) return hit;
    const i = t.lastIndexOf(' '), j = t.indexOf(' ');
    if (i < 0) return null;
    return idx.get(t.slice(0, i)) || idx.get(t.slice(j + 1)) || null;
}

/** best column for an index: most rows matched, at least half of its filled values */
function bestColumn(columns, rows, idx, skip) {
    let best = null;
    const sample = rows.slice(0, 300);
    columns.forEach(c => {
        if (c.type === 'number' || skip.has(c.key) || c.dim) return;
        let filled = 0, hits = 0;
        sample.forEach(r => {
            const v = c.text ? c.text(r) : r[c.key];
            if (v === null || v === undefined || String(v).trim() === '' || String(v) === '(none)') return;
            filled += 1;
            if (lookup(idx, v)) hits += 1;
        });
        if (filled && hits / filled >= 0.5 && (!best || hits > best.hits)) best = { key: c.key, col: c, hits };
    });
    return best;
}

/**
 * columns + rows -> the same with the attribute fields added (hidden).
 * Fields a report already has (same caption) are not added again.
 */
export function withDimensions(columns, rows, dims) {
    if (!dims || !rows.length) return { columns, rows };
    const have = new Set(columns.map(c => norm(String(c.label).split(' › ').pop())));
    const pIdx = indexOf(dims.products), lIdx = indexOf(dims.ledgers);
    const prod = bestColumn(columns, rows, pIdx, new Set());
    const led = bestColumn(columns, rows, lIdx, new Set(prod ? [prod.key] : []));
    const add = [];
    const plan = [];
    if (prod) plan.push({ src: prod, idx: pIdx, attrs: PRODUCT_ATTRS, tag: 'p' });
    if (led) plan.push({ src: led, idx: lIdx, attrs: LEDGER_ATTRS, tag: 'l' });
    plan.forEach(p => p.attrs.forEach(([a, label]) => {
        if (have.has(norm(label)) || (p.tag === 'l' && a === 'group' && have.has('group') && !prod)) return;
        add.push({ key: `__d_${p.tag}_${a}`, label, dim: true, hidden: true, from: p, attr: a });
    }));
    if (!add.length) return { columns, rows };
    const textOf = (c, r) => (c.text ? c.text(r) : r[c.key]);
    const out = rows.map(r => {
        const extra = {};
        plan.forEach(p => {
            const item = lookup(p.idx, textOf(p.src.col, r));
            add.filter(c => c.from === p).forEach(c => { extra[c.key] = item ? item[c.attr] || '(none)' : ''; });
        });
        return { ...r, ...extra };
    });
    return { columns: [...columns, ...add.map(({ from, attr, ...c }) => c)], rows: out };
}
