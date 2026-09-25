// =============================================
// PurchaseRegisterReport.jsx
// One report, every module - switches between Requisition/Quotation/
// Order/GRN, and between full Register and Outstanding-only view,
// reading the shared generic backend report engine.
// =============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import { formatDateForDisplay, getQuickDateRange } from '../utils/nepaliDateUtils';
import { evaluateFormula, validateFormula } from '../utils/formulaEvaluator';

const MODULES = [
    { value: 'requisition', label: 'Purchase Requisition', convertedLabel: 'Ordered' },
    { value: 'quotation', label: 'Purchase Quotation', convertedLabel: 'Ordered' },
    { value: 'order', label: 'Purchase Order', convertedLabel: 'Received' },
    { value: 'grn', label: 'Purchase GRN', convertedLabel: 'Billed' },
    { value: 'bill', label: 'Purchase Bill', convertedLabel: 'Returned' }
];

const QUICK_RANGES = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'this_quarter', label: 'This Quarter' },
    { value: 'last_quarter', label: 'Last Quarter' },
    { value: 'this_year', label: 'This Year' }
];

export default function PurchaseRegisterReport() {
    const { authFetch } = useAuth();
    const [module, setModule] = useState('grn');
    const [viewMode, setViewMode] = useState('register'); // 'register' | 'outstanding'
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);
    // FEATURE: "date selection should follow whatever is chosen in
    // System Control" - fetched once, drives every date display below.
    const [dateFormatSetting, setDateFormatSetting] = useState('nepali');

    // FEATURE: "maximum filter options" - every field the underlying
    // module actually carries, all usable at once.
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [docNo, setDocNo] = useState('');
    const [vendorName, setVendorName] = useState('');
    const [productName, setProductName] = useState('');
    const [status, setStatus] = useState('');
    const [agentName, setAgentName] = useState('');
    const [priority, setPriority] = useState('');
    const [batchNo, setBatchNo] = useState('');
    const [sourceDocNo, setSourceDocNo] = useState('');
    const [warehouseName, setWarehouseName] = useState('');

    // FEATURE: "Insert option - formula from available fields with IF
    // condition" - user-defined extra columns computed per row.
    const [formulaColumns, setFormulaColumns] = useState([]);
    const [showFormulaModal, setShowFormulaModal] = useState(false);
    const [formulaDraft, setFormulaDraft] = useState({ label: '', formula: '' });
    const [formulaError, setFormulaError] = useState('');

    // FEATURE: "Every Report Type ma Default option rakha. Save As
    // garera rakhna milne ... jun format choose garxa tei format ma
    // report khulne" - named, reusable configurations, one Default per
    // report type, auto-applied on open.
    const [savedViews, setSavedViews] = useState([]);
    const [activeViewId, setActiveViewId] = useState('');
    const [showSaveAsModal, setShowSaveAsModal] = useState(false);
    const [saveAsName, setSaveAsName] = useState('');
    const [saveAsDefault, setSaveAsDefault] = useState(false);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    useEffect(() => {
        authFetch('/api/system-control').then(res => {
            if (res.data?.date_format_reports) setDateFormatSetting(res.data.date_format_reports);
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyQuickRange = (preset) => {
        const { from, to } = getQuickDateRange(preset);
        setFromDate(from);
        setToDate(to);
    };

    // FEATURE: everything about the CURRENT screen that a "Save As" should
    // capture, and the reverse - applying a saved config back onto the screen.
    const buildCurrentConfig = () => ({
        module, viewMode, fromDate, toDate, docNo, vendorName, productName, status, agentName, priority, batchNo, sourceDocNo, warehouseName,
        formulaColumns
    });
    const applyConfig = (config) => {
        if (!config) return;
        if (config.module) setModule(config.module);
        if (config.viewMode) setViewMode(config.viewMode);
        setFromDate(config.fromDate || '');
        setToDate(config.toDate || '');
        setDocNo(config.docNo || '');
        setVendorName(config.vendorName || '');
        setProductName(config.productName || '');
        setStatus(config.status || '');
        setAgentName(config.agentName || '');
        setPriority(config.priority || '');
        setBatchNo(config.batchNo || '');
        setSourceDocNo(config.sourceDocNo || '');
        setWarehouseName(config.warehouseName || '');
        setFormulaColumns(Array.isArray(config.formulaColumns) ? config.formulaColumns : []);
    };

    const loadSavedViews = useCallback(async () => {
        try {
            const res = await authFetch('/api/report-saved-views?report_type=purchase_register');
            const views = res.data || [];
            setSavedViews(views);
            const defaultView = views.find(v => v.is_default);
            if (defaultView) { setActiveViewId(defaultView.id); applyConfig(defaultView.config); }
        } catch { /* no saved views yet - fine, screen just uses its own defaults */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authFetch]);
    useEffect(() => { loadSavedViews(); }, [loadSavedViews]);

    const handleSelectView = (viewId) => {
        setActiveViewId(viewId);
        const view = savedViews.find(v => v.id === viewId);
        if (view) applyConfig(view.config);
    };

    const handleSaveAsView = async () => {
        if (!saveAsName.trim()) return showAlert('Give this view a name', 'danger');
        try {
            const res = await authFetch('/api/report-saved-views', {
                method: 'POST',
                body: JSON.stringify({ report_type: 'purchase_register', view_name: saveAsName.trim(), is_default: saveAsDefault, config: buildCurrentConfig() })
            });
            showAlert(`View "${saveAsName}" saved`, 'success');
            setShowSaveAsModal(false);
            setSaveAsName('');
            setSaveAsDefault(false);
            setActiveViewId(res.data.id);
            loadSavedViews();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDeleteView = async (viewId) => {
        if (!window.confirm('Delete this saved view?')) return;
        try {
            await authFetch(`/api/report-saved-views/${viewId}`, { method: 'DELETE' });
            if (activeViewId === viewId) setActiveViewId('');
            loadSavedViews();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: "Insert option - formula from available fields with IF
    // condition" - validated against a real sample row (or a zeroed
    // stand-in field set) before it's allowed to be added.
    const availableFieldKeys = ['qty', 'amount', 'converted_qty', 'converted_amount', 'outstanding_qty', 'outstanding_amount'];
    const handleAddFormulaColumn = () => {
        if (!formulaDraft.label.trim()) return setFormulaError('Give this column a name');
        const sampleRow = rows[0] || Object.fromEntries(availableFieldKeys.map(k => [k, 0]));
        const check = validateFormula(formulaDraft.formula, sampleRow);
        if (!check.valid) return setFormulaError(check.error);
        setFormulaColumns(cols => [...cols, { key: `formula_${Date.now()}`, label: formulaDraft.label.trim(), formula: formulaDraft.formula }]);
        setFormulaDraft({ label: '', formula: '' });
        setFormulaError('');
        setShowFormulaModal(false);
    };
    const removeFormulaColumn = (key) => setFormulaColumns(cols => cols.filter(c => c.key !== key));

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ module });
            if (fromDate) params.set('from_date', fromDate);
            if (toDate) params.set('to_date', toDate);
            if (docNo) params.set('doc_no', docNo);
            if (vendorName) params.set('vendor_name', vendorName);
            if (productName) params.set('product_name', productName);
            if (status) params.set('status', status);
            if (agentName) params.set('agent_name', agentName);
            if (priority) params.set('priority', priority);
            if (batchNo) params.set('batch_no', batchNo);
            if (sourceDocNo) params.set('source_doc_no', sourceDocNo);
            if (warehouseName) params.set('warehouse_name', warehouseName);
            if (viewMode === 'outstanding') params.set('outstanding_only', 'true');
            const res = await authFetch(`/api/purchase-register-report?${params}`);
            setRows(res.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authFetch, module, viewMode]);
    useEffect(() => { load(); }, [load]);

    const currentModule = MODULES.find(m => m.value === module);
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
    const totalConvertedQty = rows.reduce((s, r) => s + r.converted_qty, 0);
    const totalConvertedAmount = rows.reduce((s, r) => s + r.converted_amount, 0);
    const totalOutstandingQty = rows.reduce((s, r) => s + r.outstanding_qty, 0);
    const totalOutstandingAmount = rows.reduce((s, r) => s + r.outstanding_amount, 0);

    const columns = [
        { key: 'doc_no', label: 'Doc No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, dateFormatSetting) },
        { key: 'vendor_name', label: 'Vendor', type: 'text', render: r => r.vendor_name || '—' },
        { key: 'agent_name', label: 'Agent', type: 'text', render: r => r.agent_name || '—' },
        { key: 'product_name', label: 'Product', type: 'text' },
        { key: 'batch_no', label: 'Batch No', type: 'text', render: r => r.batch_no || '—' },
        { key: 'source_doc_no', label: 'Ref No', type: 'text', render: r => r.source_doc_no || '—' },
        { key: 'warehouse_name', label: 'Warehouse', type: 'text', render: r => r.warehouse_name || '—' },
        { key: 'qty', label: 'Transaction Qty', type: 'number' },
        { key: 'amount', label: 'Transaction Amount', type: 'number' },
        { key: 'converted_qty', label: `${currentModule.convertedLabel} Qty`, type: 'number' },
        { key: 'converted_amount', label: `${currentModule.convertedLabel} Amount`, type: 'number' },
        { key: 'outstanding_qty', label: 'Outstanding Qty', type: 'number', render: r => r.dual && r.outstanding_alt_qty ? `${r.outstanding_qty} + ${r.outstanding_alt_qty} pcs` : r.outstanding_qty },
        { key: 'outstanding_amount', label: 'Outstanding Amount', type: 'number' },
        { key: 'priority', label: 'Priority', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        ...formulaColumns.map(fc => ({
            key: fc.key, label: fc.label, type: 'text',
            render: r => { const v = evaluateFormula(fc.formula, r); return typeof v === 'number' ? v.toFixed(2) : String(v); }
        }))
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📊 Purchase Register / Outstanding Report</span>
            </div>
            <p className="text-xs text-gray-400 px-4 pt-3">
                One report engine for every module - switch between the full transaction Register and an
                Outstanding-only view (Transaction minus {currentModule.convertedLabel}), per line, with every
                field that module carries available as a filter.
            </p>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
                <label className="text-xs text-gray-500">View:</label>
                <select className="erp-select w-auto" value={activeViewId} onChange={e => handleSelectView(e.target.value)}>
                    <option value="">— Unsaved (current) —</option>
                    {savedViews.map(v => <option key={v.id} value={v.id}>{v.view_name}{v.is_default ? ' ★' : ''}</option>)}
                </select>
                {activeViewId && (
                    <button type="button" onClick={() => handleDeleteView(activeViewId)} className="text-xs text-red-500 hover:underline">Delete this view</button>
                )}
                <button type="button" onClick={() => setShowSaveAsModal(true)} className="px-2.5 py-1 text-xs border rounded-full hover:bg-blue-50 hover:border-blue-300 ml-auto">💾 Save As…</button>
                <button type="button" onClick={() => setShowFormulaModal(true)} className="px-2.5 py-1 text-xs border rounded-full hover:bg-blue-50 hover:border-blue-300">➕ Insert Formula Column</button>
            </div>

            {formulaColumns.length > 0 && (
                <div className="px-4 pt-2 flex flex-wrap gap-1.5">
                    {formulaColumns.map(fc => (
                        <span key={fc.key} className="text-xs bg-purple-50 border border-purple-200 rounded-full px-2.5 py-1 flex items-center gap-1.5">
                            ƒ {fc.label}
                            <button type="button" onClick={() => removeFormulaColumn(fc.key)} className="text-purple-400 hover:text-purple-700">✕</button>
                        </span>
                    ))}
                </div>
            )}

            <div className="px-4 pt-3 flex flex-wrap gap-1.5">
                {QUICK_RANGES.map(qr => (
                    <button key={qr.value} onClick={() => applyQuickRange(qr.value)} className="px-2.5 py-1 text-xs border rounded-full hover:bg-blue-50 hover:border-blue-300">{qr.label}</button>
                ))}
            </div>

            <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                <div className="erp-field">
                    <label className="erp-label">Module</label>
                    <select className="erp-select" value={module} onChange={e => setModule(e.target.value)}>
                        {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                </div>
                <div className="erp-field">
                    <label className="erp-label">View</label>
                    <select className="erp-select" value={viewMode} onChange={e => setViewMode(e.target.value)}>
                        <option value="register">Full Register</option>
                        <option value="outstanding">Outstanding Only</option>
                    </select>
                </div>
                <div className="erp-field">
                    <label className="erp-label">From Date {dateFormatSetting !== 'english' && fromDate && <span className="hint">({formatDateForDisplay(fromDate, 'nepali')} BS)</span>}</label>
                    <input type="date" className="erp-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                </div>
                <div className="erp-field">
                    <label className="erp-label">To Date {dateFormatSetting !== 'english' && toDate && <span className="hint">({formatDateForDisplay(toDate, 'nepali')} BS)</span>}</label>
                    <input type="date" className="erp-input" value={toDate} onChange={e => setToDate(e.target.value)} />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Doc No</label>
                    <input className="erp-input" value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="Search doc no" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Vendor</label>
                    <input className="erp-input" value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Search vendor" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Item / Product</label>
                    <input className="erp-input" value={productName} onChange={e => setProductName(e.target.value)} placeholder="Search product name" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Status</label>
                    <input className="erp-input" value={status} onChange={e => setStatus(e.target.value)} placeholder="e.g. draft, received" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Agent</label>
                    <input className="erp-input" value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Search agent" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Priority</label>
                    <select className="erp-select" value={priority} onChange={e => setPriority(e.target.value)}>
                        <option value="">Any</option>
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="urgent">Urgent</option>
                    </select>
                </div>
                <div className="erp-field">
                    <label className="erp-label">Batch No</label>
                    <input className="erp-input" value={batchNo} onChange={e => setBatchNo(e.target.value)} placeholder="Search batch" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Ref No (source doc)</label>
                    <input className="erp-input" value={sourceDocNo} onChange={e => setSourceDocNo(e.target.value)} placeholder="Search source doc no" />
                </div>
                <div className="erp-field">
                    <label className="erp-label">Warehouse</label>
                    <input className="erp-input" value={warehouseName} onChange={e => setWarehouseName(e.target.value)} placeholder="Search warehouse" />
                </div>
                <div className="erp-field justify-end">
                    <button onClick={load} className="erp-btn primary">🔍 Filter</button>
                </div>
            </div>

            <div className="p-4">
                <div className="flex flex-wrap justify-between items-center gap-2 mb-2 text-sm">
                    <span className="text-gray-500">{loading ? 'Loading…' : `${rows.length} line(s)`}</span>
                    <div className="flex flex-wrap gap-4">
                        <span>Qty: <b>{totalQty}</b></span>
                        <span>Amount: <b>{totalAmount.toFixed(2)}</b></span>
                        <span>{currentModule.convertedLabel} Qty: <b>{totalConvertedQty}</b></span>
                        <span>{currentModule.convertedLabel} Amount: <b>{totalConvertedAmount.toFixed(2)}</b></span>
                        <span>Outstanding Qty: <b>{totalOutstandingQty}</b></span>
                        <span>Outstanding Amount: <b>{totalOutstandingAmount.toFixed(2)}</b></span>
                    </div>
                </div>
                <ReportGrid columns={columns} rows={rows} getId={r => r.detail_id} storageKey={`purchase_register_report_${module}`} />
            </div>
        </div>

        {showFormulaModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg">
                    <div className="erp-header"><span className="erp-header-title">➕ Insert Formula Column</span></div>
                    <div className="p-4 space-y-3">
                        <div className="erp-field">
                            <label className="erp-label">Column Name</label>
                            <input className="erp-input" value={formulaDraft.label} onChange={e => setFormulaDraft(d => ({ ...d, label: e.target.value }))} placeholder="e.g. Status Flag" />
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Formula</label>
                            <input className="erp-input font-mono text-sm" value={formulaDraft.formula} onChange={e => setFormulaDraft(d => ({ ...d, formula: e.target.value }))} placeholder='e.g. IF(outstanding_qty > 0, "Pending", "Done")' />
                        </div>
                        <div className="text-xs text-gray-400">
                            <p className="mb-1">Available fields: {availableFieldKeys.join(', ')}</p>
                            <p>Supports: + − × ÷, comparisons (&gt; &lt; &gt;= &lt;= == !=), AND / OR, and IF(condition, thenValue, elseValue).</p>
                        </div>
                        {formulaError && <p className="text-sm text-red-600">{formulaError}</p>}
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { setShowFormulaModal(false); setFormulaError(''); }} className="erp-btn">Cancel</button>
                            <button type="button" onClick={handleAddFormulaColumn} className="erp-btn primary">Add Column</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {showSaveAsModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-md">
                    <div className="erp-header"><span className="erp-header-title">💾 Save As</span></div>
                    <div className="p-4 space-y-3">
                        <div className="erp-field">
                            <label className="erp-label">View Name</label>
                            <input className="erp-input" value={saveAsName} onChange={e => setSaveAsName(e.target.value)} placeholder="e.g. My GRN Outstanding View" />
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={saveAsDefault} onChange={e => setSaveAsDefault(e.target.checked)} />
                            Make this the Default view for this report
                        </label>
                        <p className="text-xs text-gray-400">Saves the current Module, View mode, every filter, and any Formula Columns you've added.</p>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setShowSaveAsModal(false)} className="erp-btn">Cancel</button>
                            <button type="button" onClick={handleSaveAsView} className="erp-btn primary">Save</button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        </div>
        </Layout>
    );
}
