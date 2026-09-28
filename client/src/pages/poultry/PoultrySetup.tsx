// =============================================
// poultry/PoultrySetup.tsx  (/poultry/setup?tab=settings|items|sheds|standards)
// Poultry & Hatchery setup:
//   * Settings - consumption (P&L expense) ledger, production transfer
//     ledger, default farm warehouse, live-bird product and unit, stage days
//   * Items - which products are chicks, feed (kg per bag), medicine,
//     vaccine, litter, live birds, hatching eggs ...
//   * Sheds / hatchers - each gets its own cost center (SHD-<code>)
//   * Breed standards - body weight / cumulative feed by age (lifecycle chart)
// Server: routes/poultryRoutes.js, utils/poultry.js.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { SearchablePopupSelect, GroupBox, Msg, NavWindow, ROLE_LABEL, errText, useLookups } from '../../components/poultry/common';
import type { PItem, Shed } from '../../components/poultry/common';

const TABS: [string, string][] = [['settings', '⚙️ Settings'], ['items', '🐣 Poultry Items'], ['sheds', '🏠 Sheds / Hatchers'], ['standards', '📈 Breed Standards']];
interface Settings { consumption_ledger_id: string | null; transfer_ledger_id: string | null; default_warehouse_id: string | null; live_bird_product_id: string | null; live_bird_unit: 'kg' | 'bird'; brooding_days: number; grower_days: number; cycle_days: number; incubation_days: number; candling_day: number; transfer_day: number }
interface Std { age_day: number | string; body_weight_g: number | string | null; cum_feed_g: number | string | null; livability_pct: number | string | null }
const blankShed = (): Partial<Shed> => ({ shed_code: '', shed_name: '', shed_type: 'broiler', capacity: null, farm_name: '', location: '', supervisor: '', warehouse_id: null, is_active: true });
// Cobb 500 / Ross 308 as-hatched broiler guide (rounded) - a starting point the user can edit
const GUIDE: Std[] = [[0, 42, 0], [7, 190, 165], [14, 480, 560], [21, 950, 1220], [28, 1550, 2150], [35, 2200, 3300], [42, 2850, 4600]].map(([a, w, f]) => ({ age_day: a, body_weight_g: w, cum_feed_g: f, livability_pct: null }));

