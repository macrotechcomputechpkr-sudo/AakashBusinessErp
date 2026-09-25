// =============================================
// LcRegister.jsx
// "Lc Mapping Garne Xuttai Option Pani Dine" - maintain LCs per
// supplier and map/unmap Purchase Bills against them at any time,
// independently of the prompt shown while saving a Purchase Bill.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';

const emptyForm = { lc_number: '', vendor_ledger_id: '', bank_ledger_id: '', lc_bank_name: '', lc_amount: '', margin_amount: '', currency: 'NPR', issue_date: '', expiry_date: '', narration: '' };
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LcRegister() {
    const { authFetch } = useAuth();
    const enterFormRef0 = useRef(null);
    useEnterKeyNavigation(enterFormRef0);
    const [lcs, setLcs] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [statusFilter, setStatusFilter] = useState('open');
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [mappingLc, setMappingLc] = useState(null);
    const [mappings, setMappings] = useState([]);
    const [mappable, setMappable] = useState([]);
    const [mapAmounts, setMapAmounts] = useState({});
    const [alert, setAlert] = useState(null);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [lcRes, ldg] = await Promise.all([
                authFetch(`/api/letters-of-credit${statusFilter ? `?status=${statusFilter}` : ''}`),
                authFetch('/api/ledger-accounts?pageSize=2000')
            ]);
            setLcs(lcRes.data || []);
            setLedgers(ldg.data || []);
        } catch (err) { showAlert(err.message, 'danger'); }
    }, [authFetch, statusFilter]);
    useEffect(() => { load(); }, [load]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const payload = { ...form, lc_amount: Number(form.lc_amount) || 0, margin_amount: Number(form.margin_amount) || 0 };
            if (editingId) await authFetch(`/api/letters-of-credit/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
            else await authFetch('/api/letters-of-credit', { method: 'POST', body: JSON.stringify(payload) });
            showAlert(editingId ? 'LC updated' : 'LC created', 'success');
            setForm(emptyForm); setEditingId(null); setShowForm(false); load();
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    const handleEdit = (lc) => {
        setEditingId(lc.id);
        setForm(Object.fromEntries(Object.keys(emptyForm).map(k => [k, lc[k] ?? ''])));
        setShowForm(true);
    };

    const setStatus = async (lc, status) => {
        try {
            if (status === 'cancelled') await authFetch(`/api/letters-of-credit/${lc.id}`, { method: 'DELETE' });
            else await authFetch(`/api/letters-of-credit/${lc.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
            showAlert(`LC ${status === 'open' ? 'reopened' : status}`, 'success'); load();
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    const openMapping = async (lc) => {
        setMappingLc(lc);
        try {
            const [m, b] = await Promise.all([authFetch(`/api/letters-of-credit/${lc.id}/mappings`), authFetch(`/api/letters-of-credit/${lc.id}/mappable-bills`)]);
            setMappings(m.data || []);
            setMappable(b.data || []);
            setMapAmounts(Object.fromEntries((b.data || []).map(bill => [bill.id, Math.min(bill.unmapped_amount, lc.remaining_amount).toFixed(2)])));
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    const refreshMapping = async () => {
        const res = await authFetch(`/api/letters-of-credit${statusFilter ? `?status=${statusFilter}` : ''}`);
        setLcs(res.data || []);
        const updated = (res.data || []).find(l => l.id === mappingLc.id) || mappingLc;
        await openMapping(updated);
    };

    const mapBill = async (bill) => {
        try {
            const r = await authFetch(`/api/letters-of-credit/${mappingLc.id}/map`, { method: 'POST', body: JSON.stringify({ purchase_bill_id: bill.id, mapped_amount: Number(mapAmounts[bill.id]) }) });
            showAlert(r.message, 'success'); refreshMapping();
        } catch (err) { showAlert(err.message, 'danger'); }
    };
    const unmap = async (m) => {
        if (!window.confirm(`Remove ${m.bill?.doc_no} from this LC?`)) return;
        try {
            await authFetch(`/api/lc-mappings/${m.id}`, { method: 'DELETE' });
            showAlert('Mapping removed', 'warning'); refreshMapping();
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    const ledgerPicker = (key, label) => (
        <div className="erp-field">
            <label className="erp-label">{label}</label>
            <SearchablePopupSelect listKey={`lc_${key}`} columns={[{ key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']}
                items={ledgers} getId={l => l.id} getLabel={l => l.account_name} searchKeys={['account_name', 'account_code']}
                value={form[key]} onChange={v => setForm(f => ({ ...f, [key]: v }))} placeholder="Select" />
        </div>
    );

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🏦 LC Register & Mapping</span>
                <div className="erp-header-actions">
                    <button type="button" onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(s => !s); }} className={`erp-header-btn ${showForm ? '' : 'primary'}`}>{showForm ? '✕ Close' : '➕ New LC'}</button>
                </div>
            </div>
            {alert && <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm border-l-4 ${alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' : alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 'bg-yellow-50 border-yellow-500 text-yellow-800'}`}>{alert.message}</div>}

            <div className="erp-tab-content">
                {showForm && (
                    <form ref={enterFormRef0} onSubmit={handleSubmit} className="border rounded-lg p-3 mb-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div className="erp-field"><label className="erp-label">LC Number <span className="req">*</span></label><input className="erp-input" value={form.lc_number} onChange={e => setForm(f => ({ ...f, lc_number: e.target.value }))} required /></div>
                            {!editingId && ledgerPicker('vendor_ledger_id', 'Supplier *')}
                            {ledgerPicker('bank_ledger_id', 'Bank Ledger')}
                            <div className="erp-field"><label className="erp-label">Bank Name</label><input className="erp-input" value={form.lc_bank_name} onChange={e => setForm(f => ({ ...f, lc_bank_name: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">LC Amount</label><input type="number" step="0.01" className="erp-input" value={form.lc_amount} onChange={e => setForm(f => ({ ...f, lc_amount: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">Margin Amount</label><input type="number" step="0.01" className="erp-input" value={form.margin_amount} onChange={e => setForm(f => ({ ...f, margin_amount: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">Currency</label><input className="erp-input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">Issue Date</label><input type="date" className="erp-input" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">Expiry Date</label><input type="date" className="erp-input" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
                            <div className="erp-field md:col-span-3"><label className="erp-label">Narration</label><input className="erp-input" value={form.narration} onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} /></div>
                        </div>
                        <div className="flex justify-end gap-2 mt-3">
                            <button type="button" onClick={() => setShowForm(false)} className="erp-btn">Cancel</button>
                            <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Create'}</button>
                        </div>
                    </form>
                )}

                <div className="flex items-center gap-2 mb-3">
                    <label className="text-xs font-semibold text-gray-500">Status:</label>
                    <select className="erp-select max-w-xs" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                        <option value="open">Open</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option><option value="">All</option>
                    </select>
                </div>

                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>LC No</th><th>Supplier</th><th>Bank</th><th>Amount</th><th>Used</th><th>Remaining</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                            {lcs.map(lc => (
                                <tr key={lc.id} className={lc.is_expired && lc.status === 'open' ? 'bg-red-50' : ''}>
                                    <td>{lc.lc_number}</td><td>{lc.vendor_name}</td><td>{lc.lc_bank_name || '—'}</td>
                                    <td>{fmt(lc.lc_amount)}</td><td>{fmt(lc.utilized_amount)}</td><td className="font-semibold">{fmt(lc.remaining_amount)}</td>
                                    <td>{lc.expiry_date || '—'}{lc.is_expired ? <span className="text-xs text-red-600"> expired</span> : null}</td>
                                    <td className="capitalize">{lc.status}</td>
                                    <td><div className="flex gap-1 justify-center flex-wrap">
                                        <button onClick={() => openMapping(lc)} className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🔗 Map Bills</button>
                                        <button onClick={() => handleEdit(lc)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                        {lc.status === 'open' && <button onClick={() => setStatus(lc, 'closed')} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">Close</button>}
                                        {lc.status === 'closed' && <button onClick={() => setStatus(lc, 'open')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Reopen</button>}
                                        {lc.status !== 'cancelled' && lc.utilized_amount === 0 && <button onClick={() => setStatus(lc, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                                    </div></td>
                                </tr>
                            ))}
                            {lcs.length === 0 && <tr><td colSpan={9} className="text-center text-gray-400 py-6">No LCs.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        {mappingLc && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">🔗 LC {mappingLc.lc_number} — {mappingLc.vendor_name}</span></div>
                    <div className="p-4">
                        <p className="text-sm mb-3">Amount <b>{fmt(mappingLc.lc_amount)}</b> · Used <b>{fmt(mappingLc.utilized_amount)}</b> · Remaining <b className="text-green-700">{fmt(mappingLc.remaining_amount)}</b></p>

                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Mapped Bills</p>
                        <table className="erp-grid-table mb-4">
                            <thead><tr><th>Bill No</th><th>Date</th><th>Bill Total</th><th>Mapped</th><th></th></tr></thead>
                            <tbody>
                                {mappings.map(m => (
                                    <tr key={m.id}><td>{m.bill?.doc_no}</td><td>{m.bill?.doc_date}</td><td>{fmt(m.bill?.total_amount)}</td><td className="font-semibold">{fmt(m.mapped_amount)}</td>
                                        <td><button onClick={() => unmap(m)} className="text-xs text-red-600">✕ Remove</button></td></tr>
                                ))}
                                {mappings.length === 0 && <tr><td colSpan={5} className="text-center text-gray-400 py-3">No bills mapped yet.</td></tr>}
                            </tbody>
                        </table>

                        {mappingLc.status === 'open' && (
                            <>
                                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Supplier's Bills Not Fully Covered by an LC</p>
                                <table className="erp-grid-table">
                                    <thead><tr><th>Bill No</th><th>Date</th><th>Bill Total</th><th>Already Covered</th><th>Uncovered</th><th>Map Amount</th><th></th></tr></thead>
                                    <tbody>
                                        {mappable.map(b => (
                                            <tr key={b.id}><td>{b.doc_no}</td><td>{b.doc_date}</td><td>{fmt(b.total_amount)}</td><td>{fmt(b.lc_covered_amount)}</td><td>{fmt(b.unmapped_amount)}</td>
                                                <td><input type="number" step="0.01" className="erp-input" style={{ width: 110 }} value={mapAmounts[b.id] ?? ''} onChange={e => setMapAmounts(a => ({ ...a, [b.id]: e.target.value }))} /></td>
                                                <td><button onClick={() => mapBill(b)} disabled={mappingLc.remaining_amount <= 0} className="px-2 py-1 bg-purple-600 text-white rounded text-xs">Map</button></td></tr>
                                        ))}
                                        {mappable.length === 0 && <tr><td colSpan={7} className="text-center text-gray-400 py-3">No uncovered posted bills for this supplier.</td></tr>}
                                    </tbody>
                                </table>
                            </>
                        )}
                    </div>
                    <div className="erp-bottombar"><div /><div className="erp-bottombar-actions"><button type="button" onClick={() => { setMappingLc(null); load(); }} className="erp-btn primary">Done</button></div></div>
                </div>
            </div>
        )}
        </div>
        </Layout>
    );
}
