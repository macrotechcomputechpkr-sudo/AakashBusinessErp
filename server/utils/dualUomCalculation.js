// =============================================
// utils/dualUomCalculation.js
// "5 CRT ra 5 PCS aparai bill garna sakos, rate CRT wa PCS jaisukai
// maa lagauna milos" - a genuinely independent primary+secondary
// quantity pair (not "5 Carton, which converts to 50 Pieces"), with
// the entered rate assignable to either unit.
// =============================================

// mode (System Control "dual_uom_mode"):
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

// Tenant's dual-UOM entry mode, cached briefly (called once per line).
const modeCache = new Map();
async function getDualUomMode(tenantClient) {
    const { tenantIdOfClient } = require('./dbHelpers');
    const tenantId = tenantIdOfClient(tenantClient);
    if (!tenantId) return 'fixed';
    const hit = modeCache.get(tenantId);
    if (hit && Date.now() - hit.at < 30000) return hit.mode;
    const { data } = await tenantClient.from('system_control_settings').select('dual_uom_mode').eq('tenant_id', tenantId).maybeSingle();
    const mode = data?.dual_uom_mode === 'auto_convert' ? 'auto_convert' : 'fixed';
    modeCache.set(tenantId, { mode, at: Date.now() });
    return mode;
}

module.exports = { toBaseQtyFromDual, computeDualAmount, decomposeToDualDisplay, getDualUomMode };
