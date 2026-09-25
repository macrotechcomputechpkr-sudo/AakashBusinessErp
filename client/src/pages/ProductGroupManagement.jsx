// =============================================
// ProductGroupManagement.jsx
// Two tabs: Product Groups (hierarchical, type-driven depreciation
// fields) and Product Companies (manufacturer/brand with default
// vendor/area/product-group/agent). Follows the same conventions as
// every other master page in this app: Enter-key navigation,
// SearchablePopupSelect for pickers, backend-connected throughout.
//
// NOTE on Billing Term: if a product group's default discount is
// non-zero, a billing_term_id is required (enforced by the backend and
// a DB CHECK constraint). The Billing Term module now exists
// (pages/BillingTermManagement.jsx) - this uses a real
// SearchablePopupSelect against it, same as Area/Route/Agent.
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import SearchablePopupSelect from '../components/SearchablePopupSelect';

const emptyGroupForm = {
    group_name: '', parent_group_id: '', product_type: '',
    depreciation_method: '', depreciation_rate: '',
    default_discount_percentage: 0, default_profit_margin_percentage: 0, billing_term_id: '',
    print_barcode: true, allow_rate_change_on_mobile_order: false, description: '',
    is_branch_wise: false, branch_id: ''
};

const emptyCompanyForm = {
    company_name: '', default_vendor_id: '', default_area_id: '', default_product_group_id: '', default_agent_id: '', default_sub_ledger_id: '',
    print_barcode: true, allow_rate_change_on_mobile_order: false, description: ''
};

