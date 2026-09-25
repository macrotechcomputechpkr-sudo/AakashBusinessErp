// =============================================
// FiscalYearManagement.jsx
// The backend (fiscalYearRoutes.js) already existed and was fixed earlier,
// but there was no frontend page calling it. This adds one: list fiscal
// years, create a new one (with the overlap-check error surfaced cleanly),
// set current, and close.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';

export default function FiscalYearManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ fiscal_year_code: '', start_date_eng: '', end_date_eng: '' });
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => {
        setAlert({ message, type });
        setTimeout(() => setAlert(null), 5000);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch('/api/fiscal-years');
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            await authFetch('/api/fiscal-years/create', { method: 'POST', body: JSON.stringify(form) });
            showAlert('Fiscal year created', 'success');
            setShowForm(false);
            setForm({ fiscal_year_code: '', start_date_eng: '', end_date_eng: '' });
            load();
        } catch (err) {
            // FIX (backend): overlapping date ranges now come back as a clean
            // 400 message instead of a raw Postgres exclusion-constraint error.
            showAlert(err.message, 'danger');
        }
    };

    const setCurrent = async (id) => {
        try {
            await authFetch(`/api/fiscal-years/${id}/set-current`, { method: 'PUT' });
            showAlert('Set as current fiscal year', 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const closeYear = async (id) => {
        if (!window.confirm('Closing a fiscal year locks it permanently. Continue?')) return;
        try {
            await authFetch(`/api/fiscal-years/${id}/close`, { method: 'PUT' });
            showAlert('Fiscal year closed', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const columns = [
        { key: 'fiscal_year_code', label: 'Code', type: 'text' },
        { key: 'start_date_eng', label: 'Start Date', type: 'text' },
        { key: 'end_date_eng', label: 'End Date', type: 'text' },
        { key: 'start_date_nep', label: 'Start (BS)', type: 'text' },
        { key: 'end_date_nep', label: 'End (BS)', type: 'text' },
        {
            key: 'status', label: 'Status', type: 'text',
            render: (r) => r.is_closed
                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-700">Closed</span>
                : r.is_current
                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Current</span>
                : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Active</span>
        }
    ];

    return (
        <Layout>
            <div className="max-w-5xl mx-auto p-4">
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-2xl font-bold">Fiscal Years</h1>
                    <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                        {showForm ? 'Close Form' : '➕ New Fiscal Year'}
                    </button>
                </div>

                {alert && (
                    <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                        alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                        alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                        'bg-yellow-50 border-yellow-500 text-yellow-800'
                    }`}>
                        {alert.message}
                    </div>
                )}

                {showForm && (
                    <form ref={formRef} onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="erp-label">Fiscal Year Code *</label>
                                <input className="erp-input" placeholder="FY2082-83"
                                    value={form.fiscal_year_code} onChange={e => setForm({ ...form, fiscal_year_code: e.target.value })} required />
                            </div>
                            <div>
                                <label className="erp-label">Start Date *</label>
                                <input type="date" className="erp-input"
                                    value={form.start_date_eng} onChange={e => setForm({ ...form, start_date_eng: e.target.value })} required />
                            </div>
                            <div>
                                <label className="erp-label">End Date *</label>
                                <input type="date" className="erp-input"
                                    value={form.end_date_eng} onChange={e => setForm({ ...form, end_date_eng: e.target.value })} required />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">Create</button>
                        </div>
                    </form>
                )}

                <ReportGrid
                    columns={columns}
                    rows={rows}
                    getId={(r) => r.id}
                    storageKey="fiscal_year_grid"
                    rowActions={(row) => (
                        <div className="flex gap-2 justify-center">
                            {!row.is_current && !row.is_closed && (
                                <button onClick={() => setCurrent(row.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Set Current</button>
                            )}
                            {!row.is_closed && (
                                <button onClick={() => closeYear(row.id)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Close</button>
                            )}
                        </div>
                    )}
                />
                {loading && <p className="text-sm text-gray-400 mt-2">Loading…</p>}
            </div>
        </Layout>
    );
}
