// =============================================
// SalesNonsaleableReturn.jsx
// Customer returns damaged/expired goods that must NEVER rejoin
// sellable stock - tracked in the separate non-saleable ledger.
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
import BillWiseSettlementPanel from '../components/BillWiseSettlementPanel';
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import { resolveDualUomEntryMode, dualBaseQty, productDualMode, productRateBasis } from '../utils/dualUomEntryMode';
import UdfValuesModal from '../components/UdfValuesModal';
import RecordHistory from '../components/RecordHistory';
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

const emptyDetailRow = () => ({ product_id: '', qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', rate_basis: 'primary', rate: '', discount_percent: '', warehouse_id: '', batch_no: '', source_bill_detail_id: '' });

const emptyForm = {
    product_company_id: '', doc_date: new Date().toISOString().slice(0, 10), source_bill_id: '', numbering_category_id: '',
    customer_ledger_id: '', customer_sub_ledger_id: '', warehouse_id: '',
    return_reason: 'damaged', settlement_type: 'credit_note',
    remarks_text: '', narration: '', cost_center_id: '', business_unit_id: '',
    details: [emptyDetailRow()]
};

const REASONS = [
    { value: 'damaged', label: 'Damaged' }, { value: 'expired', label: 'Expired' },
    { value: 'quality_issue', label: 'Quality Issue' }, { value: 'wrong_item', label: 'Wrong Item' }, { value: 'other', label: 'Other' }
];

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['customer_ledger_id', 'doc_date', 'return_reason', 'settlement_type', 'warehouse_id'];

export default function SalesNonsaleableReturn() {
    const [dualUomEntryMode, setDualUomEntryMode] = useState({ mode: 'fixed', reverseEnabled: false });
    // a product's own dual-UOM entry mode (Product Master) over System Control's
    const dualModeOf = pid => productDualMode(products.find(p => p.id === pid), dualUomEntryMode);
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('sales_nonsalable_return', EFC_RENDERED_KEYS);
    const settings = useEntrySettings();
    // System Control: does this entry show item charges? (else only the Charges Summary)
    const itemCharges = showsProductTerms(settings, 'sales_nonsaleable_return');
    const termCols = [];
    const popupTerms = !!settings?.popupTerms?.includes('sales_return');
    const [partyInfo, setPartyInfo] = useState(emptyPartyInfo());
    const [pulledDocs, setPulledDocs] = useState([]);

    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showBillModal, setShowBillModal] = useState(false);
    const [postedBills, setPostedBills] = useState([]);
    const [billWiseSettlements, setBillWiseSettlements] = useState(null);
    const [auditModal, setAuditModal] = useState(null);

    const [customers, setCustomers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [remarks, setRemarks] = useState([]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addDetailRow(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, ldg, sl, prod, un, wh, cc, bu, rmk, sb, sysCtrl] = await Promise.all([
                authFetch('/api/sales-nonsaleable-returns'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/products'),
                authFetch('/api/product-units'),
                authFetch('/api/warehouses'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/remarks'),
                authFetch('/api/sales-bills'),
                authFetch('/api/system-control')
            ]);
            setRows(req.data || []);
            setCustomers(ldg.data || []);
            setSubLedgers(sl.data || []);
            setProducts(prod.data || []);
            setUnits(un.data || []);
            setWarehouses(wh.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setRemarks(rmk.data || []);
            setPostedBills((sb.data || []).filter(b => b.status === 'posted'));
            setDualUomEntryMode(resolveDualUomEntryMode(sysCtrl.data));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setBillWiseSettlements(null); setPartyInfo(emptyPartyInfo()); setPulledDocs([]); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => {
        setForm(f => ({ ...f, details: f.details.length > 1 ? f.details.filter((_, i) => i !== idx) : f.details }));
        setSelectedRowIndexes(cur => cur.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
    };
    const updateDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));

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
    };

    const lineGross = (d) => {
        if (productIsFixedDualUom(d.product_id) && d.alt_qty) {
            const factor = dualConversionFactor(d.product_id);
            const totalBaseQty = dualBaseQty(d.qty, d.alt_qty, factor, dualModeOf(d.product_id).mode);
            return d.rate_basis === 'primary' ? (totalBaseQty / factor) * (Number(d.rate) || 0) : totalBaseQty * (Number(d.rate) || 0);
        }
        return (Number(d.qty) || 0) * (Number(d.rate) || 0);
    };
    const lineAmount = (d) => {
        const gross = lineGross(d);
        const discountAmt = gross * (Number(d.discount_percent) || 0) / 100;
        return gross - discountAmt;
    };
    const grandTotal = form.details.reduce((sum, d) => sum + lineAmount(d), 0);
    const lineCtl = useLineGridControl();
    const lineTot = lineTotals(form.details, lineGross, termCols, true);
    const selectedCustomer = customers.find(c => c.id === form.customer_ledger_id);
    // F7: the last return as a new one
    useEntryHotkeys(showForm, { F7: () => { const last = latestOf(rows); if (last) copyAsNew(last); } });
    const [selectedRowIndexes, setSelectedRowIndexes] = useState([]);

    const handlePullFromBill = async (billId) => {
        try {
            const res = await authFetch(`/api/sales-bills/${billId}`);
            const src = res.data;
            setEditingId(null);
            setForm({
                ...emptyForm, source_bill_id: src.id,
                customer_ledger_id: src.customer_ledger_id, customer_sub_ledger_id: src.customer_sub_ledger_id, product_company_id: src.product_company_id || '',
                warehouse_id: src.warehouse_id, cost_center_id: src.cost_center_id, business_unit_id: src.business_unit_id,
                details: (src.details || []).length > 0
                    ? src.details.map(d => ({ ...emptyDetailRow(), product_id: d.product_id, uom_id: d.uom_id, alt_qty: d.alt_qty ? (Math.max(0, Number(d.alt_qty) - Number(d.alt_qty_returned || 0)) || '') : '', alt_unit_id: d.alt_unit_id || '', rate_basis: d.rate_basis || 'primary', rate: d.rate, warehouse_id: d.warehouse_id, batch_no: d.batch_no, source_bill_detail_id: d.id, qty: Math.max(0, Number(d.qty) - Number(d.qty_returned || 0)) }))
                        .filter(d => Number(d.qty) > 0 || Number(d.alt_qty) > 0)
                    : [emptyDetailRow()]
            });
            setShowForm(true);
            setShowBillModal(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showAlert(`Pulled from ${src.doc_no}`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleSubmit = async (e, saveAsDraft = false) => {

        // Save as Draft (new entry): kept apart as a temporary draft - no number, no accounts / stock effect

        if (saveAsDraft && !editingId) { if (e) e.preventDefault(); if (await saveEntryDraft(authFetch, 'sales_nonsalable_return', form)) { resetForm(); setShowForm(false); } return; }
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
            const payload = { ...form, details: validDetails, ...(billWiseSettlements ? { bill_wise_settlements: billWiseSettlements } : {}), ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}) };
            let postId = null;
            if (editingId) {
                await authFetch(`/api/sales-nonsaleable-returns/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                postId = editingId;
                showAlert(saveAsDraft ? 'Draft saved' : 'Sales Non-saleable Return updated', 'success');
            } else {
                const res = await authFetch('/api/sales-nonsaleable-returns', { method: 'POST', body: JSON.stringify(payload) }); savedId = res.data?.id;
                postId = res.data?.id;
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Sales Non-saleable Return ${res.data.doc_no} created`, 'success');
            }
            try { await savePartyInfo(authFetch, 'sales_nonsalable_return', savedId, partyInfo); } catch (pe) { showAlert(`Saved, but the party details were not: ${pe.message}`, 'warning'); }
            // Save (not Save as Draft): post it now, after its party details are stored
            if (!saveAsDraft) await finalizeEntry(authFetch, 'sales-nonsaleable-returns', postId, 'posted');
            await finishEntryDraft(authFetch, 'sales_nonsalable_return');
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
            const res = await authFetch(`/api/sales-nonsaleable-returns/${row.id}`);
            setEditingId(row.id);
            setPartyInfo(res.data.party_billing_address || res.data.party_pan ? partyInfoFromDoc(res.data, res.data.customer_ledger_id) : emptyPartyInfo());
            setForm({ ...emptyForm, ...res.data, doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date, details: (res.data.details || []).length > 0 ? res.data.details : [emptyDetailRow()] });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt('Reason for cancelling this Return?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            await authFetch(`/api/sales-nonsaleable-returns/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            showAlert(`Marked as ${status}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };


    const [udfDoc, setUdfDoc] = useState(null);

    const openAuditTrail = (row) => setAuditModal({ id: row.id, doc_no: row.doc_no });

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'customer_name_snapshot', label: 'Customer', type: 'text', render: r => r.customer_name_snapshot || '—' },
        { key: 'return_reason', label: 'Reason', type: 'text' },
        { key: 'settlement_type', label: 'Settlement', type: 'text' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🗑️ Sales Non-saleable Return</span>
                <div className="erp-header-actions">
                    <button onClick={() => setShowBillModal(true)} className="erp-header-btn">💵 Pull from Bill</button>
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
                    <EntryFillBar voucherType="sales_nonsalable_return" api="sales-nonsaleable-returns" form={form} editing={!!editingId} onFill={p => setForm(f => ({ ...f, ...p }))} onCopy={copyAsNew} />
                    <p className="mx-4 mt-3 text-xs text-amber-700 bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded">
                        ⚠️ These goods are tracked separately from regular sellable stock and will NOT be available for future sales.
                    </p>
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <DocNumberField docDate={form.doc_date || form.voucher_date} voucherType="sales_nonsalable_return" categoryId={form.numbering_category_id} docNo={editingId ? form.doc_no : ''} value={form.doc_no} onChange={v => setForm({ ...form, doc_no: v })} />
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>} {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className={efc.isVisible('customer_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Customer <span className="req">*</span> {efc.isRequired('customer_ledger_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="snsr_customer_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={customers} getId={c => c.id} getLabel={c => c.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.customer_ledger_id} onChange={id => setForm({ ...form, customer_ledger_id: id })} placeholder="Select Customer"
                            />
                        </div>
                        <ProductCompanyField side="sales" form={form} setForm={setForm} products={products} emptyRow={emptyDetailRow} />
                        {settings?.multiWarehouse && (
                        <div className={efc.isVisible('warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Warehouse <span className="req">*</span> {efc.isRequired('warehouse_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="snsr_warehouse_picker"
                                columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                defaultVisibleKeys={['warehouse_name']}
                                items={warehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                searchKeys={['warehouse_name', 'warehouse_code']}
                                value={form.warehouse_id} onChange={id => setForm({ ...form, warehouse_id: id })} placeholder="Select Warehouse"
                            />
                        </div>
                        )}
                        <div className={efc.isVisible('return_reason') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Return Reason {efc.isRequired('return_reason') && <span className="req">*</span>}</label>
                            <select disabled={efc.isReadonly('return_reason')} className="erp-select" value={form.return_reason} onChange={e => setForm({ ...form, return_reason: e.target.value })}>
                                {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="sales_nonsalable_return" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <PendingDocsPanel target="sales_nonsalable_return" partyId={form.customer_ledger_id} efc={efc} disabled={!!editingId} pulled={pulledDocs} onPull={data => { setForm(f => mergePulled(f, data, emptyDetailRow)); setPulledDocs(p => [...p, ...data.documents.map(x => x.id)]); showAlert(`Pulled ${data.lines.length} line(s) from ${data.documents.map(x => x.doc_no).join(', ')}`, 'success'); }} />

                    <div className="erp-tab-content">
                        {form.source_bill_id && (
                            <p className="text-xs text-gray-400 mb-2">💵 Pulled from a Sales Bill.</p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('settlement_type') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Settlement Type {efc.isRequired('settlement_type') && <span className="req">*</span>}</label>
                                <select disabled={efc.isReadonly('settlement_type')} className="erp-select" value={form.settlement_type} onChange={e => setForm({ ...form, settlement_type: e.target.value })}>
                                    <option value="credit_note">Credit Note (reduce balance owed)</option>
                                    <option value="no_credit">No Credit (record only)</option>
                                </select>
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Customer Sub Ledger</label>
                                <SearchablePopupSelect
                                    listKey="snsr_customer_subledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.customer_sub_ledger_id} onChange={id => setForm({ ...form, customer_sub_ledger_id: id })} placeholder="Select Sub Ledger"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Cost Center</label>
                                <SearchablePopupSelect
                                    listKey="snsr_cost_center_picker"
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
                                    listKey="snsr_business_unit_picker"
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
                            listKey="snr" title="Sales Non-saleable Return" ctl={lineCtl} details={form.details} onRow={updateDetailRow} onRemove={removeDetailRow} onAdd={addDetailRow}
                            products={filterProductsByCompany(products, form.product_company_id)} allProducts={products} units={units} warehouses={warehouses}
                            settings={settings} termCols={termCols} popupTerms={popupTerms} efc={efc} onProductSelect={handleProductSelect}
                            docWarehouseId={form.warehouse_id} selected={selectedRowIndexes} onSelected={setSelectedRowIndexes}
                            features={{ free: false, batch: true, expiry: false, terms: true, tax: false }} dual={dualHelpers(products, dualUomEntryMode).dual} lineGross={lineGross}
                        />

                        {form.settlement_type === 'credit_note' && (
                            <BillWiseSettlementPanel
                            productCompanyId={form.product_company_id}
                                ledgerId={form.customer_ledger_id}
                                outstandingNature="dr"
                                amount={grandTotal}
                                onSettlementsChange={setBillWiseSettlements}
                            />
                        )}
                    </div>

                    <EntryFooter

                        title="Sales Non-saleable Return"

                        warehouseName={settings?.multiWarehouse ? (warehouses.find(w => w.id === form.warehouse_id)?.warehouse_name || '') : undefined}

                        totals={{ gross: lineTot.gross, billTerm: lineTot.term, net: lineTot.amount, taxable: lineTot.taxable, tax: lineTot.tax, nonTaxable: lineTot.nonTaxable }}

                        party={{ label: 'Customer', name: selectedCustomer?.account_name, creditLimit: selectedCustomer?.credit_limit }}

                        remarks={{ value: form.remarks_text, onChange: v => setForm(f => ({ ...f, remarks_text: v })), options: remarks.map(r => r.remark_text) }}

                        onProductTerm={itemCharges ? lineCtl.openTerms : null} onBillTerm={true ? lineCtl.openOverall : null}

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
                storageKey="sales_nonsaleable_return_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        {row.status === 'draft' && <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>}
                        <DocActions type="sales_nonsalable_return" api="sales-nonsaleable-returns" row={row} onOpen={handleEdit} onCopy={copyAsNew} onReverse={r => handleStatusChange(r, 'cancelled')} onDone={load} />
                        {row.status === 'posted' && <a href={`/print/sales_nonsaleable_return/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="sales_nonsaleable_return" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                    </div>
                )}
            />
        </div>

        {showBillModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">Pull from Sales Bill</span></div>
                    <div className="p-4">
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {postedBills.map(b => (
                                <button key={b.id} type="button" onClick={() => handlePullFromBill(b.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{b.doc_no} <span className="text-xs text-gray-400">— {b.customer_name_snapshot}</span></span>
                                    <span className="text-xs text-gray-400">{b.doc_date} · {b.total_amount?.toFixed(2)}</span>
                                </button>
                            ))}
                            {postedBills.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No Posted bills available to pull from.</p>}
                        </div>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setShowBillModal(false)} className="erp-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {auditModal && <RecordHistory table="sales_nonsaleable_returns" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/sales-nonsaleable-returns/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
