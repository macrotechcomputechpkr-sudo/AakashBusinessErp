// =============================================
// UniversalRegister.jsx
// "Sabai module ko register banau...Date Selection Dine...Filter
// Variable Available Field Sabai Dine...Filter Field Choose Garyo Vane
// Tesko Selection Dine" - one register page for every module, with a
// date range and a dynamic filter builder. Only the filters that
// genuinely apply to the selected module are offered (a Journal
// Voucher has no Product filter; Stock Transfer has no Customer/
// Supplier filter, etc.) - see registerRoutes.js's availableFilters().
// =============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import SavedViewsBar from '../components/SavedViewsBar';
import Layout from '../components/Layout';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';

const DOCUMENT_TYPES = [
    { value: 'sales_bill', label: 'Sales Bill' }, { value: 'purchase_bill', label: 'Purchase Bill' },
    { value: 'sales_delivery', label: 'Sales Delivery (Challan)' }, { value: 'sales_return', label: 'Sales Return' },
    { value: 'purchase_grn', label: 'Purchase GRN (Challan)' }, { value: 'purchase_return', label: 'Purchase Return' },
    { value: 'sales_order', label: 'Sales Order' }, { value: 'sales_quotation', label: 'Sales Quotation' },
    { value: 'purchase_order', label: 'Purchase Order' }, { value: 'purchase_quotation', label: 'Purchase Quotation' }, { value: 'purchase_requisition', label: 'Purchase Requisition' },
    { value: 'sales_nonsaleable_return', label: 'Sales Non-saleable Return' }, { value: 'purchase_nonsaleable_return', label: 'Purchase Non-saleable Return' }, { value: 'stock_transfer', label: 'Stock Transfer' },
    { value: 'production_order', label: 'Production Order' },
    { value: 'journal_voucher', label: 'Journal Voucher' }, { value: 'credit_note', label: 'Credit Note' }, { value: 'debit_note', label: 'Debit Note' },
    { value: 'cash_bank_entry', label: 'Cash / Bank Entry' }, { value: 'pdc_voucher', label: 'PDC Voucher' },
    { value: 'sales_additional_entry', label: 'Sales Additional Entry' }, { value: 'purchase_additional_expense', label: 'Purchase Additional Expense' }
];

// Every filter TYPE the register understands - which master list it
// draws from, what query param it becomes, and where to read a
// chosen item's display label from.
const FILTER_TYPE_DEFS = {
    party: { label: 'Customer / Supplier', endpoint: '/api/ledger-accounts?pageSize=500', param: 'party_ledger_id', getLabel: i => i.account_name },
    area: { label: 'Area', endpoint: '/api/areas', param: 'area_id', getLabel: i => i.area_name },
    route: { label: 'Route', endpoint: '/api/routes', param: 'route_id', getLabel: i => i.route_name },
    agent: { label: 'Agent', endpoint: '/api/salesman-agents', param: 'agent_id', getLabel: i => i.agent_name },
    product: { label: 'Product', endpoint: '/api/products', param: 'product_id', getLabel: i => i.product_name },
    product_company: { label: 'Product Company', endpoint: '/api/product-companies', param: 'product_company_id', getLabel: i => i.company_name },
    product_group: { label: 'Product Group', endpoint: '/api/product-groups', param: 'product_group_id', getLabel: i => i.group_name },
    product_category: { label: 'Product Category', endpoint: '/api/product-categories', param: 'product_category_id', getLabel: i => i.category_name },
    ledger_category: { label: 'Ledger Category', endpoint: '/api/ledger-categories', param: 'ledger_category_id', getLabel: i => i.category_name }
};

