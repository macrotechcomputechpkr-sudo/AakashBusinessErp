// =============================================
// ProductionOrder.jsx
// Converts raw materials into a finished output, optionally with
// by-products - posts to the shared stock ledger only when posted.
// =============================================

import { useEntryFieldControls } from '../hooks/useEntryFieldControls';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import ReportGrid from '../components/ReportGrid';
import Layout from '../components/Layout';
import NumberingCategorySelector from '../components/NumberingCategorySelector';
import { resolveDualUomEntryMode, onPrimaryQtyChange, onSecondaryQtyChange, validateFixedSecondary, dualBaseQty } from '../utils/dualUomEntryMode';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';
import UdfValuesModal from '../components/UdfValuesModal';
import RecordHistory from '../components/RecordHistory';

const emptyRawMaterialRow = () => ({ product_id: '', batch_no: '', warehouse_id: '', qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', rate_basis: 'primary', process_name: '', cost_rate: '', billing_term_ids: [] });
const emptyByproductRow = () => ({ product_id: '', batch_no: '', warehouse_id: '', qty: '', uom_id: '', alt_qty: '', alt_unit_id: '', rate_basis: 'primary', allocation_basis: 'fixed_recovery', recovery_rate: '', relative_value: '' });

const emptyForm = {
    doc_date: new Date().toISOString().slice(0, 10),
    numbering_category_id: '',
    output_product_id: '', output_qty: '', output_uom_id: '', output_alt_qty: '', output_alt_unit_id: '', output_batch_no: '', output_mfg_date: '', output_exp_date: '', output_relative_value: '',
    output_warehouse_id: '', source_warehouse_id: '', bom_template_id: '',
    remarks_text: '', narration: '', cost_center_id: '', business_unit_id: '',
    raw_materials: [emptyRawMaterialRow()],
    byproducts: []
};

// Master fields of this screen covered by Entry Field Control (see useEntryFieldControls).
const EFC_RENDERED_KEYS = ['doc_date', 'narration', 'output_batch_no', 'output_product_id', 'output_qty', 'output_warehouse_id', 'source_warehouse_id'];

export default function ProductionOrder() {
    const { authFetch } = useAuth();
    const efc = useEntryFieldControls('production', EFC_RENDERED_KEYS);
    const [rows, setRows] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [showDraftsOnly, setShowDraftsOnly] = useState(false);
    const [auditModal, setAuditModal] = useState(null);

    const [products, setProducts] = useState([]);
    const [bomTemplates, setBomTemplates] = useState([]);
    // FEATURE: "Production Panu Panu Hunu Paryo Billing Term" -
    // Production Billing Term, applied per raw-material line. NEVER
    // creates a ledger posting - only adjusts costing (feeds
    // totalRmCost -> joint allocation) and is visible on the
    // Production Report.
    const [billingTerms, setBillingTerms] = useState([]);
    const [lineTermPreviews, setLineTermPreviews] = useState({});
    const [productTermModalIndexes, setProductTermModalIndexes] = useState(null);
    const [selectedRmIndexes, setSelectedRmIndexes] = useState([]);
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [warehouses, setWarehouses] = useState([]);
    const [units, setUnits] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [businessUnits, setBusinessUnits] = useState([]);
    const [remarks, setRemarks] = useState([]);
    const [dualUomEntryMode, setDualUomEntryMode] = useState({ mode: 'fixed', reverseEnabled: false });

    const formRef = useRef(null);
    useEnterKeyNavigation(formRef, { onLastField: () => { addRawMaterialRow(); return true; } });

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [req, prod, wh, un, cc, bu, rmk, bom, bt, sysCtrl] = await Promise.all([
                authFetch('/api/production-orders'),
                authFetch('/api/products'),
                authFetch('/api/warehouses'),
                authFetch('/api/product-units'),
                authFetch('/api/cost-centers'),
                authFetch('/api/business-units'),
                authFetch('/api/remarks'),
                authFetch('/api/bom-templates'),
                authFetch('/api/billing-terms'),
                authFetch('/api/system-control')
            ]);
            setRows(req.data || []);
            setProducts(prod.data || []);
            setWarehouses(wh.data || []);
            setUnits(un.data || []);
            setCostCenters(cc.data || []);
            setBusinessUnits(bu.data || []);
            setRemarks(rmk.data || []);
            setBomTemplates((bom.data || []).filter(t => t.is_active));
            setBillingTerms((bt.data || []).filter(t => t.applicable_production_entry && t.is_enabled));
            setDualUomEntryMode(resolveDualUomEntryMode(sysCtrl.data));
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setForm(emptyForm); setEditingId(null); };
    const productIsFixedDualUom = (productId) => products.find(p => p.id === productId)?.uom_mode === 'fixed_dual';
    const dualConversionFactor = (productId) => {
        const product = products.find(p => p.id === productId);
        const rate = (product?.product_unit_rates || []).find(r => r.unit_id === product?.dual_uom_primary_unit_id);
        return Number(rate?.conversion_factor) || 1;
    };
    const handleRawMaterialProductSelect = (idx, productId) => {
        const product = products.find(p => p.id === productId);
        if (product?.uom_mode === 'fixed_dual') {
            updateRawMaterialRow(idx, { product_id: productId, uom_id: product.dual_uom_primary_unit_id || '', alt_unit_id: product.base_unit_id || '', rate_basis: 'primary' });
        } else {
            updateRawMaterialRow(idx, { product_id: productId, uom_id: product?.base_unit_id || '' });
        }
    };
    const handleByproductProductSelect = (idx, productId) => {
        const product = products.find(p => p.id === productId);
        if (product?.uom_mode === 'fixed_dual') {
            updateByproductRow(idx, { product_id: productId, uom_id: product.dual_uom_primary_unit_id || '', alt_unit_id: product.base_unit_id || '', rate_basis: 'primary' });
        } else {
            updateByproductRow(idx, { product_id: productId, uom_id: product?.base_unit_id || '' });
        }
    };
    const handleOutputProductSelect = (productId) => {
        const product = products.find(p => p.id === productId);
        if (product?.uom_mode === 'fixed_dual') {
            setForm(f => ({ ...f, output_product_id: productId, output_uom_id: product.dual_uom_primary_unit_id || '', output_alt_unit_id: product.base_unit_id || '', output_rate_basis: 'primary' }));
        } else {
            setForm(f => ({ ...f, output_product_id: productId, output_uom_id: product?.base_unit_id || '' }));
        }
    };

    const rawMaterialBaseAmount = (r) => {
        if (productIsFixedDualUom(r.product_id) && r.alt_qty) {
            const factor = dualConversionFactor(r.product_id);
            const totalBaseQty = dualBaseQty(r.qty, r.alt_qty, factor, dualUomEntryMode.mode);
            return r.rate_basis === 'primary' ? (totalBaseQty / factor) * (Number(r.cost_rate) || 0) : totalBaseQty * (Number(r.cost_rate) || 0);
        }
        return (Number(r.qty) || 0) * (Number(r.cost_rate) || 0);
    };
    const rawMaterialAmount = (r, idx) => {
        const base = rawMaterialBaseAmount(r);
        if (idx !== undefined && (r.billing_term_ids || []).length > 0) {
            const preview = lineTermPreviews[idx];
            if (preview?.total !== undefined) return preview.total;
        }
        return base;
    };
    const addRawMaterialRow = () => setForm(f => ({ ...f, raw_materials: [...f.raw_materials, emptyRawMaterialRow()] }));
    const removeRawMaterialRow = (idx) => {
        setForm(f => ({ ...f, raw_materials: f.raw_materials.length > 1 ? f.raw_materials.filter((_, i) => i !== idx) : f.raw_materials }));
        setSelectedRmIndexes(cur => cur.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
    };

    // FEATURE: live preview of each raw material line's own term
    // adjustment, using the SAME evaluateAllTerms preview endpoint
    // Purchase already uses - this is display-only; the backend
    // recomputes authoritatively on save.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const previews = {};
            for (let i = 0; i < form.raw_materials.length; i++) {
                const r = form.raw_materials[i];
                if (!r.billing_term_ids || r.billing_term_ids.length === 0) continue;
                try {
                    const res = await authFetch('/api/billing-terms/preview', {
                        method: 'POST',
                        body: JSON.stringify({ term_ids: r.billing_term_ids, basic_amount: rawMaterialBaseAmount(r), quantity: Number(r.qty) || 0 })
                    });
                    previews[i] = res.data;
                } catch { /* leave this line's preview absent on failure */ }
            }
            if (!cancelled) setLineTermPreviews(previews);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(form.raw_materials.map(r => ({ q: r.qty, r: r.cost_rate, t: r.billing_term_ids })))]);

    const toggleTermForRmLines = (lineIndexes, termId) => {
        const allHaveIt = lineIndexes.every(idx => (form.raw_materials[idx]?.billing_term_ids || []).includes(termId));
        setForm(f => {
            const raw_materials = [...f.raw_materials];
            lineIndexes.forEach(idx => {
                const current = raw_materials[idx].billing_term_ids || [];
                raw_materials[idx] = { ...raw_materials[idx], billing_term_ids: allHaveIt ? current.filter(x => x !== termId) : (current.includes(termId) ? current : [...current, termId]) };
            });
            return { ...f, raw_materials };
        });
    };
    const updateRawMaterialRow = (idx, patch) => setForm(f => ({ ...f, raw_materials: f.raw_materials.map((r, i) => i === idx ? { ...r, ...patch } : r) }));
    const addByproductRow = () => setForm(f => ({ ...f, byproducts: [...f.byproducts, emptyByproductRow()] }));
    const removeByproductRow = (idx) => setForm(f => ({ ...f, byproducts: f.byproducts.filter((_, i) => i !== idx) }));
    const updateByproductRow = (idx, patch) => setForm(f => ({ ...f, byproducts: f.byproducts.map((b, i) => i === idx ? { ...b, ...patch } : b) }));
    const productMaintainsBatch = (productId) => !!products.find(p => p.id === productId)?.maintain_batch;

    // FEATURE: "Load from BOM Template" - pulls the recipe forward and
    // SCALES every raw material/by-product line to whatever output qty
    // is actually being run today, instead of re-typing the same list
    // every production run.
    const handleLoadTemplate = async (templateId) => {
        if (!form.output_qty || Number(form.output_qty) <= 0) {
            return showAlert('Enter the desired Output Qty first, then load a template - it scales the recipe to that quantity', 'danger');
        }
        try {
            const res = await authFetch(`/api/bom-templates/${templateId}/scale?output_qty=${form.output_qty}`);
            const { template, raw_materials, byproducts } = res.data;
            setForm(f => ({
                ...f,
                output_product_id: f.output_product_id || template.output_product_id,
                output_uom_id: f.output_uom_id || template.output_uom_id,
                bom_template_id: template.id,
                raw_materials: raw_materials.map(r => ({ ...emptyRawMaterialRow(), product_id: r.product_id, qty: r.qty, uom_id: r.uom_id, process_name: r.process_name || '' })),
                byproducts: byproducts.map(bp => ({ ...emptyByproductRow(), product_id: bp.product_id, qty: bp.qty, uom_id: bp.uom_id, allocation_basis: bp.allocation_basis || 'fixed_recovery', recovery_rate: bp.recovery_rate, relative_value: bp.relative_value }))
            }));
            setShowTemplateModal(false);
            showAlert(`Loaded "${template.template_name}" scaled to ${form.output_qty} - review rates before saving`, 'success');
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // FEATURE: mirrors the backend's Joint Cost Allocation (Relative
    // Sales Value Method) exactly, so what's previewed here matches
    // what actually gets saved - fixed-recovery lines net off first,
    // then the remainder splits across the main output + every
    // joint-basis line by relative value (or plain qty if no relative
    // value has been entered anywhere yet).
    const totalRmCost = form.raw_materials.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.cost_rate) || 0), 0);
    const fixedLines = form.byproducts.filter(b => b.allocation_basis === 'fixed_recovery');
    const jointLines = form.byproducts.filter(b => b.allocation_basis !== 'fixed_recovery');
    const fixedRecoveryValue = fixedLines.reduce((s, b) => s + (Number(b.qty) || 0) * (Number(b.recovery_rate) || 0), 0);
    const netCost = totalRmCost - fixedRecoveryValue;
    const anyRelativeValueSet = Number(form.output_relative_value) > 0 || jointLines.some(l => Number(l.relative_value) > 0);
    const weightOf = (qty, relVal) => anyRelativeValueSet ? Number(qty || 0) * Number(relVal || 0) : Number(qty || 0);
    const mainWeight = weightOf(form.output_qty, form.output_relative_value);
    const totalWeight = mainWeight + jointLines.reduce((s, l) => s + weightOf(l.qty, l.relative_value), 0);
    const allocateShare = (w) => totalWeight > 0 ? netCost * (w / totalWeight) : 0;
    const outputUnitCost = Number(form.output_qty) > 0 ? allocateShare(mainWeight) / Number(form.output_qty) : 0;
    const totalBpValue = fixedRecoveryValue + jointLines.reduce((s, l) => s + allocateShare(weightOf(l.qty, l.relative_value)), 0);

    const handleSubmit = async (e, saveAsDraft = false) => {
        e.preventDefault();
        if (!saveAsDraft) {
            const missing = efc.missingRequired(form);
            if (missing.length) { showAlert(`Required: ${missing.join(', ')}`, 'danger'); return; }
        }
        if (!form.doc_date) return showAlert('Date is required', 'danger');
        const validRawMaterials = form.raw_materials.filter(r => r.product_id && Number(r.qty) > 0);
        const validByproducts = form.byproducts.filter(b => b.product_id && Number(b.qty) > 0);
        if (!saveAsDraft) {
            if (!form.output_product_id || !form.output_qty) return showAlert('Output Product and Qty are required', 'danger');
            if (!form.output_warehouse_id || !form.source_warehouse_id) return showAlert('Output and Source Warehouse are required', 'danger');
            if (validRawMaterials.length === 0) return showAlert('At least one Raw Material line is required', 'danger');
        }
        try {
            const payload = { ...form, raw_materials: validRawMaterials, byproducts: validByproducts, ...(saveAsDraft ? { status: 'draft', save_as_draft: true } : {}) };
            if (editingId) {
                await authFetch(`/api/production-orders/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? 'Draft saved' : 'Production Order updated', 'success');
            } else {
                const res = await authFetch('/api/production-orders', { method: 'POST', body: JSON.stringify(payload) });
                showAlert(saveAsDraft ? `Draft ${res.data.doc_no} saved` : `Production Order ${res.data.doc_no} created`, 'success');
            }
            resetForm();
            setShowForm(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleEdit = async (row) => {
        try {
            const res = await authFetch(`/api/production-orders/${row.id}`);
            setEditingId(row.id);
            setForm({
                ...emptyForm, ...res.data,
                doc_date: res.data.doc_date?.slice(0, 10) || emptyForm.doc_date,
                output_mfg_date: res.data.output_mfg_date?.slice(0, 10) || '',
                output_exp_date: res.data.output_exp_date?.slice(0, 10) || '',
                raw_materials: (res.data.raw_materials || []).length > 0 ? res.data.raw_materials : [emptyRawMaterialRow()],
                byproducts: res.data.byproducts || []
            });
            setShowForm(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleStatusChange = async (row, status) => {
        let cancellationReason;
        if (status === 'cancelled') {
            cancellationReason = window.prompt('Reason for cancelling this Production Order?');
            if (!cancellationReason || !cancellationReason.trim()) return;
        }
        try {
            await authFetch(`/api/production-orders/${row.id}/status`, { method: 'PUT', body: JSON.stringify({ status, cancellation_reason: cancellationReason }) });
            showAlert(`Marked as ${status}`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleDeleteDraft = async (row) => {
        if (!window.confirm(`Delete draft "${row.doc_no}"? This cannot be undone.`)) return;
        try {
            await authFetch(`/api/production-orders/${row.id}`, { method: 'DELETE' });
            showAlert('Draft deleted', 'warning');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const [udfDoc, setUdfDoc] = useState(null);

    const openAuditTrail = (row) => setAuditModal({ id: row.id, doc_no: row.doc_no });

    const columns = [
        { key: 'doc_no', label: 'No.', type: 'text' },
        { key: 'doc_date', label: 'Date', type: 'text', render: r => formatDateForDisplay(r.doc_date, 'dual') },
        { key: 'output_product_name_snapshot', label: 'Output', type: 'text', render: r => r.output_product_name_snapshot || '—' },
        { key: 'output_qty', label: 'Output Qty', type: 'number' },
        { key: 'output_unit_cost', label: 'Unit Cost', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' }
    ];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🏭 Production Order</span>
                <div className="erp-header-actions">
                    <button onClick={() => { resetForm(); setShowForm(s => !s); }} className={`erp-header-btn ${showForm ? '' : 'primary'}`}>
                        {showForm ? '✕ Close' : '➕ New'}
                    </button>
                </div>
            </div>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} ref={formRef}>
                    <div className="erp-topbar grid-cols-1 md:grid-cols-4">
                        <div className={efc.isVisible('doc_date') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Date <span className="req">*</span> {form.doc_date && <span className="hint">({formatDateForDisplay(form.doc_date, 'nepali')} BS)</span>} {efc.isRequired('doc_date') && <span className="req">*</span>}</label>
                            <input disabled={efc.isReadonly('doc_date')} type="date" className="erp-input" value={form.doc_date} onChange={e => setForm({ ...form, doc_date: e.target.value })} required />
                        </div>
                        <div className={efc.isVisible('output_product_id') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Output Product <span className="req">*</span> {efc.isRequired('output_product_id') && <span className="req">*</span>}</label>
                            <SearchablePopupSelect
                                listKey="production_output_product_picker"
                                columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                defaultVisibleKeys={['product_name']}
                                items={products} getId={p => p.id} getLabel={p => p.product_name}
                                searchKeys={['product_name', 'product_code']}
                                value={form.output_product_id} onChange={id => handleOutputProductSelect(id)} placeholder="Select Output Product"
                            />
                        </div>
                        <div className={efc.isVisible('output_qty') ? 'erp-field' : 'erp-field hidden'}>
                            <label className="erp-label">Output Qty <span className="req">*</span> {efc.isRequired('output_qty') && <span className="req">*</span>}</label>
                            {productIsFixedDualUom(form.output_product_id) ? (
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1">
                                        <input disabled={efc.isReadonly('output_qty')}
                                            type="number" step="0.0001" className="erp-input" value={form.output_qty} required
                                            onChange={e => {
                                                if (dualUomEntryMode.mode === 'auto_convert') {
                                                    const { qty, alt_qty } = onPrimaryQtyChange(e.target.value, dualConversionFactor(form.output_product_id));
                                                    setForm({ ...form, output_qty: qty, output_alt_qty: alt_qty });
                                                } else {
                                                    setForm({ ...form, output_qty: e.target.value });
                                                }
                                            }}
                                        />
                                        <span className="text-[10px] text-gray-400">{units.find(u => u.id === form.output_uom_id)?.unit_name || 'Primary'}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number" step="0.0001" className="erp-input" value={form.output_alt_qty} placeholder="0"
                                            onChange={e => {
                                                if (dualUomEntryMode.mode === 'auto_convert') {
                                                    const { qty, alt_qty } = onSecondaryQtyChange(e.target.value, dualConversionFactor(form.output_product_id), dualUomEntryMode.reverseEnabled);
                                                    setForm({ ...form, output_qty: qty !== undefined ? qty : form.output_qty, output_alt_qty: alt_qty });
                                                } else {
                                                    const { value } = validateFixedSecondary(e.target.value, dualConversionFactor(form.output_product_id));
                                                    setForm({ ...form, output_alt_qty: value });
                                                }
                                            }}
                                        />
                                        <span className="text-[10px] text-gray-400">{units.find(u => u.id === form.output_alt_unit_id)?.unit_name || 'Secondary'}</span>
                                    </div>
                                    {dualUomEntryMode.mode !== 'auto_convert' && validateFixedSecondary(form.output_alt_qty, dualConversionFactor(form.output_product_id)).error && (
                                        <span className="text-[9px] text-red-500 leading-tight">{validateFixedSecondary(form.output_alt_qty, dualConversionFactor(form.output_product_id)).error}</span>
                                    )}
                                </div>
                            ) : (
                                <input type="number" step="0.0001" className="erp-input" value={form.output_qty} onChange={e => setForm({ ...form, output_qty: e.target.value })} required />
                            )}
                        </div>
                        <div className="erp-field">
                            <label className="erp-label">Output UOM</label>
                            {productIsFixedDualUom(form.output_product_id) ? (
                                <span className="text-xs text-gray-400">{units.find(u => u.id === form.output_uom_id)?.unit_name}/{units.find(u => u.id === form.output_alt_unit_id)?.unit_name}</span>
                            ) : (
                                <select className="erp-select" value={form.output_uom_id} onChange={e => setForm({ ...form, output_uom_id: e.target.value })}>
                                    <option value="">UOM</option>
                                    {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                </select>
                            )}
                        </div>
                        {!editingId && (
                            <NumberingCategorySelector voucherType="production" value={form.numbering_category_id} onChange={id => setForm({ ...form, numbering_category_id: id })} />
                        )}
                    </div>

                    <div className="erp-tab-content">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className={efc.isVisible('output_warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Output Warehouse <span className="req">*</span> {efc.isRequired('output_warehouse_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="production_output_wh_picker"
                                    columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                    defaultVisibleKeys={['warehouse_name']}
                                    items={warehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                    searchKeys={['warehouse_name', 'warehouse_code']}
                                    value={form.output_warehouse_id} onChange={id => setForm({ ...form, output_warehouse_id: id })} placeholder="Select Warehouse"
                                />
                            </div>
                            <div className={efc.isVisible('source_warehouse_id') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Source Warehouse (Raw Material) <span className="req">*</span> {efc.isRequired('source_warehouse_id') && <span className="req">*</span>}</label>
                                <SearchablePopupSelect
                                    listKey="production_source_wh_picker"
                                    columns={[{ key: 'warehouse_code', label: 'Code' }, { key: 'warehouse_name', label: 'Name' }]}
                                    defaultVisibleKeys={['warehouse_name']}
                                    items={warehouses} getId={w => w.id} getLabel={w => w.warehouse_name}
                                    searchKeys={['warehouse_name', 'warehouse_code']}
                                    value={form.source_warehouse_id} onChange={id => setForm({ ...form, source_warehouse_id: id })} placeholder="Select Warehouse"
                                />
                            </div>
                            {productMaintainsBatch(form.output_product_id) && (
                                <div className={efc.isVisible('output_batch_no') ? 'erp-field' : 'erp-field hidden'}>
                                    <label className="erp-label">Output Batch No {efc.isRequired('output_batch_no') && <span className="req">*</span>}</label>
                                    <input disabled={efc.isReadonly('output_batch_no')} className="erp-input" value={form.output_batch_no} onChange={e => setForm({ ...form, output_batch_no: e.target.value })} />
                                </div>
                            )}
                            <div className="erp-field">
                                <label className="erp-label">Output Mfg Date</label>
                                <input type="date" className="erp-input" value={form.output_mfg_date} onChange={e => setForm({ ...form, output_mfg_date: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Output Exp Date</label>
                                <input type="date" className="erp-input" value={form.output_exp_date} onChange={e => setForm({ ...form, output_exp_date: e.target.value })} />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Output Relative Value <span className="hint">(for Joint Product allocation)</span></label>
                                <input type="number" step="0.01" className="erp-input" value={form.output_relative_value} onChange={e => setForm({ ...form, output_relative_value: e.target.value })} placeholder="e.g. expected sale rate" />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Cost Center</label>
                                <SearchablePopupSelect
                                    listKey="production_cost_center_picker"
                                    columns={[{ key: 'cost_center_code', label: 'Code' }, { key: 'cost_center_name', label: 'Name' }]}
                                    defaultVisibleKeys={['cost_center_name']}
                                    items={costCenters} getId={c => c.id} getLabel={c => c.cost_center_name}
                                    searchKeys={['cost_center_name', 'cost_center_code']}
                                    value={form.cost_center_id} onChange={id => setForm({ ...form, cost_center_id: id })} placeholder="Select Cost Center"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Unit</label>
                                <SearchablePopupSelect
                                    listKey="production_business_unit_picker"
                                    columns={[{ key: 'unit_code', label: 'Code' }, { key: 'unit_name', label: 'Name' }]}
                                    defaultVisibleKeys={['unit_name']}
                                    items={businessUnits} getId={u => u.id} getLabel={u => u.unit_name}
                                    searchKeys={['unit_name', 'unit_code']}
                                    value={form.business_unit_id} onChange={id => setForm({ ...form, business_unit_id: id })} placeholder="Select Unit"
                                />
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Remarks</label>
                                <input list="production-remarks-suggestions" className="erp-input" value={form.remarks_text} onChange={e => setForm({ ...form, remarks_text: e.target.value })} placeholder="Type or pick" />
                                <datalist id="production-remarks-suggestions">
                                    {remarks.map(r => <option key={r.id} value={r.remark_text} />)}
                                </datalist>
                            </div>
                            <div className={efc.isVisible('narration') ? 'erp-field' : 'erp-field hidden'}>
                                <label className="erp-label">Narration {efc.isRequired('narration') && <span className="req">*</span>}</label>
                                <input disabled={efc.isReadonly('narration')} className="erp-input" value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} />
                            </div>
                        </div>

                        <div className="flex items-center justify-between mb-2">
                            <h2 className="font-semibold text-sm text-gray-500 uppercase">Raw Materials Consumed</h2>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setProductTermModalIndexes(selectedRmIndexes.length > 0 ? selectedRmIndexes : form.raw_materials.map((_, i) => i))}
                                    className="text-xs text-purple-600 border border-purple-200 rounded-full px-3 py-1 hover:bg-purple-50"
                                >
                                    🏷️ Product Term ({selectedRmIndexes.length > 0 ? `${selectedRmIndexes.length} selected` : 'all rows'})
                                </button>
                                <button type="button" onClick={() => setShowTemplateModal(true)} className="text-xs text-blue-600 border border-blue-200 rounded-full px-3 py-1 hover:bg-blue-50">📋 Load from BOM Template</button>
                            </div>
                        </div>
                        {form.bom_template_id && (
                            <p className="text-xs text-gray-400 mb-2">Using template — lines below were auto-scaled; edit freely if the actual run differed.</p>
                        )}
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table mb-2 min-w-[1000px]">
                                <thead>
                                    <tr>
                                        <th className="w-6"></th>
                                        <th className="w-56">Product</th>
                                        <th className={`w-24 ${efc.isVisible('qty', 'detail') ? '' : 'hidden'}`}>Qty</th>
                                        <th className="w-28">UOM</th>
                                        <th className="w-28">Batch No</th>
                                        <th className="w-44">Warehouse Override</th>
                                        <th className={`w-32 ${efc.isVisible('process_name', 'detail') ? '' : 'hidden'}`}>Process</th>
                                        <th className={`w-24 ${efc.isVisible('cost_rate', 'detail') ? '' : 'hidden'}`}>Cost Rate</th>
                                        <th className="w-24">Amount</th>
                                        <th className="w-20">Term</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.raw_materials.map((r, idx) => (
                                        <tr key={idx}>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRmIndexes.includes(idx)}
                                                    onChange={e => setSelectedRmIndexes(cur => e.target.checked ? [...cur, idx] : cur.filter(i => i !== idx))}
                                                />
                                            </td>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="production_rm_product_picker"
                                                    columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['product_name']}
                                                    items={products} getId={p => p.id} getLabel={p => p.product_name}
                                                    searchKeys={['product_name', 'product_code']}
                                                    value={r.product_id} onChange={id => handleRawMaterialProductSelect(idx, id)} placeholder="Raw Material"
                                                />
                                            </td>
                                            <td className={efc.isVisible('qty', 'detail') ? '' : 'hidden'}>
                                                {productIsFixedDualUom(r.product_id) ? (
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-1">
                                                            <input disabled={efc.isReadonly('qty', 'detail')}
                                                                type="number" step="0.0001" className="erp-input" style={{ width: '60px' }} value={r.qty}
                                                                onChange={e => updateRawMaterialRow(idx, dualUomEntryMode.mode === 'auto_convert' ? onPrimaryQtyChange(e.target.value, dualConversionFactor(r.product_id)) : { qty: e.target.value })}
                                                            />
                                                            <span className="text-[10px] text-gray-400">{units.find(u => u.id === r.uom_id)?.unit_name || 'Primary'}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="number" step="0.0001" className="erp-input" style={{ width: '60px' }} value={r.alt_qty} placeholder="0"
                                                                onChange={e => {
                                                                    if (dualUomEntryMode.mode === 'auto_convert') {
                                                                        updateRawMaterialRow(idx, onSecondaryQtyChange(e.target.value, dualConversionFactor(r.product_id), dualUomEntryMode.reverseEnabled));
                                                                    } else {
                                                                        const { value } = validateFixedSecondary(e.target.value, dualConversionFactor(r.product_id));
                                                                        updateRawMaterialRow(idx, { alt_qty: value });
                                                                    }
                                                                }}
                                                            />
                                                            <span className="text-[10px] text-gray-400">{units.find(u => u.id === r.alt_unit_id)?.unit_name || 'Secondary'}</span>
                                                        </div>
                                                        {dualUomEntryMode.mode !== 'auto_convert' && validateFixedSecondary(r.alt_qty, dualConversionFactor(r.product_id)).error && (
                                                            <span className="text-[9px] text-red-500 leading-tight">{validateFixedSecondary(r.alt_qty, dualConversionFactor(r.product_id)).error}</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <input disabled={efc.isReadonly('qty', 'detail')} type="number" step="0.0001" className="erp-input" value={r.qty} onChange={e => updateRawMaterialRow(idx, { qty: e.target.value })} />
                                                )}
                                            </td>
                                            <td>
                                                {productIsFixedDualUom(r.product_id) ? (
                                                    <span className="text-xs text-gray-400">{units.find(u => u.id === r.uom_id)?.unit_name}/{units.find(u => u.id === r.alt_unit_id)?.unit_name}</span>
                                                ) : (
                                                    <select className="erp-select" value={r.uom_id} onChange={e => updateRawMaterialRow(idx, { uom_id: e.target.value })}>
                                                        <option value="">UOM</option>
                                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                    </select>
                                                )}
                                            </td>
                                            <td>
                                                {productMaintainsBatch(r.product_id) ? (
                                                    <input className="erp-input" value={r.batch_no} onChange={e => updateRawMaterialRow(idx, { batch_no: e.target.value })} placeholder="Batch" />
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td>
                                                <select className="erp-select" value={r.warehouse_id} onChange={e => updateRawMaterialRow(idx, { warehouse_id: e.target.value })}>
                                                    <option value="">(source default)</option>
                                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                                </select>
                                            </td>
                                            <td className={efc.isVisible('process_name', 'detail') ? '' : 'hidden'}><input disabled={efc.isReadonly('process_name', 'detail')} className="erp-input" value={r.process_name} onChange={e => updateRawMaterialRow(idx, { process_name: e.target.value })} placeholder="e.g. Cutting" /></td>
                                            <td className={efc.isVisible('cost_rate', 'detail') ? '' : 'hidden'}>
                                                <input disabled={efc.isReadonly('cost_rate', 'detail')} type="number" step="0.01" className="erp-input" value={r.cost_rate} onChange={e => updateRawMaterialRow(idx, { cost_rate: e.target.value })} />
                                                {productIsFixedDualUom(r.product_id) && (
                                                    <select className="erp-select mt-1" style={{ fontSize: '10px', height: '22px' }} value={r.rate_basis} onChange={e => updateRawMaterialRow(idx, { rate_basis: e.target.value })}>
                                                        <option value="primary">per {units.find(u => u.id === r.uom_id)?.unit_name || 'Primary'}</option>
                                                        <option value="secondary">per {units.find(u => u.id === r.alt_unit_id)?.unit_name || 'Secondary'}</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td className="text-gray-500">{rawMaterialAmount(r, idx).toFixed(2)}</td>
                                            <td><button type="button" tabIndex={-1} onClick={() => setProductTermModalIndexes([idx])} className="text-blue-600 text-xs underline">
                                                {(r.billing_term_ids || []).length > 0 ? `Term (${r.billing_term_ids.length})` : 'Term'}
                                            </button></td>
                                            <td><button type="button" tabIndex={-1} onClick={() => removeRawMaterialRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex justify-between items-center mb-4">
                            <button type="button" onClick={addRawMaterialRow} className="text-xs text-blue-600">➕ Add Raw Material</button>
                            <span className="text-sm font-semibold">Total Raw Material Cost: {totalRmCost.toFixed(2)}</span>
                        </div>

                        <h2 className="font-semibold text-sm text-gray-500 uppercase mb-2">Outputs / By-Products <span className="text-gray-400 normal-case">(a minor scrap by-product, or a genuine Joint Product like "1 chicken → many parts")</span></h2>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table mb-2 min-w-[1100px]">
                                <thead>
                                    <tr>
                                        <th className="w-56">Product</th>
                                        <th className="w-24">Qty</th>
                                        <th className="w-28">UOM</th>
                                        <th className="w-28">Batch No</th>
                                        <th className="w-40">Warehouse</th>
                                        <th className="w-36">Type</th>
                                        <th className="w-24">Recovery Rate / Relative Value</th>
                                        <th className="w-24">Allocated Value</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.byproducts.map((bp, idx) => {
                                        const isFixed = bp.allocation_basis === 'fixed_recovery';
                                        let lineValue;
                                        if (isFixed && productIsFixedDualUom(bp.product_id) && bp.alt_qty) {
                                            const factor = dualConversionFactor(bp.product_id);
                                            const totalBaseQty = dualBaseQty(bp.qty, bp.alt_qty, factor, dualUomEntryMode.mode);
                                            lineValue = bp.rate_basis === 'primary' ? (totalBaseQty / factor) * (Number(bp.recovery_rate) || 0) : totalBaseQty * (Number(bp.recovery_rate) || 0);
                                        } else {
                                            lineValue = isFixed
                                                ? (Number(bp.qty) || 0) * (Number(bp.recovery_rate) || 0)
                                                : allocateShare(weightOf(bp.qty, bp.relative_value));
                                        }
                                        return (
                                        <tr key={idx}>
                                            <td>
                                                <SearchablePopupSelect
                                                    listKey="production_bp_product_picker"
                                                    columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]}
                                                    defaultVisibleKeys={['product_name']}
                                                    items={products} getId={p => p.id} getLabel={p => p.product_name}
                                                    searchKeys={['product_name', 'product_code']}
                                                    value={bp.product_id} onChange={id => handleByproductProductSelect(idx, id)} placeholder="Product"
                                                />
                                            </td>
                                            <td>
                                                {productIsFixedDualUom(bp.product_id) ? (
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="number" step="0.0001" className="erp-input" style={{ width: '60px' }} value={bp.qty}
                                                                onChange={e => updateByproductRow(idx, dualUomEntryMode.mode === 'auto_convert' ? onPrimaryQtyChange(e.target.value, dualConversionFactor(bp.product_id)) : { qty: e.target.value })}
                                                            />
                                                            <span className="text-[10px] text-gray-400">{units.find(u => u.id === bp.uom_id)?.unit_name || 'Primary'}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="number" step="0.0001" className="erp-input" style={{ width: '60px' }} value={bp.alt_qty} placeholder="0"
                                                                onChange={e => {
                                                                    if (dualUomEntryMode.mode === 'auto_convert') {
                                                                        updateByproductRow(idx, onSecondaryQtyChange(e.target.value, dualConversionFactor(bp.product_id), dualUomEntryMode.reverseEnabled));
                                                                    } else {
                                                                        const { value } = validateFixedSecondary(e.target.value, dualConversionFactor(bp.product_id));
                                                                        updateByproductRow(idx, { alt_qty: value });
                                                                    }
                                                                }}
                                                            />
                                                            <span className="text-[10px] text-gray-400">{units.find(u => u.id === bp.alt_unit_id)?.unit_name || 'Secondary'}</span>
                                                        </div>
                                                        {dualUomEntryMode.mode !== 'auto_convert' && validateFixedSecondary(bp.alt_qty, dualConversionFactor(bp.product_id)).error && (
                                                            <span className="text-[9px] text-red-500 leading-tight">{validateFixedSecondary(bp.alt_qty, dualConversionFactor(bp.product_id)).error}</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <input type="number" step="0.0001" className="erp-input" value={bp.qty} onChange={e => updateByproductRow(idx, { qty: e.target.value })} />
                                                )}
                                            </td>
                                            <td>
                                                {productIsFixedDualUom(bp.product_id) ? (
                                                    <span className="text-xs text-gray-400">{units.find(u => u.id === bp.uom_id)?.unit_name}/{units.find(u => u.id === bp.alt_unit_id)?.unit_name}</span>
                                                ) : (
                                                    <select className="erp-select" value={bp.uom_id} onChange={e => updateByproductRow(idx, { uom_id: e.target.value })}>
                                                        <option value="">UOM</option>
                                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                                    </select>
                                                )}
                                            </td>
                                            <td>
                                                {productMaintainsBatch(bp.product_id) ? (
                                                    <input className="erp-input" value={bp.batch_no} onChange={e => updateByproductRow(idx, { batch_no: e.target.value })} placeholder="Batch" />
                                                ) : <span className="text-gray-300 text-xs">—</span>}
                                            </td>
                                            <td>
                                                <select className="erp-select" value={bp.warehouse_id} onChange={e => updateByproductRow(idx, { warehouse_id: e.target.value })}>
                                                    <option value="">(output default)</option>
                                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                                </select>
                                            </td>
                                            <td>
                                                <select className="erp-select" value={bp.allocation_basis} onChange={e => updateByproductRow(idx, { allocation_basis: e.target.value })}>
                                                    <option value="fixed_recovery">Minor By-Product</option>
                                                    <option value="value_wise">Joint Product</option>
                                                </select>
                                            </td>
                                            <td>
                                                {isFixed ? (
                                                    <>
                                                        <input type="number" step="0.01" className="erp-input" value={bp.recovery_rate} onChange={e => updateByproductRow(idx, { recovery_rate: e.target.value })} placeholder="Recovery Rate" />
                                                        {productIsFixedDualUom(bp.product_id) && (
                                                            <select className="erp-select mt-1" style={{ fontSize: '10px', height: '22px' }} value={bp.rate_basis} onChange={e => updateByproductRow(idx, { rate_basis: e.target.value })}>
                                                                <option value="primary">per {units.find(u => u.id === bp.uom_id)?.unit_name || 'Primary'}</option>
                                                                <option value="secondary">per {units.find(u => u.id === bp.alt_unit_id)?.unit_name || 'Secondary'}</option>
                                                            </select>
                                                        )}
                                                    </>
                                                ) : (
                                                    <input type="number" step="0.01" className="erp-input" value={bp.relative_value} onChange={e => updateByproductRow(idx, { relative_value: e.target.value })} placeholder="Expected Rate" />
                                                )}
                                            </td>
                                            <td className="text-gray-500">{lineValue.toFixed(2)}</td>
                                            <td><button type="button" tabIndex={-1} onClick={() => removeByproductRow(idx)} className="text-red-500 text-xs">✕</button></td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {jointLines.length > 0 && (
                            <p className="text-xs text-gray-400 mb-2">Joint Products share the raw material cost with the main output, proportional to {anyRelativeValueSet ? 'relative value (qty × expected rate)' : 'quantity (no expected rate entered yet)'} - the standard method for splitting one process into several sellable parts.</p>
                        )}
                        <div className="flex justify-between items-center mb-4">
                            <button type="button" onClick={addByproductRow} className="text-xs text-blue-600">➕ Add By-Product</button>
                            <span className="text-sm font-semibold">Total By-Product Value: {totalBpValue.toFixed(2)}</span>
                        </div>

                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                            <div className="flex justify-between"><span>Net Production Cost</span><b>{netCost.toFixed(2)}</b></div>
                            <div className="flex justify-between"><span>Output Unit Cost</span><b>{outputUnitCost.toFixed(4)}</b></div>
                        </div>
                    </div>

                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="erp-btn">Cancel</button>
                            <button type="button" onClick={e => handleSubmit(e, true)} className="erp-btn">💾 Save as Draft</button>
                            <button type="submit" className="erp-btn primary">{editingId ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </form>
            )}
        </div>

        <div className="max-w-6xl mx-auto px-4 mt-4">
            <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={showDraftsOnly} onChange={e => setShowDraftsOnly(e.target.checked)} />
                    Show Drafts only
                </label>
            </div>
            <ReportGrid
                columns={columns}
                rows={showDraftsOnly ? rows.filter(r => r.status === 'draft') : rows}
                getId={r => r.id}
                storageKey="production_order_grid"
                rowActions={(row) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => handleEdit(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                        {row.status === 'posted' && <a href={`/print/production_order/${row.id}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨️ Print</a>}
                        <button onClick={() => openAuditTrail(row)} className="px-2 py-1 bg-gray-500 text-white rounded text-xs">History</button>
                        <button onClick={() => setUdfDoc(row.id)} className="px-2 py-1 bg-indigo-500 text-white rounded text-xs" title="Custom fields (UDF)">UDF</button>{udfDoc === row.id && <UdfValuesModal docType="production_order" docId={row.id} onClose={() => setUdfDoc(null)} />}
                        {row.status === 'draft' && <button onClick={() => handleStatusChange(row, 'posted')} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Post</button>}
                        {row.status !== 'cancelled' && <button onClick={() => handleStatusChange(row, 'cancelled')} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Cancel</button>}
                        {row.status === 'draft' && <button onClick={() => handleDeleteDraft(row)} className="px-2 py-1 bg-red-800 text-white rounded text-xs">Delete</button>}
                    </div>
                )}
            />
        </div>

        {productTermModalIndexes !== null && productTermModalIndexes.length > 0 && (() => {
            const targetLines = productTermModalIndexes.map(idx => ({ idx, line: form.raw_materials[idx] })).filter(t => t.line);
            const totalBasic = targetLines.reduce((s, t) => s + rawMaterialBaseAmount(t.line), 0);
            const totalNetTermAmount = targetLines.reduce((s, t) => {
                const preview = lineTermPreviews[t.idx];
                return s + (preview?.total !== undefined ? preview.total - rawMaterialBaseAmount(t.line) : 0);
            }, 0);
            return (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
                        <div className="erp-header">
                            <span className="erp-header-title">Product Term — {targetLines.length} Raw Material Line{targetLines.length > 1 ? 's' : ''} Selected</span>
                        </div>
                        <div className="p-5">
                            <p className="text-xs text-gray-400 mb-3">These terms only adjust Production Costing (and what shows on the Production Report) - they never post to the ledger.</p>
                            <div className="max-h-32 overflow-y-auto border rounded-lg mb-4">
                                <table className="w-full text-xs">
                                    <thead><tr className="text-gray-500 uppercase"><th className="text-left px-2 py-1">Line</th><th className="text-left px-2 py-1">Product</th><th className="text-right px-2 py-1">Qty</th><th className="text-right px-2 py-1">Basic Value</th></tr></thead>
                                    <tbody>
                                        {targetLines.map(({ idx, line }) => (
                                            <tr key={idx} className="border-t">
                                                <td className="px-2 py-1">{idx + 1}</td>
                                                <td className="px-2 py-1">{line.product_name_snapshot || '—'}</td>
                                                <td className="px-2 py-1 text-right">{line.qty || 0}</td>
                                                <td className="px-2 py-1 text-right">{rawMaterialBaseAmount(line).toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="erp-field mb-4">
                                <label className="erp-label">Combined Basic Value</label>
                                <input className="erp-input" disabled value={totalBasic.toFixed(2)} />
                            </div>
                            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                                Applicable Terms <span className="text-gray-400 normal-case">(checking a term applies it to every line above at once)</span>
                            </p>
                            <div className="space-y-1.5">
                                {billingTerms.map(t => {
                                    const checkedCount = targetLines.filter(({ line }) => (line.billing_term_ids || []).includes(t.id)).length;
                                    const allChecked = checkedCount === targetLines.length;
                                    const someChecked = checkedCount > 0 && !allChecked;
                                    return (
                                        <label key={t.id} className="flex items-center justify-between gap-2 text-sm border rounded-lg px-3 py-2">
                                            <span className="flex items-center gap-2">
                                                <input
                                                    type="checkbox" data-enter-skip="true" checked={allChecked}
                                                    ref={el => { if (el) el.indeterminate = someChecked; }}
                                                    onChange={() => toggleTermForRmLines(productTermModalIndexes, t.id)}
                                                />
                                                {t.term_name} <span className="text-xs text-gray-400">({t.term_code})</span>
                                            </span>
                                            {someChecked && <span className="text-xs text-amber-600">{checkedCount}/{targetLines.length}</span>}
                                        </label>
                                    );
                                })}
                                {billingTerms.length === 0 && <p className="text-sm text-gray-400">No Billing Terms are set up for Production yet — mark one as "Production Entry" in Billing Term Management.</p>}
                            </div>
                            <div className="flex justify-between font-semibold text-sm border-t pt-2 mt-3">
                                <span>Net Costing Adjustment (combined, all selected lines)</span>
                                <span>{totalNetTermAmount.toFixed(2)}</span>
                            </div>
                        </div>
                        <div className="erp-bottombar">
                            <div />
                            <div className="erp-bottombar-actions">
                                <button type="button" onClick={() => setProductTermModalIndexes(null)} className="erp-btn primary">Ok</button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        })()}

        {showTemplateModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
                    <div className="erp-header"><span className="erp-header-title">📋 Load from BOM Template</span></div>
                    <div className="p-4">
                        <p className="text-xs text-gray-400 mb-3">Scales to the Output Qty you've already entered ({form.output_qty || '—'}).</p>
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {bomTemplates.map(t => (
                                <button key={t.id} type="button" onClick={() => handleLoadTemplate(t.id)} className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-blue-50 flex justify-between items-center">
                                    <span>{t.template_name} <span className="text-xs text-gray-400">({t.template_code})</span></span>
                                    <span className="text-xs text-gray-400">{t.output_product_name_snapshot} · std {t.standard_output_qty}</span>
                                </button>
                            ))}
                            {bomTemplates.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No active BOM Templates yet.</p>}
                        </div>
                    </div>
                    <div className="erp-bottombar">
                        <div />
                        <div className="erp-bottombar-actions">
                            <button type="button" onClick={() => setShowTemplateModal(false)} className="erp-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {auditModal && <RecordHistory table="production_orders" id={auditModal.id} title={auditModal.doc_no} legacyUrl={`/api/production-orders/${auditModal.id}/audit-trail`} onClose={() => setAuditModal(null)} />}
        </div>
        </Layout>
    );
}
