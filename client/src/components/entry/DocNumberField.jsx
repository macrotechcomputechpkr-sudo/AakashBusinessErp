// =============================================
// components/entry/DocNumberField.jsx
// "Voucher No." of an entry: a new entry shows the number it will get from
// Document Numbering (read-only; the chosen, default, or else first active
// series of the voucher type); a Manual series lets the user type it;
// a saved entry shows its own number. Datewise / monthwise series follow the entry date.
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

export default function DocNumberField({ voucherType, categoryId, docNo, value, onChange, label = 'Voucher No.', docDate }) {
    const { authFetch } = useAuth();
    const [next, setNext] = useState(null);
    useEffect(() => {
        if (docNo) return undefined;
        let live = true;
        // the entry date picks the series (applicable dates) and the date part of datewise / monthwise numbers
        const q = new URLSearchParams({ voucher_type: voucherType, ...(categoryId ? { category_id: categoryId } : {}), ...(docDate ? { doc_date: String(docDate).slice(0, 10) } : {}) });
        authFetch(`/api/document-numbering/next?${q}`).then(r => { if (live) setNext(r.data); }).catch(() => { if (live) setNext(null); });
        return () => { live = false; };
    }, [authFetch, voucherType, categoryId, docNo, docDate]);
    const manual = !docNo && next?.mode === 'manual';
    return (
        <div className="erp-field">
            <label className="erp-label">{label} {manual ? <span className="req">*</span> : <span className="hint">(automatic)</span>}</label>
            {manual
                ? <input className="erp-input" value={value || ''} inputMode={next?.numeric ? 'numeric' : undefined}
                    onChange={e => onChange && onChange(next?.numeric ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)} placeholder={next?.numeric ? 'Type the number (digits)' : 'Type the number'} />
                : <input className="erp-input nav-input code" readOnly tabIndex={-1} value={docNo || next?.number || (next?.mode === 'system' ? 'System series - given on save' : next?.mode === 'invalid' ? next.error : '…')} title={next?.error || ''} />}
        </div>
    );
}
