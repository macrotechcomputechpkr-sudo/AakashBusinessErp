// =============================================
// utils/salesPricing.js
// Rate + discount for a sales line from the customer's Rate Category and
// Discount Category (server: /api/resolve-sales-price, utils/pricing.js).
// Discount Category rules can be Qty / Value slabs, so when a line of such
// a product changes qty or unit it is priced again (debounced).
// =============================================
import { useRef } from 'react';

export const priceUrl = (customerId, productId, extra = {}) => {
    const q = new URLSearchParams({ customer_ledger_id: customerId, product_id: productId });
    Object.entries(extra).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    return `/api/resolve-sales-price?${q}`;
};

/** the unit a new line starts in (dual-UOM products start in their primary unit) */
export const lineUnitOf = product => (product?.uom_mode === 'fixed_dual' ? product.dual_uom_primary_unit_id : product?.base_unit_id) || '';

/**
 * const reprice = useSlabRepricing(authFetch, form, updateDetailRow)
 * reprice.mark(idx, res.data)          after the first lookup of a line
 * reprice.onChange(idx, patch)         from updateDetailRow
 */
export function useSlabRepricing(authFetch, form, setRow, { withDiscount = true } = {}) {
    const formRef = useRef(form);
    formRef.current = form;
    const slabs = useRef({});
    const timers = useRef({});
    const mark = (idx, data) => { slabs.current[idx] = !!(data && data.has_slabs); };
    const onChange = (idx, patch) => {
        if (!patch || !('qty' in patch || 'uom_id' in patch) || !slabs.current[idx]) return;
        clearTimeout(timers.current[idx]);
        timers.current[idx] = setTimeout(async () => {
            const f = formRef.current;
            const row = f?.details?.[idx];
            if (!row?.product_id || !f.customer_ledger_id) return;
            try {
                const r = await authFetch(priceUrl(f.customer_ledger_id, row.product_id, { unit_id: row.uom_id, qty: row.qty, payment_term: f.payment_term }));
                const next = {};
                if (withDiscount) next.discount_percent = r.data.discount_percent;
                if (r.data.effect_on_rate || !withDiscount) next.rate = r.data.rate;
                setRow(idx, next);
            } catch { /* keep what the line has */ }
        }, 400);
    };
    return { mark, onChange };
}
