// =============================================
// JournalVoucher.jsx
// Direct multi-line Debit/Credit entries - every line is either a Dr or
// a Cr, and the whole voucher must balance before it can post.
//   Master : Voucher No. (Document Numbering), Date (AD or BS - type or
//            pick), JV Type, Ref Doc No / Date, Memo, cost center, unit
//   JV Type: Normal / taxable-non-taxable goods, asset or service purchase
//            or sales / TDS - only the chosen type's options show, and its
//            voucher lines are filled from them (server:
//            journalVoucherRoutes.js JV_TYPES)
//   Footer : Narration (one field; saved remarks offered as suggestions)
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
import UdfValuesModal from '../components/UdfValuesModal';
import useLedgerPurposes from '../components/useLedgerPurposes';
import RecordHistory from '../components/RecordHistory';
import DocActions, { finalizeEntry } from '../components/entry/DocActions';
import EntryFillBar from '../components/entry/EntryFillBar';
import { saveEntryDraft, finishEntryDraft } from '../components/entry/entryDrafts';
import DocNumberField from '../components/entry/DocNumberField';
import DualDateInput from '../components/entry/DualDateInput';

const emptyDetailRow = () => ({ ledger_id: '', sub_ledger_id: '', product_company_id: '', agent_id: '', debit_amount: '', credit_amount: '', narration: '' });

// JV Type: side (who is Cr / Dr), the account the goods / asset / service line may use, labels
export const JV_TYPES = [
    { key: 'normal', label: 'Normal Journal' },
    { key: 'purchase', label: 'Taxable / Non-taxable Purchase', side: 'purchase', purposes: ['purchase_goods', 'expense'], acct: 'Purchase / Expense A/c', sysAcct: 'purchase_account_ledger_id' },
    { key: 'sales', label: 'Taxable / Non-taxable Sales', side: 'sales', purposes: ['sales_goods'], acct: 'Sales A/c', sysAcct: 'sales_account_ledger_id' },
    { key: 'asset_purchase', label: 'Taxable / Non-taxable Asset Purchase', side: 'purchase', purposes: ['fixed_asset'], acct: 'Fixed Asset A/c' },
    { key: 'asset_sales', label: 'Taxable / Non-taxable Asset Sales', side: 'sales', purposes: ['fixed_asset', 'income'], acct: 'Fixed Asset / Disposal A/c' },
    { key: 'service_purchase', label: 'Taxable / Non-taxable Service Purchase', side: 'purchase', purposes: ['pl_expense'], acct: 'Service / Expense A/c' },
    { key: 'service_sales', label: 'Taxable / Non-taxable Service Sales', side: 'sales', purposes: ['income'], acct: 'Service Income A/c' },
    { key: 'balance_writeoff', label: 'Small Balance Write-off' },
    { key: 'tds', label: 'TDS', side: 'tds', purposes: ['expense', 'purchase_goods', 'fixed_asset'], acct: 'Expense A/c' }
];
// the JV Type drop-down: one choice, TDS split into on-purchase / on-sales
const TYPE_CHOICES = [...JV_TYPES.filter(t => t.key !== 'tds' && t.key !== 'balance_writeoff').map(t => ({ value: t.key, label: t.label })),
    { value: 'tds:purchase', label: 'TDS on Purchase' }, { value: 'tds:sales', label: 'TDS on Sales' },
    // many small customer / supplier balances at once: its own screen (BalanceWriteoff.jsx)
    { value: 'balance_writeoff', label: 'Small Balance Write-off (bulk) …' }];
const typeOf = k => JV_TYPES.find(t => t.key === k) || JV_TYPES[0];
const Arrow = ({ open }) => <span className="inline-block w-3 text-center" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s' }}>▾</span>;

