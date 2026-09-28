// =============================================
// utils/productVat.js
// Whether a product carries VAT, now that the product master has no "VAT
// Applicable" tick: a product with sales terms set in its Term Mapping tab
// is taxable only when one of them is a VAT-type term (its override % or
// the term's rate); a product with no sales terms set takes the default VAT.
// =============================================
async function productVatMap(c, t, productIds, defaultRate) {
    const out = {};
    productIds.forEach(id => { out[id] = { taxable: true, percent: defaultRate }; });
    if (!productIds.length) return out;
    const { data: terms } = await c.from('billing_terms').select('id, tax_type, rate_percentage').eq('tenant_id', t);
    const T = Object.fromEntries((terms || []).map(x => [x.id, x]));
    const rows = [];
    for (let i = 0; i < productIds.length; i += 200) {
        const { data } = await c.from('product_term_mappings').select('product_id, category_type, billing_term_id, is_enabled_by_default, override_percentage').in('product_id', productIds.slice(i, i + 200));
        rows.push(...(data || []));
    }
    const byProduct = {};
    rows.filter(r => r.category_type === 'sales').forEach(r => { (byProduct[r.product_id] = byProduct[r.product_id] || []).push(r); });
    Object.entries(byProduct).forEach(([pid, list]) => {
        const vat = list.find(r => r.is_enabled_by_default !== false && T[r.billing_term_id]?.tax_type === 'vat');
        out[pid] = vat
            ? { taxable: true, percent: Number(vat.override_percentage ?? T[vat.billing_term_id].rate_percentage ?? defaultRate) || defaultRate }
            : { taxable: false, percent: 0 };
    });
    return out;
}
module.exports = { productVatMap };
