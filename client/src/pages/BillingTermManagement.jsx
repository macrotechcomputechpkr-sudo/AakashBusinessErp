// =============================================
// BillingTermManagement.jsx
// Completes the module referenced (but never built) by
// product_groups.billing_term_id. Three calculation modes - Fixed
// Amount, Percentage, and Formula - the last one being the genuinely
// new capability: a safe, validated arithmetic expression (see
// server/utils/formulaEvaluator.js) that can reference {basic_amount},
// {quantity}, {rate}, and other terms via {term:CODE}, tested live here
// before saving via the /billing-terms/preview endpoint.
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

const emptyForm = {
    term_name: '', description: '',
    term_category: 'general', tax_type: 'none',
    calculation_mode: 'percentage',
    basis: 'value', quantity_unit: 'primary',
    base_reference: 'basic_amount', base_reference_term_id: '',
    rate_percentage: 0, fixed_amount: 0, maximum_amount: 0, formula_expression: '',
    sign: '+', rounding_method: 'none', rounding_precision: 1,
    billing_ledger_id: '', return_ledger_id: '', expiry_return_ledger_id: '', sub_ledger_id: '', return_sub_ledger_id: '',
    manual_override: true, suppress_if_zero: false, include_in_profitability: false,
    product_wise: false, show_product_term_summary: false, allow_summary: false, is_enabled: true,
    applicable_sales_entry: true, applicable_purchase_entry: false, applicable_additional_expense: false, applicable_production_entry: false,
    credit_days: 0, grace_days: 0, discount_percentage: 0,
    display_order: 1
};

