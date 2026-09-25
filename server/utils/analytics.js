// =============================================
// utils/analytics.js
// Inventory classification, forecasting and comparison reports. Everything
// is plain arithmetic on the ERP's own data (no external / paid AI):
//   fsn                 Fast / Slow / Non-moving: turnover and days since the
//                       last sale
//   abc                 A / B / C by sales value (or stock value), 70 / 20 / 10
//   xyz                 X / Y / Z by demand variability (coefficient of
//                       variation of monthly qty)
//   abc_xyz             the 9-cell matrix
//   stock_cover         days of stock left at the current sales rate,
//                       expected stock-out date, reorder suggestion
//   turnover            inventory turnover and days in stock per item
//   dead_stock          stock with no movement at all for N days
//   sales_forecast      next N months per item / group / customer / total -
//                       moving average, weighted average, linear trend,
//                       seasonal (last year x growth) and Holt smoothing; the
//                       method with the lowest back-test error is used
//   purchase_plan       forecast demand over lead time + safety stock - stock
//                       - open purchase orders = qty to buy
//   cash_forecast       receivables / payables falling due (credit days) and
//                       PDC by cheque date, week by week from today's cash
//   period_compare      month by month sales, purchase, returns, gross margin
//                       this period vs the previous period / last year
//   customer_rfm        Recency / Frequency / Monetary segments, new and lost
//                       customers against the previous period
// =============================================
const { parseTradeQuery, loadTradeLines } = require('./tradeLines');
const { stockReport } = require('./stockReport');
const { loadGroups, sectionOf, ledgerBalances } = require('./financialEngine');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const today = () => new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const d2n = s => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
const n2d = n => new Date(n).toISOString().slice(0, 10);
const addDays = (s, k) => n2d(d2n(s) + k * DAY);
const days = (a, b) => Math.round((d2n(b) - d2n(a)) / DAY);
const monthKey = s => String(s).slice(0, 7);
const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + k, 1)); return x.toISOString().slice(0, 7); };
const monthsBetween = (a, b) => { const out = []; for (let m = monthKey(a); m <= monthKey(b); m = addMonths(m, 1)) out.push(m); return out; };
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

// Posted sales (or purchase) lines, returns negative.
async function tradeLines(c, t, side, from, to, extra = {}) {
    const f = parseTradeQuery({ side, date_from: from, date_to: to, kinds: 'main,return', ...extra });
    const { lines } = await loadTradeLines(c, t, f);
    return lines.map(l => ({ ...l, sq: l.kind === 'main' ? l.base_qty : -l.base_qty, sv: l.kind === 'main' ? l.net : -l.net }));
}
async function stockNow(c, t, q = {}) {
    const d = q.as_on || today();
    const r = await stockReport(c, t, { mode: 'summary', date_from: d, date_to: d, group_by: 'item', hide_zero: 'false', warehouse_id: q.warehouse_id || undefined,
        product_group_id: q.product_group_id || undefined, product_company_id: q.product_company_id || undefined });
    return Object.fromEntries((r.rows || []).map(x => [x.product_id, x]));
}
const productFilter = q => l => (!q.product_group_id || l.product_group_id === q.product_group_id) && (!q.product_company_id || l.product_company_id === q.product_company_id);

// ---------------------------------------------------------------- classification
function abcClass(rows, key, a = 70, b = 90) {
    const total = rows.reduce((s, r) => s + Math.max(0, r[key]), 0);
    let cum = 0;
    [...rows].sort((x, y) => y[key] - x[key]).forEach(r => {
        cum += Math.max(0, r[key]);
        const pct = total ? cum * 100 / total : 100;
        r.cum_pct = round2(pct); r.share_pct = total ? round2(Math.max(0, r[key]) * 100 / total) : 0;
        r.abc = r[key] <= 0 ? 'C' : pct - r.share_pct < a ? 'A' : pct - r.share_pct < b ? 'B' : 'C';
    });
    return rows;
}
function cv(values) {
    const n = values.length; if (!n) return null;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    if (mean <= 0) return null;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    return sd / mean;
}

