// =============================================
// SalesmanAgentManagement.jsx
// Full CRUD for Salesman/Agent - previously only had a create-only
// endpoint and no dedicated management page, even though every Sales/
// Purchase transaction form picks an agent from this list.
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

const emptyForm = { agent_name: '', phone: '', email: '', commission_percentage: 0, allow_rate_change_on_mobile_order: false };

export default function SalesmanAgentManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const res = await authFetch('/api/salesman-agents');
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.agent_name.trim()) return showAlert('Agent name is required', 'danger');
        try {
            const payload = { ...form, commission_percentage: Number(form.commission_percentage) || 0 };
            if (editingId) {
                await authFetch(`/api/salesman-agents/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('Salesman/Agent updated', 'success');
            } else {
                await authFetch('/api/salesman-agents', { method: 'POST', body: JSON.stringify(payload) });
                showAlert('Salesman/Agent created', 'success');
            }
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = (row) => {
        setEditingId(row.id);
        setForm({
            agent_name: row.agent_name || '', phone: row.phone || '', email: row.email || '',
            commission_percentage: row.commission_percentage || 0, allow_rate_change_on_mobile_order: !!row.allow_rate_change_on_mobile_order
        });
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Remove "${row.agent_name}"? Past transactions will keep showing their name, but they will no longer appear when picking an agent for new entries.`)) return;
        try {
            await authFetch(`/api/salesman-agents/${row.id}`, { method: 'DELETE' });
            showAlert('Salesman/Agent removed', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'agent_code', label: 'Code', type: 'text' },
        { key: 'agent_name', label: 'Name', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'text', render: r => r.phone || '—' },
        { key: 'email', label: 'Email', type: 'text', render: r => r.email || '—' },
        { key: 'commission_percentage', label: 'Commission %', type: 'number' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🧑‍💼 Salesman / Agent</span>
                <div className="erp-header-actions">
                    <button onClick={() => { resetForm(); setShowForm(s => !s); }} className={`erp-header-btn ${showForm ? '' : 'primary'}`}>
                        {showForm ? '✕ Close' : '➕ New'}
                    </button>
                </div>
            </div>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} ref={formRef}>
                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="erp-field">
                                <label className="erp-label">Agent Name <span className="req">*</span></label>
                                <input className="erp-input" value={form.agent_name} onChange={e => setForm({ ...form, agent_name: e.target.value })} required />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Phone</label>
                                <input className="erp-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Email</label>
                                <input type="email" className="erp-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Commission %</label>
                                <input type="number" step="0.01" className="erp-input" value={form.commission_percentage} onChange={e => setForm({ ...form, commission_percentage: e.target.value })} />
                            </div>
                            <div className="erp-field md:col-span-2">
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={form.allow_rate_change_on_mobile_order} onChange={e => setForm({ ...form, allow_rate_change_on_mobile_order: e.target.checked })} />
                                    Allow this agent to change rate when placing a mobile order
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>
                            <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </form>
            )}
        </div>

        <div className="max-w-4xl mx-auto px-4 mt-4">
            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="salesman_agent_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                        <a href={`/route-plan?tab=mobile&agent_id=${row.id}`} className="px-2 py-1 bg-emerald-600 text-white rounded text-xs" title="Create the salesman's mobile login, route plan and mobile settings">📱 {row.linked_user_id ? 'Login / Plan' : 'Create Login'}</a>
                        <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                    </div>
                )}
            />
        </div>
        </div>
        </Layout>
    );
}