export default function BillingTermManagement() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const [testAmount, setTestAmount] = useState(1000);
    const [testQty, setTestQty] = useState(1);
    const [testResult, setTestResult] = useState(null);
    const [testError, setTestError] = useState(null);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [t, l, sl] = await Promise.all([
                authFetch('/api/billing-terms'),
                authFetch('/api/ledger-accounts?pageSize=1000&sortBy=account_name&sortDir=asc'),
                authFetch('/api/sub-ledgers')
            ]);
            setRows(t.data || []);
            setLedgers(l.data || []);
            setSubLedgers(sl.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setTestResult(null); setTestError(null); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.term_name.trim()) return showAlert('Term Name is required', 'danger');
        if (!form.applicable_sales_entry && !form.applicable_purchase_entry && !form.applicable_additional_expense && !form.applicable_production_entry) {
            return showAlert('Select at least one: Sales Entry, Purchase Entry, or Additional Expense', 'danger');
        }
        try {
            if (editingId) {
                await authFetch(`/api/billing-terms/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
                showAlert('Billing term updated', 'success');
            } else {
                await authFetch('/api/billing-terms', { method: 'POST', body: JSON.stringify(form) });
                showAlert('Billing term created', 'success');
            }
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = (row) => {
        setEditingId(row.id);
        setForm({ ...emptyForm, ...row });
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Deactivate "${row.term_name}"?`)) return;
        try {
            await authFetch(`/api/billing-terms/${row.id}`, { method: 'DELETE' });
            showAlert('Billing term deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: test the formula live, server-side (the SAME safe
    // evaluator that will run at real billing time), before saving.
    const testFormula = async () => {
        setTestError(null);
        setTestResult(null);
        if (!form.formula_expression.trim()) return setTestError('Type a formula first');
        try {
            const res = await authFetch('/api/billing-terms/preview', {
                method: 'POST',
                body: JSON.stringify({ formula: form.formula_expression, basic_amount: testAmount, quantity: testQty })
            });
            setTestResult(res.data.total);
        } catch (err) {
            setTestError(err.message);
        }
    };

    const columns = [
        { key: 'term_code', label: 'Code', type: 'text' },
        { key: 'term_name', label: 'Name', type: 'text' },
        { key: 'term_category', label: 'Category', type: 'text' },
        { key: 'calculation_mode', label: 'Mode', type: 'text' },
        {
            key: 'rate_percentage', label: 'Rate / Amount', type: 'text',
            render: r => r.calculation_mode === 'percentage' ? `${r.rate_percentage}%`
                : r.calculation_mode === 'fixed_amount' ? r.fixed_amount
                : r.calculation_mode === 'both' ? `${r.rate_percentage}% + ${r.fixed_amount}`
                : r.calculation_mode === 'free_quantity' ? `${r.fixed_amount} free (${r.quantity_unit})`
                : 'Formula'
        },
        { key: 'sign', label: 'Sign', type: 'text' },
        { key: 'is_enabled', label: 'Enabled', type: 'text', render: r => r.is_enabled ? '✅' : '❌' }
    ];

    return (
        <Layout>
        <div className="max-w-5xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Billing Terms</h1>
                <button onClick={() => { resetForm(); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Billing Term'}
                </button>
            </div>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {showForm && (
                <form ref={formRef} onSubmit={handleSubmit} className="bg-white border rounded-xl p-6 mb-6 space-y-4">
                    <h2 className="font-semibold text-lg">{editingId ? 'Edit Billing Term' : 'Create New Billing Term'}</h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                            <label className="erp-label">Term Name *</label>
                            <input className="erp-input" value={form.term_name} onChange={e => setForm({ ...form, term_name: e.target.value })} required />
                        </div>
                        <div>
                            <label className="erp-label">Category</label>
                            <select className="erp-input" value={form.term_category} onChange={e => setForm({ ...form, term_category: e.target.value })}>
                                <option value="general">General</option>
                                <option value="additional">Additional</option>
                                <option value="rounded_off">Rounded Off</option>
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Display Order <span className="text-xs text-gray-400">(evaluation sequence)</span></label>
                            <input type="number" min="1" className="erp-input" value={form.display_order} onChange={e => setForm({ ...form, display_order: e.target.value })} />
                        </div>

                        <div>
                            <label className="erp-label">Tax Type</label>
                            <select className="erp-input" value={form.tax_type} onChange={e => setForm({ ...form, tax_type: e.target.value })}>
                                <option value="none">None</option>
                                <option value="vat">VAT</option>
                                <option value="discount">Discount</option>
                                <option value="excise">Excise</option>
                                <option value="service_tax">Service Tax</option>
                                <option value="tsc">TSC</option>
                                <option value="cash_discount">Cash Discount</option>
                                <option value="custom">Custom</option>
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Basis</label>
                            <select className="erp-input" value={form.basis} onChange={e => setForm({ ...form, basis: e.target.value })}>
                                <option value="value">Value</option>
                                <option value="quantity">Quantity</option>
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Quantity Unit</label>
                            <select className="erp-input" value={form.quantity_unit} disabled={form.basis !== 'quantity'}
                                onChange={e => setForm({ ...form, quantity_unit: e.target.value })}>
                                <option value="primary">Primary</option>
                                <option value="secondary">Secondary</option>
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Sign</label>
                            <select className="erp-input" value={form.sign} onChange={e => setForm({ ...form, sign: e.target.value })}>
                                <option value="+">+ Add</option>
                                <option value="-">− Subtract</option>
                            </select>
                        </div>

                        <div className="md:col-span-3">
                            <label className="erp-label">Description</label>
                            <input className="erp-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                        </div>
                    </div>

                    {/* ==================== CALCULATION ==================== */}
                    <div className="border-t pt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Calculation</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="erp-label">Calculation Mode *</label>
                                <select className="erp-input" value={form.calculation_mode} onChange={e => setForm({ ...form, calculation_mode: e.target.value })}>
                                    <option value="fixed_amount">Amount Only</option>
                                    <option value="percentage">Rate Only</option>
                                    <option value="both">Both (Rate + Amount)</option>
                                    <option value="formula">Formula (advanced)</option>
                                    <option value="free_quantity">Free Quantity (no charge)</option>
                                </select>
                            </div>
                            <div>
                                <label className="erp-label">Calculate From (Base)</label>
                                <select className="erp-input" value={form.base_reference} onChange={e => setForm({ ...form, base_reference: e.target.value })}>
                                    <option value="basic_amount">Basic Amount</option>
                                    <option value="running_total">Running Total (all earlier terms)</option>
                                    <option value="specific_term">A Specific Term</option>
                                </select>
                            </div>
                            {form.base_reference === 'specific_term' && (
                                <div>
                                    <label className="erp-label">Which Term</label>
                                    <SearchablePopupSelect
                                        listKey="billing_term_ref_picker"
                                        columns={[{ key: 'term_code', label: 'Code' }, { key: 'term_name', label: 'Name' }]}
                                        defaultVisibleKeys={['term_name']}
                                        items={rows.filter(r => r.id !== editingId)}
                                        getId={r => r.id}
                                        getLabel={r => `${r.term_name} (${r.term_code})`}
                                        searchKeys={['term_name', 'term_code']}
                                        value={form.base_reference_term_id}
                                        onChange={id => setForm({ ...form, base_reference_term_id: id })}
                                        placeholder="Select term"
                                    />
                                </div>
                            )}
                        </div>

                        {form.calculation_mode === 'fixed_amount' && (
                            <div className="mt-3 max-w-xs">
                                <label className="erp-label">Fixed Amount *</label>
                                <input type="number" step="0.01" className="erp-input" value={form.fixed_amount} onChange={e => setForm({ ...form, fixed_amount: e.target.value })} />
                            </div>
                        )}

                        {form.calculation_mode === 'percentage' && (
                            <div className="mt-3 max-w-xs">
                                <label className="erp-label">Rate / Percentage % *</label>
                                <input type="number" step="0.01" className="erp-input" value={form.rate_percentage} onChange={e => setForm({ ...form, rate_percentage: e.target.value })} />
                            </div>
                        )}

                        {form.calculation_mode === 'both' && (
                            <div className="mt-3 grid grid-cols-2 gap-4 max-w-md">
                                <div>
                                    <label className="erp-label">Rate / Percentage % *</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.rate_percentage} onChange={e => setForm({ ...form, rate_percentage: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Plus Fixed Amount</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.fixed_amount} onChange={e => setForm({ ...form, fixed_amount: e.target.value })} />
                                </div>
                                <p className="text-xs text-gray-400 col-span-2">Computed as: (Base × Rate%) + Fixed Amount</p>
                            </div>
                        )}

                        {form.calculation_mode === 'free_quantity' && (
                            <div className="mt-3 grid grid-cols-2 gap-4 max-w-md">
                                <div>
                                    <label className="erp-label">Free Quantity *</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.fixed_amount} onChange={e => setForm({ ...form, fixed_amount: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">In Unit</label>
                                    <select className="erp-input" value={form.quantity_unit} onChange={e => setForm({ ...form, quantity_unit: e.target.value })}>
                                        <option value="primary">Primary</option>
                                        <option value="secondary">Alt (Secondary)</option>
                                    </select>
                                </div>
                                <p className="text-xs text-gray-400 col-span-2">
                                    Entering the value here grants this many free units of the item (in the
                                    chosen unit) instead of any monetary charge/discount - it never affects
                                    the billed amount.
                                </p>
                            </div>
                        )}

                        {['percentage', 'both', 'formula'].includes(form.calculation_mode) && (
                            <div className="mt-3 max-w-xs">
                                <label className="erp-label">Maximum Amount <span className="text-xs text-gray-400">(cap, optional)</span></label>
                                <input type="number" step="0.01" placeholder="0 = no cap" className="erp-input" value={form.maximum_amount} onChange={e => setForm({ ...form, maximum_amount: e.target.value })} />
                                <p className="text-xs text-gray-400 mt-1">If the calculated amount exceeds this, it's capped here instead.</p>
                            </div>
                        )}

                        {form.calculation_mode === 'formula' && (
                            <div className="mt-3 bg-gray-50 border-2 border-dashed border-blue-100 rounded-lg p-4">
                                <label className="erp-label">Formula Expression *</label>
                                <input
                                    className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                                    placeholder="e.g. ({basic_amount} + {term:FREIGHT}) * 0.13"
                                    value={form.formula_expression}
                                    onChange={e => setForm({ ...form, formula_expression: e.target.value })}
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    Available: <code>{'{basic_amount}'}</code> <code>{'{quantity}'}</code> <code>{'{rate}'}</code> <code>{'{running_total}'}</code> <code>{'{term:CODE}'}</code> (another term's computed amount) — operators + − * / ( )
                                </p>

                                <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-blue-100">
                                    <div>
                                        <label className="erp-label">Test with Basic Amount</label>
                                        <input type="number" className="w-32 border rounded-lg px-2 py-1.5" value={testAmount} onChange={e => setTestAmount(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="erp-label">Test with Quantity</label>
                                        <input type="number" className="w-24 border rounded-lg px-2 py-1.5" value={testQty} onChange={e => setTestQty(e.target.value)} />
                                    </div>
                                    <button type="button" onClick={testFormula} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">▶ Test Formula</button>
                                    {testResult !== null && <span className="text-sm font-semibold text-green-700">Result: {testResult}</span>}
                                    {testError && <span className="text-sm font-semibold text-red-600">{testError}</span>}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ==================== ROUNDING & LEDGERS ==================== */}
                    <div className="border-t pt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Rounding &amp; Ledger Allocation</p>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                            <div>
                                <label className="erp-label">Rounding</label>
                                <select className="erp-input" value={form.rounding_method} onChange={e => setForm({ ...form, rounding_method: e.target.value })}>
                                    <option value="none">None</option>
                                    <option value="nearest">Nearest</option>
                                    <option value="up">Round Up</option>
                                    <option value="down">Round Down</option>
                                </select>
                            </div>
                            {form.rounding_method !== 'none' && (
                                <div>
                                    <label className="erp-label">Round To</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.rounding_precision} onChange={e => setForm({ ...form, rounding_precision: e.target.value })} />
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="erp-label">Billing Ledger</label>
                                <SearchablePopupSelect
                                    listKey="billing_ledger_picker"
                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                    defaultVisibleKeys={['account_name']}
                                    items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                    searchKeys={['account_name', 'account_code']}
                                    value={form.billing_ledger_id} onChange={id => setForm({ ...form, billing_ledger_id: id, sub_ledger_id: '', ...(form.return_ledger_id ? {} : { return_sub_ledger_id: '' }) })}
                                    placeholder="Select Billing Ledger"
                                />
                            </div>
                            <div>
                                <label className="erp-label">Return Ledger</label>
                                <SearchablePopupSelect
                                    listKey="return_ledger_picker"
                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                    defaultVisibleKeys={['account_name']}
                                    items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                    searchKeys={['account_name', 'account_code']}
                                    value={form.return_ledger_id} onChange={id => setForm({ ...form, return_ledger_id: id, return_sub_ledger_id: '' })}
                                    placeholder="Select Return Ledger"
                                />
                            </div>
                            <div>
                                <label className="erp-label">Expiry Return Ledger</label>
                                <SearchablePopupSelect
                                    listKey="expiry_return_ledger_picker"
                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                    defaultVisibleKeys={['account_name']}
                                    items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                    searchKeys={['account_name', 'account_code']}
                                    value={form.expiry_return_ledger_id} onChange={id => setForm({ ...form, expiry_return_ledger_id: id })}
                                    placeholder="Select Expiry Return Ledger"
                                />
                            </div>
                            {/* Real sub-ledgers, limited to the ledger each one sits under. */}
                            {[['sub_ledger_id', 'Billing Sub-Ledger', form.billing_ledger_id, 'Billing Ledger'],
                              ['return_sub_ledger_id', 'Return Sub-Ledger', form.return_ledger_id || form.billing_ledger_id, 'Return Ledger']].map(([key, label, parentId, parentLabel]) => {
                                const options = subLedgers.filter(sl => sl.main_ledger_id === parentId);
                                return (
                                    <div key={key}>
                                        <label className="erp-label">{label} <span className="text-xs text-gray-400 normal-case">(default; changeable per transaction)</span></label>
                                        <select className="erp-select" value={form[key] || ''} disabled={!parentId} onChange={e => setForm({ ...form, [key]: e.target.value })}>
                                            <option value="">{!parentId ? `Choose ${parentLabel} first` : options.length ? 'None' : `No sub-ledgers under this ${parentLabel}`}</option>
                                            {options.map(sl => <option key={sl.id} value={sl.id}>{sl.sub_ledger_name}{sl.sub_ledger_code ? ` (${sl.sub_ledger_code})` : ''}</option>)}
                                        </select>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ==================== OPTIONS ==================== */}
                    <div className="border-t pt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Used For (applicable to)</p>
                        <div className="flex flex-wrap gap-4 mb-4">
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.applicable_sales_entry} onChange={e => setForm({ ...form, applicable_sales_entry: e.target.checked })} /> Sales Entry</label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.applicable_purchase_entry} onChange={e => setForm({ ...form, applicable_purchase_entry: e.target.checked })} /> Purchase Entry</label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.applicable_additional_expense} onChange={e => setForm({ ...form, applicable_additional_expense: e.target.checked })} /> Additional Expense</label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.applicable_production_entry} onChange={e => setForm({ ...form, applicable_production_entry: e.target.checked })} /> Production Entry <span className="text-xs text-gray-400">(costing/report only - never posts to ledger)</span></label>
                        </div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Options</p>
                        <div className="flex flex-wrap gap-4 mb-3">
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.manual_override} onChange={e => setForm({ ...form, manual_override: e.target.checked })} /> Manual Override</label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.suppress_if_zero} onChange={e => setForm({ ...form, suppress_if_zero: e.target.checked })} /> Suppress If Zero</label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.include_in_profitability} onChange={e => setForm({ ...form, include_in_profitability: e.target.checked })} /> Include In Profitability</label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allow_summary} onChange={e => setForm({ ...form, allow_summary: e.target.checked })} /> Allow Summary</label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.product_wise} onChange={e => setForm({ ...form, product_wise: e.target.checked, show_product_term_summary: e.target.checked ? form.show_product_term_summary : false })} /> Product Wise</label>
                            <label className={`flex items-center gap-2 text-sm ${!form.product_wise ? 'text-gray-400' : ''}`}>
                                <input type="checkbox" checked={form.show_product_term_summary} disabled={!form.product_wise}
                                    onChange={e => setForm({ ...form, show_product_term_summary: e.target.checked })} />
                                Show Product Term Summary
                            </label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_enabled} onChange={e => setForm({ ...form, is_enabled: e.target.checked })} /> Enabled</label>
                        </div>
                        {form.tax_type === 'cash_discount' && (
                            <div className="grid grid-cols-3 gap-4 max-w-lg">
                                <div>
                                    <label className="erp-label">Credit Days</label>
                                    <input type="number" className="erp-input" value={form.credit_days} onChange={e => setForm({ ...form, credit_days: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Grace Days</label>
                                    <input type="number" className="erp-input" value={form.grace_days} onChange={e => setForm({ ...form, grace_days: e.target.value })} />
                                </div>
                                <div>
                                    <label className="erp-label">Discount (%)</label>
                                    <input type="number" step="0.01" className="erp-input" value={form.discount_percentage} onChange={e => setForm({ ...form, discount_percentage: e.target.value })} />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                            {editingId ? 'Update Billing Term' : 'Create Billing Term'}
                        </button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="billing_term_grid"
                auditTable="billing_terms"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                        <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Deactivate</button>
                    </div>
                )}
            />
        </div>
        </Layout>
    );
}
