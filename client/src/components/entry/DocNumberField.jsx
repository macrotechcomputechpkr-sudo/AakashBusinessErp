// =============================================
// components/entry/DocNumberField.jsx
// "Voucher No." of an entry: a new entry shows the number it will get from
// Document Numbering (read-only; the chosen, default, or else first active
// series of the voucher type); a Manual series lets the user type it;
// a saved entry shows its own number.
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

export default function DocNumberField({ voucherType, categoryId, docNo, value, onChange, label = 'Voucher No.' }) {
    const { authFetch } = useAuth();
    const [next, setNext] = useState(null);
    useEffect(() => {
        if (docNo) return undefined;
        let live = true;
        const q = new URLSearchParams({ voucher_type: voucherType, ...(categoryId ? { category_id: categoryId } : {}) });
        authFetch(`/api/document-numbering/next?${q}`).then(r => { if (live) setNext(r.data); }).catch(() => { if (live) setNext(null); });
        return () => { live = false; };
    }, [authFetch, voucherType, categoryId, docNo]);
    const manual = !docNo && next?.mode === 'manual';
    return (
        <div className="erp-field">
            <label className="erp-label">{label} {manual ? <span className="req">*</span> : <span className="hint">(automatic)</span>}</label>
            {manual
                ? <input className="erp-input" value={value || ''} onChange={e => onChange && onChange(e.target.value)} placeholder="Type the number" />
                : <input className="erp-input nav-input code" readOnly tabIndex={-1} value={docNo || next?.number || (next?.mode === 'system' ? 'System series - given on save' : '…')} />}
        </div>
    );
}
