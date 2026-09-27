// =============================================
// components/entry/SalesLineGrid.jsx
// The product lines of the sales entries (Quotation, Order, Challan,
// Bill, Return ...), one layout everywhere:
//   Code / Barcode | Product | Warehouse* | Batch / Serial | Mfg | Expiry |
//   Qty | Unit | Free Qty | Free Unit | Rate (+ per unit for dual items) |
//   product terms | Amount
//   * only when System Control > Multi Warehouse is on
// Code / Barcode: type a product code or scan a barcode + Enter; the
// unit of a scanned unit barcode is set too. Anything else lists matches.
// The product popup searches by name or by code (System Control).
// Product terms: the terms mapped in System Control (Disc 1-5, Excise,
// VAT) as inline columns, or one "Terms" button per line when that entry
// is set to popup; with no mapping the plain Disc % / Tax % columns.
// =============================================
import React, { useMemo, useState } from 'react';
import SearchablePopupSelect from '../SearchablePopupSelect';
import BatchSerialPicker from '../BatchSerialPicker';
import { calcLine } from './lineCalc';

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

export function CodeCell({ products, product, onPick }) {
    const [text, setText] = useState(null);
    const [matches, setMatches] = useState([]);
    const shown = text !== null ? text : (product ? product.product_code || '' : '');
    const go = () => {
        const hit = findByCode(products, shown);
        if (hit) { onPick(hit.product.id, hit.unit_id); setText(null); setMatches([]); return true; }
        const t = shown.trim().toLowerCase();
        if (!t) return false;
        setMatches(products.filter(p => String(p.product_code || '').toLowerCase().includes(t) || String(p.product_name || '').toLowerCase().includes(t)).slice(0, 12));
        return false;
    };
    return (
        <div className="relative" data-enter-nav="off">
            <input className="erp-input" style={{ width: 110 }} placeholder="Code / barcode" value={shown}
                onChange={e => { setText(e.target.value); setMatches([]); }}
                onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const tr = e.currentTarget.closest('tr');
                    const found = text === null ? !!product : go();
                    // found: straight to the qty of this line (after the product fills in)
                    if (found && tr) setTimeout(() => { const q = tr.querySelector('[data-qty]'); if (q) { q.focus(); q.select && q.select(); } }, 60);
                }}
                onBlur={() => { if (text !== null && !matches.length) { if (!go()) setText(null); } }} />
            {matches.length > 0 && (
                <div className="nav-dropdown" style={{ minWidth: 300 }}>
                    {matches.map(p => <button type="button" key={p.id} className="nav-dropdown-item w-full" onMouseDown={e => { e.preventDefault(); onPick(p.id, null); setText(null); setMatches([]); }}>
                        <span className="font-mono">{p.product_code}</span><span className="truncate">{p.product_name}</span></button>)}
                </div>
            )}
        </div>
    );
}

function TermsPopup({ cols, line, gross, onSave, onClose }) {
    const [lt, setLt] = useState(line.line_terms || {});
    const x = calcLine({ ...line, line_terms: lt }, gross, cols);
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="nav-window w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="erp-header"><span className="erp-header-title">Product terms of this line</span></div>
                <div className="nav-content">
                    <table className="erp-grid-table">
                        <thead><tr><th>Term</th><th>%</th><th className="text-right">Amount</th></tr></thead>
                        <tbody>{cols.map(c => (
                            <tr key={c.key}><td>{c.label}</td>
                                <td><input type="number" step="0.01" className="erp-input" style={{ width: 90 }} value={num(lt[c.key]?.percent)} onChange={e => setLt({ ...lt, [c.key]: { term_id: c.term_id, percent: e.target.value } })} /></td>
                                <td className="text-right">{fmt(x.line_terms?.[c.key]?.amount)}</td></tr>
                        ))}</tbody>
                        <tfoot><tr><td>Line amount</td><td /><td className="text-right">{fmt(x.amount)}</td></tr></tfoot>
                    </table>
                </div>
                <div className="erp-bottombar"><div /><div className="erp-bottombar-actions">
                    <button type="button" className="nav-btn" onClick={onClose}>Cancel</button>
                    <button type="button" className="nav-btn primary" onClick={() => { onSave(lt); onClose(); }}>OK</button>
                </div></div>
            </div>
        </div>
    );
}

