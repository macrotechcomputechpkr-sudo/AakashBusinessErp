// =============================================
// auto/AutoEnquiries.tsx  (/auto/enquiries?id=&new=1&status=&due=today)
// Showroom customer enquiries: who, which model, source, budget, finance,
// test drive; follow-ups with next date and hot / warm / cold; booking a
// stock vehicle with the booking amount; lost with the reason. Delivery is
// done from the vehicle (Vehicle Stock > Deliver). Server: utils/automobile.js.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Msg, NavWindow, SearchablePopupSelect, errText, n2, today, useLookups } from '../../components/poultry/common';

interface Followup { id: string; followup_date: string; mode: string; note: string; next_date: string | null }
interface Enquiry {
    id: string; doc_no: string; enquiry_date: string; customer_name: string; phone: string | null; email: string | null; address: string | null; source: string; product_id: string | null; model_name: string | null;
    variant: string | null; color: string | null; budget: number | null; finance_required: boolean; exchange_vehicle: string | null; test_drive_date: string | null; follow_up_date: string | null; salesperson_id: string | null;
    temperature: string; status: string; booking_amount: number; booking_date: string | null; vehicle_id: string | null; lost_reason: string | null; remarks: string | null;
    followups?: Followup[]; vehicle?: { id: string; chassis_no: string; model_name: string; color: string; status: string } | null;
}
interface Vehicle { id: string; chassis_no: string; model_name: string | null; color: string | null; status: string; ownership: string }
const SOURCES: [string, string][] = [['walk_in', 'Walk-in'], ['phone', 'Phone'], ['referral', 'Referral'], ['social', 'Social media'], ['event', 'Event / camp'], ['web', 'Website'], ['other', 'Other']];
const TEMP: Record<string, string> = { hot: '🔥 Hot', warm: '🌤 Warm', cold: '❄ Cold' };
const STATUS: Record<string, string> = { open: 'Open', booked: 'Booked', delivered: 'Delivered', lost: 'Lost' };
const blank = () => ({ customer_name: '', phone: '', email: '', address: '', source: 'walk_in', product_id: '', model_name: '', variant: '', color: '', budget: '', finance_required: false,
    exchange_vehicle: '', test_drive_date: '', follow_up_date: '', salesperson_id: '', temperature: 'warm', enquiry_date: today(), remarks: '' });

