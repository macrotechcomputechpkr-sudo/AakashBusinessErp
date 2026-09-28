// =============================================
// components/entry/SalesLineGrid.jsx
// The product lines of the sales entries (Quotation, Order, Challan,
// Bill, Return ...), one layout everywhere:
//   # | Item Code (code / barcode) | Item Name | Unit | Warehouse* | Batch /
//   Serial | Mfg | Expiry | Qty | Free Qty | Free Unit | Rate (+ per unit for
//   dual items) | Gross | inline charges | Charges ± | Net Amount
//   * only when System Control > Multi Warehouse is on
// At least 10 rows show (click an empty one to start a line), the line being
// typed is yellow and the Total row sits under Quantity / Gross / Term / Amount.
// Term opens "<Entry> · Item Charges" for that line; the footer's Bill Term
// opens "Over All Term(s)" (useLineGridControl links the two).
// Code / Barcode: type a product code or scan a barcode + Enter; the
// unit of a scanned unit barcode is set too. Anything else lists matches.
// The product popup searches by name or by code (System Control).
// Product terms: the terms mapped in System Control (Disc 1-5, Excise,
// VAT) as inline columns, or one "Terms" button per line when that entry
// is set to popup; with no mapping the plain Disc % / Tax % columns.
// =============================================
import React, { useMemo, useRef, useState } from 'react';
import SearchablePopupSelect from '../SearchablePopupSelect';
import BatchSerialPicker from '../BatchSerialPicker';
import { calcLine, allowedKinds, kindOf, termFromInput } from './lineCalc';
import { TermPopup, OverallTermPopup } from './EntryParts';
import AmountCell, { patchFromGross, grossForNet } from './AmountCell';
import { fixedRateBasis } from '../../utils/dualUomEntryMode';

const num = v => (v === '' || v === null || v === undefined ? '' : v);
const fmt = n => (Number(n) || 0).toFixed(2);

export function unitsOfProduct(product, units) {
    if (!product) return units;
    const ids = [product.base_unit_id, ...(product.product_unit_rates || []).map(r => r.unit_id)].filter((id, i, a) => id && a.indexOf(id) === i);
    return ids.map(id => units.find(u => u.id === id) || { id, unit_name: '?' });
}

/** find a product by barcode (any unit) or exact product code */
export function findByCode(products, text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    for (const p of products) {
        const ur = (p.product_unit_rates || []).find(r => r.barcode && String(r.barcode).toLowerCase() === t);
        if (ur) return { product: p, unit_id: ur.unit_id };
        if (p.barcode && String(p.barcode).toLowerCase() === t) return { product: p, unit_id: null };
    }
    const p = products.find(x => String(x.product_code || '').toLowerCase() === t || String(x.short_name || '').toLowerCase() === t);
    return p ? { product: p, unit_id: null } : null;
}

/**
 * Item Code cell: a code, short name or barcode + Enter brings the product (qty next).
 * pos (System Control > Barcode System): scanning works like a counter - onPosPick(productId, unitId)
 * adds the item (or one more of it) and the cursor goes straight to the Item Code of the next line
 */
