// =============================================
// DocumentNumberingManagement.jsx
// Configure Manual/Auto numbering, Global/Branch-wise/User-wise scope,
// Prefix/Suffix/Digit-count/Start-End/FY, per voucher type. One
// category can be marked Default per voucher type.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

const VOUCHER_TYPES = [
    { value: 'purchase_requisition', label: 'Purchase Requisition' },
    { value: 'purchase_quotation', label: 'Purchase Quotation' },
    { value: 'purchase_order', label: 'Purchase Order' },
    { value: 'purchase_grn', label: 'Purchase GRN' },
    { value: 'purchase_bill', label: 'Purchase Bill' },
    { value: 'purchase_return', label: 'Purchase Return' },
    { value: 'purchase_nonsalable_return', label: 'Purchase Non-saleable Return' },
    { value: 'purchase_additional', label: 'Purchase Additional Expense' },
    { value: 'sales_quotation', label: 'Sales Quotation' },
    { value: 'sales_order', label: 'Sales Order' },
    { value: 'sales_delivery', label: 'Sales Delivery' },
    { value: 'sales_bill', label: 'Sales Bill' },
    { value: 'sales_return', label: 'Sales Return' },
    { value: 'sales_nonsalable_return', label: 'Sales Non-saleable Return' },
    { value: 'sales_additional', label: 'Sales Additional Expense' },
    { value: 'stock_transfer', label: 'Stock Transfer' },
    { value: 'debit_note', label: 'Debit Note' },
    { value: 'credit_note', label: 'Credit Note' },
    { value: 'cash_bank_entry', label: 'Cash/Bank Entry' },
    { value: 'journal', label: 'Journal Voucher' },
    { value: 'cash', label: 'Cash Voucher' },
    { value: 'bank', label: 'Bank Voucher' },
    { value: 'pdc', label: 'PDC' },
    { value: 'production', label: 'Production Entry' }
];

const emptyForm = {
    voucher_type: 'purchase_requisition', category_name: '', numbering_mode: 'auto', scope: 'global',
    prefix: '', suffix: '', digit_count: 6, start_number: 1, end_number: '',
    include_fiscal_year: true, fy_digit_format: 'short', is_default: false
};

function previewFormat(f) {
    const fy = f.include_fiscal_year ? (f.fy_digit_format === 'full' ? '208182' : '8182') : '';
    const padded = String(f.start_number || 1).padStart(Number(f.digit_count) || 6, '0');
    return `${f.prefix || ''}${fy}${padded}${f.suffix || ''}`;
}

