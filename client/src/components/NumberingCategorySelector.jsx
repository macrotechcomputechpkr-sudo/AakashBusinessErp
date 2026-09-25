// =============================================
// components/NumberingCategorySelector.jsx
// "Transaction Entry maa jada tyo module ko login User, Branch maa jun
// jun DocumentNumbering set gareko xa tyo list show garne ra teskai
// anusar voucher number aaune banaune." Shown at the top of a NEW
// transaction entry (draft or unsaved only - a saved document's number
// is already fixed). Silent when only one category applies (nothing to
// choose), or none exist yet (falls back to the tenant's plain default
// numbering, unchanged).
// =============================================

import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function NumberingCategorySelector({ voucherType, value, onChange, disabled }) {
    const { authFetch } = useAuth();
    const [categories, setCategories] = useState([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`/api/document-numbering-categories/applicable?voucher_type=${voucherType}`);
                if (cancelled) return;
                const data = res.data || [];
                setCategories(data);
                // Auto-select the tenant's default (or the only option) so
                // saving works even if the person never opens this field.
                if (!value && data.length > 0) {
                    const def = data.find(c => c.is_default) || data[0];
                    onChange(def.id);
                }
            } catch {
                if (!cancelled) setCategories([]);
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [voucherType]);

    // Nothing to choose: 0 configured categories (plain default numbering
    // applies) or exactly 1 (already auto-selected above) - stay silent.
    if (!loaded || categories.length <= 1) return null;

    return (
        <div className="erp-field">
            <label className="erp-label">Numbering Series</label>
            <select className="erp-select" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled}>
                {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.category_name}{c.is_default ? ' (Default)' : ''}</option>
                ))}
            </select>
        </div>
    );
}
