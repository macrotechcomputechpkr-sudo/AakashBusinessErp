// =============================================
// components/entry/CurrencyField.jsx
// Currency of an entry and its exchange rate (1 unit = rate in local
// currency). Picking a currency fills the rate from the Currency master;
// the rate can be changed for this entry. Local currency: rate 1, hidden.
// useCurrencies(): the master (cached per company); fxOf(form, list): what
// the term pop-ups and the footer need to show local amounts.
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

let cache = null;
let pending = null;
export const clearCurrencies = () => { cache = null; pending = null; };

export function useCurrencies() {
    const { authFetch, tenant } = useAuth();
    const key = tenant?.id || 'x';
    const [list, setList] = useState(cache && cache.key === key ? cache.list : []);
    useEffect(() => {
        let live = true;
        if (cache && cache.key === key) { setList(cache.list); return undefined; }
        if (!pending) pending = authFetch('/api/currencies').then(r => { cache = { key, list: r.data || [] }; return cache.list; }).catch(() => []).finally(() => { pending = null; });
        pending.then(l => { if (live) setList(l); });
        return () => { live = false; };
    }, [authFetch, key]);
    return list;
}

/** { code, rate, base, foreign } of an entry */
export function fxOf(form, list) {
    const base = (list || []).find(c => c.is_base)?.currency_code || 'NPR';
    const code = form?.currency || base;
    const rate = Number(form?.exchange_rate) > 0 ? Number(form.exchange_rate) : 1;
    return { code, rate, base, foreign: code !== base };
}

export default function CurrencyField({ value, rate, onChange, disabled, label = 'Currency', bare }) {
    const list = useCurrencies();
    const base = list.find(c => c.is_base)?.currency_code || 'NPR';
    const code = value || base;
    const foreign = code !== base;
    const controls = (
            <div className="flex gap-1 items-center">
                <select className="erp-select" style={{ maxWidth: 110 }} disabled={disabled} value={code}
                    onChange={e => { const c = list.find(x => x.currency_code === e.target.value); onChange({ currency: e.target.value, exchange_rate: c && !c.is_base ? Number(c.exchange_rate) || 1 : 1 }); }}>
                    {!list.some(c => c.currency_code === code) && <option value={code}>{code}</option>}
                    {list.map(c => <option key={c.id} value={c.currency_code}>{c.currency_code}{c.symbol ? ` (${c.symbol})` : ''}</option>)}
                </select>
                {foreign && (
                    <>
                        <span className="text-xs text-gray-500 whitespace-nowrap">1 {code} =</span>
                        <input type="number" step="0.0001" min="0" className="erp-input text-right" style={{ maxWidth: 110 }} disabled={disabled} value={rate ?? ''}
                            onChange={e => onChange({ currency: code, exchange_rate: e.target.value })} title="Exchange rate of this entry" />
                        <span className="text-xs text-gray-500">{base}</span>
                    </>
                )}
            </div>
    );
    // bare: only the controls (the screen already has the label)
    if (bare) return controls;
    return (
        <div className="erp-field">
            <label className="erp-label">{label}</label>
            {controls}
        </div>
    );
}
