// =============================================
// WorkDashboard.tsx  (/work-dashboard)
// Tasks & Darta / Chalani at a glance: KPIs, charts (status, created vs
// done per week, darta vs chalani per month, open tasks per person, by
// channel / department) and the lists that need action.
// Server: utils/workDashboard.js (only what the viewer may see).
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import Chart from '../components/charts/Chart';
import type { AuthFetch, SeriesPoint } from '../types/erp';

interface Slim { id: string; task_no?: string; title?: string; reg_no?: string; subject?: string; party_name?: string; status_label: string; due_at?: string | null; due_date?: string | null; assigned_to_name: string | null; is_overdue: boolean; priority?: string; entry_date_bs?: string | null }
interface Data {
    kpis: Record<string, number>;
    charts: Record<string, SeriesPoint[]>;
    lists: { my_tasks: Slim[]; overdue_tasks: Slim[]; pending_darta: Slim[]; recent_darta: Slim[] };
    can_see_all_tasks: boolean; can_darta: boolean;
}

function Kpi({ label, value, tone = '', onClick }: { label: string; value: number; tone?: string; onClick?: () => void }) {
    return (
        <button type="button" onClick={onClick} className="bg-white border border-slate-200 rounded-lg p-3 text-left hover:shadow">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${tone || 'text-gray-900'}`}>{value}</p>
        </button>
    );
}
function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
    return <div className={`bg-white border border-slate-200 rounded-lg p-3 ${className}`}><p className="font-semibold text-sm text-gray-800 mb-2">{title}</p>{children}</div>;
}

export default function WorkDashboard() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const navigate = useNavigate();
    const [scope, setScope] = useState<'mine' | 'all'>('mine');
    const [d, setD] = useState<Data | null>(null);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        try { const r = await authFetch<Data>(`/api/work/dashboard?scope=${scope}`); setD(r.data); setError(''); } catch (e) { setError((e as Error).message); }
    }, [authFetch, scope]);
    useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
    const due = (x: Slim) => (x.due_at ? new Date(x.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : x.due_date ? String(x.due_date).slice(0, 10) : '—');
    const taskRows = (list: Slim[]) => (
        <table className="w-full text-sm" data-no-excel>
            <tbody>{list.map(x => (
                <tr key={x.id} className="border-t cursor-pointer hover:bg-blue-50" onClick={() => navigate(`/tasks?id=${x.id}`)}>
                    <td className="py-1 pr-2 whitespace-nowrap text-xs text-gray-500">{x.task_no}</td><td className="py-1 pr-2">{x.title}</td>
                    <td className="py-1 pr-2 text-xs">{x.assigned_to_name || ''}</td>
                    <td className={`py-1 text-xs whitespace-nowrap ${x.is_overdue ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{due(x)}</td>
                </tr>
            ))}</tbody>
        </table>
    );
    const dartaRows = (list: Slim[]) => (
        <table className="w-full text-sm" data-no-excel>
            <tbody>{list.map(x => (
                <tr key={x.id} className="border-t cursor-pointer hover:bg-blue-50" onClick={() => navigate(`/darta-chalani?id=${x.id}`)}>
                    <td className="py-1 pr-2 whitespace-nowrap text-xs text-gray-500">{x.reg_no}</td><td className="py-1 pr-2">{x.subject}<span className="text-xs text-gray-500"> · {x.party_name}</span></td>
                    <td className="py-1 pr-2 text-xs">{x.assigned_to_name || ''}</td>
                    <td className={`py-1 text-xs whitespace-nowrap ${x.is_overdue ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{x.due_date ? String(x.due_date).slice(0, 10) : x.status_label}</td>
                </tr>
            ))}</tbody>
        </table>
    );
    const empty = (list: unknown[], text: string) => (list.length ? null : <p className="text-sm text-gray-400 py-4 text-center">{text}</p>);

    return (
        <Layout>
            <div className="p-4 md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <h1 className="text-xl font-semibold text-gray-900">Work Dashboard <span className="text-sm font-normal text-gray-500">Tasks · Darta / Chalani</span></h1>
                    <div className="flex gap-2">
                        {d?.can_see_all_tasks && (
                            <select className="erp-select !w-auto text-sm" value={scope} onChange={e => setScope(e.target.value as 'mine' | 'all')}>
                                <option value="mine">Tasks I am involved in</option><option value="all">All company tasks</option></select>
                        )}
                        <button type="button" className="erp-btn" onClick={load}>⟳ Refresh</button>
                        <button type="button" className="erp-btn primary" onClick={() => navigate('/tasks?new=1')}>➕ Task</button>
                        {d?.can_darta && <button type="button" className="erp-btn primary" onClick={() => navigate('/darta-chalani')}>📨 Darta / Chalani</button>}
                    </div>
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {d && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-3">
                            <Kpi label="My open tasks" value={d.kpis.my_open_tasks} onClick={() => navigate('/tasks')} />
                            <Kpi label="My overdue tasks" value={d.kpis.my_overdue_tasks} tone={d.kpis.my_overdue_tasks ? 'text-red-600' : ''} onClick={() => navigate('/tasks?view=overdue')} />
                            <Kpi label="Due today" value={d.kpis.due_today} tone={d.kpis.due_today ? 'text-orange-600' : ''} />
                            <Kpi label="Done this month" value={d.kpis.done_this_month} tone="text-green-700" />
                            {d.can_darta && <Kpi label="Darta this month" value={d.kpis.darta_this_month} onClick={() => navigate('/darta-chalani?type=darta')} />}
                            {d.can_darta && <Kpi label="Chalani this month" value={d.kpis.chalani_this_month} onClick={() => navigate('/darta-chalani?type=chalani')} />}
                            {d.can_darta && <Kpi label="Pending darta / chalani" value={d.kpis.pending_darta} onClick={() => navigate('/darta-chalani?status=pending')} />}
                            {d.can_darta && <Kpi label="Overdue darta / chalani" value={d.kpis.overdue_darta} tone={d.kpis.overdue_darta ? 'text-red-600' : ''} />}
                            <Kpi label="Open tasks (shown)" value={d.kpis.open_tasks} />
                            <Kpi label="Overdue tasks (shown)" value={d.kpis.overdue_tasks} tone={d.kpis.overdue_tasks ? 'text-red-600' : ''} />
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
                            <Panel title="Tasks by status"><Chart type="donut" points={d.charts.task_status} labels={['Tasks']} height={200} /></Panel>
                            <Panel title="Tasks created vs done (8 weeks)"><Chart type="bar" points={d.charts.task_weekly} labels={['Created', 'Done']} height={200} /></Panel>
                            <Panel title="Open tasks per person"><Chart type="hbar" points={d.charts.task_by_assignee} labels={['Open tasks']} height={200} /></Panel>
                            {d.can_darta && <Panel title="Darta vs Chalani (12 months)" className="lg:col-span-2"><Chart type="bar" points={d.charts.darta_monthly} labels={['Darta', 'Chalani']} height={220} /></Panel>}
                            <Panel title="Open tasks by priority"><Chart type="bar" points={d.charts.task_by_priority} labels={['Tasks']} height={200} /></Panel>
                            {d.can_darta && <Panel title="Pending darta by department"><Chart type="hbar" points={d.charts.pending_darta_by_department} labels={['Pending']} height={200} /></Panel>}
                            {d.can_darta && <Panel title="Darta / chalani by channel"><Chart type="donut" points={d.charts.darta_by_channel} labels={['Entries']} height={200} /></Panel>}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <Panel title="My tasks (next due first)">{taskRows(d.lists.my_tasks)}{empty(d.lists.my_tasks, 'Nothing on your list 🎉')}</Panel>
                            <Panel title="Overdue tasks">{taskRows(d.lists.overdue_tasks)}{empty(d.lists.overdue_tasks, 'No overdue tasks')}</Panel>
                            {d.can_darta && <Panel title="Pending darta / chalani">{dartaRows(d.lists.pending_darta)}{empty(d.lists.pending_darta, 'Nothing pending')}</Panel>}
                            {d.can_darta && <Panel title="Recent darta / chalani">{dartaRows(d.lists.recent_darta)}{empty(d.lists.recent_darta, 'Nothing registered yet')}</Panel>}
                        </div>
                    </>
                )}
            </div>
        </Layout>
    );
}
