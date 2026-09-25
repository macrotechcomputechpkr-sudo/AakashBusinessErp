// =============================================
// UserManagement.jsx
// FIX: the previous "User Management System" was a single static HTML file
// whose `users` array lived only in browser memory - nothing was ever sent
// to a server, so refreshing the page (or opening it on another device)
// lost everything, and "CRUD complete" was not actually true. This page
// calls the real /api/users, /api/departments, /api/designations and
// /api/security-groups endpoints (see server/routes/*), uses the shared
// ReportGrid (search + sort + group + filter + column visibility) and the
// shared Enter-key navigation hook.
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import SearchablePopupSelect from '../components/SearchablePopupSelect';

const emptyForm = {
    email: '', username: '', full_name: '', phone: '',
    department_id: '', designation_id: '', default_branch_id: '', gender: '', date_of_birth: '',
    pan_number: '', citizenship_number: '', address: '',
    security_group_id: '', is_company_admin: false, is_active: true,
    email_2fa_enabled: false, sms_2fa_enabled: false, authenticator_2fa_enabled: false,
    preferred_2fa_method: 'email',
    allow_sales_rate_change: false, rate_increase_percentage: '', rate_decrease_percentage: '',
    allow_sell_below_cost: false,
    backdated_entry_days: 0, post_date_entry_days: 0,
    employment_type: '', joining_date: '', confirmation_date: '', salary: '',
    bank_name: '', bank_account_number: '', emergency_contact_name: '', emergency_contact: '',
    password: '', password_expiry_days: 90, force_password_change: true
};

