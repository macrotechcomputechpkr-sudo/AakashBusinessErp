// =============================================
// ProductRateHistory.jsx
// "selective Products Choose Garda Tesko History Herna Milne Gari" -
// a standalone browser, not tied to filling in one row of a live
// transaction: pick one or more products, optionally a customer/
// vendor and date range, and see every posted Bill's rate, discount
// (amount and percent), and free-qty for those products.
// =============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';

const ALL_COLUMNS = [
    { key: 'doc_date', label: 'Date' },
    { key: 'doc_no', label: 'Bill No' },
    { key: 'source', label: 'Source' },
    { key: 'party_name', label: 'Party' },
    { key: 'product_name_snapshot', label: 'Product' },
    { key: 'qty', label: 'Qty' },
    { key: 'rate', label: 'Rate' },
    { key: 'discount_percent', label: 'Disc %' },
    { key: 'discount_amount', label: 'Disc Amt' },
    { key: 'free', label: 'Free' },
    { key: 'amount', label: 'Amount' },
    { key: 'batch_no', label: 'Batch' }
];

export default function ProductRateHistory() {
    const { authFetch } = useAuth();
    const [products, setProducts] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [selectedProductIds, setSelectedProductIds] = useState([]);
    const [side, setSide] = useState('both');
    const [partyLedgerId, setPartyLedgerId] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);
    const [visibleColumns, setVisibleColumns] = useState(Object.fromEntries(ALL_COLUMNS.map(c => [c.key, true])));
    const [showColumnPicker, setShowColumnPicker] = useState(false);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const loadMasters = useCallback(async () => {
        try {
            const [prod, ldg] = await Promise.all([
                authFetch('/api/products'),
                authFetch('/api/ledger-accounts?pageSize=500')
            ]);
            setProducts(prod.data || []);
            setCustomers(ldg.data || []);
            setVendors(ldg.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { loadMasters(); }, [loadMasters]);

    const toggleProduct = (id) => setSelectedProductIds(cur => cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
    const toggleColumn = (key) => setVisibleColumns(v => ({ ...v, [key]: !v[key] }));
    const toggleAllColumns = (value) => setVisibleColumns(Object.fromEntries(ALL_COLUMNS.map(c => [c.key, value])));

    const handleSearch = async () => {
        if (selectedProductIds.length === 0) return showAlert('Select at least one product', 'danger');
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('product_ids', selectedProductIds.join(','));
            if (side !== 'both') params.set('side', side);
            if (partyLedgerId) {
                if (side === 'purchase') params.set('vendor_ledger_id', partyLedgerId);
                else params.set('customer_ledger_id', partyLedgerId);
            }
            if (dateFrom) params.set('date_from', dateFrom);
            if (dateTo) params.set('date_to', dateTo);
            const res = await authFetch(`/api/product-rate-history?${params}`);
            setResults(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    };

    const freeDisplay = (h) => (h.free_qty || h.free_alt_qty)
        ? `${h.free_qty || 0} ${h.uom_name_snapshot || ''}${h.free_alt_qty ? ` + ${h.free_alt_qty} ${h.alt_unit_name || ''}` : ''}`
        : '—';
    const qtyDisplay = (h) => `${h.qty}${h.alt_qty ? ` + ${h.alt_qty} ${h.alt_unit_name || ''}` : ''} ${h.uom_name_snapshot || ''}`;

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📜 Product Rate & Discount History</span>
            </div>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="erp-tab-content">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                    <div className="erp-field md:col-span-2">
                        <label className="erp-label">Products <span className="req">*</span> <span className="text-xs text-gray-400 normal-case">(select one or more)</span></label>
                        <div className="border rounded-lg max-h-40 overflow-y-auto p-2">
                            {products.map(p => (
                                <label key={p.id} className="flex items-center gap-2 text-sm py-0.5">
                                    <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProduct(p.id)} />
                                    {p.product_name} <span className="text-xs text-gray-400">({p.product_code})</span>
                                </label>
                            ))}
                        </div>
                        {selectedProductIds.length > 0 && <p className="text-xs text-gray-500 mt-1">{selectedProductIds.length} product(s) selected</p>}
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Side</label>
                        <select className="erp-select" value={side} onChange={e => { setSide(e.target.value); setPartyLedgerId(''); }}>
                            <option value="both">Both Sales & Purchase</option>
                            <option value="sales">Sales only</option>
                            <option value="purchase">Purchase only</option>
                        </select>
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">{side === 'purchase' ? 'Vendor' : 'Customer'} <span className="text-xs text-gray-400 normal-case">(optional)</span></label>
                        <SearchablePopupSelect
                            listKey="rate_history_party_picker"
                            columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                            defaultVisibleKeys={['account_name']}
                            items={side === 'purchase' ? vendors : customers} getId={c => c.id} getLabel={c => c.account_name}
                            searchKeys={['account_name', 'account_code']}
                            value={partyLedgerId} onChange={setPartyLedgerId} placeholder="Any"
                        />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Date From</label>
                        <input type="date" className="erp-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Date To</label>
                        <input type="date" className="erp-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                    </div>
                </div>
                <div className="flex items-center gap-2 mb-4">
                    <button type="button" onClick={handleSearch} disabled={loading} className="erp-btn primary">{loading ? 'Searching…' : '🔍 Search History'}</button>
                    <button type="button" onClick={() => setShowColumnPicker(s => !s)} className="erp-btn">☰ Columns</button>
                </div>

                {showColumnPicker && (
                    <div className="border rounded-lg p-3 mb-4 bg-slate-50">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase">Show/Hide Columns</span>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => toggleAllColumns(true)} className="text-xs text-blue-600 underline">Mark All</button>
                                <button type="button" onClick={() => toggleAllColumns(false)} className="text-xs text-blue-600 underline">Unmark All</button>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                            {ALL_COLUMNS.map(c => (
                                <label key={c.key} className="flex items-center gap-1.5 text-sm">
                                    <input type="checkbox" checked={visibleColumns[c.key]} onChange={() => toggleColumn(c.key)} />
                                    {c.label}
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {results !== null && (
                    results.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">No history found for the selected filters.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table">
                                <thead>
                                    <tr>
                                        {ALL_COLUMNS.filter(c => visibleColumns[c.key]).map(c => <th key={c.key}>{c.label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((h, i) => (
                                        <tr key={i}>
                                            {visibleColumns.doc_date && <td>{formatDateForDisplay(h.doc_date, 'dual')}</td>}
                                            {visibleColumns.doc_no && <td>{h.doc_no}</td>}
                                            {visibleColumns.source && <td className="text-xs text-gray-400">{h.source}</td>}
                                            {visibleColumns.party_name && <td>{h.party_name || '—'}</td>}
                                            {visibleColumns.product_name_snapshot && <td>{h.product_name_snapshot}</td>}
                                            {visibleColumns.qty && <td>{qtyDisplay(h)}</td>}
                                            {visibleColumns.rate && <td>{Number(h.rate).toFixed(2)}{h.rate_basis ? ` /${h.rate_basis}` : ''}</td>}
                                            {visibleColumns.discount_percent && <td>{Number(h.discount_percent || 0).toFixed(2)}</td>}
                                            {visibleColumns.discount_amount && <td>{Number(h.discount_amount || 0).toFixed(2)}</td>}
                                            {visibleColumns.free && <td>{freeDisplay(h)}</td>}
                                            {visibleColumns.amount && <td>{Number(h.amount).toFixed(2)}</td>}
                                            {visibleColumns.batch_no && <td>{h.batch_no || '—'}</td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