export function CodeCell({ products, product, onPick, pos, onPosPick }) {
    const [text, setText] = useState(null);
    const [matches, setMatches] = useState([]);
    const shown = text !== null ? text : (product ? product.product_code || '' : '');
    const choose = (hit, el) => {
        if (pos && onPosPick) {
            onPosPick(hit.product.id, hit.unit_id);
            setText(null); setMatches([]);
            // next line's Item Code (a new line is added when this was the last)
            setTimeout(() => {
                const all = [...(el?.closest('tbody')?.querySelectorAll('input[data-code]') || [])];
                const next = all[all.indexOf(el) + 1];
                if (next) next.focus(); else if (el) { el.focus(); el.select && el.select(); }
            }, 90);
            return 'pos';
        }
        onPick(hit.product.id, hit.unit_id); setText(null); setMatches([]);
        return true;
    };
    const go = (el) => {
        const hit = findByCode(products, shown);
        if (hit) return choose(hit, el);
        const t = shown.trim().toLowerCase();
        if (!t) return false;
        setMatches(products.filter(p => String(p.product_code || '').toLowerCase().includes(t) || String(p.short_name || '').toLowerCase().includes(t) || String(p.product_name || '').toLowerCase().includes(t)).slice(0, 12));
        return false;
    };
    return (
        <div className="relative" data-enter-nav="off">
            <input data-code className="erp-input" style={{ width: 110 }} placeholder={pos ? 'Scan / code' : 'Code / barcode'} value={shown}
                onChange={e => { setText(e.target.value); setMatches([]); }}
                onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const tr = el.closest('tr');
                    const found = text === null ? !!product : go(el);
                    // found: straight to the qty of this line (after the product fills in)
                    if (found === true && tr) setTimeout(() => { const q = tr.querySelector('[data-qty]'); if (q) { q.focus(); q.select && q.select(); } }, 60);
                }}
                onBlur={() => { if (text !== null && !matches.length && !pos) { if (!go(null)) setText(null); } }} />
            {matches.length > 0 && (
                <div className="nav-dropdown" style={{ minWidth: 300 }}>
                    {matches.map(p => <button type="button" key={p.id} className="nav-dropdown-item w-full" onMouseDown={e => { e.preventDefault(); const el = e.currentTarget.closest('.relative')?.querySelector('input[data-code]'); if (choose({ product: p, unit_id: null }, el) === true && el) { const tr = el.closest('tr'); setTimeout(() => { const q = tr && tr.querySelector('[data-qty]'); if (q) { q.focus(); q.select && q.select(); } }, 60); } }}>
                        <span className="font-mono">{p.product_code}</span><span className="truncate">{p.product_name}</span></button>)}
                </div>
            )}
        </div>
    );
}

/** shared state between the grid and the entry footer (Product Term / Bill Term buttons) */
export function useLineGridControl() {
    const [active, setActive] = useState(0);
    const [termsFor, setTermsFor] = useState(null);
    const [overall, setOverall] = useState(false);
    return { active, setActive, termsFor, setTermsFor, overall, setOverall, openTerms: () => setTermsFor(active), openOverall: () => setOverall(true) };
}

/** qty / gross / terms / amount of the lines, and the taxable / non-taxable split */
export function lineTotals(details, lineGross, termCols, useTerms = true) {
    return details.reduce((t, d) => {
        if (!d.product_id) return t;
        const g = lineGross ? lineGross(d) : (Number(d.qty) || 0) * (Number(d.rate) || 0);
        const x = calcLine(d, g, useTerms ? termCols : []);
        const amount = useTerms ? x.amount : g;
        const term = amount - g;
        return {
            qty: t.qty + (Number(d.qty) || 0), gross: t.gross + g, disc: t.disc + x.discount_amount, excise: t.excise + x.excise_amount, tax: t.tax + x.tax_amount,
            term: t.term + term, amount: t.amount + amount,
            taxable: t.taxable + (x.tax_amount > 0 ? amount - x.tax_amount : 0), nonTaxable: t.nonTaxable + (x.tax_amount > 0 ? 0 : amount)
        };
    }, { qty: 0, gross: 0, disc: 0, excise: 0, tax: 0, term: 0, amount: 0, taxable: 0, nonTaxable: 0 });
}

const KIND_HINT = { pct: '%', rate: 'rate/qty', amt: 'amount' };
const TAXATION = { vat: 'VAT', excise: 'Excise', discount: 'Cash Discount', none: 'None' };
const formulaOf = t => (!t ? 'BV' : t.calculation_mode === 'formula' ? t.formula_expression : t.base_reference_term ? `after ${t.base_reference_term.term_code}` : 'BV');

