// =============================================
// components/entry/PendingDocsPanel.jsx
// Header part of a sales / purchase entry: the earlier documents that still
// have qty left - only the types switched on in Entry Field Control
// (ref_<type>):
//   Order <- Quotation; Challan / GRN <- Quotation + Order;
//   Bill <- Quotation + Order + Challan (sales) / GRN (purchase)
// With a party chosen: that party's documents. Without one: search by
// document no. (or party) - pulling fills the party too. Tick one or many,
// view any of them, then "Pull" brings their pending lines (with the link
// back) into the entry.
// Server: /api/pending-documents (utils/pendingDocs.js).
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const SOURCES = {
    sales_order: ['sales_quotation'], sales_delivery: ['sales_quotation', 'sales_order'], sales_bill: ['sales_quotation', 'sales_order', 'sales_delivery'],
    sales_return: ['sales_bill'], purchase_quotation: ['purchase_requisition'], purchase_order: ['purchase_requisition', 'purchase_quotation'],
    purchase_grn: ['purchase_quotation', 'purchase_order'], purchase_bill: ['purchase_quotation', 'purchase_order', 'purchase_grn'], purchase_return: ['purchase_bill']
};
const LABEL = { sales_quotation: 'Quotation', sales_order: 'Order', sales_delivery: 'Challan', sales_bill: 'Bill', purchase_requisition: 'Requisition', purchase_quotation: 'Quotation', purchase_order: 'Order', purchase_grn: 'GRN', purchase_bill: 'Bill' };
const money = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * <PendingDocsPanel target="sales_bill" partyId={form.customer_ledger_id} efc={efc} disabled={!!editingId}
 *     onPull={({ lines, header, documents }) => ...} />
 */
