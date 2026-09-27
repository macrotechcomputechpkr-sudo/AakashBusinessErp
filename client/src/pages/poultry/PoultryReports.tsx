// =============================================
// poultry/PoultryReports.tsx  (/poultry/reports?view=profitability|mortality|consumption|lifecycle)
// Shed-wise broiler reports (batches placed in the date range):
//   profitability - revenue, cost heads, profit, per kg / bird, by shed
//   mortality     - by batch, by cause, by week of age
//   consumption   - feed / medicine / vaccine per batch and per bird
//   lifecycle     - age, stage, FCR, EPEF, weight, livability per batch
//   shed_lot      - every shed with its lots: birds in, mortality, sold, profit
//   chick_source  - chick supplier performance: cost per chick, 1st-week and total mortality, FCR, profit
//   hatch_broiler - own hatches followed into own sheds (hatched -> placed -> sold -> profit)
// Server: utils/poultry.js report().
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import Chart from '../../components/charts/Chart';
import type { AuthFetch, SeriesPoint } from '../../types/erp';
import { GroupBox, Msg, NavWindow, ROLE_LABEL, errText, n0, n2, n3, pct } from '../../components/poultry/common';
import type { FlatBatch, Shed } from '../../components/poultry/common';

const VIEWS: [string, string][] = [['shed_lot', '🏠 Shed & Lot'], ['chick_source', '🛒 Chick Supplier'], ['hatch_broiler', '🐣 Hatch → Broiler'], ['profitability', '💰 Profitability'], ['lifecycle', '📈 Lifecycle'], ['mortality', '☠ Mortality'], ['consumption', '🌾 Consumption']];
interface ShedRow { shed_name: string; batches: number; placed: number; lifted: number; lifted_kg: number; feed_kg: number; revenue: number; cost: number; profit: number; fcr: number | null; profit_per_kg: number | null }
interface MortRow { batch_no: string; shed_name: string; placement_date: string; status: string; placed: number; mortality: number; culls: number; mortality_pct: number; livability_pct: number; age_days: number }
interface ConsRow { batch_no: string; shed_name: string; product_name: string; role: string; qty: number; feed_kg: number; amount: number; placed: number; per_bird: number | null }
interface LotRow { id: string; batch_no: string; placement_date: string; status: string; source: string; age_days: number; lift_due_date?: string; days_to_lift?: number | null; placed: number; dead: number; culls: number; mortality_pct: number;
    lifted: number; alive: number; lifted_kg: number; avg_weight_kg: number; fcr: number | null; sales: number; cost: number; profit: number; profit_per_bird: number | null; profit_per_kg: number | null }
interface ShedLot { shed_id: string; shed_name: string; lots: LotRow[]; placed: number; dead: number; culls: number; lifted: number; alive: number; lifted_kg: number; sales: number; cost: number; profit: number; mortality_pct: number; fcr: number | null; profit_per_bird: number | null }
interface HatchLot { id: string; batch_no: string; shed_name: string; status: string; placed: number; dead: number; mortality_pct: number; lifted: number; lifted_kg: number; sales: number; cost: number; profit: number }
interface HatchRow { id: string; hatch_no: string; hatch_date: string; eggs_set: number; chicks_a: number; hatchability_pct: number; placed_in_own_sheds: number; not_placed: number; lots: HatchLot[]; dead: number; mortality_pct: number; lifted: number; lifted_kg: number; sales: number; cost: number; profit: number }
interface SrcRow { source: string; kind: string; lots: { id: string; batch_no: string; shed_name: string; placement_date: string; status: string; placed: number; mortality_pct: number; fcr: number | null; profit: number }[];
    placed: number; dead: number; lifted: number; lifted_kg: number; cost_per_chick: number | null; first_week_mortality_pct: number; mortality_pct: number; fcr: number | null; avg_weight_kg: number | null; sales: number; cost: number; profit: number; profit_per_bird: number | null }
interface Data { totals?: Record<string, number>; batches?: (FlatBatch | MortRow)[]; sheds?: (ShedRow & ShedLot)[]; unallocated_shed_costs?: number; by_reason?: SeriesPoint[]; by_week?: SeriesPoint[]; rows?: ConsRow[]; by_role?: SeriesPoint[] }

