// =============================================
// utils/loadingSheet.js
// Loading Sheet - what to load on the vehicle for a set of sales documents.
//
// Lines from (sources, any mix):
//   delivery - Goods Delivery (Sales Delivery / GDN)
//   bill     - Sales Bill
// With both, a bill line made from a delivery line is skipped - that
// delivery line already carries the goods.
// Returns (optional): Sales Return + Non-saleable Return lines of the same
// filters, shown in their own column and deducted from the Net qty.
//
// Quantities (all computed per item from its base qty, so every view adds up):
//   base       - base unit
//   entered    - as written on the documents, per unit (5 Box + 12 Pcs)
//   breakdown  - split into the chosen units, largest first, rest in the
//                base unit (2 Ctn 3 Box 4 Pcs) - only units the item has
//   in_unit    - one chosen unit, with decimals
//   alt        - alt qty as entered, per alt unit
//   dual       - fixed-dual items: primary + secondary (1 Crt 4 Pcs)
//   free       - free qty (base unit), separate or added to the load
// Output: items (with optional group headings), bills, bill x item detail.
// =============================================
const { parseTradeQuery, loadTradeLines, csv, round2, round4 } = require('./tradeLines');

const httpError = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const GROUPS = { none: null, product_group: ['product_group_id', 'group_name'], company: ['product_company_id', 'company_name'],
    warehouse: ['warehouse_id', 'warehouse_name'], main_group: ['main_group_id', 'main_group_name'] };

function parseLoadingQuery(q) {
    const sources = csv(q.sources).filter(s => ['delivery', 'bill'].includes(s));
    const src = sources.length ? sources : ['bill'];
    const withReturns = q.include_returns === 'true';
    const kinds = [...(src.includes('delivery') ? ['delivery'] : []), ...(src.includes('bill') ? ['main'] : []), ...(withReturns ? ['return', 'nonsalable'] : [])];
    return { src, withReturns, kinds };
}

async function loadLines(c, t, q) {
    const { src, withReturns, kinds } = parseLoadingQuery(q);
    const f = parseTradeQuery({ ...q, side: 'sales', kinds: kinds.join(',') });
    if (!f.from || !f.to) throw httpError('Choose From and To dates');
    if (f.to < f.from) throw httpError('To date must be on or after From date');
    const { lines, masters } = await loadTradeLines(c, t, f);
    const both = src.includes('delivery') && src.includes('bill');
    const kept = both ? lines.filter(l => !(l.kind === 'main' && l.source_delivery_detail_id)) : lines;
    return { lines: kept, masters, src, withReturns, skipped: lines.length - kept.length };
}

// Split a base qty into the given units (largest first), rest in base unit.
function breakdown(baseQty, units, baseUnitName) {
    let rest = Math.abs(baseQty);
    const sign = baseQty < 0 ? -1 : 1;
    const parts = [];
    [...units].sort((a, b) => b.factor - a.factor).forEach(u => {
        if (u.factor <= 1) return;
        const n = Math.floor(rest / u.factor + 1e-9);
        if (n > 0) { parts.push({ unit: u.name, qty: n * sign }); rest = round4(rest - n * u.factor); }
    });
    if (rest > 1e-9 || !parts.length) parts.push({ unit: baseUnitName, qty: round4(rest) * sign });
    return parts;
}
const joinParts = parts => parts.filter(p => p.qty).map(p => `${p.qty} ${p.unit}`).join(' ') || '0';

