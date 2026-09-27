// =============================================
// components/entry/FinEntry.jsx
// The parts every sales / purchase entry shares, laid out like FinPro:
//   * EntryFooter   - Product Term / Bill Term buttons, Bill Term and Net
//                     Amount, Remarks, Number in Words, Other Details and
//                     Billing / Taxation popups, Hold / Ok / Cancel, the
//                     [F7] / [F8] hint and the taxable / tax / credit-limit
//                     status line
//   * TermPopup     - "<Entry> (Product wise)": the terms of one line with
//                     basis, %, amount, calculated-on and the ledger / sign /
//                     formula of the focused term
//   * OverallTermPopup - "<Entry> Over All Term(s)": every term of the bill
//                     with its total; a % or amount typed here goes to the
//                     lines
//   * amountInWords - "Nrs. One Lakh Twenty Thousand Only" (lakh / crore)
//   * useEntryHotkeys - F7 copy previous entry, F8 resume held entry
// =============================================
import React, { useEffect, useRef, useState } from 'react';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const upto99 = n => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const upto999 = n => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', upto99(n % 100)].filter(Boolean).join(' ');

/** whole number in words, Nepali grouping: crore, lakh, thousand, hundred */
function wordsOf(n) {
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 10000000);
    const rest = n % 10000000;
    if (crore) parts.push(`${wordsOf(crore)} Crore`);
    const lakh = Math.floor(rest / 100000);
    const thousand = Math.floor((rest % 100000) / 1000);
    const hundreds = rest % 1000;
    if (lakh) parts.push(`${upto99(lakh)} Lakh`);
    if (thousand) parts.push(`${upto99(thousand)} Thousand`);
    if (hundreds) parts.push(upto999(hundreds));
    return parts.join(' ');
}

export function amountInWords(value, currency = 'Nrs.') {
    const v = Math.round(Math.abs(Number(value) || 0) * 100);
    const rupees = Math.floor(v / 100);
    const paisa = v % 100;
    if (!rupees && !paisa) return '';
    return `${currency} ${Number(value) < 0 ? 'Minus ' : ''}${wordsOf(rupees)}${paisa ? ` and ${upto99(paisa)} Paisa` : ''} Only.`;
}

const fmt = n => (Number(n) || 0).toFixed(2);

