// =============================================
// components/entry/PurchaseTermPopups.jsx
// FinPro-style term pop-ups of the purchase entries (Requisition,
// Quotation, Order, GRN, Bill, Return, Non-saleable Return). Purchase lines
// carry billing_term_ids (Billing Term setup) that the server evaluates, so
// here a term is ticked on or off; amounts come from /billing-terms/preview.
//   * PurchaseProductTermPopup - "<Entry> (Product wise)": the terms of the
//     chosen line(s), with basis, %, amount, calculated on, and the ledger /
//     sign / formula / taxation of the focused term
//   * PurchaseOverallTermPopup - "<Entry> Over All Term(s)": product-term
//     totals (an amount typed here is shared back to the lines by their
//     share) and the bill-level terms with their preview
// =============================================
import React, { useState } from 'react';
import { FinPopup } from './FinEntry';

const fmt = n => (Number(n) || 0).toFixed(2);
const basisOf = t => (t?.calculation_mode === 'fixed_amount' ? 'A' : t?.calculation_mode === 'formula' ? 'F' : t?.calculation_mode === 'free_quantity' ? 'Q' : 'V');
const formulaOf = t => (!t ? '' : t.calculation_mode === 'formula' ? t.formula_expression : t.base_reference_term ? `after ${t.base_reference_term.term_code}` : 'BV');
const TAXATION = { vat: 'VAT', excise: 'Excise', discount: 'Cash Discount', none: 'None' };

/**
 * lines: [{ idx, line }] the target lines; previews: lineTermPreviews (by line index);
 * subLedgerCell(term): node for the SubLedger column (TermLedgerInfo)
 */
export function PurchaseProductTermPopup({ title, lines, terms, previews, productName, onToggle, subLedgerCell, onClose }) {
    const [focus, setFocus] = useState(0);
    const basicOf = l => (Number(l.qty) || 0) * (Number(l.rate) || 0);
    const basic = lines.reduce((s, t) => s + basicOf(t.line), 0);
    const qty = lines.reduce((s, t) => s + (Number(t.line.qty) || 0), 0);
    const amountOf = termId => lines.reduce((s, { idx, line }) => {
        const pos = (line.billing_term_ids || []).indexOf(termId);
        return s + (pos >= 0 ? Number(previews[idx]?.lines?.[pos]?.amount) || 0 : 0);
    }, 0);
    const net = lines.reduce((s, { idx, line }) => s + (previews[idx]?.total !== undefined ? previews[idx].total - basicOf(line) : 0), 0);
    const t = terms[focus] || terms[0];
    return (
        <FinPopup title={title} onClose={onClose} width={900} footer={<span className="fin-popup-note">{productName}</span>}>
            <div className="fin-term-head">
                <span>Basic Value</span><input className="fin-box r" readOnly value={fmt(basic)} />
                <span className="ml-auto">Quantity</span><input className="fin-box r" readOnly value={qty.toFixed(3)} />
            </div>
            <table className="fin-grid">
                <thead><tr><th style={{ width: 44 }}>SNo.</th><th style={{ width: 50 }}>Apply</th><th>Description</th><th>SubLedger</th><th style={{ width: 56 }}>Basis</th><th className="r" style={{ width: 80 }}>%tage</th><th className="r">Amount</th><th className="r">Local Amount</th><th className="r">Calculated On</th></tr></thead>
                <tbody>
                    {terms.map((term, i) => {
                        const on = lines.filter(({ line }) => (line.billing_term_ids || []).includes(term.id)).length;
                        const all = on === lines.length && on > 0;
                        const amt = amountOf(term.id);
                        return (
                            <tr key={term.id} className={focus === i ? 'cur' : ''} onClick={() => setFocus(i)}>
                                <td className="c">{i + 1}</td>
                                <td className="c"><input type="checkbox" data-enter-skip="true" checked={all} ref={el => { if (el) el.indeterminate = on > 0 && !all; }} onFocus={() => setFocus(i)} onChange={() => onToggle(term.id)} /></td>
                                <td>{term.term_name} <span className="text-[10px] text-gray-500">{on > 0 && !all ? `(${on}/${lines.length} lines)` : ''}</span></td>
                                <td onClick={e => e.stopPropagation()}>{subLedgerCell ? subLedgerCell(term) : ''}</td>
                                <td className="c">{basisOf(term)}</td>
                                <td className="r">{term.rate_percentage ? fmt(term.rate_percentage) : ''}</td>
                                <td className="r">{on ? fmt(amt) : ''}</td>
                                <td className="r">{on ? fmt(amt) : ''}</td>
                                <td className="r">{fmt(basic)}</td>
                            </tr>
                        );
                    })}
                    {terms.length === 0 && <tr><td colSpan={9} className="c">No Billing Terms are set up for Purchase yet (Master Data › Billing Terms).</td></tr>}
                </tbody>
            </table>
            <div className="fin-term-info">
                <label>Net Term Amount</label><input className="fin-box r" readOnly value={fmt(net)} />
                <label>Term Code</label><input className="fin-box" readOnly value={t?.term_code || ''} />
                <div className="fin-term-meta">
                    <span>Ledger : <b>{t?.billing_ledger?.account_name || '—'}</b></span>
                    <span>Sign : <b>{t?.sign || '+'}</b></span>
                    <span>Formula To Calculate : <b>{formulaOf(t) || 'BV'}</b></span>
                    <span>Taxation Term : <b>{TAXATION[t?.tax_type] || 'None'}</b></span>
                </div>
            </div>
        </FinPopup>
    );
}

