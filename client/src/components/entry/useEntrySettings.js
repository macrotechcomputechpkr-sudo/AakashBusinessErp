// =============================================
// components/entry/useEntrySettings.js
// System Control switches every sales / purchase entry reads, fetched once
// per company: multi-warehouse, product search by name or code, term
// mapping (VAT / Excise / Product Discount 1-5 / Bill Discount), which
// entries show product terms in a popup instead of inline columns, and the
// billing terms themselves.
// =============================================
import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

let cache = null;
let pending = null;
export const clearEntrySettings = () => { cache = null; pending = null; };

const TERM_KEYS = [['disc1', 'Disc 1'], ['disc2', 'Disc 2'], ['disc3', 'Disc 3'], ['disc4', 'Disc 4'], ['disc5', 'Disc 5'], ['excise', 'Excise'], ['vat', 'VAT']];

export default function useEntrySettings() {
    const { authFetch, tenant } = useAuth();
    const key = tenant?.id || 'x';
    const [data, setData] = useState(cache && cache.key === key ? cache.data : null);
    useEffect(() => {
        let live = true;
        if (cache && cache.key === key) { setData(cache.data); return undefined; }
        if (!pending) {
            pending = Promise.all([
                authFetch('/api/system-control').then(r => r.data || {}).catch(() => ({})),
                authFetch('/api/billing-terms').then(r => r.data || []).catch(() => [])
            ]).then(([sc, terms]) => {
                const d = {
                    multiWarehouse: !!sc.multi_warehouse,
                    searchBy: sc.product_search_by === 'code' ? 'code' : 'name',
                    barcode: !!sc.enable_barcode_system,
                    popupTerms: sc.popup_product_wise_term_applicability || [],
                    termMapping: sc.term_mapping || {},
                    billingTerms: terms,
                    raw: sc
                };
                cache = { key, data: d };
                return d;
            }).finally(() => { pending = null; });
        }
        pending.then(d => { if (live) setData(d); });
        return () => { live = false; };
    }, [authFetch, key]);
    return data;
}

/**
 * inline term columns of one side ('sales' | 'purchase'): the mapped terms,
 * in order Disc 1-5, Excise, VAT, each with its default % from the term
 */
export function termColumns(settings, side) {
    const map = settings?.termMapping?.[side] || {};
    return TERM_KEYS.filter(([k]) => map[k]).map(([k, label]) => {
        const t = (settings.billingTerms || []).find(x => x.id === map[k]);
        return { key: k, label: t ? t.term_name : label, term_id: map[k], default_percent: Number(t?.rate_percentage) || 0, kind: k === 'vat' ? 'vat' : k === 'excise' ? 'excise' : 'discount' };
    });
}
