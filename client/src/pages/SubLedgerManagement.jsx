// =============================================
// SubLedgerManagement.jsx
// Sub Ledger Master - each row is a detailed account rolling up into ONE
// Main Ledger (a control account that has Sub Ledger Mode = Enable or
// Compulsory). Type drives which detail fields show: Agent, Shareholder,
// Employee, Director/Partner, Fixed Asset, Bank Sub-Account, Loan
// Account, or a plain Other with no extra fields.
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

function nameInitials(name) {
    if (!name || !name.trim()) return 'GEN';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'GEN';
}

const emptyForm = {
    short_name: '', sub_ledger_name: '', main_ledger_id: '', sub_ledger_type: 'other',
    agent_id: '', commission_rate: '',
    number_of_shares: '', share_class: 'ordinary', face_value_per_share: '', shareholding_percentage: '', folio_number: '', share_certificate_no: '',
    employee_user_id: '', employee_code_ref: '',
    designation: '', partner_shareholding_percentage: '', din_pan_number: '',
    asset_code: '', asset_purchase_date: '', asset_depreciation_rate: '',
    bank_name: '', bank_branch: '', bank_account_number: '', bank_ifsc_swift: '',
    loan_type: 'unsecured', loan_interest_rate: '', loan_tenure_months: '',
    description: '', display_order: 1
};

const TYPE_OPTIONS = [
    { value: 'other', label: 'Other (no extra details)' },
    { value: 'agent', label: 'Agent' },
    { value: 'shareholder', label: 'Shareholder' },
    { value: 'employee', label: 'Employee' },
    { value: 'director_partner', label: 'Director / Partner' },
    { value: 'fixed_asset', label: 'Fixed Asset' },
    { value: 'bank_sub_account', label: 'Bank Sub-Account' },
    { value: 'loan_account', label: 'Loan Account' }
];

