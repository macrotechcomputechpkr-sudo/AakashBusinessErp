// =============================================
// auto/AutoReminders.tsx  (/auto/reminders?view=due|overdue|all)
// Service reminders - free services made at vehicle delivery and the next
// periodic service made when a job card is delivered. Call list with the
// customer's phone; mark contacted / booked / not interested with a note.
// Server: utils/automobile.js listReminders().
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { Msg, NavWindow, errText, n0 } from '../../components/poultry/common';

interface Rem { id: string; vehicle_id: string; title: string; service_type: string; due_date: string; due_km: number | null; status: string; last_contact_date: string | null; contact_note: string | null;
    reg_no?: string; chassis_no?: string; model_name?: string; customer_name?: string; customer_phone?: string; last_km?: number; days_left: number; job_id: string | null }
const STATUS: Record<string, string> = { pending: 'Pending', contacted: 'Contacted', booked: 'Booked', done: 'Done', not_interested: 'Not interested' };

export default function AutoReminders() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const view = params.get('view') || 'due';
    const [days, setDays] = useState('15');
    const [rows, setRows] = useState<Rem[]>([]);
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        try { setRows((await authFetch<Rem[]>(`/api/auto/reminders?view=${view}&days=${days}${view === 'all' ? '&status=all' : ''}`)).data); } catch (x) { setErr(errText(x)); }
    }, [authFetch, view, days]);
    useEffect(() => { load(); }, [load]);
    const upd = async (r: Rem, status: string) => {
        const note = window.prompt(`${STATUS[status]} - note (what the customer said):`, r.contact_note || '');
        if (note === null) return;
        setOk(''); setErr('');
        try { await authFetch(`/api/auto/reminders/${r.id}`, { method: 'PUT', body: JSON.stringify({ status, contact_note: note }) }); setOk('Saved'); load(); } catch (x) { setErr(errText(x)); }
    };
    return (
        <Layout>
            <NavWindow wide title="⏰ Service Reminders" tools={<>
                {([['due', 'Due soon'], ['overdue', 'Overdue'], ['all', 'All']] as [string, string][]).map(([k, l]) => <button key={k} type="button" className={`nav-tool-btn ${view === k ? 'active' : ''}`} onClick={() => setParams({ view: k })}>{l}</button>)}
                {view === 'due' && <><span className="nav-tool-sep" /><label className="text-xs">within</label><input type="number" className="nav-input" style={{ width: 60, height: 24 }} value={days} onChange={x => setDays(x.target.value)} /><label className="text-xs">days</label></>}
                <button type="button" className="nav-tool-btn" onClick={load}>🔄 Refresh</button>
                <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print call list</button>
            </>}>
                <Msg ok={ok} err={err} />
                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>Due</th><th>Days</th><th>Service</th><th>Reg. no.</th><th>Model</th><th>Customer</th><th>Phone</th><th className="text-right">Due km</th><th className="text-right">Last km</th><th>Status</th><th>Last note</th><th /></tr></thead>
                        <tbody>{rows.map(r => (
                            <tr key={r.id} className={r.days_left < 0 && ['pending', 'contacted'].includes(r.status) ? 'bg-red-50' : ''}>
                                <td>{r.due_date}</td><td className={r.days_left < 0 ? 'text-red-700 font-semibold' : ''}>{r.days_left < 0 ? `${-r.days_left} late` : r.days_left === 0 ? 'today' : `in ${r.days_left}`}</td>
                                <td>{r.title}</td><td><a className="underline text-blue-700" href={`/auto/vehicles?id=${r.vehicle_id}`}>{r.reg_no || r.chassis_no}</a></td><td>{r.model_name}</td><td>{r.customer_name}</td>
                                <td>{r.customer_phone && <a className="underline" href={`tel:${r.customer_phone}`}>{r.customer_phone}</a>}</td><td className="text-right">{r.due_km ? n0(r.due_km) : ''}</td><td className="text-right">{r.last_km ? n0(r.last_km) : ''}</td>
                                <td>{STATUS[r.status]}</td><td className="text-xs">{r.contact_note}{r.last_contact_date ? ` (${r.last_contact_date})` : ''}</td>
                                <td className="whitespace-nowrap">
                                    {['pending', 'contacted', 'booked'].includes(r.status) && <>
                                        <button type="button" className="nav-btn small" onClick={() => upd(r, 'contacted')}>📞</button>
                                        <button type="button" className="nav-btn small" onClick={() => upd(r, 'booked')}>📅 Booked</button>
                                        <button type="button" className="nav-btn small" onClick={() => upd(r, 'not_interested')}>✕</button>
                                        <a className="nav-btn small primary" href={`/auto/job-cards?new=1&vehicle=${r.vehicle_id}`}>🔧 Job card</a>
                                    </>}
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={12} className="text-center text-gray-500 py-6">No reminders here.</td></tr>}</tbody>
                    </table>
                </div>
            </NavWindow>
        </Layout>
    );
}
