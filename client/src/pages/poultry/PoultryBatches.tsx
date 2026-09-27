// =============================================
// poultry/PoultryBatches.tsx  (/poultry/batches?status=&shed=&new=1&id=)
// Shed-wise broiler batches (all-in all-out: one running batch per shed):
//   * list with age, stage, live birds, mortality, FCR, profit
//   * placement - chicks issued from stock to the shed (Stock Adjustment,
//     reason Consumption, batch cost center)
//   * batch window - daily log (mortality / culls / weight / water and the
//     feed, medicine, vaccine used - posted the same way), lifecycle chart
//     against the breed standard, liftings (live birds into stock, optional
//     draft sales bill), cost & profit, close / reopen.
// Server: utils/poultry.js.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import Chart from '../../components/charts/Chart';
import type { AuthFetch } from '../../types/erp';
import { SearchablePopupSelect, GroupBox, Kpi, Msg, NavWindow, ROLE_LABEL, errText, n0, n2, n3, pct, today, useLookups } from '../../components/poultry/common';
import type { Batch, PItem, Shed, Summary } from '../../components/poultry/common';

interface LogItem { product_id: string; qty: number | string; uom_id: string; role?: string; product_name?: string; amount?: number; feed_kg?: number }
interface Log { id: string; log_date: string; age: number; mortality: number; culls: number; mortality_reason: string | null; avg_weight_g: number | null; water_l: number | null; temp_min: number | null; temp_max: number | null; humidity: number | null; remarks: string | null; adjustment_no: string | null; items: LogItem[] }
interface Lifting { id: string; lift_date: string; birds: number; weight_kg: number; avg_weight_kg: number; rate: number; amount: number; vehicle_no: string | null; adjustment_no: string | null; sales_bill_id: string | null; remarks: string | null }
interface Day { date: string; age: number; opening: number; mortality: number; culls: number; lifted: number; closing: number; cum_mortality_pct: number; feed_kg: number; cum_feed_kg: number; feed_per_bird_g: number | null; avg_weight_g: number | null; std_weight_g: number | null; water_l: number | null; has_entry: boolean }
type Detail = Batch & { summary: Summary; days: Day[]; logs: Log[]; liftings: Lifting[] };

const STAGE_TONE: Record<string, string> = { Brooding: 'bg-yellow-100', Grower: 'bg-green-100', Finisher: 'bg-blue-100', Closed: 'bg-gray-200' };
const blankLog = () => ({ log_date: today(), mortality: '' as number | string, culls: '' as number | string, mortality_reason: '', avg_weight_g: '' as number | string, water_l: '' as number | string, temp_min: '' as number | string, temp_max: '' as number | string, humidity: '' as number | string, remarks: '', items: [] as LogItem[] });
const blankLift = () => ({ lift_date: today(), birds: '' as number | string, weight_kg: '' as number | string, rate: '' as number | string, customer_ledger_id: '', vehicle_no: '', make_sales_bill: false, remarks: '' });

