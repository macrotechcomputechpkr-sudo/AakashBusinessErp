// =============================================
// UdfValuesModal.jsx
// Enter / edit the User Defined Field values of one document: master
// fields once, detail fields per line. Beside every master field it shows
// the value used on the previous transaction (same customer / vendor
// first) with "Use", suggestions of values used before, and the list of
// earlier transactions with their values - so the next transaction can
// copy what was entered before.
//   <UdfValuesModal docType="sales_bill" docId={row.id} onClose={...} />
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const inputType = t => (t === 'date' ? 'date' : t === 'time' ? 'time' : t === 'number' ? 'number' : 'text');

function FieldInput({ field, value, onChange, options, suggestions }) {
    if (field.field_type === 'boolean') {
        return (
            <select className="erp-select" value={value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''} onChange={e => onChange(e.target.value === '' ? '' : e.target.value === 'true')}>
                <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
            </select>
        );
    }
    if (field.field_type === 'table_reference') {
        return (
            <select className="erp-select" value={value || ''} onChange={e => onChange(e.target.value)}>
                <option value="">—</option>
                {(options || []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
        );
    }
    const listId = `udf-sugg-${field.id}`;
    return (
        <>
            <input className="erp-input" type={inputType(field.field_type)} value={value ?? ''} onChange={e => onChange(e.target.value)} list={suggestions?.length ? listId : undefined} />
            {suggestions?.length > 0 && <datalist id={listId}>{suggestions.map((s, i) => <option key={i} value={s.value ?? s.display} />)}</datalist>}
        </>
    );
}

export default function UdfValuesModal({ docType, docId, onClose, onSaved }) {
    const { authFetch } = useAuth();
    const [data, setData] = useState(null);
    const [master, setMaster] = useState({});
    const [detail, setDetail] = useState({});
    const [options, setOptions] = useState({});
    const [history, setHistory] = useState(null);
    const [histTab, setHistTab] = useState('same');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`/api/udf-values/${docType}/${docId}`);
            const d = res.data;
            setData(d);
            setMaster(Object.fromEntries(Object.entries(d.values.master).map(([k, v]) => [k, v.value])));
            setDetail(Object.fromEntries(Object.entries(d.values.detail).map(([lid, row]) => [lid, Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value]))])));
            const refs = [...d.fields.master, ...d.fields.detail].filter(f => f.field_type === 'table_reference');
            const opts = {};
            await Promise.all(refs.map(async f => { try { opts[f.id] = (await authFetch(`/api/user-defined-fields/${f.id}/options`)).data || []; } catch { opts[f.id] = []; } }));
            setOptions(opts);
            const qs = new URLSearchParams({ exclude_id: docId, limit: '10', ...(d.doc.party_id ? { party_id: d.doc.party_id } : {}) });
            const h = await authFetch(`/api/udf-values/history/${docType}?${qs}`);
            setHistory(h.data);
            if (!d.doc.party_id || !h.data.same_party.length) setHistTab('recent');
        } catch (e) { setError(e.message); }
    }, [authFetch, docType, docId]);
    useEffect(() => { load(); }, [load]);

    const useLastAll = () => {
        if (!history) return;
        const next = { ...master };
        data.fields.master.forEach(f => { const l = history.last[f.id]; if (l && (next[f.id] === undefined || next[f.id] === '' || next[f.id] === null)) next[f.id] = l.value; });
        setMaster(next);
    };
    const copyFrom = doc => setMaster(m => ({ ...m, ...Object.fromEntries(Object.entries(doc.values).map(([k, v]) => [k, v.value])) }));

    const save = async () => {
        setSaving(true); setError('');
        try {
            await authFetch(`/api/udf-values/${docType}/${docId}`, { method: 'PUT', body: JSON.stringify({ master, detail }) });
            onSaved && onSaved();
            onClose();
        } catch (e) { setError(e.message); }
        setSaving(false);
    };

    const fields = data?.fields || { master: [], detail: [] };
    const histRows = history ? (histTab === 'same' ? history.same_party : history.recent) : [];
    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-auto p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div>
                        <div className="font-semibold">Custom Fields (UDF)</div>
                        {data && <div className="text-xs text-gray-500">{data.doc.doc_no} · {String(data.doc.doc_date || '').slice(0, 10)}{data.doc.party_name ? ` · ${data.doc.party_name}` : ''}</div>}
                    </div>
                    <button onClick={onClose} className="text-gray-500 text-xl leading-none">×</button>
                </div>
                <div className="p-4 space-y-4 max-h-[75vh] overflow-auto">
                    {error && <div className="p-2 bg-red-50 text-red-700 text-sm rounded">{error}</div>}
                    {!data && !error && <div className="text-gray-400 text-sm">Loading…</div>}
                    {data && !fields.master.length && !fields.detail.length && (
                        <div className="text-sm text-gray-500">No custom fields are defined for this document type. Add them in User Defined Fields.</div>
                    )}
                    {fields.master.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-sm font-medium">Document fields</div>
                                {history && Object.keys(history.last).length > 0 && (
                                    <button type="button" onClick={useLastAll} className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded">Fill empty fields from previous transaction</button>
                                )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {fields.master.map(f => {
                                    const last = history?.last[f.id];
                                    return (
                                        <div key={f.id} className="erp-field">
                                            <label className="erp-label">{f.field_label}</label>
                                            <FieldInput field={f} value={master[f.id]} onChange={v => setMaster(m => ({ ...m, [f.id]: v }))} options={options[f.id]} suggestions={history?.suggestions[f.id]} />
                                            {last && (
                                                <div className="text-xs text-gray-500 mt-1">
                                                    Previous{last.same_party ? ' (same party)' : ''}: <b>{last.display}</b> <span className="text-gray-400">({last.doc_no}, {last.doc_date})</span>
                                                    <button type="button" className="ml-2 text-indigo-600 underline" onClick={() => setMaster(m => ({ ...m, [f.id]: last.value }))}>Use</button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {fields.detail.length > 0 && (
                        <div>
                            <div className="text-sm font-medium mb-2">Line fields</div>
                            <div className="overflow-auto">
                                <table className="w-full text-sm border">
                                    <thead className="bg-gray-50"><tr><th className="p-1 border text-left">#</th><th className="p-1 border text-left">Item</th><th className="p-1 border text-right">Qty</th>
                                        {fields.detail.map(f => <th key={f.id} className="p-1 border text-left">{f.field_label}</th>)}</tr></thead>
                                    <tbody>
                                        {data.lines.map(l => (
                                            <tr key={l.id}>
                                                <td className="p-1 border">{l.sn}</td><td className="p-1 border">{l.label}</td><td className="p-1 border text-right">{l.qty ?? ''}</td>
                                                {fields.detail.map(f => (
                                                    <td key={f.id} className="p-1 border min-w-[140px]">
                                                        <FieldInput field={f} value={detail[l.id]?.[f.id]} options={options[f.id]}
                                                            onChange={v => setDetail(d => ({ ...d, [l.id]: { ...(d[l.id] || {}), [f.id]: v } }))} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {history && fields.master.length > 0 && (history.same_party.length > 0 || history.recent.length > 0) && (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="text-sm font-medium">Previous transactions</div>
                                {history.party_id && <button type="button" onClick={() => setHistTab('same')} className={`text-xs px-2 py-0.5 rounded ${histTab === 'same' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Same party ({history.same_party.length})</button>}
                                <button type="button" onClick={() => setHistTab('recent')} className={`text-xs px-2 py-0.5 rounded ${histTab === 'recent' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>All recent ({history.recent.length})</button>
                            </div>
                            <div className="overflow-auto">
                                <table className="w-full text-xs border">
                                    <thead className="bg-gray-50"><tr><th className="p-1 border text-left">Doc No</th><th className="p-1 border text-left">Date</th><th className="p-1 border text-left">Party</th>
                                        {fields.master.map(f => <th key={f.id} className="p-1 border text-left">{f.field_label}</th>)}<th className="p-1 border" /></tr></thead>
                                    <tbody>
                                        {histRows.map(d => (
                                            <tr key={d.doc_id}>
                                                <td className="p-1 border">{d.doc_no}</td><td className="p-1 border">{d.doc_date}</td><td className="p-1 border">{d.party_name}</td>
                                                {fields.master.map(f => <td key={f.id} className="p-1 border">{d.values[f.id]?.display ?? ''}</td>)}
                                                <td className="p-1 border"><button type="button" className="text-indigo-600 underline" onClick={() => copyFrom(d)}>Copy</button></td>
                                            </tr>
                                        ))}
                                        {!histRows.length && <tr><td className="p-2 text-gray-400" colSpan={fields.master.length + 4}>Nothing saved yet.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex justify-end gap-2 px-4 py-3 border-t">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded">Close</button>
                    {data && (fields.master.length > 0 || fields.detail.length > 0) && (
                        <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                    )}
                </div>
            </div>
        </div>
    );
}