export default function UserManagement() {
    const { authFetch } = useAuth();
    const formRef = useRef(null);
    const [userFormTab, setUserFormTab] = useState('basic');
    const USER_FORM_TABS = [
        { key: 'basic', label: '🧾 Basic Information' },
        { key: 'personal', label: '👤 Personal & Security' },
        { key: 'work', label: '💼 Work & Password' }
    ];
    const handleUserFormLastField = () => {
        const idx = USER_FORM_TABS.findIndex(t => t.key === userFormTab);
        if (idx < USER_FORM_TABS.length - 1) {
            const nextTab = USER_FORM_TABS[idx + 1].key;
            setUserFormTab(nextTab);
            setTimeout(() => {
                const first = formRef.current?.querySelector(
                    'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])'
                );
                first?.focus();
            }, 0);
            return true;
        }
        return false;
    };
    useEnterKeyNavigation(formRef, { onLastField: handleUserFormLastField });

    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [errors, setErrors] = useState({});
    const [alert, setAlert] = useState(null);
    const [generatedPassword, setGeneratedPassword] = useState('');

    const [departments, setDepartments] = useState([]);
    const [branches, setBranches] = useState([]);
    const [designations, setDesignations] = useState([]);
    const [securityGroups, setSecurityGroups] = useState([]);

    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);

    const [modal, setModal] = useState(null); // 'department' | 'designation' | null
    const masterModalFormRef = useRef(null);
    useEnterKeyNavigation(masterModalFormRef);
    const [modalForm, setModalForm] = useState({ name: '', short: '', desc: '' });

    const showAlert = (message, type = 'info') => {
        setAlert({ message, type });
        setTimeout(() => setAlert(null), 5000);
    };

    const loadMasters = useCallback(async () => {
        try {
            const [d, de, sg, br] = await Promise.all([
                authFetch('/api/departments'),
                authFetch('/api/designations'),
                authFetch('/api/security-groups'),
                authFetch('/api/branches')
            ]);
            setDepartments(d.data || []);
            setDesignations(de.data || []);
            setSecurityGroups(sg.data || []);
            setBranches(br.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);

    // FIX: ReportGrid handles search/sort/group/filter client-side, so this
    // fetches the full user list once instead of paging server-side.
    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch('/api/users?pageSize=1000&sortBy=full_name&sortDir=asc');
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    useEffect(() => { loadMasters(); }, [loadMasters]);
    useEffect(() => { loadUsers(); }, [loadUsers]);

    const resetForm = () => {
        setForm(emptyForm);
        setErrors({});
        setEditingId(null);
        setGeneratedPassword('');
        setUserFormTab('basic');
    };

    const validate = () => {
        const e = {};
        if (!form.email.trim()) e.email = 'Email is required';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email format';
        if (!form.full_name.trim()) e.full_name = 'Full name is required';
        if (!form.security_group_id) e.security_group_id = 'Security group is required';
        if (form.allow_sales_rate_change) {
            const inc = Number(form.rate_increase_percentage) || 0;
            const dec = Number(form.rate_decrease_percentage) || 0;
            if (inc < 0 || inc > 100 || dec < 0 || dec > 100) e.rate = 'Rate limits must be between 0 and 100';
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) { showAlert('Please fix the highlighted fields', 'danger'); return; }

        try {
            if (editingId) {
                await authFetch(`/api/users/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
                showAlert('User updated successfully', 'success');
            } else {
                const res = await authFetch('/api/users', { method: 'POST', body: JSON.stringify(form) });
                showAlert('User created successfully', 'success');
                if (res.generated_password) setGeneratedPassword(res.generated_password);
            }
            resetForm();
            setShowForm(false);
            loadUsers();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = (user) => {
        setEditingId(user.id);
        setForm({ ...emptyForm, ...user, password: '' });
        setUserFormTab('basic');
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (user) => {
        if (!window.confirm(`Deactivate "${user.full_name}"?`)) return;
        try {
            await authFetch(`/api/users/${user.id}`, { method: 'DELETE' });
            showAlert('User deactivated', 'warning');
            loadUsers();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const openMasterModal = (type) => {
        setModal(type);
        setModalForm({ name: '', short: '', desc: '' });
    };

    const saveMasterModal = async () => {
        if (!modalForm.name.trim()) return showAlert('Name is required', 'danger');
        try {
            if (modal === 'department') {
                const res = await authFetch('/api/departments', {
                    method: 'POST',
                    body: JSON.stringify({ department_name: modalForm.name, department_short_name: modalForm.short, description: modalForm.desc })
                });
                await loadMasters();
                setForm(f => ({ ...f, department_id: res.data.id }));
                showAlert(`Department "${modalForm.name}" added`, 'success');
            } else {
                const res = await authFetch('/api/designations', {
                    method: 'POST',
                    body: JSON.stringify({ designation_name: modalForm.name, designation_short_name: modalForm.short, description: modalForm.desc })
                });
                await loadMasters();
                setForm(f => ({ ...f, designation_id: res.data.id }));
                showAlert(`Designation "${modalForm.name}" added`, 'success');
            }
            setModal(null);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'full_name', label: 'Name', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'employee_code', label: 'Emp Code', type: 'text' },
        { key: 'department_name', label: 'Department', type: 'text' },
        { key: 'designation_name', label: 'Designation', type: 'text' },
        { key: 'security_group_name', label: 'Security Group', type: 'text' },
        {
            key: 'rate', label: 'Rate +/-', type: 'text',
            render: (r) => r.allow_sales_rate_change ? `+${r.rate_increase_percentage || 0}% / -${r.rate_decrease_percentage || 0}%` : '—'
        },
        {
            key: 'is_active', label: 'Status', type: 'text',
            render: (r) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {r.is_active ? 'Active' : 'Inactive'}
                </span>
            )
        }
    ];

    return (
        <Layout>
        <div className="max-w-6xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">User Management</h1>
                <div className="flex gap-2">
                    <button onClick={() => { resetForm(); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                        {showForm ? 'Close Form' : '➕ New User'}
                    </button>
                </div>
            </div>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    alert.type === 'warning' ? 'bg-yellow-50 border-yellow-500 text-yellow-800' :
                    'bg-blue-50 border-blue-500 text-blue-800'
                }`}>
                    {alert.message}
                </div>
            )}

            {showForm && (
                <form ref={formRef} onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4">
                    <h2 className="font-semibold text-lg">{editingId ? 'Edit User' : 'Create New User'}</h2>

                    {/* FEATURE: 26-field form split into tabs (same pattern
                        as the Ledger Account form) - Enter on the last field
                        of a tab jumps to the next tab automatically. */}
                    <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                        {USER_FORM_TABS.map(t => (
                            <button key={t.key} type="button" onClick={() => setUserFormTab(t.key)}
                                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${userFormTab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className={userFormTab === 'basic' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
                        <div>
                            <label className="erp-label">Email *</label>
                            <input className="erp-input" value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })} />
                            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                        </div>
                        <div>
                            <label className="erp-label">Full Name *</label>
                            <input className="erp-input" value={form.full_name}
                                onChange={e => setForm({ ...form, full_name: e.target.value })} />
                            {errors.full_name && <p className="text-red-500 text-xs mt-1">{errors.full_name}</p>}
                        </div>
                        <div>
                            <label className="erp-label">Phone</label>
                            <input className="erp-input" value={form.phone}
                                onChange={e => setForm({ ...form, phone: e.target.value })} />
                        </div>

                        <div>
                            <label className="erp-label">Department (Enter to search, Enter again to pick)</label>
                            <SearchablePopupSelect
                                listKey="department_picker"
                                columns={[
                                    { key: 'department_code', label: 'Code' },
                                    { key: 'department_name', label: 'Name' },
                                    { key: 'department_head', label: 'Head' },
                                    { key: 'cost_center_code', label: 'Cost Center' }
                                ]}
                                defaultVisibleKeys={['department_code', 'department_name']}
                                items={departments}
                                getId={(d) => d.id}
                                getLabel={(d) => `${d.department_name} (${d.department_code})`}
                                searchKeys={['department_name', 'department_code']}
                                value={form.department_id}
                                onChange={(id) => setForm({ ...form, department_id: id })}
                                placeholder="Select Department"
                                onAddNew={() => openMasterModal('department')}
                                onLastField={handleUserFormLastField}
                            />
                        </div>

                        <div>
                            <label className="erp-label">Default Branch <span className="text-xs text-gray-400">(auto-fills Branch on every transaction this user creates)</span></label>
                            <SearchablePopupSelect
                                listKey="user_default_branch_picker"
                                columns={[{ key: 'branch_code', label: 'Code' }, { key: 'branch_name', label: 'Name' }]}
                                defaultVisibleKeys={['branch_name']}
                                items={branches} getId={b => b.id} getLabel={b => b.branch_name}
                                searchKeys={['branch_name', 'branch_code']}
                                value={form.default_branch_id} onChange={id => setForm({ ...form, default_branch_id: id })}
                                placeholder="Select Branch"
                                onLastField={handleUserFormLastField}
                            />
                        </div>

                        <div>
                            <label className="erp-label">Designation (Enter to search, Enter again to pick)</label>
                            <SearchablePopupSelect
                                listKey="designation_picker"
                                columns={[
                                    { key: 'designation_code', label: 'Code' },
                                    { key: 'designation_name', label: 'Name' },
                                    { key: 'grade', label: 'Grade' },
                                    { key: 'hierarchy_level', label: 'Level' }
                                ]}
                                defaultVisibleKeys={['designation_code', 'designation_name']}
                                items={designations}
                                getId={(d) => d.id}
                                getLabel={(d) => `${d.designation_name} (${d.designation_code})`}
                                searchKeys={['designation_name', 'designation_code']}
                                value={form.designation_id}
                                onChange={(id) => setForm({ ...form, designation_id: id })}
                                placeholder="Select Designation"
                                onAddNew={() => openMasterModal('designation')}
                                onLastField={handleUserFormLastField}
                            />
                        </div>

                        <div>
                            <label className="erp-label">Security Group * (Enter to search, Enter again to pick)</label>
                            <SearchablePopupSelect
                                listKey="security_group_picker"
                                columns={[
                                    { key: 'group_code', label: 'Code' },
                                    { key: 'group_name', label: 'Name' },
                                    { key: 'group_type', label: 'Type' }
                                ]}
                                defaultVisibleKeys={['group_code', 'group_name']}
                                items={securityGroups}
                                getId={(g) => g.id}
                                getLabel={(g) => g.group_name}
                                searchKeys={['group_name', 'group_code']}
                                value={form.security_group_id}
                                onChange={(id) => setForm({ ...form, security_group_id: id })}
                                placeholder="Select Security Group"
                                required
                                onLastField={handleUserFormLastField}
                            />
                            {errors.security_group_id && <p className="text-red-500 text-xs mt-1">{errors.security_group_id}</p>}
                        </div>
                    </div>

                    <div className={userFormTab === 'personal' ? '' : 'hidden'}>
                    <div className="border-t pt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Personal Information</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="erp-label">Username <span className="text-xs text-gray-400">(auto-generated if blank)</span></label>
                                <input className="erp-input" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
                            </div>
                            <div>
                                <label className="erp-label">Gender</label>
                                <select className="erp-input" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                                    <option value="">Select</option>
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="erp-label">Date of Birth</label>
                                <input type="date" className="erp-input" value={form.date_of_birth} onChange={e => setForm({ ...form, date_of_birth: e.target.value })} />
                            </div>
                            <div>
                                <label className="erp-label">Citizenship Number</label>
                                <input className="erp-input" value={form.citizenship_number} onChange={e => setForm({ ...form, citizenship_number: e.target.value })} />
                            </div>
                            <div>
                                <label className="erp-label">PAN Number</label>
                                <input className="erp-input" value={form.pan_number} onChange={e => setForm({ ...form, pan_number: e.target.value })} />
                            </div>
                            <div className="md:col-span-2">
                                <label className="erp-label">Address</label>
                                <input className="erp-input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                            </div>
                        </div>
                        <div className="flex gap-6 mt-3">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                                Active (user can log in)
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.is_company_admin} onChange={e => setForm({ ...form, is_company_admin: e.target.checked })} />
                                Company Admin
                            </label>
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Two-Factor Authentication</p>
                        <div className="flex flex-wrap gap-4 mb-2">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.email_2fa_enabled} onChange={e => setForm({ ...form, email_2fa_enabled: e.target.checked })} /> Email
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.sms_2fa_enabled} onChange={e => setForm({ ...form, sms_2fa_enabled: e.target.checked })} /> SMS
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.authenticator_2fa_enabled} onChange={e => setForm({ ...form, authenticator_2fa_enabled: e.target.checked })} /> Authenticator App
                            </label>
                        </div>
                        <label className="erp-label">Preferred Method</label>
                        <select className="border rounded-lg px-3 py-2 text-sm" value={form.preferred_2fa_method} onChange={e => setForm({ ...form, preferred_2fa_method: e.target.value })}>
                            <option value="email">Email</option>
                            <option value="sms">SMS</option>
                            <option value="authenticator">Authenticator</option>
                        </select>
                    </div>
                    </div>

                    <div className={userFormTab === 'work' ? '' : 'hidden'}>
                    <div className="border-t pt-4">
                        <label className="flex items-center gap-2 mb-2">
                            <input type="checkbox" checked={form.allow_sales_rate_change}
                                onChange={e => setForm({ ...form, allow_sales_rate_change: e.target.checked })} />
                            Allow Sales Rate Change
                        </label>
                        <div className="flex gap-4">
                            <div>
                                <label className="text-xs text-gray-500">⬆️ Increase (+) %</label>
                                <input type="number" disabled={!form.allow_sales_rate_change} className="w-24 border rounded-lg px-2 py-1 block"
                                    value={form.rate_increase_percentage}
                                    onChange={e => setForm({ ...form, rate_increase_percentage: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500">⬇️ Decrease (-) %</label>
                                <input type="number" disabled={!form.allow_sales_rate_change} className="w-24 border rounded-lg px-2 py-1 block"
                                    value={form.rate_decrease_percentage}
                                    onChange={e => setForm({ ...form, rate_decrease_percentage: e.target.value })} />
                            </div>
                        </div>
                        {errors.rate && <p className="text-red-500 text-xs mt-1">{errors.rate}</p>}
                        <label className="flex items-center gap-2 mt-2 text-sm">
                            <input type="checkbox" disabled={!form.allow_sales_rate_change} checked={form.allow_sell_below_cost}
                                onChange={e => setForm({ ...form, allow_sell_below_cost: e.target.checked })} />
                            Allow Sell Below Cost
                        </label>
                    </div>

                    <div className="border-t pt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Entry Date Permissions</p>
                        <div className="grid grid-cols-2 gap-4 max-w-md">
                            <div>
                                <label className="erp-label">Backdated Entry (days)</label>
                                <input type="number" min="0" className="erp-input" value={form.backdated_entry_days} onChange={e => setForm({ ...form, backdated_entry_days: e.target.value })} />
                            </div>
                            <div>
                                <label className="erp-label">Post-Date Entry (days)</label>
                                <input type="number" min="0" className="erp-input" value={form.post_date_entry_days} onChange={e => setForm({ ...form, post_date_entry_days: e.target.value })} />
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <label className="erp-label">Employment Type (shows HR fields)</label>
                        <select className="w-full md:w-64 border rounded-lg px-3 py-2" value={form.employment_type}
                            onChange={e => setForm({ ...form, employment_type: e.target.value })}>
                            <option value="">Not Applicable</option>
                            <option value="permanent">Permanent</option>
                            <option value="contract">Contract</option>
                            <option value="probation">Probation</option>
                            <option value="intern">Intern</option>
                            <option value="temporary">Temporary</option>
                        </select>

                        {form.employment_type && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 bg-gray-50 border-2 border-dashed border-blue-100 rounded-lg p-4">
                                <div>
                                    <label className="text-xs text-gray-500">Joining Date</label>
                                    <input type="date" className="w-full border rounded-lg px-2 py-1"
                                        value={form.joining_date} onChange={e => setForm({ ...form, joining_date: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">Confirmation Date</label>
                                    <input type="date" className="w-full border rounded-lg px-2 py-1"
                                        value={form.confirmation_date} onChange={e => setForm({ ...form, confirmation_date: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">Monthly Salary</label>
                                    <input type="number" className="w-full border rounded-lg px-2 py-1"
                                        value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">Bank Name</label>
                                    <input className="w-full border rounded-lg px-2 py-1"
                                        value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">Bank Account Number</label>
                                    <input className="w-full border rounded-lg px-2 py-1"
                                        value={form.bank_account_number} onChange={e => setForm({ ...form, bank_account_number: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">Emergency Contact Name</label>
                                    <input className="w-full border rounded-lg px-2 py-1"
                                        value={form.emergency_contact_name} onChange={e => setForm({ ...form, emergency_contact_name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">Emergency Contact Phone</label>
                                    <input className="w-full border rounded-lg px-2 py-1"
                                        value={form.emergency_contact} onChange={e => setForm({ ...form, emergency_contact: e.target.value })} />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-t pt-4">
                        <label className="erp-label">Password</label>
                        <input type="password" className="w-full md:w-80 border rounded-lg px-3 py-2"
                            value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                            placeholder="Leave blank to auto-generate" />
                        {generatedPassword && (
                            <p className="text-sm mt-1">Generated password: <code className="bg-yellow-100 px-2 py-0.5 rounded">{generatedPassword}</code></p>
                        )}
                        <div className="flex items-end gap-4 mt-3">
                            <div>
                                <label className="erp-label">Password Expiry (days)</label>
                                <input type="number" min="0" className="w-32 border rounded-lg px-3 py-2" value={form.password_expiry_days} onChange={e => setForm({ ...form, password_expiry_days: e.target.value })} />
                            </div>
                            <label className="flex items-center gap-2 text-sm pb-2">
                                <input type="checkbox" checked={form.force_password_change} onChange={e => setForm({ ...form, force_password_change: e.target.checked })} />
                                Force change on first login
                            </label>
                        </div>
                    </div>
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                            {editingId ? 'Update User' : 'Create User'}
                        </button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={(r) => r.id}
                storageKey="user_management_grid"
                auditTable="users"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                        <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>
                    </div>
                )}
            />
            {loading && <p className="text-sm text-gray-400 mt-2">Loading…</p>}

            {modal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <form ref={masterModalFormRef} onSubmit={e => { e.preventDefault(); saveMasterModal(); }} className="bg-white rounded-xl p-6 w-full max-w-md">
                        <h3 className="font-semibold text-lg mb-4">Add New {modal === 'department' ? 'Department' : 'Designation'}</h3>
                        <div className="space-y-3">
                            <input className="erp-input" placeholder="Name *"
                                value={modalForm.name} onChange={e => setModalForm({ ...modalForm, name: e.target.value })} />
                            <input className="erp-input" placeholder="Short code (optional)"
                                value={modalForm.short} onChange={e => setModalForm({ ...modalForm, short: e.target.value })} />
                            <textarea className="erp-input" rows="2" placeholder="Description (optional)"
                                value={modalForm.desc} onChange={e => setModalForm({ ...modalForm, desc: e.target.value })} />
                        </div>
                        <div className="flex justify-end gap-2 mt-4">
                            <button type="button" onClick={() => setModal(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
        </Layout>
    );
}
