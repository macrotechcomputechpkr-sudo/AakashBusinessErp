// =============================================
// components/entry/PostingView.jsx
// Account Posting (JV) of a saved transaction: every ledger batch the
// document posted (server: entryHelperRoutes GET /document-posting/:id),
// Dr / Cr per ledger + sub-ledger with totals. Opened from the "JV"
// button of every transaction list (DocActions) or embedded in a tab.
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { EntryPopup } from './EntryParts';

const f2 = n => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PostingTable({ docId, status }) {
    const { authFetch } = useAuth();
    const [data, setData] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        if (!docId) return undefined;
        let live = true;
        setData(null); setErr('');
        authFetch(`/api/document-posting/${docId}`).then(r => { if (live) setData(r.data || { batches: [] }); }).catch(e => { if (live) setErr(e.message); });
        return () => { live = false; };
    }, [authFetch, docId]);
    if (!docId) return <p className="text-sm text-gray-500 p-2">Save / post the entry - its ledger entry (JV) shows here.</p>;
    if (err) return <p className="text-sm text-red-700 p-2">{err}</p>;
    if (!data) return <p className="text-sm text-gray-500 p-2">Loading…</p>;
    if (!data.batches.length) return <p className="text-sm text-gray-500 p-2">{status === 'draft' ? 'A draft has no ledger entry - post it first.' : status === 'cancelled' ? 'Cancelled - its ledger entry was reversed.' : 'No ledger entry for this document (stock-only, or account posting off).'}</p>;
    return (
        <div className="space-y-2">
            {data.batches.map(b => {
                const ok = Math.abs(b.debit - b.credit) < 0.01;
                return (
                    <div key={b.id}>
                        <div className="text-xs text-gray-600 mb-0.5">{String(b.batch_date || '').slice(0, 10)} · {b.narration || b.document_type}</div>
                        <table data-no-smart className="erp-grid-table">
                            <thead><tr><th>Ledger</th><th>Sub-Ledger</th><th>Narration</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
                            <tbody>
                                {b.lines.map((x, i) => (
                                    <tr key={i}><td className={x.credit ? 'pl-6' : ''}>{x.ledger_code ? <span className="text-gray-500 text-xs mr-1">{x.ledger_code}</span> : null}{x.ledger_name}</td><td>{x.sub_ledger_name}</td>
                                        <td className="text-xs text-gray-600">{x.narration}</td><td className="text-right">{x.debit ? f2(x.debit) : ''}</td><td className="text-right">{x.credit ? f2(x.credit) : ''}</td></tr>
                                ))}
                            </tbody>
                            <tfoot><tr className="font-bold bg-gray-100"><td colSpan={3}>Total <span className={`text-xs ml-2 ${ok ? 'text-green-700' : 'text-red-700'}`}>{ok ? '✓ Dr = Cr' : '✗ Dr ≠ Cr'}</span></td><td className="text-right">{f2(b.debit)}</td><td className="text-right">{f2(b.credit)}</td></tr></tfoot>
                        </table>
                    </div>
                );
            })}
        </div>
    );
}

export default function PostingView({ docId, docNo, status, onClose }) {
    return (
        <EntryPopup title={`Account Posting (JV)${docNo ? ` - ${docNo}` : ''}`} onClose={onClose} width={900}>
            <PostingTable docId={docId} status={status} />
        </EntryPopup>
    );
}
