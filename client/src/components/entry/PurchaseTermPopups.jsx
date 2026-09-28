// =============================================
// components/entry/PurchaseTermPopups.jsx
// Charge pop-ups of the purchase entries (Requisition, Quotation, Order,
// GRN, Bill, Return, Non-saleable Return). Purchase lines carry
// billing_term_ids (Billing Term setup) that the server works out, so here a
// charge is switched on or off; amounts come from /billing-terms/preview.
//   * PurchaseProductTermPopup - Item Charges of the chosen line(s): use,
//     charge, sub-ledger, how it is worked out, rate, amount, and the code /
//     ledger / effect / tax type of the charge in focus
//   * PurchaseOverallTermPopup - Charges Summary: item-charge totals (an
//     amount typed here is split over the lines by the charge's basis -
//     value or quantity - as set in Billing Term) and the bill charges with
//     their preview
// =============================================
import React, { useState } from 'react';
import { EntryPopup } from './EntryParts';
import { allowedKinds } from './lineCalc';

const fmt = n => (Number(n) || 0).toFixed(2);
const HOW = { fixed_amount: 'Fixed', formula: 'Formula', free_quantity: 'Free qty', percentage: 'Value %', both: 'Value % + fixed' };
const howOf = t => HOW[t?.calculation_mode] || 'Value %';
const formulaOf = t => (!t ? '' : t.calculation_mode === 'formula' ? t.formula_expression : t.base_reference_term ? `after ${t.base_reference_term.term_code}` : 'Item value');
const TAXATION = { vat: 'VAT', excise: 'Excise', discount: 'Cash Discount', none: 'None' };
const splitOf = t => (t?.basis === 'quantity' ? 'Quantity' : 'Value');
const KIND_COLS = [['pct', '%'], ['rate', 'Rate / qty'], ['amt', 'Amount']];
/** the value typed for a charge on the lines: shown when every line holds the same input */
const typedOf = (lines, termId, kind) => {
    const vals = lines.map(({ line }) => (line.term_values || {})[termId]).map(x => (x && x.kind === kind ? String(x.value) : ''));
    return vals.every(v => v === vals[0]) ? vals[0] : '';
};
const Adds = ({ sign }) => <span className={sign === '-' ? 'ent-less' : 'ent-add'}>{sign === '-' ? 'Less' : 'Add'}</span>;

/**
 * lines: [{ idx, line }] the target lines; previews: lineTermPreviews (by line index);
 * subLedgerCell(term): node for the Sub-ledger column (TermLedgerInfo);
 * lineFields: the line's own Discount % / Tax % when they are not grid columns ({ key, label, sign, value, onChange })
 * onInput(termId, kind, value): a % / rate per qty / amount typed for a charge (kinds allowed by the Billing
 * Term; nothing can be typed for a charge that may not be changed in entries)
 */
