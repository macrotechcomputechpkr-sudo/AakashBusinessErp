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
// A two-step branch transfer dispatched but not yet received (or received
// for a dispatch of an earlier period) leaves its in and out unequal; the
// difference is still company stock and is shown as "Goods in Transit".
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
    stock_adjustment: 'Stock Adjustment', goods_in_transit: 'Goods in Transit'
};
const PURCHASE_SOURCES = new Set(['opening', 'purchase_grn', 'purchase_bill', 'production']);
// Normal (summary) view: GRN and direct Purchase Bill are both "Purchase",
// Delivery (GDN) and direct Sales Bill are both "Sales"; non-saleable returns
// join their return column. 'detail' keeps every module separate.
const SUMMARY_OF = { purchase_grn: 'purchase', purchase_bill: 'purchase', purchase_return: 'purchase_return', purchase_nonsalable_return: 'purchase_return',
    sales_delivery: 'sales', sales_bill: 'sales', sales_return: 'sales_return', sales_nonsalable_return: 'sales_return', production: 'production', stock_transfer: 'stock_transfer',
    stock_adjustment: 'stock_adjustment', goods_in_transit: 'goods_in_transit' };
const SUMMARY_LABEL = { purchase: 'Purchase', purchase_return: 'Purchase Return', sales: 'Sales', sales_return: 'Sales Return', production: 'Production', stock_transfer: 'Stock Transfer',
    stock_adjustment: 'Stock Adjustment', goods_in_transit: 'Goods in Transit' };

// Company-level movements that never change stock qty or cost.
const TRANSFER_KEYS = new Set(['stock_transfer', 'goods_in_transit']);

