// =============================================
// PurchaseAdditionalExpense.jsx
// Extra costs (freight, customs duty, insurance) linked to an Order,
// GRN, and/or Bill, split across that document's product lines for
// landed cost - by Value share, Qty share, or an Equal split, with a
// live preview of the split before saving.
// Billing terms (Billing Terms > Term Used For: Purchase Additional):
//   tab 1 Product-wise - a popup per product of the linked document (like the
//         product term popup of a purchase); the whole amount goes to the
//         cost of THAT product (line.target_detail_id)
//   tab 2 Bill-wise    - a fixed form with one row per bill-level term; the
//         amount is divided over the document's products by the term's
//         basis (value / qty), changeable per row
//   a term's ledger is fixed (only its sub-ledger changes); the party paid
//   and its sub-ledger are chosen freely. A term not "Include In Costing"
//   stays out of landed cost. The vendor of the linked Bill / GRN / Order
//   is filled in as the vendor (changeable).
// =============================================

import ProductCompanyField from '../components/ProductCompanyField';
import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import CurrencyField, { useCurrencies, fxOf } from '../components/entry/CurrencyField';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';
import { amountToWords } from '../utils/numberToWords';
import UdfValuesModal from '../components/UdfValuesModal';
import useLedgerPurposes from '../components/useLedgerPurposes';
import RecordHistory from '../components/RecordHistory';
import DocActions, { finalizeEntry } from '../components/entry/DocActions';
import EntryFillBar from '../components/entry/EntryFillBar';
import { EntryPopup } from '../components/entry/EntryParts';
import { saveEntryDraft, finishEntryDraft } from '../components/entry/entryDrafts';

const emptyExpenseLine = () => ({ expense_ledger_id: '', description: '', allocation_basis: 'value_wise', entry_sign: 'add', rate_percent: '', amount: '',
    party_ledger_id: '', bill_type: 'no_bill', party_bill_no: '', party_bill_date: '', vat_percent: '', vat_amount: '', vat_in_cost: false });
const BILL_LABEL = { taxable: 'Taxable (VAT)', non_taxable: 'Tax-free bill', no_bill: 'No bill' };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const f2 = n => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// the bill type follows what is typed (same rule as the server): VAT = taxable bill, a supplier
// bill no without VAT = tax-free (non-taxable) bill, neither = no bill; TDS / "−" lines have none
const billTypeOf = l => (l.is_tds || l.entry_sign === 'deduct') ? 'no_bill' : Number(l.vat_amount) > 0 ? 'taxable' : String(l.party_bill_no || '').trim() ? 'non_taxable' : 'no_bill';
// after a change: VAT = amount x VAT % (unless the VAT itself was typed), then the bill type
const normLine = (n, patch) => {
    if ('vat_percent' in patch && patch.vat_percent === '' && !('vat_amount' in patch)) n.vat_amount = '';
    else if (('amount' in patch || 'vat_percent' in patch) && !('vat_amount' in patch) && n.vat_percent !== '' && n.vat_percent != null) n.vat_amount = r2((Number(n.amount) || 0) * (Number(n.vat_percent) || 0) / 100) || '';
    if (n.is_tds || n.entry_sign === 'deduct') { n.vat_percent = ''; n.vat_amount = ''; }
    n.bill_type = billTypeOf(n);
    if (n.bill_type !== 'taxable') n.vat_in_cost = false;
    return n;
};
// the Order / GRN / Bill line a product-wise term belongs to (same as the server)
const detailIdOf = a => a.source_grn_detail_id || a.source_bill_detail_id || a.source_order_detail_id || null;
const signed = l => (l.entry_sign === 'deduct' ? -1 : 1) * (Number(l.amount) || 0);
// a new line for a billing term: ledger + sub-ledger, basis, sign from the term
const termLine = (t, extra = {}) => ({
    ...emptyExpenseLine(), billing_term_id: t.id, expense_ledger_id: t.billing_ledger_id || '', expense_sub_ledger_id: t.sub_ledger_id || '',
    description: t.term_name, allocation_basis: t.include_in_costing === false ? 'none' : (t.basis === 'quantity' ? 'qty_wise' : 'value_wise'),
    entry_sign: t.sign === '-' ? 'deduct' : 'add', ...extra
});

