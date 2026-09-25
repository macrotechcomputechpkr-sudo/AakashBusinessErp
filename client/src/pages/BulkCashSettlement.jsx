// =============================================
// BulkCashSettlement.jsx
// "Bulk Cash Receipt Payment" - filter outstanding credit Sales/
// Purchase bills by optional Agent/Area/Route/Product-Company/Date-
// range, tick all or individually, and settle: either a quick single-
// mode full-amount settlement for everything ticked, or a per-bill
// panel supporting a partial, multi-mode split (Cash + Bank + QR +
// PDC, remainder stays Credit).
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';

const emptyAllocationSet = () => ({ cash: '', bank: '', qr: '', pdc_amount: '', pdc_cheque_no: '', pdc_cheque_date: '', pdc_bank_name: '' });

export default function BulkCashSettlement() {
    const { authFetch } = useAuth();
    const enterAreaRef = useRef(null);
    useEnterKeyNavigation(enterAreaRef);
    const [side, setSide] = useState('sales');
    const [agents, setAgents] = useState([]);
    const [areas, setAreas] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [productCompanies, setProductCompanies] = useState([]);
    const [cashBankLedgers, setCashBankLedgers] = useState([]);
    const [filters, setFilters] = useState({ agent_id: '', area_id: '', route_id: '', product_company_id: '', date_from: '', date_to: '' });
    const [results, setResults] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);

    const [quickMode, setQuickMode] = useState('cash');
    const [quickLedgerId, setQuickLedgerId] = useState('');

    const [customBill, setCustomBill] = useState(null);
    const [customAlloc, setCustomAlloc] = useState(emptyAllocationSet());
    const [customCashLedger, setCustomCashLedger] = useState('');
    const [customBankLedger, setCustomBankLedger] = useState('');
    const [customQrLedger, setCustomQrLedger] = useState('');
    const [customPdcBankLedger, setCustomPdcBankLedger] = useState('');

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const loadMasters = useCallback(async () => {
        try {
            const [ag, ar, rt, pc, ldg] = await Promise.all([
                authFetch('/api/salesman-agents'),
                authFetch('/api/areas'),
                authFetch('/api/routes'),
                authFetch('/api/product-companies'),
                authFetch('/api/ledger-accounts?pageSize=500')
            ]);
            setAgents(ag.data || []);
            setAreas(ar.data || []);
            setRoutes(rt.data || []);
            setProductCompanies(pc.data || []);
            setCashBankLedgers(ldg.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { loadMasters(); }, [loadMasters]);

    const handleSearch = async () => {
        setLoading(true);
        setResults(null);
        setSelectedIds([]);
        try {
            const params = new URLSearchParams({ side });
            Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
            const res = await authFetch(`/api/bulk-settlement/outstanding-bills?${params}`);
            setResults(res.data || []);
            if ((res.data || []).length === 0) showAlert('No outstanding credit bills match these filters', 'info');
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    };

    const toggleSelect = (billId) => setSelectedIds(cur => cur.includes(billId) ? cur.filter(x => x !== billId) : [...cur, billId]);
    const toggleSelectAll = () => setSelectedIds(cur => cur.length === (results || []).length ? [] : (results || []).map(r => r.bill_id));

    const selectedTotal = (results || []).filter(r => selectedIds.includes(r.bill_id)).reduce((s, r) => s + Number(r.outstanding_amount), 0);

    const handleQuickSettle = async () => {
        if (selectedIds.length === 0) return showAlert('Select at least one bill', 'danger');
        if (!quickLedgerId) return showAlert(`Select the ${quickMode === 'cash' ? 'Cash' : quickMode === 'bank' ? 'Bank' : 'QR receiving'} account`, 'danger');
        const chosen = (results || []).filter(r => selectedIds.includes(r.bill_id));
        const settlements = chosen.map(r => ({
            bill_id: r.bill_id, reference_id: r.reference_id, party_ledger_id: r.party_ledger_id,
            party_sub_ledger_id: r.party_sub_ledger_id, cost_center_id: r.cost_center_id, business_unit_id: r.business_unit_id,
            doc_no: r.doc_no,
            allocations: [{ mode: quickMode, cash_bank_ledger_id: quickLedgerId, amount: r.outstanding_amount }]
        }));
        await submitSettlement(settlements);
    };

    const openCustomSettle = (row) => {
        setCustomBill(row);
        setCustomAlloc(emptyAllocationSet());
    };

    const customAllocatedTotal = ['cash', 'bank', 'qr', 'pdc_amount'].reduce((s, k) => s + (Number(customAlloc[k]) || 0), 0);
    const customRemaining = customBill ? Number(customBill.outstanding_amount) - customAllocatedTotal : 0;

    const handleCustomSettle = async () => {
        if (!customBill) return;
        if (customAllocatedTotal <= 0) return showAlert('Enter at least one amount', 'danger');
        if (customAllocatedTotal > Number(customBill.outstanding_amount)) return showAlert('Allocated total cannot exceed the outstanding amount', 'danger');
        const allocations = [];
        if (Number(customAlloc.cash) > 0) { if (!customCashLedger) return showAlert('Select the Cash account', 'danger'); allocations.push({ mode: 'cash', cash_bank_ledger_id: customCashLedger, amount: Number(customAlloc.cash) }); }
        if (Number(customAlloc.bank) > 0) { if (!customBankLedger) return showAlert('Select the Bank account', 'danger'); allocations.push({ mode: 'bank', cash_bank_ledger_id: customBankLedger, amount: Number(customAlloc.bank) }); }
        if (Number(customAlloc.qr) > 0) { if (!customQrLedger) return showAlert('Select the QR receiving account', 'danger'); allocations.push({ mode: 'qr', cash_bank_ledger_id: customQrLedger, amount: Number(customAlloc.qr) }); }
        let pdc = null;
        if (Number(customAlloc.pdc_amount) > 0) {
            if (!customAlloc.pdc_cheque_no || !customAlloc.pdc_cheque_date) return showAlert('Cheque No and Cheque Date are required for the PDC portion', 'danger');
            pdc = { amount: Number(customAlloc.pdc_amount), cheque_no: customAlloc.pdc_cheque_no, cheque_date: customAlloc.pdc_cheque_date, bank_name: customAlloc.pdc_bank_name, bank_ledger_id: customPdcBankLedger || null };
        }
        const settlements = [{
            bill_id: customBill.bill_id, reference_id: customBill.reference_id, party_ledger_id: customBill.party_ledger_id,
            party_sub_ledger_id: customBill.party_sub_ledger_id, cost_center_id: customBill.cost_center_id, business_unit_id: customBill.business_unit_id,
            doc_no: customBill.doc_no,
            allocations, pdc
        }];
        await submitSettlement(settlements, true);
    };

    const submitSettlement = async (settlements, isCustom = false) => {
        try {
            const res = await authFetch('/api/bulk-settlement/settle', { method: 'POST', body: JSON.stringify({ side, settlements }) });
            showAlert(`${res.data.length} bill(s) settled successfully`, 'success');
            if (isCustom) setCustomBill(null);
            handleSearch();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">💰 Bulk Cash / Bank Settlement</span>
            </div>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div ref={enterAreaRef} className="erp-tab-content">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                    <div className="erp-field">
                        <label className="erp-label">Side</label>
                        <select className="erp-select" value={side} onChange={e => { setSide(e.target.value); setResults(null); }}>
                            <option value="sales">Sales (Receipts)</option>
                            <option value="purchase">Purchase (Payments)</option>
                        </select>
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Agent <span className="text-xs text-gray-400 normal-case">(optional)</span></label>
                        <SearchablePopupSelect
                            listKey="bulk_settle_agent_picker"
                            columns={[{ key: 'agent_code', label: 'Code' }, { key: 'agent_name', label: 'Name' }]}
                            defaultVisibleKeys={['agent_name']}
                            items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                            searchKeys={['agent_name', 'agent_code']}
                            value={filters.agent_id} onChange={id => setFilters({ ...filters, agent_id: id })} placeholder="Any"
                        />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Area <span className="text-xs text-gray-400 normal-case">(optional)</span></label>
                        <SearchablePopupSelect
                            listKey="bulk_settle_area_picker"
                            columns={[{ key: 'area_name', label: 'Name' }]}
                            defaultVisibleKeys={['area_name']}
                            items={areas} getId={a => a.id} getLabel={a => a.area_name}
                            searchKeys={['area_name']}
                            value={filters.area_id} onChange={id => setFilters({ ...filters, area_id: id })} placeholder="Any"
                        />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Route <span className="text-xs text-gray-400 normal-case">(optional)</span></label>
                        <SearchablePopupSelect
                            listKey="bulk_settle_route_picker"
                            columns={[{ key: 'route_name', label: 'Name' }]}
                            defaultVisibleKeys={['route_name']}
                            items={routes} getId={r => r.id} getLabel={r => r.route_name}
                            searchKeys={['route_name']}
                            value={filters.route_id} onChange={id => setFilters({ ...filters, route_id: id })} placeholder="Any"
                        />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Product Company <span className="text-xs text-gray-400 normal-case">(optional)</span></label>
                        <SearchablePopupSelect
                            listKey="bulk_settle_company_picker"
                            columns={[{ key: 'company_code', label: 'Code' }, { key: 'company_name', label: 'Name' }]}
                            defaultVisibleKeys={['company_name']}
                            items={productCompanies} getId={c => c.id} getLabel={c => c.company_name}
                            searchKeys={['company_name', 'company_code']}
                            value={filters.product_company_id} onChange={id => setFilters({ ...filters, product_company_id: id })} placeholder="Any"
                        />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Date From <span className="text-xs text-gray-400 normal-case">(optional)</span></label>
                        <input type="date" className="erp-input" value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Date To <span className="text-xs text-gray-400 normal-case">(optional)</span></label>
                        <input type="date" className="erp-input" value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} />
                    </div>
                </div>
                <button type="button" onClick={handleSearch} disabled={loading} className="erp-btn primary mb-4">{loading ? 'Searching…' : '🔍 Find Outstanding Bills'}</button>

                {results !== null && results.length > 0 && (
                    <>
                        <div className="overflow-x-auto mb-3">
                            <table className="erp-grid-table">
                                <thead>
                                    <tr>
                                        <th><input type="checkbox" checked={selectedIds.length === results.length} onChange={toggleSelectAll} /></th>
                                        <th>Date</th><th>Bill No</th><th>{side === 'sales' ? 'Customer' : 'Vendor'}</th>
                                        <th>Total</th><th>Outstanding</th><th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map(r => (
                                        <tr key={r.bill_id}>
                                            <td><input type="checkbox" checked={selectedIds.includes(r.bill_id)} onChange={() => toggleSelect(r.bill_id)} /></td>
                                            <td>{formatDateForDisplay(r.doc_date, 'dual')}</td>
                                            <td>{r.doc_no}</td>
                                            <td>{r.party_name}</td>
                                            <td>{Number(r.total_amount).toFixed(2)}</td>
                                            <td className="font-semibold">{Number(r.outstanding_amount).toFixed(2)}</td>
                                            <td><button type="button" onClick={() => openCustomSettle(r)} className="text-xs text-blue-600 underline">Custom Settle</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="border rounded-lg p-3 bg-slate-50">
                            <p className="text-sm font-semibold mb-2">Quick Settle Selected — {selectedIds.length} bill(s), total {selectedTotal.toFixed(2)}</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                                <div className="erp-field">
                                    <label className="erp-label">Mode</label>
                                    <select className="erp-select" value={quickMode} onChange={e => { setQuickMode(e.target.value); setQuickLedgerId(''); }}>
                                        <option value="cash">Cash</option>
                                        <option value="bank">Bank Transfer</option>
                                        <option value="qr">QR / Online</option>
                                    </select>
                                </div>
                                <div className="erp-field">
                                    <label className="erp-label">Account</label>
                                    <SearchablePopupSelect
                                        listKey="bulk_settle_quick_ledger_picker"
                                        columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                        defaultVisibleKeys={['account_name']}
                                        items={cashBankLedgers} getId={l => l.id} getLabel={l => l.account_name}
                                        searchKeys={['account_name', 'account_code']}
                                        value={quickLedgerId} onChange={setQuickLedgerId} placeholder="Select Account"
                                    />
                                </div>
                                <button type="button" onClick={handleQuickSettle} className="erp-btn primary">Settle at Full Amount</button>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">Settles every ticked bill's FULL outstanding amount via this one mode. For a partial or mixed-mode settlement on a specific bill, use "Custom Settle" on that row instead.</p>
                        </div>
                    </>
                )}
                {results !== null && results.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">No outstanding credit bills match these filters.</p>
                )}
            </div>
        </div>

        {customBill && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-xl max-h-[85vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">Custom Settle — {customBill.doc_no}</span></div>
                    <div className="p-5">
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div className="erp-field"><label className="erp-label">{side === 'sales' ? 'Customer' : 'Vendor'}</label><input className="erp-input" disabled value={customBill.party_name} /></div>
                            <div className="erp-field"><label className="erp-label">Outstanding</label><input className="erp-input" disabled value={Number(customBill.outstanding_amount).toFixed(2)} /></div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
                            <div className="erp-field">
                                <label className="erp-label">Cash Amount</label>
                                <input type="number" step="0.01" className="erp-input" value={customAlloc.cash} onChange={e => setCustomAlloc({ ...customAlloc, cash: e.target.value })} />
                            </div>
                            {Number(customAlloc.cash) > 0 && (
                                <div className="erp-field">
                                    <label className="erp-label">Cash Account</label>
                                    <SearchablePopupSelect listKey="custom_cash_ledger" columns={[{ key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']} items={cashBankLedgers} getId={l => l.id} getLabel={l => l.account_name} searchKeys={['account_name']} value={customCashLedger} onChange={setCustomCashLedger} placeholder="Select" />
                                </div>
                            )}
                            <div className="erp-field">
                                <label className="erp-label">Bank Amount</label>
                                <input type="number" step="0.01" className="erp-input" value={customAlloc.bank} onChange={e => setCustomAlloc({ ...customAlloc, bank: e.target.value })} />
                            </div>
                            {Number(customAlloc.bank) > 0 && (
                                <div className="erp-field">
                                    <label className="erp-label">Bank Account</label>
                                    <SearchablePopupSelect listKey="custom_bank_ledger" columns={[{ key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']} items={cashBankLedgers} getId={l => l.id} getLabel={l => l.account_name} searchKeys={['account_name']} value={customBankLedger} onChange={setCustomBankLedger} placeholder="Select" />
                                </div>
                            )}
                            <div className="erp-field">
                                <label className="erp-label">QR / Online Amount</label>
                                <input type="number" step="0.01" className="erp-input" value={customAlloc.qr} onChange={e => setCustomAlloc({ ...customAlloc, qr: e.target.value })} />
                            </div>
                            {Number(customAlloc.qr) > 0 && (
                                <div className="erp-field">
                                    <label className="erp-label">QR Receiving Account</label>
                                    <SearchablePopupSelect listKey="custom_qr_ledger" columns={[{ key: 'account_name', label: 'Name' }]} defaultVisibleKeys={['account_name']} items={cashBankLedgers} getId={l => l.id} getLabel={l => l.account_name} searchKeys={['account_name']} value={customQrLedger} onChange={setCustomQrLedger} placeholder="Select" />
                                </div>
                            )}
                        </div>

                        <p className="text-xs font-semibold text-slate-500 uppercase mt-3 mb-2">PDC Portion <span className="text-gray-400 normal-case">(settles when the cheque later realizes, not immediately)</span></p>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div className="erp-field"><label className="erp-label">PDC Amount</label><input type="number" step="0.01" className="erp-input" value={customAlloc.pdc_amount} onChange={e => setCustomAlloc({ ...customAlloc, pdc_amount: e.target.value })} /></div>
                            {Number(customAlloc.pdc_amount) > 0 && (
                                <>
                                    <div className="erp-field"><label className="erp-label">Cheque No</label><input className="erp-input" value={customAlloc.pdc_cheque_no} onChange={e => setCustomAlloc({ ...customAlloc, pdc_cheque_no: e.target.value })} /></div>
                                    <div className="erp-field"><label className="erp-label">Cheque Date</label><input type="date" className="erp-input" value={customAlloc.pdc_cheque_date} onChange={e => setCustomAlloc({ ...customAlloc, pdc_cheque_date: e.target.value })} /></div>
                                    <div className="erp-field"><label className="erp-label">Bank Name</label><input className="erp-input" value={customAlloc.pdc_bank_name} onChange={e => setCustomAlloc({ ...customAlloc, pdc_bank_name: e.target.value })} /></div>
                                </>
                            )}
                        </div>

                        <div className="flex justify-between font-semibold text-sm border-t pt-2">
                            <span>Remaining on Credit</span>
                            <span className={customRemaining < 0 ? 'text-red-600' : ''}>{customRemaining.toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setCustomBill(null)} className="erp-btn">Cancel</button>
                            <button type="button" onClick={handleCustomSettle} className="erp-btn primary">Settle</button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        </div>
        </Layout>
    );
}
