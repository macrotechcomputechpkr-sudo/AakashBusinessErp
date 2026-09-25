// =============================================
// utils/tradeAnalysis.js
// Sales / Purchase Analysis, Monthly Analysis and Profitability over the
// lines of utils/tradeLines.js.
//
// Rows: up to 4 levels of any dimension, in the order asked, e.g.
//   area > customer > product group > product
// Columns (optional): month, or any other dimension (customer vs product
// group ...). Every node carries the full measure set, and the same per
// column, with subtotals at each level and a grand total.
//
// Measures (qty = base unit unless noted; "return" = return + non-saleable):
//   main_qty / main_value      Sales (or Purchase) - bills
//   return_qty / return_value  Returns; nonsalable_qty / _value its part
//   net_qty / net_value        main - return
//   entered_qty, alt_qty, alt1_qty, free_qty   as entered (net of returns)
//   display_qty                net qty in a chosen unit (per item factor)
//   gross, discount, tax, amount (net of returns), avg_rate (net value / net qty)
//   lines, docs, parties, products (distinct counts)
//   cost, profit, margin_pct   Profitability (sales): cost of sales = base qty
//                              x the item's cost on the bill date under the
//                              chosen valuation method; a Sales Return gives the
//                              cost back, a Non-saleable Return does not (the
//                              goods are a loss).
// "Only returns" = kinds=return,nonsalable.
// =============================================
const { parseTradeQuery, loadTradeLines, round2, round4 } = require('./tradeLines');
const { costRatesOn, METHODS } = require('./stockEngine');
const { lookupUdf } = require('./documentCatalog');

const DIMS = {
    party: { label: s => (s === 'sales' ? 'Customer' : 'Supplier'), id: 'party_id', name: 'party_name', code: 'party_code' },
    sub_ledger: { label: 'Sub Ledger', id: 'sub_ledger_id', name: 'sub_ledger_name' },
    product: { label: 'Product', id: 'product_id', name: 'product_name', code: 'product_code' },
    product_group: { label: 'Product Group', id: 'product_group_id', name: 'group_name' },
    main_group: { label: 'Main Product Group', id: 'main_group_id', name: 'main_group_name' },
    product_company: { label: 'Product Company', id: 'product_company_id', name: 'company_name' },
    category: { label: 'Product Category', id: 'category_name', name: 'category_name' },
    item_type: { label: 'Item Type', id: 'item_type', name: 'item_type' },
    area: { label: 'Area', id: 'area_id', name: 'area_name' },
    main_area: { label: 'Main Area', id: 'main_area_id', name: 'main_area_name' },
    route: { label: 'Route', id: 'route_id', name: 'route_name' },
    agent: { label: 'Salesman / Agent', id: 'agent_id', name: 'agent_name' },
    branch: { label: 'Branch', id: 'branch_id', name: 'branch_name' },
    warehouse: { label: 'Warehouse', id: 'warehouse_id', name: 'warehouse_name' },
    cost_center: { label: 'Cost Center', id: 'cost_center_id', name: 'cost_center_name' },
    business_unit: { label: 'Business Unit', id: 'business_unit_id', name: 'business_unit_name' },
    doc_type: { label: 'Document Type', id: 'doc_type', name: 'doc_label' },
    doc: { label: 'Bill / Document', id: 'doc_id', name: 'doc_no' },
    month: { label: 'Month', id: 'month', name: 'month' },
    date: { label: 'Date', id: 'doc_date', name: 'doc_date' },
    batch: { label: 'Batch', id: 'batch_no', name: 'batch_no' }
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = m => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : '');
const ITEM_TYPE_LABEL = { raw_material: 'Raw Material', semi_finished: 'Semi-Finished', finished_good: 'Finished Good', trading_item: 'Trading Item',
    fixed_asset: 'Fixed Asset', service: 'Service', non_inventory: 'Non-Inventory' };

