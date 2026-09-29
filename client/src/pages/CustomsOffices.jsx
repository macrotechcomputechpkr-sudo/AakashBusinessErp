// =============================================
// CustomsOffices.jsx (/customs-offices)
// Customs Offices (Bhansar Karyalaya) master - picked on import Purchase
// Bills and on the Customs (Bhansar) tab of Purchase Additional. Nepal's
// offices are created with a code the first time the list opens
// (server/utils/customsOffices.js); codes and names can be edited.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';

const empty = { office_code: '', office_name: '', office_name_np: '', district: '', border_point: '', is_active: true };

export default function CustomsOffices() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [form, setForm] = useState(empty);
    const [editId, setEditId] = useState(null);
    const [q, setQ] = useState('');
    const [msg, setMsg] = useState(null);
    const load = useCallback(() => authFetch('/api/customs-offices?all=1').then(r => setRows(r.data || [])).catch(e => setMsg({ t: 'danger', m: e.message })), [authFetch]);
    useEffect(() => { load(); }, [load]);
    const save = async e => {
        e.preventDefault();
        try {
            if (editId) await authFetch(`/api/customs-offices/${editId}`, { method: 'PUT', body: JSON.stringify(form) });
            else await authFetch('/api/customs-offices', { method: 'POST', body: JSON.stringify(form) });
            setMsg({ t: 'success', m: editId ? 'Updated' : 'Customs Office added' }); setForm(empty); setEditId(null); load();
        } catch (err) { setMsg({ t: 'danger', m: err.message }); }
    };
    const toggle = async r => { try { await authFetch(`/api/customs-offices/${r.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !r.is_active }) }); load(); } catch (err) { setMsg({ t: 'danger', m: err.message }); } };
    const shown = rows.filter(r => !q || [r.office_code, r.office_name, r.office_name_np, r.district, r.border_point].some(x => String(x || '').toLowerCase().includes(q.toLowerCase())));
    const f = (k, label, cls = '') => (
        <div className={`erp-field ${cls}`}><label className="erp-label">{label}</label><input className="erp-input" value={form[k] || ''} onChange={e => setForm({ ...form, [k]: e.target.value })} /></div>
    );
    return (
        <Layout>
            <div className="erp-shell px-4"><div className="erp-card">
                <div className="erp-header"><span className="erp-header-title">🛃 Customs Offices (Bhansar)</span></div>
                {msg && <div className={`mx-4 mt-2 px-3 py-2 text-sm border-l-4 ${msg.t === 'success' ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}>{msg.m}</div>}
                <form onSubmit={save} className="erp-topbar grid-cols-1 md:grid-cols-3">
                    {f('office_code', 'Code *')}{f('office_name', 'Office Name *', '')}{f('office_name_np', 'नाम (नेपाली)')}{f('district', 'District')}{f('border_point', 'Border Point')}
                    <div className="flex gap-2 items-end md:col-span-3">
                        <button type="submit" className="erp-btn primary">{editId ? 'Update' : '➕ Add'}</button>
                        {editId && <button type="button" className="erp-btn" onClick={() => { setEditId(null); setForm(empty); }}>Cancel</button>}
                        <input className="erp-input ml-auto w-64" placeholder="Search code / name / district" value={q} onChange={e => setQ(e.target.value)} />
                    </div>
                </form>
                <div className="px-3 pb-3 overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>Code</th><th>Customs Office</th><th>नाम</th><th>District</th><th>Border Point</th><th>Status</th><th /></tr></thead>
                        <tbody>{shown.map(r => (
                            <tr key={r.id} className={r.is_active === false ? 'text-gray-400' : ''}>
                                <td className="font-mono">{r.office_code}</td><td>{r.office_name}</td><td>{r.office_name_np}</td><td>{r.district || r.location}</td><td>{r.border_point}</td>
                                <td>{r.is_active === false ? 'Inactive' : 'Active'}</td>
                                <td className="whitespace-nowrap">
                                    <button type="button" className="nav-btn small" onClick={() => { setEditId(r.id); setForm({ ...empty, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)) }); window.scrollTo({ top: 0 }); }}>Edit</button>{' '}
                                    <button type="button" className="nav-btn small" onClick={() => toggle(r)}>{r.is_active === false ? 'Activate' : 'Deactivate'}</button>
                                </td>
                            </tr>
                        ))}</tbody>
                    </table>
                    <p className="text-xs text-gray-500 mt-1">{shown.length} of {rows.length} offices · Nepal's customs offices were added with a code - change the codes to match yours if needed.</p>
                </div>
            </div></div>
        </Layout>
    );
}
