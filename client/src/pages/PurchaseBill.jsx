// =============================================
// PurchaseBill.jsx
// Master + Details entry, matching the Enter-nav/popup-picker pattern
// used across every master page. Vendor can be created inline from the
// popup itself (the "cash vendor" case - buying from someone not yet
// in Ledger Accounts) so the same vendor is immediately reusable on
// every later document in the chain (Quotation, Order, GRN, Bill).
// =============================================

import TermLedgerInfo from '../components/TermLedgerInfo';
import ProductCompanyField, { filterProductsByCompany } from '../components/ProductCompanyField';
import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import BillWiseSettlementPanel from '../components/BillWiseSettlementPanel';
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import { resolveDualUomEntryMode, onPrimaryQtyChange, onSecondaryQtyChange, validateFixedSecondary, dualBaseQty } from '../utils/dualUomEntryMode';
import UdfValuesModal from '../components/UdfValuesModal';
import useLedgerPurposes from '../components/useLedgerPurposes';
import RecordHistory from '../components/RecordHistory';

const emptyDetailRow = () => ({
    product_id: '', qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', alt1_qty: '', alt1_unit_id: '',
    rate: '', rate_basis: 'primary', discount_percent: '', tax_percent: '', narration: '',
    free_qty: '', free_alt_qty: '', free_uom_id: '', warehouse_id: '', barcode: '', batch_no: '', serial_no: '', source_doc_no: '',
    item_import_taxable_amount: '', item_import_tax_free_amount: '', billing_term_ids: [], product_company_id: '', term_sub_ledgers: {}
});

