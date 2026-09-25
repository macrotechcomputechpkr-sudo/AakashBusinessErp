// =============================================
// SalesAdditionalEntry.jsx
// Extra charges billed to the customer beyond the product bill itself
// (delivery, packing, handling) - line-based, each line can Add to or
// Deduct from what the customer owes.
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
import BillWiseSettlementPanel from '../components/BillWiseSettlementPanel';
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import UdfValuesModal from '../components/UdfValuesModal';

const emptyLine = () => ({ income_ledger_id: '', description: '', entry_sign: 'add', amount: '' });

const emptyForm = {
    product_company_id: '', doc_date: new Date().toISOString().slice(0, 10), numbering_category_id: '',
    customer_ledger_id: '', customer_sub_ledger_id: '', agent_id: '',
    remarks_text: '', cost_center_id: '', business_unit_id: '', narration: '',
    lines: [emptyLine()]
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['agent_id', 'customer_ledger_id', 'doc_date', 'narration'];

export default function SalesAdditionalEntry() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('sales_additional', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [billWiseSettlements, setBillWiseSettlements] = useState(null);
    const [auditModal, setAuditModal] = useState(null);

    const [customers, setCustomers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [agents, setAgents] = useState([]);
    const [incomeLedgers, setIncomeLedgers] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [remarks, setRemarks] = useState([]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addLine(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, ldg, sl, ag, cc, bu, rmk] = await Promise.all([
                authFetch('/api/sales-additional-entries'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/remarks')
            ]);
            setRows(req.data || []);
            setCustomers(ldg.data || []);
            setIncomeLedgers(ldg.data || []);
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
    const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }));
    const removeLine = (idx) => setForm(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== idx) : f.lines }));
    const updateLine = (idx, patch) => setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));

    const grandTotal = form.lines.reduce((sum, l) => sum + (l.entry_sign === 'deduct' ? -(Number(l.amount) || 0) : (Number(l.amount) || 0)), 0);

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        const validLines = form.lines.filter(l => l.income_ledger_id && Number(l.amount) > 0);
        if (!saveAsDraft) {
            if (!form.customer_ledger_id) return showAlert('Customer is required', 'danger');
            if (validLines.length === 0) return showAlert('At least one complete line item is required', 'danger');
        }
        try {
            const payload = { ...form, lines: validLines, ...(billWiseSettlements ? { bill_wise_settlements: billWiseSettlements } : {}), ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}) };
            if (editingId) {
                await authFetch(`/api/sales-additional-entries/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : 'Sales Additional Entry updated', 'success');
            } else {
                const res = await authFetch('/api/sales-additional-entries', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Sales Additional Entry ${res.data.doc_no} created`, 'success');
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
            const res = await authFetch(`/api/sales-additional-entries/${row.id}`);
            setEditingId(row.id);
            setForm({ ...emptyForm, ...res.data, doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date, lines: (res.data.lines || []).length > 0 ? res.data.lines : [emptyLine()] });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt('Reason for cancelling this Entry?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            await authFetch(`/api/sales-additional-entries/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            showAlert(`Marked as ${status}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/sales-additional-entries/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const [udfDoc, setUdfDoc] = useState(null);

    const openAuditTrail = async (row) => {
        try {
            const res = await authFetch(`/api/sales-additional-entries/${row.id}/audit-trail`);
            setAuditModal({ doc_no: row.doc_no, entries: res.data || [] });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'customer_name_snapshot', label: 'Customer', type: 'text', render: r => r.customer_name_snapshot || '—' },
        { key: 'total_amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">➕ Sales Additional Entry</span>
                <div className="erp-header-actions">
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
                        <div className={efc.isVisible('customer_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Customer <span className="req">*</span> {efc.isRequired('customer_ledger_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="sae_customer_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={customers} getId={c => c.id} getLabel={c => c.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.customer_ledger_id} onChange={id => setForm({ ...form, customer_ledger_id: id })} placeholder="Select Customer"
                            />
                        </div>
                        <ProductCompanyField side="sales" form={form} setForm={setForm} products={[]} />
                        <div className={efc.isVisible('agent_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Salesman/Agent {efc.isRequired('agent_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="sae_agent_picker"
                                columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                                defaultVisibleKeys={['agent_name']}
                                items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                searchKeys={['agent_name', 'agent_code']}
                                value={form.agent_id} onChange={id => setForm({ ...form, agent_id: id })} placeholder="Select Agent"
                            />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Customer Sub Ledger</label>
                            <SearchablePopupSelect
                                listKey="sae_customer_subledger_picker"
                                columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                defaultVisibleKeys={['sub_ledger_name']}
                                items={subLedgers} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                value={form.customer_sub_ledger_id} onChange={id => setForm({ ...form, customer_sub_ledger_id: id })} placeholder="Select Sub Ledger"
                            />
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="sales_additional" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                            <div className="erp-field">
                                <label className="erp-label">Cost Center</label>
                                <SearchablePopupSelect
                                    listKey="sae_cost_center_picker"
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
                                    listKey="sae_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="sae-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="sae-remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field md:col-span-3' : 'erp-field md:col-span-3 hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Charge Lines</h2>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table min-w-[800px]">
                                <thead>
                                    <tr>
                                        <th className="w-56">Ledger</th>
                                        <th className={`w-56 ${efc.isVisible('description', 'detail') ? '' : 'hidden'}`}>Description</th>
                                        <th className={`w-28 ${efc.isVisible('entry_sign', 'detail') ? '' : 'hidden'}`}>Sign</th>
                                        <th className={`w-28 ${efc.isVisible('amount', 'detail') ? '' : 'hidden'}`}>Amount</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.lines.map((l, idx) => (
                                        <tr key={idx}>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="sae_income_ledger_picker"
                                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['account_name']}
                                                    items={incomeLedgers} getId={l2 => l2.id} getLabel={l2 => l2.account_name}
                                                    searchKeys={['account_name', 'account_code']}
                                                    value={l.income_ledger_id} onChange={id => updateLine(idx, { income_ledger_id: id })} placeholder="e.g. Delivery Income"
                                                />
                                            </td>
                                            <td className={efc.isVisible('description', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('description', 'detail')} className="erp-input" value={l.description} onChange={e => updateLine(idx, { description: e.target.value })} placeholder="e.g. Delivery Charge" /></td>
                                            <td className={efc.isVisible('entry_sign', 'detail') ? '' : 'hidden'}>
                                                <select disabled={efc.isReadonly('entry_sign', 'detail')} className="erp-select" value={l.entry_sign} onChange={e => updateLine(idx, { entry_sign: e.target.value })}>
                                                    <option value="add">Add</option>
                                                    <option value="deduct">Deduct</option>
                                                </select>
                                            </td>
                                            <td className={efc.isVisible('amount', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('amount', 'detail')} type="number" step="0.01" className="erp-input" value={l.amount} onChange={e => updateLine(idx, { amount: e.target.value })} /></td>
                                            <td><button type="button" tabIndex={-1} onClick={() => removeLine(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-between items-center mt-2 mb-4">
                            <button type="button" onClick={addLine} className="text-xs text-blue-600">➕ Add Line</button>
                            <span className="text-sm font-semibold">Net Total: {grandTotal.toFixed(2)}</span>
                        </div>

                        <BillWiseSettlementPanel
                            productCompanyId={form.product_company_id}
                            ledgerId={form.customer_ledger_id}
                            outstandingNature="cr"
                            amount={grandTotal}
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
                storageKey="sales_additional_entry_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        {row.status === 'draft' && <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>}
                        {row.status === 'posted' && <a href={`/print/sales_additional_entry/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="sales_additional_entry" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {row.status !== 'cancelled' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {row.status === 'draft' && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
                    </div>
                )}
            />
        </div>

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
