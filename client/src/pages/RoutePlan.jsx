// =============================================
// RoutePlan.jsx  (/route-plan)
// Salesman route plan (beat plan) + mobile login / settings.
//   Plan      which route a salesman walks on which date: single dates, a
//             date range (optionally only some weekdays) or a weekly
//             repeating weekday. A date plan overrides the weekday plan.
//   Calendar  day by day the routes each salesman is planned for
//   Mobile    create / reset the salesman's login (opens /mobile on the
//             phone), rate change, off-route orders, order status,
//             default warehouse, commission ledgers
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const iso = d => d.toISOString().slice(0, 10);
const monthEnd = () => { const d = new Date(); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };

export default function RoutePlan() {
    const { authFetch } = useAuth();
    const url = new URLSearchParams(window.location.search);
    const [tab, setTab] = useState(url.get('tab') || 'plan');
    const [agents, setAgents] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [agentId, setAgentId] = useState(url.get('agent_id') || '');
    const [form, setForm] = useState({ route_id: '', plan_type: 'range', date_from: iso(new Date()), date_to: monthEnd(), only_weekdays: [], weekdays: [], dates: '' });
    const [range, setRange] = useState({ date_from: iso(new Date()), date_to: monthEnd() });
    const [cal, setCal] = useState(null);
    const [login, setLogin] = useState(null);
    const [loginForm, setLoginForm] = useState({ email: '', password: '' });
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const agent = agents.find(a => a.id === agentId);

    const loadAgents = useCallback(() => authFetch('/api/salesman-agents').then(r => setAgents(r.data || [])).catch(() => {}), [authFetch]);
    useEffect(() => {
        loadAgents();
        authFetch('/api/routes').then(r => setRoutes(r.data || [])).catch(() => {});
        authFetch('/api/warehouses').then(r => setWarehouses(r.data || [])).catch(() => {});
        authFetch('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc').then(r => setLedgers(r.data || [])).catch(() => {});
    }, [authFetch, loadAgents]);

    const loadCal = useCallback(async () => {
        const p = new URLSearchParams(range);
        if (agentId) p.set('agent_id', agentId);
        try { setCal((await authFetch(`/api/route-plans?${p}`)).data); } catch (e) { setError(e.message); }
    }, [authFetch, range, agentId]);
    useEffect(() => { loadCal(); }, [loadCal]);
    useEffect(() => {
        if (!agentId || tab !== 'mobile') return;
        authFetch(`/api/salesman-agents/${agentId}/login`).then(r => { setLogin(r.data); setLoginForm({ email: r.data.user?.email || r.data.agent.email || '', password: '' }); }).catch(e => setError(e.message));
    }, [authFetch, agentId, tab]);

    const toggle = (k, n) => set(k, form[k].includes(n) ? form[k].filter(x => x !== n) : [...form[k], n]);
    const save = async () => {
        setError(''); setMsg('');
        if (!agentId) return setError('Choose a salesman');
        const body = { agent_id: agentId, route_id: form.route_id };
        if (form.plan_type === 'weekday') Object.assign(body, { plan_type: 'weekday', weekdays: form.weekdays });
        else if (form.plan_type === 'dates') Object.assign(body, { plan_type: 'date', dates: form.dates.split(/[\s,]+/).filter(Boolean) });
        else Object.assign(body, { plan_type: 'date', date_from: form.date_from, date_to: form.date_to, only_weekdays: form.only_weekdays });
        try { const r = await authFetch('/api/route-plans', { method: 'POST', body: JSON.stringify(body) }); setMsg(`Added ${r.data.added} plan(s)${r.data.skipped ? `, ${r.data.skipped} already existed` : ''}`); loadCal(); }
        catch (e) { setError(e.message); }
    };
    const remove = async ids => {
        if (!window.confirm(`Remove ${ids.length} plan(s)?`)) return;
        try { await authFetch('/api/route-plans/delete-many', { method: 'POST', body: JSON.stringify({ ids }) }); loadCal(); } catch (e) { setError(e.message); }
    };
    const saveSettings = async patch => {
        try { await authFetch(`/api/salesman-agents/${agentId}/mobile-settings`, { method: 'PUT', body: JSON.stringify(patch) }); await loadAgents(); setMsg('Saved'); } catch (e) { setError(e.message); }
    };
    const saveLogin = async () => {
        setError(''); setMsg('');
        try {
            const r = await authFetch(`/api/salesman-agents/${agentId}/login`, { method: 'POST', body: JSON.stringify(loginForm) });
            setMsg(r.data.created ? `Login created for ${r.data.email}. The salesman signs in on the phone and opens /mobile.` : 'Password reset');
            const l = await authFetch(`/api/salesman-agents/${agentId}/login`); setLogin(l.data); loadAgents();
        } catch (e) { setError(e.message); }
    };

    const plans = (cal?.plans || []).filter(p => !agentId || p.agent_id === agentId);
    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">🗓 Salesman Route Plan & Mobile</span></div>
                    <div className="erp-tab-content">
                        <div className="flex flex-wrap gap-2 mb-3">
                            {[['plan', 'Plan'], ['calendar', 'Calendar'], ['mobile', 'Mobile login & settings']].map(([k, l]) => <button key={k} className={`erp-btn ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
                            <a className="erp-btn" href="/mobile" target="_blank" rel="noopener noreferrer">📱 Open mobile app</a>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                            <div className="erp-field"><label className="erp-label">Salesman</label>
                                <select className="erp-select" value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">All / choose…</option>{agents.map(a => <option key={a.id} value={a.id}>{a.agent_name}</option>)}</select></div>
                            {tab !== 'mobile' && <>
                                <div className="erp-field"><label className="erp-label">Show from</label><input type="date" className="erp-input" value={range.date_from} onChange={e => setRange({ ...range, date_from: e.target.value })} /></div>
                                <div className="erp-field"><label className="erp-label">to</label><input type="date" className="erp-input" value={range.date_to} onChange={e => setRange({ ...range, date_to: e.target.value })} /></div>
                            </>}
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}

                        {tab === 'plan' && (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 border rounded-lg p-3 mb-3">
                                    <div className="erp-field"><label className="erp-label">Route</label>
                                        <select className="erp-select" value={form.route_id} onChange={e => set('route_id', e.target.value)}><option value="">Choose…</option>{routes.map(r => <option key={r.id} value={r.id}>{r.route_name}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Plan by</label>
                                        <select className="erp-select" value={form.plan_type} onChange={e => set('plan_type', e.target.value)}>
                                            <option value="range">Date range</option><option value="dates">Specific dates</option><option value="weekday">Every week (weekday)</option>
                                        </select></div>
                                    {form.plan_type === 'range' && <>
                                        <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={form.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                                        <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={form.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                                        <div className="md:col-span-4 flex flex-wrap gap-3 text-sm"><span className="text-gray-500">Only on:</span>{WEEKDAYS.map((w, i) => <label key={w} className="flex items-center gap-1"><input type="checkbox" checked={form.only_weekdays.includes(i)} onChange={() => toggle('only_weekdays', i)} />{w}</label>)}<span className="text-xs text-gray-400">(none ticked = every day)</span></div>
                                    </>}
                                    {form.plan_type === 'dates' && <div className="erp-field md:col-span-2"><label className="erp-label">Dates (YYYY-MM-DD, comma separated)</label><input className="erp-input" value={form.dates} onChange={e => set('dates', e.target.value)} placeholder="2025-09-01, 2025-09-08" /></div>}
                                    {form.plan_type === 'weekday' && <div className="md:col-span-2 flex flex-wrap gap-3 text-sm items-end">{WEEKDAYS.map((w, i) => <label key={w} className="flex items-center gap-1"><input type="checkbox" checked={form.weekdays.includes(i)} onChange={() => toggle('weekdays', i)} />{w}</label>)}</div>}
                                    <div className="md:col-span-4"><button className="erp-btn primary" onClick={save}>➕ Add to plan</button></div>
                                </div>
                                <table className="erp-grid-table text-sm">
                                    <thead><tr><th>Salesman</th><th>Route</th><th>Day</th><th>Notes</th><th /></tr></thead>
                                    <tbody>
                                        {plans.map(p => <tr key={p.id}><td>{p.agent_name}</td><td>{p.route_name}</td><td>{p.plan_type === 'date' ? String(p.plan_date).slice(0, 10) : `Every ${WEEKDAYS[p.weekday]}`}</td><td className="text-xs">{p.notes || ''}</td><td><button className="text-xs text-red-600" onClick={() => remove([p.id])}>Remove</button></td></tr>)}
                                    </tbody>
                                </table>
                                {plans.length > 1 && <button className="erp-btn mt-2" onClick={() => remove(plans.map(p => p.id))}>Remove all shown ({plans.length})</button>}
                                {plans.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No plans in this range.</p>}
                            </>
                        )}

                        {tab === 'calendar' && cal && (
                            <table className="erp-grid-table text-sm">
                                <thead><tr><th>Date</th><th>Day</th><th>Salesman</th><th>Route(s)</th></tr></thead>
                                <tbody>{cal.days.map((d, i) => <tr key={i}><td>{d.date}</td><td>{WEEKDAYS[d.weekday]}</td><td>{d.agent_name}</td><td>{d.routes.map(r => r.name).join(', ')}</td></tr>)}</tbody>
                            </table>
                        )}

                        {tab === 'mobile' && (!agent ? <p className="text-sm text-gray-500">Choose a salesman.</p> : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="border rounded-lg p-3">
                                    <p className="font-semibold mb-2">Mobile login</p>
                                    {login?.user ? <p className="text-sm mb-2">Linked user: <b>{login.user.email}</b> {login.user.is_active === false && <span className="text-red-600">(inactive)</span>}</p> : <p className="text-sm text-gray-500 mb-2">No login yet - create one so the salesman can take orders on the phone.</p>}
                                    {!login?.user && <div className="erp-field mb-2"><label className="erp-label">Email (login id)</label><input className="erp-input" value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} /></div>}
                                    <div className="erp-field mb-2"><label className="erp-label">{login?.user ? 'New password' : 'Password'}</label><input type="password" className="erp-input" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} /></div>
                                    <button className="erp-btn primary" onClick={saveLogin}>{login?.user ? '🔑 Reset password' : '👤 Create salesman login'}</button>
                                    <p className="text-xs text-gray-500 mt-2">The login gets the "Salesman (Mobile)" security group and opens the mobile screen after sign-in.</p>
                                </div>
                                <div className="border rounded-lg p-3 space-y-2 text-sm">
                                    <p className="font-semibold">Mobile order settings</p>
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!agent.allow_rate_change_on_mobile_order} onChange={e => saveSettings({ allow_rate_change_on_mobile_order: e.target.checked })} /> May change rate / discount (otherwise only where the product group and company allow it)</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!agent.allow_off_route_orders} onChange={e => saveSettings({ allow_off_route_orders: e.target.checked })} /> May order for customers outside the day's route</label>
                                    <div className="erp-field"><label className="erp-label">Mobile orders are saved as</label>
                                        <select className="erp-select" value={agent.mobile_order_status || 'draft'} onChange={e => saveSettings({ mobile_order_status: e.target.value })}><option value="draft">Draft (office confirms)</option><option value="confirmed">Confirmed</option></select></div>
                                    <div className="erp-field"><label className="erp-label">Default warehouse (stock shown / ordered from)</label>
                                        <select className="erp-select" value={agent.default_warehouse_id || ''} onChange={e => saveSettings({ default_warehouse_id: e.target.value })}><option value="">All warehouses</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Commission expense ledger</label>
                                        <select className="erp-select" value={agent.commission_expense_ledger_id || ''} onChange={e => saveSettings({ commission_expense_ledger_id: e.target.value })}><option value="">—</option>{ledgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Commission payable ledger (salesman account)</label>
                                        <select className="erp-select" value={agent.commission_payable_ledger_id || ''} onChange={e => saveSettings({ commission_payable_ledger_id: e.target.value })}><option value="">—</option>{ledgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
