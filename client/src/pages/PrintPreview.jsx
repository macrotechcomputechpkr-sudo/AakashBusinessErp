// =============================================
// PrintPreview.jsx
// The real output of the Document Designer: given a template and an
// actual document, this renders the exact mm-positioned layout with
// REAL data (not the designer's sample data) - header band once,
// detail band once per line item, footer band once - including the
// real chart (aggregated from the actual line items) and the real
// Product Term Summary table, then lets the person print it with the
// browser's own print dialog.
// =============================================

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { renderMiniChartSvg, aggregateForChart } from '../utils/miniChart';

const PAPER_SIZES_MM = { A4: { width: 210, height: 297 }, A5: { width: 148, height: 210 } };

export default function PrintPreview() {
    const { documentType, documentId } = useParams();
    const [searchParams] = useSearchParams();
    const templateId = searchParams.get('template_id');
    const { authFetch } = useAuth();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                let resolvedTemplateId = templateId;
                if (!resolvedTemplateId) {
                    const list = await authFetch(`/api/print-templates?document_type=${documentType}`);
                    const def = (list.data || []).find(t => t.is_default) || (list.data || [])[0];
                    if (!def) { setError('No print template exists yet for this document type. Create one in Document Designer.'); return; }
                    resolvedTemplateId = def.id;
                }
                const res = await authFetch(`/api/print-templates/${resolvedTemplateId}/render/${documentId}`);
                setData(res.data);
            } catch (err) {
                setError(err.message);
            }
        })();
    }, [authFetch, documentType, documentId, templateId]);

    if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
    if (!data) return <div className="p-8 text-center text-gray-400">Loading…</div>;

    const { template, details, resolved } = data;
    const dims = template.paper_size === 'custom'
        ? { width: template.custom_width_mm, height: template.custom_height_mm }
        : PAPER_SIZES_MM[template.paper_size] || PAPER_SIZES_MM.A4;
    const pageWidthMm = template.orientation === 'landscape' ? dims.height : dims.width;
    const pageHeightMm = template.orientation === 'landscape' ? dims.width : dims.height;

    const renderResolvedBlock = (b, i) => {
        const style = {
            position: 'absolute', left: `${b.x}mm`, top: `${b.y}mm`, width: `${b.width}mm`, height: `${b.height}mm`,
            fontSize: `${b.font_size || 10}pt`, fontWeight: b.bold ? 700 : 400, fontStyle: b.italic ? 'italic' : 'normal', textAlign: b.align || 'left'
        };
        if (b.type === 'line') return <div key={i} style={{ ...style, background: '#333', height: '0.5mm' }} />;
        if (b.field_key === 'byproducts_summary') {
            const rows = b.value?.table || [];
            return (
                <table key={i} style={{ ...style, height: 'auto', fontSize: '8pt', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'left' }}>Byproduct</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'left' }}>Batch</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>Qty</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'left' }}>UOM</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>Recovery Rate</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0
                            ? <tr><td colSpan={6} style={{ border: '1px solid #ccc', padding: '2px 6px', color: '#999' }}>No byproducts recorded</td></tr>
                            : rows.map((r, ri) => (
                                <tr key={ri}>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px' }}>{r.product_name_snapshot}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px' }}>{r.batch_no || '—'}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>{r.qty}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px' }}>{r.uom_name_snapshot}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>{Number(r.recovery_rate || 0).toFixed(2)}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>{Number(r.amount || 0).toFixed(2)}</td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            );
        }
        if (b.field_key === 'product_term_summary') {
            const rows = b.value?.table || [];
            return (
                <table key={i} style={{ ...style, height: 'auto', fontSize: '8pt', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'left' }}>Product</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'left' }}>Term</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>%</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>Rate</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>Base Amount</th>
                            <th style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>Calc. Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0
                            ? <tr><td colSpan={6} style={{ border: '1px solid #ccc', padding: '2px 6px', color: '#999' }}>No product terms applied</td></tr>
                            : rows.map((r, ri) => (
                                <tr key={ri}>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px' }}>{r.product_name}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px' }}>{r.term_name}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>{r.term_percent !== null ? Number(r.term_percent).toFixed(2) : '—'}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>{Number(r.rate).toFixed(2)}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>{Number(r.base_amount).toFixed(2)}</td>
                                    <td style={{ border: '1px solid #ccc', padding: '2px 6px', textAlign: 'right' }}>{Number(r.calculation_amount).toFixed(2)}</td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            );
        }
        if (b.type === 'chart') {
            const chartRows = aggregateForChart(details, b.chart_x_field, b.chart_y_field);
            const pxPerMm = 3.78; // 96dpi / 25.4mm, for a print-accurate SVG pixel size
            return <div key={i} style={style} dangerouslySetInnerHTML={{ __html: renderMiniChartSvg(b.chart_type, chartRows, b.width * pxPerMm, b.height * pxPerMm) }} />;
        }
        return <div key={i} style={style}>{b.value ?? ''}</div>;
    };

    return (
        <div className="bg-gray-200 min-h-screen py-8 print:bg-white print:py-0">
            <style>{`@media print { @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; } .no-print { display: none !important; } }`}</style>

            <div className="no-print text-center mb-4">
                <button onClick={() => window.print()} className="bg-blue-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-blue-700">🖨️ Print</button>
            </div>

            <div className="bg-white shadow-lg mx-auto relative" style={{ width: `${pageWidthMm}mm`, minHeight: `${pageHeightMm}mm` }}>
                <div style={{ position: 'relative', height: `${Math.max(...(resolved.header.map(b => b.y + b.height)), 20)}mm` }}>
                    {resolved.header.map(renderResolvedBlock)}
                </div>

                {details.map((row, rowIdx) => (
                    <div key={rowIdx} style={{ position: 'relative', height: `${Math.max(...((resolved.detail_rows[rowIdx] || []).map(b => b.y + b.height)), 8)}mm`, borderBottom: '0.2mm solid #eee' }}>
                        {(resolved.detail_rows[rowIdx] || []).map(renderResolvedBlock)}
                    </div>
                ))}

                <div style={{ position: 'relative', height: `${Math.max(...(resolved.footer.map(b => b.y + b.height)), 20)}mm`, marginTop: '4mm' }}>
                    {resolved.footer.map(renderResolvedBlock)}
                </div>
            </div>
        </div>
    );
}
