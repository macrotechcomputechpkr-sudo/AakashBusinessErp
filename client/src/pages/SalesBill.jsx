// =============================================
// SalesBill.jsx
// The customer invoice - pulls forward from Sales Delivery (normal
// path) or directly from Sales Order (cash/counter sale), credit-
// checked, Batch/Serial picker for any direct (non-delivery-sourced)
// lines.
// =============================================

import ProductCompanyField, { filterProductsByCompany } from '../components/ProductCompanyField';
import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';
import BatchSerialPicker from '../components/BatchSerialPicker';
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import ProductTermBar from '../components/ProductTermBar';
import { resolveDualUomEntryMode, onPrimaryQtyChange, onSecondaryQtyChange, validateFixedSecondary, dualBaseQty } from '../utils/dualUomEntryMode';

const emptyDetailRow = () => ({ product_id: '', qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', rate: '', rate_basis: 'primary', discount_percent: '', tax_percent: '', free_qty: '', free_alt_qty: '', warehouse_id: '', batch_no: '', serial_no: '', source_delivery_detail_id: '', source_order_detail_id: '' });

const emptyForm = {
    product_company_id: '', doc_date: new Date().toISOString().slice(0, 10), source_delivery_id: '', source_order_id: '',
    customer_ledger_id: '', customer_sub_ledger_id: '', sales_account_ledger_id: '', sales_sub_ledger_id: '', agent_id: '', invoice_type: 'credit', currency: 'NPR',
    due_date: '', warehouse_id: '', numbering_category_id: '', remarks_text: '', narration: '', rate_type: 'exclusive',
    cost_center_id: '', business_unit_id: '', area_id: '', route_id: '',
    details: [emptyDetailRow()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['customer_ledger_id', 'doc_date', 'due_date', 'invoice_type', 'narration', 'warehouse_id'];

export default function SalesBill() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('sales_bill', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showDeliveryModal, setShowDeliveryModal] = useState(false);
    const [postedDeliveries, setPostedDeliveries] = useState([]);
    const [auditModal, setAuditModal] = useState(null);
    const [pendingCreditBlock, setPendingCreditBlock] = useState(null);

    const [customers, setCustomers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [agents, setAgents] = useState([]);
    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [areas, setAreas] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [remarks, setRemarks] = useState([]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addDetailRow(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, ldg, sl, ag, prod, un, wh, cc, bu, ar, rt, rmk, sd, sysCtrl] = await Promise.all([
                authFetch('/api/sales-bills'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/products'),
                authFetch('/api/product-units'),
                authFetch('/api/warehouses'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/areas'),
                authFetch('/api/routes'),
                authFetch('/api/remarks'),
                authFetch('/api/sales-deliveries'),
                authFetch('/api/system-control')
            ]);
            setRows(req.data || []);
            setCustomers(ldg.data || []);
            setSubLedgers(sl.data || []);
            setAgents(ag.data || []);
            setProducts(prod.data || []);
            setUnits(un.data || []);
            setWarehouses(wh.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setAreas(ar.data || []);
            setRoutes(rt.data || []);
            setRemarks(rmk.data || []);
            setPostedDeliveries((sd.data || []).filter(d => d.status === 'posted'));
            setDualUomEntryMode(resolveDualUomEntryMode(sysCtrl.data));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setPendingCreditBlock(null); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => {
        setForm(f => ({ ...f, details: f.details.length > 1 ? f.details.filter((_, i) => i !== idx) : f.details }));
        // Re-index selectedRowIndexes so a deletion doesn't leave stale
        // indexes pointing at the wrong (shifted) row.
        setSelectedRowIndexes(cur => cur.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
    };
    const updateDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));
    const productMaintainsBatch = (productId) => !!products.find(p => p.id === productId)?.maintain_batch;
    const productTracksSerial = (productId) => !!products.find(p => p.id === productId)?.track_serial_number;
    const productIsFixedDualUom = (productId) => products.find(p => p.id === productId)?.uom_mode === 'fixed_dual';
    // FEATURE: "Fixed Dual UOM" - conversion factor for the product's
    // own designated primary unit (e.g. how many Pieces = 1 Carton),
    // read from the already-loaded product_unit_rates rather than a
    // separate round-trip.
    const dualConversionFactor = (productId) => {
        const product = products.find(p => p.id === productId);
        const rate = (product?.product_unit_rates || []).find(r => r.unit_id === product?.dual_uom_primary_unit_id);
        return Number(rate?.conversion_factor) || 1;
    };

    const handleProductSelect = async (idx, productId) => {
        const product = products.find(p => p.id === productId);
        if (product?.uom_mode === 'fixed_dual') {
            updateDetailRow(idx, { product_id: productId, uom_id: product.dual_uom_primary_unit_id || '', alt_unit_id: product.base_unit_id || '', rate_basis: 'primary' });
        } else {
            updateDetailRow(idx, { product_id: productId, uom_id: product?.base_unit_id || '' });
        }
        if (!form.customer_ledger_id) { updateDetailRow(idx, { rate: product?.sales_rate_sr1 || 0 }); return; }
        try {
            const res = await authFetch(`/api/resolve-sales-price?customer_ledger_id=${form.customer_ledger_id}&product_id=${productId}`);
            updateDetailRow(idx, { rate: res.data.rate, discount_percent: res.data.discount_percent });
        } catch {
            updateDetailRow(idx, { rate: product?.sales_rate_sr1 || 0 });
        }
    };

    // Mirrors the backend's computeDualAmount exactly - a rate quoted
    // per Carton prices the FRACTIONAL Carton count implied by the
    // combined (Carton + loose Piece) total, not just the Carton count
    // typed in.
    // FEATURE: "product wise sales history kunai key thichera herna
    // milne" - F1 on a product row (matching the reference software's
    // own key binding) pops up what this customer has bought/been
    // billed for that SAME product before - batch, qty, rate, and
    // (when relevant) the dual-UOM breakdown exactly as it was billed.
    const [historyModal, setHistoryModal] = useState(null);
    const openProductHistory = async (productId) => {
        if (!form.customer_ledger_id || !productId) return showAlert('Select Customer and Product first', 'danger');
        try {
            const res = await authFetch(`/api/customer-product-history?customer_ledger_id=${form.customer_ledger_id}&product_id=${productId}`);
            const productName = products.find(p => p.id === productId)?.product_name || '';
            setHistoryModal({ productName, entries: res.data || [] });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };
    const handleProductRowKeyDown = (e, productId) => {
        if (e.key === 'F1') { e.preventDefault(); openProductHistory(productId); }
    };

    const lineGross = (d) => {
        if (productIsFixedDualUom(d.product_id) && d.alt_qty) {
            const factor = dualConversionFactor(d.product_id);
            const totalBaseQty = dualBaseQty(d.qty, d.alt_qty, factor, dualUomEntryMode.mode);
            return d.rate_basis === 'primary' ? (totalBaseQty / factor) * (Number(d.rate) || 0) : totalBaseQty * (Number(d.rate) || 0);
        }
        return (Number(d.qty) || 0) * (Number(d.rate) || 0);
    };
    const lineAmount = (d) => {
        const gross = lineGross(d);
        const discountAmt = gross * (Number(d.discount_percent) || 0) / 100;
        const afterDiscount = gross - discountAmt;
        const taxAmt = afterDiscount * (Number(d.tax_percent) || 0) / 100;
        return afterDiscount + taxAmt;
    };
    const grandTotal = form.details.reduce((sum, d) => sum + lineAmount(d), 0);
    const [selectedRowIndexes, setSelectedRowIndexes] = useState([]);
    const [dualUomEntryMode, setDualUomEntryMode] = useState({ mode: 'fixed', reverseEnabled: false });
    const applyProductTerm = (updates) => {
        setForm(f => {
            const details = [...f.details];
            updates.forEach(({ idx, discount_percent }) => { details[idx] = { ...details[idx], discount_percent }; });
            return { ...f, details };
        });
    };

    const handlePullFromDelivery = async (deliveryId) => {
        try {
            const res = await authFetch(`/api/sales-deliveries/${deliveryId}`);
            const src = res.data;
            setEditingId(null);
            setForm({
                ...emptyForm, source_delivery_id: src.id, source_order_id: src.source_order_id || '',
                customer_ledger_id: src.customer_ledger_id, customer_sub_ledger_id: src.customer_sub_ledger_id, product_company_id: src.product_company_id || '',
                agent_id: src.agent_id, warehouse_id: src.warehouse_id,
                cost_center_id: src.cost_center_id, business_unit_id: src.business_unit_id, area_id: src.area_id, route_id: src.route_id,
                details: (src.details || []).length > 0
                    ? src.details.map(d => ({ ...emptyDetailRow(), product_id: d.product_id, uom_id: d.uom_id, rate: d.rate, warehouse_id: d.warehouse_id, batch_no: d.batch_no, serial_no: d.serial_no, source_delivery_detail_id: d.id, alt_qty: d.alt_qty ? (Math.max(0, Number(d.alt_qty) - Number(d.alt_qty_billed || 0)) || '') : '', alt_unit_id: d.alt_unit_id || '', rate_basis: d.rate_basis || 'primary', qty: Math.max(0, Number(d.qty) - Number(d.qty_billed || 0)) }))
                        .filter(d => Number(d.qty) > 0 || Number(d.alt_qty) > 0)
                    : [emptyDetailRow()]
            });
            setShowForm(true);
            setShowDeliveryModal(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showAlert(`Pulled from ${src.doc_no} - only not-yet-billed qty carried forward`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleSubmit = async (e, saveAsDraft = false, overrideCreditBlock = false) => {
        if (e) e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        const validDetails = form.details.filter(d => d.product_id && (Number(d.qty) > 0 || Number(d.alt_qty) > 0));
        if (!saveAsDraft && validDetails.length === 0) return showAlert('At least one complete line item is required', 'danger');
        try {
            const payload = {
                ...form, details: validDetails,
                ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}),
                ...(overrideCreditBlock ? { override_credit_block: true } : {})
            };
            let res;
            if (editingId) {
                res = await authFetch(`/api/sales-bills/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : 'Sales Bill updated', 'success');
            } else {
                res = await authFetch('/api/sales-bills', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Sales Bill ${res.data.doc_no} created`, 'success');
            }
            if (res.warning) showAlert(res.warning, 'warning');
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            if (err.credit_blocked) { setPendingCreditBlock(err.message); return; }
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/sales-bills/${row.id}`);
            setEditingId(row.id);
            setForm({ ...emptyForm, ...res.data, doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date, due_date: res.data.due_date?.slice(0, 10) || '', details: (res.data.details || []).length > 0 ? res.data.details : [emptyDetailRow()] });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt('Reason for cancelling this Bill?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            await authFetch(`/api/sales-bills/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            showAlert(`Marked as ${status}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/sales-bills/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const openAuditTrail = async (row) => {
        try {
            const res = await authFetch(`/api/sales-bills/${row.id}/audit-trail`);
            setAuditModal({ doc_no: row.doc_no, entries: res.data || [] });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'customer_name_snapshot', label: 'Customer', type: 'text', render: r => r.customer_name_snapshot || '—' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'credit_check_result', label: 'Credit', type: 'text', render: r => r.credit_check_result === 'warned' ? '⚠ Warned' : r.credit_check_result === 'overridden' ? '🔓 Overridden' : '—' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">💵 Sales Bill / Invoice</span>
                <div className="erp-header-actions">
                    <button onClick={() => setShowDeliveryModal(true)} className="erp-header-btn">🚚 Pull from Delivery</button>
                    <button onClick={() => { resetForm(); setShowForm(s => !s); }} className={`erp-header-btn ${showForm ? '' : 'primary'}`}>
                        {showForm ? '✕ Close' : '➕ New (Direct Sale)'}
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

            {pendingCreditBlock && (
                <div className="mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 bg-red-50 border-red-500 text-red-800">
                    <p className="mb-2">🚫 {pendingCreditBlock}</p>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => handleSubmit(null, false, true)} className="px-3 py-1 bg-red-600 text-white rounded text-xs">Override and Save Anyway</button>
                        <button type="button" onClick={() => setPendingCreditBlock(null)} className="px-3 py-1 border rounded text-xs">Cancel</button>
                    </div>
                </div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} ref={formRef}>
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>} {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className={efc.isVisible('customer_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Customer <span className="req">*</span> {efc.isRequired('customer_ledger_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="sb_customer_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={customers} getId={c => c.id} getLabel={c => c.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.customer_ledger_id} onChange={id => setForm({ ...form, customer_ledger_id: id })} placeholder="Select Customer"
                            />
                        </div>
                        <ProductCompanyField side="sales" form={form} setForm={setForm} products={products} emptyRow={emptyDetailRow} />
                        <div className={efc.isVisible('invoice_type') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Cash / Credit {efc.isRequired('invoice_type') && <span className="req">*</span>}</label>
                            <select disabled={efc.isReadonly('invoice_type')} className="erp-select" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
                                <option value="credit">Credit</option>
                                <option value="cash">Cash</option>
                            </select>
                        </div>
                        <div className={efc.isVisible('warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Warehouse {efc.isRequired('warehouse_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="sb_warehouse_picker"
                                columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                defaultVisibleKeys={['warehouse_name']}
                                items={warehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                searchKeys={['warehouse_name', 'warehouse_code']}
                                value={form.warehouse_id} onChange={id => setForm({ ...form, warehouse_id: id })} placeholder="Select Warehouse"
                            />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Sales Account <span className="text-xs text-gray-400 normal-case">(blank = System default)</span></label>
                            <SearchablePopupSelect
                                listKey="sb_sales_account_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={customers} getId={l => l.id} getLabel={l => l.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.sales_account_ledger_id || ''} onChange={id => setForm({ ...form, sales_account_ledger_id: id, sales_sub_ledger_id: '' })} placeholder="System default"
                            />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Sales Sub-Ledger</label>
                            <select className="erp-select" value={form.sales_sub_ledger_id || ''} disabled={!form.sales_account_ledger_id}
                                onChange={e => setForm({ ...form, sales_sub_ledger_id: e.target.value })}>
                                <option value="">{form.sales_account_ledger_id ? 'None' : 'Choose a Sales Account first'}</option>
                                {subLedgers.filter(sl => sl.main_ledger_id === form.sales_account_ledger_id).map(sl => <option key={sl.id} value={sl.id}>{sl.sub_ledger_name}</option>)}
                            </select>
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Sales Account</label>
                            <SearchablePopupSelect
                                listKey="sb_sales_account_picker"
                                columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]}
                                defaultVisibleKeys={['name']}
                                items={customers.map(l => ({ id: l.id, code: l.account_code, name: l.account_name }))} getId={x => x.id} getLabel={x => x.name}
                                searchKeys={['name', 'code']}
                                value={form.sales_account_ledger_id} onChange={id => setForm({ ...form, sales_account_ledger_id: id, sales_sub_ledger_id: '' })} placeholder="System default"
                            />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Sales Sub-Ledger</label>
                            <SearchablePopupSelect
                                listKey="sb_sales_subledger_picker"
                                columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]}
                                defaultVisibleKeys={['name']}
                                items={subLedgers.filter(x => x.main_ledger_id === form.sales_account_ledger_id).map(x => ({ id: x.id, code: x.sub_ledger_code, name: x.sub_ledger_name }))} getId={x => x.id} getLabel={x => x.name}
                                searchKeys={['name', 'code']}
                                value={form.sales_sub_ledger_id} onChange={id => setForm({ ...form, sales_sub_ledger_id: id })} placeholder="None"
                            />
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="sales_bill" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        {form.source_delivery_id && (
                            <p className="text-xs text-gray-400 mb-2">🚚 Pulled from a Sales Delivery — only not-yet-billed qty was carried forward, and its stock movement is not duplicated.</p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className="erp-field">
                                <label className="erp-label">Salesman/Agent</label>
                                <SearchablePopupSelect
                                    listKey="sb_agent_picker"
                                    columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                    defaultVisibleKeys={['agent_name']}
                                    items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                    searchKeys={['agent_name', 'agent_code']}
                                    value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })} placeholder="Select Agent"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Customer Sub Ledger</label>
                                <SearchablePopupSelect
                                    listKey="sb_customer_subledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.customer_sub_ledger_id} onChange={id => setForm({ ...form, customer_sub_ledger_id: id })} placeholder="Select Sub Ledger"
                                />
                            </div>
                            <div className={efc.isVisible('due_date') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Due Date {efc.isRequired('due_date') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('due_date')} type="date" className="erp-input" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Area</label>
                                <SearchablePopupSelect
                                    listKey="sb_area_picker"
                                    columns={[{ key: 'area_code', label: 'Code' }, { key: 'area_name', label: 'Name' }]}
                                    defaultVisibleKeys={['area_name']}
                                    items={areas} getId={a => a.id} getLabel={a => a.area_name}
                                    searchKeys={['area_name', 'area_code']}
                                    value={form.area_id} onChange={id => setForm({ ...form, area_id: id })} placeholder="Select Area"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Route</label>
                                <SearchablePopupSelect
                                    listKey="sb_route_picker"
                                    columns={[{ key: 'route_code', label: 'Code' }, { key: 'route_name', label: 'Name' }]}
                                    defaultVisibleKeys={['route_name']}
                                    items={routes} getId={r => r.id} getLabel={r => r.route_name}
                                    searchKeys={['route_name', 'route_code']}
                                    value={form.route_id} onChange={id => setForm({ ...form, route_id: id })} placeholder="Select Route"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Cost Center</label>
                                <SearchablePopupSelect
                                    listKey="sb_cost_center_picker"
                                    columns={[{ key: 'cost_center_code', label: 'Code' }, { key: 'cost_center_name', label: 'Name' }]}
                                    defaultVisibleKeys={['cost_center_name']}
                                    items={costCenters} getId={c => c.id} getLabel={c => c.cost_center_name}
                                    searchKeys={['cost_center_name', 'cost_center_code']}
                                    value={form.cost_center_id} onChange={id => setForm({ ...form, cost_center_id: id })} placeholder="Select Cost Center"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Unit</label>
                                <SearchablePopupSelect
                                    listKey="sb_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Rate Type</label>
                                <select className="erp-select" value={form.rate_type} onChange={e => setForm({ ...form, rate_type: e.target.value })}>
                                    <option value="exclusive">Exclusive of Tax</option>
                                    <option value="inclusive">Inclusive of Tax</option>
                                </select>
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="sb-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="sb-remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Details</h2>
                        <ProductTermBar
                            details={form.details}
                            selectedIndexes={selectedRowIndexes}
                            onSelectedIndexesChange={setSelectedRowIndexes}
                            lineGross={lineGross}
                            onApply={applyProductTerm}
                        />
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table min-w-[1300px]">
                                <thead>
                                    <tr>
                                        <th className="w-8"></th>
                                        <th className="w-56">Product</th>
                                        <th className={`w-24 ${efc.isVisible('qty', 'detail') ? '' : 'hidden'}`}>Qty</th>
                                        <th className="w-28">UOM</th>
                                        <th className={`w-24 ${efc.isVisible('rate', 'detail') ? '' : 'hidden'}`}>Rate</th>
                                        <th className="w-20">Disc %</th>
                                        <th className={`w-20 ${efc.isVisible('tax_percent', 'detail') ? '' : 'hidden'}`}>Tax %</th>
                                        <th className="w-24">Amount</th>
                                        <th className="w-24">Free Qty</th>
                                        <th className="w-40">Warehouse</th>
                                        <th className="w-40">Batch/Serial</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.details.map((d, idx) => (
                                        <tr key={idx}>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRowIndexes.includes(idx)}
                                                    onChange={e => setSelectedRowIndexes(cur => e.target.checked ? [...cur, idx] : cur.filter(i => i !== idx))}
                                                />
                                            </td>
                                            <td onKeyDown={e => handleProductRowKeyDown(e, d.product_id)}>
                                                <div className="flex items-center gap-1">
                                                    <div className="flex-1">
                                                        <SearchablePopupSelect
                                                            listKey="sb_product_picker"
                                                            columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                            defaultVisibleKeys={['product_name']}
                                                            items={filterProductsByCompany(products, form.product_company_id)} getId={p => p.id} getLabel={p => p.product_name}
                                                            searchKeys={['product_name', 'product_code']}
                                                            value={d.product_id} onChange={id => handleProductSelect(idx, id)} placeholder="Product (F1 = history)"
                                                        />
                                                    </div>
                                                    {d.product_id && (
                                                        <button type="button" tabIndex={-1} onClick={() => openProductHistory(d.product_id)} title="Last Sales History (F1)" className="text-gray-400 hover:text-blue-600 text-sm px-1">🕐</button>
                                                    )}
                                                </div>
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
                                            <td>
                                                {productIsFixedDualUom(d.product_id) ? (
                                                    <span className="text-xs text-gray-400">{units.find(u => u.id === d.uom_id)?.unit_name}/{units.find(u => u.id === d.alt_unit_id)?.unit_name}</span>
                                                ) : (
                                                    <select className="erp-select" value={d.uom_id} onChange={e => updateDetailRow(idx, { uom_id: e.target.value })}>
                                                        <option value="">UOM</option>
                                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                    </select>
                                                )}
                                            </td>
                                            <td className={efc.isVisible('rate', 'detail') ? '' : 'hidden'}>
                                                <input disabled={efc.isReadonly('rate', 'detail')} type="number" step="0.01" className="erp-input" value={d.rate} onChange={e => updateDetailRow(idx, { rate: e.target.value })} />
                                                {productIsFixedDualUom(d.product_id) && (
                                                    <select className="erp-select mt-1" style={{ fontSize: '10px', height: '22px' }} value={d.rate_basis} onChange={e => updateDetailRow(idx, { rate_basis: e.target.value })}>
                                                        <option value="primary">per {units.find(u => u.id === d.uom_id)?.unit_name || 'Primary'}</option>
                                                        <option value="secondary">per {units.find(u => u.id === d.alt_unit_id)?.unit_name || 'Secondary'}</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td><input type="number" step="0.01" className="erp-input" value={d.discount_percent} onChange={e => updateDetailRow(idx, { discount_percent: e.target.value })} /></td>
                                            <td className={efc.isVisible('tax_percent', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('tax_percent', 'detail')} type="number" step="0.01" className="erp-input" value={d.tax_percent} onChange={e => updateDetailRow(idx, { tax_percent: e.target.value })} /></td>
                                            <td className="text-gray-500">{lineAmount(d).toFixed(2)}</td>
                                            <td>
                                                {productIsFixedDualUom(d.product_id) ? (
                                                    <div className="flex flex-col gap-1">
                                                        <input type="number" step="0.0001" className="erp-input" style={{ width: '60px' }} value={d.free_qty} onChange={e => updateDetailRow(idx, { free_qty: e.target.value })} placeholder="0" />
                                                        <input type="number" step="0.0001" className="erp-input" style={{ width: '60px' }} value={d.free_alt_qty} onChange={e => updateDetailRow(idx, { free_alt_qty: e.target.value })} placeholder="0" />
                                                    </div>
                                                ) : (
                                                    <input type="number" step="0.0001" className="erp-input" value={d.free_qty} onChange={e => updateDetailRow(idx, { free_qty: e.target.value })} placeholder="0" />
                                                )}
                                            </td>
                                            <td>
                                                <select className="erp-select" value={d.warehouse_id} onChange={e => updateDetailRow(idx, { warehouse_id: e.target.value })}>
                                                    <option value="">(document default)</option>
                                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                                </select>
                                            </td>
                                            <td>
                                                {productTracksSerial(d.product_id) ? (
                                                    <div className="flex items-center gap-1">
                                                        <input className="erp-input" value={d.serial_no} onChange={e => updateDetailRow(idx, { serial_no: e.target.value })} placeholder="Serial No" />
                                                        <BatchSerialPicker mode="serial" productId={d.product_id} onSelect={sel => updateDetailRow(idx, sel)} />
                                                    </div>
                                                ) : productMaintainsBatch(d.product_id) ? (
                                                    <div className="flex items-center gap-1">
                                                        <input className="erp-input" value={d.batch_no} onChange={e => updateDetailRow(idx, { batch_no: e.target.value })} placeholder="Batch" />
                                                        <BatchSerialPicker mode="batch" productId={d.product_id} warehouseId={d.warehouse_id || form.warehouse_id} onSelect={sel => updateDetailRow(idx, sel)} />
                                                    </div>
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
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
            <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={showDraftsOnly} onChange={e => setShowDraftsOnly(e.target.checked)} />
                    Show Drafts only
                </label>
            </div>
            <ReportGrid
                columns={columns}
                rows={showDraftsOnly ? rows.filter(r => r.status === 'draft') : rows}
                getId={r => r.id}
                storageKey="sales_bill_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        {row.status === 'draft' && <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>}
                        {row.status === 'posted' && <a href={`/print/sales_bill/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {row.status !== 'cancelled' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {row.status === 'draft' && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
                    </div>
                )}
            />
        </div>

        {historyModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-3xl max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">🕐 Last Sales History — {historyModal.productName}</span></div>
                    <div className="p-4">
                        {historyModal.entries.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-6">No previous sales of this product to this customer yet.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead>
                                        <tr><th>Bill Date</th><th>Bill No</th><th>Batch</th><th>Qty</th><th>Free</th><th>Rate</th><th>Disc %</th><th>Disc Amt</th><th>Amount</th><th>Source</th></tr>
                                    </thead>
                                    <tbody>
                                        {historyModal.entries.map((h, i) => (
                                            <tr key={i}>
                                                <td>{formatDateForDisplay(h.doc_date, 'dual')}</td>
                                                <td>{h.doc_no}</td>
                                                <td>{h.batch_no || '—'}</td>
                                                <td>{h.qty}{h.alt_qty ? ` + ${h.alt_qty} ${h.alt_unit_name || ''}` : ''} {h.uom_name_snapshot}</td>
                                                <td>{(h.free_qty || h.free_alt_qty) ? `${h.free_qty || 0} ${h.uom_name_snapshot || ''}${h.free_alt_qty ? ` + ${h.free_alt_qty} ${h.alt_unit_name || ''}` : ''}` : '—'}</td>
                                                <td>{Number(h.rate).toFixed(2)}{h.rate_basis ? ` /${h.rate_basis}` : ''}</td>
                                                <td>{Number(h.discount_percent || 0).toFixed(2)}</td>
                                                <td>{Number(h.discount_amount || 0).toFixed(2)}</td>
                                                <td>{Number(h.amount).toFixed(2)}</td>
                                                <td className="text-xs text-gray-400">{h.source}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setHistoryModal(null)} className="erp-btn">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {showDeliveryModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">Pull from Sales Delivery</span></div>
                    <div className="p-4">
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {postedDeliveries.map(d => (
                                <button key={d.id} type="button" onClick={() => handlePullFromDelivery(d.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{d.doc_no} <span className="text-xs text-gray-400">— {d.customer_name_snapshot}</span></span>
                                    <span className="text-xs text-gray-400">{d.doc_date} · {d.total_amount?.toFixed(2)}</span>
                                </button>
                            ))}
                            {postedDeliveries.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No Posted deliveries available to pull from.</p>}
                        </div>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setShowDeliveryModal(false)} className="erp-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {auditModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                    <h3 className="font-semibold text-lg mb-4">History — {auditModal.doc_no}</h3>
                    {auditModal.entries.length === 0 && <p className="text-sm text-gray-400">No history recorded yet.</p>}
                    <div className="space-y-2">
                        {auditModal.entries.map(e => (
                            <div key={e.id} className="border rounded-lg px-3 py-2 text-sm">
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>{e.action}</span>
                                    <span>{e.performer?.full_name || 'Unknown'} · {new Date(e.performed_at).toLocaleString()}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end mt-4">
                        <button onClick={() => setAuditModal(null)} className="px-4 py-2 border rounded-lg">Close</button>
                    </div>
                </div>
            </div>
        )}
        </div>
        </Layout>
    );
}
