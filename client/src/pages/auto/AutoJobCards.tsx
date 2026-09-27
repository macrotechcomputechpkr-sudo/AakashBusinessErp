// =============================================
// auto/AutoJobCards.tsx  (/auto/job-cards?status=&id=&new=1&vehicle=)
// Workshop job cards: vehicle in (km, fuel, complaints, service type) ->
// labour -> item issue for the job card (parts from store, returns) ->
// outside work (sent / back) -> vehicle ready for delivery -> vehicle
// delivery complete (job invoice posted, next service reminder).
// Server: utils/automobile.js.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Kpi, Msg, NavWindow, SearchablePopupSelect, errText, n0, n2, today, useLookups } from '../../components/poultry/common';
import { LedgerPick } from '../construction/common';

interface Labour { description: string; hours: number | string; rate: number | string; amount?: number; chargeable: boolean }
interface Part { id: string; issue_date: string; product_name: string; product_code: string; qty: number; cost_amount: number; sale_rate: number; sale_amount: number; chargeable: boolean; adjustment_no: string | null }
interface Outside { id: string; doc_no: string; vendor_name: string | null; work_description: string; sent_date: string; received_date: string | null; cost_amount: number; charge_amount: number; status: string }
interface Job {
    id: string; doc_no: string; vehicle_id: string; customer_ledger_id: string | null; customer_name: string | null; customer_phone: string | null; date_in: string; odometer_in: number; fuel_level: string | null;
    service_type: string; complaints: string | null; advisor: string | null; technician: string | null; promised_date: string | null; status: string; ready_at: string | null; delivered_on: string | null;
    labour: Labour[]; parts_amount: number; labour_amount: number; outside_amount: number; discount_amount: number; vat_amount: number; total_amount: number; work_done: string | null;
    next_service_date: string | null; next_service_km: number | null; reg_no?: string; chassis_no?: string; model_name?: string;
    vehicle?: { id: string; chassis_no: string; reg_no: string | null; model_name: string | null; color: string | null; odometer: number };
    parts?: Part[]; outside_works?: Outside[]; parts_cost?: number; outside_cost?: number; margin?: number;
}
const STATUS: Record<string, string> = { open: 'Open', in_progress: 'In progress', outside_work: 'At outside work', ready: 'Ready for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
const TYPES: [string, string][] = [['paid', 'Paid service'], ['free', 'Free service'], ['warranty', 'Warranty'], ['accident', 'Accident / body'], ['running', 'Running repair']];

export default function AutoJobCards() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const id = params.get('id');
    const isNew = !!params.get('new');
    const status = params.get('status') || 'open_all';
    const L = useLookups(authFetch, { ledgers: true });
    const [rows, setRows] = useState<Job[]>([]);
    const [j, setJ] = useState<Job | null>(null);
    const [vehicles, setVehicles] = useState<{ id: string; chassis_no: string; reg_no: string | null; model_name: string | null; customer_name: string | null; customer_phone: string | null; customer_ledger_id: string | null; odometer: number }[]>([]);
    const [nf, setNf] = useState({ vehicle_id: params.get('vehicle') || '', reg_no: '', chassis_no: '', model_name: '', customer_name: '', customer_phone: '', customer_ledger_id: '', odometer_in: '', fuel_level: '', service_type: 'paid',
        complaints: '', advisor: '', technician: '', promised_date: '' });
    const [labour, setLabour] = useState<Labour[]>([]);
    const [edit, setEdit] = useState({ complaints: '', technician: '', advisor: '', promised_date: '', discount_amount: '', work_done: '' });
    const [parts, setParts] = useState([{ product_id: '', qty: '', sale_rate: '', chargeable: true }]);
    const [ret, setRet] = useState(false);
    const [ow, setOw] = useState({ vendor_ledger_id: '', vendor_name: '', work_description: '', cost_amount: '', charge_amount: '' });
    const [dlv, setDlv] = useState({ bill_to_ledger_id: '', next_service_date: '', next_service_km: '' });
    const [search, setSearch] = useState('');
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const [warn, setWarn] = useState<string[]>([]);

    const loadList = useCallback(async () => {
        try { setRows((await authFetch<Job[]>(`/api/auto/job-cards?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`)).data); } catch (x) { setErr(errText(x)); }
    }, [authFetch, status, search]);
    const loadOne = useCallback(async () => {
        if (!id) { setJ(null); return; }
        try {
            const r = (await authFetch<Job>(`/api/auto/job-cards/${id}`)).data;
            setJ(r); setLabour(r.labour || []);
            setEdit({ complaints: r.complaints || '', technician: r.technician || '', advisor: r.advisor || '', promised_date: r.promised_date || '', discount_amount: r.discount_amount ? String(r.discount_amount) : '', work_done: r.work_done || '' });
            setDlv(d => ({ ...d, bill_to_ledger_id: r.customer_ledger_id || '' }));
        } catch (x) { setErr(errText(x)); }
    }, [authFetch, id]);
    useEffect(() => { if (!id && !isNew) loadList(); }, [loadList, id, isNew]);
    useEffect(() => { loadOne(); }, [loadOne]);
    useEffect(() => { if (isNew) authFetch<typeof vehicles>('/api/auto/vehicles?ownership=customer').then(r => setVehicles(r.data)).catch(() => undefined); }, [authFetch, isNew]);

    const run = async (fn: () => Promise<unknown>, done: string) => {
        setOk(''); setErr(''); setWarn([]);
        try { const r = await fn() as { data?: { warnings?: string[] } }; if (r?.data?.warnings?.length) setWarn(r.data.warnings); setOk(done); await loadOne(); return true; } catch (x) { setErr(errText(x)); return false; }
    };
    const call = (url: string, body?: unknown, method = 'POST') => authFetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const labourTable = (editable: boolean) => (
        <table className="erp-grid-table">
            <thead><tr><th style={{ minWidth: 240 }}>Labour / work</th><th>Hours</th><th>Rate</th><th className="text-right">Amount</th><th>Charge</th>{editable && <th />}</tr></thead>
            <tbody>{labour.map((l, i) => (
                <tr key={i}>
                    <td>{editable ? <input className="nav-input" value={l.description} onChange={x => setLabour(a => a.map((y, k) => (k === i ? { ...y, description: x.target.value } : y)))} /> : l.description}</td>
                    <td>{editable ? <input type="number" className="nav-input" style={{ width: 70 }} value={l.hours} onChange={x => setLabour(a => a.map((y, k) => (k === i ? { ...y, hours: x.target.value } : y)))} /> : l.hours}</td>
                    <td>{editable ? <input type="number" className="nav-input" style={{ width: 90 }} value={l.rate} onChange={x => setLabour(a => a.map((y, k) => (k === i ? { ...y, rate: x.target.value } : y)))} /> : n2(Number(l.rate))}</td>
                    <td className="text-right">{n2((Number(l.hours) || 0) * (Number(l.rate) || 0))}</td>
                    <td><input type="checkbox" disabled={!editable} checked={l.chargeable !== false} onChange={x => setLabour(a => a.map((y, k) => (k === i ? { ...y, chargeable: x.target.checked } : y)))} /></td>
                    {editable && <td><button type="button" className="nav-btn small" onClick={() => setLabour(a => a.filter((_, k) => k !== i))}>✕</button></td>}
                </tr>
            ))}</tbody>
            {editable && <tfoot><tr><td colSpan={6}><button type="button" className="nav-btn small" onClick={() => setLabour(a => [...a, { description: '', hours: '', rate: '', chargeable: true }])}>➕ Labour</button></td></tr></tfoot>}
        </table>
    );

    // ---------------------------------------------------------------- new job card
    if (isNew) {
        const pick = vehicles.find(x => x.id === nf.vehicle_id);
        return (
            <Layout>
                <NavWindow wide title="🔧 New Job Card" tools={<button type="button" className="nav-tool-btn" onClick={() => setParams({})}>← Job cards</button>}>
                    <Msg ok={ok} err={err} />
                    <GroupBox title="Vehicle in">
                        <div className="nav-form-grid">
                            <label className="nav-label">Vehicle</label>
                            <SearchablePopupSelect listKey="auto_job_vehicle" columns={[{ key: 'reg_no', label: 'Reg. no.' }, { key: 'chassis_no', label: 'Chassis' }, { key: 'model_name', label: 'Model' }, { key: 'customer_name', label: 'Customer' }, { key: 'customer_phone', label: 'Phone' }]}
                                defaultVisibleKeys={['reg_no', 'chassis_no', 'model_name', 'customer_name']} items={vehicles} getId={x => x.id} getLabel={x => `${x.reg_no || x.chassis_no} · ${x.model_name || ''} · ${x.customer_name || ''}`}
                                searchKeys={['reg_no', 'chassis_no', 'model_name', 'customer_name', 'customer_phone']} value={nf.vehicle_id} onChange={x => setNf({ ...nf, vehicle_id: x })} placeholder="Search reg / chassis / customer" />
                            {!nf.vehicle_id && <>
                                <label className="nav-label">…or a new vehicle: reg. / chassis</label>
                                <div className="flex gap-1"><input className="nav-input" placeholder="reg. no." value={nf.reg_no} onChange={x => setNf({ ...nf, reg_no: x.target.value.toUpperCase() })} /><input className="nav-input" placeholder="chassis" value={nf.chassis_no} onChange={x => setNf({ ...nf, chassis_no: x.target.value.toUpperCase() })} /></div>
                                <label className="nav-label">Model</label><input className="nav-input" value={nf.model_name} onChange={x => setNf({ ...nf, model_name: x.target.value })} />
                                <label className="nav-label">Customer name / phone</label>
                                <div className="flex gap-1"><input className="nav-input" value={nf.customer_name} onChange={x => setNf({ ...nf, customer_name: x.target.value })} /><input className="nav-input" value={nf.customer_phone} onChange={x => setNf({ ...nf, customer_phone: x.target.value })} /></div>
                                <label className="nav-label">Customer ledger</label><LedgerPick listKey="auto_job_cust" ledgers={L.ledgers} value={nf.customer_ledger_id} onChange={x => setNf({ ...nf, customer_ledger_id: x })} placeholder="Customer (blank = cash)" />
                            </>}
                            {pick && <><label className="nav-label">Customer</label><div className="nav-input bg-gray-50">{pick.customer_name} · {pick.customer_phone} · last {n0(pick.odometer)} km</div></>}
                            <label className="nav-label required">Odometer in (km)</label><input type="number" className="nav-input" value={nf.odometer_in} onChange={x => setNf({ ...nf, odometer_in: x.target.value })} />
                            <label className="nav-label">Fuel level</label>
                            <select className="nav-select" value={nf.fuel_level} onChange={x => setNf({ ...nf, fuel_level: x.target.value })}><option value="">—</option>{['Empty', '1/4', '1/2', '3/4', 'Full'].map(x => <option key={x} value={x}>{x}</option>)}</select>
                            <label className="nav-label">Service type</label>
                            <select className="nav-select" value={nf.service_type} onChange={x => setNf({ ...nf, service_type: x.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                            <label className="nav-label">Service advisor / technician</label>
                            <div className="flex gap-1"><input className="nav-input" value={nf.advisor} onChange={x => setNf({ ...nf, advisor: x.target.value })} /><input className="nav-input" value={nf.technician} onChange={x => setNf({ ...nf, technician: x.target.value })} /></div>
                            <label className="nav-label">Promised delivery</label><input type="date" className="nav-input" value={nf.promised_date} onChange={x => setNf({ ...nf, promised_date: x.target.value })} />
                        </div>
                        <label className="nav-label mt-2 block">Customer complaints / work asked</label>
                        <textarea className="nav-input" style={{ width: '100%', height: 80 }} value={nf.complaints} onChange={x => setNf({ ...nf, complaints: x.target.value })} />
                    </GroupBox>
                    <GroupBox title="Labour (can be added later too)">{labourTable(true)}</GroupBox>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="nav-btn" onClick={() => setParams({})}>Cancel</button>
                        <button type="button" className="nav-btn primary" onClick={async () => {
                            setErr('');
                            try { const r = await authFetch<Job>('/api/auto/job-cards', { method: 'POST', body: JSON.stringify({ ...nf, labour }) }); setParams({ id: r.data.id }); } catch (x) { setErr(errText(x)); }
                        }}>💾 Open job card</button>
                    </div>
                </NavWindow>
            </Layout>
        );
    }

    // ---------------------------------------------------------------- one job card
    if (id && j) {
        const live = !['delivered', 'cancelled'].includes(j.status);
        const canWork = ['open', 'in_progress', 'outside_work'].includes(j.status);
        const flow = ['open', 'in_progress', 'outside_work', 'ready', 'delivered'];
        return (
            <Layout>
                <NavWindow wide title={<>🔧 {j.doc_no} · {j.vehicle?.reg_no || j.vehicle?.chassis_no} · {j.vehicle?.model_name || ''} <span className="font-normal">({STATUS[j.status]} · {j.customer_name || ''})</span></>} tools={<>
                    <button type="button" className="nav-tool-btn" onClick={() => setParams({})}>← Job cards</button>
                    {live && <button type="button" className="nav-tool-btn" onClick={() => run(() => call(`/api/auto/job-cards/${j.id}`, { ...edit, labour }, 'PUT'), 'Job card saved')}>💾 Save</button>}
                    <button type="button" className="nav-tool-btn" onClick={loadOne}>🔄 Refresh</button>
                    <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
                </>}>
                    <Msg ok={ok} err={err} warn={warn} />
                    <div className="flex flex-wrap gap-1 mb-2 text-xs">{flow.map(s => <span key={s} className={`px-2 py-1 border ${j.status === s ? 'bg-blue-700 text-white' : flow.indexOf(s) < flow.indexOf(j.status) ? 'bg-green-100' : 'bg-gray-100'}`}>{STATUS[s]}</span>)}</div>
                    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                        <Kpi label="Parts" value={n2(j.parts_amount)} sub={`cost ${n2(j.parts_cost)}`} />
                        <Kpi label="Labour" value={n2(j.labour_amount)} />
                        <Kpi label="Outside work" value={n2(j.outside_amount)} sub={`cost ${n2(j.outside_cost)}`} />
                        <Kpi label="Total incl. VAT" tone="orange" value={n2(j.total_amount)} sub={`VAT ${n2(j.vat_amount)} · disc ${n2(j.discount_amount)}`} />
                        <Kpi label="Workshop margin" tone={(j.margin || 0) >= 0 ? 'green' : 'red'} value={n2(j.margin)} />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                            <GroupBox title={`Vehicle in ${j.date_in} · ${n0(j.odometer_in)} km · fuel ${j.fuel_level || '—'} · ${TYPES.find(t => t[0] === j.service_type)?.[1]}`}>
                                <div className="nav-form-grid">
                                    <label className="nav-label">Complaints</label><textarea className="nav-input" style={{ height: 60 }} disabled={!live} value={edit.complaints} onChange={x => setEdit({ ...edit, complaints: x.target.value })} />
                                    <label className="nav-label">Advisor / technician</label>
                                    <div className="flex gap-1"><input className="nav-input" disabled={!live} value={edit.advisor} onChange={x => setEdit({ ...edit, advisor: x.target.value })} /><input className="nav-input" disabled={!live} value={edit.technician} onChange={x => setEdit({ ...edit, technician: x.target.value })} /></div>
                                    <label className="nav-label">Promised</label><input type="date" className="nav-input" disabled={!live} value={edit.promised_date} onChange={x => setEdit({ ...edit, promised_date: x.target.value })} />
                                    <label className="nav-label">Discount</label><input type="number" className="nav-input" disabled={!live} value={edit.discount_amount} onChange={x => setEdit({ ...edit, discount_amount: x.target.value })} />
                                    <label className="nav-label">Work done</label><textarea className="nav-input" style={{ height: 60 }} disabled={!live} value={edit.work_done} onChange={x => setEdit({ ...edit, work_done: x.target.value })} />
                                </div>
                            </GroupBox>
                            <GroupBox title="Labour">{labourTable(live)}</GroupBox>
                            <GroupBox title="Outside work (sent to another workshop)">
                                <table className="erp-grid-table">
                                    <thead><tr><th>No.</th><th>Workshop</th><th>Work</th><th>Sent</th><th>Back</th><th className="text-right">Cost</th><th className="text-right">Charge</th><th /></tr></thead>
                                    <tbody>{(j.outside_works || []).map(o => (
                                        <tr key={o.id}><td className="font-mono">{o.doc_no}</td><td>{o.vendor_name}</td><td>{o.work_description}</td><td>{o.sent_date}</td><td>{o.received_date || ''}</td>
                                            <td className="text-right">{n2(o.cost_amount)}</td><td className="text-right">{n2(o.charge_amount)}</td>
                                            <td className="whitespace-nowrap">{o.status === 'sent' && <button type="button" className="nav-btn small primary" onClick={() => {
                                                const cost = window.prompt('Final cost from the workshop:', String(o.cost_amount)); if (cost === null) return;
                                                const charge = window.prompt('Charge to the customer:', String(o.charge_amount)); if (charge === null) return;
                                                run(() => call(`/api/auto/outside-works/${o.id}/receive`, { cost_amount: cost, charge_amount: charge }, 'PUT'), `${o.doc_no} back - cost posted`);
                                            }}>Back</button>}
                                                {live && <button type="button" className="nav-btn small danger" onClick={() => window.confirm('Remove this outside work?') && run(() => call(`/api/auto/outside-works/${o.id}`, undefined, 'DELETE'), 'Removed')}>✕</button>}</td></tr>
                                    ))}</tbody>
                                </table>
                                {canWork && (
                                    <div className="nav-form-grid mt-2">
                                        <label className="nav-label">Workshop (ledger)</label><LedgerPick listKey="auto_ow_vendor" ledgers={L.ledgers} value={ow.vendor_ledger_id} onChange={x => setOw({ ...ow, vendor_ledger_id: x })} placeholder="Outside workshop" />
                                        <label className="nav-label">Work</label><input className="nav-input" value={ow.work_description} onChange={x => setOw({ ...ow, work_description: x.target.value })} />
                                        <label className="nav-label">Cost / charge to customer</label>
                                        <div className="flex gap-1"><input type="number" className="nav-input" placeholder="cost" value={ow.cost_amount} onChange={x => setOw({ ...ow, cost_amount: x.target.value })} /><input type="number" className="nav-input" placeholder="charge" value={ow.charge_amount} onChange={x => setOw({ ...ow, charge_amount: x.target.value })} /></div>
                                        <span /><button type="button" className="nav-btn" onClick={() => run(() => call(`/api/auto/job-cards/${j.id}/outside-works`, ow), 'Sent to outside work').then(d => d && setOw({ vendor_ledger_id: '', vendor_name: '', work_description: '', cost_amount: '', charge_amount: '' }))}>🚚 Send out</button>
                                    </div>
                                )}
                            </GroupBox>
                        </div>
                        <div>
                            <GroupBox title="Item issue for job card (parts)">
                                <table className="erp-grid-table">
                                    <thead><tr><th>Date</th><th>Part</th><th className="text-right">Qty</th><th className="text-right">Cost</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th>Charge</th><th /></tr></thead>
                                    <tbody>{(j.parts || []).map(p => (
                                        <tr key={p.id} className={p.qty < 0 ? 'text-orange-700' : ''}><td>{p.issue_date}</td><td>{p.product_name}</td><td className="text-right">{n2(p.qty)}</td><td className="text-right">{n2(p.cost_amount)}</td>
                                            <td className="text-right">{n2(p.sale_rate)}</td><td className="text-right">{n2(p.sale_amount)}</td><td>{p.chargeable ? 'Yes' : 'Free'}</td>
                                            <td>{live && <button type="button" className="nav-btn small danger" onClick={() => window.confirm('Remove this issue? Stock goes back.') && run(() => call(`/api/auto/job-parts/${p.id}`, undefined, 'DELETE'), 'Removed')}>✕</button>}</td></tr>
                                    ))}
                                    {!(j.parts || []).length && <tr><td colSpan={8} className="text-center text-gray-500">No parts issued.</td></tr>}</tbody>
                                </table>
                                {canWork && (
                                    <>
                                        <div className="flex gap-4 text-sm mt-2"><label><input type="radio" checked={!ret} onChange={() => setRet(false)} /> Issue from store</label><label><input type="radio" checked={ret} onChange={() => setRet(true)} /> Return to store</label></div>
                                        <table className="erp-grid-table mt-1">
                                            <thead><tr><th style={{ minWidth: 220 }}>Part</th><th>Qty</th>{!ret && <><th>Selling rate</th><th>Charge</th></>}<th /></tr></thead>
                                            <tbody>{parts.map((p, i) => (
                                                <tr key={i}>
                                                    <td><SearchablePopupSelect listKey="auto_part_picker" columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Part' }]} defaultVisibleKeys={['product_code', 'product_name']}
                                                        items={L.products} getId={x => x.id} getLabel={x => x.product_name} searchKeys={['product_name', 'product_code']} value={p.product_id} onChange={x => setParts(a => a.map((y, k) => (k === i ? { ...y, product_id: x } : y)))} placeholder="Part" /></td>
                                                    <td><input type="number" className="nav-input" style={{ width: 80 }} value={p.qty} onChange={x => setParts(a => a.map((y, k) => (k === i ? { ...y, qty: x.target.value } : y)))} /></td>
                                                    {!ret && <><td><input type="number" className="nav-input" style={{ width: 100 }} placeholder="item rate" value={p.sale_rate} onChange={x => setParts(a => a.map((y, k) => (k === i ? { ...y, sale_rate: x.target.value } : y)))} /></td>
                                                        <td><input type="checkbox" checked={p.chargeable} onChange={x => setParts(a => a.map((y, k) => (k === i ? { ...y, chargeable: x.target.checked } : y)))} /></td></>}
                                                    <td><button type="button" className="nav-btn small" onClick={() => setParts(a => (a.length > 1 ? a.filter((_, k) => k !== i) : a))}>✕</button></td>
                                                </tr>
                                            ))}</tbody>
                                            <tfoot><tr><td colSpan={5}><button type="button" className="nav-btn small" onClick={() => setParts(a => [...a, { product_id: '', qty: '', sale_rate: '', chargeable: !['free', 'warranty'].includes(j.service_type) }])}>➕ Part</button></td></tr></tfoot>
                                        </table>
                                        <div className="flex justify-end mt-2"><button type="button" className="nav-btn primary" onClick={() => run(() => call(`/api/auto/job-cards/${j.id}/parts`, { return: ret, lines: parts.map(p => ({ ...p, qty: Number(p.qty) })) }), ret ? 'Parts returned to store' : 'Parts issued').then(d => d && setParts([{ product_id: '', qty: '', sale_rate: '', chargeable: !['free', 'warranty'].includes(j.service_type) }]))}>📦 {ret ? 'Return' : 'Issue'} parts</button></div>
                                    </>
                                )}
                            </GroupBox>
                            <GroupBox title="Status">
                                {j.status === 'open' && <button type="button" className="nav-btn" onClick={() => run(() => call(`/api/auto/job-cards/${j.id}/status`, { status: 'in_progress' }, 'PUT'), 'Work started')}>▶ Start work</button>}
                                {canWork && <button type="button" className="nav-btn primary ml-1" onClick={() => run(() => call(`/api/auto/job-cards/${j.id}/status`, { status: 'ready', work_done: edit.work_done }, 'PUT'), 'Vehicle ready for delivery')}>✅ Vehicle ready for delivery</button>}
                                {j.status === 'ready' && (
                                    <>
                                        <p className="text-sm mb-2">Ready since {j.ready_at ? new Date(j.ready_at).toLocaleString() : ''}. Call the customer {j.customer_phone ? <a className="underline" href={`tel:${j.customer_phone}`}>{j.customer_phone}</a> : ''}.</p>
                                        <div className="nav-form-grid">
                                            <label className="nav-label">Bill to</label><LedgerPick listKey="auto_bill_to" ledgers={L.ledgers} value={dlv.bill_to_ledger_id} onChange={x => setDlv({ ...dlv, bill_to_ledger_id: x })} placeholder="Customer (blank = setup cash)" />
                                            <label className="nav-label">Next service date / km</label>
                                            <div className="flex gap-1"><input type="date" className="nav-input" value={dlv.next_service_date} onChange={x => setDlv({ ...dlv, next_service_date: x.target.value })} /><input type="number" className="nav-input" placeholder="km (blank = setup)" value={dlv.next_service_km} onChange={x => setDlv({ ...dlv, next_service_km: x.target.value })} /></div>
                                        </div>
                                        <div className="flex justify-between mt-2">
                                            <button type="button" className="nav-btn" onClick={() => run(() => call(`/api/auto/job-cards/${j.id}/status`, { status: 'in_progress' }, 'PUT'), 'Back to work')}>↩ More work needed</button>
                                            <button type="button" className="nav-btn primary" onClick={() => run(() => call(`/api/auto/job-cards/${j.id}/status`, { status: 'delivered', delivered_on: today(), ...dlv }, 'PUT'), 'Vehicle delivery complete - invoice posted, next service reminder made')}>🔑 Vehicle delivery complete ({n2(j.total_amount)})</button>
                                        </div>
                                    </>
                                )}
                                {j.status === 'delivered' && <p className="text-sm">Delivered on {j.delivered_on}. Next service {j.next_service_date} / {n0(j.next_service_km)} km. <button type="button" className="nav-btn small ml-2" onClick={() => window.confirm('Reopen? The job invoice is reversed.') && run(() => call(`/api/auto/job-cards/${j.id}/status`, { status: 'reopen' }, 'PUT'), 'Reopened')}>↩ Reopen</button></p>}
                                {live && j.status !== 'ready' && <button type="button" className="nav-btn danger ml-1" onClick={() => { const why = window.prompt('Cancel this job card? Reason:'); if (why) run(() => call(`/api/auto/job-cards/${j.id}/status`, { status: 'cancelled', reason: why }, 'PUT'), 'Cancelled'); }}>✕ Cancel job</button>}
                            </GroupBox>
                        </div>
                    </div>
                </NavWindow>
            </Layout>
        );
    }

    return (
        <Layout>
            <NavWindow wide title="🔧 Job Cards" tools={<>
                <button type="button" className="nav-tool-btn" onClick={() => setParams({ new: '1' })}>➕ New job card</button>
                <span className="nav-tool-sep" />
                {([['open_all', 'All open'], ['open', 'Open'], ['in_progress', 'In progress'], ['outside_work', 'Outside work'], ['ready', 'Ready for delivery'], ['delivered', 'Delivered'], ['all', 'All']] as [string, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={`nav-tool-btn ${status === k ? 'active' : ''}`} onClick={() => setParams({ status: k })}>{l}</button>
                ))}
                <span className="nav-tool-sep" />
                <input className="nav-input" style={{ width: 180, height: 24 }} placeholder="Job / reg / customer" value={search} onChange={x => setSearch(x.target.value)} onKeyDown={x => x.key === 'Enter' && loadList()} />
                <button type="button" className="nav-tool-btn" onClick={loadList}>🔍</button>
            </>}>
                <Msg err={err} />
                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>Job</th><th>In</th><th>Reg. no.</th><th>Model</th><th>Customer</th><th>Phone</th><th>Type</th><th className="text-right">Km</th><th>Promised</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
                        <tbody>{rows.map(r => (
                            <tr key={r.id} className="cursor-pointer" onClick={() => setParams({ id: r.id })}>
                                <td className="font-mono text-blue-700 underline">{r.doc_no}</td><td>{r.date_in}</td><td>{r.reg_no || r.chassis_no}</td><td>{r.model_name}</td><td>{r.customer_name}</td><td>{r.customer_phone}</td>
                                <td>{TYPES.find(t => t[0] === r.service_type)?.[1]}</td><td className="text-right">{n0(r.odometer_in)}</td>
                                <td className={r.promised_date && r.promised_date < today() && !['delivered', 'cancelled'].includes(r.status) ? 'text-red-700 font-semibold' : ''}>{r.promised_date || ''}</td>
                                <td className={r.status === 'ready' ? 'text-green-800 font-semibold' : ''}>{STATUS[r.status]}</td><td className="text-right">{n2(r.total_amount)}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={11} className="text-center text-gray-500 py-6">No job cards here.</td></tr>}</tbody>
                    </table>
                </div>
            </NavWindow>
        </Layout>
    );
}
