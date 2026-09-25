// =============================================
// BusinessUnitManagement.jsx
// Frontend for server/routes/businessUnitRoutes.js - existed in the
// original design document but had no working, connected page.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

const emptyForm = { unit_name: '', unit_short_name: '', unit_type: 'brand', brand_name: '', product_category: '', tax_rate: 13, description: '', parent_unit_id: '' };

function nameInitials(name) {
    if (!name || !name.trim()) return 'GEN';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'GEN';
}

export default function BusinessUnitManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [sysControl, setSysControl] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [showForm, setShowForm] = useState(false);
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => {
        setAlert({ message, type });
        setTimeout(() => setAlert(null), 5000);
    };

    const load = useCallback(async () => {
        try {
            const [res, sc] = await Promise.all([
                authFetch('/api/business-units'),
                authFetch('/api/system-control')
            ]);
            setRows(res.data || []);
            setSysControl(sc.data);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            await authFetch('/api/business-units', { method: 'POST', body: JSON.stringify(form) });
            showAlert('Business unit created', 'success');
            setForm(emptyForm);
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Deactivate "${row.unit_name}"?`)) return;
        try {
            await authFetch(`/api/business-units/${row.id}`, { method: 'DELETE' });
            showAlert('Business unit deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'unit_code', label: 'Code', type: 'text' },
        { key: 'unit_name', label: 'Name', type: 'text', editable: true },
        { key: 'unit_type', label: 'Type', type: 'text' },
        { key: 'brand_name', label: 'Brand', type: 'text', editable: true },
        { key: 'product_category', label: 'Category', type: 'text', editable: true },
        { key: 'tax_rate', label: 'Tax %', type: 'number', editable: true },
        // FEATURE: multi-level hierarchy - shows the computed level and,
        // indented, which parent it rolls up under, so the structure is
        // visible directly in the listing without needing a separate
        // tree view (the future Entry/Report modules will read the same
        // hierarchy_level and parent_unit_id columns this displays).
        {
            key: 'hierarchy_level', label: 'Level', type: 'text',
            render: r => {
                const parent = rows.find(x => x.id === r.parent_unit_id);
                return (
                    <span style={{ paddingLeft: ((r.hierarchy_level || 1) - 1) * 16 }}>
                        {(r.hierarchy_level || 1) > 1 && '↳ '}
                        Level {r.hierarchy_level || 1}{parent ? ` (under ${parent.unit_name})` : ''}
                    </span>
                );
            }
        }
    ];

    // FEATURE: inline cell editing - safe here because every editable
    // column is a plain scalar with no foreign-key relationship or
    // conditional logic to protect (unlike Ledger Accounts, Users, or
    // Product Groups, which stay form-only for exactly that reason).
    const handleCellEdit = async (row, key, value) => {
        try {
            const res = await authFetch(`/api/business-units/${row.id}`, { method: 'PUT', body: JSON.stringify({ [key]: value }) });
            setRows(rs => rs.map(r => r.id === row.id ? { ...r, ...res.data } : r));
            showAlert('Business unit updated', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    return (
        <Layout>
        <div className="max-w-5xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Business Units</h1>
                <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Business Unit'}
                </button>
            </div>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>
                    {alert.message}
                </div>
            )}

            {showForm && (
                <form onSubmit={handleCreate} ref={formRef} className="bg-white border rounded-xl p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input className="erp-input" disabled placeholder="Code" value="Auto-generated on save" />
                    <input className="erp-input" placeholder="Unit Name *" value={form.unit_name} onChange={e => setForm({ ...form, unit_name: e.target.value })} required />
                    <input className="erp-input" placeholder={`Short Name (Alias) - e.g. ${nameInitials(form.unit_name)}00001`} value={form.unit_short_name} onChange={e => setForm({ ...form, unit_short_name: e.target.value })} />
                    <select className="erp-input" value={form.unit_type} onChange={e => setForm({ ...form, unit_type: e.target.value })}>
                        <option value="brand">Brand</option>
                        <option value="division">Division</option>
                        <option value="product_line">Product Line</option>
                    </select>
                    <input className="erp-input" placeholder="Brand Name" value={form.brand_name} onChange={e => setForm({ ...form, brand_name: e.target.value })} />
                    <input className="erp-input" placeholder="Product Category" value={form.product_category} onChange={e => setForm({ ...form, product_category: e.target.value })} />
                    <input type="number" step="0.01" className="erp-input" placeholder="Tax Rate %" value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} />
                    {sysControl?.enable_business_unit_hierarchy && (
                        <div>
                            <SearchablePopupSelect
                                listKey="business_unit_parent_picker"
                                columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                defaultVisibleKeys={['unit_name']}
                                items={rows} getId={r => r.id} getLabel={r => r.unit_name}
                                searchKeys={['unit_name', 'unit_code']}
                                value={form.parent_unit_id} onChange={id => setForm({ ...form, parent_unit_id: id })}
                                placeholder={`Parent Unit (optional, up to ${sysControl.business_unit_max_levels || 3} levels)`}
                            />
                        </div>
                    )}
                    <input className="border rounded-lg px-3 py-2 md:col-span-3" placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                    <div className="md:col-span-3 flex justify-end">
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={(r) => r.id}
                storageKey="business_unit_grid"
                onCellEdit={handleCellEdit}
                rowActions={(row) => <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>}
            />
        </div>
        </Layout>
    );
}
