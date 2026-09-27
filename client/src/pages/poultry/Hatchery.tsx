// =============================================
// poultry/Hatchery.tsx  (/poultry/hatchery?tab=list|report&status=&new=1&id=)
// Hatchery: egg setting (eggs issued from stock to the setter) -> candling
// (infertile / early dead / cracked) -> hatch (A-grade chicks into stock at
// the computed chick cost, B-grade and infertile eggs as by-products).
// Fertility, hatchability, hatch-of-fertile and cost per chick.
// Server: utils/hatchery.js.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Kpi, Msg, NavWindow, errText, n0, n2, pct, today, useLookups } from '../../components/poultry/common';
import type { PItem, Shed } from '../../components/poultry/common';

interface Hatch {
    id: string; hatch_no: string; hatchery_id: string; hatchery_name?: string; setter_no: string | null; egg_source: string | null; set_date: string; eggs_set: number; status: 'set' | 'candled' | 'hatched' | 'cancelled';
    infertile: number; early_dead: number; cracked: number; candling_date: string | null; transfer_date: string | null; chicks_a: number; chicks_b: number; dead_in_shell: number; hatch_date: string | null;
    fertile: number; hatched: number; fertility_pct: number | null; hatchability_pct: number | null; saleable_pct: number | null; hof_pct: number | null; early_dead_pct: number | null; dead_in_shell_pct: number | null; unaccounted: number;
    expected_candling: string; expected_transfer: string; expected_hatch: string; remarks: string | null;
    cost?: { eggs: number; direct_expenses: number; hatchery_share: number; total: number; by_products: number; chick_cost: number | null }; set_adjustment_no?: string | null; output_adjustment_no?: string | null;
}
const STATUS_LABEL: Record<string, string> = { set: 'In setter', candled: 'Candled', hatched: 'Hatched', cancelled: 'Cancelled' };

