// =============================================
// TermLedgerInfo.jsx
// Shown under each billing term in a transaction's term popup:
//   * Ledger      - read-only (comes from the Billing Term master)
//   * Sub-Ledger  - defaults from the master, changeable per transaction,
//                   limited to sub-ledgers of that ledger
// Return documents use the term's Return Ledger / Return Sub-Ledger
// (falling back to the billing ones), exactly like GL posting does.
// =============================================

import React from 'react';

export function termLedgerFor(term, isReturn) {
    if (!term) return { ledgerId: null, ledgerName: null, defaultSubLedgerId: '' };
    if (isReturn && term.return_ledger_id) {
        return { ledgerId: term.return_ledger_id, ledgerName: term.return_ledger?.account_name, defaultSubLedgerId: term.return_sub_ledger_id || '' };
    }
    return {
        ledgerId: term.billing_ledger_id, ledgerName: term.billing_ledger?.account_name,
        defaultSubLedgerId: (isReturn ? (term.return_sub_ledger_id || term.sub_ledger_id) : term.sub_ledger_id) || ''
    };
}

export default function TermLedgerInfo({ term, isReturn = false, subLedgers = [], value, onChange, disabled = false }) {
    const { ledgerId, ledgerName, defaultSubLedgerId } = termLedgerFor(term, isReturn);
    const options = subLedgers.filter(sl => sl.main_ledger_id === ledgerId);
    // undefined = user hasn't touched it -> show the master default
    const current = value === undefined ? defaultSubLedgerId : (value || '');
    const stop = e => e.stopPropagation(); // don't toggle the term checkbox's <label>
    return (
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500 w-full" onClick={stop}>
            <span>Ledger: <b className="text-gray-700">{ledgerName || (ledgerId ? '—' : 'Default VAT / none')}</b></span>
            {ledgerId && (
                <label className="flex items-center gap-1" onClick={stop}>
                    Sub-Ledger:
                    <select className="border rounded px-1 py-0.5 text-xs" value={current} disabled={disabled || options.length === 0}
                        onClick={stop} onChange={e => onChange && onChange(e.target.value)}>
                        <option value="">{options.length ? 'None' : 'No sub-ledgers'}</option>
                        {options.map(sl => <option key={sl.id} value={sl.id}>{sl.sub_ledger_name}</option>)}
                    </select>
                </label>
            )}
        </div>
    );
}