const httpError = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
// User Defined Fields as dimensions: 'udf:<field id>' (value typed on the
// document, or on the line for a detail field).
const isUdf = k => /^udf:[0-9a-f-]{8,}$/i.test(k);
const isDim = k => !!DIMS[k] || isUdf(k);
async function attachUdf(c, t, lines, fieldIds) {
    const { data: defs, error } = await c.from('user_defined_fields').select('id, field_label, section').eq('tenant_id', t).in('id', fieldIds);
    if (error) throw error;
    const u = await lookupUdf(c, t, { documentIds: lines.map(l => l.doc_id), fieldIds });
    lines.forEach(l => { l.udf = { ...(u.docs[l.doc_id] || {}), ...(u.lines[l.line_id] || {}) }; });
    return Object.fromEntries((defs || []).map(d => [d.id, d.field_label]));
}
const dimLabel = (k, side, udfLabels) => (isUdf(k) ? udfLabels[k.slice(4)] || 'Custom field' : typeof DIMS[k].label === 'function' ? DIMS[k].label(side) : DIMS[k].label);
const dimValue = (key, l) => {
    if (isUdf(key)) {
        const v = l.udf ? l.udf[key.slice(4)] : null;
        return { key: v == null || v === '' ? '__none__' : `u:${v}`, label: v == null || v === '' ? '(blank)' : String(v), code: '', sort: null };
    }
    const d = DIMS[key];
    const id = l[d.id];
    let name = l[d.name];
    if (key === 'month') name = monthLabel(l.month);
    if (key === 'item_type') name = ITEM_TYPE_LABEL[l.item_type] || l.item_type;
    if (key === 'doc') name = `${l.doc_no} · ${l.doc_date}`;
    return { key: id == null || id === '' ? '__none__' : String(id), label: name || '(none)', code: d.code ? l[d.code] || '' : '', sort: key === 'month' || key === 'date' || key === 'doc' ? `${l.doc_date}|${l.doc_no}` : null };
};

function newMeasures() {
    return { main_qty: 0, main_value: 0, return_qty: 0, return_value: 0, nonsalable_qty: 0, nonsalable_value: 0,
        entered_qty: 0, alt_qty: 0, alt1_qty: 0, free_qty: 0, display_qty: 0, gross: 0, discount: 0, tax: 0, amount: 0,
        cost: 0, lines: 0, _docs: new Set(), _parties: new Set(), _products: new Set(), _unit: undefined };
}
function addLine(m, l, ctx) {
    const sign = l.kind === 'main' ? 1 : -1;
    if (l.kind === 'main') { m.main_qty += l.base_qty; m.main_value += l.net; }
    else { m.return_qty += l.base_qty; m.return_value += l.net; if (l.kind === 'nonsalable') { m.nonsalable_qty += l.base_qty; m.nonsalable_value += l.net; } }
    m.entered_qty += sign * l.qty; m.alt_qty += sign * l.alt_qty; m.alt1_qty += sign * l.alt1_qty; m.free_qty += sign * l.free_base_qty;
    m.display_qty += sign * (ctx.displayFactor ? l.base_qty / (ctx.displayFactor(l.product_id) || 1) : l.base_qty);
    m.gross += sign * l.gross; m.discount += sign * l.discount; m.tax += sign * l.tax; m.amount += sign * l.amount;
    if (ctx.withCost) m.cost += l.kind === 'main' ? l.cost : l.kind === 'return' ? -l.cost : 0;
    m.lines++; m._docs.add(l.doc_id); m._parties.add(l.party_id); m._products.add(l.product_id);
    // Unit info is shown only while a node holds one item.
    const u = `${l.product_id}`;
    m._unit = m._unit === undefined ? { id: u, base_unit: l.base_unit, dual: l.dual, dual_factor: l.dual_factor, primary_unit: l.primary_unit, unit: l.unit, alt_unit: l.alt_unit, alt1_unit: l.alt1_unit }
        : m._unit && m._unit.id === u ? m._unit : null;
}
function finish(m, withCost) {
    const out = {};
    ['main_qty', 'return_qty', 'nonsalable_qty', 'entered_qty', 'alt_qty', 'alt1_qty', 'free_qty', 'display_qty'].forEach(k => { out[k] = round4(m[k]); });
    ['main_value', 'return_value', 'nonsalable_value', 'gross', 'discount', 'tax', 'amount'].forEach(k => { out[k] = round2(m[k]); });
    out.net_qty = round4(m.main_qty - m.return_qty);
    out.net_value = round2(m.main_value - m.return_value);
    out.avg_rate = Math.abs(out.net_qty) > 1e-9 ? round4(out.net_value / out.net_qty) : 0;
    out.lines = m.lines; out.docs = m._docs.size; out.parties = m._parties.size; out.products = m._products.size;
    if (withCost) {
        out.cost = round2(m.cost);
        out.profit = round2(out.net_value - out.cost);
        out.margin_pct = out.net_value ? round2(out.profit * 100 / out.net_value) : 0;
        out.markup_pct = out.cost ? round2(out.profit * 100 / out.cost) : 0;
    }
    if (m._unit) {
        const u = m._unit;
        Object.assign(out, { base_unit: u.base_unit, unit: u.unit, alt_unit: u.alt_unit, alt1_unit: u.alt1_unit });
        if (u.dual && u.dual_factor > 1) {                 // e.g. 5 CRT 3 PCS
            const f = u.dual_factor, q = Math.abs(out.net_qty);
            out.dual = { primary: Math.floor(q / f + 1e-9) * Math.sign(out.net_qty || 1), secondary: round4(q - Math.floor(q / f + 1e-9) * f) * Math.sign(out.net_qty || 1), primary_unit: u.primary_unit, secondary_unit: u.base_unit };
        }
    }
    return out;
}

