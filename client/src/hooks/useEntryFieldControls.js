// =============================================
// useEntryFieldControls.js
// Entry Field Control for any voucher screen. The server resolves the
// mode per field for the LOGGED-IN user (User > User Group > Global), so
// no user/group needs to be sent from here.
//   isVisible(key, section)  - false when the field is 'disabled' (hidden)
//   isRequired(key, section) - 'compulsory'
//   isReadonly(key, section) - 'readonly'
//   missingRequired(form)    - labels of compulsory fields left empty,
//                              master fields and each product line; covers
//                              popup pickers, which HTML `required` cannot.
// section: 'master' (header) or 'detail' (line items).
// =============================================
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const empty = v => v === undefined || v === null || String(v).trim() === '';
// Line items live under different names per screen; a line is "real" once it
// has its main pick (a product, or a ledger for voucher/ledger lines).
const LINE_ARRAYS = ['details', 'lines', 'expense_lines', 'raw_materials'];
const lineArrayOf = form => { for (const k of LINE_ARRAYS) if (Array.isArray(form[k])) return form[k]; return []; };
const isRealLine = d => !!(d && (d.product_id || d.ledger_id || d.income_ledger_id || d.expense_ledger_id));

// renderedKeys (optional): master fields this screen really shows. A field the
// screen doesn't render can't be filled in, so it never blocks saving.
export function useEntryFieldControls(voucherType, renderedKeys = null) {
    const { authFetch } = useAuth();
    const [fields, setFields] = useState([]);

    useEffect(() => {
        let alive = true;
        if (!voucherType) return undefined;
        authFetch(`/api/entry-field-controls/resolve?voucher_type=${voucherType}`)
            .then(res => { if (alive) setFields(res.data || []); })
            .catch(() => { if (alive) setFields([]); });
        return () => { alive = false; };
    }, [authFetch, voucherType]);

    const modeOf = useCallback((key, section = 'master') => {
        const f = fields.find(x => x.field_key === key && x.section === section);
        return f ? f.effective_mode : 'enabled';
    }, [fields]);

    const isVisible = useCallback((key, section = 'master') => modeOf(key, section) !== 'disabled', [modeOf]);
    const isRequired = useCallback((key, section = 'master') => modeOf(key, section) === 'compulsory', [modeOf]);
    const isReadonly = useCallback((key, section = 'master') => modeOf(key, section) === 'readonly', [modeOf]);

    const missingRequired = useCallback((form) => {
        const missing = [];
        fields.filter(f => f.effective_mode === 'compulsory').forEach(f => {
            if (f.section === 'master') {
                if (renderedKeys && !renderedKeys.includes(f.field_key)) return;
                if (empty(form[f.field_key])) missing.push(f.field_label || f.field_key);
            } else {
                lineArrayOf(form).forEach((d, i) => {
                    if (isRealLine(d) && empty(d[f.field_key])) missing.push(`${f.field_label || f.field_key} (line ${i + 1})`);
                });
            }
        });
        return missing;
    }, [fields, renderedKeys]);

    return { isVisible, isRequired, isReadonly, missingRequired, fields };
}
