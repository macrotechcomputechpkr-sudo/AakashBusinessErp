// =============================================
// SalesDelivery.jsx
// Goods physically leaving for the customer - pulls forward from Sales
// Order, Batch/Serial picker for selecting what's actually in stock,
// negative-stock warning surfaced on posting.
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
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import { resolveDualUomEntryMode, dualBaseQty, productDualMode, productRateBasis } from '../utils/dualUomEntryMode';
import UdfValuesModal from '../components/UdfValuesModal';
import RecordHistory from '../components/RecordHistory';
import { priceUrl, lineUnitOf, useSlabRepricing } from '../utils/salesPricing';
import RateTypeField, { useEntryRateType } from '../components/entry/RateTypeField';
import useEntrySettings, { showsProductTerms } from '../components/entry/useEntrySettings';
import DocNumberField from '../components/entry/DocNumberField';
import PendingDocsPanel, { mergePulled } from '../components/entry/PendingDocsPanel';
import { PartyDetailsPanel, emptyPartyInfo, savePartyInfo, partyInfoFromDoc } from '../components/entry/PartyFooterTabs';
import SalesLineGrid, { useLineGridControl, lineTotals } from '../components/entry/SalesLineGrid';
import { EntryFooter, useEntryHotkeys, latestOf } from '../components/entry/EntryParts';

import { dualHelpers } from '../components/entry/dualHelpers';
import DocActions, { asNewCopy, finalizeEntry } from '../components/entry/DocActions';
import EntryFillBar from '../components/entry/EntryFillBar';
import { saveEntryDraft, finishEntryDraft } from '../components/entry/entryDrafts';

