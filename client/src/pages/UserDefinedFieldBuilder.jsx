// =============================================
// UserDefinedFieldBuilder.jsx
// Define custom fields for any entry module's Master or Detail section.
// Field types: Text, Date, Time, Boolean (Yes/No), Number, or Table
// Reference (pick a value from another master's records).
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

const VOUCHER_TYPES = [
    { value: 'sales_order', label: 'Sales Order' },
    { value: 'sales_delivery', label: 'Sales Delivery (GDN)' },
    { value: 'sales_bill', label: 'Sales Bill' },
    { value: 'sales_return', label: 'Sales Return' },
    { value: 'sales_additional', label: 'Sales Additional Expense' },
    { value: 'purchase_order', label: 'Purchase Order' },
    { value: 'purchase_grn', label: 'Purchase GRN' },
    { value: 'purchase_bill', label: 'Purchase Bill' },
    { value: 'purchase_return', label: 'Purchase Return' },
    { value: 'purchase_additional', label: 'Purchase Additional Expense' },
    { value: 'journal', label: 'Journal Voucher' },
    { value: 'cash', label: 'Cash Voucher' },
    { value: 'bank', label: 'Bank Voucher' },
    { value: 'pdc', label: 'PDC (Post-Dated Cheque)' },
    { value: 'production', label: 'Production Entry' }
];
const FIELD_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'date', label: 'Date' },
    { value: 'time', label: 'Time' },
    { value: 'boolean', label: 'Boolean (Yes/No)' },
    { value: 'number', label: 'Number' },
    { value: 'table_reference', label: 'Table Reference (pick from a list)' }
];

const emptyForm = { field_label: '', field_type: 'text', reference_table: '', reference_display_field: '', display_order: 1 };

export default function UserDefinedFieldBuilder() {
    const { authFetch } = useAuth();
    const [voucherType, setVoucherType] = useState('sales_bill');
    const [section, setSection] = useState('master');
    const [fields, setFields] = useState([]);
    const [referenceTables, setReferenceTables] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [f, rt] = await Promise.all([
                authFetch(`/api/user-defined-fields?voucher_type=${voucherType}&section=${section}`),
                authFetch('/api/user-defined-fields/reference-tables')
            ]);
            setFields(f.data || []);
            setReferenceTables(rt.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch, voucherType, section]);
    useEffect(() => { load(); }, [load]);

    const currentTableMeta = referenceTables.find(t => t.table === form.reference_table);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.field_label.trim()) return showAlert('Field Label is required', 'danger');
        if (form.field_type === 'table_reference' && !form.reference_table) return showAlert('Pick which table this field references', 'danger');
        try {
            await authFetch('/api/user-defined-fields', {
                method: 'POST',
                body: JSON.stringify({ ...form, voucher_type: voucherType, section })
            });
            showAlert('Custom field created', 'success');
            setForm(emptyForm);
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDelete = async (field) => {
        if (!window.confirm(`Remove "${field.field_label}"?`)) return;
        try {
            await authFetch(`/api/user-defined-fields/${field.id}`, { method: 'DELETE' });
            showAlert('Removed', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    return (
        <Layout>
        <div className="max-w-3xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-1">User Defined Fields</h1>
            <p className="text-xs text-gray-400 mb-4">
                Add custom fields to any entry module's Master (header) or Detail
                (line item) section, without needing a code change. Table Reference
                fields let you pick a value from another master's records (e.g. a
                custom field that looks up a Ledger Account).
            </p>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <label className="erp-label">Module</label>
                    <select className="erp-input" value={voucherType} onChange={e => setVoucherType(e.target.value)}>
                        {VOUCHER_TYPES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                </div>
                <div>
                    <label className="erp-label">Section</label>
                    <select className="erp-input" value={section} onChange={e => setSection(e.target.value)}>
                        <option value="master">Master</option>
                        <option value="detail">Detail</option>
                    </select>
                </div>
            </div>

            <div className="flex justify-end mb-3">
                <button onClick={() => { setForm(emptyForm); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Custom Field'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleSubmit} ref={formRef} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                    <div>
                        <label className="erp-label">Field Label *</label>
                        <input className="erp-input" value={form.field_label} onChange={e => setForm({ ...form, field_label: e.target.value })} required />
                    </div>
                    <div>
                        <label className="erp-label">Field Type *</label>
                        <select className="erp-input" value={form.field_type} onChange={e => setForm({ ...form, field_type: e.target.value, reference_table: '', reference_display_field: '' })}>
                            {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                    </div>

                    {form.field_type === 'table_reference' && (
                        <div className="grid grid-cols-2 gap-4 bg-gray-50 border rounded-lg p-4">
                            <div>
                                <label className="erp-label">Which Table *</label>
                                <select className="erp-input" value={form.reference_table} onChange={e => setForm({ ...form, reference_table: e.target.value, reference_display_field: '' })}>
                                    <option value="">Select table</option>
                                    {referenceTables.map(t => <option key={t.table} value={t.table}>{t.table}</option>)}
                                </select>
                            </div>
                            {currentTableMeta && (
                                <div>
                                    <label className="erp-label">Display Field</label>
                                    <select className="erp-input" value={form.reference_display_field || currentTableMeta.labelField} onChange={e => setForm({ ...form, reference_display_field: e.target.value })}>
                                        {currentTableMeta.allowedDisplayFields.map(f => <option key={f} value={f}>{f}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="max-w-xs">
                        <label className="erp-label">Display Order</label>
                        <input type="number" min="1" className="erp-input" value={form.display_order} onChange={e => setForm({ ...form, display_order: e.target.value })} />
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { setForm(emptyForm); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">Create Field</button>
                    </div>
                </form>
            )}

            <div className="bg-white border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Label</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Reference</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {fields.map(f => (
                            <tr key={f.id} className="border-t border-gray-100">
                                <td className="px-3 py-1.5">{f.field_label}</td>
                                <td className="px-3 py-1.5 text-xs text-gray-500">{FIELD_TYPES.find(t => t.value === f.field_type)?.label}</td>
                                <td className="px-3 py-1.5 text-xs text-gray-500">{f.field_type === 'table_reference' ? `${f.reference_table} (${f.reference_display_field})` : '—'}</td>
                                <td className="px-3 py-1.5"><button onClick={() => handleDelete(f)} className="text-xs text-red-600 hover:underline">Remove</button></td>
                            </tr>
                        ))}
                        {fields.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-gray-400 text-sm">No custom fields on this module/section yet.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
        </Layout>
    );
}