async function itemBase(c, t, q) {
    const to = q.date_to || today(), from = q.date_from || addDays(to, -364);
    const [lines, stock] = await Promise.all([tradeLines(c, t, 'sales', from, to), stockNow(c, t, { ...q, as_on: to })]);
    const months = monthsBetween(from, to);
    const items = {};
    Object.values(stock).forEach(s => { items[s.product_id] = { product_id: s.product_id, product_code: s.product_code, product_name: s.product_name, group_name: s.group_name, company_name: s.company_name,
        unit: s.unit, stock_qty: round4(s.closing_qty), stock_value: round2(s.closing_value), opening_qty: s.opening_qty, qty: 0, value: 0, last_sale: null, bills: new Set(), monthly: Object.fromEntries(months.map(m => [m, 0])) }; });
    lines.filter(productFilter(q)).forEach(l => {
        const it = items[l.product_id] = items[l.product_id] || { product_id: l.product_id, product_code: l.product_code, product_name: l.product_name, group_name: l.group_name, company_name: l.company_name,
            unit: l.base_unit, stock_qty: 0, stock_value: 0, qty: 0, value: 0, last_sale: null, bills: new Set(), monthly: Object.fromEntries(months.map(m => [m, 0])) };
        it.qty += l.sq; it.value += l.sv;
        if (l.kind === 'main') { it.bills.add(l.doc_id); if (!it.last_sale || l.doc_date > it.last_sale) it.last_sale = l.doc_date; }
        if (it.monthly[l.month] !== undefined) it.monthly[l.month] += l.sq;
    });
    const span = Math.max(1, days(from, to) + 1);
    const list = Object.values(items).filter(i => !q.product_group_id || stock[i.product_id] || i.qty).map(i => ({
        ...i, qty: round4(i.qty), value: round2(i.value), bills: i.bills.size, daily_qty: i.qty / span,
        idle_days: i.last_sale ? days(i.last_sale, to) : null, monthly: months.map(m => round4(i.monthly[m]))
    }));
    return { from, to, months, span, list };
}

async function fsn(c, t, q) {
    const B = await itemBase(c, t, q);
    const fastT = Number(q.fast_turnover) || 3, slowT = Number(q.slow_turnover) || 1, nonDays = Number(q.non_moving_days) || 90;
    const rows = B.list.map(i => {
        const avgStock = Math.max(1e-9, ((Number(i.opening_qty) || 0) + Math.max(0, i.stock_qty)) / 2);
        const turnover = i.qty > 0 ? i.qty / avgStock : 0;
        const cls = i.qty <= 0 || i.idle_days === null || i.idle_days >= nonDays ? 'N' : turnover >= fastT ? 'F' : turnover >= slowT ? 'S' : 'S';
        return { ...i, monthly: undefined, turnover: round2(turnover), fsn: cls, fsn_label: { F: 'Fast moving', S: 'Slow moving', N: 'Non moving' }[cls] };
    }).filter(r => r.qty || r.stock_qty).sort((a, b) => 'FSN'.indexOf(a.fsn) - 'FSN'.indexOf(b.fsn) || b.turnover - a.turnover);
    const summary = ['F', 'S', 'N'].map(k => ({ class: k, items: rows.filter(r => r.fsn === k).length, sales_value: round2(rows.filter(r => r.fsn === k).reduce((s, r) => s + r.value, 0)), stock_value: round2(rows.filter(r => r.fsn === k).reduce((s, r) => s + r.stock_value, 0)) }));
    return { from: B.from, to: B.to, rules: { fast_turnover: fastT, slow_turnover: slowT, non_moving_days: nonDays }, summary, rows };
}
async function abc(c, t, q) {
    const B = await itemBase(c, t, q);
    const basis = q.basis === 'stock' ? 'stock_value' : q.basis === 'qty' ? 'qty' : 'value';
    const rows = abcClass(B.list.filter(r => r[basis] > 0 || basis === 'value' && r.stock_qty > 0).map(r => ({ ...r, monthly: undefined })), basis, Number(q.a_pct) || 70, Number(q.b_pct) || 90)
        .sort((a, b) => b[basis] - a[basis]);
    const summary = ['A', 'B', 'C'].map(k => { const g = rows.filter(r => r.abc === k); return { class: k, items: g.length, items_pct: rows.length ? round2(g.length * 100 / rows.length) : 0, value: round2(g.reduce((s, r) => s + r[basis], 0)) }; });
    return { from: B.from, to: B.to, basis, summary, rows };
}
async function xyz(c, t, q) {
    const B = await itemBase(c, t, q);
    const rows = B.list.filter(r => r.qty > 0).map(r => {
        const v = cv(r.monthly.map(x => Math.max(0, x)));
        const cls = v === null ? 'Z' : v <= (Number(q.x_cv) || 0.5) ? 'X' : v <= (Number(q.y_cv) || 1) ? 'Y' : 'Z';
        return { ...r, cv: v === null ? null : round2(v), xyz: cls, xyz_label: { X: 'Steady demand', Y: 'Variable demand', Z: 'Irregular demand' }[cls] };
    }).sort((a, b) => (a.cv ?? 99) - (b.cv ?? 99));
    return { from: B.from, to: B.to, months: B.months, rows };
}
async function abcXyz(c, t, q) {
    const [A, X] = await Promise.all([abc(c, t, q), xyz(c, t, q)]);
    const xOf = Object.fromEntries(X.rows.map(r => [r.product_id, r]));
    const rows = A.rows.map(r => ({ ...r, cv: xOf[r.product_id]?.cv ?? null, xyz: xOf[r.product_id]?.xyz || 'Z', cell: `${r.abc}${xOf[r.product_id]?.xyz || 'Z'}` }));
    const ADVICE = { AX: 'Keep continuous stock, tight control', AY: 'Safety stock + frequent review', AZ: 'Order to demand, watch closely', BX: 'Regular replenishment', BY: 'Periodic review', BZ: 'Order on demand',
        CX: 'Bulk / infrequent orders', CY: 'Low stock, periodic review', CZ: 'Stock only on order or discontinue' };
    const matrix = {};
    rows.forEach(r => { const m = (matrix[r.cell] = matrix[r.cell] || { cell: r.cell, items: 0, value: 0, advice: ADVICE[r.cell] }); m.items++; m.value = round2(m.value + r.value); });
    return { from: A.from, to: A.to, matrix: Object.values(matrix).sort((a, b) => a.cell.localeCompare(b.cell)), rows };
}

