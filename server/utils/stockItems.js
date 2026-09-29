// =============================================
// utils/stockItems.js
// Which products are carried in stock.
//   Item Type service / non_inventory / fixed_asset is NOT inventory: a
//   service has no quantity on hand, and a fixed asset bought through a
//   purchase bill belongs in the fixed asset register, not in closing stock.
//   Documents still carry these lines (value, VAT, accounts) but write no
//   stock movement for them, and the negative-stock check skips them - the
//   same way Tally / Busy treat services and NAV treats non-inventory items.
// =============================================

const NON_STOCK = ['service', 'non_inventory', 'fixed_asset'];

/** Set of the given product ids that are not stock items */
async function nonStockIds(c, productIds) {
    const ids = [...new Set((productIds || []).filter(Boolean))];
    const out = new Set();
    for (let i = 0; i < ids.length; i += 200) {
        const { data } = await c.from('products').select('id, item_type').in('id', ids.slice(i, i + 200));
        (data || []).forEach(p => { if (NON_STOCK.includes(p.item_type)) out.add(p.id); });
    }
    return out;
}

/** the lines that move stock */
async function stockLines(c, details) {
    const skip = await nonStockIds(c, (details || []).map(d => d.product_id));
    return (details || []).filter(d => d.product_id && !skip.has(d.product_id));
}

module.exports = { NON_STOCK, nonStockIds, stockLines };
