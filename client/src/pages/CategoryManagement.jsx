// =============================================
// CategoryManagement.jsx
// "Customize Category Banaune Option...Master Maa Tesko product, Ra
// Ledger Both Maa Xa...Typ Filter Pani Dine" - ONE Category master
// page covering both Product Category and Ledger Category (which are
// separate backend tables - product_categories / ledger_categories -
// with an identical shape), unified behind a Type selector so the
// person doesn't need two different pages, plus a Type filter on the
// list.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import Layout from '../components/Layout';

const TYPE_CONFIG = {
    product: { apiBase: 'product-categories', settingBase: 'company/product-category-setting', label: 'Product Category' },
    ledger: { apiBase: 'ledger-categories', settingBase: 'company/ledger-category-setting', label: 'Ledger Category' }
};

const emptyForm = { category_name: '', description: '', display_order: 1 };

export default function CategoryManagement() {
    const { authFetch } = useAuth();
    const enterFormRef0 = useRef(null);
    useEnterKeyNavigation(enterFormRef0);
    const [rows, setRows] = useState({ product: [], ledger: [] });
    const [settings, setSettings] = useState({ product: { enabled: false, label: 'Product Category' }, ledger: { enabled: false, label: 'Ledger Category' } });
    const [typeFilter, setTypeFilter] = useState('all');
    const [showForm, setShowForm] = useState(false);
    const [formType, setFormType] = useState('product');
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [pCats, lCats, pSetting, lSetting] = await Promise.all([
                authFetch('/api/product-categories'),
                authFetch('/api/ledger-categories'),
                authFetch('/api/company/product-category-setting'),
                authFetch('/api/company/ledger-category-setting')
            ]);
            setRows({
                product: (pCats.data || []).map(c => ({ ...c, _type: 'product' })),
                ledger: (lCats.data || []).map(c => ({ ...c, _type: 'ledger' }))
            });
            setSettings({ product: pSetting.data, ledger: lSetting.data });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };

    const handleToggleEnabled = async (type) => {
        const cfg = TYPE_CONFIG[type];
        try {
            await authFetch(`/api/${cfg.settingBase}`, { method: 'PUT', body: JSON.stringify({ enabled: !settings[type].enabled, label: settings[type].label }) });
            showAlert(`${cfg.label} ${!settings[type].enabled ? 'enabled' : 'disabled'}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // The tenant's own name for this category feature (e.g. "Brand",
    // "Customer Type") - used on the master form label and as the
    // Register filter name.
    const handleSaveLabel = async (type) => {
        const cfg = TYPE_CONFIG[type];
        const label = (settings[type].label || '').trim() || cfg.label;
        try {
            await authFetch(`/api/${cfg.settingBase}`, { method: 'PUT', body: JSON.stringify({ enabled: settings[type].enabled, label }) });
            showAlert(`Label saved as "${label}"`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };
    const typeLabel = (type) => settings[type]?.label || TYPE_CONFIG[type].label;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.category_name.trim()) return showAlert('Category name is required', 'danger');
        const cfg = TYPE_CONFIG[formType];
        try {
            if (editingId) {
                await authFetch(`/api/${cfg.apiBase}/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
                showAlert(`${cfg.label} updated`, 'success');
            } else {
                await authFetch(`/api/${cfg.apiBase}`, { method: 'POST', body: JSON.stringify(form) });
                showAlert(`${cfg.label} created`, 'success');
            }
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = (row) => {
        setFormType(row._type);
        setEditingId(row.id);
        setForm({ category_name: row.category_name || '', description: row.description || '', display_order: row.display_order || 1 });
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (row) => {
        const cfg = TYPE_CONFIG[row._type];
        if (!window.confirm(`Remove "${row.category_name}"?`)) return;
        try {
            await authFetch(`/api/${cfg.apiBase}/${row.id}`, { method: 'DELETE' });
            showAlert(`${cfg.label} removed`, 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const allRows = [...rows.product, ...rows.ledger].sort((a, b) => (a.display_order || 1) - (b.display_order || 1));
    const visibleRows = typeFilter === 'all' ? allRows : allRows.filter(r => r._type === typeFilter);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🏷️ Category Management</span>
                <div className="erp-header-actions">
                    <button type="button" onClick={() => { resetForm(); setShowForm(s => !s); }} className={`erp-header-btn ${showForm ? '' : 'primary'}`}>
                        {showForm ? '✕ Close' : '➕ New Category'}
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

            <div className="erp-tab-content">
                {/* Feature enable toggles */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {['product', 'ledger'].map(type => (
                        <div key={type} className="border rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <p className="text-sm font-semibold">{type === 'product' ? 'Product' : 'Ledger (Customer/Supplier & all ledgers)'} Category</p>
                                    <p className="text-xs text-gray-400">{settings[type].enabled ? 'Enabled - shown on the master form and as a Register filter' : 'Disabled - hidden on the master form and in Register filters'}</p>
                                </div>
                                <button type="button" onClick={() => handleToggleEnabled(type)} className={`erp-btn ${settings[type].enabled ? '' : 'primary'}`}>
                                    {settings[type].enabled ? 'Disable' : 'Enable'}
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-500 shrink-0">Display Label:</label>
                                <input className="erp-input" value={settings[type].label || ''} onChange={e => setSettings(s => ({ ...s, [type]: { ...s[type], label: e.target.value } }))} placeholder={TYPE_CONFIG[type].label} />
                                <button type="button" onClick={() => handleSaveLabel(type)} className="erp-btn">Save</button>
                            </div>
                        </div>
                    ))}
                </div>

                {showForm && (
                    <form ref={enterFormRef0} onSubmit={handleSubmit}>
                        <div className="erp-tab-content border rounded-lg mb-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="erp-field">
                                    <label className="erp-label">Type <span className="req">*</span></label>
                                    <select className="erp-select" value={formType} onChange={e => setFormType(e.target.value)} disabled={!!editingId}>
                                        <option value="product">{typeLabel('product')}</option>
                                        <option value="ledger">{typeLabel('ledger')}</option>
                                    </select>
                                </div>
                                <div className="erp-field">
                                    <label className="erp-label">Category Name <span className="req">*</span></label>
                                    <input className="erp-input" value={form.category_name} onChange={e => setForm({ ...form, category_name: e.target.value })} required />
                                </div>
                                <div className="erp-field">
                                    <label className="erp-label">Display Order</label>
                                    <input type="number" className="erp-input" value={form.display_order} onChange={e => setForm({ ...form, display_order: Number(e.target.value) })} />
                                </div>
                                <div className="erp-field md:col-span-3">
                                    <label className="erp-label">Description</label>
                                    <input className="erp-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
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

                <div className="flex items-center gap-2 mb-3">
                    <label className="text-xs font-semibold text-gray-500">Type Filter:</label>
                    <select className="erp-select max-w-xs" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                        <option value="all">All Types</option>
                        <option value="product">{typeLabel('product')}</option>
                        <option value="ledger">{typeLabel('ledger')}</option>
                    </select>
                </div>

                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead>
                            <tr><th>Type</th><th>Code</th><th>Name</th><th>Description</th><th>Order</th><th></th></tr>
                        </thead>
                        <tbody>
                            {visibleRows.map(row => (
                                <tr key={`${row._type}_${row.id}`}>
                                    <td className="text-xs">{typeLabel(row._type)}</td>
                                    <td>{row.category_code}</td>
                                    <td>{row.category_name}</td>
                                    <td className="text-gray-500">{row.description || '—'}</td>
                                    <td>{row.display_order}</td>
                                    <td>
                                        <div className="flex gap-2 justify-center">
                                            <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                            <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {visibleRows.length === 0 && (
                                <tr><td colSpan={6} className="text-center text-gray-400 py-6">No categories yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        </div>
        </Layout>
    );
}
