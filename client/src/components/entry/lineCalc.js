// =============================================
// components/entry/lineCalc.js
// Amount of a sales line with inline product terms:
//   gross -> Disc 1 -> Disc 2 ... (each on what is left) -> + Excise -> + VAT
// A term is a % of what it is calculated on (basis V), a rate per quantity
// (basis Q) or a fixed amount typed in the Charges Summary pop-up.
// (VAT is on the amount after discounts and excise, as on a Nepali invoice).
// Without mapped terms the line keeps the plain Disc % / Tax % fields.
// The result goes into discount_amount / excise_amount / tax_amount and
// line_terms, which the server stores as they are.
// =============================================
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

export function calcLine(d, gross, cols) {
    const g = Number(gross) || 0;
    if (!cols || !cols.length) {
        const disc = g * (Number(d.discount_percent) || 0) / 100;
        const tax = (g - disc) * (Number(d.tax_percent) || 0) / 100;
        return { discount_amount: r2(disc), excise_amount: 0, tax_amount: r2(tax), amount: r2(g - disc + tax), line_terms: null };
    }
    const lt = d.line_terms || {};
    const qty = Number(d.qty) || 0;
    // basis V: % of what the term is calculated on; basis Q: rate per quantity; fixed: amount typed in
    const termAmt = (x, base) => (x?.fixed ? Number(x.amount) || 0 : x?.basis === 'Q' ? qty * (Number(x.percent) || 0) : base * (Number(x?.percent) || 0) / 100);
    const flags = x => ({ ...(x?.fixed ? { fixed: true } : {}), ...(x?.basis === 'Q' ? { basis: 'Q' } : {}) });
    let running = g, disc = 0, excise = 0, vat = 0;
    const out = {};
    cols.filter(c => c.kind === 'discount').forEach(c => {
        const x = lt[c.key];
        const amt = termAmt(x, running);
        out[c.key] = { term_id: c.term_id, percent: Number(x?.percent) || 0, amount: r2(amt), base: r2(running), ...flags(x) };
        disc += amt; running -= amt;
    });
    const ex = cols.find(c => c.kind === 'excise');
    if (ex) { excise = termAmt(lt.excise, running); out.excise = { term_id: ex.term_id, percent: Number(lt.excise?.percent) || 0, amount: r2(excise), base: r2(running), ...flags(lt.excise) }; }
    const vt = cols.find(c => c.kind === 'vat');
    if (vt) { vat = termAmt(lt.vat, running + excise); out.vat = { term_id: vt.term_id, percent: Number(lt.vat?.percent) || 0, amount: r2(vat), base: r2(running + excise), ...flags(lt.vat) }; }
    return { discount_amount: r2(disc), excise_amount: r2(excise), tax_amount: r2(vat), amount: r2(running + excise + vat), line_terms: out };
}

/** default line_terms for a new line: every mapped term at its own default % */
export function defaultLineTerms(cols) {
    if (!cols || !cols.length) return null;
    const lt = {};
    cols.forEach(c => { if (c.default_percent) lt[c.key] = { term_id: c.term_id, percent: c.default_percent }; });
    return lt;
}

// what may be typed for a term (Billing Term > Typed In Entry As)
const MODES = {
    percent: ['pct'], rate: ['rate'], amount: ['amt'], all: ['pct', 'rate', 'amt'],
    rate_percent: ['pct', 'rate'], rate_percent_amount: ['pct', 'rate', 'amt'], rate_amount: ['rate', 'amt']
};
export const allowedKinds = mode => MODES[mode] || MODES.all;
const BASIS_KIND = { percent: 'pct', rate: 'rate', amount: 'amt' };

/** a line term from an input kind: % of value, rate x qty, or an amount */
export function termFromInput(termId, kind, value) {
    if (kind === 'rate') return { term_id: termId, percent: value, basis: 'Q' };
    if (kind === 'amt') return { term_id: termId, fixed: true, amount: value, percent: 0 };
    return { term_id: termId, percent: value, basis: 'V' };
}
/** which input a line term holds */
export const kindOf = x => (x?.fixed ? 'amt' : x?.basis === 'Q' ? 'rate' : 'pct');

/**
 * line_terms for a line when a product is picked: the line's own (or the default %), then the
 * product's values (Product Master > Term Mapping, as %, rate x qty or amount); a term that may
 * not be changed in entries always takes the product's value or its own default
 */
export function productLineTerms(cols, product, current, side = 'sales') {
    if (!cols || !cols.length) return current || null;
    const lt = { ...(current || defaultLineTerms(cols) || {}) };
    const maps = (product?.product_term_mappings || []).filter(m => m.category_type === side);
    cols.forEach(c => {
        const m = maps.find(x => x.billing_term_id === c.term_id);
        const has = m && m.override_percentage !== null && m.override_percentage !== undefined && m.override_percentage !== '';
        if (has) lt[c.key] = termFromInput(c.term_id, BASIS_KIND[m.override_basis] || 'pct', Number(m.override_percentage));
        else if (c.manual === false) { if (c.default_percent) lt[c.key] = { term_id: c.term_id, percent: c.default_percent }; else delete lt[c.key]; }
    });
    return lt;
}

/** fields to send for one line (percent columns kept for older reports) */
export function lineForSave(d, gross, cols) {
    const x = calcLine(d, gross, cols);
    if (!cols || !cols.length) return { ...d };
    const g = Number(gross) || 0;
    return {
        ...d, line_terms: x.line_terms, discount_amount: x.discount_amount, excise_amount: x.excise_amount, tax_amount: x.tax_amount,
        discount_percent: g ? Math.round((x.discount_amount / g) * 1000000) / 10000 : 0,
        tax_percent: Number(d.line_terms?.vat?.percent) || 0
    };
}

/** purchase: a line's charges once a product is picked - its own plus the product's (Term Mapping, on by default) */
export function productTermIds(product, current, side = 'purchase') {
    const ids = [...(current || [])];
    (product?.product_term_mappings || []).filter(m => m.category_type === side && m.is_enabled_by_default !== false)
        .forEach(m => { if (!ids.includes(m.billing_term_id)) ids.push(m.billing_term_id); });
    return ids;
}

/** purchase: a line's typed charge inputs with one changed ('' clears it) */
export function withTermValue(values, termId, kind, value) {
    const out = { ...(values || {}) };
    if (value === '' || value === null || value === undefined) delete out[termId];
    else out[termId] = { kind, value };
    return out;
}
