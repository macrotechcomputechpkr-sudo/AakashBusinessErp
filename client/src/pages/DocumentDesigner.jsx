// =============================================
// DocumentDesigner.jsx
// "Sabai entry module ko documents design garne option banaune
// available feild list dine formula lagauna mile crystal report vanda
// advance. Drag and drop multiple feild... pratyak maa master details
// footer dine jun field ko variable jun ma parxa tesma rakhna dine...
// default maa a4,a5... graph chart pani banauna Milne hos"
//
// A from-scratch WYSIWYG print-layout designer:
// - Field palette (per document type) draggable onto three bands:
//   Header (once per print), Detail (repeats per line item), Footer
//   (totals/summaries).
// - Drag-to-place, drag-to-reposition, drag-to-resize.
// - Properties panel per selected block: font size, bold, italic,
//   align, and for "formula" blocks a formula expression (evaluated
//   server-side with the SAME engine Billing Terms use).
// - A4 / A5 / custom paper size, portrait/landscape.
// - Multiple named templates per document type, one marked default.
// - A basic chart block (bar/pie) bound to the detail rows.
//
// V1 note: this is a genuinely large feature (a mini Crystal Reports).
// This version covers the full core workflow end-to-end; some polish
// (snapping/grid, more chart types, more document types) is left for
// follow-up iteration once this foundation is confirmed working.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import { renderMiniChartSvg } from '../utils/miniChart';

const PAPER_SIZES_MM = { A4: { width: 210, height: 297 }, A5: { width: 148, height: 210 } };
const PX_PER_MM = 3.5; // on-screen scale factor for the canvas
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

const newBlockDefaults = { font_size: 10, bold: false, italic: false, align: 'left', width: 40, height: 8 };

