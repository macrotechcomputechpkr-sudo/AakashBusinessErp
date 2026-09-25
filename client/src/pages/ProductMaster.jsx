// =============================================
// ProductMaster.jsx
// The item catalog. Multi-unit rates (Odoo Packaging pattern - each
// unit its own rate+barcode) and BOM lines are simple inline repeating
// sub-tables (not full masters), same design tier as the Billing Term
// preview or a line-item grid - unlike Ledger Accounts/Users/Product
// Groups, these rows have no FK-heavy complexity that would need a
// proper form of their own.
// =============================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';

const emptyUnitRow = () => ({
    unit_id: '', is_base_unit: false, conversion_factor: 1,
    purchase_rate: 0, mrp: 0, sales_rate_sr1: 0, sales_rate_sr2: 0, sales_rate_sr3: 0, sales_rate_sr4: 0, sales_rate_sr5: 0,
    rate_inclusive_of_tax: false, barcode: '', purchase_eligible: true, sales_eligible: true
});
const emptyBomRow = () => ({ component_product_id: '', quantity_required: '', unit_id: '', auto_recalculate_on_component_rate_change: false });

const emptyForm = {
    product_name: '', short_name: '', item_type: 'trading_item', product_group_id: '', product_company_id: '',
    hs_code: '', is_blocked: false, product_category_ids: [], tags: [],
    base_unit_id: '', unit_rates: [], uom_mode: 'single', dual_uom_primary_unit_id: '',
    sales_account_ledger_id: '', purchase_account_ledger_id: '', sales_sub_ledger_id: '', purchase_sub_ledger_id: '', inventory_account_ledger_id: '', cogs_account_ledger_id: '', discount_account_ledger_id: '',
    default_vendor_id: '', vendor_item_code: '', lead_time_days: 0, default_discount_percent: 0,
    opening_qty: 0, opening_rate: 0, minimum_stock: 0, maximum_stock: 0, reorder_qty: 0, allow_negative_stock: null,
    costing_method: 'average',
    maintain_batch: false, track_expiry: false, track_mfg_date: false, track_serial_number: false, is_vehicle_linked: false, free_qty_eligible: false,
    replenishment_method: 'purchase', routing_reference: '', scrap_percent: 0, bom_lines: [], rack_locations: [], term_mappings: [],
    costing_approach: 'standard', overhead_absorption_basis: '', overhead_absorption_rate: 0, standard_labour_rate: 0,
    weight: '', weight_unit: '', dimensions: '', vat_applicable: true, excise_applicable: false
};

const TABS = [
    { key: 'basic', label: '🧾 Basic Info' },
    { key: 'units', label: '📏 Units & Rates' },
    { key: 'mapping', label: '📒 Account Mapping' },
    { key: 'term_mapping', label: '🧮 Term Mapping' },
    { key: 'vendor', label: '🏭 Vendor & Discount' },
    { key: 'stock', label: '📦 Stock & Costing' },
    { key: 'tracking', label: '🔖 Tracking' },
    { key: 'rack', label: '📍 Rack Location' },
    { key: 'production', label: '⚙️ Production & BOM' },
    { key: 'physical', label: '📐 Physical & Statutory' }
];

// Account field -> its sub-ledger field (product-level posting, see utils/accountResolver).
const ACCOUNT_SUB = { sales_account_ledger_id: 'sales_sub_ledger_id', purchase_account_ledger_id: 'purchase_sub_ledger_id' };

