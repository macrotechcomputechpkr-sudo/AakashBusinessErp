// =============================================
// PurchaseReturn.jsx
// Goods returned to the vendor - linked to the Bill they were billed
// came from, pulling forward only what's still genuinely returnable
// (qty minus qty_returned - the backend enforces this as a hard limit
// too, not just a suggestion).
// =============================================

import TermLedgerInfo from '../components/TermLedgerInfo';
import ProductCompanyField, { filterProductsByCompany } from '../components/ProductCompanyField';
import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import { resolveDualUomEntryMode, onPrimaryQtyChange, onSecondaryQtyChange, validateFixedSecondary, dualBaseQty } from '../utils/dualUomEntryMode';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import BillWiseSettlementPanel from '../components/BillWiseSettlementPanel';

const RETURN_REASONS = [
    { value: 'defective', label: 'Defective' },
    { value: 'excess_quantity', label: 'Excess Quantity' },
    { value: 'wrong_item', label: 'Wrong Item' },
    { value: 'quality_issue', label: 'Quality Issue' },
    { value: 'price_dispute', label: 'Price Dispute' },
    { value: 'other', label: 'Other' }
];

const emptyDetailRow = () => ({
    product_id: '', qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', rate_basis: 'primary', rate: '', tax_percent: '', warehouse_id: '',
    batch_no: '', source_doc_no: '', line_reason: '',
    source_bill_detail_id: '', billing_term_ids: [], product_company_id: '', term_sub_ledgers: {}
});