// Cost of each sales line (base qty x cost per base unit on its date).
async function attachCost(c, t, lines, method, masters) {
    const wants = {};
    lines.forEach(l => { (wants[l.product_id] = wants[l.product_id] || []).push({ date: l.doc_date, qty: l.kind === 'main' ? l.base_qty : 0 }); });
    const rates = await costRatesOn(c, t, wants, method);
    const warnings = new Set();
    lines.forEach(l => {
        let rate = rates[`${l.product_id}|${l.doc_date}`] || 0;
        if (!(rate > 0)) {
            rate = masters.purchaseRate[l.product_id] || 0;
            warnings.add(rate > 0 ? `${l.product_name}: no stock cost on ${l.doc_date} - master purchase rate used` : `${l.product_name}: no cost found - cost taken as zero`);
        }
        l.cost_rate = round4(rate);
        l.cost = round2(l.base_qty * rate);
    });
    return [...warnings].slice(0, 50);
}

async function tradeAnalysis(c, t, q, preset = {}) {
    const f = parseTradeQuery({ ...q, ...preset });
    if (!f.from || !f.to) throw httpError('Choose From and To dates');
    if (f.to < f.from) throw httpError('To date must be on or after From date');
    const rowDims = String(q.rows || preset.rows || 'party').split(',').map(s => s.trim()).filter(isDim).slice(0, 4);
    if (!rowDims.length) rowDims.push('party');
    const colDim = q.columns && isDim(q.columns) && !rowDims.includes(q.columns) ? q.columns : null;
    const withCost = f.side === 'sales' && (preset.withCost || q.with_cost === 'true');
    const method = METHODS[q.cost_method] ? q.cost_method : 'moving_average';

    let { lines, masters } = await loadTradeLines(c, t, f);
    const warnings = [];
    // UDF: as dimensions, and as a filter (udf_filter=<field id>:<text>, text contained, case-insensitive)
    const udfFilter = /^([0-9a-f-]{8,}):(.*)$/i.exec(q.udf_filter || '');
    const udfIds = [...new Set([...rowDims, colDim].filter(k => k && isUdf(k)).map(k => k.slice(4)).concat(udfFilter ? [udfFilter[1]] : []))];
    let udfLabels = {};
    if (udfIds.length && lines.length) {
        const labels = await attachUdf(c, t, lines, udfIds);
        udfLabels = labels;
        if (udfFilter) {
            const want = udfFilter[2].trim().toLowerCase();
            lines = lines.filter(l => { const v = String(l.udf[udfFilter[1]] ?? '').toLowerCase(); return want === '(blank)' ? !v : v.includes(want); });
        }
    }
    if (withCost && lines.length) warnings.push(...await attachCost(c, t, lines, method, masters));
    let displayFactor = null, displayUnit = null;
    if (q.display_unit_id) {
        displayUnit = masters.unitName(q.display_unit_id);
        displayFactor = pid => masters.factor[`${pid}|${q.display_unit_id}`] || null;
        const missing = new Set(lines.filter(l => !displayFactor(l.product_id)).map(l => l.product_name));
        if (missing.size) warnings.push(`${displayUnit} is not a unit of ${[...missing].slice(0, 5).join(', ')}${missing.size > 5 ? ' ...' : ''} - their qty is shown in base unit`);
    }
    const ctx = { withCost, displayFactor };

    // Columns
    const colMap = new Map();
    if (colDim === 'month') {                             // every month in the range, even empty ones
        for (let d = new Date(f.from.slice(0, 7) + '-01T00:00:00Z'); d.toISOString().slice(0, 7) <= f.to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
            const m = d.toISOString().slice(0, 7);
            colMap.set(m, { key: m, label: monthLabel(m), sort: m });
        }
    }
    // Tree
    const root = { key: '__root__', label: 'Grand Total', level: -1, m: newMeasures(), cols: {}, children: new Map() };
    lines.forEach(l => {
        let colKey = null;
        if (colDim) {
            const cv = dimValue(colDim, l);
            colKey = cv.key;
            if (!colMap.has(colKey)) colMap.set(colKey, { key: colKey, label: cv.code ? `${cv.label}` : cv.label, sort: cv.sort || cv.label });
        }
        let node = root;
        const touch = n => {
            addLine(n.m, l, ctx);
            if (colKey !== null) addLine(n.cols[colKey] = n.cols[colKey] || newMeasures(), l, ctx);
        };
        touch(root);
        rowDims.forEach((dim, level) => {
            const v = dimValue(dim, l);
            if (!node.children.has(v.key)) node.children.set(v.key, { key: v.key, label: v.label, code: v.code, sort: v.sort, dim, level, m: newMeasures(), cols: {}, children: new Map() });
            node = node.children.get(v.key);
            touch(node);
        });
    });

    const sortBy = ['name', 'net_value', 'net_qty', 'main_value', 'return_value', 'profit', 'margin_pct', 'amount'].includes(q.sort_by) ? q.sort_by : 'name';
    const top = Math.max(0, parseInt(q.top, 10) || 0);
    const build = n => {
        const measures = finish(n.m, withCost);
        const cols = Object.fromEntries(Object.entries(n.cols).map(([k, m]) => [k, finish(m, withCost)]));
        let children = [...n.children.values()].map(build);
        children.sort((a, b) => sortBy === 'name'
            ? String(a._sort || a.label).localeCompare(String(b._sort || b.label))
            : (b.measures[sortBy] || 0) - (a.measures[sortBy] || 0));
        let others = null;
        if (top && children.length > top) {             // Top N per level, the rest folded into "Others"
            const rest = children.slice(top);
            children = children.slice(0, top);
            others = { key: '__others__', label: `Others (${rest.length})`, level: rest[0].level, dim: rest[0].dim, children: [], measures: {}, cols: {} };
            const sumInto = (dst, src) => Object.entries(src).forEach(([k, v]) => { if (typeof v === 'number' && !['avg_rate', 'margin_pct', 'markup_pct'].includes(k)) dst[k] = (dst[k] || 0) + v; });
            rest.forEach(r => { sumInto(others.measures, r.measures); Object.entries(r.cols).forEach(([ck, cm]) => sumInto(others.cols[ck] = others.cols[ck] || {}, cm)); });
            children.push(others);
        }
        const out = { key: n.key, label: n.label, code: n.code || '', dim: n.dim, level: n.level, measures, cols, children, _sort: n.sort };
        return out;
    };
    const tree = build(root);
    const strip = n => { delete n._sort; n.children.forEach(strip); };
    strip(tree);

    const columns = [...colMap.values()].sort((a, b) => String(a.sort).localeCompare(String(b.sort))).map(({ key, label }) => ({ key, label }));
    return {
        side: f.side, from: f.from, to: f.to, kinds: f.kinds,
        rows: rowDims.map(k => ({ key: k, label: dimLabel(k, f.side, udfLabels) })),
        column_dim: colDim ? { key: colDim, label: dimLabel(colDim, f.side, udfLabels) } : null,
        columns, tree, with_cost: withCost, cost_method: withCost ? method : null, cost_method_label: withCost ? METHODS[method] : null,
        display_unit: displayUnit, line_count: lines.length, warnings
    };
}

