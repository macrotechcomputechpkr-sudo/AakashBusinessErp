// =============================================
// PurchaseBillImport.jsx
// Purchase Bill from a JPG / PNG / PDF of the supplier's bill (server:
// utils/purchaseBillImport.js).
//   1. Upload - the bill is read (vendor, PAN, bill no, date, lines, VAT).
//   2. Review - vendor found by PAN / ledger tag / name (change it if
//      needed); each line shows its product:
//        Remembered  - mapped the same way on this vendor's earlier bill
//        Suggested   - product code, or name / short name / tag >= 60% similar
//        New         - nothing >= 60%: pick one of the closest products, any
//                      product, or "Create new product" (name, unit, rate
//                      pre-filled from the bill)
//   3. Create - new products are created (normal Product API, the bill's
//      text kept as a tag), then a DRAFT Purchase Bill (normal Purchase
//      Bill API) to review and post, and the confirmed mappings are
//      remembered for this vendor.
// =============================================
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import SearchablePopupSelect from '../components/SearchablePopupSelect';

const fmt2 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS = { remembered: ['Remembered', 'bg-blue-100 text-blue-800'], suggested: ['Suggested', 'bg-green-100 text-green-800'], new: ['Looks new', 'bg-amber-100 text-amber-800'], manual: ['Chosen', 'bg-gray-100 text-gray-700'], create: ['New product', 'bg-purple-100 text-purple-800'] };
const readFile = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });

