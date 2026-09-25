// =============================================
// BarcodePrint.jsx
// Barcode / price label printing.
//   Items     pick products (unit, number of labels, batch, mfg / expiry,
//             MRP / rate), or load them from a GRN / Purchase Bill (labels =
//             qty received)
//   Formats   built-in: 38x25 roll, 50x25 roll 2-up, A4 65 (38.1x21.2),
//             A4 24 (64x33.9), 100x50 shelf label, 30x30 QR label - and your
//             own, made in the designer (document_templates, barcode_label)
//   Designer  label size, columns, gaps, margins, sheet / roll; elements
//             (text / field, barcode CODE128 / EAN-13 / EAN-8 / UPC / CODE39 /
//             ITF, QR code, line) placed in mm - drag them on the preview,
//             edit font, size, bold, alignment
// Barcodes: JsBarcode (MIT), QR: qrcode (MIT) - both bundled, free.
// =============================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';

const FIELDS = [['product_name', 'Product name'], ['product_code', 'Product code'], ['barcode', 'Barcode value'], ['mrp', 'MRP'], ['rate', 'Sales rate'], ['unit', 'Unit'],
    ['batch_no', 'Batch'], ['mfg_date', 'Mfg date'], ['exp_date', 'Expiry date'], ['company_name', 'Company'], ['group', 'Product group'], ['custom', 'Custom text']];
const FORMATS = ['CODE128', 'EAN13', 'EAN8', 'UPC', 'CODE39', 'ITF'];
let eid = 0; const nid = () => `e${Date.now()}${++eid}`;
const T = (field, x, y, w, h, extra = {}) => ({ id: nid(), type: 'text', field, x, y, w, h, font_size: 7, bold: false, align: 'left', text: '', ...extra });
const B = (x, y, w, h, extra = {}) => ({ id: nid(), type: 'barcode', field: 'barcode', x, y, w, h, format: 'CODE128', show_text: true, font_size: 6, ...extra });
export const BUILTIN_LABELS = [
    { id: 'b-38x25', template_name: '38 x 25 mm roll (1 across)', builtin: true, config: { sheet: 'roll', label_w_mm: 38, label_h_mm: 25, cols: 1, gap_x_mm: 0, gap_y_mm: 2, margin_top_mm: 0, margin_left_mm: 0, border: false,
        elements: [T('product_name', 1.5, 1, 35, 4, { bold: true }), B(2, 5.5, 34, 12), T('mrp', 1.5, 19.5, 17, 4, { text: 'MRP Rs. ', bold: true }), T('batch_no', 19.5, 19.5, 17, 4, { text: 'B: ', align: 'right' })] } },
    { id: 'b-50x25x2', template_name: '50 x 25 mm roll (2 across)', builtin: true, config: { sheet: 'roll', label_w_mm: 50, label_h_mm: 25, cols: 2, gap_x_mm: 3, gap_y_mm: 2, margin_top_mm: 0, margin_left_mm: 1, border: false,
        elements: [T('product_name', 2, 1, 46, 4, { bold: true, font_size: 8 }), B(3, 5.5, 44, 12), T('mrp', 2, 19.5, 22, 4, { text: 'MRP Rs. ', bold: true, font_size: 8 }), T('exp_date', 26, 19.5, 22, 4, { text: 'Exp: ', align: 'right' })] } },
    { id: 'b-a4-65', template_name: 'A4 sheet 65 labels (38.1 x 21.2)', builtin: true, config: { sheet: 'a4', label_w_mm: 38.1, label_h_mm: 21.2, cols: 5, gap_x_mm: 2.5, gap_y_mm: 0, margin_top_mm: 10.7, margin_left_mm: 4.7, border: false,
        elements: [T('product_name', 1.5, 0.8, 35, 3.5, { bold: true, font_size: 6 }), B(2, 4.5, 34, 11, { font_size: 5 }), T('mrp', 1.5, 16.5, 35, 3.5, { text: 'MRP Rs. ', font_size: 6, align: 'center', bold: true })] } },
    { id: 'b-a4-24', template_name: 'A4 sheet 24 labels (64 x 33.9)', builtin: true, config: { sheet: 'a4', label_w_mm: 64, label_h_mm: 33.9, cols: 3, gap_x_mm: 2.5, gap_y_mm: 0, margin_top_mm: 12.9, margin_left_mm: 7.2, border: false,
        elements: [T('company_name', 2, 1, 60, 3.5, { font_size: 6, align: 'center' }), T('product_name', 2, 4.5, 60, 4.5, { bold: true, font_size: 8, align: 'center' }), B(6, 9.5, 52, 15),
            T('mrp', 2, 27, 30, 5, { text: 'MRP Rs. ', bold: true, font_size: 9 }), T('rate', 32, 27, 30, 5, { text: 'Our price ', font_size: 9, align: 'right' })] } },
    { id: 'b-shelf', template_name: 'Shelf label 100 x 50', builtin: true, config: { sheet: 'roll', label_w_mm: 100, label_h_mm: 50, cols: 1, gap_x_mm: 0, gap_y_mm: 3, margin_top_mm: 0, margin_left_mm: 0, border: true,
        elements: [T('product_name', 4, 3, 92, 8, { bold: true, font_size: 14 }), T('product_code', 4, 12, 50, 5, { font_size: 8 }), T('rate', 4, 20, 55, 14, { text: 'Rs. ', bold: true, font_size: 28 }),
            T('mrp', 4, 36, 55, 6, { text: 'MRP Rs. ', font_size: 10 }), { id: nid(), type: 'qr', field: 'barcode', x: 70, y: 15, w: 26, h: 26 }, B(4, 43, 60, 6, { show_text: false })] } },
    { id: 'b-qr', template_name: 'QR label 30 x 30', builtin: true, config: { sheet: 'roll', label_w_mm: 30, label_h_mm: 30, cols: 1, gap_x_mm: 0, gap_y_mm: 2, margin_top_mm: 0, margin_left_mm: 0, border: false,
        elements: [{ id: nid(), type: 'qr', field: 'barcode', x: 5, y: 1, w: 20, h: 20 }, T('product_name', 1, 22, 28, 4, { font_size: 6, align: 'center', bold: true }), T('mrp', 1, 26, 28, 3.5, { text: 'Rs. ', font_size: 6, align: 'center' })] } }
];

