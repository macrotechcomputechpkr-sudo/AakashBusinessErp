// =============================================
// utils/dualUomCalculation.js
// "5 CRT ra 5 PCS aparai bill garna sakos, rate CRT wa PCS jaisukai
// maa lagauna milos" - a genuinely independent primary+secondary
// quantity pair (not "5 Carton, which converts to 50 Pieces"), with
// the entered rate assignable to either unit.
// =============================================

// mode (System Control "dual_uom_mode", or the product's own dual_auto_convert):
//   'fixed'        - Primary + Secondary are ADDITIVE (5 CRT + 3 PCS), secondary < factor.
//   'auto_convert' - Flexible: the Secondary field holds the TOTAL in the
//                    secondary unit (typing 5 CRT mirrors 25 PCS; typing 27 PCS
//                    shows 5 CRT). Adding them double-counted stock and amount.
//                    Total = secondary when entered, else primary x factor.
function toBaseQtyFromDual(qtyPrimary, qtySecondary, conversionFactor, mode = 'fixed') {
    const factor = Number(conversionFactor) || 1;
    if (mode === 'auto_convert') {
        const hasSecondary = qtySecondary !== null && qtySecondary !== undefined && qtySecondary !== '' && Number(qtySecondary) !== 0;
        return hasSecondary ? Number(qtySecondary) : (Number(qtyPrimary) || 0) * factor;
    }
    return (Number(qtyPrimary) || 0) * factor + (Number(qtySecondary) || 0);
}

function computeDualAmount(qtyPrimary, qtySecondary, rate, rateBasis, conversionFactor, mode = 'fixed') {
    const totalBaseQty = toBaseQtyFromDual(qtyPrimary, qtySecondary, conversionFactor, mode);
    if (rateBasis === 'primary') {
        return (totalBaseQty / (Number(conversionFactor) || 1)) * Number(rate);
    }
    return totalBaseQty * Number(rate);
}

function decomposeToDualDisplay(baseQty, conversionFactor) {
    const factor = Number(conversionFactor) || 1;
    const qty = Number(baseQty) || 0;
    return { primary: Math.floor(qty / factor), secondary: qty % factor };
}

// Tenant's dual-UOM entry mode (System Control), cached briefly (called once per line).
// A product can override it (Product Master: dual_auto_convert yes / no; null = System Control).
const modeCache = new Map();
async function tenantDualState(tenantClient) {
    const { tenantIdOfClient } = require('./dbHelpers');
    const tenantId = tenantIdOfClient(tenantClient);
    if (!tenantId) return { mode: 'fixed', overrides: new Map() };
    const hit = modeCache.get(tenantId);
    if (hit && Date.now() - hit.at < 30000) return hit;
    const { data } = await tenantClient.from('system_control_settings').select('dual_uom_mode').eq('tenant_id', tenantId).maybeSingle();
    const mode = data?.dual_uom_mode === 'auto_convert' ? 'auto_convert' : 'fixed';
    const overrides = new Map();
    try {
        const { data: prods } = await tenantClient.from('products').select('id, dual_auto_convert').eq('tenant_id', tenantId).eq('uom_mode', 'fixed_dual');
        (prods || []).forEach(p => { if (p.dual_auto_convert === true || p.dual_auto_convert === false) overrides.set(p.id, p.dual_auto_convert ? 'auto_convert' : 'fixed'); });
    } catch { /* column not there yet: System Control only */ }
    // Product Master "Rate per": a Fixed Dual item priced per its primary or secondary unit always
    const bases = new Map();
    try {
        const { data: prods } = await tenantClient.from('products').select('id, dual_rate_basis').eq('tenant_id', tenantId).eq('uom_mode', 'fixed_dual');
        (prods || []).forEach(p => { if (p.dual_rate_basis === 'primary' || p.dual_rate_basis === 'secondary') bases.set(p.id, p.dual_rate_basis); });
    } catch { /* column not there yet: per line */ }
    const state = { mode, overrides, bases, at: Date.now() };
    modeCache.set(tenantId, state);
    return state;
}
/** entry mode of one product (its own setting, else System Control's) */
async function getDualUomMode(tenantClient, productId) {
    const st = await tenantDualState(tenantClient);
    return (productId && st.overrides.get(productId)) || st.mode;
}
/** productId => mode, for loops over many lines */
async function getDualUomResolver(tenantClient) {
    const st = await tenantDualState(tenantClient);
    return productId => (productId && st.overrides.get(productId)) || st.mode;
}
const clearDualUomCache = () => modeCache.clear();

/** the rate basis of a line: the product's fixed one (Product Master "Rate per"), else the line's own choice */
async function rateBasisFor(tenantClient, productId, lineBasis) {
    const st = await tenantDualState(tenantClient);
    return (productId && st.bases && st.bases.get(productId)) || (lineBasis === 'secondary' ? 'secondary' : 'primary');
}

module.exports = { rateBasisFor, toBaseQtyFromDual, computeDualAmount, decomposeToDualDisplay, getDualUomMode, getDualUomResolver, clearDualUomCache };