export default function PendingDocsPanel({ target, partyId, efc, onPull, disabled, pulled = [] }) {
    const { authFetch } = useAuth();
    const types = (SOURCES[target] || []).filter(t => !efc || efc.isVisible(`ref_${t}`));
    const [docs, setDocs] = useState([]);
    const [ticked, setTicked] = useState({});
    const [viewing, setViewing] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [q, setQ] = useState('');
    const typesKey = types.join(',');

    const load = useCallback(async () => {
        setErr('');
        // no party yet: only when a document no. / party is typed to search for
        if (!typesKey || disabled || (!partyId && q.trim().length < 1)) { setDocs([]); return; }
        const qs = `target=${target}&types=${typesKey}${partyId ? `&party_id=${partyId}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;
        try { setDocs((await authFetch(`/api/pending-documents?${qs}`)).data || []); }
        catch (e) { setErr(e.message); setDocs([]); }
    }, [authFetch, target, partyId, typesKey, disabled, q]);
    useEffect(() => { const h = setTimeout(load, q ? 300 : 0); return () => clearTimeout(h); }, [load, q]);
    useEffect(() => { setTicked({}); }, [partyId, typesKey]);

    if (!types.length || disabled) return null;
    const keyOf = d => `${d.type}:${d.id}`;
    const chosen = docs.filter(d => ticked[keyOf(d)]);
    const view = async d => {
        try { setViewing((await authFetch(`/api/pending-documents/${d.type}/${d.id}?target=${target}`)).data); } catch (e) { setErr(e.message); }
    };
    const pull = async () => {
        if (!chosen.length) return;
        setBusy(true); setErr('');
        try {
            const r = await authFetch('/api/pending-documents/pull', { method: 'POST', body: JSON.stringify({ target, docs: chosen.map(d => ({ type: d.type, id: d.id })) }) });
            onPull(r.data);
            setTicked({});
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };

    return (
        <div className="nav-groupbox" style={{ margin: '14px 10px 6px' }}>
            <span className="nav-groupbox-title">Pull from {types.map(t => LABEL[t]).join(' / ')}{partyId ? ' of this party' : ''}</span>
            {err && <div className="nav-msg err">{err}</div>}
            <div className="flex items-center gap-2 mb-1" data-enter-nav="off">
                <label className="text-xs text-gray-600 whitespace-nowrap">Doc No.</label>
                <input className="erp-input" style={{ maxWidth: 260 }} placeholder={partyId ? 'Filter by number…' : 'Type a number (or party) to find it…'} value={q} onChange={e => setQ(e.target.value)} />
            </div>
            {docs.length === 0 ? <p className="text-xs text-gray-600">{partyId ? 'Nothing pending for this party.' : q ? 'No pending document with this number.' : 'Choose the party, or type a document number.'}</p> : (
                <>
                    <div className="overflow-x-auto max-h-48 overflow-y-auto">
                        <table className="erp-grid-table" data-no-excel>
                            <thead><tr><th style={{ width: 30 }}><input type="checkbox" checked={chosen.length === docs.length} onChange={e => setTicked(e.target.checked ? Object.fromEntries(docs.map(d => [keyOf(d), true])) : {})} /></th>
                                <th>Type</th><th>Doc No</th><th>Date</th>{!partyId && <th>Party</th>}<th className="text-right">Lines pending</th><th className="text-right">Pending value</th><th className="text-right">Doc total</th><th /></tr></thead>
                            <tbody>{docs.map(d => (
                                <tr key={keyOf(d)} className={pulled.includes(d.id) ? 'text-gray-400' : ''}>
                                    <td><input type="checkbox" checked={!!ticked[keyOf(d)]} onChange={e => setTicked(t => ({ ...t, [keyOf(d)]: e.target.checked }))} /></td>
                                    <td>{d.type_label}</td><td className="font-mono">{d.doc_no}</td><td>{String(d.doc_date || '').slice(0, 10)}</td>{!partyId && <td>{d.party_name || ''}</td>}
                                    <td className="text-right">{d.pending_lines}</td><td className="text-right">{money(d.pending_value)}</td><td className="text-right">{money(d.total_amount)}</td>
                                    <td><button type="button" className="nav-btn small" onClick={() => view(d)}>👁 View</button></td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        <button type="button" className="nav-btn primary small" disabled={!chosen.length || busy} onClick={pull}>⬇ Pull {chosen.length || ''} selected</button>
                        <span className="text-xs text-gray-600">Pulled lines replace the empty lines of the entry; qty can be reduced before saving.</span>
                    </div>
                </>
            )}
            {viewing && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setViewing(null)}>
                    <div className="nav-window w-full max-w-3xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="erp-header"><span className="erp-header-title">👁 {viewing.type_label} {viewing.doc_no} · {String(viewing.doc_date || '').slice(0, 10)}</span></div>
                        <div className="nav-content">
                            <table className="erp-grid-table">
                                <thead><tr><th>#</th><th>Product</th><th className="text-right">Qty</th><th className="text-right">Pending</th><th>Unit</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th>Batch</th></tr></thead>
                                <tbody>{viewing.lines.map((l, i) => (
                                    <tr key={l.id} className={l.pending_qty > 0 ? '' : 'text-gray-400'}>
                                        <td>{i + 1}</td><td>{l.product_name_snapshot || l.product_id}</td><td className="text-right">{l.qty}</td><td className="text-right font-semibold">{l.pending_qty}</td>
                                        <td>{l.uom_name_snapshot || ''}</td><td className="text-right">{money(l.rate)}</td><td className="text-right">{money(l.amount)}</td><td>{l.batch_no || ''}</td>
                                    </tr>
                                ))}</tbody>
                            </table>
                            {viewing.narration && <p className="text-xs text-gray-600 mt-2">Narration: {viewing.narration}</p>}
                        </div>
                        <div className="erp-bottombar"><div /><div className="erp-bottombar-actions">
                            <button type="button" className="nav-btn" onClick={() => { setTicked(t => ({ ...t, [`${viewing.type}:${viewing.id}`]: true })); setViewing(null); }}>☑ Tick this</button>
                            <button type="button" className="nav-btn" onClick={() => setViewing(null)}>Close</button>
                        </div></div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** merge pulled lines into the entry: empty lines are dropped, pulled ones appended */
export function mergePulled(form, pulledData, emptyRow, isEmpty = d => !d.product_id) {
    const kept = (form.details || []).filter(d => !isEmpty(d));
    const lines = pulledData.lines.map(l => ({ ...emptyRow(), ...l }));
    const header = {};
    // only fields this entry has (the rest would not be saved)
    Object.entries(pulledData.header || {}).forEach(([k, v]) => { if (k in form && !form[k]) header[k] = v; });
    return { ...form, ...header, details: [...kept, ...lines].length ? [...kept, ...lines] : [emptyRow()] };
}
