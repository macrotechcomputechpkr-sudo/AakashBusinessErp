// =============================================
// PdcVoucher.jsx
// Post-Dated Cheque - Pending -> Posted (GL posts here, cash received /
// cheque cleared) or Returned -> Cancelled.
// =============================================

import ProductCompanyField from '../components/ProductCompanyField';
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

const emptyForm = {
    product_company_id: '', doc_date: new Date().toISOString().slice(0, 10),
    numbering_category_id: '',
    voucher_type: 'received',
    party_ledger_id: '', party_sub_ledger_id: '', bank_ledger_id: '',
    cheque_no: '', cheque_date: '', bank_name: '', bank_branch: '', bank_account_name: '', bank_account_no: '',
    beneficiary_name: '', amount: '', is_online_pdc: false, is_opening_balance: false,
    ref_doc_no: '', ref_doc_date: '', remarks_text: '', narration: '',
    cost_center_id: '', business_unit_id: ''
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['amount', 'bank_account_no', 'bank_branch', 'bank_name', 'beneficiary_name', 'cheque_date', 'cheque_no', 'doc_date', 'narration', 'party_ledger_id', 'ref_doc_no', 'voucher_type'];

export default function PdcVoucher() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('pdc', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [billWiseSettlements, setBillWiseSettlements] = useState(null);
    const [auditModal, setAuditModal] = useState(null);
    const [showRegisterOnly, setShowRegisterOnly] = useState(true);

    const [ledgers, setLedgers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [remarks, setRemarks] = useState([]);

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, ldg, sl, cc, bu, rmk] = await Promise.all([
                authFetch('/api/pdc-vouchers'),
                authFetch('/api/ledger-accounts?pageSize=500'),
                authFetch('/api/sub-ledgers'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/remarks')
            ]);
            setRows(req.data || []);
            setLedgers(ldg.data || []);
            setSubLedgers(sl.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setRemarks(rmk.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setBillWiseSettlements(null); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const missing = efc.missingRequired(form);
        if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        try {
            const payload = { ...form, ...(billWiseSettlements ? { bill_wise_settlements: billWiseSettlements } : {}) };
            if (editingId) {
                await authFetch(`/api/pdc-vouchers/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('PDC updated', 'success');
            } else {
                const res = await authFetch('/api/pdc-vouchers', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(`PDC ${res.data.doc_no} created`, 'success');
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
            const res = await authFetch(`/api/pdc-vouchers/${row.id}`);
            setEditingId(row.id);
            setForm({ ...emptyForm, ...res.data, doc_date: res.data.doc_date?.slice(0, 10), cheque_date: res.data.cheque_date?.slice(0, 10), ref_doc_date: res.data.ref_doc_date?.slice(0, 10) || '' });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handlePost = async (row) => {
        if (!row.bank_ledger_id) return showAlert('Open this PDC and set a Bank Ledger before posting it', 'danger');
        const postingDate = window.prompt('Cash received / cheque cleared date? (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
        if (!postingDate) return;
        const postingNo = window.prompt('Bank voucher / reference no.? (optional)') || null;
        try {
            await authFetch(`/api/pdc-vouchers/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'posted', posting_date: postingDate, posting_no: postingNo }) });
            showAlert('PDC posted - ledger entry recorded', 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleReturn = async (row) => {
        const returnReason = window.prompt(row.status === 'posted' ? 'This PDC was already posted - reason for reversing it as returned?' : 'Reason this cheque was returned?');
        if (!returnReason || !returnReason.trim()) return;
        try {
            await authFetch(`/api/pdc-vouchers/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'returned', return_reason: returnReason }) });
            showAlert('Marked as Returned', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleCancel = async (row) => {
        const cancellationReason = window.prompt('Reason for cancelling this PDC?');
        if (!cancellationReason || !cancellationReason.trim()) return;
        try {
            await authFetch(`/api/pdc-vouchers/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled', cancellation_reason: cancellationReason }) });
            showAlert('PDC cancelled', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Delete PDC "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/pdc-vouchers/${row.id}`, { method: 'DELETE' });
            showAlert('PDC deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const [udfDoc, setUdfDoc] = useState(null);

    const openAuditTrail = (row) => setAuditModal({ id: row.id, doc_no: row.doc_no });

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'voucher_type', label: 'Type', type: 'text', render: r => r.voucher_type === 'received' ? 'Received' : 'Issued' },
        { key: 'party_name_snapshot', label: 'Party', type: 'text', render: r => r.party_name_snapshot || '—' },
        { key: 'cheque_no', label: 'Cheque No', type: 'text' },
        { key: 'cheque_date', label: 'Cheque Date', type: 'text', render: r => formatDateForDisplay(r.cheque_date, 'dual') },
        { key: 'amount', label: 'Amount', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🏦 Post-Dated Cheque (PDC)</span>
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
                        <div className={efc.isVisible('voucher_type') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Received / Issued <span className="req">*</span> {efc.isRequired('voucher_type') && <span className="req">*</span>}</label>
                            <select disabled={efc.isReadonly('voucher_type')} className="erp-select" value={form.voucher_type} onChange={e => setForm({ ...form, voucher_type: e.target.value })}>
                                <option value="received">Received (from Customer)</option>
                                <option value="issued">Issued (to Vendor)</option>
                            </select>
                        </div>
                        <div className={efc.isVisible('party_ledger_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Party <span className="req">*</span> {efc.isRequired('party_ledger_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="pdc_party_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.party_ledger_id} onChange={id => setForm({ ...form, party_ledger_id: id })} placeholder="Select Party"
                            />
                        </div>
                        <ProductCompanyField side={form.voucher_type === 'issue' ? 'purchase' : 'sales'} form={form} setForm={setForm} products={[]} />
                        <div className="erp-field">
                            <label className="erp-label">Bank Ledger <span className="hint">(required to realize)</span></label>
                            <SearchablePopupSelect
                                listKey="pdc_bank_ledger_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.bank_ledger_id} onChange={id => setForm({ ...form, bank_ledger_id: id })} placeholder="Select Bank Ledger"
                            />
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="pdc" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('cheque_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Cheque No <span className="req">*</span> {efc.isRequired('cheque_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('cheque_no')} className="erp-input" value={form.cheque_no} onChange={e => setForm({ ...form, cheque_no: e.target.value })} required />
                            </div>
                            <div className={efc.isVisible('cheque_date') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Cheque Date <span className="req">*</span> {efc.isRequired('cheque_date') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('cheque_date')} type="date" className="erp-input" value={form.cheque_date} onChange={e => setForm({ ...form, cheque_date: e.target.value })} required />
                            </div>
                            <div className={efc.isVisible('amount') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Amount <span className="req">*</span> {efc.isRequired('amount') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('amount')} type="number" step="0.01" className="erp-input" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
                            </div>
                            <div className="erp-field justify-end">
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={form.is_online_pdc} onChange={e => setForm({ ...form, is_online_pdc: e.target.checked })} />
                                    Online PDC
                                </label>
                            </div>
                            <div className="erp-field justify-end">
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={form.is_opening_balance} onChange={e => setForm({ ...form, is_opening_balance: e.target.checked })} />
                                    Opening Balance PDC
                                </label>
                            </div>
                            <div className={efc.isVisible('bank_name') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Bank Name {efc.isRequired('bank_name') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('bank_name')} className="erp-input" value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('bank_branch') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Bank Branch {efc.isRequired('bank_branch') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('bank_branch')} className="erp-input" value={form.bank_branch} onChange={e => setForm({ ...form, bank_branch: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Bank Account Name</label>
                                <input className="erp-input" value={form.bank_account_name} onChange={e => setForm({ ...form, bank_account_name: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('bank_account_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Bank Account No {efc.isRequired('bank_account_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('bank_account_no')} className="erp-input" value={form.bank_account_no} onChange={e => setForm({ ...form, bank_account_no: e.target.value })} />
                            </div>
                            <div className={efc.isVisible('beneficiary_name') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Beneficiary Name {efc.isRequired('beneficiary_name') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('beneficiary_name')} className="erp-input" value={form.beneficiary_name} onChange={e => setForm({ ...form, beneficiary_name: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Party Sub Ledger</label>
                                <SearchablePopupSelect
                                    listKey="pdc_subledger_picker"
                                    columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]}
                                    defaultVisibleKeys={['sub_ledger_name']}
                                    items={subLedgers} getId={s => s.id} getLabel={s => s.sub_ledger_name}
                                    searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                    value={form.party_sub_ledger_id} onChange={id => setForm({ ...form, party_sub_ledger_id: id })} placeholder="Select Sub Ledger"
                                />
                            </div>
                            <div className={efc.isVisible('ref_doc_no') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Ref Doc No {efc.isRequired('ref_doc_no') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('ref_doc_no')} className="erp-input" value={form.ref_doc_no} onChange={e => setForm({ ...form, ref_doc_no: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Ref Doc Date</label>
                                <input type="date" className="erp-input" value={form.ref_doc_date} onChange={e => setForm({ ...form, ref_doc_date: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Cost Center</label>
                                <SearchablePopupSelect
                                    listKey="pdc_cost_center_picker"
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
                                    listKey="pdc_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="pdc-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="pdc-remarks-suggestions">
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
                            outstandingNature={form.voucher_type === 'received' ? 'dr' : 'cr'}
                            amount={form.amount}
                            onSettlementsChange={setBillWiseSettlements}
                        />
                        <p className="text-xs text-gray-400 mt-2">This settlement, and the ledger entry itself, only apply once this PDC is marked <b>Posted</b> from the list below - a post-dated cheque doesn't move money until cash is received or the cheque actually clears.</p>
                    </div>

                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>
                            <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </form>
            )}
        </div>

        <div className="max-w-6xl mx-auto px-4 mt-4">
            <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={showRegisterOnly} onChange={e => setShowRegisterOnly(e.target.checked)} />
                    Show only outstanding (Pending)
                </label>
            </div>
            <ReportGrid
                columns={columns}
                rows={showRegisterOnly ? rows.filter(r => r.status === 'pending') : rows}
                getId={r => r.id}
                storageKey="pdc_voucher_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center flex-wrap">
                        {row.status === 'pending' && <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>}
                        {['pending', 'posted'].includes(row.status) && <a href={`/print/pdc_voucher/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="pdc_voucher" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'pending' && <button onClick={() => handlePost(row)} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {['pending', 'posted'].includes(row.status) && <button onClick={() => handleReturn(row)} className="px-2 py-1 bg-orange-600 text-white rounded text-xs">Return</button>}
                        {row.status === 'pending' && <button onClick={() => handleCancel(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {row.status === 'pending' && <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
                    </div>
                )}
            />
        </div>

        {auditModal && <RecordHistory table="pdc_vouchers" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/pdc-vouchers/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
