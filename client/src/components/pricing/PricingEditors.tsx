// =============================================
// components/pricing/PricingEditors.tsx
// The three pricing masters of Pricing (Master Data > Rate & Discount):
//   RateTypesEditor        - Sr1..Sr5 fixed: caption + enable. Product Master
//                            shows only enabled ones, labelled by caption.
//   RateCategoryEditor     - unlimited categories: Sr tier + own rows
//                            (serial, product, unit, rate)
//   DiscountCategoryEditor - payment term, effect on rate, rules (serial,
//                            product, unit, Qty / Value, From, To, % /
//                            Rate per Qty / Fixed amount)
// Server: routes/salesPricingRoutes.js, utils/pricing.js.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Msg, SearchablePopupSelect, errText } from '../poultry/common';
import type { Product, Unit } from '../poultry/common';

export interface RateType { sr: number; caption: string; enabled: boolean }
interface RateCat { id?: string; category_name: string; description: string | null; sr_tier: number; is_active: boolean; items?: CatItem[] }
interface CatItem { product_id: string; unit_id: string | null; rate: number | string }
interface DiscCat { id?: string; group_name: string; description: string | null; payment_term: string; effect_on_rate: boolean; is_active: boolean; rules?: Rule[] }
interface Rule { product_id: string | null; unit_id: string | null; basis: 'qty' | 'value'; from_value: number | string; to_value: number | string | null; discount_percent: number | string | null; rate_per_qty: number | string | null; fixed_amount: number | string | null }

const TERMS: [string, string][] = [['any', 'Any (cash or credit)'], ['cash', 'Cash'], ['credit', 'Credit (any days)'], ['credit_15', 'Credit 15 Days'], ['credit_30', 'Credit 30 Days'], ['credit_60', 'Credit 60 Days'], ['advance', 'Advance']];
const v = (x: unknown) => (x === null || x === undefined ? '' : String(x));

function useProductsUnits(authFetch: AuthFetch) {
    const [products, setProducts] = useState<Product[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    useEffect(() => {
        authFetch<Product[]>('/api/products').then(r => setProducts(r.data || [])).catch(() => undefined);
        authFetch<Unit[]>('/api/product-units').then(r => setUnits(r.data || [])).catch(() => undefined);
    }, [authFetch]);
    const unitsOf = (pid: string | null): Unit[] => {
        const p = products.find(x => x.id === pid);
        if (!p) return units;
        const ids = [p.base_unit_id, ...(p.product_unit_rates || []).map(r => r.unit_id)].filter((id, i, a) => id && a.indexOf(id) === i);
        return ids.map(id => units.find(u => u.id === id) || { id, unit_name: '?' });
    };
    return { products, units, unitsOf };
}

function ProductPick({ products, value, onChange, k, allowAll }: { products: Product[]; value: string | null; onChange: (id: string) => void; k: string; allowAll?: boolean }) {
    return (
        <SearchablePopupSelect listKey={`pricing_${k}`} columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]} defaultVisibleKeys={['product_name']}
            items={products} getId={p => p.id} getLabel={p => p.product_name} searchKeys={['product_name', 'product_code']}
            value={value || ''} onChange={id => onChange(id || '')} placeholder={allowAll ? 'All products' : 'Choose product'} />
    );
}

