// =============================================
// components/BillWiseSettlementPanel.jsx
// "Vendor Master ma Bill to Bill enable xa ra balance Dr/Cr xa vane,
// FIFO method ma kun doc ma kati balance xa kati adjust garne milaune"
// - shows the FIFO-suggested settlement against outstanding opposite-
// nature references, editable before saving. Shared by Purchase Bill
// (outstandingNature='dr', settling outstanding Dr) and Purchase Return
// (outstandingNature='cr', settling outstanding Cr/Bills).
// =============================================

import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

// productCompanyId: when Product Company is compulsory, only that company's
// bills are offered for bill-to-bill settlement (server filters the same way).
export default function BillWiseSettlementPanel({ ledgerId, outstandingNature, amount, onSettlementsChange, productCompanyId }) {
    const { authFetch } = useAuth();
    const [enabled, setEnabled] = useState(false);
    const [allocations, setAllocations] = useState([]);
    const [unallocated, setUnallocated] = useState(0);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!ledgerId || !amount || Number(amount) <= 0) {
            setEnabled(false);
            setAllocations([]);
            onSettlementsChange && onSettlementsChange(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        authFetch(`/api/bill-wise-settlement-preview?ledger_id=${ledgerId}&nature=${outstandingNature}&amount=${amount}${productCompanyId ? `&product_company_id=${productCompanyId}` : ''}`)
            .then(res => {
                if (cancelled) return;
                setEnabled(res.data.enabled);
                setAllocations(res.data.allocations || []);
                setUnallocated(res.data.unallocated ?? Number(amount));
                onSettlementsChange && onSettlementsChange(res.data.enabled ? (res.data.allocations || []) : null);
            })
            .catch(() => { if (!cancelled) setEnabled(false); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ledgerId, outstandingNature, amount, productCompanyId]);

    const updateAllocation = (idx, newAmount) => {
        const next = allocations.map((a, i) => i === idx ? { ...a, settled_amount: newAmount } : a);
        setAllocations(next);
        const usedTotal = next.reduce((s, a) => s + (Number(a.settled_amount) || 0), 0);
        setUnallocated(Math.round((Number(amount) - usedTotal) * 100) / 100);
        onSettlementsChange && onSettlementsChange(next.filter(a => Number(a.settled_amount) > 0));
    };

    if (loading) return <p className="text-xs text-gray-400 mt-2">Checking outstanding balance…</p>;
    if (!enabled || allocations.length === 0) return null;

    const natureLabel = outstandingNature === 'dr' ? 'Debit (advance/overpayment)' : 'Credit (outstanding Bills)';

    return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
            <p className="text-sm font-medium text-amber-800 mb-2">
                🔗 Bill-wise Settlement — this vendor has an outstanding {natureLabel} balance. FIFO suggestion below (oldest first) - edit amounts if needed.
            </p>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase">
                        <th className="py-1">Voucher</th>
                        <th className="py-1">Date</th>
                        <th className="py-1 text-right">Settle Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {allocations.map((a, idx) => (
                        <tr key={a.against_reference_id} className="border-t border-amber-100">
                            <td className="py-1.5">{a.source_doc_no}</td>
                            <td className="py-1.5 text-gray-500">{a.source_date}</td>
                            <td className="py-1.5 text-right">
                                <input
                                    type="number" step="0.01"
                                    className="w-28 border rounded px-2 py-1 text-right"
                                    value={a.settled_amount}
                                    onChange={e => updateAllocation(idx, e.target.value)}
                                />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="text-xs text-gray-500 mt-2">
                {unallocated > 0
                    ? `Remaining ${unallocated.toFixed(2)} will become a new outstanding reference for this document.`
                    : 'Fully settled against existing outstanding - no new reference will be created.'}
            </p>
        </div>
    );
}
