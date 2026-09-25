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
import PrintedDocument, { pageSizeOf } from '../components/PrintedDocument';

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

    const { pageWidthMm, pageHeightMm } = pageSizeOf(data.template);

    return (
        <div className="bg-gray-200 min-h-screen py-8 print:bg-white print:py-0">
            <style>{`@media print { @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; } .no-print { display: none !important; } }`}</style>

            <div className="no-print text-center mb-4">
                <button onClick={() => window.print()} className="bg-blue-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-blue-700">🖨️ Print</button>
            </div>

            <PrintedDocument data={data} />
        </div>
    );
}