export default function PurchaseBillImport() {
    const { authFetch } = useAuth();
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [reading, setReading] = useState(false);
    const [result, setResult] = useState(null);        // server response
    const [head, setHead] = useState(null);            // { vendor_ledger_id, party_bill_no, bill_date, apply_vat }
    const [lines, setLines] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(null);

    useEffect(() => {
        authFetch('/api/reports/ageing/meta').then(r => setSuppliers(r.data?.suppliers || [])).catch(() => {});
        authFetch('/api/products?pageSize=5000').then(r => setProducts(r.data || [])).catch(() => {});
        authFetch('/api/product-units').then(r => setUnits(r.data || [])).catch(() => {});
    }, [authFetch]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const pick = f => {
        setError(''); setResult(null); setDone(null);
        if (!f) return;
        if (!/^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/.test(f.type)) { setError('Choose a JPG, PNG, WEBP or PDF file'); return; }
        if (f.size > 20 * 1024 * 1024) { setError('File too large - keep it under 20 MB'); return; }
        setFile(f); setPreview(URL.createObjectURL(f));
    };
    const toLine = l => ({ ...l, choice: l.product_id ? (l.status === 'remembered' ? 'remembered' : 'suggested') : 'new', new_name: l.new_product.product_name, new_unit_id: l.new_product.unit_id || '', new_rate: l.rate });

    const read = async () => {
        if (!file) return;
        setReading(true); setError('');
        try {
            const data = await readFile(file);
            const res = (await authFetch('/api/purchase-bill-import/extract', { method: 'POST', body: JSON.stringify({ file_name: file.name, media_type: file.type, data }) })).data;
            setResult(res);
            setHead({ vendor_ledger_id: res.vendor.ledger_id || '', party_bill_no: res.bill.bill_no || '', bill_date: res.bill_date || '', apply_vat: Number(res.bill.vat_amount) > 0, vat_percent: 13 });
            setLines(res.lines.map(toLine));
        } catch (e) { setError(e.message); }
        finally { setReading(false); }
    };

    const changeVendor = async id => {
        setHead(h => ({ ...h, vendor_ledger_id: id }));
        if (!result) return;
        try {   // re-check remembered mappings for this vendor, keep lines the user already chose
            const res = (await authFetch('/api/purchase-bill-import/rematch', { method: 'POST', body: JSON.stringify({ vendor_ledger_id: id, items: result.bill.items }) })).data;
            setLines(ls => ls.map((l, i) => (['manual', 'create'].includes(l.choice) ? l : { ...toLine(res.lines[i]), qty: l.qty, rate: l.rate, discount_amount: l.discount_amount, unit_id: l.unit_id || res.lines[i].unit_id })));
        } catch { /* keep current lines */ }
    };
    const update = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    const productById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
    const unitsOfProduct = pid => (productById[pid]?.product_unit_rates || []).map(r => units.find(u => u.id === r.unit_id)).filter(Boolean);
    const setProduct = (i, pid, choice = 'manual') => {
        const p = productById[pid];
        const own = (p?.product_unit_rates || []).map(r => r.unit_id);
        update(i, { product_id: pid || null, choice: pid ? choice : 'new', unit_id: own.includes(lines[i].unit_id) ? lines[i].unit_id : p?.base_unit_id || lines[i].unit_id });
    };

    const ready = head && head.vendor_ledger_id && head.bill_date && lines.length > 0
        && lines.every(l => l.skip || (l.choice === 'create' ? l.new_name.trim() && l.new_unit_id : l.product_id));
    const lineAmount = l => Math.round(((Number(l.qty) || 0) * (Number(l.rate) || 0) - (Number(l.discount_amount) || 0)) * 100) / 100;
    const total = lines.filter(l => !l.skip).reduce((s, l) => s + lineAmount(l), 0);

    const create = async () => {
        if (!ready) return;
        setSaving(true); setError('');
        try {
            const out = [...lines];
            for (let i = 0; i < out.length; i++) {
                const l = out[i];
                if (l.skip || l.choice !== 'create') continue;
                const res = await authFetch('/api/products', { method: 'POST', body: JSON.stringify({
                    product_name: l.new_name.trim(), base_unit_id: l.new_unit_id, item_type: 'trading_item', hs_code: l.hs_code || null,
                    tags: [l.description].filter(Boolean), unit_rates: [{ unit_id: l.new_unit_id, is_base_unit: true, conversion_factor: 1, purchase_rate: Number(l.new_rate) || 0 }]
                }) });
                out[i] = { ...l, product_id: res.data.id, unit_id: l.new_unit_id, choice: 'manual' };
            }
            setLines(out);
            const keep = out.filter(l => !l.skip);
            const bill = (await authFetch('/api/purchase-bills', { method: 'POST', body: JSON.stringify({
                doc_date: head.bill_date, status: 'draft', save_as_draft: true, vendor_ledger_id: head.vendor_ledger_id,
                party_bill_no: head.party_bill_no || null, party_bill_date: head.bill_date,
                narration: `Imported from ${file?.name || 'bill'}${result?.bill?.vendor_name ? ` - ${result.bill.vendor_name}` : ''}`,
                details: keep.map(l => ({ product_id: l.product_id, qty: Number(l.qty) || 0, uom_id: l.unit_id || productById[l.product_id]?.base_unit_id || null,
                    rate: Number(l.rate) || 0, discount_amount: Number(l.discount_amount) || 0, free_qty: Number(l.free_qty) || 0,
                    batch_no: l.batch_no || null, tax_percent: head.apply_vat ? Number(head.vat_percent) || 0 : 0 }))
            }) })).data;
            await authFetch('/api/purchase-bill-import/learn', { method: 'POST', body: JSON.stringify({ vendor_ledger_id: head.vendor_ledger_id,
                mappings: keep.map(l => ({ item_text: l.description, product_id: l.product_id, unit_id: l.unit_id })) }) }).catch(() => {});
            setDone({ doc_no: bill.doc_no, created: out.filter(l => l.choice === 'manual' && lines.find(x => x.index === l.index)?.choice === 'create').length });
        } catch (e) { setError(e.message); }
        finally { setSaving(false); }
    };

    const b = result?.bill;
    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">📷 Purchase Bill from Image / PDF</span></div>
            <div className="erp-tab-content">
                <div className="flex flex-wrap items-end gap-3 mb-3">
                    <div className="erp-field"><label className="erp-label">Supplier's bill (JPG, PNG, PDF)</label>
                        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => pick(e.target.files?.[0])} /></div>
                    <button className="erp-btn primary" disabled={!file || reading} onClick={read}>{reading ? 'Reading the bill…' : '🔎 Read bill'}</button>
                    {result && <span className="text-sm text-gray-600">{result.counts.remembered} remembered · {result.counts.suggested} suggested · {result.counts.new} look new</span>}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {result?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{result.warnings.join(' · ')}</p>}
                {done && (
                    <div className="mb-3 border rounded p-3 bg-green-50 text-sm text-green-800">
                        ✓ Draft Purchase Bill <b>{done.doc_no}</b> created{done.created ? ` with ${done.created} new product(s)` : ''}. Mappings remembered for this vendor.
                        <a href="/purchase-bill" className="ml-2 text-blue-600">Open Purchase Bills to review and post →</a>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {preview && (
                        <div className="lg:col-span-1 border rounded bg-gray-50 max-h-[80vh] overflow-auto">
                            {file?.type === 'application/pdf' ? <object data={preview} type="application/pdf" className="w-full h-[78vh]">PDF preview</object> : <img src={preview} alt="Bill" className="w-full" />}
                        </div>
                    )}
                    {result && head && (
                        <div className={preview ? 'lg:col-span-2' : 'lg:col-span-3'}>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                <div className="erp-field md:col-span-2"><label className="erp-label">Vendor <span className="req">*</span>
                                    <span className="hint"> {b.vendor_name}{b.vendor_pan ? ` · PAN ${b.vendor_pan}` : ''}{result.vendor.by ? ` · matched by ${result.vendor.by}` : ' · not matched'}</span></label>
                                    <SearchablePopupSelect listKey="bill_import_vendor" columns={[{ key: 'name', label: 'Supplier' }]} defaultVisibleKeys={['name']}
                                        items={suppliers} getId={s => s.id} getLabel={s => s.name} searchKeys={['name']} value={head.vendor_ledger_id} onChange={changeVendor} placeholder="Choose vendor" />
                                    {!result.vendor.ledger_id && result.vendor.candidates.length > 0 && (
                                        <div className="text-xs mt-1">Closest: {result.vendor.candidates.slice(0, 4).map(cnd => (
                                            <button key={cnd.id} className="text-blue-600 mr-2" onClick={() => changeVendor(cnd.id)}>{cnd.name} ({Math.round(cnd.score * 100)}%)</button>))}</div>
                                    )}</div>
                                <div className="erp-field"><label className="erp-label">Party Bill No</label><input className="erp-input" value={head.party_bill_no} onChange={e => setHead(h => ({ ...h, party_bill_no: e.target.value }))} /></div>
                                <div className="erp-field"><label className="erp-label">Bill Date <span className="req">*</span> {result.bill_date_bs && <span className="hint">(BS {result.bill_date_bs})</span>}</label>
                                    <input type="date" className="erp-input" value={head.bill_date} onChange={e => setHead(h => ({ ...h, bill_date: e.target.value }))} /></div>
                            </div>
                            <div className="flex flex-wrap gap-4 items-center text-sm mb-2">
                                <label className="flex items-center gap-2"><input type="checkbox" checked={head.apply_vat} onChange={e => setHead(h => ({ ...h, apply_vat: e.target.checked }))} /> VAT on lines</label>
                                {head.apply_vat && <label className="flex items-center gap-1">@ <input type="number" className="erp-input" style={{ width: 70 }} value={head.vat_percent} onChange={e => setHead(h => ({ ...h, vat_percent: e.target.value }))} /> %</label>}
                                <span className="text-gray-500">Bill: taxable {fmt2(b.taxable_amount || b.subtotal)} · VAT {fmt2(b.vat_amount)} · total {fmt2(b.grand_total)}</span>
                                {b.other_charges?.length > 0 && <span className="text-amber-700 text-xs">Other charges on the bill: {b.other_charges.map(x => `${x.name} ${fmt2(x.amount)}`).join(', ')} - add them as billing terms on the bill</span>}
                            </div>

                            <div className="overflow-x-auto">
                                <table className="erp-grid-table w-full text-sm">
                                    <thead><tr>
                                        <th className="text-left">On the bill</th><th className="text-left min-w-[260px]">Product</th><th className="text-right">Qty</th><th className="text-left">Unit</th>
                                        <th className="text-right">Rate</th><th className="text-right">Disc</th><th className="text-right">Amount</th><th />
                                    </tr></thead>
                                    <tbody>
                                        {lines.map((l, i) => {
                                            const st = STATUS[l.choice] || STATUS.manual;
                                            const pUnits = l.product_id ? unitsOfProduct(l.product_id) : units;
                                            return (
                                                <tr key={i} className={l.skip ? 'opacity-40' : ''}>
                                                    <td className="align-top">
                                                        <div className="font-medium">{l.description}</div>
                                                        <div className="text-[10px] text-gray-500">{l.qty} {l.unit_text} × {fmt2(l.rate)} = {fmt2(l.amount)}{l.product_code ? ` · code ${l.product_code}` : ''}</div>
                                                        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] ${st[1]}`}>{st[0]}</span>
                                                    </td>
                                                    <td className="align-top">
                                                        {l.choice === 'create' ? (
                                                            <div className="space-y-1 border rounded p-2 bg-purple-50">
                                                                <input className="erp-input" value={l.new_name} placeholder="Product name" onChange={e => update(i, { new_name: e.target.value })} />
                                                                <div className="flex gap-1">
                                                                    <select className="erp-select" value={l.new_unit_id} onChange={e => update(i, { new_unit_id: e.target.value, unit_id: e.target.value })}>
                                                                        <option value="">Base unit{l.new_product.unit_text ? ` (bill: ${l.new_product.unit_text})` : ''}</option>
                                                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                                    </select>
                                                                    <input type="number" className="erp-input" style={{ width: 90 }} value={l.new_rate} title="Purchase rate" onChange={e => update(i, { new_rate: e.target.value })} />
                                                                </div>
                                                                <button className="text-xs text-gray-600" onClick={() => update(i, { choice: l.product_id ? 'manual' : 'new' })}>← map to an existing product instead</button>
                                                            </div>
                                                        ) : (<>
                                                            {l.suggestions.length > 0 && (
                                                                <select className="erp-select mb-1" value={l.suggestions.some(s => s.product_id === l.product_id) ? l.product_id : ''} onChange={e => setProduct(i, e.target.value, 'manual')}>
                                                                    <option value="">{l.product_id ? '(other product chosen)' : 'Closest products…'}</option>
                                                                    {l.suggestions.map(s => <option key={s.product_id} value={s.product_id}>{s.product_name} · {Math.round(s.score * 100)}% {s.by}</option>)}
                                                                </select>
                                                            )}
                                                            <SearchablePopupSelect listKey="bill_import_product" columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]} defaultVisibleKeys={['product_name']}
                                                                items={products} getId={p => p.id} getLabel={p => p.product_name} searchKeys={['product_name', 'product_code', 'short_name']}
                                                                value={l.product_id || ''} onChange={id => setProduct(i, id)} placeholder="Search any product" />
                                                            <button className="text-xs text-purple-700 mt-1" onClick={() => update(i, { choice: 'create' })}>➕ Create new product from this line</button>
                                                        </>)}
                                                        {l.unit_warning && <div className="text-[10px] text-amber-700">{l.unit_warning}</div>}
                                                    </td>
                                                    <td className="align-top"><input type="number" className="erp-input text-right" style={{ width: 80 }} value={l.qty} onChange={e => update(i, { qty: e.target.value })} /></td>
                                                    <td className="align-top">
                                                        {l.choice === 'create' ? <span className="text-xs text-gray-500">{units.find(u => u.id === l.new_unit_id)?.unit_name || '-'}</span> : (
                                                            <select className="erp-select" value={l.unit_id || ''} onChange={e => update(i, { unit_id: e.target.value })}>
                                                                <option value="">Base unit</option>{pUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                            </select>)}
                                                        {l.unit_text && <div className="text-[10px] text-gray-400">bill: {l.unit_text}</div>}
                                                    </td>
                                                    <td className="align-top"><input type="number" className="erp-input text-right" style={{ width: 90 }} value={l.rate} onChange={e => update(i, { rate: e.target.value })} /></td>
                                                    <td className="align-top"><input type="number" className="erp-input text-right" style={{ width: 70 }} value={l.discount_amount} onChange={e => update(i, { discount_amount: e.target.value })} /></td>
                                                    <td className="align-top text-right tabular-nums">{fmt2(lineAmount(l))}</td>
                                                    <td className="align-top"><button className="text-xs text-red-600" title={l.skip ? 'Include' : 'Leave this line out'} onClick={() => update(i, { skip: !l.skip })}>{l.skip ? '↺' : '✕'}</button></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot><tr className="font-bold bg-blue-50"><td colSpan={6} className="text-right">Lines total{head.apply_vat ? ' (before VAT)' : ''}</td><td className="text-right tabular-nums">{fmt2(total)}</td><td /></tr></tfoot>
                                </table>
                            </div>
                            <div className="flex items-center gap-3 mt-3">
                                <button className="erp-btn primary" disabled={!ready || saving || !!done} onClick={create}>{saving ? 'Creating…' : '🧾 Create Draft Purchase Bill'}</button>
                                {!ready && <span className="text-xs text-gray-500">Choose the vendor, bill date and a product (or new product) for every line.</span>}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
        </div>
        </Layout>
    );
}
