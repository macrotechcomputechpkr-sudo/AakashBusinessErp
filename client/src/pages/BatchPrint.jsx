// =============================================
// BatchPrint.jsx
// Prints many documents of one type in one go - the documents tagged in
// Manual Document Printing - each on its own page(s), in the chosen print
// template (or the type's default). The id list comes through
// localStorage (?key=...) so hundreds of documents never hit a URL limit.
// Printing records a print log entry per document.
// =============================================
import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import PrintedDocument, { pageSizeOf } from '../components/PrintedDocument';

export const BATCH_PREFIX = 'batch_print_';

export default function BatchPrint() {
    const { documentType } = useParams();
    const [searchParams] = useSearchParams();
    const { authFetch } = useAuth();
    const [job, setJob] = useState(null);
    const [docs, setDocs] = useState([]);              // [{ id, data, error }]
    const [done, setDone] = useState(0);
    const [error, setError] = useState('');
    const [copies, setCopies] = useState(1);
    const [logged, setLogged] = useState(false);
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        (async () => {
            let j = null;
            try { j = JSON.parse(localStorage.getItem(BATCH_PREFIX + searchParams.get('key')) || 'null'); } catch { j = null; }
            if (!j && searchParams.get('ids')) j = { ids: searchParams.get('ids').split(','), template_id: searchParams.get('template_id') || '' };
            if (!j || !j.ids?.length) { setError('Nothing to print - tag documents in Manual Document Printing first.'); return; }
            setJob(j);
            try {
                let templateId = j.template_id;
                if (!templateId) {
                    const list = await authFetch(`/api/print-templates?document_type=${documentType}`);
                    const def = (list.data || []).find(t => t.is_default) || (list.data || [])[0];
                    if (!def) { setError('No print template exists yet for this document type. Create one in Document Designer.'); return; }
                    templateId = def.id;
                }
                const out = new Array(j.ids.length);
                let next = 0, count = 0;
                const worker = async () => {
                    while (next < j.ids.length) {
                        const i = next++;
                        try { out[i] = { id: j.ids[i], data: (await authFetch(`/api/print-templates/${templateId}/render/${j.ids[i]}`)).data }; }
                        catch (e) { out[i] = { id: j.ids[i], error: e.message }; }
                        setDone(++count);
                    }
                };
                await Promise.all([worker(), worker(), worker(), worker()]);
                setDocs(out);
                setJob({ ...j, template_id: templateId });
            } catch (e) { setError(e.message); }
        })();
    }, [authFetch, documentType, searchParams]);

    const ok = docs.filter(d => d.data);
    const failed = docs.filter(d => d.error);
    const doPrint = async () => {
        if (!logged && ok.length) {
            try { await authFetch('/api/document-print/log', { method: 'POST', body: JSON.stringify({ document_type: documentType, document_ids: ok.map(d => d.id), template_id: job?.template_id || null }) }); setLogged(true); }
            catch { /* printing still works without the log */ }
        }
        window.print();
    };

    if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
    if (!job || docs.length === 0) {
        const total = job?.ids?.length || 0;
        return <div className="p-8 text-center text-gray-500">Preparing documents… {done} / {total}</div>;
    }
    const { pageWidthMm, pageHeightMm } = ok.length ? pageSizeOf(ok[0].data.template) : { pageWidthMm: 210, pageHeightMm: 297 };
    const pages = ok.flatMap(d => Array.from({ length: Math.max(1, copies) }, (_, c) => ({ ...d, copy: c })));

    return (
        <div className="bg-gray-200 min-h-screen py-8 print:bg-white print:py-0">
            <style>{`@media print { @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; } .no-print { display: none !important; } .batch-page { break-after: page; page-break-after: always; box-shadow: none !important; margin: 0 !important; } .batch-page:last-child { break-after: auto; page-break-after: auto; } }`}</style>
            <div className="no-print text-center mb-4 space-y-2">
                <div className="text-sm text-gray-700">{ok.length} document(s) ready{failed.length ? ` · ${failed.length} could not be rendered` : ''}{logged ? ' · print logged' : ''}</div>
                <div className="flex items-center justify-center gap-3">
                    <label className="text-sm">Copies of each <input type="number" min="1" max="10" value={copies} onChange={e => setCopies(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} className="w-16 border rounded px-2 py-1 ml-1" /></label>
                    <button onClick={doPrint} disabled={!ok.length} className="bg-blue-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">🖨️ Print all ({pages.length} page sets)</button>
                </div>
                {failed.length > 0 && <div className="text-xs text-red-600">{failed.map(f => f.error).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</div>}
            </div>
            {pages.map((d, i) => (
                <PrintedDocument key={`${d.id}-${d.copy}-${i}`} data={d.data} className="batch-page bg-white shadow-lg mx-auto relative mb-6" />
            ))}
        </div>
    );
}