export default function DocumentNumberingManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [scopeModal, setScopeModal] = useState(null);
    const [branches, setBranches] = useState([]);
    const [users, setUsers] = useState([]);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const res = await authFetch('/api/document-numbering-categories');
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
        // FEATURE: branches/users back the "Assign Branch/User" scope
        // modal only - fetched separately (not in the same Promise.all
        // as the main list) so a person without user-management rights
        // still sees their numbering categories; the Assign modal just
        // shows fewer options for them.
        try {
            const br = await authFetch('/api/branches');
            setBranches(br.data || []);
        } catch { /* keep whatever was loaded before, if anything */ }
        try {
            const us = await authFetch('/api/users');
            setUsers(us.data || []);
        } catch { /* likely lacks user_management view rights - fine, scope-by-branch still works */ }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    // FEATURE: "login User, Branch maa jun jun DocumentNumbering set
    // gareko xa" - restricting a category to specific branches/users so
    // a transaction entry screen shows only what applies to whoever is
    // logged in. No selection at all = stays globally available.
    const openScopeModal = async (row) => {
        try {
            const res = await authFetch(`/api/document-numbering-categories/${row.id}/scopes`);
            setScopeModal({
                category: row,
                branchIds: (res.data || []).filter(s => s.branch_id).map(s => s.branch_id),
                userIds: (res.data || []).filter(s => s.user_id).map(s => s.user_id)
            });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };
    const toggleScopeBranch = (branchId) => setScopeModal(m => ({ ...m, branchIds: m.branchIds.includes(branchId) ? m.branchIds.filter(id => id !== branchId) : [...m.branchIds, branchId] }));
    const toggleScopeUser = (userId) => setScopeModal(m => ({ ...m, userIds: m.userIds.includes(userId) ? m.userIds.filter(id => id !== userId) : [...m.userIds, userId] }));
    const handleSaveScopes = async () => {
        try {
            const res = await authFetch(`/api/document-numbering-categories/${scopeModal.category.id}/scopes`, { method: 'PUT', body: JSON.stringify({ branch_ids: scopeModal.branchIds, user_ids: scopeModal.userIds }) });
            showAlert(res.message, 'success');
            setScopeModal(null);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.category_name.trim()) return showAlert('Category Name is required', 'danger');
        try {
            const payload = { ...form, end_number: form.end_number || null };
            if (editingId) {
                await authFetch(`/api/document-numbering-categories/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('Numbering category updated', 'success');
            } else {
                await authFetch('/api/document-numbering-categories', { method: 'POST', body: JSON.stringify(payload) });
                showAlert('Numbering category created', 'success');
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
        setForm({ ...emptyForm, ...row, end_number: row.end_number ?? '' });
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Remove numbering category "${row.category_name}"?`)) return;
        try {
            await authFetch(`/api/document-numbering-categories/${row.id}`, { method: 'DELETE' });
            showAlert('Removed', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'voucher_type', label: 'Module', type: 'text', render: r => VOUCHER_TYPES.find(v => v.value === r.voucher_type)?.label || r.voucher_type },
        { key: 'category_name', label: 'Category', type: 'text' },
        { key: 'numbering_mode', label: 'Mode', type: 'text' },
        { key: 'scope', label: 'Scope', type: 'text' },
        { key: 'preview', label: 'Format Preview', type: 'text', render: r => previewFormat(r) },
        { key: 'is_default', label: 'Default', type: 'text', render: r => r.is_default ? '✓' : '' }
    ];

    return (
        <Layout>
        <div className="max-w-4xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Document Numbering</h1>
                <button onClick={() => { resetForm(); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Numbering Category'}
                </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">
                Every document type (Purchase Requisition, Order, Sales Bill, etc.) reads its
                Default category here to generate its number - or lets the user pick a
                different one if more than one exists for that module.
            </p>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} ref={formRef} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="erp-label">Module (Voucher Type) *</label>
                            <select className="erp-input" value={form.voucher_type} onChange={e => setForm({ ...form, voucher_type: e.target.value })}>
                                {VOUCHER_TYPES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Category Name *</label>
                            <input className="erp-input" value={form.category_name} onChange={e => setForm({ ...form, category_name: e.target.value })} placeholder="e.g. Standard" required />
                        </div>

                        <div>
                            <label className="erp-label">Numbering Mode</label>
                            <select className="erp-input" value={form.numbering_mode} onChange={e => setForm({ ...form, numbering_mode: e.target.value })}>
                                <option value="auto">Auto</option>
                                <option value="manual">Manual (user types the number)</option>
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Scope</label>
                            <select className="erp-input" value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} disabled={form.numbering_mode === 'manual'}>
                                <option value="global">Global (one shared counter)</option>
                                <option value="branch_wise">Branch-wise (separate counter per Branch)</option>
                                <option value="user_wise">User-wise (separate counter per User)</option>
                            </select>
                        </div>
                    </div>

                    {form.numbering_mode === 'auto' && (
                        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div>
                                    <label className="erp-label">Prefix</label>
                                    <input className="erp-input" value={form.prefix} onChange={e => setForm({ ...form, prefix: e.target.value })} placeholder="e.g. PREQ-" />
                                </div>
                                <div>
                                    <label className="erp-label">Suffix</label>
                                    <input className="erp-input" value={form.suffix} onChange={e => setForm({ ...form, suffix: e.target.value })} placeholder="e.g. -A" />
                                </div>
                                <div>
                                    <label className="erp-label">Digit Count</label>
                                    <input type="number" min="1" max="12" className="erp-input" value={form.digit_count} onChange={e => setForm({ ...form, digit_count: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Start Number</label>
                                    <input type="number" min="1" className="erp-input" value={form.start_number} onChange={e => setForm({ ...form, start_number: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">End Number <span className="text-gray-400">(optional cap)</span></label>
                                    <input type="number" className="erp-input" value={form.end_number} onChange={e => setForm({ ...form, end_number: e.target.value })} />
                                </div>
                                <div className="flex items-end">
                                    <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={form.include_fiscal_year} onChange={e => setForm({ ...form, include_fiscal_year: e.target.checked })} /> Include Fiscal Year</label>
                                </div>
                                {form.include_fiscal_year && (
                                    <div>
                                        <label className="erp-label">FY Format</label>
                                        <select className="erp-input" value={form.fy_digit_format} onChange={e => setForm({ ...form, fy_digit_format: e.target.value })}>
                                            <option value="short">Short (8182)</option>
                                            <option value="full">Full (208182)</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div className="text-sm">
                                <span className="text-gray-500">Preview: </span>
                                <span className="font-mono font-semibold">{previewFormat(form)}</span>
                            </div>
                        </div>
                    )}

                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked })} /> Set as Default for this Module</label>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">{editingId ? 'Update' : 'Create'} Category</button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="document_numbering_grid"
                auditTable="document_numbering_categories"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                        <button onClick={() => openScopeModal(row)} className="px-2 py-1 bg-purple-600 text-white rounded text-xs">Assign Branch/User</button>
                        <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                    </div>
                )}
            />
        </div>

        {scopeModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <h3 className="font-semibold text-lg mb-1">Assign — {scopeModal.category.category_name}</h3>
                    <p className="text-xs text-gray-400 mb-4">Leave everything unchecked to keep this category globally available. Check specific branches/users to restrict it to only them — a transaction entry screen will then only offer it to those branches/users.</p>

                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Branches</h4>
                    <div className="grid grid-cols-2 gap-1.5 mb-4">
                        {branches.map(b => (
                            <label key={b.id} className="flex items-center gap-1.5 text-sm">
                                <input type="checkbox" checked={scopeModal.branchIds.includes(b.id)} onChange={() => toggleScopeBranch(b.id)} />
                                {b.branch_name}
                            </label>
                        ))}
                        {branches.length === 0 && <p className="text-xs text-gray-400">No branches configured.</p>}
                    </div>

                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Users</h4>
                    <div className="grid grid-cols-2 gap-1.5 mb-4 max-h-40 overflow-y-auto">
                        {users.map(u => (
                            <label key={u.id} className="flex items-center gap-1.5 text-sm">
                                <input type="checkbox" checked={scopeModal.userIds.includes(u.id)} onChange={() => toggleScopeUser(u.id)} />
                                {u.full_name}
                            </label>
                        ))}
                        {users.length === 0 && <p className="text-xs text-gray-400">No users found.</p>}
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => setScopeModal(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="button" onClick={handleSaveScopes} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">Save</button>
                    </div>
                </div>
            </div>
        )}
        </Layout>
    );
}
