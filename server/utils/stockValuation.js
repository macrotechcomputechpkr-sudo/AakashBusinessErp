// =============================================
// utils/stockValuation.js
// Stock Valuation as on a date, under several valuation methods side by
// side. Stock-ledger methods are valued by stockEngine.itemMovement() - the
// same engine as Stock Movement, Stock Report and the financial statements:
//   weighted_average, moving_average, fifo, lifo, last_purchase
// Master-rate bases value the same closing qty at the item master's rate
// (base unit row of product_unit_rates):
//   master_purchase (Purchase Rate), mrp (MRP), sales_rate (Sales Rate SR1)
// Rows: item, item + warehouse or item + batch. Filters and stock status are
// the Stock Report's (utils/stockReport.js).
// =============================================
const { itemMovement, METHODS } = require('./stockEngine');
const { parseQuery, loadProducts, loadEvents, statusOk } = require('./stockReport');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

const MASTER_BASES = { master_purchase: { label: 'Master Purchase Rate', col: 'purchase_rate' }, mrp: { label: 'MRP', col: 'mrp' }, sales_rate: { label: 'Sales Rate (SR1)', col: 'sales_rate_sr1' } };
const ALL_METHODS = { ...Object.fromEntries(Object.entries(METHODS)), ...Object.fromEntries(Object.entries(MASTER_BASES).map(([k, v]) => [k, v.label])) };

async function stockValuation(c, t, q) {
    const asOn = q.as_on;
    const f = parseQuery({ ...q, mode: 'summary', date_from: asOn, date_to: asOn });
    let methods = String(q.methods || 'weighted_average').split(',').map(s => s.trim()).filter(m => ALL_METHODS[m]);
    if (!methods.length) methods = ['weighted_average'];
    const { products, info } = await loadProducts(c, t, f);
    const ev = await loadEvents(c, t, f, products);

    // Master rates per base unit.
    const masterRate = {};
    if (methods.some(m => MASTER_BASES[m]) && products.length) {
        const rates = await fetchAll(() => c.from('product_unit_rates').select('product_id, is_base_unit, conversion_factor, purchase_rate, mrp, sales_rate_sr1').eq('tenant_id', t).order('product_id'));
        rates.forEach(r => {
            const per = Number(r.is_base_unit ? 1 : r.conversion_factor) || 1;
            const cur = masterRate[r.product_id];
            if (cur && cur.base && !r.is_base_unit) return;       // the base unit's own row wins
            masterRate[r.product_id] = { base: !!r.is_base_unit, ...Object.fromEntries(Object.entries(MASTER_BASES).map(([k, v]) => [k, (Number(r[v.col]) || 0) / per])) };
        });
    }

    const warnings = [...ev.warnings];
    let rows = ev.rows.map(r => {
        const p = info[r.product_id], k = p.factor;
        const byMethod = {};
        let qty = 0;
        methods.filter(m => METHODS[m]).forEach(m => {
            const mv = itemMovement(r.events, m, asOn, asOn);
            qty = mv.closing.qty;
            byMethod[m] = { rate: mv.closing.qty > 1e-9 ? round4(mv.closing.value / mv.closing.qty * k) : 0, value: round2(mv.closing.value) };
        });
        if (!methods.some(m => METHODS[m])) qty = itemMovement(r.events, 'weighted_average', asOn, asOn).closing.qty;
        methods.filter(m => MASTER_BASES[m]).forEach(m => {
            const rate = masterRate[r.product_id]?.[m] || 0;
            byMethod[m] = { rate: round4(rate * k), value: qty > 1e-9 ? round2(qty * rate) : 0 };
        });
        const meta = r.batch_no ? ev.batchMeta[`${r.product_id}|${r.batch_no}`] : null;
        return {
            ...p, key: r.key, batch_no: r.batch_no, exp_date: meta?.exp_date || null,
            warehouse_name: r.warehouse_id ? ev.whName[r.warehouse_id] || '' : (f.groupBy === 'item_warehouse' ? '(Opening - no warehouse)' : null),
            qty: round4(qty / k), _base: qty, methods: byMethod
        };
    });
    if (f.hideZero) rows = rows.filter(r => Math.abs(r.qty) > 1e-9);
    rows = rows.filter(r => statusOk(f, r._base, r.minimum_stock));
    rows.forEach(r => { if (r._base < -1e-9) warnings.push(`${r.product_name}${r.warehouse_name ? ' · ' + r.warehouse_name : ''}: negative stock ${round4(r.qty)} - valued at zero`); delete r._base; });
    rows.sort((a, b) => a.product_name.localeCompare(b.product_name) || String(a.batch_no || a.warehouse_name || '').localeCompare(String(b.batch_no || b.warehouse_name || '')));
    const totals = Object.fromEntries(methods.map(m => [m, round2(rows.reduce((s, r) => s + (r.methods[m]?.value || 0), 0))]));
    return {
        as_on: asOn, group_by: f.groupBy, methods: methods.map(m => ({ key: m, label: ALL_METHODS[m], ledger: !!METHODS[m] })),
        rows, totals, warnings: [...new Set(warnings)]
    };
}

module.exports = { stockValuation, VALUATION_METHODS: ALL_METHODS };
