// =============================================
// RemarksTermsManagement.jsx
// Two reusable, pick-from-list masters: Remarks and Terms & Conditions.
// Each entry can be scoped to Sales, Purchase, or Both so a future
// document entry screen only offers the relevant ones.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

const emptyRemark = { remark_text: '', display_order: 1 };
const emptyTerm = { title: '', terms_text: '', applicable_to: 'both', display_order: 1 };

export default function RemarksTermsManagement() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState('remarks');
    const [remarks, setRemarks] = useState([]);
    const [terms, setTerms] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [remarkForm, setRemarkForm] = useState(emptyRemark);
    const [termForm, setTermForm] = useState(emptyTerm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const remarkFormRef = useRef(null);
    const termFormRef = useRef(null);
    useEnterKeyNavigation(remarkFormRef);
    useEnterKeyNavigation(termFormRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [r, t] = await Promise.all([authFetch('/api/remarks'), authFetch('/api/terms-conditions')]);
            setRemarks(r.data || []);
            setTerms(t.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForms = () => { setRemarkForm(emptyRemark); setTermForm(emptyTerm); setEditingId(null); };

    const handleRemarkSubmit = async (e) => {
        e.preventDefault();
        if (!remarkForm.remark_text.trim()) return showAlert('Remark text is required', 'danger');
        try {
            if (editingId) await authFetch(`/api/remarks/${editingId}`, { method: 'PUT', body: JSON.stringify(remarkForm) });
            else await authFetch('/api/remarks', { method: 'POST', body: JSON.stringify(remarkForm) });
            showAlert('Remark saved', 'success');
            resetForms();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleTermSubmit = async (e) => {
        e.preventDefault();
        if (!termForm.title.trim() || !termForm.terms_text.trim()) return showAlert('Title and Terms Text are required', 'danger');
        try {
            if (editingId) await authFetch(`/api/terms-conditions/${editingId}`, { method: 'PUT', body: JSON.stringify(termForm) });
            else await authFetch('/api/terms-conditions', { method: 'POST', body: JSON.stringify(termForm) });
            showAlert('Terms & Conditions saved', 'success');
            resetForms();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEditRemark = (row) => { setEditingId(row.id); setRemarkForm({ remark_text: row.remark_text, display_order: row.display_order }); setShowForm(true); };
    const handleEditTerm = (row) => { setEditingId(row.id); setTermForm({ title: row.title, terms_text: row.terms_text, applicable_to: row.applicable_to, display_order: row.display_order }); setShowForm(true); };

    const handleDeleteRemark = async (row) => {
        if (!window.confirm('Remove this remark?')) return;
        try { await authFetch(`/api/remarks/${row.id}`, { method: 'DELETE' }); showAlert('Removed', 'warning'); load(); }
        catch (err) { showAlert(err.message, 'danger'); }
    };
    const handleDeleteTerm = async (row) => {
        if (!window.confirm('Remove this term?')) return;
        try { await authFetch(`/api/terms-conditions/${row.id}`, { method: 'DELETE' }); showAlert('Removed', 'warning'); load(); }
        catch (err) { showAlert(err.message, 'danger'); }
    };

    const remarkColumns = [
        { key: 'remark_text', label: 'Remark', type: 'text' }
    ];
    const termColumns = [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'terms_text', label: 'Terms', type: 'text' },
        { key: 'applicable_to', label: 'Applicable To', type: 'text' }
    ];

    return (
        <Layout>
        <div className="max-w-4xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Remarks &amp; Terms and Conditions</h1>
                <button onClick={() => { resetForms(); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : `➕ New ${tab === 'remarks' ? 'Remark' : 'Term'}`}
                </button>
            </div>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 w-fit">
                <button onClick={() => { setTab('remarks'); resetForms(); setShowForm(false); }} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'remarks' ? 'bg-white shadow' : 'text-gray-500'}`}>Remarks</button>
                <button onClick={() => { setTab('terms'); resetForms(); setShowForm(false); }} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'terms' ? 'bg-white shadow' : 'text-gray-500'}`}>Terms &amp; Conditions</button>
            </div>

            {showForm && tab === 'remarks' && (
                <form onSubmit={handleRemarkSubmit} ref={remarkFormRef} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                    <div>
                        <label className="erp-label">Remark Text *</label>
                        <textarea className="erp-input" rows="2" value={remarkForm.remark_text} onChange={e => setRemarkForm({ ...remarkForm, remark_text: e.target.value })} required />
                    </div>
                    <div className="max-w-xs">
                        <label className="erp-label">Display Order</label>
                        <input type="number" min="1" className="erp-input" value={remarkForm.display_order} onChange={e => setRemarkForm({ ...remarkForm, display_order: e.target.value })} />
                    </div>
                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { resetForms(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">{editingId ? 'Update' : 'Create'} Remark</button>
                    </div>
                </form>
            )}

            {showForm && tab === 'terms' && (
                <form onSubmit={handleTermSubmit} ref={termFormRef} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                    <div>
                        <label className="erp-label">Title *</label>
                        <input className="erp-input" value={termForm.title} onChange={e => setTermForm({ ...termForm, title: e.target.value })} required />
                    </div>
                    <div>
                        <label className="erp-label">Terms Text *</label>
                        <textarea className="erp-input" rows="4" value={termForm.terms_text} onChange={e => setTermForm({ ...termForm, terms_text: e.target.value })} required />
                    </div>
                    <div className="grid grid-cols-2 gap-4 max-w-md">
                        <div>
                            <label className="erp-label">Applicable To</label>
                            <select className="erp-input" value={termForm.applicable_to} onChange={e => setTermForm({ ...termForm, applicable_to: e.target.value })}>
                                <option value="both">Both</option>
                                <option value="sales">Sales</option>
                                <option value="purchase">Purchase</option>
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Display Order</label>
                            <input type="number" min="1" className="erp-input" value={termForm.display_order} onChange={e => setTermForm({ ...termForm, display_order: e.target.value })} />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { resetForms(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">{editingId ? 'Update' : 'Create'} Term</button>
                    </div>
                </form>
            )}

            {tab === 'remarks' ? (
                <ReportGrid
                    columns={remarkColumns}
                    rows={remarks}
                    getId={r => r.id}
                    storageKey="remarks_grid"
                    rowActions={(row) => (
                        <div className="flex gap-2 justify-center">
                            <button onClick={() => handleEditRemark(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                            <button onClick={() => handleDeleteRemark(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                        </div>
                    )}
                />
            ) : (
                <ReportGrid
                    columns={termColumns}
                    rows={terms}
                    getId={r => r.id}
                    storageKey="terms_grid"
                    rowActions={(row) => (
                        <div className="flex gap-2 justify-center">
                            <button onClick={() => handleEditTerm(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                            <button onClick={() => handleDeleteTerm(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                        </div>
                    )}
                />
            )}
        </div>
        </Layout>
    );
}
