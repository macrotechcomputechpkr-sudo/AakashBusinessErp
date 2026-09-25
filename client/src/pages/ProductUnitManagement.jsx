// =============================================
// ProductUnitManagement.jsx
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

const emptyForm = { unit_name: '', unit_symbol: '', unit_type: 'simple', display_order: 1 };

export default function ProductUnitManagement() {
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
            const res = await authFetch('/api/product-units');
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.unit_name.trim()) return showAlert('Unit Name is required', 'danger');
        try {
            if (editingId) {
                await authFetch(`/api/product-units/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
                showAlert('Unit updated', 'success');
            } else {
                await authFetch('/api/product-units', { method: 'POST', body: JSON.stringify(form) });
                showAlert('Unit created', 'success');
            }
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = (row) => { setEditingId(row.id); setForm({ ...emptyForm, ...row }); setShowForm(true); };
    const handleDelete = async (row) => {
        if (!window.confirm(`Deactivate "${row.unit_name}"?`)) return;
        try {
            await authFetch(`/api/product-units/${row.id}`, { method: 'DELETE' });
            showAlert('Unit deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'unit_code', label: 'Code', type: 'text' },
        { key: 'unit_name', label: 'Name', type: 'text', editable: true },
        { key: 'unit_symbol', label: 'Symbol', type: 'text', editable: true },
        { key: 'unit_type', label: 'Type', type: 'text' }
    ];

    const handleCellEdit = async (row, key, value) => {
        try {
            const res = await authFetch(`/api/product-units/${row.id}`, { method: 'PUT', body: JSON.stringify({ [key]: value }) });
            setRows(rs => rs.map(r => r.id === row.id ? { ...r, ...res.data } : r));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    return (
        <Layout>
        <div className="max-w-3xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Product Units</h1>
                <button onClick={() => { resetForm(); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Unit'}
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
                <form ref={formRef} onSubmit={handleSubmit} className="bg-white border rounded-xl p-6 mb-6 grid grid-cols-3 gap-4">
                    <input className="erp-input" placeholder="Unit Name *" value={form.unit_name} onChange={e => setForm({ ...form, unit_name: e.target.value })} required />
                    <input className="erp-input" placeholder="Symbol (e.g. Kg)" value={form.unit_symbol} onChange={e => setForm({ ...form, unit_symbol: e.target.value })} />
                    <select className="erp-input" value={form.unit_type} onChange={e => setForm({ ...form, unit_type: e.target.value })}>
                        <option value="simple">Simple</option>
                        <option value="compound">Compound</option>
                    </select>
                    <div className="col-span-3 flex justify-end gap-2">
                        <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">{editingId ? 'Update' : 'Create'}</button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="product_unit_grid"
                auditTable="product_units"
                onCellEdit={handleCellEdit}
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
