// =============================================
// BomTemplate.jsx
// Reusable production recipes - Production Order pulls these forward
// and scales them to the actual output quantity being run.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

const emptyRawMaterialRow = () => ({ product_id: '', qty: '', uom_id: '', process_name: '' });
const emptyByproductRow = () => ({ product_id: '', qty: '', uom_id: '', allocation_basis: 'fixed_recovery', recovery_rate: '', relative_value: '' });

const emptyForm = {
    template_name: '', description: '', output_product_id: '', standard_output_qty: '', output_uom_id: '', output_relative_value: '', is_active: true,
    raw_materials: [emptyRawMaterialRow()], byproducts: []
};

export default function BomTemplate() {
    const { authFetch } = useAuth();
    const enterFormRef0 = useRef(null);
    useEnterKeyNavigation(enterFormRef0);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);

    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, prod, un] = await Promise.all([
                authFetch('/api/bom-templates'),
                authFetch('/api/products'),
                authFetch('/api/product-units')
            ]);
            setRows(req.data || []);
            setProducts(prod.data || []);
            setUnits(un.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };
    const addRawMaterialRow = () => setForm(f => ({ ...f, raw_materials: [...f.raw_materials, emptyRawMaterialRow()] }));
    const removeRawMaterialRow = (idx) => setForm(f => ({ ...f, raw_materials: f.raw_materials.length > 1 ? f.raw_materials.filter((_, i) => i !== idx) : f.raw_materials }));
    const updateRawMaterialRow = (idx, patch) => setForm(f => ({ ...f, raw_materials: f.raw_materials.map((r, i) => i === idx ? { ...r, ...patch } : r) }));
    const addByproductRow = () => setForm(f => ({ ...f, byproducts: [...f.byproducts, emptyByproductRow()] }));
    const removeByproductRow = (idx) => setForm(f => ({ ...f, byproducts: f.byproducts.filter((_, i) => i !== idx) }));
    const updateByproductRow = (idx, patch) => setForm(f => ({ ...f, byproducts: f.byproducts.map((b, i) => i === idx ? { ...b, ...patch } : b) }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.template_name) return showAlert('Template Name is required', 'danger');
        if (!form.output_product_id || !form.standard_output_qty) return showAlert('Output Product and Standard Output Qty are required', 'danger');
        const validRawMaterials = form.raw_materials.filter(r => r.product_id && Number(r.qty) > 0);
        if (validRawMaterials.length === 0) return showAlert('At least one Raw Material line is required', 'danger');
        const validByproducts = form.byproducts.filter(b => b.product_id && Number(b.qty) > 0);
        try {
            const payload = { ...form, raw_materials: validRawMaterials, byproducts: validByproducts };
            if (editingId) {
                await authFetch(`/api/bom-templates/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('Template updated', 'success');
            } else {
                const res = await authFetch('/api/bom-templates', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(`Template ${res.data.template_code} created`, 'success');
            }
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/bom-templates/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...res.data,
                raw_materials: (res.data.raw_materials || []).length > 0 ? res.data.raw_materials : [emptyRawMaterialRow()],
                byproducts: res.data.byproducts || []
            });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Delete template "${row.template_name}"?`)) return;
        try {
            await authFetch(`/api/bom-templates/${row.id}`, { method: 'DELETE' });
            showAlert('Template deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'template_code', label: 'Code', type: 'text' },
        { key: 'template_name', label: 'Name', type: 'text' },
        { key: 'output_product_name_snapshot', label: 'Output Product', type: 'text', render: r => r.output_product_name_snapshot || '—' },
        { key: 'standard_output_qty', label: 'Standard Output Qty', type: 'number' },
        { key: 'is_active', label: 'Active', type: 'text', render: r => r.is_active ? 'Yes' : 'No' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📋 BOM Template</span>
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
                <form ref={enterFormRef0} onSubmit={handleSubmit}>
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className="erp-field">
                            <label className="erp-label">Template Name <span className="req">*</span></label>
                            <input className="erp-input" value={form.template_name} onChange={e => setForm({ ...form, template_name: e.target.value })} required />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Output Product <span className="req">*</span></label>
                            <SearchablePopupSelect
                                listKey="bom_output_product_picker"
                                columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                defaultVisibleKeys={['product_name']}
                                items={products} getId={p => p.id} getLabel={p => p.product_name}
                                searchKeys={['product_name', 'product_code']}
                                value={form.output_product_id} onChange={id => setForm({ ...form, output_product_id: id })} placeholder="Select Output Product"
                            />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Standard Output Qty <span className="req">*</span> <span className="hint">(the batch size these proportions assume)</span></label>
                            <input type="number" step="0.0001" className="erp-input" value={form.standard_output_qty} onChange={e => setForm({ ...form, standard_output_qty: e.target.value })} required />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Output UOM</label>
                            <select className="erp-select" value={form.output_uom_id} onChange={e => setForm({ ...form, output_uom_id: e.target.value })}>
                                <option value="">UOM</option>
                                {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                            <div className="erp-field">
                                <label className="erp-label">Description</label>
                                <input className="erp-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Output Relative Value <span className="hint">(for Joint Product allocation)</span></label>
                                <input type="number" step="0.01" className="erp-input" value={form.output_relative_value} onChange={e => setForm({ ...form, output_relative_value: e.target.value })} placeholder="e.g. expected sale rate" />
                            </div>
                            <div className="erp-field justify-end">
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                                    Active
                                </label>
                            </div>
                        </div>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Raw Materials (per Standard Output Qty)</h2>
                        <table className="erp-grid-table mb-2">
                            <thead>
                                <tr><th>Product</th><th>Qty</th><th>UOM</th><th>Process</th><th></th></tr>
                            </thead>
                            <tbody>
                                {form.raw_materials.map((r, idx) => (
                                    <tr key={idx}>
                                        <td>
                                            <SearchablePopupSelect
                                                listKey="bom_rm_product_picker"
                                                columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                defaultVisibleKeys={['product_name']}
                                                items={products} getId={p => p.id} getLabel={p => p.product_name}
                                                searchKeys={['product_name', 'product_code']}
                                                value={r.product_id} onChange={id => updateRawMaterialRow(idx, { product_id: id })} placeholder="Raw Material"
                                            />
                                        </td>
                                        <td><input type="number" step="0.0001" className="erp-input" value={r.qty} onChange={e => updateRawMaterialRow(idx, { qty: e.target.value })} /></td>
                                        <td>
                                            <select className="erp-select" value={r.uom_id} onChange={e => updateRawMaterialRow(idx, { uom_id: e.target.value })}>
                                                <option value="">UOM</option>
                                                {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                            </select>
                                        </td>
                                        <td><input className="erp-input" value={r.process_name} onChange={e => updateRawMaterialRow(idx, { process_name: e.target.value })} placeholder="e.g. Cutting" /></td>
                                        <td><button type="button" tabIndex={-1} onClick={() => removeRawMaterialRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button type="button" onClick={addRawMaterialRow} className="text-xs text-blue-600 mb-4">➕ Add Raw Material</button>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Outputs / By-Products <span className="text-gray-400 normal-case">(a minor scrap by-product, or a genuine Joint Product like "1 chicken → many parts", per Standard Output Qty)</span></h2>
                        <table className="erp-grid-table mb-2">
                            <thead>
                                <tr><th>Product</th><th>Qty</th><th>UOM</th><th>Type</th><th>Recovery Rate / Relative Value</th><th></th></tr>
                            </thead>
                            <tbody>
                                {form.byproducts.map((bp, idx) => {
                                    const isFixed = bp.allocation_basis === 'fixed_recovery';
                                    return (
                                    <tr key={idx}>
                                        <td>
                                            <SearchablePopupSelect
                                                listKey="bom_bp_product_picker"
                                                columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                defaultVisibleKeys={['product_name']}
                                                items={products} getId={p => p.id} getLabel={p => p.product_name}
                                                searchKeys={['product_name', 'product_code']}
                                                value={bp.product_id} onChange={id => updateByproductRow(idx, { product_id: id })} placeholder="Product"
                                            />
                                        </td>
                                        <td><input type="number" step="0.0001" className="erp-input" value={bp.qty} onChange={e => updateByproductRow(idx, { qty: e.target.value })} /></td>
                                        <td>
                                            <select className="erp-select" value={bp.uom_id} onChange={e => updateByproductRow(idx, { uom_id: e.target.value })}>
                                                <option value="">UOM</option>
                                                {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                            </select>
                                        </td>
                                        <td>
                                            <select className="erp-select" value={bp.allocation_basis} onChange={e => updateByproductRow(idx, { allocation_basis: e.target.value })}>
                                                <option value="fixed_recovery">Minor By-Product</option>
                                                <option value="value_wise">Joint Product</option>
                                            </select>
                                        </td>
                                        <td>
                                            {isFixed ? (
                                                <input type="number" step="0.01" className="erp-input" value={bp.recovery_rate} onChange={e => updateByproductRow(idx, { recovery_rate: e.target.value })} placeholder="Recovery Rate" />
                                            ) : (
                                                <input type="number" step="0.01" className="erp-input" value={bp.relative_value} onChange={e => updateByproductRow(idx, { relative_value: e.target.value })} placeholder="Expected Rate" />
                                            )}
                                        </td>
                                        <td><button type="button" tabIndex={-1} onClick={() => removeByproductRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <button type="button" onClick={addByproductRow} className="text-xs text-blue-600">➕ Add By-Product</button>
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

        <div className="max-w-6xl mx-auto px-4 mt-4">
            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="bom_template_grid"
                auditTable="bom_templates"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                        <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>
                    </div>
                )}
            />
        </div>
        </div>
        </Layout>
    );
}
