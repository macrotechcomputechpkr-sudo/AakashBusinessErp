// =============================================
// components/PartyLedgerNoteForm.jsx
// Shared engine for Debit Note and Credit Note - structurally identical
// (a party + reference bill + straight ledger lines, no products), so
// one configurable component serves both rather than duplicating
// near-identical logic across two files.
// =============================================

import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from './SearchablePopupSelect';
import ReportGrid from './ReportGrid';
import Layout from './Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';
import { amountToWords } from '../utils/numberToWords';
import BillWiseSettlementPanel from './BillWiseSettlementPanel';
import NumberingCategorySelector from './NumberingCategorySelector';
import UdfValuesModal from './UdfValuesModal';
import RecordHistory from './RecordHistory';

const emptyDetailRow = () => ({ ledger_id: '', sub_ledger_id: '', product_company_id: '', amount: '', narration: '' });

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['agent_id', 'doc_date', 'narration', 'party_ledger_id', 'reason', 'ref_doc_date', 'ref_doc_no'];

export default function PartyLedgerNoteForm({ title, icon, apiBase, voucherType, partyLabel, reasonOptions, outstandingNature }) {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls(voucherType, EFC_RENDERED_KEYS);
    // Product Company list for the accounting dimension picker.
    const [productCompanies, setProductCompanies] = useState([]);
    useEffect(() => { authFetch('/api/product-companies').then(r => setProductCompanies(r.data || [])).catch(() => {}); }, [authFetch]);
    const emptyForm = {
        doc_date: new Date().toISOString().slice(0, 10), numbering_category_id: '',
        party_ledger_id: '', party_sub_ledger_id: '', agent_id: '',
        ref_doc_no: '', ref_doc_date: '', reason: reasonOptions[0]?.value || 'other',
        remarks_text: '', narration: '', cost_center_id: '', business_unit_id: '', priority: 'normal',
        details: [emptyDetailRow()]
    };

    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [showCopyModal, setShowCopyModal] = useState(false);
    const [auditModal, setAuditModal] = useState(null);
    const [billWiseSettlements, setBillWiseSettlements] = useState(null);

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
                authFetch(`/api/${apiBase}`),
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authFetch, apiBase]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setBillWiseSettlements(null); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => setForm(f => ({ ...f, details: f.details.length > 1 ? f.details.filter((_, i) => i !== idx) : f.details }));
    const updateDetailRow = (idx, patch) => setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) }));

    const totalAmount = form.details.reduce((s, d) => s + (Number(d.amount) || 0), 0);

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        if (!saveAsDraft && !form.party_ledger_id) return showAlert(`${partyLabel} is required`, 'danger');
        const validDetails = form.details.filter(d => d.ledger_id && Number(d.amount) > 0);
        if (!saveAsDraft && validDetails.length === 0) return showAlert('At least one complete line is required', 'danger');
        try {
            const payload = {
                ...form, details: validDetails,
                ...(billWiseSettlements ? { bill_wise_settlements: billWiseSettlements } : {}),
                ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {})
            };
            if (editingId) {
                await authFetch(`/api/${apiBase}/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : `${title} updated`, 'success');
            } else {
                const res = await authFetch(`/api/${apiBase}`, { method: 'POST', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `${title} ${res.data.doc_no} created`, 'success');
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
            const res = await authFetch(`/api/${apiBase}/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...res.data,
                doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date,
                ref_doc_date: res.data.ref_doc_date?.slice(0, 10) || '',
                details: (res.data.details || []).length > 0 ? res.data.details : [emptyDetailRow()]
            });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleCopyFrom = async (sourceId) => {
        try {
            const res = await authFetch(`/api/${apiBase}/${sourceId}`);
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
            showAlert(`Copied from ${src.doc_no} - review and save as a new ${title}`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt(`Reason for cancelling this ${title}?`);
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            await authFetch(`/api/${apiBase}/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            showAlert(`Marked as ${status}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/${apiBase}/${row.id}`, { method: 'DELETE' });
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
        { key: 'party_name_snapshot', label: partyLabel, type: 'text', render: r => r.party_name_snapshot || '—' },
        { key: 'reason', label: 'Reason', type: 'text' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">{icon} {title}</span>
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
                        <div className={efc.isVisible('party_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">{partyLabel} <span className="req">*</span> {efc.isRequired('party_ledger_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="note_party_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.party_ledger_id} onChange={id => setForm({ ...form, party_ledger_id: id })} placeholder={`Select ${partyLabel}`}
                            />
                        </div>
                        <div className={efc.isVisible('ref_doc_no') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Ref Bill No {efc.isRequired('ref_doc_no') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('ref_doc_no')} className="erp-input" value={form.ref_doc_no} onChange={e => setForm({ ...form, ref_doc_no: e.target.value })} />
                        </div>
                        <div className={efc.isVisible('reason') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Reason <span className="req">*</span> {efc.isRequired('reason') && <span className="req">*</span>}</label>
                            <select disabled={efc.isReadonly('reason')} className="erp-select" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
                                {reasonOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                        </div>
                        {!editingId && voucherType && (
                            <NumberingCategorySelector voucherType={voucherType} value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('ref_doc_date') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Ref Bill Date {efc.isRequired('ref_doc_date') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('ref_doc_date')} type="date" className="erp-input" value={form.ref_doc_date} onChange={e => setForm({ ...form, ref_doc_date: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Party Sub Ledger</label>
                                <SearchablePopupSelect
                                    listKey="note_party_subledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers.filter(x => x.main_ledger_id === form.party_ledger_id)} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.party_sub_ledger_id} onChange={id => setForm({ ...form, party_sub_ledger_id: id })} placeholder="Select Sub Ledger"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Priority</label>
                                <select className="erp-select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                                    <option value="low">Low</option>
                                    <option value="normal">Normal</option>
                                    <option value="urgent">Urgent</option>
                                </select>
                            </div>
                            <div className={efc.isVisible('agent_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Agent {efc.isRequired('agent_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="note_agent_picker"
                                    columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                    defaultVisibleKeys={['agent_name']}
                                    items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                    searchKeys={['agent_name', 'agent_code']}
                                    value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })} placeholder="Select Agent"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Cost Center</label>
                                <SearchablePopupSelect
                                    listKey="note_cost_center_picker"
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
                                    listKey="note_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="note-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="note-remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field md:col-span-2' : 'erp-field md:col-span-2 hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Ledger Lines</h2>
                        <table className="erp-grid-table mb-2">
                            <thead>
                                <tr><th>Ledger</th><th>Sub-Ledger</th><th>Product Company</th><th className={efc.isVisible('amount', 'detail') ? '' : 'hidden'}>Amount</th><th className={efc.isVisible('narration', 'detail') ? '' : 'hidden'}>Narration</th><th></th></tr>
                            </thead>
                            <tbody>
                                {form.details.map((d, idx) => (
                                    <tr key={idx}>
                                        <td>
                                            <SearchablePopupSelect
                                                listKey="note_line_ledger_picker"
                                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                                defaultVisibleKeys={['account_name']}
                                                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                                searchKeys={['account_name', 'account_code']}
                                                value={d.ledger_id} onChange={id => updateDetailRow(idx, { ledger_id: id, sub_ledger_id: '' })} placeholder="Ledger"
                                            />
                                        </td>
                                        <td>
                                            <SearchablePopupSelect
                                                listKey="note_line_subledger_picker"
                                                columns={[{ key: 'name', label: 'Name' }]} defaultVisibleKeys={['name']}
                                                items={subLedgers.filter(x => x.main_ledger_id === d.ledger_id).map(x => ({ id: x.id, name: x.sub_ledger_name }))} getId={x => x.id} getLabel={x => x.name} searchKeys={['name']}
                                                value={d.sub_ledger_id} onChange={id => updateDetailRow(idx, { sub_ledger_id: id })} placeholder="None"
                                            />
                                        </td>
                                        <td>
                                            <SearchablePopupSelect
                                                listKey="note_line_product_company_picker"
                                                columns={[{ key: 'name', label: 'Name' }]} defaultVisibleKeys={['name']}
                                                items={productCompanies.map(c => ({ id: c.id, name: c.company_name }))} getId={x => x.id} getLabel={x => x.name} searchKeys={['name']}
                                                value={d.product_company_id} onChange={id => updateDetailRow(idx, { product_company_id: id })} placeholder="None"
                                            />
                                        </td>
                                        <td className={efc.isVisible('amount', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('amount', 'detail')} type="number" step="0.01" className="erp-input" value={d.amount} onChange={e => updateDetailRow(idx, { amount: e.target.value })} /></td>
                                        <td className={efc.isVisible('narration', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('narration', 'detail')} className="erp-input" value={d.narration} onChange={e => updateDetailRow(idx, { narration: e.target.value })} /></td>
                                        <td><button type="button" tabIndex={-1} onClick={() => removeDetailRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex justify-between items-center mb-1">
                            <button type="button" onClick={addDetailRow} className="text-xs text-blue-600">➕ Add Line</button>
                            <span className="text-sm font-semibold">Total: {totalAmount.toFixed(2)}</span>
                        </div>
                        {totalAmount > 0 && <p className="text-xs text-gray-500 text-right mb-2 italic">{amountToWords(totalAmount, 'Nrs')}</p>}

                        <BillWiseSettlementPanel
                            productCompanyId={(() => { const ids = [...new Set((form.details || []).map(d => d.product_company_id || ''))]; return ids.length === 1 ? ids[0] : ''; })()}
                            ledgerId={form.party_ledger_id}
                            outstandingNature={outstandingNature}
                            amount={totalAmount}
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
                storageKey={`${apiBase}_grid`}
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        {row.status === 'posted' && <a href={`/print/${voucherType}/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType={voucherType} docId={row.id} onClose={() => setUdfDoc(null)} />}
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
                    <div className="erp-header"><span className="erp-header-title">Copy From — {title}</span></div>
                    <div className="p-4">
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {rows.map(r => (
                                <button key={r.id} type="button" onClick={() => handleCopyFrom(r.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{r.doc_no}</span>
                                    <span className="text-xs text-gray-400">{r.doc_date} · {r.total_amount?.toFixed(2)}</span>
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

        {auditModal && <RecordHistory table={apiBase.replace(/-/g, '_')} id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/${apiBase}/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