const emptyDetailRow = () => ({ product_id: '', qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', rate_basis: 'primary', rate: '', warehouse_id: '', batch_no: '', serial_no: '', mfg_date: '', exp_date: '', source_order_detail_id: '' });

const emptyForm = {
    product_company_id: '', doc_date: new Date().toISOString().slice(0, 10), source_order_id: '', source_quotation_id: '', numbering_category_id: '',
    customer_ledger_id: '', customer_sub_ledger_id: '', agent_id: '', warehouse_id: '',
    vehicle_no: '', driver_name: '', transport_master_id: '', delivery_address: '',
    remarks_text: '', narration: '', cost_center_id: '', business_unit_id: '', area_id: '', route_id: '',
    details: [emptyDetailRow()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['customer_ledger_id', 'delivery_address', 'doc_date', 'driver_name', 'narration', 'vehicle_no', 'warehouse_id'];

export default function SalesDelivery() {
    const [dualUomEntryMode, setDualUomEntryMode] = useState({ mode: 'fixed', reverseEnabled: false });
    // a product's own dual-UOM entry mode (Product Master) over System Control's
    const dualModeOf = pid => productDualMode(products.find(p => p.id === pid), dualUomEntryMode);
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('sales_delivery', EFC_RENDERED_KEYS);
    const settings = useEntrySettings();
    // System Control: does this entry show item charges? (else only the Charges Summary)
    const itemCharges = showsProductTerms(settings, 'sales_delivery');
    const termCols = [];
    const popupTerms = !!settings?.popupTerms?.includes('sales');
    const [partyInfo, setPartyInfo] = useState(emptyPartyInfo());
    const [pulledDocs, setPulledDocs] = useState([]);

    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showOrderModal, setShowOrderModal] = useState(false);
    const [confirmedOrders, setConfirmedOrders] = useState([]);
    const [auditModal, setAuditModal] = useState(null);

    const [customers, setCustomers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [agents, setAgents] = useState([]);
    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [transports, setTransports] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [areas, setAreas] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [remarks, setRemarks] = useState([]);
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

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addDetailRow(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, ldg, sl, ag, prod, un, wh, tm, cc, bu, ar, rt, rmk, so, sysCtrl] = await Promise.all([
                authFetch('/api/sales-deliveries'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/products'),
                authFetch('/api/product-units'),
                authFetch('/api/warehouses'),
                authFetch('/api/transport-master'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/areas'),
                authFetch('/api/routes'),
                authFetch('/api/remarks'),
                authFetch('/api/sales-orders'),
                authFetch('/api/system-control')
            ]);
            setRows(req.data || []);
            setCustomers(ldg.data || []);
            setSubLedgers(sl.data || []);
            setAgents(ag.data || []);
            setProducts(prod.data || []);
            setUnits(un.data || []);
            setWarehouses(wh.data || []);
            setTransports(tm.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setAreas(ar.data || []);
            setRoutes(rt.data || []);
            setRemarks(rmk.data || []);
            setConfirmedOrders((so.data || []).filter(o => ['confirmed', 'partially_delivered'].includes(o.status)));
            setDualUomEntryMode(resolveDualUomEntryMode(sysCtrl.data));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setPartyInfo(emptyPartyInfo()); setPulledDocs([]); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => setForm(f => ({ ...f, details: f.details.length > 1 ? f.details.filter((_, i) => i !== idx) : f.details }));
    const setDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));
    // qty / value slab discounts: re-price the line when its qty or unit changes
    const reprice = useSlabRepricing(authFetch, form, setDetailRow, { withDiscount: false });
    const updateDetailRow = (idx, patch) => { setDetailRow(idx, patch); reprice.onChange(idx, patch); };
    // Rate Type (Sr1-Sr5): the customer's by default; picking another prices every line again at it
    const rateType = useEntryRateType(authFetch, form.customer_ledger_id);
    const onRateTypeChanged = async (tier) => {
        const caption = rateType.captionOf(tier);
        if (tier !== rateType.customerTier) showAlert(`Rate type is now ${caption} - different from this customer's (${rateType.captionOf(rateType.customerTier)}). Line rates are taken again at ${caption}.`, 'warning');
        else showAlert(`Rate type back to the customer's (${caption}); line rates taken again.`, 'info');
        if (!form.customer_ledger_id) return;
        const lines = form.details.map((d, idx) => ({ d, idx })).filter(x => x.d.product_id);
        for (const { d, idx } of lines) {
            try {
                const res = await authFetch(priceUrl(form.customer_ledger_id, d.product_id, { sr_tier: tier !== rateType.customerTier ? tier : undefined, unit_id: d.uom_id, qty: d.qty }));
                setDetailRow(idx, { rate: res.data.rate });
            } catch { /* keep the line's rate */ }
        }
    };
    const productIsFixedDualUom = (productId) => products.find(p => p.id === productId)?.uom_mode === 'fixed_dual';
    const dualConversionFactor = (productId) => {
        const product = products.find(p => p.id === productId);
        const rate = (product?.product_unit_rates || []).find(r => r.unit_id === product?.dual_uom_primary_unit_id);
        return Number(rate?.conversion_factor) || 1;
    };

    const handleProductSelect = async (idx, productId, unitId) => {
        const product = products.find(p => p.id === productId);
        if (product?.uom_mode === 'fixed_dual') {
            updateDetailRow(idx, { product_id: productId, uom_id: product.dual_uom_primary_unit_id || '', alt_unit_id: product.base_unit_id || '', rate_basis: productRateBasis(product), rate: product?.sales_rate_sr1 || 0 });
        } else {
            updateDetailRow(idx, { product_id: productId, uom_id: unitId || product?.base_unit_id || '', rate: product?.sales_rate_sr1 || 0 });
        }
        // FIX: use the customer's Rate Category (SR1..SR5) like Sales Bill /
        // Order / Quotation do - the challan used to always show SR1.
        // (Delivery lines carry no discount column, so only the rate applies.)
        if (!form.customer_ledger_id || !productId) return;
        try {
            const res = await authFetch(priceUrl(form.customer_ledger_id, productId, { sr_tier: rateType.srTier, unit_id: lineUnitOf(product), qty: form.details[idx]?.qty, payment_term: form.payment_term }));
            if (res?.data && res.data.rate !== undefined) { setDetailRow(idx, { rate: res.data.rate }); reprice.mark(idx, res.data); }
        } catch { /* keep SR1 */ }
    };

    const lineAmount = (d) => {
        if (productIsFixedDualUom(d.product_id) && d.alt_qty) {
            const factor = dualConversionFactor(d.product_id);
            const totalBaseQty = dualBaseQty(d.qty, d.alt_qty, factor, dualModeOf(d.product_id).mode);
            return d.rate_basis === 'primary' ? (totalBaseQty / factor) * (Number(d.rate) || 0) : totalBaseQty * (Number(d.rate) || 0);
        }
        return (Number(d.qty) || 0) * (Number(d.rate) || 0);
    };
    const lineCtl = useLineGridControl();
    const lineTot = lineTotals(form.details, lineAmount, termCols, false);
    const selectedCustomer = customers.find(c => c.id === form.customer_ledger_id);
    // F7: the last challan as a new one
    useEntryHotkeys(showForm, { F7: () => { const last = latestOf(rows); if (last) copyAsNew(last); } });

    const handlePullFromOrder = async (orderId) => {
        try {
            const res = await authFetch(`/api/sales-orders/${orderId}`);
            const src = res.data;
            setEditingId(null);
            setForm({
                ...emptyForm, source_order_id: src.id,
                customer_ledger_id: src.customer_ledger_id, customer_sub_ledger_id: src.customer_sub_ledger_id, product_company_id: src.product_company_id || '',
                agent_id: src.agent_id, warehouse_id: src.warehouse_id,
                cost_center_id: src.cost_center_id, business_unit_id: src.business_unit_id, area_id: src.area_id, route_id: src.route_id,
                details: (src.details || []).length > 0
                    ? src.details.map(d => ({ ...emptyDetailRow(), product_id: d.product_id, uom_id: d.uom_id, alt_qty: d.alt_qty ? (Math.max(0, Number(d.alt_qty) - Number(d.alt_qty_delivered || 0)) || '') : '', alt_unit_id: d.alt_unit_id || '', rate_basis: d.rate_basis || 'primary', rate: d.rate, warehouse_id: d.warehouse_id, batch_no: d.batch_no, source_order_detail_id: d.id, qty: Math.max(0, Number(d.qty) - Number(d.qty_delivered || 0)) }))
                        .filter(d => Number(d.qty) > 0 || Number(d.alt_qty) > 0)
                    : [emptyDetailRow()]
            });
            setShowForm(true);
            setShowOrderModal(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showAlert(`Pulled from ${src.doc_no} - only not-yet-delivered qty carried forward`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleSubmit = async (e, saveAsDraft = false) => {

        // Save as Draft (new entry): kept apart as a temporary draft - no number, no accounts / stock effect

        if (saveAsDraft && !editingId) { if (e) e.preventDefault(); if (await saveEntryDraft(authFetch, 'sales_delivery', form)) { resetForm(); setShowForm(false); } return; }
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        const validDetails = form.details.filter(d => d.product_id && (Number(d.qty) > 0 || Number(d.alt_qty) > 0));
        if (!saveAsDraft) {
            if (!form.customer_ledger_id) return showAlert('Customer is required', 'danger');
            if (!form.warehouse_id) return showAlert('Warehouse is required', 'danger');
            if (validDetails.length === 0) return showAlert('At least one complete line item is required', 'danger');
        }
        let savedId = editingId;
        try {
            const payload = { ...form, details: validDetails, ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}) };
            let postId = null;
            if (editingId) {
                await authFetch(`/api/sales-deliveries/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                postId = editingId;
                showAlert(saveAsDraft ? 'Draft saved' : 'Sales Delivery updated', 'success');
            } else {
                const res = await authFetch('/api/sales-deliveries', { method: 'POST', body: JSON.stringify(payload) }); savedId = res.data?.id;
                postId = res.data?.id;
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Sales Delivery ${res.data.doc_no} created`, 'success');
            }
            try { await savePartyInfo(authFetch, 'sales_delivery', savedId, partyInfo); } catch (pe) { showAlert(`Saved, but the party details were not: ${pe.message}`, 'warning'); }
            // Save (not Save as Draft): post it now, after its party details are stored
            if (!saveAsDraft) await finalizeEntry(authFetch, 'sales-deliveries', postId, 'posted');
            await finishEntryDraft(authFetch, 'sales_delivery');
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const copyAsNew = async (row) => { await handleEdit(row); setEditingId(null); setForm(f => asNewCopy(f, row.id)); setShowForm(true); };
    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/sales-deliveries/${row.id}`);
            setEditingId(row.id);
            setPartyInfo(res.data.party_billing_address || res.data.party_pan ? partyInfoFromDoc(res.data, res.data.customer_ledger_id) : emptyPartyInfo());
            setForm({ ...emptyForm, ...res.data, doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date, details: (res.data.details || []).length > 0 ? res.data.details : [emptyDetailRow()] });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status, overrideWarning = false) => {
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt('Reason for cancelling this Delivery?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            const res = await authFetch(`/api/sales-deliveries/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason, override_negative_stock_warning: overrideWarning }) });
            if (res.warnings?.length > 0) {
                showAlert(`Marked as ${status}, but: ${res.warnings.join('; ')}`, 'warning');
            } else {
                showAlert(`Marked as ${status}`, 'success');
            }
            load();
        } catch (err) {
            if (err.warnings?.length > 0 && window.confirm(`${err.error || err.message}\n\n${err.warnings.join('\n')}\n\nPost anyway?`)) {
                return handleStatusChange(row, status, true);
            }
            showAlert(err.message, 'danger');
        }
    };


    const [udfDoc, setUdfDoc] = useState(null);

    const openAuditTrail = (row) => setAuditModal({ id: row.id, doc_no: row.doc_no });

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'customer_name_snapshot', label: 'Customer', type: 'text', render: r => r.customer_name_snapshot || '—' },
        { key: 'warehouse_name_snapshot', label: 'Warehouse', type: 'text', render: r => r.warehouse_name_snapshot || '—' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🚚 Sales Delivery / Challan</span>
                <div className="erp-header-actions">
                    <button onClick={() => setShowOrderModal(true)} className="erp-header-btn">🧾 Pull from Order</button>
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
                <form onSubmit={handleSubmit} ref={formRef} className="ent-entry">
                    <EntryFillBar voucherType="sales_delivery" api="sales-deliveries" form={form} editing={!!editingId} onFill={p => setForm(f => ({ ...f, ...p }))} onCopy={copyAsNew} />
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <DocNumberField docDate={form.doc_date || form.voucher_date} voucherType="sales_delivery" categoryId={form.numbering_category_id} docNo={editingId ? form.doc_no : ''} value={form.doc_no} onChange={v => setForm({ ...form, doc_no: v })} />
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>} {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className={efc.isVisible('customer_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Customer <span className="req">*</span> {efc.isRequired('customer_ledger_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="sd_customer_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={customers} getId={c => c.id} getLabel={c => c.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.customer_ledger_id} onChange={id => setForm({ ...form, customer_ledger_id: id })} placeholder="Select Customer"
                            />
                        </div>
                        <RateTypeField rt={rateType} onChanged={onRateTypeChanged} />
                        <ProductCompanyField side="sales" form={form} setForm={setForm} products={products} emptyRow={emptyDetailRow} />
                        {settings?.multiWarehouse && (
                        <div className={efc.isVisible('warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Warehouse <span className="req">*</span> {efc.isRequired('warehouse_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="sd_warehouse_picker"
                                columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                defaultVisibleKeys={['warehouse_name']}
                                items={warehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                searchKeys={['warehouse_name', 'warehouse_code']}
                                value={form.warehouse_id} onChange={id => setForm({ ...form, warehouse_id: id })} placeholder="Select Warehouse"
                            />
                        </div>
                        )}
                        <div className={efc.isVisible('vehicle_no') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Vehicle No {efc.isRequired('vehicle_no') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('vehicle_no')} className="erp-input" value={form.vehicle_no} onChange={e => setForm({ ...form, vehicle_no: e.target.value })} />
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="sales_delivery" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <PendingDocsPanel target="sales_delivery" partyId={form.customer_ledger_id} efc={efc} disabled={!!editingId} pulled={pulledDocs} onPull={data => { setForm(f => mergePulled(f, data, emptyDetailRow)); setPulledDocs(p => [...p, ...data.documents.map(x => x.id)]); showAlert(`Pulled ${data.lines.length} line(s) from ${data.documents.map(x => x.doc_no).join(', ')}`, 'success'); }} />

                    <div className="erp-tab-content">
                        {form.source_order_id && (
                            <p className="text-xs text-gray-400 mb-2">🧾 Pulled from a Sales Order — only not-yet-delivered qty was carried forward.</p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className="erp-field">
                                <label className="erp-label">Salesman/Agent</label>
                                <SearchablePopupSelect
                                    listKey="sd_agent_picker"
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
                                    listKey="sd_customer_subledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.customer_sub_ledger_id} onChange={id => setForm({ ...form, customer_sub_ledger_id: id })} placeholder="Select Sub Ledger"
                                />
                            </div>
                            <div className={efc.isVisible('driver_name') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Driver Name {efc.isRequired('driver_name') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('driver_name')} className="erp-input" value={form.driver_name} onChange={e => setForm({ ...form, driver_name: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Transport</label>
                                <SearchablePopupSelect
                                    listKey="sd_transport_picker"
                                    columns={[{ key: 'transport_code', label: 'Code' }, { key: 'transport_name', label: 'Name' }]}
                                    defaultVisibleKeys={['transport_name']}
                                    items={transports} getId={t => t.id} getLabel={t => t.transport_name}
                                    searchKeys={['transport_name', 'transport_code']}
                                    value={form.transport_master_id} onChange={id => setForm({ ...form, transport_master_id: id })} placeholder="Select Transport"
                                />
                            </div>
                            <div className={efc.isVisible('delivery_address') ? 'erp-field md:col-span-2' : 'erp-field md:col-span-2 hidden'}>
                                <label className="erp-label">Delivery Address {efc.isRequired('delivery_address') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('delivery_address')} className="erp-input" value={form.delivery_address} onChange={e => setForm({ ...form, delivery_address: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Area</label>
                                <SearchablePopupSelect
                                    listKey="sd_area_picker"
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
                                    listKey="sd_route_picker"
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
                                    listKey="sd_cost_center_picker"
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
                                    listKey="sd_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>
                        <SalesLineGrid itemCharges={itemCharges}
                            listKey="sd" title="Sales Delivery" ctl={lineCtl} details={form.details} onRow={updateDetailRow} onRemove={removeDetailRow} onAdd={addDetailRow}
                            products={filterProductsByCompany(products, form.product_company_id)} allProducts={products} units={units} warehouses={warehouses}
                            settings={settings} termCols={termCols} popupTerms={popupTerms} efc={efc} onProductSelect={handleProductSelect}
                            docWarehouseId={form.warehouse_id}
                            features={{ free: false, batch: true, expiry: true, terms: false }} dual={dualHelpers(products, dualUomEntryMode).dual} lineGross={dualHelpers(products, dualUomEntryMode).lineGross} onProductKeyDown={handleProductRowKeyDown}
                        />
                    </div>

                    <EntryFooter

                        title="Sales Delivery"

                        warehouseName={settings?.multiWarehouse ? (warehouses.find(w => w.id === form.warehouse_id)?.warehouse_name || '') : undefined}

                        totals={{ gross: lineTot.gross, billTerm: lineTot.term, net: lineTot.amount, taxable: lineTot.taxable, tax: lineTot.tax, nonTaxable: lineTot.nonTaxable }}

                        party={{ label: 'Customer', name: selectedCustomer?.account_name, creditLimit: selectedCustomer?.credit_limit }}

                        remarks={{ value: form.remarks_text, onChange: v => setForm(f => ({ ...f, remarks_text: v })), options: remarks.map(r => r.remark_text) }}

                        onProductTerm={null} onBillTerm={false ? lineCtl.openOverall : null}

                        panels={[{ key: 'billing', label: 'Party & Tax Info', content: <PartyDetailsPanel partyId={form.customer_ledger_id} partyLabel="Customer" info={partyInfo} onChange={setPartyInfo} /> }]}

                        actions={<>


                            <button type="button" onClick={e => handleSubmit(e, true)} className="erp-btn">💾 Save as Draft</button>

                            <button type="submit" className="erp-btn primary">💾 {editingId ? 'Update' : 'Save'}</button>

                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>

                        </>}

                    />
                </form>
            )}
        </div>

        <div className="max-w-6xl mx-auto px-4 mt-4">
            <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={showDraftsOnly} onChange={e => setShowDraftsOnly(e.target.checked)} />
                    Show unposted (awaiting approval) only
                </label>
            </div>
            <ReportGrid
                columns={columns}
                rows={showDraftsOnly ? rows.filter(r => r.status === 'draft') : rows}
                getId={r => r.id}
                storageKey="sales_delivery_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        {row.status === 'draft' && <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>}
                        <DocActions type="sales_delivery" api="sales-deliveries" row={row} onOpen={handleEdit} onCopy={copyAsNew} onReverse={r => handleStatusChange(r, 'cancelled')} onDone={load} />
                        {row.status === 'posted' && <a href={`/print/sales_delivery/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="sales_delivery" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                    </div>
                )}
            />
        </div>

        {showOrderModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">Pull from Sales Order</span></div>
                    <div className="p-4">
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {confirmedOrders.map(o => (
                                <button key={o.id} type="button" onClick={() => handlePullFromOrder(o.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{o.doc_no} <span className="text-xs text-gray-400">— {o.customer_name_snapshot}</span></span>
                                    <span className="text-xs text-gray-400">{o.doc_date} · {o.total_amount?.toFixed(2)}</span>
                                </button>
                            ))}
                            {confirmedOrders.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No Confirmed orders available to pull from.</p>}
                        </div>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setShowOrderModal(false)} className="erp-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {historyModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-3xl max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">🕐 Sales History — {historyModal.productName}</span></div>
                    <div className="p-4">
                        {historyModal.entries.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-6">No previous sales of this product to this customer yet.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead>
                                        <tr><th>Date</th><th>Doc No</th><th>Batch</th><th>Qty</th><th>Free</th><th>Rate</th><th>Disc %</th><th>Disc Amt</th><th>Amount</th><th>Source</th></tr>
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

        {auditModal && <RecordHistory table="sales_deliveries" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/sales-deliveries/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