/** F7 / F8 / F9 while the entry form is open */
export function useEntryHotkeys(active, keys) {
    const ref = useRef(keys);
    ref.current = keys;
    useEffect(() => {
        if (!active) return undefined;
        const onKey = e => {
            const fn = ref.current[e.key];
            if (!fn) return;
            e.preventDefault();
            fn();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active]);
}

/** newest entry of a list (for F7 "copy previous data") */
export const latestOf = rows => [...(rows || [])].sort((a, b) => String(b.created_at || b.doc_date || '').localeCompare(String(a.created_at || a.doc_date || '')))[0] || null;

/** FinPro pop-up window: dark title bar with the entry name, body, Ok at the bottom right */
export function FinPopup({ title, onClose, children, width = 820, footer, hidden }) {
    useEffect(() => {
        if (hidden) return undefined;
        const esc = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [hidden, onClose]);
    return (
        <div className={`fin-popup-back ${hidden ? 'hidden' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="fin-popup" style={{ width: `min(${width}px, 96vw)` }} data-enter-scope>
                <div className="fin-popup-title">
                    <span className="fin-popup-logo">A</span><span>{title}</span>
                    <button type="button" className="fin-popup-x" onClick={onClose} title="Close (Esc)">✕</button>
                </div>
                <div className="fin-popup-body">{children}</div>
                <div className="fin-popup-foot">{footer}<button type="button" className="fin-ok" onClick={onClose}>✔ Ok</button></div>
            </div>
        </div>
    );
}

/**
 * The terms of one line.
 * rows: [{ key, description, basis ('V' value | 'Q' quantity), sign ('+' | '-'), percent, amount, calculatedOn,
 *          termCode, ledgerName, formula, taxation, subLedger (node, optional), editable }]
 */
export function TermPopup({ title, productName, basic, qty, unitName, rows, onPercent, onBasis, onClose }) {
    const [focus, setFocus] = useState(0);
    const f = rows[focus] || rows[0] || {};
    const net = rows.reduce((s, r) => s + (r.sign === '-' ? -1 : 1) * (Number(r.amount) || 0), 0);
    const withSub = rows.some(r => r.subLedger);
    return (
        <FinPopup title={title} onClose={onClose} footer={<span className="fin-popup-note">{productName}</span>}>
            <div className="fin-term-head">
                <span>Basic Value</span><input className="fin-box r" readOnly value={fmt(basic)} />
                <span className="fin-unit">{unitName}</span>
                <span className="ml-auto">Quantity</span><input className="fin-box r" readOnly value={Number(qty || 0).toFixed(3)} />
            </div>
            <table className="fin-grid">
                <thead><tr><th style={{ width: 44 }}>SNo.</th><th>Description</th>{withSub && <th>SubLedger</th>}<th style={{ width: 70 }}>Basis</th><th style={{ width: 90 }} className="r">%tage</th><th className="r">Amount</th><th className="r">Local Amount</th><th className="r">Calculated On</th></tr></thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={r.key} className={focus === i ? 'cur' : ''} onFocus={() => setFocus(i)} onClick={() => setFocus(i)}>
                            <td className="c">{i + 1}</td>
                            <td>{r.description}</td>
                            {withSub && <td>{r.subLedger || ''}</td>}
                            <td>{onBasis && r.editable !== false
                                ? <select className="fin-cell" value={r.basis || 'V'} onChange={e => onBasis(r.key, e.target.value)}><option value="V">V</option><option value="Q">Q</option></select>
                                : (r.basis || 'V')}</td>
                            <td className="r">{r.editable === false ? fmt(r.percent) : (
                                <input type="number" step="0.01" className="fin-cell r" value={r.percent === '' || r.percent === undefined || r.percent === null ? '' : r.percent}
                                    onFocus={e => { setFocus(i); e.target.select(); }} onChange={e => onPercent(r.key, e.target.value)} />
                            )}</td>
                            <td className="r">{fmt(r.amount)}</td>
                            <td className="r">{fmt(r.amount)}</td>
                            <td className="r">{fmt(r.calculatedOn)}</td>
                        </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={withSub ? 8 : 7} className="c">No product terms are set for this entry (System Control › Term Mapping / Billing Terms).</td></tr>}
                </tbody>
            </table>
            <div className="fin-term-info">
                <label>Net Term Amount</label><input className="fin-box r" readOnly value={fmt(net)} />
                <label>Term Code</label><input className="fin-box" readOnly value={f.termCode || ''} />
                <div className="fin-term-meta">
                    <span>Ledger : <b>{f.ledgerName || '—'}</b></span>
                    <span>Sign : <b>{f.sign || '+'}</b></span>
                    <span>Formula To Calculate : <b>{f.formula || 'BV'}</b></span>
                    <span>Taxation Term : <b>{f.taxation || 'None'}</b></span>
                </div>
            </div>
        </FinPopup>
    );
}

/**
 * Every term of the bill with its total.
 * rows: [{ key, term, basis, sign, percent, amount, editable }]
 */
export function OverallTermPopup({ title, rows, onPercent, onAmount, onClose, note, extra }) {
    const total = rows.reduce((s, r) => s + (r.sign === '-' ? -1 : 1) * (Number(r.amount) || 0), 0);
    return (
        <FinPopup title={title} onClose={onClose} footer={note ? <span className="fin-popup-note">{note}</span> : null}>
            {extra}
            <table className="fin-grid">
                <thead><tr><th style={{ width: 44 }}>SNo.</th><th>Term</th><th style={{ width: 56 }}>Basis</th><th style={{ width: 50 }}>Sign</th><th style={{ width: 100 }} className="r">%tage</th><th style={{ width: 130 }} className="r">Amount</th><th style={{ width: 130 }} className="r">Local Amount</th></tr></thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={r.key}>
                            <td className="c">{i + 1}</td>
                            <td>{r.term}</td>
                            <td className="c">{r.basis || 'V'}</td>
                            <td className="c">{r.sign || '+'}</td>
                            <td className="r">{onPercent && r.editable !== false
                                ? <input type="number" step="0.01" className="fin-cell r" placeholder={r.mixed ? 'mixed' : ''} value={r.percent ?? ''} onFocus={e => e.target.select()} onChange={e => onPercent(r.key, e.target.value)} />
                                : (r.percent === '' || r.percent === null || r.percent === undefined ? '' : fmt(r.percent))}</td>
                            <td className="r">{onAmount && r.editable !== false
                                ? <input type="number" step="0.01" className="fin-cell r" value={r.amountInput ?? fmt(r.amount)} onFocus={e => e.target.select()} onChange={e => onAmount(r.key, e.target.value)} />
                                : fmt(r.amount)}</td>
                            <td className="r">{fmt(r.amount)}</td>
                        </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={7} className="c">No terms on this bill.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={5} /><td className="r">{fmt(total)}</td><td className="r">{fmt(total)}</td></tr></tfoot>
            </table>
        </FinPopup>
    );
}

/**
 * <EntryFooter warehouseName totals={{ billTerm, net, taxable, tax, nonTaxable }} party={{ label, name, creditLimit }}
 *     remarks={{ value, onChange, options }} onProductTerm onBillTerm panels={[{ key, label, content }]} actions={<>…</>} />
 * Panels (Other Details, Billing / Taxation ...) open as pop-ups; they stay mounted so party details
 * still fill in from the ledger while closed.
 */
export function EntryFooter({ warehouseName, totals, party, remarks, onProductTerm, onBillTerm, panels = [], actions, hints = ['[F7]: copy previous data', '[F8]: resume hold data'], title = 'Entry', extraButtons }) {
    const [open, setOpen] = useState(null);
    const listId = useRef(`rmk-${Math.random().toString(36).slice(2, 8)}`).current;
    return (
        <div className="fin-footer">
            {warehouseName !== undefined && (
                <div className="fin-row"><label>Warehouse Name</label><input className="fin-box wide" readOnly value={warehouseName || ''} /></div>
            )}
            <div className="fin-row">
                {onProductTerm && <button type="button" className="fin-btn" onClick={onProductTerm}>◉ Product Term</button>}
                {onBillTerm && <button type="button" className="fin-btn" onClick={onBillTerm}>◉ Bill Term</button>}
                <span className="fin-cap">Bill Term Amount in (Nrs)&gt;</span><input className="fin-box r" readOnly value={fmt(totals.billTerm)} />
                <span className="fin-cap ml-auto">Net Amount in (Nrs)&gt;</span><input className="fin-box r strong" readOnly value={fmt(totals.net)} />
            </div>
            <div className="fin-block">
                {remarks && (
                    <div className="fin-row"><label>Remarks</label>
                        <input className="fin-box wide edit" list={listId} value={remarks.value || ''} onChange={e => remarks.onChange(e.target.value)} placeholder="Type, or pick a saved remark" />
                        <datalist id={listId}>{(remarks.options || []).map(r => <option key={r} value={r} />)}</datalist>
                    </div>
                )}
                <div className="fin-row"><label>Number in Words</label><input className="fin-box wide words" readOnly value={amountInWords(totals.net)} /></div>
            </div>
            <div className="fin-row fin-actions">
                {panels.map(p => <button key={p.key} type="button" className="fin-btn" onClick={() => setOpen(p.key)}>◉ {p.label}</button>)}
                {extraButtons}
                <div className="ml-auto flex items-center gap-2 flex-wrap">{actions}</div>
            </div>
            <div className="fin-hint">{hints.map(h => <span key={h}><b>{h.split(':')[0]}</b>:{h.split(':').slice(1).join(':')}</span>)}</div>
            <div className="fin-status">
                <span>Taxable Amt : <b>{fmt(totals.taxable)}</b></span>
                <span>Tax : <b>{fmt(totals.tax)}</b></span>
                <span>Non Taxable Amt : <b>{fmt(totals.nonTaxable)}</b></span>
                {party && <span>Cr.Limit : <b>{party.creditLimit ? fmt(party.creditLimit) : '—'}</b></span>}
                {party && <span>{party.label} : <b>{party.name || '—'}</b></span>}
            </div>
            {panels.map(p => (
                <FinPopup key={p.key} title={`${title} - ${p.label}`} hidden={open !== p.key} onClose={() => setOpen(null)} width={p.width || 980}>{p.content}</FinPopup>
            ))}
        </div>
    );
}
