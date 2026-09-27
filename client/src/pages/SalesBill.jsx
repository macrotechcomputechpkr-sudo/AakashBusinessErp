// =============================================
// SalesBill.jsx
// The customer invoice.
//   Header  : voucher no. (from Document Numbering), date, customer + its
//             sub-ledger, cash / credit, product company, warehouse (only
//             with multi-warehouse), agent, due date, area / route / cost
//             center / unit
//   Pending : the customer's Quotations / Orders / Challans with qty left
//             (as allowed in Entry Field Control) - tick, view, pull
//   Lines   : Code / Barcode first, warehouse, batch / serial (stock of the
//             chosen warehouse), qty, unit, free qty + unit, rate (+ basis
//             for dual items), product terms inline or in a popup, amount
//   Footer  : FinPro style (components/entry/FinEntry.jsx) - Product Term /
//             Bill Term pop-ups, net amount, remarks, amount in words, Other
//             Details (sales account + sub-ledger, rate type, narration),
//             Billing/Taxation (customer address & PAN, optionally saved to
//             the customer master), Hold / Ok / Cancel; F7 copies the last
//             bill, F8 recalls a held one
// Credit-checked; lines not from a Challan move stock.
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
import { resolveDualUomEntryMode } from '../utils/dualUomEntryMode';
import UdfValuesModal from '../components/UdfValuesModal';
import useLedgerPurposes from '../components/useLedgerPurposes';
import RecordHistory from '../components/RecordHistory';
import { priceUrl, lineUnitOf, useSlabRepricing } from '../utils/salesPricing';
import useEntrySettings, { termColumns } from '../components/entry/useEntrySettings';
import DocNumberField from '../components/entry/DocNumberField';
import PendingDocsPanel, { mergePulled } from '../components/entry/PendingDocsPanel';
import { PartyDetailsPanel, emptyPartyInfo, savePartyInfo, partyInfoFromDoc } from '../components/entry/PartyFooterTabs';
import SalesLineGrid, { useLineGridControl, lineTotals } from '../components/entry/SalesLineGrid';
import { EntryFooter, useEntryHotkeys, latestOf } from '../components/entry/FinEntry';
import { calcLine, defaultLineTerms, lineForSave } from '../components/entry/lineCalc';
import { dualHelpers } from '../components/entry/dualHelpers';
import DocActions, { HoldButtons, asNewCopy } from '../components/entry/DocActions';

