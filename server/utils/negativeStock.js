// =============================================
// utils/negativeStock.js
// System Control > Negative Stock (none / warn / block) for every document
// that takes goods OUT of a warehouse. Before, only Sales Delivery, Stock
// Transfer and Stock Adjustment checked it - a direct Sales Bill or a
// Purchase Return could take stock below zero even with "block" on.
//   * only stock items (utils/stockItems - no service / non-inventory /
//     fixed asset lines)
//   * lines of the same product / warehouse / batch are added up first, so
//     two lines of 6 against 10 on hand are caught (each alone would pass)
//   * quantity in BASE units (fixed dual-unit lines by their conversion)
// -> { blocked, warnings: [text] }
// =============================================

const { stockLines } = require('./stockItems');
const { toBaseUnitQty } = require('./unitConversion');
const { toBaseQtyFromDual, getDualUomMode } = require('./dualUomCalculation');

const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;

async function baseQtyOf(c, d) {
    if (d.alt_qty) {
        const { data: product } = await c.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
        if (product?.uom_mode === 'fixed_dual') {
            const { data: unitRate } = await c.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
            return toBaseQtyFromDual(d.qty, d.alt_qty, Number(unitRate?.conversion_factor) || 1, await getDualUomMode(c, d.product_id));
        }
    }
    return toBaseUnitQty(c, d.product_id, d.qty, d.uom_id);
}

/**
 * doc: the header (its warehouse_id is the default for lines)
 * details: the lines going out (callers leave out lines whose stock already went out, e.g. bill lines from a delivery)
 */
async function checkNegativeStock(c, t, doc, details) {
    const { data: sc } = await c.from('system_control_settings').select('negative_stock_control').eq('tenant_id', t).maybeSingle();
    const control = sc?.negative_stock_control || 'warn';
    if (control === 'none') return { blocked: false, warnings: [] };
    const lines = await stockLines(c, details);
    const need = new Map();
    for (const d of lines) {
        const wh = d.warehouse_id || doc.warehouse_id;
        if (!wh) continue;
        const k = `${d.product_id}|${wh}|${d.batch_no || ''}`;
        const q = await baseQtyOf(c, d);
        const cur = need.get(k) || { product_id: d.product_id, warehouse_id: wh, batch_no: d.batch_no || null, name: d.product_name_snapshot || d.product_id, wh_name: d.warehouse_name_snapshot || '', qty: 0 };
        cur.qty = round4(cur.qty + (Number(q) || 0));
        need.set(k, cur);
    }
    const warnings = [];
    for (const n of need.values()) {
        let q = c.from('v_current_stock').select('on_hand_qty').eq('tenant_id', t).eq('product_id', n.product_id).eq('warehouse_id', n.warehouse_id);
        q = n.batch_no ? q.eq('batch_no', n.batch_no) : q.is('batch_no', null);
        const { data: row } = await q.maybeSingle();
        const available = Number(row?.on_hand_qty) || 0;
        if (available - n.qty < -1e-9) warnings.push(`${n.name}${n.batch_no ? ` (batch ${n.batch_no})` : ''}: available ${available} (base unit)${n.wh_name ? ` in ${n.wh_name}` : ''}, taking out ${n.qty} - stock would go negative`);
    }
    return { blocked: warnings.length > 0 && control === 'block', warnings };
}

module.exports = { checkNegativeStock };
