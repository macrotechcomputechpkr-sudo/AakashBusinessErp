// =============================================
// auto/AutoDashboard.tsx  (/auto)
// Showroom (enquiries, follow-ups due, stock, PDI pending, deliveries) and
// workshop (job cards by stage, ready for delivery, revenue) at a glance,
// with the service reminders due this week. Server: utils/automobile.js dashboard().
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Kpi, Msg, NavWindow, errText, n0, n2 } from '../../components/poultry/common';

interface Dash {
    showroom: { open_enquiries: number; hot: number; follow_up_due: number; enquiries_month: number; booked: number; in_stock: number; pdi_pending: number; delivered_month: number };
    workshop: { open: number; in_progress: number; outside_work: number; ready: number; delivered_month: number; revenue_month: number };
    reminders: { due_7_days: number; overdue: number; list: { id: string; vehicle_id: string; title: string; due_date: string; days_left: number; reg_no?: string; customer_name?: string; customer_phone?: string }[] };
}
const A = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href} className="block no-underline text-inherit">{children}</a>;

export default function AutoDashboard() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [d, setD] = useState<Dash | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => { authFetch<Dash>('/api/auto/dashboard').then(r => setD(r.data)).catch(e => setErr(errText(e))); }, [authFetch]);
    return (
        <Layout>
            <NavWindow wide title="🚗 Automobile Dashboard" tools={<>
                <a className="nav-tool-btn" href="/auto/enquiries?new=1">➕ Enquiry</a><a className="nav-tool-btn" href="/auto/job-cards?new=1">➕ Job card</a>
                <a className="nav-tool-btn" href="/auto/vehicles?ownership=stock">🚗 Stock</a><a className="nav-tool-btn" href="/auto/reminders">⏰ Reminders</a><a className="nav-tool-btn" href="/auto/reports?view=enquiries">📊 Reports</a>
            </>}>
                <Msg err={err} />
                {d && (
                    <>
                        <GroupBox title="Showroom">
                            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                                <A href="/auto/enquiries?status=open"><Kpi label="Open enquiries" value={n0(d.showroom.open_enquiries)} sub={`🔥 ${d.showroom.hot} hot · ${d.showroom.enquiries_month} this month`} /></A>
                                <A href="/auto/enquiries?status=open&due=today"><Kpi label="Follow-up due" tone={d.showroom.follow_up_due ? 'red' : 'green'} value={n0(d.showroom.follow_up_due)} /></A>
                                <A href="/auto/enquiries?status=booked"><Kpi label="Booked" tone="orange" value={n0(d.showroom.booked)} /></A>
                                <A href="/auto/vehicles?ownership=stock"><Kpi label="Vehicles in stock" value={n0(d.showroom.in_stock)} sub={`${d.showroom.pdi_pending} PDI pending`} /></A>
                                <A href="/auto/reports?view=vehicle_sales"><Kpi label="Delivered this month" tone="green" value={n0(d.showroom.delivered_month)} /></A>
                            </div>
                        </GroupBox>
                        <GroupBox title="Workshop">
                            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                                <A href="/auto/job-cards?status=open"><Kpi label="Open" value={n0(d.workshop.open)} /></A>
                                <A href="/auto/job-cards?status=in_progress"><Kpi label="In progress" value={n0(d.workshop.in_progress)} /></A>
                                <A href="/auto/job-cards?status=outside_work"><Kpi label="At outside work" tone="orange" value={n0(d.workshop.outside_work)} /></A>
                                <A href="/auto/job-cards?status=ready"><Kpi label="Ready for delivery" tone="green" value={n0(d.workshop.ready)} /></A>
                                <A href="/auto/job-cards?status=delivered"><Kpi label="Delivered this month" value={n0(d.workshop.delivered_month)} sub={`revenue ${n2(d.workshop.revenue_month)}`} /></A>
                            </div>
                        </GroupBox>
                        <GroupBox title={`Service reminders - ${d.reminders.due_7_days} due this week, ${d.reminders.overdue} overdue`}>
                            <table className="erp-grid-table">
                                <thead><tr><th>Due</th><th>Service</th><th>Vehicle</th><th>Customer</th><th>Phone</th></tr></thead>
                                <tbody>{d.reminders.list.map(r => (
                                    <tr key={r.id} className={r.days_left < 0 ? 'text-red-700' : ''}><td>{r.due_date}</td><td>{r.title}</td><td><a className="underline" href={`/auto/vehicles?id=${r.vehicle_id}`}>{r.reg_no}</a></td><td>{r.customer_name}</td><td>{r.customer_phone}</td></tr>
                                ))}
                                {!d.reminders.list.length && <tr><td colSpan={5} className="text-center text-gray-500">Nothing due this week.</td></tr>}</tbody>
                            </table>
                        </GroupBox>
                    </>
                )}
            </NavWindow>
        </Layout>
    );
}