const emptyForm = {
    vendor_sub_ledger_id: '', product_company_id: '', doc_date: new Date().toISOString().slice(0, 10),
    source_order_id: '', source_grn_id: '', source_bill_id: '', account_posting: true,
    vendor_ledger_id: '', cash_vendor_name: '', agent_id: '', invoice_type: 'credit', currency: 'NPR', exchange_rate: 1,
    party_bill_no: '', party_bill_date: '',
    remarks_text: '', cost_center_id: '', business_unit_id: '', priority: 'normal', narration: '',
    expense_lines: [emptyExpenseLine()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['agent_id', 'business_unit_id', 'cost_center_id', 'currency', 'doc_date', 'invoice_type', 'narration', 'party_bill_date', 'party_bill_no', 'priority', 'vendor_ledger_id'];

export default function PurchaseAdditionalExpense() {
    const { authFetch } = useAuth();
    const lp = useLedgerPurposes();
    const efc = useEntryFieldControls('purchase_additional', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    // currency of the entry: local amounts in the charge pop-ups and the footer
    const currencies = useCurrencies();
    const fx = fxOf(form, currencies);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [auditModal, setAuditModal] = useState(null);
    const [allocationPreview, setAllocationPreview] = useState([]);
    // reference document + additional / non-additional totals (allocation preview)
    const [refInfo, setRefInfo] = useState(null);

    const [vendors, setVendors] = useState([]);

    const [subLedgers, setSubLedgers] = useState([]);
    const [agents, setAgents] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [remarks, setRemarks] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [openOrders, setOpenOrders] = useState([]);
    const [openGrns, setOpenGrns] = useState([]);
    const [openBills, setOpenBills] = useState([]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addExpenseLine(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const [sysCtl, setSysCtl] = useState({});
    const [terms, setTerms] = useState([]);           // billing terms used for Purchase Additional
    const [termTab, setTermTab] = useState('product'); // 'product' | 'bill'
    const [productPopup, setProductPopup] = useState(null); // source line whose product terms are open
    const [bottomTab, setBottomTab] = useState('goods');   // 'goods' | 'bills' | 'posting'
    const load = useCallback(async () => {
        try {
            const [req, v1, v2, ag, ldg, rmk, cc, bu, pords, pgrns, pbills, subl] = await Promise.all([
                authFetch('/api/purchase-additional-expenses'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=purchase'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=both'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/remarks'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/purchase-orders'),
                authFetch('/api/purchase-grns'),
                authFetch('/api/purchase-bills'),
                authFetch('/api/sub-ledgers')
            ]);
            setSubLedgers(subl.data || []);
            try { setSysCtl((await authFetch('/api/system-control')).data || {}); } catch { /* TDS line then needs its ledger picked */ }
            try { setTerms(((await authFetch('/api/billing-terms')).data || []).filter(t => t.applicable_additional_expense && t.is_enabled !== false)); } catch { setTerms([]); }
            setRows(req.data || []);
            setVendors([...(v1.data || []), ...(v2.data || [])]);
            setAgents(ag.data || []);
            setLedgers(ldg.data || []);
            setRemarks(rmk.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setOpenOrders((pords.data || []).filter(o => !['cancelled'].includes(o.status)));
            setOpenGrns((pgrns.data || []).filter(g => !['cancelled'].includes(g.status)));
            setOpenBills((pbills.data || []).filter(b => !['cancelled'].includes(b.status)));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setAllocationPreview([]); };
    const addExpenseLine = () => setForm(f => ({ ...f, expense_lines: [...f.expense_lines, emptyExpenseLine()] }));
    // TDS withheld from a party: a "−" line on the TDS payable ledger (+ its TDS sub-ledger), never in costing.
    // One line per party paid, on that party's TDS-applicable terms (Billing Terms > TDS Applicable);
    // when no term is marked, on all its "+" lines. Pressing again rebuilds the TDS lines.
    const tdsBase = (lines, party, vendor) => {
        const own = lines.filter(l => !l.is_tds && l.entry_sign !== 'deduct' && (l.party_ledger_id || vendor) === party);
        const marked = own.filter(l => termById(l.billing_term_id)?.tds_applicable);
        const anyMarked = lines.some(l => termById(l.billing_term_id)?.tds_applicable);
        return r2((anyMarked ? marked : own).reduce((s2, l) => s2 + (Number(l.amount) || 0), 0));
    };
    const addTdsLine = () => setForm(f => {
        const pct = Number(sysCtl.default_tds_percent) || 1.5;
        const kept = f.expense_lines.filter(l => !l.is_tds);
        const parties = [...new Set(kept.filter(l => l.entry_sign !== 'deduct' && Number(l.amount) > 0).map(l => l.party_ledger_id || f.vendor_ledger_id).filter(Boolean))];
        const tds = parties.map(party => {
            const base = tdsBase(kept, party, f.vendor_ledger_id);
            return base > 0 ? { ...emptyExpenseLine(), expense_ledger_id: sysCtl.tds_ledger_id || '', expense_sub_ledger_id: sysCtl.tds_sub_ledger_id || '', description: 'TDS', entry_sign: 'deduct', is_tds: true,
                allocation_basis: 'none', bill_type: 'no_bill', party_ledger_id: party === f.vendor_ledger_id ? '' : party, tds_base: base, rate_percent: pct, amount: r2(base * pct / 100) } : null;
        }).filter(Boolean);
        if (!tds.length) { showAlert('No amount for TDS - enter the terms first (TDS goes on terms marked "TDS Applicable")', 'danger'); return f; }
        return { ...f, expense_lines: [...kept.filter(l => l.billing_term_id || l.expense_ledger_id || Number(l.amount)), ...tds] };
    });
    const removeExpenseLine = (idx) => setForm(f => ({ ...f, expense_lines: f.expense_lines.length > 1 ? f.expense_lines.filter((_, i) => i !== idx) : f.expense_lines }));
    const updateExpenseLine = (idx, patch) => setForm(f => ({ ...f, expense_lines: f.expense_lines.map((l, i) => {
        if (i !== idx) return l;
        return normLine({ ...l, ...patch }, patch);
    }) }));

    // FEATURE: "Rate/Perc." convenience - a VAT or TDS line's amount can
    // be auto-computed as rate_percent% of every OTHER '+' line's total
    // (the underlying expense being taxed/withheld against), rather
    // than always hand-typed.
    const autoCalcFromRate = (idx, ratePercent) => {
        setForm(f => {
            const me = f.expense_lines[idx];
            const baseAmount = me?.is_tds ? tdsBase(f.expense_lines, me.party_ledger_id || f.vendor_ledger_id, f.vendor_ledger_id)
                : f.expense_lines.reduce((s, l, i) => i === idx ? s : s + (l.entry_sign !== 'deduct' ? (Number(l.amount) || 0) : 0), 0);
            const computed = ratePercent === '' ? '' : Math.round(baseAmount * (Number(ratePercent) / 100) * 100) / 100;
            return { ...f, expense_lines: f.expense_lines.map((l, i) => i === idx ? normLine({ ...l, rate_percent: ratePercent, amount: computed }, { amount: computed }) : l) };
        });
    };

    // ---- billing terms ----
    const billTerms = terms.filter(t => !t.product_wise);
    const productTerms = terms.filter(t => t.product_wise);
    const termById = id => terms.find(t => t.id === id);
    const ledgerName = id => (ledgers.find(x => x.id === id) || {}).account_name || '';
    const subLedgersOf = ledgerId => subLedgers.filter(x => x.main_ledger_id === ledgerId);
    // Bill-wise tab = a fixed form: a new entry starts with one row per bill-level term
    useEffect(() => {
        if (!showForm || editingId || !billTerms.length) return;
        setForm(f => {
            const blank = f.expense_lines.length === 1 && !f.expense_lines[0].billing_term_id && !f.expense_lines[0].expense_ledger_id && !Number(f.expense_lines[0].amount);
            return blank ? { ...f, expense_lines: billTerms.map(t => termLine(t)) } : f;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showForm, editingId, terms]);
    const goodsValue = Number(allocationPreview.reduce((s2, a) => s2 + (Number(a.value) || 0), 0)) || 0;
    // a term row's Rate % is a % of the goods value (a product-wise term: of that product)
    const termRate = (idx, rate) => setForm(f => ({ ...f, expense_lines: f.expense_lines.map((l, i) => {
        if (i !== idx) return l;
        const src = l.target_detail_id ? allocationPreview.find(a => detailIdOf(a) === l.target_detail_id) : null;
        const base = src ? Number(src.value) || 0 : goodsValue;
        const amount = rate === '' ? '' : r2(base * Number(rate) / 100);
        return normLine({ ...l, rate_percent: rate, amount }, { amount });
    }) }));
    const setTermOfLine = (idx, termId) => setForm(f => ({ ...f, expense_lines: f.expense_lines.map((l, i) => {
        if (i !== idx) return l;
        const t = termById(termId);
        return t ? termLine(t, { amount: l.amount, party_ledger_id: l.party_ledger_id, party_sub_ledger_id: l.party_sub_ledger_id, bill_type: l.bill_type, party_bill_no: l.party_bill_no, party_bill_date: l.party_bill_date, vat_percent: l.vat_percent, vat_amount: l.vat_amount, vat_in_cost: l.vat_in_cost })
            : { ...l, billing_term_id: '', expense_sub_ledger_id: '' };
    }) }));
    // product-wise: the line of a term for one product (created on first input)
    const productTermIdx = (detailId, termId) => form.expense_lines.findIndex(l => l.target_detail_id === detailId && l.billing_term_id === termId);
    const updateProductTerm = (detailId, t, patch) => {
        const idx = productTermIdx(detailId, t.id);
        const byRate = 'rate_percent' in patch && !('amount' in patch);
        if (idx >= 0) { if (byRate) termRate(idx, patch.rate_percent); else updateExpenseLine(idx, patch); return; }
        const src = allocationPreview.find(a => detailIdOf(a) === detailId);
        const line = termLine(t, { target_detail_id: detailId, ...patch });
        if (byRate) line.amount = patch.rate_percent === '' ? '' : r2((Number(src?.value) || 0) * Number(patch.rate_percent) / 100);
        normLine(line, { ...patch, amount: line.amount });
        setForm(f => ({ ...f, expense_lines: [...f.expense_lines.filter(l => l.billing_term_id || l.expense_ledger_id || Number(l.amount)), line] }));
    };
    const productTermTotal = detailId => r2(form.expense_lines.filter(l => l.target_detail_id === detailId).reduce((s2, l) => s2 + signed(l), 0));
    // the vendor of the linked Bill / GRN / Order comes in as the vendor (changeable)
    const linkDoc = (key, list, id) => setForm(f => {
        const d = list.find(x => x.id === id);
        const n = { ...f, [key]: id };
        if (d && d.vendor_ledger_id) { n.vendor_ledger_id = d.vendor_ledger_id; n.vendor_sub_ledger_id = d.vendor_sub_ledger_id || ''; n.cash_vendor_name = ''; if (n.invoice_type === 'cash') n.invoice_type = 'credit'; }
        return n;
    });

    // FEATURE: "Net Payable" to the expense provider - every '+' line
    // adds, every '-' line (a TDS/withholding deduction, the standard
    // case) subtracts. Computed the same way the backend does, so what
    // the form shows while typing matches what gets saved.
    const netPayable = form.expense_lines.reduce((s, l) => s + (l.entry_sign === 'deduct' ? -(Number(l.amount) || 0) : (Number(l.amount) || 0) + (l.bill_type === 'taxable' ? Number(l.vat_amount) || 0 : 0)), 0);

    // FEATURE: live allocation preview - refetches from the SAME math
    // the backend uses, whenever the source or any line changes. Only
    // lines with a Basis other than "Not Allocated" affect landed cost.
    useEffect(() => {
        const hasSource = form.source_order_id || form.source_grn_id || form.source_bill_id;
        // the reference document's product lines show as soon as it is chosen
        if (!hasSource) { setAllocationPreview([]); setRefInfo(null); return; }
        let cancelled = false;
        authFetch('/api/purchase-additional-expenses/allocation-preview', {
            method: 'POST',
            body: JSON.stringify({
                source_order_id: form.source_order_id || undefined, source_grn_id: form.source_grn_id || undefined, source_bill_id: form.source_bill_id || undefined,
                vendor_ledger_id: form.vendor_ledger_id || undefined, vendor_sub_ledger_id: form.vendor_sub_ledger_id || undefined, account_posting: form.account_posting,
                expense_lines: form.expense_lines.filter(l => Number(l.amount) > 0)
            })
        })
            .then(res => { if (!cancelled) { setAllocationPreview(res.data.allocations || []); setRefInfo({ reference: res.data.reference, totals: res.data.totals, gl: res.data.gl, gl_error: res.data.gl_error }); } })
            .catch(() => { if (!cancelled) { setAllocationPreview([]); setRefInfo(null); } });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.source_order_id, form.source_grn_id, form.source_bill_id, form.vendor_ledger_id, form.vendor_sub_ledger_id, form.account_posting, JSON.stringify(form.expense_lines)]);

    const handleSubmit = async (e, saveAsDraft = false) => {

        // Save as Draft (new entry): kept apart as a temporary draft - no number, no accounts / stock effect

        if (saveAsDraft && !editingId) { if (e) e.preventDefault(); if (await saveEntryDraft(authFetch, 'purchase_additional', form)) { resetForm(); setShowForm(false); } return; }
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        if (!saveAsDraft) {
            if (!form.source_bill_id && !form.source_order_id && !form.source_grn_id) return showAlert('Choose the Ref. Bill No. (the purchase bill the cost belongs to)', 'danger');
        }
        const validLines = form.expense_lines.filter(l => (l.expense_ledger_id || l.billing_term_id) && Number(l.amount) > 0);
        const noBillNo = validLines.findIndex(l => Number(l.vat_amount) > 0 && !String(l.party_bill_no || '').trim());
        if (!saveAsDraft && noBillNo >= 0) return showAlert(`${validLines[noBillNo].description || 'A line'}: VAT is entered - give the supplier's Bill No (taxable bill)`, 'danger');
        if (!saveAsDraft && validLines.length === 0) return showAlert('At least one complete expense line (Expense Type + Amount) is required', 'danger');
        try {
            const payload = { ...form, expense_lines: validLines, ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}) };
            if (editingId) {
                await authFetch(`/api/purchase-additional-expenses/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                if (!saveAsDraft) await finalizeEntry(authFetch, 'purchase-additional-expenses', editingId, 'posted');
                showAlert(saveAsDraft ? 'Draft saved' : 'Additional Expense updated', 'success');
            } else {
                const res = await authFetch('/api/purchase-additional-expenses', { method: 'POST', body: JSON.stringify(payload) });
                if (!saveAsDraft) await finalizeEntry(authFetch, 'purchase-additional-expenses', res.data?.id, 'posted');
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Additional Expense ${res.data.doc_no} created`, 'success');
            }
            await finishEntryDraft(authFetch, 'purchase_additional');
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/purchase-additional-expenses/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...res.data,
                doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date,
                party_bill_date: res.data.party_bill_date?.slice(0, 10) || '',
                expense_lines: (res.data.expense_lines || []).length > 0 ? res.data.expense_lines.map(l => ({ ...emptyExpenseLine(), ...Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null)) })) : [emptyExpenseLine()]
            });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleCopyFrom = async (sourceId) => {
        try {
            const res = await authFetch(`/api/purchase-additional-expenses/${sourceId}`);
            const src = res.data;
            setEditingId(null);
            setForm({
                ...emptyForm, ...src,
                doc_no: '', doc_date: new Date().toISOString().slice(0, 10), status: 'draft',
                expense_lines: (src.expense_lines || []).length > 0 ? src.expense_lines.map(l => ({ ...emptyExpenseLine(), ...l })) : [emptyExpenseLine()]
            });
            setShowForm(true);
            setShowCopyModal(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showAlert(`Copied from ${src.doc_no} - review and save as new`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt('Reason for cancelling this entry?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            await authFetch(`/api/purchase-additional-expenses/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
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
        { key: 'doc_date', label: 'Date', type: 'text' },
        { key: 'vendor', label: 'Vendor', type: 'text', render: r => r.vendor_display_name || '—' },
        { key: 'allocation_method', label: 'Allocation', type: 'text' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🧮 Purchase Additional Expense</span>
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
                    <EntryFillBar voucherType="purchase_additional" api="purchase-additional-expenses" form={form} editing={!!editingId} docId={editingId} onFill={p => setForm(f => ({ ...f, ...p }))} onCopy={r => handleCopyFrom(r.id)} />
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>} {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Ref. Bill No. <span className="req">*</span></label>
                            <select className="erp-select" value={form.source_bill_id} onChange={e => linkDoc('source_bill_id', openBills, e.target.value)}>
                                <option value="">— Choose the purchase bill —</option>
                                {openBills.map(b => <option key={b.id} value={b.id}>{b.doc_no}{b.vendor_name_snapshot ? ` · ${b.vendor_name_snapshot}` : ''}</option>)}
                            </select>
                        </div>
                        {(() => {
                            const b = openBills.find(x => x.id === form.source_bill_id);
                            return (
                                <div className="erp-field">
                                    <label className="erp-label">Ref. Bill Date / Amount</label>
                                    <div className="erp-input bg-gray-100 truncate">{b ? `${String(b.doc_date || '').slice(0, 10)} · ${Number(b.total_amount || 0).toFixed(2)}` : '—'}</div>
                                </div>
                            );
                        })()}
                        {(form.source_order_id || form.source_grn_id) && !form.source_bill_id && (
                            <div className="erp-field">
                                <label className="erp-label">Linked (older entry)</label>
                                <div className="erp-input bg-gray-100 truncate" title="Entries made before Ref Bill only">{[openOrders.find(o => o.id === form.source_order_id)?.doc_no, openGrns.find(g => g.id === form.source_grn_id)?.doc_no].filter(Boolean).join(' · ') || 'Order / GRN'}</div>
                            </div>
                        )}
                        <div className="erp-field">
                            <label className="erp-label">Account Posting <span className="hint">(No: costing only)</span></label>
                            <select className="erp-select" value={form.account_posting === false ? 'no' : 'yes'} onChange={e => setForm({ ...form, account_posting: e.target.value === 'yes' })}>
                                <option value="yes">Yes - post to the ledger</option><option value="no">No - landed cost only</option>
                            </select>
                        </div>
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('invoice_type') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Invoice Type {efc.isRequired('invoice_type') && <span className="req">*</span>}</label>
                                <select disabled={efc.isReadonly('invoice_type')} className="erp-select" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
                                    <option value="cash">Cash</option>
                                    <option value="credit">Credit</option>
                                </select>
                            </div>
                            <div className={efc.isVisible('vendor_ledger_id') ? 'erp-field md:col-span-2' : 'erp-field md:col-span-2 hidden'}>
                                <label className="erp-label">{form.invoice_type === 'cash' ? 'Party Name' : 'Vendor (Expense Provider)'} {efc.isRequired('vendor_ledger_id') && <span className="req">*</span>}</label>
                                {form.invoice_type === 'cash' && !form.vendor_ledger_id ? (
                                    <input className="erp-input" value={form.cash_vendor_name} onChange={e => setForm({ ...form, cash_vendor_name: e.target.value })} placeholder="Type party name (e.g. transporter)" />
                                ) : (
                                    <SearchablePopupSelect
                                        listKey="expense_vendor_picker"
                                        columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                        defaultVisibleKeys={['account_name']}
                                        items={vendors} getId={v => v.id} getLabel={v => v.account_name}
                                        searchKeys={['account_name', 'account_code']}
                                        value={form.vendor_ledger_id} onChange={id => setForm({ ...form, vendor_ledger_id: id, cash_vendor_name: '', vendor_sub_ledger_id: '' })}
                                        placeholder="Select Vendor"
                                    />
                                )}
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Vendor Sub-Ledger</label>
                                <SearchablePopupSelect
                                    listKey="purchaseAdditionalExpense_vendor_sub_ledger_picker"
                                    columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]}
                                    defaultVisibleKeys={['name']}
                                    items={subLedgers.filter(x => x.main_ledger_id === form.vendor_ledger_id).map(x => ({ id: x.id, code: x.sub_ledger_code, name: x.sub_ledger_name }))} getId={x => x.id} getLabel={x => x.name}
                                    searchKeys={['name', 'code']}
                                    value={form.vendor_sub_ledger_id || ''} onChange={id => setForm({ ...form, vendor_sub_ledger_id: id })} placeholder={form.vendor_ledger_id ? 'None' : 'Choose a Vendor first'}
                                />
                            </div>
                            <ProductCompanyField side="purchase" form={form} setForm={setForm} products={[]} />
                            <div className={efc.isVisible('agent_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Agent {efc.isRequired('agent_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="expense_agent_picker"
                                    columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                    defaultVisibleKeys={['agent_name']}
                                    items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                    searchKeys={['agent_name', 'agent_code']}
                                    value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })} placeholder="Select Agent"
                                />
                            </div>
                            <div className={efc.isVisible('currency') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Currency {efc.isRequired('currency') && <span className="req">*</span>}</label>
                                <CurrencyField bare disabled={efc.isReadonly('currency')} value={form.currency} rate={form.exchange_rate} onChange={v => setForm(f => ({ ...f, ...v }))} />
                            </div>
                            <div className={efc.isVisible('priority') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Priority {efc.isRequired('priority') && <span className="req">*</span>}</label>
                                <select disabled={efc.isReadonly('priority')} className="erp-select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                                    <option value="low">Low</option>
                                    <option value="normal">Normal</option>
                                    <option value="urgent">Urgent</option>
                                </select>
                            </div>
                            <div className={efc.isVisible('party_bill_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Party Bill No {efc.isRequired('party_bill_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('party_bill_no')} className="erp-input" value={form.party_bill_no} onChange={e => setForm({ ...form, party_bill_no: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('party_bill_date') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Party Bill Date {efc.isRequired('party_bill_date') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('party_bill_date')} type="date" className="erp-input" value={form.party_bill_date} onChange={e => setForm({ ...form, party_bill_date: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('cost_center_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Cost Center {efc.isRequired('cost_center_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="expense_cost_center_picker"
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
                                    listKey="expense_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="expense-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="expense-remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <div className="erp-tabs mb-1">
                            <button type="button" className={`erp-tab ${termTab === 'product' ? 'active' : ''}`} onClick={() => setTermTab('product')}>Product-wise Terms{form.expense_lines.some(l => l.target_detail_id && Number(l.amount)) ? ' •' : ''}</button>
                            <button type="button" className={`erp-tab ${termTab === 'bill' ? 'active' : ''}`} onClick={() => setTermTab('bill')}>Bill-wise Terms</button>
                        </div>
                        {termTab === 'product' && (
                            <div className="mb-3">
                                {allocationPreview.length === 0 ? (
                                    <p className="text-sm text-gray-500 py-2">Link an Order, GRN or Bill above - its products are listed here; open a product to enter its terms.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="erp-grid-table">
                                            <thead><tr><th>#</th><th>Product</th><th className="text-right">Qty</th><th className="text-right">Value</th><th className="text-right">Product Terms</th><th className="text-right">Cost Total</th><th /></tr></thead>
                                            <tbody>
                                                {allocationPreview.map((a, i) => {
                                                    const did = detailIdOf(a);
                                                    return (
                                                        <tr key={did || i} className="cursor-pointer" onDoubleClick={() => did && setProductPopup(a)}>
                                                            <td>{i + 1}</td><td>{a.product_name_snapshot}</td><td className="text-right">{a.qty}</td><td className="text-right">{Number(a.value || 0).toFixed(2)}</td>
                                                            <td className="text-right font-semibold">{productTermTotal(did) ? productTermTotal(did).toFixed(2) : ''}</td>
                                                            <td className="text-right">{(Number(a.value || 0) + Number(a.allocated_amount || 0)).toFixed(2)}</td>
                                                            <td className="text-right"><button type="button" className="nav-btn small" disabled={!did || !productTerms.length} onClick={() => setProductPopup(a)} title={productTerms.length ? 'Terms of this product' : 'No product-wise term for Purchase Additional in Billing Terms'}>Terms…</button></td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        {!productTerms.length && <p className="text-xs text-gray-500 mt-1">No product-wise term yet - in Billing Terms tick "Purchase Additional" and "Product Wise".</p>}
                                    </div>
                                )}
                            </div>
                        )}
                        {productPopup && (() => {
                            const did = detailIdOf(productPopup);
                            return (
                                <EntryPopup title={`Product terms - ${productPopup.product_name_snapshot} (Qty ${productPopup.qty} · Value ${Number(productPopup.value || 0).toFixed(2)})`} onClose={() => setProductPopup(null)} width={980}
                                    footer={<span className="text-sm">Total <b>{productTermTotal(did).toFixed(2)}</b> - goes to the cost of this product only (terms kept out of costing excepted)</span>}>
                                    <div className="overflow-x-auto">
                                        <table className="erp-grid-table min-w-[860px]">
                                            <thead><tr><th>Term</th><th>Ledger</th><th>Sub-Ledger</th><th className="text-right">Rate %</th><th className="text-right">Amount</th><th>Paid to</th><th>Supplier Bill No</th><th className="text-right">VAT %</th><th className="text-right">VAT</th><th>Bill</th></tr></thead>
                                            <tbody>
                                                {productTerms.map(t => {
                                                    const idx = productTermIdx(did, t.id);
                                                    const l = idx >= 0 ? form.expense_lines[idx] : termLine(t);
                                                    const set = patch => updateProductTerm(did, t, patch);
                                                    return (
                                                        <tr key={t.id}>
                                                            <td className="font-semibold whitespace-nowrap">{t.term_name}{t.sign === '-' ? ' (−)' : ''}{t.include_in_costing === false && <span className="text-xs text-gray-500"> · not in cost</span>}</td>
                                                            <td className="whitespace-nowrap" title="Term ledger - fixed">{ledgerName(l.expense_ledger_id) || '—'}</td>
                                                            <td><select className="erp-select" value={l.expense_sub_ledger_id || ''} disabled={!subLedgersOf(l.expense_ledger_id).length} onChange={e => set({ expense_sub_ledger_id: e.target.value })}>
                                                                <option value="">None</option>{subLedgersOf(l.expense_ledger_id).map(x => <option key={x.id} value={x.id}>{x.sub_ledger_name}</option>)}</select></td>
                                                            <td><input type="number" step="0.001" className="erp-input w-20 text-right" value={l.rate_percent ?? ''} onChange={e => set({ rate_percent: e.target.value })} /></td>
                                                            <td><input type="number" step="0.01" className="erp-input w-28 text-right" value={l.amount ?? ''} onChange={e => set({ amount: e.target.value, rate_percent: '' })} /></td>
                                                            <td className="w-48"><SearchablePopupSelect listKey="expense_party_picker" columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
                                                                items={lp.filter(ledgers, 'supplier', l.party_ledger_id)} getId={x => x.id} getLabel={x => x.account_name} searchKeys={['account_name', 'account_code']}
                                                                value={l.party_ledger_id} onChange={id => set({ party_ledger_id: id, party_sub_ledger_id: '' })} placeholder="Entry vendor" />
                                                                {l.party_ledger_id && subLedgersOf(l.party_ledger_id).length > 0 && (
                                                                    <select className="erp-select mt-0.5" value={l.party_sub_ledger_id || ''} onChange={e => set({ party_sub_ledger_id: e.target.value })}>
                                                                        <option value="">Sub-ledger: none</option>{subLedgersOf(l.party_ledger_id).map(x => <option key={x.id} value={x.id}>{x.sub_ledger_name}</option>)}</select>
                                                                )}</td>
                                                            <td><input className="erp-input w-24" disabled={l.entry_sign === 'deduct'} value={l.party_bill_no || ''} onChange={e => set({ party_bill_no: e.target.value })} /></td>
                                                            <td><input type="number" step="0.01" className="erp-input w-16 text-right" disabled={l.entry_sign === 'deduct'} value={l.vat_percent ?? ''} onChange={e => set({ vat_percent: e.target.value })} placeholder="13" /></td>
                                                            <td><input type="number" step="0.01" className="erp-input w-24 text-right" disabled={l.entry_sign === 'deduct'} value={l.vat_amount ?? ''} onChange={e => set({ vat_amount: e.target.value })} /></td>
                                                            <td className="text-xs whitespace-nowrap">{BILL_LABEL[l.bill_type || billTypeOf(l)]}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="ent-note mt-2">Rate % is of this product's value. The term ledger is fixed by the term (only its sub-ledger changes); "Paid to" and its sub-ledger are free - empty = the entry's vendor.</p>
                                </EntryPopup>
                            );
                        })()}
                        {termTab === 'bill' && (
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table pae-terms mb-1">
                                <thead>
                                    <tr>
                                        <th className="w-6">#</th>
                                        <th className="min-w-[130px]">Term</th>
                                        <th className="min-w-[150px]">Ledger / Sub-Ledger</th>
                                        <th className={`w-32 ${efc.isVisible('allocation_basis', 'detail') ? '' : 'hidden'}`}>Basis</th>
                                        <th className={`min-w-[52px] ${efc.isVisible('entry_sign', 'detail') ? '' : 'hidden'}`}>±</th>
                                        <th className={`w-16 text-right ${efc.isVisible('rate_percent', 'detail') ? '' : 'hidden'}`}>Rate %</th>
                                        <th className={`w-24 text-right ${efc.isVisible('amount', 'detail') ? '' : 'hidden'}`}>Amount</th>
                                        <th className="min-w-[150px]" title="Party credited with this bill - empty = the entry's vendor">Paid to (party)</th>
                                        <th className="w-24" title="Supplier's bill no - lines of one party with the same bill no make one bill">Supplier Bill No</th>
                                        <th className="w-32">Bill Date</th>
                                        <th className="w-14 text-right">VAT %</th>
                                        <th className="w-20 text-right">VAT</th>
                                        <th className="w-24 text-right">Total</th>
                                        <th className="w-24">Bill</th>
                                        <th className="w-5"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.expense_lines.map((l, idx) => {
                                        if (l.target_detail_id) return null;
                                        const sn = form.expense_lines.slice(0, idx + 1).filter(x => !x.target_detail_id).length;
                                        const minus = l.is_tds || l.entry_sign === 'deduct';
                                        const bt = l.bill_type || billTypeOf(l);
                                        return (
                                        <tr key={idx} className={l.is_tds ? 'bg-amber-50' : ''}>
                                            <td className="text-gray-500">{sn}</td>
                                            <td>
                                                {l.is_tds ? <b className="text-amber-800 px-1" title="TDS withheld: Cr TDS payable, Dr the party; not in costing">TDS {l.tds_base ? <span className="font-normal text-xs">on {f2(l.tds_base)}</span> : null}</b> : (
                                                <select className="erp-select" value={l.billing_term_id || ''} onChange={e => setTermOfLine(idx, e.target.value)}>
                                                    <option value="">— ledger (no term) —</option>
                                                    {billTerms.map(t => <option key={t.id} value={t.id}>{t.term_name}{t.include_in_costing === false ? ' (not in cost)' : ''}</option>)}
                                                    {l.billing_term_id && !billTerms.some(t => t.id === l.billing_term_id) && <option value={l.billing_term_id}>{(termById(l.billing_term_id) || {}).term_name || l.description || 'Term'}</option>}
                                                </select>)}
                                            </td>
                                            <td>
                                                {l.billing_term_id && termById(l.billing_term_id)?.billing_ledger_id ? (
                                                    <div className="erp-input bg-gray-100 truncate" title="Term ledger - fixed by the billing term">{ledgerName(l.expense_ledger_id) || 'Term ledger'}</div>
                                                ) : (
                                                <SearchablePopupSelect
                                                    listKey="expense_ledger_picker"
                                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['account_name']}
                                                    items={lp.filter(ledgers, 'expense', l.expense_ledger_id)} getId={x => x.id} getLabel={x => x.account_name}
                                                    searchKeys={['account_name', 'account_code']}
                                                    value={l.expense_ledger_id} onChange={id => updateExpenseLine(idx, { expense_ledger_id: id, description: l.description || ledgerName(id) })} placeholder={l.is_tds ? 'TDS payable ledger' : 'Expense ledger'}
                                                />
                                                )}
                                                {l.expense_ledger_id && subLedgersOf(l.expense_ledger_id).length > 0 && (
                                                    <select className="erp-select mt-0.5" value={l.expense_sub_ledger_id || ''} onChange={e => updateExpenseLine(idx, { expense_sub_ledger_id: e.target.value })} title="Sub-ledger of the term ledger (changeable)">
                                                        <option value="">Sub-ledger: none</option>
                                                        {subLedgersOf(l.expense_ledger_id).map(x => <option key={x.id} value={x.id}>{x.sub_ledger_name}</option>)}
                                                    </select>
                                                )}
                                            </td>
                                            <td className={efc.isVisible('allocation_basis', 'detail') ? '' : 'hidden'}>
                                                <select disabled={efc.isReadonly('allocation_basis', 'detail') || l.is_tds || termById(l.billing_term_id)?.include_in_costing === false} className="erp-select" value={l.allocation_basis} onChange={e => updateExpenseLine(idx, { allocation_basis: e.target.value })}>
                                                    <option value="value_wise">Cost · Value</option>
                                                    <option value="qty_wise">Cost · Qty</option>
                                                    <option value="equal">Cost · Equal</option>
                                                    <option value="none">Not in cost</option>
                                                </select>
                                            </td>
                                            <td className={efc.isVisible('entry_sign', 'detail') ? '' : 'hidden'}>
                                                <select disabled={efc.isReadonly('entry_sign', 'detail') || l.is_tds} className="erp-select" value={l.entry_sign} onChange={e => updateExpenseLine(idx, { entry_sign: e.target.value })}>
                                                    <option value="add">+</option>
                                                    <option value="deduct">−</option>
                                                </select>
                                            </td>
                                            <td className={efc.isVisible('rate_percent', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('rate_percent', 'detail')} type="number" step="0.001" className="erp-input text-right" value={l.rate_percent ?? ''} onChange={e => (l.billing_term_id ? termRate(idx, e.target.value) : autoCalcFromRate(idx, e.target.value))} placeholder={l.is_tds ? 'TDS %' : '%'} /></td>
                                            <td className={efc.isVisible('amount', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('amount', 'detail')} type="number" step="0.01" className="erp-input text-right font-semibold" value={l.amount ?? ''} onChange={e => updateExpenseLine(idx, { amount: e.target.value, rate_percent: '' })} /></td>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="expense_party_picker"
                                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['account_name']}
                                                    items={lp.filter(ledgers, 'supplier', l.party_ledger_id)} getId={x => x.id} getLabel={x => x.account_name}
                                                    searchKeys={['account_name', 'account_code']}
                                                    value={l.party_ledger_id} onChange={id => updateExpenseLine(idx, { party_ledger_id: id, party_sub_ledger_id: '' })} placeholder={form.vendor_ledger_id ? 'Entry vendor' : 'Choose'}
                                                />
                                                {l.party_ledger_id && subLedgersOf(l.party_ledger_id).length > 0 && (
                                                    <select className="erp-select mt-0.5" value={l.party_sub_ledger_id || ''} onChange={e => updateExpenseLine(idx, { party_sub_ledger_id: e.target.value })}>
                                                        <option value="">Sub-ledger: none</option>
                                                        {subLedgersOf(l.party_ledger_id).map(x => <option key={x.id} value={x.id}>{x.sub_ledger_name}</option>)}
                                                    </select>
                                                )}
                                            </td>
                                            <td><input className="erp-input" disabled={minus} value={minus ? '' : l.party_bill_no || ''} onChange={e => updateExpenseLine(idx, { party_bill_no: e.target.value })} placeholder={minus ? '' : 'no bill'} /></td>
                                            <td><input type="date" className="erp-input" disabled={minus || !String(l.party_bill_no || '').trim()} value={l.party_bill_date || ''} onChange={e => updateExpenseLine(idx, { party_bill_date: e.target.value })} /></td>
                                            <td><input type="number" step="0.01" className="erp-input text-right" disabled={minus} value={minus ? '' : l.vat_percent ?? ''} onChange={e => updateExpenseLine(idx, { vat_percent: e.target.value })} placeholder={minus ? '' : '13'} /></td>
                                            <td>
                                                <input type="number" step="0.01" className="erp-input text-right" disabled={minus} value={minus ? '' : l.vat_amount ?? ''} onChange={e => updateExpenseLine(idx, { vat_amount: e.target.value })} />
                                                {bt === 'taxable' && <label className="flex items-center gap-1 text-[10px] text-gray-600 whitespace-nowrap" title="Tick when this VAT cannot be claimed - it then goes to the cost of the goods and stays out of input VAT"><input type="checkbox" checked={!!l.vat_in_cost} onChange={e => updateExpenseLine(idx, { vat_in_cost: e.target.checked })} />to cost</label>}
                                            </td>
                                            <td className={`text-right font-semibold ${minus ? 'text-red-700' : ''}`}>{Number(l.amount) ? f2((minus ? -1 : 1) * ((Number(l.amount) || 0) + (bt === 'taxable' ? Number(l.vat_amount) || 0 : 0))) : ''}</td>
                                            <td className="text-xs whitespace-nowrap">{l.is_tds ? 'TDS' : l.entry_sign === 'deduct' ? 'Less' : <span className={bt === 'taxable' ? 'text-green-700 font-semibold' : bt === 'non_taxable' ? 'text-blue-700' : 'text-gray-500'}>{BILL_LABEL[bt]}</span>}</td>
                                            <td><button type="button" tabIndex={-1} onClick={() => removeExpenseLine(idx)} className="text-red-500 text-xs" title="Remove line">✕</button></td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="font-semibold bg-gray-100">
                                        <td colSpan={2 + 1 + (efc.isVisible('allocation_basis', 'detail') ? 1 : 0) + (efc.isVisible('entry_sign', 'detail') ? 1 : 0) + (efc.isVisible('rate_percent', 'detail') ? 1 : 0)} className="text-right">Bill-wise total</td>
                                        {efc.isVisible('amount', 'detail') && <td className="text-right">{f2(form.expense_lines.filter(l => !l.target_detail_id).reduce((s2, l) => s2 + (l.is_tds || l.entry_sign === 'deduct' ? -1 : 1) * (Number(l.amount) || 0), 0))}</td>}
                                        <td colSpan={4} />
                                        <td className="text-right">{f2(form.expense_lines.filter(l => !l.target_detail_id && (l.bill_type || billTypeOf(l)) === 'taxable').reduce((s2, l) => s2 + (Number(l.vat_amount) || 0), 0))}</td>
                                        <td className="text-right">{f2(form.expense_lines.filter(l => !l.target_detail_id).reduce((s2, l) => s2 + (l.is_tds || l.entry_sign === 'deduct' ? -1 : 1) * (Number(l.amount) || 0) + ((l.bill_type || billTypeOf(l)) === 'taxable' ? Number(l.vat_amount) || 0 : 0), 0))}</td>
                                        <td colSpan={2} />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        )}
                        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
                            <span className="flex gap-3">
                                <button type="button" onClick={addExpenseLine} className="nav-btn small">➕ Add Line</button>
                                <button type="button" onClick={addTdsLine} className="nav-btn small" title="One TDS line per party paid, on its TDS-applicable terms: Cr TDS payable (sub-ledger), less paid to that party">➕ Add / Refresh TDS</button>
                            </span>
                            <span className="text-xs text-gray-500">VAT typed on a line = taxable bill · Bill No without VAT = tax-free bill · neither = no bill. Lines of one party with the same Bill No are one bill, credited to that party.</span>
                        </div>

                        {(() => {
                            const partyOf = l => l.party_ledger_id || form.vendor_ledger_id || '';
                            const partyName = id => (id ? ledgerName(id) || (vendors.find(v => v.id === id) || {}).account_name : form.cash_vendor_name) || '(choose party)';
                            // bills of this entry: party + supplier bill no -> taxable / VAT / tax-free; less TDS and "−" lines per party
                            const parties = new Map();
                            form.expense_lines.forEach(l => {
                                const amt = Number(l.amount) || 0;
                                if (!amt) return;
                                const pid = partyOf(l);
                                if (!parties.has(pid)) parties.set(pid, { id: pid, bills: new Map(), less: 0, tds: 0 });
                                const p = parties.get(pid);
                                if (l.is_tds) { p.tds = r2(p.tds + amt); return; }
                                if (l.entry_sign === 'deduct') { p.less = r2(p.less + amt); return; }
                                const bt = l.bill_type || billTypeOf(l), no = String(l.party_bill_no || '').trim();
                                const k = no.toLowerCase();
                                if (!p.bills.has(k)) p.bills.set(k, { no, date: l.party_bill_date || '', taxable: 0, vat: 0, free: 0 });
                                const b = p.bills.get(k);
                                if (!b.date && l.party_bill_date) b.date = l.party_bill_date;
                                if (bt === 'taxable') { b.taxable = r2(b.taxable + amt); b.vat = r2(b.vat + (Number(l.vat_amount) || 0)); } else b.free = r2(b.free + amt);
                            });
                            const plist = [...parties.values()].map(p => {
                                const bills = [...p.bills.values()].map(b => ({ ...b, total: r2(b.taxable + b.vat + b.free) }));
                                return { ...p, bills, credit: r2(bills.reduce((s2, b) => s2 + b.total, 0) - p.less - p.tds) };
                            });
                            const sumOf = k => r2(plist.reduce((s2, p) => s2 + p.bills.reduce((s3, b) => s3 + b[k], 0), 0));
                            const T = { taxable: sumOf('taxable'), vat: sumOf('vat'), free: sumOf('free'), total: sumOf('total'), less: r2(plist.reduce((s2, p) => s2 + p.less, 0)), tds: r2(plist.reduce((s2, p) => s2 + p.tds, 0)), credit: r2(plist.reduce((s2, p) => s2 + p.credit, 0)) };
                            // Prd. (product-wise) / Gen. (bill-wise) additional (to the cost of the goods) / non-additional
                            const cost = l => !l.is_tds && l.allocation_basis !== 'none';
                            const parts = { prdAdd: 0, prdNon: 0, genAdd: 0, genNon: 0 };
                            form.expense_lines.forEach(l => {
                                const amt = (l.entry_sign === 'deduct' || l.is_tds ? -1 : 1) * (Number(l.amount) || 0);
                                const vat = (l.bill_type || billTypeOf(l)) === 'taxable' ? Number(l.vat_amount) || 0 : 0;
                                const k = l.target_detail_id ? 'prd' : 'gen';
                                parts[k + (cost(l) ? 'Add' : 'Non')] += amt;
                                parts[k + (l.vat_in_cost && cost(l) ? 'Add' : 'Non')] += vat;
                            });
                            const netAdd = r2(parts.prdAdd + parts.genAdd), netNon = r2(parts.prdNon + parts.genNon);
                            const goods = Number(refInfo?.totals?.net_basic || 0);
                            const gl = refInfo?.gl || [];
                            const glDr = r2(gl.reduce((s2, x) => s2 + x.debit, 0)), glCr = r2(gl.reduce((s2, x) => s2 + x.credit, 0));
                            const partyIds = new Set(plist.map(p => p.id));
                            const glParty = r2(gl.filter(x => partyIds.has(x.ledger_id)).reduce((s2, x) => s2 + x.credit - x.debit, 0));
                            const ok = (a, b) => Math.abs(a - b) < 0.01;
                            const Check = ({ a, b, label }) => <span className={`text-xs ml-2 ${ok(a, b) ? 'text-green-700' : 'text-red-700 font-semibold'}`}>{ok(a, b) ? `✓ ${label}` : `✗ ${label} ${f2(b)}`}</span>;
                            return (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                <div className="lg:col-span-2 min-w-0">
                                    <div className="erp-tabs">
                                        {[['goods', `Goods Details${allocationPreview.length ? ` (${allocationPreview.length})` : ''}`], ['bills', `Party Bills / VAT${plist.length ? ` (${plist.reduce((s2, p) => s2 + p.bills.length, 0)})` : ''}`], ['posting', 'Account Posting (Ledger)']].map(([k, t]) => (
                                            <button key={k} type="button" className={`erp-tab ${bottomTab === k ? 'active' : ''}`} onClick={() => setBottomTab(k)}>{t}</button>
                                        ))}
                                    </div>
                                    <div className="border border-t-0 border-[#aca899] bg-white p-2 overflow-x-auto">
                                    {bottomTab === 'goods' && (allocationPreview.length === 0 ? <p className="text-sm text-gray-500 p-2">Choose the Ref. Bill No. - its goods and the additional cost per product show here.</p> : (
                                        <>
                                            {refInfo?.reference && (
                                                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs mb-1 px-1">
                                                    <span>Ref. Bill <b className="font-mono">{refInfo.reference.doc_no}</b> {String(refInfo.reference.doc_date || '').slice(0, 10)}</span>
                                                    <span>Supplier <b>{refInfo.reference.vendor_name_snapshot || '—'}</b></span>
                                                    {refInfo.reference.party_bill_no && <span>Supplier Bill <b>{refInfo.reference.party_bill_no}</b></span>}
                                                    <span>Bill amount <b>{f2(refInfo.reference.total_amount)}</b></span>
                                                </div>
                                            )}
                                            <table className="erp-grid-table">
                                                <thead><tr><th>#</th><th>Product</th><th className="text-right">Alt Qty</th><th className="text-right">Qty</th><th className="text-right">Goods Amount</th><th className="text-right">Additional</th><th className="text-right">Net Amount</th><th className="text-right">Cost / Unit</th></tr></thead>
                                                <tbody>
                                                    {allocationPreview.map((a, i) => (
                                                        <tr key={i}><td>{i + 1}</td><td>{a.product_name_snapshot}</td><td className="text-right">{a.alt_qty || ''}</td><td className="text-right">{a.qty}</td>
                                                            <td className="text-right">{f2(a.value)}</td><td className="text-right text-green-800">{f2(a.allocated_amount)}</td>
                                                            <td className="text-right font-semibold">{f2(a.value + a.allocated_amount)}</td><td className="text-right">{a.qty ? ((a.value + a.allocated_amount) / a.qty).toFixed(4) : ''}</td></tr>
                                                    ))}
                                                </tbody>
                                                <tfoot><tr className="font-semibold bg-gray-100"><td colSpan={2}>Total</td><td className="text-right">{refInfo?.totals?.alt_qty || ''}</td><td className="text-right">{refInfo?.totals?.qty}</td>
                                                    <td className="text-right">{f2(goods)}</td><td className="text-right">{f2(refInfo?.totals?.additional)}<Check a={netAdd} b={Number(refInfo?.totals?.additional || 0)} label="= Net Additional" /></td><td className="text-right">{f2(goods + Number(refInfo?.totals?.additional || 0))}</td><td /></tr></tfoot>
                                            </table>
                                        </>
                                    ))}
                                    {bottomTab === 'bills' && (plist.length === 0 ? <p className="text-sm text-gray-500 p-2">No amounts yet.</p> : (
                                        <table className="erp-grid-table">
                                            <thead><tr><th>Party (credited)</th><th>Supplier Bill No</th><th>Bill Date</th><th>Bill</th><th className="text-right">Taxable Amt</th><th className="text-right">VAT</th><th className="text-right">Tax-free / No bill</th><th className="text-right">Bill Total</th></tr></thead>
                                            <tbody>
                                                {plist.map(p => (
                                                    <React.Fragment key={p.id || 'none'}>
                                                        {p.bills.map((b, i) => (
                                                            <tr key={i}><td>{i === 0 ? <b>{partyName(p.id)}</b> : ''}</td><td className="font-mono">{b.no || '—'}</td><td>{b.date}</td>
                                                                <td className="text-xs">{b.taxable ? (b.free ? 'Taxable + tax-free' : 'Taxable (VAT)') : b.no ? 'Tax-free bill' : 'No bill'}</td>
                                                                <td className="text-right">{b.taxable ? f2(b.taxable) : ''}</td><td className="text-right">{b.vat ? f2(b.vat) : ''}</td><td className="text-right">{b.free ? f2(b.free) : ''}</td><td className="text-right font-semibold">{f2(b.total)}</td></tr>
                                                        ))}
                                                        {p.less > 0 && <tr className="text-red-700"><td /><td colSpan={6}>Less ("−" terms)</td><td className="text-right">-{f2(p.less)}</td></tr>}
                                                        {p.tds > 0 && <tr className="text-amber-800"><td /><td colSpan={6}>Less TDS withheld (Cr TDS payable)</td><td className="text-right">-{f2(p.tds)}</td></tr>}
                                                        <tr className="bg-blue-50"><td /><td colSpan={6} className="font-semibold">Credited to {partyName(p.id)}</td><td className="text-right font-bold">{f2(p.credit)}</td></tr>
                                                    </React.Fragment>
                                                ))}
                                            </tbody>
                                            <tfoot><tr className="font-bold bg-gray-100"><td colSpan={4}>Total · {plist.reduce((s2, p) => s2 + p.bills.filter(b => b.no).length, 0)} supplier bill(s), {plist.length} part{plist.length === 1 ? 'y' : 'ies'}</td><td className="text-right">{f2(T.taxable)}</td><td className="text-right">{f2(T.vat)}</td><td className="text-right">{f2(T.free)}</td>
                                                <td className="text-right">{f2(T.credit)}{gl.length > 0 && <Check a={T.credit} b={glParty} label="= party credit in posting" />}</td></tr></tfoot>
                                        </table>
                                    ))}
                                    {bottomTab === 'posting' && (form.account_posting === false ? <p className="text-sm text-gray-500 p-2">Account Posting is "No" - landed cost only, nothing goes to the ledger.</p>
                                        : refInfo?.gl_error ? <p className="text-sm text-red-700 p-2">{refInfo.gl_error}</p>
                                        : !gl.length ? <p className="text-sm text-gray-500 p-2">Enter the amounts - the ledger entry shows here.</p> : (
                                        <table className="erp-grid-table">
                                            <thead><tr><th>Ledger</th><th>Sub-Ledger</th><th>Narration</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
                                            <tbody>
                                                {gl.map((x, i) => (
                                                    <tr key={i}><td className={x.credit ? 'pl-6' : ''}>{x.ledger_name}</td><td>{x.sub_ledger_name}</td><td className="text-xs text-gray-600">{x.narration}</td>
                                                        <td className="text-right">{x.debit ? f2(x.debit) : ''}</td><td className="text-right">{x.credit ? f2(x.credit) : ''}</td></tr>
                                                ))}
                                            </tbody>
                                            <tfoot><tr className="font-bold bg-gray-100"><td colSpan={3}>Total <Check a={glDr} b={glCr} label="Dr = Cr" /></td><td className="text-right">{f2(glDr)}</td><td className="text-right">{f2(glCr)}</td></tr></tfoot>
                                        </table>
                                    ))}
                                    </div>
                                </div>
                                <div className="border border-[#aca899] bg-[#f7f6f1] text-sm self-start">
                                    <div className="px-2 py-1 font-semibold bg-[#dfdcd0] border-b border-[#aca899]">Totals</div>
                                    <table className="w-full text-xs">
                                        <tbody>
                                            {[[['Prd. Additional', parts.prdAdd], ['Prd. Non-Add.', parts.prdNon]], [['Gen. Additional', parts.genAdd], ['Gen. Non-Add.', parts.genNon]],
                                              [['Net Additional', netAdd, 'b'], ['Net Non-Add.', netNon, 'b']], [['Taxable Amt', T.taxable], ['VAT', T.vat]], [['Tax-free / no bill', T.free], ['Less TDS', -T.tds]]].map((row, i) => (
                                                <tr key={i} className="border-b border-[#e4e1d6]">{row.map(([lbl, v, st]) => (
                                                    <React.Fragment key={lbl}><td className={`px-2 py-1 text-gray-600 ${st ? 'font-semibold text-gray-800' : ''}`}>{lbl}</td><td className={`px-2 py-1 text-right ${st ? 'font-semibold' : ''}`}>{f2(v)}</td></React.Fragment>
                                                ))}</tr>
                                            ))}
                                            {T.less > 0 && <tr className="border-b border-[#e4e1d6]"><td className="px-2 py-1 text-gray-600" colSpan={3}>Less "−" terms</td><td className="px-2 py-1 text-right">{f2(-T.less)}</td></tr>}
                                            {[['Net Payable (credited to parties)', netPayable, 'bg-blue-50 font-bold text-sm'], ['Goods (Ref. Bill net basic)', goods, ''], ['Net Total (goods + additional)', r2(goods + netAdd), 'font-semibold']].map(([lbl, v, cls]) => (
                                                <tr key={lbl} className={`border-b border-[#e4e1d6] ${cls}`}><td className="px-2 py-1" colSpan={3}>{lbl}</td><td className="px-2 py-1 text-right">{f2(v)}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {netPayable !== 0 && <p className="text-xs text-gray-600 italic px-2 py-1 border-t">{amountToWords(netPayable, form.currency === 'NPR' ? 'Nrs' : form.currency)}{fx.foreign ? ` · ${fx.code} = ${f2(netPayable * fx.rate)} ${fx.base}` : ''}</p>}
                                    {gl.length > 0 && <p className="px-2 pb-1"><Check a={r2(netPayable)} b={glParty} label="Net Payable = party credit in posting" /></p>}
                                </div>
                            </div>
                            );
                        })()}
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
                    Show unposted (awaiting approval) only
                </label>
            </div>
            <ReportGrid
                columns={columns}
                rows={showDraftsOnly ? rows.filter(r => r.status === 'draft') : rows}
                getId={r => r.id}
                storageKey="purchase_additional_expense_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        <DocActions type="purchase_additional" api="purchase-additional-expenses" row={row} onOpen={handleEdit} onCopy={r => handleCopyFrom(r.id)} onReverse={r => handleStatusChange(r, 'cancelled')} onDone={load} />
                        {row.status === 'posted' && <a href={`/print/purchase_additional_expense/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="purchase_additional_expense" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                    </div>
                )}
            />
        </div>

        {showCopyModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">Copy From — Additional Expense</span></div>
                    <div className="p-4">
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {rows.map(r => (
                                <button key={r.id} type="button" onClick={() => handleCopyFrom(r.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{r.doc_no} <span className="text-xs text-gray-400">— {r.vendor_display_name || 'No vendor'}</span></span>
                                    <span className="text-xs text-gray-400">{r.doc_date} · {r.status}</span>
                                </button>
                            ))}
                            {rows.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nothing yet to copy from.</p>}
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

        {auditModal && <RecordHistory table="purchase_additional_expenses" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/purchase-additional-expenses/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
