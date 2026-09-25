// =============================================
// utils/progressCounters.js
// Moves a source line's ALTERNATE-unit progress counter (alt_qty_billed,
// alt_qty_delivered, ...) alongside its primary counter - see migration 110.
// altDelta is signed: + when the child document posts, - when it is
// cancelled. Never goes below zero, like the primary counters.
// =============================================
async function bumpAltCounter(tenantClient, table, id, column, altDelta) {
    const delta = Number(altDelta) || 0;
    if (!id || delta === 0) return;
    const { data: row } = await tenantClient.from(table).select(column).eq('id', id).maybeSingle();
    if (!row) return;
    await tenantClient.from(table).update({ [column]: Math.max(0, Number(row[column] || 0) + delta) }).eq('id', id);
}
module.exports = { bumpAltCounter };

// ---------------------------------------------------------------------
// Moving a source document's progress when a child document starts or
// stops counting (e.g. GRN received / cancelled -> Order qty_received).
// spec: { sourceIdField, table, counter, altCounter }
// dir: +1 when the child starts counting, -1 when it stops.
// ---------------------------------------------------------------------
async function moveSourceProgress(tenantClient, lines, spec, dir) {
    for (const d of (lines || [])) {
        const id = d && d[spec.sourceIdField];
        if (!id) continue;
        const { data: row } = await tenantClient.from(spec.table).select(spec.counter).eq('id', id).maybeSingle();
        if (!row) continue;
        await tenantClient.from(spec.table).update({ [spec.counter]: Math.max(0, Number(row[spec.counter] || 0) + dir * Number(d.qty || 0)) }).eq('id', id);
        await bumpAltCounter(tenantClient, spec.table, id, spec.altCounter, dir * Number(d.alt_qty || 0));
    }
}

// Header status from its lines' progress, measured in BASE units, so a
// dual-unit line counts its loose pieces: (qty*factor + alt) vs
// (done*factor + alt_done). statuses: { none, partial, full }; only
// headers currently in `rollable` are touched (never cancelled/closed).
async function rollHeaderStatus(tenantClient, { headerTable, detailTable, fk, headerId, counter, altCounter, statuses, rollable }) {
    if (!headerId) return;
    const { toBaseQtyFromDual, getDualUomMode } = require('./dualUomCalculation');
    const { data: lines } = await tenantClient.from(detailTable).select(`product_id, qty, alt_qty, ${counter}, ${altCounter}`).eq(fk, headerId);
    if (!lines || !lines.length) return;
    const ids = [...new Set(lines.filter(l => l.product_id && Number(l.alt_qty || 0) + Number(l[altCounter] || 0) > 0).map(l => l.product_id))];
    const factorOf = {};
    if (ids.length) {
        const { data: prods } = await tenantClient.from('products').select('id, uom_mode, dual_uom_primary_unit_id').in('id', ids);
        for (const p of (prods || []).filter(x => x.uom_mode === 'fixed_dual' && x.dual_uom_primary_unit_id)) {
            const { data: ur } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', p.id).eq('unit_id', p.dual_uom_primary_unit_id).maybeSingle();
            factorOf[p.id] = Number(ur?.conversion_factor) || 1;
        }
    }
    const mode = Object.keys(factorOf).length ? await getDualUomMode(tenantClient) : 'fixed';
    const measure = l => {
        const f = factorOf[l.product_id];
        return f
            ? { total: toBaseQtyFromDual(l.qty, l.alt_qty, f, mode), done: toBaseQtyFromDual(l[counter], l[altCounter], f, mode) }
            : { total: Number(l.qty) || 0, done: Number(l[counter]) || 0 };
    };
    const m = lines.map(measure);
    const full = m.every(x => x.done >= x.total - 0.00005);
    const any = m.some(x => x.done > 0.00005);
    const next = full ? statuses.full : (any ? statuses.partial : statuses.none);
    await tenantClient.from(headerTable).update({ status: next }).eq('id', headerId).in('status', rollable);
}

module.exports.moveSourceProgress = moveSourceProgress;
module.exports.rollHeaderStatus = rollHeaderStatus;

// Conversion factors of the fixed-dual products among `lines` (product_id -> factor).
async function dualFactors(tenantClient, lines) {
    const ids = [...new Set((lines || []).filter(l => l.product_id).map(l => l.product_id))];
    const out = {};
    if (!ids.length) return out;
    const { data: prods } = await tenantClient.from('products').select('id, uom_mode, dual_uom_primary_unit_id').in('id', ids);
    for (const p of (prods || []).filter(x => x.uom_mode === 'fixed_dual' && x.dual_uom_primary_unit_id)) {
        const { data: ur } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', p.id).eq('unit_id', p.dual_uom_primary_unit_id).maybeSingle();
        out[p.id] = Number(ur?.conversion_factor) || 1;
    }
    return out;
}

// Pending of one line: base units for fixed-dual products, primary otherwise.
// Returns { dual, pendingPrimary, pendingAlt, pendingBase, doneShare } where
// doneShare (0..1) apportions the line amount.
function linePending(d, counter, altCounter, factor, mode) {
    const { toBaseQtyFromDual, decomposeToDualDisplay } = require('./dualUomCalculation');
    const qty = Number(d.qty) || 0, done = Number(d[counter]) || 0;
    if (factor) {
        const total = toBaseQtyFromDual(qty, d.alt_qty, factor, mode);
        const doneBase = Math.min(total, toBaseQtyFromDual(done, d[altCounter], factor, mode));
        const pending = Math.max(0, total - doneBase);
        const split = decomposeToDualDisplay(pending, factor);
        return { dual: true, pendingPrimary: split.primary, pendingAlt: Math.round(split.secondary * 10000) / 10000, pendingBase: pending, doneShare: total ? doneBase / total : 0 };
    }
    return { dual: false, pendingPrimary: qty - done, pendingAlt: 0, pendingBase: qty - done, doneShare: qty ? done / qty : 0 };
}

module.exports.dualFactors = dualFactors;
module.exports.linePending = linePending;