export default function DocumentDesigner() {
    const { authFetch } = useAuth();
    const [documentType, setDocumentType] = useState('sales_bill');
    const [fieldCatalog, setFieldCatalog] = useState({ header: [], detail: [], footer: [] });
    const [templates, setTemplates] = useState([]);
    const [activeTemplateId, setActiveTemplateId] = useState(null);
    const [templateName, setTemplateName] = useState('New Template');
    const [paperSize, setPaperSize] = useState('A4');
    const [orientation, setOrientation] = useState('portrait');
    const [customWidth, setCustomWidth] = useState(210);
    const [customHeight, setCustomHeight] = useState(297);
    const [isDefault, setIsDefault] = useState(false);
    const [layout, setLayout] = useState({ header: [], detail: [], footer: [] });
    const [activeBand, setActiveBand] = useState('header');
    const [selectedBlockId, setSelectedBlockId] = useState(null);
    const [alert, setAlert] = useState(null);
    const [saving, setSaving] = useState(false);

    const canvasRef = useRef(null);
    const dragState = useRef(null); // { blockId, mode: 'move'|'resize', startX, startY, origX, origY, origW, origH }

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };

    const loadCatalogAndTemplates = useCallback(async () => {
        try {
            const [fc, tpl] = await Promise.all([
                authFetch(`/api/print-templates/available-fields?document_type=${documentType}`),
                authFetch(`/api/print-templates?document_type=${documentType}`)
            ]);
            setFieldCatalog(fc.data || { header: [], detail: [], footer: [] });
            setTemplates(tpl.data || []);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch, documentType]);
    useEffect(() => { loadCatalogAndTemplates(); }, [loadCatalogAndTemplates]);

    const paperDims = paperSize === 'custom' ? { width: customWidth, height: customHeight } : PAPER_SIZES_MM[paperSize];
    const canvasWidthPx = (orientation === 'landscape' ? paperDims.height : paperDims.width) * PX_PER_MM;
    const canvasHeightPx = (orientation === 'landscape' ? paperDims.width : paperDims.height) * PX_PER_MM;

    // FEATURE: detail band is drawn shorter on screen (it represents
    // ONE repeating row template, not the full page) since real
    // documents have a variable number of line items.
    const bandHeightPx = activeBand === 'detail' ? 60 : canvasHeightPx;

    const genBlockId = () => `blk_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const handlePaletteDragStart = (e, field, band) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ field, band }));
    };

    const handleCanvasDrop = (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/json');
        if (!raw) return;
        const { field } = JSON.parse(raw);
        const rect = canvasRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.round((e.clientX - rect.left) / PX_PER_MM));
        const y = Math.max(0, Math.round((e.clientY - rect.top) / PX_PER_MM));
        const newBlock = { id: genBlockId(), type: 'field', field_key: field.key, label: field.label, x, y, ...newBlockDefaults };
        setLayout(l => ({ ...l, [activeBand]: [...l[activeBand], newBlock] }));
        setSelectedBlockId(newBlock.id);
    };

    const addFormulaBlock = () => {
        const newBlock = { id: genBlockId(), type: 'formula', formula: '', label: 'Formula', x: 10, y: 10, ...newBlockDefaults, width: 50 };
        setLayout(l => ({ ...l, [activeBand]: [...l[activeBand], newBlock] }));
        setSelectedBlockId(newBlock.id);
    };
    const addTextBlock = () => {
        const newBlock = { id: genBlockId(), type: 'text', text: 'Label', x: 10, y: 10, ...newBlockDefaults };
        setLayout(l => ({ ...l, [activeBand]: [...l[activeBand], newBlock] }));
        setSelectedBlockId(newBlock.id);
    };
    const addLineBlock = () => {
        const newBlock = { id: genBlockId(), type: 'line', x: 10, y: 10, width: 100, height: 0.5, ...newBlockDefaults };
        setLayout(l => ({ ...l, [activeBand]: [...l[activeBand], newBlock] }));
        setSelectedBlockId(newBlock.id);
    };
    const addChartBlock = () => {
        const newBlock = { id: genBlockId(), type: 'chart', chart_type: 'bar', chart_x_field: 'product_name_snapshot', chart_y_field: 'amount', label: 'Chart', x: 10, y: 10, width: 80, height: 50, ...newBlockDefaults };
        setLayout(l => ({ ...l, [activeBand]: [...l[activeBand], newBlock] }));
        setSelectedBlockId(newBlock.id);
    };

    const currentBandBlocks = layout[activeBand] || [];
    const selectedBlock = currentBandBlocks.find(b => b.id === selectedBlockId) || null;

    const updateSelectedBlock = (patch) => {
        setLayout(l => ({ ...l, [activeBand]: l[activeBand].map(b => b.id === selectedBlockId ? { ...b, ...patch } : b) }));
    };
    const removeSelectedBlock = () => {
        setLayout(l => ({ ...l, [activeBand]: l[activeBand].filter(b => b.id !== selectedBlockId) }));
        setSelectedBlockId(null);
    };

    const onBlockMouseDown = (e, block, mode) => {
        e.stopPropagation();
        setSelectedBlockId(block.id);
        dragState.current = { blockId: block.id, mode, startX: e.clientX, startY: e.clientY, origX: block.x, origY: block.y, origW: block.width, origH: block.height };
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragEnd);
    };
    const onDragMove = (e) => {
        const ds = dragState.current;
        if (!ds) return;
        const dxMm = (e.clientX - ds.startX) / PX_PER_MM;
        const dyMm = (e.clientY - ds.startY) / PX_PER_MM;
        setLayout(l => ({
            ...l,
            [activeBand]: l[activeBand].map(b => {
                if (b.id !== ds.blockId) return b;
                if (ds.mode === 'move') return { ...b, x: Math.max(0, Math.round(ds.origX + dxMm)), y: Math.max(0, Math.round(ds.origY + dyMm)) };
                return { ...b, width: Math.max(5, Math.round(ds.origW + dxMm)), height: Math.max(3, Math.round(ds.origH + dyMm)) };
            })
        }));
    };
    const onDragEnd = () => {
        dragState.current = null;
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
    };

    const resetDesigner = () => {
        setActiveTemplateId(null);
        setTemplateName('New Template');
        setPaperSize('A4');
        setOrientation('portrait');
        setIsDefault(false);
        setLayout({ header: [], detail: [], footer: [] });
        setSelectedBlockId(null);
    };

    const loadTemplate = async (id) => {
        try {
            const res = await authFetch(`/api/print-templates/${id}`);
            const t = res.data;
            setActiveTemplateId(t.id);
            setTemplateName(t.template_name);
            setPaperSize(t.paper_size);
            setOrientation(t.orientation);
            setCustomWidth(t.custom_width_mm || 210);
            setCustomHeight(t.custom_height_mm || 297);
            setIsDefault(t.is_default);
            setLayout(t.layout_json || { header: [], detail: [], footer: [] });
            setSelectedBlockId(null);
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const handleSave = async () => {
        if (!templateName.trim()) return showAlert('Template name is required', 'danger');
        setSaving(true);
        try {
            const payload = {
                document_type: documentType, template_name: templateName, paper_size: paperSize, orientation,
                custom_width_mm: paperSize === 'custom' ? customWidth : null, custom_height_mm: paperSize === 'custom' ? customHeight : null,
                layout_json: layout, is_default: isDefault
            };
            if (activeTemplateId) {
                await authFetch(`/api/print-templates/${activeTemplateId}`, { method: 'PUT', body: JSON.stringify(payload) });
            } else {
                const res = await authFetch('/api/print-templates', { method: 'POST', body: JSON.stringify(payload) });
                setActiveTemplateId(res.data.id);
            }
            showAlert('Template saved', 'success');
            loadCatalogAndTemplates();
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Remove this template?')) return;
        try {
            await authFetch(`/api/print-templates/${id}`, { method: 'DELETE' });
            if (id === activeTemplateId) resetDesigner();
            loadCatalogAndTemplates();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    // Sample data purely for the designer's own canvas preview - a
    // real document's actual resolved rows are used at print time.
    const SAMPLE_CHART_ROWS = [{ label: 'Product A', value: 500 }, { label: 'Product B', value: 300 }, { label: 'Product C', value: 200 }];

    const handleSeedDefaults = async () => {
        try {
            const res = await authFetch('/api/print-templates/seed-defaults', { method: 'POST', body: JSON.stringify({ document_type: documentType }) });
            showAlert(res.message, 'success');
            loadCatalogAndTemplates();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const renderBlockContent = (b) => {
        if (b.type === 'line') return <div style={{ width: '100%', height: '100%', background: '#333' }} />;
        if (b.type === 'chart') return (
            <div className="w-full h-full border border-dashed border-purple-300 bg-purple-50/50" dangerouslySetInnerHTML={{ __html: renderMiniChartSvg(b.chart_type, SAMPLE_CHART_ROWS, b.width * PX_PER_MM, b.height * PX_PER_MM) }} />
        );
        const label = b.type === 'formula' ? `ƒ ${b.formula || '(empty)'}` : b.type === 'text' ? b.text : `{${b.label}}`;
        return <span style={{ fontWeight: b.bold ? 700 : 400, fontStyle: b.italic ? 'italic' : 'normal', textAlign: b.align, fontSize: `${b.font_size}px`, display: 'block', width: '100%' }}>{label}</span>;
    };

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">🎨 Document Designer</span>
                <div className="erp-header-actions">
                    <button type="button" onClick={handleSeedDefaults} className="erp-header-btn">✨ Generate 6 Default Templates</button>
                    <button type="button" onClick={resetDesigner} className="erp-header-btn">➕ New Template</button>
                    <button type="button" onClick={handleSave} disabled={saving} className="erp-header-btn primary">{saving ? 'Saving…' : '💾 Save'}</button>
                </div>
            </div>

            {alert && (
                <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="erp-tab-content">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
                    <div className="erp-field">
                        <label className="erp-label">Document Type</label>
                        <select className="erp-select" value={documentType} onChange={e => { setDocumentType(e.target.value); resetDesigner(); }}>
                            {DOCUMENT_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Template Name</label>
                        <input className="erp-input" value={templateName} onChange={e => setTemplateName(e.target.value)} />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Paper Size</label>
                        <select className="erp-select" value={paperSize} onChange={e => setPaperSize(e.target.value)}>
                            <option value="A4">A4</option>
                            <option value="A5">A5</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    {paperSize === 'custom' && (
                        <>
                            <div className="erp-field"><label className="erp-label">Width (mm)</label><input type="number" className="erp-input" value={customWidth} onChange={e => setCustomWidth(Number(e.target.value))} /></div>
                            <div className="erp-field"><label className="erp-label">Height (mm)</label><input type="number" className="erp-input" value={customHeight} onChange={e => setCustomHeight(Number(e.target.value))} /></div>
                        </>
                    )}
                    <div className="erp-field">
                        <label className="erp-label">Orientation</label>
                        <select className="erp-select" value={orientation} onChange={e => setOrientation(e.target.value)}>
                            <option value="portrait">Portrait</option>
                            <option value="landscape">Landscape</option>
                        </select>
                    </div>
                    <div className="erp-field">
                        <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Default for this document type</label>
                    </div>
                </div>

                {templates.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {templates.map(t => (
                            <div key={t.id} className={`flex items-center gap-1 border rounded-full px-3 py-1 text-xs cursor-pointer ${activeTemplateId === t.id ? 'bg-blue-50 border-blue-400' : 'border-gray-200'}`}>
                                <span onClick={() => loadTemplate(t.id)}>{t.template_name}{t.is_default ? ' ⭐' : ''}</span>
                                <button type="button" onClick={() => handleDelete(t.id)} className="text-red-400 hover:text-red-600">✕</button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-1 mb-3">
                    {['header', 'detail', 'footer'].map(band => (
                        <button key={band} type="button" onClick={() => { setActiveBand(band); setSelectedBlockId(null); }}
                            className={`px-4 py-1.5 text-sm rounded-t-lg border-b-2 ${activeBand === band ? 'border-blue-500 text-blue-600 font-semibold' : 'border-transparent text-gray-400'}`}>
                            {band === 'header' ? 'Header (Master)' : band === 'detail' ? 'Detail (per line)' : 'Footer'} ({(layout[band] || []).length})
                        </button>
                    ))}
                </div>

                <div className="flex gap-4">
                    {/* Field palette */}
                    <div className="w-48 shrink-0 border rounded-lg p-2 max-h-[560px] overflow-y-auto">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{activeBand} Fields</p>
                        {(fieldCatalog[activeBand] || []).map(f => (
                            <div key={f.key} draggable onDragStart={e => handlePaletteDragStart(e, f, activeBand)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5 mb-1 cursor-grab hover:bg-slate-100">
                                {f.label}
                            </div>
                        ))}
                        <div className="border-t mt-2 pt-2 space-y-1">
                            <button type="button" onClick={addTextBlock} className="w-full text-xs text-left px-2 py-1.5 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100">➕ Text Label</button>
                            <button type="button" onClick={addFormulaBlock} className="w-full text-xs text-left px-2 py-1.5 bg-green-50 border border-green-200 rounded hover:bg-green-100">ƒ Formula Field</button>
                            <button type="button" onClick={addLineBlock} className="w-full text-xs text-left px-2 py-1.5 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100">➖ Line</button>
                            <button type="button" onClick={addChartBlock} className="w-full text-xs text-left px-2 py-1.5 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100">📊 Chart</button>
                        </div>
                    </div>

                    {/* Canvas */}
                    <div className="flex-1 overflow-auto border rounded-lg bg-gray-100 p-4">
                        <div
                            ref={canvasRef}
                            onDragOver={e => e.preventDefault()}
                            onDrop={handleCanvasDrop}
                            onMouseDown={() => setSelectedBlockId(null)}
                            className="relative bg-white shadow mx-auto"
                            style={{ width: canvasWidthPx, height: bandHeightPx, backgroundImage: 'linear-gradient(#eee 1px, transparent 1px), linear-gradient(90deg, #eee 1px, transparent 1px)', backgroundSize: `${PX_PER_MM * 10}px ${PX_PER_MM * 10}px` }}
                        >
                            {currentBandBlocks.map(b => (
                                <div
                                    key={b.id}
                                    onMouseDown={e => onBlockMouseDown(e, b, 'move')}
                                    className={`absolute overflow-hidden cursor-move ${selectedBlockId === b.id ? 'ring-2 ring-blue-500' : 'ring-1 ring-gray-200'}`}
                                    style={{ left: b.x * PX_PER_MM, top: b.y * PX_PER_MM, width: b.width * PX_PER_MM, height: b.height * PX_PER_MM }}
                                >
                                    {renderBlockContent(b)}
                                    {selectedBlockId === b.id && (
                                        <div onMouseDown={e => onBlockMouseDown(e, b, 'resize')} className="absolute bottom-0 right-0 w-3 h-3 bg-blue-500 cursor-se-resize" />
                                    )}
                                </div>
                            ))}
                        </div>
                        {activeBand === 'detail' && <p className="text-xs text-gray-400 text-center mt-2">This band repeats once per line item on the printed document.</p>}
                    </div>

                    {/* Properties panel */}
                    <div className="w-64 shrink-0 border rounded-lg p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Properties</p>
                        {!selectedBlock ? (
                            <p className="text-xs text-gray-400">Select a block to edit its properties, or drag a field onto the canvas.</p>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-xs text-gray-500">{selectedBlock.label || selectedBlock.type}</p>
                                {selectedBlock.type === 'text' && (
                                    <div className="erp-field"><label className="erp-label">Text</label><input className="erp-input" value={selectedBlock.text} onChange={e => updateSelectedBlock({ text: e.target.value })} /></div>
                                )}
                                {selectedBlock.type === 'formula' && (
                                    <div className="erp-field">
                                        <label className="erp-label">Formula <span className="text-[10px] text-gray-400 normal-case">(e.g. qty * rate - discount_amount)</span></label>
                                        <input className="erp-input" value={selectedBlock.formula} onChange={e => updateSelectedBlock({ formula: e.target.value })} />
                                    </div>
                                )}
                                {selectedBlock.type === 'chart' && (
                                    <>
                                        <div className="erp-field">
                                            <label className="erp-label">Chart Type</label>
                                            <select className="erp-select" value={selectedBlock.chart_type} onChange={e => updateSelectedBlock({ chart_type: e.target.value })}>
                                                <option value="bar">Bar</option>
                                                <option value="pie">Pie</option>
                                                <option value="line">Line</option>
                                            </select>
                                        </div>
                                        <div className="erp-field">
                                            <label className="erp-label">Category Field</label>
                                            <select className="erp-select" value={selectedBlock.chart_x_field} onChange={e => updateSelectedBlock({ chart_x_field: e.target.value })}>
                                                {(fieldCatalog.detail || []).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                                            </select>
                                        </div>
                                        <div className="erp-field">
                                            <label className="erp-label">Value Field</label>
                                            <select className="erp-select" value={selectedBlock.chart_y_field} onChange={e => updateSelectedBlock({ chart_y_field: e.target.value })}>
                                                {(fieldCatalog.detail || []).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                                            </select>
                                        </div>
                                    </>
                                )}
                                {selectedBlock.type !== 'line' && selectedBlock.type !== 'chart' && (
                                    <>
                                        <div className="erp-field"><label className="erp-label">Font Size</label><input type="number" className="erp-input" value={selectedBlock.font_size} onChange={e => updateSelectedBlock({ font_size: Number(e.target.value) })} /></div>
                                        <div className="flex gap-3">
                                            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={selectedBlock.bold} onChange={e => updateSelectedBlock({ bold: e.target.checked })} /> Bold</label>
                                            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={selectedBlock.italic} onChange={e => updateSelectedBlock({ italic: e.target.checked })} /> Italic</label>
                                        </div>
                                        <div className="erp-field">
                                            <label className="erp-label">Align</label>
                                            <select className="erp-select" value={selectedBlock.align} onChange={e => updateSelectedBlock({ align: e.target.value })}>
                                                <option value="left">Left</option>
                                                <option value="center">Center</option>
                                                <option value="right">Right</option>
                                            </select>
                                        </div>
                                    </>
                                )}
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="erp-field"><label className="erp-label">X (mm)</label><input type="number" className="erp-input" value={selectedBlock.x} onChange={e => updateSelectedBlock({ x: Number(e.target.value) })} /></div>
                                    <div className="erp-field"><label className="erp-label">Y (mm)</label><input type="number" className="erp-input" value={selectedBlock.y} onChange={e => updateSelectedBlock({ y: Number(e.target.value) })} /></div>
                                    <div className="erp-field"><label className="erp-label">Width (mm)</label><input type="number" className="erp-input" value={selectedBlock.width} onChange={e => updateSelectedBlock({ width: Number(e.target.value) })} /></div>
                                    <div className="erp-field"><label className="erp-label">Height (mm)</label><input type="number" className="erp-input" value={selectedBlock.height} onChange={e => updateSelectedBlock({ height: Number(e.target.value) })} /></div>
                                </div>
                                <button type="button" onClick={removeSelectedBlock} className="w-full text-xs text-red-600 border border-red-200 rounded py-1.5 hover:bg-red-50">🗑 Remove Block</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
        </div>
        </Layout>
    );
}
