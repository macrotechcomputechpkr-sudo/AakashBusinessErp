// =============================================
// poultry/PoultryDashboard.tsx  (/poultry)
// Farm at a glance: running batches (age, stage, birds, mortality, FCR),
// sheds without today's entry, last 12 months' closed batches (FCR,
// livability, EPEF, profit) and the hatchery pipeline.
// Server: utils/poultry.js dashboard().
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import Chart from '../../components/charts/Chart';
import type { AuthFetch } from '../../types/erp';
import { Kpi, Msg, errText, n0, n2, n3, pct } from '../../components/poultry/common';
import type { FlatBatch } from '../../components/poultry/common';

interface Dash {
    features: { enabled: boolean; broiler: boolean; hatchery: boolean };
    kpis: { active_batches: number; live_birds: number; avg_age: number | null; mortality_today: number; mortality_mtd: number; closed_12m: number; avg_fcr_12m: number | null; avg_livability_12m: number | null; avg_epef_12m: number | null; profit_12m: number };
    active: FlatBatch[]; missing_today: { id: string; batch_no: string; shed_name: string }[]; closed: FlatBatch[];
    hatchery: null | { in_incubation: number; eggs_in_incubation: number; hatches_12m: number; eggs_set_12m: number; chicks_12m: number; fertility_pct: number | null; hatchability_pct: number | null; hof_pct: number | null; due_soon: { id: string; hatch_no: string; set_date: string; eggs_set: number; status: string }[] };
}

export default function PoultryDashboard() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [d, setD] = useState<Dash | null>(null);
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        try { setD((await authFetch<Dash>('/api/poultry/dashboard')).data); } catch (e) { setErr(errText(e)); }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);
    const k = d?.kpis;
    return (
        <Layout>
            <div className="nav-toolbar">
                <span className="font-bold text-[#1a4a8a] mr-2">🐔 Poultry Dashboard</span>
                <button type="button" className="nav-tool-btn" onClick={load}>🔄 Refresh</button>
                <span className="nav-tool-sep" />
                {d?.features.broiler && <a className="nav-tool-btn" href="/poultry/batches?new=1">➕ New placement</a>}
                {d?.features.broiler && <a className="nav-tool-btn" href="/poultry/batches">🐔 Batches</a>}
                {d?.features.hatchery && <a className="nav-tool-btn" href="/poultry/hatchery">🥚 Hatchery</a>}
                <a className="nav-tool-btn" href="/poultry/reports?view=profitability">📊 Reports</a>
                <a className="nav-tool-btn" href="/poultry/setup">⚙️ Setup</a>
            </div>
            <div className="p-2 md:p-3 max-w-[1600px] mx-auto">
                <Msg err={err} />
                {k && (
                    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                        <Kpi label="Running batches" value={k.active_batches} sub={`avg age ${k.avg_age ?? '—'} days`} />
                        <Kpi label="Live birds" tone="green" value={n0(k.live_birds)} />
                        <Kpi label="Mortality today / MTD" tone="red" value={`${n0(k.mortality_today)} / ${n0(k.mortality_mtd)}`} />
                        <Kpi label="FCR (12 m)" tone="orange" value={n3(k.avg_fcr_12m)} sub={`${k.closed_12m} closed batches`} />
                        <Kpi label="Livability / EPEF (12 m)" value={`${pct(k.avg_livability_12m)}`} sub={`EPEF ${k.avg_epef_12m ?? '—'}`} />
                        <Kpi label="Profit (12 m)" tone={k.profit_12m >= 0 ? 'green' : 'red'} value={n2(k.profit_12m)} />
                    </div>
                )}
                {d && d.missing_today.length > 0 && <div className="nav-msg warn">No daily entry today for: {d.missing_today.map(m => <a key={m.id} className="underline mr-2" href={`/poultry/batches?id=${m.id}`}>{m.batch_no} ({m.shed_name})</a>)}</div>}
                {d && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        <div className="chart-panel lg:col-span-2">
                            <div className="chart-panel-header">Running batches - shed-wise</div>
                            <div className="chart-panel-body overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead><tr><th>Shed</th><th>Batch</th><th className="text-right">Age</th><th>Stage</th><th className="text-right">Alive</th><th className="text-right">Mort %</th><th className="text-right">Feed / bird kg</th><th className="text-right">Avg kg</th><th className="text-right">FCR</th><th className="text-right">Cost / kg</th></tr></thead>
                                    <tbody>{d.active.map(b => (
                                        <tr key={b.id} className="cursor-pointer" onClick={() => { window.location.href = `/poultry/batches?id=${b.id}`; }}>
                                            <td>{b.shed_name}</td><td className="font-mono text-blue-700 underline">{b.batch_no}</td><td className="text-right">{b.age_days}</td><td>{b.stage}</td><td className="text-right">{n0(b.alive)}</td>
                                            <td className="text-right">{pct(b.mortality_pct)}</td><td className="text-right">{n3(b.feed_per_bird_kg)}</td><td className="text-right">{n3(b.avg_weight_kg)}</td><td className="text-right">{n3(b.fcr)}</td>
                                            <td className="text-right">{b.cost_per_kg === null ? '—' : n2(b.cost_per_kg)}</td>
                                        </tr>
                                    ))}
                                    {d.active.length === 0 && <tr><td colSpan={10} className="text-center text-gray-500 py-4">No running batch.</td></tr>}</tbody>
                                </table>
                            </div>
                        </div>
                        <div className="chart-panel">
                            <div className="chart-panel-header">Profit of closed batches</div>
                            <div className="chart-panel-body"><Chart type="bar" points={d.closed.map(b => ({ label: b.batch_no, value: b.profit }))} /></div>
                        </div>
                        <div className="chart-panel">
                            <div className="chart-panel-header">FCR of closed batches</div>
                            <div className="chart-panel-body"><Chart type="line" points={d.closed.map(b => ({ label: b.batch_no, value: b.fcr || 0 }))} /></div>
                        </div>
                        {d.hatchery && (
                            <div className="chart-panel lg:col-span-2">
                                <div className="chart-panel-header">Hatchery</div>
                                <div className="chart-panel-body">
                                    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                                        <Kpi label="In incubation" value={`${d.hatchery.in_incubation} settings`} sub={`${n0(d.hatchery.eggs_in_incubation)} eggs`} />
                                        <Kpi label="Fertility (12 m)" tone="green" value={pct(d.hatchery.fertility_pct)} />
                                        <Kpi label="Hatchability (12 m)" tone="orange" value={pct(d.hatchery.hatchability_pct)} sub={`HOF ${pct(d.hatchery.hof_pct)}`} />
                                        <Kpi label="Chicks (12 m)" value={n0(d.hatchery.chicks_12m)} sub={`${d.hatchery.hatches_12m} hatches`} />
                                    </div>
                                    {d.hatchery.due_soon.map(h => <a key={h.id} className="inline-block mr-3 text-sm text-blue-700 underline" href={`/poultry/hatchery?id=${h.id}`}>{h.hatch_no} · set {h.set_date} · {n0(h.eggs_set)} eggs · {h.status}</a>)}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Layout>
    );
}
