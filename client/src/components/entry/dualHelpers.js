// =============================================
// components/entry/dualHelpers.js
// "Fixed Dual UOM" items (e.g. Carton + loose Pieces) on an entry line:
// gross amount of the line and the qty handlers the line grid uses.
// Mirrors the server's computeDualAmount.
// =============================================
import { onPrimaryQtyChange, onSecondaryQtyChange, validateFixedSecondary, dualBaseQty } from '../../utils/dualUomEntryMode';

export function dualHelpers(products, dualMode) {
    const byId = id => products.find(p => p.id === id);
    const isDual = id => byId(id)?.uom_mode === 'fixed_dual';
    const factor = id => {
        const p = byId(id);
        const r = (p?.product_unit_rates || []).find(x => x.unit_id === p?.dual_uom_primary_unit_id);
        return Number(r?.conversion_factor) || 1;
    };
    const lineGross = d => {
        if (isDual(d.product_id) && d.alt_qty) {
            const f = factor(d.product_id);
            const base = dualBaseQty(d.qty, d.alt_qty, f, dualMode.mode);
            return d.rate_basis === 'primary' ? (base / f) * (Number(d.rate) || 0) : base * (Number(d.rate) || 0);
        }
        return (Number(d.qty) || 0) * (Number(d.rate) || 0);
    };
    const dual = {
        isDual,
        onPrimary: (v, d) => (dualMode.mode === 'auto_convert' ? onPrimaryQtyChange(v, factor(d.product_id)) : { qty: v }),
        onSecondary: (v, d) => (dualMode.mode === 'auto_convert'
            ? onSecondaryQtyChange(v, factor(d.product_id), dualMode.reverseEnabled)
            : { alt_qty: validateFixedSecondary(v, factor(d.product_id)).value }),
        error: d => (dualMode.mode !== 'auto_convert' ? validateFixedSecondary(d.alt_qty, factor(d.product_id)).error : null)
    };
    return { isDual, factor, lineGross, dual };
}
