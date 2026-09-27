// =============================================
// Dashboard.tsx
// Customizable dashboard: every user builds their own from a catalog of
// widgets (KPIs, trends, top-10s, ageing, expenses, cash, stock, lists).
//   * each tile: chart type (bar / horizontal bar / line / area / pie /
//     donut / table where the data allows), period, size, own title
//   * drag tiles (or ← →) to re-order, ✕ to remove, ➕ to add
//   * Save keeps it for this user; an administrator can also save it as
//     the company default that new users start from; Reset returns to it
// Data: /api/dashboard/widgets/:key (server/utils/dashboardWidgets.js).
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import Chart, { money } from '../components/charts/Chart';
import type { AuthFetch, ChartType, DashboardTile, WidgetData, WidgetDef } from '../types/erp';

const PERIODS: [string, string][] = [['this_month', 'This month'], ['last_month', 'Last month'], ['last_30', 'Last 30 days'], ['this_quarter', 'This quarter'],
    ['this_year', 'This year'], ['fiscal_year', 'This fiscal year'], ['last_12_months', 'Last 12 months']];
const CHART_LABEL: Record<ChartType, string> = { bar: 'Bar', hbar: 'Horizontal bar', line: 'Line', area: 'Area', pie: 'Pie', donut: 'Donut', kpi: 'Number', table: 'Table' };
const SPAN: Record<number, string> = { 1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-4' };
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Tile({ tile, def, editing, authFetch, refreshKey, onChange, onRemove, onMove, onDragStart, onDrop }: {
    tile: DashboardTile; def?: WidgetDef; editing: boolean; authFetch: AuthFetch; refreshKey: number;
    onChange: (patch: Partial<DashboardTile>) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; onDragStart: () => void; onDrop: () => void;
}) {
    const [data, setData] = useState<WidgetData | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        let live = true;
        setLoading(true); setError('');
        authFetch<WidgetData>(`/api/dashboard/widgets/${tile.widget}?period=${tile.period}`)
            .then(r => { if (live) setData(r.data); })
            .catch((e: Error) => { if (live) setError(e.message); })
            .finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [authFetch, tile.widget, tile.period, refreshKey]);
    const title = tile.title || def?.label || tile.widget;
    const period = PERIODS.find(p => p[0] === tile.period)?.[1] || '';

    return (
        <div data-tile={tile.widget} className={`chart-panel ${SPAN[tile.size] || ''} ${editing ? 'outline outline-1 outline-blue-300 cursor-move' : ''}`}
            draggable={editing} onDragStart={onDragStart} onDragOver={e => editing && e.preventDefault()} onDrop={onDrop}>
            <div className="chart-panel-header">
                <div className="min-w-0 flex-1">
                    {editing ? <input className="nav-input" style={{ height: 22, textTransform: 'none' }} value={tile.title ?? ''} placeholder={def?.label} onChange={e => onChange({ title: e.target.value })} />
                        : <p className="truncate">{data?.link ? <a href={data.link} className="hover:underline">{title}</a> : title}</p>}
                </div>
                {editing ? (
                    <div className="flex items-center gap-1 shrink-0">
                        <button className="nav-btn small" title="Move left" onClick={() => onMove(-1)}>←</button>
                        <button className="nav-btn small" title="Move right" onClick={() => onMove(1)}>→</button>
                        <button className="nav-btn small danger" title="Remove" onClick={onRemove}>✕</button>
                    </div>
                ) : <span className="font-normal normal-case text-[10px] text-gray-500 shrink-0">{period}</span>}
            </div>
            <div className="chart-panel-body flex flex-col">
            {data?.from && <p className="text-[10px] text-gray-500 mb-1">{data.from} – {data.to}</p>}
            {editing && (
                <div className="grid grid-cols-3 gap-1 mb-2 text-xs" data-enter-nav="off">
                    <select data-chart className="nav-select" title="Chart type" value={tile.chart} onChange={e => onChange({ chart: e.target.value as ChartType })} disabled={(def?.charts.length || 0) < 2}>
                        {(def?.charts || [tile.chart]).map(c => <option key={c} value={c}>{CHART_LABEL[c]}</option>)}
                    </select>
                    <select className="nav-select" value={tile.period} onChange={e => onChange({ period: e.target.value })}>
                        {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <select className="nav-select" value={tile.size} onChange={e => onChange({ size: Number(e.target.value) as 1 | 2 | 3 })}>
                        <option value={1}>Small</option><option value={2}>Wide</option><option value={3}>Full width</option>
                    </select>
                </div>
            )}
            <div className="flex-1">
                {loading && !data && <p className="text-xs text-gray-400 py-8 text-center">Loading…</p>}
                {error && <p className="text-xs text-red-600">{error}</p>}
                {data && !error && data.kind === 'kpi' && (
                    <div className="py-1">
                        <p className="kpi-value text-2xl">{data.unit === 'count' ? Number(data.value || 0).toLocaleString('en-IN') : `Rs ${money(data.value || 0)}`}</p>
                        {data.change_pct !== null && data.change_pct !== undefined && (
                            <p className={`text-xs mt-1 ${data.change_pct >= 0 ? 'text-green-700' : 'text-red-600'}`}>{data.change_pct >= 0 ? '▲' : '▼'} {Math.abs(data.change_pct)}% vs previous period
                                <span className="text-gray-400"> ({data.unit === 'count' ? data.previous : money(data.previous || 0)})</span></p>
                        )}
                    </div>
                )}
                {data && !error && data.kind === 'series' && <Chart type={tile.chart} points={data.points || []} labels={data.series_labels} height={tile.size === 1 ? 200 : 240} />}
                {data && !error && data.kind === 'table' && (
                    <div className="overflow-auto max-h-64" data-no-excel>
                        <table className="w-full text-xs">
                            <thead><tr className="text-gray-500">{(data.columns || []).map(c => <th key={c.key} className={`py-1 ${c.money ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr></thead>
                            <tbody>{(data.rows || []).map((r, i) => <tr key={i} className="border-t">{(data.columns || []).map(c => <td key={c.key} className={`py-1 ${c.money ? 'text-right tabular-nums' : ''}`}>{c.money ? money(Number(r[c.key]) || 0) : String(r[c.key] ?? '')}</td>)}</tr>)}</tbody>
                        </table>
                        {(data.rows || []).length === 0 && <p className="text-xs text-gray-400 text-center py-6">Nothing to show</p>}
                    </div>
                )}
            </div>
            </div>
        </div>
    );
}

export default function Dashboard() {
    const { tenant, requiresCompanyCreation, authFetch } = useAuth() as { tenant: { id: string; company_name?: string } | null; requiresCompanyCreation: boolean; authFetch: AuthFetch };
    const navigate = useNavigate();
    const [catalog, setCatalog] = useState<WidgetDef[]>([]);
    const [tiles, setTiles] = useState<DashboardTile[]>([]);
    const [source, setSource] = useState('');
    const [editing, setEditing] = useState(false);
    const [adding, setAdding] = useState(false);
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    useEffect(() => { if (requiresCompanyCreation) navigate('/company-creation'); }, [requiresCompanyCreation, navigate]);
    const load = useCallback(async () => {
        try {
            const [c, l] = await Promise.all([authFetch<WidgetDef[]>('/api/dashboard/widgets'), authFetch<{ layout: DashboardTile[]; source: string }>('/api/dashboard/layout')]);
            setCatalog(c.data || []); setTiles(l.data.layout || []); setSource(l.data.source);
        } catch (e) { setError((e as Error).message); }
    }, [authFetch]);
    useEffect(() => { if (tenant?.id && !requiresCompanyCreation) load(); }, [tenant, requiresCompanyCreation, load]);

    const defOf = useMemo(() => Object.fromEntries(catalog.map(d => [d.key, d])), [catalog]);
    const groups = useMemo(() => Array.from(new Set(catalog.map(d => d.group))), [catalog]);
    const patch = (i: number, p: Partial<DashboardTile>) => setTiles(ts => ts.map((t, j) => (j === i ? { ...t, ...p } : t)));
    const move = (from: number, to: number) => setTiles(ts => { if (to < 0 || to >= ts.length) return ts; const a = [...ts]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; });
    const add = (d: WidgetDef) => { setTiles(ts => [...ts, { id: newId(), widget: d.key, chart: d.default_chart, size: d.kind === 'kpi' ? 1 : d.kind === 'table' ? 2 : 1, period: d.key.includes('trend') || d.key === 'income_expense' ? 'last_12_months' : 'this_month' }]); };
    const save = async (companyDefault = false) => {
        setError(''); setMsg('');
        try { await authFetch('/api/dashboard/layout', { method: 'PUT', body: JSON.stringify({ layout: tiles, company_default: companyDefault }) }); setMsg(companyDefault ? 'Saved as the company default dashboard' : 'Dashboard saved'); setEditing(false); setAdding(false); if (!companyDefault) setSource('user'); }
        catch (e) { setError((e as Error).message); }
    };
    const reset = async () => {
        if (!window.confirm('Go back to the company default dashboard?')) return;
        try { const r = await authFetch<{ layout: DashboardTile[]; source: string }>('/api/dashboard/layout', { method: 'DELETE' }); setTiles(r.data.layout); setSource(r.data.source); setMsg('Reset'); }
        catch (e) { setError((e as Error).message); }
    };
    const setAllPeriods = (p: string) => setTiles(ts => ts.map(t => ({ ...t, period: p })));

    return (
        <Layout>
            <div className="nav-toolbar" data-enter-scope>
                    <span className="font-bold text-[#1a4a8a] mr-2">📊 Dashboard <span className="font-normal text-gray-600">{tenant?.company_name}</span></span>
                    <button className="nav-tool-btn" onClick={() => setRefreshKey(k => k + 1)}>🔄 Refresh</button>
                    <button className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
                    <span className="nav-tool-sep" />
                    {!editing ? <button className="nav-tool-btn" onClick={() => setEditing(true)}>✎ Customize</button> : <>
                        <select className="nav-select" style={{ width: 'auto', height: 24 }} defaultValue="" onChange={e => { if (e.target.value) setAllPeriods(e.target.value); }} title="Set every tile to one period">
                            <option value="">Period for all…</option>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        <button className="nav-tool-btn" onClick={() => setAdding(a => !a)}>➕ Add widget</button>
                        <button className="nav-tool-btn" onClick={() => save(false)}>💾 Save</button>
                        <button className="nav-tool-btn" onClick={() => save(true)} title="Administrators only">🏢 Save as company default</button>
                        <button className="nav-tool-btn" onClick={reset}>↺ Reset</button>
                        <button className="nav-tool-btn" onClick={() => { setEditing(false); setAdding(false); load(); }}>✕ Cancel</button>
                    </>}
            </div>
            <div className="p-2 md:p-3 max-w-[1600px] mx-auto">
                {source === 'default' && !editing && <p className="text-xs text-gray-500 mb-2">This is the standard dashboard - click Customize to choose your own charts.</p>}
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}
                {adding && (
                    <div className="nav-groupbox grid grid-cols-1 md:grid-cols-3 gap-3">
                        {groups.map(g => (
                            <div key={g}>
                                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{g}</p>
                                {catalog.filter(d => d.group === g).map(d => (
                                    <button key={d.key} className="block w-full text-left text-sm px-2 py-1 rounded hover:bg-blue-50" onClick={() => add(d)}>
                                        ➕ {d.label} <span className="text-[11px] text-gray-400">{d.charts.map(c => CHART_LABEL[c]).join(' / ')}</span>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                    {tiles.map((t, i) => (
                        <Tile key={t.id} tile={t} def={defOf[t.widget]} editing={editing} authFetch={authFetch} refreshKey={refreshKey}
                            onChange={p => patch(i, p)} onRemove={() => setTiles(ts => ts.filter((_, j) => j !== i))} onMove={d => move(i, i + d)}
                            onDragStart={() => setDragFrom(i)} onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }} />
                    ))}
                </div>
                {tiles.length === 0 && <p className="text-center text-gray-400 py-16">No widgets - click Customize, then Add widget.</p>}
            </div>
        </Layout>
    );
}
