// =============================================
// CostProfitCenters.jsx
// FIX: server/routes/chartOfAccountsRoutes.js had GET/POST for
// cost-centers and profit-centers since early on, but no frontend page
// ever consumed them - added PUT/DELETE there too for full CRUD, plus
// this page.
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

function nameInitials(name) {
    if (!name || !name.trim()) return 'GEN';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'GEN';
}

const emptyCostForm = {
    cost_center_name: '', cost_center_short_name: '', cost_center_type: 'department', nfrs_allocation_basis: '',
    allocation_percentage: 100, annual_budget: 0, monthly_budget: 0,
    responsible_person: '', responsible_person_phone: '', responsible_person_email: '', description: ''
};
const emptyProfitForm = {
    profit_center_name: '', profit_center_short_name: '', profit_center_type: 'division',
    annual_target: 0, quarterly_target: 0, monthly_target: 0,
    responsible_person: '', responsible_person_phone: '', responsible_person_email: '', description: ''
};

export default function CostProfitCenters() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState('cost');
    const [alert, setAlert] = useState(null);
    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const [costCenters, setCostCenters] = useState([]);
    const [profitCenters, setProfitCenters] = useState([]);

    const [showCostForm, setShowCostForm] = useState(false);
    const [costForm, setCostForm] = useState(emptyCostForm);
    const [editingCostId, setEditingCostId] = useState(null);
    const costFormRef = useRef(null);
    useEnterKeyNavigation(costFormRef);

    const [showProfitForm, setShowProfitForm] = useState(false);
    const [profitForm, setProfitForm] = useState(emptyProfitForm);
    const [editingProfitId, setEditingProfitId] = useState(null);
    const profitFormRef = useRef(null);
    useEnterKeyNavigation(profitFormRef);

    const load = useCallback(async () => {
        try {
            const [c, p] = await Promise.all([authFetch('/api/cost-centers'), authFetch('/api/profit-centers')]);
            setCostCenters(c.data || []);
            setProfitCenters(p.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetCostForm = () => { setCostForm(emptyCostForm); setEditingCostId(null); };
    const handleCostSubmit = async (e) => {
        e.preventDefault();
        if (!costForm.cost_center_name.trim()) return showAlert('Cost center name is required', 'danger');
        try {
            if (editingCostId) {
                await authFetch(`/api/cost-centers/${editingCostId}`, { method: 'PUT', body: JSON.stringify(costForm) });
                showAlert('Cost center updated', 'success');
            } else {
                await authFetch('/api/cost-centers', { method: 'POST', body: JSON.stringify(costForm) });
                showAlert('Cost center created', 'success');
            }
            resetCostForm(); setShowCostForm(false); load();
        } catch (err) { showAlert(err.message, 'danger'); }
    };
    const handleEditCost = (row) => { setEditingCostId(row.id); setCostForm({ ...emptyCostForm, ...row }); setShowCostForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const handleDeleteCost = async (row) => {
        if (!window.confirm(`Deactivate "${row.cost_center_name}"?`)) return;
        try { await authFetch(`/api/cost-centers/${row.id}`, { method: 'DELETE' }); showAlert('Cost center deactivated', 'warning'); load(); }
        catch (err) { showAlert(err.message, 'danger'); }
    };

    const costColumns = [
        { key: 'cost_center_code', label: 'Code', type: 'text' },
        { key: 'cost_center_name', label: 'Name', type: 'text' },
        { key: 'cost_center_type', label: 'Type', type: 'text' },
        { key: 'nfrs_allocation_basis', label: 'Allocation Basis', type: 'text' },
        { key: 'allocation_percentage', label: 'Allocation %', type: 'number' },
        { key: 'annual_budget', label: 'Annual Budget', type: 'number' },
        { key: 'monthly_budget', label: 'Monthly Budget', type: 'number' },
        { key: 'responsible_person', label: 'Responsible Person', type: 'text' }
    ];

    const resetProfitForm = () => { setProfitForm(emptyProfitForm); setEditingProfitId(null); };
    const handleProfitSubmit = async (e) => {
        e.preventDefault();
        if (!profitForm.profit_center_name.trim()) return showAlert('Profit center name is required', 'danger');
        try {
            if (editingProfitId) {
                await authFetch(`/api/profit-centers/${editingProfitId}`, { method: 'PUT', body: JSON.stringify(profitForm) });
                showAlert('Profit center updated', 'success');
            } else {
                await authFetch('/api/profit-centers', { method: 'POST', body: JSON.stringify(profitForm) });
                showAlert('Profit center created', 'success');
            }
            resetProfitForm(); setShowProfitForm(false); load();
        } catch (err) { showAlert(err.message, 'danger'); }
    };
    const handleEditProfit = (row) => { setEditingProfitId(row.id); setProfitForm({ ...emptyProfitForm, ...row }); setShowProfitForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const handleDeleteProfit = async (row) => {
        if (!window.confirm(`Deactivate "${row.profit_center_name}"?`)) return;
        try { await authFetch(`/api/profit-centers/${row.id}`, { method: 'DELETE' }); showAlert('Profit center deactivated', 'warning'); load(); }
        catch (err) { showAlert(err.message, 'danger'); }
    };

    const profitColumns = [
        { key: 'profit_center_code', label: 'Code', type: 'text' },
        { key: 'profit_center_name', label: 'Name', type: 'text' },
        { key: 'profit_center_type', label: 'Type', type: 'text' },
        { key: 'annual_target', label: 'Annual Target', type: 'number' },
        { key: 'quarterly_target', label: 'Quarterly Target', type: 'number' },
        { key: 'monthly_target', label: 'Monthly Target', type: 'number' },
        { key: 'responsible_person', label: 'Responsible Person', type: 'text' }
    ];

    return (
        <Layout>
        <div className="max-w-6xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Cost & Profit Centers</h1>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="flex gap-2 mb-4 border-b">
                <button onClick={() => setTab('cost')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'cost' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Cost Centers</button>
                <button onClick={() => setTab('profit')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'profit' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Profit Centers</button>
            </div>

            {tab === 'cost' && (
                <>
                    <div className="flex justify-end mb-3">
                        <button onClick={() => { resetCostForm(); setShowCostForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                            {showCostForm ? 'Close' : '➕ New Cost Center'}
                        </button>
                    </div>
                    {showCostForm && (
                        <form ref={costFormRef} onSubmit={handleCostSubmit} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="erp-label">Code <span className="text-xs text-gray-400">(preview only)</span></label>
                                    <input className="erp-input" disabled
                                        value={editingCostId ? (costForm.cost_center_code || '') : 'Auto-generated on save'} />
                                </div>
                                <div>
                                    <label className="erp-label">Cost Center Name *</label>
                                    <input className="erp-input" value={costForm.cost_center_name} onChange={e => setCostForm({ ...costForm, cost_center_name: e.target.value })} required />
                                </div>
                                <div>
                                    <label className="erp-label">Short Name (Alias)</label>
                                    <input className="erp-input" value={costForm.cost_center_short_name} onChange={e => setCostForm({ ...costForm, cost_center_short_name: e.target.value })}
                                        placeholder={!editingCostId ? `e.g. ${nameInitials(costForm.cost_center_name)}00001 (auto if blank)` : ''} />
                                </div>
                                <div>
                                    <label className="erp-label">Type</label>
                                    <select className="erp-input" value={costForm.cost_center_type} onChange={e => setCostForm({ ...costForm, cost_center_type: e.target.value })}>
                                        <option value="department">Department</option>
                                        <option value="project">Project</option>
                                        <option value="branch">Branch</option>
                                        <option value="activity">Activity</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="erp-label">NFRS Allocation Basis</label>
                                    <select className="erp-input" value={costForm.nfrs_allocation_basis} onChange={e => setCostForm({ ...costForm, nfrs_allocation_basis: e.target.value })}>
                                        <option value="">Select</option>
                                        <option value="Direct">Direct</option>
                                        <option value="Indirect">Indirect</option>
                                        <option value="Activity Based">Activity Based</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="erp-label">Allocation %</label>
                                    <input type="number" step="0.01" className="erp-input" value={costForm.allocation_percentage} onChange={e => setCostForm({ ...costForm, allocation_percentage: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Annual Budget</label>
                                    <input type="number" className="erp-input" value={costForm.annual_budget} onChange={e => setCostForm({ ...costForm, annual_budget: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Monthly Budget</label>
                                    <input type="number" className="erp-input" value={costForm.monthly_budget} onChange={e => setCostForm({ ...costForm, monthly_budget: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Responsible Person</label>
                                    <input className="erp-input" value={costForm.responsible_person} onChange={e => setCostForm({ ...costForm, responsible_person: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Phone</label>
                                    <input className="erp-input" value={costForm.responsible_person_phone} onChange={e => setCostForm({ ...costForm, responsible_person_phone: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Email</label>
                                    <input type="email" className="erp-input" value={costForm.responsible_person_email} onChange={e => setCostForm({ ...costForm, responsible_person_email: e.target.value })} />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="erp-label">Description</label>
                                    <input className="erp-input" value={costForm.description} onChange={e => setCostForm({ ...costForm, description: e.target.value })} />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 border-t pt-4">
                                <button type="button" onClick={() => { resetCostForm(); setShowCostForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">{editingCostId ? 'Update Cost Center' : 'Create Cost Center'}</button>
                            </div>
                        </form>
                    )}
                    <ReportGrid columns={costColumns} rows={costCenters} getId={(r) => r.id} storageKey="cost_center_grid"
                        rowActions={(row) => (
                            <div className="flex gap-2 justify-center">
                                <button onClick={() => handleEditCost(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                <button onClick={() => handleDeleteCost(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>
                            </div>
                        )}
                    />
                </>
            )}

            {tab === 'profit' && (
                <>
                    <div className="flex justify-end mb-3">
                        <button onClick={() => { resetProfitForm(); setShowProfitForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                            {showProfitForm ? 'Close' : '➕ New Profit Center'}
                        </button>
                    </div>
                    {showProfitForm && (
                        <form ref={profitFormRef} onSubmit={handleProfitSubmit} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="erp-label">Code <span className="text-xs text-gray-400">(preview only)</span></label>
                                    <input className="erp-input" disabled
                                        value={editingProfitId ? (profitForm.profit_center_code || '') : 'Auto-generated on save'} />
                                </div>
                                <div>
                                    <label className="erp-label">Profit Center Name *</label>
                                    <input className="erp-input" value={profitForm.profit_center_name} onChange={e => setProfitForm({ ...profitForm, profit_center_name: e.target.value })} required />
                                </div>
                                <div>
                                    <label className="erp-label">Short Name (Alias)</label>
                                    <input className="erp-input" value={profitForm.profit_center_short_name} onChange={e => setProfitForm({ ...profitForm, profit_center_short_name: e.target.value })}
                                        placeholder={!editingProfitId ? `e.g. ${nameInitials(profitForm.profit_center_name)}00001 (auto if blank)` : ''} />
                                </div>
                                <div>
                                    <label className="erp-label">Type</label>
                                    <select className="erp-input" value={profitForm.profit_center_type} onChange={e => setProfitForm({ ...profitForm, profit_center_type: e.target.value })}>
                                        <option value="division">Division</option>
                                        <option value="branch">Branch</option>
                                        <option value="product_line">Product Line</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="erp-label">Annual Target</label>
                                    <input type="number" className="erp-input" value={profitForm.annual_target} onChange={e => setProfitForm({ ...profitForm, annual_target: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Quarterly Target</label>
                                    <input type="number" className="erp-input" value={profitForm.quarterly_target} onChange={e => setProfitForm({ ...profitForm, quarterly_target: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Monthly Target</label>
                                    <input type="number" className="erp-input" value={profitForm.monthly_target} onChange={e => setProfitForm({ ...profitForm, monthly_target: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Responsible Person</label>
                                    <input className="erp-input" value={profitForm.responsible_person} onChange={e => setProfitForm({ ...profitForm, responsible_person: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Phone</label>
                                    <input className="erp-input" value={profitForm.responsible_person_phone} onChange={e => setProfitForm({ ...profitForm, responsible_person_phone: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Email</label>
                                    <input type="email" className="erp-input" value={profitForm.responsible_person_email} onChange={e => setProfitForm({ ...profitForm, responsible_person_email: e.target.value })} />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="erp-label">Description</label>
                                    <input className="erp-input" value={profitForm.description} onChange={e => setProfitForm({ ...profitForm, description: e.target.value })} />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 border-t pt-4">
                                <button type="button" onClick={() => { resetProfitForm(); setShowProfitForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">{editingProfitId ? 'Update Profit Center' : 'Create Profit Center'}</button>
                            </div>
                        </form>
                    )}
                    <ReportGrid columns={profitColumns} rows={profitCenters} getId={(r) => r.id} storageKey="profit_center_grid"
                        rowActions={(row) => (
                            <div className="flex gap-2 justify-center">
                                <button onClick={() => handleEditProfit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                <button onClick={() => handleDeleteProfit(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>
                            </div>
                        )}
                    />
                </>
            )}
        </div>
        </Layout>
    );
}