export default function PoultrySetup() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const tab = params.get('tab') || 'settings';
    const L = useLookups(authFetch, { ledgers: true });
    const [settings, setSettings] = useState<Settings | null>(null);
    const [items, setItems] = useState<PItem[]>([]);
    const [roles, setRoles] = useState<string[]>([]);
    const [sheds, setSheds] = useState<Shed[]>([]);
    const [shed, setShed] = useState<Partial<Shed> | null>(null);
    const [breed, setBreed] = useState('Cobb 500');
    const [std, setStd] = useState<Std[]>([]);
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        setErr('');
        try {
            const r = await authFetch<{ settings: Settings; items: PItem[]; roles: string[] }>('/api/poultry/settings');
            setSettings(r.data.settings); setItems(r.data.items); setRoles(r.data.roles);
            const s = await authFetch<Shed[]>('/api/poultry/sheds');
            setSheds(s.data);
        } catch (e) { setErr(errText(e)); }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (tab !== 'standards') return;
        authFetch<Std[]>(`/api/poultry/breed-standards?breed=${encodeURIComponent(breed)}`).then(r => setStd(r.data)).catch(e => setErr(errText(e)));
    }, [authFetch, tab, breed]);

    const run = async (fn: () => Promise<unknown>, done: string) => {
        setOk(''); setErr('');
        try { await fn(); setOk(done); await load(); } catch (e) { setErr(errText(e)); }
    };
    const setS = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(s => (s ? { ...s, [k]: v } : s));
    const ledgerPick = (label: string, k: 'consumption_ledger_id' | 'transfer_ledger_id', hint: string) => (
        <>
            <label className="nav-label">{label}</label>
            <div>
                <SearchablePopupSelect listKey={`poultry_${k}`} columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
                    items={L.ledgers} getId={(l: { id: string }) => l.id} getLabel={(l: { account_name: string }) => l.account_name} searchKeys={['account_name', 'account_code']}
                    value={settings?.[k] || ''} onChange={(v: string) => setS(k, v || null)} placeholder="Choose ledger" />
                <p className="text-[11px] text-gray-500">{hint}</p>
            </div>
        </>
    );
    const productPick = (value: string, onChange: (v: string) => void, key: string) => (
        <SearchablePopupSelect listKey={`poultry_prod_${key}`} columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]} defaultVisibleKeys={['product_name']}
            items={L.products} getId={(p: { id: string }) => p.id} getLabel={(p: { product_name: string }) => p.product_name} searchKeys={['product_name', 'product_code']}
            value={value} onChange={(v: string) => onChange(v || '')} placeholder="Choose product" />
    );

    return (
        <Layout>
            <NavWindow title="🐔 Poultry & Hatchery Setup" tools={<>
                {TABS.map(([k, l]) => <button key={k} type="button" className={`nav-tool-btn ${tab === k ? 'active' : ''}`} onClick={() => { setOk(''); setParams({ tab: k }); }}>{l}</button>)}
                <span className="nav-tool-sep" />
                <button type="button" className="nav-tool-btn" onClick={load}>🔄 Refresh</button>
            </>}>
                <Msg ok={ok} err={err} />

                {tab === 'settings' && settings && (
                    <>
                        <GroupBox title="Posting (accounts)">
                            <div className="nav-form-grid">
                                {ledgerPick('Consumption ledger', 'consumption_ledger_id', 'P&L expense - Dr when chicks / feed / medicine are issued to a shed')}
                                {ledgerPick('Production transfer', 'transfer_ledger_id', 'P&L - Cr when live birds / chicks come into stock (Dr when eggs go to the setter)')}
                            </div>
                            <p className="text-xs text-gray-600 mt-2">Issues and receipts are posted as Stock Adjustments (reason Consumption / Production) with the batch / shed cost center, so Trial Balance, P&L, stock and cost center reports all include poultry.</p>
                        </GroupBox>
                        <GroupBox title="Stock">
                            <div className="nav-form-grid">
                                <label className="nav-label required">Farm warehouse</label>
                                <select className="nav-select" value={settings.default_warehouse_id || ''} onChange={e => setS('default_warehouse_id', e.target.value || null)}>
                                    <option value="">—</option>{L.warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                </select>
                                <label className="nav-label">Live bird product</label>
                                {productPick(settings.live_bird_product_id || '', v => setS('live_bird_product_id', v || null), 'live')}
                                <label className="nav-label">Live birds counted in</label>
                                <select className="nav-select" value={settings.live_bird_unit} onChange={e => setS('live_bird_unit', e.target.value as 'kg' | 'bird')}>
                                    <option value="kg">Kg (live weight)</option><option value="bird">Birds (numbers)</option>
                                </select>
                            </div>
                        </GroupBox>
                        <GroupBox title="Stages & hatchery days">
                            <div className="nav-form-grid">
                                {([['cycle_days', 'Broiler cycle (days to lifting)'], ['brooding_days', 'Brooding up to day'], ['grower_days', 'Grower up to day'], ['incubation_days', 'Incubation days'], ['candling_day', 'Candling on day'], ['transfer_day', 'Transfer to hatcher on day']] as [keyof Settings, string][]).map(([k, l]) => (
                                    <React.Fragment key={k}>
                                        <label className="nav-label">{l}</label>
                                        <input type="number" className="nav-input" value={String(settings[k] ?? '')} onChange={e => setS(k, Number(e.target.value) as never)} />
                                    </React.Fragment>
                                ))}
                            </div>
                        </GroupBox>
                        <div className="flex justify-end"><button type="button" className="nav-btn primary" onClick={() => run(() => authFetch('/api/poultry/settings', { method: 'PUT', body: JSON.stringify(settings) }), 'Settings saved')}>💾 Save</button></div>
                    </>
                )}

                {tab === 'items' && (
                    <GroupBox title="Which product is what">
                        <p className="text-xs text-gray-600 mb-2">Mark the products used on the farm. Feed must have <b>kg per unit</b> (e.g. 50 for a 50 kg bag) so FCR is right.</p>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table" data-no-excel>
                                <thead><tr><th style={{ minWidth: 260 }}>Product</th><th>Role</th><th>Kg per unit</th><th /></tr></thead>
                                <tbody>
                                    {items.map((it, i) => (
                                        <tr key={i}>
                                            <td>{productPick(it.product_id, v => setItems(a => a.map((x, j) => (j === i ? { ...x, product_id: v } : x))), `item${i}`)}</td>
                                            <td><select className="nav-select" value={it.role} onChange={e => setItems(a => a.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                                                {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}</select></td>
                                            <td><input type="number" className="nav-input" style={{ width: 110 }} value={it.kg_per_unit ?? ''} onChange={e => setItems(a => a.map((x, j) => (j === i ? { ...x, kg_per_unit: e.target.value === '' ? null : Number(e.target.value) } : x)))} /></td>
                                            <td><button type="button" className="nav-btn small danger" onClick={() => setItems(a => a.filter((_, j) => j !== i))}>✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex gap-2 mt-2">
                            <button type="button" className="nav-btn" onClick={() => setItems(a => [...a, { product_id: '', role: 'feed', kg_per_unit: null }])}>➕ Add row</button>
                            <button type="button" className="nav-btn primary ml-auto" onClick={() => run(() => authFetch('/api/poultry/items', { method: 'PUT', body: JSON.stringify({ items: items.filter(x => x.product_id) }) }), 'Items saved')}>💾 Save</button>
                        </div>
                    </GroupBox>
                )}

                {tab === 'sheds' && (
                    <>
                        <div className="flex mb-2"><button type="button" className="nav-btn primary" onClick={() => setShed(blankShed())}>➕ New shed / hatcher</button></div>
                        {shed && (
                            <GroupBox title={shed.id ? `Edit ${shed.shed_code}` : 'New shed / hatcher'}>
                                <div className="nav-form-grid">
                                    <label className="nav-label required">Code</label>
                                    <input className={`nav-input ${shed.id ? 'code' : ''}`} readOnly={!!shed.id} value={shed.shed_code || ''} onChange={e => setShed({ ...shed, shed_code: e.target.value.toUpperCase() })} />
                                    <label className="nav-label required">Name</label>
                                    <input className="nav-input" value={shed.shed_name || ''} onChange={e => setShed({ ...shed, shed_name: e.target.value })} />
                                    <label className="nav-label">Type</label>
                                    <select className="nav-select" value={shed.shed_type} disabled={!!shed.id} onChange={e => setShed({ ...shed, shed_type: e.target.value as Shed['shed_type'] })}>
                                        <option value="broiler">Broiler shed</option><option value="hatchery">Hatchery / setter</option>
                                    </select>
                                    <label className="nav-label">Capacity (birds / eggs)</label>
                                    <input type="number" className="nav-input" value={shed.capacity ?? ''} onChange={e => setShed({ ...shed, capacity: e.target.value === '' ? null : Number(e.target.value) })} />
                                    <label className="nav-label">Farm</label>
                                    <input className="nav-input" value={shed.farm_name || ''} onChange={e => setShed({ ...shed, farm_name: e.target.value })} />
                                    <label className="nav-label">Location</label>
                                    <input className="nav-input" value={shed.location || ''} onChange={e => setShed({ ...shed, location: e.target.value })} />
                                    <label className="nav-label">Area (sq ft)</label>
                                    <input type="number" className="nav-input" value={shed.area_sqft ?? ''} onChange={e => setShed({ ...shed, area_sqft: e.target.value === '' ? null : Number(e.target.value) })} />
                                    <label className="nav-label">Supervisor</label>
                                    <input className="nav-input" value={shed.supervisor || ''} onChange={e => setShed({ ...shed, supervisor: e.target.value })} />
                                    <label className="nav-label">Warehouse</label>
                                    <select className="nav-select" value={shed.warehouse_id || ''} onChange={e => setShed({ ...shed, warehouse_id: e.target.value || null })}>
                                        <option value="">Farm warehouse (settings)</option>{L.warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                    </select>
                                    <label className="nav-label">Active</label>
                                    <label className="nav-check"><input type="checkbox" checked={shed.is_active !== false} onChange={e => setShed({ ...shed, is_active: e.target.checked })} /> In use</label>
                                </div>
                                <div className="flex gap-2 justify-end mt-3">
                                    <button type="button" className="nav-btn" onClick={() => setShed(null)}>Cancel</button>
                                    <button type="button" className="nav-btn primary" onClick={() => run(async () => {
                                        await authFetch(shed.id ? `/api/poultry/sheds/${shed.id}` : '/api/poultry/sheds', { method: shed.id ? 'PUT' : 'POST', body: JSON.stringify(shed) });
                                        setShed(null);
                                    }, 'Shed saved')}>💾 Save</button>
                                </div>
                            </GroupBox>
                        )}
                        <table className="erp-grid-table">
                            <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Farm</th><th className="text-right">Capacity</th><th>Running batch</th><th>Status</th><th /></tr></thead>
                            <tbody>
                                {sheds.map(s => (
                                    <tr key={s.id}>
                                        <td className="font-mono">{s.shed_code}</td><td>{s.shed_name}</td><td>{s.shed_type === 'hatchery' ? 'Hatchery' : 'Broiler'}</td><td>{s.farm_name || ''}</td>
                                        <td className="text-right">{s.capacity ?? ''}</td>
                                        <td>{s.active_batch ? <a className="text-blue-700 underline" href={`/poultry/batches?id=${s.active_batch.id}`}>{s.active_batch.batch_no}</a> : (s.shed_type === 'broiler' ? 'Empty' : '')}</td>
                                        <td>{s.is_active ? 'Active' : 'Inactive'}</td>
                                        <td><button type="button" className="nav-btn small" onClick={() => setShed(s)}>Edit</button></td>
                                    </tr>
                                ))}
                                {sheds.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-4">No sheds yet.</td></tr>}
                            </tbody>
                        </table>
                    </>
                )}

                {tab === 'standards' && (
                    <GroupBox title="Breed standard (target by age)">
                        <div className="flex flex-wrap gap-2 items-center mb-2">
                            <label className="nav-label">Breed</label>
                            <input className="nav-input" style={{ width: 200 }} value={breed} onChange={e => setBreed(e.target.value)} />
                            {std.length === 0 && <button type="button" className="nav-btn" onClick={() => setStd(GUIDE)}>Fill a typical broiler guide</button>}
                        </div>
                        <table className="erp-grid-table" data-no-excel>
                            <thead><tr><th>Age (day)</th><th>Body weight (g)</th><th>Cumulative feed (g / bird)</th><th>Livability %</th><th /></tr></thead>
                            <tbody>
                                {std.map((r, i) => (
                                    <tr key={i}>
                                        {(['age_day', 'body_weight_g', 'cum_feed_g', 'livability_pct'] as (keyof Std)[]).map(k => (
                                            <td key={k}><input type="number" className="nav-input" value={r[k] ?? ''} onChange={e => setStd(a => a.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>
                                        ))}
                                        <td><button type="button" className="nav-btn small danger" onClick={() => setStd(a => a.filter((_, j) => j !== i))}>✕</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex gap-2 mt-2">
                            <button type="button" className="nav-btn" onClick={() => setStd(a => [...a, { age_day: a.length ? Number(a[a.length - 1].age_day) + 7 : 0, body_weight_g: '', cum_feed_g: '', livability_pct: '' }])}>➕ Add age</button>
                            <button type="button" className="nav-btn primary ml-auto" onClick={() => run(() => authFetch('/api/poultry/breed-standards', { method: 'PUT', body: JSON.stringify({ breed, rows: std }) }), 'Breed standard saved')}>💾 Save</button>
                        </div>
                    </GroupBox>
                )}
            </NavWindow>
        </Layout>
    );
}