export function PurchaseProductTermPopup({ title, lines, terms, previews, productName, onToggle, onInput, subLedgerCell, onClose, lineFields }) {
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
        <EntryPopup title={title} onClose={onClose} width={940}>
            <div className="ent-item-strip">
                <div><small>Item</small><b>{productName || '—'}</b></div>
                <div><small>Quantity</small><b>{qty.toFixed(3)}</b></div>
                <div><small>Value</small><b>{fmt(basic)}</b></div>
                <div><small>Charges</small><b className={net < 0 ? 'ent-less' : ''}>{fmt(net)}</b></div>
                <div><small>After charges</small><b>{fmt(basic + net)}</b></div>
            </div>
            <div className="ent-charge-wrap">
                <table className="erp-grid-table ent-charge-table">
                    <thead><tr><th style={{ width: 34 }}>#</th><th style={{ width: 44 }}>Use</th><th>Charge</th><th>Sub-ledger</th><th style={{ width: 90 }}>Worked as</th><th style={{ width: 56 }}>+/-</th>{KIND_COLS.map(([k, l]) => <th key={k} className="text-right" style={{ width: 80 }}>{l}</th>)}<th className="text-right">Amount</th></tr></thead>
                    <tbody>
                        {(lineFields || []).map(fl => (
                            <tr key={fl.key} className="ent-line-field">
                                <td>•</td><td /><td>{fl.label}</td><td /><td>Value %</td><td><Adds sign={fl.sign} /></td>
                                <td className="text-right"><input type="number" step="0.01" className="erp-input text-right" style={{ height: 24 }} value={fl.value} onFocus={e => e.target.select()} onChange={e => fl.onChange(e.target.value)} /></td>
                                <td /><td />
                                <td className="text-right">{lines.length > 1 ? `${lines.length} lines` : ''}</td>
                            </tr>
                        ))}
                        {terms.map((term, i) => {
                            const on = lines.filter(({ line }) => (line.billing_term_ids || []).includes(term.id)).length;
                            const all = on === lines.length && on > 0;
                            return (
                                <tr key={term.id} className={focus === i ? 'ent-focus' : ''} onClick={() => setFocus(i)}>
                                    <td>{i + 1}</td>
                                    <td className="text-center"><input type="checkbox" data-enter-skip="true" checked={all} ref={el => { if (el) el.indeterminate = on > 0 && !all; }} onFocus={() => setFocus(i)} onChange={() => onToggle(term.id)} /></td>
                                    <td>{term.term_name} {on > 0 && !all && <span className="text-[10px] text-gray-500">({on}/{lines.length} lines)</span>}</td>
                                    <td onClick={e => e.stopPropagation()}>{subLedgerCell ? subLedgerCell(term) : ''}</td>
                                    <td>{howOf(term)}{term.manual_override === false && <span className="text-[10px] text-gray-500"> (fixed)</span>}</td>
                                    <td><Adds sign={term.sign} /></td>
                                    {KIND_COLS.map(([k]) => {
                                        const can = onInput && term.manual_override !== false && allowedKinds(term.entry_input_mode).includes(k);
                                        return (
                                            <td key={k} className="text-right" onClick={e => e.stopPropagation()}>
                                                {can ? <input type="number" step="0.01" className="erp-input text-right" style={{ height: 24 }} value={typedOf(lines, term.id, k)}
                                                    placeholder={k === 'pct' && term.rate_percentage ? fmt(term.rate_percentage) : ''}
                                                    onFocus={e => { setFocus(i); e.target.select(); }} onChange={e => onInput(term.id, k, e.target.value)} />
                                                    : <span className="text-gray-400">{k === 'pct' && term.rate_percentage ? fmt(term.rate_percentage) : ''}</span>}
                                            </td>
                                        );
                                    })}
                                    <td className="text-right font-semibold">{on ? fmt(amountOf(term.id)) : ''}</td>
                                </tr>
                            );
                        })}
                        {terms.length === 0 && <tr><td colSpan={10} className="text-center">No purchase charges are set up yet (Master Data › Billing Terms).</td></tr>}
                    </tbody>
                </table>
                <aside className="ent-charge-info">
                    <div className="ent-info-title">{t?.term_name || 'Charge'}</div>
                    <dl>
                        <dt>Code</dt><dd>{t?.term_code || '—'}</dd>
                        <dt>Posts to</dt><dd>{t?.billing_ledger?.account_name || '—'}</dd>
                        <dt>Effect</dt><dd>{t?.sign === '-' ? 'Less from value' : 'Add to value'}</dd>
                        <dt>Worked on</dt><dd>{formulaOf(t) || 'Item value'}</dd>
                        <dt>Split by</dt><dd>{splitOf(t)}</dd>
                        <dt>Tax type</dt><dd>{TAXATION[t?.tax_type] || 'None'}</dd>
                    </dl>
                </aside>
            </div>
        </EntryPopup>
    );
}

/**
 * summaryRows / overrides: the item-charge totals of the lines (amount editable, split by the charge's basis);
 * terms + billTermIds + preview: bill charges ticked on the document
 */