export default function PoultryReports() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const view = params.get('view') || 'shed_lot';
    const [from, setFrom] = useState(params.get('date_from') || '');
    const [to, setTo] = useState(params.get('date_to') || '');
    const [shedId, setShedId] = useState(params.get('shed_id') || '');
    const [sheds, setSheds] = useState<Shed[]>([]);
    const [data, setData] = useState<Data | null>(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        setErr('');
        try {
            const qs = new URLSearchParams({ ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}), ...(shedId ? { shed_id: shedId } : {}) });
            setData((await authFetch<Data>(`/api/poultry/reports/${view}?${qs}`)).data);
        } catch (e) { setErr(errText(e)); }
    }, [authFetch, view, from, to, shedId]);
    useEffect(() => { setData(null); load(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { authFetch<Shed[]>('/api/poultry/sheds?shed_type=broiler').then(r => setSheds(r.data)).catch(() => undefined); }, [authFetch]);

    const flat = (data?.batches || []) as FlatBatch[];
    const hatchRows = (Array.isArray(data) ? data : []) as HatchRow[];
    const srcRows = (Array.isArray(data) ? data : []) as SrcRow[];
    const red = (v: number) => (v < 0 ? 'text-red-700' : '');
    const goBatch = (id: string) => { window.location.href = `/poultry/batches?id=${id}`; };
    return (
        <Layout>
            <NavWindow wide title="📊 Poultry Reports" tools={<>
                {VIEWS.map(([k, l]) => <button key={k} type="button" className={`nav-tool-btn ${view === k ? 'active' : ''}`} onClick={() => setParams({ view: k })}>{l}</button>)}
                <span className="nav-tool-sep" />
                <label className="text-xs">Placed from</label><input type="date" className="nav-input" style={{ width: 140, height: 24 }} value={from} onChange={e => setFrom(e.target.value)} />
                <label className="text-xs">to</label><input type="date" className="nav-input" style={{ width: 140, height: 24 }} value={to} onChange={e => setTo(e.target.value)} />
                <select className="nav-select" style={{ width: 160, height: 24 }} value={shedId} onChange={e => setShedId(e.target.value)}><option value="">All sheds</option>{sheds.map(s => <option key={s.id} value={s.id}>{s.shed_name}</option>)}</select>
                <button type="button" className="nav-tool-btn" onClick={load}>▶ Show</button>
                <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
            </>}>
                <Msg err={err} />
                {!data && !err && <p className="text-sm text-gray-500">Loading…</p>}

                {data && view === 'shed_lot' && (
                    <>
                        {data.totals && (
                            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                                <div className="kpi-card"><div className="kpi-label">Chicks placed</div><div className="kpi-value">{n0(data.totals.placed)}</div></div>
                                <div className="kpi-card red"><div className="kpi-label">Mortality</div><div className="kpi-value">{n0(data.totals.dead + data.totals.culls)}</div><div className="kpi-sub">{pct(data.totals.placed ? (data.totals.dead + data.totals.culls) * 100 / data.totals.placed : 0)}</div></div>
                                <div className="kpi-card"><div className="kpi-label">Sold (lifted)</div><div className="kpi-value">{n0(data.totals.lifted)}</div><div className="kpi-sub">{n2(data.totals.lifted_kg)} kg</div></div>
                                <div className="kpi-card"><div className="kpi-label">In sheds now</div><div className="kpi-value">{n0(data.totals.alive)}</div></div>
                                <div className="kpi-card green"><div className="kpi-label">Sales</div><div className="kpi-value">{n2(data.totals.sales)}</div><div className="kpi-sub">cost {n2(data.totals.cost)}</div></div>
                                <div className={`kpi-card ${data.totals.profit < 0 ? 'red' : 'green'}`}><div className="kpi-label">Profit</div><div className="kpi-value">{n2(data.totals.profit)}</div></div>
                            </div>
                        )}
                        {(data.sheds || []).map(s => (
                            <GroupBox key={s.shed_id} title={`${s.shed_name} - ${s.lots.length} lot(s) · mortality ${pct(s.mortality_pct)} · sold ${n0(s.lifted)} birds · profit ${n2(s.profit)}`}>
                                <div className="overflow-x-auto">
                                    <table className="erp-grid-table">
                                        <thead><tr><th>Lot</th><th>Chicks from</th><th>Placed on</th><th>Status</th><th className="text-right">Age</th><th>Lift due</th><th className="text-right">Placed</th><th className="text-right">Dead + culls</th><th className="text-right">Mort %</th>
                                            <th className="text-right">Sold</th><th className="text-right">Kg</th><th className="text-right">Avg kg</th><th className="text-right">FCR</th><th className="text-right">In shed</th><th className="text-right">Sales</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">Profit / bird</th></tr></thead>
                                        <tbody>{s.lots.map(l => (
                                            <tr key={l.id} className="cursor-pointer" onClick={() => goBatch(l.id)}>
                                                <td className="font-mono text-blue-700 underline">{l.batch_no}</td><td>{l.source}</td><td>{l.placement_date}</td><td>{l.status}</td><td className="text-right">{l.age_days}</td>
                                                <td className={l.status === 'active' && l.days_to_lift !== null && l.days_to_lift !== undefined && l.days_to_lift <= 3 ? 'text-orange-700 font-semibold' : ''}>{l.status === 'active' ? `${l.lift_due_date || ''}${l.days_to_lift !== null && l.days_to_lift !== undefined ? ` (${l.days_to_lift}d)` : ''}` : ''}</td>
                                                <td className="text-right">{n0(l.placed)}</td><td className="text-right">{n0(l.dead + l.culls)}</td><td className="text-right">{pct(l.mortality_pct)}</td><td className="text-right">{n0(l.lifted)}</td>
                                                <td className="text-right">{n2(l.lifted_kg)}</td><td className="text-right">{n3(l.avg_weight_kg)}</td><td className="text-right">{n3(l.fcr)}</td><td className="text-right">{n0(l.alive)}</td>
                                                <td className="text-right">{n2(l.sales)}</td><td className="text-right">{n2(l.cost)}</td><td className={`text-right ${red(l.profit)}`}>{n2(l.profit)}</td><td className="text-right">{l.profit_per_bird === null ? '—' : n2(l.profit_per_bird)}</td>
                                            </tr>
                                        ))}</tbody>
                                        <tfoot><tr><td colSpan={6}>Shed total</td><td className="text-right">{n0(s.placed)}</td><td className="text-right">{n0(s.dead + s.culls)}</td><td className="text-right">{pct(s.mortality_pct)}</td><td className="text-right">{n0(s.lifted)}</td>
                                            <td className="text-right">{n2(s.lifted_kg)}</td><td /><td className="text-right">{n3(s.fcr)}</td><td className="text-right">{n0(s.alive)}</td><td className="text-right">{n2(s.sales)}</td><td className="text-right">{n2(s.cost)}</td>
                                            <td className={`text-right ${red(s.profit)}`}>{n2(s.profit)}</td><td className="text-right">{s.profit_per_bird === null ? '—' : n2(s.profit_per_bird)}</td></tr></tfoot>
                                    </table>
                                </div>
                            </GroupBox>
                        ))}
                        {(data.sheds || []).length === 0 && <p className="text-sm text-gray-500">No lots placed in this period.</p>}
                    </>
                )}

                {data && view === 'chick_source' && (
                    <>
                        <GroupBox title="Where the chicks came from - compare suppliers">
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead><tr><th>Supplier / source</th><th className="text-right">Lots</th><th className="text-right">Chicks</th><th className="text-right">Cost / chick</th><th className="text-right">1st week mort %</th><th className="text-right">Total mort %</th>
                                        <th className="text-right">Sold</th><th className="text-right">Avg kg</th><th className="text-right">FCR</th><th className="text-right">Sales</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">Profit / bird</th></tr></thead>
                                    <tbody>{srcRows.map(r => (
                                        <tr key={r.source}><td>{r.kind === 'supplier' ? '🛒 ' : r.kind === 'own_hatch' ? '🥚 ' : ''}{r.source}</td><td className="text-right">{r.lots.length}</td><td className="text-right">{n0(r.placed)}</td>
                                            <td className="text-right">{r.cost_per_chick === null ? '—' : n2(r.cost_per_chick)}</td><td className="text-right">{pct(r.first_week_mortality_pct)}</td><td className="text-right">{pct(r.mortality_pct)}</td>
                                            <td className="text-right">{n0(r.lifted)}</td><td className="text-right">{n3(r.avg_weight_kg)}</td><td className="text-right">{n3(r.fcr)}</td><td className="text-right">{n2(r.sales)}</td><td className="text-right">{n2(r.cost)}</td>
                                            <td className={`text-right ${red(r.profit)}`}>{n2(r.profit)}</td><td className="text-right">{r.profit_per_bird === null ? '—' : n2(r.profit_per_bird)}</td></tr>
                                    ))}
                                    {srcRows.length === 0 && <tr><td colSpan={13} className="text-center text-gray-500">No lots placed in this period.</td></tr>}</tbody>
                                </table>
                            </div>
                        </GroupBox>
                        {srcRows.map(r => (
                            <GroupBox key={r.source} title={`${r.source} - lots`}>
                                <table className="erp-grid-table">
                                    <thead><tr><th>Lot</th><th>Shed</th><th>Placed on</th><th>Status</th><th className="text-right">Chicks</th><th className="text-right">Mort %</th><th className="text-right">FCR</th><th className="text-right">Profit</th></tr></thead>
                                    <tbody>{r.lots.map(l => (
                                        <tr key={l.id} className="cursor-pointer" onClick={() => goBatch(l.id)}><td className="font-mono text-blue-700 underline">{l.batch_no}</td><td>{l.shed_name}</td><td>{l.placement_date}</td><td>{l.status}</td>
                                            <td className="text-right">{n0(l.placed)}</td><td className="text-right">{pct(l.mortality_pct)}</td><td className="text-right">{n3(l.fcr)}</td><td className={`text-right ${red(l.profit)}`}>{n2(l.profit)}</td></tr>
                                    ))}</tbody>
                                </table>
                            </GroupBox>
                        ))}
                    </>
                )}

                {data && view === 'hatch_broiler' && (
                    <>
                        {hatchRows.length === 0 && <p className="text-sm text-gray-500">No hatched settings in this period.</p>}
                        {hatchRows.map(h => (
                            <GroupBox key={h.id} title={`Hatch ${h.hatch_no} (${h.hatch_date}) - ${n0(h.chicks_a)} chicks · ${n0(h.placed_in_own_sheds)} in own sheds · profit ${n2(h.profit)}`}>
                                <div className="text-xs mb-1">Eggs set {n0(h.eggs_set)} · hatchability {pct(h.hatchability_pct)} · not placed {n0(h.not_placed)} · mortality {n0(h.dead)} ({pct(h.mortality_pct)}) · sold {n0(h.lifted)} birds / {n2(h.lifted_kg)} kg</div>
                                <table className="erp-grid-table">
                                    <thead><tr><th>Lot</th><th>Shed</th><th>Status</th><th className="text-right">Placed</th><th className="text-right">Dead + culls</th><th className="text-right">Mort %</th><th className="text-right">Sold</th><th className="text-right">Kg</th><th className="text-right">Sales</th><th className="text-right">Cost</th><th className="text-right">Profit</th></tr></thead>
                                    <tbody>{h.lots.map(l => (
                                        <tr key={l.id} className="cursor-pointer" onClick={() => goBatch(l.id)}>
                                            <td className="font-mono text-blue-700 underline">{l.batch_no}</td><td>{l.shed_name}</td><td>{l.status}</td><td className="text-right">{n0(l.placed)}</td><td className="text-right">{n0(l.dead)}</td><td className="text-right">{pct(l.mortality_pct)}</td>
                                            <td className="text-right">{n0(l.lifted)}</td><td className="text-right">{n2(l.lifted_kg)}</td><td className="text-right">{n2(l.sales)}</td><td className="text-right">{n2(l.cost)}</td><td className={`text-right ${red(l.profit)}`}>{n2(l.profit)}</td>
                                        </tr>
                                    ))}
                                    {h.lots.length === 0 && <tr><td colSpan={11} className="text-center text-gray-500">No chicks of this hatch placed in own sheds.</td></tr>}</tbody>
                                    <tfoot><tr><td colSpan={3}>Total</td><td className="text-right">{n0(h.placed_in_own_sheds)}</td><td className="text-right">{n0(h.dead)}</td><td className="text-right">{pct(h.mortality_pct)}</td><td className="text-right">{n0(h.lifted)}</td>
                                        <td className="text-right">{n2(h.lifted_kg)}</td><td className="text-right">{n2(h.sales)}</td><td className="text-right">{n2(h.cost)}</td><td className={`text-right ${red(h.profit)}`}>{n2(h.profit)}</td></tr></tfoot>
                                </table>
                            </GroupBox>
                        ))}
                    </>
                )}

                {data && view === 'profitability' && (
                    <>
                        <GroupBox title="Shed-wise">
                            <table className="erp-grid-table">
                                <thead><tr><th>Shed</th><th className="text-right">Batches</th><th className="text-right">Placed</th><th className="text-right">Lifted</th><th className="text-right">Kg</th><th className="text-right">Feed kg</th><th className="text-right">FCR</th><th className="text-right">Revenue</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">Profit / kg</th></tr></thead>
                                <tbody>{(data.sheds || []).map(s => (
                                    <tr key={s.shed_name}><td>{s.shed_name}</td><td className="text-right">{s.batches}</td><td className="text-right">{n0(s.placed)}</td><td className="text-right">{n0(s.lifted)}</td><td className="text-right">{n2(s.lifted_kg)}</td>
                                        <td className="text-right">{n0(s.feed_kg)}</td><td className="text-right">{n3(s.fcr)}</td><td className="text-right">{n2(s.revenue)}</td><td className="text-right">{n2(s.cost)}</td>
                                        <td className={`text-right ${s.profit < 0 ? 'text-red-700' : ''}`}>{n2(s.profit)}</td><td className="text-right">{s.profit_per_kg === null ? '—' : n2(s.profit_per_kg)}</td></tr>
                                ))}</tbody>
                            </table>
                            {!!data.unallocated_shed_costs && <p className="text-xs text-gray-600 mt-1">Shed expenses with no batch to carry them (empty shed): {n2(data.unallocated_shed_costs)}</p>}
                        </GroupBox>
                        <GroupBox title="Batch-wise">
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead><tr><th>Batch</th><th>Shed</th><th>Status</th><th className="text-right">Chicks</th><th className="text-right">Feed</th><th className="text-right">Med + Vac</th><th className="text-right">Other</th><th className="text-right">Expenses</th><th className="text-right">Total cost</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th className="text-right">Cost / kg</th><th className="text-right">Profit / bird</th></tr></thead>
                                    <tbody>{flat.map(b => (
                                        <tr key={b.id} className="cursor-pointer" onClick={() => { window.location.href = `/poultry/batches?id=${b.id}`; }}>
                                            <td className="font-mono">{b.batch_no}</td><td>{b.shed_name}</td><td>{b.status}</td><td className="text-right">{n2(b.costs.chicks)}</td><td className="text-right">{n2(b.costs.feed)}</td>
                                            <td className="text-right">{n2(b.costs.medicine + b.costs.vaccine)}</td><td className="text-right">{n2(b.costs.litter + b.costs.other_items)}</td><td className="text-right">{n2(b.costs.direct_expenses + b.costs.shed_share)}</td>
                                            <td className="text-right">{n2(b.costs.total)}</td><td className="text-right">{n2(b.revenue.total)}</td><td className={`text-right ${b.profit < 0 ? 'text-red-700' : ''}`}>{n2(b.profit)}</td>
                                            <td className="text-right">{b.cost_per_kg === null ? '—' : n2(b.cost_per_kg)}</td><td className="text-right">{b.profit_per_bird === null ? '—' : n2(b.profit_per_bird)}</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </div>
                        </GroupBox>
                    </>
                )}

                {data && view === 'lifecycle' && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead><tr><th>Batch</th><th>Shed</th><th>Breed</th><th>Placed on</th><th className="text-right">Age</th><th>Stage</th><th className="text-right">Placed</th><th className="text-right">Alive</th><th className="text-right">Livability</th><th className="text-right">Feed / bird kg</th><th className="text-right">Avg kg</th><th className="text-right">FCR</th><th className="text-right">EPEF</th></tr></thead>
                            <tbody>{flat.map(b => (
                                <tr key={b.id} className="cursor-pointer" onClick={() => { window.location.href = `/poultry/batches?id=${b.id}`; }}>
                                    <td className="font-mono">{b.batch_no}</td><td>{b.shed_name}</td><td>{b.breed || ''}</td><td>{b.placement_date}</td><td className="text-right">{b.age_days}</td><td>{b.stage}</td>
                                    <td className="text-right">{n0(b.placed)}</td><td className="text-right">{n0(b.alive)}</td><td className="text-right">{pct(b.livability_pct)}</td><td className="text-right">{n3(b.feed_per_bird_kg)}</td>
                                    <td className="text-right">{n3(b.avg_weight_kg)}</td><td className="text-right">{n3(b.fcr)}</td><td className="text-right">{b.epef ?? '—'}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                )}

                {data && view === 'mortality' && (
                    <>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-2">
                            <div className="chart-panel"><div className="chart-panel-header">By cause</div><div className="chart-panel-body"><Chart type="hbar" points={data.by_reason || []} /></div></div>
                            <div className="chart-panel"><div className="chart-panel-header">By week of age</div><div className="chart-panel-body"><Chart type="bar" points={data.by_week || []} /></div></div>
                        </div>
                        <table className="erp-grid-table">
                            <thead><tr><th>Batch</th><th>Shed</th><th>Placed on</th><th>Status</th><th className="text-right">Age</th><th className="text-right">Placed</th><th className="text-right">Dead</th><th className="text-right">Culls</th><th className="text-right">Mortality %</th><th className="text-right">Livability %</th></tr></thead>
                            <tbody>{((data.batches || []) as MortRow[]).map(b => (
                                <tr key={b.batch_no}><td className="font-mono">{b.batch_no}</td><td>{b.shed_name}</td><td>{b.placement_date}</td><td>{b.status}</td><td className="text-right">{b.age_days}</td>
                                    <td className="text-right">{n0(b.placed)}</td><td className="text-right">{n0(b.mortality)}</td><td className="text-right">{n0(b.culls)}</td><td className="text-right">{pct(b.mortality_pct)}</td><td className="text-right">{pct(b.livability_pct)}</td></tr>
                            ))}</tbody>
                        </table>
                    </>
                )}

                {data && view === 'consumption' && (
                    <>
                        <div className="chart-panel mb-2"><div className="chart-panel-header">Cost by item type</div><div className="chart-panel-body"><Chart type="donut" points={(data.by_role || []).map(p => ({ ...p, label: ROLE_LABEL[p.label] || p.label }))} height={200} /></div></div>
                        <table className="erp-grid-table">
                            <thead><tr><th>Batch</th><th>Shed</th><th>Item</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Feed kg</th><th className="text-right">Amount</th><th className="text-right">Per bird placed</th></tr></thead>
                            <tbody>{(data.rows || []).map((r, i) => (
                                <tr key={i}><td className="font-mono">{r.batch_no}</td><td>{r.shed_name}</td><td>{r.product_name}</td><td>{ROLE_LABEL[r.role] || r.role}</td><td className="text-right">{n2(r.qty)}</td>
                                    <td className="text-right">{r.feed_kg ? n2(r.feed_kg) : ''}</td><td className="text-right">{n2(r.amount)}</td><td className="text-right">{r.per_bird === null ? '—' : n3(r.per_bird)}</td></tr>
                            ))}</tbody>
                        </table>
                    </>
                )}
            </NavWindow>
        </Layout>
    );
}
