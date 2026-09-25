// =============================================
// utils/pendingDocuments.js
// Documents still waiting for their next step, with the pending value -
// for Ageing (challans / orders) and anything else that needs it:
//   sales_challan     Goods Delivery (GDN) not yet billed
//   sales_order       Sales Order not yet delivered
//   purchase_challan  Goods Receipt (GRN) not yet billed
//   purchase_order    Purchase Order not yet received
// Same counters and dual-unit handling as the Outstanding Report
// (routes/outstandingReportRoutes.js): pending base qty = ordered - done,
// pending value = line amount x pending / total. Counters are current, so
// "pending" is as of today even when an earlier as-on date is asked.
// =============================================
const { toBaseQtyFromDual, getDualUomMode } = require('./dualUomCalculation');

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
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}

const STAGES = {
    sales_challan: { side: 'receivable', kind: 'challan', label: 'Goods Delivery (unbilled)', header: 'sales_deliveries', detail: 'sales_delivery_details', fk: 'delivery_id',
        done: 'qty_billed', party: 'customer_ledger_id', partyName: 'customer_name_snapshot', statuses: ['posted'] },
    sales_order: { side: 'receivable', kind: 'order', label: 'Sales Order (undelivered)', header: 'sales_orders', detail: 'sales_order_details', fk: 'order_id',
        done: 'qty_delivered', party: 'customer_ledger_id', partyName: 'customer_name_snapshot', statuses: ['confirmed', 'partially_delivered'] },
    purchase_challan: { side: 'payable', kind: 'challan', label: 'Goods Receipt (unbilled)', header: 'purchase_grns', detail: 'purchase_grn_details', fk: 'grn_id',
        done: 'qty_billed', party: 'vendor_ledger_id', partyName: 'vendor_name_snapshot', statuses: ['received', 'partially_billed'] },
    purchase_order: { side: 'payable', kind: 'order', label: 'Purchase Order (unreceived)', header: 'purchase_orders', detail: 'purchase_order_details', fk: 'order_id',
        done: 'qty_received', party: 'vendor_ledger_id', partyName: 'vendor_name_snapshot', statuses: ['confirmed', 'partially_received'] }
};

// opts: { asOn, partyIds, productCompanyIds, areaIds, routeIds, agentIds, branchIds } -> [{ ...doc, pending_value, pending_base_qty, lines }]
async function pendingDocuments(c, t, stageKey, opts = {}) {
    const s = STAGES[stageKey];
    const headers = await fetchAll(() => {
        let q = c.from(s.header).select('*').eq('tenant_id', t).in('status', s.statuses).order('id');
        if (opts.asOn) q = q.lte('doc_date', opts.asOn);
        if (opts.partyIds?.length) q = q.in(s.party, opts.partyIds);
        return q;
    });
    const hs = headers.filter(h => (!opts.productCompanyIds?.length || opts.productCompanyIds.includes(h.product_company_id))
        && (!opts.areaIds?.length || opts.areaIds.includes(h.area_id)) && (!opts.routeIds?.length || opts.routeIds.includes(h.route_id))
        && (!opts.agentIds?.length || opts.agentIds.includes(h.agent_id)) && (!opts.branchIds?.length || opts.branchIds.includes(h.branch_id)));
    if (!hs.length) return [];
    const details = await inChunks(hs.map(h => h.id), async ids => {
        const { data, error } = await c.from(s.detail).select('*').in(s.fk, ids);
        if (error) throw error; return data || [];
    });
    // Fixed-dual items: measure in base units (primary x factor + loose).
    const pids = [...new Set(details.filter(d => d.alt_qty != null).map(d => d.product_id).filter(Boolean))];
    const factorOf = {};
    if (pids.length) {
        const prods = await inChunks(pids, async ids => { const { data } = await c.from('products').select('id, uom_mode, dual_uom_primary_unit_id').in('id', ids); return data || []; });
        const duals = prods.filter(p => p.uom_mode === 'fixed_dual' && p.dual_uom_primary_unit_id);
        const rates = await inChunks(duals.map(p => p.id), async ids => { const { data } = await c.from('product_unit_rates').select('product_id, unit_id, conversion_factor').in('product_id', ids); return data || []; });
        duals.forEach(p => { factorOf[p.id] = Number(rates.find(r => r.product_id === p.id && r.unit_id === p.dual_uom_primary_unit_id)?.conversion_factor) || 1; });
    }
    const dualMode = Object.keys(factorOf).length ? await getDualUomMode(c) : 'fixed';
    const byHeader = {};
    details.forEach(d => {
        const qty = Number(d.qty) || 0, done = Number(d[s.done]) || 0, amount = Number(d.amount) || 0;
        let total, pending;
        const f = factorOf[d.product_id];
        if (f) { total = toBaseQtyFromDual(qty, d.alt_qty, f, dualMode); pending = Math.max(0, total - toBaseQtyFromDual(done, d[`alt_${s.done}`], f, dualMode)); }
        else { total = qty; pending = Math.max(0, qty - done); }
        if (pending <= 0.00005) return;
        const value = total ? amount * pending / total : 0;
        const agg = (byHeader[d[s.fk]] = byHeader[d[s.fk]] || { value: 0, base: 0, lines: 0 });
        agg.value += value; agg.base += pending; agg.lines++;
    });
    return hs.filter(h => byHeader[h.id]).map(h => ({
        stage: stageKey, kind: s.kind, label: s.label, doc_type: stageKey, doc_id: h.id, doc_no: h.doc_no, doc_date: String(h.doc_date).slice(0, 10),
        due_date: h.due_date ? String(h.due_date).slice(0, 10) : null, party_id: h[s.party] || null, party_name: h[s.partyName] || h.cash_vendor_name || '',
        product_company_id: h.product_company_id || null, total_amount: round2(h.total_amount), pending_value: round2(byHeader[h.id].value),
        pending_base_qty: round4(byHeader[h.id].base), pending_lines: byHeader[h.id].lines,
        area_id: h.area_id || null, route_id: h.route_id || null, agent_id: h.agent_id || null, vehicle_no: h.vehicle_no || null
    }));
}

module.exports = { pendingDocuments, PENDING_STAGES: STAGES };
