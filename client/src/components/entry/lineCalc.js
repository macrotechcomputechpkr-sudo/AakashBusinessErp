// =============================================
// components/entry/lineCalc.js
// Amount of a sales line with inline product terms:
//   gross -> Disc 1 -> Disc 2 ... (each on what is left) -> + Excise -> + VAT
// A term is a % of what it is calculated on (basis V), a rate per quantity
// (basis Q) or a fixed amount typed in the Over All Term pop-up.
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