export default function AutoEnquiries() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const id = params.get('id');
    const isNew = !!params.get('new');
    const status = params.get('status') || 'open';
    const due = params.get('due') || '';
    const L = useLookups(authFetch);
    const [rows, setRows] = useState<Enquiry[]>([]);
    const [e, setE] = useState<Enquiry | null>(null);
    const [f, setF] = useState<Record<string, string | boolean>>(blank());
    const [agents, setAgents] = useState<{ id: string; agent_name: string }[]>([]);
    const [stock, setStock] = useState<Vehicle[]>([]);
    const [fu, setFu] = useState({ note: '', mode: 'call', next_date: '', temperature: '' });
    const [book, setBook] = useState({ vehicle_id: '', booking_amount: '' });
    const [search, setSearch] = useState('');
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');

    useEffect(() => { authFetch<{ id: string; agent_name: string }[]>('/api/salesman-agents').then(r => setAgents(r.data || [])).catch(() => undefined); }, [authFetch]);
    const loadList = useCallback(async () => {
        try { setRows((await authFetch<Enquiry[]>(`/api/auto/enquiries?status=${status}${due ? `&due=${due}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`)).data); } catch (x) { setErr(errText(x)); }
    }, [authFetch, status, due, search]);
    const loadOne = useCallback(async () => {
        if (!id) { setE(null); return; }
        try {
            const r = (await authFetch<Enquiry>(`/api/auto/enquiries/${id}`)).data;
            setE(r);
            const b = blank() as Record<string, string | boolean>;
            Object.keys(b).forEach(k => { const v = (r as unknown as Record<string, unknown>)[k]; b[k] = v === null || v === undefined ? (typeof b[k] === 'boolean' ? false : '') : (v as string | boolean); });
            setF(b);
            setBook({ vehicle_id: r.vehicle_id || '', booking_amount: r.booking_amount ? String(r.booking_amount) : '' });
            authFetch<Vehicle[]>('/api/auto/vehicles?ownership=stock').then(x => setStock(x.data.filter(v => ['in_stock', 'pdi_done'].includes(v.status) || v.id === r.vehicle_id))).catch(() => undefined);
        } catch (x) { setErr(errText(x)); }
    }, [authFetch, id]);
    useEffect(() => { if (!id && !isNew) loadList(); }, [loadList, id, isNew]);
    useEffect(() => { loadOne(); }, [loadOne]);
    useEffect(() => { if (isNew) setF(blank()); }, [isNew]);

    const run = async (fn: () => Promise<unknown>, done: string) => {
        setOk(''); setErr('');
        try { await fn(); setOk(done); await loadOne(); return true; } catch (x) { setErr(errText(x)); return false; }
    };
    const call = (url: string, body: unknown, method = 'POST') => authFetch(url, { method, body: JSON.stringify(body) });

    const form = (
        <GroupBox title="Customer & interest">
            <div className="nav-form-grid">
                <label className="nav-label required">Customer name</label><input className="nav-input" value={String(f.customer_name)} onChange={x => setF({ ...f, customer_name: x.target.value })} />
                <label className="nav-label required">Phone</label><input className="nav-input" value={String(f.phone)} onChange={x => setF({ ...f, phone: x.target.value })} />
                <label className="nav-label">Email</label><input className="nav-input" value={String(f.email)} onChange={x => setF({ ...f, email: x.target.value })} />
                <label className="nav-label">Address</label><input className="nav-input" value={String(f.address)} onChange={x => setF({ ...f, address: x.target.value })} />
                <label className="nav-label">Enquiry date</label><input type="date" className="nav-input" value={String(f.enquiry_date)} onChange={x => setF({ ...f, enquiry_date: x.target.value })} />
                <label className="nav-label">Source</label>
                <select className="nav-select" value={String(f.source)} onChange={x => setF({ ...f, source: x.target.value })}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <label className="nav-label">Model (stock item)</label>
                <SearchablePopupSelect listKey="auto_model_picker" columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Model' }]} defaultVisibleKeys={['product_name']}
                    items={L.products} getId={p => p.id} getLabel={p => p.product_name} searchKeys={['product_name', 'product_code']} value={String(f.product_id)} onChange={v => setF({ ...f, product_id: v })} placeholder="Model" />
                <label className="nav-label">Model / variant / colour</label>
                <div className="flex gap-1"><input className="nav-input" placeholder="model (if not an item)" value={String(f.model_name)} onChange={x => setF({ ...f, model_name: x.target.value })} />
                    <input className="nav-input" placeholder="variant" value={String(f.variant)} onChange={x => setF({ ...f, variant: x.target.value })} />
                    <input className="nav-input" placeholder="colour" value={String(f.color)} onChange={x => setF({ ...f, color: x.target.value })} /></div>
                <label className="nav-label">Budget</label><input type="number" className="nav-input" value={String(f.budget)} onChange={x => setF({ ...f, budget: x.target.value })} />
                <label className="nav-label">Finance needed</label><label className="text-sm"><input type="checkbox" checked={!!f.finance_required} onChange={x => setF({ ...f, finance_required: x.target.checked })} /> Yes (loan / hire purchase)</label>
                <label className="nav-label">Exchange vehicle</label><input className="nav-input" placeholder="old vehicle to exchange" value={String(f.exchange_vehicle)} onChange={x => setF({ ...f, exchange_vehicle: x.target.value })} />
                <label className="nav-label">Test drive on</label><input type="date" className="nav-input" value={String(f.test_drive_date)} onChange={x => setF({ ...f, test_drive_date: x.target.value })} />
                <label className="nav-label">Next follow-up</label><input type="date" className="nav-input" value={String(f.follow_up_date)} onChange={x => setF({ ...f, follow_up_date: x.target.value })} />
                <label className="nav-label">Salesperson</label>
                <select className="nav-select" value={String(f.salesperson_id)} onChange={x => setF({ ...f, salesperson_id: x.target.value })}><option value="">—</option>{agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}</select>
                <label className="nav-label">Interest</label>
                <select className="nav-select" value={String(f.temperature)} onChange={x => setF({ ...f, temperature: x.target.value })}>{Object.entries(TEMP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <label className="nav-label">Remarks</label><input className="nav-input" value={String(f.remarks)} onChange={x => setF({ ...f, remarks: x.target.value })} />
            </div>
        </GroupBox>
    );

    if (isNew) {
        return (
            <Layout>
                <NavWindow title="📋 New Customer Enquiry" tools={<button type="button" className="nav-tool-btn" onClick={() => setParams({})}>← Enquiries</button>}>
                    <Msg ok={ok} err={err} />
                    {form}
                    <div className="flex justify-end gap-2">
                        <button type="button" className="nav-btn" onClick={() => setParams({})}>Cancel</button>
                        <button type="button" className="nav-btn primary" onClick={async () => {
                            setErr('');
                            try { const r = await authFetch<Enquiry>('/api/auto/enquiries', { method: 'POST', body: JSON.stringify(f) }); setParams({ id: r.data.id }); } catch (x) { setErr(errText(x)); }
                        }}>💾 Save enquiry</button>
                    </div>
                </NavWindow>
            </Layout>
        );
    }

    if (id && e) {
        return (
            <Layout>
                <NavWindow wide title={<>📋 {e.doc_no} · {e.customer_name} <span className="font-normal">({STATUS[e.status]} · {TEMP[e.temperature]})</span></>} tools={<>
                    <button type="button" className="nav-tool-btn" onClick={() => setParams({})}>← Enquiries</button>
                    <button type="button" className="nav-tool-btn" onClick={() => run(() => call(`/api/auto/enquiries/${e.id}`, f, 'PUT'), 'Saved')}>💾 Save</button>
                    {e.phone && <a className="nav-tool-btn" href={`tel:${e.phone}`}>📞 {e.phone}</a>}
                </>}>
                    <Msg ok={ok} err={err} />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>{form}</div>
                        <div>
                            {e.status !== 'delivered' && (
                                <GroupBox title="Follow-up">
                                    <div className="nav-form-grid">
                                        <label className="nav-label">How</label>
                                        <select className="nav-select" value={fu.mode} onChange={x => setFu({ ...fu, mode: x.target.value })}>{['call', 'visit', 'sms', 'whatsapp', 'email'].map(m => <option key={m} value={m}>{m}</option>)}</select>
                                        <label className="nav-label required">What was discussed</label><input className="nav-input" value={fu.note} onChange={x => setFu({ ...fu, note: x.target.value })} />
                                        <label className="nav-label">Next follow-up</label><input type="date" className="nav-input" value={fu.next_date} onChange={x => setFu({ ...fu, next_date: x.target.value })} />
                                        <label className="nav-label">Interest now</label>
                                        <select className="nav-select" value={fu.temperature} onChange={x => setFu({ ...fu, temperature: x.target.value })}><option value="">(same)</option>{Object.entries(TEMP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                                    </div>
                                    <div className="flex justify-end mt-2"><button type="button" className="nav-btn primary" onClick={() => run(() => call(`/api/auto/enquiries/${e.id}/followups`, fu), 'Follow-up saved').then(d => d && setFu({ note: '', mode: 'call', next_date: '', temperature: '' }))}>💾 Save follow-up</button></div>
                                </GroupBox>
                            )}
                            <GroupBox title="Follow-up history">
                                <table className="erp-grid-table">
                                    <thead><tr><th>Date</th><th>How</th><th>Note</th><th>Next</th></tr></thead>
                                    <tbody>{(e.followups || []).map(x => <tr key={x.id}><td>{x.followup_date}</td><td>{x.mode}</td><td>{x.note}</td><td>{x.next_date || ''}</td></tr>)}
                                        {!(e.followups || []).length && <tr><td colSpan={4} className="text-center text-gray-500">No follow-ups yet.</td></tr>}</tbody>
                                </table>
                            </GroupBox>
                            {['open', 'booked'].includes(e.status) && (
                                <GroupBox title="Booking">
                                    <div className="nav-form-grid">
                                        <label className="nav-label">Vehicle from stock</label>
                                        <select className="nav-select" value={book.vehicle_id} onChange={x => setBook({ ...book, vehicle_id: x.target.value })}>
                                            <option value="">— allot later —</option>{stock.map(v => <option key={v.id} value={v.id}>{v.chassis_no} · {v.model_name} · {v.color || ''} {v.status === 'pdi_done' ? '(PDI done)' : ''}</option>)}
                                        </select>
                                        <label className="nav-label">Booking amount</label><input type="number" className="nav-input" value={book.booking_amount} onChange={x => setBook({ ...book, booking_amount: x.target.value })} />
                                    </div>
                                    <div className="flex justify-between mt-2">
                                        <button type="button" className="nav-btn danger" onClick={() => { const why = window.prompt('Why was it lost? (bought other brand, price, finance…)'); if (why) run(() => call(`/api/auto/enquiries/${e.id}/status`, { status: 'lost', lost_reason: why }, 'PUT'), 'Marked lost'); }}>✕ Lost</button>
                                        <button type="button" className="nav-btn primary" onClick={() => run(() => call(`/api/auto/enquiries/${e.id}/status`, { status: 'booked', ...book }, 'PUT'), 'Booked')}>✔ Book</button>
                                    </div>
                                    {e.status === 'booked' && e.vehicle && <p className="text-xs mt-2">Booked {e.vehicle.chassis_no} ({e.vehicle.model_name}) for {n2(e.booking_amount)} on {e.booking_date}. <a className="underline text-blue-700" href={`/auto/vehicles?id=${e.vehicle.id}`}>Go to the vehicle for PDI & delivery →</a></p>}
                                    <p className="text-xs text-gray-600 mt-1">Enter the booking money as a receipt (Cash / Bank) from the customer; bill the vehicle with a Sales Bill.</p>
                                </GroupBox>
                            )}
                            {e.status === 'lost' && <GroupBox title="Lost"><p className="text-sm">{e.lost_reason}</p><button type="button" className="nav-btn mt-2" onClick={() => run(() => call(`/api/auto/enquiries/${e.id}/status`, { status: 'open' }, 'PUT'), 'Reopened')}>↩ Reopen</button></GroupBox>}
                        </div>
                    </div>
                </NavWindow>
            </Layout>
        );
    }

    return (
        <Layout>
            <NavWindow wide title="📋 Customer Enquiries" tools={<>
                <button type="button" className="nav-tool-btn" onClick={() => setParams({ new: '1' })}>➕ New enquiry</button>
                <span className="nav-tool-sep" />
                {([['open', 'Open'], ['booked', 'Booked'], ['delivered', 'Delivered'], ['lost', 'Lost'], ['all', 'All']] as [string, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={`nav-tool-btn ${status === k && !due ? 'active' : ''}`} onClick={() => setParams({ status: k })}>{l}</button>
                ))}
                <button type="button" className={`nav-tool-btn ${due ? 'active' : ''}`} onClick={() => setParams({ status: 'open', due: 'today' })}>📞 Follow-up due</button>
                <span className="nav-tool-sep" />
                <input className="nav-input" style={{ width: 180, height: 24 }} placeholder="Name / phone / model" value={search} onChange={x => setSearch(x.target.value)} onKeyDown={x => x.key === 'Enter' && loadList()} />
                <button type="button" className="nav-tool-btn" onClick={loadList}>🔍</button>
            </>}>
                <Msg err={err} />
                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>No.</th><th>Date</th><th>Customer</th><th>Phone</th><th>Model</th><th>Source</th><th className="text-right">Budget</th><th>Interest</th><th>Next follow-up</th><th>Status</th></tr></thead>
                        <tbody>{rows.map(r => (
                            <tr key={r.id} className="cursor-pointer" onClick={() => setParams({ id: r.id })}>
                                <td className="font-mono text-blue-700 underline">{r.doc_no}</td><td>{r.enquiry_date}</td><td>{r.customer_name}</td><td>{r.phone}</td><td>{[r.model_name, r.variant, r.color].filter(Boolean).join(' · ')}</td>
                                <td>{SOURCES.find(s => s[0] === r.source)?.[1]}</td><td className="text-right">{r.budget ? n2(r.budget) : ''}</td><td>{TEMP[r.temperature]}</td>
                                <td className={r.follow_up_date && r.status === 'open' && String(r.follow_up_date).slice(0, 10) <= today() ? 'text-red-700 font-semibold' : ''}>{r.follow_up_date || ''}</td><td>{STATUS[r.status]}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={10} className="text-center text-gray-500 py-6">No enquiries here.</td></tr>}</tbody>
                    </table>
                </div>
            </NavWindow>
        </Layout>
    );
}
