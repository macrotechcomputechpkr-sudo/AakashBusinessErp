// =============================================
// CashBankEntry.jsx
// Cash / Bank Receipt & Payment voucher, master + details:
//   master  - voucher no, date, Receipt / Payment, cash / bank ledger,
//             document no / date, cost center, unit (+ optional product
//             company, area, agent, route that then apply to every line)
//   details - any ledger (party, expense, bank for a deposit ...), its
//             sub-ledger and dimensions, manual receipt no, remarks and a
//             Receipt or a Payment amount; the cash / bank takes the net.
// Bulk mode still posts one entry per party at once.
// =============================================

import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';
import BillWiseSettlementPanel from '../components/BillWiseSettlementPanel';
import UdfValuesModal from '../components/UdfValuesModal';
import RecordHistory from '../components/RecordHistory';
import DocActions, { asNewCopy, finalizeEntry } from '../components/entry/DocActions';
import EntryFillBar from '../components/entry/EntryFillBar';
import { saveEntryDraft, finishEntryDraft } from '../components/entry/entryDrafts';
import DocNumberField from '../components/entry/DocNumberField';

const PAYMENT_MODES = [
    { value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'cheque', label: 'Cheque' }, { value: 'online', label: 'Online' },
    { value: 'card', label: 'Card' }, { value: 'other', label: 'Other' }
];

const emptyLine = () => ({ ledger_id: '', sub_ledger_id: '', product_company_id: '', area_id: '', agent_id: '', route_id: '', business_unit_id: '',
    manual_receipt_no: '', remarks: '', receipt_amount: '', payment_amount: '', bill_wise_settlements: null });
const emptyForm = {
    doc_date: new Date().toISOString().slice(0, 10),
    numbering_category_id: '', doc_no: '',
    entry_type: 'receipt', cash_bank_ledger_id: '', payment_mode: 'cash', ref_no: '', ref_doc_no: '', ref_doc_date: '',
    cost_center_id: '', business_unit_id: '', product_company_id: '', area_id: '', agent_id: '', route_id: '',
    remarks_text: '', narration: '', lines: [emptyLine()]
};
const num = v => Number(v) || 0;
const emptyBulkLine = () => ({ party_ledger_id: '', amount: '', payment_mode: 'cash', narration: '' });

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['cash_bank_ledger_id', 'doc_date', 'entry_type', 'narration', 'payment_mode', 'ref_no', 'ref_doc_no', 'ref_doc_date', 'cost_center_id', 'business_unit_id'];

