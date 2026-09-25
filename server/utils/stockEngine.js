// =============================================
// utils/stockEngine.js
// ONE engine for stock quantity and value, used by the Stock Movement
// report AND by the financial statements' Closing / Opening Stock, so the
// figures always match.
//
// For a period [from, to] and a valuation method, per item:
//   Opening qty/value (end of the day before `from`)
//   In  - qty/value by module (purchase GRN / bill, sales return, production ...)
//   Out - qty/value by module (sales delivery / bill, purchase return, consumption ...)
//   Closing qty/value (end of `to`)
// and always  Opening + In - Out = Closing  (qty and value).
//
// Methods: fifo, lifo, moving_average, weighted_average (periodic),
// last_purchase. FIFO / LIFO / moving average cost each issue as it
// happens; for periodic methods the cost of issues is the balancing figure
// (opening + receipts - closing), spread over the issuing modules by
// quantity. Product opening stock is a receipt on hand at the end of the day
// before the opening fiscal year starts. Stock transfers move stock between
// warehouses only: shown in and out at the same value, they net to zero.
// =============================================

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
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

const METHODS = {
    weighted_average: 'Weighted Average (periodic)', moving_average: 'Moving Average (perpetual)', fifo: 'FIFO',
    lifo: 'LIFO (not permitted by NFRS / IAS 2 - comparison only)', last_purchase: 'Last Purchase Rate'
};
const MODULE_LABEL = {
    opening: 'Opening Stock', purchase_grn: 'Purchase (GRN)', purchase_bill: 'Purchase (Direct Bill)', purchase_return: 'Purchase Return',
    purchase_nonsalable_return: 'Purchase Non-saleable Return', sales_delivery: 'Sales (Delivery)', sales_bill: 'Sales (Direct Bill)',
    sales_return: 'Sales Return', sales_nonsalable_return: 'Sales Non-saleable Return', production: 'Production', stock_transfer: 'Stock Transfer',
    stock_adjustment: 'Stock Adjustment'
};
const PURCHASE_SOURCES = new Set(['opening', 'purchase_grn', 'purchase_bill', 'production']);
// Normal (summary) view: GRN and direct Purchase Bill are both "Purchase",
// Delivery (GDN) and direct Sales Bill are both "Sales"; non-saleable returns
// join their return column. 'detail' keeps every module separate.
const SUMMARY_OF = { purchase_grn: 'purchase', purchase_bill: 'purchase', purchase_return: 'purchase_return', purchase_nonsalable_return: 'purchase_return',
    sales_delivery: 'sales', sales_bill: 'sales', sales_return: 'sales_return', sales_nonsalable_return: 'sales_return', production: 'production', stock_transfer: 'stock_transfer',
    stock_adjustment: 'stock_adjustment' };
const SUMMARY_LABEL = { purchase: 'Purchase', purchase_return: 'Purchase Return', sales: 'Sales', sales_return: 'Sales Return', production: 'Production', stock_transfer: 'Stock Transfer',
    stock_adjustment: 'Stock Adjustment' };

