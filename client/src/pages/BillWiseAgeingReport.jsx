// =============================================
// BillWiseAgeingReport.jsx
// "Tesko Reflection Ageing Report ma garaune" - every bill-wise
// reference still carrying a balance, bucketed by how many days old it
// is, filterable by vendor, nature (Dr/Cr), and date range.
// =============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

const AGE_BUCKETS = ['0-30', '31-60', '61-90', '90+'];

export default function BillWiseAgeingReport() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);
    const [vendorName, setVendorName] = useState('');
    const [nature, setNature] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [companyId, setCompanyId] = useState('');
    const [companies, setCompanies] = useState([]);
    useEffect(() => { authFetch('/api/product-companies').then(r => setCompanies(r.data || [])).catch(() => {}); }, [authFetch]);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (vendorName) params.set('vendor_name', vendorName);
            if (nature) params.set('nature', nature);
            if (fromDate) params.set('from_date', fromDate);
            if (toDate) params.set('to_date', toDate);
            if (companyId) params.set('product_company_id', companyId);
            const res = await authFetch(`/api/bill-wise-ageing-report?${params}`);
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const totalRemaining = rows.reduce((s, r) => s + Number(r.remaining_amount), 0);
    const bucketTotals = AGE_BUCKETS.map(b => ({
        bucket: b,
        total: rows.filter(r => r.age_bucket === b).reduce((s, r) => s + Number(r.remaining_amount), 0)
    }));

    const columns = [
        { key: 'vendor_name', label: 'Vendor', type: 'text' },
        { key: 'product_company_name', label: 'Product Company', type: 'text' },
        { key: 'source_doc_no', label: 'Doc No.', type: 'text' },
        { key: 'source_date', label: 'Date', type: 'text' },
        { key: 'source_type', label: 'Document Type', type: 'text', render: r => r.source_type.replace('purchase_', '').replace(/_/g, ' ') },
        { key: 'nature', label: 'Nature', type: 'text', render: r => r.nature === 'dr' ? 'Dr' : 'Cr' },
        { key: 'total_amount', label: 'Total Amount', type: 'number' },
        { key: 'allocated_amount', label: 'Settled Amount', type: 'number' },
        { key: 'remaining_amount', label: 'Outstanding', type: 'number' },
        { key: 'age_days', label: 'Age (days)', type: 'number' },
        { key: 'age_bucket', label: 'Bucket', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📅 Bill-wise Ageing Report</span>
            </div>
            <p className="text-xs text-gray-400 px-4 pt-3">
                Every voucher-wise reference still carrying an outstanding balance, bucketed by age - what's still owed
                to or by each vendor, and how old it is.
            </p>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="erp-topbar grid-cols-1 md:grid-cols-5">
                <div className="erp-field">
                    <label className="erp-label">Vendor</label>
                    <input className="erp-input" value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Search vendor" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Nature</label>
                    <select className="erp-select" value={nature} onChange={e => setNature(e.target.value)}>
                        <option value="">Both</option>
                        <option value="cr">Cr (we owe them)</option>
                        <option value="dr">Dr (they owe us)</option>
                    </select>
                </div>
                <div className="erp-field">
                    <label className="erp-label">From Date</label>
                    <input type="date" className="erp-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                </div>
                <div className="erp-field">
                    <label className="erp-label">To Date</label>
                    <input type="date" className="erp-input" value={toDate} onChange={e => setToDate(e.target.value)} />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Product Company</label>
                    <select className="erp-select" value={companyId} onChange={e => setCompanyId(e.target.value)}>
                        <option value="">All companies</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </select>
                </div>
                <div className="erp-field justify-end">
                    <button onClick={load} className="erp-btn primary">🔍 Filter</button>
                </div>
            </div>

            <div className="px-4 pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {bucketTotals.map(b => (
                        <div key={b.bucket} className="border rounded-lg p-3 text-center">
                            <div className="text-xs text-gray-400 uppercase">{b.bucket} days</div>
                            <div className="text-lg font-semibold">{b.total.toFixed(2)}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="p-4 pt-0">
                <div className="flex justify-between items-center mb-2 text-sm">
                    <span className="text-gray-500">{loading ? 'Loading…' : `${rows.length} outstanding reference(s)`}</span>
                    <span className="font-semibold">Total Outstanding: {totalRemaining.toFixed(2)}</span>
                </div>
                <ReportGrid columns={columns} rows={rows} getId={r => r.reference_id} storageKey="bill_wise_ageing_report_grid" />
            </div>
        </div>
        </div>
        </Layout>
    );
}
