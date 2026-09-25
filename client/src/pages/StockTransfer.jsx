// =============================================
// StockTransfer.jsx
// Warehouse-to-warehouse or branch-to-branch inventory movement - Draft ->
// Approved -> Posted (stock only actually moves at Posted) -> Cancelled.
// Branch transfer: each side picks one of that branch's warehouses. With
// System Control "Branch Transfer Receipt = In Transit", Post only
// dispatches the goods and the receiving branch must Receive them. The
// accounts panel shows the ledgers the transfer posts to (System Control >
// Stock Posting) and lets the user change them when that is allowed.
// Only the receiving branch can Receive. Cost Rate fills from the current
// stock cost, so a transfer carries value even with account posting off.
// =============================================

import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import { resolveDualUomEntryMode, onPrimaryQtyChange, onSecondaryQtyChange, validateFixedSecondary, dualBaseQty } from '../utils/dualUomEntryMode';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';
import UdfValuesModal from '../components/UdfValuesModal';
import RecordHistory from '../components/RecordHistory';

const emptyDetailRow = () => ({
    product_id: '', batch_no: '', mfg_date: '', exp_date: '',
    from_warehouse_id: '', to_warehouse_id: '',
    qty: '', free_qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', rate_basis: 'primary',
    cost_rate: '', mrp: '', sell_rate: '', narration: ''
});

const emptyForm = {
    doc_date: new Date().toISOString().slice(0, 10),
    numbering_category_id: '',
    transfer_type: 'warehouse', from_branch_id: '', to_branch_id: '',
    from_warehouse_id: '', to_warehouse_id: '',
    dr_ledger_id: '', cr_ledger_id: '', transit_ledger_id: '',
    transport_id: '', vehicle_no: '', driver_name: '', driver_license_no: '', driver_contact_no: '',
    remarks_text: '', narration: '', cost_center_id: '', business_unit_id: '', priority: 'normal',
    details: [emptyDetailRow()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['business_unit_id', 'cost_center_id', 'doc_date', 'driver_contact_no', 'driver_license_no', 'driver_name', 'from_branch_id', 'from_warehouse_id', 'narration', 'priority', 'to_branch_id', 'to_warehouse_id', 'transport_id', 'vehicle_no'];

// In Transit = a two-step branch transfer dispatched but not yet received.
const isInTransit = r => r.status === 'posted' && r.requires_receipt && !r.received_date;
const statusLabel = r => isInTransit(r) ? 'in transit' : r.status === 'posted' && r.received_date ? `received ${String(r.received_date).slice(0, 10)}` : r.status;
const noNulls = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === null ? '' : v]));
const today = () => new Date().toISOString().slice(0, 10);

