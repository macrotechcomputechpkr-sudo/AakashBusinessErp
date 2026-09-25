// =============================================
// utils/productionReport.js
// Production reports, from production_orders + raw materials + by-products
// (every qty also in the product's BASE unit - dual UOM aware, the same way
// posting moves stock):
//   register     one row per production order: output, input cost, by-product
//                value, net output cost, unit cost
//   details      every line of every order: input (raw material), output,
//                by-product
//   output       finished output summary     } grouped by product / group /
//   consumption  raw material consumption    } month / branch / warehouse /
//   byproduct    by-product recovery         } process / output product
//   variance     BOM standard vs actual raw material use (orders made from a
//                BOM template): standard qty scaled to the actual output,
//                actual qty, variance qty / % / value at the actual rate
//   cost_trend   output product x month: qty, net cost, unit cost and its
//                change from the month before
//   batch        batch traceability: each output batch (mfg / expiry) with
//                the raw material batches it consumed and the by-products
//   bom_cost     each BOM template's standard cost at the latest purchase
//                rates vs the actual average unit cost of the period
//   pending      draft (not yet posted) production orders with their age
// =============================================

const { loadMasters, fetchAll, inChunks, csv, round2, round4 } = require('./tradeLines');
const { toBaseQtyFromDual, getDualUomMode } = require('./dualUomCalculation');

const VIEWS = ['register', 'details', 'output', 'consumption', 'byproduct', 'variance', 'cost_trend', 'batch', 'bom_cost', 'pending'];
const GROUPS = {
    product: { label: 'Product' }, product_group: { label: 'Product Group' }, month: { label: 'Month' }, date: { label: 'Date' }, branch: { label: 'Branch' },
    warehouse: { label: 'Warehouse' }, process: { label: 'Process' }, output_product: { label: 'Output Product' }, doc: { label: 'Production Order' }
};

function parseProductionQuery(q) {
    return {
        view: VIEWS.includes(q.view) ? q.view : 'register',
        groupBy: csv(q.group_by).filter(g => GROUPS[g]).slice(0, 3),
        from: q.from_date || null, to: q.to_date || null,
        statuses: q.view === 'pending' ? ['draft'] : csv(q.statuses).length ? csv(q.statuses) : ['posted'],
        branchIds: csv(q.branch_ids), outputProductIds: csv(q.output_product_ids), productIds: csv(q.product_ids),
        productGroupIds: csv(q.product_group_ids), warehouseIds: csv(q.warehouse_ids), templateIds: csv(q.bom_template_ids),
        search: (q.search || '').trim().toLowerCase()
    };
}

// A group and every group under it.
function withChildren(ids, byId, parentKey) {
    if (!ids.length) return null;
    const set = new Set(ids);
    for (let grew = true; grew;) {
        grew = false;
        Object.values(byId).forEach(x => { if (x[parentKey] && set.has(x[parentKey]) && !set.has(x.id)) { set.add(x.id); grew = true; } });
    }
    return set;
}

