// =============================================
// SystemControlSettings.jsx
// One settings object per tenant (not a list) - Tally F11/F12 and
// FACT-inspired company configuration, organized into 7 tabs. See
// database/18_system_control_settings_schema.sql for the full field
// list and research notes on what was added beyond the original ask.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';
import { refreshAppFeatures } from '../hooks/useAppFeatures';
import MasterCodesEditor from '../components/MasterCodesEditor';
import { RateTypesEditor } from '../components/pricing/PricingEditors';
import { clearEntrySettings } from '../components/entry/useEntrySettings';
import { clearDocPolicy } from '../components/entry/DocActions';

const TABS = [
    { key: 'business', label: '🏢 Business Nature' },
    { key: 'codes', label: '🔢 Master Codes' },
    { key: 'rateTypes', label: '📊 Rate Types' },
    { key: 'regional', label: '🌐 Regional & Format' },
    { key: 'ledgerMapping', label: '📒 Ledger Mapping' },
    { key: 'inventory', label: '📦 Inventory & UOM' },
    { key: 'stockPosting', label: '🔁 Stock Posting' },
    { key: 'billing', label: '🧾 Billing Behavior' },
    { key: 'termMapping', label: '🧮 Term Mapping' },
    { key: 'warnings', label: '⚠️ Warnings & Confirmations' },
    { key: 'misc', label: '🌍 Multi-Currency & Misc' },
    { key: 'captions', label: '🏷️ Captions' }
];

function Field({ label, hint, value, onChange, type = 'text', ...props }) {
    return (
        <div>
            <label className="erp-label">{label} {hint && <span className="text-xs text-gray-400">({hint})</span>}</label>
            <input type={type} className="erp-input" value={value ?? ''} onChange={e => onChange(e.target.value)} {...props} />
        </div>
    );
}
function SelectField({ label, hint, value, onChange, options }) {
    return (
        <div>
            <label className="erp-label">{label} {hint && <span className="text-xs text-gray-400">({hint})</span>}</label>
            <select className="erp-input" value={value ?? ''} onChange={e => onChange(e.target.value)}>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        </div>
    );
}
function CheckField({ label, checked, onChange }) {
    return (
        <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} /> {label}
        </label>
    );
}
function LedgerField({ label, value, onChange, ledgers }) {
    return (
        <div>
            <label className="erp-label">{label}</label>
            <SearchablePopupSelect
                listKey={`sc_ledger_${label}`}
                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                defaultVisibleKeys={['account_name']}
                items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                searchKeys={['account_name', 'account_code']}
                value={value} onChange={onChange}
                placeholder="None selected"
            />
        </div>
    );
}

// Business Nature: decides which industry modules the menus offer. Trading is the default;
// Poultry turns on the Poultry & Hatchery module (broiler and / or hatchery).
const NATURES = [
    { value: 'trading', label: 'Trading (default)', note: 'Buy and sell goods - the standard accounting, inventory, sales and purchase screens.' },
    { value: 'distribution', label: 'Distribution', note: 'Trading with salesman routes, orders and schemes - same screens as trading.' },
    { value: 'retail', label: 'Retail', note: 'Counter sales - same screens as trading.' },
    { value: 'manufacturing', label: 'Manufacturing', note: 'Trading + BOM and production orders.' },
    { value: 'service', label: 'Service', note: 'Service billing - inventory screens stay available.' },
    { value: 'construction', label: 'Construction / Contractor', note: 'Adds contract sites (thekka) with BOQ, running bills to the client, material, wages, petti thekka (sub-contract) taken or given, and site-wise profit / loss.' },
    { value: 'poultry', label: 'Poultry & Hatchery', note: 'Adds shed-wise broiler batches (lifecycle, consumption, mortality, profitability) and hatchery management, posted to the same accounts and inventory.' }
];

// Term Mapping: which billing term does which job, for sales and for purchase
const TERM_JOBS = [['vat', 'VAT'], ['excise', 'Excise Duty'], ['disc1', 'Product Discount 1'], ['disc2', 'Product Discount 2'], ['disc3', 'Product Discount 3'],
    ['disc4', 'Product Discount 4'], ['disc5', 'Product Discount 5'], ['bill_disc', 'Bill Discount']];

const YES_NO = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];