// Batch / serial products can be costed differently (System Control):
// FIFO / LIFO / average like everything else, or by SPECIFIC IDENTIFICATION
// - each batch (or serial number) keeps its own purchase cost and an issue
// of that batch / serial takes exactly that cost. Internally that method is
// 'specific': receipt layers carry a key (batch no or serial no) and an issue
// consumes the layers of its own key first (then FIFO for anything left,
// e.g. stock received before batches / serials were recorded).
const COSTING_CHOICES = {
    batch: { same: 'Same as the valuation method of the report', fifo: 'FIFO', lifo: 'LIFO', moving_average: 'Moving Average', weighted_average: 'Weighted Average', batch_wise: 'Batch-wise (actual cost of each batch)' },
    serial: { same: 'Same as the valuation method of the report', fifo: 'FIFO', lifo: 'LIFO', moving_average: 'Moving Average', weighted_average: 'Weighted Average', serial_wise: 'Serial-wise (actual cost of each serial no)' }
};
async function costingSettings(tenantClient, tenantId) {
    try {
        const { data } = await tenantClient.from('system_control_settings').select('batch_costing_method, serial_costing_method').eq('tenant_id', tenantId).maybeSingle();
        return { batch: COSTING_CHOICES.batch[data?.batch_costing_method] ? data.batch_costing_method : 'same', serial: COSTING_CHOICES.serial[data?.serial_costing_method] ? data.serial_costing_method : 'same' };
    } catch { return { batch: 'same', serial: 'same' }; }
}
// Effective method + which key (batch / serial) identifies a layer for one product.
function methodFor(product, method, cs) {
    if (!product || !cs) return { method, keyBy: null };
    if (product.track_serial_number && cs.serial !== 'same') return cs.serial === 'serial_wise' ? { method: 'specific', keyBy: 'serial' } : { method: cs.serial, keyBy: null };
    if (product.maintain_batch && cs.batch !== 'same') return cs.batch === 'batch_wise' ? { method: 'specific', keyBy: 'batch' } : { method: cs.batch, keyBy: null };
    return { method, keyBy: null };
}
const splitKeys = k => String(k || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
// Attach the costing key to each event of a product.
function keyEvents(ev, keyBy) {
    if (!keyBy) return ev;
    return ev.map(e => ({ ...e, key: keyBy === 'serial' ? e.serial_no || null : e.batch_no || null }));
}
const LAYERED = new Set(['fifo', 'lifo', 'specific']);

// Running state of one item under one method.
function newState() { return { qty: 0, avg: 0, layers: [], sumQ: 0, sumV: 0, last: 0, keyCost: {} }; }
function rateOf(st, method) {
    if (method === 'moving_average') return st.avg;
    if (method === 'last_purchase') return st.last || st.avg;
    if (method === 'weighted_average') return st.sumQ > 0 ? st.sumV / st.sumQ : 0;
    return st.qty > 0 ? st.layers.reduce((s, L) => s + L.q * L.c, 0) / st.qty : st.avg;
}
function valueOf(st, method) {
    if (st.qty <= 1e-9) return 0;                      // nil or negative stock carries no value
    if (LAYERED.has(method)) return st.layers.reduce((s, L) => s + L.q * L.c, 0);
    return st.qty * rateOf(st, method);
}
function receive(st, qty, cost, key) {
    // a receipt without cost (e.g. a return) comes in at the cost that key went out at, else the current average
    const keys = splitKeys(key);
    const known = keys.length ? keys.map(k => st.keyCost[k]).filter(x => x > 0) : [];
    const c = cost > 0 ? cost : known.length ? known.reduce((a, b) => a + b, 0) / known.length : st.avg;
    st.avg = st.qty + qty > 0 ? (Math.max(st.qty, 0) * st.avg + qty * c) / (Math.max(st.qty, 0) + qty) : c;
    st.qty += qty; st.sumQ += qty; st.sumV += qty * c;
    if (keys.length > 1) keys.forEach(k => { st.layers.push({ q: qty / keys.length, c, key: k }); st.keyCost[k] = c; });
    else { st.layers.push({ q: qty, c, key: keys[0] || null }); if (keys[0]) st.keyCost[keys[0]] = c; }
    return qty * c;
}
function takeLayers(st, need, pick) {                  // pick(): index of the next layer to use, or -1
    let cost = 0;
    while (need > 1e-9) {
        const i = pick(); if (i < 0) break;
        const L = st.layers[i], take = Math.min(L.q, need);
        L.q -= take; need -= take; cost += take * L.c;
        if (L.key) st.keyCost[L.key] = L.c;
        if (L.q <= 1e-9) st.layers.splice(i, 1);
    }
    return { cost, left: need };
}
function issue(st, qty, method, key) {                 // returns the natural cost of this issue
    let cost = 0;
    if (method === 'specific') {
        const keys = splitKeys(key);
        let left = 0;
        (keys.length ? keys : [null]).forEach(k => {
            const part = keys.length ? qty / keys.length : qty;
            const r = k ? takeLayers(st, part, () => st.layers.findIndex(L => L.key === k)) : { cost: 0, left: part };
            cost += r.cost; left += r.left;
        });
        // anything not identified: the oldest un-keyed stock first, then plain FIFO
        let r = takeLayers(st, left, () => st.layers.findIndex(L => !L.key));
        cost += r.cost;
        r = takeLayers(st, r.left, () => (st.layers.length ? 0 : -1));
        cost += r.cost;
    } else if (method === 'fifo' || method === 'lifo') {
        cost = takeLayers(st, qty, () => (st.layers.length ? (method === 'lifo' ? st.layers.length - 1 : 0) : -1)).cost;
    } else {
        cost = qty * rateOf(st, method);
        // keep FIFO layers in step so rateOf() for non-layer methods is unaffected
        takeLayers(st, qty, () => (st.layers.length ? 0 : -1));
    }
    st.qty -= qty;
    return cost;
}

async function loadItems(tenantClient, tenantId, to, filters = {}) {
    let pq = () => {
        let q = tenantClient.from('products').select('id, product_code, product_name, opening_qty, opening_rate, product_group_id, product_company_id, maintain_batch, track_serial_number').eq('tenant_id', tenantId);
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
        .select('*').eq('tenant_id', tenantId).lte('movement_date', to)))
        .filter(m => ids.has(m.product_id));
    // opening batches (with their own rates) make batch-wise costing exact from day one
    const batchRows = products.some(p => p.maintain_batch) ? await fetchAll(() => tenantClient.from('product_batches').select('product_id, batch_no, qty, rate, is_active').eq('tenant_id', tenantId)).catch(() => []) : [];
    const events = {};
    products.forEach(p => {
        events[p.id] = [];
        const total = Number(p.opening_qty) || 0;
        let used = 0;
        if (p.maintain_batch) batchRows.filter(b => b.product_id === p.id && b.is_active !== false && Number(b.qty) > 0 && used + Number(b.qty) <= total + 1e-9).forEach(b => {
            used += Number(b.qty);
            events[p.id].push({ date: openingDay, seq: '', qin: Number(b.qty), qout: 0, cost: Number(b.rate) || Number(p.opening_rate) || 0, src: 'opening', batch_no: b.batch_no });
        });
        if (total - used > 1e-9) events[p.id].push({ date: openingDay, seq: '', qin: round4(total - used), qout: 0, cost: Number(p.opening_rate) || 0, src: 'opening' });
    });
    moves.forEach(m => events[m.product_id].push({ date: String(m.movement_date).slice(0, 10), seq: m.created_at || '', qin: Number(m.qty_in) || 0, qout: Number(m.qty_out) || 0, cost: Number(m.unit_cost) || 0,
        src: m.source_type || 'other', batch_no: m.batch_no || null, serial_no: m.serial_no || null }));
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
            const v = receive(st, e.qin, e.cost, e.key);
            if (e.cost > 0 && PURCHASE_SOURCES.has(e.src)) st.last = e.cost;
            if (inPeriod) { const b = (inBy[e.src] = inBy[e.src] || { qty: 0, value: 0 }); b.qty += e.qin; b.value += v; }
        }
        if (e.qout > 0) {
            const natural = issue(st, e.qout, method, e.key);
            if (inPeriod) { const b = (outBy[e.src] = outBy[e.src] || { qty: 0, value: 0 }); b.qty += e.qout; outNatural[e.src] = (outNatural[e.src] || 0) + natural; }
        }
    }
    if (!opening) opening = snap();                     // nothing happened in the period
    const closing = snap();
    // Transfer out - in = goods that left one warehouse but reached no other in
    // the period (two-step branch transfer): still company stock, so balance it.
    const tIn = inBy.stock_transfer || { qty: 0, value: 0 }, tOut = outBy.stock_transfer || { qty: 0, value: 0 };
    const transitQ = tOut.qty - tIn.qty, transitV = tOut.value - tIn.value;
    if (Math.abs(transitQ) > 1e-9 || Math.abs(transitV) > 0.005) {
        if (transitQ > 0 || (transitQ === 0 && transitV > 0)) inBy.goods_in_transit = { qty: transitQ, value: transitV };
        else outBy.goods_in_transit = { qty: -transitQ, value: -transitV };
    }
    // Cost of issues so that Opening + In - Out = Closing exactly, spread by natural cost (or qty).
    const inValue = Object.entries(inBy).filter(([k]) => !TRANSFER_KEYS.has(k)).reduce((s, [, b]) => s + b.value, 0);
    const outTotal = opening.value + inValue - closing.value;
    const srcs = Object.keys(outBy).filter(k => !TRANSFER_KEYS.has(k));
    const naturalSum = srcs.reduce((s, k) => s + (outNatural[k] || 0), 0);
    const qtySum = srcs.reduce((s, k) => s + outBy[k].qty, 0);
    srcs.forEach(k => { outBy[k].value = naturalSum > 1e-9 ? outTotal * (outNatural[k] || 0) / naturalSum : (qtySum ? outTotal * outBy[k].qty / qtySum : 0); });
    return { opening, closing, inBy, outBy, negative: st.qty < -1e-9 };
}