async function stockCover(c, t, q) {
    const B = await itemBase(c, t, { ...q, date_from: q.date_from || addDays(q.date_to || today(), -89) });
    const ids = B.list.map(r => r.product_id);
    const prods = await inChunks(ids, async ch => (await c.from('products').select('id, lead_time_days, minimum_stock, reorder_qty, maximum_stock').in('id', ch)).data || []);
    const P = Object.fromEntries(prods.map(p => [p.id, p]));
    const rows = B.list.filter(r => r.stock_qty > 0 || r.qty > 0).map(r => {
        const p = P[r.product_id] || {}, lt = Number(p.lead_time_days) || Number(q.lead_days) || 7;
        const cover = r.daily_qty > 1e-9 ? r.stock_qty / r.daily_qty : null;
        const out = cover !== null ? addDays(B.to, Math.floor(cover)) : null;
        const reorderAt = r.daily_qty * lt;
        const suggest = cover !== null && cover <= lt + (Number(q.buffer_days) || 7) ? Math.max(Number(p.reorder_qty) || 0, round4(r.daily_qty * (lt + (Number(q.cover_days) || 30)) - r.stock_qty)) : 0;
        return { ...r, monthly: undefined, avg_daily_sales: round4(r.daily_qty), cover_days: cover === null ? null : Math.round(cover), stock_out_date: out, lead_time_days: lt,
            reorder_point: round4(reorderAt), status: cover === null ? (r.stock_qty > 0 ? 'no sales' : '') : cover <= lt ? 'order now' : cover <= lt + 7 ? 'order soon' : cover > 180 ? 'over-stocked' : 'ok',
            suggested_qty: round4(Math.max(0, suggest)) };
    }).sort((a, b) => (a.cover_days ?? 1e9) - (b.cover_days ?? 1e9));
    return { from: B.from, to: B.to, rows };
}
async function turnover(c, t, q) {
    const B = await itemBase(c, t, q);
    const st = await stockReport(c, t, { mode: 'summary', date_from: B.from, date_to: B.to, group_by: 'item', hide_zero: 'true' });
    const rows = (st.rows || []).map(r => {
        const cogs = r.out?.sales?.value ? r.out.sales.value - (r.in?.sales_return?.value || 0) : r.out_value;
        const avg = (r.opening_value + r.closing_value) / 2;
        const turn = avg > 0 ? cogs / avg : null;
        return { product_code: r.product_code, product_name: r.product_name, group_name: r.group_name, opening_value: r.opening_value, closing_value: r.closing_value, cogs: round2(cogs),
            avg_inventory: round2(avg), turnover: turn === null ? null : round2(turn), days_in_stock: turn ? Math.round(B.span / turn) : null };
    }).sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1));
    const tc = rows.reduce((s, r) => s + r.cogs, 0), ta = rows.reduce((s, r) => s + r.avg_inventory, 0);
    return { from: B.from, to: B.to, rows, totals: { cogs: round2(tc), avg_inventory: round2(ta), turnover: ta ? round2(tc / ta) : null, days_in_stock: ta && tc ? Math.round(B.span * ta / tc) : null } };
}
async function deadStock(c, t, q) {
    const n = Number(q.days) || 180, to = q.date_to || today(), since = addDays(to, -n);
    const moves = await fetchAll(() => c.from('stock_movements').select('product_id, movement_date').eq('tenant_id', t).gte('movement_date', since).lte('movement_date', to).order('id'));
    const moved = new Set(moves.map(m => m.product_id));
    const lastAll = {};
    (await fetchAll(() => c.from('stock_movements').select('product_id, movement_date').eq('tenant_id', t).lte('movement_date', to).order('id'))).forEach(m => { const d = String(m.movement_date).slice(0, 10); if (!lastAll[m.product_id] || d > lastAll[m.product_id]) lastAll[m.product_id] = d; });
    const stock = await stockNow(c, t, { ...q, as_on: to });
    const rows = Object.values(stock).filter(s => s.closing_qty > 1e-9 && !moved.has(s.product_id)).map(s => ({ product_code: s.product_code, product_name: s.product_name, group_name: s.group_name,
        company_name: s.company_name, unit: s.unit, stock_qty: s.closing_qty, stock_value: s.closing_value, last_movement: lastAll[s.product_id] || '(opening)', idle_days: lastAll[s.product_id] ? days(lastAll[s.product_id], to) : null }))
        .sort((a, b) => b.stock_value - a.stock_value);
    return { days: n, rows, totals: { items: rows.length, stock_value: round2(rows.reduce((s, r) => s + r.stock_value, 0)) } };
}

