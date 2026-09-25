// =============================================
// EntryFieldControl.jsx
// Per-field control (Enabled/Disabled/Compulsory/ReadOnly) for every
// voucher type's Master+Detail fields, settable Globally or overridden
// per User Group / per User. See database/19_entry_field_control_schema.sql
// for the full field catalog and research notes (Tally/NAV/FACT/Busy).
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';

const VOUCHER_TYPES = [
    { value: 'purchase_requisition', label: 'Purchase Requisition' },
    { value: 'purchase_quotation', label: 'Purchase Quotation' },
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
const MODES = [
    { value: 'enabled', label: 'Enabled' },
    { value: 'disabled', label: 'Disabled' },
    { value: 'compulsory', label: 'Compulsory' },
    { value: 'readonly', label: 'Read Only' }
];

export default function EntryFieldControl() {
    const { authFetch } = useAuth();
    const enterAreaRef = useRef(null);
    useEnterKeyNavigation(enterAreaRef);
    const [voucherType, setVoucherType] = useState('purchase_requisition');
    const [catalog, setCatalog] = useState([]);
    const [controls, setControls] = useState([]);
    const [securityGroups, setSecurityGroups] = useState([]);
    const [users, setUsers] = useState([]);
    const [overridingField, setOverridingField] = useState(null); // field_key currently adding an override for
    const [overrideScope, setOverrideScope] = useState('user_group');
    const [overrideTarget, setOverrideTarget] = useState('');
    const [overrideMode, setOverrideMode] = useState('enabled');
    const [alert, setAlert] = useState(null);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [cat, ctl, sg, us] = await Promise.all([
                authFetch(`/api/voucher-field-catalog?voucher_type=${voucherType}`),
                authFetch(`/api/entry-field-controls?voucher_type=${voucherType}`),
                authFetch('/api/security-groups'),
                authFetch('/api/users?pageSize=200')
            ]);
            setCatalog(cat.data || []);
            setControls(ctl.data || []);
            setSecurityGroups(sg.data || []);
            setUsers(us.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch, voucherType]);
    useEffect(() => { load(); }, [load]);

    const globalModeFor = (fieldKey) => {
        const rule = controls.find(c => c.scope === 'global' && c.field_key === fieldKey);
        return rule ? rule.mode : 'enabled';
    };
    const overridesFor = (fieldKey) => controls.filter(c => c.scope !== 'global' && c.field_key === fieldKey);

    const saveGlobalMode = async (field, mode) => {
        if (field.is_system_required && mode === 'disabled') {
            return showAlert(`"${field.field_label}" is a required system field and cannot be disabled`, 'danger');
        }
        try {
            await authFetch('/api/entry-field-controls', {
                method: 'POST',
                body: JSON.stringify({ voucher_type: voucherType, field_key: field.field_key, scope: 'global', mode })
            });
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const saveOverride = async (field) => {
        if (!overrideTarget) return showAlert('Pick a User Group or User first', 'danger');
        try {
            await authFetch('/api/entry-field-controls', {
                method: 'POST',
                body: JSON.stringify({
                    voucher_type: voucherType, field_key: field.field_key, scope: overrideScope,
                    user_group_id: overrideScope === 'user_group' ? overrideTarget : undefined,
                    user_id: overrideScope === 'user' ? overrideTarget : undefined,
                    mode: overrideMode
                })
            });
            setOverridingField(null);
            setOverrideTarget('');
            load();
            showAlert('Override saved', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const removeOverride = async (id) => {
        try {
            await authFetch(`/api/entry-field-controls/${id}`, { method: 'DELETE' });
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const master = catalog.filter(f => f.section === 'master');
    const detail = catalog.filter(f => f.section === 'detail');

    const renderFieldRow = (field) => {
        const globalMode = globalModeFor(field.field_key);
        const overrides = overridesFor(field.field_key);
        return (
            <div key={field.field_key} className="border-b border-gray-100 py-3">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[180px]">
                        <span className="text-sm font-medium">{field.field_label}</span>
                        {field.is_system_required && <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase">System</span>}
                        <span className="ml-2 text-xs text-gray-400">{field.field_data_type}</span>
                    </div>
                    <select
                        className="border rounded-lg px-2 py-1.5 text-sm"
                        value={globalMode}
                        onChange={e => saveGlobalMode(field, e.target.value)}
                    >
                        {MODES.map(m => <option key={m.value} value={m.value} disabled={field.is_system_required && m.value === 'disabled'}>{m.label}</option>)}
                    </select>
                    <button onClick={() => { setOverridingField(field.field_key); setOverrideTarget(''); setOverrideScope('user_group'); setOverrideMode('enabled'); }} className="text-xs text-blue-600 hover:underline">+ Add Override</button>
                </div>

                {overrides.length > 0 && (
                    <div className="mt-2 ml-2 space-y-1">
                        {overrides.map(o => (
                            <div key={o.id} className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                                <span className="font-medium">{o.scope === 'user_group' ? `Group: ${o.user_group?.group_name || o.user_group_id}` : `User: ${users.find(u => u.id === o.user_id)?.full_name || o.user_id}`}</span>
                                <span>→ {MODES.find(m => m.value === o.mode)?.label}</span>
                                <button onClick={() => removeOverride(o.id)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
                            </div>
                        ))}
                    </div>
                )}

                {overridingField === field.field_key && (
                    <div className="mt-2 ml-2 flex flex-wrap items-end gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Scope</label>
                            <select className="border rounded px-2 py-1.5 text-sm" value={overrideScope} onChange={e => { setOverrideScope(e.target.value); setOverrideTarget(''); }}>
                                <option value="user_group">User Group</option>
                                <option value="user">User</option>
                            </select>
                        </div>
                        <div className="min-w-[180px]">
                            <label className="block text-xs text-gray-500 mb-1">{overrideScope === 'user_group' ? 'Which Group' : 'Which User'}</label>
                            {overrideScope === 'user_group' ? (
                                <SearchablePopupSelect
                                    listKey="efc_group_picker"
                                    columns={[{ key: 'group_name', label: 'Name' }]}
                                    defaultVisibleKeys={['group_name']}
                                    items={securityGroups} getId={g => g.id} getLabel={g => g.group_name}
                                    searchKeys={['group_name']}
                                    value={overrideTarget} onChange={setOverrideTarget}
                                    placeholder="Select group"
                                />
                            ) : (
                                <SearchablePopupSelect
                                    listKey="efc_user_picker"
                                    columns={[{ key: 'full_name', label: 'Name' }]}
                                    defaultVisibleKeys={['full_name']}
                                    items={users} getId={u => u.id} getLabel={u => u.full_name}
                                    searchKeys={['full_name']}
                                    value={overrideTarget} onChange={setOverrideTarget}
                                    placeholder="Select user"
                                />
                            )}
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Mode</label>
                            <select className="border rounded px-2 py-1.5 text-sm" value={overrideMode} onChange={e => setOverrideMode(e.target.value)}>
                                {MODES.map(m => <option key={m.value} value={m.value} disabled={field.is_system_required && m.value === 'disabled'}>{m.label}</option>)}
                            </select>
                        </div>
                        <button onClick={() => saveOverride(field)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">Save</button>
                        <button onClick={() => setOverridingField(null)} className="px-3 py-1.5 border rounded-lg text-sm">Cancel</button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <Layout>
        <div ref={enterAreaRef} className="max-w-5xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Entry Field Control</h1>
            <p className="text-xs text-gray-400 mb-4">
                Choose a voucher type, then set each field's default mode (applies to
                everyone), or add a User Group / User-specific override. Priority when
                a person actually enters a voucher: their own User override, then their
                User Group's override, then this Global default.
            </p>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Voucher Type</label>
                <select className="border rounded-lg px-3 py-2 min-w-[260px]" value={voucherType} onChange={e => setVoucherType(e.target.value)}>
                    {VOUCHER_TYPES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
            </div>

            <div className="bg-white border rounded-xl p-6 mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Master Fields</p>
                {master.length === 0 ? <p className="text-xs text-gray-400">No fields.</p> : master.map(renderFieldRow)}
            </div>

            <div className="bg-white border rounded-xl p-6">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Detail (Line Item) Fields</p>
                {detail.length === 0 ? <p className="text-xs text-gray-400">No fields.</p> : detail.map(renderFieldRow)}
            </div>
        </div>
        </Layout>
    );
}
