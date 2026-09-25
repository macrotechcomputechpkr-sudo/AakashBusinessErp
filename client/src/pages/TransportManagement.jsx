// =============================================
// TransportManagement.jsx
// Transport Master - a Vendor Ledger AND/OR a Sub-Ledger can both be
// picked at once for the same transport entry (not either/or).
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

function nameInitials(name) {
    if (!name || !name.trim()) return 'GEN';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'GEN';
}

const emptyForm = {
    transport_name: '', short_name: '', vendor_ledger_id: '', sub_ledger_id: '',
    contact_person: '', phone: '', email: '', address: '', display_order: 1
};

export default function TransportManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [t, v1, v2, sl] = await Promise.all([
                authFetch('/api/transport-master'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=purchase'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=both'),
                authFetch('/api/sub-ledgers')
            ]);
            setRows(t.data || []);
            setVendors([...(v1.data || []), ...(v2.data || [])]);
            setSubLedgers(sl.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.transport_name.trim()) return showAlert('Transport Name is required', 'danger');
        if (!form.vendor_ledger_id && !form.sub_ledger_id) return showAlert('Select at least one: a Vendor Ledger or a Sub-Ledger', 'danger');
        try {
            if (editingId) {
                await authFetch(`/api/transport-master/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
                showAlert('Transport updated', 'success');
            } else {
                await authFetch('/api/transport-master', { method: 'POST', body: JSON.stringify(form) });
                showAlert('Transport created', 'success');
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
        setForm({ ...emptyForm, ...row });
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Deactivate "${row.transport_name}"?`)) return;
        try {
            await authFetch(`/api/transport-master/${row.id}`, { method: 'DELETE' });
            showAlert('Transport deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'transport_code', label: 'Code', type: 'text' },
        { key: 'transport_name', label: 'Name', type: 'text' },
        { key: 'vendor_ledger', label: 'Vendor Ledger', type: 'text', render: r => r.vendor_ledger?.account_name || '—' },
        { key: 'sub_ledger', label: 'Sub-Ledger', type: 'text', render: r => r.sub_ledger?.sub_ledger_name || '—' },
        { key: 'phone', label: 'Phone', type: 'text' }
    ];

    return (
        <Layout>
        <div className="max-w-4xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Transport Master</h1>
                <button onClick={() => { resetForm(); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Transport'}
                </button>
            </div>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} ref={formRef} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                    <h2 className="font-semibold text-lg">{editingId ? 'Edit Transport' : 'Create New Transport'}</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="erp-label">Code <span className="text-xs text-gray-400">(preview only)</span></label>
                            <input className="erp-input" disabled
                                value={editingId ? (form.transport_code || '') : 'Auto-generated on save'} />
                        </div>
                        <div>
                            <label className="erp-label">Transport Name *</label>
                            <input className="erp-input" value={form.transport_name} onChange={e => setForm({ ...form, transport_name: e.target.value })} required />
                        </div>
                        <div>
                            <label className="erp-label">Short Name (Alias)</label>
                            <input className="erp-input" value={form.short_name} onChange={e => setForm({ ...form, short_name: e.target.value })}
                                placeholder={!editingId ? `e.g. ${nameInitials(form.transport_name)}00001 (auto if blank)` : ''} />
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Accounting Link <span className="text-gray-400 font-normal normal-case">(pick either, or both)</span></p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="erp-label">Vendor Ledger</label>
                                <SearchablePopupSelect
                                    listKey="transport_vendor_picker"
                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                    defaultVisibleKeys={['account_name']}
                                    items={vendors} getId={l => l.id} getLabel={l => l.account_name}
                                    searchKeys={['account_name', 'account_code']}
                                    value={form.vendor_ledger_id} onChange={id => setForm({ ...form, vendor_ledger_id: id })}
                                    placeholder="Select Vendor Ledger"
                                />
                            </div>
                            <div>
                                <label className="erp-label">Sub-Ledger</label>
                                <SearchablePopupSelect
                                    listKey="transport_sub_ledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.sub_ledger_id} onChange={id => setForm({ ...form, sub_ledger_id: id })}
                                    placeholder="Select Sub-Ledger"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="erp-label">Contact Person</label>
                            <input className="erp-input" value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
                        </div>
                        <div>
                            <label className="erp-label">Phone</label>
                            <input className="erp-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                        </div>
                        <div>
                            <label className="erp-label">Email</label>
                            <input type="email" className="erp-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                        </div>
                        <div>
                            <label className="erp-label">Address</label>
                            <input className="erp-input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                            {editingId ? 'Update Transport' : 'Create Transport'}
                        </button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="transport_grid"
                auditTable="transport_master"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                        <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>
                    </div>
                )}
            />
        </div>
        </Layout>
    );
}
