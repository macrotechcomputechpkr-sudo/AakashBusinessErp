// =============================================
// SecurityGroupManagement.jsx
// Full CRUD for Security Groups. The backend already had POST/PUT for
// this; UserManagement.jsx only ever fetched groups for a picker, so
// there was no page to actually create, edit, or delete a group's
// permission matrix (15 modules x 6 actions each) - or use the DELETE
// endpoint added alongside this page.
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

const MODULES = [
    ['dashboard', 'Dashboard'], ['ledger', 'Ledger'], ['product', 'Product'],
    ['sales', 'Sales'], ['purchase', 'Purchase'], ['inventory', 'Inventory'],
    ['invoice', 'Invoice'], ['reports', 'Reports'], ['user_management', 'User Management'],
    ['security_groups', 'Security Groups'], ['company_settings', 'Company Settings'],
    ['tax_settings', 'Tax Settings'], ['ocr_bill', 'OCR Bill'], ['backup', 'Backup'], ['audit_log', 'Audit Log']
];
const ACTIONS = ['view', 'create', 'edit', 'delete', 'print', 'export'];

const emptyPermissions = () => Object.fromEntries(MODULES.map(([key]) => [key, Object.fromEntries(ACTIONS.map(a => [a, false]))]));
const emptyForm = { group_name: '', group_description: '', permissions: emptyPermissions() };

export default function SecurityGroupManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [editingIsSystem, setEditingIsSystem] = useState(false);
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const res = await authFetch('/api/security-groups');
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setEditingIsSystem(false); };

    const togglePermission = (moduleKey, action) => setForm(f => ({
        ...f,
        permissions: { ...f.permissions, [moduleKey]: { ...f.permissions[moduleKey], [action]: !f.permissions[moduleKey][action] } }
    }));

    const toggleWholeRow = (moduleKey, value) => setForm(f => ({
        ...f,
        permissions: { ...f.permissions, [moduleKey]: Object.fromEntries(ACTIONS.map(a => [a, value])) }
    }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.group_name.trim()) return showAlert('Group name is required', 'danger');
        try {
            if (editingId) {
                await authFetch(`/api/security-groups/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
                showAlert('Security group updated', 'success');
            } else {
                await authFetch('/api/security-groups', { method: 'POST', body: JSON.stringify(form) });
                showAlert('Security group created', 'success');
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
        setEditingIsSystem(!!row.is_system);
        const mergedPermissions = emptyPermissions();
        MODULES.forEach(([key]) => { if (row.permissions?.[key]) mergedPermissions[key] = { ...mergedPermissions[key], ...row.permissions[key] }; });
        setForm({ group_name: row.group_name || '', group_description: row.group_description || '', permissions: mergedPermissions });
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Remove security group "${row.group_name}"? Users still assigned to it must be reassigned first.`)) return;
        try {
            await authFetch(`/api/security-groups/${row.id}`, { method: 'DELETE' });
            showAlert('Security group removed', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'group_code', label: 'Code', type: 'text' },
        { key: 'group_name', label: 'Name', type: 'text' },
        { key: 'group_description', label: 'Description', type: 'text', render: r => r.group_description || '—' },
        { key: 'group_type', label: 'Type', type: 'text', render: r => r.is_system ? 'System' : 'Custom' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🔐 Security Groups</span>
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
                    {editingIsSystem && (
                        <div className="mx-4 mt-3 px-4 py-2 rounded-lg text-sm bg-amber-50 border-l-4 border-amber-500 text-amber-800">
                            This is a built-in system group and cannot be edited.
                        </div>
                    )}
                    <fieldset disabled={editingIsSystem}>
                        <div className="erp-tab-content">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                                <div className="erp-field">
                                    <label className="erp-label">Group Name <span className="req">*</span></label>
                                    <input className="erp-input" value={form.group_name} onChange={e => setForm({ ...form, group_name: e.target.value })} required />
                                </div>
                                <div className="erp-field">
                                    <label className="erp-label">Description</label>
                                    <input className="erp-input" value={form.group_description} onChange={e => setForm({ ...form, group_description: e.target.value })} />
                                </div>
                            </div>

                            <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Permissions</h2>
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table min-w-[700px]">
                                    <thead>
                                        <tr>
                                            <th className="text-left">Module</th>
                                            {ACTIONS.map(a => <th key={a} className="text-center capitalize w-20">{a}</th>)}
                                            <th className="w-16"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {MODULES.map(([key, label]) => (
                                            <tr key={key}>
                                                <td>{label}</td>
                                                {ACTIONS.map(a => (
                                                    <td key={a} className="text-center">
                                                        <input
                                                            type="checkbox" data-enter-skip="true"
                                                            checked={!!form.permissions[key]?.[a]}
                                                            onChange={() => togglePermission(key, a)}
                                                        />
                                                    </td>
                                                ))}
                                                <td>
                                                    <button type="button" tabIndex={-1} onClick={() => toggleWholeRow(key, !ACTIONS.every(a => form.permissions[key]?.[a]))} className="text-blue-600 text-xs underline">
                                                        {ACTIONS.every(a => form.permissions[key]?.[a]) ? 'Clear' : 'All'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </fieldset>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>
                            {!editingIsSystem && <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Create'}</button>}
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
                storageKey="security_group_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">
                            {row.is_system ? 'View' : 'Edit'}
                        </button>
                        {!row.is_system && <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>}
                    </div>
                )}
            />
        </div>
        </div>
        </Layout>
    );
}
