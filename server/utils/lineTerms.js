// =============================================
// utils/lineTerms.js
// Inline product terms of a sales line (System Control > Term Mapping):
// Product Discount 1-5, Excise and VAT, each with its % and amount, kept in
// line_terms. The totals stay in the usual columns: discount_amount (all
// discounts), excise_amount, tax_amount (VAT).
// =============================================
const KEYS = ['disc1', 'disc2', 'disc3', 'disc4', 'disc5', 'excise', 'vat'];
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** only the known keys, numbers rounded; null when nothing is set */
function cleanLineTerms(v) {
    if (!v || typeof v !== 'object') return null;
    const out = {};
    KEYS.forEach(k => {
        const x = v[k];
        if (!x) return;
        const pct = Number(x.percent), amt = Number(x.amount);
        if (!(pct > 0) && !(amt > 0)) return;
        out[k] = { term_id: x.term_id || null, percent: pct > 0 ? Math.round(pct * 10000) / 10000 : 0, amount: r2(amt) };
        // Q basis: percent holds the rate per quantity; fixed: an amount typed in (Over All Term)
        if (x.basis === 'Q') out[k].basis = 'Q';
        if (x.fixed) out[k].fixed = true;
    });
    return Object.keys(out).length ? out : null;
}
const exciseOf = d => r2(d && d.excise_amount);

module.exports = { KEYS, cleanLineTerms, exciseOf };