// Running state of one item under one method.
function newState() { return { qty: 0, avg: 0, layers: [], sumQ: 0, sumV: 0, last: 0 }; }
function rateOf(st, method) {
    if (method === 'moving_average') return st.avg;
    if (method === 'last_purchase') return st.last || st.avg;
    if (method === 'weighted_average') return st.sumQ > 0 ? st.sumV / st.sumQ : 0;
    return st.qty > 0 ? st.layers.reduce((s, L) => s + L.q * L.c, 0) / st.qty : st.avg;
}
function valueOf(st, method) {
    if (st.qty <= 1e-9) return 0;                      // nil or negative stock carries no value
    if (method === 'fifo' || method === 'lifo') return st.layers.reduce((s, L) => s + L.q * L.c, 0);
    return st.qty * rateOf(st, method);
}
function receive(st, qty, cost) {
    const c = cost > 0 ? cost : st.avg;                // a receipt without cost (e.g. a return) comes in at the current average
    st.avg = st.qty + qty > 0 ? (Math.max(st.qty, 0) * st.avg + qty * c) / (Math.max(st.qty, 0) + qty) : c;
    st.qty += qty; st.layers.push({ q: qty, c }); st.sumQ += qty; st.sumV += qty * c;
    return qty * c;
}
function issue(st, qty, method) {                      // returns the natural cost of this issue
    let cost = 0;
    if (method === 'fifo' || method === 'lifo') {
        let need = qty;
        while (need > 1e-9 && st.layers.length) {
            const L = method === 'lifo' ? st.layers[st.layers.length - 1] : st.layers[0];
            const take = Math.min(L.q, need); L.q -= take; need -= take; cost += take * L.c;
            if (L.q <= 1e-9) method === 'lifo' ? st.layers.pop() : st.layers.shift();
        }
    } else {
        cost = qty * rateOf(st, method);
        // keep FIFO layers in step so rateOf() for non-layer methods is unaffected
        let need = qty;
        while (need > 1e-9 && st.layers.length) { const L = st.layers[0]; const take = Math.min(L.q, need); L.q -= take; need -= take; if (L.q <= 1e-9) st.layers.shift(); }
    }
    st.qty -= qty;
    return cost;
}

async function loadItems(tenantClient, tenantId, to, filters = {}) {
    let pq = () => {
        let q = tenantClient.from('products').select('id, product_code, product_name, opening_qty, opening_rate, product_group_id, product_company_id').eq('tenant_id', tenantId);
        if (filters.productId) q = q.eq('id', filters.productId);
        if (filters.productGroupId) q = q.eq('product_group_id', filters.productGroupId);
        if (filters.productCompanyId) q = q.eq('product_company_id', filters.productCompanyId);
        return q;
    };
    const products = await fetchAll(pq);
    const { data: fy } = await tenantClient.from('fiscal_years').select('start_date_eng').eq('tenant_id', tenantId).eq('has_opening_balance', true).maybeSingle();
    const openingDay = fy?.start_date_eng ? dayBefore(String(fy.start_date_eng).slice(0, 10)) : '0000-01-01';
    const ids = new Set(products.map(p => p.id));
    const moves = (await fetchAll(() => tenantClient.from('stock_movements')
        .select('product_id, movement_date, qty_in, qty_out, unit_cost, source_type, created_at').eq('tenant_id', tenantId).lte('movement_date', to)))
        .filter(m => ids.has(m.product_id));
    const events = {};
    products.forEach(p => {
        events[p.id] = [];
        if (Number(p.opening_qty) > 0) events[p.id].push({ date: openingDay, seq: '', qin: Number(p.opening_qty), qout: 0, cost: Number(p.opening_rate) || 0, src: 'opening' });
    });
    moves.forEach(m => events[m.product_id].push({ date: String(m.movement_date).slice(0, 10), seq: m.created_at || '', qin: Number(m.qty_in) || 0, qout: Number(m.qty_out) || 0, cost: Number(m.unit_cost) || 0, src: m.source_type || 'other' }));
    Object.values(events).forEach(ev => ev.sort((a, b) => a.date.localeCompare(b.date) || String(a.seq).localeCompare(String(b.seq))));
    return { products, events };
}

