// =============================================
// BranchWarehouseManagement.jsx
// Frontend for server/routes/branchWarehouseRoutes.js - this module existed
// in the original design document but had no working, connected page.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

const emptyBranch = { branch_name: '', branch_type: 'retail', province: '', district: '', address_line1: '', phone: '', is_head_office: false };
const emptyWarehouse = { warehouse_name: '', warehouse_type: 'main', province: '', district: '', address_line1: '', phone: '' };

export default function BranchWarehouseManagement() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState('branches');
    const [branches, setBranches] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [branchForm, setBranchForm] = useState(emptyBranch);
    const [warehouseForm, setWarehouseForm] = useState(emptyWarehouse);
    const [showBranchForm, setShowBranchForm] = useState(false);
    const [showWarehouseForm, setShowWarehouseForm] = useState(false);
    const [alert, setAlert] = useState(null);
    const branchFormRef = useRef(null);
    const warehouseFormRef = useRef(null);
    useEnterKeyNavigation(branchFormRef);
    useEnterKeyNavigation(warehouseFormRef);

    const showAlert = (message, type = 'info') => {
        setAlert({ message, type });
        setTimeout(() => setAlert(null), 5000);
    };

    const load = useCallback(async () => {
        try {
            const [b, w] = await Promise.all([authFetch('/api/branches'), authFetch('/api/warehouses')]);
            setBranches(b.data || []);
            setWarehouses(w.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);

    useEffect(() => { load(); }, [load]);

    const createBranch = async (e) => {
        e.preventDefault();
        try {
            await authFetch('/api/branches', { method: 'POST', body: JSON.stringify(branchForm) });
            showAlert('Branch created', 'success');
            setBranchForm(emptyBranch);
            setShowBranchForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const deleteBranch = async (row) => {
        if (!window.confirm(`Deactivate "${row.branch_name}"?`)) return;
        try {
            await authFetch(`/api/branches/${row.id}`, { method: 'DELETE' });
            showAlert('Branch deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const createWarehouse = async (e) => {
        e.preventDefault();
        try {
            await authFetch('/api/warehouses', { method: 'POST', body: JSON.stringify(warehouseForm) });
            showAlert('Warehouse created', 'success');
            setWarehouseForm(emptyWarehouse);
            setShowWarehouseForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const deleteWarehouse = async (row) => {
        if (!window.confirm(`Deactivate "${row.warehouse_name}"?`)) return;
        try {
            await authFetch(`/api/warehouses/${row.id}`, { method: 'DELETE' });
            showAlert('Warehouse deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const branchColumns = [
        { key: 'branch_code', label: 'Code', type: 'text' },
        { key: 'branch_name', label: 'Name', type: 'text', editable: true },
        { key: 'branch_type', label: 'Type', type: 'text' },
        { key: 'district', label: 'District', type: 'text', editable: true },
        { key: 'province', label: 'Province', type: 'text', editable: true },
        { key: 'is_head_office', label: 'HQ', type: 'text', render: r => r.is_head_office ? '✅' : '' }
    ];

    const warehouseColumns = [
        { key: 'warehouse_code', label: 'Code', type: 'text' },
        { key: 'warehouse_name', label: 'Name', type: 'text', editable: true },
        { key: 'warehouse_type', label: 'Type', type: 'text' },
        { key: 'district', label: 'District', type: 'text', editable: true },
        { key: 'province', label: 'Province', type: 'text', editable: true }
    ];

    // FEATURE: inline cell editing - safe here since every editable
    // column is a plain scalar field with no foreign-key relationship to
    // protect. Both mapping endpoints/complex forms elsewhere stay
    // form-only for exactly that reason.
    const handleBranchCellEdit = async (row, key, value) => {
        try {
            const res = await authFetch(`/api/branches/${row.id}`, { method: 'PUT', body: JSON.stringify({ [key]: value }) });
            setBranches(bs => bs.map(b => b.id === row.id ? { ...b, ...res.data } : b));
            showAlert('Branch updated', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };
    const handleWarehouseCellEdit = async (row, key, value) => {
        try {
            const res = await authFetch(`/api/warehouses/${row.id}`, { method: 'PUT', body: JSON.stringify({ [key]: value }) });
            setWarehouses(ws => ws.map(w => w.id === row.id ? { ...w, ...res.data } : w));
            showAlert('Warehouse updated', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    return (
        <Layout>
        <div className="max-w-6xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Branches & Warehouses</h1>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>
                    {alert.message}
                </div>
            )}

            <div className="flex gap-2 mb-4 border-b">
                <button onClick={() => setTab('branches')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'branches' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Branches</button>
                <button onClick={() => setTab('warehouses')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'warehouses' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Warehouses</button>
            </div>

            {tab === 'branches' && (
                <>
                    <div className="flex justify-end mb-3">
                        <button onClick={() => setShowBranchForm(s => !s)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                            {showBranchForm ? 'Close' : '➕ New Branch'}
                        </button>
                    </div>
                    {showBranchForm && (
                        <form ref={branchFormRef} onSubmit={createBranch} className="bg-white border rounded-xl p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input className="erp-input" placeholder="Branch Name *" value={branchForm.branch_name} onChange={e => setBranchForm({ ...branchForm, branch_name: e.target.value })} required />
                            <select className="erp-input" value={branchForm.branch_type} onChange={e => setBranchForm({ ...branchForm, branch_type: e.target.value })}>
                                <option value="retail">Retail</option>
                                <option value="wholesale">Wholesale</option>
                                <option value="office">Office</option>
                            </select>
                            <input className="erp-input" placeholder="Province *" value={branchForm.province} onChange={e => setBranchForm({ ...branchForm, province: e.target.value })} required />
                            <input className="erp-input" placeholder="District *" value={branchForm.district} onChange={e => setBranchForm({ ...branchForm, district: e.target.value })} required />
                            <input className="border rounded-lg px-3 py-2 md:col-span-2" placeholder="Address" value={branchForm.address_line1} onChange={e => setBranchForm({ ...branchForm, address_line1: e.target.value })} />
                            <input className="erp-input" placeholder="Phone" value={branchForm.phone} onChange={e => setBranchForm({ ...branchForm, phone: e.target.value })} />
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={branchForm.is_head_office} onChange={e => setBranchForm({ ...branchForm, is_head_office: e.target.checked })} /> Head Office
                            </label>
                            <div className="md:col-span-3 flex justify-end">
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save Branch</button>
                            </div>
                        </form>
                    )}
                    <ReportGrid columns={branchColumns} rows={branches}
                        getId={(r) => r.id} storageKey="branch_grid"
                auditTable="branches"
                        onCellEdit={handleBranchCellEdit}
                        rowActions={(row) => <button onClick={() => deleteBranch(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>}
                    />
                </>
            )}

            {tab === 'warehouses' && (
                <>
                    <div className="flex justify-end mb-3">
                        <button onClick={() => setShowWarehouseForm(s => !s)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                            {showWarehouseForm ? 'Close' : '➕ New Warehouse'}
                        </button>
                    </div>
                    {showWarehouseForm && (
                        <form ref={warehouseFormRef} onSubmit={createWarehouse} className="bg-white border rounded-xl p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input className="erp-input" placeholder="Warehouse Name *" value={warehouseForm.warehouse_name} onChange={e => setWarehouseForm({ ...warehouseForm, warehouse_name: e.target.value })} required />
                            <select className="erp-input" value={warehouseForm.warehouse_type} onChange={e => setWarehouseForm({ ...warehouseForm, warehouse_type: e.target.value })}>
                                <option value="main">Main</option>
                                <option value="satellite">Satellite</option>
                                <option value="cold_storage">Cold Storage</option>
                            </select>
                            <input className="erp-input" placeholder="Province *" value={warehouseForm.province} onChange={e => setWarehouseForm({ ...warehouseForm, province: e.target.value })} required />
                            <input className="erp-input" placeholder="District *" value={warehouseForm.district} onChange={e => setWarehouseForm({ ...warehouseForm, district: e.target.value })} required />
                            <input className="border rounded-lg px-3 py-2 md:col-span-2" placeholder="Address" value={warehouseForm.address_line1} onChange={e => setWarehouseForm({ ...warehouseForm, address_line1: e.target.value })} />
                            <input className="erp-input" placeholder="Phone" value={warehouseForm.phone} onChange={e => setWarehouseForm({ ...warehouseForm, phone: e.target.value })} />
                            <div className="md:col-span-3 flex justify-end">
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save Warehouse</button>
                            </div>
                        </form>
                    )}
                    <ReportGrid columns={warehouseColumns} rows={warehouses}
                        getId={(r) => r.id} storageKey="warehouse_grid"
                auditTable="warehouses"
                        onCellEdit={handleWarehouseCellEdit}
                        rowActions={(row) => <button onClick={() => deleteWarehouse(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>}
                    />
                </>
            )}
        </div>
        </Layout>
    );
}