export default function SalesLineGrid({
    details, onRow, onRemove, onAdd, products, allProducts, units, warehouses, settings, termCols = [], popupTerms = false,
    efc, onProductSelect, docWarehouseId, selected, onSelected, features = {}, dual, lineGross, onProductKeyDown, listKey = 'sl',
    extraColumns
}) {
    const f = { free: true, batch: true, expiry: false, terms: true, rate: true, tax: true, ...features };
    const visible = (k) => !efc || efc.isVisible(k, 'detail');
    const readonly = (k) => !!efc && efc.isReadonly(k, 'detail');
    const [termsFor, setTermsFor] = useState(null);
    const searchBy = settings?.searchBy || 'name';
    const catalog = allProducts || products;
    const productById = useMemo(() => Object.fromEntries(catalog.map(p => [p.id, p])), [catalog]);
    const multiWh = !!settings?.multiWarehouse;
    const inlineTerms = f.terms && termCols.length > 0 && !popupTerms;
    const legacyTerms = f.terms && termCols.length === 0;
    const unitName = id => units.find(u => u.id === id)?.unit_name || '';
    const isDual = pid => !!dual && dual.isDual(pid);

    const pick = (idx, productId, unitId) => onProductSelect(idx, productId, unitId || null);

    return (
        <>
            <div className="overflow-x-auto">
                <table className="erp-grid-table" style={{ minWidth: 1100 }}>
                    <thead>
                        <tr>
                            {onSelected && <th className="w-8" />}
                            <th>Code / Barcode</th>
                            <th style={{ minWidth: 220 }}>Product</th>
                            {multiWh && <th>Warehouse</th>}
                            {f.batch && <th>Batch / Serial</th>}
                            {f.expiry && <th>Mfg</th>}
                            {f.expiry && <th>Expiry</th>}
                            <th className={visible('qty') ? '' : 'hidden'}>Qty</th>
                            <th>Unit</th>
                            {f.free && <th className={visible('free_qty') ? '' : 'hidden'}>Free Qty</th>}
                            {f.free && <th>Free Unit</th>}
                            {f.rate && <th className={visible('rate') ? '' : 'hidden'}>Rate</th>}
                            {legacyTerms && <th className={visible('discount_percent') ? '' : 'hidden'}>Disc %</th>}
                            {legacyTerms && f.tax && <th className={visible('tax_percent') ? '' : 'hidden'}>Tax %</th>}
                            {inlineTerms && termCols.map(c => <th key={c.key} title={c.label}>{c.label} %</th>)}
                            {f.terms && popupTerms && termCols.length > 0 && <th>Terms</th>}
                            {extraColumns && extraColumns.header}
                            {f.rate && <th className="text-right">Amount</th>}
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {details.map((d, idx) => {
                            const p = productById[d.product_id];
                            const pUnits = unitsOfProduct(p, units);
                            const gross = lineGross ? lineGross(d) : (Number(d.qty) || 0) * (Number(d.rate) || 0);
                            const calc = calcLine(d, gross, f.terms ? termCols : []);
                            const wh = d.warehouse_id || docWarehouseId || '';
                            return (
                                <tr key={idx}>
                                    {onSelected && <td><input type="checkbox" checked={selected.includes(idx)} onChange={e => onSelected(e.target.checked ? [...selected, idx] : selected.filter(i => i !== idx))} /></td>}
                                    <td><CodeCell products={products} product={p} onPick={(pid, uid) => pick(idx, pid, uid)} /></td>
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
                                    {multiWh && (
                                        <td><select className="erp-select" style={{ width: 140 }} value={d.warehouse_id || ''} onChange={e => onRow(idx, { warehouse_id: e.target.value, batch_no: '', serial_no: '' })}>
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
                                                    <BatchSerialPicker mode="batch" productId={d.product_id} warehouseId={wh} onSelect={sel => onRow(idx, f.expiry ? sel : { batch_no: sel.batch_no, ...(multiWh && sel.warehouse_id ? { warehouse_id: sel.warehouse_id } : {}) })} />
                                                </div>
                                            ) : <span className="text-gray-400 text-xs">—</span>}
                                        </td>
                                    )}
                                    {f.expiry && <td>{p?.maintain_batch ? <input type="date" className="erp-input" style={{ width: 130 }} value={String(d.mfg_date || '').slice(0, 10)} onChange={e => onRow(idx, { mfg_date: e.target.value })} /> : ''}</td>}
                                    {f.expiry && <td>{p?.maintain_batch ? <input type="date" className="erp-input" style={{ width: 130 }} value={String(d.exp_date || '').slice(0, 10)} onChange={e => onRow(idx, { exp_date: e.target.value })} /> : ''}</td>}
                                    <td className={visible('qty') ? '' : 'hidden'}>
                                        {isDual(d.product_id) ? (
                                            <div className="flex flex-col gap-1">
                                                <input data-qty disabled={readonly('qty')} type="number" step="0.0001" className="erp-input" style={{ width: 80 }} value={num(d.qty)} placeholder={unitName(d.uom_id) || 'Primary'}
                                                    onChange={e => onRow(idx, dual.onPrimary(e.target.value, d))} />
                                                <input type="number" step="0.0001" className="erp-input" style={{ width: 80 }} value={num(d.alt_qty)} placeholder={unitName(d.alt_unit_id) || 'Secondary'}
                                                    onChange={e => onRow(idx, dual.onSecondary(e.target.value, d))} />
                                                {dual.error && dual.error(d) && <span className="text-[9px] text-red-600 leading-tight">{dual.error(d)}</span>}
                                            </div>
                                        ) : <input data-qty disabled={readonly('qty')} type="number" step="0.0001" className="erp-input" style={{ width: 90 }} value={num(d.qty)} onChange={e => onRow(idx, { qty: e.target.value })} />}
                                    </td>
                                    <td>
                                        {isDual(d.product_id)
                                            ? <span className="text-xs text-gray-600 whitespace-nowrap">{unitName(d.uom_id)} + {unitName(d.alt_unit_id)}</span>
                                            : <select className="erp-select" style={{ width: 90 }} value={d.uom_id || ''} onChange={e => onRow(idx, { uom_id: e.target.value })}>
                                                <option value="">Unit</option>{pUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select>}
                                    </td>
                                    {f.free && (
                                        <td className={visible('free_qty') ? '' : 'hidden'}>
                                            {isDual(d.product_id) ? (
                                                <div className="flex flex-col gap-1">
                                                    <input type="number" step="0.0001" className="erp-input" style={{ width: 75 }} value={num(d.free_qty)} placeholder="0" onChange={e => onRow(idx, { free_qty: e.target.value })} />
                                                    <input type="number" step="0.0001" className="erp-input" style={{ width: 75 }} value={num(d.free_alt_qty)} placeholder="0" onChange={e => onRow(idx, { free_alt_qty: e.target.value })} />
                                                </div>
                                            ) : <input type="number" step="0.0001" className="erp-input" style={{ width: 75 }} value={num(d.free_qty)} placeholder="0" onChange={e => onRow(idx, { free_qty: e.target.value })} />}
                                        </td>
                                    )}
                                    {f.free && (
                                        <td>{isDual(d.product_id)
                                            ? <span className="text-xs text-gray-600 whitespace-nowrap">{unitName(d.uom_id)} + {unitName(d.alt_unit_id)}</span>
                                            : <select className="erp-select" style={{ width: 90 }} value={d.free_uom_id || ''} onChange={e => onRow(idx, { free_uom_id: e.target.value })}>
                                                <option value="">{unitName(d.uom_id) || 'Same'}</option>{pUnits.filter(u => u.id !== d.uom_id).map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select>}</td>
                                    )}
                                    {f.rate && (
                                        <td className={visible('rate') ? '' : 'hidden'}>
                                            <input disabled={readonly('rate')} type="number" step="0.01" className="erp-input" style={{ width: 90 }} value={num(d.rate)} onChange={e => onRow(idx, { rate: e.target.value })} />
                                            {isDual(d.product_id) && (
                                                <select className="erp-select mt-1" style={{ fontSize: 11, height: 22, width: 90 }} value={d.rate_basis || 'primary'} onChange={e => onRow(idx, { rate_basis: e.target.value })} title="Rate is per">
                                                    <option value="primary">per {unitName(d.uom_id) || 'primary'}</option>
                                                    <option value="secondary">per {unitName(d.alt_unit_id) || 'secondary'}</option>
                                                </select>
                                            )}
                                        </td>
                                    )}
                                    {legacyTerms && <td className={visible('discount_percent') ? '' : 'hidden'}><input type="number" step="0.01" className="erp-input" style={{ width: 70 }} value={num(d.discount_percent)} onChange={e => onRow(idx, { discount_percent: e.target.value })} /></td>}
                                    {legacyTerms && f.tax && <td className={visible('tax_percent') ? '' : 'hidden'}><input disabled={readonly('tax_percent')} type="number" step="0.01" className="erp-input" style={{ width: 70 }} value={num(d.tax_percent)} onChange={e => onRow(idx, { tax_percent: e.target.value })} /></td>}
                                    {inlineTerms && termCols.map(c => (
                                        <td key={c.key}>
                                            <input type="number" step="0.01" className="erp-input" style={{ width: 70 }} value={num(d.line_terms?.[c.key]?.percent)}
                                                onChange={e => onRow(idx, { line_terms: { ...(d.line_terms || {}), [c.key]: { term_id: c.term_id, percent: e.target.value } } })} />
                                            <div className="text-[10px] text-gray-600 text-right">{fmt(calc.line_terms?.[c.key]?.amount)}</div>
                                        </td>
                                    ))}
                                    {f.terms && popupTerms && termCols.length > 0 && (
                                        <td><button type="button" className="nav-btn small" onClick={() => setTermsFor(idx)} title="Product terms of this line">
                                            Terms {fmt((calc.excise_amount || 0) + (calc.tax_amount || 0) - (calc.discount_amount || 0))}</button></td>
                                    )}
                                    {extraColumns && extraColumns.cells(d, idx)}
                                    {f.rate && <td className="text-right whitespace-nowrap">{fmt(f.terms ? calc.amount : gross)}</td>}
                                    <td><button type="button" tabIndex={-1} onClick={() => onRemove(idx)} className="nav-btn small danger">✕</button></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center gap-2 mt-2">
                <button type="button" className="nav-btn small" onClick={onAdd}>➕ Add line</button>
                <span className="text-xs text-gray-600">Code / Barcode: type or scan + Enter · Product search by {searchBy} (System Control)</span>
            </div>
            {termsFor !== null && details[termsFor] && (
                <TermsPopup cols={termCols} line={details[termsFor]} gross={lineGross ? lineGross(details[termsFor]) : 0}
                    onSave={lt => onRow(termsFor, { line_terms: lt })} onClose={() => setTermsFor(null)} />
            )}
        </>
    );
}
