// =============================================
// components/entry/RateTypeField.jsx
// Rate Type (Sr1-Sr5 captions from Multiple Rate Types) in the master part
// of a sales entry. It fills itself with the customer's rate type (its Rate
// Category's tier) when the customer is chosen; the user may pick another
// one - the entry then says the rate type differs from the customer's and
// the lines are priced again at the chosen type
// (server: /api/customer-rate-type, /api/resolve-sales-price?sr_tier=).
// =============================================
import React, { useEffect, useState } from 'react';

/** rt.srTier: the tier to send with a price lookup (only when it differs from the customer's) */
export function useEntryRateType(authFetch, customerId) {
    const [info, setInfo] = useState({ types: [], tier: '', customerTier: '', category: null });
    useEffect(() => {
        let live = true;
        authFetch(`/api/customer-rate-type${customerId ? `?customer_ledger_id=${customerId}` : ''}`)
            .then(r => { if (live) setInfo({ types: (r.data.rate_types || []).filter(x => x.enabled), tier: r.data.sr_tier, customerTier: r.data.sr_tier, category: r.data.rate_category }); })
            .catch(() => undefined);
        return () => { live = false; };
    }, [authFetch, customerId]);
    const captionOf = tier => (info.types.find(x => x.sr === Number(tier)) || {}).caption || `Sr${tier}`;
    return {
        ...info, captionOf,
        setTier: tier => setInfo(i => ({ ...i, tier: Number(tier) })),
        srTier: info.tier && info.tier !== info.customerTier ? info.tier : undefined,
        differs: !!info.tier && info.tier !== info.customerTier
    };
}

/** onChanged(tier) after the user picks another rate type (re-price the lines there) */
export default function RateTypeField({ rt, onChanged, disabled }) {
    if (!rt.types.length) return null;
    return (
        <div className="erp-field">
            <label className="erp-label">Rate Type {rt.differs && <span className="hint" style={{ color: '#a92a1a' }}>(customer: {rt.captionOf(rt.customerTier)})</span>}</label>
            <select className="erp-select" disabled={disabled} value={rt.tier || ''}
                onChange={e => { const t = Number(e.target.value); rt.setTier(t); onChanged && onChanged(t); }}>
                {rt.types.map(x => <option key={x.sr} value={x.sr}>{x.caption}{x.sr === rt.customerTier ? ' (customer)' : ''}</option>)}
            </select>
        </div>
    );
}