// Qty presentation of one aggregate (lines of one item).
function present(agg, p, opts, M) {
    const out = { base_qty: round4(agg.base), base_unit: p.base_unit };
    out.entered = Object.entries(agg.entered).filter(([, v]) => Math.abs(v) > 1e-9).map(([unit, qty]) => ({ unit, qty: round4(qty) }));
    out.alt = Object.entries(agg.alt).filter(([, v]) => Math.abs(v) > 1e-9).map(([unit, qty]) => ({ unit, qty: round4(qty) }));
    const units = (M.unitsOf[p.product_id] || []).filter(u => !opts.breakdownUnits.length || opts.breakdownUnits.includes(u.unit_id))
        .map(u => ({ name: M.unitName(u.unit_id), factor: u.factor }));
    out.breakdown = joinParts(breakdown(agg.base, units, p.base_unit));
    if (opts.displayUnitId) {
        const fct = M.factor[`${p.product_id}|${opts.displayUnitId}`];
        out.in_unit = fct ? { qty: round4(agg.base / fct), unit: M.unitName(opts.displayUnitId) } : { qty: round4(agg.base), unit: p.base_unit, fallback: true };
    }
    if (p.dual && p.dual_factor > 1) out.dual = joinParts(breakdown(agg.base, [{ name: p.primary_unit, factor: p.dual_factor }], p.base_unit));
    return out;
}

function newAgg() { return { base: 0, entered: {}, alt: {}, free: 0, value: 0, amount: 0 }; }
function addTo(a, l, sign, freeInLoad) {
    const base = l.base_qty + (freeInLoad ? l.free_base_qty : 0);
    a.base += sign * base;
    a.entered[l.unit || l.base_unit] = (a.entered[l.unit || l.base_unit] || 0) + sign * l.qty;
    if (l.alt_qty) a.alt[l.alt_unit || 'alt'] = (a.alt[l.alt_unit || 'alt'] || 0) + sign * l.alt_qty;
    a.free += sign * l.free_base_qty;
    a.value += sign * l.net; a.amount += sign * l.amount;
}