export default function Hatchery() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const id = params.get('id');
    const tab = params.get('tab') || 'list';
    const status = params.get('status') || '';
    const L = useLookups(authFetch);
    const [rows, setRows] = useState<Hatch[]>([]);
    const [h, setH] = useState<Hatch | null>(null);
    const [hatcheries, setHatcheries] = useState<Shed[]>([]);
    const [items, setItems] = useState<PItem[]>([]);
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const [warn, setWarn] = useState<string[]>([]);
    const [setForm, setSetForm] = useState({ hatchery_id: '', setter_no: '', egg_source: '', set_date: today(), eggs_set: '', egg_product_id: '', egg_cost_manual: '', warehouse_id: '', remarks: '' });
    const [cand, setCand] = useState({ candling_date: today(), infertile: '', early_dead: '', cracked: '', transfer_date: '' });
    const [hf, setHf] = useState({ hatch_date: today(), chicks_a: '', chicks_b: '', dead_in_shell: '', chick_product_id: '', chick_b_product_id: '', chick_b_rate: '', infertile_product_id: '', infertile_rate: '', output_warehouse_id: '' });

    const loadList = useCallback(async () => {
        try { setRows((await authFetch<Hatch[]>(`/api/poultry/hatches${status ? `?status=${status}` : ''}`)).data); } catch (e) { setErr(errText(e)); }
    }, [authFetch, status]);
    const loadOne = useCallback(async () => {
        if (!id) { setH(null); return; }
        try { setH((await authFetch<Hatch>(`/api/poultry/hatches/${id}`)).data); } catch (e) { setErr(errText(e)); }
    }, [authFetch, id]);
    useEffect(() => { if (!id) loadList(); }, [loadList, id]);
    useEffect(() => { loadOne(); }, [loadOne]);
    useEffect(() => {
        authFetch<Shed[]>('/api/poultry/sheds?shed_type=hatchery').then(r => setHatcheries(r.data)).catch(() => undefined);
        authFetch<{ items: PItem[] }>('/api/poultry/settings').then(r => setItems(r.data.items)).catch(() => undefined);
    }, [authFetch]);

    const byRole = (...roles: string[]) => items.filter(i => roles.includes(i.role));
    const act = async (url: string, body: unknown, done: string) => {
        setOk(''); setErr(''); setWarn([]);
        try {
            const r = await authFetch<Hatch & { warnings?: string[] }>(url, { method: 'POST', body: JSON.stringify(body) });
            if (r.data?.warnings?.length) setWarn(r.data.warnings);
            setOk(done);
            if (r.data?.id && r.data.id !== id) setParams({ id: r.data.id }); else await loadOne();
        } catch (e) { setErr(errText(e)); }
    };
    const report = useMemo(() => {
        const done = rows.filter(r => r.status === 'hatched');
        const by: Record<string, { name: string; hatches: number; set: number; infertile: number; a: number; b: number }> = {};
        done.forEach(r => {
            const k = r.hatchery_name || '—';
            by[k] = by[k] || { name: k, hatches: 0, set: 0, infertile: 0, a: 0, b: 0 };
            by[k].hatches += 1; by[k].set += r.eggs_set; by[k].infertile += r.infertile; by[k].a += r.chicks_a; by[k].b += r.chicks_b;
        });
        return { done, by: Object.values(by) };
    }, [rows]);
    const p = (a: number, b: number) => (b ? (a / b) * 100 : null);

    const opts = (list: PItem[]) => list.map(i => <option key={i.product_id} value={i.product_id}>{i.product_name}</option>);

    // ---------------------------------------------------------------- one hatch
    if (id && h) {
        return (
            <Layout>
                <NavWindow title={<>🥚 Hatch {h.hatch_no} · {h.hatchery_name || ''} <span className="font-normal">({STATUS_LABEL[h.status]})</span></>} tools={<>
                    <button type="button" className="nav-tool-btn" onClick={() => setParams({})}>← Hatches</button>
                    <button type="button" className="nav-tool-btn" onClick={loadOne}>🔄 Refresh</button>
                    <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
                </>}>
                    <Msg ok={ok} err={err} warn={warn} />
                    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                        <Kpi label="Eggs set" value={n0(h.eggs_set)} sub={`on ${h.set_date}`} />
                        <Kpi label="Fertility" tone="green" value={pct(h.fertility_pct)} sub={`${n0(h.infertile)} infertile`} />
                        <Kpi label="Hatchability" tone="orange" value={pct(h.hatchability_pct)} sub={`HOF ${pct(h.hof_pct)}`} />
                        <Kpi label="Chicks A / B" value={`${n0(h.chicks_a)} / ${n0(h.chicks_b)}`} sub={`dead in shell ${n0(h.dead_in_shell)}`} />
                        <Kpi label="Cost per chick" value={h.cost?.chick_cost === null || h.cost?.chick_cost === undefined ? '—' : n2(h.cost.chick_cost)} sub={`total ${n2(h.cost?.total)}`} />
                    </div>
                    <GroupBox title="Timeline">
                        <table className="erp-grid-table"><tbody>
                            <tr><td>Set</td><td>{h.set_date}</td><td>Stock doc {h.set_adjustment_no || '—'}</td></tr>
                            <tr><td>Candling</td><td>{h.candling_date || `due ${h.expected_candling}`}</td><td>{h.status !== 'set' ? `${n0(h.infertile)} infertile · ${n0(h.early_dead)} early dead · ${n0(h.cracked)} cracked` : ''}</td></tr>
                            <tr><td>Transfer to hatcher</td><td>{h.transfer_date || `due ${h.expected_transfer}`}</td><td /></tr>
                            <tr><td>Hatch</td><td>{h.hatch_date || `due ${h.expected_hatch}`}</td><td>{h.output_adjustment_no ? `Chicks into stock on ${h.output_adjustment_no}` : ''}</td></tr>
                        </tbody></table>
                    </GroupBox>
                    {h.cost && (
                        <GroupBox title="Chick cost">
                            <table className="erp-grid-table"><tbody>
                                <tr><td>Hatching eggs</td><td className="text-right">{n2(h.cost.eggs)}</td></tr>
                                <tr><td>Direct expenses (hatch cost center)</td><td className="text-right">{n2(h.cost.direct_expenses)}</td></tr>
                                <tr><td>Hatchery expenses share (by eggs in the setter)</td><td className="text-right">{n2(h.cost.hatchery_share)}</td></tr>
                                <tr><td>Less by-products (B-grade chicks, infertile eggs)</td><td className="text-right">-{n2(h.cost.by_products)}</td></tr>
                            </tbody><tfoot><tr><td>Net cost ÷ A-grade chicks</td><td className="text-right">{h.cost.chick_cost === null ? '—' : n2(h.cost.chick_cost)}</td></tr></tfoot></table>
                        </GroupBox>
                    )}
                    {h.status === 'set' && (
                        <GroupBox title="Candling">
                            <div className="nav-form-grid">
                                <label className="nav-label">Candling date</label><input type="date" className="nav-input" value={cand.candling_date} onChange={e => setCand({ ...cand, candling_date: e.target.value })} />
                                <label className="nav-label">Infertile (clear)</label><input type="number" className="nav-input" value={cand.infertile} onChange={e => setCand({ ...cand, infertile: e.target.value })} />
                                <label className="nav-label">Early dead</label><input type="number" className="nav-input" value={cand.early_dead} onChange={e => setCand({ ...cand, early_dead: e.target.value })} />
                                <label className="nav-label">Cracked</label><input type="number" className="nav-input" value={cand.cracked} onChange={e => setCand({ ...cand, cracked: e.target.value })} />
                                <label className="nav-label">Transfer date</label><input type="date" className="nav-input" value={cand.transfer_date} onChange={e => setCand({ ...cand, transfer_date: e.target.value })} />
                            </div>
                            <div className="flex justify-between mt-3">
                                <button type="button" className="nav-btn danger" onClick={() => window.confirm('Cancel this setting? The egg issue is reversed.') && act(`/api/poultry/hatches/${h.id}/cancel`, {}, 'Setting cancelled')}>Cancel setting</button>
                                <button type="button" className="nav-btn primary" onClick={() => act(`/api/poultry/hatches/${h.id}/candle`, cand, 'Candling saved')}>💾 Save candling</button>
                            </div>
                        </GroupBox>
                    )}
                    {h.status === 'candled' && (
                        <GroupBox title="Hatch (pull chicks)">
                            <div className="nav-form-grid">
                                <label className="nav-label">Hatch date</label><input type="date" className="nav-input" value={hf.hatch_date} onChange={e => setHf({ ...hf, hatch_date: e.target.value })} />
                                <label className="nav-label">A-grade chicks</label><input type="number" className="nav-input" value={hf.chicks_a} onChange={e => setHf({ ...hf, chicks_a: e.target.value })} />
                                <label className="nav-label">B-grade chicks</label><input type="number" className="nav-input" value={hf.chicks_b} onChange={e => setHf({ ...hf, chicks_b: e.target.value })} />
                                <label className="nav-label">Dead in shell</label><input type="number" className="nav-input" value={hf.dead_in_shell} onChange={e => setHf({ ...hf, dead_in_shell: e.target.value })} />
                                <label className="nav-label">A-grade chick product</label>
                                <select className="nav-select" value={hf.chick_product_id} onChange={e => setHf({ ...hf, chick_product_id: e.target.value })}><option value="">No stock entry</option>{opts(byRole('chick'))}</select>
                                <label className="nav-label">B-grade product / rate</label>
                                <div className="flex gap-1"><select className="nav-select" value={hf.chick_b_product_id} onChange={e => setHf({ ...hf, chick_b_product_id: e.target.value })}><option value="">—</option>{opts(byRole('chick', 'cull_bird', 'other'))}</select>
                                    <input type="number" className="nav-input" style={{ width: 90 }} placeholder="rate" value={hf.chick_b_rate} onChange={e => setHf({ ...hf, chick_b_rate: e.target.value })} /></div>
                                <label className="nav-label">Infertile egg product / rate</label>
                                <div className="flex gap-1"><select className="nav-select" value={hf.infertile_product_id} onChange={e => setHf({ ...hf, infertile_product_id: e.target.value })}><option value="">—</option>{opts(byRole('table_egg', 'other'))}</select>
                                    <input type="number" className="nav-input" style={{ width: 90 }} placeholder="rate" value={hf.infertile_rate} onChange={e => setHf({ ...hf, infertile_rate: e.target.value })} /></div>
                                <label className="nav-label">Into warehouse</label>
                                <select className="nav-select" value={hf.output_warehouse_id} onChange={e => setHf({ ...hf, output_warehouse_id: e.target.value })}><option value="">Hatchery / farm warehouse</option>{L.warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}</select>
                            </div>
                            <div className="flex justify-end mt-3"><button type="button" className="nav-btn primary" onClick={() => act(`/api/poultry/hatches/${h.id}/hatch`, hf, 'Hatch saved - chicks are in stock')}>🐣 Save hatch</button></div>
                        </GroupBox>
                    )}
                    {h.status === 'hatched' && <button type="button" className="nav-btn" onClick={() => window.confirm('Reopen? The chick receipt is reversed.') && act(`/api/poultry/hatches/${h.id}/reopen`, {}, 'Hatch reopened')}>↩ Reopen hatch</button>}
                </NavWindow>
            </Layout>
        );
    }

    // ---------------------------------------------------------------- list / report
    return (
        <Layout>
            <NavWindow wide title="🥚 Hatchery" tools={<>
                <button type="button" className={`nav-tool-btn ${tab === 'list' ? 'active' : ''}`} onClick={() => setParams({})}>📋 Settings</button>
                <button type="button" className={`nav-tool-btn ${tab === 'new' ? 'active' : ''}`} onClick={() => setParams({ tab: 'new' })}>➕ Set eggs</button>
                <button type="button" className={`nav-tool-btn ${tab === 'report' ? 'active' : ''}`} onClick={() => setParams({ tab: 'report' })}>📊 Performance</button>
                <span className="nav-tool-sep" />
                {tab === 'list' && ([['', 'All'], ['set', 'In setter'], ['candled', 'Candled'], ['hatched', 'Hatched']] as [string, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={`nav-tool-btn ${status === k ? 'active' : ''}`} onClick={() => setParams(k ? { status: k } : {})}>{l}</button>
                ))}
            </>}>
                <Msg ok={ok} err={err} warn={warn} />
                {tab === 'new' && (
                    <GroupBox title="Egg setting">
                        <div className="nav-form-grid">
                            <label className="nav-label required">Hatchery</label>
                            <select className="nav-select" value={setForm.hatchery_id} onChange={e => setSetForm({ ...setForm, hatchery_id: e.target.value })}><option value="">—</option>{hatcheries.filter(x => x.is_active).map(x => <option key={x.id} value={x.id}>{x.shed_name}</option>)}</select>
                            <label className="nav-label">Setter no.</label><input className="nav-input" value={setForm.setter_no} onChange={e => setSetForm({ ...setForm, setter_no: e.target.value })} />
                            <label className="nav-label required">Set date</label><input type="date" className="nav-input" value={setForm.set_date} onChange={e => setSetForm({ ...setForm, set_date: e.target.value })} />
                            <label className="nav-label required">Eggs set</label><input type="number" className="nav-input" value={setForm.eggs_set} onChange={e => setSetForm({ ...setForm, eggs_set: e.target.value })} />
                            <label className="nav-label">Hatching egg product</label>
                            <select className="nav-select" value={setForm.egg_product_id} onChange={e => setSetForm({ ...setForm, egg_product_id: e.target.value })}><option value="">No stock issue (cost by hand)</option>{opts(byRole('hatching_egg'))}</select>
                            {setForm.egg_product_id ? <>
                                <label className="nav-label">From warehouse</label>
                                <select className="nav-select" value={setForm.warehouse_id} onChange={e => setSetForm({ ...setForm, warehouse_id: e.target.value })}><option value="">Hatchery / farm warehouse</option>{L.warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}</select>
                            </> : <>
                                <label className="nav-label">Egg cost</label><input type="number" className="nav-input" value={setForm.egg_cost_manual} onChange={e => setSetForm({ ...setForm, egg_cost_manual: e.target.value })} />
                            </>}
                            <label className="nav-label">Egg source / flock</label><input className="nav-input" value={setForm.egg_source} onChange={e => setSetForm({ ...setForm, egg_source: e.target.value })} />
                            <label className="nav-label">Remarks</label><input className="nav-input" value={setForm.remarks} onChange={e => setSetForm({ ...setForm, remarks: e.target.value })} />
                        </div>
                        <div className="flex justify-end mt-3"><button type="button" className="nav-btn primary" onClick={() => act('/api/poultry/hatches', setForm, 'Eggs set')}>💾 Save setting</button></div>
                    </GroupBox>
                )}
                {tab === 'list' && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead><tr><th>Hatch</th><th>Hatchery</th><th>Setter</th><th>Set on</th><th className="text-right">Eggs</th><th>Status</th><th>Next</th><th className="text-right">Fertility</th><th className="text-right">Hatchability</th><th className="text-right">Chicks A</th></tr></thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.id} className="cursor-pointer" onClick={() => setParams({ id: r.id })}>
                                        <td className="font-mono text-blue-700 underline">{r.hatch_no}</td><td>{r.hatchery_name}</td><td>{r.setter_no || ''}</td><td>{r.set_date}</td><td className="text-right">{n0(r.eggs_set)}</td>
                                        <td>{STATUS_LABEL[r.status]}</td>
                                        <td>{r.status === 'set' ? `Candle ${r.expected_candling}` : r.status === 'candled' ? `Hatch ${r.expected_hatch}` : ''}</td>
                                        <td className="text-right">{pct(r.fertility_pct)}</td><td className="text-right">{pct(r.hatchability_pct)}</td><td className="text-right">{r.status === 'hatched' ? n0(r.chicks_a) : ''}</td>
                                    </tr>
                                ))}
                                {rows.length === 0 && <tr><td colSpan={10} className="text-center text-gray-500 py-6">Nothing here. Click “Set eggs”.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}
                {tab === 'report' && (
                    <>
                        <GroupBox title="By hatchery (hatched settings)">
                            <table className="erp-grid-table">
                                <thead><tr><th>Hatchery</th><th className="text-right">Hatches</th><th className="text-right">Eggs set</th><th className="text-right">Fertility</th><th className="text-right">Hatchability</th><th className="text-right">HOF</th><th className="text-right">Chicks A</th><th className="text-right">Chicks B</th></tr></thead>
                                <tbody>{report.by.map(g => (
                                    <tr key={g.name}><td>{g.name}</td><td className="text-right">{g.hatches}</td><td className="text-right">{n0(g.set)}</td><td className="text-right">{pct(p(g.set - g.infertile, g.set))}</td>
                                        <td className="text-right">{pct(p(g.a + g.b, g.set))}</td><td className="text-right">{pct(p(g.a + g.b, g.set - g.infertile))}</td><td className="text-right">{n0(g.a)}</td><td className="text-right">{n0(g.b)}</td></tr>
                                ))}</tbody>
                            </table>
                        </GroupBox>
                        <GroupBox title="Each hatch">
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead><tr><th>Hatch</th><th>Hatchery</th><th>Set</th><th>Hatched</th><th className="text-right">Eggs</th><th className="text-right">Infertile</th><th className="text-right">Early dead %</th><th className="text-right">Dead in shell %</th><th className="text-right">Fertility</th><th className="text-right">Hatchability</th><th className="text-right">Saleable</th><th className="text-right">HOF</th></tr></thead>
                                    <tbody>{report.done.map(r => (
                                        <tr key={r.id} className="cursor-pointer" onClick={() => setParams({ id: r.id })}>
                                            <td className="font-mono">{r.hatch_no}</td><td>{r.hatchery_name}</td><td>{r.set_date}</td><td>{r.hatch_date}</td><td className="text-right">{n0(r.eggs_set)}</td><td className="text-right">{n0(r.infertile)}</td>
                                            <td className="text-right">{pct(r.early_dead_pct)}</td><td className="text-right">{pct(r.dead_in_shell_pct)}</td><td className="text-right">{pct(r.fertility_pct)}</td><td className="text-right">{pct(r.hatchability_pct)}</td>
                                            <td className="text-right">{pct(r.saleable_pct)}</td><td className="text-right">{pct(r.hof_pct)}</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </div>
                        </GroupBox>
                    </>
                )}
            </NavWindow>
        </Layout>
    );
}