// ---------------------------------------------------------------- rate types
export function RateTypesEditor() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [rows, setRows] = useState<RateType[]>([]);
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    useEffect(() => { authFetch<RateType[]>('/api/rate-types').then(r => setRows(r.data)).catch(e => setErr(errText(e))); }, [authFetch]);
    const save = async () => {
        setOk(''); setErr('');
        try { const r = await authFetch<RateType[]>('/api/rate-types', { method: 'PUT', body: JSON.stringify({ rate_types: rows }) }); setRows(r.data); setOk('Rate types saved - Product Master now shows these captions'); } catch (e) { setErr(errText(e)); }
    };
    return (
        <GroupBox title="Multiple Rate Type (Sr1 - Sr5)">
            <p className="text-xs text-gray-600 mb-2">Sr1 to Sr5 are fixed. Change the caption and switch on the ones you use - only enabled rate types appear in Product Master, with this caption as the label.</p>
            <Msg ok={ok} err={err} />
            <table className="erp-grid-table" style={{ maxWidth: 640 }} data-no-excel>
                <thead><tr><th style={{ width: 60 }}>Sr</th><th>Caption</th><th style={{ width: 90 }}>Enable</th></tr></thead>
                <tbody>{rows.map((r, i) => (
                    <tr key={r.sr}>
                        <td className="font-mono font-semibold">Sr{r.sr}</td>
                        <td><input className="nav-input" value={r.caption} onChange={e => setRows(a => a.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} /></td>
                        <td className="text-center"><input type="checkbox" checked={r.enabled} onChange={e => setRows(a => a.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} /></td>
                    </tr>
                ))}</tbody>
            </table>
            <div className="mt-3"><button type="button" className="nav-btn primary" onClick={save}>💾 Save Rate Types</button></div>
        </GroupBox>
    );
}

// ---------------------------------------------------------------- rate category
export function RateCategoryEditor({ onChanged }: { onChanged?: () => void }) {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const PU = useProductsUnits(authFetch);
    const [list, setList] = useState<RateCat[]>([]);
    const [types, setTypes] = useState<RateType[]>([]);
    const [cat, setCat] = useState<RateCat | null>(null);
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        try { setList((await authFetch<RateCat[]>('/api/rate-categories')).data || []); } catch (e) { setErr(errText(e)); }
    }, [authFetch]);
    useEffect(() => { load(); authFetch<RateType[]>('/api/rate-types').then(r => setTypes(r.data)).catch(() => undefined); }, [load, authFetch]);
    const open = async (id?: string, keepMsg = false) => {
        if (!keepMsg) { setOk(''); setErr(''); }
        if (!id) { setCat({ category_name: '', description: '', sr_tier: types.find(t => t.enabled)?.sr || 1, is_active: true, items: [] }); return; }
        try { setCat((await authFetch<RateCat>(`/api/rate-categories/${id}`)).data); } catch (e) { setErr(errText(e)); }
    };
    const save = async () => {
        if (!cat) return;
        setOk(''); setErr('');
        if (!cat.category_name.trim()) { setErr('Category name is required'); return; }
        try {
            const body = JSON.stringify({ category_name: cat.category_name.trim(), description: cat.description, sr_tier: Number(cat.sr_tier), is_active: cat.is_active, items: (cat.items || []).filter(x => x.product_id) });
            const r = cat.id ? await authFetch<RateCat>(`/api/rate-categories/${cat.id}`, { method: 'PUT', body }) : await authFetch<RateCat>('/api/rate-categories', { method: 'POST', body });
            setOk('Rate category saved');
            await load(); onChanged?.();
            await open(r.data.id, true);
        } catch (e) { setErr(errText(e)); }
    };
    const del = async (c: RateCat) => {
        if (!window.confirm(`Delete rate category "${c.category_name}"?`)) return;
        try { await authFetch(`/api/rate-categories/${c.id}`, { method: 'DELETE' }); setCat(null); await load(); onChanged?.(); } catch (e) { setErr(errText(e)); }
    };
    const setItem = (i: number, p: Partial<CatItem>) => setCat(c => (c ? { ...c, items: (c.items || []).map((x, j) => (j === i ? { ...x, ...p } : x)) } : c));
    const caption = (sr: number) => types.find(t => t.sr === sr)?.caption || `Sr${sr}`;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-3">
            <GroupBox title="Rate Categories">
                <button type="button" className="nav-btn primary w-full mb-2" onClick={() => open()}>➕ New category</button>
                {list.map(c => (
                    <button key={c.id} type="button" className={`nav-navitem w-full text-left ${cat?.id === c.id ? 'active' : ''}`} style={{ paddingLeft: 10 }} onClick={() => open(c.id)}>
                        {c.category_name} <span className="text-[10px] opacity-70">({caption(c.sr_tier)}){c.is_active ? '' : ' · off'}</span>
                    </button>
                ))}
                {list.length === 0 && <p className="text-xs text-gray-500">None yet.</p>}
            </GroupBox>
            <div className="min-w-0">
                <Msg ok={ok} err={err} />
                {!cat && <p className="text-sm text-gray-500 mt-4">Choose a category or make a new one. A customer gets a Rate Category on their ledger.</p>}
                {cat && (
                    <>
                        <GroupBox title="Category Details">
                            <div className="nav-form-grid">
                                <label className="nav-label required">Category Name</label>
                                <input className="nav-input" value={cat.category_name} onChange={e => setCat({ ...cat, category_name: e.target.value })} placeholder="e.g. Customer Type A" />
                                <label className="nav-label">Other products use</label>
                                <select className="nav-select" value={cat.sr_tier} onChange={e => setCat({ ...cat, sr_tier: Number(e.target.value) })}>
                                    {types.map(t => <option key={t.sr} value={t.sr} disabled={!t.enabled}>{t.caption}{t.enabled ? '' : ' (disabled)'}</option>)}
                                </select>
                                <label className="nav-label">Description</label>
                                <input className="nav-input" value={v(cat.description)} onChange={e => setCat({ ...cat, description: e.target.value })} />
                                <label className="nav-label">Active</label>
                                <label className="nav-check"><input type="checkbox" checked={cat.is_active} onChange={e => setCat({ ...cat, is_active: e.target.checked })} /> In use</label>
                            </div>
                        </GroupBox>
                        <GroupBox title="Products & Rates">
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table" data-no-excel>
                                    <thead><tr><th style={{ width: 60 }}>Serial</th><th style={{ minWidth: 240 }}>Product</th><th>Unit</th><th>Rate</th><th /></tr></thead>
                                    <tbody>{(cat.items || []).map((it, i) => (
                                        <tr key={i}>
                                            <td>{i + 1}</td>
                                            <td><ProductPick products={PU.products} value={it.product_id} k={`rc${i}`} onChange={id => setItem(i, { product_id: id, unit_id: PU.products.find(p => p.id === id)?.base_unit_id || null })} /></td>
                                            <td><select className="nav-select" value={v(it.unit_id)} onChange={e => setItem(i, { unit_id: e.target.value || null })}>{PU.unitsOf(it.product_id).map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select></td>
                                            <td><input type="number" className="nav-input text-right" style={{ width: 120 }} value={v(it.rate)} onChange={e => setItem(i, { rate: e.target.value })} /></td>
                                            <td><button type="button" className="nav-btn small danger" onClick={() => setCat({ ...cat, items: (cat.items || []).filter((_, j) => j !== i) })}>✕</button></td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">Products listed here get this rate; every other product gets its “{caption(cat.sr_tier)}”.</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                                <button type="button" className="nav-btn" onClick={() => setCat({ ...cat, items: [...(cat.items || []), { product_id: '', unit_id: null, rate: '' }] })}>➕ Add Product</button>
                                {cat.id && <button type="button" className="nav-btn danger" onClick={() => del(cat)}>🗑 Delete</button>}
                                <button type="button" className="nav-btn ml-auto" onClick={() => open(cat.id)}>Reset</button>
                                <button type="button" className="nav-btn primary" onClick={save}>💾 Save Category</button>
                            </div>
                        </GroupBox>
                    </>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- discount category
const blankRule = (): Rule => ({ product_id: '', unit_id: null, basis: 'qty', from_value: '', to_value: '', discount_percent: '', rate_per_qty: '', fixed_amount: '' });

export function DiscountCategoryEditor({ onChanged }: { onChanged?: () => void }) {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const PU = useProductsUnits(authFetch);
    const [list, setList] = useState<DiscCat[]>([]);
    const [cat, setCat] = useState<DiscCat | null>(null);
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        try { setList((await authFetch<DiscCat[]>('/api/discount-groups')).data || []); } catch (e) { setErr(errText(e)); }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);
    const open = async (id?: string, keepMsg = false) => {
        if (!keepMsg) { setOk(''); setErr(''); }
        if (!id) { setCat({ group_name: '', description: '', payment_term: 'any', effect_on_rate: false, is_active: true, rules: [blankRule()] }); return; }
        try { setCat((await authFetch<DiscCat>(`/api/discount-groups/${id}`)).data); } catch (e) { setErr(errText(e)); }
    };
    const save = async () => {
        if (!cat) return;
        setOk(''); setErr('');
        if (!cat.group_name.trim()) { setErr('Category name is required'); return; }
        try {
            const body = JSON.stringify({ group_name: cat.group_name.trim(), description: cat.description, payment_term: cat.payment_term, effect_on_rate: cat.effect_on_rate, is_active: cat.is_active, rules: cat.rules || [] });
            const r = cat.id ? await authFetch<DiscCat>(`/api/discount-groups/${cat.id}`, { method: 'PUT', body }) : await authFetch<DiscCat>('/api/discount-groups', { method: 'POST', body });
            setOk('Discount category saved');
            await load(); onChanged?.();
            await open(r.data.id, true);
        } catch (e) { setErr(errText(e)); }
    };
    const del = async (c: DiscCat) => {
        if (!window.confirm(`Delete discount category "${c.group_name}"?`)) return;
        try { await authFetch(`/api/discount-groups/${c.id}`, { method: 'DELETE' }); setCat(null); await load(); onChanged?.(); } catch (e) { setErr(errText(e)); }
    };
    const setRule = (i: number, p: Partial<Rule>) => setCat(c => (c ? { ...c, rules: (c.rules || []).map((x, j) => (j === i ? { ...x, ...p } : x)) } : c));
    // one benefit per rule: typing in one clears the other two
    const benefit = (i: number, k: 'discount_percent' | 'rate_per_qty' | 'fixed_amount', val: string) =>
        setRule(i, { discount_percent: '', rate_per_qty: '', fixed_amount: '', [k]: val });

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-3">
            <GroupBox title="Discount Categories">
                <button type="button" className="nav-btn primary w-full mb-2" onClick={() => open()}>➕ New category</button>
                {list.map(c => (
                    <button key={c.id} type="button" className={`nav-navitem w-full text-left ${cat?.id === c.id ? 'active' : ''}`} style={{ paddingLeft: 10 }} onClick={() => open(c.id)}>
                        {c.group_name} <span className="text-[10px] opacity-70">({TERMS.find(t => t[0] === c.payment_term)?.[1] || 'Any'})</span>
                    </button>
                ))}
                {list.length === 0 && <p className="text-xs text-gray-500">None yet.</p>}
            </GroupBox>
            <div className="min-w-0">
                <Msg ok={ok} err={err} />
                {!cat && <p className="text-sm text-gray-500 mt-4">Choose a category or make a new one. A customer gets a Discount Category on their ledger.</p>}
                {cat && (
                    <>
                        <GroupBox title="Discount Category Details">
                            <div className="nav-form-grid">
                                <label className="nav-label required">Category Name</label>
                                <input className="nav-input" value={cat.group_name} onChange={e => setCat({ ...cat, group_name: e.target.value })} placeholder="e.g. Normal Discount" />
                                <label className="nav-label">Billing Term</label>
                                <select className="nav-select" value={cat.payment_term} onChange={e => setCat({ ...cat, payment_term: e.target.value })}>{TERMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                                <label className="nav-label">Effect On Rate</label>
                                <label className="nav-check"><input type="checkbox" checked={cat.effect_on_rate} onChange={e => setCat({ ...cat, effect_on_rate: e.target.checked })} /> Yes - show the net rate (discount taken off the sales rate)</label>
                                <label className="nav-label">Description</label>
                                <input className="nav-input" value={v(cat.description)} onChange={e => setCat({ ...cat, description: e.target.value })} />
                            </div>
                            <p className="text-xs text-gray-600 mt-2">Billing term: a Cash category applies to customers without credit days; Credit 30 applies to customers with up to 30 credit days.</p>
                        </GroupBox>
                        <GroupBox title="Discount Rules">
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table" data-no-excel style={{ minWidth: 980 }}>
                                    <thead><tr><th style={{ width: 50 }}>Serial</th><th style={{ minWidth: 220 }}>Product</th><th>Unit</th><th>Qty / Value</th><th>From</th><th>To</th><th>%</th><th>Rate/Qty</th><th>Fixed Amt</th><th /></tr></thead>
                                    <tbody>{(cat.rules || []).map((r, i) => (
                                        <tr key={i}>
                                            <td>{i + 1}</td>
                                            <td><ProductPick products={PU.products} value={r.product_id} k={`dr${i}`} allowAll onChange={id => setRule(i, { product_id: id || null, unit_id: PU.products.find(p => p.id === id)?.base_unit_id || null })} /></td>
                                            <td><select className="nav-select" value={v(r.unit_id)} onChange={e => setRule(i, { unit_id: e.target.value || null })}><option value="">Any</option>{PU.unitsOf(r.product_id).map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select></td>
                                            <td><select className="nav-select" value={r.basis} onChange={e => setRule(i, { basis: e.target.value as Rule['basis'] })}><option value="qty">Qty</option><option value="value">Value</option></select></td>
                                            <td><input type="number" className="nav-input text-right" style={{ width: 90 }} value={v(r.from_value)} onChange={e => setRule(i, { from_value: e.target.value })} /></td>
                                            <td><input type="number" className="nav-input text-right" style={{ width: 90 }} placeholder="∞" value={v(r.to_value)} onChange={e => setRule(i, { to_value: e.target.value })} /></td>
                                            <td><input type="number" className="nav-input text-right" style={{ width: 70 }} value={v(r.discount_percent)} onChange={e => benefit(i, 'discount_percent', e.target.value)} /></td>
                                            <td><input type="number" className="nav-input text-right" style={{ width: 90 }} value={v(r.rate_per_qty)} onChange={e => benefit(i, 'rate_per_qty', e.target.value)} /></td>
                                            <td><input type="number" className="nav-input text-right" style={{ width: 100 }} value={v(r.fixed_amount)} onChange={e => benefit(i, 'fixed_amount', e.target.value)} /></td>
                                            <td><button type="button" className="nav-btn small danger" onClick={() => setCat({ ...cat, rules: (cat.rules || []).filter((_, j) => j !== i) })}>✕</button></td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">Each rule gives one of: % off, Rs off per qty, or a fixed amount off the line. When several fit, a rule for the product beats an “all products” rule, then the bigger discount wins. Qty slabs are counted in the rule's unit (1 Crt = 12 Pcs counts as 12 Pcs).</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                                <button type="button" className="nav-btn" onClick={() => setCat({ ...cat, rules: [...(cat.rules || []), blankRule()] })}>➕ Add Rule</button>
                                {cat.id && <button type="button" className="nav-btn danger" onClick={() => del(cat)}>🗑 Delete</button>}
                                <button type="button" className="nav-btn ml-auto" onClick={() => open(cat.id)}>Reset</button>
                                <button type="button" className="nav-btn primary" onClick={save}>💾 Save</button>
                            </div>
                        </GroupBox>
                    </>
                )}
            </div>
        </div>
    );
}