function BarcodeSvg({ value, format, showText, fontSize }) {
    const ref = useRef(null);
    useEffect(() => {
        let cancelled = false;
        import('jsbarcode').then(mod => {
            if (cancelled || !ref.current) return;
            const JsBarcode = mod.default || mod;
            const opts = { format: format || 'CODE128', displayValue: showText !== false, fontSize: (fontSize || 6) * 3, margin: 0, height: 60, width: 2, textMargin: 1 };
            try { JsBarcode(ref.current, String(value || ' '), opts); }
            catch { try { JsBarcode(ref.current, String(value || ' '), { ...opts, format: 'CODE128' }); } catch { /* nothing to draw */ } }
            const w = ref.current.getAttribute('width'), h = ref.current.getAttribute('height');
            if (w && h) { ref.current.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`); ref.current.removeAttribute('width'); ref.current.removeAttribute('height'); }
        });
        return () => { cancelled = true; };
    }, [value, format, showText, fontSize]);
    return <svg ref={ref} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }} />;
}
function QrSvg({ value }) {
    const [svg, setSvg] = useState('');
    useEffect(() => { let c = false; import('qrcode').then(m => (m.default || m).toString(String(value || ' '), { type: 'svg', margin: 0 })).then(s => { if (!c) setSvg(s); }).catch(() => {}); return () => { c = true; }; }, [value]);
    return <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: svg.replace('<svg', '<svg style="width:100%;height:100%"') }} />;
}

function valueOf(el, item) {
    if (el.field === 'custom') return el.text || '';
    const v = item[el.field];
    if (v === undefined || v === null || v === '') return el.type === 'text' ? '' : item.product_code || '';
    const shown = ['mrp', 'rate'].includes(el.field) ? Number(v).toFixed(2) : String(v);
    return el.type === 'text' ? `${el.text || ''}${shown}` : shown;
}
export function Label({ cfg, item, selected, onPick, onDrag }) {
    return (
        <div style={{ position: 'relative', width: `${cfg.label_w_mm}mm`, height: `${cfg.label_h_mm}mm`, border: cfg.border ? '0.2mm solid #000' : undefined, overflow: 'hidden', boxSizing: 'border-box', background: '#fff' }}>
            {cfg.elements.map(el => {
                const style = { position: 'absolute', left: `${el.x}mm`, top: `${el.y}mm`, width: `${el.w}mm`, height: `${el.h}mm`, outline: selected === el.id ? '0.3mm dashed #2563eb' : undefined, cursor: onDrag ? 'move' : undefined };
                const down = onDrag ? e => { e.preventDefault(); onPick(el.id); onDrag(el.id, e); } : undefined;
                if (el.type === 'line') return <div key={el.id} style={{ ...style, borderTop: '0.3mm solid #000', height: 0 }} onMouseDown={down} />;
                if (el.type === 'barcode') return <div key={el.id} style={style} onMouseDown={down}><BarcodeSvg value={valueOf(el, item)} format={el.format} showText={el.show_text} fontSize={el.font_size} /></div>;
                if (el.type === 'qr') return <div key={el.id} style={style} onMouseDown={down}><QrSvg value={valueOf(el, item)} /></div>;
                return <div key={el.id} onMouseDown={down} style={{ ...style, fontSize: `${el.font_size}pt`, fontWeight: el.bold ? 700 : 400, textAlign: el.align, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valueOf(el, item)}</div>;
            })}
        </div>
    );
}
function Sheet({ cfg, items }) {
    // one page (A4) or a continuous roll; labels fill columns left to right
    const style = { display: 'grid', gridTemplateColumns: `repeat(${cfg.cols}, ${cfg.label_w_mm}mm)`, columnGap: `${cfg.gap_x_mm}mm`, rowGap: `${cfg.gap_y_mm}mm`, padding: `${cfg.margin_top_mm}mm 0 0 ${cfg.margin_left_mm}mm` };
    if (cfg.sheet !== 'a4') return <div style={style}>{items.map((it, i) => <Label key={i} cfg={cfg} item={it} />)}</div>;
    const perRow = cfg.cols, rows = Math.max(1, Math.floor((297 - cfg.margin_top_mm + cfg.gap_y_mm) / (cfg.label_h_mm + cfg.gap_y_mm)));
    const per = perRow * rows, pages = [];
    for (let i = 0; i < items.length; i += per) pages.push(items.slice(i, i + per));
    return pages.map((p, i) => <div key={i} className="label-page" style={{ ...style, width: '210mm', height: '297mm', boxSizing: 'border-box', alignContent: 'start' }}>{p.map((it, j) => <Label key={j} cfg={cfg} item={it} />)}</div>);
}

export default function BarcodePrint() {
    const { authFetch } = useAuth();
    const [products, setProducts] = useState([]);
    const [company, setCompany] = useState('');
    const [units, setUnits] = useState({});
    const [picked, setPicked] = useState([]);
    const [items, setItems] = useState([]);            // { key, product_id, unit_id, labels, batch_no, mfg_date, exp_date, mrp, rate }
    const [templates, setTemplates] = useState([]);
    const [tplId, setTplId] = useState('b-38x25');
    const [design, setDesign] = useState(null);
    const [sel, setSel] = useState(null);
    const [src, setSrc] = useState({ type: 'purchase_grn', list: [], id: '' });
    const [printing, setPrinting] = useState(false);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    const canvasRef = useRef(null);

    const loadTemplates = useCallback(() => authFetch('/api/document-templates?type=barcode_label').then(r => { const l = r.data || []; setTemplates(l); const d = l.find(x => x.is_default); if (d) setTplId(id => (id.startsWith('b-') ? d.id : id)); }).catch(() => {}), [authFetch]);
    useEffect(() => {
        loadTemplates();
        authFetch('/api/products').then(r => setProducts(r.data || [])).catch(e => setError(e.message));
        authFetch('/api/company/profile').then(r => setCompany((r.data && (r.data.company_name || r.data[0]?.company_name)) || '')).catch(() => {});
        authFetch('/api/product-units').then(r => setUnits(Object.fromEntries((r.data || []).map(u => [u.id, u.unit_symbol || u.unit_name])))).catch(() => {});
    }, [authFetch, loadTemplates]);
    useEffect(() => { authFetch(`/api/barcode/sources?type=${src.type}`).then(r => setSrc(s => ({ ...s, list: r.data || [], id: '' }))).catch(() => {}); }, [authFetch, src.type]);
    const all = useMemo(() => [...BUILTIN_LABELS, ...templates], [templates]);
    const tpl = all.find(x => x.id === tplId) || BUILTIN_LABELS[0];
    const cfg = design ? design.config : tpl.config;
    const byId = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

    const addItems = list => setItems(cur => [...cur, ...list.map(x => {
        const p = byId[x.product_id] || {}, rates = p.product_unit_rates || [];
        const r = rates.find(u => u.unit_id === x.unit_id) || rates.find(u => u.is_base_unit) || rates[0] || {};
        return { key: nid(), product_id: x.product_id, unit_id: r.unit_id || '', labels: Math.max(1, Math.round(x.labels || 1)), batch_no: x.batch_no || '', mfg_date: x.mfg_date ? String(x.mfg_date).slice(0, 10) : '', exp_date: x.exp_date ? String(x.exp_date).slice(0, 10) : '',
            mrp: x.mrp || r.mrp || '', rate: r.sales_rate_sr1 || x.rate || '' };
    })]);
    const labelData = it => {
        const p = byId[it.product_id] || {}, r = (p.product_unit_rates || []).find(u => u.unit_id === it.unit_id) || {};
        return { product_name: p.product_name || '', product_code: p.product_code || '', barcode: r.barcode || p.barcode || p.product_code || '', mrp: it.mrp, rate: it.rate,
            unit: units[r.unit_id] || p.base_unit?.unit_symbol || p.base_unit?.unit_name || '', batch_no: it.batch_no, mfg_date: it.mfg_date, exp_date: it.exp_date, company_name: company, group: p.product_groups?.group_name || '' };
    };
    const allLabels = items.flatMap(it => Array.from({ length: Math.min(2000, Number(it.labels) || 0) }, () => labelData(it)));
    const loadSource = async () => {
        if (!src.id) return;
        try { const r = await authFetch(`/api/barcode/source-lines?type=${src.type}&id=${src.id}`); addItems((r.data || []).map(l => ({ ...l, unit_id: l.uom_id, labels: l.qty + (l.free_qty || 0) }))); setMsg(`${(r.data || []).length} line(s) added`); } catch (e) { setError(e.message); }
    };
    const updEl = (id, patch) => setDesign(d => ({ ...d, config: { ...d.config, elements: d.config.elements.map(e => (e.id === id ? { ...e, ...patch } : e)) } }));
    const startDrag = (id, ev) => {
        const el = design.config.elements.find(e => e.id === id);
        const pxPerMm = canvasRef.current ? canvasRef.current.getBoundingClientRect().width / design.config.label_w_mm : 12;
        const sx = ev.clientX, sy = ev.clientY, ox = el.x, oy = el.y;
        const move = e => updEl(id, { x: Math.max(0, Math.round((ox + (e.clientX - sx) / pxPerMm) * 2) / 2), y: Math.max(0, Math.round((oy + (e.clientY - sy) / pxPerMm) * 2) / 2) });
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };
    const saveTpl = async asNew => {
        try {
            const body = { template_type: 'barcode_label', template_name: design.template_name, config: design.config, is_default: !!design.is_default };
            const r = asNew || !design.id ? await authFetch('/api/document-templates', { method: 'POST', body: JSON.stringify(body) }) : await authFetch(`/api/document-templates/${design.id}`, { method: 'PUT', body: JSON.stringify(body) });
            await loadTemplates(); setTplId(r.data.id); setDesign(null); setMsg('Label format saved');
        } catch (e) { setError(e.message); }
    };
    const delTpl = async () => { if (!window.confirm('Delete this label format?')) return; try { await authFetch(`/api/document-templates/${design.id}`, { method: 'DELETE' }); await loadTemplates(); setTplId('b-38x25'); setDesign(null); } catch (e) { setError(e.message); } };
    const doPrint = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 800); };
    const selEl = design?.config.elements.find(e => e.id === sel);
    const sample = allLabels[0] || { product_name: 'Sample Product 500g', product_code: 'P0001', barcode: '8901234567890', mrp: 125, rate: 115, unit: 'Pcs', batch_no: 'B24', mfg_date: '2026-01-01', exp_date: '2027-01-01', company_name: company || 'Company', group: 'Group' };
    const C = (k, label, step = '0.1') => <label className="flex flex-col text-xs">{label}<input type="number" step={step} className="border rounded px-1 w-20" value={design.config[k]} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, [k]: Number(e.target.value) } }))} /></label>;

    return (
        <Layout>
        <style>{`@media print { body * { visibility: hidden !important; } .labels-print, .labels-print * { visibility: visible !important; } .labels-print { position: absolute; left: 0; top: 0; }
            .label-page { break-after: page; page-break-after: always; } @page { ${cfg.sheet === 'a4' ? 'size: A4; margin: 0;' : `size: ${cfg.label_w_mm * cfg.cols + cfg.gap_x_mm * (cfg.cols - 1) + cfg.margin_left_mm}mm ${cfg.label_h_mm + cfg.gap_y_mm}mm; margin: 0;`} } }`}</style>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">🏷 Barcode / Label Printing</span></div>
            <div className="erp-tab-content">
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}
                <div className="grid lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 space-y-3">
                        <div className="flex flex-wrap gap-2 items-end">
                            <div className="w-72"><MultiPick label="Products" items={products.map(p => ({ id: p.id, name: `${p.product_name}${p.product_code ? ` (${p.product_code})` : ''}` }))} value={picked} onChange={setPicked} allLabel="Choose" /></div>
                            <button className="erp-btn" disabled={!picked.length} onClick={() => { addItems(picked.map(id => ({ product_id: id, labels: 1 }))); setPicked([]); }}>➕ Add</button>
                            <span className="text-gray-400 text-sm mx-2">or from</span>
                            <select className="erp-select w-36" value={src.type} onChange={e => setSrc(s => ({ ...s, type: e.target.value }))}><option value="purchase_grn">GRN</option><option value="purchase_bill">Purchase Bill</option></select>
                            <select className="erp-select w-56" value={src.id} onChange={e => setSrc(s => ({ ...s, id: e.target.value }))}><option value="">— document —</option>{src.list.map(d => <option key={d.id} value={d.id}>{d.doc_no} · {String(d.doc_date).slice(0, 10)} · {d.vendor_name_snapshot || ''}</option>)}</select>
                            <button className="erp-btn" disabled={!src.id} onClick={loadSource}>Load items</button>
                        </div>
                        <table className="erp-grid-table w-full text-sm">
                            <thead><tr><th className="text-left">Product</th><th className="text-left">Unit</th><th className="text-right">Labels</th><th className="text-left">Batch</th><th className="text-left">Mfg</th><th className="text-left">Expiry</th><th className="text-right">MRP</th><th className="text-right">Rate</th><th /></tr></thead>
                            <tbody>{items.map(it => {
                                const p = byId[it.product_id] || {};
                                const up = patch => setItems(list => list.map(x => (x.key === it.key ? { ...x, ...patch } : x)));
                                return (
                                    <tr key={it.key}><td>{p.product_name}</td>
                                        <td><select className="border rounded px-1" value={it.unit_id} onChange={e => { const r = (p.product_unit_rates || []).find(u => u.unit_id === e.target.value) || {}; up({ unit_id: e.target.value, mrp: r.mrp || it.mrp, rate: r.sales_rate_sr1 || it.rate }); }}>
                                            {(p.product_unit_rates || []).map(u => <option key={u.unit_id} value={u.unit_id}>{units[u.unit_id] || (u.is_base_unit ? 'Base' : 'Unit')}{u.barcode ? ` · ${u.barcode}` : ''}</option>)}</select></td>
                                        <td className="text-right"><input type="number" min="0" className="border rounded px-1 w-16 text-right" value={it.labels} onChange={e => up({ labels: e.target.value })} /></td>
                                        <td><input className="border rounded px-1 w-20" value={it.batch_no} onChange={e => up({ batch_no: e.target.value })} /></td>
                                        <td><input type="date" className="border rounded px-1" value={it.mfg_date} onChange={e => up({ mfg_date: e.target.value })} /></td>
                                        <td><input type="date" className="border rounded px-1" value={it.exp_date} onChange={e => up({ exp_date: e.target.value })} /></td>
                                        <td className="text-right"><input type="number" className="border rounded px-1 w-20 text-right" value={it.mrp} onChange={e => up({ mrp: e.target.value })} /></td>
                                        <td className="text-right"><input type="number" className="border rounded px-1 w-20 text-right" value={it.rate} onChange={e => up({ rate: e.target.value })} /></td>
                                        <td><button className="text-red-500 text-xs" onClick={() => setItems(list => list.filter(x => x.key !== it.key))}>✕</button></td></tr>
                                );
                            })}{!items.length && <tr><td colSpan={9} className="text-center text-gray-400 py-3">Add products, or load a GRN / purchase bill.</td></tr>}</tbody>
                        </table>
                    </div>
                    <div className="space-y-2">
                        <div className="erp-field"><label className="erp-label">Label format</label>
                            <select className="erp-select" value={tplId} onChange={e => { setTplId(e.target.value); setDesign(null); }}>{all.map(x => <option key={x.id} value={x.id}>{x.template_name}{x.is_default ? ' (default)' : ''}{x.builtin ? ' · built-in' : ''}</option>)}</select></div>
                        <div className="flex gap-2">
                            <button className="erp-btn" onClick={() => { setDesign(design ? null : { id: tpl.builtin ? null : tpl.id, template_name: tpl.builtin ? `${tpl.template_name} (copy)` : tpl.template_name, is_default: !!tpl.is_default, config: JSON.parse(JSON.stringify(tpl.config)) }); setSel(null); }}>🎨 {design ? 'Close designer' : 'Design'}</button>
                            <button className="erp-btn primary" disabled={!allLabels.length} onClick={doPrint}>🖨 Print {allLabels.length} label(s)</button>
                        </div>
                        <div className="bg-gray-100 p-3 overflow-auto max-w-full"><Label cfg={cfg} item={sample} /></div>
                        <div className="text-xs text-gray-500">{cfg.sheet === 'a4' ? `A4 sheet, ${cfg.cols} across` : `Roll, ${cfg.cols} across`} · {cfg.label_w_mm} x {cfg.label_h_mm} mm</div>
                    </div>
                </div>

                {design && (
                    <div className="mt-4 border rounded p-3 bg-gray-50 grid lg:grid-cols-3 gap-4">
                        <div className="space-y-2 text-sm">
                            <label className="erp-field"><span className="erp-label">Format name</span><input className="erp-input" value={design.template_name} onChange={e => setDesign(d => ({ ...d, template_name: e.target.value }))} /></label>
                            <div className="flex flex-wrap gap-2">
                                <label className="flex flex-col text-xs">Paper<select className="border rounded px-1" value={design.config.sheet} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, sheet: e.target.value } }))}><option value="roll">Roll</option><option value="a4">A4 sheet</option></select></label>
                                {C('label_w_mm', 'Width mm')}{C('label_h_mm', 'Height mm')}{C('cols', 'Across', '1')}{C('gap_x_mm', 'Gap X')}{C('gap_y_mm', 'Gap Y')}{C('margin_top_mm', 'Top margin')}{C('margin_left_mm', 'Left margin')}
                                <label className="flex items-center gap-1 text-xs mt-3"><input type="checkbox" checked={!!design.config.border} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, border: e.target.checked } }))} /> Border</label>
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {[['text', 'Text / field'], ['barcode', 'Barcode'], ['qr', 'QR code'], ['line', 'Line']].map(([t, l]) => (
                                    <button key={t} className="text-xs px-2 py-1 border rounded bg-white" onClick={() => { const e = t === 'text' ? T('product_name', 1, 1, 20, 4) : t === 'barcode' ? B(1, 5, 30, 10) : t === 'qr' ? { id: nid(), type: 'qr', field: 'barcode', x: 1, y: 1, w: 15, h: 15 } : { id: nid(), type: 'line', x: 1, y: 10, w: 20, h: 0 };
                                        setDesign(d => ({ ...d, config: { ...d.config, elements: [...d.config.elements, e] } })); setSel(e.id); }}>➕ {l}</button>
                                ))}
                            </div>
                            <label className="flex items-center gap-1"><input type="checkbox" checked={!!design.is_default} onChange={e => setDesign(d => ({ ...d, is_default: e.target.checked }))} /> Default format</label>
                            <div className="flex gap-2"><button className="erp-btn primary" onClick={() => saveTpl(false)}>💾 Save</button><button className="erp-btn" onClick={() => saveTpl(true)}>Save as new</button>{design.id && <button className="erp-btn" onClick={delTpl}>🗑 Delete</button>}</div>
                        </div>
                        <div className="overflow-auto bg-gray-200 p-2 max-h-[70vh]">
                            {(() => { const z = Math.min(4, Math.max(1.5, 90 / design.config.label_w_mm)); return (
                                <div style={{ width: `${design.config.label_w_mm * z}mm`, height: `${design.config.label_h_mm * z}mm` }}>
                                    <div ref={canvasRef} style={{ transform: `scale(${z})`, transformOrigin: 'top left', width: `${design.config.label_w_mm}mm` }}>
                                        <Label cfg={design.config} item={sample} selected={sel} onPick={setSel} onDrag={startDrag} />
                                    </div>
                                </div>); })()}
                        </div>
                        <div className="text-sm space-y-2">
                            {selEl ? (
                                <>
                                    <div className="font-medium">Selected: {selEl.type}</div>
                                    {selEl.type !== 'line' && <label className="flex flex-col text-xs">Field<select className="border rounded px-1" value={selEl.field} onChange={e => updEl(selEl.id, { field: e.target.value })}>{FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
                                    {selEl.type === 'text' && <label className="flex flex-col text-xs">{selEl.field === 'custom' ? 'Text' : 'Prefix'}<input className="border rounded px-1" value={selEl.text || ''} onChange={e => updEl(selEl.id, { text: e.target.value })} /></label>}
                                    <div className="flex flex-wrap gap-2">{['x', 'y', 'w', 'h'].map(k => <label key={k} className="flex flex-col text-xs">{k.toUpperCase()} mm<input type="number" step="0.5" className="border rounded px-1 w-16" value={selEl[k]} onChange={e => updEl(selEl.id, { [k]: Number(e.target.value) })} /></label>)}</div>
                                    {['text', 'barcode'].includes(selEl.type) && <label className="flex flex-col text-xs">Font pt<input type="number" step="0.5" className="border rounded px-1 w-16" value={selEl.font_size} onChange={e => updEl(selEl.id, { font_size: Number(e.target.value) })} /></label>}
                                    {selEl.type === 'text' && <div className="flex gap-3 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={!!selEl.bold} onChange={e => updEl(selEl.id, { bold: e.target.checked })} /> Bold</label>
                                        <select className="border rounded px-1" value={selEl.align} onChange={e => updEl(selEl.id, { align: e.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div>}
                                    {selEl.type === 'barcode' && <div className="flex gap-3 text-xs"><select className="border rounded px-1" value={selEl.format} onChange={e => updEl(selEl.id, { format: e.target.value })}>{FORMATS.map(f => <option key={f} value={f}>{f}</option>)}</select>
                                        <label className="flex items-center gap-1"><input type="checkbox" checked={selEl.show_text !== false} onChange={e => updEl(selEl.id, { show_text: e.target.checked })} /> Show number</label></div>}
                                    <button className="text-red-600 text-xs underline" onClick={() => { setDesign(d => ({ ...d, config: { ...d.config, elements: d.config.elements.filter(e => e.id !== selEl.id) } })); setSel(null); }}>Remove element</button>
                                </>
                            ) : <div className="text-xs text-gray-500">Click an element on the label to edit it; drag it to move (0.5 mm steps).</div>}
                        </div>
                    </div>
                )}
            </div>
        </div>
        </div>
        {printing && <div className="labels-print"><Sheet cfg={cfg} items={allLabels} /></div>}
        </Layout>
    );
}