export default function ProductGroupManagement() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState('groups');
    const [alert, setAlert] = useState(null);
    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const [groups, setGroups] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [areas, setAreas] = useState([]);
    const [agents, setAgents] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [billingTerms, setBillingTerms] = useState([]);
    const [sysControl, setSysControl] = useState(null);
    const [branches, setBranches] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);

    const [showGroupForm, setShowGroupForm] = useState(false);
    const [groupForm, setGroupForm] = useState(emptyGroupForm);
    const [editingGroupId, setEditingGroupId] = useState(null);
    const groupFormRef = useRef(null);
    useEnterKeyNavigation(groupFormRef);

    const [showCompanyForm, setShowCompanyForm] = useState(false);
    const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
    const [editingCompanyId, setEditingCompanyId] = useState(null);
    const companyFormRef = useRef(null);
    useEnterKeyNavigation(companyFormRef);

    const load = useCallback(async () => {
        try {
            const [g, c, a, s, v1, v2, bt, sc, br, sl] = await Promise.all([
                authFetch('/api/product-groups'),
                authFetch('/api/product-companies'),
                authFetch('/api/areas'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=purchase'),
                // FIX: a ledger tagged 'both' (customer AND supplier) is a
                // valid vendor too, but the exact-match filter alone
                // (category_type=purchase) missed it - same fix pattern
                // already used correctly in RouteSequencing.jsx.
                authFetch('/api/ledger-accounts?pageSize=200&category_type=both'),
                authFetch('/api/billing-terms'),
                authFetch('/api/system-control'),
                authFetch('/api/branches'),
                authFetch('/api/sub-ledgers')
            ]);
            setGroups(g.data || []);
            setCompanies(c.data || []);
            setAreas(a.data || []);
            setAgents(s.data || []);
            setVendors([...(v1.data || []), ...(v2.data || [])]);
            setBillingTerms(bt.data || []);
            setSysControl(sc.data);
            setBranches(br.data || []);
            setSubLedgers(sl.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);

    useEffect(() => { load(); }, [load]);

    const resetGroupForm = () => { setGroupForm(emptyGroupForm); setEditingGroupId(null); };

    const handleGroupSubmit = async (e) => {
        e.preventDefault();
        if (!groupForm.group_name.trim()) return showAlert('Group name is required', 'danger');
        if (!groupForm.product_type) return showAlert('Product type is required', 'danger');
        if (groupForm.product_type === 'asset' && (!groupForm.depreciation_method || groupForm.depreciation_rate === '')) {
            return showAlert('Depreciation method and rate are required for an Asset group', 'danger');
        }
        if ((Number(groupForm.default_discount_percentage) || 0) !== 0 && !groupForm.billing_term_id) {
            return showAlert('A non-zero default discount requires a Billing Term reference', 'danger');
        }
        if (groupForm.is_branch_wise && !groupForm.branch_id) {
            return showAlert('A Branch is required when this group is Branch Wise', 'danger');
        }
        try {
            if (editingGroupId) {
                await authFetch(`/api/product-groups/${editingGroupId}`, { method: 'PUT', body: JSON.stringify(groupForm) });
                showAlert('Product group updated', 'success');
            } else {
                await authFetch('/api/product-groups', { method: 'POST', body: JSON.stringify(groupForm) });
                showAlert('Product group created', 'success');
            }
            resetGroupForm();
            setShowGroupForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEditGroup = (row) => {
        setEditingGroupId(row.id);
        setGroupForm({ ...emptyGroupForm, ...row });
        setShowGroupForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteGroup = async (row) => {
        if (!window.confirm(`Deactivate "${row.group_name}"?`)) return;
        try {
            await authFetch(`/api/product-groups/${row.id}`, { method: 'DELETE' });
            showAlert('Product group deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const groupColumns = [
        { key: 'group_code', label: 'Code', type: 'text' },
        { key: 'group_name', label: 'Name', type: 'text' },
        { key: 'product_type', label: 'Type', type: 'text', render: (r) => <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700">{r.product_type}</span> },
        { key: 'depreciation_method', label: 'Depreciation', type: 'text', render: (r) => r.product_type === 'asset' ? `${r.depreciation_method || '—'} @ ${r.depreciation_rate || 0}%` : '—' },
        { key: 'default_discount_percentage', label: 'Disc %', type: 'number' },
        { key: 'default_profit_margin_percentage', label: 'Margin %', type: 'number' },
        { key: 'print_barcode', label: 'Barcode', type: 'text', render: (r) => r.print_barcode ? '✅' : '❌' }
    ];

    const resetCompanyForm = () => { setCompanyForm(emptyCompanyForm); setEditingCompanyId(null); };

    const handleCompanySubmit = async (e) => {
        e.preventDefault();
        if (!companyForm.company_name.trim()) return showAlert('Company name is required', 'danger');
        try {
            if (editingCompanyId) {
                await authFetch(`/api/product-companies/${editingCompanyId}`, { method: 'PUT', body: JSON.stringify(companyForm) });
                showAlert('Product company updated', 'success');
            } else {
                await authFetch('/api/product-companies', { method: 'POST', body: JSON.stringify(companyForm) });
                showAlert('Product company created', 'success');
            }
            resetCompanyForm();
            setShowCompanyForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEditCompany = (row) => {
        setEditingCompanyId(row.id);
        setCompanyForm({ ...emptyCompanyForm, ...row });
        setShowCompanyForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteCompany = async (row) => {
        if (!window.confirm(`Deactivate "${row.company_name}"?`)) return;
        try {
            await authFetch(`/api/product-companies/${row.id}`, { method: 'DELETE' });
            showAlert('Product company deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const companyColumns = [
        { key: 'company_code', label: 'Code', type: 'text' },
        { key: 'company_name', label: 'Name', type: 'text' },
        { key: 'default_vendor', label: 'Default Vendor', type: 'text', render: (r) => r.default_vendor?.account_name || '—' },
        { key: 'default_area', label: 'Default Area', type: 'text', render: (r) => r.default_area?.area_name || '—' },
        { key: 'default_product_group', label: 'Default Product Group', type: 'text', render: (r) => r.default_product_group?.group_name || '—' },
        { key: 'default_agent', label: 'Default Agent', type: 'text', render: (r) => r.default_agent?.agent_name || '—' },
        { key: 'print_barcode', label: 'Barcode', type: 'text', render: (r) => r.print_barcode ? '✅' : '❌' }
    ];

    return (
        <Layout>
        <div className="max-w-6xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Product Groups & Companies</h1>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="flex gap-2 mb-4 border-b">
                <button onClick={() => setTab('groups')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'groups' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Product Groups</button>
                <button onClick={() => setTab('companies')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'companies' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Product Companies</button>
            </div>

            {tab === 'groups' && (
                <>
                    <div className="flex justify-end mb-3">
                        <button onClick={() => { resetGroupForm(); setShowGroupForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                            {showGroupForm ? 'Close' : '➕ New Product Group'}
                        </button>
                    </div>

                    {showGroupForm && (
                        <form ref={groupFormRef} onSubmit={handleGroupSubmit} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="erp-label">Group Name *</label>
                                    <input className="erp-input" value={groupForm.group_name}
                                        onChange={e => setGroupForm({ ...groupForm, group_name: e.target.value })} required />
                                </div>

                                <div>
                                    <label className="erp-label">Parent Group (optional, like Area's Main Area)</label>
                                    <SearchablePopupSelect
                                        listKey="product_group_parent_picker"
                                        columns={[{ key: 'group_code', label: 'Code' }, { key: 'group_name', label: 'Name' }, { key: 'product_type', label: 'Type' }]}
                                        defaultVisibleKeys={['group_name', 'product_type']}
                                        items={groups.filter(g => g.id !== editingGroupId)}
                                        getId={(g) => g.id} getLabel={(g) => g.group_name}
                                        searchKeys={['group_name', 'group_code']}
                                        value={groupForm.parent_group_id}
                                        onChange={(id) => setGroupForm({ ...groupForm, parent_group_id: id })}
                                        placeholder="None (top-level group)"
                                    />
                                </div>

                                <div>
                                    <label className="erp-label">Product Type *</label>
                                    <select className="erp-input" value={groupForm.product_type}
                                        onChange={e => setGroupForm({ ...groupForm, product_type: e.target.value })} required>
                                        <option value="">Select type</option>
                                        <option value="asset">Asset</option>
                                        <option value="service">Service</option>
                                        <option value="inventory">Inventory</option>
                                    </select>
                                </div>

                                {groupForm.product_type === 'asset' && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="erp-label">Depreciation Method *</label>
                                            <select className="erp-input" value={groupForm.depreciation_method}
                                                onChange={e => setGroupForm({ ...groupForm, depreciation_method: e.target.value })} required>
                                                <option value="">Select</option>
                                                <option value="straight_line">Straight Line</option>
                                                <option value="written_down_value">Written Down Value</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="erp-label">Depreciation Rate % *</label>
                                            <input type="number" step="0.01" className="erp-input" value={groupForm.depreciation_rate}
                                                onChange={e => setGroupForm({ ...groupForm, depreciation_rate: e.target.value })} required />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="erp-label">Default Discount %</label>
                                    <input type="number" step="0.01" className="erp-input" value={groupForm.default_discount_percentage}
                                        onChange={e => setGroupForm({ ...groupForm, default_discount_percentage: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Default Profit Margin %</label>
                                    <input type="number" step="0.01" className="erp-input" value={groupForm.default_profit_margin_percentage}
                                        onChange={e => setGroupForm({ ...groupForm, default_profit_margin_percentage: e.target.value })} />
                                </div>

                                {(Number(groupForm.default_discount_percentage) || 0) !== 0 && (
                                    <div className="md:col-span-2">
                                        <label className="erp-label">Billing Term *</label>
                                        <SearchablePopupSelect
                                            listKey="billing_term_picker"
                                            columns={[{ key: 'term_code', label: 'Code' }, { key: 'term_name', label: 'Name' }, { key: 'calculation_mode', label: 'Mode' }]}
                                            defaultVisibleKeys={['term_name', 'calculation_mode']}
                                            items={billingTerms}
                                            getId={t => t.id}
                                            getLabel={t => `${t.term_name} (${t.term_code})`}
                                            searchKeys={['term_name', 'term_code']}
                                            value={groupForm.billing_term_id}
                                            onChange={id => setGroupForm({ ...groupForm, billing_term_id: id })}
                                            placeholder="Select Billing Term"
                                            required
                                        />
                                    </div>
                                )}

                                <div className="md:col-span-2 flex gap-6 border-t pt-4">
                                    {sysControl?.enable_barcode_print && (
                                        <label className="flex items-center gap-2 text-sm">
                                            <input type="checkbox" checked={groupForm.print_barcode} onChange={e => setGroupForm({ ...groupForm, print_barcode: e.target.checked })} />
                                            Print Barcode
                                        </label>
                                    )}
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={groupForm.allow_rate_change_on_mobile_order} onChange={e => setGroupForm({ ...groupForm, allow_rate_change_on_mobile_order: e.target.checked })} />
                                        Allow Rate Change on Mobile Order
                                    </label>
                                    {sysControl?.enable_branch_wise_master && (
                                        <label className="flex items-center gap-2 text-sm">
                                            <input type="checkbox" checked={groupForm.is_branch_wise} onChange={e => setGroupForm({ ...groupForm, is_branch_wise: e.target.checked, branch_id: e.target.checked ? groupForm.branch_id : '' })} />
                                            Branch Wise
                                        </label>
                                    )}
                                </div>

                                {sysControl?.enable_branch_wise_master && groupForm.is_branch_wise && (
                                    <div className="md:col-span-2">
                                        <label className="erp-label">Branch *</label>
                                        <SearchablePopupSelect
                                            listKey="product_group_branch_picker"
                                            columns={[{ key: 'branch_code', label: 'Code' }, { key: 'branch_name', label: 'Name' }]}
                                            defaultVisibleKeys={['branch_name']}
                                            items={branches} getId={b => b.id} getLabel={b => b.branch_name}
                                            searchKeys={['branch_name', 'branch_code']}
                                            value={groupForm.branch_id} onChange={id => setGroupForm({ ...groupForm, branch_id: id })}
                                            placeholder="Select Branch" required
                                        />
                                    </div>
                                )}

                                <div className="md:col-span-2">
                                    <label className="erp-label">Description</label>
                                    <input className="erp-input" value={groupForm.description}
                                        onChange={e => setGroupForm({ ...groupForm, description: e.target.value })} />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 border-t pt-4">
                                <button type="button" onClick={() => { resetGroupForm(); setShowGroupForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                                    {editingGroupId ? 'Update Product Group' : 'Create Product Group'}
                                </button>
                            </div>
                        </form>
                    )}

                    <ReportGrid
                        columns={groupColumns}
                        rows={groups}
                        getId={(r) => r.id}
                        storageKey="product_group_grid"
                auditTable="product_groups"
                        rowActions={(row) => (
                            <div className="flex gap-2 justify-center">
                                <button onClick={() => handleEditGroup(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                <button onClick={() => handleDeleteGroup(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>
                            </div>
                        )}
                    />
                </>
            )}

            {tab === 'companies' && (
                <>
                    <div className="flex justify-end mb-3">
                        <button onClick={() => { resetCompanyForm(); setShowCompanyForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                            {showCompanyForm ? 'Close' : '➕ New Product Company'}
                        </button>
                    </div>

                    {showCompanyForm && (
                        <form ref={companyFormRef} onSubmit={handleCompanySubmit} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="erp-label">Company Name * <span className="text-xs text-gray-400">(manufacturer/brand)</span></label>
                                    <input className="erp-input" value={companyForm.company_name}
                                        onChange={e => setCompanyForm({ ...companyForm, company_name: e.target.value })} required />
                                </div>

                                <div>
                                    <label className="erp-label">Default Vendor <span className="text-xs text-gray-400">(a Purchase ledger)</span></label>
                                    <SearchablePopupSelect
                                        listKey="default_vendor_picker"
                                        columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                        defaultVisibleKeys={['account_name']}
                                        items={vendors} getId={(v) => v.id} getLabel={(v) => v.account_name}
                                        searchKeys={['account_name', 'account_code']}
                                        value={companyForm.default_vendor_id}
                                        onChange={(id) => setCompanyForm({ ...companyForm, default_vendor_id: id })}
                                        placeholder="Select default vendor"
                                    />
                                </div>

                                <div>
                                    <label className="erp-label">Default Area</label>
                                    <SearchablePopupSelect
                                        listKey="area_picker"
                                        columns={[{ key: 'area_code', label: 'Code' }, { key: 'area_name', label: 'Name' }]}
                                        defaultVisibleKeys={['area_name']}
                                        items={areas} getId={(a) => a.id} getLabel={(a) => a.area_name}
                                        searchKeys={['area_name', 'area_code']}
                                        value={companyForm.default_area_id}
                                        onChange={(id) => setCompanyForm({ ...companyForm, default_area_id: id })}
                                        placeholder="Select default area"
                                    />
                                </div>

                                <div>
                                    <label className="erp-label">Default Product Group</label>
                                    <SearchablePopupSelect
                                        listKey="product_group_parent_picker"
                                        columns={[{ key: 'group_code', label: 'Code' }, { key: 'group_name', label: 'Name' }]}
                                        defaultVisibleKeys={['group_name']}
                                        items={groups} getId={(g) => g.id} getLabel={(g) => g.group_name}
                                        searchKeys={['group_name', 'group_code']}
                                        value={companyForm.default_product_group_id}
                                        onChange={(id) => setCompanyForm({ ...companyForm, default_product_group_id: id })}
                                        placeholder="Select default product group"
                                    />
                                </div>

                                <div>
                                    <label className="erp-label">Default Agent</label>
                                    <SearchablePopupSelect
                                        listKey="salesman_picker"
                                        columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                        defaultVisibleKeys={['agent_name']}
                                        items={agents} getId={(a) => a.id} getLabel={(a) => a.agent_name}
                                        searchKeys={['agent_name', 'agent_code']}
                                        value={companyForm.default_agent_id}
                                        onChange={(id) => setCompanyForm({ ...companyForm, default_agent_id: id })}
                                        placeholder="Select default agent"
                                    />
                                </div>

                                <div>
                                    <label className="erp-label">Preferred Sub-Ledger</label>
                                    <SearchablePopupSelect
                                        listKey="product_company_sub_ledger_picker"
                                        columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                        defaultVisibleKeys={['sub_ledger_name']}
                                        items={subLedgers} getId={(s) => s.id} getLabel={(s) => s.sub_ledger_name}
                                        searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                        value={companyForm.default_sub_ledger_id}
                                        onChange={(id) => setCompanyForm({ ...companyForm, default_sub_ledger_id: id })}
                                        placeholder="Select preferred sub-ledger"
                                    />
                                </div>

                                <div className="md:col-span-2 flex gap-6 border-t pt-4">
                                    {sysControl?.enable_barcode_print && (
                                        <label className="flex items-center gap-2 text-sm">
                                            <input type="checkbox" checked={companyForm.print_barcode} onChange={e => setCompanyForm({ ...companyForm, print_barcode: e.target.checked })} />
                                            Print Barcode
                                        </label>
                                    )}
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={companyForm.allow_rate_change_on_mobile_order} onChange={e => setCompanyForm({ ...companyForm, allow_rate_change_on_mobile_order: e.target.checked })} />
                                        Allow Rate Change on Mobile Order
                                    </label>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="erp-label">Description</label>
                                    <input className="erp-input" value={companyForm.description}
                                        onChange={e => setCompanyForm({ ...companyForm, description: e.target.value })} />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 border-t pt-4">
                                <button type="button" onClick={() => { resetCompanyForm(); setShowCompanyForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                                    {editingCompanyId ? 'Update Product Company' : 'Create Product Company'}
                                </button>
                            </div>
                        </form>
                    )}

                    <ReportGrid
                        columns={companyColumns}
                        rows={companies}
                        getId={(r) => r.id}
                        storageKey="product_company_grid"
                auditTable="product_companies"
                        rowActions={(row) => (
                            <div className="flex gap-2 justify-center">
                                <button onClick={() => handleEditCompany(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                <button onClick={() => handleDeleteCompany(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>
                            </div>
                        )}
                    />
                </>
            )}
        </div>
        </Layout>
    );
}
