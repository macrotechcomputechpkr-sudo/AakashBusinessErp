// =============================================
// PurchaseAdditionalExpense.jsx
// Extra costs (freight, customs duty, insurance) linked to an Order,
// GRN, and/or Bill, split across that document's product lines for
// landed cost - by Value share, Qty share, or an Equal split, with a
// live preview of the split before saving.
// =============================================

import ProductCompanyField from '../components/ProductCompanyField';
import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';
import { amountToWords } from '../utils/numberToWords';

const emptyExpenseLine = () => ({ expense_ledger_id: '', description: '', allocation_basis: 'value_wise', entry_sign: 'add', rate_percent: '', amount: '' });

const emptyForm = {
    vendor_sub_ledger_id: '', product_company_id: '', doc_date: new Date().toISOString().slice(0, 10),
    source_order_id: '', source_grn_id: '', source_bill_id: '',
    vendor_ledger_id: '', cash_vendor_name: '', agent_id: '', invoice_type: 'credit', currency: 'NPR',
    party_bill_no: '', party_bill_date: '',
    remarks_text: '', cost_center_id: '', business_unit_id: '', priority: 'normal', narration: '',
    expense_lines: [emptyExpenseLine()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['agent_id', 'business_unit_id', 'cost_center_id', 'currency', 'doc_date', 'invoice_type', 'narration', 'party_bill_date', 'party_bill_no', 'priority', 'vendor_ledger_id'];

export default function PurchaseAdditionalExpense() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('purchase_additional', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [auditModal, setAuditModal] = useState(null);
    const [allocationPreview, setAllocationPreview] = useState([]);

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
    const removeExpenseLine = (idx) => setForm(f => ({ ...f, expense_lines: f.expense_lines.length > 1 ? f.expense_lines.filter((_, i) => i !== idx) : f.expense_lines }));
    const updateExpenseLine = (idx, patch) => setForm(f => ({ ...f, expense_lines: f.expense_lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));

    // FEATURE: "Rate/Perc." convenience - a VAT or TDS line's amount can
    // be auto-computed as rate_percent% of every OTHER '+' line's total
    // (the underlying expense being taxed/withheld against), rather
    // than always hand-typed.
    const autoCalcFromRate = (idx, ratePercent) => {
        setForm(f => {
            const baseAmount = f.expense_lines.reduce((s, l, i) => i === idx ? s : s + (l.entry_sign !== 'deduct' ? (Number(l.amount) || 0) : 0), 0);
            const computed = ratePercent === '' ? '' : Math.round(baseAmount * (Number(ratePercent) / 100) * 100) / 100;
            return { ...f, expense_lines: f.expense_lines.map((l, i) => i === idx ? { ...l, rate_percent: ratePercent, amount: computed } : l) };
        });
    };

    // FEATURE: "Net Payable" to the expense provider - every '+' line
    // adds, every '-' line (a TDS/withholding deduction, the standard
    // case) subtracts. Computed the same way the backend does, so what
    // the form shows while typing matches what gets saved.
    const netPayable = form.expense_lines.reduce((s, l) => s + (l.entry_sign === 'deduct' ? -(Number(l.amount) || 0) : (Number(l.amount) || 0)), 0);

    // FEATURE: live allocation preview - refetches from the SAME math
    // the backend uses, whenever the source or any line changes. Only
    // lines with a Basis other than "Not Allocated" affect landed cost.
    useEffect(() => {
        const hasSource = form.source_order_id || form.source_grn_id || form.source_bill_id;
        const hasAllocatableLine = form.expense_lines.some(l => l.allocation_basis !== 'none' && Number(l.amount) > 0);
        if (!hasSource || !hasAllocatableLine) { setAllocationPreview([]); return; }
        let cancelled = false;
        authFetch('/api/purchase-additional-expenses/allocation-preview', {
            method: 'POST',
            body: JSON.stringify({
                source_order_id: form.source_order_id || undefined, source_grn_id: form.source_grn_id || undefined, source_bill_id: form.source_bill_id || undefined,
                expense_lines: form.expense_lines.filter(l => Number(l.amount) > 0)
            })
        })
            .then(res => { if (!cancelled) setAllocationPreview(res.data.allocations || []); })
            .catch(() => { if (!cancelled) setAllocationPreview([]); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.source_order_id, form.source_grn_id, form.source_bill_id, JSON.stringify(form.expense_lines)]);

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        if (!saveAsDraft) {
            if (!form.source_order_id && !form.source_grn_id && !form.source_bill_id) return showAlert('Link this to at least one Order, GRN, or Bill', 'danger');
        }
        const validLines = form.expense_lines.filter(l => l.expense_ledger_id && Number(l.amount) > 0);
        if (!saveAsDraft && validLines.length === 0) return showAlert('At least one complete expense line (Expense Type + Amount) is required', 'danger');
        try {
            const payload = { ...form, expense_lines: validLines, ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}) };
            if (editingId) {
                await authFetch(`/api/purchase-additional-expenses/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : 'Additional Expense updated', 'success');
            } else {
                const res = await authFetch('/api/purchase-additional-expenses', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Additional Expense ${res.data.doc_no} created`, 'success');
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
            const res = await authFetch(`/api/purchase-additional-expenses/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...res.data,
                doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date,
                party_bill_date: res.data.party_bill_date?.slice(0, 10) || '',
                expense_lines: (res.data.expense_lines || []).length > 0 ? res.data.expense_lines : [emptyExpenseLine()]
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

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/purchase-additional-expenses/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const openAuditTrail = async (row) => {
        try {
            const res = await authFetch(`/api/purchase-additional-expenses/${row.id}/audit-trail`);
            setAuditModal({ doc_no: row.doc_no, entries: res.data || [] });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

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
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>} {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Link to Order</label>
                            <select className="erp-select" value={form.source_order_id} onChange={e => setForm({ ...form, source_order_id: e.target.value })}>
                                <option value="">— None —</option>
                                {openOrders.map(o => <option key={o.id} value={o.id}>{o.doc_no}</option>)}
                            </select>
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Link to GRN</label>
                            <select className="erp-select" value={form.source_grn_id} onChange={e => setForm({ ...form, source_grn_id: e.target.value })}>
                                <option value="">— None —</option>
                                {openGrns.map(g => <option key={g.id} value={g.id}>{g.doc_no}</option>)}
                            </select>
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Link to Bill</label>
                            <select className="erp-select" value={form.source_bill_id} onChange={e => setForm({ ...form, source_bill_id: e.target.value })}>
                                <option value="">— None —</option>
                                {openBills.map(b => <option key={b.id} value={b.id}>{b.doc_no}</option>)}
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
                                <input disabled={efc.isReadonly('currency')} className="erp-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} />
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

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Expense Lines</h2>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table mb-2 min-w-[900px]">
                                <thead>
                                    <tr>
                                        <th className="w-48">Ledger</th>
                                        <th className={`w-40 ${efc.isVisible('description', 'detail') ? '' : 'hidden'}`}>Term <span className="text-gray-400 normal-case">(description)</span></th>
                                        <th className={`w-32 ${efc.isVisible('allocation_basis', 'detail') ? '' : 'hidden'}`}>Basis</th>
                                        <th className={`w-20 ${efc.isVisible('entry_sign', 'detail') ? '' : 'hidden'}`}>Sign</th>
                                        <th className={`w-24 ${efc.isVisible('rate_percent', 'detail') ? '' : 'hidden'}`}>Rate %</th>
                                        <th className={`w-28 ${efc.isVisible('amount', 'detail') ? '' : 'hidden'}`}>Amount</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.expense_lines.map((l, idx) => (
                                        <tr key={idx}>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="expense_ledger_picker"
                                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['account_name']}
                                                    items={ledgers} getId={x => x.id} getLabel={x => x.account_name}
                                                    searchKeys={['account_name', 'account_code']}
                                                    value={l.expense_ledger_id} onChange={id => updateExpenseLine(idx, { expense_ledger_id: id })} placeholder="e.g. Freight, VAT, TDS"
                                                />
                                            </td>
                                            <td className={efc.isVisible('description', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('description', 'detail')} className="erp-input" value={l.description} onChange={e => updateExpenseLine(idx, { description: e.target.value })} placeholder="e.g. Transportation" /></td>
                                            <td className={efc.isVisible('allocation_basis', 'detail') ? '' : 'hidden'}>
                                                <select disabled={efc.isReadonly('allocation_basis', 'detail')} className="erp-select" value={l.allocation_basis} onChange={e => updateExpenseLine(idx, { allocation_basis: e.target.value })}>
                                                    <option value="value_wise">Value-wise</option>
                                                    <option value="qty_wise">Qty-wise</option>
                                                    <option value="equal">Equal Split</option>
                                                    <option value="none">Not Allocated</option>
                                                </select>
                                            </td>
                                            <td className={efc.isVisible('entry_sign', 'detail') ? '' : 'hidden'}>
                                                <select disabled={efc.isReadonly('entry_sign', 'detail')} className="erp-select" value={l.entry_sign} onChange={e => updateExpenseLine(idx, { entry_sign: e.target.value })}>
                                                    <option value="add">+</option>
                                                    <option value="deduct">−</option>
                                                </select>
                                            </td>
                                            <td className={efc.isVisible('rate_percent', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('rate_percent', 'detail')} type="number" step="0.001" className="erp-input" value={l.rate_percent} onChange={e => autoCalcFromRate(idx, e.target.value)} placeholder="e.g. 13" /></td>
                                            <td className={efc.isVisible('amount', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('amount', 'detail')} type="number" step="0.01" className="erp-input" value={l.amount} onChange={e => updateExpenseLine(idx, { amount: e.target.value, rate_percent: '' })} /></td>
                                            <td><button type="button" tabIndex={-1} onClick={() => removeExpenseLine(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">Rate % auto-computes this line's Amount from the other "+" lines' total (e.g. a 13% VAT or 1.5% TDS line on a Freight charge) - type an amount directly to override.</p>
                        <div className="flex justify-between items-start mb-1">
                            <button type="button" onClick={addExpenseLine} className="text-xs text-blue-600">➕ Add Line</button>
                            <span className="text-sm font-semibold">Net Payable: {netPayable.toFixed(2)}</span>
                        </div>
                        {netPayable !== 0 && (
                            <p className="text-xs text-gray-500 text-right mb-4 italic">{amountToWords(netPayable, form.currency === 'NPR' ? 'Nrs' : form.currency)}</p>
                        )}

                        {allocationPreview.length > 0 && (
                            <div>
                                <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Allocation Preview (Landed Cost)</h2>
                                <p className="text-xs text-gray-400 mb-2">Only lines with a Basis other than "Not Allocated" reach here - a VAT or TDS line doesn't change what the item cost.</p>
                                <table className="erp-grid-table">
                                    <thead>
                                        <tr><th>Product</th><th>Qty</th><th>Line Value</th><th>Allocated Expense</th><th>Landed Cost / Unit</th><th>Net Amount</th></tr>
                                    </thead>
                                    <tbody>
                                        {allocationPreview.map((a, i) => (
                                            <tr key={i}>
                                                <td>{a.product_name_snapshot}</td>
                                                <td>{a.qty}</td>
                                                <td>{a.value.toFixed(2)}</td>
                                                <td>{a.allocated_amount.toFixed(2)}</td>
                                                <td>{a.landed_cost_per_unit}</td>
                                                <td className="font-medium">{(a.value + a.allocated_amount).toFixed(2)}</td>
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
                storageKey="purchase_additional_expense_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        {row.status === 'posted' && <a href={`/print/purchase_additional_expense/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {row.status !== 'cancelled' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {row.status === 'draft' && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
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
