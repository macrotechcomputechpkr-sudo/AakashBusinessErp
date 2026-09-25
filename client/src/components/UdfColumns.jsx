// =============================================
// UdfColumns.jsx
// "Show custom fields (UDF)" for any report. The report says which document
// types it covers; the user ticks which custom fields to show (remembered
// per report in this browser); after the report loads, the values are
// fetched in one call by document id (and line id for line fields) and
// rendered as extra columns.
//
//   const udf = useUdfColumns('loading-sheet', ['sales_bill', 'sales_delivery']);
//   useEffect(() => { udf.load(rows, { doc: 'doc_id', line: 'line_id' }); }, [rows]);
//   {udf.picker}                                      // the chooser button
//   <th>…</th>{udf.headers()}                          // header cells
//   <td>…</td>{udf.cells(row, { doc: 'doc_id' })}      // row cells
//   udf.values(row) -> [{ label, value }]              // for print / export
// =============================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const storeKey = k => `udf_cols_${k}`;
const readStore = k => { try { return JSON.parse(localStorage.getItem(storeKey(k)) || '[]'); } catch { return []; } };

export function useUdfColumns(reportKey, docTypes = []) {
    const { authFetch } = useAuth();
    const [fields, setFields] = useState([]);
    const [selected, setSelected] = useState(() => readStore(reportKey));
    const [map, setMap] = useState({ docs: {}, lines: {} });
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const typesKey = docTypes.join(',');
    const lastLoad = useRef(null);

    useEffect(() => {
        if (!typesKey) return;
        authFetch(`/api/udf-values/fields?doc_types=${encodeURIComponent(typesKey)}`).then(r => setFields(r.data || [])).catch(() => setFields([]));
    }, [authFetch, typesKey]);
    useEffect(() => { try { localStorage.setItem(storeKey(reportKey), JSON.stringify(selected)); } catch { /* ignore */ } }, [reportKey, selected]);
    useEffect(() => {
        if (!open) return undefined;
        const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    // Same label on several document types (e.g. "Vehicle" on Bill and GDN) = one column.
    const columns = useMemo(() => {
        const byLabel = new Map();
        fields.filter(f => selected.includes(f.id)).forEach(f => {
            const k = `${f.section}|${f.field_label.trim().toLowerCase()}`;
            if (!byLabel.has(k)) byLabel.set(k, { key: k, label: f.field_label, section: f.section, ids: [] });
            byLabel.get(k).ids.push(f.id);
        });
        return [...byLabel.values()];
    }, [fields, selected]);

    const fetchValues = useCallback(async (docIds, fieldIds) => {
        if (!docIds.length || !fieldIds.length) { setMap({ docs: {}, lines: {} }); return; }
        try {
            const r = await authFetch('/api/udf-values/lookup', { method: 'POST', body: JSON.stringify({ document_ids: docIds, field_ids: fieldIds }) });
            setMap(r.data || { docs: {}, lines: {} });
        } catch { setMap({ docs: {}, lines: {} }); }
    }, [authFetch]);

    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    const load = useCallback((rows, keys = { doc: 'doc_id' }) => {
        const ids = [...new Set((rows || []).map(r => r && r[keys.doc || 'doc_id']).filter(Boolean))];
        lastLoad.current = ids;
        fetchValues(ids, selectedRef.current);
    }, [fetchValues]);
    // re-fetch when the choice changes
    useEffect(() => { if (lastLoad.current) fetchValues(lastLoad.current, selected); }, [selected, fetchValues]);

    const valueOf = useCallback((row, col, keys = {}) => {
        const docId = row[keys.doc || 'doc_id'], lineId = row[keys.line || 'line_id'];
        for (const id of col.ids) {
            const v = col.section === 'detail' ? map.lines[lineId]?.[id] : map.docs[docId]?.[id];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return '';
    }, [map]);

    const headers = (className = 'p-2 text-left') => columns.map(c => <th key={c.key} className={className}>{c.label}</th>);
    const cells = (row, keys, className = 'p-2') => columns.map(c => <td key={c.key} className={className}>{row ? valueOf(row, c, keys) : ''}</td>);
    const values = (row, keys) => columns.map(c => ({ label: c.label, value: valueOf(row, c, keys) }));
    const toggle = id => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

    const picker = !fields.length ? null : (
        <div className="relative inline-block" ref={ref}>
            <button type="button" onClick={() => setOpen(o => !o)} className="px-3 py-1.5 text-sm border rounded bg-white hover:bg-gray-50">
                Custom fields{selected.length ? ` (${columns.length})` : ''} ▾
            </button>
            {open && (
                <div className="absolute z-30 mt-1 w-72 max-h-80 overflow-auto bg-white border rounded shadow-lg p-2 text-sm">
                    <div className="text-xs text-gray-500 mb-1">Show these User Defined Fields as columns</div>
                    {fields.map(f => (
                        <label key={f.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
                            <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggle(f.id)} />
                            <span>{f.field_label}</span>
                            <span className="text-xs text-gray-400 ml-auto">{f.voucher_type}{f.section === 'detail' ? ' · line' : ''}</span>
                        </label>
                    ))}
                    {selected.length > 0 && <button type="button" className="text-xs text-red-600 mt-1" onClick={() => setSelected([])}>Clear</button>}
                </div>
            )}
        </div>
    );

    return { fields, columns, selected, setSelected, picker, load, headers, cells, values, valueOf, count: columns.length };
}

export default useUdfColumns;