const emptyForm = {
    doc_date: new Date().toISOString().slice(0, 10),
    numbering_category_id: '',
    source_bill_id: '',
    vendor_ledger_id: '', cash_vendor_name: '', agent_id: '', invoice_type: 'credit', currency: 'NPR',
    warehouse_id: '', goods_account_ledger_id: '', goods_sub_ledger_id: '',
    party_bill_no: '', party_bill_date: '', return_reason: 'other',
    remarks_text: '', rate_type: 'exclusive', cost_center_id: '', business_unit_id: '',
    priority: 'normal', narration: '', billing_term_ids: [],
    details: [emptyDetailRow()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['agent_id', 'business_unit_id', 'cost_center_id', 'currency', 'doc_date', 'goods_account_ledger_id', 'goods_sub_ledger_id', 'invoice_type', 'narration', 'party_bill_date', 'party_bill_no', 'priority', 'rate_type', 'return_reason', 'vendor_ledger_id', 'warehouse_id'];

export default function PurchaseReturn() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('purchase_return', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [billWiseSettlements, setBillWiseSettlements] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [auditModal, setAuditModal] = useState(null);
    const [pullBillId, setPullBillId] = useState('');
    // FEATURE: "Return haru maa pani term...jastai hunu parxa" - the
    // SAME document-level + per-line Billing Term system Purchase Bill/
    // GRN/Order/Quotation already have, brought to Purchase Return too.
    const [billingTerms, setBillingTerms] = useState([]);
    const [billingPreview, setBillingPreview] = useState(null);
    const [productTermModalIndexes, setProductTermModalIndexes] = useState(null);
    const [lineTermPreviews, setLineTermPreviews] = useState({});
    const [summaryOverrides, setSummaryOverrides] = useState({});
    const [selectedRowIndexes, setSelectedRowIndexes] = useState([]);
    const [dualUomEntryMode, setDualUomEntryMode] = useState({ mode: 'fixed', reverseEnabled: false });
    // FEATURE: "[F1]: Last Purchase history, [F2]: Last Purchase
    // history (Any Supplier)" - matches Purchase Bill's own two-key
    // distinction exactly.
    const [historyModal, setHistoryModal] = useState(null);
    const openProductHistory = async (productId, anyVendor = false) => {
        if (!productId) return showAlert('Select a Product first', 'danger');
        if (!anyVendor && !form.vendor_ledger_id) return showAlert('Select a Supplier first, or use F2 for Any Supplier', 'danger');
        try {
            const params = new URLSearchParams({ product_id: productId, ...(anyVendor ? { any_vendor: 'true' } : { vendor_ledger_id: form.vendor_ledger_id }) });
            const res = await authFetch(`/api/vendor-product-history?${params}`);
            const productName = products.find(p => p.id === productId)?.product_name || '';
            setHistoryModal({ productName, anyVendor, entries: res.data || [] });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };
    const handleProductRowKeyDown = (e, productId) => {
        if (e.key === 'F1') { e.preventDefault(); openProductHistory(productId, false); }
        if (e.key === 'F2') { e.preventDefault(); openProductHistory(productId, true); }
    };

    const [vendors, setVendors] = useState([]);
    const [agents, setAgents] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);
    const [openBills, setOpenBills] = useState([]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addDetailRow(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, v1, v2, ag, wh, ldg, sl, cc, bu, prod, un, pbills, bt, sysCtrl] = await Promise.all([
                authFetch('/api/purchase-returns'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=purchase'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=both'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/warehouses'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/products'),
                authFetch('/api/product-units'),
                authFetch('/api/purchase-bills'),
                authFetch('/api/billing-terms'),
                authFetch('/api/system-control')
            ]);
            setRows(req.data || []);
            setVendors([...(v1.data || []), ...(v2.data || [])]);
            setAgents(ag.data || []);
            setWarehouses(wh.data || []);
            setLedgers(ldg.data || []);
            setSubLedgers(sl.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setProducts(prod.data || []);
            setUnits(un.data || []);
            setOpenBills((pbills.data || []).filter(b => !['cancelled'].includes(b.status)));
            setBillingTerms((bt.data || []).filter(t => t.applicable_purchase_entry && t.is_enabled));
            setDualUomEntryMode(resolveDualUomEntryMode(sysCtrl.data));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setPullBillId(''); setSummaryOverrides({}); setSelectedRowIndexes([]); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => {
        setForm(f => ({ ...f, details: f.details.length > 1 ? f.details.filter((_, i) => i !== idx) : f.details }));
        setSelectedRowIndexes(cur => cur.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
    };
    const updateDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));
    const productMaintainsBatch = (productId) => !!products.find(p => p.id === productId)?.maintain_batch;
    const productIsFixedDualUom = (productId) => products.find(p => p.id === productId)?.uom_mode === 'fixed_dual';
    const dualConversionFactor = (productId) => {
        const product = products.find(p => p.id === productId);
        const rate = (product?.product_unit_rates || []).find(r => r.unit_id === product?.dual_uom_primary_unit_id);
        return Number(rate?.conversion_factor) || 1;
    };
    const handleProductSelect = (idx, productId) => {
        const product = products.find(p => p.id === productId);
        if (product?.uom_mode === 'fixed_dual') {
            updateDetailRow(idx, { product_id: productId, uom_id: product.dual_uom_primary_unit_id || '', alt_unit_id: product.base_unit_id || '', rate_basis: 'primary' });
        } else {
            updateDetailRow(idx, { product_id: productId, uom_id: product?.base_unit_id || '' });
        }
    };

    const lineAmount = (d) => {
        let base;
        if (productIsFixedDualUom(d.product_id) && d.alt_qty) {
            const factor = dualConversionFactor(d.product_id);
            const totalBaseQty = dualBaseQty(d.qty, d.alt_qty, factor, dualUomEntryMode.mode);
            base = d.rate_basis === 'primary' ? (totalBaseQty / factor) * (Number(d.rate) || 0) : totalBaseQty * (Number(d.rate) || 0);
        } else {
            base = (Number(d.qty) || 0) * (Number(d.rate) || 0);
        }
        const tax = d.tax_percent ? base * (Number(d.tax_percent) / 100) : 0;
        return base + tax;
    };
    const grandTotal = form.details.reduce((sum, d) => sum + lineAmount(d), 0);
    const totalQty = form.details.reduce((sum, d) => sum + (Number(d.qty) || 0), 0);

    // FEATURE: live preview of the SAME evaluateAllTerms() engine the
    // backend uses on save - document-level Billing Terms.
    useEffect(() => {
        if (form.billing_term_ids.length === 0) { setBillingPreview(null); return; }
        let cancelled = false;
        authFetch('/api/billing-terms/preview', { method: 'POST', body: JSON.stringify({ term_ids: form.billing_term_ids, basic_amount: grandTotal, quantity: totalQty }) })
            .then(res => { if (!cancelled) setBillingPreview(res.data); })
            .catch(() => { if (!cancelled) setBillingPreview(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.billing_term_ids, grandTotal, totalQty]);

    const toggleBillingTerm = (id) => setForm(f => ({
        ...f,
        billing_term_ids: f.billing_term_ids.includes(id) ? f.billing_term_ids.filter(x => x !== id) : [...f.billing_term_ids, id]
    }));

    // FEATURE: recomputes every line's OWN term preview (Product Term)
    // whenever qty/rate/billing_term_ids change on any line.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const previews = {};
            for (let i = 0; i < form.details.length; i++) {
                const d = form.details[i];
                if (!d.billing_term_ids || d.billing_term_ids.length === 0) continue;
                try {
                    const res = await authFetch('/api/billing-terms/preview', {
                        method: 'POST',
                        body: JSON.stringify({ term_ids: d.billing_term_ids, basic_amount: (Number(d.qty) || 0) * (Number(d.rate) || 0), quantity: Number(d.qty) || 0 })
                    });
                    previews[i] = res.data;
                } catch { /* leave this line's preview absent on failure */ }
            }
            if (!cancelled) setLineTermPreviews(previews);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(form.details.map(d => ({ q: d.qty, r: d.rate, t: d.billing_term_ids })))]);

    const toggleLineBillingTerm = (lineIdx, termId) => {
        updateDetailRow(lineIdx, {
            billing_term_ids: (form.details[lineIdx].billing_term_ids || []).includes(termId)
                ? form.details[lineIdx].billing_term_ids.filter(x => x !== termId)
                : [...(form.details[lineIdx].billing_term_ids || []), termId]
        });
    };

    const toggleTermForLines = (lineIndexes, termId) => {
        const allHaveIt = lineIndexes.every(idx => (form.details[idx]?.billing_term_ids || []).includes(termId));
        setForm(f => {
            const details = [...f.details];
            lineIndexes.forEach(idx => {
                const current = details[idx].billing_term_ids || [];
                details[idx] = { ...details[idx], billing_term_ids: allHaveIt ? current.filter(x => x !== termId) : (current.includes(termId) ? current : [...current, termId]) };
            });
            return { ...f, details };
        });
    };

    // FEATURE: aggregates every line's own computed term amount into one
    // Summary row per term - original totals before any Summary-level
    // override.
    const summaryRows = useMemo(() => {
        const byTermId = {};
        form.details.forEach((d, lineIdx) => {
            const preview = lineTermPreviews[lineIdx];
            (d.billing_term_ids || []).forEach(termId => {
                const term = billingTerms.find(t => t.id === termId);
                const lineTermEntry = preview?.lines?.find(l => l.billing_term_id === termId);
                if (!byTermId[termId]) byTermId[termId] = { billing_term_id: termId, term_name: term?.term_name || '—', original_total: 0 };
                byTermId[termId].original_total += Number(lineTermEntry?.amount) || 0;
            });
        });
        return Object.values(byTermId);
    }, [form.details, lineTermPreviews, billingTerms]);
    const summaryGrandTotal = summaryRows.reduce((sum, r) => sum + (summaryOverrides[r.billing_term_id] !== undefined ? Number(summaryOverrides[r.billing_term_id]) : r.original_total), 0);

    // FEATURE: "whichever module comes after should be able to fill from
    // FEATURE: Return links to Bill only - a return is a Credit Note
    // against what was actually billed. Only offering
    // what's still genuinely returnable (the backend enforces the same
    // limit as a hard check on save, this is just the convenient offer).
    const handlePullForward = async () => {
        if (!pullBillId) return showAlert('Pick a Bill to pull from', 'danger');
        try {
            const params = new URLSearchParams();
            if (pullBillId) params.set('bill_id', pullBillId);
            const res = await authFetch(`/api/purchase-returns/pull-forward?${params}`);
            const { master, details } = res.data;
            setForm(f => ({
                ...f, ...master,
                source_bill_id: pullBillId || '',
                details: (details && details.length > 0) ? details.map(d => ({ ...emptyDetailRow(), ...d })) : f.details
            }));
            showAlert('Pulled forward - review and adjust before saving', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        if (!saveAsDraft) {
            if (!form.source_bill_id) return showAlert('Link this to a Bill', 'danger');
            if (!form.vendor_ledger_id && !form.cash_vendor_name) return showAlert('A Vendor (or, for Cash, a Party Name) is required', 'danger');
        }
        const validDetails = form.details.filter(d => d.product_id && (Number(d.qty) > 0 || Number(d.alt_qty) > 0));
        if (!saveAsDraft && validDetails.length === 0) return showAlert('At least one complete line item (Product + Qty) is required', 'danger');
        try {
            const payload = {
                ...form, details: validDetails, summary_overrides: summaryOverrides,
                ...(billWiseSettlements ? { bill_wise_settlements: billWiseSettlements } : {}),
                ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {})
            };
            if (editingId) {
                await authFetch(`/api/purchase-returns/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : 'Return updated', 'success');
            } else {
                const res = await authFetch('/api/purchase-returns', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Return ${res.data.doc_no} created`, 'success');
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
            const res = await authFetch(`/api/purchase-returns/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...res.data,
                doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date,
                party_bill_date: res.data.party_bill_date?.slice(0, 10) || '',
                details: (res.data.details || []).length > 0 ? res.data.details : [emptyDetailRow()]
            });
            try {
                const tsl = await authFetch(`/api/document-term-sub-ledgers?document_type=purchase_return&document_id=${row.id}`);
                setForm(f => ({ ...f, term_sub_ledgers: tsl.data || {} }));
            } catch { /* keep master defaults */ }
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleCopyFrom = async (sourceId) => {
        try {
            const res = await authFetch(`/api/purchase-returns/${sourceId}`);
            const src = res.data;
            setEditingId(null);
            setForm({
                ...emptyForm, ...src,
                doc_no: '', doc_date: new Date().toISOString().slice(0, 10), status: 'draft',
                details: (src.details || []).length > 0 ? src.details.map(d => ({ ...emptyDetailRow(), ...d })) : [emptyDetailRow()]
            });
            setShowForm(true);
            setShowCopyModal(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showAlert(`Copied from ${src.doc_no} - review and save as a new Return`, 'success');
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
            await authFetch(`/api/purchase-returns/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            showAlert(`Marked as ${status}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/purchase-returns/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const openAuditTrail = async (row) => {
        try {
            const res = await authFetch(`/api/purchase-returns/${row.id}/audit-trail`);
            setAuditModal({ doc_no: row.doc_no, entries: res.data || [] });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text' },
        { key: 'vendor', label: 'Vendor', type: 'text', render: r => r.vendor_name_snapshot || r.cash_vendor_name || '—' },
        { key: 'return_reason', label: 'Reason', type: 'text' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">↩️ Purchase Return</span>
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
                    {!editingId && (
                        <div className="erp-topbar grid-cols-1 md:grid-cols-3" style={{ background: '#eff6ff' }}>
                            <div className="erp-field md:col-span-2">
                                <label className="erp-label">Pull From Bill</label>
                                <select className="erp-select" value={pullBillId} onChange={e => setPullBillId(e.target.value)}>
                                    <option value="">— None —</option>
                                    {openBills.map(b => <option key={b.id} value={b.id}>{b.doc_no}</option>)}
                                </select>
                            </div>
                            <div className="erp-field justify-end">
                                <button type="button" onClick={handlePullForward} className="erp-btn primary">⬇ Pull Forward</button>
                            </div>
                            <p className="text-xs text-gray-400 md:col-span-3">Only what's still genuinely returnable (qty minus already-returned) gets offered - and the server rejects anything beyond that even if typed in manually.</p>
                        </div>
                    )}

                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className={efc.isVisible('invoice_type') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Invoice Type {efc.isRequired('invoice_type') && <span className="req">*</span>}</label>
                            <select disabled={efc.isReadonly('invoice_type')} className="erp-select" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
                                <option value="cash">Cash</option>
                                <option value="credit">Credit</option>
                            </select>
                        </div>
                        <div className={efc.isVisible('vendor_ledger_id') ? 'erp-field md:col-span-2' : 'erp-field md:col-span-2 hidden'}>
                            <label className="erp-label">{form.invoice_type === 'cash' ? 'Party Name' : 'Vendor'} {efc.isRequired('vendor_ledger_id') && <span className="req">*</span>}</label>
                            {form.invoice_type === 'cash' && !form.vendor_ledger_id ? (
                                <input className="erp-input" value={form.cash_vendor_name} onChange={e => setForm({ ...form, cash_vendor_name: e.target.value })} placeholder="Type party name" />
                            ) : (
                                <SearchablePopupSelect
                                    listKey="return_vendor_picker"
                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                    defaultVisibleKeys={['account_name']}
                                    items={vendors} getId={v => v.id} getLabel={v => v.account_name}
                                    searchKeys={['account_name', 'account_code']}
                                    value={form.vendor_ledger_id} onChange={id => setForm({ ...form, vendor_ledger_id: id, cash_vendor_name: '', vendor_sub_ledger_id: '' })}
                                    placeholder="Select Vendor"
                                />
                            )}
                        </div>
                        <ProductCompanyField side="purchase" form={form} setForm={setForm} products={products} emptyRow={emptyDetailRow} />
                        {!editingId && (
                            <NumberingCategorySelector voucherType="purchase_return" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('return_reason') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Return Reason <span className="req">*</span> {efc.isRequired('return_reason') && <span className="req">*</span>}</label>
                                <select disabled={efc.isReadonly('return_reason')} className="erp-select" value={form.return_reason} onChange={e => setForm({ ...form, return_reason: e.target.value })}>
                                    {RETURN_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                            </div>
                            <div className={efc.isVisible('warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Warehouse {efc.isRequired('warehouse_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="return_warehouse_picker"
                                    columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                    defaultVisibleKeys={['warehouse_name']}
                                    items={warehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                    searchKeys={['warehouse_name', 'warehouse_code']}
                                    value={form.warehouse_id} onChange={id => setForm({ ...form, warehouse_id: id })} placeholder="Select Warehouse"
                                />
                            </div>
                            <div className={efc.isVisible('agent_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Agent {efc.isRequired('agent_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="return_agent_picker"
                                    columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                    defaultVisibleKeys={['agent_name']}
                                    items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                    searchKeys={['agent_name', 'agent_code']}
                                    value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })} placeholder="Select Agent"
                                />
                            </div>
                            <div className={efc.isVisible('currency') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Currency {efc.isRequired('currency') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('currency')} className="erp-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Vendor Sub-Ledger</label>
                                <SearchablePopupSelect
                                    listKey="purchase_return_vendor_subledger_picker"
                                    columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]}
                                    defaultVisibleKeys={['name']}
                                    items={subLedgers.filter(x => x.main_ledger_id === form.vendor_ledger_id).map(x => ({ id: x.id, code: x.sub_ledger_code, name: x.sub_ledger_name }))} getId={x => x.id} getLabel={x => x.name}
                                    searchKeys={['name', 'code']}
                                    value={form.vendor_sub_ledger_id} onChange={id => setForm({ ...form, vendor_sub_ledger_id: id })} placeholder="None"
                                />
                            </div>
                            <div className={efc.isVisible('goods_account_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Goods Account {efc.isRequired('goods_account_ledger_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="return_goods_account_picker"
                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                    defaultVisibleKeys={['account_name']}
                                    items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                    searchKeys={['account_name', 'account_code']}
                                    value={form.goods_account_ledger_id} onChange={id => setForm({ ...form, goods_account_ledger_id: id, goods_sub_ledger_id: '' })} placeholder="Select Ledger"
                                />
                            </div>
                            <div className={efc.isVisible('goods_sub_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Goods Sub-Ledger {efc.isRequired('goods_sub_ledger_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="return_goods_subledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers.filter(s => s.main_ledger_id === form.goods_account_ledger_id)} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.goods_sub_ledger_id} onChange={id => setForm({ ...form, goods_sub_ledger_id: id })} placeholder="Select Sub-Ledger"
                                />
                            </div>
                            <div className={efc.isVisible('rate_type') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Rate Type {efc.isRequired('rate_type') && <span className="req">*</span>}</label>
                                <select disabled={efc.isReadonly('rate_type')} className="erp-select" value={form.rate_type} onChange={e => setForm({ ...form, rate_type: e.target.value })}>
                                    <option value="exclusive">Exclusive of Tax</option>
                                    <option value="inclusive">Inclusive of Tax</option>
                                </select>
                            </div>
                            <div className={efc.isVisible('party_bill_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Party Bill No <span className="hint">(Credit Note ref)</span> {efc.isRequired('party_bill_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('party_bill_no')} className="erp-input" value={form.party_bill_no} onChange={e => setForm({ ...form, party_bill_no: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('party_bill_date') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Party Bill Date {efc.isRequired('party_bill_date') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('party_bill_date')} type="date" className="erp-input" value={form.party_bill_date} onChange={e => setForm({ ...form, party_bill_date: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('cost_center_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Cost Center {efc.isRequired('cost_center_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="return_cost_center_picker"
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
                                    listKey="return_business_unit_picker"
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
                                <input className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Details</h2>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table min-w-[1100px]">
                                <thead>
                                    <tr>
                                        <th className="w-6"></th>
                                        <th className="w-56">Product</th>
                                        <th className={`w-24 ${efc.isVisible('qty', 'detail') ? '' : 'hidden'}`}>Qty</th>
                                        <th className={`w-32 ${efc.isVisible('uom_id', 'detail') ? '' : 'hidden'}`}>UOM</th>
                                        <th className={`w-24 ${efc.isVisible('rate', 'detail') ? '' : 'hidden'}`}>Rate</th>
                                        <th className={`w-20 ${efc.isVisible('tax_percent', 'detail') ? '' : 'hidden'}`}>Tax %</th>
                                        <th className="w-24">Amount</th>
                                        <th className={`w-40 ${efc.isVisible('warehouse_id', 'detail') ? '' : 'hidden'}`}>Details Warehouse</th>
                                        <th className={`w-28 ${efc.isVisible('batch_no', 'detail') ? '' : 'hidden'}`}>Batch No</th>
                                        <th className="w-32">Ref No</th>
                                        <th className={`w-40 ${efc.isVisible('line_reason', 'detail') ? '' : 'hidden'}`}>Line Reason</th>
                                        <th className="w-20">Term</th>
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
                                                            listKey="return_product_picker"
                                                            columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                            defaultVisibleKeys={['product_name']}
                                                            items={filterProductsByCompany(products, form.product_company_id)} getId={p => p.id} getLabel={p => p.product_name}
                                                            searchKeys={['product_name', 'product_code']}
                                                            value={d.product_id} onChange={id => handleProductSelect(idx, id)} placeholder="Product (F1/F2=history)"
                                                        />
                                                    </div>
                                                    <button type="button" tabIndex={-1} onClick={() => openProductHistory(d.product_id, false)} title="Last Purchase History (F1)" className="text-gray-400 hover:text-blue-600 text-sm px-1">🕐</button>
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
                                            <td className={efc.isVisible('uom_id', 'detail') ? '' : 'hidden'}>
                                                {productIsFixedDualUom(d.product_id) ? (
                                                    <span className="text-xs text-gray-400">{units.find(u => u.id === d.uom_id)?.unit_name}/{units.find(u => u.id === d.alt_unit_id)?.unit_name}</span>
                                                ) : (
                                                    <select disabled={efc.isReadonly('uom_id', 'detail')} className="erp-select" value={d.uom_id} onChange={e => updateDetailRow(idx, { uom_id: e.target.value })}>
                                                        <option value="">UOM</option>
                                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                    </select>
                                                )}
                                            </td>
                                            <td className={efc.isVisible('rate', 'detail') ? '' : 'hidden'}>
                                                <input disabled={efc.isReadonly('rate', 'detail')} type="number" step="0.0001" className="erp-input" value={d.rate} onChange={e => updateDetailRow(idx, { rate: e.target.value })} />
                                                {productIsFixedDualUom(d.product_id) && (
                                                    <select className="erp-select mt-1" style={{ fontSize: '10px', height: '22px' }} value={d.rate_basis} onChange={e => updateDetailRow(idx, { rate_basis: e.target.value })}>
                                                        <option value="primary">per {units.find(u => u.id === d.uom_id)?.unit_name || 'Primary'}</option>
                                                        <option value="secondary">per {units.find(u => u.id === d.alt_unit_id)?.unit_name || 'Secondary'}</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td className={efc.isVisible('tax_percent', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('tax_percent', 'detail')} type="number" step="0.01" className="erp-input" value={d.tax_percent} onChange={e => updateDetailRow(idx, { tax_percent: e.target.value })} /></td>
                                            <td className="text-gray-500">{lineAmount(d).toFixed(2)}</td>
                                            <td className={efc.isVisible('warehouse_id', 'detail') ? '' : 'hidden'}>
                                                <select disabled={efc.isReadonly('warehouse_id', 'detail')} className="erp-select" value={d.warehouse_id} onChange={e => updateDetailRow(idx, { warehouse_id: e.target.value })}>
                                                    <option value="">Warehouse</option>
                                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                                </select>
                                            </td>
                                            <td className={efc.isVisible('batch_no', 'detail') ? '' : 'hidden'}>
                                                {productMaintainsBatch(d.product_id) ? (
                                                    <input disabled={efc.isReadonly('batch_no', 'detail')} className="erp-input" value={d.batch_no} onChange={e => updateDetailRow(idx, { batch_no: e.target.value })} placeholder="Batch" />
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td className="text-xs text-gray-500">{d.source_doc_no || (d.source_bill_detail_id ? '…' : '—')}</td>
                                            <td className={efc.isVisible('line_reason', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('line_reason', 'detail')} className="erp-input" value={d.line_reason} onChange={e => updateDetailRow(idx, { line_reason: e.target.value })} /></td>
                                            <td><button type="button" tabIndex={-1} onClick={() => setProductTermModalIndexes([idx])} className="text-blue-600 text-xs underline">
                                                {(d.billing_term_ids || []).length > 0 ? `Term (${d.billing_term_ids.length})` : 'Term'}
                                            </button></td>
                                            <td><button type="button" tabIndex={-1} onClick={() => removeDetailRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                            <div className="flex items-center gap-3">
                                <button type="button" onClick={addDetailRow} className="text-xs text-blue-600">➕ Add Line</button>
                                <button
                                    type="button"
                                    onClick={() => setProductTermModalIndexes(selectedRowIndexes.length > 0 ? selectedRowIndexes : form.details.map((_, i) => i))}
                                    className="text-xs text-purple-600"
                                >
                                    🏷️ Product Term ({selectedRowIndexes.length > 0 ? `${selectedRowIndexes.length} selected` : 'all rows'})
                                </button>
                            </div>
                            <span className="text-sm font-semibold">Total: {grandTotal.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* ==================== BILLING TERMS ==================== */}
                    <div className="erp-card p-4 mb-3">
                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Billing Terms (Document-level)</h2>
                        <div className="space-y-1.5 mb-3">
                            {billingTerms.map(t => {
                                const checked = form.billing_term_ids.includes(t.id);
                                return (
                                    <label key={t.id} className="flex flex-wrap items-center gap-2 text-sm border rounded-lg px-3 py-2">
                                        <input type="checkbox" checked={checked} onChange={() => toggleBillingTerm(t.id)} />
                                        {t.term_name} <span className="text-xs text-gray-400">({t.term_code})</span>
                                        <TermLedgerInfo term={t} isReturn={true} subLedgers={subLedgers} value={(form.term_sub_ledgers || {})[t.id]} onChange={v => setForm(f => ({ ...f, term_sub_ledgers: { ...(f.term_sub_ledgers || {}), [t.id]: v } }))} />
                                    </label>
                                );
                            })}
                            {billingTerms.length === 0 && <p className="text-sm text-gray-400">No Billing Terms are set up for Purchase yet.</p>}
                        </div>
                        {summaryRows.length > 0 && (
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead><tr className="bg-slate-50 text-xs text-gray-500 uppercase"><th className="text-left px-3 py-1.5">Term</th><th className="text-right px-3 py-1.5">Amount</th></tr></thead>
                                    <tbody>
                                        {summaryRows.map(r => (
                                            <tr key={r.billing_term_id} className="border-t">
                                                <td className="px-3 py-1.5">{r.term_name}</td>
                                                <td className="px-3 py-1.5 text-right">
                                                    <input
                                                        type="number" step="0.01" className="erp-input text-right" style={{ maxWidth: '140px', marginLeft: 'auto' }}
                                                        value={summaryOverrides[r.billing_term_id] !== undefined ? summaryOverrides[r.billing_term_id] : r.original_total.toFixed(2)}
                                                        onChange={e => setSummaryOverrides(prev => ({ ...prev, [r.billing_term_id]: e.target.value }))}
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                        <tr className="border-t font-semibold bg-slate-50">
                                            <td className="px-3 py-1.5">Total</td>
                                            <td className="px-3 py-1.5 text-right">{summaryGrandTotal.toFixed(2)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {billingPreview && (
                            <p className="text-xs text-gray-400 mt-2">Document-level term adjustment (net): {(billingPreview.total !== undefined ? billingPreview.total - grandTotal : 0).toFixed(2)}</p>
                        )}
                    </div>

                    <BillWiseSettlementPanel
                            productCompanyId={form.product_company_id}
                        ledgerId={form.vendor_ledger_id}
                        outstandingNature="cr"
                        amount={grandTotal}
                        onSettlementsChange={setBillWiseSettlements}
                    />

                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>
                            <button type="button" onClick={e => handleSubmit(e, true)} className="erp-btn">💾 Save as Draft</button>
                            <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Create'} Return</button>
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
                storageKey="purchase_return_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        {row.status === 'posted' && <a href={`/print/purchase_return/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {row.status !== 'cancelled' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {row.status === 'draft' && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
                    </div>
                )}
            />
        </div>

        {productTermModalIndexes !== null && productTermModalIndexes.length > 0 && (() => {
            const targetLines = productTermModalIndexes.map(idx => ({ idx, line: form.details[idx] })).filter(t => t.line);
            const lineBasicOf = (line) => (Number(line.qty) || 0) * (Number(line.rate) || 0);
            const totalBasic = targetLines.reduce((s, t) => s + lineBasicOf(t.line), 0);
            const totalNetTermAmount = targetLines.reduce((s, t) => {
                const preview = lineTermPreviews[t.idx];
                return s + (preview?.total !== undefined ? preview.total - lineBasicOf(t.line) : 0);
            }, 0);
            return (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
                        <div className="erp-header">
                            <span className="erp-header-title">Product Term — {targetLines.length} Line{targetLines.length > 1 ? 's' : ''} Selected</span>
                        </div>
                        <div className="p-5">
                            <div className="max-h-32 overflow-y-auto border rounded-lg mb-4">
                                <table className="w-full text-xs">
                                    <thead><tr className="text-gray-500 uppercase"><th className="text-left px-2 py-1">Line</th><th className="text-left px-2 py-1">Product</th><th className="text-right px-2 py-1">Qty</th><th className="text-right px-2 py-1">Basic Value</th></tr></thead>
                                    <tbody>
                                        {targetLines.map(({ idx, line }) => (
                                            <tr key={idx} className="border-t">
                                                <td className="px-2 py-1">{idx + 1}</td>
                                                <td className="px-2 py-1">{line.product_name_snapshot || '—'}</td>
                                                <td className="px-2 py-1 text-right">{line.qty || 0}</td>
                                                <td className="px-2 py-1 text-right">{lineBasicOf(line).toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="erp-field mb-4">
                                <label className="erp-label">Combined Basic Value</label>
                                <input className="erp-input" disabled value={totalBasic.toFixed(2)} />
                            </div>
                            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                                Applicable Terms <span className="text-gray-400 normal-case">(checking a term applies it to every line above at once)</span>
                            </p>
                            <div className="space-y-1.5">
                                {billingTerms.map(t => {
                                    const checkedCount = targetLines.filter(({ line }) => (line.billing_term_ids || []).includes(t.id)).length;
                                    const allChecked = checkedCount === targetLines.length;
                                    const someChecked = checkedCount > 0 && !allChecked;
                                    return (
                                        <label key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-lg px-3 py-2">
                                            <span className="flex items-center gap-2">
                                                <input
                                                    type="checkbox" data-enter-skip="true" checked={allChecked}
                                                    ref={el => { if (el) el.indeterminate = someChecked; }}
                                                    onChange={() => toggleTermForLines(productTermModalIndexes, t.id)}
                                                />
                                                {t.term_name} <span className="text-xs text-gray-400">({t.term_code})</span>
                                            </span>
                                            {someChecked && <span className="text-xs text-amber-600">{checkedCount}/{targetLines.length}</span>}
                                            <TermLedgerInfo term={t} isReturn={true} subLedgers={subLedgers} value={(form.term_sub_ledgers || {})[t.id]} onChange={v => setForm(f => ({ ...f, term_sub_ledgers: { ...(f.term_sub_ledgers || {}), [t.id]: v } }))} />
                                        </label>
                                    );
                                })}
                                {billingTerms.length === 0 && <p className="text-sm text-gray-400">No Billing Terms are set up for Purchase yet.</p>}
                            </div>
                            <div className="flex justify-between font-semibold text-sm border-t pt-2 mt-3">
                                <span>Net Term Amount (combined, all selected lines)</span>
                                <span>{totalNetTermAmount.toFixed(2)}</span>
                            </div>
                        </div>
                        <div className="erp-bottombar">
                            <div />
                            <div className="erp-bottombar-actions">
                                <button type="button" onClick={() => setProductTermModalIndexes(null)} className="erp-btn primary">Ok</button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        })()}

        {historyModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">🕐 Last Purchase History — {historyModal.productName}{historyModal.anyVendor ? ' (Any Supplier)' : ''}</span></div>
                    <div className="p-4">
                        {historyModal.entries.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-6">No previous purchase of this product yet.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead>
                                        <tr><th>Bill Date</th><th>Bill No</th>{historyModal.anyVendor && <th>Supplier</th>}<th>Batch</th><th>Qty</th><th>Free</th><th>Rate</th><th>Disc %</th><th>Disc Amt</th><th>Amount</th></tr>
                                    </thead>
                                    <tbody>
                                        {historyModal.entries.map((h, i) => (
                                            <tr key={i}>
                                                <td>{h.doc_date}</td>
                                                <td>{h.doc_no}</td>
                                                {historyModal.anyVendor && <td className="text-xs text-gray-400">{h.vendor_name}</td>}
                                                <td>{h.batch_no || '—'}</td>
                                                <td>{h.qty}{h.alt_qty ? ` + ${h.alt_qty} ${h.alt_unit_name || ''}` : ''} {h.uom_name_snapshot}</td>
                                                <td>{(h.free_qty || h.free_alt_qty) ? `${h.free_qty || 0} ${h.uom_name_snapshot || ''}${h.free_alt_qty ? ` + ${h.free_alt_qty} ${h.alt_unit_name || ''}` : ''}` : '—'}</td>
                                                <td>{Number(h.rate).toFixed(2)}{h.rate_basis ? ` /${h.rate_basis}` : ''}</td>
                                                <td>{Number(h.discount_percent || 0).toFixed(2)}</td>
                                                <td>{Number(h.discount_amount || 0).toFixed(2)}</td>
                                                <td>{Number(h.amount).toFixed(2)}</td>
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
                            <button type="button" onClick={() => setHistoryModal(null)} className="erp-btn primary">Ok</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {showCopyModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">Copy From — Purchase Return</span></div>
                    <div className="p-4">
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {rows.map(r => (
                                <button key={r.id} type="button" onClick={() => handleCopyFrom(r.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{r.doc_no} <span className="text-xs text-gray-400">— {r.vendor_name_snapshot || r.cash_vendor_name || 'No vendor'}</span></span>
                                    <span className="text-xs text-gray-400">{r.doc_date} · {r.status}</span>
                                </button>
                            ))}
                            {rows.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No Returns yet to copy from.</p>}
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