// Core: one item's movement over [from, to] (from = null => opening is nil and everything is "in period").
function itemMovement(ev, method, from, to) {
    const st = newState();
    let opening = null;
    const inBy = {}, outBy = {}, outNatural = {};
    const snap = () => ({ qty: st.qty, value: valueOf(st, method) });
    for (const e of ev) {
        if (e.date > to) break;
        const inPeriod = !from || e.date >= from;
        if (inPeriod && !opening) opening = snap();
        if (e.src === 'stock_transfer') {               // company level: no effect on qty or cost
            if (inPeriod) {
                const r = rateOf(st, method);
                if (e.qin) { (inBy[e.src] = inBy[e.src] || { qty: 0, value: 0 }).qty += e.qin; inBy[e.src].value += e.qin * r; }
                if (e.qout) { (outBy[e.src] = outBy[e.src] || { qty: 0, value: 0 }).qty += e.qout; outBy[e.src].value += e.qout * r; }
            }
            continue;
        }
        if (e.qin > 0) {
            const v = receive(st, e.qin, e.cost);
            if (e.cost > 0 && PURCHASE_SOURCES.has(e.src)) st.last = e.cost;
            if (inPeriod) { const b = (inBy[e.src] = inBy[e.src] || { qty: 0, value: 0 }); b.qty += e.qin; b.value += v; }
        }
        if (e.qout > 0) {
            const natural = issue(st, e.qout, method);
            if (inPeriod) { const b = (outBy[e.src] = outBy[e.src] || { qty: 0, value: 0 }); b.qty += e.qout; outNatural[e.src] = (outNatural[e.src] || 0) + natural; }
        }
    }
    if (!opening) opening = snap();                     // nothing happened in the period
    const closing = snap();
    // Cost of issues so that Opening + In - Out = Closing exactly, spread by natural cost (or qty).
    const inValue = Object.entries(inBy).filter(([k]) => k !== 'stock_transfer').reduce((s, [, b]) => s + b.value, 0);
    const outTotal = opening.value + inValue - closing.value;
    const srcs = Object.keys(outBy).filter(k => k !== 'stock_transfer');
    const naturalSum = srcs.reduce((s, k) => s + (outNatural[k] || 0), 0);
    const qtySum = srcs.reduce((s, k) => s + outBy[k].qty, 0);
    srcs.forEach(k => { outBy[k].value = naturalSum > 1e-9 ? outTotal * (outNatural[k] || 0) / naturalSum : (qtySum ? outTotal * outBy[k].qty / qtySum : 0); });
    return { opening, closing, inBy, outBy, negative: st.qty < -1e-9 };
}

