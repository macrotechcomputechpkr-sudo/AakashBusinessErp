// =============================================
// utils/stockInOut.js
// Stock In / Out report - quantity only:  Opening | Receipt | Issue | Balance
// per product, laid out
//   branch    - per branch (its warehouses via branch_warehouse_mapping)
//   warehouse - per warehouse
//   product   - company total per product
// Receipt / Issue are every stock line in the period (purchase, sales,
// returns, production, adjustment ...). A stock transfer counts only where
// it really moves stock: its in and out net off inside one row, so a
// transfer within a branch shows nothing in the branch view and nothing in
// the product view. Goods of a two-step branch transfer dispatched but not
// yet received sit in a "Goods in Transit" row, and product opening stock
// (not linked to a warehouse) in an "Opening stock - no warehouse" row, so
// the rows always add up to company stock.
// Product filters are the Stock Report's (utils/stockReport.js); the stock
// status filter works on the balance qty.
// =============================================
const { parseQuery, loadProducts, statusOk } = require('./stockReport');

const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const dayBefore = d => new Date(new Date(d + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

const VIEWS = ['branch', 'warehouse', 'product'];
const OPENING = '__opening__', TRANSIT = '__transit__', NO_BRANCH = '__no_branch__', ALL = '__all__';
const PSEUDO_NAME = { [OPENING]: 'Opening stock - no warehouse', [TRANSIT]: 'Goods in Transit', [NO_BRANCH]: '(No branch)', [ALL]: '' };

async function stockInOut(c, t, q) {
    const f = { ...parseQuery({ ...q, mode: 'summary' }), view: VIEWS.includes(q.view) ? q.view : 'branch', branchId: q.branch_id || null };
    const { products, info } = await loadProducts(c, t, f);
    const ids = new Set(products.map(p => p.id));

    const [warehouses, branches, maps, transfers, fyRes] = await Promise.all([
        fetchAll(() => c.from('warehouses').select('id, warehouse_code, warehouse_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('branches').select('id, branch_code, branch_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('branch_warehouse_mapping').select('branch_id, warehouse_id, is_primary, default_warehouse').eq('tenant_id', t).eq('is_active', true).order('id')),
        fetchAll(() => c.from('stock_transfers').select('id').eq('tenant_id', t).eq('requires_receipt', true).order('id')),
        c.from('fiscal_years').select('start_date_eng').eq('tenant_id', t).eq('has_opening_balance', true).maybeSingle()
    ]);
    const openingDay = fyRes.data?.start_date_eng ? dayBefore(String(fyRes.data.start_date_eng).slice(0, 10)) : '0000-01-01';
    const whName = Object.fromEntries(warehouses.map(w => [w.id, w.warehouse_name]));
    const brName = Object.fromEntries(branches.map(b => [b.id, b.branch_name]));
    const twoStep = new Set(transfers.map(x => x.id));

    // A warehouse mapped to several branches belongs to its primary mapping (else the first).
    const branchOf = {};
    [...maps].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)).forEach(m => { if (!branchOf[m.warehouse_id]) branchOf[m.warehouse_id] = m.branch_id; });
    const branchWhs = f.branchId ? new Set(Object.keys(branchOf).filter(w => branchOf[w] === f.branchId)) : null;
    const whOk = w => (!f.warehouseId || w === f.warehouseId) && (!branchWhs || branchWhs.has(w));
    const located = !!(f.warehouseId || f.branchId);        // opening / transit belong to no warehouse or branch

    const locOf = w => f.view === 'product' ? ALL : f.view === 'warehouse' ? w : branchOf[w] || NO_BRANCH;
    const pseudo = key => f.view === 'product' ? ALL : key;

    const moves = ids.size ? await fetchAll(() => {
        let qq = c.from('stock_movements').select('id, product_id, warehouse_id, movement_date, qty_in, qty_out, source_type, source_id')
            .eq('tenant_id', t).lte('movement_date', f.to).order('id');
        if (f.productId) qq = qq.eq('product_id', f.productId);
        if (f.warehouseId) qq = qq.eq('warehouse_id', f.warehouseId);
        return qq;
    }) : [];

    const rows = new Map();
    const rowFor = (loc, pid) => {
        const key = `${loc}|${pid}`;
        if (!rows.has(key)) rows.set(key, { loc, product_id: pid, opening: 0, receipt: 0, issue: 0, transfers: {} });
        return rows.get(key);
    };
    // Before `from` everything is opening; in the period a transfer is netted
    // per document inside its row, anything else is receipt / issue as it is.
    const add = (loc, pid, date, qin, qout, transferId) => {
        const r = rowFor(loc, pid);
        if (date < f.from) { r.opening += qin - qout; return; }
        if (transferId) { r.transfers[transferId] = (r.transfers[transferId] || 0) + qin - qout; return; }
        r.receipt += qin; r.issue += qout;
    };

    if (!located) products.forEach(p => { if (Number(p.opening_qty) > 0) add(pseudo(OPENING), p.id, openingDay, Number(p.opening_qty), 0, null); });
    moves.forEach(m => {
        if (!ids.has(m.product_id) || !whOk(m.warehouse_id)) return;
        const date = String(m.movement_date).slice(0, 10), qin = Number(m.qty_in) || 0, qout = Number(m.qty_out) || 0;
        const transferId = m.source_type === 'stock_transfer' ? m.source_id : null;
        add(locOf(m.warehouse_id), m.product_id, date, qin, qout, transferId);
        // Two-step transfer: what leaves a warehouse enters transit, what arrives leaves it.
        if (transferId && twoStep.has(transferId) && !located) add(pseudo(TRANSIT), m.product_id, date, qout, qin, transferId);
    });

    const nameOf = loc => PSEUDO_NAME[loc] ?? (f.view === 'warehouse' ? whName[loc] : brName[loc]) ?? '(unknown)';
    const orderOf = loc => (loc === OPENING ? 2 : loc === TRANSIT ? 1 : loc === NO_BRANCH ? 0.5 : 0);
    let out = [...rows.values()].map(r => {
        Object.values(r.transfers).forEach(n => { if (n > 0) r.receipt += n; else r.issue -= n; });
        const p = info[r.product_id], k = p.factor;
        const balance = r.opening + r.receipt - r.issue;
        return {
            location_id: r.loc === ALL ? null : r.loc, location_name: nameOf(r.loc), location_kind: [OPENING, TRANSIT].includes(r.loc) ? r.loc.replace(/_/g, '') : f.view,
            _order: orderOf(r.loc), _balance_base: balance,
            product_id: p.product_id, product_code: p.product_code, product_name: p.product_name, group_name: p.group_name, company_name: p.company_name,
            unit: p.unit, minimum_stock: p.minimum_stock,
            opening: round4(r.opening / k), receipt: round4(r.receipt / k), issue: round4(r.issue / k), balance: round4(balance / k)
        };
    });
    if (f.hideZero) out = out.filter(r => r.opening || r.receipt || r.issue || r.balance);
    out = out.filter(r => statusOk(f, r._balance_base, r.minimum_stock));
    out.sort((a, b) => a._order - b._order || a.location_name.localeCompare(b.location_name) || a.product_name.localeCompare(b.product_name));
    out.forEach(r => { delete r._order; delete r._balance_base; });

    const sum = list => ['opening', 'receipt', 'issue', 'balance'].reduce((s, k) => ({ ...s, [k]: round4(list.reduce((x, r) => x + r[k], 0)) }), {});
    const groups = [];
    if (f.view !== 'product') {
        out.forEach(r => {
            let g = groups[groups.length - 1];
            if (!g || g.location_name !== r.location_name) groups.push(g = { location_id: r.location_id, location_name: r.location_name, location_kind: r.location_kind, rows: [] });
            g.rows.push(r);
        });
        groups.forEach(g => { g.totals = sum(g.rows); });
    }
    const warnings = [];
    if (located && products.some(p => Number(p.opening_qty) > 0)) warnings.push('Product opening stock is not linked to a warehouse, so it is left out when filtering by branch / warehouse.');
    // Qty totals across products only make sense in one unit.
    const oneUnit = new Set(out.map(r => r.unit)).size <= 1;
    return { view: f.view, from: f.from, to: f.to, rows: out, groups, totals: oneUnit ? sum(out) : null, mixed_units: !oneUnit, warnings };
}

module.exports = { stockInOut };