export default function StockTransfer() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('stock_transfer', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [listFilter, setListFilter] = useState('all');
    const [receiveModal, setReceiveModal] = useState(null);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [auditModal, setAuditModal] = useState(null);

    const [warehouses, setWarehouses] = useState([]);
    const [branches, setBranches] = useState([]);
    const [branchWarehouses, setBranchWarehouses] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [accounts, setAccounts] = useState(null);
    const [transports, setTransports] = useState([]);
    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [remarks, setRemarks] = useState([]);
    const [dualUomEntryMode, setDualUomEntryMode] = useState({ mode: 'fixed', reverseEnabled: false });

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addDetailRow(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, wh, br, tr, prod, un, cc, bu, rmk, sysCtrl] = await Promise.all([
                authFetch('/api/stock-transfers'),
                authFetch('/api/warehouses'),
                authFetch('/api/branches'),
                authFetch('/api/transport-master'),
                authFetch('/api/products'),
                authFetch('/api/product-units'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/remarks'),
                authFetch('/api/system-control')
            ]);
            setRows(req.data || []);
            setWarehouses(wh.data || []);
            setBranches(br.data || []);
            setTransports(tr.data || []);
            setProducts(prod.data || []);
            setUnits(un.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setRemarks(rmk.data || []);
            setDualUomEntryMode(resolveDualUomEntryMode(sysCtrl.data));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
        // Optional lookups: a user without ledger access can still make transfers.
        authFetch('/api/branch-warehouse-mapping').then(r => setBranchWarehouses(r.data || [])).catch(() => setBranchWarehouses([]));
        authFetch('/api/ledger-accounts?pageSize=1000&sortBy=account_name&sortDir=asc').then(r => setLedgers(r.data || [])).catch(() => setLedgers([]));
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const isBranch = form.transfer_type === 'branch';
    // A branch's warehouses; a branch with no mapping is not restricted (same rule as the server).
    const warehousesOf = useCallback((branchId) => {
        if (!branchId) return warehouses;
        const ids = branchWarehouses.filter(m => m.branch_id === branchId).map(m => m.warehouse_id);
        return ids.length ? warehouses.filter(w => ids.includes(w.id)) : warehouses;
    }, [warehouses, branchWarehouses]);
    const fromWarehouses = isBranch ? warehousesOf(form.from_branch_id) : warehouses;
    const toWarehouses = isBranch ? warehousesOf(form.to_branch_id) : warehouses;
    const defaultWarehouseOf = (branchId) => {
        const maps = branchWarehouses.filter(m => m.branch_id === branchId);
        return (maps.find(m => m.default_warehouse) || maps.find(m => m.is_primary) || (maps.length === 1 ? maps[0] : null))?.warehouse_id || '';
    };
    const setBranchSide = (side, branchId) => setForm(f => {
        const whKey = `${side}_warehouse_id`;
        const allowed = warehousesOf(branchId).map(w => w.id);
        const keep = f[whKey] && allowed.includes(f[whKey]);
        return {
            ...f, [`${side}_branch_id`]: branchId, [whKey]: keep ? f[whKey] : defaultWarehouseOf(branchId),
            // line overrides outside the new branch no longer apply
            details: f.details.map(d => (d[whKey] && !allowed.includes(d[whKey]) ? { ...d, [whKey]: '' } : d))
        };
    });
    const setTransferType = (type) => setForm(f => ({
        ...f, transfer_type: type,
        ...(type === 'warehouse' ? { from_branch_id: '', to_branch_id: '', transit_ledger_id: '' } : {})
    }));

    // Accounts this transfer posts to (before the user's own choice).
    const accountsQuery = new URLSearchParams(Object.entries({
        transfer_type: form.transfer_type, from_branch_id: form.from_branch_id, to_branch_id: form.to_branch_id,
        from_warehouse_id: form.from_warehouse_id, to_warehouse_id: form.to_warehouse_id
    }).filter(([, v]) => v)).toString();
    useEffect(() => {
        if (!showForm) return;
        let live = true;
        authFetch(`/api/stock-transfer-accounts?${accountsQuery}`).then(r => live && setAccounts(r.data)).catch(() => live && setAccounts(null));
        return () => { live = false; };
    }, [authFetch, showForm, accountsQuery]);
    const ledgerName = id => ledgers.find(l => l.id === id)?.account_name || '';

    const resetForm = () => { setForm({ ...emptyForm, doc_date: today() }); setEditingId(null); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => setForm(f => ({ ...f, details: f.details.length > 1 ? f.details.filter((_, i) => i !== idx) : f.details }));
    const updateDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));
    const productMaintainsBatch = (productId) => !!products.find(p => p.id === productId)?.maintain_batch;
    const productHasAltUnits = (productId) => (products.find(p => p.id === productId)?.product_unit_rates?.length || 0) > 1;
    const productIsFixedDualUom = (productId) => products.find(p => p.id === productId)?.uom_mode === 'fixed_dual';
    const dualConversionFactor = (productId) => {
        const product = products.find(p => p.id === productId);
        const rate = (product?.product_unit_rates || []).find(r => r.unit_id === product?.dual_uom_primary_unit_id);
        return Number(rate?.conversion_factor) || 1;
    };
    // Cost Rate = current stock cost in the line's unit, unless the user typed one.
    const fillCost = async (idx, productId, uomId) => {
        if (!productId) return;
        try {
            const q = new URLSearchParams({ product_id: productId, date: form.doc_date || today(), ...(uomId ? { uom_id: uomId } : {}) });
            const res = await authFetch(`/api/stock/current-cost?${q}`);
            if (res.data?.rate > 0) setForm(f => ({ ...f, details: f.details.map((d, i) => (i === idx && d.product_id === productId && !d._cost_manual ? { ...d, cost_rate: res.data.rate } : d)) }));
        } catch { /* no ledger access or no cost: leave blank - posting fills it */ }
    };
    const handleProductSelect = (idx, productId) => {
        const product = products.find(p => p.id === productId);
        const uomId = product?.uom_mode === 'fixed_dual' ? product.dual_uom_primary_unit_id || '' : product?.base_unit_id || '';
        if (product?.uom_mode === 'fixed_dual') {
            updateDetailRow(idx, { product_id: productId, uom_id: uomId, alt_unit_id: product.base_unit_id || '', rate_basis: 'primary', cost_rate: '', _cost_manual: false });
        } else {
            updateDetailRow(idx, { product_id: productId, uom_id: uomId, cost_rate: '', _cost_manual: false });
        }
        fillCost(idx, productId, uomId);
    };

    const lineAmount = (d) => {
        if (productIsFixedDualUom(d.product_id) && d.alt_qty) {
            const factor = dualConversionFactor(d.product_id);
            const totalBaseQty = dualBaseQty(d.qty, d.alt_qty, factor, dualUomEntryMode.mode);
            return d.rate_basis === 'primary' ? (totalBaseQty / factor) * (Number(d.cost_rate) || 0) : totalBaseQty * (Number(d.cost_rate) || 0);
        }
        return (Number(d.qty) || 0) * (Number(d.cost_rate) || 0);
    };
    const grandTotal = form.details.reduce((sum, d) => sum + lineAmount(d), 0);

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        if (!saveAsDraft) {
            if (!form.from_warehouse_id || !form.to_warehouse_id) return showAlert('From and To Warehouse are required', 'danger');
            if (form.from_warehouse_id === form.to_warehouse_id) return showAlert('From and To Warehouse must be different', 'danger');
            if (isBranch) {
                if (!form.from_branch_id || !form.to_branch_id) return showAlert('From Branch and To Branch are required for a branch transfer', 'danger');
                if (form.from_branch_id === form.to_branch_id) return showAlert('From and To Branch must be different - use a warehouse transfer within one branch', 'danger');
            }
        }
        const validDetails = form.details.filter(d => d.product_id && (Number(d.qty) > 0 || Number(d.alt_qty) > 0));
        if (!saveAsDraft && validDetails.length === 0) return showAlert('At least one complete line item (Product + Qty) is required', 'danger');
        try {
            const payload = { ...form, details: validDetails, ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}) };
            if (editingId) {
                await authFetch(`/api/stock-transfers/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : 'Stock Transfer updated', 'success');
            } else {
                const res = await authFetch('/api/stock-transfers', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Stock Transfer ${res.data.doc_no} created`, 'success');
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
            const res = await authFetch(`/api/stock-transfers/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...noNulls(res.data),
                transfer_type: res.data.transfer_type || 'warehouse',
                doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date,
                details: (res.data.details || []).length > 0 ? res.data.details.map(d => ({ ...emptyDetailRow(), ...noNulls(d) })) : [emptyDetailRow()]
            });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleCopyFrom = async (sourceId) => {
        try {
            const res = await authFetch(`/api/stock-transfers/${sourceId}`);
            const src = res.data;
            setEditingId(null);
            const { id, requires_receipt, received_date, received_by, received_at, receive_remarks, gl_posted, posted_by, posted_at, approved_by, approved_at,
                cancelled_by, cancelled_at, cancellation_reason, ...rest } = src;
            setForm({
                ...emptyForm, ...noNulls(rest),
                transfer_type: src.transfer_type || 'warehouse',
                doc_no: '', doc_date: today(), status: 'draft',
                details: (src.details || []).length > 0 ? src.details.map(({ id: _id, transfer_id, ...d }) => ({ ...emptyDetailRow(), ...noNulls(d) })) : [emptyDetailRow()]
            });
            setShowForm(true);
            setShowCopyModal(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showAlert(`Copied from ${src.doc_no} - review and save as a new Transfer`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        let cancellationReason;
        if (status === 'cancelled') {
            if (row.status === 'posted' && row.requires_receipt && !window.confirm(isInTransit(row)
                ? `${row.doc_no} is In Transit. Cancelling returns the goods to ${row.from_warehouse_name_snapshot || 'the sending warehouse'} and reverses its entries. Continue?`
                : `${row.doc_no} was already received. Cancelling reverses both the dispatch and the receipt. Continue?`)) return;
            cancellationReason = window.prompt('Reason for cancelling this Transfer?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            const res = await authFetch(`/api/stock-transfers/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            if (res.warnings?.length > 0) {
                showAlert(`Marked as ${status}, but: ${res.warnings.join('; ')}`, 'warning');
            } else {
                showAlert(`Marked as ${status}`, 'success');
            }
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleReceive = async (e) => {
        e.preventDefault();
        const { row, received_date, receive_remarks } = receiveModal;
        if (!received_date) return showAlert('Receiving date is required', 'danger');
        try {
            const res = await authFetch(`/api/stock-transfers/${row.id}/receive`, { method: 'PUT', body: JSON.stringify({ received_date, receive_remarks }) });
            showAlert(res.message || `${row.doc_no} received`, 'success');
            setReceiveModal(null);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/stock-transfers/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const [udfDoc, setUdfDoc] = useState(null);

    const openAuditTrail = (row) => setAuditModal({ id: row.id, doc_no: row.doc_no });

    const side = (branch, wh) => [branch, wh].filter(Boolean).join(' · ') || '—';
    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'transfer_type', label: 'Type', type: 'text', render: r => r.transfer_type === 'branch' ? 'Branch' : 'Warehouse' },
        { key: 'from_warehouse_name_snapshot', label: 'From', type: 'text', render: r => side(r.transfer_type === 'branch' && r.from_branch_name_snapshot, r.from_warehouse_name_snapshot) },
        { key: 'to_warehouse_name_snapshot', label: 'To', type: 'text', render: r => side(r.transfer_type === 'branch' && r.to_branch_name_snapshot, r.to_warehouse_name_snapshot) },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text', render: r => (
            <span className={isInTransit(r) ? 'text-orange-600 font-semibold' : ''}>{statusLabel(r)}{r.gl_posted ? ' · GL' : ''}</span>
        ) }
    ];
    const listRows = listFilter === 'draft' ? rows.filter(r => r.status === 'draft')
        : listFilter === 'in_transit' ? rows.filter(isInTransit)
        : listFilter === 'to_receive' ? rows.filter(r => isInTransit(r) && r.can_receive) : rows;
    const inTransitCount = rows.filter(isInTransit).length;
    const toReceiveCount = rows.filter(r => isInTransit(r) && r.can_receive).length;

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🔄 Stock Transfer</span>
                <div className="erp-header-actions">
                    <button onClick={() => setShowCopyModal(true)} className="erp-header-btn">📑 Copy From</button>
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
                <form onSubmit={handleSubmit} ref={formRef}>
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className="erp-field">
                            <label className="erp-label">Transfer Type</label>
                            <select className="erp-select" value={form.transfer_type} onChange={e => setTransferType(e.target.value)} disabled={!!editingId && form.status !== 'draft'}>
                                <option value="warehouse">Warehouse to Warehouse</option>
                                <option value="branch">Branch to Branch</option>
                            </select>
                        </div>
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>} {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        {isBranch && (
                        <div className={efc.isVisible('from_branch_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">From Branch <span className="req">*</span> {efc.isRequired('from_branch_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="transfer_from_branch_picker"
                                columns={[{ key: 'branch_code', label: 'Code' }, { key: 'branch_name', label: 'Name' }]}
                                defaultVisibleKeys={['branch_name']}
                                items={branches} getId={b => b.id} getLabel={b => b.branch_name}
                                searchKeys={['branch_name', 'branch_code']}
                                value={form.from_branch_id} onChange={id => setBranchSide('from', id)} placeholder="Select Branch"
                            />
                        </div>
                        )}
                        <div className={efc.isVisible('from_warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">From Warehouse <span className="req">*</span> {efc.isRequired('from_warehouse_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="transfer_from_wh_picker"
                                columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                defaultVisibleKeys={['warehouse_name']}
                                items={fromWarehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                searchKeys={['warehouse_name', 'warehouse_code']}
                                value={form.from_warehouse_id} onChange={id => setForm({ ...form, from_warehouse_id: id })} placeholder="Select Warehouse"
                            />
                        </div>
                        {isBranch && (
                        <div className={efc.isVisible('to_branch_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">To Branch <span className="req">*</span> {efc.isRequired('to_branch_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="transfer_to_branch_picker"
                                columns={[{ key: 'branch_code', label: 'Code' }, { key: 'branch_name', label: 'Name' }]}
                                defaultVisibleKeys={['branch_name']}
                                items={branches} getId={b => b.id} getLabel={b => b.branch_name}
                                searchKeys={['branch_name', 'branch_code']}
                                value={form.to_branch_id} onChange={id => setBranchSide('to', id)} placeholder="Select Branch"
                            />
                        </div>
                        )}
                        <div className={efc.isVisible('to_warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">To Warehouse <span className="req">*</span> {efc.isRequired('to_warehouse_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="transfer_to_wh_picker"
                                columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                defaultVisibleKeys={['warehouse_name']}
                                items={toWarehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                searchKeys={['warehouse_name', 'warehouse_code']}
                                value={form.to_warehouse_id} onChange={id => setForm({ ...form, to_warehouse_id: id })} placeholder="Select Warehouse"
                            />
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="stock_transfer" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('transport_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Transport {efc.isRequired('transport_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="transfer_transport_picker"
                                    columns={[{ key: 'transport_code', label: 'Code' }, { key: 'transport_name', label: 'Name' }]}
                                    defaultVisibleKeys={['transport_name']}
                                    items={transports} getId={t => t.id} getLabel={t => t.transport_name}
                                    searchKeys={['transport_name', 'transport_code']}
                                    value={form.transport_id} onChange={id => setForm({ ...form, transport_id: id })} placeholder="Select Transport"
                                />
                            </div>
                            <div className={efc.isVisible('vehicle_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Vehicle No {efc.isRequired('vehicle_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('vehicle_no')} className="erp-input" value={form.vehicle_no} onChange={e => setForm({ ...form, vehicle_no: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('driver_name') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Driver Name {efc.isRequired('driver_name') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('driver_name')} className="erp-input" value={form.driver_name} onChange={e => setForm({ ...form, driver_name: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('driver_contact_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Driver Contact No {efc.isRequired('driver_contact_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('driver_contact_no')} className="erp-input" value={form.driver_contact_no} onChange={e => setForm({ ...form, driver_contact_no: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('driver_license_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Driver License No {efc.isRequired('driver_license_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('driver_license_no')} className="erp-input" value={form.driver_license_no} onChange={e => setForm({ ...form, driver_license_no: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('cost_center_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Cost Center {efc.isRequired('cost_center_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="transfer_cost_center_picker"
                                    columns={[{ key: 'cost_center_code', label: 'Code' }, { key: 'cost_center_name', label: 'Name' }]}
                                    defaultVisibleKeys={['cost_center_name']}
                                    items={costCenters} getId={c => c.id} getLabel={c => c.cost_center_name}
                                    searchKeys={['cost_center_name', 'cost_center_code']}
                                    value={form.cost_center_id} onChange={id => setForm({ ...form, cost_center_id: id })} placeholder="Select Cost Center"
                                />
                            </div>
                            <div className={efc.isVisible('business_unit_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Unit {efc.isRequired('business_unit_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="transfer_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className={efc.isVisible('priority') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Priority {efc.isRequired('priority') && <span className="req">*</span>}</label>
                                <select disabled={efc.isReadonly('priority')} className="erp-select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                                    <option value="low">Low</option>
                                    <option value="normal">Normal</option>
                                    <option value="urgent">Urgent</option>
                                </select>
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="transfer-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="transfer-remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field md:col-span-2' : 'erp-field md:col-span-2 hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Details</h2>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table min-w-[1200px]">
                                <thead>
                                    <tr>
                                        <th className="w-56">Product</th>
                                        <th className={`w-24 ${efc.isVisible('qty', 'detail') ? '' : 'hidden'}`}>Qty</th>
                                        <th className={`w-32 ${efc.isVisible('uom_id', 'detail') ? '' : 'hidden'}`}>UOM</th>
                                        <th className="w-20">Alt Qty</th>
                                        <th className="w-32">Alt Unit</th>
                                        <th className={`w-24 ${efc.isVisible('cost_rate', 'detail') ? '' : 'hidden'}`}>Cost Rate</th>
                                        <th className="w-24">Amount</th>
                                        <th className={`w-28 ${efc.isVisible('batch_no', 'detail') ? '' : 'hidden'}`}>Batch No</th>
                                        <th className="w-32">Mfg Date</th>
                                        <th className="w-32">Exp Date</th>
                                        <th className={`w-20 ${efc.isVisible('free_qty', 'detail') ? '' : 'hidden'}`}>Free Qty</th>
                                        <th className="w-24">MRP</th>
                                        <th className="w-24">Sell Rate</th>
                                        <th className="w-40">Override From WH</th>
                                        <th className="w-40">Override To WH</th>
                                        <th className={`w-40 ${efc.isVisible('narration', 'detail') ? '' : 'hidden'}`}>Narration</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.details.map((d, idx) => (
                                        <tr key={idx}>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="transfer_product_picker"
                                                    columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['product_name']}
                                                    items={products} getId={p => p.id} getLabel={p => p.product_name}
                                                    searchKeys={['product_name', 'product_code']}
                                                    value={d.product_id} onChange={id => handleProductSelect(idx, id)} placeholder="Product"
                                                />
                                            </td>
                                            <td className={efc.isVisible('qty', 'detail') ? '' : 'hidden'}>
                                                {productIsFixedDualUom(d.product_id) ? (
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-1">
                                                            <input disabled={efc.isReadonly('qty', 'detail')}
                                                                type="number" step="0.0001" className="erp-input" style={{ width: '60px' }} value={d.qty}
                                                                onChange={e => updateDetailRow(idx, dualUomEntryMode.mode === 'auto_convert' ? onPrimaryQtyChange(e.target.value, dualConversionFactor(d.product_id)) : { qty: e.target.value })}
                                                            />
                                                            <span className="text-[10px] text-gray-400">{units.find(u => u.id === d.uom_id)?.unit_name || 'Primary'}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="number" step="0.0001" className="erp-input" style={{ width: '60px' }} value={d.alt_qty} placeholder="0"
                                                                onChange={e => {
                                                                    if (dualUomEntryMode.mode === 'auto_convert') {
                                                                        updateDetailRow(idx, onSecondaryQtyChange(e.target.value, dualConversionFactor(d.product_id), dualUomEntryMode.reverseEnabled));
                                                                    } else {
                                                                        const { value } = validateFixedSecondary(e.target.value, dualConversionFactor(d.product_id));
                                                                        updateDetailRow(idx, { alt_qty: value });
                                                                    }
                                                                }}
                                                            />
                                                            <span className="text-[10px] text-gray-400">{units.find(u => u.id === d.alt_unit_id)?.unit_name || 'Secondary'}</span>
                                                        </div>
                                                        {dualUomEntryMode.mode !== 'auto_convert' && validateFixedSecondary(d.alt_qty, dualConversionFactor(d.product_id)).error && (
                                                            <span className="text-[9px] text-red-500 leading-tight">{validateFixedSecondary(d.alt_qty, dualConversionFactor(d.product_id)).error}</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <input disabled={efc.isReadonly('qty', 'detail')} type="number" step="0.0001" className="erp-input" value={d.qty} onChange={e => updateDetailRow(idx, { qty: e.target.value })} />
                                                )}
                                            </td>
                                            <td className={efc.isVisible('uom_id', 'detail') ? '' : 'hidden'}>
                                                {productIsFixedDualUom(d.product_id) ? (
                                                    <span className="text-xs text-gray-400">{units.find(u => u.id === d.uom_id)?.unit_name}/{units.find(u => u.id === d.alt_unit_id)?.unit_name}</span>
                                                ) : (
                                                    <select disabled={efc.isReadonly('uom_id', 'detail')} className="erp-select" value={d.uom_id} onChange={e => { updateDetailRow(idx, { uom_id: e.target.value }); fillCost(idx, d.product_id, e.target.value); }}>
                                                        <option value="">UOM</option>
                                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                    </select>
                                                )}
                                            </td>
                                            <td>
                                                {productIsFixedDualUom(d.product_id) ? <span className="text-gray-300 text-xs">(above)</span> : productHasAltUnits(d.product_id) ? <input type="number" step="0.0001" className="erp-input" value={d.alt_qty} onChange={e => updateDetailRow(idx, { alt_qty: e.target.value })} /> : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td>
                                                {productIsFixedDualUom(d.product_id) ? <span className="text-gray-300 text-xs">(above)</span> : productHasAltUnits(d.product_id) ? (
                                                    <select className="erp-select" value={d.alt_unit_id} onChange={e => updateDetailRow(idx, { alt_unit_id: e.target.value })}>
                                                        <option value="">Unit</option>
                                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                    </select>
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td className={efc.isVisible('cost_rate', 'detail') ? '' : 'hidden'}>
                                                <input disabled={efc.isReadonly('cost_rate', 'detail')} type="number" step="0.01" className="erp-input" value={d.cost_rate} onChange={e => updateDetailRow(idx, { cost_rate: e.target.value, _cost_manual: e.target.value !== '' })} />
                                                {productIsFixedDualUom(d.product_id) && (
                                                    <select className="erp-select mt-1" style={{ fontSize: '10px', height: '22px' }} value={d.rate_basis} onChange={e => updateDetailRow(idx, { rate_basis: e.target.value })}>
                                                        <option value="primary">per {units.find(u => u.id === d.uom_id)?.unit_name || 'Primary'}</option>
                                                        <option value="secondary">per {units.find(u => u.id === d.alt_unit_id)?.unit_name || 'Secondary'}</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td className="text-gray-500">{lineAmount(d).toFixed(2)}</td>
                                            <td className={efc.isVisible('batch_no', 'detail') ? '' : 'hidden'}>
                                                {productMaintainsBatch(d.product_id) ? (
                                                    <input disabled={efc.isReadonly('batch_no', 'detail')} className="erp-input" value={d.batch_no} onChange={e => updateDetailRow(idx, { batch_no: e.target.value })} placeholder="Batch" />
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td><input type="date" className="erp-input" value={d.mfg_date} onChange={e => updateDetailRow(idx, { mfg_date: e.target.value })} /></td>
                                            <td><input type="date" className="erp-input" value={d.exp_date} onChange={e => updateDetailRow(idx, { exp_date: e.target.value })} /></td>
                                            <td className={efc.isVisible('free_qty', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('free_qty', 'detail')} type="number" step="0.0001" className="erp-input" value={d.free_qty} onChange={e => updateDetailRow(idx, { free_qty: e.target.value })} /></td>
                                            <td><input type="number" step="0.01" className="erp-input" value={d.mrp} onChange={e => updateDetailRow(idx, { mrp: e.target.value })} /></td>
                                            <td><input type="number" step="0.01" className="erp-input" value={d.sell_rate} onChange={e => updateDetailRow(idx, { sell_rate: e.target.value })} /></td>
                                            <td>
                                                <select className="erp-select" value={d.from_warehouse_id} onChange={e => updateDetailRow(idx, { from_warehouse_id: e.target.value })}>
                                                    <option value="">(document default)</option>
                                                    {fromWarehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                                </select>
                                            </td>
                                            <td>
                                                <select className="erp-select" value={d.to_warehouse_id} onChange={e => updateDetailRow(idx, { to_warehouse_id: e.target.value })}>
                                                    <option value="">(document default)</option>
                                                    {toWarehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                                </select>
                                            </td>
                                            <td className={efc.isVisible('narration', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('narration', 'detail')} className="erp-input" value={d.narration} onChange={e => updateDetailRow(idx, { narration: e.target.value })} /></td>
                                            <td><button type="button" tabIndex={-1} onClick={() => removeDetailRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                            <button type="button" onClick={addDetailRow} className="text-xs text-blue-600">➕ Add Line</button>
                            <span className="text-sm font-semibold">Total: {grandTotal.toFixed(2)}</span>
                        </div>

                        {accounts && (
                            <div className="mt-4 border rounded-lg p-3 bg-gray-50">
                                <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
                                    <p className="text-xs font-semibold text-gray-500 uppercase">Accounts</p>
                                    <span className="text-xs text-gray-500">
                                        {accounts.posts ? 'Posts to accounts at qty x cost rate' : 'Stock only, at value (qty x cost rate) - no accounting entry (System Control > Stock Posting)'}
                                        {accounts.two_step && ' · Two-step: Post dispatches (In Transit), the receiving branch must Receive'}
                                    </span>
                                </div>
                                {accounts.posts && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {[
                                            ['dr_ledger_id', 'Receiving stock a/c (Dr)'],
                                            ['cr_ledger_id', 'Sending stock a/c (Cr)'],
                                            ...(accounts.two_step ? [['transit_ledger_id', 'Goods in Transit']] : [])
                                        ].map(([key, label]) => (
                                            <div key={key} className="erp-field">
                                                <label className="erp-label">{label} {!form[key] && <span className="hint">(auto: {ledgerName(accounts[key]) || 'not mapped'})</span>}</label>
                                                {accounts.allow_change ? (
                                                    <SearchablePopupSelect
                                                        listKey={`transfer_${key}_picker`}
                                                        columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                                        defaultVisibleKeys={['account_name']}
                                                        items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                                        searchKeys={['account_name', 'account_code']}
                                                        value={form[key]} onChange={id => setForm(f => ({ ...f, [key]: id || '' }))} placeholder={ledgerName(accounts[key]) || 'Auto'}
                                                    />
                                                ) : (
                                                    <input className="erp-input" disabled value={ledgerName(accounts[key]) || 'Not mapped'} />
                                                )}
                                                {accounts.allow_change && form[key] && (
                                                    <button type="button" className="text-[11px] text-blue-600" onClick={() => setForm(f => ({ ...f, [key]: '' }))}>↺ use auto</button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>
                            <button type="button" onClick={e => handleSubmit(e, true)} className="erp-btn">💾 Save as Draft</button>
                            <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </form>
            )}
        </div>

        <div className="max-w-6xl mx-auto px-4 mt-4">
            <div className="flex items-center gap-2 mb-2 text-sm">
                <span className="text-gray-500">Show:</span>
                <select className="erp-select" style={{ width: 'auto' }} value={listFilter} onChange={e => setListFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="draft">Drafts only</option>
                    <option value="to_receive">Pending receipt at my branch ({toReceiveCount})</option>
                    <option value="in_transit">All In Transit ({inTransitCount})</option>
                </select>
            </div>
            <ReportGrid
                columns={columns}
                rows={listRows}
                getId={r => r.id}
                storageKey="stock_transfer_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        {row.status === 'posted' && <a href={`/print/stock_transfer/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="stock_transfer" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'approved')} className="px-2 py-1 bg-indigo-600 text-white rounded text-xs">Approve</button>}
                        {row.status === 'approved' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {!['cancelled', 'posted'].includes(row.status) && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {isInTransit(row) && row.can_receive && <button onClick={() => setReceiveModal({ row, received_date: today(), receive_remarks: '' })} className="px-2 py-1 bg-orange-600 text-white rounded text-xs">📥 Receive</button>}
                        {isInTransit(row) && !row.can_receive && <span className="px-2 py-1 text-orange-600 text-xs">Awaiting {row.to_branch_name_snapshot || 'receiving branch'}</span>}
                        {row.status === 'posted' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Cancel (reverse stock)</button>}
                        {row.status === 'draft' && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
                    </div>
                )}
            />
        </div>

        {showCopyModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">Copy From — Stock Transfer</span></div>
                    <div className="p-4">
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {rows.map(r => (
                                <button key={r.id} type="button" onClick={() => handleCopyFrom(r.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{r.doc_no} <span className="text-xs text-gray-400">— {r.from_warehouse_name_snapshot} → {r.to_warehouse_name_snapshot}</span></span>
                                    <span className="text-xs text-gray-400">{r.doc_date} · {statusLabel(r)}</span>
                                </button>
                            ))}
                            {rows.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No Transfers yet to copy from.</p>}
                        </div>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setShowCopyModal(false)} className="erp-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {receiveModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <form onSubmit={handleReceive} className="bg-white rounded-xl w-full max-w-md">
                    <div className="erp-header"><span className="erp-header-title">📥 Receive — {receiveModal.row.doc_no}</span></div>
                    <div className="p-4 space-y-3">
                        <p className="text-sm text-gray-600">
                            {side(receiveModal.row.from_branch_name_snapshot, receiveModal.row.from_warehouse_name_snapshot)} → {side(receiveModal.row.to_branch_name_snapshot, receiveModal.row.to_warehouse_name_snapshot)}
                            <br /><span className="text-xs text-gray-400">Dispatched {formatDateForDisplay(receiveModal.row.doc_date, 'dual')} · Amount {Number(receiveModal.row.total_amount || 0).toFixed(2)}</span>
                        </p>
                        <div className="erp-field">
                            <label className="erp-label">Receiving Date <span className="req">*</span> {receiveModal.received_date && <span className="hint">({formatDateForDisplay(receiveModal.received_date, 'nepali')} BS)</span>}</label>
                            <input type="date" className="erp-input" required min={String(receiveModal.row.doc_date).slice(0, 10)} value={receiveModal.received_date} onChange={e => setReceiveModal(m => ({ ...m, received_date: e.target.value }))} />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Remarks</label>
                            <input className="erp-input" value={receiveModal.receive_remarks} onChange={e => setReceiveModal(m => ({ ...m, receive_remarks: e.target.value }))} placeholder="e.g. received in good condition" />
                        </div>
                        <p className="text-xs text-gray-500">Stock enters {receiveModal.row.to_warehouse_name_snapshot || 'the receiving warehouse'} on the receiving date{receiveModal.row.gl_posted ? ', and the Goods in Transit entry is cleared' : ''}.</p>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setReceiveModal(null)} className="erp-btn">Cancel</button>
                            <button type="submit" className="erp-btn primary">Receive</button>
                        </div>
                    </div>
                </form>
            </div>
        )}

        {auditModal && <RecordHistory table="stock_transfers" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/stock-transfers/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