// ---------------------------------------------------------------- forecasting
const FORECASTERS = {
    moving_average: (h, k) => { const w = h.slice(-3); const a = w.length ? w.reduce((s, v) => s + v, 0) / w.length : 0; return Array(k).fill(a); },
    weighted_average: (h, k) => { const w = h.slice(-3); const wt = w.map((_, i) => i + 1); const a = w.length ? w.reduce((s, v, i) => s + v * wt[i], 0) / wt.reduce((s, v) => s + v, 0) : 0; return Array(k).fill(a); },
    linear_trend: (h, k) => {
        const n = h.length; if (n < 2) return Array(k).fill(h[0] || 0);
        const mx = (n - 1) / 2, my = h.reduce((s, v) => s + v, 0) / n;
        const b = h.reduce((s, v, i) => s + (i - mx) * (v - my), 0) / h.reduce((s, _, i) => s + (i - mx) ** 2, 0);
        return Array.from({ length: k }, (_, j) => my + b * (n + j - mx));
    },
    seasonal: (h, k) => {                               // same month last year x recent growth
        if (h.length < 13) return null;
        const last3 = h.slice(-3).reduce((s, v) => s + v, 0), prior3 = h.slice(-15, -12).reduce((s, v) => s + v, 0);
        const g = prior3 > 0 ? Math.min(3, Math.max(0.2, last3 / prior3)) : 1;
        return Array.from({ length: k }, (_, j) => (h[h.length - 12 + (j % 12)] || 0) * g);
    },
    holt: (h, k) => {                                   // double exponential smoothing
        if (h.length < 2) return Array(k).fill(h[0] || 0);
        const a = 0.5, b = 0.3; let L = h[0], T = h[1] - h[0];
        for (let i = 1; i < h.length; i++) { const pl = L; L = a * h[i] + (1 - a) * (L + T); T = b * (L - pl) + (1 - b) * T; }
        return Array.from({ length: k }, (_, j) => L + (j + 1) * T);
    }
};
const METHOD_LABEL = { moving_average: '3-month moving average', weighted_average: 'Weighted moving average', linear_trend: 'Linear trend', seasonal: 'Seasonal (last year x growth)', holt: 'Holt exponential smoothing' };
// Back-test: forecast each of the last `test` months from the months before it.
function bestMethod(h, wanted) {
    const methods = wanted && FORECASTERS[wanted] ? [wanted] : Object.keys(FORECASTERS);
    const test = Math.min(3, Math.max(0, h.length - 3));
    let best = null;
    methods.forEach(m => {
        let err = 0, cnt = 0;
        for (let i = h.length - test; i < h.length; i++) { const f = FORECASTERS[m](h.slice(0, i), 1); if (!f) { err = Infinity; break; } err += Math.abs(f[0] - h[i]); cnt++; }
        const mae = cnt ? err / cnt : 0;
        if (FORECASTERS[m](h, 1) && (!best || mae < best.mae)) best = { method: m, mae };
    });
    return best || { method: 'moving_average', mae: 0 };
}
async function salesForecast(c, t, q) {
    const to = q.date_to || today(), histMonths = Math.min(36, Math.max(3, Number(q.history_months) || 24)), ahead = Math.min(24, Math.max(1, Number(q.months) || 3));
    const lastFull = addMonths(monthKey(to), -1);
    const months = Array.from({ length: histMonths }, (_, i) => addMonths(lastFull, i - histMonths + 1));
    const from = `${months[0]}-01`;
    const side = q.side === 'purchase' ? 'purchase' : 'sales';
    const lines = (await tradeLines(c, t, side, from, n2d(d2n(`${addMonths(lastFull, 1)}-01`) - DAY))).filter(productFilter(q));
    const by = ['product', 'product_group', 'product_company', 'party', 'total'].includes(q.group_by) ? q.group_by : 'product';
    const measure = q.measure === 'qty' ? 'sq' : 'sv';
    const keyOf = l => (by === 'total' ? 'total' : by === 'product' ? l.product_id : by === 'product_group' ? l.product_group_id : by === 'product_company' ? l.product_company_id : l.party_id);
    const nameOf = l => (by === 'total' ? 'All' : by === 'product' ? l.product_name : by === 'product_group' ? l.group_name : by === 'product_company' ? l.company_name : l.party_name);
    const series = {};
    lines.forEach(l => {
        const k = keyOf(l) || '-';
        const s = (series[k] = series[k] || { key: k, name: nameOf(l) || '(none)', h: Object.fromEntries(months.map(m => [m, 0])) });
        if (s.h[l.month] !== undefined) s.h[l.month] += l[measure];
    });
    const future = Array.from({ length: ahead }, (_, i) => addMonths(lastFull, i + 1));
    let rows = Object.values(series).map(s => {
        const h = months.map(m => Math.max(0, s.h[m]));
        const best = bestMethod(h, q.method);
        const f = (FORECASTERS[best.method](h, ahead) || []).map(v => Math.max(0, v));
        const last12 = h.slice(-12).reduce((a, b) => a + b, 0), prev12 = h.slice(-24, -12).reduce((a, b) => a + b, 0);
        return { key: s.key, name: s.name, method: best.method, method_label: METHOD_LABEL[best.method], mae: round2(best.mae),
            history: h.map(v => (measure === 'sq' ? round4(v) : round2(v))), forecast: f.map(v => (measure === 'sq' ? round4(v) : round2(v))),
            forecast_total: round2(f.reduce((a, b) => a + b, 0)), last_12: round2(last12), growth_pct: prev12 ? round2((last12 - prev12) * 100 / prev12) : null };
    }).filter(r => r.history.some(v => v) );
    rows.sort((a, b) => b.forecast_total - a.forecast_total);
    if (Number(q.top) > 0) rows = rows.slice(0, Number(q.top));
    return { side, measure: measure === 'sq' ? 'qty' : 'value', group_by: by, history_months: months, forecast_months: future, rows,
        totals: { forecast: future.map((_, i) => round2(rows.reduce((s, r) => s + r.forecast[i], 0))), history: months.map((_, i) => round2(rows.reduce((s, r) => s + r.history[i], 0))) } };
}
async function purchasePlan(c, t, q) {
    const F = await salesForecast(c, t, { ...q, side: 'sales', group_by: 'product', measure: 'qty', months: Math.max(1, Number(q.months) || 1), top: 0 });
    const stock = await stockNow(c, t, q);
    const ids = [...new Set([...F.rows.map(r => r.key), ...Object.keys(stock)])];
    const [prods, poLines] = await Promise.all([
        inChunks(ids, async ch => (await c.from('products').select('id, product_name, product_code, lead_time_days, reorder_qty, default_vendor_id').in('id', ch)).data || []),
        fetchAll(() => c.from('purchase_order_details').select('product_id, qty, qty_received, order:order_id!inner(status, tenant_id)').eq('order.tenant_id', t).in('order.status', ['confirmed', 'partially_received']).order('id')).catch(() => [])
    ]);
    const P = Object.fromEntries(prods.map(p => [p.id, p]));
    const onOrder = {};
    poLines.forEach(l => { onOrder[l.product_id] = (onOrder[l.product_id] || 0) + Math.max(0, Number(l.qty) - Number(l.qty_received || 0)); });
    const vendors = [...new Set(prods.map(p => p.default_vendor_id).filter(Boolean))];
    const V = Object.fromEntries((await inChunks(vendors, async ch => (await c.from('ledger_accounts').select('id, account_name').in('id', ch)).data || [])).map(v => [v.id, v.account_name]));
    const z = Number(q.service_level) >= 99 ? 2.33 : Number(q.service_level) >= 95 ? 1.65 : 1.28;
    const rows = F.rows.map(r => {
        const p = P[r.key] || {}, lt = Number(p.lead_time_days) || Number(q.lead_days) || 7, cover = Number(q.cover_days) || 30;
        const monthly = r.forecast[0] || 0, daily = monthly / 30;
        const sd = Math.sqrt(r.history.slice(-6).reduce((s, v, _, arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return s + (v - m) ** 2; }, 0) / 6) / Math.sqrt(30);
        const safety = z * sd * Math.sqrt(lt);
        const need = daily * (lt + cover) + safety;
        const have = Math.max(0, stock[r.key]?.closing_qty || 0) + (onOrder[r.key] || 0);
        const buy = Math.max(0, need - have);
        return { product_id: r.key, product_code: p.product_code || '', product_name: r.name, vendor: V[p.default_vendor_id] || '', forecast_month: round4(monthly), daily_demand: round4(daily),
            lead_time_days: lt, safety_stock: round4(safety), requirement: round4(need), stock: round4(stock[r.key]?.closing_qty || 0), on_order: round4(onOrder[r.key] || 0),
            suggested_qty: round4(buy > 0 ? Math.max(buy, Number(p.reorder_qty) || 0) : 0), method: r.method_label };
    }).filter(r => r.suggested_qty > 0 || q.all === 'true').sort((a, b) => b.suggested_qty - a.suggested_qty);
    return { rows, service_level: Number(q.service_level) || 90 };
}
async function cashForecast(c, t, q) {
    const start = q.start || today(), weeks = Math.min(52, Math.max(1, Number(q.weeks) || 12));
    const [groups, leds, refs, pdcs] = await Promise.all([
        loadGroups(c, t),
        fetchAll(() => c.from('ledger_accounts').select('id, account_name, account_group_id, credit_days, category_type, opening_balance, opening_balance_type').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('bill_wise_references').select('ledger_id, source_doc_no, source_date, nature, remaining_amount').eq('tenant_id', t).gt('remaining_amount', 0).order('id')),
        fetchAll(() => c.from('pdc_vouchers').select('party_ledger_id, voucher_type, amount, cheque_date, status, doc_no').eq('tenant_id', t).eq('status', 'pending').order('id')).catch(() => [])
    ]);
    const L = Object.fromEntries(leds.map(l => [l.id, l]));
    const cashIds = leds.filter(l => groups[l.account_group_id]?.anchor === 'CASH_BANK' || ['cash', 'bank'].includes(l.category_type)).map(l => l.id);
    let cash = cashIds.reduce((s, id) => s + (L[id].opening_balance_type === 'cr' ? -1 : 1) * (Number(L[id].opening_balance) || 0), 0);
    const glc = await inChunks(cashIds, ch => fetchAll(() => c.from('ledger_transaction_lines').select('debit_amount, credit_amount, batch:batch_id!inner(batch_date)').eq('tenant_id', t).in('ledger_account_id', ch).lt('batch.batch_date', start).order('id')), 100);
    glc.forEach(l => { cash += Number(l.debit_amount || 0) - Number(l.credit_amount || 0); });
    const buckets = Array.from({ length: weeks }, (_, i) => ({ week: i + 1, from: addDays(start, i * 7), to: addDays(start, i * 7 + 6), receipts: 0, payments: 0, pdc_in: 0, pdc_out: 0 }));
    const overdue = { receipts: 0, payments: 0 };
    const place = (date, field, amt) => {
        if (date < start) { overdue[field === 'receipts' || field === 'pdc_in' ? 'receipts' : 'payments'] += amt; return; }
        const b = buckets.find(x => date >= x.from && date <= x.to); if (b) b[field] += amt;
    };
    refs.forEach(r => {
        const due = addDays(String(r.source_date).slice(0, 10), Number(L[r.ledger_id]?.credit_days) || 0);
        place(due, r.nature === 'dr' ? 'receipts' : 'payments', Number(r.remaining_amount) || 0);
    });
    pdcs.forEach(p => place(String(p.cheque_date).slice(0, 10), p.voucher_type === 'issued' ? 'pdc_out' : 'pdc_in', Number(p.amount) || 0));
    // overdue amounts are assumed to arrive / go out in week 1 (shown separately too)
    const collect = Number(q.overdue_collection_pct ?? 50) / 100;
    if (buckets.length) { buckets[0].receipts += overdue.receipts * collect; buckets[0].payments += overdue.payments; }
    let run = cash;
    buckets.forEach(b => {
        b.opening = round2(run);
        const inn = b.receipts + b.pdc_in, out = b.payments + b.pdc_out;
        run += inn - out;
        Object.assign(b, { receipts: round2(b.receipts), payments: round2(b.payments), pdc_in: round2(b.pdc_in), pdc_out: round2(b.pdc_out), net: round2(inn - out), closing: round2(run) });
    });
    return { start, opening_cash: round2(cash), overdue: { receipts: round2(overdue.receipts), payments: round2(overdue.payments), collection_assumed_pct: round2(collect * 100) }, weeks: buckets,
        lowest: buckets.length ? buckets.reduce((m, b) => (b.closing < m.closing ? b : m), buckets[0]) : null };
}