// Stock movement for many items. Returns rows + module list + totals.
async function stockMovement(tenantClient, tenantId, { from, to, method = 'weighted_average', productId, productGroupId, productCompanyId, hideZero = true, columns = 'summary' }) {
    if (!METHODS[method]) method = 'weighted_average';
    const { products, events } = await loadItems(tenantClient, tenantId, to, { productId, productGroupId, productCompanyId });
    const cs = await costingSettings(tenantClient, tenantId);
    const modulesIn = new Set(), modulesOut = new Set(), warnings = [];
    let rows = products.map(p => {
        const eff = methodFor(p, method, cs);
        const m = itemMovement(keyEvents(events[p.id], eff.keyBy), eff.method, from, to);
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
            closing_rate: m.closing.qty > 1e-9 ? round2(m.closing.value / m.closing.qty) : 0,
            costing: eff.method === method ? null : eff.method === 'specific' ? (eff.keyBy === 'serial' ? 'serial_wise' : 'batch_wise') : eff.method
        };
    });
    if (hideZero) rows = rows.filter(r => r.opening_qty || r.in_qty || r.out_qty || r.closing_qty);
    // Rounding: make each row's value identity exact at 2 decimals by trimming the out figure.
    rows.forEach(r => {
        const gap = round2(r.opening_value + r.in_value - r.out_value - r.closing_value);
        if (gap && Object.keys(r.out).length) { const k = Object.keys(r.out).find(x => !TRANSFER_KEYS.has(x)) || Object.keys(r.out)[0]; r.out[k].value = round2(r.out[k].value + gap); r.out_value = round2(r.out_value + gap); }
    });
    rows.sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)));
    const orderIn = columns === 'detail' ? ['opening', 'purchase_grn', 'purchase_bill', 'sales_return', 'sales_nonsalable_return', 'production', 'stock_adjustment', 'stock_transfer', 'goods_in_transit'] : ['purchase', 'sales_return', 'production', 'stock_adjustment', 'stock_transfer', 'goods_in_transit'];
    const orderOut = columns === 'detail' ? ['sales_delivery', 'sales_bill', 'purchase_return', 'purchase_nonsalable_return', 'production', 'stock_adjustment', 'stock_transfer', 'goods_in_transit'] : ['sales', 'purchase_return', 'production', 'stock_adjustment', 'stock_transfer', 'goods_in_transit'];
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

