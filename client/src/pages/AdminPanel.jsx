// =============================================
// AdminPanel.jsx (/admin)
// Where a Super Admin lands after login: every company (tenant) with its
// users, last login and subscription. From here the super admin can:
//   * open a company VIEW ONLY (reports, lists, documents - no entries;
//     the server refuses every write: middleware/auth.js readOnly)
//   * suspend / activate a company, set its plan, end date and user limit
//   * create a new company (Company Creation)
// Server: routes/adminRoutes.js, POST /api/auth/switch-tenant / exit-tenant.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const STATUS_CLS = { active: 'bg-green-100 text-green-800', suspended: 'bg-red-100 text-red-800', expired: 'bg-amber-100 text-amber-800', pending: 'bg-gray-100 text-gray-700' };
const d10 = v => (v ? String(v).slice(0, 10) : '');

export default function AdminPanel() {
    const { authFetch, user, switchTenant, logout } = useAuth();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('');
    const [msg, setMsg] = useState(null);
    const [edit, setEdit] = useState(null);
    const [busy, setBusy] = useState('');

    const load = useCallback(() => authFetch('/api/admin/overview').then(r => setData(r.data)).catch(e => setMsg({ t: 'danger', m: e.message })), [authFetch]);
    useEffect(() => { load(); }, [load]);

    const rows = useMemo(() => (data?.tenants || []).filter(t => (!status || t.subscription_status === status || (status === 'no_company' && !t.is_company_created))
        && (!q || [t.tenant_code, t.company_name, t.pan_number, t.contact_person, t.contact_email].some(x => String(x || '').toLowerCase().includes(q.toLowerCase())))), [data, q, status]);

    const open = async t => {
        setBusy(t.id);
        try {
            await switchTenant(t.id);
            navigate(t.is_company_created ? '/dashboard' : '/company-creation');
        } catch (e) { setMsg({ t: 'danger', m: e.message }); } finally { setBusy(''); }
    };
    const save = async (id, patch) => {
        try {
            const r = await authFetch(`/api/admin/tenants/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
            setMsg({ t: 'success', m: r.message }); setEdit(null); load();
        } catch (e) { setMsg({ t: 'danger', m: e.message }); }
    };
    const T = data?.totals || {};

    return (
        <div className="min-h-screen bg-[#e8e6de]">
            <div className="flex items-center justify-between px-4 py-2 text-white" style={{ background: 'linear-gradient(#2b5797, #1e3f6f)' }}>
                <div className="font-semibold">🛡 Aakash Business ERP - Admin Panel</div>
                <div className="flex items-center gap-3 text-sm">
                    <span>👤 {user?.full_name || user?.email} (Super Admin)</span>
                    <button type="button" className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30" onClick={() => navigate('/change-password')}>🔑 Password</button>
                    <button type="button" className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700" onClick={async () => { await logout(); navigate('/login'); }}>⏻ Logout</button>
                </div>
            </div>
            <div className="max-w-7xl mx-auto p-4">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
                    {[['Companies', T.tenants, ''], ['Active', T.active, 'active'], ['Suspended', T.suspended, 'suspended'], ['Subscription ended', T.expiring, ''], ['Company not created', T.without_company, 'no_company'], ['Users', T.users, '']].map(([l, v, st]) => (
                        <button key={l} type="button" onClick={() => st !== undefined && setStatus(s => (s === st ? '' : st))} className={`text-left border rounded bg-white px-3 py-2 shadow-sm ${status && status === st ? 'ring-2 ring-blue-500' : ''}`}>
                            <div className="text-xs text-gray-500">{l}</div><div className="text-2xl font-bold">{v ?? '…'}</div>
                        </button>
                    ))}
                </div>
                {msg && <div className={`mb-3 px-3 py-2 text-sm border-l-4 ${msg.t === 'success' ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}>{msg.m}</div>}
                <div className="bg-white border rounded shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 p-3 border-b bg-[#f4f2ea]">
                        <b className="mr-2">Companies (Tenants)</b>
                        <input className="erp-input w-72" placeholder="Search code, company, PAN, contact…" value={q} onChange={e => setQ(e.target.value)} />
                        <select className="erp-select w-44" value={status} onChange={e => setStatus(e.target.value)}>
                            <option value="">All status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="expired">Expired</option><option value="pending">Pending</option><option value="no_company">Company not created</option>
                        </select>
                        <span className="text-xs text-gray-500">{rows.length} shown</span>
                        <button type="button" className="erp-btn primary ml-auto" onClick={() => navigate('/company-creation')}>➕ New Company</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead><tr><th>Code</th><th>Company</th><th>PAN</th><th>Contact</th><th>Status</th><th>Plan</th><th className="text-right">Users</th><th>Last login</th><th>Subscription end</th><th>Created</th><th /></tr></thead>
                            <tbody>
                                {rows.map(t => (
                                    <tr key={t.id} className={t.is_active === false ? 'text-gray-400' : ''}>
                                        <td className="font-mono">{t.tenant_code}</td>
                                        <td className="font-semibold">{t.company_name}{!t.is_company_created && <span className="ml-1 text-[10px] text-amber-700">(company not created)</span>}</td>
                                        <td>{t.pan_number}</td>
                                        <td className="text-xs">{t.contact_person}<br />{t.contact_email}</td>
                                        <td><span className={`px-2 py-0.5 rounded text-xs ${STATUS_CLS[t.subscription_status] || ''}`}>{t.subscription_status}</span></td>
                                        <td>{t.subscription_plan}</td>
                                        <td className="text-right">{t.active_users}/{t.users}{t.max_users ? <span className="text-xs text-gray-400"> of {t.max_users}</span> : null}</td>
                                        <td className="text-xs">{t.last_login ? new Date(t.last_login).toLocaleString() : '—'}</td>
                                        <td>{d10(t.subscription_end) || '—'}</td>
                                        <td>{d10(t.created_at)}</td>
                                        <td className="whitespace-nowrap">
                                            <button type="button" className="nav-btn small primary" disabled={busy === t.id || t.is_active === false} onClick={() => open(t)} title="Open this company - view only, no entries">👁 Open (view only)</button>{' '}
                                            <button type="button" className="nav-btn small" onClick={() => setEdit({ id: t.id, name: t.company_name, subscription_status: t.subscription_status, subscription_plan: t.subscription_plan || 'standard', subscription_end: d10(t.subscription_end), max_users: t.max_users || 50, is_active: t.is_active !== false })}>⚙ Subscription</button>{' '}
                                            {t.subscription_status === 'active'
                                                ? <button type="button" className="nav-btn small" onClick={() => window.confirm(`Suspend ${t.company_name}? Its users cannot log in.`) && save(t.id, { subscription_status: 'suspended' })}>⛔ Suspend</button>
                                                : <button type="button" className="nav-btn small" onClick={() => save(t.id, { subscription_status: 'active' })}>✅ Activate</button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {data && rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No company matches.</p>}
                        {!data && <p className="text-sm text-gray-400 text-center py-6">Loading…</p>}
                    </div>
                </div>
                <p className="text-xs text-gray-600 mt-2">A Super Admin opens a company <b>view only</b>: reports, lists and documents can be seen, but no entry, change or delete is allowed (the server refuses it). Log in as that company's own user to make entries.</p>
            </div>
            {edit && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onMouseDown={e => e.target === e.currentTarget && setEdit(null)}>
                    <div className="bg-white rounded shadow-lg w-[420px]">
                        <div className="erp-header"><span className="erp-header-title">Subscription - {edit.name}</span></div>
                        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                            <label className="erp-field">Status<select className="erp-select" value={edit.subscription_status} onChange={e => setEdit({ ...edit, subscription_status: e.target.value })}>{['active', 'suspended', 'expired', 'pending'].map(s => <option key={s} value={s}>{s}</option>)}</select></label>
                            <label className="erp-field">Plan<input className="erp-input" value={edit.subscription_plan} onChange={e => setEdit({ ...edit, subscription_plan: e.target.value })} /></label>
                            <label className="erp-field">Subscription end<input type="date" className="erp-input" value={edit.subscription_end} onChange={e => setEdit({ ...edit, subscription_end: e.target.value })} /></label>
                            <label className="erp-field">Max users<input type="number" className="erp-input" value={edit.max_users} onChange={e => setEdit({ ...edit, max_users: e.target.value })} /></label>
                            <label className="flex items-center gap-2 col-span-2"><input type="checkbox" checked={edit.is_active} onChange={e => setEdit({ ...edit, is_active: e.target.checked })} /> Company active (listed / can be opened)</label>
                        </div>
                        <div className="erp-bottombar"><div /><div className="erp-bottombar-actions">
                            <button type="button" className="erp-btn" onClick={() => setEdit(null)}>Cancel</button>
                            <button type="button" className="erp-btn primary" onClick={() => { const { id, name, ...patch } = edit; save(id, patch); }}>Save</button>
                        </div></div>
                    </div>
                </div>
            )}
        </div>
    );
}