export default function UniversalRegister() {
    const { authFetch } = useAuth();
    const [documentType, setDocumentType] = useState('sales_bill');
    const [availableFilterTypes, setAvailableFilterTypes] = useState([]);
    // Tenant's own names for the optional category features (e.g.
    // "Brand", "Customer Type") - shown instead of the generic label.
    const [customLabels, setCustomLabels] = useState({});
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [activeFilters, setActiveFilters] = useState([]); // [{ type, value, id }]
    const [pickerCache, setPickerCache] = useState({}); // { [filterType]: items[] }
    const [addFilterType, setAddFilterType] = useState('');
    const [results, setResults] = useState(null);
    // FEATURE: "Sales Bill Normal Register Default Maa Hunxa Ani User Le
    // Customer Wise, Product Wise Xuttai Report Banayo Vane Save As" -
    // '' = the normal register (default); anything else = summary.
    const [groupBy, setGroupBy] = useState('');
    const [grouped, setGrouped] = useState(null);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const loadFilterOptions = useCallback(async () => {
        try {
            const res = await authFetch(`/api/registers/filter-options?document_type=${documentType}`);
            const types = (res.data.filters || []).filter(f => f !== 'date_range');
            setAvailableFilterTypes(types);
            setCustomLabels(res.data.labels || {});
            setActiveFilters(f => f.filter(af => types.includes(af.type)));
            setAddFilterType('');
            setResults(null);
            setGrouped(null);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch, documentType]);
    useEffect(() => { loadFilterOptions(); }, [loadFilterOptions]);

    const ensurePickerLoaded = async (filterType) => {
        if (pickerCache[filterType]) return;
        const def = FILTER_TYPE_DEFS[filterType];
        try {
            const res = await authFetch(def.endpoint);
            setPickerCache(c => ({ ...c, [filterType]: res.data || [] }));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleAddFilter = async (filterType) => {
        if (!filterType) return;
        await ensurePickerLoaded(filterType);
        setActiveFilters(f => [...f, { type: filterType, value: '', id: `${filterType}_${Date.now()}` }]);
        setAddFilterType('');
    };
    const updateFilterValue = (id, value) => setActiveFilters(f => f.map(af => af.id === id ? { ...af, value } : af));
    const removeFilter = (id) => setActiveFilters(f => f.filter(af => af.id !== id));

    const handleSearch = async (override) => {
        const cfg = override || { dateFrom, dateTo, activeFilters, groupBy };
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (cfg.dateFrom) params.set('date_from', cfg.dateFrom);
            if (cfg.dateTo) params.set('date_to', cfg.dateTo);
            cfg.activeFilters.forEach(af => {
                if (af.value && FILTER_TYPE_DEFS[af.type]) params.set(FILTER_TYPE_DEFS[af.type].param, af.value);
            });
            if (cfg.groupBy) params.set('group_by', cfg.groupBy);
            const res = await authFetch(`/api/registers/${documentType}/search?${params}`);
            if (cfg.groupBy) { setGrouped(res.data); setResults(null); }
            else { setResults(res.data || []); setGrouped(null); }
            const empty = cfg.groupBy ? (res.data?.rows || []).length === 0 : (res.data || []).length === 0;
            if (empty) showAlert('No records match these filters', 'info');
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    };

    const getViewConfig = () => ({ dateFrom, dateTo, groupBy, activeFilters: activeFilters.map(af => ({ type: af.type, value: af.value })) });
    const applyViewConfig = async (cfg) => {
        const restored = (cfg.activeFilters || []).map((af, i) => ({ ...af, id: `${af.type}_${Date.now()}_${i}` }));
        for (const af of restored) await ensurePickerLoaded(af.type);
        setDateFrom(cfg.dateFrom || ''); setDateTo(cfg.dateTo || ''); setGroupBy(cfg.groupBy || ''); setActiveFilters(restored);
        handleSearch({ dateFrom: cfg.dateFrom || '', dateTo: cfg.dateTo || '', groupBy: cfg.groupBy || '', activeFilters: restored });
    };
    const resetToDefault = () => { setDateFrom(''); setDateTo(''); setGroupBy(''); setActiveFilters([]); setResults(null); setGrouped(null); };

    // A row's most useful "party" name, whichever snapshot key this
    // document type actually has (or none, for internal documents).
    const partyDisplay = (row) => row.customer_name_snapshot || row.vendor_name_snapshot || row.party_name_snapshot || row.cash_vendor_name || '—';
    const amountDisplay = (row) => row.total_amount ?? row.grand_total ?? row.amount ?? row.total_debit ?? row.total_raw_material_cost ?? null;

    const remainingFilterTypes = availableFilterTypes.filter(t => !activeFilters.some(af => af.type === t));
    const filterLabel = (type) => customLabels[type] || FILTER_TYPE_DEFS[type].label;

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📋 Universal Register</span>
            </div>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="erp-tab-content">
                <SavedViewsBar reportKey={`register:${documentType}`} getConfig={getViewConfig} onApply={applyViewConfig} onReset={resetToDefault} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div className="erp-field">
                        <label className="erp-label">Module</label>
                        <select className="erp-select" value={documentType} onChange={e => setDocumentType(e.target.value)}>
                            {DOCUMENT_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
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

                {/* Active filters */}
                {activeFilters.length > 0 && (
                    <div className="space-y-2 mb-3">
                        {activeFilters.map(af => {
                            const def = FILTER_TYPE_DEFS[af.type];
                            const items = pickerCache[af.type] || [];
                            return (
                                <div key={af.id} className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-gray-500 w-40 shrink-0">{filterLabel(af.type)}</span>
                                    <div className="flex-1 max-w-sm">
                                        <SearchablePopupSelect
                                            listKey={`register_filter_${af.type}`}
                                            columns={[{ key: 'label', label: 'Name' }]}
                                            defaultVisibleKeys={['label']}
                                            items={items.map(i => ({ ...i, label: def.getLabel(i) }))}
                                            getId={i => i.id} getLabel={i => def.getLabel(i)}
                                            searchKeys={['label']}
                                            value={af.value} onChange={v => updateFilterValue(af.id, v)} placeholder="Select"
                                        />
                                    </div>
                                    <button type="button" onClick={() => removeFilter(af.id)} className="text-red-500 text-xs">✕ Remove</button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Add filter */}
                {remainingFilterTypes.length > 0 && (
                    <div className="flex items-center gap-2 mb-4">
                        <select className="erp-select max-w-xs" value={addFilterType} onChange={e => handleAddFilter(e.target.value)}>
                            <option value="">➕ Add Filter…</option>
                            {remainingFilterTypes.map(t => <option key={t} value={t}>{filterLabel(t)}</option>)}
                        </select>
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <label className="text-xs font-semibold text-gray-500">Report Type:</label>
                    <select className="erp-select max-w-xs" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                        <option value="">Normal Register (every document)</option>
                        {availableFilterTypes.includes('party') && <option value="party">Customer / Supplier Wise</option>}
                        {availableFilterTypes.includes('product') && <option value="product">Product Wise</option>}
                        {availableFilterTypes.includes('agent') && <option value="agent">Agent Wise</option>}
                        {availableFilterTypes.includes('area') && <option value="area">Area Wise</option>}
                        {availableFilterTypes.includes('route') && <option value="route">Route Wise</option>}
                        <option value="month">Month Wise</option>
                        <option value="status">Status Wise</option>
                    </select>
                    <button type="button" onClick={() => handleSearch()} disabled={loading} className="erp-btn primary">{loading ? 'Searching…' : '🔍 Search'}</button>
                </div>

                {grouped && grouped.rows.length > 0 && (
                    <div className="overflow-x-auto mb-4">
                        <table className="erp-grid-table">
                            <thead><tr><th>{{ party: 'Customer / Supplier', product: 'Product', agent: 'Agent', area: 'Area', route: 'Route', month: 'Month', status: 'Status' }[grouped.group_by]}</th><th>Documents</th>{grouped.group_by === 'product' && <th>Qty</th>}<th>Amount</th></tr></thead>
                            <tbody>
                                {grouped.rows.map(r => (
                                    <tr key={r.key}><td>{r.label}</td><td>{r.doc_count}</td>{grouped.group_by === 'product' && <td>{r.qty}</td>}<td>{Number(r.amount).toFixed(2)}</td></tr>
                                ))}
                                <tr className="font-semibold bg-slate-50">
                                    <td>Total ({grouped.rows.length})</td><td></td>
                                    {grouped.group_by === 'product' && <td>{Math.round(grouped.rows.reduce((t, r) => t + r.qty, 0) * 10000) / 10000}</td>}
                                    <td>{grouped.rows.reduce((t, r) => t + r.amount, 0).toFixed(2)}</td>
                                </tr>
                            </tbody>
                        </table>
                        {grouped.truncated && <p className="text-xs text-amber-600 mt-1">Only the latest 5,000 documents were summarised - narrow the date range for complete totals.</p>}
                    </div>
                )}

                {results !== null && results.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead>
                                <tr><th>Date</th><th>Doc No</th><th>Party</th><th>Status</th><th>Amount</th></tr>
                            </thead>
                            <tbody>
                                {results.map(row => (
                                    <tr key={row.id}>
                                        <td>{formatDateForDisplay(row.doc_date, 'dual')}</td>
                                        <td>{row.doc_no}</td>
                                        <td>{partyDisplay(row)}</td>
                                        <td className="capitalize">{row.status || '—'}</td>
                                        <td>{amountDisplay(row) !== null ? Number(amountDisplay(row)).toFixed(2) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="text-xs text-gray-400 mt-2">{results.length} record(s){results.length === 500 ? ' (showing first 500 - narrow your filters for a complete list)' : ''}</p>
                    </div>
                )}
                {results !== null && results.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">No records match these filters.</p>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
