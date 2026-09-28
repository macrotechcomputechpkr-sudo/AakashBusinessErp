// =============================================
// utils/termInput.js
// What may be typed for a billing term in a transaction line (Billing Term
// > "Typed In Entry As"): a % of the value, a rate per quantity (rate x qty)
// or an amount - one of them, or several. A term that may not be changed in
// entries (manual_override off) keeps its own value, or the value set for
// the product in Product Master > Term Mapping.
// =============================================
const MODES = {
    percent: ['pct'], rate: ['rate'], amount: ['amt'], all: ['pct', 'rate', 'amt'],
    rate_percent: ['pct', 'rate'], rate_percent_amount: ['pct', 'rate', 'amt'], rate_amount: ['rate', 'amt']
};
const MODE_KEYS = Object.keys(MODES);
// product term mapping basis -> input kind
const BASIS_KIND = { percent: 'pct', rate: 'rate', amount: 'amt' };

/** the input kinds allowed for a term: subset of pct / rate / amt */
function allowedKinds(term) {
    return MODES[term && term.entry_input_mode] || MODES.all;
}

/** a clean { kind, value } or null */
function cleanInput(x) {
    if (!x || typeof x !== 'object') return null;
    const kind = ['pct', 'rate', 'amt'].includes(x.kind) ? x.kind : null;
    const value = Number(x.value);
    if (!kind || x.value === '' || x.value === null || x.value === undefined || !Number.isFinite(value)) return null;
    return { kind, value };
}

/** the value set for a product (Product Master > Term Mapping), as an input */
function productInput(mapping) {
    if (!mapping || mapping.override_percentage === null || mapping.override_percentage === undefined || mapping.override_percentage === '') return null;
    return cleanInput({ kind: BASIS_KIND[mapping.override_basis] || 'pct', value: mapping.override_percentage });
}

/**
 * the input that counts for a term on a line: the typed one when the term may be
 * changed in entries and the kind is allowed, else the product's own value
 */
function effectiveInput(term, typed, productMapping) {
    const own = productInput(productMapping);
    if (term.manual_override === false) return own;
    const t = cleanInput(typed);
    if (t && allowedKinds(term).includes(t.kind)) return t;
    return own;
}

/** the term as it is worked out for one line with that input */
function applyInput(term, input, qty) {
    if (!term || !input) return term;
    if (input.kind === 'pct') return { ...term, calculation_mode: 'percentage', basis: 'value', rate_percentage: input.value, fixed_amount: 0 };
    if (input.kind === 'rate') return { ...term, calculation_mode: 'fixed_amount', fixed_amount: (Number(qty) || 0) * input.value };
    return { ...term, calculation_mode: 'fixed_amount', fixed_amount: input.value };
}

/** product_id -> billing_term_id -> mapping, for one side ('sales' | 'purchase') */
async function loadProductTermMap(tenantClient, productIds, side) {
    const ids = [...new Set((productIds || []).filter(Boolean))];
    const out = {};
    if (!ids.length) return out;
    for (let i = 0; i < ids.length; i += 200) {
        const { data } = await tenantClient.from('product_term_mappings')
            .select('product_id, category_type, billing_term_id, override_percentage, override_basis').in('product_id', ids.slice(i, i + 200));
        (data || []).filter(m => !side || m.category_type === side).forEach(m => {
            (out[m.product_id] = out[m.product_id] || {})[m.billing_term_id] = m;
        });
    }
    return out;
}

module.exports = { MODES, MODE_KEYS, allowedKinds, cleanInput, productInput, effectiveInput, applyInput, loadProductTermMap };