const emptyForm = {
    doc_date: new Date().toISOString().slice(0, 10), vendor_ledger_id: '', cash_vendor_name: '', agent_id: '', numbering_category_id: '',
    invoice_type: 'credit', currency: 'NPR', due_date: '', due_days: '', warehouse_id: '',
    goods_account_ledger_id: '', goods_sub_ledger_id: '', remarks_text: '',
    rate_type: 'exclusive', cost_center_id: '', business_unit_id: '', area_id: '', route_id: '',
    priority: 'normal', terms_conditions_id: '', narration: '',
    billing_term_ids: [], cash_billing_details: null,
    source_quotation_id: '', source_order_id: '', source_grn_id: '', party_bill_no: '', party_bill_date: '',
    import_detail_mode: '', customs_office_id: '', customs_declaration_no: '', customs_declaration_date: '',
    bill_wise_import_taxable_amount: '', bill_wise_import_tax_free_amount: '',
    details: [emptyDetailRow()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['agent_id', 'area_id', 'business_unit_id', 'cost_center_id', 'currency', 'doc_date', 'due_date', 'due_days', 'goods_account_ledger_id', 'goods_sub_ledger_id', 'invoice_type', 'narration', 'party_bill_date', 'party_bill_no', 'priority', 'rate_type', 'route_id', 'terms_conditions_id', 'vendor_ledger_id', 'warehouse_id'];

export default function PurchaseBill() {
    const { authFetch } = useAuth();
    const lp = useLedgerPurposes();
    // Compulsory check on save (incl. popup pickers, which HTML `required` can't enforce);
    // visibility / required marks on this page come from its own fieldControls.
    const efc = useEntryFieldControls('purchase_bill', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [billWiseSettlements, setBillWiseSettlements] = useState(null);
    // FEATURE: "Purchase Bill Save Garda if Tyo Vendor Ko Lc pending Xa
    // Vane Tyo Map Garne Vanne Option Dine" - when the chosen supplier
    // has an open LC with balance left, saving asks which LC (if any)
    // this bill should be mapped to. Skipping is always allowed; the
    // mapping can also be done later from LC Register.
    const [lcPrompt, setLcPrompt] = useState(null); // { lcs, saveAsDraft, choiceId, amount }
    const [alert, setAlert] = useState(null);

    // ---- master lookups for every picker ----
    const [vendors, setVendors] = useState([]);
    const [agents, setAgents] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [remarks, setRemarks] = useState([]);
    const [termsConditions, setTermsConditions] = useState([]);
    const [billingTerms, setBillingTerms] = useState([]);
    const [billingPreview, setBillingPreview] = useState(null);
    const [fieldControls, setFieldControls] = useState({});
    // FEATURE: "Product Term" - per-line billing term popup + a document
    // Summary that aggregates every line's own computed amounts, editable
    // with proportional redistribution back to the lines.
    const [productTermModalIndexes, setProductTermModalIndexes] = useState(null);
    const [lineTermPreviews, setLineTermPreviews] = useState({}); // { [lineIndex]: { lines, total } }
    const [summaryOverrides, setSummaryOverrides] = useState({}); // { [billingTermId]: overriddenAmount }
    const [auditModal, setAuditModal] = useState(null); // { doc_no, entries }
    // FEATURE: "pulls forward from Requisition and/or Quotation" - the
    // "pulls forward from any earlier stage" capability.
    const [pullQuotationId, setPullQuotationId] = useState('');
    const [pullOrderId, setPullOrderId] = useState('');
    const [pullGrnId, setPullGrnId] = useState('');
    const [openQuotations, setOpenQuotations] = useState([]);
    const [openOrders, setOpenOrders] = useState([]);
    const [openGrns, setOpenGrns] = useState([]);
    const [customsOffices, setCustomsOffices] = useState([]);
    // FEATURE: Master reorganized into tabs (not all fields flat) plus a
    // bottom bar for narration-style fields, matching the "own concept,
    // NAV style" desktop-form pattern.
    const [activeTab, setActiveTab] = useState('general');
    // FEATURE: Cash -> manual party name (or still pick from list if
    // preferred); Credit -> must pick from the Vendor list. This only
    // controls whether the FREE-TEXT name field is offered alongside the
    // picker - both invoice types can always use the picker.
    const [cashVendorName, setCashVendorName] = useState('');
    const [showCashBillingModal, setShowCashBillingModal] = useState(false);
    const [cashBillingForm, setCashBillingForm] = useState({
        street: '', city: '', state: '', country: '', zip: '', phone: '', email: '', contact_person: '',
        pan_number: '', cst_number: ''
    });
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [areas, setAreas] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addDetailRow(); return true; } });

    // ---- Vendor quick-create modal ("cash vendor" case) ----
    const [vendorModalOpen, setVendorModalOpen] = useState(false);
    const [vendorModalForm, setVendorModalForm] = useState({ account_name: '', phone: '', pan_number: '' });
    const vendorModalFormRef = useRef(null);
    useEnterKeyNavigation(vendorModalFormRef);

    // ---- Generic quick-create modal for every OTHER simple picker.
    // Warehouse, Goods Account (Ledger), Goods Sub-Ledger, and Product's
    // full detail are deliberately NOT here - each needs enough of its
    // own setup (Warehouse needs province/district, a Ledger needs an
    // Account Group, a Sub-Ledger needs a type-specific detail section)
    // that a one-line quick-add would either fail validation or create a
    // half-configured record - those stay a link to their full page.
    const [masterModal, setMasterModal] = useState(null); // 'agent' | 'remark' | 'cost_center' | 'business_unit' | 'area' | 'route' | 'product'
    const [masterModalForm, setMasterModalForm] = useState({ name: '', area_id: '', unit_id: '' });
    const masterModalFormRef = useRef(null);
    useEnterKeyNavigation(masterModalFormRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, v1, v2, ag, wh, ldg, sl, rmk, cc, bu, ar, rt, prod, un, tc, efc, bt, pquos, pords, pgrns, custOffices, sysCtrl] = await Promise.all([
                authFetch('/api/purchase-bills'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=purchase'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=both'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/warehouses'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/remarks'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/areas'),
                authFetch('/api/routes'),
                authFetch('/api/products'),
                authFetch('/api/product-units'),
                authFetch('/api/terms-conditions?applicable_to=purchase'),
                authFetch('/api/entry-field-controls/resolve?voucher_type=purchase_bill'),
                authFetch('/api/billing-terms'),
                authFetch('/api/purchase-quotations'),
                authFetch('/api/purchase-orders'),
                authFetch('/api/purchase-grns'),
                authFetch('/api/customs-offices'),
                authFetch('/api/system-control')
            ]);
            setOpenQuotations((pquos.data || []).filter(q => !['closed', 'cancelled'].includes(q.status)));
            setOpenOrders((pords.data || []).filter(o => !['closed', 'cancelled'].includes(o.status)));
            setOpenGrns((pgrns.data || []).filter(g => !['cancelled'].includes(g.status)));
            setCustomsOffices(custOffices.data || []);
            setRows(req.data || []);
            setVendors([...(v1.data || []), ...(v2.data || [])]);
            setAgents(ag.data || []);
            setWarehouses(wh.data || []);
            setLedgers(ldg.data || []);
            setSubLedgers(sl.data || []);
            setRemarks(rmk.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setAreas(ar.data || []);
            setRoutes(rt.data || []);
            setProducts(prod.data || []);
            setUnits(un.data || []);
            setTermsConditions(tc.data || []);
            // FIX: field_key collides between sections (warehouse_id and
            // narration exist on BOTH Master and Details) - key by
            // "section:field_key" so they never overwrite each other.
            const controlsMap = {};
            (efc.data || []).forEach(f => { controlsMap[`${f.section}:${f.field_key}`] = f.effective_mode; });
            setFieldControls(controlsMap);
            setBillingTerms((bt.data || []).filter(t => t.applicable_purchase_entry && t.is_enabled));
            setDualUomEntryMode(resolveDualUomEntryMode(sysCtrl.data));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setPullQuotationId(''); setPullOrderId(''); setPullGrnId(''); };

    // FEATURE: fetches the shared pull-forward endpoint and populates the
    // Master + Details with whatever it returns - user can still edit
    // everything afterward, this is a starting point, not a lock-in.
    const handlePullForward = async () => {
        if (!pullQuotationId && !pullOrderId && !pullGrnId) return showAlert('Pick a Quotation, Order, and/or GRN to pull from', 'danger');
        try {
            const params = new URLSearchParams();
            if (pullQuotationId) params.set('quotation_id', pullQuotationId);
            if (pullOrderId) params.set('order_id', pullOrderId);
            if (pullGrnId) params.set('grn_id', pullGrnId);
            const res = await authFetch(`/api/purchase-bills/pull-forward?${params}`);
            const { master, details } = res.data;
            setForm(f => ({
                ...f, ...master,
                source_quotation_id: pullQuotationId || '', source_order_id: pullOrderId || '', source_grn_id: pullGrnId || '',
                details: (details && details.length > 0) ? details.map(d => ({ ...emptyDetailRow(), ...d })) : f.details
            }));
            showAlert('Pulled forward - review and adjust before saving', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: Entry Field Control - resolved per-field mode drives
    // visibility/required/readonly across the whole form. Section
    // defaults to 'master' since that covers most calls; Details-grid
    // calls pass section='detail' explicitly - this matters because
    // warehouse_id and narration exist on BOTH sections with the same
    // field_key, so the section distinguishes which one is meant.
    const isVisible = (key, section = 'master') => fieldControls[`${section}:${key}`] !== 'disabled';
    const isRequired = (key, section = 'master') => fieldControls[`${section}:${key}`] === 'compulsory';
    const isReadonly = (key, section = 'master') => fieldControls[`${section}:${key}`] === 'readonly';

    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => {
        setForm(f => ({ ...f, details: f.details.length > 1 ? f.details.filter((_, i) => i !== idx) : f.details }));
        setSelectedRowIndexes(cur => cur.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
    };
    const updateDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));

    // FIX: mirrors the backend's exact formula (syncDetails in
    // purchaseOrderRoutes.js) so the on-screen total always
    // matches what actually gets saved - base minus discount, plus tax.
    // FEATURE: "Batch/Serial should follow Product Master's own setting"
    // - only show a Batch input for lines whose PRODUCT has
    // maintain_batch enabled; otherwise show a plain dash, and never
    // require it either way.
    const productMaintainsBatch = (productId) => !!products.find(p => p.id === productId)?.maintain_batch;
    const productTracksSerial = (productId) => !!products.find(p => p.id === productId)?.track_serial_number;
    // FEATURE: "whatever is ON for the Product, show that in the entry
    // form - like Alt UOM" - a product only has Alt Unit fields worth
    // showing if it actually has more than its base unit configured.
    const productHasAltUnits = (productId) => (products.find(p => p.id === productId)?.product_unit_rates?.length || 0) > 1;
    // FEATURE: "Fixed Duel Uom enabled xa vane purchase ra sales dubai
    // maa" - 5 CRT AND 5 PCS on one line, rate quotable in either unit.
    const productIsFixedDualUom = (productId) => products.find(p => p.id === productId)?.uom_mode === 'fixed_dual';
    const dualConversionFactor = (productId) => {
        const product = products.find(p => p.id === productId);
        const rate = (product?.product_unit_rates || []).find(r => r.unit_id === product?.dual_uom_primary_unit_id);
        return Number(rate?.conversion_factor) || 1;
    };

    // FEATURE: "if the Vendor's Country is not Nepal, it's an Import" -
    // Nepal is Local Purchase, anything else offers the Import section.
    const selectedVendor = vendors.find(v => v.id === form.vendor_ledger_id);
    const isImportVendor = !!selectedVendor && selectedVendor.country && selectedVendor.country !== 'Nepal';

    // FEATURE: picking a Fixed Dual UOM product auto-selects its own
    // Primary unit (e.g. Carton) and Secondary unit (e.g. loose Piece)
    // so the two qty boxes are labelled correctly from the start.
    const handleProductSelect = (idx, productId) => {
        const product = products.find(p => p.id === productId);
        if (product?.uom_mode === 'fixed_dual') {
            updateDetailRow(idx, { product_id: productId, uom_id: product.dual_uom_primary_unit_id || '', alt_unit_id: product.base_unit_id || '', rate_basis: 'primary' });
        } else {
            updateDetailRow(idx, { product_id: productId, uom_id: product?.base_unit_id || '' });
        }
    };

    // FEATURE: "[F1]: Last Purchase history, [F2]: Last Purchase
    // history (Any Supplier)" - matches the reference software's own
    // two-key distinction exactly.
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

    const lineGross = (d) => {
        if (productIsFixedDualUom(d.product_id) && d.alt_qty) {
            const factor = dualConversionFactor(d.product_id);
            const totalBaseQty = dualBaseQty(d.qty, d.alt_qty, factor, dualUomEntryMode.mode);
            return d.rate_basis === 'primary' ? (totalBaseQty / factor) * (Number(d.rate) || 0) : totalBaseQty * (Number(d.rate) || 0);
        }
        return (Number(d.qty) || 0) * (Number(d.rate) || 0);
    };
    const lineAmount = (d) => {
        const base = lineGross(d);
        const discount = d.discount_percent ? base * (Number(d.discount_percent) / 100) : 0;
        const taxable = base - discount;
        const tax = d.tax_percent ? taxable * (Number(d.tax_percent) / 100) : 0;
        return taxable + tax;
    };
    const grandTotal = form.details.reduce((sum, d) => sum + lineAmount(d), 0);
    const totalQty = form.details.reduce((sum, d) => sum + (Number(d.qty) || 0), 0);
    // FEATURE: "Product Level Billing Term popup huda multiple row maa
    // aunu paryo" - checked rows here become the target set the
    // Product Term modal applies term selections to, all at once.
    const [selectedRowIndexes, setSelectedRowIndexes] = useState([]);
    const [dualUomEntryMode, setDualUomEntryMode] = useState({ mode: 'fixed', reverseEnabled: false });

    // FEATURE: live preview of the SAME evaluateAllTerms() engine the
    // backend will use on save - refetches whenever the selected terms
    // or the line-items total changes, so the user sees the real
    // computed adjustment before submitting.
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
    // whenever qty/rate/billing_term_ids change on any line - each call
    // reuses the SAME /billing-terms/preview endpoint the document-level
    // preview already uses, just scoped to that one line's basic_amount.
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

    // FEATURE: "Product Level Billing Term popup huda multiple row maa
    // aunu paryo" - one checkbox click applies the SAME add/remove
    // action across every targeted line at once. If EVERY targeted line
    // already has the term, the click removes it from all of them;
    // otherwise it adds it to whichever ones don't have it yet (a
    // consistent "make them all match" toggle, not a per-line XOR that
    // could leave the set half-on).
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
    // Summary row per term (matching the "Overall Term(s)" concept) -
    // original totals before any Summary-level override.
    const summaryRows = useMemo(() => {
        const byTermId = {};
        form.details.forEach((d, lineIdx) => {
            const preview = lineTermPreviews[lineIdx];
            if (!preview) return;
            (d.billing_term_ids || []).forEach((termId, i) => {
                const term = billingTerms.find(t => t.id === termId);
                const amount = preview.lines[i]?.amount ?? 0;
                if (!byTermId[termId]) byTermId[termId] = { billing_term_id: termId, term_code: term?.term_code, term_name: term?.term_name, original_total: 0 };
                byTermId[termId].original_total += amount;
            });
        });
        return Object.values(byTermId);
    }, [form.details, lineTermPreviews, billingTerms]);

    const summaryGrandTotal = summaryRows.reduce((sum, r) => sum + (summaryOverrides[r.billing_term_id] !== undefined ? Number(summaryOverrides[r.billing_term_id]) : r.original_total), 0);

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        // FEATURE: "Save as Draft" - everything else can be filled in
        // later, so skip the full validation when explicitly saving as a
        // draft (matches the backend's own relaxed check for drafts).
        if (!saveAsDraft) {
            if (!form.vendor_ledger_id && !form.cash_vendor_name) return showAlert('A Vendor (or, for Cash, a Party Name) is required', 'danger');
        }
        const validDetails = form.details.filter(d => d.product_id && (Number(d.qty) > 0 || Number(d.alt_qty) > 0));
        if (!saveAsDraft && validDetails.length === 0) return showAlert('At least one complete line item (Product + Qty) is required', 'danger');
        // Posted (not draft) bill of a supplier with pending LC -> ask first.
        if (!saveAsDraft && form.vendor_ledger_id && !lcPrompt) {
            try {
                const pending = await authFetch(`/api/letters-of-credit/pending?vendor_ledger_id=${form.vendor_ledger_id}`);
                if ((pending.data || []).length > 0) {
                    const first = pending.data[0];
                    setLcPrompt({ lcs: pending.data, saveAsDraft, choiceId: first.id, amount: Math.min(first.remaining_amount, grandTotal).toFixed(2) });
                    return;
                }
            } catch { /* LC lookup failing must never block saving the bill */ }
        }
        await proceedSubmit(saveAsDraft, null);
    };

    const proceedSubmit = async (saveAsDraft, lcChoice) => {
        const validDetails = form.details.filter(d => d.product_id && (Number(d.qty) > 0 || Number(d.alt_qty) > 0));
        try {
            const payload = {
                ...form, details: validDetails, summary_overrides: summaryOverrides,
                ...(billWiseSettlements ? { bill_wise_settlements: billWiseSettlements } : {}),
                ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {})
            };
            let billId = editingId, docNo = null;
            if (editingId) {
                await authFetch(`/api/purchase-bills/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : 'Bill updated', 'success');
            } else {
                const res = await authFetch('/api/purchase-bills', { method: 'POST', body: JSON.stringify(payload) });
                billId = res.data.id; docNo = res.data.doc_no;
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Bill ${res.data.doc_no} created`, 'success');
            }
            if (lcChoice && billId) {
                // The bill is already saved - a mapping failure is reported
                // but never undoes the save; it can be fixed in LC Register.
                try {
                    const m = await authFetch(`/api/letters-of-credit/${lcChoice.lcId}/map`, { method: 'POST', body: JSON.stringify({ purchase_bill_id: billId, mapped_amount: Number(lcChoice.amount) }) });
                    showAlert(`${docNo ? `Bill ${docNo} created. ` : ''}${m.message}`, 'success');
                } catch (mapErr) {
                    showAlert(`Bill saved, but LC mapping failed: ${mapErr.message}. Map it from LC Register.`, 'warning');
                }
            }
            setLcPrompt(null);
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            setLcPrompt(null);
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/purchase-bills/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...res.data,
                doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date,
                due_date: res.data.due_date?.slice(0, 10) || '',
                details: (res.data.details || []).length > 0 ? res.data.details : [emptyDetailRow()]
            });
            try {
                const tsl = await authFetch(`/api/document-term-sub-ledgers?document_type=purchase_bill&document_id=${row.id}`);
                setForm(f => ({ ...f, term_sub_ledgers: tsl.data || {} }));
            } catch { /* keep master defaults */ }
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        // FEATURE: Bill cancellation always needs a reason (matches the
        // backend's own requirement) - goods already received need a
        // documented reason if the whole Bill gets voided.
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt('Reason for cancelling this Bill?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            await authFetch(`/api/purchase-bills/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            showAlert(`Marked as ${status}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: "Draft list can be deleted" - only ever offered for a
    // draft-status row (the backend enforces this too).
    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/purchase-bills/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: "Copy option - choose which same-module document to copy
    // from" - loads an EXISTING document's data into a fresh, unsaved
    // form (editingId stays null) so saving creates a brand new record.
    const handleCopyFrom = async (sourceId) => {
        try {
            const res = await authFetch(`/api/purchase-bills/${sourceId}`);
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
            showAlert(`Copied from ${src.doc_no} - review and save as a new Bill`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const [udfDoc, setUdfDoc] = useState(null);

    const openAuditTrail = (row) => setAuditModal({ id: row.id, doc_no: row.doc_no });

    // ---- Vendor quick-create ("cash vendor" inline creation) ----
    const saveVendorModal = async () => {
        if (!vendorModalForm.account_name.trim()) return showAlert('Vendor name is required', 'danger');
        try {
            const groupsRes = await authFetch('/api/account-groups');
            const purchaseGroup = (groupsRes.data || []).find(g => g.category_type === 'purchase');
            const res = await authFetch('/api/ledger-accounts', {
                method: 'POST',
                body: JSON.stringify({
                    account_name: vendorModalForm.account_name.trim(),
                    category_type: 'purchase',
                    account_group_id: purchaseGroup?.id,
                    phone: vendorModalForm.phone || undefined,
                    pan_number: vendorModalForm.pan_number || undefined
                })
            });
            await load();
            setForm(f => ({ ...f, vendor_ledger_id: res.data.id }));
            setVendorModalOpen(false);
            showAlert(`Vendor "${res.data.account_name}" created and selected`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // ---- Generic quick-create for simple pickers ----
    const openMasterModal = (type) => { setMasterModal(type); setMasterModalForm({ name: '', area_id: '', unit_id: '' }); };
    const saveMasterModal = async () => {
        if (!masterModalForm.name.trim()) return showAlert('Name is required', 'danger');
        try {
            if (masterModal === 'agent') {
                const res = await authFetch('/api/salesman-agents', { method: 'POST', body: JSON.stringify({ agent_name: masterModalForm.name }) });
                await load();
                setForm(f => ({ ...f, agent_id: res.data.id }));
            } else if (masterModal === 'remark') {
                const res = await authFetch('/api/remarks', { method: 'POST', body: JSON.stringify({ remark_text: masterModalForm.name }) });
                await load();
                setForm(f => ({ ...f, remarks_id: res.data.id }));
            } else if (masterModal === 'cost_center') {
                const res = await authFetch('/api/cost-centers', { method: 'POST', body: JSON.stringify({ cost_center_name: masterModalForm.name }) });
                await load();
                setForm(f => ({ ...f, cost_center_id: res.data.id }));
            } else if (masterModal === 'business_unit') {
                const res = await authFetch('/api/business-units', { method: 'POST', body: JSON.stringify({ unit_name: masterModalForm.name }) });
                await load();
                setForm(f => ({ ...f, business_unit_id: res.data.id }));
            } else if (masterModal === 'area') {
                const res = await authFetch('/api/areas', { method: 'POST', body: JSON.stringify({ area_name: masterModalForm.name }) });
                await load();
                setForm(f => ({ ...f, area_id: res.data.id }));
            } else if (masterModal === 'route') {
                if (!masterModalForm.area_id) return showAlert('Please choose an Area for this route', 'danger');
                const res = await authFetch('/api/routes', { method: 'POST', body: JSON.stringify({ route_name: masterModalForm.name, area_id: masterModalForm.area_id }) });
                await load();
                setForm(f => ({ ...f, route_id: res.data.id }));
            } else if (masterModal === 'customs_office') {
                const res = await authFetch('/api/customs-offices', { method: 'POST', body: JSON.stringify({ office_name: masterModalForm.name }) });
                await load();
                setForm(f => ({ ...f, customs_office_id: res.data.id }));
            } else if (masterModal === 'product') {
                if (!masterModalForm.unit_id) return showAlert('Please choose a Base Unit for this product', 'danger');
                const res = await authFetch('/api/products', {
                    method: 'POST',
                    body: JSON.stringify({
                        product_name: masterModalForm.name, base_unit_id: masterModalForm.unit_id,
                        unit_rates: [{ unit_id: masterModalForm.unit_id, is_base_unit: true, conversion_factor: 1 }]
                    })
                });
                await load();
                showAlert(`Product "${res.data.product_name}" created - open Product Master to fill in rates and other details`, 'success');
            }
            setMasterModal(null);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text' },
        { key: 'vendor', label: 'Vendor', type: 'text', render: r => r.vendor_display_name || '—' },
        { key: 'warehouse', label: 'Warehouse', type: 'text', render: r => r.warehouse_display_name || '—' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📋 Purchase Bill</span>
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
                    {/* ==================== PULL FORWARD (universal - any earlier stage) ==================== */}
                    {!editingId && (
                        <div className="erp-topbar grid-cols-1 md:grid-cols-4" style={{ background: '#eff6ff' }}>
                            <div className="erp-field">
                                <label className="erp-label">Pull From Quotation</label>
                                <select className="erp-select" value={pullQuotationId} onChange={e => setPullQuotationId(e.target.value)}>
                                    <option value="">— None —</option>
                                    {openQuotations.map(q => <option key={q.id} value={q.id}>{q.doc_no}</option>)}
                                </select>
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Pull From Order</label>
                                <select className="erp-select" value={pullOrderId} onChange={e => setPullOrderId(e.target.value)}>
                                    <option value="">— None —</option>
                                    {openOrders.map(o => <option key={o.id} value={o.id}>{o.doc_no} — {o.vendor_display_name || 'No vendor yet'}</option>)}
                                </select>
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Pull From GRN</label>
                                <select className="erp-select" value={pullGrnId} onChange={e => setPullGrnId(e.target.value)}>
                                    <option value="">— None —</option>
                                    {openGrns.map(g => <option key={g.id} value={g.id}>{g.doc_no} — {g.vendor_display_name || 'No vendor yet'}</option>)}
                                </select>
                            </div>
                            <div className="erp-field justify-end">
                                <button type="button" onClick={handlePullForward} className="erp-btn primary">⬇ Pull Forward</button>
                            </div>
                            <p className="text-xs text-gray-400 md:col-span-4">Pick any combination - all their lines get merged in. GRN lines only bring in what's still outstanding (not yet billed).</p>
                        </div>
                    )}

                    {/* ==================== TOP BAR (identity fields, Cash/Credit up front) ==================== */}
                    <div className="erp-topbar grid-cols-1 md:grid-cols-6">
                        <div className="erp-field">
                            <label className="erp-label">Doc No <span className="hint">(auto)</span></label>
                            <input className="erp-input" disabled value={editingId ? (form.doc_no || '') : 'Auto on save'} />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Date {isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })}
                                required={isRequired('doc_date')} disabled={isReadonly('doc_date')} />
                        </div>
                        <div className={`erp-field ${isVisible('invoice_type') ? '' : 'hidden'}`}>
                            <label className="erp-label">Cash / Credit</label>
                            <select className="erp-select" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value, vendor_ledger_id: '', cash_vendor_name: '' })}>
                                <option value="cash">Cash</option>
                                <option value="credit">Credit</option>
                            </select>
                        </div>
                        <div className={`erp-field md:col-span-2 ${isVisible('vendor_ledger_id') ? '' : 'hidden'}`}>
                            <label className="erp-label">
                                {form.invoice_type === 'cash' ? 'Party Name' : 'Vendor'}
                                {form.invoice_type === 'cash' && <span className="hint"> (type freely, or use the list button)</span>}
                            </label>
                            {form.invoice_type === 'cash' && !form.vendor_ledger_id ? (
                                <div className="flex gap-1">
                                    <input className="erp-input flex-1" value={form.cash_vendor_name}
                                        onChange={e => setForm(f => ({ ...f, cash_vendor_name: e.target.value }))}
                                        placeholder="Type party name" />
                                    <button type="button" tabIndex={-1} onClick={() => setShowCashBillingModal(true)} className="erp-btn ghost px-2" title="Billing/Shipping & Taxation details">📋</button>
                                </div>
                            ) : (
                                <div className="flex gap-1">
                                    <div className="flex-1">
                                        <SearchablePopupSelect
                                            listKey="purchase_bill_vendor_picker"
                                            columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                            defaultVisibleKeys={['account_name']}
                                            items={vendors} getId={v => v.id} getLabel={v => v.account_name}
                                            searchKeys={['account_name', 'account_code']}
                                            value={form.vendor_ledger_id} onChange={id => setForm({ ...form, vendor_ledger_id: id, cash_vendor_name: '', vendor_sub_ledger_id: '' })}
                                            placeholder="Select or create Vendor"
                                            onAddNew={() => { setVendorModalForm({ account_name: '', phone: '', pan_number: '' }); setVendorModalOpen(true); }}
                                        />
                                    </div>
                                    {form.invoice_type === 'cash' && (
                                        <button type="button" tabIndex={-1} onClick={() => setForm(f => ({ ...f, vendor_ledger_id: '' }))} className="erp-btn ghost px-2" title="Switch back to typing a name">✎</button>
                                    )}
                                </div>
                            )}
                        </div>
                        <ProductCompanyField side="purchase" form={form} setForm={setForm} products={products} emptyRow={emptyDetailRow} />
                        <div className={isVisible('priority') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Priority</label>
                            <select className="erp-select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                                <option value="low">Low</option>
                                <option value="normal">Normal</option>
                                <option value="urgent">Urgent</option>
                            </select>
                        </div>
                    </div>

                    {/* ==================== TABS ==================== */}
                    <div className="erp-tabs">
                        <button type="button" className={`erp-tab ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>General</button>
                        <button type="button" className={`erp-tab ${activeTab === 'accounts' ? 'active' : ''}`} onClick={() => setActiveTab('accounts')}>Accounts &amp; Allocation</button>
                        <button type="button" className={`erp-tab ${activeTab === 'additional' ? 'active' : ''}`} onClick={() => setActiveTab('additional')}>Additional</button>
                        {isImportVendor && (
                            <button type="button" className={`erp-tab ${activeTab === 'import' ? 'active' : ''}`} onClick={() => setActiveTab('import')}>🛃 Import / Customs</button>
                        )}
                    </div>
                    <div className="erp-tab-content">
                        <div className={activeTab === 'general' ? 'grid grid-cols-1 md:grid-cols-4 gap-3' : 'hidden'}>
                            <div className={isVisible('agent_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Agent</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_agent_picker"
                                    columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                    defaultVisibleKeys={['agent_name']}
                                    items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                    searchKeys={['agent_name', 'agent_code']}
                                    value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })} placeholder="Select Agent"
                                    onAddNew={() => openMasterModal('agent')}
                                    disabled={isReadonly('agent_id')}
                                />
                            </div>
                            <div className={isVisible('currency') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Currency</label>
                                <input className="erp-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} />
                            </div>
                            <div className={isVisible('due_date') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Due Date</label>
                                <input type="date" className="erp-input" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                            </div>
                            <div className={isVisible('due_days') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Due Days</label>
                                <input type="number" className="erp-input" value={form.due_days} onChange={e => setForm({ ...form, due_days: e.target.value })} />
                            </div>
                            <div className={isVisible('warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Master Warehouse</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_warehouse_picker"
                                    columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                    defaultVisibleKeys={['warehouse_name']}
                                    items={warehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                    searchKeys={['warehouse_name', 'warehouse_code']}
                                    value={form.warehouse_id} onChange={id => setForm({ ...form, warehouse_id: id })} placeholder="Select Warehouse"
                                />
                            </div>
                            {!editingId && (
                                <NumberingCategorySelector voucherType="purchase_bill" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                            )}
                        </div>

                        <div className={activeTab === 'accounts' ? 'grid grid-cols-1 md:grid-cols-4 gap-3' : 'hidden'}>
                            <div className="erp-field">
                                <label className="erp-label">Vendor Sub-Ledger</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_vendor_subledger_picker"
                                    columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]}
                                    defaultVisibleKeys={['name']}
                                    items={subLedgers.filter(x => x.main_ledger_id === form.vendor_ledger_id).map(x => ({ id: x.id, code: x.sub_ledger_code, name: x.sub_ledger_name }))} getId={x => x.id} getLabel={x => x.name}
                                    searchKeys={['name', 'code']}
                                    value={form.vendor_sub_ledger_id} onChange={id => setForm({ ...form, vendor_sub_ledger_id: id })} placeholder="None"
                                />
                            </div>
                            <div className={isVisible('goods_account_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Goods Account</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_goods_account_picker"
                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                    defaultVisibleKeys={['account_name']}
                                    items={lp.filter(ledgers, 'purchase_goods', form.goods_account_ledger_id)} getId={l => l.id} getLabel={l => l.account_name}
                                    searchKeys={['account_name', 'account_code']}
                                    value={form.goods_account_ledger_id} onChange={id => setForm({ ...form, goods_account_ledger_id: id, goods_sub_ledger_id: '' })} placeholder="Select Ledger"
                                />
                            </div>
                            <div className={isVisible('goods_sub_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Goods Sub-Ledger</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_goods_subledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers.filter(s => s.main_ledger_id === form.goods_account_ledger_id)} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.goods_sub_ledger_id} onChange={id => setForm({ ...form, goods_sub_ledger_id: id })} placeholder="Select Sub-Ledger"
                                />
                            </div>
                            <div className={isVisible('rate_type') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Rate Type</label>
                                <select className="erp-select" value={form.rate_type} onChange={e => setForm({ ...form, rate_type: e.target.value })}>
                                    <option value="exclusive">Exclusive of Tax</option>
                                    <option value="inclusive">Inclusive of Tax</option>
                                </select>
                            </div>
                            <div className={isVisible('cost_center_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Cost Center</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_cost_center_picker"
                                    columns={[{ key: 'cost_center_code', label: 'Code' }, { key: 'cost_center_name', label: 'Name' }]}
                                    defaultVisibleKeys={['cost_center_name']}
                                    items={costCenters} getId={c => c.id} getLabel={c => c.cost_center_name}
                                    searchKeys={['cost_center_name', 'cost_center_code']}
                                    value={form.cost_center_id} onChange={id => setForm({ ...form, cost_center_id: id })} placeholder="Select Cost Center"
                                    onAddNew={() => openMasterModal('cost_center')}
                                />
                            </div>
                            <div className={isVisible('business_unit_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Unit (Business Unit)</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                    onAddNew={() => openMasterModal('business_unit')}
                                />
                            </div>
                            <div className={isVisible('area_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Area</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_area_picker"
                                    columns={[{ key: 'area_code', label: 'Code' }, { key: 'area_name', label: 'Name' }]}
                                    defaultVisibleKeys={['area_name']}
                                    items={areas} getId={a => a.id} getLabel={a => a.area_name}
                                    searchKeys={['area_name', 'area_code']}
                                    value={form.area_id} onChange={id => setForm({ ...form, area_id: id })} placeholder="Select Area"
                                    onAddNew={() => openMasterModal('area')}
                                />
                            </div>
                            <div className={isVisible('route_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Route</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_route_picker"
                                    columns={[{ key: 'route_code', label: 'Code' }, { key: 'route_name', label: 'Name' }]}
                                    defaultVisibleKeys={['route_name']}
                                    items={routes} getId={r => r.id} getLabel={r => r.route_name}
                                    searchKeys={['route_name', 'route_code']}
                                    value={form.route_id} onChange={id => setForm({ ...form, route_id: id })} placeholder="Select Route"
                                    onAddNew={() => openMasterModal('route')}
                                />
                            </div>
                        </div>

                        <div className={activeTab === 'additional' ? 'grid grid-cols-1 md:grid-cols-4 gap-3' : 'hidden'}>
                            <div className={isVisible('party_bill_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Party Bill No</label>
                                <input className="erp-input" value={form.party_bill_no} onChange={e => setForm({ ...form, party_bill_no: e.target.value })} />
                            </div>
                            <div className={isVisible('party_bill_date') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Party Bill Date</label>
                                <input type="date" className="erp-input" value={form.party_bill_date} onChange={e => setForm({ ...form, party_bill_date: e.target.value })} />
                            </div>
                            <div className={`erp-field md:col-span-2 ${isVisible('terms_conditions_id') ? '' : 'hidden'}`}>
                                <label className="erp-label">Terms &amp; Conditions</label>
                                <SearchablePopupSelect
                                    listKey="purchase_bill_terms_picker"
                                    columns={[{ key: 'title', label: 'Title' }]}
                                    defaultVisibleKeys={['title']}
                                    items={termsConditions} getId={t => t.id} getLabel={t => t.title}
                                    searchKeys={['title']}
                                    value={form.terms_conditions_id} onChange={id => setForm({ ...form, terms_conditions_id: id })} placeholder="Select Terms"
                                />
                            </div>
                        </div>

                        {/* ==================== IMPORT / CUSTOMS (only for non-Nepal vendor) ==================== */}
                        {isImportVendor && (
                            <div className={activeTab === 'import' ? '' : 'hidden'}>
                                <p className="text-xs text-gray-500 mb-3">
                                    {selectedVendor?.account_name} is based in <b>{selectedVendor?.country}</b> - this is an Import purchase.
                                    Customs' own valuation can differ from the vendor's invoiced amount, so capture both here for the Purchase VAT Register.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                                    <div className="erp-field">
                                        <label className="erp-label">Import Detail Mode</label>
                                        <select className="erp-select" value={form.import_detail_mode} onChange={e => setForm({ ...form, import_detail_mode: e.target.value })}>
                                            <option value="">— Select —</option>
                                            <option value="item_wise">Item-wise</option>
                                            <option value="bill_wise">Bill-wise</option>
                                        </select>
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Customs Office (Bhansar)</label>
                                        <SearchablePopupSelect
                                            listKey="purchase_bill_customs_office_picker"
                                            columns={[{ key: 'office_name', label: 'Name' }]}
                                            defaultVisibleKeys={['office_name']}
                                            items={customsOffices} getId={c => c.id} getLabel={c => c.office_name}
                                            searchKeys={['office_name']}
                                            value={form.customs_office_id} onChange={id => setForm({ ...form, customs_office_id: id })} placeholder="Select Customs Office"
                                            onAddNew={() => openMasterModal('customs_office')}
                                        />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Import Declaration No <span className="hint">(Pragyapan Patra)</span></label>
                                        <input className="erp-input" value={form.customs_declaration_no} onChange={e => setForm({ ...form, customs_declaration_no: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Declaration Date</label>
                                        <input type="date" className="erp-input" value={form.customs_declaration_date} onChange={e => setForm({ ...form, customs_declaration_date: e.target.value })} />
                                    </div>
                                </div>
                                {form.import_detail_mode === 'bill_wise' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 rounded-lg p-4">
                                        <div className="erp-field">
                                            <label className="erp-label">Import Taxable Amount (whole bill)</label>
                                            <input type="number" step="0.01" className="erp-input" value={form.bill_wise_import_taxable_amount} onChange={e => setForm({ ...form, bill_wise_import_taxable_amount: e.target.value })} />
                                        </div>
                                        <div className="erp-field">
                                            <label className="erp-label">Import Tax-Free Amount (whole bill)</label>
                                            <input type="number" step="0.01" className="erp-input" value={form.bill_wise_import_tax_free_amount} onChange={e => setForm({ ...form, bill_wise_import_tax_free_amount: e.target.value })} />
                                        </div>
                                    </div>
                                )}
                                {form.import_detail_mode === 'item_wise' && (
                                    <p className="text-xs text-gray-400">Item-wise mode - enter each line's own Import Taxable/Tax-Free Amount directly in the Details grid below.</p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="px-4">

                    {/* ==================== DETAILS PART ==================== */}
                    <div className="border-t pt-4">
                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-3">Details</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[1400px]">
                                <thead>
                                    <tr className="text-xs text-gray-500 uppercase">
                                        <th className="text-left px-1 py-1 w-6"></th>
                                        <th className="text-left px-1 py-1 w-56">Product {isRequired('product_id', 'detail') && <span className="text-red-500">*</span>}</th>
                                        <th className="text-left px-1 py-1 w-24">Qty {isRequired('qty', 'detail') && <span className="text-red-500">*</span>}</th>
                                        <th className={`text-left px-1 py-1 w-32 ${isVisible('uom_id', 'detail') ? '' : 'hidden'}`}>UOM</th>
                                        <th className={`text-left px-1 py-1 w-20 ${isVisible('alt_qty', 'detail') ? '' : 'hidden'}`}>Alt Qty</th>
                                        <th className={`text-left px-1 py-1 w-32 ${isVisible('alt_unit_id', 'detail') ? '' : 'hidden'}`}>Alt Unit</th>
                                        <th className={`text-left px-1 py-1 w-20 ${isVisible('alt1_qty', 'detail') ? '' : 'hidden'}`}>Alt1 Qty</th>
                                        <th className={`text-left px-1 py-1 w-32 ${isVisible('alt1_unit_id', 'detail') ? '' : 'hidden'}`}>Alt1 Unit</th>
                                        <th className={`text-left px-1 py-1 w-24 ${isVisible('rate', 'detail') ? '' : 'hidden'}`}>Rate</th>
                                        <th className={`text-left px-1 py-1 w-20 ${isVisible('discount_percent', 'detail') ? '' : 'hidden'}`}>Disc %</th>
                                        <th className={`text-left px-1 py-1 w-20 ${isVisible('tax_percent', 'detail') ? '' : 'hidden'}`}>Tax %</th>
                                        <th className="text-left px-1 py-1 w-24">Amount</th>
                                        <th className={`text-left px-1 py-1 w-20 ${isVisible('free_qty', 'detail') ? '' : 'hidden'}`}>Free Qty</th>
                                        <th className={`text-left px-1 py-1 w-32 ${isVisible('free_uom_id', 'detail') ? '' : 'hidden'}`}>Free UOM</th>
                                        <th className={`text-left px-1 py-1 w-40 ${isVisible('warehouse_id', 'detail') ? '' : 'hidden'}`}>Details Warehouse</th>
                                        <th className={`text-left px-1 py-1 w-28 ${isVisible('barcode', 'detail') ? '' : 'hidden'}`}>Barcode</th>
                                        <th className={`text-left px-1 py-1 w-28 ${isVisible('batch_no', 'detail') ? '' : 'hidden'}`}>Batch No</th>
                                        <th className="text-left px-1 py-1 w-32">Ref No <span className="text-gray-400 normal-case">(source doc)</span></th>
                                        {form.import_detail_mode === 'item_wise' && (
                                            <>
                                                <th className="text-left px-1 py-1 w-32">Import Taxable</th>
                                                <th className="text-left px-1 py-1 w-32">Import Tax-Free</th>
                                            </>
                                        )}
                                        <th className={`text-left px-1 py-1 w-40 ${isVisible('narration', 'detail') ? '' : 'hidden'}`}>Narration</th>
                                        <th className="text-left px-1 py-1 w-20">Term</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.details.map((d, idx) => (
                                        <tr key={idx} className="border-t border-gray-100">
                                            <td className="px-1 py-1">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRowIndexes.includes(idx)}
                                                    onChange={e => setSelectedRowIndexes(cur => e.target.checked ? [...cur, idx] : cur.filter(i => i !== idx))}
                                                />
                                            </td>
                                            <td className="px-1 py-1" onKeyDown={e => handleProductRowKeyDown(e, d.product_id)}>
                                                <div className="flex items-center gap-1">
                                                    <div className="flex-1">
                                                        <SearchablePopupSelect
                                                            listKey="purchase_bill_product_picker"
                                                            columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                            defaultVisibleKeys={['product_name']}
                                                            items={filterProductsByCompany(products, form.product_company_id)} getId={p => p.id} getLabel={p => p.product_name}
                                                            searchKeys={['product_name', 'product_code']}
                                                            value={d.product_id} onChange={id => handleProductSelect(idx, id)} placeholder="Product (F1/F2=history)"
                                                            onAddNew={() => openMasterModal('product')}
                                                        />
                                                    </div>
                                                    {d.product_id && (
                                                        <button type="button" tabIndex={-1} onClick={() => openProductHistory(d.product_id, false)} title="Last Purchase History (F1)" className="text-gray-400 hover:text-blue-600 text-sm px-1">🕐</button>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-1 py-1">
                                                {productIsFixedDualUom(d.product_id) ? (
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-1">
                                                            <input disabled={efc.isReadonly('qty', 'detail')}
                                                                type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" style={{ width: '60px' }} value={d.qty}
                                                                onChange={e => updateDetailRow(idx, dualUomEntryMode.mode === 'auto_convert' ? onPrimaryQtyChange(e.target.value, dualConversionFactor(d.product_id)) : { qty: e.target.value })}
                                                            />
                                                            <span className="text-[10px] text-gray-400">{units.find(u => u.id === d.uom_id)?.unit_name || 'Primary'}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <input disabled={efc.isReadonly('alt_qty', 'detail')}
                                                                type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" style={{ width: '60px' }} value={d.alt_qty} placeholder="0"
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
                                                    <input disabled={efc.isReadonly('qty', 'detail')} type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" value={d.qty} onChange={e => updateDetailRow(idx, { qty: e.target.value })} />
                                                )}
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('uom_id', 'detail') ? '' : 'hidden'}`}>
                                                {productIsFixedDualUom(d.product_id) ? (
                                                    <span className="text-xs text-gray-400">{units.find(u => u.id === d.uom_id)?.unit_name}/{units.find(u => u.id === d.alt_unit_id)?.unit_name}</span>
                                                ) : (
                                                    <select disabled={efc.isReadonly('uom_id', 'detail')} className="w-full border rounded px-1.5 py-1" value={d.uom_id} onChange={e => updateDetailRow(idx, { uom_id: e.target.value })}>
                                                        <option value="">UOM</option>
                                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                    </select>
                                                )}
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('alt_qty', 'detail') ? '' : 'hidden'}`}>
                                                {productIsFixedDualUom(d.product_id) ? <span className="text-gray-300 text-xs">(above)</span> : productHasAltUnits(d.product_id) ? <input disabled={efc.isReadonly('alt_qty', 'detail')} type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" value={d.alt_qty} onChange={e => updateDetailRow(idx, { alt_qty: e.target.value })} /> : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('alt_unit_id', 'detail') ? '' : 'hidden'}`}>
                                                {productHasAltUnits(d.product_id) ? (
                                                <select disabled={efc.isReadonly('alt_unit_id', 'detail')} className="w-full border rounded px-1.5 py-1" value={d.alt_unit_id} onChange={e => updateDetailRow(idx, { alt_unit_id: e.target.value })}>
                                                    <option value="">Unit</option>
                                                    {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                </select>
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('alt1_qty', 'detail') ? '' : 'hidden'}`}>
                                                {productHasAltUnits(d.product_id) ? <input type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" value={d.alt1_qty} onChange={e => updateDetailRow(idx, { alt1_qty: e.target.value })} /> : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('alt1_unit_id', 'detail') ? '' : 'hidden'}`}>
                                                {productHasAltUnits(d.product_id) ? (
                                                <select className="w-full border rounded px-1.5 py-1" value={d.alt1_unit_id} onChange={e => updateDetailRow(idx, { alt1_unit_id: e.target.value })}>
                                                    <option value="">Unit</option>
                                                    {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                </select>
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('rate', 'detail') ? '' : 'hidden'}`}>
                                                <input disabled={efc.isReadonly('rate', 'detail')} type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" value={d.rate} onChange={e => updateDetailRow(idx, { rate: e.target.value })} />
                                                {productIsFixedDualUom(d.product_id) && (
                                                    <select className="w-full border rounded px-1 py-0.5 mt-1" style={{ fontSize: '10px' }} value={d.rate_basis} onChange={e => updateDetailRow(idx, { rate_basis: e.target.value })}>
                                                        <option value="primary">per {units.find(u => u.id === d.uom_id)?.unit_name || 'Primary'}</option>
                                                        <option value="secondary">per {units.find(u => u.id === d.alt_unit_id)?.unit_name || 'Secondary'}</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('discount_percent', 'detail') ? '' : 'hidden'}`}><input disabled={efc.isReadonly('discount_percent', 'detail')} type="number" step="0.01" className="w-full border rounded px-1.5 py-1" value={d.discount_percent} onChange={e => updateDetailRow(idx, { discount_percent: e.target.value })} /></td>
                                            <td className={`px-1 py-1 ${isVisible('tax_percent', 'detail') ? '' : 'hidden'}`}><input disabled={efc.isReadonly('tax_percent', 'detail')} type="number" step="0.01" className="w-full border rounded px-1.5 py-1" value={d.tax_percent} onChange={e => updateDetailRow(idx, { tax_percent: e.target.value })} /></td>
                                            <td className="px-1 py-1 text-gray-500">{lineAmount(d).toFixed(2)}</td>
                                            <td className={`px-1 py-1 ${isVisible('free_qty', 'detail') ? '' : 'hidden'}`}>
                                                {productIsFixedDualUom(d.product_id) ? (
                                                    <div className="flex flex-col gap-1">
                                                        <input disabled={efc.isReadonly('free_qty', 'detail')} type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" style={{ width: '60px' }} value={d.free_qty} onChange={e => updateDetailRow(idx, { free_qty: e.target.value })} placeholder="0" />
                                                        <input type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" style={{ width: '60px' }} value={d.free_alt_qty} onChange={e => updateDetailRow(idx, { free_alt_qty: e.target.value })} placeholder="0" />
                                                    </div>
                                                ) : (
                                                    <input disabled={efc.isReadonly('free_qty', 'detail')} type="number" step="0.0001" className="w-full border rounded px-1.5 py-1" value={d.free_qty} onChange={e => updateDetailRow(idx, { free_qty: e.target.value })} />
                                                )}
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('free_uom_id', 'detail') ? '' : 'hidden'}`}>
                                                <select disabled={efc.isReadonly('free_uom_id', 'detail')} className="w-full border rounded px-1.5 py-1" value={d.free_uom_id} onChange={e => updateDetailRow(idx, { free_uom_id: e.target.value })}>
                                                    <option value="">UOM</option>
                                                    {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                </select>
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('warehouse_id', 'detail') ? '' : 'hidden'}`}>
                                                <select disabled={efc.isReadonly('warehouse_id', 'detail')} className="w-full border rounded px-1.5 py-1" value={d.warehouse_id} onChange={e => updateDetailRow(idx, { warehouse_id: e.target.value })}>
                                                    <option value="">Warehouse</option>
                                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                                </select>
                                            </td>
                                            <td className={`px-1 py-1 ${isVisible('barcode', 'detail') ? '' : 'hidden'}`}><input disabled={efc.isReadonly('barcode', 'detail')} className="w-full border rounded px-1.5 py-1" value={d.barcode} onChange={e => updateDetailRow(idx, { barcode: e.target.value })} /></td>
                                            <td className={`px-1 py-1 ${isVisible('batch_no', 'detail') ? '' : 'hidden'}`}>
                                                {productMaintainsBatch(d.product_id) ? (
                                                    <input disabled={efc.isReadonly('batch_no', 'detail')} className="w-full border rounded px-1.5 py-1" value={d.batch_no} onChange={e => updateDetailRow(idx, { batch_no: e.target.value })} placeholder="Batch" />
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                                {productTracksSerial(d.product_id) && <input className="w-full border rounded px-1.5 py-1 mt-1" value={d.serial_no || ''} onChange={e => updateDetailRow(idx, { serial_no: e.target.value })} placeholder="Serial No(s)" title="Serial numbers, comma separated - used for serial-wise costing" />}
                                            </td>
                                            <td className="px-1 py-1 text-xs text-gray-500">{d.source_doc_no || (d.source_quotation_detail_id || d.source_order_detail_id || d.source_grn_detail_id ? '…' : '—')}</td>
                                            {form.import_detail_mode === 'item_wise' && (
                                                <>
                                                    <td className="px-1 py-1"><input type="number" step="0.01" className="w-full border rounded px-1.5 py-1" value={d.item_import_taxable_amount} onChange={e => updateDetailRow(idx, { item_import_taxable_amount: e.target.value })} /></td>
                                                    <td className="px-1 py-1"><input type="number" step="0.01" className="w-full border rounded px-1.5 py-1" value={d.item_import_tax_free_amount} onChange={e => updateDetailRow(idx, { item_import_tax_free_amount: e.target.value })} /></td>
                                                </>
                                            )}
                                            <td className={`px-1 py-1 ${isVisible('narration', 'detail') ? '' : 'hidden'}`}><input disabled={efc.isReadonly('narration', 'detail')} className="w-full border rounded px-1.5 py-1" value={d.narration} onChange={e => updateDetailRow(idx, { narration: e.target.value })} /></td>
                                            <td className="px-1 py-1"><button type="button" tabIndex={-1} onClick={() => setProductTermModalIndexes([idx])} className="text-blue-600 text-xs underline">
                                                {(d.billing_term_ids || []).length > 0 ? `Term (${d.billing_term_ids.length})` : 'Term'}
                                            </button></td>
                                            <td className="px-1 py-1"><button type="button" tabIndex={-1} onClick={() => removeDetailRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                            <div className="flex items-center gap-3">
                                <button type="button" onClick={addDetailRow} className="text-xs text-blue-600">➕ Add Line (or press Enter on the last field)</button>
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
                    {billingTerms.length > 0 && (
                        <div className="border-t pt-4">
                            <h2 className="font-semibold text-sm text-gray-500 uppercase mb-3">Billing Terms</h2>
                            <p className="text-xs text-gray-400 mb-2">Same calculation engine as Billing Term Management's own Test Formula - pick any that apply, the adjustment previews live below.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
                                {billingTerms.map(t => (
                                    <label key={t.id} className="flex flex-wrap items-center gap-2 text-sm border rounded-lg px-3 py-2">
                                        <input type="checkbox" data-enter-skip="true" checked={form.billing_term_ids.includes(t.id)} onChange={() => toggleBillingTerm(t.id)} />
                                        {t.term_name} <span className="text-xs text-gray-400">({t.term_code})</span>
                                        <TermLedgerInfo term={t} isReturn={false} subLedgers={subLedgers} value={(form.term_sub_ledgers || {})[t.id]} onChange={v => setForm(f => ({ ...f, term_sub_ledgers: { ...(f.term_sub_ledgers || {}), [t.id]: v } }))} />
                                    </label>
                                ))}
                            </div>
                            {billingPreview && (
                                <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                                    {billingPreview.lines.map((line, i) => (
                                        <div key={i} className="flex justify-between text-xs text-gray-600">
                                            <span>{line.term_code}{line.suppressed ? ' (suppressed, zero)' : line.skipped ? ' (disabled)' : ''}</span>
                                            <span>{line.free_quantity !== undefined ? `+${line.free_quantity} free unit(s)` : (line.amount ?? 0).toFixed(2)}</span>
                                        </div>
                                    ))}
                                    <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                                        <span>Final Total (Lines + Terms)</span>
                                        <span>{billingPreview.total.toFixed(2)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ==================== SUMMARY (aggregated Product Term amounts) ==================== */}
                    {/* FEATURE: "product wise term amount should show in
                        summary automatically" - each line's own applied
                        terms (set via the "Term" button per row) roll up
                        here by term code. Editing a Summary amount
                        redistributes proportionally back down to the
                        exact lines it came from (their ORIGINAL relative
                        share is preserved), matching "if changed in
                        Summary, it goes to product level, portion-based". */}
                    {summaryRows.length > 0 && (
                        <div className="border-t pt-4">
                            <h2 className="font-semibold text-sm text-gray-500 uppercase mb-3">Summary (Overall Term Totals)</h2>
                            <table className="erp-grid-table max-w-lg">
                                <thead>
                                    <tr><th>Term</th><th>Amount</th></tr>
                                </thead>
                                <tbody>
                                    {summaryRows.map(r => (
                                        <tr key={r.billing_term_id}>
                                            <td>{r.term_name} <span className="text-xs text-gray-400">({r.term_code})</span></td>
                                            <td>
                                                <input
                                                    type="number" step="0.01" className="erp-input w-32"
                                                    value={summaryOverrides[r.billing_term_id] !== undefined ? summaryOverrides[r.billing_term_id] : r.original_total.toFixed(2)}
                                                    onChange={e => setSummaryOverrides(o => ({ ...o, [r.billing_term_id]: e.target.value }))}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                    <tr className="font-semibold border-t">
                                        <td>Total</td>
                                        <td>{summaryGrandTotal.toFixed(2)}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <p className="text-xs text-gray-400 mt-1">Editing an amount here redistributes it proportionally across every line that carries this term, preserving each line's original share.</p>
                        </div>
                    )}
                    </div>

                    <BillWiseSettlementPanel
                            productCompanyId={form.product_company_id}
                        ledgerId={form.vendor_ledger_id}
                        outstandingNature="dr"
                        amount={grandTotal}
                        onSettlementsChange={setBillWiseSettlements}
                    />

                    <div className="erp-bottombar">
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="erp-field">
                                <label className="erp-label">Remarks <span className="hint">(pick from list or type - editable either way)</span></label>
                                <input
                                    list="remarks-suggestions"
                                    className="erp-input"
                                    value={form.remarks_text}
                                    onChange={e => setForm({ ...form, remarks_text: e.target.value })}
                                    placeholder="Type, or pick a saved remark"
                                />
                                <datalist id="remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={`erp-field ${isVisible('narration') ? '' : 'hidden'}`}>
                                <label className="erp-label">Narration</label>
                                <input className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>
                            <button type="button" onClick={e => handleSubmit(e, true)} className="erp-btn">💾 Save as Draft</button>
                            <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Create'} Bill</button>
                        </div>
                    </div>
                </form>
            )}
        </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 mt-4">
            <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={showDraftsOnly} onChange={e => setShowDraftsOnly(e.target.checked)} />
                    Show Drafts only
                </label>
                <span className="text-xs text-gray-400">({rows.filter(r => r.status === 'draft').length} draft{rows.filter(r => r.status === 'draft').length === 1 ? '' : 's'})</span>
            </div>
            <ReportGrid
                columns={columns}
                rows={showDraftsOnly ? rows.filter(r => r.status === 'draft') : rows}
                getId={r => r.id}
                storageKey="purchase_bill_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        {row.status === 'posted' && <a href={`/print/purchase_bill/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="purchase_bill" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {row.status !== 'cancelled' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {row.status === 'draft' && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
                    </div>
                )}
            />
        </div>

            {/* ==================== COPY FROM MODAL ==================== */}
            {lcPrompt && (() => {
                const chosen = lcPrompt.lcs.find(l => l.id === lcPrompt.choiceId);
                return (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl w-full max-w-2xl">
                            <div className="erp-header"><span className="erp-header-title">🏦 This supplier has pending LC</span></div>
                            <div className="p-5">
                                <p className="text-sm text-gray-600 mb-3">Map this bill (total {grandTotal.toFixed(2)}) to one of the supplier's open LCs, or save without mapping.</p>
                                <table className="erp-grid-table mb-3">
                                    <thead><tr><th></th><th>LC No</th><th>Bank</th><th>Amount</th><th>Remaining</th><th>Expiry</th></tr></thead>
                                    <tbody>
                                        {lcPrompt.lcs.map(lc => (
                                            <tr key={lc.id} className="cursor-pointer" onClick={() => setLcPrompt(p => ({ ...p, choiceId: lc.id, amount: Math.min(lc.remaining_amount, grandTotal).toFixed(2) }))}>
                                                <td><input type="radio" checked={lcPrompt.choiceId === lc.id} readOnly /></td>
                                                <td>{lc.lc_number}</td><td>{lc.lc_bank_name || '—'}</td><td>{Number(lc.lc_amount).toFixed(2)}</td>
                                                <td className="font-semibold">{Number(lc.remaining_amount).toFixed(2)}</td><td>{lc.expiry_date || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="erp-field max-w-xs">
                                    <label className="erp-label">Amount to map</label>
                                    <input type="number" step="0.01" className="erp-input" value={lcPrompt.amount} onChange={e => setLcPrompt(p => ({ ...p, amount: e.target.value }))} />
                                    {chosen && Number(lcPrompt.amount) > chosen.remaining_amount && <span className="text-xs text-red-600">More than this LC's remaining {chosen.remaining_amount.toFixed(2)}</span>}
                                </div>
                            </div>
                            <div className="erp-bottombar">
                                <button type="button" onClick={() => setLcPrompt(null)} className="erp-btn">Back to Bill</button>
                                <div className="erp-bottombar-actions">
                                    <button type="button" onClick={() => proceedSubmit(lcPrompt.saveAsDraft, null)} className="erp-btn">Save without LC</button>
                                    <button type="button" disabled={!chosen || !(Number(lcPrompt.amount) > 0) || Number(lcPrompt.amount) > chosen.remaining_amount}
                                        onClick={() => proceedSubmit(lcPrompt.saveAsDraft, { lcId: lcPrompt.choiceId, amount: lcPrompt.amount })} className="erp-btn primary">Save & Map to LC</button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {historyModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl w-full max-w-3xl max-h-[80vh] overflow-y-auto">
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
                                <button type="button" onClick={() => setHistoryModal(null)} className="erp-btn">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showCopyModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                        <div className="erp-header">
                            <span className="erp-header-title">Copy From — Purchase Bill</span>
                        </div>
                        <div className="p-4">
                            <p className="text-xs text-gray-400 mb-3">Pick an existing Bill to copy its Master + Details into a brand new one - the original is untouched.</p>
                            <div className="space-y-1.5 max-h-96 overflow-y-auto">
                                {rows.map(r => (
                                    <button key={r.id} type="button" onClick={() => handleCopyFrom(r.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                        <span>{r.doc_no} <span className="text-xs text-gray-400">— {r.vendor_display_name || 'No vendor'}</span></span>
                                        <span className="text-xs text-gray-400">{r.doc_date} · {r.status}</span>
                                    </button>
                                ))}
                                {rows.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No Orders yet to copy from.</p>}
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

            {/* ==================== PRODUCT TERM MODAL (multi-line) ==================== */}
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
                                                <TermLedgerInfo term={t} isReturn={false} subLedgers={subLedgers} value={(form.term_sub_ledgers || {})[t.id]} onChange={v => setForm(f => ({ ...f, term_sub_ledgers: { ...(f.term_sub_ledgers || {}), [t.id]: v } }))} />
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

            {/* ==================== CASH PARTY BILLING/SHIPPING & TAXATION MODAL ==================== */}
            {/* FEATURE: even without a full Vendor Ledger, a Cash party
                still gets a place to capture Address and Tax Registration
                details, matching what a real Vendor master would carry -
                stored inline on the document itself. */}
            {showCashBillingModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
                        <div className="erp-header">
                            <span className="erp-header-title">Billing / Shipping &amp; Taxation — {form.cash_vendor_name || 'Cash Party'}</span>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Address</p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="erp-field md:col-span-2">
                                        <label className="erp-label">Street</label>
                                        <input className="erp-input" value={cashBillingForm.street} onChange={e => setCashBillingForm({ ...cashBillingForm, street: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">City</label>
                                        <input className="erp-input" value={cashBillingForm.city} onChange={e => setCashBillingForm({ ...cashBillingForm, city: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">State</label>
                                        <input className="erp-input" value={cashBillingForm.state} onChange={e => setCashBillingForm({ ...cashBillingForm, state: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Country</label>
                                        <input className="erp-input" value={cashBillingForm.country} onChange={e => setCashBillingForm({ ...cashBillingForm, country: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Zip</label>
                                        <input className="erp-input" value={cashBillingForm.zip} onChange={e => setCashBillingForm({ ...cashBillingForm, zip: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Phone</label>
                                        <input className="erp-input" value={cashBillingForm.phone} onChange={e => setCashBillingForm({ ...cashBillingForm, phone: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Email</label>
                                        <input className="erp-input" value={cashBillingForm.email} onChange={e => setCashBillingForm({ ...cashBillingForm, email: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Contact Person</label>
                                        <input className="erp-input" value={cashBillingForm.contact_person} onChange={e => setCashBillingForm({ ...cashBillingForm, contact_person: e.target.value })} />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Taxation Details</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="erp-field">
                                        <label className="erp-label">PAN Number</label>
                                        <input className="erp-input" maxLength={9} value={cashBillingForm.pan_number} onChange={e => setCashBillingForm({ ...cashBillingForm, pan_number: e.target.value })} />
                                    </div>
                                    <div className="erp-field">
                                        <label className="erp-label">Registration No.</label>
                                        <input className="erp-input" value={cashBillingForm.cst_number} onChange={e => setCashBillingForm({ ...cashBillingForm, cst_number: e.target.value })} />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="erp-bottombar">
                            <div />
                            <div className="erp-bottombar-actions">
                                <button type="button" onClick={() => setShowCashBillingModal(false)} className="erp-btn">Cancel</button>
                                <button type="button" onClick={() => { setForm(f => ({ ...f, cash_billing_details: cashBillingForm })); setShowCashBillingModal(false); showAlert('Billing/Taxation details saved for this document', 'success'); }} className="erp-btn primary">Save</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== VENDOR QUICK-CREATE MODAL ==================== */}
            {vendorModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <form ref={vendorModalFormRef} onSubmit={e => { e.preventDefault(); saveVendorModal(); }} className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <h3 className="font-semibold text-lg mb-1">New Vendor</h3>
                        <p className="text-xs text-gray-400 mb-4">Creates a real Vendor Ledger, immediately reusable on every later document (Quotation, Order, GRN, Bill).</p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium mb-1">Vendor Name *</label>
                                <input className="erp-input" value={vendorModalForm.account_name} onChange={e => setVendorModalForm({ ...vendorModalForm, account_name: e.target.value })} required autoFocus />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Phone</label>
                                <input className="erp-input" value={vendorModalForm.phone} onChange={e => setVendorModalForm({ ...vendorModalForm, phone: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">PAN Number</label>
                                <input className="erp-input" maxLength={9} value={vendorModalForm.pan_number} onChange={e => setVendorModalForm({ ...vendorModalForm, pan_number: e.target.value })} />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-4">
                            <button type="button" onClick={() => setVendorModalOpen(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Create &amp; Select</button>
                        </div>
                    </form>
                </div>
            )}

            {/* ==================== GENERIC QUICK-CREATE MODAL ==================== */}
            {masterModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <form ref={masterModalFormRef} onSubmit={e => { e.preventDefault(); saveMasterModal(); }} className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <h3 className="font-semibold text-lg mb-4">
                            New {{ agent: 'Agent', remark: 'Remark', cost_center: 'Cost Center', business_unit: 'Business Unit', area: 'Area', route: 'Route', product: 'Product', customs_office: 'Customs Office' }[masterModal]}
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium mb-1">{masterModal === 'remark' ? 'Remark Text' : 'Name'} *</label>
                                <input className="erp-input" value={masterModalForm.name} onChange={e => setMasterModalForm({ ...masterModalForm, name: e.target.value })} required autoFocus />
                            </div>
                            {masterModal === 'route' && (
                                <div>
                                    <label className="block text-sm font-medium mb-1">Area *</label>
                                    <select className="erp-input" value={masterModalForm.area_id} onChange={e => setMasterModalForm({ ...masterModalForm, area_id: e.target.value })} required>
                                        <option value="">Select Area</option>
                                        {areas.map(a => <option key={a.id} value={a.id}>{a.area_name}</option>)}
                                    </select>
                                </div>
                            )}
                            {masterModal === 'product' && (
                                <div>
                                    <label className="block text-sm font-medium mb-1">Base Unit *</label>
                                    <select className="erp-input" value={masterModalForm.unit_id} onChange={e => setMasterModalForm({ ...masterModalForm, unit_id: e.target.value })} required>
                                        <option value="">Select Unit</option>
                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                    </select>
                                    <p className="text-xs text-gray-400 mt-1">Rates and other details can be filled in later from Product Master.</p>
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 mt-4">
                            <button type="button" onClick={() => setMasterModal(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Create &amp; Select</button>
                        </div>
                    </form>
                </div>
            )}

            {/* ==================== AUDIT TRAIL MODAL ==================== */}
            {auditModal && <RecordHistory table="purchase_bills" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/purchase-bills/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </Layout>
    );
}