async function loadProduction(c, t, f) {
    const M = await loadMasters(c, t);
    const dualMode = await getDualUomMode(c);
    let orders = await fetchAll(() => {
        let x = c.from('production_orders').select('*').eq('tenant_id', t).in('status', f.statuses);
        if (f.from) x = x.gte('doc_date', f.from);
        if (f.to) x = x.lte('doc_date', f.to);
        if (f.branchIds.length) x = x.in('branch_id', f.branchIds);
        if (f.outputProductIds.length) x = x.in('output_product_id', f.outputProductIds);
        if (f.templateIds.length) x = x.in('bom_template_id', f.templateIds);
        return x.order('doc_date').order('id');
    });
    if (f.search) orders = orders.filter(o => [o.doc_no, o.output_product_name_snapshot, o.narration, o.remarks_text, o.output_batch_no].some(v => String(v || '').toLowerCase().includes(f.search)));
    const ids = orders.map(o => o.id);
    const byOrder = rows => rows.reduce((m, r) => ((m[r.production_id] = m[r.production_id] || []).push(r), m), {});
    const lines = table => inChunks(ids, async chunk => {
        const { data, error } = await c.from(table).select('*').in('production_id', chunk).order('display_order');
        if (error) throw error;
        return data || [];
    });
    const [rms, bps, terms, whs, branches] = await Promise.all([
        lines('production_raw_materials'), lines('production_byproducts'),
        inChunks(ids, async chunk => {
            const { data, error } = await c.from('document_line_billing_terms').select('document_id, detail_id, computed_amount').eq('tenant_id', t).eq('document_type', 'production').in('document_id', chunk);
            if (error) return [];
            return data || [];
        }),
        fetchAll(() => c.from('warehouses').select('id, warehouse_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('branches').select('id, branch_name').eq('tenant_id', t).order('id'))
    ]);
    const whName = Object.fromEntries(whs.map(w => [w.id, w.warehouse_name])), brName = Object.fromEntries(branches.map(b => [b.id, b.branch_name]));
    const baseQty = (pid, qty, uomId, altQty) => {
        const p = M.products[pid] || {};
        if (p.uom_mode === 'fixed_dual' && altQty) return toBaseQtyFromDual(qty, altQty, M.factor[`${pid}|${p.dual_uom_primary_unit_id}`] || 1, dualMode);
        return (Number(qty) || 0) * (uomId ? M.factor[`${pid}|${uomId}`] || 1 : 1);
    };
    const termsByLine = {};
    terms.forEach(x => { termsByLine[x.detail_id] = (termsByLine[x.detail_id] || 0) + (Number(x.computed_amount) || 0); });
    return { M, orders, rmBy: byOrder(rms), bpBy: byOrder(bps), termsByLine, whName, brName, baseQty };
}

const productInfo = (M, pid, snapshot) => {
    const p = M.products[pid] || {};
    return { product_id: pid, product_code: p.product_code || '', product_name: p.product_name || snapshot || '', base_unit: M.unitName(p.base_unit_id),
        product_group_id: p.product_group_id || null, product_group: M.groups[p.product_group_id]?.group_name || '' };
};

// Every order, as flat lines (output / input / by-product).
function flatten(D, f) {
    const { M, orders, rmBy, bpBy, termsByLine, whName, brName, baseQty } = D;
    const groupSet = withChildren(f.productGroupIds, M.groups, 'parent_group_id');
    const out = [];
    const docs = [];
    orders.forEach(o => {
        const rm = rmBy[o.id] || [], bp = bpBy[o.id] || [];
        if (f.productIds.length && !rm.some(r => f.productIds.includes(r.product_id)) && !bp.some(b => f.productIds.includes(b.product_id))) return;
        const head = {
            doc_id: o.id, doc_no: o.doc_no, doc_date: String(o.doc_date).slice(0, 10), month: String(o.doc_date).slice(0, 7), status: o.status,
            branch_id: o.branch_id || null, branch_name: o.branch_name_snapshot || brName[o.branch_id] || '',
            output_product_id: o.output_product_id, output_product_name: M.products[o.output_product_id]?.product_name || o.output_product_name_snapshot || '',
            bom_template_id: o.bom_template_id || null, cost_center: o.cost_center_name_snapshot || '', narration: o.narration || o.remarks_text || ''
        };
        const outBase = baseQty(o.output_product_id, o.output_qty, o.output_uom_id, o.output_alt_qty);
        const rmCost = rm.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const bpValue = bp.reduce((s, b) => s + (Number(b.amount) || 0), 0);
        const termAmt = rm.reduce((s, r) => s + (termsByLine[r.id] || 0), 0);
        const netCost = rmCost - bpValue;
        const inputBase = rm.reduce((s, r) => s + baseQty(r.product_id, r.qty, r.uom_id, r.alt_qty), 0);
        docs.push({ ...head, output_qty: round4(Number(o.output_qty) || 0), output_unit: o.output_uom_name_snapshot || M.unitName(o.output_uom_id), output_base_qty: round4(outBase),
            base_unit: M.unitName(M.products[o.output_product_id]?.base_unit_id), output_batch_no: o.output_batch_no || '',
            output_warehouse: o.output_warehouse_name_snapshot || whName[o.output_warehouse_id] || '', source_warehouse: o.source_warehouse_name_snapshot || whName[o.source_warehouse_id] || '',
            raw_material_lines: rm.length, input_base_qty: round4(inputBase), raw_material_cost: round2(rmCost), term_amount: round2(termAmt), byproduct_lines: bp.length, byproduct_value: round2(bpValue),
            net_output_cost: round2(netCost), unit_cost: outBase ? round4(netCost / outBase) : 0, entry_unit_cost: round4(Number(o.output_unit_cost) || 0),
            yield_pct: inputBase ? round2((outBase / inputBase) * 100) : null,
            output_mfg_date: o.output_mfg_date ? String(o.output_mfg_date).slice(0, 10) : '', output_exp_date: o.output_exp_date ? String(o.output_exp_date).slice(0, 10) : '',
            inputs: rm.map(r => ({ product_name: M.products[r.product_id]?.product_name || r.product_name_snapshot || '', batch_no: r.batch_no || '', base_qty: round4(baseQty(r.product_id, r.qty, r.uom_id, r.alt_qty)),
                base_unit: M.unitName(M.products[r.product_id]?.base_unit_id), amount: round2(Number(r.amount) || 0) })),
            byproducts: bp.map(b => ({ product_name: M.products[b.product_id]?.product_name || b.product_name_snapshot || '', batch_no: b.batch_no || '', base_qty: round4(baseQty(b.product_id, b.qty, b.uom_id, b.alt_qty)),
                base_unit: M.unitName(M.products[b.product_id]?.base_unit_id), amount: round2(Number(b.amount) || 0) })) });
        const keep = pid => (!groupSet || groupSet.has(M.products[pid]?.product_group_id)) && (!f.productIds.length || f.productIds.includes(pid));
        if (!groupSet || groupSet.has(M.products[o.output_product_id]?.product_group_id)) {
            out.push({ ...head, line_type: 'output', line_id: null, ...productInfo(M, o.output_product_id, o.output_product_name_snapshot), process: '',
                warehouse_name: o.output_warehouse_name_snapshot || whName[o.output_warehouse_id] || '', batch_no: o.output_batch_no || '',
                qty: Number(o.output_qty) || 0, unit: o.output_uom_name_snapshot || M.unitName(o.output_uom_id), base_qty: outBase, rate: 0, term_amount: 0, amount: netCost });
        }
        rm.forEach(r => {
            if (!keep(r.product_id)) return;
            out.push({ ...head, line_type: 'input', line_id: r.id, ...productInfo(M, r.product_id, r.product_name_snapshot), process: r.process_name || '',
                warehouse_name: r.warehouse_name_snapshot || whName[r.warehouse_id || o.source_warehouse_id] || '', batch_no: r.batch_no || '',
                qty: Number(r.qty) || 0, unit: r.uom_name_snapshot || M.unitName(r.uom_id), base_qty: baseQty(r.product_id, r.qty, r.uom_id, r.alt_qty),
                rate: Number(r.cost_rate) || 0, term_amount: termsByLine[r.id] || 0, amount: Number(r.amount) || 0 });
        });
        bp.forEach(b => {
            if (!keep(b.product_id)) return;
            out.push({ ...head, line_type: 'byproduct', line_id: b.id, ...productInfo(M, b.product_id, b.product_name_snapshot), process: b.allocation_basis || '',
                warehouse_name: b.warehouse_name_snapshot || whName[b.warehouse_id || o.output_warehouse_id] || '', batch_no: b.batch_no || '',
                qty: Number(b.qty) || 0, unit: b.uom_name_snapshot || M.unitName(b.uom_id), base_qty: baseQty(b.product_id, b.qty, b.uom_id, b.alt_qty),
                rate: Number(b.recovery_rate) || 0, term_amount: 0, amount: Number(b.amount) || 0 });
        });
    });
    return { lines: out, docs };
}

function groupKey(l, g) {
    switch (g) {
        case 'product': return [l.product_id, `${l.product_name}${l.product_code ? ` (${l.product_code})` : ''}`];
        case 'product_group': return [l.product_group_id || '-', l.product_group || '(no group)'];
        case 'month': return [l.month, l.month];
        case 'date': return [l.doc_date, l.doc_date];
        case 'branch': return [l.branch_id || '-', l.branch_name || '(no branch)'];
        case 'warehouse': return [l.warehouse_name || '-', l.warehouse_name || '(no warehouse)'];
        case 'process': return [l.process || '-', l.process || '(no process)'];
        case 'output_product': return [l.output_product_id, l.output_product_name];
        case 'doc': return [l.doc_id, `${l.doc_no} · ${l.doc_date}`];
        default: return ['-', '-'];
    }
}

function summarize(lines, groupBy) {
    const map = new Map();
    lines.forEach(l => {
        const keys = groupBy.map(g => groupKey(l, g));
        const k = keys.map(x => x[0]).join('|');
        if (!map.has(k)) map.set(k, { key: k, groups: Object.fromEntries(groupBy.map((g, i) => [g, keys[i][1]])), base_unit: l.base_unit, _units: new Set(), _docs: new Set(), base_qty: 0, amount: 0, term_amount: 0, lines: 0 });
        const m = map.get(k);
        m._units.add(l.base_unit); m._docs.add(l.doc_id); m.base_qty += l.base_qty; m.amount += l.amount; m.term_amount += l.term_amount; m.lines++;
    });
    return [...map.values()].map(({ _units, _docs, ...m }) => ({ ...m, base_unit: _units.size === 1 ? [..._units][0] : '(mixed)', orders: _docs.size,
        base_qty: round4(m.base_qty), amount: round2(m.amount), term_amount: round2(m.term_amount), avg_rate: m.base_qty ? round4(m.amount / m.base_qty) : 0 }))
        .sort((a, b) => groupBy.map(g => String(a.groups[g]).localeCompare(String(b.groups[g]))).find(x => x) || 0);
}

async function variance(c, t, D, f) {
    const { M, orders, rmBy, baseQty } = D;
    const tplIds = [...new Set(orders.map(o => o.bom_template_id).filter(Boolean))];
    const [tpls, tplRm] = await Promise.all([
        inChunks(tplIds, async ids => { const { data, error } = await c.from('bom_templates').select('id, template_code, template_name, output_product_id, standard_output_qty, output_uom_id').in('id', ids); if (error) throw error; return data || []; }),
        inChunks(tplIds, async ids => { const { data, error } = await c.from('bom_template_raw_materials').select('template_id, product_id, qty, uom_id, process_name').in('template_id', ids); if (error) throw error; return data || []; })
    ]);
    const tplById = Object.fromEntries(tpls.map(x => [x.id, x]));
    const rows = [];
    orders.forEach(o => {
        const tpl = tplById[o.bom_template_id];
        if (!tpl) return;
        const outBase = baseQty(o.output_product_id, o.output_qty, o.output_uom_id, o.output_alt_qty);
        const stdOutBase = baseQty(tpl.output_product_id, tpl.standard_output_qty, tpl.output_uom_id, null);
        const scale = stdOutBase ? outBase / stdOutBase : 0;
        const per = {};                                          // product -> { std, actual, amount }
        tplRm.filter(r => r.template_id === tpl.id).forEach(r => { const p = per[r.product_id] = per[r.product_id] || { std: 0, actual: 0, amount: 0 }; p.std += baseQty(r.product_id, r.qty, r.uom_id, null) * scale; });
        (rmBy[o.id] || []).forEach(r => { const p = per[r.product_id] = per[r.product_id] || { std: 0, actual: 0, amount: 0 }; p.actual += baseQty(r.product_id, r.qty, r.uom_id, r.alt_qty); p.amount += Number(r.amount) || 0; });
        Object.entries(per).forEach(([pid, p]) => {
            if (f.productIds.length && !f.productIds.includes(pid)) return;
            const rate = p.actual ? p.amount / p.actual : (M.purchaseRate[pid] || 0);
            const vq = p.actual - p.std;
            rows.push({ doc_id: o.id, doc_no: o.doc_no, doc_date: String(o.doc_date).slice(0, 10), template: `${tpl.template_code} · ${tpl.template_name}`,
                output_product_name: M.products[o.output_product_id]?.product_name || o.output_product_name_snapshot || '', output_base_qty: round4(outBase),
                ...productInfo(M, pid), standard_qty: round4(p.std), actual_qty: round4(p.actual), variance_qty: round4(vq),
                variance_pct: p.std ? round2((vq / p.std) * 100) : null, rate: round4(rate), variance_value: round2(vq * rate),
                remark: !p.std ? 'Not in BOM' : !p.actual ? 'Not used' : Math.abs(vq) < 1e-9 ? 'As per BOM' : vq > 0 ? 'Excess use' : 'Saving' });
        });
    });
    const byProduct = summarizeVariance(rows);
    return { rows, by_product: byProduct, orders_without_bom: orders.filter(o => !tplById[o.bom_template_id]).length };
}
function summarizeVariance(rows) {
    const m = new Map();
    rows.forEach(r => {
        if (!m.has(r.product_id)) m.set(r.product_id, { product_id: r.product_id, product_name: r.product_name, product_code: r.product_code, base_unit: r.base_unit, standard_qty: 0, actual_qty: 0, variance_qty: 0, variance_value: 0, orders: new Set() });
        const x = m.get(r.product_id);
        x.standard_qty += r.standard_qty; x.actual_qty += r.actual_qty; x.variance_qty += r.variance_qty; x.variance_value += r.variance_value; x.orders.add(r.doc_id);
    });
    return [...m.values()].map(x => ({ ...x, orders: x.orders.size, standard_qty: round4(x.standard_qty), actual_qty: round4(x.actual_qty), variance_qty: round4(x.variance_qty),
        variance_value: round2(x.variance_value), variance_pct: x.standard_qty ? round2((x.variance_qty / x.standard_qty) * 100) : null }))
        .sort((a, b) => Math.abs(b.variance_value) - Math.abs(a.variance_value));
}

function costTrend(docs) {
    const m = new Map();
    docs.forEach(d => {
        const k = `${d.output_product_id}|${d.month}`;
        if (!m.has(k)) m.set(k, { key: k, output_product_id: d.output_product_id, output_product_name: d.output_product_name, month: d.month, base_unit: d.base_unit, orders: 0, base_qty: 0, net_cost: 0, raw_material_cost: 0, byproduct_value: 0 });
        const x = m.get(k);
        x.orders++; x.base_qty += d.output_base_qty; x.net_cost += d.net_output_cost; x.raw_material_cost += d.raw_material_cost; x.byproduct_value += d.byproduct_value;
    });
    const rows = [...m.values()].sort((a, b) => a.output_product_name.localeCompare(b.output_product_name) || a.month.localeCompare(b.month));
    let prev = null;
    return rows.map(x => {
        const unit = x.base_qty ? round4(x.net_cost / x.base_qty) : 0;
        const same = prev && prev.output_product_id === x.output_product_id;
        const out = { ...x, base_qty: round4(x.base_qty), net_cost: round2(x.net_cost), raw_material_cost: round2(x.raw_material_cost), byproduct_value: round2(x.byproduct_value),
            unit_cost: unit, prev_unit_cost: same ? prev.unit_cost : null, change_pct: same && prev.unit_cost ? round2(((unit - prev.unit_cost) / prev.unit_cost) * 100) : null };
        prev = out;
        return out;
    });
}

async function bomCost(c, t, D, docs, f) {
    const { M, baseQty } = D;
    const tpls = await fetchAll(() => {
        let x = c.from('bom_templates').select('id, template_code, template_name, output_product_id, standard_output_qty, output_uom_id, is_active').eq('tenant_id', t);
        if (f.templateIds.length) x = x.in('id', f.templateIds);
        if (f.outputProductIds.length) x = x.in('output_product_id', f.outputProductIds);
        return x.order('id');
    });
    const ids = tpls.map(x => x.id);
    const [rm, bp] = await Promise.all([
        inChunks(ids, async ch => { const { data, error } = await c.from('bom_template_raw_materials').select('template_id, product_id, qty, uom_id, process_name').in('template_id', ch); if (error) throw error; return data || []; }),
        inChunks(ids, async ch => { const { data, error } = await c.from('bom_template_byproducts').select('template_id, product_id, qty, uom_id, recovery_rate').in('template_id', ch); if (error) throw error; return data || []; })
    ]);
    // rate: latest purchase rate, else the period's average consumption rate
    const used = {};
    Object.values(D.rmBy).flat().forEach(r => { const u = used[r.product_id] = used[r.product_id] || { q: 0, a: 0 }; u.q += baseQty(r.product_id, r.qty, r.uom_id, r.alt_qty); u.a += Number(r.amount) || 0; });
    const rateOf = pid => M.purchaseRate[pid] || (used[pid] && used[pid].q ? used[pid].a / used[pid].q : 0);
    const actual = {};
    docs.forEach(d => { const a = actual[d.output_product_id] = actual[d.output_product_id] || { qty: 0, cost: 0 }; a.qty += d.output_base_qty; a.cost += d.net_output_cost; });
    return tpls.map(tp => {
        const outBase = baseQty(tp.output_product_id, tp.standard_output_qty, tp.output_uom_id, null);
        const lines = rm.filter(r => r.template_id === tp.id).map(r => {
            const q = baseQty(r.product_id, r.qty, r.uom_id, null), rate = rateOf(r.product_id);
            const source = M.purchaseRate[r.product_id] ? 'purchase' : rate ? 'consumption' : 'none';
            return { product_name: M.products[r.product_id]?.product_name || '', process: r.process_name || '', base_qty: round4(q), base_unit: M.unitName(M.products[r.product_id]?.base_unit_id), rate: round4(rate), rate_source: source, amount: round2(q * rate), no_rate: !rate };
        });
        const recovery = bp.filter(b => b.template_id === tp.id).reduce((s, b) => s + (Number(b.qty) || 0) * (Number(b.recovery_rate) || 0), 0);
        const std = lines.reduce((s, l) => s + l.amount, 0) - recovery;
        const a = actual[tp.output_product_id];
        const actualUnit = a && a.qty ? a.cost / a.qty : null;
        const stdUnit = outBase ? std / outBase : 0;
        return { key: tp.id, template: `${tp.template_code} · ${tp.template_name}`, is_active: tp.is_active !== false, output_product_name: M.products[tp.output_product_id]?.product_name || '',
            standard_output_base_qty: round4(outBase), base_unit: M.unitName(M.products[tp.output_product_id]?.base_unit_id), raw_material_cost: round2(lines.reduce((s, l) => s + l.amount, 0)),
            byproduct_recovery: round2(recovery), standard_cost: round2(std), standard_unit_cost: round4(stdUnit), actual_unit_cost: actualUnit === null ? null : round4(actualUnit),
            difference_pct: actualUnit !== null && stdUnit > 0 && !lines.some(l => l.no_rate) ? round2(((actualUnit - stdUnit) / stdUnit) * 100) : null, missing_rates: lines.filter(l => l.no_rate).map(l => l.product_name), lines };
    });
}

async function productionReport(c, t, q) {
    const f = parseProductionQuery(q);
    const D = await loadProduction(c, t, f);
    const { lines, docs } = flatten(D, f);
    const totals = {
        orders: docs.length, output_base_qty: round4(docs.reduce((s, d) => s + d.output_base_qty, 0)), raw_material_cost: round2(docs.reduce((s, d) => s + d.raw_material_cost, 0)),
        term_amount: round2(docs.reduce((s, d) => s + d.term_amount, 0)), byproduct_value: round2(docs.reduce((s, d) => s + d.byproduct_value, 0)), net_output_cost: round2(docs.reduce((s, d) => s + d.net_output_cost, 0))
    };
    const base = { view: f.view, totals };
    if (f.view === 'register') return { ...base, rows: docs };
    if (f.view === 'details') return { ...base, rows: lines.map(l => ({ ...l, base_qty: round4(l.base_qty), amount: round2(l.amount), term_amount: round2(l.term_amount) })) };
    if (f.view === 'variance') return { ...base, ...(await variance(c, t, D, f)) };
    if (f.view === 'cost_trend') return { ...base, rows: costTrend(docs) };
    if (f.view === 'batch') return { ...base, rows: docs.map(d => ({ ...d, key: d.doc_id })).sort((a, b) => String(a.output_batch_no).localeCompare(String(b.output_batch_no)) || a.doc_date.localeCompare(b.doc_date)) };
    if (f.view === 'bom_cost') return { ...base, rows: await bomCost(c, t, D, docs, f) };
    if (f.view === 'pending') {
        const today = new Date().toISOString().slice(0, 10);
        return { ...base, rows: docs.map(d => ({ ...d, age_days: Math.round((Date.parse(today) - Date.parse(d.doc_date)) / 86400000) })) };
    }
    const type = { output: 'output', consumption: 'input', byproduct: 'byproduct' }[f.view];
    const groupBy = f.groupBy.length ? f.groupBy : ['product'];
    return { ...base, group_by: groupBy, rows: summarize(lines.filter(l => l.line_type === type), groupBy) };
}

async function productionMeta(c, t) {
    const M = await loadMasters(c, t);
    const [branches, warehouses, templates] = await Promise.all([
        fetchAll(() => c.from('branches').select('id, branch_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('warehouses').select('id, warehouse_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('bom_templates').select('id, template_code, template_name').eq('tenant_id', t).order('id'))
    ]);
    const list = (obj, name) => Object.values(obj).map(x => ({ id: x.id, name: x[name] })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return {
        views: VIEWS, groups: Object.entries(GROUPS).map(([key, g]) => ({ key, label: g.label })),
        products: Object.values(M.products).map(p => ({ id: p.id, name: `${p.product_name}${p.product_code ? ` (${p.product_code})` : ''}` })).sort((a, b) => a.name.localeCompare(b.name)),
        product_groups: list(M.groups, 'group_name'), branches: branches.map(b => ({ id: b.id, name: b.branch_name })), warehouses: warehouses.map(w => ({ id: w.id, name: w.warehouse_name })),
        templates: templates.map(x => ({ id: x.id, name: `${x.template_code} · ${x.template_name}` }))
    };
}

module.exports = { productionReport, productionMeta, parseProductionQuery, VIEWS, GROUPS };