export default function SystemControlSettings() {
    const { authFetch } = useAuth();
    const enterAreaRef = useRef(null);
    useEnterKeyNavigation(enterAreaRef);
    const [settings, setSettings] = useState(null);
    const [ledgers, setLedgers] = useState([]);
    const [billingTerms, setBillingTerms] = useState([]);
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'business');
    const [alert, setAlert] = useState(null);
    const [saving, setSaving] = useState(false);
    // Stock Posting tab: each branch's / warehouse's own stock ledger + the ledger check.
    const [stockMap, setStockMap] = useState(null);
    const [stockCheck, setStockCheck] = useState([]);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const loadStockPosting = useCallback(async () => {
        try {
            const [m, chk] = await Promise.all([authFetch('/api/stock-posting/mapping'), authFetch('/api/stock-posting/check')]);
            setStockMap(m.data); setStockCheck(chk.data || []);
        } catch (err) { showAlert(err.message, 'danger'); }
    }, [authFetch]);
    useEffect(() => { if (tab === 'stockPosting' && !stockMap) loadStockPosting(); }, [tab, stockMap, loadStockPosting]);
    const setStockLedger = (kind, id, ledgerId) => setStockMap(m => ({ ...m, [kind]: m[kind].map(r => r.id === id ? { ...r, stock_ledger_id: ledgerId || null, _dirty: true } : r) }));

    const load = useCallback(async () => {
        try {
            const [s, l] = await Promise.all([
                authFetch('/api/system-control'),
                authFetch('/api/ledger-accounts?pageSize=1000&sortBy=account_name&sortDir=asc')
            ]);
            setSettings(s.data);
            setLedgers(l.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (tab === 'termMapping' && !billingTerms.length) authFetch('/api/billing-terms').then(r => setBillingTerms(r.data || [])).catch(err => showAlert(err.message, 'danger'));
    }, [tab, billingTerms.length, authFetch]);
    const setTerm = (side, job, id) => setSettings(s => ({ ...s, term_mapping: { ...(s.term_mapping || {}), [side]: { ...((s.term_mapping || {})[side] || {}), [job]: id || null } } }));

    const set = (key, value) => setSettings(s => ({ ...s, [key]: value }));

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await authFetch('/api/system-control', { method: 'PUT', body: JSON.stringify(settings) });
            setSettings(res.data);
            refreshAppFeatures();
            clearEntrySettings();
            clearDocPolicy();
            if (stockMap) {
                const dirty = kind => stockMap[kind].filter(r => r._dirty).map(r => ({ id: r.id, stock_ledger_id: r.stock_ledger_id }));
                if (dirty('branches').length || dirty('warehouses').length) {
                    await authFetch('/api/stock-posting/mapping', { method: 'PUT', body: JSON.stringify({ branches: dirty('branches'), warehouses: dirty('warehouses') }) });
                }
                await loadStockPosting();
            }
            showAlert('System control settings saved', 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setSaving(false);
        }
    };

    const toggleTermApplicability = (term) => {
        const current = settings.popup_product_wise_term_applicability || [];
        set('popup_product_wise_term_applicability', current.includes(term) ? current.filter(t => t !== term) : [...current, term]);
    };

    if (!settings) return <Layout><div className="max-w-5xl mx-auto p-4 text-gray-400">Loading...</div></Layout>;

    return (
        <Layout>
        <div ref={enterAreaRef} className="erp-shell">
          <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">⚙️ System Control</span>
                <div className="erp-header-actions">
                    <button onClick={handleSave} disabled={saving} className="erp-header-btn primary">{saving ? 'Saving...' : '💾 Save Settings'}</button>
                </div>
            </div>

            {alert && (
                <div className={`m-2 px-4 py-2 text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="erp-tabs">
                {TABS.map(t => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`erp-tab ${tab === t.key ? 'active' : ''}`}>{t.label}</button>
                ))}
            </div>

            <div className="erp-tab-content">

                {tab === 'codes' && <MasterCodesEditor />}
                {tab === 'rateTypes' && <RateTypesEditor />}

                {tab === 'business' && (() => {
                    const nature = settings.business_nature || 'trading';
                    const pf = settings.poultry_features || { broiler: true, hatchery: false };
                    return (
                        <div>
                            <div className="nav-groupbox">
                                <span className="nav-groupbox-title">Business Nature</span>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {NATURES.map(n => (
                                        <label key={n.value} className={`flex items-start gap-2 p-2 border cursor-pointer ${nature === n.value ? 'bg-[#dde8f6] border-[#4a7ab5]' : 'bg-white border-[#d4d0c8]'}`}>
                                            <input type="radio" name="business_nature" className="mt-1" checked={nature === n.value} onChange={() => set('business_nature', n.value)} />
                                            <span><span className="font-semibold text-sm">{n.label}</span><br /><span className="text-xs text-gray-600">{n.note}</span></span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            {nature === 'poultry' && (
                                <div className="nav-groupbox">
                                    <span className="nav-groupbox-title">Poultry & Hatchery features</span>
                                    <div className="flex flex-col gap-1">
                                        <CheckField label="Broiler farming - shed-wise batches: placement, daily log (feed / medicine / vaccine / mortality / weight), lifting, profitability" checked={pf.broiler !== false} onChange={v => set('poultry_features', { ...pf, broiler: v })} />
                                        <CheckField label="Hatchery - egg setting, candling, hatch (A / B grade chicks), fertility / hatchability, chick cost" checked={!!pf.hatchery} onChange={v => set('poultry_features', { ...pf, hatchery: v })} />
                                    </div>
                                    <p className="text-xs text-gray-600 mt-2">Every issue and receipt is posted as a Stock Adjustment (reason Consumption / Production) with the shed / batch cost center, so stock, ledgers and P&L stay on the normal posting.
                                        After saving, open <a className="text-blue-700 underline" href="/poultry/setup">Poultry Setup</a> to choose the consumption ledger, warehouse and item roles.</p>
                                </div>
                            )}
                            {nature !== 'poultry' && settings.business_nature === 'poultry' && <p className="nav-msg warn">Poultry menus will be hidden; poultry records stay in the database.</p>}
                        </div>
                    );
                })()}

                {/* ==================== 1. REGIONAL & FORMAT ==================== */}
                {tab === 'regional' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <SelectField label="Date In Entry" value={settings.date_format_entry} onChange={v => set('date_format_entry', v)}
                            options={[{ value: 'english', label: 'English' }, { value: 'nepali', label: 'Nepali' }, { value: 'dual', label: 'Dual' }]} />
                        <SelectField label="Date In Reports" value={settings.date_format_reports} onChange={v => set('date_format_reports', v)}
                            options={[{ value: 'english', label: 'English' }, { value: 'nepali', label: 'Nepali' }, { value: 'dual', label: 'Dual' }]} />
                        <SelectField label="Date Type" hint="overall calendar" value={settings.date_type} onChange={v => set('date_type', v)}
                            options={[{ value: 'dual', label: 'Dual' }, { value: 'nepali', label: 'Nepali' }]} />

                        <SelectField label="Number Format In Qty" value={settings.number_format_qty} onChange={v => set('number_format_qty', v)}
                            options={['0', '0.00', '0.000', '0.0000'].map(v => ({ value: v, label: v }))} />
                        <SelectField label="Number Format In Rate" value={settings.number_format_rate} onChange={v => set('number_format_rate', v)}
                            options={['0', '0.00', '0.000', '0.0000'].map(v => ({ value: v, label: v }))} />
                        <SelectField label="Number Format In Amount" value={settings.number_format_amount} onChange={v => set('number_format_amount', v)}
                            options={['0', '0.00', '0.000', '0.0000'].map(v => ({ value: v, label: v }))} />
                        <SelectField label="Number Format In Alt Qty" value={settings.number_format_alt_qty} onChange={v => set('number_format_alt_qty', v)}
                            options={['0', '0.00', '0.000', '0.0000'].map(v => ({ value: v, label: v }))} />
                        <SelectField label="Number Format In Alt1 Qty" value={settings.number_format_alt1_qty} onChange={v => set('number_format_alt1_qty', v)}
                            options={['0', '0.00', '0.000', '0.0000'].map(v => ({ value: v, label: v }))} />

                        <SelectField label="Word Case In Master" hint="also Master Font Type" value={settings.word_case_master} onChange={v => set('word_case_master', v)}
                            options={[{ value: 'upper', label: 'Upper' }, { value: 'lower', label: 'Lower' }, { value: 'proper', label: 'Proper' }, { value: 'user_entered', label: 'As User Entered' }]} />
                        <SelectField label="Number In Word Format" value={settings.number_in_words_format} onChange={v => set('number_in_words_format', v)}
                            options={[{ value: 'lakhs', label: 'Lakhs' }, { value: 'million', label: 'Million' }]} />
                    </div>
                )}

                {/* ==================== 2. LEDGER MAPPING ==================== */}
                {tab === 'ledgerMapping' && (
                    <div className="space-y-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase">Sales Side</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <LedgerField label="Sales Account Mapping" value={settings.sales_account_ledger_id} onChange={v => set('sales_account_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Sales Return Account Mapping" value={settings.sales_return_account_ledger_id} onChange={v => set('sales_return_account_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Sales Brk Exp Return Ac Mapping" value={settings.sales_brokerage_exp_return_ledger_id} onChange={v => set('sales_brokerage_exp_return_ledger_id', v)} ledgers={ledgers} />
                        </div>

                        <p className="text-xs font-semibold text-gray-500 uppercase pt-2 border-t">Purchase Side</p>
                        <CheckField label="Same as Sales Part" checked={settings.purchase_same_as_sales} onChange={v => set('purchase_same_as_sales', v)} />
                        {/* FIX: "Same as Sales Part" only makes sense for the
                            Purchase Account itself. The ledgers below have no
                            sales-side twin AND are used by GL posting
                            (grnAccounting.js / purchaseNonsaleableReturnRoutes.js)
                            whether visible or not - hiding them left a stored
                            value silently in force that nobody could see. */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {!settings.purchase_same_as_sales && (
                                <LedgerField label="Purchase Account Mapping" value={settings.purchase_account_ledger_id} onChange={v => set('purchase_account_ledger_id', v)} ledgers={ledgers} />
                            )}
                            <LedgerField label="Purchase Return Account Mapping" value={settings.purchase_return_account_ledger_id} onChange={v => set('purchase_return_account_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="GRN Clearing Ledger (GR/IR)" value={settings.grn_clearing_ledger_id} onChange={v => set('grn_clearing_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Non-saleable Write-off Expense Ledger" value={settings.nonsaleable_writeoff_expense_ledger_id} onChange={v => set('nonsaleable_writeoff_expense_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Non-saleable Stock Asset Ledger" value={settings.nonsaleable_stock_asset_ledger_id} onChange={v => set('nonsaleable_stock_asset_ledger_id', v)} ledgers={ledgers} />
                        </div>
                        <p className="text-xs text-gray-400">Purchase Return: if left blank, returns credit their own Goods Account. GRN Clearing: if left blank, GRNs make no GL entry (stock only).</p>

                        <p className="text-xs font-semibold text-gray-500 uppercase pt-2 border-t">Stock & Other Ledgers</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <LedgerField label="Opening Stock Ledger" value={settings.opening_stock_ledger_id} onChange={v => set('opening_stock_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Closing Stock Ledger" value={settings.closing_stock_ledger_id} onChange={v => set('closing_stock_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="WIP Ledger" value={settings.wip_ledger_id} onChange={v => set('wip_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Goods Transit Ledger" value={settings.goods_transit_ledger_id} onChange={v => set('goods_transit_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Inter Branch Transaction Ledger" value={settings.inter_branch_transaction_ledger_id} onChange={v => set('inter_branch_transaction_ledger_id', v)} ledgers={ledgers} />
                        </div>

                        <p className="text-xs font-semibold text-gray-500 uppercase pt-2 border-t">Tax & Default Ledgers</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <LedgerField label="VAT Ledger Mapping" value={settings.vat_ledger_id} onChange={v => set('vat_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="TDS Ledger Mapping" value={settings.tds_ledger_id} onChange={v => set('tds_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Excise Duty Mapping" value={settings.excise_duty_ledger_id} onChange={v => set('excise_duty_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Default Cash Ledger" value={settings.default_cash_ledger_id} onChange={v => set('default_cash_ledger_id', v)} ledgers={ledgers} />
                            <LedgerField label="Default Bank Ledger" value={settings.default_bank_ledger_id} onChange={v => set('default_bank_ledger_id', v)} ledgers={ledgers} />
                        </div>
                    </div>
                )}

                {/* ==================== 3. INVENTORY & UOM ==================== */}
                {tab === 'inventory' && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <SelectField label="Dual UOM" value={String(!!settings.dual_uom_enabled)} onChange={v => set('dual_uom_enabled', v === 'true')} options={YES_NO} />
                            {settings.dual_uom_enabled && (
                                <SelectField label="Auto Convert" value={settings.dual_uom_mode} onChange={v => set('dual_uom_mode', v)}
                                    options={[{ value: 'auto_convert', label: 'Auto Convert' }, { value: 'fixed', label: 'Fixed UOM' }]} />
                            )}
                            {settings.dual_uom_enabled && settings.dual_uom_mode === 'auto_convert' && (
                                <SelectField label="Reverse Conversion" value={String(!!settings.dual_uom_reverse_conversion)} onChange={v => set('dual_uom_reverse_conversion', v === 'true')} options={YES_NO} />
                            )}
                            <SelectField label="Multi Warehouse" hint="warehouse fields show only when Yes" value={String(!!settings.multi_warehouse)} onChange={v => set('multi_warehouse', v === 'true')} options={YES_NO} />
                            <SelectField label="Product Search In Entries" value={settings.product_search_by || 'name'} onChange={v => set('product_search_by', v)}
                                options={[{ value: 'name', label: 'By Product Name' }, { value: 'code', label: 'By Product Code' }]} />
                            <SelectField label="Free Qty System" value={String(!!settings.free_qty_system)} onChange={v => set('free_qty_system', v === 'true')} options={YES_NO} />
                            <SelectField label="Batch System" value={settings.batch_system} onChange={v => set('batch_system', v)}
                                options={[{ value: 'none', label: 'None' }, { value: 'retail', label: 'Retail' }, { value: 'medicine', label: 'Medicine' }, { value: 'other', label: 'Other' }]} />
                            {settings.batch_system !== 'none' && (
                                <Field label="Caption For Batch" hint="renames the label everywhere" value={settings.batch_label} onChange={v => set('batch_label', v)} />
                            )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t">
                            <CheckField label="Product Company Compulsory - Sales (customer transactions)" checked={settings.product_company_compulsory_sales} onChange={v => set('product_company_compulsory_sales', v)} />
                            <CheckField label="Product Company Compulsory - Purchase (vendor transactions)" checked={settings.product_company_compulsory_purchase} onChange={v => set('product_company_compulsory_purchase', v)} />
                            <CheckField label="Multiple Batch Auto Generate" checked={settings.multiple_batch_auto_generate} onChange={v => set('multiple_batch_auto_generate', v)} />
                            <CheckField label="Enable Vehicle Options" checked={settings.enable_vehicle_options} onChange={v => set('enable_vehicle_options', v)} />
                            {settings.enable_vehicle_options && (
                                <Field label="Caption For Vehicle" value={settings.vehicle_label} onChange={v => set('vehicle_label', v)} />
                            )}
                            <CheckField label="Enable Barcode System" checked={settings.enable_barcode_system} onChange={v => set('enable_barcode_system', v)} />
                            <CheckField label="Enable Barcode Print" checked={settings.enable_barcode_print} onChange={v => set('enable_barcode_print', v)} />
                            <CheckField label="FIFO Adjustment (Unit Wise)" checked={settings.fifo_adjustment_unit_wise} onChange={v => set('fifo_adjustment_unit_wise', v)} />
                            <CheckField label="Enable Exp. Date" checked={settings.enable_exp_date} onChange={v => set('enable_exp_date', v)} />
                            <CheckField label="Enable Mfg. Date" checked={settings.enable_mfg_date} onChange={v => set('enable_mfg_date', v)} />
                            <CheckField label="Enable Serial Number" checked={settings.enable_serial_number} onChange={v => set('enable_serial_number', v)} />
                            {settings.enable_serial_number && (
                                <Field label="Caption For Serial Number" value={settings.serial_number_label} onChange={v => set('serial_number_label', v)} />
                            )}                            <CheckField label="Update Last Sales Rate from Bill" checked={settings.update_last_sales_rate_from_bill} onChange={v => set('update_last_sales_rate_from_bill', v)} />
                            <CheckField label="Reorder Level Tracking" checked={settings.reorder_level_tracking} onChange={v => set('reorder_level_tracking', v)} />
                            <CheckField label="Actual vs Billed Qty" checked={settings.actual_vs_billed_qty} onChange={v => set('actual_vs_billed_qty', v)} />
                            {settings.enable_exp_date && (
                                <Field label="Near-Expiry Alert (Days)" hint="warn this many days before expiry" type="number" value={settings.near_expiry_alert_days} onChange={v => set('near_expiry_alert_days', v)} />
                            )}
                            <SelectField label="Negative Stock Control" value={settings.negative_stock_control} onChange={v => set('negative_stock_control', v)} options={[
                                { value: 'none', label: 'No Action' }, { value: 'warn', label: 'Warn' }, { value: 'block', label: 'Block' }
                            ]} />
                            <SelectField label="Costing of Batch-wise Products" value={settings.batch_costing_method || 'same'} onChange={v => set('batch_costing_method', v)} options={[
                                { value: 'same', label: 'Same as report / statement method' }, { value: 'fifo', label: 'FIFO' }, { value: 'lifo', label: 'LIFO (comparison only - not NFRS)' },
                                { value: 'moving_average', label: 'Moving Average' }, { value: 'weighted_average', label: 'Weighted Average' }, { value: 'batch_wise', label: 'Batch-wise (actual cost of each batch)' }
                            ]} />
                            <SelectField label="Costing of Serial-no Products" value={settings.serial_costing_method || 'same'} onChange={v => set('serial_costing_method', v)} options={[
                                { value: 'same', label: 'Same as report / statement method' }, { value: 'fifo', label: 'FIFO' }, { value: 'lifo', label: 'LIFO (comparison only - not NFRS)' },
                                { value: 'moving_average', label: 'Moving Average' }, { value: 'weighted_average', label: 'Weighted Average' }, { value: 'serial_wise', label: 'Serial-wise (actual cost of each serial no)' }
                            ]} />
                            <CheckField label="Block Cancel if Bill-wise Settled" checked={settings.block_cancel_if_settled} onChange={v => set('block_cancel_if_settled', v)} />
                            <SelectField label="Back-date Entry Control" value={settings.backdate_entry_control} onChange={v => set('backdate_entry_control', v)} options={[
                                { value: 'none', label: 'No Action' }, { value: 'warn', label: 'Warn' }, { value: 'block', label: 'Block' }
                            ]} />
                            <SelectField label="Post-date Entry Control" value={settings.postdate_entry_control} onChange={v => set('postdate_entry_control', v)} options={[
                                { value: 'none', label: 'No Action' }, { value: 'warn', label: 'Warn' }, { value: 'block', label: 'Block' }
                            ]} />
                            <Field label="Default VAT %" type="number" step="0.01" value={settings.default_vat_percent} onChange={v => set('default_vat_percent', v)} />
                            <Field label="Default TDS %" type="number" step="0.01" value={settings.default_tds_percent} onChange={v => set('default_tds_percent', v)} />
                        </div>
                    </div>
                )}

                {/* ==================== STOCK POSTING ==================== */}
                {/* Which ledgers Stock Transfer / Stock Adjustment post to. Stock is
                    valued periodically (closing stock from the stock ledger replaces
                    the GL balance of Inventory-group ledgers), so transfer and
                    contra ledgers must be Inventory / Purchase-group ledgers - see
                    server/utils/stockAccounting.js. */}
                {tab === 'stockPosting' && (
                    <div className="space-y-5">
                        <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Stock Transfer</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <SelectField label="Post Stock Transfer to Accounts" value={settings.stock_transfer_gl_posting || 'none'} onChange={v => set('stock_transfer_gl_posting', v)} options={[
                                    { value: 'none', label: 'No - stock only' }, { value: 'branch_only', label: 'Branch-to-branch transfers only' }, { value: 'all', label: 'All transfers (warehouse + branch)' }
                                ]} />
                                <SelectField label="Branch Transfer Receipt" value={settings.branch_transfer_receipt || 'direct'} onChange={v => set('branch_transfer_receipt', v)} options={[
                                    { value: 'direct', label: 'Direct - stock arrives when posted' }, { value: 'in_transit', label: 'In Transit - receiving branch must Receive' }
                                ]} />
                                <div />
                                <LedgerField label="Stock Transfer In (receiving, Dr)" value={settings.stock_transfer_in_ledger_id} onChange={v => set('stock_transfer_in_ledger_id', v)} ledgers={ledgers} />
                                <LedgerField label="Stock Transfer Out (sending, Cr)" value={settings.stock_transfer_out_ledger_id} onChange={v => set('stock_transfer_out_ledger_id', v)} ledgers={ledgers} />
                                <LedgerField label="Goods in Transit" value={settings.goods_transit_ledger_id} onChange={v => set('goods_transit_ledger_id', v)} ledgers={ledgers} />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">A branch's or warehouse's own stock account (below) is used before these defaults.</p>
                        </div>

                        <div className="pt-3 border-t">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Stock Adjustment</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <SelectField label="Post Stock Adjustment to Accounts" value={String(!!settings.stock_adjustment_gl_posting)} onChange={v => set('stock_adjustment_gl_posting', v === 'true')} options={YES_NO} />
                                <LedgerField label="Stock Adjustment (contra)" value={settings.stock_adjustment_contra_ledger_id} onChange={v => set('stock_adjustment_contra_ledger_id', v)} ledgers={ledgers} />
                                <div />
                                <LedgerField label="Stock Shortage / Loss (Dr)" value={settings.stock_shortage_ledger_id} onChange={v => set('stock_shortage_ledger_id', v)} ledgers={ledgers} />
                                <LedgerField label="Stock Damage / Expiry (Dr)" value={settings.stock_damage_ledger_id} onChange={v => set('stock_damage_ledger_id', v)} ledgers={ledgers} />
                                <LedgerField label="Stock Excess / Gain (Cr)" value={settings.stock_excess_ledger_id} onChange={v => set('stock_excess_ledger_id', v)} ledgers={ledgers} />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Damage / Expiry blank = Shortage ledger is used.</p>
                        </div>

                        <div className="pt-3 border-t">
                            <CheckField label="Allow changing these accounts on the entry (Stock Transfer / Stock Adjustment)" checked={settings.stock_posting_allow_ledger_change !== false} onChange={v => set('stock_posting_allow_ledger_change', v)} />
                        </div>

                        <div className="pt-3 border-t">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Accounting entries made</p>
                            <table className="w-full text-sm border">
                                <thead className="bg-gray-50"><tr><th className="text-left p-2">Case</th><th className="text-left p-2">Debit</th><th className="text-left p-2">Credit</th><th className="text-left p-2">Effect</th></tr></thead>
                                <tbody>
                                    {[
                                        ['Transfer (direct)', 'Receiving branch / warehouse stock a/c (else Transfer In)', 'Sending branch / warehouse stock a/c (else Transfer Out)', 'Nil on profit and Balance Sheet'],
                                        ['Branch transfer - Dispatch', 'Goods in Transit', 'Sending stock a/c', 'Nil'],
                                        ['Branch transfer - Receive', 'Receiving stock a/c', 'Goods in Transit', 'Nil'],
                                        ['Adjustment - Shortage', 'Stock Shortage / Loss', 'Stock Adjustment', 'Loss moves out of COGS into its own expense line'],
                                        ['Adjustment - Damage / Expiry', 'Stock Damage / Expiry', 'Stock Adjustment', 'Same, shown as damage'],
                                        ['Adjustment - Excess', 'Stock Adjustment', 'Stock Excess / Gain', 'Gain moves out of COGS into other income']
                                    ].map(r => <tr key={r[0]} className="border-t">{r.map((c, i) => <td key={i} className={`p-2 ${i === 0 ? 'font-medium' : ''}`}>{c}</td>)}</tr>)}
                                </tbody>
                            </table>
                            <p className="text-xs text-gray-500 mt-2">
                                Closing stock always comes from the stock ledger (quantity x valuation method), and Inventory-group ledger balances are replaced by it.
                                So <b>Transfer In / Out, Goods in Transit, branch / warehouse stock and Stock Adjustment</b> ledgers must be under an <b>Inventory</b> (Stock-in-Hand) group
                                or a <b>Purchase</b> group - then the entry never changes profit twice. Loss / Damage should be an expense and Excess / Gain an income ledger.
                                Amount = qty x the line's cost rate.
                            </p>
                        </div>

                        <div className="pt-3 border-t">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Branch / Warehouse stock accounts <span className="normal-case font-normal text-gray-400">(optional - e.g. "Stock - Pokhara Branch")</span></p>
                            {!stockMap && <p className="text-sm text-gray-400">Loading...</p>}
                            {stockMap && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <p className="text-xs font-semibold text-gray-600 mb-1">Branches</p>
                                        {stockMap.branches.map(b => (
                                            <div key={b.id} className="mb-2">
                                                <LedgerField label={`${b.branch_name}${b.branch_code ? ` (${b.branch_code})` : ''}`} value={b.stock_ledger_id} onChange={v => setStockLedger('branches', b.id, v)} ledgers={ledgers} />
                                                <p className="text-[11px] text-gray-400">Warehouses: {stockMap.branch_warehouses.filter(m => m.branch_id === b.id).map(m => stockMap.warehouses.find(w => w.id === m.warehouse_id)?.warehouse_name).filter(Boolean).join(', ') || 'none mapped'}</p>
                                            </div>
                                        ))}
                                        {stockMap.branches.length === 0 && <p className="text-sm text-gray-400">No branches.</p>}
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-gray-600 mb-1">Warehouses <span className="font-normal text-gray-400">(overrides the branch)</span></p>
                                        {stockMap.warehouses.map(w => (
                                            <div key={w.id} className="mb-2"><LedgerField label={w.warehouse_name} value={w.stock_ledger_id} onChange={v => setStockLedger('warehouses', w.id, v)} ledgers={ledgers} /></div>
                                        ))}
                                        {stockMap.warehouses.length === 0 && <p className="text-sm text-gray-400">No warehouses.</p>}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="pt-3 border-t">
                            <div className="flex justify-between items-center mb-2">
                                <p className="text-xs font-semibold text-gray-500 uppercase">Ledger check <span className="normal-case font-normal text-gray-400">(saved values)</span></p>
                                <button type="button" onClick={loadStockPosting} className="text-xs text-blue-600">↻ Re-check</button>
                            </div>
                            <table className="w-full text-sm border">
                                <thead className="bg-gray-50"><tr><th className="text-left p-2">Used as</th><th className="text-left p-2">Ledger</th><th className="text-left p-2">Group</th><th className="text-left p-2">Result</th></tr></thead>
                                <tbody>
                                    {stockCheck.map(r => (
                                        <tr key={r.key} className="border-t">
                                            <td className="p-2">{r.label}</td>
                                            <td className="p-2">{r.ledger_name || <span className="text-gray-400">—</span>}</td>
                                            <td className="p-2 text-xs text-gray-500">{r.group}{r.kind ? ` · ${r.kind}` : ''}</td>
                                            <td className={`p-2 text-xs ${r.ok === false ? 'text-red-600 font-semibold' : r.ok ? 'text-green-700' : 'text-gray-400'}`}>{r.ok === false ? '✗ ' : r.ok ? '✓ ' : ''}{r.message}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ==================== 4. BILLING BEHAVIOR ==================== */}
                {tab === 'termMapping' && (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-500">Choose which billing term is VAT, Excise Duty, Product Discount 1-5 and Bill Discount. Entry screens show these as line columns (inline) or in the terms popup,
                            and VAT / Excise post to the ledgers of these terms. A term can do only one job on each side.</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border">
                                <thead><tr className="bg-slate-50 text-xs text-gray-600"><th className="text-left px-3 py-1.5">Job</th><th className="text-left px-3 py-1.5">Sales Term</th><th className="text-left px-3 py-1.5">Purchase Term</th></tr></thead>
                                <tbody>
                                    {TERM_JOBS.map(([job, label]) => (
                                        <tr key={job} className="border-t">
                                            <td className="px-3 py-1.5 font-medium">{label}</td>
                                            {['sales', 'purchase'].map(side => {
                                                const map = (settings.term_mapping || {})[side] || {};
                                                const takenElsewhere = new Set(Object.entries(map).filter(([k, v]) => k !== job && v).map(([, v]) => v));
                                                const options = billingTerms.filter(t => t.is_active !== false && (side === 'sales' ? t.applicable_sales_entry !== false : t.applicable_purchase_entry !== false) && !takenElsewhere.has(t.id));
                                                return (
                                                    <td key={side} className="px-3 py-1.5">
                                                        <select className="erp-input w-full" value={map[job] || ''} onChange={e => setTerm(side, job, e.target.value)}>
                                                            <option value="">- none -</option>
                                                            {options.map(t => <option key={t.id} value={t.id}>{t.term_name}{t.rate_percentage ? ` (${Number(t.rate_percentage)}%)` : ''}</option>)}
                                                        </select>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                {tab === 'billing' && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <SelectField label="Sales Bill Type" hint="same on return & brk ret" value={settings.sales_bill_type} onChange={v => set('sales_bill_type', v)}
                                options={[{ value: 'cash', label: 'Cash' }, { value: 'credit', label: 'Credit' }]} />
                            <SelectField label="Purchase Bill Type" hint="same on return" value={settings.purchase_bill_type} onChange={v => set('purchase_bill_type', v)}
                                options={[{ value: 'cash', label: 'Cash' }, { value: 'credit', label: 'Credit' }]} />
                            <SelectField label="Auto Billing Rate Type" value={settings.auto_billing_rate_type} onChange={v => set('auto_billing_rate_type', v)}
                                options={[...(settings.rate_types || [1, 2, 3, 4, 5].map(sr => ({ sr, caption: `Sr${sr}`, enabled: sr <= 2 }))).filter(r => r.enabled).map(r => ({ value: `sr${r.sr}`, label: r.caption })), { value: 'mrp', label: 'MRP' }]} />
                            <SelectField label="IRD Billing" hint="Yes: posted Sales Bill / Return can only be cancelled" value={String(!!settings.ird_billing)} onChange={v => set('ird_billing', v === 'true')} options={YES_NO} />
                            <SelectField label="Sub-Ledger Popup" value={settings.sub_ledger_popup_mode} onChange={v => set('sub_ledger_popup_mode', v)}
                                options={[{ value: 'single', label: 'Single' }, { value: 'multiple', label: 'Multiple' }]} />
                            <SelectField label="Amount Wise Qty Change" value={settings.amount_wise_qty_change} onChange={v => set('amount_wise_qty_change', v)}
                                options={[{ value: 'sales_only', label: 'Only Sales' }, { value: 'purchase_only', label: 'Only Purchase' }, { value: 'both', label: 'Both' }]} />
                        </div>

                        <div>
                            <label className="erp-label">Popup Product Wise Term - Applicable To <span className="text-xs text-gray-400">(multiple selection)</span></label>
                            <div className="flex flex-wrap gap-4 border rounded-lg px-3 py-2">
                                {['sales', 'purchase', 'sales_return', 'purchase_return'].map(t => (
                                    <label key={t} className="flex items-center gap-1.5 text-sm">
                                        <input type="checkbox" data-enter-skip="true" checked={(settings.popup_product_wise_term_applicability || []).includes(t)} onChange={() => toggleTermApplicability(t)} />
                                        {t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t">
                            <CheckField label="Goods Delivery Note Required" checked={settings.goods_delivery_note_required} onChange={v => set('goods_delivery_note_required', v)} />
                            <CheckField label="Cash Down On Credit Bill" checked={settings.cash_down_on_credit_bill} onChange={v => set('cash_down_on_credit_bill', v)} />
                            <CheckField label="Multiple Payment Method While Billing" checked={settings.multiple_payment_method_billing} onChange={v => set('multiple_payment_method_billing', v)} />
                            <CheckField label="Popup Listing" checked={settings.popup_listing_enabled} onChange={v => set('popup_listing_enabled', v)} />
                            <CheckField label="Show Cash Transactions In Customer/Vendor Ledger" checked={settings.show_cash_transactions_in_party_ledger} onChange={v => set('show_cash_transactions_in_party_ledger', v)} />
                            <CheckField label="Bill-wise Tracking" checked={settings.bill_wise_tracking} onChange={v => set('bill_wise_tracking', v)} />
                        </div>
                    </div>
                )}

                {/* ==================== 5. WARNINGS & CONFIRMATIONS ==================== */}
                {tab === 'warnings' && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <CheckField label="Msg For New Data Entry" checked={settings.msg_confirm_new_entry} onChange={v => set('msg_confirm_new_entry', v)} />
                            <CheckField label="Msg For Data Modify" checked={settings.msg_confirm_modify} onChange={v => set('msg_confirm_modify', v)} />
                            <CheckField label="Msg For Data Remove" checked={settings.msg_confirm_remove} onChange={v => set('msg_confirm_remove', v)} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
                            <SelectField label="Cash Negative Balance" value={settings.cash_negative_balance} onChange={v => set('cash_negative_balance', v)}
                                options={[{ value: 'warn', label: 'Warn' }, { value: 'none', label: 'None' }, { value: 'block', label: 'Block' }]} />
                            <SelectField label="Bank Negative Balance" value={settings.bank_negative_balance} onChange={v => set('bank_negative_balance', v)}
                                options={[{ value: 'warn', label: 'Warn' }, { value: 'none', label: 'None' }, { value: 'block', label: 'Block' }]} />
                            <SelectField label="Update Rate From Purchase" value={settings.update_rate_from_purchase} onChange={v => set('update_rate_from_purchase', v)}
                                options={[{ value: 'buy_only', label: 'Buy Only' }, { value: 'popup', label: 'Popup' }]} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
                            <SelectField label="Rate Fluctuation Warning" value={settings.rate_fluctuation_warning} onChange={v => set('rate_fluctuation_warning', v)}
                                options={[{ value: 'none', label: 'None' }, { value: 'sales', label: 'In Sales' }, { value: 'purchase', label: 'In Purchase' }, { value: 'both', label: 'Both' }]} />
                            {settings.rate_fluctuation_warning !== 'none' && (
                                <Field label="Warning at % Change" type="number" value={settings.rate_fluctuation_warning_percentage} onChange={v => set('rate_fluctuation_warning_percentage', v)} />
                            )}
                        </div>
                        <div className="flex flex-wrap gap-4 pt-2 border-t">
                            <CheckField label="LC/BG Amount Warning - Sales" checked={settings.lc_bg_amount_warning_sales} onChange={v => set('lc_bg_amount_warning_sales', v)} />
                            <CheckField label="LC/BG Amount Warning - Purchase" checked={settings.lc_bg_amount_warning_purchase} onChange={v => set('lc_bg_amount_warning_purchase', v)} />
                        </div>

                        {/* FEATURE: Customer and Vendor get genuinely different default
                            Credit Days/Limit policies - a ledger set to "Default (As Per
                            System Control)" looks up whichever one of these four applies
                            to it, rather than one shared setting for both sides. */}
                        <div className="pt-2 border-t">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Credit Control Defaults (used by ledgers set to "System Default")</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-gray-50 rounded-lg p-3">
                                    <p className="text-xs font-semibold text-gray-600 mb-2">Customer</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <SelectField label="Credit Days Control" value={settings.customer_credit_days_control} onChange={v => set('customer_credit_days_control', v)}
                                            options={[{ value: 'warn', label: 'Warn' }, { value: 'block', label: 'Block' }, { value: 'no_action', label: 'No Action' }]} />
                                        <SelectField label="Credit Limit Control" value={settings.customer_credit_limit_control} onChange={v => set('customer_credit_limit_control', v)}
                                            options={[{ value: 'warn', label: 'Warn' }, { value: 'block', label: 'Block' }, { value: 'no_action', label: 'No Action' }]} />
                                    </div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-3">
                                    <p className="text-xs font-semibold text-gray-600 mb-2">Vendor</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <SelectField label="Credit Days Control" value={settings.vendor_credit_days_control} onChange={v => set('vendor_credit_days_control', v)}
                                            options={[{ value: 'warn', label: 'Warn' }, { value: 'block', label: 'Block' }, { value: 'no_action', label: 'No Action' }]} />
                                        <SelectField label="Credit Limit Control" value={settings.vendor_credit_limit_control} onChange={v => set('vendor_credit_limit_control', v)}
                                            options={[{ value: 'warn', label: 'Warn' }, { value: 'block', label: 'Block' }, { value: 'no_action', label: 'No Action' }]} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ==================== 6. MULTI-CURRENCY & MISC ==================== */}
                {tab === 'misc' && (
                    <div className="space-y-4">
                        <CheckField label="Multi Currency System" checked={settings.multi_currency_system} onChange={v => set('multi_currency_system', v)} />
                        {settings.multi_currency_system && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <Field label="Default Currency Symbol" value={settings.default_currency_symbol} onChange={v => set('default_currency_symbol', v)} />
                                <Field label="Code" value={settings.default_currency_code} onChange={v => set('default_currency_code', v)} />
                                <Field label="Description" value={settings.default_currency_desc} onChange={v => set('default_currency_desc', v)} />
                                <Field label="Low Unit" value={settings.default_currency_low_unit} onChange={v => set('default_currency_low_unit', v)} />
                            </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
                            <SelectField label="Company Wise Entry (Purchase Module)" value={settings.company_wise_entry_purchase} onChange={v => set('company_wise_entry_purchase', v)}
                                options={[{ value: 'compulsory', label: 'Compulsory' }, { value: 'enable_only', label: 'Enable Only' }]} />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t">
                            <CheckField label="Allow Duplicate Master Name" checked={settings.allow_duplicate_master_name} onChange={v => set('allow_duplicate_master_name', v)} />
                            <CheckField label="User Defined Field" checked={settings.user_defined_field_enabled} onChange={v => set('user_defined_field_enabled', v)} />
                            <CheckField label="Nepal VAT Annexure-10" checked={settings.nepal_vat_annexure10_enabled} onChange={v => set('nepal_vat_annexure10_enabled', v)} />
                            <CheckField label="Enable Branch Wise Master" checked={settings.enable_branch_wise_master} onChange={v => set('enable_branch_wise_master', v)} />
                            <CheckField label="Enable Business Unit Hierarchy (multi-level)" checked={settings.enable_business_unit_hierarchy} onChange={v => set('enable_business_unit_hierarchy', v)} />
                        </div>
                        {settings.enable_business_unit_hierarchy && (
                            <div className="max-w-xs pt-2">
                                <Field label="Business Unit Max Levels" type="number" hint="e.g. 3 allows Unit → Sub-Unit → Sub-Sub-Unit" value={settings.business_unit_max_levels} onChange={v => set('business_unit_max_levels', v)} />
                            </div>
                        )}
                    </div>
                )}

                {/* ==================== 7. CAPTIONS ==================== */}
                {tab === 'captions' && (
                    <div className="space-y-4">
                        <p className="text-xs text-gray-400">
                            Rename these labels across the app - the same way the Ledger Category
                            feature's own label can be renamed.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label="Caption For Agent" value={settings.caption_agent} onChange={v => set('caption_agent', v)} />
                            <Field label="Caption For Sub Ledger" value={settings.caption_sub_ledger} onChange={v => set('caption_sub_ledger', v)} />
                            <Field label="Caption For Area" value={settings.caption_area} onChange={v => set('caption_area', v)} />
                            <Field label="Caption For Batch/Lot" value={settings.caption_batch_lot} onChange={v => set('caption_batch_lot', v)} />
                        </div>
                    </div>
                )}

            </div>
          </div>
        </div>
        </Layout>
    );
}