export default function ProductMaster() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [units, setUnits] = useState([]);
    const [productGroups, setProductGroups] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [subLedgers, setSubLedgers] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [products, setProducts] = useState([]); // for BOM component picker
    const [categories, setCategories] = useState([]);
    const [categoryEnabled, setCategoryEnabled] = useState(false);
    const [categoryLabel, setCategoryLabel] = useState('Product Category');
    const [sysControl, setSysControl] = useState(null);
    const [branches, setBranches] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [billingTerms, setBillingTerms] = useState([]);

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [tab, setTab] = useState('basic');
    const [alert, setAlert] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const load = useCallback(async () => {
        try {
            const [p, u, pg, pc, l, v, cat, catSetting, sc, br, wh, bt, subl] = await Promise.all([
                authFetch('/api/products'),
                authFetch('/api/product-units'),
                authFetch('/api/product-groups'),
                authFetch('/api/product-companies'),
                authFetch('/api/ledger-accounts?pageSize=1000&sortBy=account_name&sortDir=asc'),
                authFetch('/api/ledger-accounts?pageSize=200&category_type=purchase'),
                authFetch('/api/product-categories'),
                authFetch('/api/company/product-category-setting'),
                authFetch('/api/system-control'),
                authFetch('/api/branches'),
                authFetch('/api/warehouses'),
                authFetch('/api/billing-terms')
            ,
                authFetch('/api/sub-ledgers')
            ]);
            setSubLedgers(subl.data || []);
            setRows(p.data || []);
            setProducts(p.data || []);
            setUnits(u.data || []);
            setProductGroups(pg.data || []);
            setCompanies(pc.data || []);
            setLedgers(l.data || []);
            setVendors(v.data || []);
            setCategories(cat.data || []);
            setBranches(br.data || []);
            setWarehouses(wh.data || []);
            setBillingTerms(bt.data || []);
            setCategoryEnabled(!!catSetting.data?.enabled);
            setCategoryLabel(catSetting.data?.label || 'Product Category');
            setSysControl(sc.data);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); setTab('basic'); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.product_name.trim()) return showAlert('Product Name is required', 'danger');
        if (!form.base_unit_id) return showAlert('Base Unit is required', 'danger');
        if (form.unit_rates.length === 0) return showAlert('Add at least the Base Unit row in Units & Rates', 'danger');
        try {
            if (editingId) {
                await authFetch(`/api/products/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
                showAlert('Product updated', 'success');
            } else {
                await authFetch('/api/products', { method: 'POST', body: JSON.stringify(form) });
                showAlert('Product created', 'success');
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
        setForm({
            ...emptyForm, ...row,
            unit_rates: row.product_unit_rates || [],
            product_category_ids: row.product_category_ids || [],
            bom_lines: row.bom_lines || [],
            rack_locations: (row.product_rack_locations || []).map(r => ({ branch_id: r.branch_id, warehouse_id: r.warehouse_id, rack_location: r.rack_location })),
            term_mappings: (row.product_term_mappings || []).map(m => ({ category_type: m.category_type, billing_term_id: m.billing_term_id, is_enabled_by_default: m.is_enabled_by_default, override_percentage: m.override_percentage ?? '' }))
        });
        setShowForm(true);
        setTab('basic');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Deactivate "${row.product_name}"?`)) return;
        try {
            await authFetch(`/api/products/${row.id}`, { method: 'DELETE' });
            showAlert('Product deactivated', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: "Remove" - genuinely permanent, blocked with a clear
    // message if any document already uses this product.
    const handleRemove = async (row) => {
        if (!window.confirm(`Permanently delete "${row.product_name}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/products/${row.id}/permanent`, { method: 'DELETE' });
            showAlert('Product permanently deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // ---------- Multi-unit rows ----------
    const addUnitRow = () => setForm(f => ({ ...f, unit_rates: [...f.unit_rates, emptyUnitRow()] }));
    const removeUnitRow = (idx) => setForm(f => ({ ...f, unit_rates: f.unit_rates.filter((_, i) => i !== idx) }));
    const updateUnitRow = (idx, patch) => setForm(f => ({ ...f, unit_rates: f.unit_rates.map((u, i) => i === idx ? { ...u, ...patch } : u) }));
    const markAsBase = (idx) => setForm(f => ({
        ...f,
        base_unit_id: f.unit_rates[idx].unit_id,
        unit_rates: f.unit_rates.map((u, i) => ({ ...u, is_base_unit: i === idx }))
    }));

    // ---------- BOM rows ----------
    const addBomRow = () => setForm(f => ({ ...f, bom_lines: [...f.bom_lines, emptyBomRow()] }));
    const removeBomRow = (idx) => setForm(f => ({ ...f, bom_lines: f.bom_lines.filter((_, i) => i !== idx) }));
    const updateBomRow = (idx, patch) => setForm(f => ({ ...f, bom_lines: f.bom_lines.map((b, i) => i === idx ? { ...b, ...patch } : b) }));

    const addRackRow = () => setForm(f => ({ ...f, rack_locations: [...f.rack_locations, { branch_id: '', warehouse_id: '', rack_location: '' }] }));
    const removeRackRow = (idx) => setForm(f => ({ ...f, rack_locations: f.rack_locations.filter((_, i) => i !== idx) }));
    const updateRackRow = (idx, patch) => setForm(f => ({ ...f, rack_locations: f.rack_locations.map((r, i) => i === idx ? { ...r, ...patch } : r) }));

    // FEATURE: Term Mapping - toggle a Billing Term on/off for this
    // product's Sales or Purchase side, with an optional per-product
    // rate override.
    const toggleTermMapping = (categoryType, billingTermId) => {
        setForm(f => {
            const exists = f.term_mappings.find(m => m.category_type === categoryType && m.billing_term_id === billingTermId);
            if (exists) return { ...f, term_mappings: f.term_mappings.filter(m => !(m.category_type === categoryType && m.billing_term_id === billingTermId)) };
            return { ...f, term_mappings: [...f.term_mappings, { category_type: categoryType, billing_term_id: billingTermId, is_enabled_by_default: true, override_percentage: '' }] };
        });
    };
    const updateTermMappingOverride = (categoryType, billingTermId, value) => {
        setForm(f => ({
            ...f,
            term_mappings: f.term_mappings.map(m => (m.category_type === categoryType && m.billing_term_id === billingTermId) ? { ...m, override_percentage: value } : m)
        }));
    };

    const isProduced = ['semi_finished', 'finished_good'].includes(form.item_type);

    const columns = [
        { key: 'product_code', label: 'Code', type: 'text' },
        { key: 'product_name', label: 'Name', type: 'text' },
        { key: 'item_type', label: 'Type', type: 'text' },
        { key: 'product_groups', label: 'Stock Group', type: 'text', render: r => r.product_groups?.group_name || '—' },
        { key: 'base_unit', label: 'Base Unit', type: 'text', render: r => r.base_unit?.unit_symbol || r.base_unit?.unit_name || '—' }
    ];

    return (
        <Layout>
        <div className="max-w-5xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Products</h1>
                <button onClick={() => { resetForm(); setShowForm(s => !s); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">
                    {showForm ? 'Close' : '➕ New Product'}
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
                    <h2 className="font-semibold text-lg">{editingId ? 'Edit Product' : 'Create New Product'}</h2>

                    <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1">
                        {TABS.map(t => (
                            <button key={t.key} type="button" onClick={() => setTab(t.key)}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* ==================== BASIC INFO ==================== */}
                    <div className={tab === 'basic' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
                        <div>
                            <label className="erp-label">Product Name *</label>
                            <input className="erp-input" value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} required />
                        </div>
                        <div>
                            <label className="erp-label">Short Name</label>
                            <input className="erp-input" value={form.short_name} onChange={e => setForm({ ...form, short_name: e.target.value })} />
                        </div>
                        <div>
                            <label className="erp-label">Code <span className="text-xs text-gray-400">(preview only)</span></label>
                            <input className="erp-input" disabled value={editingId ? (form.product_code || '') : 'Auto-generated on save'} />
                        </div>
                        <div>
                            <label className="erp-label">Item Type *</label>
                            <select className="erp-input" value={form.item_type} onChange={e => setForm({ ...form, item_type: e.target.value })}>
                                <option value="raw_material">Raw Material</option>
                                <option value="semi_finished">Semi-Finished</option>
                                <option value="finished_good">Finished Good</option>
                                <option value="trading_item">Trading Item</option>
                                <option value="fixed_asset">Fixed Asset</option>
                                <option value="service">Service</option>
                                <option value="non_inventory">Non-Inventory</option>
                            </select>
                        </div>
                        <div>
                            <label className="erp-label">Stock Group</label>
                            <SearchablePopupSelect
                                listKey="product_group_picker"
                                columns={[{ key: 'group_code', label: 'Code' }, { key: 'group_name', label: 'Name' }]}
                                defaultVisibleKeys={['group_name']}
                                items={productGroups} getId={g => g.id} getLabel={g => g.group_name}
                                searchKeys={['group_name', 'group_code']}
                                value={form.product_group_id} onChange={id => setForm({ ...form, product_group_id: id })}
                                placeholder="Select Stock Group"
                            />
                        </div>
                        <div>
                            <label className="erp-label">Company / Brand</label>
                            <SearchablePopupSelect
                                listKey="product_company_picker"
                                columns={[{ key: 'company_name', label: 'Name' }]}
                                defaultVisibleKeys={['company_name']}
                                items={companies} getId={c => c.id} getLabel={c => c.company_name}
                                searchKeys={['company_name']}
                                value={form.product_company_id} onChange={id => setForm({ ...form, product_company_id: id })}
                                placeholder="Select Company"
                            />
                        </div>
                        <div>
                            <label className="erp-label">HS Code</label>
                            <input className="erp-input" value={form.hs_code} onChange={e => setForm({ ...form, hs_code: e.target.value })} />
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={form.is_blocked} onChange={e => setForm({ ...form, is_blocked: e.target.checked })} /> Blocked (prevents new transactions, keeps history)</label>
                        </div>

                        {categoryEnabled && (
                            <div className="md:col-span-2">
                                <label className="erp-label">{categoryLabel} <span className="text-xs text-gray-400">(optional, multi-select)</span></label>
                                {categories.length === 0 ? (
                                    <p className="text-xs text-gray-400 border rounded-lg px-3 py-2">No categories defined yet.</p>
                                ) : (
                                    <div className="flex flex-wrap gap-3 border rounded-lg px-3 py-2">
                                        {categories.map(c => (
                                            <label key={c.id} className="flex items-center gap-1.5 text-sm">
                                                <input type="checkbox" data-enter-skip="true" checked={form.product_category_ids.includes(c.id)}
                                                    onChange={e => setForm(f => ({
                                                        ...f,
                                                        product_category_ids: e.target.checked ? [...f.product_category_ids, c.id] : f.product_category_ids.filter(id => id !== c.id)
                                                    }))} />
                                                {c.category_name}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* FEATURE: Tags kept last in this Master Entry form, per
                            request - matches the same "Tags last" placement on the
                            Ledger Account form for consistency. */}
                        <div className="md:col-span-2">
                            <label className="erp-label">Tags <span className="text-xs text-gray-400">(free-form labels, type and press Enter)</span></label>
                            <div className="flex flex-wrap gap-1.5 border rounded-lg px-2 py-1.5">
                                {form.tags.map((t, i) => (
                                    <span key={i} className="flex items-center gap-1 bg-gray-800 text-white text-xs px-2 py-1 rounded-full">
                                        {t}
                                        <span onClick={() => setForm({ ...form, tags: form.tags.filter((_, idx) => idx !== i) })} className="cursor-pointer text-red-300 hover:text-red-100 font-bold">✕</span>
                                    </span>
                                ))}
                                <input
                                    className="flex-1 min-w-[100px] border-none outline-none text-sm px-1 py-1"
                                    placeholder={form.tags.length === 0 ? 'e.g. bestseller, seasonal' : ''}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && e.target.value.trim()) {
                                            e.preventDefault();
                                            if (!form.tags.includes(e.target.value.trim())) {
                                                setForm({ ...form, tags: [...form.tags, e.target.value.trim()] });
                                            }
                                            e.target.value = '';
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* ==================== UNITS & RATES ==================== */}
                    <div className={tab === 'units' ? '' : 'hidden'}>
                        <p className="text-xs text-gray-400 mb-3">
                            Each unit gets its own rates and its own barcode (e.g. a "Case of 24" priced and
                            scanned independently from a single "Piece") - not derived from the base unit.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 p-3 bg-slate-50 rounded-lg border">
                            <div>
                                <label className="erp-label">Unit Mode</label>
                                <select className="erp-select" value={form.uom_mode} onChange={e => setForm({ ...form, uom_mode: e.target.value })}>
                                    <option value="single">Single Unit</option>
                                    <option value="flexible">Flexible (pick any configured unit per line)</option>
                                    <option value="fixed_dual">Fixed Dual (e.g. Carton + PCS, mixed-radix entry)</option>
                                </select>
                            </div>
                            {form.uom_mode === 'fixed_dual' && (
                                <div>
                                    <label className="erp-label">Primary Unit <span className="hint">(the Base Unit itself is the Secondary)</span></label>
                                    <select className="erp-select" value={form.dual_uom_primary_unit_id} onChange={e => setForm({ ...form, dual_uom_primary_unit_id: e.target.value })}>
                                        <option value="">Select</option>
                                        {form.unit_rates.filter(u => !u.is_base_unit && u.unit_id).map(u => {
                                            const unit = units.find(x => x.id === u.unit_id);
                                            return <option key={u.unit_id} value={u.unit_id}>{unit?.unit_name || u.unit_id}</option>;
                                        })}
                                    </select>
                                    {form.unit_rates.filter(u => !u.is_base_unit && u.unit_id).length === 0 && (
                                        <p className="text-xs text-amber-600 mt-1">Add a non-base unit row below first (e.g. Carton), with its Conv. Factor to the Base Unit (e.g. Pieces).</p>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="overflow-x-auto border rounded-lg">
                            <table className="min-w-[900px] w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-2 py-2 text-left">Base?</th>
                                        <th className="px-2 py-2 text-left">Unit</th>
                                        <th className="px-2 py-2 text-left">Conv. Factor</th>
                                        <th className="px-2 py-2 text-left">Purchase Rate</th>
                                        <th className="px-2 py-2 text-left">MRP</th>
                                        <th className="px-2 py-2 text-left">Sr1</th>
                                        <th className="px-2 py-2 text-left">Sr2</th>
                                        <th className="px-2 py-2 text-left">Sr3</th>
                                        <th className="px-2 py-2 text-left">Sr4</th>
                                        <th className="px-2 py-2 text-left">Sr5</th>
                                        <th className="px-2 py-2 text-left">Barcode</th>
                                        <th className="px-2 py-2 text-left">Purch.</th>
                                        <th className="px-2 py-2 text-left">Sale</th>
                                        <th className="px-2 py-2"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.unit_rates.map((u, idx) => (
                                        <tr key={idx} className="border-t">
                                            <td className="px-2 py-1"><input type="radio" checked={u.is_base_unit} onChange={() => markAsBase(idx)} /></td>
                                            <td className="px-2 py-1 min-w-[130px]">
                                                <select className="border rounded px-2 py-1 w-full" value={u.unit_id} onChange={e => updateUnitRow(idx, { unit_id: e.target.value })}>
                                                    <option value="">Select</option>
                                                    {units.map(un => <option key={un.id} value={un.id}>{un.unit_name}</option>)}
                                                </select>
                                            </td>
                                            <td className="px-2 py-1"><input type="number" step="0.0001" className="w-20 border rounded px-1 py-1" value={u.conversion_factor} onChange={e => updateUnitRow(idx, { conversion_factor: e.target.value })} disabled={u.is_base_unit} /></td>
                                            <td className="px-2 py-1"><input type="number" step="0.01" className="w-20 border rounded px-1 py-1" value={u.purchase_rate} onChange={e => updateUnitRow(idx, { purchase_rate: e.target.value })} /></td>
                                            <td className="px-2 py-1"><input type="number" step="0.01" className="w-20 border rounded px-1 py-1" value={u.mrp} onChange={e => updateUnitRow(idx, { mrp: e.target.value })} /></td>
                                            <td className="px-2 py-1"><input type="number" step="0.01" className="w-16 border rounded px-1 py-1" value={u.sales_rate_sr1} onChange={e => updateUnitRow(idx, { sales_rate_sr1: e.target.value })} /></td>
                                            <td className="px-2 py-1"><input type="number" step="0.01" className="w-16 border rounded px-1 py-1" value={u.sales_rate_sr2} onChange={e => updateUnitRow(idx, { sales_rate_sr2: e.target.value })} /></td>
                                            <td className="px-2 py-1"><input type="number" step="0.01" className="w-16 border rounded px-1 py-1" value={u.sales_rate_sr3} onChange={e => updateUnitRow(idx, { sales_rate_sr3: e.target.value })} /></td>
                                            <td className="px-2 py-1"><input type="number" step="0.01" className="w-16 border rounded px-1 py-1" value={u.sales_rate_sr4} onChange={e => updateUnitRow(idx, { sales_rate_sr4: e.target.value })} /></td>
                                            <td className="px-2 py-1"><input type="number" step="0.01" className="w-16 border rounded px-1 py-1" value={u.sales_rate_sr5} onChange={e => updateUnitRow(idx, { sales_rate_sr5: e.target.value })} /></td>
                                            <td className="px-2 py-1"><input className="w-24 border rounded px-1 py-1" value={u.barcode} onChange={e => updateUnitRow(idx, { barcode: e.target.value })} /></td>
                                            <td className="px-2 py-1 text-center"><input type="checkbox" checked={u.purchase_eligible} onChange={e => updateUnitRow(idx, { purchase_eligible: e.target.checked })} /></td>
                                            <td className="px-2 py-1 text-center"><input type="checkbox" checked={u.sales_eligible} onChange={e => updateUnitRow(idx, { sales_eligible: e.target.checked })} /></td>
                                            <td className="px-2 py-1"><button type="button" onClick={() => removeUnitRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <button type="button" onClick={addUnitRow} className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">➕ Add Unit Row</button>
                    </div>

                    {/* ==================== ACCOUNT MAPPING ==================== */}
                    <div className={tab === 'mapping' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
                        <p className="md:col-span-2 text-xs text-gray-400">Leave blank to use the System Control defaults.</p>
                        {[
                            ['sales_account_ledger_id', 'Sales Account'],
                            ['purchase_account_ledger_id', 'Purchase Account'],
                            ['inventory_account_ledger_id', 'Inventory/Stock Account'],
                            ['cogs_account_ledger_id', 'Cost of Goods Sold Account'],
                            ['discount_account_ledger_id', 'Discount Account']
                        ].map(([key, label]) => (
                            <div key={key}>
                                <label className="erp-label">{label}</label>
                                <SearchablePopupSelect
                                    listKey={`product_ledger_${key}`}
                                    columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                    defaultVisibleKeys={['account_name']}
                                    items={ledgers} getId={l => l.id} getLabel={l => l.account_name}
                                    searchKeys={['account_name', 'account_code']}
                                    value={form[key]} onChange={id => setForm({ ...form, [key]: id, ...(ACCOUNT_SUB[key] ? { [ACCOUNT_SUB[key]]: '' } : {}) })}
                                    placeholder="System Control default"
                                />
                                {ACCOUNT_SUB[key] && (
                                    <select className="erp-select mt-1" value={form[ACCOUNT_SUB[key]] || ''} disabled={!form[key]}
                                        onChange={e => setForm({ ...form, [ACCOUNT_SUB[key]]: e.target.value })}>
                                        <option value="">{form[key] ? 'Sub-Ledger: none' : 'Sub-Ledger (choose the account first)'}</option>
                                        {subLedgers.filter(sl => sl.main_ledger_id === form[key]).map(sl => <option key={sl.id} value={sl.id}>{sl.sub_ledger_name}</option>)}
                                    </select>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* ==================== TERM MAPPING ==================== */}
                    <div className={tab === 'term_mapping' ? 'space-y-4' : 'hidden'}>
                        <p className="text-xs text-gray-400">Which Billing Terms apply to this product by default, for Sales and for Purchase - pre-selected when this product is added to a transaction line. An override % replaces the term's usual rate just for this product.</p>
                        {['sales', 'purchase'].map(categoryType => (
                            <div key={categoryType}>
                                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{categoryType}</p>
                                <table className="w-full text-sm border rounded-lg overflow-hidden">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="text-left px-3 py-1.5 w-10"></th>
                                            <th className="text-left px-3 py-1.5">Term</th>
                                            <th className="text-left px-3 py-1.5 w-32">Override %</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {billingTerms.filter(t => categoryType === 'sales' ? t.applicable_sales_entry : t.applicable_purchase_entry).map(t => {
                                            const mapping = form.term_mappings.find(m => m.category_type === categoryType && m.billing_term_id === t.id);
                                            return (
                                                <tr key={t.id} className="border-t border-gray-100">
                                                    <td className="px-3 py-1.5"><input type="checkbox" data-enter-skip="true" checked={!!mapping} onChange={() => toggleTermMapping(categoryType, t.id)} /></td>
                                                    <td className="px-3 py-1.5">{t.term_name} <span className="text-xs text-gray-400">({t.term_code})</span></td>
                                                    <td className="px-3 py-1.5">
                                                        {mapping && (
                                                            <input type="number" step="0.0001" className="w-24 border rounded px-2 py-1" placeholder={`Default ${t.rate_percentage ?? 0}`}
                                                                value={mapping.override_percentage} onChange={e => updateTermMappingOverride(categoryType, t.id, e.target.value)} />
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {billingTerms.filter(t => categoryType === 'sales' ? t.applicable_sales_entry : t.applicable_purchase_entry).length === 0 && (
                                            <tr><td colSpan={3} className="text-center py-3 text-gray-400 text-xs">No {categoryType}-applicable Billing Terms set up yet.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                    </div>

                    {/* ==================== VENDOR & DISCOUNT ==================== */}
                    <div className={tab === 'vendor' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'hidden'}>
                        <div>
                            <label className="erp-label">Default Vendor</label>
                            <SearchablePopupSelect
                                listKey="product_vendor_picker"
                                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }]}
                                defaultVisibleKeys={['account_name']}
                                items={vendors} getId={v => v.id} getLabel={v => v.account_name}
                                searchKeys={['account_name', 'account_code']}
                                value={form.default_vendor_id} onChange={id => setForm({ ...form, default_vendor_id: id })}
                                placeholder="Select Vendor"
                            />
                        </div>
                        <Field label="Vendor Item Code" value={form.vendor_item_code} onChange={v => setForm({ ...form, vendor_item_code: v })} />
                        <Field label="Lead Time (days)" type="number" value={form.lead_time_days} onChange={v => setForm({ ...form, lead_time_days: v })} />
                        <Field label="Default Discount %" type="number" value={form.default_discount_percent} onChange={v => setForm({ ...form, default_discount_percent: v })} />
                    </div>

                    {/* ==================== STOCK & COSTING ==================== */}
                    <div className={tab === 'stock' ? 'grid grid-cols-1 md:grid-cols-3 gap-4' : 'hidden'}>
                        <Field label="Opening Qty" type="number" value={form.opening_qty} onChange={v => setForm({ ...form, opening_qty: v })} />
                        <Field label="Opening Rate" type="number" value={form.opening_rate} onChange={v => setForm({ ...form, opening_rate: v })} />
                        <Field label="Opening Value" value={((Number(form.opening_qty) || 0) * (Number(form.opening_rate) || 0)).toFixed(2)} onChange={() => {}} disabled />
                        <Field label="Minimum Stock (Reorder Level)" type="number" value={form.minimum_stock} onChange={v => setForm({ ...form, minimum_stock: v })} />
                        <Field label="Maximum Stock" type="number" value={form.maximum_stock} onChange={v => setForm({ ...form, maximum_stock: v })} />
                        <Field label="Reorder Qty" type="number" value={form.reorder_qty} onChange={v => setForm({ ...form, reorder_qty: v })} />
                        <SelectField label="Allow Negative Stock" value={form.allow_negative_stock === null ? 'inherit' : String(form.allow_negative_stock)}
                            onChange={v => setForm({ ...form, allow_negative_stock: v === 'inherit' ? null : v === 'true' })}
                            options={[{ value: 'inherit', label: 'Use global policy' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
                        <SelectField label="Costing Method" value={form.costing_method} onChange={v => setForm({ ...form, costing_method: v })}
                            options={['fifo', 'lifo', 'average', 'standard', 'specific'].map(v => ({ value: v, label: v.toUpperCase() }))} />
                    </div>

                    {/* ==================== TRACKING (System-Control-conditional) ==================== */}
                    <div className={tab === 'tracking' ? 'space-y-3' : 'hidden'}>
                        {sysControl?.batch_system && sysControl.batch_system !== 'none' && (
                            <CheckField label="Maintain Batch/Lot" checked={form.maintain_batch} onChange={v => setForm({ ...form, maintain_batch: v })} />
                        )}
                        {sysControl?.enable_exp_date && <CheckField label="Track Expiry Date" checked={form.track_expiry} onChange={v => setForm({ ...form, track_expiry: v })} />}
                        {sysControl?.enable_mfg_date && <CheckField label="Track Manufacture Date" checked={form.track_mfg_date} onChange={v => setForm({ ...form, track_mfg_date: v })} />}
                        {sysControl?.enable_serial_number && <CheckField label="Track Serial Number" checked={form.track_serial_number} onChange={v => setForm({ ...form, track_serial_number: v })} />}
                        {sysControl?.enable_vehicle_options && <CheckField label="Vehicle-linked" checked={form.is_vehicle_linked} onChange={v => setForm({ ...form, is_vehicle_linked: v })} />}
                        {sysControl?.free_qty_system && <CheckField label="Free Qty Eligible" checked={form.free_qty_eligible} onChange={v => setForm({ ...form, free_qty_eligible: v })} />}
                        {!sysControl?.enable_barcode_system && <p className="text-xs text-gray-400">Barcode fields (in Units & Rates) only apply once System Control's "Enable Barcode System" is on.</p>}
                        {sysControl && !sysControl.batch_system && sysControl.batch_system === 'none' && !sysControl.enable_exp_date && !sysControl.enable_mfg_date && !sysControl.enable_serial_number && !sysControl.enable_vehicle_options && !sysControl.free_qty_system && (
                            <p className="text-xs text-gray-400">No tracking options are enabled in System Control yet - turn them on there first.</p>
                        )}
                    </div>

                    {/* ==================== RACK LOCATION ==================== */}
                    <div className={tab === 'rack' ? 'space-y-3' : 'hidden'}>
                        <p className="text-xs text-gray-400">
                            Branch-wise AND Warehouse-wise, since one warehouse can serve more
                            than one branch - pick both, then type the rack/bin location.
                        </p>
                        {form.rack_locations.map((r, idx) => (
                            <div key={idx} className="flex flex-wrap items-center gap-2">
                                <div className="flex-1 min-w-[160px]">
                                    <SearchablePopupSelect
                                        listKey="rack_branch_picker"
                                        columns={[{ key: 'branch_code', label: 'Code' }, { key: 'branch_name', label: 'Name' }]}
                                        defaultVisibleKeys={['branch_name']}
                                        items={branches} getId={b => b.id} getLabel={b => b.branch_name}
                                        searchKeys={['branch_name', 'branch_code']}
                                        value={r.branch_id} onChange={id => updateRackRow(idx, { branch_id: id })}
                                        placeholder="Select Branch"
                                    />
                                </div>
                                <div className="flex-1 min-w-[160px]">
                                    <SearchablePopupSelect
                                        listKey="rack_warehouse_picker"
                                        columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                        defaultVisibleKeys={['warehouse_name']}
                                        items={warehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                        searchKeys={['warehouse_name', 'warehouse_code']}
                                        value={r.warehouse_id} onChange={id => updateRackRow(idx, { warehouse_id: id })}
                                        placeholder="Select Warehouse"
                                    />
                                </div>
                                <input placeholder="Rack Location (e.g. A1-R3)" className="flex-1 min-w-[140px] border rounded-lg px-3 py-2" value={r.rack_location} onChange={e => updateRackRow(idx, { rack_location: e.target.value })} />
                                <button type="button" onClick={() => removeRackRow(idx)} className="text-red-500 text-xs">✕ Remove</button>
                            </div>
                        ))}
                        <button type="button" onClick={addRackRow} className="text-xs text-blue-600">➕ Add Rack Location</button>
                    </div>

                    {/* ==================== PRODUCTION & BOM ==================== */}
                    <div className={tab === 'production' ? 'space-y-4' : 'hidden'}>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <SelectField label="Replenishment Method" value={form.replenishment_method} onChange={v => setForm({ ...form, replenishment_method: v })}
                                options={[{ value: 'purchase', label: 'Purchase' }, { value: 'production', label: 'Production' }, { value: 'assembly', label: 'Assembly' }]} />
                            {!isProduced && ['production', 'assembly'].includes(form.replenishment_method) && (
                                <p className="md:col-span-2 text-xs text-red-500 self-center">Item Type must be Semi-Finished or Finished Good for "{form.replenishment_method === 'production' ? 'Production' : 'Assembly'}"</p>
                            )}
                        </div>

                        {isProduced && (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <Field label="Routing / Process Reference" value={form.routing_reference} onChange={v => setForm({ ...form, routing_reference: v })} />
                                    <Field label="Scrap %" type="number" value={form.scrap_percent} onChange={v => setForm({ ...form, scrap_percent: v })} />
                                    <SelectField label="Costing Approach" value={form.costing_approach} onChange={v => setForm({ ...form, costing_approach: v })}
                                        options={[{ value: 'standard', label: 'Standard' }, { value: 'actual', label: 'Actual' }, { value: 'job', label: 'Job' }]} />
                                    <SelectField label="Overhead Absorption Basis" value={form.overhead_absorption_basis} onChange={v => setForm({ ...form, overhead_absorption_basis: v })}
                                        options={[{ value: '', label: 'None' }, { value: 'machine_hour', label: 'Per Machine Hour' }, { value: 'labour_hour', label: 'Per Labour Hour' }, { value: 'per_unit', label: 'Per Unit' }]} />
                                    <Field label="Overhead Absorption Rate" type="number" value={form.overhead_absorption_rate} onChange={v => setForm({ ...form, overhead_absorption_rate: v })} />
                                    <Field label="Standard Labour Rate" type="number" value={form.standard_labour_rate} onChange={v => setForm({ ...form, standard_labour_rate: v })} />
                                </div>

                                <div className="border-t pt-3">
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Bill of Materials</p>
                                    <div className="space-y-2">
                                        {form.bom_lines.map((b, idx) => (
                                            <div key={idx} className="flex flex-wrap items-center gap-2">
                                                <div className="flex-1 min-w-[180px]">
                                                    <SearchablePopupSelect
                                                        listKey="bom_component_picker"
                                                        columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                        defaultVisibleKeys={['product_name']}
                                                        items={products.filter(p => p.id !== editingId)} getId={p => p.id} getLabel={p => p.product_name}
                                                        searchKeys={['product_name', 'product_code']}
                                                        value={b.component_product_id} onChange={id => updateBomRow(idx, { component_product_id: id })}
                                                        placeholder="Select raw material"
                                                    />
                                                </div>
                                                <input type="number" step="0.0001" placeholder="Qty" className="w-24 border rounded px-2 py-1.5" value={b.quantity_required} onChange={e => updateBomRow(idx, { quantity_required: e.target.value })} />
                                                <select className="border rounded px-2 py-1.5" value={b.unit_id} onChange={e => updateBomRow(idx, { unit_id: e.target.value })}>
                                                    <option value="">Unit</option>
                                                    {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                </select>
                                                <label className="flex items-center gap-1 text-xs text-gray-500">
                                                    <input type="checkbox" checked={b.auto_recalculate_on_component_rate_change} onChange={e => updateBomRow(idx, { auto_recalculate_on_component_rate_change: e.target.checked })} />
                                                    Auto rate on change
                                                </label>
                                                <button type="button" onClick={() => removeBomRow(idx)} className="text-red-500 text-xs">✕ Remove</button>
                                            </div>
                                        ))}
                                    </div>
                                    <button type="button" onClick={addBomRow} className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">➕ Add Raw Material</button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* ==================== PHYSICAL & STATUTORY ==================== */}
                    <div className={tab === 'physical' ? 'grid grid-cols-1 md:grid-cols-3 gap-4' : 'hidden'}>
                        <Field label="Weight" type="number" value={form.weight} onChange={v => setForm({ ...form, weight: v })} />
                        <Field label="Weight Unit" value={form.weight_unit} onChange={v => setForm({ ...form, weight_unit: v })} placeholder="e.g. Kg" />
                        <Field label="Dimensions" value={form.dimensions} onChange={v => setForm({ ...form, dimensions: v })} placeholder="L x W x H" />
                        <CheckField label="VAT Applicable" checked={form.vat_applicable} onChange={v => setForm({ ...form, vat_applicable: v })} />
                        <CheckField label="Excise Applicable" checked={form.excise_applicable} onChange={v => setForm({ ...form, excise_applicable: v })} />
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium">{editingId ? 'Update Product' : 'Create Product'}</button>
                    </div>
                </form>
            )}

            <ReportGrid
                columns={columns}
                rows={rows}
                getId={r => r.id}
                storageKey="product_master_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                        <button onClick={() => handleDelete(row)} className="px-2 py-1 bg-yellow-600 text-white rounded text-xs">Deactivate</button>
                        <button onClick={() => handleRemove(row)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                    </div>
                )}
            />
        </div>
        </Layout>
    );
}

function Field({ label, value, onChange, type = 'text', disabled, ...props }) {
    return (
        <div>
            <label className="erp-label">{label}</label>
            <input type={type} className={`w-full border rounded-lg px-3 py-2 ${disabled ? 'bg-gray-100 text-gray-500' : ''}`} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} {...props} />
        </div>
    );
}
function SelectField({ label, value, onChange, options }) {
    return (
        <div>
            <label className="erp-label">{label}</label>
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