async function loadingSheet(c, t, q) {
    const { lines, masters: M, src, withReturns, skipped } = await loadLines(c, t, q);
    const opts = { breakdownUnits: csv(q.breakdown_unit_ids), displayUnitId: q.display_unit_id || null, freeInLoad: q.free === 'add' };
    const groupKey = GROUPS[q.group_by] || null;

    // ---- items ----
    const items = new Map();
    lines.forEach(l => {
        if (!items.has(l.product_id)) items.set(l.product_id, {
            p: l, load: newAgg(), ret: newAgg(), docs: new Set(), parties: new Set(),
            group_id: groupKey ? l[groupKey[0]] || '' : '', group_name: groupKey ? l[groupKey[1]] || '(none)' : ''
        });
        const it = items.get(l.product_id);
        if (l.kind === 'main' || l.kind === 'delivery') { addTo(it.load, l, 1, opts.freeInLoad); it.docs.add(l.doc_id); it.parties.add(l.party_id); }
        else addTo(it.ret, l, 1, opts.freeInLoad);
    });
    const itemRows = [...items.values()].map(it => {
        const net = newAgg();
        net.base = it.load.base - it.ret.base; net.free = it.load.free - it.ret.free;
        [it.load, it.ret].forEach((a, i) => {
            const sign = i === 0 ? 1 : -1;
            Object.entries(a.entered).forEach(([u, v]) => { net.entered[u] = (net.entered[u] || 0) + sign * v; });
            Object.entries(a.alt).forEach(([u, v]) => { net.alt[u] = (net.alt[u] || 0) + sign * v; });
        });
        net.value = it.load.value - it.ret.value; net.amount = it.load.amount - it.ret.amount;
        const p = it.p;
        return {
            product_id: p.product_id, product_code: p.product_code, product_name: p.product_name, group_name: it.group_name,
            company_name: p.company_name, product_group: p.group_name,
            load: { ...present(it.load, p, opts, M), free: round4(it.load.free), value: round2(it.load.value), amount: round2(it.load.amount) },
            ...(withReturns ? {
                returned: { ...present(it.ret, p, opts, M), free: round4(it.ret.free), value: round2(it.ret.value), amount: round2(it.ret.amount) },
                net: { ...present(net, p, opts, M), free: round4(net.free), value: round2(net.value), amount: round2(net.amount) }
            } : {}),
            docs: it.docs.size, parties: it.parties.size
        };
    });
    const sortBy = q.sort_by === 'code' ? 'product_code' : 'product_name';
    itemRows.sort((a, b) => String(a.group_name).localeCompare(String(b.group_name)) || String(a[sortBy] || '').localeCompare(String(b[sortBy] || '')));

    // ---- bills ----
    const bills = new Map();
    lines.forEach(l => {
        if (!bills.has(l.doc_id)) bills.set(l.doc_id, {
            doc_id: l.doc_id, doc_type: l.doc_type, doc_label: l.doc_label, kind: l.kind, doc_no: l.doc_no, doc_date: l.doc_date, status: l.status,
            party_name: l.party_name, area_name: l.area_name, route_name: l.route_name, agent_name: l.agent_name,
            vehicle_no: l.vehicle_no, driver_name: l.driver_name, delivery_address: l.delivery_address,
            items: new Set(), base_qty: 0, value: 0, amount: 0, lines: []
        });
        const b = bills.get(l.doc_id);
        b.items.add(l.product_id); b.base_qty += l.base_qty; b.value += l.net; b.amount += l.amount;
        b.lines.push({ product_code: l.product_code, product_name: l.product_name, qty: l.qty, unit: l.unit, alt_qty: l.alt_qty, alt_unit: l.alt_unit,
            free_qty: l.free_base_qty, base_qty: l.base_qty, base_unit: l.base_unit, rate: l.rate, net: l.net, amount: l.amount, batch_no: l.batch_no,
            dual: l.dual && l.dual_factor > 1 ? joinParts(breakdown(l.base_qty, [{ name: l.primary_unit, factor: l.dual_factor }], l.base_unit)) : null });
    });
    const billRows = [...bills.values()].map(b => ({ ...b, items: b.items.size, base_qty: round4(b.base_qty), value: round2(b.value), amount: round2(b.amount) }))
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'return' || a.kind === 'nonsalable' ? 1 : -1) || a.doc_date.localeCompare(b.doc_date) || String(a.doc_no).localeCompare(String(b.doc_no)));

    const loads = billRows.filter(b => b.kind === 'main' || b.kind === 'delivery'), rets = billRows.filter(b => b.kind !== 'main' && b.kind !== 'delivery');
    const sum = (rows, k) => round2(rows.reduce((s, r) => s + r[k], 0));
    const warnings = [];
    if (skipped) warnings.push(`${skipped} bill line(s) made from a Goods Delivery were left out - the delivery already carries those goods.`);
    if (opts.displayUnitId && itemRows.some(r => r.load.in_unit?.fallback)) warnings.push('Some items do not have the chosen unit - their qty is shown in base unit.');
    if (lines.some(l => l.status === 'draft')) warnings.push('Draft documents are included.');
    return {
        from: q.date_from, to: q.date_to, sources: src, with_returns: withReturns, free: opts.freeInLoad ? 'add' : 'separate',
        group_by: groupKey ? q.group_by : 'none', breakdown_units: opts.breakdownUnits.map(id => M.unitName(id)), display_unit: opts.displayUnitId ? M.unitName(opts.displayUnitId) : null,
        items: itemRows, bills: billRows,
        totals: { bills: loads.length, returns: rets.length, customers: new Set(loads.map(b => b.party_name)).size, items: itemRows.length,
            value: sum(loads, 'value'), amount: sum(loads, 'amount'), return_value: sum(rets, 'value'), return_amount: sum(rets, 'amount') },
        vehicles: [...new Set(billRows.map(b => b.vehicle_no).filter(Boolean))], warnings
    };
}

// Documents for the "Bills" picker (same filters, no document filter).
async function loadingSheetDocs(c, t, q) {
    const { lines } = await loadLines(c, t, { ...q, doc_ids: '' });
    const docs = new Map();
    lines.forEach(l => {
        if (!docs.has(l.doc_id)) docs.set(l.doc_id, { id: l.doc_id, name: `${l.doc_no} · ${l.doc_date} · ${l.party_name}${l.kind === 'delivery' ? ' (GDN)' : l.kind === 'main' ? '' : ' (Return)'}`, amount: 0 });
        docs.get(l.doc_id).amount += l.amount;
    });
    return [...docs.values()].map(d => ({ ...d, amount: round2(d.amount) })).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { loadingSheet, loadingSheetDocs, breakdown };