const emptyDetailRow = () => ({ product_id: '', qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', rate: '', rate_basis: 'primary', discount_percent: '', tax_percent: '', free_qty: '', free_alt_qty: '', free_uom_id: '', warehouse_id: '', batch_no: '', serial_no: '', line_terms: null, source_delivery_detail_id: '', source_order_detail_id: '', source_quotation_detail_id: '' });

const emptyForm = {
    product_company_id: '', doc_no: '', doc_date: new Date().toISOString().slice(0, 10), source_delivery_id: '', source_order_id: '', source_quotation_id: '',
    customer_ledger_id: '', customer_sub_ledger_id: '', sales_account_ledger_id: '', sales_sub_ledger_id: '', agent_id: '', invoice_type: 'credit', currency: 'NPR',
    due_date: '', warehouse_id: '', numbering_category_id: '', remarks_text: '', narration: '', rate_type: 'exclusive',
    cost_center_id: '', business_unit_id: '', area_id: '', route_id: '',
    details: [emptyDetailRow()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['customer_ledger_id', 'doc_date', 'due_date', 'invoice_type', 'narration', 'warehouse_id'];

export default function SalesBill() {
    const { authFetch } = useAuth();
    const lp = useLedgerPurposes();
    const efc = useEntryFieldControls('sales_bill', EFC_RENDERED_KEYS);
    const settings = useEntrySettings();
    const termCols = termColumns(settings, 'sales');
    const popupTerms = !!settings?.popupTerms.includes('sales');
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [partyInfo, setPartyInfo] = useState(emptyPartyInfo());
    const [pulledDocs, setPulledDocs] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
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
    const [selectedRowIndexes, setSelectedRowIndexes] = useState([]);
    const [dualUomEntryMode, setDualUomEntryMode] = useState({ mode: 'fixed', reverseEnabled: false });

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addDetailRow(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, ldg, sl, ag, prod, un, wh, cc, bu, ar, rt, rmk, sysCtrl] = await Promise.all([
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
            setDualUomEntryMode(resolveDualUomEntryMode(sysCtrl.data));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const { lineGross, dual } = dualHelpers(products, dualUomEntryMode);
    const newRow = () => ({ ...emptyDetailRow(), line_terms: defaultLineTerms(termCols) });
    const resetForm = () => { setForm({ ...emptyForm, details: [newRow()] }); setEditingId(null); setPendingCreditBlock(null); setPartyInfo(emptyPartyInfo()); setPulledDocs([]); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, newRow()] }));
    const removeDetailRow = (idx) => {
        setForm(f => ({ ...f, details: f.details.length > 1 ? f.details.filter((_, i) => i !== idx) : f.details }));
        setSelectedRowIndexes(cur => cur.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
    };
    const setDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));
    // qty / value slab discounts: re-price the line when its qty or unit changes
    const reprice = useSlabRepricing(authFetch, form, setDetailRow);
    const updateDetailRow = (idx, patch) => { setDetailRow(idx, patch); reprice.onChange(idx, patch); };

    // the customer's discount goes into Disc 1 when product terms are mapped
    const withDiscount = (row, pct) => (termCols.some(c => c.key === 'disc1')
        ? { line_terms: { ...(row.line_terms || defaultLineTerms(termCols) || {}), disc1: { term_id: termCols.find(c => c.key === 'disc1').term_id, percent: pct } } }
        : { discount_percent: pct });

    const handleProductSelect = async (idx, productId, unitId) => {
        const product = products.find(p => p.id === productId);
        const base = { product_id: productId, line_terms: form.details[idx]?.line_terms || defaultLineTerms(termCols) };
        if (product?.uom_mode === 'fixed_dual') {
            updateDetailRow(idx, { ...base, uom_id: product.dual_uom_primary_unit_id || '', alt_unit_id: product.base_unit_id || '', rate_basis: 'primary' });
        } else {
            updateDetailRow(idx, { ...base, uom_id: unitId || product?.base_unit_id || '' });
        }
        if (!form.customer_ledger_id) { updateDetailRow(idx, { rate: product?.sales_rate_sr1 || 0 }); return; }
        try {
            const res = await authFetch(priceUrl(form.customer_ledger_id, productId, { unit_id: unitId || lineUnitOf(product), qty: form.details[idx]?.qty, payment_term: form.invoice_type === 'cash' ? 'cash' : undefined }));
            setDetailRow(idx, { rate: res.data.rate, ...(res.data.discount_percent ? withDiscount(form.details[idx] || {}, res.data.discount_percent) : {}) });
            reprice.mark(idx, res.data);
        } catch {
            updateDetailRow(idx, { rate: product?.sales_rate_sr1 || 0 });
        }
    };

    // F1 on a product line: what this customer bought / was billed for that product before
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

    const lineAmount = d => calcLine(d, lineGross(d), termCols).amount;
    const grandTotal = form.details.reduce((sum, d) => sum + lineAmount(d), 0);
    const totals = lineTotals(form.details, lineGross, termCols);
    const lineCtl = useLineGridControl();

    const handlePull = (data) => {
        setForm(f => mergePulled(f, data, newRow));
        setPulledDocs(p => [...p, ...data.documents.map(d => d.id)]);
        showAlert(`Pulled ${data.lines.length} line(s) from ${data.documents.map(d => d.doc_no).join(', ')} - only the qty still pending`, 'success');
    };

    const handleSubmit = async (e, saveAsDraft = false, overrideCreditBlock = false) => {
        if (e) e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        const validDetails = form.details.filter(d => d.product_id && (Number(d.qty) > 0 || Number(d.alt_qty) > 0)).map(d => lineForSave(d, lineGross(d), termCols));
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
            try { await savePartyInfo(authFetch, 'sales_bill', res.data?.id || editingId, partyInfo); } catch (pe) { showAlert(`Saved, but the party details were not: ${pe.message}`, 'warning'); }
            if (res.warning) showAlert(res.warning, 'warning');
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            if (err.credit_blocked) { setPendingCreditBlock(err.message); return; }
            showAlert(err.message, 'danger');
        }
    };

    const copyAsNew = async (row) => { await handleEdit(row); setEditingId(null); setForm(f => asNewCopy(f, row.id)); setShowForm(true); };
    // F7: the last bill as a new one (F8 - held entries - is on the Hold button)
    useEntryHotkeys(showForm, { F7: () => { const last = latestOf(rows); if (last) copyAsNew(last); else showAlert('No earlier bill to copy', 'info'); } });
    const selectedCustomer = customers.find(c => c.id === form.customer_ledger_id);
    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/sales-bills/${row.id}`);
            setEditingId(row.id);
            setForm({ ...emptyForm, ...res.data, doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date, due_date: res.data.due_date?.slice(0, 10) || '', details: (res.data.details || []).length > 0 ? res.data.details : [newRow()] });
            setPartyInfo(res.data.party_billing_address || res.data.party_pan ? partyInfoFromDoc(res.data, res.data.customer_ledger_id) : emptyPartyInfo());
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


    const [udfDoc, setUdfDoc] = useState(null);
    const openAuditTrail = (row) => setAuditModal({ id: row.id, doc_no: row.doc_no });

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'customer_name_snapshot', label: 'Customer', type: 'text', render: r => r.customer_name_snapshot || '—' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'credit_check_result', label: 'Credit', type: 'text', render: r => r.credit_check_result === 'warned' ? '⚠ Warned' : r.credit_check_result === 'overridden' ? '🔓 Overridden' : '—' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    // the customer's own sub-ledgers (all when the customer has none)
    const customerSubs = subLedgers.filter(s => s.main_ledger_id === form.customer_ledger_id);
    const picker = (key, items, id, code, name, value, onChange, placeholder) => (
        <SearchablePopupSelect listKey={`sb_${key}`} columns={[{ key: code, label: 'Code' }, { key: name, label: 'Name' }]} defaultVisibleKeys={[name]}
            items={items} getId={x => x[id]} getLabel={x => x[name]} searchKeys={[name, code]} value={value} onChange={onChange} placeholder={placeholder} />
    );

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card" style={{ maxWidth: 1400 }}>
            <div className="erp-header">
                <span className="erp-header-title">💵 Sales Bill / Invoice</span>
                <div className="erp-header-actions">
                    <button onClick={() => { resetForm(); setShowForm(s => !s); }} className={`erp-header-btn ${showForm ? '' : 'primary'}`}>
                        {showForm ? '✕ Close' : '➕ New Bill'}
                    </button>
                </div>
            </div>

            {alert && (
                <div className={`nav-msg ${alert.type === 'success' ? 'ok' : alert.type === 'danger' ? 'err' : 'warn'}`} style={{ margin: 8 }}>{alert.message}</div>
            )}

            {pendingCreditBlock && (
                <div className="nav-msg err" style={{ margin: 8 }}>
                    <p className="mb-2">🚫 {pendingCreditBlock}</p>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => handleSubmit(null, false, true)} className="nav-btn small danger">Override and Save Anyway</button>
                        <button type="button" onClick={() => setPendingCreditBlock(null)} className="nav-btn small">Cancel</button>
                    </div>
                </div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} ref={formRef} className="fin-entry">
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <DocNumberField voucherType="sales_bill" categoryId={form.numbering_category_id} docNo={editingId ? form.doc_no : ''} value={form.doc_no} onChange={v => setForm({ ...form, doc_no: v })} />
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className={efc.isVisible('customer_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Customer <span className="req">*</span></label>
                            {picker('customer_picker', customers, 'id', 'account_code', 'account_name', form.customer_ledger_id, id => setForm({ ...form, customer_ledger_id: id, customer_sub_ledger_id: '' }), 'Select Customer')}
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Customer Sub-Ledger</label>
                            {picker('customer_subledger_picker', customerSubs.length ? customerSubs : subLedgers, 'id', 'sub_ledger_code', 'sub_ledger_name', form.customer_sub_ledger_id, id => setForm({ ...form, customer_sub_ledger_id: id }), 'None')}
                        </div>
                        <div className={efc.isVisible('invoice_type') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Cash / Credit</label>
                            <select disabled={efc.isReadonly('invoice_type')} className="erp-select" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
                                <option value="credit">Credit</option>
                                <option value="cash">Cash</option>
                            </select>
                        </div>
                        <ProductCompanyField side="sales" form={form} setForm={setForm} products={products} emptyRow={newRow} />
                        {settings?.multiWarehouse && (
                            <div className={efc.isVisible('warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Warehouse</label>
                                {picker('warehouse_picker', warehouses, 'id', 'warehouse_code', 'warehouse_name', form.warehouse_id, id => setForm({ ...form, warehouse_id: id }), 'Select Warehouse')}
                            </div>
                        )}
                        <div className="erp-field">
                            <label className="erp-label">Salesman / Agent</label>
                            {picker('agent_picker', agents, 'id', 'agent_code', 'agent_name', form.agent_id, id => setForm({ ...form, agent_id: id }), 'Select Agent')}
                        </div>
                        <div className={efc.isVisible('due_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Due Date</label>
                            <input disabled={efc.isReadonly('due_date')} type="date" className="erp-input" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Area</label>
                            {picker('area_picker', areas, 'id', 'area_code', 'area_name', form.area_id, id => setForm({ ...form, area_id: id }), 'Select Area')}
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Route</label>
                            {picker('route_picker', routes, 'id', 'route_code', 'route_name', form.route_id, id => setForm({ ...form, route_id: id }), 'Select Route')}
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Cost Center</label>
                            {picker('cost_center_picker', costCenters, 'id', 'cost_center_code', 'cost_center_name', form.cost_center_id, id => setForm({ ...form, cost_center_id: id }), 'Select Cost Center')}
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Unit</label>
                            {picker('business_unit_picker', businessUnits, 'id', 'unit_code', 'unit_name', form.business_unit_id, id => setForm({ ...form, business_unit_id: id }), 'Select Unit')}
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="sales_bill" value={form.numbering_category_id} onChange={id => setForm(f => ({ ...f, numbering_category_id: id }))} />
                        )}
                    </div>

                    <PendingDocsPanel target="sales_bill" partyId={form.customer_ledger_id} efc={efc} disabled={!!editingId} onPull={handlePull} pulled={pulledDocs} />

                    <div className="erp-tab-content fin-lines">
                        <SalesLineGrid
                            listKey="sb" title="Sales Bill" ctl={lineCtl} details={form.details} onRow={updateDetailRow} onRemove={removeDetailRow} onAdd={addDetailRow}
                            products={filterProductsByCompany(products, form.product_company_id)} allProducts={products} units={units} warehouses={warehouses}
                            settings={settings} termCols={termCols} popupTerms={popupTerms} efc={efc} onProductSelect={handleProductSelect}
                            docWarehouseId={form.warehouse_id} selected={selectedRowIndexes} onSelected={setSelectedRowIndexes}
                            features={{ free: true, batch: true, expiry: false, terms: true }} dual={dual} lineGross={lineGross} onProductKeyDown={handleProductRowKeyDown}
                        />
                    </div>

                    <EntryFooter
                        title="Sales Bill"
                        warehouseName={settings?.multiWarehouse ? (warehouses.find(w => w.id === form.warehouse_id)?.warehouse_name || '') : undefined}
                        totals={{ billTerm: totals.term, net: grandTotal, taxable: totals.taxable, tax: totals.tax, nonTaxable: totals.nonTaxable }}
                        party={{ label: 'Customer', name: selectedCustomer?.account_name, creditLimit: selectedCustomer?.credit_limit }}
                        remarks={{ value: form.remarks_text, onChange: v => setForm(f => ({ ...f, remarks_text: v })), options: remarks.map(r => r.remark_text) }}
                        onProductTerm={lineCtl.openTerms} onBillTerm={lineCtl.openOverall}
                        panels={[
                            { key: 'other', label: 'Other Details', content: (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div className="erp-field">
                                        <label className="erp-label">Sales Account <span className="hint">(blank = product / system default)</span></label>
                                        {picker('sales_account_picker', lp.filter(customers, 'sales_goods', form.sales_account_ledger_id), 'id', 'account_code', 'account_name', form.sales_account_ledger_id || '', id => setForm({ ...form, sales_account_ledger_id: id, sales_sub_ledger_id: '' }), 'System default')}
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Sales Sub-Ledger</label>
                                        {picker('sales_subledger_picker', subLedgers.filter(x => x.main_ledger_id === form.sales_account_ledger_id), 'id', 'sub_ledger_code', 'sub_ledger_name', form.sales_sub_ledger_id, id => setForm({ ...form, sales_sub_ledger_id: id }), form.sales_account_ledger_id ? 'None' : 'Choose a Sales Account first')}
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Rate Type</label>
                                        <select className="erp-select" value={form.rate_type} onChange={e => setForm({ ...form, rate_type: e.target.value })}>
                                            <option value="exclusive">Exclusive of Tax</option>
                                            <option value="inclusive">Inclusive of Tax</option>
                                        </select>
                                    </div>
                                    <div className={efc.isVisible('narration') ? 'erp-field' : 'erp-field hidden'}>
                                        <label className="erp-label">Narration</label>
                                        <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                                    </div>
                                </div>
                            ) },
                            { key: 'billing', label: 'Billing/Taxation', content: <PartyDetailsPanel partyId={form.customer_ledger_id} partyLabel="Customer" info={partyInfo} onChange={setPartyInfo} /> }
                        ]}
                        actions={<>
                            <HoldButtons hotkey voucherType="sales_bill" form={form} disabled={!!editingId} onRecall={p => { if (p) { setForm(p); setEditingId(null); setShowForm(true); } else resetForm(); }} />
                            <button type="button" onClick={e => handleSubmit(e, true)} className="erp-btn">💾 Save as Draft</button>
                            <button type="submit" className="erp-btn primary">✔ {editingId ? 'Update' : 'Ok'}</button>
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">✖ Cancel</button>
                        </>}
                    />
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
                        <DocActions type="sales_bill" api="sales-bills" row={row} onOpen={handleEdit} onCopy={copyAsNew} onReverse={r => handleStatusChange(r, 'cancelled')} onDone={load} />
                        {row.status === 'posted' && <a href={`/print/sales_bill/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="sales_bill" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                    </div>
                )}
            />
        </div>

        {historyModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="nav-window w-full max-w-3xl max-h-[80vh] overflow-y-auto">
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

        {auditModal && <RecordHistory table="sales_bills" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/sales-bills/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
