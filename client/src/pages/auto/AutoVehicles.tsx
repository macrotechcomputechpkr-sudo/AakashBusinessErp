// =============================================
// auto/AutoVehicles.tsx  (/auto/vehicles?ownership=stock|customer&id=&new=1)
// Every vehicle by chassis. New vehicles in stock -> PDI checklist ->
// delivery to the customer (documents, keys, accessories, registration;
// free-service reminders are made). Customer vehicles carry their job
// cards and reminders. Server: utils/automobile.js.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Msg, NavWindow, SearchablePopupSelect, errText, n0, n2, today, useLookups } from '../../components/poultry/common';
import { LedgerPick } from '../construction/common';

interface Pdi { id: string; doc_no: string; pdi_date: string; inspector: string | null; odometer: number; result: string; checklist: { item: string; ok: boolean; remark: string | null }[]; remarks: string | null }
interface Delivery { id: string; doc_no: string; delivery_date: string; customer_name: string; reg_no: string | null; finance_company: string | null; keys_given: number; accessories: string | null; documents: { item: string; given: boolean }[]; status: string; delivered_by: string | null }
interface Vehicle {
    id: string; chassis_no: string; engine_no: string | null; product_id: string | null; model_name: string | null; variant: string | null; color: string | null; model_year: number | null; reg_no: string | null;
    ownership: string; customer_ledger_id: string | null; customer_name: string | null; customer_phone: string | null; sale_date: string | null; odometer: number; status: string; remarks: string | null;
    pdis?: Pdi[]; deliveries?: Delivery[]; job_cards?: { id: string; doc_no: string; date_in: string; odometer_in: number; service_type: string; status: string; total_amount: number }[];
    reminders?: { id: string; title: string; due_date: string; due_km: number | null; status: string }[];
}
interface Enq { id: string; doc_no: string; customer_name: string; phone: string | null; vehicle_id: string | null; customer_ledger_id: string | null }
const STATUS: Record<string, string> = { in_stock: 'In stock', booked: 'Booked', pdi_done: 'PDI done', delivered: 'Delivered', customer: 'Customer vehicle' };
const DOCS = ['Invoice / bill', 'Bluebook / registration', 'Insurance policy', 'Owner manual & service book', 'Warranty card', 'Duplicate key'];

