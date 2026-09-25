// =============================================
// JournalVoucher.jsx
// Direct multi-line Debit/Credit entries - every line is either a Dr or
// a Cr, and the whole voucher must balance before it can post.
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
import { amountToWords } from '../utils/numberToWords';

const emptyDetailRow = () => ({ ledger_id: '', sub_ledger_id: '', product_company_id: '', agent_id: '', debit_amount: '', credit_amount: '', tds_percent: '', narration: '' });

const emptyForm = {
    doc_date: new Date().toISOString().slice(0, 10),
    numbering_category_id: '',
    ref_doc_no: '', ref_doc_date: '',
    cost_center_id: '', business_unit_id: '', remarks_text: '', narration: '',
    is_memo: false,
    details: [emptyDetailRow(), emptyDetailRow()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['business_unit_id', 'cost_center_id', 'doc_date', 'narration', 'ref_doc_date', 'ref_doc_no'];

export default function JournalVoucher() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('journal', EFC_RENDERED_KEYS);
    // Product Company list for the accounting dimension picker.
    const [productCompanies, setProductCompanies] = useState([]);
    useEffect(() => { authFetch('/api/product-companies').then(r => setProductCompanies(r.data || [])).catch(() => {}); }, [authFetch]);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [auditModal, setAuditModal] = useState(null);

    const [ledgers, setLedgers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [agents, setAgents] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [remarks, setRemarks] = useState([]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addDetailRow(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, ldg, sl, ag, cc, bu, rmk] = await Promise.all([
                authFetch('/api/journal-vouchers'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/remarks')
            ]);
            setRows(req.data || []);
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

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => setForm(f => ({ ...f, details: f.details.length > 2 ? f.details.filter((_, i) => i !== idx) : f.details }));
    const updateDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));

    const autoCalcTdsFromRate = (idx, ratePercent) => {
        setForm(f => {
            const baseAmount = f.details.reduce((s, d, i) => i === idx ? s : s + (Number(d.debit_amount) || 0), 0);
            const computed = ratePercent === '' ? '' : Math.round(baseAmount * (Number(ratePercent) / 100) * 100) / 100;
            return { ...f, details: f.details.map((d, i) => i === idx ? { ...d, tds_percent: ratePercent, credit_amount: computed, debit_amount: '' } : d) };
        });
    };

    const totalDebit = form.details.reduce((s, d) => s + (Number(d.debit_amount) || 0), 0);
    const totalCredit = form.details.reduce((s, d) => s + (Number(d.credit_amount) || 0), 0);
    const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
    const isBalanced = Math.abs(difference) < 0.01 && totalDebit > 0;

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        const validDetails = form.details.filter(d => d.ledger_id && (Number(d.debit_amount) > 0 || Number(d.credit_amount) > 0));
        if (!saveAsDraft) {
            if (validDetails.length < 2) return showAlert('At least two complete lines are required', 'danger');
            if (!isBalanced) return showAlert(`Voucher does not balance - Debit ${totalDebit.toFixed(2)} vs Credit ${totalCredit.toFixed(2)}`, 'danger');
        }
        try {
            const payload = { ...form, details: validDetails, ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}) };
            if (editingId) {
                await authFetch(`/api/journal-vouchers/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : 'Journal Voucher updated', 'success');
            } else {
                const res = await authFetch('/api/journal-vouchers', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Journal Voucher ${res.data.doc_no} created`, 'success');
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
            const res = await authFetch(`/api/journal-vouchers/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...res.data,
                doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date,
                ref_doc_date: res.data.ref_doc_date?.slice(0, 10) || '',
                details: (res.data.details || []).length > 0 ? res.data.details : [emptyDetailRow(), emptyDetailRow()]
            });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleCopyFrom = async (sourceId) => {
        try {
            const res = await authFetch(`/api/journal-vouchers/${sourceId}`);
            const src = res.data;
            setEditingId(null);
            setForm({
                ...emptyForm, ...src,
                doc_no: '', doc_date: new Date().toISOString().slice(0, 10), status: 'draft',
                details: (src.details || []).length > 0 ? src.details.map(d => ({ ...emptyDetailRow(), ...d })) : [emptyDetailRow(), emptyDetailRow()]
            });
            setShowForm(true);
            setShowCopyModal(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showAlert(`Copied from ${src.doc_no} - review and save as a new voucher`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt('Reason for cancelling this Journal Voucher?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            await authFetch(`/api/journal-vouchers/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            showAlert(`Marked as ${status}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleToggleAuditLock = async (row) => {
        const locking = !row.audit_locked;
        if (!window.confirm(locking ? 'Audit-lock this voucher? No one will be able to edit it while locked.' : 'Remove the audit lock?')) return;
        try {
            await authFetch(`/api/journal-vouchers/${row.id}/audit-lock`, { method: 'PUT', body: JSON.stringify({ locked: locking }) });
            showAlert(locking ? 'Voucher audit-locked' : 'Audit lock removed', 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/journal-vouchers/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const openAuditTrail = async (row) => {
        try {
            const res = await authFetch(`/api/journal-vouchers/${row.id}/audit-trail`);
            setAuditModal({ doc_no: row.doc_no, entries: res.data || [] });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'total_debit', label: 'Total Debit', type: 'number' },
        { key: 'total_credit', label: 'Total Credit', type: 'number' },
        { key: 'is_memo', label: 'Memo', type: 'text', render: r => r.is_memo ? 'Yes' : '—' },
        { key: 'audit_locked', label: 'Locked', type: 'text', render: r => r.audit_locked ? '🔒' : '—' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📗 Journal Voucher</span>
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
                        <div className={efc.isVisible('ref_doc_no') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Ref Doc No {efc.isRequired('ref_doc_no') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('ref_doc_no')} className="erp-input" value={form.ref_doc_no} onChange={e => setForm({ ...form, ref_doc_no: e.target.value })} />
                        </div>
                        <div className={efc.isVisible('ref_doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Ref Doc Date {efc.isRequired('ref_doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('ref_doc_date')} type="date" className="erp-input" value={form.ref_doc_date} onChange={e => setForm({ ...form, ref_doc_date: e.target.value })} />
                        </div>
                        <div className="erp-field justify-end">
                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.is_memo} onChange={e => setForm({ ...form, is_memo: e.target.checked })} />
                                Memo Only <span className="hint">(never posts to ledger)</span>
                            </label>
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="journal" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('cost_center_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Cost Center {efc.isRequired('cost_center_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="jv_cost_center_picker"
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
                                    listKey="jv_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="jv-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="jv-remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Voucher Lines</h2>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table mb-2 min-w-[1000px]">
                                <thead>
                                    <tr>
                                        <th className="w-52">Ledger</th>
                                        <th className={`w-40 ${efc.isVisible('sub_ledger_id', 'detail') ? '' : 'hidden'}`}>Sub Ledger</th>
                                        <th className="w-40">Agent</th>
                                        <th className="w-40">Product Company</th>
                                        <th className={`w-28 ${efc.isVisible('debit_amount', 'detail') ? '' : 'hidden'}`}>Debit</th>
                                        <th className={`w-24 ${efc.isVisible('tds_percent', 'detail') ? '' : 'hidden'}`}>TDS %</th>
                                        <th className={`w-28 ${efc.isVisible('credit_amount', 'detail') ? '' : 'hidden'}`}>Credit</th>
                                        <th className={`w-40 ${efc.isVisible('narration', 'detail') ? '' : 'hidden'}`}>Narration</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.details.map((d, idx) => (
                                        <tr key={idx}>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="jv_ledger_picker"
                                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['account_name']}
                                                    items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                                    searchKeys={['account_name', 'account_code']}
                                                    value={d.ledger_id} onChange={id => updateDetailRow(idx, { ledger_id: id, sub_ledger_id: '' })} placeholder="Ledger"
                                                />
                                            </td>
                                            <td className={efc.isVisible('sub_ledger_id', 'detail') ? '' : 'hidden'}>
                                                <SearchablePopupSelect
                                                    listKey="jv_subledger_picker"
                                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['sub_ledger_name']}
                                                    items={subLedgers.filter(x => x.main_ledger_id === d.ledger_id)} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                                    value={d.sub_ledger_id} onChange={id => updateDetailRow(idx, { sub_ledger_id: id })} placeholder="Sub Ledger"
                                                />
                                            </td>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="jv_agent_picker"
                                                    columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['agent_name']}
                                                    items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                                    searchKeys={['agent_name', 'agent_code']}
                                                    value={d.agent_id} onChange={id => updateDetailRow(idx, { agent_id: id })} placeholder="Agent"
                                                />
                                            </td>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="jv_product_company_picker"
                                                    columns={[{ key: 'name', label: 'Name' }]} defaultVisibleKeys={['name']}
                                                    items={productCompanies.map(c => ({ id: c.id, name: c.company_name }))} getId={x => x.id} getLabel={x => x.name} searchKeys={['name']}
                                                    value={d.product_company_id} onChange={id => updateDetailRow(idx, { product_company_id: id })} placeholder="Product Company"
                                                />
                                            </td>
                                            <td className={efc.isVisible('debit_amount', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('debit_amount', 'detail')} type="number" step="0.01" className="erp-input" value={d.debit_amount} onChange={e => updateDetailRow(idx, { debit_amount: e.target.value, credit_amount: '' })} /></td>
                                            <td className={efc.isVisible('tds_percent', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('tds_percent', 'detail')} type="number" step="0.001" className="erp-input" value={d.tds_percent} onChange={e => autoCalcTdsFromRate(idx, e.target.value)} placeholder="e.g. 1.5" /></td>
                                            <td className={efc.isVisible('credit_amount', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('credit_amount', 'detail')} type="number" step="0.01" className="erp-input" value={d.credit_amount} onChange={e => updateDetailRow(idx, { credit_amount: e.target.value, debit_amount: '', tds_percent: '' })} /></td>
                                            <td className={efc.isVisible('narration', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('narration', 'detail')} className="erp-input" value={d.narration} onChange={e => updateDetailRow(idx, { narration: e.target.value })} /></td>
                                            <td><button type="button" tabIndex={-1} onClick={() => removeDetailRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                            <button type="button" onClick={addDetailRow} className="text-xs text-blue-600">➕ Add Line</button>
                            <div className="text-sm text-right">
                                <div>Total Debit: <b>{totalDebit.toFixed(2)}</b> &nbsp; Total Credit: <b>{totalCredit.toFixed(2)}</b></div>
                                <div className={isBalanced ? 'text-green-600' : 'text-red-600'}>
                                    {isBalanced ? '✓ Balanced' : `Difference: ${difference.toFixed(2)}`}
                                </div>
                            </div>
                        </div>
                        {isBalanced && (
                            <p className="text-xs text-gray-500 text-right mb-4 italic">{amountToWords(totalDebit, 'Nrs')}</p>
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
                storageKey="journal_voucher_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        {row.status === 'posted' && <a href={`/print/journal_voucher/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        {row.status === 'draft' && !row.is_memo && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {!row.audit_locked && row.status !== 'cancelled' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {row.status === 'draft' && !row.audit_locked && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
                        <button onClick={() => handleToggleAuditLock(row)} className="px-2 py-1 bg-gray-700 text-white rounded text-xs">{row.audit_locked ? '🔓 Unlock' : '🔒 Lock'}</button>
                    </div>
                )}
            />
        </div>

        {showCopyModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">Copy From — Journal Voucher</span></div>
                    <div className="p-4">
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {rows.map(r => (
                                <button key={r.id} type="button" onClick={() => handleCopyFrom(r.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{r.doc_no}</span>
                                    <span className="text-xs text-gray-400">{r.doc_date} · {r.total_debit?.toFixed(2)}</span>
                                </button>
                            ))}
                            {rows.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No vouchers yet to copy from.</p>}
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