const emptyForm = {
    doc_no: '', doc_date: new Date().toISOString().slice(0, 10),
    numbering_category_id: '',
    ref_doc_no: '', ref_doc_date: '',
    cost_center_id: '', business_unit_id: '', narration: '',
    is_memo: false,
    // JV Type and its options (taxable / non-taxable goods, asset, service; TDS)
    jv_type: 'normal', party_ledger_id: '', party_pan: '', party_bill_no: '', party_bill_date: '',
    taxable_amount: '', non_taxable_amount: '', vat_percent: 13, vat_amount: '',
    tds_percent: '', tds_base_amount: '', tds_amount: '', tds_ledger_id: '', tds_sub_ledger_id: '',
    // TDS type: on purchase (supplier's bills) or on sales (customer's bills), and the bills chosen
    tds_side: 'purchase', tds_bills: [],
    details: [emptyDetailRow(), emptyDetailRow()]
};
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['business_unit_id', 'cost_center_id', 'doc_date', 'narration', 'ref_doc_date', 'ref_doc_no', 'jv_type'];

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

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setAutoLines(true); };
    const addDetailRow = () => setForm(f => ({ ...f, details: [...f.details, emptyDetailRow()] }));
    const removeDetailRow = (idx) => setForm(f => ({ ...f, details: f.details.length > 2 ? f.details.filter((_, i) => i !== idx) : f.details }));
    const updateDetailRow = (idx, patch) => { setAutoLines(false); setForm(f => ({ ...f, details: f.details.map((d, i) => i === idx ? { ...d, ...patch } : d) })); };
    // choosing the ledger of a line with no amount yet fills the amount that balances the
    // voucher on the other side (100 Dr on line 1 -> 100 Cr on the next line), still editable
    const pickLineLedger = (idx, id) => { setAutoLines(false); setForm(f => ({ ...f, details: f.details.map((d, i) => {
        if (i !== idx) return d;
        const next = { ...d, ledger_id: id, sub_ledger_id: '' };
        if (id && !Number(d.debit_amount) && !Number(d.credit_amount)) {
            const diff = r2(f.details.reduce((s, x, k) => (k === idx ? s : s + (Number(x.debit_amount) || 0) - (Number(x.credit_amount) || 0)), 0));
            if (diff > 0) next.credit_amount = diff; else if (diff < 0) next.debit_amount = -diff;
        }
        return next;
    }) })); };

    // ---- taxable / non-taxable purchase or sales entry: voucher lines are
    // filled from the party, amounts and accounts, and stay editable (once a
    // line is edited by hand, it is no longer refilled automatically).
    const lp = useLedgerPurposes();
    const [sysCtl, setSysCtl] = useState({});
    const [taxAcct, setTaxAcct] = useState({ goods: '', vat: '' });
    const [autoLines, setAutoLines] = useState(true);
    useEffect(() => { authFetch('/api/system-control').then(r => setSysCtl(r.data || {})).catch(() => {}); }, [authFetch]);
    const jt = typeOf(form.jv_type);
    const isTax = jt.side === 'purchase' || jt.side === 'sales';
    const isTds = jt.side === 'tds';
    const tdsSales = isTds && form.tds_side === 'sales';
    // the party side: customers (+ both) for sales and TDS on sales, suppliers (+ both) otherwise
    const partySales = jt.side === 'sales' || tdsSales;
    const partyCats = partySales ? ['sales', 'both'] : ['purchase', 'both'];
    const partyLedgers = ledgers.filter(l => partyCats.includes(l.category_type) || l.id === form.party_ledger_id);
    const billMode = isTds && (form.tds_bills || []).length > 0;
    const goodsAmount = r2(Number(form.taxable_amount || 0) + Number(form.non_taxable_amount || 0));
    const taxTotal = r2(goodsAmount + Number(form.vat_amount || 0));
    // TDS: % of the base (tax types: the VAT-exclusive value) unless the amount is typed
    const tdsBase = isTds ? r2(form.tds_base_amount) : Number(form.tds_base_amount) > 0 ? r2(form.tds_base_amount) : goodsAmount;
    const tdsAmount = r2(form.tds_amount);
    const defaultTdsLedger = partySales ? sysCtl.sales_tds_ledger_id : sysCtl.tds_ledger_id;
    const setTax = patch => setForm(f => {
        const n = { ...f, ...patch };
        if (('taxable_amount' in patch || 'vat_percent' in patch) && !('vat_amount' in patch)) n.vat_amount = n.vat_percent === '' ? n.vat_amount : r2(Number(n.taxable_amount || 0) * Number(n.vat_percent || 0) / 100);
        if (patch.party_ledger_id) { const pl = ledgers.find(l => l.id === patch.party_ledger_id); n.party_pan = pl?.vat_pan_number || pl?.pan_number || n.party_pan || ''; }
        // TDS follows its % unless the TDS amount itself was typed
        const base = n.jv_type === 'tds' || Number(n.tds_base_amount) > 0 ? Number(n.tds_base_amount || 0) : Number(n.taxable_amount || 0) + Number(n.non_taxable_amount || 0);
        if ('tds_amount' in patch) n.tds_percent = base > 0 && Number(patch.tds_amount) > 0 ? r2(Number(patch.tds_amount) * 100 / base) : '';
        else if (Number(n.tds_percent) > 0) n.tds_amount = r2(base * Number(n.tds_percent) / 100);
        if ((n.tds_bills || []).length && ('tds_percent' in patch)) n.tds_bills = n.tds_bills.map(b => ({ ...b, tds_percent: n.tds_percent }));
        if ((n.tds_bills || []).length) Object.assign(n, billTotals(n.tds_bills));
        if (Number(n.tds_amount) > 0 && !n.tds_ledger_id) n.tds_ledger_id = (typeOf(n.jv_type).side === 'sales' || (n.jv_type === 'tds' && n.tds_side === 'sales') ? sysCtl.sales_tds_ledger_id : sysCtl.tds_ledger_id) || '';
        return n;
    });
    // TDS journal against bills: the party's open bills (newest first), several can be chosen
    const [openBills, setOpenBills] = useState([]);
    // the bill list folds away with the arrow; the chosen bills' total stays visible
    // FastTabs of the type's options: each folds with its arrow (summary shown when folded)
    const [partyOpen, setPartyOpen] = useState(true);
    const [detailOpen, setDetailOpen] = useState(true);
    const [billsOpen, setBillsOpen] = useState(true);
    const [tdsOpen, setTdsOpen] = useState(false);
    useEffect(() => { setTdsOpen(form.jv_type === 'tds' || Number(form.tds_amount) > 0); }, [form.jv_type]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!isTds || !form.party_ledger_id) { setOpenBills([]); return; }
        const q = new URLSearchParams({ side: form.tds_side || 'purchase', party_id: form.party_ledger_id, ...(editingId ? { jv_id: editingId } : {}) });
        authFetch(`/api/journal-vouchers/tds-bills?${q}`).then(r => setOpenBills(r.data || [])).catch(() => setOpenBills([]));
    }, [authFetch, isTds, form.party_ledger_id, form.tds_side, editingId]);
    const billKey = b => `${b.source_type}|${b.source_id}`;
    const billTds = b => r2(Number(b.base_amount || 0) * Number(b.tds_percent || 0) / 100);
    const billTotals = bills => {
        const base = r2(bills.reduce((s, b) => s + Number(b.base_amount || 0), 0)), tds = r2(bills.reduce((s, b) => s + billTds(b), 0));
        return { tds_base_amount: base || '', tds_amount: tds || '', tds_percent: bills.length && bills.every(b => Number(b.tds_percent) === Number(bills[0].tds_percent)) ? bills[0].tds_percent : '' };
    };
    const setBills = fn => { setAutoLines(true); setForm(f => { const bills = fn(f.tds_bills || []); const n = { ...f, tds_bills: bills, ...billTotals(bills) };
        if (!bills.length) Object.assign(n, { tds_base_amount: '', tds_amount: '' });
        if (Number(n.tds_amount) > 0 && !n.tds_ledger_id) n.tds_ledger_id = (f.tds_side === 'sales' ? sysCtl.sales_tds_ledger_id : sysCtl.tds_ledger_id) || '';
        return n; }); };
    const toggleBill = b => setBills(list => (list.some(x => billKey(x) === billKey(b)) ? list.filter(x => billKey(x) !== billKey(b))
        : [...list, { ...b, tds_percent: form.tds_percent || sysCtl.default_tds_percent || 1.5 }]));
    const setBillPct = (b, pct) => setBills(list => list.map(x => (billKey(x) === billKey(b) ? { ...x, tds_percent: pct } : x)));
    const shownBills = [...(form.tds_bills || []).filter(x => !openBills.some(o => billKey(o) === billKey(x))), ...openBills];
    // voucher lines: the party of this side, the accounts of the type, VAT and TDS ledgers
    const lineLedgers = jt.key === 'normal' ? ledgers : ledgers.filter(l => partyCats.includes(l.category_type)
        || (jt.purposes || []).some(p => lp.can(l.id, p)) || lp.can(l.id, partySales ? 'income' : 'expense')
        || [taxAcct.vat, form.tds_ledger_id, defaultTdsLedger, sysCtl.vat_ledger_id].includes(l.id) || form.details.some(d => d.ledger_id === l.id));
    const changeType = (key, side) => {
        setAutoLines(true);
        setPartyOpen(true); setDetailOpen(true); setBillsOpen(true);
        // a new type starts its TDS afresh (the TDS type's base is not a purchase's)
        setForm(f => ({ ...f, jv_type: key, tds_ledger_id: '', tds_sub_ledger_id: '', tds_percent: '', tds_base_amount: '', tds_amount: '', tds_bills: [], party_ledger_id: '', party_pan: '', tds_side: side || 'purchase', ...(key === 'normal' ? { details: [emptyDetailRow(), emptyDetailRow()] } : {}) }));
    };
    const buildTaxLines = (f, acct) => {
        const t = typeOf(f.jv_type);
        const goodsAmt = r2(Number(f.taxable_amount || 0) + Number(f.non_taxable_amount || 0)), vat = r2(f.vat_amount), total = r2(goodsAmt + vat), tds = r2(f.tds_amount);
        const text = f.party_bill_no ? `${t.side === 'sales' ? 'Invoice' : 'Bill'} ${f.party_bill_no}` : '';
        const row = (ledger_id, dr, cr, sub = '') => ({ ...emptyDetailRow(), ledger_id: ledger_id || '', sub_ledger_id: sub || '', debit_amount: dr ? dr : '', credit_amount: cr ? cr : '', narration: text });
        const tdsRow = (dr, cr) => row(f.tds_ledger_id, dr, cr, f.tds_sub_ledger_id);
        let lines;
        if (t.side === 'tds' && ((f.tds_bills || []).length || f.tds_side === 'sales')) {
            // bills already booked: only the TDS moves
            const billText = (f.tds_bills || []).map(b => b.doc_no).filter(Boolean).join(', ');
            const withText = l => ({ ...l, narration: billText ? `TDS on ${billText}` : l.narration });
            lines = (f.tds_side === 'sales' ? [tdsRow(tds, 0), row(f.party_ledger_id, 0, tds)] : [row(f.party_ledger_id, tds, 0), tdsRow(0, tds)]).map(withText);
        } else if (t.side === 'tds') {
            const base = r2(f.tds_base_amount);
            lines = [row(acct.goods, base, 0), tdsRow(0, tds), row(f.party_ledger_id, 0, r2(base - tds))];
        } else if (t.side === 'purchase') {
            lines = [row(acct.goods, goodsAmt, 0), ...(vat ? [row(acct.vat, vat, 0)] : []), row(f.party_ledger_id, 0, r2(total - tds)), ...(tds ? [tdsRow(0, tds)] : [])];
        } else {
            lines = [row(f.party_ledger_id, r2(total - tds), 0), ...(tds ? [tdsRow(tds, 0)] : []), row(acct.goods, 0, goodsAmt), ...(vat ? [row(acct.vat, 0, vat)] : [])];
        }
        return lines.filter(l => Number(l.debit_amount) || Number(l.credit_amount));
    };
    const filterAny = (list, purposes, keep) => (list || []).filter(l => l.id === keep || purposes.some(p => lp.can(l.id, p)));
    // default accounts when the type changes
    useEffect(() => {
        if (jt.key === 'normal') return;
        setTaxAcct(a => ({
            goods: a.goods && jt.purposes.some(p => lp.can(a.goods, p)) ? a.goods : (jt.sysAcct && sysCtl[jt.sysAcct]) || '',
            vat: a.vat || sysCtl.vat_ledger_id || ''
        }));
    }, [form.jv_type, sysCtl]); // eslint-disable-line react-hooks/exhaustive-deps
    // refill the lines while they are automatic
    useEffect(() => {
        if (jt.key === 'normal' || !autoLines) return;
        setForm(f => ({ ...f, details: buildTaxLines(f, taxAcct).length ? buildTaxLines(f, taxAcct) : f.details }));
    }, [form.jv_type, form.tds_side, form.tds_bills, form.party_ledger_id, form.taxable_amount, form.non_taxable_amount, form.vat_amount, form.party_bill_no, form.tds_amount, form.tds_base_amount, form.tds_ledger_id, form.tds_sub_ledger_id, taxAcct, autoLines]); // eslint-disable-line react-hooks/exhaustive-deps

    const totalDebit = form.details.reduce((s, d) => s + (Number(d.debit_amount) || 0), 0);
    const totalCredit = form.details.reduce((s, d) => s + (Number(d.credit_amount) || 0), 0);
    const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
    const isBalanced = Math.abs(difference) < 0.01 && totalDebit > 0;

    const handleSubmit = async (e, saveAsDraft = false) => {

        // Save as Draft (new entry): kept apart as a temporary draft - no number, no accounts / stock effect

        if (saveAsDraft && !editingId) { if (e) e.preventDefault(); if (await saveEntryDraft(authFetch, 'journal', form)) { resetForm(); setShowForm(false); } return; }
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
                if (!saveAsDraft) await finalizeEntry(authFetch, 'journal-vouchers', editingId, 'posted');
                showAlert(saveAsDraft ? 'Draft saved' : 'Journal Voucher updated', 'success');
            } else {
                const res = await authFetch('/api/journal-vouchers', { method: 'POST', body: JSON.stringify(payload) });
                if (!saveAsDraft) await finalizeEntry(authFetch, 'journal-vouchers', res.data?.id, 'posted');
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Journal Voucher ${res.data.doc_no} created`, 'success');
            }
            await finishEntryDraft(authFetch, 'journal');
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
            setAutoLines(false);
            setForm({
                ...emptyForm, ...Object.fromEntries(Object.entries(res.data).filter(([, v]) => v !== null)),
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
            setAutoLines(false);
            setForm({
                ...emptyForm, ...Object.fromEntries(Object.entries(src).filter(([, v]) => v !== null)),
                doc_no: '', doc_date: new Date().toISOString().slice(0, 10), status: 'draft', tds_bills: [],   // a bill takes TDS once
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


    const [udfDoc, setUdfDoc] = useState(null);

    const openAuditTrail = (row) => setAuditModal({ id: row.id, doc_no: row.doc_no });

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'jv_type', label: 'JV Type', type: 'text', render: r => typeOf(r.jv_type).label },
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
                    <EntryFillBar voucherType="journal" api="journal-vouchers" form={form} editing={!!editingId} docId={editingId} onFill={p => setForm(f => ({ ...f, ...p }))} onCopy={r => handleCopyFrom(r.id)} />
                    <div className="erp-topbar grid-cols-1 md:grid-cols-3">
                        <DocNumberField docDate={form.doc_date} voucherType="journal" categoryId={form.numbering_category_id} docNo={editingId ? form.doc_no : ''} value={form.doc_no} onChange={v => setForm(f => ({ ...f, doc_no: v }))} />
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span></label>
                            <DualDateInput value={form.doc_date} onChange={v => setForm(f => ({ ...f, doc_date: v }))} disabled={efc.isReadonly('doc_date')} required defaultMode={sysCtl.date_format_entry} />
                        </div>
                        <div className={efc.isVisible('jv_type') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">JV Type</label>
                            <select className="erp-select" value={form.jv_type === 'tds' ? `tds:${form.tds_side || 'purchase'}` : form.jv_type} disabled={efc.isReadonly('jv_type')}
                                onChange={e => { if (e.target.value === 'balance_writeoff') { window.location.assign('/balance-writeoff'); return; } const [k, side] = e.target.value.split(':'); changeType(k, side); }}>
                                {TYPE_CHOICES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>
                        <div className="erp-field">
                            <span className="erp-label">Memo Only</span>
                            <label className="flex items-center gap-2 text-xs text-gray-600" title="A memo voucher is kept for record and never posts to the ledger">
                                <input type="checkbox" checked={form.is_memo} onChange={e => setForm({ ...form, is_memo: e.target.checked })} />
                                never posts to ledger
                            </label>
                        </div>
                        <div className={efc.isVisible('ref_doc_no') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Ref Doc No {efc.isRequired('ref_doc_no') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('ref_doc_no')} className="erp-input" value={form.ref_doc_no} onChange={e => setForm({ ...form, ref_doc_no: e.target.value })} />
                        </div>
                        <div className={efc.isVisible('ref_doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Ref Doc Date {efc.isRequired('ref_doc_date') && <span className="req">*</span>}</label>
                            <DualDateInput value={form.ref_doc_date} onChange={v => setForm(f => ({ ...f, ref_doc_date: v }))} disabled={efc.isReadonly('ref_doc_date')} defaultMode={sysCtl.date_format_entry} />
                        </div>
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
                        {!editingId && (
                            <NumberingCategorySelector voucherType="journal" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        {jt.key !== 'normal' && (<>
                        {/* ---- Vendor / Customer (FastTab) ---- */}
                        <div className="nav-fasttab">
                            <button type="button" className="nav-fasttab-head" onClick={() => setPartyOpen(o => !o)} aria-expanded={partyOpen}>
                                <Arrow open={partyOpen} /> {partySales ? 'Customer' : 'Vendor'} Details
                                {!partyOpen && <span className="nav-fasttab-sum">{ledgers.find(l => l.id === form.party_ledger_id)?.account_name || 'not chosen'}{form.party_pan ? ` · PAN ${form.party_pan}` : ''}{form.party_bill_no ? ` · Bill ${form.party_bill_no}` : ''}</span>}
                            </button>
                            {partyOpen && (
                                <div className="nav-fasttab-body">
                                    <div className="erp-field"><label className="erp-label">{partySales ? 'Customer' : 'Vendor'} <span className="req">*</span></label>
                                        <SearchablePopupSelect
                                            listKey="jv_tax_party_picker"
                                            columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }, { key: 'pan_number', label: 'PAN' }]}
                                            defaultVisibleKeys={['account_name']}
                                            items={partyLedgers} getId={l => l.id} getLabel={l => l.account_name}
                                            searchKeys={['account_name', 'account_code', 'pan_number']}
                                            value={form.party_ledger_id} onChange={id => setTax({ party_ledger_id: id, tds_bills: [], tds_base_amount: '', tds_amount: '' })} placeholder={partySales ? 'Customer / both' : 'Vendor / both'}
                                        /></div>
                                    <div className="erp-field"><label className="erp-label">PAN / VAT No</label><input className="erp-input" value={form.party_pan || ''} onChange={e => setTax({ party_pan: e.target.value })} /></div>
                                    <div className="erp-field"><label className="erp-label">{jt.side === 'purchase' ? "Vendor's Bill No" : jt.side === 'sales' ? 'Invoice No' : 'Bill / Ref No'}{jt.side === 'purchase' && <span className="req">*</span>}</label><input className="erp-input" value={form.party_bill_no || ''} onChange={e => setTax({ party_bill_no: e.target.value })} /></div>
                                    <div className="erp-field"><label className="erp-label">Bill Date</label><DualDateInput value={form.party_bill_date || ''} onChange={v => setTax({ party_bill_date: v })} defaultMode={sysCtl.date_format_entry} /></div>
                                </div>
                            )}
                        </div>

                        {/* ---- Bill Details (FastTab): amounts and accounts of the tax types ---- */}
                        {(isTax || (isTds && !billMode && !tdsSales)) && (
                            <div className="nav-fasttab">
                                <button type="button" className="nav-fasttab-head" onClick={() => setDetailOpen(o => !o)} aria-expanded={detailOpen}>
                                    <Arrow open={detailOpen} /> Bill Details
                                    {!detailOpen && <span className="nav-fasttab-sum">{isTax ? `Taxable ${r2(form.taxable_amount).toFixed(2)} · Non-taxable ${r2(form.non_taxable_amount).toFixed(2)} · VAT ${r2(form.vat_amount).toFixed(2)} · Total ${taxTotal.toFixed(2)}` : `Expense ${r2(form.tds_base_amount).toFixed(2)}`}</span>}
                                </button>
                                {detailOpen && (
                                    <div className="nav-fasttab-body">
                                        {isTax && (<>
                                            <div className="erp-field"><label className="erp-label">Taxable Amount</label><input type="number" step="0.01" className="erp-input text-right" value={form.taxable_amount} onChange={e => setTax({ taxable_amount: e.target.value })} /></div>
                                            <div className="erp-field"><label className="erp-label">VAT %</label><input type="number" step="0.01" className="erp-input text-right" value={form.vat_percent ?? ''} onChange={e => setTax({ vat_percent: e.target.value })} /></div>
                                            <div className="erp-field"><label className="erp-label">VAT Amount</label><input type="number" step="0.01" className="erp-input text-right" value={form.vat_amount} onChange={e => setTax({ vat_amount: e.target.value })} /></div>
                                            <div className="erp-field"><label className="erp-label">Non-taxable Amount</label><input type="number" step="0.01" className="erp-input text-right" value={form.non_taxable_amount} onChange={e => setTax({ non_taxable_amount: e.target.value })} /></div>
                                        </>)}
                                        <div className="erp-field"><label className="erp-label">{jt.acct}</label>
                                            <SearchablePopupSelect listKey="jv_tax_goods_picker" columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
                                                items={filterAny(ledgers, jt.purposes || [], taxAcct.goods)} getId={l => l.id} getLabel={l => l.account_name} searchKeys={['account_name', 'account_code']}
                                                value={taxAcct.goods} onChange={id => { setAutoLines(true); setTaxAcct(a => ({ ...a, goods: id })); }} placeholder="Choose account" /></div>
                                        {isTax && <div className="erp-field"><label className="erp-label">VAT A/c</label>
                                            <SearchablePopupSelect listKey="jv_tax_vat_picker" columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
                                                items={lp.filter(ledgers, 'vat', taxAcct.vat)} getId={l => l.id} getLabel={l => l.account_name} searchKeys={['account_name', 'account_code']}
                                                value={taxAcct.vat} onChange={id => { setAutoLines(true); setTaxAcct(a => ({ ...a, vat: id })); }} placeholder="VAT ledger" /></div>}
                                        {isTax && <div className="erp-field"><label className="erp-label">Bill Total</label><input className="erp-input text-right font-semibold" readOnly tabIndex={-1} value={taxTotal.toFixed(2)} /></div>}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ---- Bills without TDS (FastTab) ---- */}
                        {isTds && form.party_ledger_id && (
                            <div className="nav-fasttab">
                                <button type="button" className="nav-fasttab-head" onClick={() => setBillsOpen(o => !o)} aria-expanded={billsOpen}>
                                    <Arrow open={billsOpen} /> {tdsSales ? 'Sales Bills' : 'Purchase Bills / Additional Expenses'} without TDS
                                    <span className="nav-fasttab-sum">{shownBills.length} bill(s){billMode ? ` · ${form.tds_bills.length} chosen · base ${r2(form.tds_base_amount).toFixed(2)} · TDS ${tdsAmount.toFixed(2)}` : ''}</span>
                                </button>
                                {billsOpen && (
                                    <div className="overflow-auto my-1" style={{ maxHeight: 180 }}>
                                        <table className="erp-grid-table">
                                            <thead><tr>
                                                <th style={{ width: 30 }}><input type="checkbox" checked={shownBills.length > 0 && shownBills.every(b => (form.tds_bills || []).some(x => billKey(x) === billKey(b)))}
                                                    onChange={e => setBills(() => (e.target.checked ? shownBills.map(b => ({ ...b, tds_percent: (form.tds_bills || []).find(x => billKey(x) === billKey(b))?.tds_percent || form.tds_percent || sysCtl.default_tds_percent || 1.5 })) : []))} title="All" /></th>
                                                <th>Date</th><th>Doc No.</th><th>Type</th><th>Party Bill No.</th><th className="text-right">Bill Amount</th><th className="text-right">Base (excl. VAT)</th><th className="text-right" style={{ width: 90 }}>TDS %</th><th className="text-right">TDS</th>
                                            </tr></thead>
                                            <tbody>
                                                {shownBills.map(b => {
                                                    const sel = (form.tds_bills || []).find(x => billKey(x) === billKey(b));
                                                    return (
                                                        <tr key={billKey(b)} className={sel ? 'bg-blue-50' : ''}>
                                                            <td><input type="checkbox" checked={!!sel} onChange={() => toggleBill(b)} /></td>
                                                            <td>{formatDateForDisplay(b.doc_date, 'dual')}</td><td className="font-mono">{b.doc_no}</td><td>{b.label}</td><td>{b.party_bill_no || '—'}</td>
                                                            <td className="text-right">{Number(b.bill_amount || 0).toFixed(2)}</td><td className="text-right">{Number(b.base_amount || 0).toFixed(2)}</td>
                                                            <td>{sel ? <input type="number" step="0.001" className="erp-input text-right" value={sel.tds_percent} onChange={e => setBillPct(b, e.target.value)} /> : ''}</td>
                                                            <td className="text-right">{sel ? billTds(sel).toFixed(2) : ''}</td>
                                                        </tr>
                                                    );
                                                })}
                                                {shownBills.length === 0 && <tr><td colSpan={9} className="text-center text-gray-400">No bill of this party is waiting for TDS{tdsSales ? '' : ' - use Bill Details for TDS on an expense without a bill'}.</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ---- TDS (FastTab) ---- */}
                        <div className="nav-fasttab">
                            <button type="button" className="nav-fasttab-head" onClick={() => setTdsOpen(o => !o)} aria-expanded={tdsOpen}>
                                <Arrow open={tdsOpen} /> TDS {partySales ? '(receivable)' : '(payable)'}{!isTds && <span className="font-normal text-xs text-gray-500 ml-1">optional</span>}
                                <span className="nav-fasttab-sum">{tdsAmount > 0 ? `${Number(form.tds_percent || 0) ? `${form.tds_percent}% · ` : ''}TDS ${tdsAmount.toFixed(2)}` : 'none'}</span>
                            </button>
                            {tdsOpen && (
                                <div className="nav-fasttab-body">
                                    <div className="erp-field"><label className="erp-label">{billMode ? 'Base of Bills' : 'TDS Base'}{isTds && !billMode && !tdsSales && <span className="req">*</span>}</label><input type="number" step="0.01" className="erp-input text-right" readOnly={billMode} value={form.tds_base_amount} onChange={e => setTax({ tds_base_amount: e.target.value })} placeholder={isTds ? '' : goodsAmount.toFixed(2)} /></div>
                                    <div className="erp-field"><label className="erp-label">TDS %</label><input type="number" step="0.001" className="erp-input text-right" value={form.tds_percent} onChange={e => setTax({ tds_percent: e.target.value })} placeholder={sysCtl.default_tds_percent ? String(sysCtl.default_tds_percent) : '1.5'} /></div>
                                    <div className="erp-field"><label className="erp-label">TDS Amount</label><input type="number" step="0.01" className="erp-input text-right" value={form.tds_amount} onChange={e => setTax({ tds_amount: e.target.value })} /></div>
                                    <div className="erp-field"><label className="erp-label">TDS Ledger</label>
                                        <SearchablePopupSelect listKey="jv_tds_ledger_picker" columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
                                            items={lp.filter(ledgers, 'tds', form.tds_ledger_id)} getId={l => l.id} getLabel={l => l.account_name} searchKeys={['account_name', 'account_code']}
                                            value={form.tds_ledger_id} onChange={id => { setAutoLines(true); setForm(f => ({ ...f, tds_ledger_id: id, tds_sub_ledger_id: '' })); }} placeholder="System Control default" /></div>
                                    <div className="erp-field"><label className="erp-label">TDS Sub-Ledger</label>
                                        <SearchablePopupSelect listKey="jv_tds_subledger_picker" columns={[{ key: 'sub_ledger_code', label: 'Code' }, { key: 'sub_ledger_name', label: 'Name' }]} defaultVisibleKeys={['sub_ledger_name']}
                                            items={subLedgers.filter(x => x.main_ledger_id === (form.tds_ledger_id || defaultTdsLedger))} getId={x => x.id} getLabel={x => x.sub_ledger_name} searchKeys={['sub_ledger_name', 'sub_ledger_code']}
                                            value={form.tds_sub_ledger_id} onChange={id => { setAutoLines(true); setForm(f => ({ ...f, tds_sub_ledger_id: id, tds_ledger_id: f.tds_ledger_id || defaultTdsLedger || '' })); }} placeholder={(form.tds_ledger_id || defaultTdsLedger) ? 'None' : 'Choose the TDS ledger first'} /></div>
                                    <div className="erp-field"><label className="erp-label">{partySales ? 'Customer Pays' : isTds && (billMode || tdsSales) ? 'Entry' : 'Vendor Gets'}</label>
                                        <input className="erp-input text-right" readOnly tabIndex={-1} value={isTds && (billMode || tdsSales) ? (tdsSales ? 'Dr TDS / Cr customer' : 'Dr vendor / Cr TDS') : r2((isTax ? taxTotal : tdsBase) - tdsAmount).toFixed(2)} /></div>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 mx-3 mt-1 mb-2">
                            {!autoLines && <button type="button" className="nav-btn small" onClick={() => setAutoLines(true)}>↻ Refill voucher lines</button>}
                            <span>{autoLines ? 'Voucher lines below are filled from these - you can still edit them.' : 'Voucher lines were edited by hand.'}</span>
                        </div>
                        </>)}

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
                                                    items={lineLedgers} getId={l => l.id} getLabel={l => l.account_name}
                                                    searchKeys={['account_name', 'account_code']}
                                                    value={d.ledger_id} onChange={id => pickLineLedger(idx, id)} placeholder="Ledger"
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
                        <div className={efc.isVisible('narration') ? 'flex items-center gap-2 flex-1 mr-4' : 'hidden'}>
                            <label className="erp-label whitespace-nowrap">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                            <input list="jv-remarks-suggestions" disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} placeholder="Type, or pick a saved remark" />
                            <datalist id="jv-remarks-suggestions">{remarks.map(r => <option key={r.id} value={r.remark_text} />)}</datalist>
                        </div>
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
                storageKey="journal_voucher_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        <DocActions type="journal" api="journal-vouchers" row={row} onOpen={handleEdit} onCopy={r => handleCopyFrom(r.id)} onReverse={r => handleStatusChange(r, 'cancelled')} onDone={load} />
                        {row.status === 'posted' && <a href={`/print/journal_voucher/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="journal_voucher" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && !row.is_memo && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
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

        {auditModal && <RecordHistory table="journal_vouchers" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/journal-vouchers/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