// ---------------------------------------------------------------- comparison
function comparePeriod(q, from, to) {
    if (q.compare === 'custom' && q.compare_from && q.compare_to) return { from: q.compare_from, to: q.compare_to, label: 'Custom period' };
    if (q.compare === 'previous') { const len = days(from, to); const pTo = addDays(from, -1); return { from: addDays(pTo, -len), to: pTo, label: 'Previous period' }; }
    const back = s => { const x = new Date(d2n(s)); x.setUTCFullYear(x.getUTCFullYear() - 1); return n2d(x.getTime()); };
    return { from: back(from), to: back(to), label: 'Same period last year' };
}
async function periodCompare(c, t, q) {
    const to = q.date_to || today(), from = q.date_from || `${to.slice(0, 4)}-01-01`;
    const cmp = comparePeriod(q, from, to);
    const sum = async (a, b) => {
        const [s, p] = await Promise.all([tradeLines(c, t, 'sales', a, b), tradeLines(c, t, 'purchase', a, b)]);
        const m = {};
        const add = (month, k, v) => { const x = (m[month] = m[month] || { sales: 0, sales_return: 0, purchase: 0, purchase_return: 0, bills: new Set(), customers: new Set() }); x[k] += v; };
        s.forEach(l => { add(l.month, l.kind === 'main' ? 'sales' : 'sales_return', l.net); if (l.kind === 'main') { m[l.month].bills.add(l.doc_id); m[l.month].customers.add(l.party_id); } });
        p.forEach(l => add(l.month, l.kind === 'main' ? 'purchase' : 'purchase_return', l.net));
        return m;
    };
    const [cur, prev] = await Promise.all([sum(from, to), sum(cmp.from, cmp.to)]);
    const cm = monthsBetween(from, to), pm = monthsBetween(cmp.from, cmp.to);
    const rows = cm.map((m, i) => {
        const a = cur[m] || {}, b = prev[pm[i]] || {};
        const net = x => (x.sales || 0) - (x.sales_return || 0), pur = x => (x.purchase || 0) - (x.purchase_return || 0);
        const r = { month: m, compare_month: pm[i] || '', sales: round2(net(a)), sales_prev: round2(net(b)), purchase: round2(pur(a)), purchase_prev: round2(pur(b)),
            bills: a.bills?.size || 0, bills_prev: b.bills?.size || 0, customers: a.customers?.size || 0, customers_prev: b.customers?.size || 0 };
        r.sales_change_pct = r.sales_prev ? round2((r.sales - r.sales_prev) * 100 / Math.abs(r.sales_prev)) : null;
        r.purchase_change_pct = r.purchase_prev ? round2((r.purchase - r.purchase_prev) * 100 / Math.abs(r.purchase_prev)) : null;
        r.avg_bill = r.bills ? round2(r.sales / r.bills) : 0; r.avg_bill_prev = r.bills_prev ? round2(r.sales_prev / r.bills_prev) : 0;
        return r;
    });
    const tot = k => round2(rows.reduce((s, r) => s + r[k], 0));
    const totals = { sales: tot('sales'), sales_prev: tot('sales_prev'), purchase: tot('purchase'), purchase_prev: tot('purchase_prev'), bills: tot('bills'), bills_prev: tot('bills_prev') };
    totals.sales_change_pct = totals.sales_prev ? round2((totals.sales - totals.sales_prev) * 100 / Math.abs(totals.sales_prev)) : null;
    totals.purchase_change_pct = totals.purchase_prev ? round2((totals.purchase - totals.purchase_prev) * 100 / Math.abs(totals.purchase_prev)) : null;
    return { from, to, compare: cmp, rows, totals };
}
async function customerRfm(c, t, q) {
    const to = q.date_to || today(), from = q.date_from || addDays(to, -364);
    const cmp = comparePeriod({ compare: 'previous' }, from, to);
    const [lines, prev] = await Promise.all([tradeLines(c, t, 'sales', from, to), tradeLines(c, t, 'sales', cmp.from, cmp.to)]);
    const cust = {};
    lines.forEach(l => {
        if (!l.party_id) return;
        const x = (cust[l.party_id] = cust[l.party_id] || { party_id: l.party_id, name: l.party_name, last: null, bills: new Set(), value: 0, area: l.area_name, agent: l.agent_name });
        x.value += l.sv; if (l.kind === 'main') { x.bills.add(l.doc_id); if (!x.last || l.doc_date > x.last) x.last = l.doc_date; }
    });
    const prevSet = new Set(prev.map(l => l.party_id).filter(Boolean));
    const prevValue = {};
    prev.forEach(l => { if (l.party_id) prevValue[l.party_id] = (prevValue[l.party_id] || 0) + l.sv; });
    let rows = Object.values(cust).map(x => ({ ...x, bills: x.bills.size, value: round2(x.value), recency_days: x.last ? days(x.last, to) : null }));
    const score = (arr, key, desc) => { const s = [...arr].sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key])); s.forEach((r, i) => { r[`${key}_score`] = 5 - Math.floor(i * 5 / Math.max(1, s.length)); }); };
    score(rows.filter(r => r.recency_days !== null), 'recency_days', false);
    score(rows, 'bills', true); score(rows, 'value', true);
    rows = rows.map(r => {
        const R = r.recency_days_score || 1, F = r.bills_score, M = r.value_score;
        const seg = R >= 4 && F >= 4 && M >= 4 ? 'Champion' : R >= 3 && F >= 3 ? 'Loyal' : R >= 4 && F <= 2 ? 'New / Promising' : R <= 2 && F >= 3 ? 'At risk' : R <= 2 && F <= 2 ? 'Hibernating' : 'Needs attention';
        return { ...r, rfm: `${R}${F}${M}`, segment: seg, is_new: !prevSet.has(r.party_id), prev_value: round2(prevValue[r.party_id] || 0), change: round2(r.value - (prevValue[r.party_id] || 0)) };
    }).sort((a, b) => b.value - a.value);
    const here = new Set(rows.map(r => r.party_id));
    const lost = Object.entries(prevValue).filter(([id]) => !here.has(id)).map(([id, v]) => ({ party_id: id, name: prev.find(l => l.party_id === id)?.party_name || '', prev_value: round2(v) })).sort((a, b) => b.prev_value - a.prev_value);
    const segments = {};
    rows.forEach(r => { const s = (segments[r.segment] = segments[r.segment] || { segment: r.segment, customers: 0, value: 0 }); s.customers++; s.value = round2(s.value + r.value); });
    return { from, to, compare: cmp, rows, lost, segments: Object.values(segments), totals: { customers: rows.length, new: rows.filter(r => r.is_new).length, lost: lost.length } };
}

