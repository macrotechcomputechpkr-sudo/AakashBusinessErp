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
// Quantities (all from each item's base qty, so every view adds up):
//   uom        - as the item's UOM mode reads it:
//                  fixed dual  "5 Crt 2 Pcs · Total 62 Pcs"
//                  flexible / multi-unit  "5 Crt = 10 Pcs" (as entered, with
//                  its base-unit equivalent)
//   entered    - as written on the documents, per unit (5 Box + 12 Pcs)
//   breakdown  - split into the chosen units, largest first, rest in the
//                base unit (2 Ctn 3 Box 4 Pcs) - only units the item has
//   base, in_unit (one chosen unit), alt, dual, free (separate or added)
//
// Amounts per line / item / bill (all agree with the bill totals):
//   basic    = qty x rate
//   discount = line discount, vat = line VAT
//   other    = bill-level terms: posted Sales Additional Entries made for
//              the bill (or the delivery) - each "add" / "deduct" line -
//              spread over the document's lines by their share of its
//              taxable value (the last line takes the rounding)
//   term     = -discount + vat + other
//   net      = basic + term  (= bill total + its additional entries)
// Output: items (optional group headings), bill summary, bill x item detail.
// =============================================
const { parseTradeQuery, loadTradeLines, inChunks, fetchAll, csv, round2, round4 } = require('./tradeLines');

const httpError = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const GROUPS = { none: null, product_group: ['product_group_id', 'group_name'], company: ['product_company_id', 'company_name'],
    warehouse: ['warehouse_id', 'warehouse_name'], main_group: ['main_group_id', 'main_group_name'] };
const isLoad = l => l.kind === 'main' || l.kind === 'delivery';

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
    const productFiltered = ['product_ids', 'product_group_ids', 'product_company_ids', 'product_category_ids', 'item_types', 'search'].some(k => q[k]);
    return { lines: kept, masters, src, withReturns, skipped: lines.length - kept.length, statuses: f.statuses, productFiltered };
}