/**
 * summaryRows / overrides: the product-term totals of the lines (amount editable);
 * terms + billTermIds + preview: bill-level terms ticked on the document
 */
export function PurchaseOverallTermPopup({ title, summaryRows, overrides, onOverride, terms, billTermIds, onToggleBillTerm, preview, subLedgerCell, onClose }) {
    const termById = Object.fromEntries(terms.map(t => [t.id, t]));
    const prodTotal = summaryRows.reduce((s, r) => s + (overrides[r.billing_term_id] !== undefined ? Number(overrides[r.billing_term_id]) || 0 : r.original_total), 0);
    const billLines = preview?.lines || [];
    return (
        <FinPopup title={title} onClose={onClose} width={900}>
            <table className="fin-grid">
                <thead><tr><th style={{ width: 44 }}>SNo.</th><th>Term (product-wise, all lines)</th><th style={{ width: 56 }}>Basis</th><th style={{ width: 50 }}>Sign</th><th className="r" style={{ width: 90 }}>%tage</th><th className="r" style={{ width: 140 }}>Amount</th><th className="r" style={{ width: 130 }}>Local Amount</th></tr></thead>
                <tbody>
                    {summaryRows.map((r, i) => {
                        const t = termById[r.billing_term_id];
                        const v = overrides[r.billing_term_id] !== undefined ? overrides[r.billing_term_id] : Number(r.original_total).toFixed(2);
                        return (
                            <tr key={r.billing_term_id}>
                                <td className="c">{i + 1}</td>
                                <td>{r.term_name} <span className="text-[10px] text-gray-500">({r.term_code})</span></td>
                                <td className="c">{basisOf(t)}</td>
                                <td className="c">{t?.sign || '+'}</td>
                                <td className="r">{t?.rate_percentage ? fmt(t.rate_percentage) : ''}</td>
                                <td className="r"><input type="number" step="0.01" className="fin-cell r" value={v} onFocus={e => e.target.select()} onChange={e => onOverride(r.billing_term_id, e.target.value)} /></td>
                                <td className="r">{fmt(v)}</td>
                            </tr>
                        );
                    })}
                    {summaryRows.length === 0 && <tr><td colSpan={7} className="c">No product terms on the lines - use Product Term.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={5} className="r">Product terms total</td><td className="r">{fmt(prodTotal)}</td><td className="r">{fmt(prodTotal)}</td></tr></tfoot>
            </table>
            <p className="fin-popup-note mt-1 mb-3">An amount changed here is shared back to the lines that carry the term, each keeping its share.</p>
            <table className="fin-grid">
                <thead><tr><th style={{ width: 44 }}>SNo.</th><th style={{ width: 50 }}>Apply</th><th>Bill Term (on the bill total)</th><th>SubLedger</th><th style={{ width: 56 }}>Basis</th><th style={{ width: 50 }}>Sign</th><th className="r" style={{ width: 90 }}>%tage</th><th className="r" style={{ width: 130 }}>Amount</th></tr></thead>
                <tbody>
                    {terms.map((t, i) => {
                        const on = billTermIds.includes(t.id);
                        const line = on ? billLines.find(l => l.term_code === t.term_code) : null;
                        return (
                            <tr key={t.id}>
                                <td className="c">{i + 1}</td>
                                <td className="c"><input type="checkbox" data-enter-skip="true" checked={on} onChange={() => onToggleBillTerm(t.id)} /></td>
                                <td>{t.term_name} <span className="text-[10px] text-gray-500">({t.term_code})</span></td>
                                <td>{subLedgerCell ? subLedgerCell(t) : ''}</td>
                                <td className="c">{basisOf(t)}</td>
                                <td className="c">{t.sign || '+'}</td>
                                <td className="r">{t.rate_percentage ? fmt(t.rate_percentage) : ''}</td>
                                <td className="r">{line ? (line.free_quantity !== undefined ? `+${line.free_quantity} free` : fmt(line.amount)) : ''}</td>
                            </tr>
                        );
                    })}
                    {terms.length === 0 && <tr><td colSpan={8} className="c">No Billing Terms are set up for Purchase yet.</td></tr>}
                </tbody>
                {preview && <tfoot><tr><td colSpan={7} className="r">Final total (lines + bill terms)</td><td className="r">{fmt(preview.total)}</td></tr></tfoot>}
            </table>
        </FinPopup>
    );
}
