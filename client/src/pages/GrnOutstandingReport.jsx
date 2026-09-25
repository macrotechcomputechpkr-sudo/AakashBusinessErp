// =============================================
// GrnOutstandingReport.jsx
// "GRN1 has 5 items, some converted to Bill, some still outstanding" -
// reads v_grn_outstanding (one row per GRN line with its own
// outstanding qty/amount, plus Ref No and Batch No living right on the
// line), filterable by vendor and date range.
// =============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

export default function GrnOutstandingReport() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [vendorName, setVendorName] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [alert, setAlert] = useState(null);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (vendorName) params.set('vendor_name', vendorName);
            if (fromDate) params.set('from_date', fromDate);
            if (toDate) params.set('to_date', toDate);
            const res = await authFetch(`/api/grn-outstanding-report?${params}`);
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const totalOutstandingAmount = rows.reduce((sum, r) => sum + (Number(r.amount_outstanding) || 0), 0);

    const columns = [
        { key: 'grn_doc_no', label: 'GRN No.', type: 'text' },
        { key: 'grn_date', label: 'Date', type: 'text' },
        { key: 'vendor_name', label: 'Vendor', type: 'text', render: r => r.vendor_name || '—' },
        { key: 'product_name', label: 'Product', type: 'text' },
        { key: 'batch_no', label: 'Batch No', type: 'text', render: r => r.batch_no || '—' },
        { key: 'source_doc_no', label: 'Ref No', type: 'text', render: r => r.source_doc_no || '—' },
        { key: 'qty', label: 'Received Qty', type: 'number' },
        { key: 'qty_billed', label: 'Billed Qty', type: 'number' },
        { key: 'qty_outstanding', label: 'Outstanding Qty', type: 'number' },
        { key: 'amount_outstanding', label: 'Outstanding Amount', type: 'number' },
        { key: 'grn_status', label: 'GRN Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📊 GRN Outstanding Report</span>
            </div>
            <p className="text-xs text-gray-400 px-4 pt-3">
                Every GRN line not yet fully converted to a Bill - "5 items received, some billed, some still
                outstanding" answered directly, per line, with its own Batch No and Ref No.
            </p>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                <div className="erp-field">
                    <label className="erp-label">Vendor</label>
                    <input className="erp-input" value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Search vendor name" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">From Date</label>
                    <input type="date" className="erp-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                </div>
                <div className="erp-field">
                    <label className="erp-label">To Date</label>
                    <input type="date" className="erp-input" value={toDate} onChange={e => setToDate(e.target.value)} />
                </div>
                <div className="erp-field justify-end">
                    <button onClick={load} className="erp-btn primary">🔍 Filter</button>
                </div>
            </div>

            <div className="p-4">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-500">{loading ? 'Loading…' : `${rows.length} outstanding line(s)`}</span>
                    <span className="text-sm font-semibold">Total Outstanding: {totalOutstandingAmount.toFixed(2)}</span>
                </div>
                <ReportGrid columns={columns} rows={rows} getId={r => r.detail_id} storageKey="grn_outstanding_report_grid" />
            </div>
        </div>
        </div>
        </Layout>
    );
}
