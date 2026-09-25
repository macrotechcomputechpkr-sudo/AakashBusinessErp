// =============================================
// utils/stockHealth.js
// Stock Ageing, Near Expiry / Expired, Re-order and Over-stock.
//
// Stock Ageing (as on a date): stock on hand split by how long it has been
//   in, FIFO - issues use up the oldest receipts first, so what is left is
//   the newest; each remaining receipt layer is aged from its date and
//   valued at its own cost. Rows by item, item + warehouse (a transfer in
//   starts a new age in that warehouse) or item + batch.
// Expiry: stock on hand per item + batch (+ warehouse) with the batch's
//   expiry date (Batch master, else a document line that carried it):
//   expired, expiring within N days, or all; valued at moving average.
// Re-order / Over-stock (products' minimum_stock = re-order level,
//   maximum_stock, reorder_qty; stock company-wide or for chosen
//   warehouses): projected = on hand + pending purchase orders
//   (- pending sales orders, optional). Re-order when projected <= level;
//   suggested qty = reorder_qty (at least what reaches the level), or up
//   to maximum when no reorder_qty. Over-stock when on hand > maximum.
//   Average daily sales (last N days) gives days of cover. Vendor = the
//   product's default vendor, else the last supplier; rate = last purchase
//   rate per base unit.
// Product filters are the Stock Report's.
// =============================================
const { parseQuery, loadProducts, loadEvents, statusOk } = require('./stockReport');
const { costRatesOn } = require('./stockEngine');
const { toBaseQtyFromDual, getDualUomMode } = require('./dualUomCalculation');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const days = (from, to) => Math.floor((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}
function parseBuckets(s, def) {
    const cuts = [...new Set(csv(s || def).map(Number).filter(n => n > 0))].sort((a, b) => a - b).slice(0, 10);
    const list = [];
    let prev = 0;
    cuts.forEach((n, i) => { list.push({ key: `b${i}`, label: `${i === 0 ? 0 : prev + 1}-${n}`, max: n }); prev = n; });
    list.push({ key: `b${cuts.length}`, label: `> ${prev}`, max: Infinity });
    return list;
}

// ---------------- Stock Ageing ----------------
async function stockAgeing(c, t, q) {
    const asOn = q.as_on || today();
    const f = parseQuery({ ...q, mode: 'summary', date_from: asOn, date_to: asOn });
    const buckets = parseBuckets(q.buckets, '30,60,90,180,365');
    const { products, info } = await loadProducts(c, t, f);
    const ev = await loadEvents(c, t, f, products);
    let rows = ev.rows.map(r => {
        const p = info[r.product_id], k = p.factor;
        const layers = [];                               // { q, cost, date }
        let avg = 0, qty = 0;
        r.events.forEach(e => {
            if (e.date > asOn || e.src === 'stock_transfer') return;   // company view: a transfer moves nothing
            if (e.qin > 0) {
                const cost = e.cost > 0 ? e.cost : avg;
                avg = qty + e.qin > 0 ? (Math.max(qty, 0) * avg + e.qin * cost) / (Math.max(qty, 0) + e.qin) : cost;
                layers.push({ q: e.qin, cost, date: e.date }); qty += e.qin;
            }
            if (e.qout > 0) {
                let need = e.qout; qty -= e.qout;
                while (need > 1e-9 && layers.length) { const L = layers[0]; const take = Math.min(L.q, need); L.q -= take; need -= take; if (L.q <= 1e-9) layers.shift(); }
            }
        });
        const b = Object.fromEntries(buckets.map(x => [x.key, { qty: 0, value: 0 }]));
        let value = 0, weighted = 0, oldest = null;
        if (qty > 1e-9) layers.forEach(L => {
            const age = days(L.date === '0000-01-01' ? asOn : L.date, asOn);
            const key = buckets.find(x => age <= x.max).key;
            b[key].qty += L.q; b[key].value += L.q * L.cost;
            value += L.q * L.cost; weighted += L.q * age;
            oldest = oldest === null || L.date < oldest ? L.date : oldest;
        });
        return {
            ...p, key: r.key, batch_no: r.batch_no, warehouse_name: r.warehouse_id ? ev.whName[r.warehouse_id] || '' : (f.groupBy === 'item_warehouse' ? '(Opening - no warehouse)' : null),
            qty: round4(qty / k), value: qty > 1e-9 ? round2(value) : 0, _base: qty,
            buckets: Object.fromEntries(Object.entries(b).map(([key, x]) => [key, { qty: round4(x.qty / k), value: round2(x.value) }])),
            avg_age_days: qty > 1e-9 ? Math.round(weighted / qty) : null, oldest_date: qty > 1e-9 ? oldest : null,
            oldest_days: qty > 1e-9 && oldest ? days(oldest === '0000-01-01' ? asOn : oldest, asOn) : null
        };
    });
    if (f.hideZero) rows = rows.filter(r => Math.abs(r.qty) > 1e-9);
    rows = rows.filter(r => statusOk(f, r._base, r.minimum_stock));
    const minAge = Number(q.min_age_days) || 0;
    if (minAge) rows = rows.filter(r => (r.oldest_days || 0) >= minAge);
    rows.forEach(r => delete r._base);
    rows.sort((a, b) => (q.sort_by === 'oldest' ? (b.oldest_days || 0) - (a.oldest_days || 0) : q.sort_by === 'value' ? b.value - a.value : 0)
        || a.product_name.localeCompare(b.product_name) || String(a.batch_no || a.warehouse_name || '').localeCompare(String(b.batch_no || b.warehouse_name || '')));
    const totals = { value: round2(rows.reduce((s, r) => s + r.value, 0)),
        buckets: Object.fromEntries(buckets.map(x => [x.key, round2(rows.reduce((s, r) => s + r.buckets[x.key].value, 0))])) };
    const warnings = [...ev.warnings];
    if (f.groupBy === 'item_warehouse') warnings.push('Warehouse view: stock transferred in is aged from the transfer date.');
    return { as_on: asOn, group_by: f.groupBy, buckets: buckets.map(({ key, label }) => ({ key, label })), rows, totals, warnings };
}

// ---------------- Near Expiry / Expired ----------------
async function expiryReport(c, t, q) {
    const asOn = q.as_on || today();
    const withinDays = Math.max(0, parseInt(q.within_days, 10) || 90);
    const status = ['expired', 'near', 'all'].includes(q.status) ? q.status : 'near_and_expired';
    const byWarehouse = q.by_warehouse === 'true';
    const f = parseQuery({ ...q, mode: 'summary', date_from: asOn, date_to: asOn });
    const { products, info } = await loadProducts(c, t, f);
    const ids = products.map(p => p.id);
    if (!ids.length) return { as_on: asOn, within_days: withinDays, rows: [], totals: { qty_rows: 0, value: 0 }, warnings: [] };
    const idSet = new Set(ids);
    const warehouseIds = csv(q.warehouse_ids || q.warehouse_id);

    const [moves, batches, warehouses, fyRes] = await Promise.all([
        fetchAll(() => c.from('stock_movements').select('product_id, warehouse_id, batch_no, qty_in, qty_out').eq('tenant_id', t).lte('movement_date', asOn).not('batch_no', 'is', null).order('id')),
        fetchAll(() => c.from('product_batches').select('product_id, batch_no, mfg_date, exp_date, qty, is_active').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('warehouses').select('id, warehouse_name').eq('tenant_id', t).order('id')),
        c.from('fiscal_years').select('start_date_eng').eq('tenant_id', t).eq('has_opening_balance', true).maybeSingle()
    ]);
    const whName = Object.fromEntries(warehouses.map(w => [w.id, w.warehouse_name]));
    // Expiry: Batch master first, else any document line that carried one.
    const exp = {}, mfg = {};
    batches.forEach(b => { const k = `${b.product_id}|${b.batch_no}`; if (b.exp_date) exp[k] = String(b.exp_date).slice(0, 10); if (b.mfg_date) mfg[k] = String(b.mfg_date).slice(0, 10); });
    for (const [table] of [['stock_transfer_details'], ['sales_delivery_details'], ['stock_adjustment_details']]) {
        try {
            const rows = await fetchAll(() => c.from(table).select('product_id, batch_no, mfg_date, exp_date').eq('tenant_id', t).not('exp_date', 'is', null).order('id'));
            rows.forEach(r => { const k = `${r.product_id}|${r.batch_no}`; if (r.batch_no && !exp[k]) exp[k] = String(r.exp_date).slice(0, 10); if (r.batch_no && r.mfg_date && !mfg[k]) mfg[k] = String(r.mfg_date).slice(0, 10); });
        } catch { /* table without the column on older schemas */ }
    }
    const qty = {};
    const add = (pid, wh, batch, n) => { const k = `${pid}|${batch}|${byWarehouse ? wh || '' : ''}`; qty[k] = (qty[k] || 0) + n; };
    const openingOk = fyRes.data?.start_date_eng ? String(fyRes.data.start_date_eng).slice(0, 10) <= addDays(asOn, 1) : true;
    if (openingOk && !warehouseIds.length) batches.filter(b => idSet.has(b.product_id) && b.is_active !== false && Number(b.qty) > 0).forEach(b => add(b.product_id, null, b.batch_no, Number(b.qty)));
    moves.forEach(m => {
        if (!idSet.has(m.product_id) || (warehouseIds.length && !warehouseIds.includes(m.warehouse_id))) return;
        add(m.product_id, m.warehouse_id, m.batch_no, (Number(m.qty_in) || 0) - (Number(m.qty_out) || 0));
    });
    const rateWants = {};
    Object.keys(qty).forEach(k => { const pid = k.split('|')[0]; rateWants[pid] = [{ date: asOn, qty: 0 }]; });
    const rates = await costRatesOn(c, t, rateWants, 'moving_average');
    const limit = addDays(asOn, withinDays);
    let rows = Object.entries(qty).filter(([, n]) => n > 1e-9).map(([k, n]) => {
        const [pid, batch, wh] = k.split('|');
        const p = info[pid], e = exp[`${pid}|${batch}`] || null;
        const left = e ? days(asOn, e) : null;
        const state = !e ? 'no_expiry' : e < asOn ? 'expired' : e <= limit ? 'near' : 'ok';
        const rate = rates[`${pid}|${asOn}`] || 0;
        return { ...p, key: k, batch_no: batch, warehouse_name: byWarehouse ? (wh ? whName[wh] || '' : '(Opening - no warehouse)') : null,
            mfg_date: mfg[`${pid}|${batch}`] || null, exp_date: e, days_left: left, state,
            qty: round4(n / p.factor), rate: round2(rate * p.factor), value: round2(n * rate) };
    });
    rows = rows.filter(r => status === 'all' ? true : status === 'expired' ? r.state === 'expired' : status === 'near' ? r.state === 'near' : ['expired', 'near'].includes(r.state));
    rows.sort((a, b) => String(a.exp_date || '9999').localeCompare(String(b.exp_date || '9999')) || a.product_name.localeCompare(b.product_name));
    const sum = st => round2(rows.filter(r => r.state === st).reduce((s, r) => s + r.value, 0));
    return { as_on: asOn, within_days: withinDays, status, by_warehouse: byWarehouse, rows,
        totals: { value: round2(rows.reduce((s, r) => s + r.value, 0)), expired: sum('expired'), near: sum('near'), rows: rows.length },
        warnings: rows.some(r => r.state === 'no_expiry') ? ['Some batches have no expiry date in the Batch master.'] : [] };
}

// ---------------- Re-order / Over-stock ----------------
async function reorderReport(c, t, q) {
    const mode = q.mode === 'overstock' ? 'overstock' : 'reorder';
    const f = parseQuery({ ...q, mode: 'summary', date_from: today(), date_to: today() });
    const salesDays = Math.max(1, parseInt(q.sales_days, 10) || 90);
    const minusSo = q.deduct_sales_orders === 'true';
    const warehouseIds = csv(q.warehouse_ids || q.warehouse_id);
    const { products, info } = await loadProducts(c, t, { ...f, warehouseId: null });
    const pmeta = Object.fromEntries((await inChunks(products.map(p => p.id), async ids => {
        const { data, error } = await c.from('products').select('id, default_vendor_id, lead_time_days, base_unit_id, item_type, maximum_stock, uom_mode, dual_uom_primary_unit_id').in('id', ids);
        if (error) throw error; return data || [];
    })).map(p => [p.id, p]));
    const stockable = products.filter(p => !['service', 'non_inventory'].includes(pmeta[p.id]?.item_type));
    const ids = stockable.map(p => p.id), idSet = new Set(ids);
    if (!ids.length) return { mode, rows: [], totals: {}, warnings: [] };

    const since = addDays(today(), -salesDays);
    const [moves, rates, openPos, openSos] = await Promise.all([
        fetchAll(() => { let x = c.from('stock_movements').select('product_id, warehouse_id, movement_date, qty_in, qty_out, source_type').eq('tenant_id', t).order('id'); if (warehouseIds.length) x = x.in('warehouse_id', warehouseIds); return x; }),
        fetchAll(() => c.from('product_unit_rates').select('product_id, is_base_unit, conversion_factor, last_purchase_rate, purchase_rate').eq('tenant_id', t).order('product_id')),
        fetchAll(() => c.from('purchase_orders').select('id, vendor_ledger_id, vendor_name_snapshot').eq('tenant_id', t).in('status', ['confirmed', 'partially_received']).order('id')),
        minusSo ? fetchAll(() => c.from('sales_orders').select('id').eq('tenant_id', t).in('status', ['confirmed', 'partially_delivered']).order('id')) : []
    ]);
    const onHand = {}, sold = {};
    if (!warehouseIds.length) stockable.forEach(p => { onHand[p.id] = Number(p.opening_qty) || 0; });
    moves.forEach(m => {
        if (!idSet.has(m.product_id)) return;
        if (m.source_type === 'stock_transfer' && !warehouseIds.length) return;
        onHand[m.product_id] = (onHand[m.product_id] || 0) + (Number(m.qty_in) || 0) - (Number(m.qty_out) || 0);
        if (['sales_bill', 'sales_delivery'].includes(m.source_type) && String(m.movement_date).slice(0, 10) >= since) sold[m.product_id] = (sold[m.product_id] || 0) + (Number(m.qty_out) || 0);
        if (['sales_return'].includes(m.source_type) && String(m.movement_date).slice(0, 10) >= since) sold[m.product_id] = (sold[m.product_id] || 0) - (Number(m.qty_in) || 0);
    });
    const factorOf = {}, lastRate = {};
    rates.forEach(r => {
        if (r.is_base_unit) lastRate[r.product_id] = Number(r.last_purchase_rate) || Number(r.purchase_rate) || 0;
    });
    // Pending qty on open orders, in base units (qty x unit factor; dual lines primary x factor + loose).
    const unitRates = await inChunks(ids, async chunk => { const { data } = await c.from('product_unit_rates').select('product_id, unit_id, conversion_factor, is_base_unit').in('product_id', chunk); return data || []; });
    unitRates.forEach(r => { factorOf[`${r.product_id}|${r.unit_id}`] = r.is_base_unit ? 1 : Number(r.conversion_factor) || 1; });
    const dualMode = await getDualUomMode(c);
    const pendingOf = async (headers, table, fk, doneCol) => {
        const out = {};
        const lines = await inChunks(headers.map(h => h.id), async chunk => { const { data, error } = await c.from(table).select('*').in(fk, chunk); if (error) throw error; return data || []; });
        lines.forEach(d => {
            if (!idSet.has(d.product_id)) return;
            const m = pmeta[d.product_id] || {};
            let pend;
            if (m.uom_mode === 'fixed_dual' && d.alt_qty) {              // primary x factor + loose pieces
                const fct = factorOf[`${d.product_id}|${m.dual_uom_primary_unit_id}`] || 1;
                pend = Math.max(0, toBaseQtyFromDual(d.qty, d.alt_qty, fct, dualMode) - toBaseQtyFromDual(d[doneCol], d[`alt_${doneCol}`], fct, dualMode));
            } else {
                const fct = d.uom_id ? factorOf[`${d.product_id}|${d.uom_id}`] || 1 : 1;
                pend = Math.max(0, (Number(d.qty) || 0) - (Number(d[doneCol]) || 0)) * fct;
            }
            out[d.product_id] = (out[d.product_id] || 0) + pend;
        });
        return out;
    };
    const poPending = openPos.length ? await pendingOf(openPos, 'purchase_order_details', 'order_id', 'qty_received') : {};
    const soPending = openSos.length ? await pendingOf(openSos, 'sales_order_details', 'order_id', 'qty_delivered') : {};

    // Last supplier per product (latest posted purchase bill line).
    const vendorNeeded = ids.filter(id => !pmeta[id]?.default_vendor_id);
    const lastVendor = {};
    if (vendorNeeded.length) {
        const bills = await fetchAll(() => c.from('purchase_bills').select('id, doc_date, vendor_ledger_id, vendor_name_snapshot').eq('tenant_id', t).eq('status', 'posted').order('doc_date', { ascending: false }));
        const billById = Object.fromEntries(bills.map(b => [b.id, b]));
        const lines = await inChunks(vendorNeeded, async chunk => { const { data } = await c.from('purchase_bill_details').select('bill_id, product_id').in('product_id', chunk); return data || []; });
        lines.forEach(l => { const b = billById[l.bill_id]; if (b?.vendor_ledger_id && (!lastVendor[l.product_id] || b.doc_date > lastVendor[l.product_id].date)) lastVendor[l.product_id] = { id: b.vendor_ledger_id, name: b.vendor_name_snapshot, date: b.doc_date }; });
    }
    const vendorIds = [...new Set(ids.map(id => pmeta[id]?.default_vendor_id).filter(Boolean))];
    const vendorName = Object.fromEntries((await inChunks(vendorIds, async chunk => { const { data } = await c.from('ledger_accounts').select('id, account_name').in('id', chunk); return data || []; })).map(v => [v.id, v.account_name]));

    let rows = stockable.map(p => {
        const i = info[p.id], k = i.factor, m = pmeta[p.id] || {};
        const hand = onHand[p.id] || 0, po = poPending[p.id] || 0, so = soPending[p.id] || 0;
        const projected = hand + po - (minusSo ? so : 0);
        const level = Number(p.minimum_stock) || 0, max = Number(m.maximum_stock ?? p.maximum_stock) || 0, rq = Number(p.reorder_qty) || 0;
        const daily = (sold[p.id] || 0) / salesDays;
        let suggest = 0;
        if (projected <= level && (level > 0 || rq > 0 || max > 0)) {
            const toLevel = Math.max(0, level - projected);
            suggest = rq > 0 ? Math.max(rq, toLevel) : max > 0 ? Math.max(0, max - projected) : toLevel;
        }
        const vendor = m.default_vendor_id ? { id: m.default_vendor_id, name: vendorName[m.default_vendor_id] || '' } : lastVendor[p.id] || null;
        const rate = lastRate[p.id] || 0;
        return {
            ...i, product_id: p.id, base_unit_id: m.base_unit_id || null, unit: i.unit,
            on_hand: round4(hand / k), pending_po: round4(po / k), pending_so: round4(so / k), projected: round4(projected / k),
            reorder_level: round4(level / k), maximum_stock: round4(max / k), reorder_qty: round4(rq / k),
            avg_daily_sales: round4(daily / k), days_cover: daily > 0 ? Math.floor(hand / daily) : null, lead_time_days: Number(m.lead_time_days) || 0,
            suggested_qty: round4(Math.ceil(suggest / k * 10000) / 10000), rate: round4(rate * k), suggested_value: round2(suggest * rate),
            excess_qty: max > 0 && hand > max ? round4((hand - max) / k) : 0, excess_value: max > 0 && hand > max ? round2((hand - max) * rate) : 0, stock_value: round2(hand * rate),
            vendor_id: vendor?.id || null, vendor_name: vendor?.name || '', vendor_source: m.default_vendor_id ? 'default' : vendor ? 'last purchase' : null,
            _flag: mode === 'reorder' ? suggest > 1e-9 || (q.include_lead_time === 'true' && daily > 0 && Number(m.lead_time_days) > 0 && hand / daily <= Number(m.lead_time_days)) : max > 0 && hand > max
        };
    }).filter(r => r._flag);
    if (mode === 'reorder' && q.include_lead_time === 'true') rows.forEach(r => { if (!r.suggested_qty && r.avg_daily_sales) { r.suggested_qty = round4(Math.max(r.reorder_qty, r.avg_daily_sales * r.lead_time_days)); r.suggested_value = round2(r.suggested_qty * r.rate); } });
    const vendorFilter = csv(q.vendor_ids);
    if (vendorFilter.length) rows = rows.filter(r => vendorFilter.includes(r.vendor_id));
    rows.forEach(r => delete r._flag);
    rows.sort((a, b) => (q.sort_by === 'vendor' ? String(a.vendor_name).localeCompare(String(b.vendor_name)) : 0)
        || (mode === 'overstock' && q.sort_by === 'value' ? b.excess_value - a.excess_value : 0) || a.product_name.localeCompare(b.product_name));
    const warnings = [];
    if (!warehouseIds.length) warnings.push('Stock is company-wide (all warehouses + opening).');
    if (rows.some(r => !r.vendor_id)) warnings.push('Some items have no default vendor and no purchase yet - choose a vendor before making the order.');
    return { mode, sales_days: salesDays, rows,
        totals: { items: rows.length, suggested_value: round2(rows.reduce((s, r) => s + r.suggested_value, 0)), excess_value: round2(rows.reduce((s, r) => s + r.excess_value, 0)) }, warnings };
}

module.exports = { stockAgeing, expiryReport, reorderReport };
