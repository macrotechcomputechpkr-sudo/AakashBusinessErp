// =============================================
// OutstandingReport.jsx
// "Delivery Huna Baki, Bill Ma Convert Huna Baki, Bill Ko Payment
// Aauna Baaki" - one page, six stages across the Sales and Purchase
// chains. Quantity stages show pending qty per line; payment stages
// show pending amount per bill with overdue days and aging buckets.
// =============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import SavedViewsBar from '../components/SavedViewsBar';
import Layout from '../components/Layout';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';

const FILTER_SOURCES = {
    party: { endpoint: '/api/ledger-accounts?pageSize=500', getLabel: i => i.account_name },
    agent: { endpoint: '/api/salesman-agents', getLabel: i => i.agent_name },
    area: { endpoint: '/api/areas', getLabel: i => i.area_name },
    route: { endpoint: '/api/routes', getLabel: i => i.route_name },
    company: { endpoint: '/api/product-companies', getLabel: i => i.company_name }
};

export default function OutstandingReport() {
    const { authFetch } = useAuth();
    const [stages, setStages] = useState([]);
    const [stage, setStage] = useState('sales_pending_delivery');
    const [masters, setMasters] = useState({ party: [], agent: [], area: [], route: [] });
    const defaultFilters = () => ({ date_from: '', date_to: '', as_of: new Date().toISOString().slice(0, 10), party_ledger_id: '', agent_id: '', area_id: '', route_id: '', product_company_id: '' });
    const [filters, setFilters] = useState(defaultFilters());
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const loadMasters = useCallback(async () => {
        try {
            const [st, ...lists] = await Promise.all([
                authFetch('/api/outstanding-report/stages'),
                ...Object.values(FILTER_SOURCES).map(s => authFetch(s.endpoint))
            ]);
            setStages(st.data || []);
            const keys = Object.keys(FILTER_SOURCES);
            setMasters(Object.fromEntries(keys.map((k, i) => [k, lists[i].data || []])));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { loadMasters(); }, [loadMasters]);

    const handleSearch = async (override) => {
        const useStage = override?.stage || stage;
        const useFilters = override?.filters || filters;
        setLoading(true);
        try {
            const params = new URLSearchParams({ stage: useStage });
            Object.entries(useFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
            const res = await authFetch(`/api/outstanding-report?${params}`);
            setResult(res.data);
            if ((res.data?.rows || []).length === 0) showAlert('Nothing outstanding for these filters', 'info');
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    };

    const picker = (key, paramKey, label) => (
        <div className="erp-field">
            <label className="erp-label">{label} <span className="text-xs text-gray-400 normal-case">(optional)</span></label>
            <SearchablePopupSelect
                listKey={`outstanding_${key}_picker`}
                columns={[{ key: 'label', label: 'Name' }]}
                defaultVisibleKeys={['label']}
                items={(masters[key] || []).map(i => ({ ...i, label: FILTER_SOURCES[key].getLabel(i) }))}
                getId={i => i.id} getLabel={i => FILTER_SOURCES[key].getLabel(i)}
                searchKeys={['label']}
                value={filters[paramKey]} onChange={v => setFilters(f => ({ ...f, [paramKey]: v }))} placeholder="Any"
            />
        </div>
    );

    const isSales = stage.startsWith('sales_');
    const rows = result?.rows || [];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">⏳ Outstanding Report</span>
            </div>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="erp-tab-content">
                <SavedViewsBar
                    reportKey="outstanding_report"
                    // "As of" is always today when a saved view opens, so aging stays current.
                    getConfig={() => ({ stage, filters: { ...filters, as_of: '' } })}
                    onApply={cfg => {
                        const f = { ...defaultFilters(), ...(cfg.filters || {}), as_of: new Date().toISOString().slice(0, 10) };
                        const st = cfg.stage || 'sales_pending_delivery';
                        setStage(st); setFilters(f); handleSearch({ stage: st, filters: f });
                    }}
                    onReset={() => { setStage('sales_pending_delivery'); setFilters(defaultFilters()); setResult(null); }}
                />
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                    <div className="erp-field md:col-span-2">
                        <label className="erp-label">Outstanding Type</label>
                        <select className="erp-select" value={stage} onChange={e => { setStage(e.target.value); setResult(null); }}>
                            <optgroup label="Sales">
                                {stages.filter(s => s.key.startsWith('sales_')).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </optgroup>
                            <optgroup label="Purchase">
                                {stages.filter(s => s.key.startsWith('purchase_')).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </optgroup>
                        </select>
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Date From</label>
                        <input type="date" className="erp-input" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Date To</label>
                        <input type="date" className="erp-input" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} />
                    </div>
                    {picker('party', 'party_ledger_id', isSales ? 'Customer' : 'Supplier')}
                    {picker('agent', 'agent_id', 'Agent')}
                    {picker('area', 'area_id', 'Area')}
                    {picker('route', 'route_id', 'Route')}
                    {picker('company', 'product_company_id', 'Product Company')}
                    <div className="erp-field">
                        <label className="erp-label">Aging As Of</label>
                        <input type="date" className="erp-input" value={filters.as_of} onChange={e => setFilters(f => ({ ...f, as_of: e.target.value }))} />
                    </div>
                </div>
                <button type="button" onClick={() => handleSearch()} disabled={loading} className="erp-btn primary mb-4">{loading ? 'Loading…' : '🔍 Show Outstanding'}</button>

                {result?.kind === 'payment' && rows.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        {Object.entries(result.aging || {}).map(([bucket, amt]) => (
                            <div key={bucket} className={`border rounded-lg p-3 ${bucket === '90+' && amt > 0 ? 'border-red-300 bg-red-50' : ''}`}>
                                <p className="text-xs text-gray-500">{bucket} days</p>
                                <p className="text-lg font-semibold">{Number(amt).toFixed(2)}</p>
                            </div>
                        ))}
                    </div>
                )}

                {rows.length > 0 && result.kind === 'qty' && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead>
                                <tr><th>Date</th><th>Doc No</th><th>{isSales ? 'Customer' : 'Supplier'}</th><th>Product</th><th>Qty</th><th>{rows[0].converted_label}</th><th>Pending Qty</th><th>Rate</th><th>Pending Amount</th><th>Days</th></tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={i} className={r.days_overdue > 0 ? 'bg-red-50' : ''}>
                                        <td>{formatDateForDisplay(r.doc_date, 'dual')}</td>
                                        <td>{r.doc_no}</td>
                                        <td>{r.party_name}</td>
                                        <td>{r.product_name}{r.batch_no ? <span className="text-xs text-gray-400"> ({r.batch_no})</span> : null}</td>
                                        <td>{r.qty} {r.uom || ''}{r.dual && r.alt_qty ? <span className="text-xs text-gray-500"> + {r.alt_qty} pcs</span> : null}</td>
                                        <td>{r.converted_qty}{r.dual && r.converted_alt_qty ? <span className="text-xs text-gray-500"> + {r.converted_alt_qty} pcs</span> : null}</td>
                                        <td className="font-semibold">{r.outstanding_qty}{r.dual && r.outstanding_alt_qty ? <span className="text-xs text-gray-500"> + {r.outstanding_alt_qty} pcs</span> : null}</td>
                                        <td>{Number(r.rate).toFixed(2)}</td>
                                        <td className="font-semibold">{Number(r.outstanding_amount).toFixed(2)}</td>
                                        <td>{r.days_pending}{r.days_overdue > 0 ? <span className="text-xs text-red-600"> ({r.days_overdue} overdue)</span> : null}</td>
                                    </tr>
                                ))}
                                <tr className="font-semibold bg-slate-50">
                                    <td colSpan={4}>Total</td>
                                    <td>{result.totals.qty}</td><td>{result.totals.converted_qty}</td><td>{result.totals.outstanding_qty}</td><td></td>
                                    <td>{Number(result.totals.outstanding_amount).toFixed(2)}</td><td></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}

                {rows.length > 0 && result.kind === 'payment' && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead>
                                <tr><th>Bill Date</th><th>Bill No</th><th>{isSales ? 'Customer' : 'Supplier'}</th><th>Due Date</th><th>Bill Amount</th><th>{isSales ? 'Received' : 'Paid'}</th><th>Outstanding</th><th>Days</th></tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={i} className={r.days_overdue > 0 ? 'bg-red-50' : ''}>
                                        <td>{formatDateForDisplay(r.doc_date, 'dual')}</td>
                                        <td>{r.doc_no}</td>
                                        <td>{r.party_name}</td>
                                        <td>{r.due_date ? formatDateForDisplay(r.due_date, 'dual') : '—'}</td>
                                        <td>{Number(r.bill_amount).toFixed(2)}</td>
                                        <td>{Number(r.settled_amount).toFixed(2)}</td>
                                        <td className="font-semibold">{Number(r.outstanding_amount).toFixed(2)}</td>
                                        <td>{r.days_pending}{r.days_overdue > 0 ? <span className="text-xs text-red-600"> ({r.days_overdue} overdue)</span> : null}</td>
                                    </tr>
                                ))}
                                <tr className="font-semibold bg-slate-50">
                                    <td colSpan={4}>Total</td>
                                    <td>{Number(result.totals.bill_amount).toFixed(2)}</td>
                                    <td>{Number(result.totals.settled_amount).toFixed(2)}</td>
                                    <td>{Number(result.totals.outstanding_amount).toFixed(2)}</td><td></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}

                {result && rows.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">Nothing outstanding for these filters.</p>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