export default function CashBankEntry() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('cash_bank_entry', EFC_RENDERED_KEYS);
    // Product Company list for the accounting dimension picker.
    const [productCompanies, setProductCompanies] = useState([]);
    useEffect(() => { authFetch('/api/product-companies').then(r => setProductCompanies(r.data || [])).catch(() => {}); }, [authFetch]);
    const [mode, setMode] = useState('single');
    const [rows, setRows] = useState([]);
    const [bulkBatches, setBulkBatches] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [billLine, setBillLine] = useState(null); // line index whose bills are being settled
    const [auditModal, setAuditModal] = useState(null);

    const [bulkForm, setBulkForm] = useState({ batch_date: new Date().toISOString().slice(0, 10), entry_type: 'receipt', cash_bank_ledger_id: '', narration: '', lines: [emptyBulkLine()] });

    const [ledgers, setLedgers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [agents, setAgents] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [remarks, setRemarks] = useState([]);
    const [areas, setAreas] = useState([]);
    const [routes, setRoutes] = useState([]);
    useEffect(() => {
        authFetch('/api/areas').then(r => setAreas(r.data || [])).catch(() => {});
        authFetch('/api/routes').then(r => setRoutes(r.data || [])).catch(() => {});
    }, [authFetch]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, bulk, ldg, sl, ag, cc, bu, rmk] = await Promise.all([
                authFetch('/api/cash-bank-entries'),
                authFetch('/api/bulk-cash-bank-batches'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/remarks')
            ]);
            setRows(req.data || []);
            setBulkBatches(bulk.data || []);
            setLedgers(ldg.data || []);
            setSubLedgers(sl.data || []);
            setAgents(ag.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setRemarks(rmk.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm({ ...emptyForm, lines: [emptyLine()] }); setEditingId(null); setBillLine(null); };
    const updateLine = (idx, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
    const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }));
    const removeLine = idx => setForm(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== idx) : [emptyLine()] }));
    const realLines = (form.lines || []).filter(l => l.ledger_id);
    const totalReceipt = realLines.reduce((t, l) => t + num(l.receipt_amount), 0);
    const totalPayment = realLines.reduce((t, l) => t + num(l.payment_amount), 0);
    const net = Math.round((totalReceipt - totalPayment) * 100) / 100;
    // a dimension chosen on the master applies to every line, so its line column is not shown
    const dimOnMaster = k => !!form[k];
    const resetBulkForm = () => setBulkForm({ batch_date: new Date().toISOString().slice(0, 10), entry_type: 'receipt', cash_bank_ledger_id: '', narration: '', lines: [emptyBulkLine()] });
    const addBulkLine = () => setBulkForm(f => ({ ...f, lines: [...f.lines, emptyBulkLine()] }));
    const removeBulkLine = (idx) => setBulkForm(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== idx) : f.lines }));
    const updateBulkLine = (idx, patch) => setBulkForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
    const bulkTotal = bulkForm.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

    const handleSubmit = async (e, saveAsDraft = false) => {

        // Save as Draft (new entry): kept apart as a temporary draft - no number, no accounts / stock effect

        if (saveAsDraft && !editingId) { if (e) e.preventDefault(); if (await saveEntryDraft(authFetch, 'cash_bank_entry', form)) { resetForm(); setShowForm(false); } return; }
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        if (!form.cash_bank_ledger_id) return showAlert('Cash/Bank Ledger is required', 'danger');
        if (!realLines.length) return showAlert('Enter at least one detail line', 'danger');
        for (const [i, l] of realLines.entries()) {
            if ((num(l.receipt_amount) > 0) === (num(l.payment_amount) > 0)) return showAlert(`Line ${i + 1}: enter either a Receipt or a Payment amount`, 'danger');
            if (l.ledger_id === form.cash_bank_ledger_id) return showAlert(`Line ${i + 1}: the ledger cannot be the Cash / Bank ledger itself`, 'danger');
        }
        if (net === 0) return showAlert('Receipts and payments cancel out - nothing moves in Cash / Bank', 'danger');
        try {
            const payload = { ...form, lines: realLines.map(l => ({ ...l, receipt_amount: num(l.receipt_amount), payment_amount: num(l.payment_amount) })), ...(saveAsDraft ? { status: 'draft' } : {}) };
            ['party_ledger_id', 'party_sub_ledger_id', 'amount', 'bill_wise_settlements'].forEach(k => delete payload[k]);
            if (editingId) {
                await authFetch(`/api/cash-bank-entries/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                if (!saveAsDraft) await finalizeEntry(authFetch, 'cash-bank-entries', editingId, 'posted');
                showAlert('Entry updated', 'success');
            } else {
                const res = await authFetch('/api/cash-bank-entries', { method: 'POST', body: JSON.stringify(payload) });
                if (!saveAsDraft) await finalizeEntry(authFetch, 'cash-bank-entries', res.data?.id, 'posted');
                showAlert(`${net > 0 ? 'Receipt' : 'Payment'} ${res.data.doc_no} created`, 'success');
            }
            await finishEntryDraft(authFetch, 'cash_bank_entry');
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleBulkSubmit = async (e) => {
        e.preventDefault();
        if (!bulkForm.batch_date) return showAlert('Date is required', 'danger');
        if (!bulkForm.cash_bank_ledger_id) return showAlert('Cash/Bank Ledger is required', 'danger');
        const validLines = bulkForm.lines.filter(l => l.party_ledger_id && Number(l.amount) > 0);
        if (validLines.length === 0) return showAlert('At least one complete line is required', 'danger');
        try {
            const res = await authFetch('/api/bulk-cash-bank-batches', { method: 'POST', body: JSON.stringify({ ...bulkForm, lines: validLines }) });
            showAlert(res.message, 'success');
            resetBulkForm();
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const copyAsNew = async (row) => { await handleEdit(row); setEditingId(null); setForm(f => asNewCopy(f, row.id)); setShowForm(true); };
    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/cash-bank-entries/${row.id}`);
            setEditingId(row.id);
            const d = res.data;
            const lines = (d.lines || []).length ? d.lines.map(l => ({ ...emptyLine(), ...l, receipt_amount: Number(l.receipt_amount) || '', payment_amount: Number(l.payment_amount) || '' }))
                // an entry saved before detail lines: its one party becomes the one line
                : [{ ...emptyLine(), ledger_id: d.party_ledger_id || '', sub_ledger_id: d.party_sub_ledger_id || '', agent_id: d.agent_id || '',
                    [d.entry_type === 'payment' ? 'payment_amount' : 'receipt_amount']: Number(d.amount) || '', bill_wise_settlements: d.bill_wise_settlements || null }];
            setForm({ ...emptyForm, ...d, doc_date: d.doc_date?.slice(0, 10), ref_doc_date: d.ref_doc_date?.slice(0, 10) || '', lines });
            setMode('single');
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
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
            await authFetch(`/api/cash-bank-entries/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
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
        { key: 'entry_type', label: 'Type', type: 'text', render: r => r.entry_type === 'receipt' ? 'Receipt' : 'Payment' },
        { key: 'party_name_snapshot', label: 'Ledger(s)', type: 'text', render: r => r.party_name_snapshot || '—' },
        { key: 'cash_bank_name_snapshot', label: 'Cash/Bank', type: 'text', render: r => r.cash_bank_name_snapshot || '—' },
        { key: 'amount', label: 'Net Amount', type: 'number' },
        { key: 'total_receipt', label: 'Receipts', type: 'number' },
        { key: 'total_payment', label: 'Payments', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    const bulkColumns = [
        { key: 'batch_no', label: 'Batch No', type: 'text' },
        { key: 'batch_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.batch_date, 'dual') },
        { key: 'entry_type', label: 'Type', type: 'text', render: r => r.entry_type === 'receipt' ? 'Receipt' : 'Payment' },
        { key: 'entry_count', label: 'Entries', type: 'number' },
        { key: 'total_amount', label: 'Total Amount', type: 'number' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">💵 Cash/Bank Entry</span>
                <div className="erp-header-actions">
                    <button onClick={() => setMode(m => m === 'single' ? 'bulk' : 'single')} className="erp-header-btn">
                        {mode === 'single' ? '📦 Bulk Mode' : '📄 Single Mode'}
                    </button>
                    {mode === 'single' && (
                        <button onClick={() => { resetForm(); setShowForm(s => !s); }} className={`erp-header-btn ${showForm ? '' : 'primary'}`}>
                            {showForm ? '✕ Close' : '➕ New'}
                        </button>
                    )}
                </div>
            </div>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {mode === 'single' && showForm && (
                <form onSubmit={handleSubmit} ref={formRef}>
                    <EntryFillBar voucherType="cash_bank_entry" api="cash-bank-entries" form={form} editing={!!editingId} onFill={p => setForm(f => ({ ...f, ...p }))} onCopy={copyAsNew} />
                    {/* ==================== MASTER ==================== */}
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <DocNumberField docDate={form.doc_date || form.voucher_date} voucherType="cash_bank_entry" categoryId={form.numbering_category_id} docNo={editingId ? form.doc_no : ''} value={form.doc_no} onChange={v => setForm({ ...form, doc_no: v })} label="Voucher No" />
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className={efc.isVisible('entry_type') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Receipt / Payment <span className="req">*</span></label>
                            <select disabled={efc.isReadonly('entry_type')} className="erp-select" value={form.entry_type} onChange={e => setForm({ ...form, entry_type: e.target.value })}>
                                <option value="receipt">Receipt</option>
                                <option value="payment">Payment</option>
                            </select>
                        </div>
                        <div className={efc.isVisible('cash_bank_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Cash / Bank <span className="req">*</span></label>
                            <SearchablePopupSelect
                                listKey="cb_cashbank_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.cash_bank_ledger_id} onChange={id => setForm({ ...form, cash_bank_ledger_id: id })} placeholder="Select Cash/Bank"
                            />
                        </div>
                        <div className={efc.isVisible('ref_doc_no') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Document No {efc.isRequired('ref_doc_no') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('ref_doc_no')} className="erp-input" value={form.ref_doc_no || ''} onChange={e => setForm({ ...form, ref_doc_no: e.target.value })} />
                        </div>
                        <div className={efc.isVisible('ref_doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Document Date {efc.isRequired('ref_doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('ref_doc_date')} type="date" className="erp-input" value={form.ref_doc_date || ''} onChange={e => setForm({ ...form, ref_doc_date: e.target.value })} />
                        </div>
                        <div className={efc.isVisible('cost_center_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Cost Center {efc.isRequired('cost_center_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect listKey="cb_cost_center_picker" columns={[{ key: 'cost_center_code', label: 'Code' }, { key: 'cost_center_name', label: 'Name' }]} defaultVisibleKeys={['cost_center_name']}
                                items={costCenters} getId={c => c.id} getLabel={c => c.cost_center_name} searchKeys={['cost_center_name', 'cost_center_code']}
                                value={form.cost_center_id} onChange={id => setForm({ ...form, cost_center_id: id })} placeholder="Select Cost Center" />
                        </div>
                        <div className={efc.isVisible('business_unit_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Unit <span className="hint">(blank = per line)</span></label>
                            <SearchablePopupSelect listKey="cb_business_unit_picker" columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]} defaultVisibleKeys={['unit_name']}
                                items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name} searchKeys={['unit_name', 'unit_code']}
                                value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Per line" />
                        </div>
                        <div className={efc.isVisible('payment_mode') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Mode</label>
                            <select disabled={efc.isReadonly('payment_mode')} className="erp-select" value={form.payment_mode} onChange={e => setForm({ ...form, payment_mode: e.target.value })}>
                                {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                        </div>
                        <div className={efc.isVisible('ref_no') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Cheque / Txn No</label>
                            <input disabled={efc.isReadonly('ref_no')} className="erp-input" value={form.ref_no || ''} onChange={e => setForm({ ...form, ref_no: e.target.value })} />
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="cash_bank_entry" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>
                    <details className="mx-3 mt-1 text-xs">
                        <summary className="cursor-pointer text-[#1a4a8a]">Same Product Company / Area / Agent / Route for every line (optional)</summary>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 py-2">
                            <div className="erp-field">
                                <label className="erp-label">Product Company</label>
                                <SearchablePopupSelect listKey="cbe_product_company_picker" columns={[{ key: 'name', label: 'Name' }]} defaultVisibleKeys={['name']}
                                    items={productCompanies.map(c => ({ id: c.id, name: c.company_name }))} getId={x => x.id} getLabel={x => x.name} searchKeys={['name']}
                                    value={form.product_company_id} onChange={id => setForm({ ...form, product_company_id: id })} placeholder="Per line" />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Area</label>
                                <SearchablePopupSelect listKey="cb_area_picker" columns={[{ key: 'area_code', label: 'Code' }, { key: 'area_name', label: 'Name' }]} defaultVisibleKeys={['area_name']}
                                    items={areas} getId={x => x.id} getLabel={x => x.area_name} searchKeys={['area_name', 'area_code']} value={form.area_id} onChange={id => setForm({ ...form, area_id: id })} placeholder="Per line" />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Agent</label>
                                <SearchablePopupSelect listKey="cb_agent_picker" columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]} defaultVisibleKeys={['agent_name']}
                                    items={agents} getId={a => a.id} getLabel={a => a.agent_name} searchKeys={['agent_name', 'agent_code']} value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })} placeholder="Per line" />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Route</label>
                                <SearchablePopupSelect listKey="cb_route_picker" columns={[{ key: 'route_code', label: 'Code' }, { key: 'route_name', label: 'Name' }]} defaultVisibleKeys={['route_name']}
                                    items={routes} getId={x => x.id} getLabel={x => x.route_name} searchKeys={['route_name', 'route_code']} value={form.route_id} onChange={id => setForm({ ...form, route_id: id })} placeholder="Per line" />
                            </div>
                        </div>
                    </details>

                    {/* ==================== DETAILS ==================== */}
                    <div className="erp-tab-content">
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table mb-2">
                                <thead>
                                    <tr>
                                        <th className="w-6">#</th>
                                        <th className="min-w-[200px]">Ledger</th>
                                        <th className="min-w-[140px]">Sub-Ledger</th>
                                        {!dimOnMaster('product_company_id') && efc.isVisible('product_company_id', 'detail') && <th className="min-w-[130px]">Product Company</th>}
                                        {!dimOnMaster('area_id') && efc.isVisible('area_id', 'detail') && <th className="min-w-[120px]">Area</th>}
                                        {!dimOnMaster('agent_id') && efc.isVisible('agent_id', 'detail') && <th className="min-w-[120px]">Agent</th>}
                                        {!dimOnMaster('route_id') && efc.isVisible('route_id', 'detail') && <th className="min-w-[120px]">Route</th>}
                                        {!dimOnMaster('business_unit_id') && efc.isVisible('business_unit_id', 'detail') && <th className="min-w-[120px]">Unit</th>}
                                        {efc.isVisible('manual_receipt_no', 'detail') && <th className="w-28">Manual Rec No</th>}
                                        {efc.isVisible('remarks', 'detail') && <th className="min-w-[140px]">Remarks</th>}
                                        <th className="w-28 text-right">Receipt</th>
                                        <th className="w-28 text-right">Payment</th>
                                        <th className="w-14">Bills</th>
                                        <th className="w-6"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.lines.map((l, idx) => {
                                        const pick = (key, items, codeKey, nameKey, listKey) => (
                                            <td>
                                                <SearchablePopupSelect listKey={listKey} columns={[{ key: codeKey, label: 'Code' }, { key: nameKey, label: 'Name' }]} defaultVisibleKeys={[nameKey]}
                                                    items={items} getId={x => x.id} getLabel={x => x[nameKey]} searchKeys={[nameKey, codeKey]}
                                                    value={l[key]} onChange={id => updateLine(idx, { [key]: id })} placeholder="-" />
                                            </td>
                                        );
                                        return (
                                            <tr key={idx}>
                                                <td className="text-xs text-gray-500">{idx + 1}</td>
                                                <td>
                                                    <SearchablePopupSelect listKey="cb_line_ledger_picker" columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
                                                        items={ledgers.filter(x => x.id !== form.cash_bank_ledger_id)} getId={x => x.id} getLabel={x => x.account_name} searchKeys={['account_name', 'account_code']}
                                                        value={l.ledger_id} onChange={id => updateLine(idx, { ledger_id: id, sub_ledger_id: '', bill_wise_settlements: null })} placeholder="Ledger" />
                                                </td>
                                                <td>
                                                    <SearchablePopupSelect listKey="cb_line_subledger_picker" columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]} defaultVisibleKeys={['sub_ledger_name']}
                                                        items={subLedgers.filter(x => x.main_ledger_id === l.ledger_id)} getId={x => x.id} getLabel={x => x.sub_ledger_name} searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                                        value={l.sub_ledger_id} onChange={id => updateLine(idx, { sub_ledger_id: id })} placeholder="-" />
                                                </td>
                                                {!dimOnMaster('product_company_id') && efc.isVisible('product_company_id', 'detail') && pick('product_company_id', productCompanies.map(c => ({ id: c.id, company_name: c.company_name, company_code: c.company_code })), 'company_code', 'company_name', 'cb_line_pc_picker')}
                                                {!dimOnMaster('area_id') && efc.isVisible('area_id', 'detail') && pick('area_id', areas, 'area_code', 'area_name', 'cb_line_area_picker')}
                                                {!dimOnMaster('agent_id') && efc.isVisible('agent_id', 'detail') && pick('agent_id', agents, 'agent_code', 'agent_name', 'cb_line_agent_picker')}
                                                {!dimOnMaster('route_id') && efc.isVisible('route_id', 'detail') && pick('route_id', routes, 'route_code', 'route_name', 'cb_line_route_picker')}
                                                {!dimOnMaster('business_unit_id') && efc.isVisible('business_unit_id', 'detail') && pick('business_unit_id', businessUnits, 'unit_code', 'unit_name', 'cb_line_unit_picker')}
                                                {efc.isVisible('manual_receipt_no', 'detail') && <td><input className="erp-input" disabled={efc.isReadonly('manual_receipt_no', 'detail')} value={l.manual_receipt_no || ''} onChange={e => updateLine(idx, { manual_receipt_no: e.target.value })} /></td>}
                                                {efc.isVisible('remarks', 'detail') && (
                                                    <td><input list="cb-remarks-suggestions" className="erp-input" disabled={efc.isReadonly('remarks', 'detail')} value={l.remarks || ''} onChange={e => updateLine(idx, { remarks: e.target.value })} /></td>
                                                )}
                                                <td><input type="number" step="0.01" min="0" className="erp-input text-right" value={l.receipt_amount} onChange={e => updateLine(idx, { receipt_amount: e.target.value, ...(e.target.value ? { payment_amount: '' } : {}) })} /></td>
                                                <td><input type="number" step="0.01" min="0" className="erp-input text-right" value={l.payment_amount} onChange={e => updateLine(idx, { payment_amount: e.target.value, ...(e.target.value ? { receipt_amount: '' } : {}) })} /></td>
                                                <td>
                                                    <button type="button" tabIndex={-1} disabled={!l.ledger_id || !(num(l.receipt_amount) || num(l.payment_amount))} onClick={() => setBillLine(idx)}
                                                        className="text-xs text-blue-600 underline disabled:text-gray-300" title="Settle against bills">{l.bill_wise_settlements?.length ? `${l.bill_wise_settlements.length} bill(s)` : 'Bills'}</button>
                                                </td>
                                                <td><button type="button" tabIndex={-1} onClick={() => removeLine(idx)} className="text-red-500 text-xs">✕</button></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 justify-end text-sm font-semibold border-t pt-2">
                            <button type="button" onClick={addLine} className="mr-auto text-xs text-blue-600">➕ Add Line</button>
                            <span>Receipts: {totalReceipt.toFixed(2)}</span>
                            <span>Payments: {totalPayment.toFixed(2)}</span>
                            <span className={net === 0 ? 'text-red-600' : ''}>Cash / Bank {net >= 0 ? 'Dr' : 'Cr'} {Math.abs(net).toFixed(2)} ({net >= 0 ? 'Receipt' : 'Payment'})</span>
                        </div>
                        <datalist id="cb-remarks-suggestions">
                            {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                        </datalist>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="cb-remarks-suggestions" className="erp-input" value={form.remarks_text || ''} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration || ''} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>
                        {form.entry_type && net !== 0 && (net > 0) !== (form.entry_type === 'receipt') && (
                            <p className="text-xs text-amber-700 mt-2">The lines add up to a net {net > 0 ? 'receipt' : 'payment'} - the voucher is saved as a {net > 0 ? 'Receipt' : 'Payment'}.</p>
                        )}
                    </div>

                    {billLine !== null && form.lines[billLine] && (
                        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setBillLine(null)}>
                            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-auto p-4" onClick={e => e.stopPropagation()}>
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="font-semibold">Bill-wise settlement - line {billLine + 1}</h3>
                                    <button type="button" onClick={() => setBillLine(null)}>✕</button>
                                </div>
                                <BillWiseSettlementPanel
                                    productCompanyId={form.product_company_id || form.lines[billLine].product_company_id}
                                    ledgerId={form.lines[billLine].ledger_id}
                                    outstandingNature={num(form.lines[billLine].receipt_amount) > 0 ? 'dr' : 'cr'}
                                    amount={num(form.lines[billLine].receipt_amount) || num(form.lines[billLine].payment_amount)}
                                    onSettlementsChange={v => updateLine(billLine, { bill_wise_settlements: v })}
                                />
                                <div className="text-right mt-3"><button type="button" className="erp-btn primary" onClick={() => setBillLine(null)}>Done</button></div>
                            </div>
                        </div>
                    )}

                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>
                            <button type="button" onClick={e => handleSubmit(e, true)} className="erp-btn">💾 Save as Draft</button>
                            <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Save'}</button>
                        </div>
                    </div>
                </form>
            )}

            {mode === 'bulk' && (
                <form onSubmit={handleBulkSubmit} ref={formRef}>
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className="erp-field">
                            <label className="erp-label">Date <span className="req">*</span></label>
                            <input type="date" className="erp-input" value={bulkForm.batch_date} onChange={e => setBulkForm({ ...bulkForm, batch_date: e.target.value })} required />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Receipt / Payment <span className="req">*</span></label>
                            <select className="erp-select" value={bulkForm.entry_type} onChange={e => setBulkForm({ ...bulkForm, entry_type: e.target.value })}>
                                <option value="receipt">Bulk Receipt</option>
                                <option value="payment">Bulk Payment</option>
                            </select>
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Cash/Bank Ledger <span className="req">*</span></label>
                            <SearchablePopupSelect
                                listKey="bulk_cashbank_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={bulkForm.cash_bank_ledger_id} onChange={id => setBulkForm({ ...bulkForm, cash_bank_ledger_id: id })} placeholder="Select Cash/Bank"
                            />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Narration</label>
                            <input className="erp-input" value={bulkForm.narration} onChange={e => setBulkForm({ ...bulkForm, narration: e.target.value })} />
                        </div>
                    </div>
                    <div className="erp-tab-content">
                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                            Every line below posts immediately as its own {bulkForm.entry_type} - bulk entry is for same-day collection/disbursement across many parties, not for parking as drafts.
                        </p>
                        <table className="erp-grid-table mb-2">
                            <thead>
                                <tr><th>Party</th><th>Amount</th><th>Payment Mode</th><th>Narration</th><th></th></tr>
                            </thead>
                            <tbody>
                                {bulkForm.lines.map((l, idx) => (
                                    <tr key={idx}>
                                        <td>
                                            <SearchablePopupSelect
                                                listKey="bulk_party_picker"
                                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                                defaultVisibleKeys={['account_name']}
                                                items={ledgers} getId={x => x.id} getLabel={x => x.account_name}
                                                searchKeys={['account_name', 'account_code']}
                                                value={l.party_ledger_id} onChange={id => updateBulkLine(idx, { party_ledger_id: id })} placeholder="Party"
                                            />
                                        </td>
                                        <td><input type="number" step="0.01" className="erp-input" value={l.amount} onChange={e => updateBulkLine(idx, { amount: e.target.value })} /></td>
                                        <td>
                                            <select className="erp-select" value={l.payment_mode} onChange={e => updateBulkLine(idx, { payment_mode: e.target.value })}>
                                                {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                            </select>
                                        </td>
                                        <td><input className="erp-input" value={l.narration} onChange={e => updateBulkLine(idx, { narration: e.target.value })} /></td>
                                        <td><button type="button" tabIndex={-1} onClick={() => removeBulkLine(idx)} className="text-red-500 text-xs">✕</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex justify-between items-center mb-4">
                            <button type="button" onClick={addBulkLine} className="text-xs text-blue-600">➕ Add Line</button>
                            <span className="text-sm font-semibold">Total: {bulkTotal.toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={resetBulkForm} className="erp-btn">Reset</button>
                            <button type="submit" className="erp-btn primary">Post All ({bulkForm.lines.filter(l => l.party_ledger_id && Number(l.amount) > 0).length})</button>
                        </div>
                    </div>
                </form>
            )}
        </div>

        <div className="max-w-6xl mx-auto px-4 mt-4">
            {mode === 'single' ? (
                <ReportGrid
                    columns={columns}
                    rows={rows}
                    getId={r => r.id}
                    storageKey="cash_bank_entry_grid"
                    rowActions={(row) => (
                        <div className="flex gap-2 justify-center">
                            {row.status === 'draft' && <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>}
                            <DocActions type="cash_bank_entry" api="cash-bank-entries" row={row} onOpen={handleEdit} onCopy={copyAsNew} onReverse={r => handleStatusChange(r, 'cancelled')} onDone={load} />
                            {row.status === 'posted' && <a href={`/print/cash_bank_entry/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                            <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                            <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="cash_bank_entry" docId={row.id} onClose={() => setUdfDoc(null)} />}
                            {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        </div>
                    )}
                />
            ) : (
                <ReportGrid columns={bulkColumns} rows={bulkBatches} getId={r => r.id} storageKey="bulk_cash_bank_grid"
                auditTable="bulk_cash_bank_batches" />
            )}
        </div>

        {auditModal && <RecordHistory table="cash_bank_entries" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/cash-bank-entries/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
