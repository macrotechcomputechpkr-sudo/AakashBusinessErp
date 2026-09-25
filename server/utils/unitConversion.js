// =============================================
// utils/unitConversion.js
// A stock ledger must be unit-agnostic - a product's on-hand quantity
// is one number regardless of which unit a given transaction happened
// to use. Shared by every module that writes to stock_movements
// (Stock Transfer, Production, and any future one) so the conversion
// logic lives in exactly one place.
// =============================================

async function toBaseUnitQty(tenantClient, productId, qty, selectedUomId) {
    if (!selectedUomId) return Number(qty);
    const { data: unitRate } = await tenantClient
        .from('product_unit_rates').select('conversion_factor, is_base_unit')
        .eq('product_id', productId).eq('unit_id', selectedUomId).maybeSingle();
    if (!unitRate || unitRate.is_base_unit) return Number(qty);
    return Number(qty) * Number(unitRate.conversion_factor || 1);
}

module.exports = { toBaseUnitQty };