export default function SubLedgerManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [mainLedgers, setMainLedgers] = useState([]);
    const [agents, setAgents] = useState([]);
    const [users, setUsers] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [sl, ml, ag, us] = await Promise.all([
                authFetch('/api/sub-ledgers'),
                authFetch('/api/sub-ledgers/eligible-main-ledgers'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/users?pageSize=200')
            ]);
            setRows(sl.data || []);
            setMainLedgers(ml.data || []);
            setAgents(ag.data || []);
            setUsers(us.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.sub_ledger_name.trim()) return showAlert('Sub Ledger Name is required', 'danger');
        if (!form.main_ledger_id) return showAlert('Main Ledger is required', 'danger');
        try {
            if (editingId) {
                await authFetch(`/api/sub-ledgers/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
                showAlert('Sub-ledger updated', 'success');
            } else {
                await authFetch('/api/sub-ledgers', { method: 'POST', body: JSON.stringify(form) });
                showAlert('Sub-ledger created', 'success');
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
        if (!window.confirm(`Deactivate "${row.sub_ledger_name}"?`)) return;
        try {
            await authFetch(`/api/sub-ledgers/${row.id}`, { method: 'DELETE' });
            showAlert('Sub-ledger deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'sub_ledger_code', label: 'Code', type: 'text' },
        { key: 'sub_ledger_name', label: 'Name', type: 'text' },
        { key: 'sub_ledger_type', label: 'Type', type: 'text' },
        { key: 'main_ledger', label: 'Main Ledger', type: 'text', render: r => r.main_ledger?.account_name || '—' }
    ];

    const type = form.sub_ledger_type;

    return (
        <Layout>
        <div className="max-w-5xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Sub Ledgers</h1>
                <button onClick={() => { resetForm(); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Sub-Ledger'}
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
                <form ref={formRef} onSubmit={handleSubmit} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                    <h2 className="font-semibold text-lg">{editingId ? 'Edit Sub-Ledger' : 'Create New Sub-Ledger'}</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="erp-label">Sub Ledger Name *</label>
                            <input className="erp-input" value={form.sub_ledger_name} onChange={e => setForm({ ...form, sub_ledger_name: e.target.value })} required />
                        </div>
                        <div>
                            <label className="erp-label">Short Name (Alias)</label>
                            <input className="erp-input" value={form.short_name} onChange={e => setForm({ ...form, short_name: e.target.value })}
                                placeholder={!editingId ? `e.g. ${nameInitials(form.sub_ledger_name)}00001 (auto if blank)` : ''} />
                        </div>

                        <div>
                            <label className="erp-label">Code <span className="text-xs text-gray-400">(preview only)</span></label>
                            <input className="erp-input" disabled
                                value={editingId ? (form.sub_ledger_code || '') : 'Auto-generated on save'} />
                        </div>
                        <div>
                            <label className="erp-label">Type</label>
                            <select className="erp-input" value={type} onChange={e => setForm({ ...form, sub_ledger_type: e.target.value })}>
                                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Display Order</label>
                            <input type="number" min="1" className="erp-input" value={form.display_order} onChange={e => setForm({ ...form, display_order: e.target.value })} />
                        </div>

                        <div className="md:col-span-2">
                            <label className="erp-label">Main Ledger * <span className="text-xs text-gray-400">(only ledgers with Sub Ledger Mode = Enable/Compulsory)</span></label>
                            <SearchablePopupSelect
                                listKey="sub_ledger_main_ledger_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }, { key: 'sub_ledger_mode', label: 'Sub Ledger Mode' }]}
                                defaultVisibleKeys={['account_name', 'sub_ledger_mode']}
                                items={mainLedgers}
                                getId={l => l.id}
                                getLabel={l => `${l.account_name} (${l.account_code})`}
                                searchKeys={['account_name', 'account_code']}
                                value={form.main_ledger_id}
                                onChange={id => setForm({ ...form, main_ledger_id: id })}
                                placeholder={mainLedgers.length ? 'Select Main Ledger' : 'No ledgers have Sub Ledger enabled yet'}
                                required
                            />
                        </div>
                    </div>

                    {/* ==================== TYPE-SPECIFIC DETAILS ==================== */}
                    {type === 'agent' && (
                        <div className="border-t pt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Agent Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="erp-label">Agent *</label>
                                    <SearchablePopupSelect
                                        listKey="sub_ledger_agent_picker"
                                        columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                        defaultVisibleKeys={['agent_name']}
                                        items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                        searchKeys={['agent_name', 'agent_code']}
                                        value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })}
                                        placeholder="Select Agent" required
                                    />
                                </div>
                                <div>
                                    <label className="erp-label">Commission Rate %</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.commission_rate} onChange={e => setForm({ ...form, commission_rate: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    )}

                    {type === 'shareholder' && (
                        <div className="border-t pt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Shareholder Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="erp-label">Number of Shares *</label>
                                    <input type="number" className="erp-input" value={form.number_of_shares} onChange={e => setForm({ ...form, number_of_shares: e.target.value })} required />
                                </div>
                                <div>
                                    <label className="erp-label">Share Class</label>
                                    <select className="erp-input" value={form.share_class} onChange={e => setForm({ ...form, share_class: e.target.value })}>
                                        <option value="ordinary">Ordinary</option>
                                        <option value="preference">Preference</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="erp-label">Face Value / Share</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.face_value_per_share} onChange={e => setForm({ ...form, face_value_per_share: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Shareholding %</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.shareholding_percentage} onChange={e => setForm({ ...form, shareholding_percentage: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Folio Number</label>
                                    <input className="erp-input" value={form.folio_number} onChange={e => setForm({ ...form, folio_number: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Share Certificate No.</label>
                                    <input className="erp-input" value={form.share_certificate_no} onChange={e => setForm({ ...form, share_certificate_no: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    )}

                    {type === 'employee' && (
                        <div className="border-t pt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Employee Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="erp-label">Employee *</label>
                                    <SearchablePopupSelect
                                        listKey="sub_ledger_employee_picker"
                                        columns={[{ key: 'full_name', label: 'Name' }, { key: 'email', label: 'Email' }]}
                                        defaultVisibleKeys={['full_name']}
                                        items={users} getId={u => u.id} getLabel={u => u.full_name}
                                        searchKeys={['full_name', 'email']}
                                        value={form.employee_user_id} onChange={id => setForm({ ...form, employee_user_id: id })}
                                        placeholder="Select Employee" required
                                    />
                                </div>
                                <div>
                                    <label className="erp-label">Employee Code Reference</label>
                                    <input className="erp-input" value={form.employee_code_ref} onChange={e => setForm({ ...form, employee_code_ref: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    )}

                    {type === 'director_partner' && (
                        <div className="border-t pt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Director / Partner Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="erp-label">Designation</label>
                                    <input className="erp-input" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Managing Director" />
                                </div>
                                <div>
                                    <label className="erp-label">Shareholding %</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.partner_shareholding_percentage} onChange={e => setForm({ ...form, partner_shareholding_percentage: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">DIN / PAN Number</label>
                                    <input className="erp-input" value={form.din_pan_number} onChange={e => setForm({ ...form, din_pan_number: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    )}

                    {type === 'fixed_asset' && (
                        <div className="border-t pt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Fixed Asset Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="erp-label">Asset Code</label>
                                    <input className="erp-input" value={form.asset_code} onChange={e => setForm({ ...form, asset_code: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Purchase Date</label>
                                    <input type="date" className="erp-input" value={form.asset_purchase_date} onChange={e => setForm({ ...form, asset_purchase_date: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Depreciation Rate %</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.asset_depreciation_rate} onChange={e => setForm({ ...form, asset_depreciation_rate: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    )}

                    {type === 'bank_sub_account' && (
                        <div className="border-t pt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Bank Sub-Account Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="erp-label">Bank Name</label>
                                    <input className="erp-input" value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Branch</label>
                                    <input className="erp-input" value={form.bank_branch} onChange={e => setForm({ ...form, bank_branch: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Account Number *</label>
                                    <input className="erp-input" value={form.bank_account_number} onChange={e => setForm({ ...form, bank_account_number: e.target.value })} required />
                                </div>
                                <div>
                                    <label className="erp-label">IFSC / SWIFT</label>
                                    <input className="erp-input" value={form.bank_ifsc_swift} onChange={e => setForm({ ...form, bank_ifsc_swift: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    )}

                    {type === 'loan_account' && (
                        <div className="border-t pt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Loan Account Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="erp-label">Loan Type</label>
                                    <select className="erp-input" value={form.loan_type} onChange={e => setForm({ ...form, loan_type: e.target.value })}>
                                        <option value="secured">Secured</option>
                                        <option value="unsecured">Unsecured</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="erp-label">Interest Rate %</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.loan_interest_rate} onChange={e => setForm({ ...form, loan_interest_rate: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Tenure (months)</label>
                                    <input type="number" className="erp-input" value={form.loan_tenure_months} onChange={e => setForm({ ...form, loan_tenure_months: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="border-t pt-4">
                        <label className="erp-label">Description</label>
                        <input className="erp-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                            {editingId ? 'Update Sub-Ledger' : 'Create Sub-Ledger'}
                        </button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="sub_ledger_grid"
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