// Bill-level terms: posted Sales Additional Entries of each bill / delivery,
// spread over its lines. Sets l.other = { termName: amount } and l.other_total.
async function allocateBillTerms(c, t, lines, statuses) {
    lines.forEach(l => { l.other = {}; l.other_total = 0; });
    const billIds = [...new Set(lines.filter(l => l.kind === 'main').map(l => l.doc_id))];
    const deliveryIds = [...new Set(lines.filter(l => l.kind === 'delivery').map(l => l.doc_id))];
    if (!billIds.length && !deliveryIds.length) return [];
    const byCol = async (col, ids) => (ids.length ? inChunks(ids, async chunk => {
        const { data, error } = await c.from('sales_additional_entries').select('id, doc_no, source_bill_id, source_delivery_id')
            .eq('tenant_id', t).in('status', statuses).in(col, chunk);
        if (error) throw error; return data || [];
    }) : []);
    const entries = [...await byCol('source_bill_id', billIds), ...await byCol('source_delivery_id', deliveryIds)];
    if (!entries.length) return [];
    const entryLines = await inChunks([...new Set(entries.map(e => e.id))], async chunk => {
        const { data, error } = await c.from('sales_additional_entry_lines').select('entry_id, income_ledger_id, description, entry_sign, amount').eq('tenant_id', t).in('entry_id', chunk);
        if (error) throw error; return data || [];
    });
    const ledgerIds = [...new Set(entryLines.map(x => x.income_ledger_id).filter(Boolean))];
    const ledgerName = Object.fromEntries((await inChunks(ledgerIds, async chunk => {
        const { data, error } = await c.from('ledger_accounts').select('id, account_name').eq('tenant_id', t).in('id', chunk);
        if (error) throw error; return data || [];
    })).map(x => [x.id, x.account_name]));

    // Terms per document (a bill's entries, else its delivery's).
    const termsOf = {};
    const entryDoc = Object.fromEntries(entries.map(e => [e.id, billIds.includes(e.source_bill_id) ? e.source_bill_id : e.source_delivery_id]));
    entryLines.forEach(x => {
        const doc = entryDoc[x.entry_id]; if (!doc) return;
        const name = ledgerName[x.income_ledger_id] || x.description || 'Other charges';
        const amt = (x.entry_sign === 'deduct' ? -1 : 1) * (Number(x.amount) || 0);
        (termsOf[doc] = termsOf[doc] || {})[name] = ((termsOf[doc] || {})[name] || 0) + amt;
    });
    const byDoc = {};
    lines.forEach(l => { if (termsOf[l.doc_id] && isLoad(l)) (byDoc[l.doc_id] = byDoc[l.doc_id] || []).push(l); });
    Object.entries(byDoc).forEach(([doc, docLines]) => {
        const docNet = (docLines[0].doc_total - docLines[0].doc_tax) || docLines.reduce((s, l) => s + l.net, 0);
        Object.entries(termsOf[doc]).forEach(([name, amt]) => {
            let given = 0;
            docLines.forEach((l, i) => {
                const share = docNet ? l.net / docNet : 1 / docLines.length;
                // the last line takes the rounding, but only when the whole document is here
                const whole = Math.abs(docLines.reduce((s, x) => s + x.net, 0) - docNet) < 0.01;
                const part = i === docLines.length - 1 && whole ? round2(amt - given) : round2(amt * share);
                given += part;
                l.other[name] = round2((l.other[name] || 0) + part);
                l.other_total = round2(l.other_total + part);
            });
        });
    });
    return [...new Set(Object.values(termsOf).flatMap(Object.keys))].sort();
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

// Qty text by the item's UOM mode.
function uomText(baseQty, enteredParts, p) {
    if (p.dual && p.dual_factor > 1) return `${joinParts(breakdown(baseQty, [{ name: p.primary_unit, factor: p.dual_factor }], p.base_unit))} · Total ${round4(baseQty)} ${p.base_unit}`;
    const entered = enteredParts.filter(x => Math.abs(x.qty) > 1e-9);
    const text = entered.map(x => `${x.qty} ${x.unit}`).join(' + ');
    if (!entered.length) return `${round4(baseQty)} ${p.base_unit}`;
    return entered.length === 1 && entered[0].unit === p.base_unit ? text : `${text} = ${round4(baseQty)} ${p.base_unit}`;
}

function present(agg, p, opts, M) {
    const out = { base_qty: round4(agg.base), base_unit: p.base_unit };
    out.entered = Object.entries(agg.entered).filter(([, v]) => Math.abs(v) > 1e-9).map(([unit, qty]) => ({ unit, qty: round4(qty) }));
    out.alt = Object.entries(agg.alt).filter(([, v]) => Math.abs(v) > 1e-9).map(([unit, qty]) => ({ unit, qty: round4(qty) }));
    out.uom = uomText(agg.base, out.entered, p);
    const units = (M.unitsOf[p.product_id] || []).filter(u => !opts.breakdownUnits.length || opts.breakdownUnits.includes(u.unit_id))
        .map(u => ({ name: M.unitName(u.unit_id), factor: u.factor }));
    out.breakdown = joinParts(breakdown(agg.base, units, p.base_unit));
    if (opts.displayUnitId) {
        const fct = M.factor[`${p.product_id}|${opts.displayUnitId}`];
        out.in_unit = fct ? { qty: round4(agg.base / fct), unit: M.unitName(opts.displayUnitId) } : { qty: round4(agg.base), unit: p.base_unit, fallback: true };
    }
    if (p.dual && p.dual_factor > 1) out.dual = joinParts(breakdown(agg.base, [{ name: p.primary_unit, factor: p.dual_factor }], p.base_unit));
    out.free = round4(agg.free);
    ['basic', 'discount', 'vat', 'other_total', 'net_amount'].forEach(k => { out[k] = round2(agg[k]); });
    out.term = round2(-agg.discount + agg.vat + agg.other_total);
    out.other = Object.fromEntries(Object.entries(agg.other).map(([k, v]) => [k, round2(v)]));
    return out;
}

function newAgg() { return { base: 0, entered: {}, alt: {}, free: 0, basic: 0, discount: 0, vat: 0, other_total: 0, net_amount: 0, other: {} }; }
function addTo(a, l, sign, freeInLoad) {
    // Fixed-dual lines: entered = primary qty + secondary qty as written.
    const unit = l.unit || l.base_unit;
    a.base += sign * (l.base_qty + (freeInLoad ? l.free_base_qty : 0));
    a.entered[unit] = (a.entered[unit] || 0) + sign * l.qty;
    if (l.alt_qty) {
        const alt = l.alt_unit || 'alt';
        if (l.dual) a.entered[alt] = (a.entered[alt] || 0) + sign * l.alt_qty;
        a.alt[alt] = (a.alt[alt] || 0) + sign * l.alt_qty;
    }
    a.free += sign * l.free_base_qty;
    a.basic += sign * l.gross; a.discount += sign * l.discount; a.vat += sign * l.tax;
    a.other_total += sign * (l.other_total || 0);
    Object.entries(l.other || {}).forEach(([k, v]) => { a.other[k] = (a.other[k] || 0) + sign * v; });
    a.net_amount += sign * (l.amount + (l.other_total || 0));
}
function combine(load, ret) {
    const n = newAgg();
    [[load, 1], [ret, -1]].forEach(([a, sign]) => {
        ['base', 'free', 'basic', 'discount', 'vat', 'other_total', 'net_amount'].forEach(k => { n[k] += sign * a[k]; });
        ['entered', 'alt', 'other'].forEach(k => Object.entries(a[k]).forEach(([u, v]) => { n[k][u] = (n[k][u] || 0) + sign * v; }));
    });
    return n;
}

async function loadingSheet(c, t, q) {
    const { lines, masters: M, src, withReturns, skipped, statuses, productFiltered } = await loadLines(c, t, q);
    const termNames = await allocateBillTerms(c, t, lines, statuses);
    const opts = { breakdownUnits: csv(q.breakdown_unit_ids), displayUnitId: q.display_unit_id || null, freeInLoad: q.free === 'add' };
    const groupKey = GROUPS[q.group_by] || null;

    // ---- items ----
    const items = new Map();
    lines.forEach(l => {
        if (!items.has(l.product_id)) items.set(l.product_id, {
            p: l, load: newAgg(), ret: newAgg(), docs: new Set(),
            group_name: groupKey ? l[groupKey[1]] || '(none)' : ''
        });
        const it = items.get(l.product_id);
        if (isLoad(l)) { addTo(it.load, l, 1, opts.freeInLoad); it.docs.add(l.doc_id); }
        else addTo(it.ret, l, 1, opts.freeInLoad);
    });
    const itemRows = [...items.values()].map(it => {
        const p = it.p;
        return {
            product_id: p.product_id, product_code: p.product_code, product_name: p.product_name, group_name: it.group_name,
            company_name: p.company_name, product_group: p.group_name, uom_mode: p.uom_mode,
            load: present(it.load, p, opts, M),
            ...(withReturns ? { returned: present(it.ret, p, opts, M), net: present(combine(it.load, it.ret), p, opts, M) } : {}),
            docs: it.docs.size
        };
    });
    const sortBy = q.sort_by === 'code' ? 'product_code' : 'product_name';
    itemRows.sort((a, b) => String(a.group_name).localeCompare(String(b.group_name)) || String(a[sortBy] || '').localeCompare(String(b[sortBy] || '')));

    // ---- bills ----
    const bills = new Map();
    lines.forEach(l => {
        if (!bills.has(l.doc_id)) bills.set(l.doc_id, {
            doc_id: l.doc_id, doc_type: l.doc_type, doc_label: l.doc_label, kind: l.kind, doc_no: l.doc_no, doc_date: l.doc_date, status: l.status,
            party_name: l.party_name, party_code: l.party_code, party_address: l.delivery_address || l.party_address, party_phone: l.party_phone,
            area_name: l.area_name, route_name: l.route_name, agent_name: l.agent_name, vehicle_no: l.vehicle_no, driver_name: l.driver_name,
            items: new Set(), base_qty: 0, agg: newAgg(), lines: []
        });
        const b = bills.get(l.doc_id);
        b.items.add(l.product_id); b.base_qty += l.base_qty;
        addTo(b.agg, l, 1, false);
        b.lines.push({ product_code: l.product_code, product_name: l.product_name, qty: l.qty, unit: l.unit, alt_qty: l.alt_qty, alt_unit: l.alt_unit,
            free_qty: l.free_base_qty, base_qty: l.base_qty, base_unit: l.base_unit, rate: l.rate, batch_no: l.batch_no,
            uom: uomText(l.base_qty, [{ unit: l.unit || l.base_unit, qty: l.qty }, ...(l.dual && l.alt_qty ? [{ unit: l.alt_unit, qty: l.alt_qty }] : [])], l),
            basic: l.gross, discount: l.discount, vat: l.tax, other_total: l.other_total || 0, net_amount: round2(l.amount + (l.other_total || 0)) });
    });
    const billRows = [...bills.values()].map(({ agg, ...b }) => ({
        ...b, items: b.items.size, base_qty: round4(b.base_qty),
        basic: round2(agg.basic), discount: round2(agg.discount), vat: round2(agg.vat), other_total: round2(agg.other_total),
        other: Object.fromEntries(Object.entries(agg.other).map(([k, v]) => [k, round2(v)])),
        term: round2(-agg.discount + agg.vat + agg.other_total), net_amount: round2(agg.net_amount)
    })).sort((a, b) => (isLoad(a) === isLoad(b) ? 0 : isLoad(a) ? -1 : 1) || a.doc_date.localeCompare(b.doc_date) || String(a.doc_no).localeCompare(String(b.doc_no)));

    const loads = billRows.filter(isLoad), rets = billRows.filter(b => !isLoad(b));
    const sum = (rows, k) => round2(rows.reduce((s, r) => s + r[k], 0));
    const totalsOf = rows => ({ basic: sum(rows, 'basic'), discount: sum(rows, 'discount'), vat: sum(rows, 'vat'), other_total: sum(rows, 'other_total'),
        term: sum(rows, 'term'), net_amount: sum(rows, 'net_amount'),
        other: Object.fromEntries(termNames.map(n => [n, round2(rows.reduce((s, r) => s + (r.other[n] || 0), 0))])) });
    const warnings = [];
    if (skipped) warnings.push(`${skipped} bill line(s) made from a Goods Delivery were left out - the delivery already carries those goods.`);
    if (opts.displayUnitId && itemRows.some(r => r.load.in_unit?.fallback)) warnings.push('Some items do not have the chosen unit - their qty is shown in base unit.');
    if (lines.some(l => l.status === 'draft')) warnings.push('Draft documents are included.');
    if (productFiltered) warnings.push('Item filters are on - bill amounts cover the shown items only.');
    return {
        from: q.date_from, to: q.date_to, sources: src, with_returns: withReturns, free: opts.freeInLoad ? 'add' : 'separate',
        group_by: groupKey ? q.group_by : 'none', breakdown_units: opts.breakdownUnits.map(id => M.unitName(id)), display_unit: opts.displayUnitId ? M.unitName(opts.displayUnitId) : null,
        term_names: termNames, items: itemRows, bills: billRows,
        totals: { bills: loads.length, returns: rets.length, customers: new Set(loads.map(b => b.party_name)).size, items: itemRows.length,
            load: totalsOf(loads), returned: totalsOf(rets),
            net_amount: round2(sum(loads, 'net_amount') - (withReturns ? sum(rets, 'net_amount') : 0)) },
        vehicles: [...new Set(billRows.map(b => b.vehicle_no).filter(Boolean))], warnings
    };
}

// Documents for the "Bills" picker (same filters, no document filter).
async function loadingSheetDocs(c, t, q) {
    const { lines } = await loadLines(c, t, { ...q, doc_ids: '' });
    const docs = new Map();
    lines.forEach(l => {
        if (!docs.has(l.doc_id)) docs.set(l.doc_id, { id: l.doc_id, name: `${l.doc_no} · ${l.doc_date} · ${l.party_name}${l.kind === 'delivery' ? ' (GDN)' : l.kind === 'main' ? '' : ' (Return)'}` });
    });
    return [...docs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { loadingSheet, loadingSheetDocs, breakdown, uomText, fetchAll };
