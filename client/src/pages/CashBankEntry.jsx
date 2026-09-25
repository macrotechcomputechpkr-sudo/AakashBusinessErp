// =============================================
// CashBankEntry.jsx
// Single receipt/payment against one party, or a Bulk batch fanning
// out to many parties at once (immediately posted).
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

const PAYMENT_MODES = [
    { value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'cheque', label: 'Cheque' }, { value: 'online', label: 'Online' },
    { value: 'card', label: 'Card' }, { value: 'other', label: 'Other' }
];

const emptyForm = {
    doc_date: new Date().toISOString().slice(0, 10),
    numbering_category_id: '',
    entry_type: 'receipt', cash_bank_ledger_id: '', party_ledger_id: '', party_sub_ledger_id: '', agent_id: '',
    amount: '', payment_mode: 'cash', ref_no: '', ref_doc_no: '', ref_doc_date: '',
    remarks_text: '', narration: '', cost_center_id: '', business_unit_id: ''
};
const emptyBulkLine = () => ({ party_ledger_id: '', amount: '', payment_mode: 'cash', narration: '' });

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['amount', 'cash_bank_ledger_id', 'doc_date', 'entry_type', 'narration', 'party_ledger_id', 'payment_mode', 'ref_no'];

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
    const [billWiseSettlements, setBillWiseSettlements] = useState(null);
    const [auditModal, setAuditModal] = useState(null);

    const [bulkForm, setBulkForm] = useState({ batch_date: new Date().toISOString().slice(0, 10), entry_type: 'receipt', cash_bank_ledger_id: '', narration: '', lines: [emptyBulkLine()] });

    const [ledgers, setLedgers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [agents, setAgents] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [remarks, setRemarks] = useState([]);

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

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setBillWiseSettlements(null); };
    const resetBulkForm = () => setBulkForm({ batch_date: new Date().toISOString().slice(0, 10), entry_type: 'receipt', cash_bank_ledger_id: '', narration: '', lines: [emptyBulkLine()] });
    const addBulkLine = () => setBulkForm(f => ({ ...f, lines: [...f.lines, emptyBulkLine()] }));
    const removeBulkLine = (idx) => setBulkForm(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== idx) : f.lines }));
    const updateBulkLine = (idx, patch) => setBulkForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
    const bulkTotal = bulkForm.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        if (!form.cash_bank_ledger_id) return showAlert('Cash/Bank Ledger is required', 'danger');
        if (!form.party_ledger_id) return showAlert('Party is required', 'danger');
        if (!form.amount || Number(form.amount) <= 0) return showAlert('Amount greater than zero is required', 'danger');
        try {
            const payload = { ...form, ...(billWiseSettlements ? { bill_wise_settlements: billWiseSettlements } : {}), ...(saveAsDraft ? { status: 'draft' } : {}) };
            if (editingId) {
                await authFetch(`/api/cash-bank-entries/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('Entry updated', 'success');
            } else {
                const res = await authFetch('/api/cash-bank-entries', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(`${form.entry_type === 'receipt' ? 'Receipt' : 'Payment'} ${res.data.doc_no} created`, 'success');
            }
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

    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/cash-bank-entries/${row.id}`);
            setEditingId(row.id);
            setForm({ ...emptyForm, ...res.data, doc_date: res.data.doc_date?.slice(0, 10), ref_doc_date: res.data.ref_doc_date?.slice(0, 10) || '' });
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

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/cash-bank-entries/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
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
        { key: 'party_name_snapshot', label: 'Party', type: 'text', render: r => r.party_name_snapshot || '—' },
        { key: 'cash_bank_name_snapshot', label: 'Cash/Bank', type: 'text', render: r => r.cash_bank_name_snapshot || '—' },
        { key: 'amount', label: 'Amount', type: 'number' },
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
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>} {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className={efc.isVisible('entry_type') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Receipt / Payment <span className="req">*</span> {efc.isRequired('entry_type') && <span className="req">*</span>}</label>
                            <select disabled={efc.isReadonly('entry_type')} className="erp-select" value={form.entry_type} onChange={e => setForm({ ...form, entry_type: e.target.value })}>
                                <option value="receipt">Receipt (from Party)</option>
                                <option value="payment">Payment (to Party)</option>
                            </select>
                        </div>
                        <div className={efc.isVisible('cash_bank_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Cash/Bank Ledger <span className="req">*</span> {efc.isRequired('cash_bank_ledger_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="cb_cashbank_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.cash_bank_ledger_id} onChange={id => setForm({ ...form, cash_bank_ledger_id: id })} placeholder="Select Cash/Bank"
                            />
                        </div>
                        <div className={efc.isVisible('party_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Party <span className="req">*</span> {efc.isRequired('party_ledger_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="cb_party_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.party_ledger_id} onChange={id => setForm({ ...form, party_ledger_id: id })} placeholder="Select Party"
                            />
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="cash_bank_entry" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('amount') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Amount <span className="req">*</span> {efc.isRequired('amount') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('amount')} type="number" step="0.01" className="erp-input" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
                            </div>
                            <div className={efc.isVisible('payment_mode') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Payment Mode {efc.isRequired('payment_mode') && <span className="req">*</span>}</label>
                                <select disabled={efc.isReadonly('payment_mode')} className="erp-select" value={form.payment_mode} onChange={e => setForm({ ...form, payment_mode: e.target.value })}>
                                    {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                            </div>
                            <div className={efc.isVisible('ref_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Ref No {efc.isRequired('ref_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('ref_no')} className="erp-input" value={form.ref_no} onChange={e => setForm({ ...form, ref_no: e.target.value })} placeholder="Cheque/Transaction No" />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Party Sub Ledger</label>
                                <SearchablePopupSelect
                                    listKey="cb_subledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers.filter(x => x.main_ledger_id === form.party_ledger_id)} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.party_sub_ledger_id} onChange={id => setForm({ ...form, party_sub_ledger_id: id })} placeholder="Select Sub Ledger"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Product Company</label>
                                <SearchablePopupSelect listKey="cbe_product_company_picker" columns={[{ key: 'name', label: 'Name' }]} defaultVisibleKeys={['name']}
                                    items={productCompanies.map(c => ({ id: c.id, name: c.company_name }))} getId={x => x.id} getLabel={x => x.name} searchKeys={['name']}
                                    value={form.product_company_id} onChange={id => setForm({ ...form, product_company_id: id })} placeholder="None" />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Agent</label>
                                <SearchablePopupSelect
                                    listKey="cb_agent_picker"
                                    columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                    defaultVisibleKeys={['agent_name']}
                                    items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                    searchKeys={['agent_name', 'agent_code']}
                                    value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })} placeholder="Select Agent"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Ref Doc No</label>
                                <input className="erp-input" value={form.ref_doc_no} onChange={e => setForm({ ...form, ref_doc_no: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Ref Doc Date</label>
                                <input type="date" className="erp-input" value={form.ref_doc_date} onChange={e => setForm({ ...form, ref_doc_date: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Cost Center</label>
                                <SearchablePopupSelect
                                    listKey="cb_cost_center_picker"
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
                                    listKey="cb_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="cb-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="cb-remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field md:col-span-2' : 'erp-field md:col-span-2 hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <BillWiseSettlementPanel
                            productCompanyId={form.product_company_id}
                            ledgerId={form.party_ledger_id}
                            outstandingNature={form.entry_type === 'receipt' ? 'dr' : 'cr'}
                            amount={form.amount}
                            onSettlementsChange={setBillWiseSettlements}
                        />
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
                            {row.status === 'posted' && <a href={`/print/cash_bank_entry/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                            <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                            <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="cash_bank_entry" docId={row.id} onClose={() => setUdfDoc(null)} />}
                            {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                            {row.status !== 'cancelled' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                            {row.status === 'draft' && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
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