export default function AutoVehicles() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const id = params.get('id');
    const isNew = !!params.get('new');
    const ownership = params.get('ownership') || 'stock';
    const L = useLookups(authFetch, { ledgers: true });
    const [rows, setRows] = useState<Vehicle[]>([]);
    const [v, setV] = useState<Vehicle | null>(null);
    const [f, setF] = useState<Record<string, string>>({});
    const [checklist, setChecklist] = useState<{ item: string; ok: boolean; remark: string }[]>([]);
    const [pdiF, setPdiF] = useState({ pdi_date: today(), inspector: '', odometer: '', fuel_level: '', remarks: '' });
    const [enqs, setEnqs] = useState<Enq[]>([]);
    const [dl, setDl] = useState({ enquiry_id: '', customer_ledger_id: '', customer_name: '', customer_phone: '', delivery_date: today(), reg_no: '', odometer: '', finance_company: '', keys_given: '2', accessories: '', delivered_by: '', remarks: '' });
    const [docs, setDocs] = useState(DOCS.map(item => ({ item, given: true })));
    const [search, setSearch] = useState('');
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');

    const loadList = useCallback(async () => {
        try { setRows((await authFetch<Vehicle[]>(`/api/auto/vehicles?ownership=${ownership}${search ? `&search=${encodeURIComponent(search)}` : ''}`)).data); } catch (x) { setErr(errText(x)); }
    }, [authFetch, ownership, search]);
    const loadOne = useCallback(async () => {
        if (!id) { setV(null); return; }
        try {
            const r = (await authFetch<Vehicle>(`/api/auto/vehicles/${id}`)).data;
            setV(r);
            setF(Object.fromEntries(['chassis_no', 'engine_no', 'product_id', 'model_name', 'variant', 'color', 'model_year', 'reg_no', 'customer_name', 'customer_phone', 'customer_ledger_id', 'odometer', 'remarks']
                .map(k => [k, (r as unknown as Record<string, unknown>)[k] === null || (r as unknown as Record<string, unknown>)[k] === undefined ? '' : String((r as unknown as Record<string, unknown>)[k])])));
            if (r.ownership === 'stock') {
                const s = (await authFetch<{ pdi_checklist: string[] }>('/api/auto/settings')).data;
                setChecklist(s.pdi_checklist.map(item => ({ item, ok: true, remark: '' })));
                const e = (await authFetch<Enq[]>('/api/auto/enquiries?status=booked')).data.concat((await authFetch<Enq[]>('/api/auto/enquiries?status=open')).data);
                setEnqs(e);
                const mine = e.find(x => x.vehicle_id === r.id);
                if (mine) setDl(d => ({ ...d, enquiry_id: mine.id, customer_name: mine.customer_name, customer_phone: mine.phone || '', customer_ledger_id: mine.customer_ledger_id || '' }));
            }
        } catch (x) { setErr(errText(x)); }
    }, [authFetch, id]);
    useEffect(() => { if (!id && !isNew) loadList(); }, [loadList, id, isNew]);
    useEffect(() => { loadOne(); }, [loadOne]);
    useEffect(() => { if (isNew) setF({ ownership }); }, [isNew, ownership]);

    const run = async (fn: () => Promise<unknown>, done: string) => {
        setOk(''); setErr('');
        try { await fn(); setOk(done); await loadOne(); return true; } catch (x) { setErr(errText(x)); return false; }
    };
    const call = (url: string, body: unknown, method = 'POST') => authFetch(url, { method, body: JSON.stringify(body) });
    const vForm = (
        <GroupBox title="Vehicle">
            <div className="nav-form-grid">
                <label className="nav-label required">Chassis no. (VIN)</label><input className="nav-input" value={f.chassis_no || ''} onChange={x => setF({ ...f, chassis_no: x.target.value.toUpperCase() })} />
                <label className="nav-label">Engine no.</label><input className="nav-input" value={f.engine_no || ''} onChange={x => setF({ ...f, engine_no: x.target.value.toUpperCase() })} />
                <label className="nav-label">Model (stock item)</label>
                <SearchablePopupSelect listKey="auto_vehicle_model" columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Model' }]} defaultVisibleKeys={['product_name']}
                    items={L.products} getId={p => p.id} getLabel={p => p.product_name} searchKeys={['product_name', 'product_code']} value={f.product_id || ''} onChange={x => setF({ ...f, product_id: x })} placeholder="Model" />
                <label className="nav-label">Model / variant</label>
                <div className="flex gap-1"><input className="nav-input" placeholder="model (if not an item)" value={f.model_name || ''} onChange={x => setF({ ...f, model_name: x.target.value })} /><input className="nav-input" placeholder="variant" value={f.variant || ''} onChange={x => setF({ ...f, variant: x.target.value })} /></div>
                <label className="nav-label">Colour / year</label>
                <div className="flex gap-1"><input className="nav-input" value={f.color || ''} onChange={x => setF({ ...f, color: x.target.value })} /><input type="number" className="nav-input" value={f.model_year || ''} onChange={x => setF({ ...f, model_year: x.target.value })} /></div>
                <label className="nav-label">Registration no.</label><input className="nav-input" value={f.reg_no || ''} onChange={x => setF({ ...f, reg_no: x.target.value.toUpperCase() })} />
                {(f.ownership === 'customer' || v?.ownership === 'customer') && <>
                    <label className="nav-label">Customer (ledger)</label><LedgerPick listKey="auto_vehicle_cust" ledgers={L.ledgers} value={f.customer_ledger_id || ''} onChange={x => setF({ ...f, customer_ledger_id: x })} placeholder="Customer" />
                    <label className="nav-label">Customer name / phone</label>
                    <div className="flex gap-1"><input className="nav-input" value={f.customer_name || ''} onChange={x => setF({ ...f, customer_name: x.target.value })} /><input className="nav-input" value={f.customer_phone || ''} onChange={x => setF({ ...f, customer_phone: x.target.value })} /></div>
                    <label className="nav-label">Odometer (km)</label><input type="number" className="nav-input" value={f.odometer || ''} onChange={x => setF({ ...f, odometer: x.target.value })} />
                </>}
                <label className="nav-label">Remarks</label><input className="nav-input" value={f.remarks || ''} onChange={x => setF({ ...f, remarks: x.target.value })} />
            </div>
        </GroupBox>
    );

    if (isNew) {
        return (
            <Layout>
                <NavWindow title={f.ownership === 'customer' ? '🔑 Add Customer Vehicle' : '🚗 Add Vehicle to Stock'} tools={<button type="button" className="nav-tool-btn" onClick={() => setParams({ ownership })}>← Vehicles</button>}>
                    <Msg ok={ok} err={err} />
                    {vForm}
                    <p className="text-xs text-gray-600">Buy the vehicle with a Purchase Bill (chassis no. as the serial) for the accounts; this list tracks it through PDI and delivery.</p>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="nav-btn" onClick={() => setParams({ ownership })}>Cancel</button>
                        <button type="button" className="nav-btn primary" onClick={async () => {
                            setErr('');
                            try { const r = await authFetch<Vehicle>('/api/auto/vehicles', { method: 'POST', body: JSON.stringify(f) }); setParams({ id: r.data.id }); } catch (x) { setErr(errText(x)); }
                        }}>💾 Save vehicle</button>
                    </div>
                </NavWindow>
            </Layout>
        );
    }

    if (id && v) {
        const pdiPassed = (v.pdis || []).some(p => p.result === 'pass');
        const inStock = v.ownership === 'stock' && v.status !== 'delivered';
        return (
            <Layout>
                <NavWindow wide title={<>🚗 {v.model_name || 'Vehicle'} · {v.chassis_no} <span className="font-normal">({STATUS[v.status]}{v.reg_no ? ` · ${v.reg_no}` : ''}{v.customer_name ? ` · ${v.customer_name}` : ''})</span></>} tools={<>
                    <button type="button" className="nav-tool-btn" onClick={() => setParams({ ownership: v.ownership })}>← Vehicles</button>
                    <button type="button" className="nav-tool-btn" onClick={() => run(() => call(`/api/auto/vehicles/${v.id}`, f, 'PUT'), 'Vehicle saved')}>💾 Save</button>
                    {v.ownership === 'customer' && <a className="nav-tool-btn" href={`/auto/job-cards?new=1&vehicle=${v.id}`}>🔧 New job card</a>}
                    <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
                </>}>
                    <Msg ok={ok} err={err} />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                            {vForm}
                            {(v.pdis || []).map(p => (
                                <GroupBox key={p.id} title={`${p.doc_no} · ${p.pdi_date} · ${p.result === 'pass' ? '✅ Passed' : '❌ Failed'}${p.inspector ? ` · ${p.inspector}` : ''}`}>
                                    <div className="text-xs">{p.checklist.filter(c => !c.ok).map(c => <div key={c.item} className="text-red-700">✗ {c.item}{c.remark ? ` - ${c.remark}` : ''}</div>)}
                                        {p.checklist.every(c => c.ok) && <span>All {p.checklist.length} points OK.</span>} {p.remarks}</div>
                                </GroupBox>
                            ))}
                        </div>
                        <div>
                            {inStock && (
                                <GroupBox title="PDI - pre-delivery inspection">
                                    <div className="nav-form-grid">
                                        <label className="nav-label">Date</label><input type="date" className="nav-input" value={pdiF.pdi_date} onChange={x => setPdiF({ ...pdiF, pdi_date: x.target.value })} />
                                        <label className="nav-label">Inspector</label><input className="nav-input" value={pdiF.inspector} onChange={x => setPdiF({ ...pdiF, inspector: x.target.value })} />
                                        <label className="nav-label">Odometer / fuel</label>
                                        <div className="flex gap-1"><input type="number" className="nav-input" value={pdiF.odometer} onChange={x => setPdiF({ ...pdiF, odometer: x.target.value })} /><input className="nav-input" placeholder="fuel" value={pdiF.fuel_level} onChange={x => setPdiF({ ...pdiF, fuel_level: x.target.value })} /></div>
                                    </div>
                                    <table className="erp-grid-table mt-2">
                                        <thead><tr><th>Check point</th><th>OK</th><th>Remark</th></tr></thead>
                                        <tbody>{checklist.map((c, i) => (
                                            <tr key={c.item} className={c.ok ? '' : 'bg-red-50'}><td>{c.item}</td>
                                                <td><input type="checkbox" checked={c.ok} onChange={x => setChecklist(cl => cl.map((y, k) => (k === i ? { ...y, ok: x.target.checked } : y)))} /></td>
                                                <td><input className="nav-input" value={c.remark} onChange={x => setChecklist(cl => cl.map((y, k) => (k === i ? { ...y, remark: x.target.value } : y)))} /></td></tr>
                                        ))}</tbody>
                                    </table>
                                    <div className="flex justify-end mt-2"><button type="button" className="nav-btn primary" onClick={() => run(() => call(`/api/auto/vehicles/${v.id}/pdi`, { ...pdiF, checklist }), checklist.every(c => c.ok) ? 'PDI passed - ready to deliver' : 'PDI saved with faults - fix and redo the PDI')}>💾 Save PDI</button></div>
                                </GroupBox>
                            )}
                            {inStock && (
                                <GroupBox title={pdiPassed ? 'Vehicle delivery' : 'Vehicle delivery (after the PDI passes)'}>
                                    <div className="nav-form-grid">
                                        <label className="nav-label">From enquiry</label>
                                        <select className="nav-select" value={dl.enquiry_id} onChange={x => { const e = enqs.find(q => q.id === x.target.value); setDl({ ...dl, enquiry_id: x.target.value, ...(e ? { customer_name: e.customer_name, customer_phone: e.phone || '', customer_ledger_id: e.customer_ledger_id || dl.customer_ledger_id } : {}) }); }}>
                                            <option value="">—</option>{enqs.map(e => <option key={e.id} value={e.id}>{e.doc_no} · {e.customer_name}{e.vehicle_id === v.id ? ' (booked this vehicle)' : ''}</option>)}
                                        </select>
                                        <label className="nav-label">Customer (ledger)</label><LedgerPick listKey="auto_dl_cust" ledgers={L.ledgers} value={dl.customer_ledger_id} onChange={x => setDl({ ...dl, customer_ledger_id: x })} placeholder="Customer ledger" />
                                        <label className="nav-label required">Customer name / phone</label>
                                        <div className="flex gap-1"><input className="nav-input" value={dl.customer_name} onChange={x => setDl({ ...dl, customer_name: x.target.value })} /><input className="nav-input" value={dl.customer_phone} onChange={x => setDl({ ...dl, customer_phone: x.target.value })} /></div>
                                        <label className="nav-label required">Delivery date</label><input type="date" className="nav-input" value={dl.delivery_date} onChange={x => setDl({ ...dl, delivery_date: x.target.value })} />
                                        <label className="nav-label">Registration no.</label><input className="nav-input" value={dl.reg_no} onChange={x => setDl({ ...dl, reg_no: x.target.value.toUpperCase() })} />
                                        <label className="nav-label">Odometer / keys</label>
                                        <div className="flex gap-1"><input type="number" className="nav-input" placeholder="km" value={dl.odometer} onChange={x => setDl({ ...dl, odometer: x.target.value })} /><input type="number" className="nav-input" placeholder="keys" value={dl.keys_given} onChange={x => setDl({ ...dl, keys_given: x.target.value })} /></div>
                                        <label className="nav-label">Finance company</label><input className="nav-input" value={dl.finance_company} onChange={x => setDl({ ...dl, finance_company: x.target.value })} />
                                        <label className="nav-label">Accessories given</label><input className="nav-input" value={dl.accessories} onChange={x => setDl({ ...dl, accessories: x.target.value })} />
                                        <label className="nav-label">Delivered by</label><input className="nav-input" value={dl.delivered_by} onChange={x => setDl({ ...dl, delivered_by: x.target.value })} />
                                    </div>
                                    <div className="flex flex-wrap gap-3 text-sm mt-2">{docs.map((d, i) => <label key={d.item} className="flex items-center gap-1"><input type="checkbox" checked={d.given} onChange={x => setDocs(ds => ds.map((y, k) => (k === i ? { ...y, given: x.target.checked } : y)))} /> {d.item}</label>)}</div>
                                    <div className="flex justify-end mt-2"><button type="button" className="nav-btn primary" disabled={!pdiPassed} onClick={() => run(() => call(`/api/auto/vehicles/${v.id}/deliver`, { ...dl, documents: docs }), 'Vehicle delivered - free-service reminders made')}>🔑 Deliver vehicle</button></div>
                                    <p className="text-xs text-gray-600 mt-1">Bill the vehicle with a Sales Bill (chassis no. as the serial); the delivery records the hand-over and starts the service reminders.</p>
                                </GroupBox>
                            )}
                            {(v.deliveries || []).map(d => (
                                <GroupBox key={d.id} title={`${d.doc_no} · delivered ${d.delivery_date}${d.status === 'cancelled' ? ' (cancelled)' : ''}`}>
                                    <div className="text-sm">{d.customer_name} · {d.reg_no || 'no reg. yet'} · {d.keys_given} key(s){d.finance_company ? ` · finance: ${d.finance_company}` : ''}</div>
                                    <div className="text-xs text-gray-600">{d.documents.map(x => `${x.given ? '✓' : '✗'} ${x.item}`).join(' · ')}{d.accessories ? ` · Accessories: ${d.accessories}` : ''}</div>
                                    {d.status === 'delivered' && <button type="button" className="nav-btn small danger mt-1" onClick={() => { const why = window.prompt('Cancel this delivery? Reason:'); if (why) run(() => call(`/api/auto/deliveries/${d.id}/cancel`, { reason: why }), 'Delivery cancelled - vehicle back in stock'); }}>Cancel delivery</button>}
                                </GroupBox>
                            ))}
                            {v.ownership === 'customer' && (
                                <>
                                    <GroupBox title="Service history">
                                        <table className="erp-grid-table"><thead><tr><th>Job</th><th>Date</th><th className="text-right">Km</th><th>Type</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
                                            <tbody>{(v.job_cards || []).map(j => <tr key={j.id} className="cursor-pointer" onClick={() => { window.location.href = `/auto/job-cards?id=${j.id}`; }}><td className="font-mono text-blue-700 underline">{j.doc_no}</td><td>{j.date_in}</td><td className="text-right">{n0(j.odometer_in)}</td><td>{j.service_type}</td><td>{j.status}</td><td className="text-right">{n2(j.total_amount)}</td></tr>)}
                                                {!(v.job_cards || []).length && <tr><td colSpan={6} className="text-center text-gray-500">No service yet.</td></tr>}</tbody></table>
                                    </GroupBox>
                                    <GroupBox title="Service reminders">
                                        <table className="erp-grid-table"><thead><tr><th>Service</th><th>Due date</th><th className="text-right">Due km</th><th>Status</th></tr></thead>
                                            <tbody>{(v.reminders || []).map(r => <tr key={r.id}><td>{r.title}</td><td>{r.due_date}</td><td className="text-right">{r.due_km ? n0(r.due_km) : ''}</td><td>{r.status}</td></tr>)}</tbody></table>
                                    </GroupBox>
                                </>
                            )}
                        </div>
                    </div>
                </NavWindow>
            </Layout>
        );
    }

    return (
        <Layout>
            <NavWindow wide title={ownership === 'stock' ? '🚗 Vehicle Stock / PDI / Delivery' : '🔑 Delivered & Customer Vehicles'} tools={<>
                <button type="button" className="nav-tool-btn" onClick={() => setParams({ ownership, new: '1' })}>➕ Add vehicle</button>
                <span className="nav-tool-sep" />
                <button type="button" className={`nav-tool-btn ${ownership === 'stock' ? 'active' : ''}`} onClick={() => setParams({ ownership: 'stock' })}>🚗 Stock</button>
                <button type="button" className={`nav-tool-btn ${ownership === 'customer' ? 'active' : ''}`} onClick={() => setParams({ ownership: 'customer' })}>🔑 Customers</button>
                <span className="nav-tool-sep" />
                <input className="nav-input" style={{ width: 200, height: 24 }} placeholder="Chassis / reg / customer" value={search} onChange={x => setSearch(x.target.value)} onKeyDown={x => x.key === 'Enter' && loadList()} />
                <button type="button" className="nav-tool-btn" onClick={loadList}>🔍</button>
            </>}>
                <Msg err={err} />
                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>Chassis</th><th>Engine</th><th>Model</th><th>Colour</th><th>Year</th><th>Reg. no.</th>{ownership === 'customer' && <><th>Customer</th><th>Phone</th><th>Sold on</th><th className="text-right">Km</th></>}<th>Status</th></tr></thead>
                        <tbody>{rows.map(r => (
                            <tr key={r.id} className="cursor-pointer" onClick={() => setParams({ id: r.id })}>
                                <td className="font-mono text-blue-700 underline">{r.chassis_no}</td><td>{r.engine_no}</td><td>{[r.model_name, r.variant].filter(Boolean).join(' · ')}</td><td>{r.color}</td><td>{r.model_year || ''}</td><td>{r.reg_no}</td>
                                {ownership === 'customer' && <><td>{r.customer_name}</td><td>{r.customer_phone}</td><td>{r.sale_date || ''}</td><td className="text-right">{n0(r.odometer)}</td></>}
                                <td>{STATUS[r.status]}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={11} className="text-center text-gray-500 py-6">No vehicles here.</td></tr>}</tbody>
                    </table>
                </div>
            </NavWindow>
        </Layout>
    );
}