// Profitability = sales analysis with cost; bill-wise / product-wise presets.
function profitability(c, t, q) {
    return tradeAnalysis(c, t, { ...q, side: 'sales' }, { withCost: true, rows: q.rows || 'product' });
}

// Rate history: every line with its rate, newest first, plus a summary per
// party + item (last / min / max / average net rate per base unit).
async function rateHistory(c, t, q) {
    const f = parseTradeQuery({ kinds: 'main', ...q });
    if (!f.from || !f.to) throw httpError('Choose From and To dates');
    const { lines } = await loadTradeLines(c, t, f);
    const groupBy = ['party_product', 'product', 'party'].includes(q.group_by) ? q.group_by : 'party_product';
    const keyOf = l => (groupBy === 'product' ? l.product_id : groupBy === 'party' ? `${l.party_id}` : `${l.party_id}|${l.product_id}`);
    const summary = new Map();
    const sorted = [...lines].sort((a, b) => b.doc_date.localeCompare(a.doc_date) || String(b.doc_no).localeCompare(String(a.doc_no)));
    sorted.forEach(l => {
        const k = keyOf(l);
        if (!summary.has(k)) summary.set(k, { key: k, party_id: groupBy === 'product' ? null : l.party_id, party_name: groupBy === 'product' ? '' : l.party_name,
            product_id: groupBy === 'party' ? null : l.product_id, product_name: groupBy === 'party' ? '' : l.product_name, product_code: groupBy === 'party' ? '' : l.product_code,
            base_unit: l.base_unit, unit: l.unit, count: 0, qty: 0, value: 0, min_rate: Infinity, max_rate: -Infinity,
            last_date: null, last_doc_no: null, last_rate: 0, last_unit: '', last_net_rate_base: 0, last_discount_percent: 0, first_net_rate_base: null });
        const s = summary.get(k);
        if (l.kind !== 'main') return;                  // returns show in the history only
        if (!s.last_date) Object.assign(s, { last_date: l.doc_date, last_doc_no: l.doc_no, last_rate: l.rate, last_unit: l.dual && l.alt_qty ? (l.rate_basis === 'primary' ? l.primary_unit : l.base_unit) : l.unit,
            last_net_rate_base: l.net_rate_base, last_discount_percent: l.discount_percent });
        s.count++; s.qty += l.base_qty; s.value += l.net;
        if (l.net_rate_base > 0) { s.min_rate = Math.min(s.min_rate, l.net_rate_base); s.max_rate = Math.max(s.max_rate, l.net_rate_base); s.first_net_rate_base = l.net_rate_base; }
    });
    const rows = [...summary.values()].map(s => ({
        ...s, qty: round4(s.qty), value: round2(s.value), avg_rate: s.qty ? round4(s.value / s.qty) : 0,
        min_rate: Number.isFinite(s.min_rate) ? s.min_rate : 0, max_rate: Number.isFinite(s.max_rate) ? s.max_rate : 0,
        change_pct: s.first_net_rate_base ? round2((s.last_net_rate_base - s.first_net_rate_base) * 100 / s.first_net_rate_base) : 0
    })).sort((a, b) => String(a.party_name).localeCompare(String(b.party_name)) || String(a.product_name).localeCompare(String(b.product_name)));
    const history = sorted.map(l => ({
        doc_type: l.doc_type, doc_label: l.doc_label, kind: l.kind, doc_id: l.doc_id, line_id: l.line_id, doc_no: l.doc_no, doc_date: l.doc_date, party_bill_no: l.party_bill_no,
        party_id: l.party_id, party_name: l.party_name, product_id: l.product_id, product_code: l.product_code, product_name: l.product_name,
        qty: l.qty, unit: l.unit, alt_qty: l.alt_qty, alt_unit: l.alt_unit, free_qty: l.free_base_qty, base_qty: l.base_qty, base_unit: l.base_unit,
        rate: l.rate, rate_basis: l.rate_basis, rate_unit: l.dual && l.alt_qty ? (l.rate_basis === 'primary' ? l.primary_unit : l.base_unit) : l.unit,
        discount_percent: l.discount_percent, gross: l.gross, discount: l.discount, net: l.net, net_rate_base: l.net_rate_base,
        area_name: l.area_name, agent_name: l.agent_name, branch_name: l.branch_name
    }));
    return { side: f.side, from: f.from, to: f.to, group_by: groupBy, summary: rows, history: history.slice(0, 5000), truncated: history.length > 5000 };
}

const dimensionList = side => Object.entries(DIMS).map(([key, d]) => ({ key, label: typeof d.label === 'function' ? d.label(side) : d.label }));

module.exports = { tradeAnalysis, profitability, rateHistory, dimensionList, DIMS };