export default function PoultryBatches() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const id = params.get('id');
    const isNew = !!params.get('new');
    const status = params.get('status') || 'active';
    const L = useLookups(authFetch, { ledgers: true });
    const [rows, setRows] = useState<Batch[]>([]);
    const [sheds, setSheds] = useState<Shed[]>([]);
    const [items, setItems] = useState<PItem[]>([]);
    const [detail, setDetail] = useState<Detail | null>(null);
    const [tab, setTab] = useState('log');
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const [warn, setWarn] = useState<string[]>([]);
    const [place, setPlace] = useState({ shed_id: '', placement_date: today(), chicks_placed: '' as number | string, free_chicks: '' as number | string, chick_product_id: '', chick_rate: '', chick_cost_manual: '', warehouse_id: '', breed: '', chick_source: '', target_weight_kg: '', expected_close_date: '', remarks: '' });
    const [log, setLog] = useState(blankLog());
    const [lift, setLift] = useState(blankLift());
    const [closeForm, setCloseForm] = useState({ closed_on: today(), write_off_remaining: false, close_notes: '' });

    const loadList = useCallback(async () => {
        try {
            const qs = new URLSearchParams({ money: '1', ...(status !== 'all' ? { status } : {}), ...(params.get('shed') ? { shed_id: params.get('shed') as string } : {}) });
            setRows((await authFetch<Batch[]>(`/api/poultry/batches?${qs}`)).data);
        } catch (e) { setErr(errText(e)); }
    }, [authFetch, status, params]);
    const loadDetail = useCallback(async () => {
        if (!id) { setDetail(null); return; }
        try { setDetail((await authFetch<Detail>(`/api/poultry/batches/${id}`)).data); } catch (e) { setErr(errText(e)); }
    }, [authFetch, id]);
    useEffect(() => { if (!id && !isNew) loadList(); }, [loadList, id, isNew]);
    useEffect(() => { loadDetail(); }, [loadDetail]);
    useEffect(() => {
        authFetch<Shed[]>('/api/poultry/sheds?shed_type=broiler').then(r => setSheds(r.data)).catch(() => undefined);
        authFetch<{ items: PItem[] }>('/api/poultry/settings').then(r => setItems(r.data.items)).catch(() => undefined);
    }, [authFetch]);

    const run = async (fn: () => Promise<{ warnings?: string[] } | unknown>, done: string) => {
        setOk(''); setErr(''); setWarn([]);
        try {
            const r = await fn() as { data?: { warnings?: string[] } };
            if (r?.data?.warnings?.length) setWarn(r.data.warnings);
            setOk(done);
            await loadDetail();
            return true;
        } catch (e) { setErr(errText(e)); return false; }
    };
    const post = (url: string, body: unknown, method = 'POST') => authFetch(url, { method, body: JSON.stringify(body) });

    const chickItems = items.filter(i => i.role === 'chick');
    const consumables = items.filter(i => ['feed', 'medicine', 'vaccine', 'litter', 'other'].includes(i.role));
    const productName = (pid: string) => L.products.find(p => p.id === pid)?.product_name || items.find(i => i.product_id === pid)?.product_name || '';
    const s = detail?.summary;
    const weightPoints = useMemo(() => (detail?.days || []).filter(d => d.avg_weight_g || d.std_weight_g).map(d => ({ label: `D${d.age}`, value: d.avg_weight_g || 0, value2: d.std_weight_g })), [detail]);
    const mortPoints = useMemo(() => (detail?.days || []).map(d => ({ label: `D${d.age}`, value: d.mortality + d.culls })), [detail]);

    // ---------------------------------------------------------------- placement
    if (isNew) {
        const freeSheds = sheds.filter(x => x.is_active && !x.active_batch);
        return (
            <Layout>
                <NavWindow title="🐣 New Batch Placement" tools={<button type="button" className="nav-tool-btn" onClick={() => setParams({})}>← Batches</button>}>
                    <Msg ok={ok} err={err} warn={warn} />
                    <GroupBox title="Placement">
                        <div className="nav-form-grid">
                            <label className="nav-label required">Shed</label>
                            <select className="nav-select" value={place.shed_id} onChange={e => setPlace({ ...place, shed_id: e.target.value })}>
                                <option value="">— empty sheds —</option>{freeSheds.map(x => <option key={x.id} value={x.id}>{x.shed_code} · {x.shed_name}{x.capacity ? ` (${x.capacity})` : ''}</option>)}
                            </select>
                            <label className="nav-label required">Placement date</label>
                            <input type="date" className="nav-input" value={place.placement_date} onChange={e => setPlace({ ...place, placement_date: e.target.value })} />
                            <label className="nav-label required">Chicks placed (paid)</label>
                            <input type="number" className="nav-input" value={place.chicks_placed} onChange={e => setPlace({ ...place, chicks_placed: e.target.value })} />
                            <label className="nav-label">Free / extra chicks</label>
                            <input type="number" className="nav-input" value={place.free_chicks} onChange={e => setPlace({ ...place, free_chicks: e.target.value })} />
                            <label className="nav-label">Chick product</label>
                            <select className="nav-select" value={place.chick_product_id} onChange={e => setPlace({ ...place, chick_product_id: e.target.value })}>
                                <option value="">No stock issue (cost entered by hand)</option>{chickItems.map(c => <option key={c.product_id} value={c.product_id}>{c.product_name}</option>)}
                            </select>
                            {place.chick_product_id ? <>
                                <label className="nav-label">Rate per chick</label>
                                <input type="number" className="nav-input" placeholder="blank = stock cost" value={place.chick_rate} onChange={e => setPlace({ ...place, chick_rate: e.target.value })} />
                            </> : <>
                                <label className="nav-label">Total chick cost</label>
                                <input type="number" className="nav-input" value={place.chick_cost_manual} onChange={e => setPlace({ ...place, chick_cost_manual: e.target.value })} />
                            </>}
                            <label className="nav-label">Issue from warehouse</label>
                            <select className="nav-select" value={place.warehouse_id} onChange={e => setPlace({ ...place, warehouse_id: e.target.value })}>
                                <option value="">Shed / farm warehouse</option>{L.warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                            </select>
                            <label className="nav-label">Breed</label>
                            <input className="nav-input" list="breeds" value={place.breed} onChange={e => setPlace({ ...place, breed: e.target.value })} />
                            <label className="nav-label">Hatchery / chick source</label>
                            <input className="nav-input" value={place.chick_source} onChange={e => setPlace({ ...place, chick_source: e.target.value })} />
                            <label className="nav-label">Target weight (kg)</label>
                            <input type="number" className="nav-input" value={place.target_weight_kg} onChange={e => setPlace({ ...place, target_weight_kg: e.target.value })} />
                            <label className="nav-label">Expected lifting by</label>
                            <input type="date" className="nav-input" value={place.expected_close_date} onChange={e => setPlace({ ...place, expected_close_date: e.target.value })} />
                            <label className="nav-label">Remarks</label>
                            <input className="nav-input" value={place.remarks} onChange={e => setPlace({ ...place, remarks: e.target.value })} />
                        </div>
                        <datalist id="breeds"><option value="Cobb 500" /><option value="Ross 308" /><option value="Hubbard" /><option value="Arbor Acres" /><option value="Vencobb 400" /></datalist>
                    </GroupBox>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="nav-btn" onClick={() => setParams({})}>Cancel</button>
                        <button type="button" className="nav-btn primary" onClick={async () => {
                            setErr(''); setWarn([]);
                            try {
                                const r = await authFetch<Batch & { warnings?: string[] }>('/api/poultry/batches', { method: 'POST', body: JSON.stringify(place) });
                                setParams({ id: r.data.id });
                                setOk(`Batch ${r.data.batch_no} placed${r.data.placement_adjustment_no ? ` - chicks issued on ${r.data.placement_adjustment_no}` : ''}`);
                            } catch (e) { setErr(errText(e)); }
                        }}>💾 Place batch</button>
                    </div>
                </NavWindow>
            </Layout>
        );
    }

    // ---------------------------------------------------------------- batch window
    if (id && detail && s) {
        const active = detail.status === 'active';
        const editLog = (l: Log) => {
            setLog({ log_date: l.log_date, mortality: l.mortality, culls: l.culls, mortality_reason: l.mortality_reason || '', avg_weight_g: l.avg_weight_g ?? '', water_l: l.water_l ?? '', temp_min: l.temp_min ?? '', temp_max: l.temp_max ?? '', humidity: l.humidity ?? '', remarks: l.remarks || '', items: l.items.map(i => ({ product_id: i.product_id, qty: i.qty, uom_id: i.uom_id })) });
            setTab('log');
            window.scrollTo(0, 0);
        };
        return (
            <Layout>
                <NavWindow wide title={<>🐔 Batch {detail.batch_no} · {detail.shed_name} <span className="font-normal">({detail.status === 'closed' ? `closed ${detail.closed_on}` : `day ${s.kpi.age_days}, ${s.stage}`})</span></>} tools={<>
                    <button type="button" className="nav-tool-btn" onClick={() => setParams({})}>← Batches</button>
                    <span className="nav-tool-sep" />
                    {([['log', '📝 Daily Log'], ['life', '📈 Lifecycle'], ['lift', '🚚 Lifting'], ['cost', '💰 Cost & Profit'], ['close', active ? '🔒 Close Batch' : '🔓 Reopen']] as [string, string][]).map(([k, l]) => (
                        <button key={k} type="button" className={`nav-tool-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
                    ))}
                    <span className="nav-tool-sep" />
                    <button type="button" className="nav-tool-btn" onClick={loadDetail}>🔄 Refresh</button>
                    <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
                </>}>
                    <Msg ok={ok} err={err} warn={warn} />
                    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                        <Kpi label="Birds in shed" value={n0(s.birds.alive)} sub={`placed ${n0(s.birds.placed)} · lifted ${n0(s.birds.lifted)}`} />
                        <Kpi label="Mortality" tone={s.kpi.mortality_pct > 5 ? 'red' : 'green'} value={pct(s.kpi.mortality_pct)} sub={`${n0(s.birds.dead)} dead · ${n0(s.birds.culls)} culls`} />
                        <Kpi label="FCR" tone="orange" value={n3(s.kpi.fcr)} sub={`feed ${n0(s.kpi.feed_kg)} kg · ${n3(s.kpi.feed_per_bird_kg)} kg/bird`} />
                        <Kpi label="Avg weight" value={`${n3(s.kpi.avg_weight_kg)} kg`} sub={`EPEF ${s.kpi.epef ?? '—'}`} />
                        <Kpi label="Cost / kg" value={s.kpi.cost_per_kg === null ? '—' : n2(s.kpi.cost_per_kg)} sub={`total ${n2(s.costs.total)}`} />
                        <Kpi label="Profit" tone={s.profit >= 0 ? 'green' : 'red'} value={n2(s.profit)} sub={`per kg ${s.profit_per_kg === null ? '—' : n2(s.profit_per_kg)}`} />
                    </div>

                    {tab === 'log' && (
                        <>
                            {active && (
                                <GroupBox title="Daily entry (one per day - saving the same date again corrects it)">
                                    <div className="nav-form-grid">
                                        <label className="nav-label required">Date</label>
                                        <input type="date" className="nav-input" value={log.log_date} onChange={e => setLog({ ...log, log_date: e.target.value })} />
                                        <label className="nav-label">Mortality (dead)</label>
                                        <input type="number" className="nav-input" value={log.mortality} onChange={e => setLog({ ...log, mortality: e.target.value })} />
                                        <label className="nav-label">Culls</label>
                                        <input type="number" className="nav-input" value={log.culls} onChange={e => setLog({ ...log, culls: e.target.value })} />
                                        <label className="nav-label">Cause of death</label>
                                        <input className="nav-input" list="causes" value={log.mortality_reason} onChange={e => setLog({ ...log, mortality_reason: e.target.value })} />
                                        <label className="nav-label">Avg body weight (g)</label>
                                        <input type="number" className="nav-input" value={log.avg_weight_g} onChange={e => setLog({ ...log, avg_weight_g: e.target.value })} />
                                        <label className="nav-label">Water (litre)</label>
                                        <input type="number" className="nav-input" value={log.water_l} onChange={e => setLog({ ...log, water_l: e.target.value })} />
                                        <label className="nav-label">Temp min / max °C</label>
                                        <div className="flex gap-1"><input type="number" className="nav-input" value={log.temp_min} onChange={e => setLog({ ...log, temp_min: e.target.value })} /><input type="number" className="nav-input" value={log.temp_max} onChange={e => setLog({ ...log, temp_max: e.target.value })} /></div>
                                        <label className="nav-label">Humidity %</label>
                                        <input type="number" className="nav-input" value={log.humidity} onChange={e => setLog({ ...log, humidity: e.target.value })} />
                                        <label className="nav-label">Remarks</label>
                                        <input className="nav-input span-3" value={log.remarks} onChange={e => setLog({ ...log, remarks: e.target.value })} />
                                    </div>
                                    <datalist id="causes">{['Weak chicks', 'Heat stress', 'Ascites', 'Coccidiosis', 'CRD / E. coli', 'Gumboro (IBD)', 'Ranikhet (ND)', 'Sudden death', 'Leg problem', 'Predator / injury'].map(c => <option key={c} value={c} />)}</datalist>
                                    <p className="nav-label mt-3 font-semibold">Feed / medicine / vaccine used (issued from stock)</p>
                                    <table className="erp-grid-table" data-no-excel>
                                        <thead><tr><th style={{ minWidth: 220 }}>Item</th><th>Qty</th><th>Unit</th><th /></tr></thead>
                                        <tbody>
                                            {log.items.map((it, i) => (
                                                <tr key={i}>
                                                    <td><select className="nav-select" value={it.product_id} onChange={e => { const pid = e.target.value; const p = L.products.find(x => x.id === pid); setLog({ ...log, items: log.items.map((x, j) => (j === i ? { ...x, product_id: pid, uom_id: p?.base_unit_id || '' } : x)) }); }}>
                                                        <option value="">—</option>{consumables.map(c => <option key={c.product_id} value={c.product_id}>{c.product_name} ({ROLE_LABEL[c.role]})</option>)}</select></td>
                                                    <td><input type="number" className="nav-input" style={{ width: 110 }} value={it.qty} onChange={e => setLog({ ...log, items: log.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} /></td>
                                                    <td><select className="nav-select" value={it.uom_id} onChange={e => setLog({ ...log, items: log.items.map((x, j) => (j === i ? { ...x, uom_id: e.target.value } : x)) })}>
                                                        {L.unitsOf(it.product_id).map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select></td>
                                                    <td><button type="button" className="nav-btn small danger" onClick={() => setLog({ ...log, items: log.items.filter((_, j) => j !== i) })}>✕</button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <button type="button" className="nav-btn" onClick={() => setLog({ ...log, items: [...log.items, { product_id: '', qty: '', uom_id: '' }] })}>➕ Add item</button>
                                        <button type="button" className="nav-btn ml-auto" onClick={() => setLog(blankLog())}>Clear</button>
                                        <button type="button" className="nav-btn primary" onClick={async () => { if (await run(() => post(`/api/poultry/batches/${detail.id}/logs`, { ...log, items: log.items.filter(x => x.product_id && Number(x.qty) > 0) }), `Daily log for ${log.log_date} saved`)) setLog({ ...blankLog(), items: log.items.map(x => ({ ...x })) }); }}>💾 Save day</button>
                                    </div>
                                </GroupBox>
                            )}
                            <GroupBox title="Logs">
                                <div className="overflow-x-auto">
                                    <table className="erp-grid-table">
                                        <thead><tr><th>Date</th><th>Age</th><th className="text-right">Dead</th><th className="text-right">Culls</th><th>Cause</th><th className="text-right">Wt (g)</th><th className="text-right">Water</th><th>Items used</th><th>Stock doc</th><th /></tr></thead>
                                        <tbody>
                                            {detail.logs.map(l => (
                                                <tr key={l.id}>
                                                    <td>{l.log_date}</td><td>{l.age}</td><td className="text-right">{l.mortality}</td><td className="text-right">{l.culls}</td><td>{l.mortality_reason || ''}</td>
                                                    <td className="text-right">{l.avg_weight_g ?? ''}</td><td className="text-right">{l.water_l ?? ''}</td>
                                                    <td>{l.items.map(i => `${i.product_name || productName(i.product_id)} ${i.qty} ${L.unitName(i.uom_id)}`).join(', ')}</td>
                                                    <td className="font-mono">{l.adjustment_no || ''}</td>
                                                    <td className="whitespace-nowrap">{active && <>
                                                        <button type="button" className="nav-btn small" onClick={() => editLog(l)}>Edit</button>{' '}
                                                        <button type="button" className="nav-btn small danger" onClick={() => window.confirm(`Delete the log of ${l.log_date}? Its stock issue is cancelled.`) && run(() => authFetch(`/api/poultry/logs/${l.id}`, { method: 'DELETE' }), 'Log deleted')}>✕</button>
                                                    </>}</td>
                                                </tr>
                                            ))}
                                            {detail.logs.length === 0 && <tr><td colSpan={10} className="text-center text-gray-500 py-4">No daily entries yet.</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </GroupBox>
                        </>
                    )}

                    {tab === 'life' && (
                        <>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-2">
                                <div className="chart-panel"><div className="chart-panel-header">Body weight (g) - actual vs breed standard</div><div className="chart-panel-body">
                                    {weightPoints.length ? <Chart type="line" points={weightPoints} labels={['Actual', 'Standard']} /> : <p className="text-xs text-gray-500 py-8 text-center">Enter sample weights in the daily log (and a breed standard in setup).</p>}</div></div>
                                <div className="chart-panel"><div className="chart-panel-header">Daily mortality + culls</div><div className="chart-panel-body"><Chart type="bar" points={mortPoints} /></div></div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead><tr><th>Date</th><th>Age</th><th className="text-right">Opening</th><th className="text-right">Dead</th><th className="text-right">Culls</th><th className="text-right">Lifted</th><th className="text-right">Closing</th><th className="text-right">Cum mort %</th><th className="text-right">Feed kg</th><th className="text-right">Cum feed kg</th><th className="text-right">Feed g/bird</th><th className="text-right">Wt g</th><th className="text-right">Std g</th></tr></thead>
                                    <tbody>
                                        {detail.days.map(d => (
                                            <tr key={d.date} className={d.has_entry ? '' : 'text-gray-400'}>
                                                <td>{d.date}</td><td>{d.age}</td><td className="text-right">{n0(d.opening)}</td><td className="text-right">{d.mortality || ''}</td><td className="text-right">{d.culls || ''}</td><td className="text-right">{d.lifted || ''}</td>
                                                <td className="text-right">{n0(d.closing)}</td><td className="text-right">{d.cum_mortality_pct.toFixed(2)}</td><td className="text-right">{d.feed_kg ? n2(d.feed_kg) : ''}</td><td className="text-right">{n2(d.cum_feed_kg)}</td>
                                                <td className="text-right">{d.feed_per_bird_g ?? ''}</td><td className="text-right">{d.avg_weight_g ?? ''}</td><td className="text-right">{d.std_weight_g ?? ''}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {tab === 'lift' && (
                        <>
                            {active && (
                                <GroupBox title="Lifting (sale of live birds)">
                                    <div className="nav-form-grid">
                                        <label className="nav-label required">Date</label>
                                        <input type="date" className="nav-input" value={lift.lift_date} onChange={e => setLift({ ...lift, lift_date: e.target.value })} />
                                        <label className="nav-label required">Birds</label>
                                        <input type="number" className="nav-input" value={lift.birds} onChange={e => setLift({ ...lift, birds: e.target.value })} />
                                        <label className="nav-label required">Live weight (kg)</label>
                                        <input type="number" className="nav-input" value={lift.weight_kg} onChange={e => setLift({ ...lift, weight_kg: e.target.value })} />
                                        <label className="nav-label">Rate per kg</label>
                                        <input type="number" className="nav-input" value={lift.rate} onChange={e => setLift({ ...lift, rate: e.target.value })} />
                                        <label className="nav-label">Customer</label>
                                        <SearchablePopupSelect listKey="poultry_lift_customer" columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
                                            items={L.ledgers} getId={(l: { id: string }) => l.id} getLabel={(l: { account_name: string }) => l.account_name} searchKeys={['account_name', 'account_code']}
                                            value={lift.customer_ledger_id} onChange={(v: string) => setLift({ ...lift, customer_ledger_id: v || '' })} placeholder="Customer ledger" />
                                        <label className="nav-label">Vehicle no.</label>
                                        <input className="nav-input" value={lift.vehicle_no} onChange={e => setLift({ ...lift, vehicle_no: e.target.value })} />
                                        <label className="nav-label">Sales bill</label>
                                        <label className="nav-check"><input type="checkbox" checked={lift.make_sales_bill} onChange={e => setLift({ ...lift, make_sales_bill: e.target.checked })} /> Make a draft sales bill for the customer</label>
                                        <label className="nav-label">Remarks</label>
                                        <input className="nav-input" value={lift.remarks} onChange={e => setLift({ ...lift, remarks: e.target.value })} />
                                    </div>
                                    <p className="text-xs text-gray-600 mt-2">Birds come into stock as the live-bird product at the batch's running cost (Stock Adjustment, reason Production). Sell them with a normal sales bill - with the draft option it is prepared for you with the batch cost center, so the sale counts in this batch's profit.</p>
                                    <div className="flex justify-end mt-2">
                                        <button type="button" className="nav-btn primary" onClick={async () => { if (await run(() => post(`/api/poultry/batches/${detail.id}/liftings`, lift), 'Lifting saved')) setLift(blankLift()); }}>💾 Save lifting</button>
                                    </div>
                                </GroupBox>
                            )}
                            <table className="erp-grid-table">
                                <thead><tr><th>Date</th><th className="text-right">Birds</th><th className="text-right">Kg</th><th className="text-right">Avg kg</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th>Vehicle</th><th>Stock doc</th><th>Sales bill</th><th /></tr></thead>
                                <tbody>
                                    {detail.liftings.map(l => (
                                        <tr key={l.id}>
                                            <td>{l.lift_date}</td><td className="text-right">{n0(l.birds)}</td><td className="text-right">{n2(l.weight_kg)}</td><td className="text-right">{n3(l.avg_weight_kg)}</td>
                                            <td className="text-right">{n2(l.rate)}</td><td className="text-right">{n2(l.amount)}</td><td>{l.vehicle_no || ''}</td><td className="font-mono">{l.adjustment_no || ''}</td>
                                            <td>{l.sales_bill_id ? <a className="text-blue-700 underline" href={`/sales-bill?id=${l.sales_bill_id}`}>Open bill</a> : ''}</td>
                                            <td>{active && <button type="button" className="nav-btn small danger" onClick={() => window.confirm('Delete this lifting? Its stock receipt is cancelled.') && run(() => authFetch(`/api/poultry/liftings/${l.id}`, { method: 'DELETE' }), 'Lifting deleted')}>✕</button>}</td>
                                        </tr>
                                    ))}
                                    {detail.liftings.length === 0 && <tr><td colSpan={10} className="text-center text-gray-500 py-4">No liftings yet.</td></tr>}
                                </tbody>
                            </table>
                        </>
                    )}

                    {tab === 'cost' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <GroupBox title="Cost">
                                <table className="erp-grid-table"><tbody>
                                    {([['Chicks', s.costs.chicks], ['Feed', s.costs.feed], ['Medicine', s.costs.medicine], ['Vaccine', s.costs.vaccine], ['Litter', s.costs.litter], ['Other items', s.costs.other_items], ['Direct expenses (batch cost center)', s.costs.direct_expenses], ['Shed expenses share', s.costs.shed_share]] as [string, number][]).map(([l, v]) => <tr key={l}><td>{l}</td><td className="text-right">{n2(v)}</td></tr>)}
                                </tbody><tfoot><tr><td>Total cost</td><td className="text-right">{n2(s.costs.total)}</td></tr></tfoot></table>
                            </GroupBox>
                            <GroupBox title="Revenue & profit">
                                <table className="erp-grid-table"><tbody>
                                    <tr><td>Sales (bills with this batch's cost center)</td><td className="text-right">{n2(s.revenue.sales)}</td></tr>
                                    <tr><td>Liftings not billed yet (at lifting rate)</td><td className="text-right">{n2(s.revenue.unbilled_liftings)}</td></tr>
                                    <tr><td>Other income</td><td className="text-right">{n2(s.revenue.other_income)}</td></tr>
                                    <tr><td>Total revenue</td><td className="text-right font-semibold">{n2(s.revenue.total)}</td></tr>
                                </tbody><tfoot><tr><td>Profit / loss</td><td className={`text-right ${s.profit < 0 ? 'text-red-700' : 'text-green-800'}`}>{n2(s.profit)}</td></tr></tfoot></table>
                                <p className="text-xs text-gray-600 mt-2">Per kg {s.profit_per_kg === null ? '—' : n2(s.profit_per_kg)} · per bird {s.profit_per_bird === null ? '—' : n2(s.profit_per_bird)} · cost per bird {s.kpi.cost_per_bird === null ? '—' : n2(s.kpi.cost_per_bird)}</p>
                                <p className="text-xs text-gray-600">Chicks issued on {detail.placement_adjustment_no || '—'}. Expenses booked in any voucher with this batch's cost center are added automatically.</p>
                            </GroupBox>
                        </div>
                    )}

                    {tab === 'close' && (active ? (
                        <GroupBox title="Close batch (shed becomes empty)">
                            <div className="nav-form-grid">
                                <label className="nav-label">Close date</label>
                                <input type="date" className="nav-input" value={closeForm.closed_on} onChange={e => setCloseForm({ ...closeForm, closed_on: e.target.value })} />
                                <label className="nav-label">Birds left</label>
                                <label className="nav-check"><input type="checkbox" checked={closeForm.write_off_remaining} onChange={e => setCloseForm({ ...closeForm, write_off_remaining: e.target.checked })} /> Write off the {n0(s.birds.alive)} birds still counted as mortality</label>
                                <label className="nav-label">Notes</label>
                                <input className="nav-input span-3" value={closeForm.close_notes} onChange={e => setCloseForm({ ...closeForm, close_notes: e.target.value })} />
                            </div>
                            <div className="flex justify-between mt-3">
                                <button type="button" className="nav-btn danger" onClick={() => window.confirm('Delete this batch? Only possible without logs / liftings; the chick issue is cancelled.') && authFetch(`/api/poultry/batches/${detail.id}`, { method: 'DELETE' }).then(() => setParams({})).catch(e => setErr(errText(e)))}>🗑 Delete batch</button>
                                <button type="button" className="nav-btn primary" onClick={() => run(() => post(`/api/poultry/batches/${detail.id}/close`, closeForm), 'Batch closed')}>🔒 Close batch</button>
                            </div>
                        </GroupBox>
                    ) : (
                        <GroupBox title="Reopen">
                            <p className="text-sm mb-2">Closed on {detail.closed_on}. {detail.close_notes || ''}</p>
                            <button type="button" className="nav-btn" onClick={() => run(() => post(`/api/poultry/batches/${detail.id}/reopen`, {}), 'Batch reopened')}>🔓 Reopen batch</button>
                        </GroupBox>
                    ))}
                </NavWindow>
            </Layout>
        );
    }

    // ---------------------------------------------------------------- list
    return (
        <Layout>
            <NavWindow wide title="🐔 Broiler Batches" tools={<>
                <button type="button" className="nav-tool-btn" onClick={() => setParams({ new: '1' })}>➕ New placement</button>
                <span className="nav-tool-sep" />
                {([['active', 'Running'], ['closed', 'Closed'], ['all', 'All']] as [string, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={`nav-tool-btn ${status === k ? 'active' : ''}`} onClick={() => setParams({ status: k })}>{l}</button>
                ))}
                <span className="nav-tool-sep" />
                <select className="nav-select" style={{ width: 180, height: 24 }} value={params.get('shed') || ''} onChange={e => setParams({ status, ...(e.target.value ? { shed: e.target.value } : {}) })}>
                    <option value="">All sheds</option>{sheds.map(x => <option key={x.id} value={x.id}>{x.shed_name}</option>)}
                </select>
                <button type="button" className="nav-tool-btn" onClick={loadList}>🔄 Refresh</button>
                <a className="nav-tool-btn" href="/poultry/reports?view=profitability">📊 Reports</a>
            </>}>
                <Msg err={err} />
                {id && !detail && !err && <p className="text-sm text-gray-500">Loading…</p>}
                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>Batch</th><th>Shed</th><th>Breed</th><th>Placed on</th><th className="text-right">Age</th><th>Stage</th><th className="text-right">Placed</th><th className="text-right">Alive</th><th className="text-right">Mort %</th><th className="text-right">Feed kg</th><th className="text-right">FCR</th><th className="text-right">Avg kg</th><th className="text-right">Cost</th><th className="text-right">Profit</th></tr></thead>
                        <tbody>
                            {rows.map(b => (
                                <tr key={b.id} className="cursor-pointer" onClick={() => setParams({ id: b.id })}>
                                    <td className="font-mono text-blue-700 underline">{b.batch_no}</td><td>{b.shed_name}</td><td>{b.breed || ''}</td><td>{b.placement_date}</td>
                                    <td className="text-right">{b.kpi?.age_days}</td><td><span className={`px-1 ${STAGE_TONE[b.stage || ''] || ''}`}>{b.stage}</span></td>
                                    <td className="text-right">{n0(b.birds?.placed)}</td><td className="text-right">{n0(b.birds?.alive)}</td><td className="text-right">{b.kpi?.mortality_pct?.toFixed(2)}</td>
                                    <td className="text-right">{n0(b.kpi?.feed_kg)}</td><td className="text-right">{n3(b.kpi?.fcr)}</td><td className="text-right">{n3(b.kpi?.avg_weight_kg)}</td>
                                    <td className="text-right">{n2(b.costs?.total)}</td><td className={`text-right ${(b.profit || 0) < 0 ? 'text-red-700' : ''}`}>{n2(b.profit)}</td>
                                </tr>
                            ))}
                            {rows.length === 0 && <tr><td colSpan={14} className="text-center text-gray-500 py-6">No batches. Click “New placement”.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </NavWindow>
        </Layout>
    );
}