export function PurchaseOverallTermPopup({ title, summaryRows, overrides, onOverride, terms, billTermIds, onToggleBillTerm, preview, subLedgerCell, onClose }) {
    const termById = Object.fromEntries(terms.map(t => [t.id, t]));
    // charges set (Billing Term) not to show in the Charges Summary stay out of it
    summaryRows = summaryRows.filter(r => termById[r.billing_term_id]?.show_in_term_summary !== false);
    const prodTotal = summaryRows.reduce((s, r) => s + (overrides[r.billing_term_id] !== undefined ? Number(overrides[r.billing_term_id]) || 0 : r.original_total), 0);
    const billLines = preview?.lines || [];
    return (
        <EntryPopup title={title} onClose={onClose} width={900}>
            <div className="ent-section-title">Item charges (all lines)</div>
            <table className="erp-grid-table">
                <thead><tr><th style={{ width: 34 }}>#</th><th>Charge</th><th style={{ width: 100 }}>Split by</th><th style={{ width: 56 }}>+/-</th><th className="text-right" style={{ width: 90 }}>Rate</th><th className="text-right" style={{ width: 160 }}>Amount</th></tr></thead>
                <tbody>
                    {summaryRows.map((r, i) => {
                        const t = termById[r.billing_term_id];
                        const v = overrides[r.billing_term_id] !== undefined ? overrides[r.billing_term_id] : Number(r.original_total).toFixed(2);
                        return (
                            <tr key={r.billing_term_id}>
                                <td>{i + 1}</td>
                                <td>{r.term_name} <span className="text-[10px] text-gray-500">({r.term_code})</span></td>
                                <td>{splitOf(t)}</td>
                                <td><Adds sign={t?.sign} /></td>
                                <td className="text-right">{t?.rate_percentage ? fmt(t.rate_percentage) : ''}</td>
                                <td className="text-right">{t?.manual_override === false ? fmt(v)
                                    : <input type="number" step="0.01" className="erp-input text-right" style={{ height: 24 }} value={v} onFocus={e => e.target.select()} onChange={e => onOverride(r.billing_term_id, e.target.value)} />}</td>
                            </tr>
                        );
                    })}
                    {summaryRows.length === 0 && <tr><td colSpan={6} className="text-center">No item charges on the lines yet - use Item Charges.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={5} className="text-right">Item charges total</td><td className="text-right">{fmt(prodTotal)}</td></tr></tfoot>
            </table>
            <p className="ent-note mt-1 mb-3">An amount changed here is split over the lines that carry the charge, by value or by quantity as set on the charge (Billing Term).</p>
            <div className="ent-section-title">Bill charges (on the bill total)</div>
            <table className="erp-grid-table">
                <thead><tr><th style={{ width: 34 }}>#</th><th style={{ width: 44 }}>Use</th><th>Charge</th><th>Sub-ledger</th><th style={{ width: 90 }}>Worked as</th><th style={{ width: 56 }}>+/-</th><th className="text-right" style={{ width: 80 }}>Rate</th><th className="text-right" style={{ width: 130 }}>Amount</th></tr></thead>
                <tbody>
                    {terms.map((t, i) => {
                        const on = billTermIds.includes(t.id);
                        const line = on ? billLines.find(l => l.term_code === t.term_code) : null;
                        return (
                            <tr key={t.id}>
                                <td>{i + 1}</td>
                                <td className="text-center"><input type="checkbox" data-enter-skip="true" checked={on} onChange={() => onToggleBillTerm(t.id)} /></td>
                                <td>{t.term_name} <span className="text-[10px] text-gray-500">({t.term_code})</span></td>
                                <td>{subLedgerCell ? subLedgerCell(t) : ''}</td>
                                <td>{howOf(t)}</td>
                                <td><Adds sign={t.sign} /></td>
                                <td className="text-right">{t.rate_percentage ? fmt(t.rate_percentage) : ''}</td>
                                <td className="text-right">{line ? (line.free_quantity !== undefined ? `+${line.free_quantity} free` : fmt(line.amount)) : ''}</td>
                            </tr>
                        );
                    })}
                    {terms.length === 0 && <tr><td colSpan={8} className="text-center">No purchase charges are set up yet.</td></tr>}
                </tbody>
                {preview && <tfoot><tr><td colSpan={7} className="text-right">Bill total after bill charges</td><td className="text-right">{fmt(preview.total)}</td></tr></tfoot>}
            </table>
        </EntryPopup>
    );
}