export default function SalesLineGrid({
    details, onRow, onRemove, onAdd, products, allProducts, units, warehouses, settings, termCols = [], popupTerms = false,
    efc, onProductSelect, docWarehouseId, selected, onSelected, features = {}, dual, lineGross, onProductKeyDown, listKey = 'sl',
    ctl: ctlIn, title = 'Entry', minRows = 10, itemCharges = true, amountSide = 'sales', fx
}) {
    const f0 = { free: true, batch: true, expiry: false, terms: true, rate: true, tax: true, ...features };
    const visible = (k) => !efc || efc.isVisible(k, 'detail');
    const readonly = (k) => !!efc && efc.isReadonly(k, 'detail');
    const own = useLineGridControl();
    const ctl = ctlIn || own;
    const tableRef = useRef(null);
    const searchBy = settings?.searchBy || 'name';
    const catalog = allProducts || products;
    const productById = useMemo(() => Object.fromEntries(catalog.map(p => [p.id, p])), [catalog]);
    // Free Qty, Batch / Serial, Mfg and Expiry columns only when System Control switches them on
    const f = {
        ...f0, free: f0.free && !!settings?.freeQty, batch: f0.batch && !!(settings?.batch || settings?.serial),
        mfg: f0.expiry && !!settings?.mfgDate, exp: f0.expiry && !!settings?.expDate
    };
    const termById = useMemo(() => Object.fromEntries((settings?.billingTerms || []).map(t => [t.id, t])), [settings]);
    const multiWh = !!settings?.multiWarehouse;
    // itemCharges off (System Control): no per-line charges, only the Charges Summary - the product's values still count
    const inlineTerms = itemCharges && f.terms && termCols.length > 0 && !popupTerms;
    const legacyTerms = f.terms && termCols.length === 0;
    // Disc % / Tax % as columns only when this entry's charges are not set to open in the pop-up
    const legacyInline = itemCharges && legacyTerms && !popupTerms;
    const unitName = id => units.find(u => u.id === id)?.unit_name || '';
    const isDual = pid => !!dual && dual.isDual(pid);
    const grossOf = d => (lineGross ? lineGross(d) : (Number(d.qty) || 0) * (Number(d.rate) || 0));

    // Gross / Net Amount typed in: the rate (or, per product, the quantity) is worked out
    const applyGross = (idx, g) => {
        const d = details[idx];
        const p = productById[d.product_id];
        const patch = patchFromGross(d, g, grossOf, !!p?.[`qty_from_amount_${amountSide}`], isDual(d.product_id));
        if (patch) onRow(idx, patch);
    };
    const applyNet = (idx, n) => {
        const d = details[idx];
        const g = grossForNet(n, gg => (f.terms ? calcLine(d, gg, termCols).amount : gg));
        if (g !== null && g >= 0) applyGross(idx, g);
    };

    const pick = (idx, productId, unitId) => onProductSelect(idx, productId, unitId || null);
    // barcode counter mode: the same item again adds one to its line, a new one takes this line with qty 1
    const posMode = !!settings?.barcode;
    const posPick = (idx, productId, unitId) => {
        const other = details.findIndex((d, i) => i !== idx && d.product_id === productId && (!unitId || d.uom_id === unitId) && !isDual(productId));
        if (other >= 0 && !details[idx].product_id) { onRow(other, { qty: (Number(details[other].qty) || 0) + 1 }); ctl.setActive(other); return; }
        pick(idx, productId, unitId);
        if (!(Number(details[idx].qty) > 0)) onRow(idx, { qty: 1 });
        if (idx === details.length - 1) onAdd();
    };

    // ---- product-wise terms of one line ----
    const termRows = (d) => {
        const g = grossOf(d);
        if (legacyTerms || !f.terms) {
            const x = calcLine(d, g, []);
            return [
                { key: 'discount_percent', description: 'Product Discount', sign: '-', kinds: ['pct'], kind: 'pct', value: d.discount_percent, percent: d.discount_percent, amount: x.discount_amount, calculatedOn: g, termCode: 'DISC', formula: 'BV', taxation: 'None' },
                ...(f.tax ? [{ key: 'tax_percent', description: 'VAT / Tax', sign: '+', kinds: ['pct'], kind: 'pct', value: d.tax_percent, percent: d.tax_percent, amount: x.tax_amount, calculatedOn: g - x.discount_amount, termCode: 'TAX', formula: 'BV - Discount', taxation: 'VAT' }] : [])
            ];
        }
        const x = calcLine(d, g, termCols);
        return termCols.map(c => {
            const t = termById[c.term_id];
            const lt = d.line_terms?.[c.key];
            const kind = kindOf(lt);
            return {
                key: c.key, description: c.label, sign: c.kind === 'discount' ? '-' : '+', percent: lt?.fixed ? '' : lt?.percent,
                kinds: allowedKinds(c.input), kind, value: lt ? (kind === 'amt' ? lt.amount : lt.percent) : '', editable: c.manual !== false,
                amount: x.line_terms?.[c.key]?.amount, calculatedOn: x.line_terms?.[c.key]?.base, termCode: t?.term_code, ledgerName: t?.billing_ledger?.account_name,
                subLedger: t?.sub_ledger?.sub_ledger_name, formula: formulaOf(t), taxation: TAXATION[t?.tax_type || c.kind] || 'None'
            };
        });
    };
    // a % / rate per qty / amount typed for a charge of one line ('' clears it)
    const setTermInput = (idx, key, kind, v) => {
        const d = details[idx];
        if (legacyTerms || !f.terms) { onRow(idx, { [key]: v }); return; }
        const c = termCols.find(x => x.key === key);
        if (!c || c.manual === false) return;
        const lt = { ...(d.line_terms || {}) };
        if (v === '' || v === null || v === undefined) delete lt[key]; else lt[key] = termFromInput(c.term_id, kind, v);
        onRow(idx, { line_terms: lt });
    };
    const setLineTerm = (idx, key, patch) => {
        const d = details[idx];
        if (legacyTerms || !f.terms) { onRow(idx, { [key]: patch.percent }); return; }
        const c = termCols.find(x => x.key === key);
        const cur = { ...(d.line_terms?.[key] || {}) };
        delete cur.fixed; delete cur.amount;
        onRow(idx, { line_terms: { ...(d.line_terms || {}), [key]: { ...cur, term_id: c.term_id, ...patch } } });
    };

    // ---- over-all terms (every line, or the ticked lines) ----
    const scope = details.map((d, i) => i).filter(i => details[i].product_id && (!selected || !selected.length || selected.includes(i)));
    const overallRows = () => {
        const keys = legacyTerms || !f.terms ? termRows({ qty: 0, rate: 0 }).map(r => ({ key: r.key, label: r.description, sign: r.sign })) : termCols.filter(c => c.summary !== false).map(c => ({ key: c.key, label: c.label, sign: c.kind === 'discount' ? '-' : '+', editable: c.manual !== false, pctOk: allowedKinds(c.input).includes('pct'), amtOk: allowedKinds(c.input).includes('amt') }));
        return keys.map(k => {
            let amount = 0; const pcts = new Set();
            scope.forEach(i => { const r = termRows(details[i]).find(x => x.key === k.key); if (r) { amount += Number(r.amount) || 0; pcts.add(String(Number(r.percent) || 0)); } });
            const same = pcts.size === 1 ? Number([...pcts][0]) : '';
            return { key: k.key, term: k.label, editable: k.editable, pctOk: k.pctOk, amtOk: k.amtOk, basis: !legacyTerms && f.terms && splitByQty(k.key) ? 'Q' : 'V', sign: k.sign, percent: pcts.size > 1 ? '' : same, mixed: pcts.size > 1, amount };
        });
    };
    const overallPercent = (key, v) => scope.forEach(i => setLineTerm(i, key, { percent: v, basis: 'V' }));
    // a charge's basis (Billing Term setup): 'quantity' splits a typed amount by qty, else by value
    const splitByQty = key => { const c = termCols.find(x => x.key === key); return termById[c?.term_id]?.basis === 'quantity'; };
    const overallAmount = (key, v) => {
        const total = Number(v) || 0;
        const byQty = !legacyTerms && f.terms && splitByQty(key);
        const grosses = scope.map(i => grossOf(details[i]));
        const weights = byQty ? scope.map(i => Number(details[i].qty) || 0) : grosses;
        const sum = weights.reduce((a, b) => a + b, 0);
        if (!sum) return;
        scope.forEach((i, n) => {
            const share = total * weights[n] / sum;
            if (legacyTerms || !f.terms) { onRow(i, { [key]: grosses[n] ? +(share / grosses[n] * 100).toFixed(4) : 0 }); return; }
            const c = termCols.find(x => x.key === key);
            onRow(i, { line_terms: { ...(details[i].line_terms || {}), [key]: { term_id: c.term_id, fixed: true, amount: Math.round(share * 100) / 100, percent: 0 } } });
        });
    };

    const addAndFocus = () => {
        onAdd();
        setTimeout(() => {
            const rows = tableRef.current?.querySelectorAll('tbody tr.line');
            const last = rows && rows[rows.length - 1];
            const inp = last && last.querySelector('input:not([type=checkbox]), select');
            if (inp) inp.focus();
        }, 50);
    };

    const totals = lineTotals(details, lineGross, termCols, f.terms);
    const colCount = 3 + 1 + (multiWh ? 1 : 0) + (f.batch ? 1 : 0) + (f.mfg ? 1 : 0) + (f.exp ? 1 : 0) + 1 + (f.free ? 2 : 0) + (f.rate ? 2 : 0)
        + (legacyInline ? (f.tax ? 2 : 1) : 0) + (inlineTerms ? termCols.length : 0) + (f.terms ? 1 : 0) + (f.rate ? 1 : 0) + 1;
    const beforeQty = 3 + 1 + (multiWh ? 1 : 0) + (f.batch ? 1 : 0) + (f.mfg ? 1 : 0) + (f.exp ? 1 : 0);
    const fillers = Math.max(0, minRows - details.length);

    return (
        <>
            <div className="ent-grid-wrap">
                <table className="ent-grid" ref={tableRef} style={{ minWidth: 1100 }}>
                    <thead>
                        <tr>
                            <th className="sno">#</th>
                            <th>Item Code</th>
                            <th style={{ minWidth: 200 }}>Item Name</th>
                            <th>Unit</th>
                            {multiWh && <th>Warehouse</th>}
                            {f.batch && <th>Batch / Serial</th>}
                            {f.mfg && <th>Mfg</th>}
                            {f.exp && <th>Expiry</th>}
                            <th className={`r ${visible('qty') ? '' : 'hidden'}`}>Qty</th>
                            {f.free && <th className={`r ${visible('free_qty') ? '' : 'hidden'}`}>Free Qty</th>}
                            {f.free && <th>Free Unit</th>}
                            {f.rate && <th className={`r ${visible('rate') ? '' : 'hidden'}`}>Rate</th>}
                            {f.rate && <th className="r">Gross</th>}
                            {legacyInline && <th className={`r ${visible('discount_percent') ? '' : 'hidden'}`}>Disc %</th>}
                            {legacyInline && f.tax && <th className={`r ${visible('tax_percent') ? '' : 'hidden'}`}>Tax %</th>}
                            {inlineTerms && termCols.map(c => <th key={c.key} className="r" title={c.label}>{c.label}</th>)}
                            {f.terms && <th className="r">Charges ±</th>}
                            {f.rate && <th className="r">Net Amount</th>}
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {details.map((d, idx) => {
                            const p = productById[d.product_id];
                            const pUnits = unitsOfProduct(p, units);
                            const gross = grossOf(d);
                            const calc = calcLine(d, gross, f.terms ? termCols : []);
                            const wh = d.warehouse_id || docWarehouseId || '';
                            const amount = f.terms ? calc.amount : gross;
                            return (
                                <tr key={idx} className={`line ${ctl.active === idx ? 'cur' : ''}`} onFocus={() => ctl.setActive(idx)}>
                                    <td className="sno">
                                        {onSelected ? (
                                            <label className="inline-flex items-center gap-1 cursor-pointer" title="Tick lines to change their charges together">
                                                <input type="checkbox" tabIndex={-1} checked={selected.includes(idx)} onChange={e => onSelected(e.target.checked ? [...selected, idx] : selected.filter(i => i !== idx))} />{idx + 1}
                                            </label>
                                        ) : idx + 1}
                                    </td>
                                    <td><CodeCell products={products} product={p} onPick={(pid, uid) => pick(idx, pid, uid)} pos={posMode} onPosPick={(pid, uid) => posPick(idx, pid, uid)} /></td>
                                    <td onKeyDown={e => onProductKeyDown && onProductKeyDown(e, d.product_id)}>
                                        <SearchablePopupSelect
                                            listKey={`${listKey}_product_picker_${searchBy}`}
                                            columns={searchBy === 'code' ? [{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }] : [{ key: 'product_name', label: 'Name' }, { key: 'product_code', label: 'Code' }]}
                                            defaultVisibleKeys={['product_code', 'product_name']}
                                            items={products} getId={x => x.id} getLabel={x => (searchBy === 'code' ? `${x.product_code || ''} ${x.product_name}` : x.product_name)}
                                            searchKeys={searchBy === 'code' ? ['product_code', 'short_name'] : ['product_name', 'short_name', 'product_code']}
                                            value={d.product_id} onChange={id => pick(idx, id, null)} placeholder={searchBy === 'code' ? 'Search by code' : 'Search by name'}
                                        />
                                    </td>
                                    <td>
                                        {isDual(d.product_id)
                                            ? <span className="text-xs text-gray-600 whitespace-nowrap">{unitName(d.uom_id)} + {unitName(d.alt_unit_id)}</span>
                                            : <select className="erp-select" style={{ width: 78 }} value={d.uom_id || ''} onChange={e => onRow(idx, { uom_id: e.target.value })}>
                                                <option value="">Unit</option>{pUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select>}
                                    </td>
                                    {multiWh && (
                                        <td><select className="erp-select" style={{ width: 130 }} value={d.warehouse_id || ''} onChange={e => onRow(idx, { warehouse_id: e.target.value, batch_no: '', serial_no: '' })}>
                                            <option value="">(document)</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}</select></td>
                                    )}
                                    {f.batch && (
                                        <td>
                                            {p?.track_serial_number ? (
                                                <div className="flex items-center gap-1">
                                                    <input className="erp-input" style={{ width: 110 }} value={d.serial_no || ''} onChange={e => onRow(idx, { serial_no: e.target.value })} placeholder="Serial" />
                                                    <BatchSerialPicker mode="serial" productId={d.product_id} warehouseId={wh} onSelect={sel => onRow(idx, sel)} />
                                                </div>
                                            ) : p?.maintain_batch ? (
                                                <div className="flex items-center gap-1">
                                                    <input className="erp-input" style={{ width: 110 }} value={d.batch_no || ''} onChange={e => onRow(idx, { batch_no: e.target.value })} placeholder="Batch" />
                                                    <BatchSerialPicker mode="batch" productId={d.product_id} warehouseId={wh} onSelect={sel => onRow(idx, (f.mfg || f.exp) ? sel : { batch_no: sel.batch_no, ...(multiWh && sel.warehouse_id ? { warehouse_id: sel.warehouse_id } : {}) })} />
                                                </div>
                                            ) : <span className="text-gray-400 text-xs">—</span>}
                                        </td>
                                    )}
                                    {f.mfg && <td>{p?.maintain_batch ? <input type="date" className="erp-input" style={{ width: 130 }} value={String(d.mfg_date || '').slice(0, 10)} onChange={e => onRow(idx, { mfg_date: e.target.value })} /> : ''}</td>}
                                    {f.exp && <td>{p?.maintain_batch ? <input type="date" className="erp-input" style={{ width: 130 }} value={String(d.exp_date || '').slice(0, 10)} onChange={e => onRow(idx, { exp_date: e.target.value })} /> : ''}</td>}
                                    <td className={`r ${visible('qty') ? '' : 'hidden'}`}>
                                        {isDual(d.product_id) ? (
                                            <div className="flex flex-col gap-1">
                                                <input data-qty disabled={readonly('qty')} type="number" step="0.0001" className="erp-input text-right" style={{ width: 80 }} value={num(d.qty)} placeholder={unitName(d.uom_id) || 'Primary'}
                                                    onChange={e => onRow(idx, dual.onPrimary(e.target.value, d))} />
                                                <input type="number" step="0.0001" className="erp-input text-right" style={{ width: 80 }} value={num(d.alt_qty)} placeholder={unitName(d.alt_unit_id) || 'Secondary'}
                                                    onChange={e => onRow(idx, dual.onSecondary(e.target.value, d))} />
                                                {dual.error && dual.error(d) && <span className="text-[9px] text-red-600 leading-tight">{dual.error(d)}</span>}
                                            </div>
                                        ) : <input data-qty disabled={readonly('qty')} type="number" step="0.0001" className="erp-input text-right" style={{ width: 80 }} value={num(d.qty)} onChange={e => onRow(idx, { qty: e.target.value })} />}
                                    </td>
                                    {f.free && (
                                        <td className={`r ${visible('free_qty') ? '' : 'hidden'}`}>
                                            {isDual(d.product_id) ? (
                                                <div className="flex flex-col gap-1">
                                                    <input type="number" step="0.0001" className="erp-input text-right" style={{ width: 75 }} value={num(d.free_qty)} placeholder="0" onChange={e => onRow(idx, { free_qty: e.target.value })} />
                                                    <input type="number" step="0.0001" className="erp-input text-right" style={{ width: 75 }} value={num(d.free_alt_qty)} placeholder="0" onChange={e => onRow(idx, { free_alt_qty: e.target.value })} />
                                                </div>
                                            ) : <input type="number" step="0.0001" className="erp-input text-right" style={{ width: 60 }} value={num(d.free_qty)} placeholder="0" onChange={e => onRow(idx, { free_qty: e.target.value })} />}
                                        </td>
                                    )}
                                    {f.free && (
                                        <td>{isDual(d.product_id)
                                            ? <span className="text-xs text-gray-600 whitespace-nowrap">{unitName(d.uom_id)} + {unitName(d.alt_unit_id)}</span>
                                            : <select className="erp-select" style={{ width: 78 }} value={d.free_uom_id || ''} onChange={e => onRow(idx, { free_uom_id: e.target.value })}>
                                                <option value="">{unitName(d.uom_id) || 'Same'}</option>{pUnits.filter(u => u.id !== d.uom_id).map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select>}</td>
                                    )}
                                    {f.rate && (
                                        <td className={`r ${visible('rate') ? '' : 'hidden'}`}>
                                            <input disabled={readonly('rate')} type="number" step="0.01" className="erp-input text-right" style={{ width: 80 }} value={num(d.rate)} onChange={e => onRow(idx, { rate: e.target.value })} />
                                            {isDual(d.product_id) && (
                                                <select className="erp-select mt-1" style={{ fontSize: 11, height: 22, width: 90 }} value={fixedRateBasis(p) || d.rate_basis || 'primary'} disabled={!!fixedRateBasis(p)} onChange={e => onRow(idx, { rate_basis: e.target.value })} title={fixedRateBasis(p) ? 'Rate per this unit (Product Master)' : 'Rate is per'}>
                                                    <option value="primary">per {unitName(d.uom_id) || 'primary'}</option>
                                                    <option value="secondary">per {unitName(d.alt_unit_id) || 'secondary'}</option>
                                                </select>
                                            )}
                                        </td>
                                    )}
                                    {f.rate && <td className="r whitespace-nowrap">{d.product_id ? <AmountCell value={gross} disabled={readonly('rate')} title="Type the amount: the rate (or the quantity) is worked out" onChange={g => applyGross(idx, g)} /> : ''}</td>}
                                    {legacyInline && <td className={`r ${visible('discount_percent') ? '' : 'hidden'}`}><input type="number" step="0.01" className="erp-input text-right" style={{ width: 56 }} value={num(d.discount_percent)} onChange={e => onRow(idx, { discount_percent: e.target.value })} /></td>}
                                    {legacyInline && f.tax && <td className={`r ${visible('tax_percent') ? '' : 'hidden'}`}><input disabled={readonly('tax_percent')} type="number" step="0.01" className="erp-input text-right" style={{ width: 56 }} value={num(d.tax_percent)} onChange={e => onRow(idx, { tax_percent: e.target.value })} /></td>}
                                    {inlineTerms && termCols.map(c => {
                                        const lt = d.line_terms?.[c.key];
                                        const kinds = allowedKinds(c.input);
                                        const kind = kinds.includes(kindOf(lt)) ? kindOf(lt) : kinds[0];
                                        const v = lt && kindOf(lt) === kind ? (kind === 'amt' ? lt.amount : lt.percent) : '';
                                        return (
                                            <td key={c.key} className="r">
                                                <input type="number" step="0.01" className="erp-input text-right" style={{ width: 70 }} value={num(v)} disabled={c.manual === false}
                                                    placeholder={KIND_HINT[kind]} title={`${c.label}: ${KIND_HINT[kind]}`} onChange={e => setTermInput(idx, c.key, kind, e.target.value)} />
                                                <div className="text-[10px] text-gray-600 text-right">{fmt(calc.line_terms?.[c.key]?.amount)}{kind !== 'pct' && calc.line_terms?.[c.key]?.base ? ` · ${(Math.abs(calc.line_terms[c.key].amount) / calc.line_terms[c.key].base * 100).toFixed(2)}%` : ''}</div>
                                            </td>
                                        );
                                    })}
                                    {f.terms && (
                                        <td className="r">
                                            {itemCharges ? (
                                                <button type="button" tabIndex={-1} className="ent-term-btn" onClick={() => { ctl.setActive(idx); ctl.setTermsFor(idx); }} title="Charges of this line">
                                                    {d.product_id ? fmt(amount - gross) : '…'}
                                                </button>
                                            ) : (d.product_id ? fmt(amount - gross) : '')}
                                        </td>
                                    )}
                                    {f.rate && <td className="r whitespace-nowrap">{d.product_id ? <AmountCell bold value={amount} disabled={readonly('rate')} title="Type the net amount: taken back through the charges to the rate (or quantity)" onChange={n => applyNet(idx, n)} /> : ''}</td>}
                                    <td className="c"><button type="button" tabIndex={-1} onClick={() => onRemove(idx)} className="ent-x" title="Remove line">✕</button></td>
                                </tr>
                            );
                        })}
                        {Array.from({ length: fillers }).map((_, i) => (
                            <tr key={`f${i}`} className="filler" onClick={addAndFocus} title="Click to add a line">
                                <td className="sno">{details.length + i + 1}</td>
                                <td colSpan={colCount - 1} />
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colSpan={beforeQty} className="r"><span className="ent-total-cap">Totals</span></td>
                            <td className={`r ${visible('qty') ? '' : 'hidden'}`}>{Number(totals.qty).toFixed(3)}</td>
                            {f.free && <td className={visible('free_qty') ? '' : 'hidden'} />}
                            {f.free && <td />}
                            {f.rate && <td className={visible('rate') ? '' : 'hidden'} />}
                            {f.rate && <td className="r">{fmt(totals.gross)}</td>}
                            {legacyInline && <td className={visible('discount_percent') ? '' : 'hidden'} />}
                            {legacyInline && f.tax && <td className={visible('tax_percent') ? '' : 'hidden'} />}
                            {inlineTerms && termCols.map(c => <td key={c.key} />)}
                            {f.terms && <td className="r">{fmt(totals.term)}</td>}
                            {f.rate && <td className="r">{fmt(totals.amount)}</td>}
                            <td />
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
                <button type="button" className="nav-btn small" onClick={addAndFocus}>➕ Add line</button>
                <span>Item Code: type a code / short name or scan a barcode + Enter · Gross / Net Amount can be typed · Item Name: search by {searchBy} · Enter on the last field adds a line · Charges ±: this line's charges</span>
            </div>
            {itemCharges && ctl.termsFor !== null && details[ctl.termsFor] && (() => {
                const d = details[ctl.termsFor];
                const p = productById[d.product_id];
                return (
                    <TermPopup title={`${title} · Item Charges`} productName={p ? `${p.product_code || ''} ${p.product_name}` : `Line ${ctl.termsFor + 1}`}
                        basic={grossOf(d)} qty={d.qty} unitName={unitName(d.uom_id)} rows={termRows(d)}
                        onInput={(key, kind, v) => setTermInput(ctl.termsFor, key, kind, v)} fx={fx}
                        onClose={() => ctl.setTermsFor(null)} />
                );
            })()}
            {ctl.overall && (
                <OverallTermPopup fx={fx} title={`${title} · Charges Summary`} rows={overallRows()} onPercent={overallPercent} onAmount={overallAmount} onClose={() => ctl.setOverall(false)}
                    note={selected && selected.length ? `Goes to the ${scope.length} ticked line(s)` : `Goes to all ${scope.length} line(s) - tick lines (#) to change only those`} />
            )}
        </>
    );
}
