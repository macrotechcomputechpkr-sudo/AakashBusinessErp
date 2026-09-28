// =============================================
// components/entry/EntryParts.jsx
// The parts every sales / purchase entry shares (Aakash ERP's own layout):
//   * EntryFooter      - left: remarks, amount in words, extra rows and the
//                        Item Charges / Bill Charges / More Info / Party & Tax
//                        buttons; right: the bill summary box (gross,
//                        charges +/-, bill amount, taxable / tax / tax-free,
//                        credit limit); bottom: key hints and Hold / Save /
//                        Cancel
//   * ChargePopup      - "Item Charges" of one line: charge, value / qty
//                        basis, rate %, base amount, amount, and the code /
//                        ledger / adds-less / formula / tax type of the
//                        charge in focus
//   * ChargeSummaryPopup - "Charges Summary" of the bill: a % or amount typed
//                        here is split over the lines by the charge's own
//                        basis (value or quantity, Billing Term setup)
//   * amountInWords    - "Rupees One Lakh Twenty Thousand only" (lakh / crore)
//   * useEntryHotkeys  - F7 copy the last entry
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

export function amountInWords(value, currency = 'Rupees') {
    const v = Math.round(Math.abs(Number(value) || 0) * 100);
    const rupees = Math.floor(v / 100);
    const paisa = v % 100;
    if (!rupees && !paisa) return '';
    return `${currency} ${Number(value) < 0 ? 'Minus ' : ''}${wordsOf(rupees)}${paisa ? ` and ${upto99(paisa)} Paisa` : ''} only`;
}

const fmt = n => (Number(n) || 0).toFixed(2);

/** F7 / F9 while the entry form is open */
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

/** newest entry of a list (F7: copy the last entry) */
export const latestOf = rows => [...(rows || [])].sort((a, b) => String(b.created_at || b.doc_date || '').localeCompare(String(a.created_at || a.doc_date || '')))[0] || null;