// Stock movement for many items. Returns rows + module list + totals.
async function stockMovement(tenantClient, tenantId, { from, to, method = 'weighted_average', productId, productGroupId, productCompanyId, hideZero = true, columns = 'summary' }) {
    if (!METHODS[method]) method = 'weighted_average';
    const { products, events } = await loadItems(tenantClient, tenantId, to, { productId, productGroupId, productCompanyId });
    const modulesIn = new Set(), modulesOut = new Set(), warnings = [];
    let rows = products.map(p => {
        const m = itemMovement(events[p.id], method, from, to);
        if (m.negative) warnings.push(`${p.product_name}: negative stock ${round4(m.closing.qty)} - valued at zero`);
        const fold = obj => {
            if (columns === 'detail') return obj;
            const out = {};
            Object.entries(obj).forEach(([k, b]) => { const g = SUMMARY_OF[k] || k; out[g] = out[g] || { qty: 0, value: 0 }; out[g].qty += b.qty; out[g].value += b.value; });
            return out;
        };
        m.inBy = fold(m.inBy); m.outBy = fold(m.outBy);
        Object.keys(m.inBy).forEach(k => modulesIn.add(k)); Object.keys(m.outBy).forEach(k => modulesOut.add(k));
        const fix = obj => Object.fromEntries(Object.entries(obj).map(([k, b]) => [k, { qty: round4(b.qty), value: round2(b.value) }]));
        const inBy = fix(m.inBy), outBy = fix(m.outBy);
        const inQty = Object.values(inBy).reduce((s, b) => s + b.qty, 0), outQty = Object.values(outBy).reduce((s, b) => s + b.qty, 0);
        const inVal = Object.values(inBy).reduce((s, b) => s + b.value, 0), outVal = Object.values(outBy).reduce((s, b) => s + b.value, 0);
        return {
            product_id: p.id, product_code: p.product_code, product_name: p.product_name, product_group_id: p.product_group_id,
            opening_qty: round4(m.opening.qty), opening_value: round2(m.opening.value),
            in: inBy, out: outBy, in_qty: round4(inQty), in_value: round2(inVal), out_qty: round4(outQty), out_value: round2(outVal),
            closing_qty: round4(m.closing.qty), closing_value: round2(m.closing.value),
            closing_rate: m.closing.qty > 1e-9 ? round2(m.closing.value / m.closing.qty) : 0
        };
    });
    if (hideZero) rows = rows.filter(r => r.opening_qty || r.in_qty || r.out_qty || r.closing_qty);
    // Rounding: make each row's value identity exact at 2 decimals by trimming the out figure.
    rows.forEach(r => {
        const gap = round2(r.opening_value + r.in_value - r.out_value - r.closing_value);
        if (gap && Object.keys(r.out).length) { const k = Object.keys(r.out).find(x => x !== 'stock_transfer') || Object.keys(r.out)[0]; r.out[k].value = round2(r.out[k].value + gap); r.out_value = round2(r.out_value + gap); }
    });
    rows.sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)));
    const orderIn = columns === 'detail' ? ['opening', 'purchase_grn', 'purchase_bill', 'sales_return', 'sales_nonsalable_return', 'production', 'stock_adjustment', 'stock_transfer'] : ['purchase', 'sales_return', 'production', 'stock_adjustment', 'stock_transfer'];
    const orderOut = columns === 'detail' ? ['sales_delivery', 'sales_bill', 'purchase_return', 'purchase_nonsalable_return', 'production', 'stock_adjustment', 'stock_transfer'] : ['sales', 'purchase_return', 'production', 'stock_adjustment', 'stock_transfer'];
    const labelOf = k => (columns === 'detail' ? MODULE_LABEL[k] : SUMMARY_LABEL[k]) || MODULE_LABEL[k] || k;
    const sortMods = (set, order) => [...set].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    const sum = k => round2(rows.reduce((s, r) => s + r[k], 0));
    const totals = { opening_value: sum('opening_value'), in_value: sum('in_value'), out_value: sum('out_value'), closing_value: sum('closing_value'),
        in: {}, out: {} };
    rows.forEach(r => {
        Object.entries(r.in).forEach(([k, b]) => { totals.in[k] = totals.in[k] || { qty: 0, value: 0 }; totals.in[k].qty = round4(totals.in[k].qty + b.qty); totals.in[k].value = round2(totals.in[k].value + b.value); });
        Object.entries(r.out).forEach(([k, b]) => { totals.out[k] = totals.out[k] || { qty: 0, value: 0 }; totals.out[k].qty = round4(totals.out[k].qty + b.qty); totals.out[k].value = round2(totals.out[k].value + b.value); });
    });
    return {
        from, to, method, method_label: METHODS[method],
        columns, modules_in: sortMods(modulesIn, orderIn).map(k => ({ key: k, label: labelOf(k) })),
        modules_out: sortMods(modulesOut, orderOut).map(k => ({ key: k, label: labelOf(k) })),
        rows, totals, warnings,
        reconciles: rows.every(r => Math.abs(round2(r.opening_value + r.in_value - r.out_value) - r.closing_value) < 0.01 && Math.abs(round4(r.opening_qty + r.in_qty - r.out_qty) - r.closing_qty) < 0.0001)
    };
}

// Closing stock value at the end of `asOf` (what the financial statements use).
async function closingStock(tenantClient, tenantId, asOf, method, filters = {}) {
    const r = await stockMovement(tenantClient, tenantId, { from: null, to: asOf, method, ...filters, hideZero: true });
    return {
        method, method_label: METHODS[method] || method, value: round2(r.rows.reduce((s, x) => s + x.closing_value, 0)),
        lines: r.rows.filter(x => Math.abs(x.closing_qty) > 1e-9).map(x => ({ product_id: x.product_id, product_code: x.product_code, product_name: x.product_name, qty: x.closing_qty, rate: x.closing_rate, value: x.closing_value })),
        warnings: r.warnings
    };
}

module.exports = { stockMovement, closingStock, METHODS, MODULE_LABEL, itemMovement };