// Cost per BASE unit of the stock issued on given dates under `method`
// (Profitability's cost of sales). The ledger is replayed to the start of
// each date plus that day's receipts; FIFO / LIFO then cost the day's issued
// qty from the layers, the average methods use their rate. Batch / serial
// products follow System Control's batch / serial costing; with batch-wise /
// serial-wise costing a want may carry key (its batch or serial no) and gets
// that batch's own cost under 'productId|date|key'.
// wants: { productId: [{ date, qty, key? }] }  ->  { 'productId|date': rate, 'productId|date|key': rate }
async function costRatesOn(tenantClient, tenantId, wants, method = 'moving_average') {
    if (!METHODS[method]) method = 'moving_average';
    const pids = Object.keys(wants).filter(p => wants[p].length);
    if (!pids.length) return {};
    const maxDate = pids.flatMap(p => wants[p].map(w => w.date)).sort().pop();
    const { products, events } = await loadItems(tenantClient, tenantId, maxDate, pids.length === 1 ? { productId: pids[0] } : {});
    const cs = await costingSettings(tenantClient, tenantId);
    const P = Object.fromEntries(products.map(p => [p.id, p]));
    const out = {};
    pids.forEach(pid => {
        const eff = methodFor(P[pid], method, cs), m = eff.method;
        const apply = (st, e, withIssue) => {
            if (e.src === 'stock_transfer') return;            // company level: no effect
            if (e.qin > 0) { receive(st, e.qin, e.cost, e.key); if (e.cost > 0 && PURCHASE_SOURCES.has(e.src)) st.last = e.cost; }
            if (withIssue && e.qout > 0) issue(st, e.qout, m, e.key);
        };
        const ev = keyEvents(events[pid] || [], eff.keyBy), st = newState();
        const qtyOn = {}, keysOn = {};
        wants[pid].forEach(w => {
            qtyOn[w.date] = (qtyOn[w.date] || 0) + (Number(w.qty) || 0);
            const wk = w.key || (eff.keyBy === 'serial' ? w.serial : eff.keyBy === 'batch' ? w.batch : null);
            if (eff.keyBy && wk) (keysOn[w.date] = keysOn[w.date] || {})[wk] = ((keysOn[w.date] || {})[wk] || 0) + (Number(w.qty) || 0);
        });
        let i = 0;
        const clone = x => ({ ...x, layers: x.layers.map(L => ({ ...L })), keyCost: { ...x.keyCost } });
        Object.keys(qtyOn).sort().forEach(d => {
            for (; i < ev.length && ev[i].date < d; i++) apply(st, ev[i], true);
            // that day's receipts first (not its issues) on a copy of the state
            const day = clone(st);
            for (let j = i; j < ev.length && ev[j].date === d; j++) apply(day, ev[j], false);
            const q = qtyOn[d];
            let rate = rateOf(day, m);
            if (LAYERED.has(m) && q > 1e-9 && day.layers.length) {
                const taken = Math.min(q, day.layers.reduce((s, L) => s + L.q, 0));
                if (taken > 1e-9) rate = issue(clone(day), taken, m === 'specific' ? 'fifo' : m) / taken;
            }
            out[`${pid}|${d}`] = rate;
            Object.entries(keysOn[d] || {}).forEach(([k, kq]) => {
                const onHand = day.layers.filter(L => splitKeys(k).includes(L.key)).reduce((s, L) => s + L.q, 0);
                const want = kq > 1e-9 ? kq : Math.max(onHand, 1e-6);
                const cp = clone(day);
                const cost = issue(cp, want, 'specific', k);
                out[`${pid}|${d}|${k}`] = want > 1e-9 ? cost / want : rate;
            });
        });
    });
    return out;
}

module.exports = { stockMovement, closingStock, costRatesOn, METHODS, MODULE_LABEL, TRANSFER_KEYS, itemMovement, costingSettings, methodFor, keyEvents, COSTING_CHOICES };
