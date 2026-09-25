// =============================================
// useLedgerPurposes.js
// Filters a page's ledger list down to the ledgers allowed for a job
// (sales / purchase goods account, inventory, COGS, discount, customer,
// supplier, expense, VAT) - by the ledger's group: Profit & Loss or
// Balance Sheet (server/utils/ledgerPurpose.js). The server checks the
// same rule again on save.
//   const lp = useLedgerPurposes();
//   items={lp.filter(ledgers, 'purchase_goods', form.goods_account_ledger_id)}
// The currently chosen ledger is always kept in the list so an old
// document still shows its value. Until the map loads, nothing is hidden.
// =============================================
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

let cache = null;
export default function useLedgerPurposes() {
    const { authFetch } = useAuth();
    const [map, setMap] = useState(cache);
    useEffect(() => {
        if (cache) return;
        authFetch('/api/ledger-purposes').then(r => {
            cache = { byId: Object.fromEntries((r.data?.ledgers || []).map(l => [l.id, l])), purposes: r.data?.purposes || {} };
            setMap(cache);
        }).catch(() => {});
    }, [authFetch]);
    const can = (id, purpose) => !map || !map.byId[id] || map.byId[id].purposes.includes(purpose);
    return {
        ready: !!map,
        can,
        info: id => (map ? map.byId[id] : null),
        need: purpose => map?.purposes[purpose]?.need || '',
        filter: (ledgers, purpose, keepId) => (ledgers || []).filter(l => l.id === keepId || can(l.id, purpose))
    };
}
