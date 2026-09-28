// =============================================
// components/entry/AmountCell.jsx
// Gross / Net Amount of an entry line that can be typed in:
//   * a Gross typed with a quantity works out the rate (gross / qty); when
//     the product says so (Product Master > "Amount typed on a line changes
//     quantity", sales and purchase apart) it works out the quantity from
//     the rate instead
//   * a Net Amount is taken back to the gross through the line's charges
//     (every % charge scales with the gross, fixed / per-qty ones do not)
// The cell keeps what is typed while it has focus, so the worked-out figure
// does not jump under the cursor.
// =============================================
import React, { useState } from 'react';

const r4 = n => Math.round((Number(n) || 0) * 10000) / 10000;

export default function AmountCell({ value, onChange, disabled, bold, width = 90, title }) {
    const [text, setText] = useState(null);
    const shown = text !== null ? text : (value === '' || value === null || value === undefined ? '' : (Number(value) || 0).toFixed(2));
    return (
        <input type="number" step="0.01" className={`erp-input text-right ${bold ? 'font-semibold' : ''}`} style={{ width }} disabled={disabled} title={title}
            value={shown} onFocus={e => { setText(shown); e.target.select(); }} onBlur={() => setText(null)}
            onChange={e => { setText(e.target.value); if (e.target.value !== '' && !Number.isNaN(Number(e.target.value))) onChange(Number(e.target.value)); }} />
    );
}

/**
 * the line change for a typed gross: { qty } when the product works quantity out of the amount
 * (single-unit lines with a rate), else { rate }; lineGross(d) is the page's own gross of a line
 */
export function patchFromGross(d, gross, lineGross, qtyFromAmount, isDual) {
    const rate = Number(d.rate) || 0;
    if (qtyFromAmount && !isDual && rate > 0) return { qty: r4(gross / rate) };
    const perRate = lineGross({ ...d, rate: 1 });
    if (perRate > 0) return { rate: r4(gross / perRate) };
    // no quantity yet: one of the unit at that amount
    if (!isDual && !(Number(d.qty) > 0)) return { qty: 1, rate: r4(gross) };
    return null;
}

/** the gross that gives a typed net, when net = a * gross + b (amountAt(g): net of the line at gross g) */
export function grossForNet(net, amountAt) {
    // a large probe so the 2-decimal rounding inside the line does not skew the slope
    const K = 1000000;
    const b = amountAt(0);
    const a = (amountAt(K) - b) / K;
    return a ? Math.round(((net - b) / a) * 10000) / 10000 : null;
}