/** pop-up window of an entry: title bar, body, Done at the bottom right */
export function EntryPopup({ title, onClose, children, width = 820, footer, hidden }) {
    useEffect(() => {
        if (hidden) return undefined;
        const esc = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [hidden, onClose]);
    return (
        <div className={`ent-popup-back ${hidden ? 'hidden' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="ent-popup" style={{ width: `min(${width}px, 96vw)` }} data-enter-scope>
                <div className="ent-popup-title">
                    <span>{title}</span>
                    <button type="button" className="nav-wc-btn close" onClick={onClose} title="Close (Esc)">✕</button>
                </div>
                <div className="ent-popup-body">{children}</div>
                <div className="ent-popup-foot">{footer}<button type="button" className="nav-btn primary ml-auto" onClick={onClose}>Done</button></div>
            </div>
        </div>
    );
}

const Adds = ({ sign }) => <span className={sign === '-' ? 'ent-less' : 'ent-add'}>{sign === '-' ? 'Less' : 'Add'}</span>;

const KIND_COLS = [['pct', '%'], ['rate', 'Rate / qty'], ['amt', 'Amount']];

/**
 * Item Charges of one line.
 * rows: [{ key, description, sign ('+' | '-'), kinds (inputs allowed: 'pct' % of value, 'rate' rate x qty,
 *          'amt' amount), kind + value (what the line holds), amount, calculatedOn, termCode, ledgerName,
 *          formula, taxation, subLedger (optional), editable (false: cannot be changed in entries) }]
 * onInput(key, kind, value)
 */
export function TermPopup({ title, productName, basic, qty, unitName, rows, onInput, onClose }) {
    const [focus, setFocus] = useState(0);
    const f = rows[focus] || rows[0] || {};
    const net = rows.reduce((s, r) => s + (r.sign === '-' ? -1 : 1) * (Number(r.amount) || 0), 0);
    const withSub = rows.some(r => r.subLedger);
    const blank = v => v === '' || v === undefined || v === null;
    return (
        <EntryPopup title={title} onClose={onClose} width={900}>
            <div className="ent-item-strip">
                <div><small>Item</small><b>{productName || '—'}</b></div>
                <div><small>Quantity</small><b>{Number(qty || 0).toFixed(3)} {unitName}</b></div>
                <div><small>Value</small><b>{fmt(basic)}</b></div>
                <div><small>Charges</small><b className={net < 0 ? 'ent-less' : ''}>{fmt(net)}</b></div>
                <div><small>After charges</small><b>{fmt(Number(basic || 0) + net)}</b></div>
            </div>
            <div className="ent-charge-wrap">
                <table className="erp-grid-table ent-charge-table">
                    <thead><tr><th style={{ width: 34 }}>#</th><th>Charge</th>{withSub && <th>Sub-ledger</th>}<th style={{ width: 56 }}>+/-</th>{KIND_COLS.map(([k, l]) => <th key={k} className="text-right" style={{ width: 84 }}>{l}</th>)}<th className="text-right">Base Amount</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={r.key} className={focus === i ? 'ent-focus' : ''} onFocus={() => setFocus(i)} onClick={() => setFocus(i)}>
                                <td>{i + 1}</td>
                                <td>{r.description}{r.editable === false && <span className="text-[10px] text-gray-500"> (fixed)</span>}</td>
                                {withSub && <td>{r.subLedger || ''}</td>}
                                <td><Adds sign={r.sign} /></td>
                                {KIND_COLS.map(([k]) => {
                                    const mine = (r.kind || 'pct') === k;
                                    const can = onInput && r.editable !== false && (r.kinds || ['pct']).includes(k);
                                    return (
                                        <td key={k} className="text-right">{can
                                            ? <input type="number" step="0.01" className="erp-input text-right" style={{ height: 24 }} value={mine && !blank(r.value) ? r.value : ''}
                                                onFocus={e => { setFocus(i); e.target.select(); }} onChange={e => onInput(r.key, k, e.target.value)} />
                                            : (mine && !blank(r.value) ? fmt(r.value) : '')}</td>
                                    );
                                })}
                                <td className="text-right">{fmt(r.calculatedOn)}</td>
                                <td className="text-right font-semibold">{fmt(r.amount)}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={withSub ? 9 : 8} className="text-center">No charges are set for this entry (System Control › Term Mapping / Billing Terms).</td></tr>}
                    </tbody>
                </table>
                <aside className="ent-charge-info">
                    <div className="ent-info-title">{f.description || 'Charge'}</div>
                    <dl>
                        <dt>Code</dt><dd>{f.termCode || '—'}</dd>
                        <dt>Posts to</dt><dd>{f.ledgerName || '—'}</dd>
                        <dt>Effect</dt><dd>{f.sign === '-' ? 'Less from value' : 'Add to value'}</dd>
                        <dt>Worked on</dt><dd>{f.formula || 'Item value'}</dd>
                        <dt>Tax type</dt><dd>{f.taxation || 'None'}</dd>
                        <dt>Typed as</dt><dd>{(f.kinds || ['pct']).map(k => KIND_COLS.find(x => x[0] === k)[1]).join(', ')}</dd>
                    </dl>
                </aside>
            </div>
        </EntryPopup>
    );
}

/**
 * Charges Summary of the bill.
 * rows: [{ key, term, basis ('V' | 'Q' - how an amount typed here is split), sign, percent, amount, editable }]
 */
export function OverallTermPopup({ title, rows, onPercent, onAmount, onClose, note, extra }) {
    const total = rows.reduce((s, r) => s + (r.sign === '-' ? -1 : 1) * (Number(r.amount) || 0), 0);
    return (
        <EntryPopup title={title} onClose={onClose} footer={note ? <span className="ent-note">{note}</span> : null}>
            {extra}
            <table className="erp-grid-table">
                <thead><tr><th style={{ width: 34 }}>#</th><th>Charge</th><th style={{ width: 110 }}>Split by</th><th style={{ width: 56 }}>+/-</th><th className="text-right" style={{ width: 110 }}>Rate %</th><th className="text-right" style={{ width: 150 }}>Amount</th></tr></thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={r.key}>
                            <td>{i + 1}</td>
                            <td>{r.term}</td>
                            <td>{r.basis === 'Q' ? 'Quantity' : 'Value'}</td>
                            <td><Adds sign={r.sign} /></td>
                            <td className="text-right">{onPercent && r.editable !== false && r.pctOk !== false
                                ? <input type="number" step="0.01" className="erp-input text-right" style={{ height: 24 }} placeholder={r.mixed ? 'differs' : ''} value={r.percent ?? ''} onFocus={e => e.target.select()} onChange={e => onPercent(r.key, e.target.value)} />
                                : (r.percent === '' || r.percent === null || r.percent === undefined ? '' : fmt(r.percent))}</td>
                            <td className="text-right">{onAmount && r.editable !== false && r.amtOk !== false
                                ? <input type="number" step="0.01" className="erp-input text-right" style={{ height: 24 }} value={r.amountInput ?? fmt(r.amount)} onFocus={e => e.target.select()} onChange={e => onAmount(r.key, e.target.value)} />
                                : fmt(r.amount)}</td>
                        </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={6} className="text-center">No charges on this bill.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={5} className="text-right">Net charges</td><td className="text-right">{fmt(total)}</td></tr></tfoot>
            </table>
        </EntryPopup>
    );
}

/**
 * <EntryFooter totals={{ gross, billTerm, net, taxable, tax, nonTaxable }} party={{ label, name, creditLimit }}
 *     remarks={{ value, onChange, options }} onProductTerm onBillTerm panels={[{ key, label, content, buttons }]} actions={<>…</>} />
 * Panels (More Info, Party & Tax Info ...) open as pop-ups; they stay mounted so party details
 * still fill in from the ledger while closed. A panel may have several buttons ({ label, onClick }),
 * e.g. one pop-up of tabs opened on different tabs. children: more rows under Amount in Words.
 */
export function EntryFooter({ warehouseName, totals, party, remarks, onProductTerm, onBillTerm, panels = [], actions, hints = ['F7 copy the last entry', 'Esc closes a pop-up'], title = 'Entry', extraButtons, children }) {
    const [open, setOpen] = useState(null);
    const listId = useRef(`rmk-${Math.random().toString(36).slice(2, 8)}`).current;
    const charges = Number(totals.net || 0) - Number(totals.gross ?? totals.net ?? 0);
    return (
        <div className="ent-footer">
            <div className="ent-footer-main">
                <div className="ent-footer-left">
                    {remarks && (
                        <div className="ent-frow"><label>Remarks</label>
                            <input className="erp-input" list={listId} value={remarks.value || ''} onChange={e => remarks.onChange(e.target.value)} placeholder="Type, or pick a saved remark" />
                            <datalist id={listId}>{(remarks.options || []).map(r => <option key={r} value={r} />)}</datalist>
                        </div>
                    )}
                    {children}
                    {warehouseName !== undefined && <div className="ent-frow"><label>Warehouse</label><span className="ent-ro">{warehouseName || '—'}</span></div>}
                    <div className="ent-frow"><label>In words</label><span className="ent-words">{amountInWords(totals.net) || '—'}</span></div>
                    <div className="ent-fbtns">
                        {onProductTerm && <button type="button" className="nav-btn small" onClick={onProductTerm}>🧾 Item Charges</button>}
                        {onBillTerm && <button type="button" className="nav-btn small" onClick={onBillTerm}>Σ Bill Charges</button>}
                        {panels.flatMap(p => (p.buttons || [{ label: p.label }]).map(b => (
                            <button key={`${p.key}-${b.label}`} type="button" className="nav-btn small" onClick={() => { if (b.onClick) b.onClick(); setOpen(p.key); }}>{b.label}</button>
                        )))}
                        {extraButtons}
                    </div>
                </div>
                <div className="ent-summary">
                    <div className="ent-srow"><span>Gross</span><b>{fmt(totals.gross ?? totals.net)}</b></div>
                    <div className="ent-srow"><span>Charges {charges < 0 ? '(less)' : '(add)'}</span><b className={charges < 0 ? 'ent-less' : ''}>{fmt(charges)}</b></div>
                    {Number(totals.billTerm) !== 0 && Math.abs(Number(totals.billTerm) - charges) > 0.005 && <div className="ent-srow sub"><span>of which bill charges</span><b>{fmt(totals.billTerm)}</b></div>}
                    <div className="ent-srow total"><span>Bill Amount</span><b>{fmt(totals.net)}</b></div>
                    <div className="ent-srow sub"><span>Taxable</span><b>{fmt(totals.taxable)}</b></div>
                    <div className="ent-srow sub"><span>Tax</span><b>{fmt(totals.tax)}</b></div>
                    <div className="ent-srow sub"><span>Tax-free</span><b>{fmt(totals.nonTaxable)}</b></div>
                    {party && <div className="ent-srow sub"><span>{party.label} credit limit</span><b>{party.creditLimit ? fmt(party.creditLimit) : '—'}</b></div>}
                </div>
            </div>
            <div className="ent-actionbar">
                <span className="ent-hint">{hints.join(' · ')}</span>
                <div className="ml-auto flex items-center gap-2 flex-wrap">{actions}</div>
            </div>
            {panels.map(p => (
                <EntryPopup key={p.key} title={`${title} · ${p.label}`} hidden={open !== p.key} onClose={() => setOpen(null)} width={p.width || 980}>{p.content}</EntryPopup>
            ))}
        </div>
    );
}