// Income / expense ledgers: this period vs the comparison period.
async function expenseCompare(c, t, q) {
    const to = q.date_to || today(), from = q.date_from || `${to.slice(0, 4)}-01-01`;
    const cmp = comparePeriod(q, from, to);
    const [groups, cur, prev] = await Promise.all([loadGroups(c, t), ledgerBalances(c, t, { from, to }), ledgerBalances(c, t, { from: cmp.from, to: cmp.to })]);
    const rows = Object.values(cur).map(b => {
        const g = groups[b.account_group_id], sec = sectionOf(g);
        if (!/income|expense/.test(sec)) return null;
        const nat = x => (x ? (/income/.test(sec) ? x.cr - x.dr : x.dr - x.cr) : 0);
        const a = round2(nat(b)), p = round2(nat(prev[b.id]));
        if (!a && !p) return null;
        return { ledger_id: b.id, ledger: b.account_name, group: g?.group_name || '', section: sec, current: a, previous: p, change: round2(a - p), change_pct: p ? round2((a - p) * 100 / Math.abs(p)) : null,
            adverse: /expense/.test(sec) ? a > p : a < p };
    }).filter(Boolean).sort((x, y) => x.section.localeCompare(y.section) || Math.abs(y.change) - Math.abs(x.change));
    const tot = sec => { const r = rows.filter(x => x.section === sec); return { current: round2(r.reduce((s, x) => s + x.current, 0)), previous: round2(r.reduce((s, x) => s + x.previous, 0)) }; };
    const sections = ['trading_income', 'indirect_income', 'trading_expense', 'indirect_expense'].map(k => ({ section: k, ...tot(k) }));
    const inc = sections.filter(x => /income/.test(x.section)), exp = sections.filter(x => /expense/.test(x.section));
    const np = k => round2(inc.reduce((s, x) => s + x[k], 0) - exp.reduce((s, x) => s + x[k], 0));
    return { from, to, compare: cmp, rows, sections, net: { current: np('current'), previous: np('previous') } };
}
// Days Sales Outstanding / Days Payables Outstanding month by month.
async function dsoDpo(c, t, q) {
    const to = q.date_to || today(), n = Math.min(24, Math.max(3, Number(q.months) || 12));
    const lastM = monthKey(to), months = Array.from({ length: n }, (_, i) => addMonths(lastM, i - n + 1));
    const from = `${months[0]}-01`;
    const [groups, leds, sales, purch] = await Promise.all([
        loadGroups(c, t), fetchAll(() => c.from('ledger_accounts').select('id, account_group_id, opening_balance, opening_balance_type').eq('tenant_id', t).order('id')),
        tradeLines(c, t, 'sales', from, to), tradeLines(c, t, 'purchase', from, to)
    ]);
    const recv = new Set(leds.filter(l => groups[l.account_group_id]?.anchor === 'RECEIVABLES').map(l => l.id));
    const pay = new Set(leds.filter(l => groups[l.account_group_id]?.anchor === 'PAYABLES').map(l => l.id));
    const ids = [...recv, ...pay];
    let r0 = 0, p0 = 0;
    leds.forEach(l => { const o = (l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0); if (recv.has(l.id)) r0 += o; if (pay.has(l.id)) p0 -= o; });
    const lines = await inChunks(ids, ch => fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)').eq('tenant_id', t).in('ledger_account_id', ch).lte('batch.batch_date', to).order('id')), 100);
    const endOf = m => n2d(d2n(`${addMonths(m, 1)}-01`) - DAY);
    const rows = months.map(m => {
        const e = endOf(m) > to ? to : endOf(m);
        let r = r0, p = p0;
        lines.forEach(l => { if (String(l.batch.batch_date).slice(0, 10) <= e) { const v = Number(l.debit_amount || 0) - Number(l.credit_amount || 0); if (recv.has(l.ledger_account_id)) r += v; if (pay.has(l.ledger_account_id)) p -= v; } });
        const sv = sales.filter(l => l.month === m).reduce((s, l) => s + l.sv + (l.kind === 'main' ? l.tax : -l.tax), 0);
        const pv = purch.filter(l => l.month === m).reduce((s, l) => s + l.sv + (l.kind === 'main' ? l.tax : -l.tax), 0);
        const dim = Number(e.slice(8, 10));
        return { month: m, sales: round2(sv), receivables: round2(r), dso: sv > 0 ? Math.round(r * dim / sv) : null, purchases: round2(pv), payables: round2(p), dpo: pv > 0 ? Math.round(p * dim / pv) : null };
    });
    return { rows };
}

const VIEWS = { fsn, abc, xyz, abc_xyz: abcXyz, stock_cover: stockCover, turnover, dead_stock: deadStock, sales_forecast: salesForecast, purchase_plan: purchasePlan,
    cash_forecast: cashForecast, period_compare: periodCompare, customer_rfm: customerRfm, expense_compare: expenseCompare, dso_dpo: dsoDpo };
async function analyticsReport(c, t, view, q) {
    if (!VIEWS[view]) throw httpError('Unknown analytics report');
    return VIEWS[view](c, t, q || {});
}

module.exports = { analyticsReport, FORECASTERS, bestMethod, abcClass, cv, comparePeriod };
