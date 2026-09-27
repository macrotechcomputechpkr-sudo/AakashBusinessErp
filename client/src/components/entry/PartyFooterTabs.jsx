// =============================================
// components/entry/PartyFooterTabs.jsx
// Footer of a sales / purchase entry, in tabs:
//   * Party Details - billing / shipping address, PAN, phone, e-mail of the
//     customer / supplier, filled from the ledger when the party is chosen,
//     editable for this document, with "also update the ledger master"
//   * any other tabs the screen passes (Accounts: goods account + sub-ledger,
//     Other: remarks / narration ...)
// Party details are saved after the entry itself (savePartyInfo), so every
// entry route keeps working unchanged. Server: routes/entryHelperRoutes.js.
// =============================================
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

export const emptyPartyInfo = () => ({ billing_address: '', shipping_address: '', pan: '', phone: '', email: '', update_master: false, _loadedFor: '' });

/** after the entry is saved: store the party details on it (and on the ledger when asked) */
export async function savePartyInfo(authFetch, docType, docId, info) {
    if (!docId || !info || !info._loadedFor) return null;
    const { _loadedFor, ...body } = info;
    return authFetch(`/api/documents/${docType}/${docId}/party-info`, { method: 'PUT', body: JSON.stringify(body) });
}

/** party details stored on an opened document */
export const partyInfoFromDoc = (doc, partyId) => ({
    billing_address: doc.party_billing_address || '', shipping_address: doc.party_shipping_address || '', pan: doc.party_pan || '',
    phone: doc.party_phone || '', email: doc.party_email || '', update_master: false, _loadedFor: partyId || 'doc'
});

/** the party fields (fills itself from the ledger when the party changes) */
export function PartyDetailsPanel({ partyId, partyLabel = 'Party', info, onChange }) {
    const { authFetch } = useAuth();
    const infoRef = useRef(info);
    infoRef.current = info;
    // fill from the ledger when the party changes (not when an opened document already carries them)
    useEffect(() => {
        if (!partyId || infoRef.current?._loadedFor === partyId || infoRef.current?._loadedFor === 'doc') return undefined;
        let live = true;
        authFetch(`/api/party-info/${partyId}`).then(r => {
            if (!live) return;
            const d = r.data || {};
            onChange({ billing_address: d.billing_address || '', shipping_address: d.shipping_address || '', pan: d.pan || '', phone: d.phone || '', email: d.email || '', update_master: false, _loadedFor: partyId });
        }).catch(() => undefined);
        return () => { live = false; };
    }, [authFetch, partyId, onChange]);
    const set = (k, v) => onChange({ ...info, [k]: v, _loadedFor: info._loadedFor || partyId || 'doc' });
    if (!partyId) return <p className="text-xs text-gray-600">Choose the {partyLabel.toLowerCase()} first.</p>;
    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="erp-field md:col-span-2"><label className="erp-label">Billing Address</label>
                <textarea className="erp-input" rows={2} value={info.billing_address} onChange={e => set('billing_address', e.target.value)} /></div>
            <div className="erp-field md:col-span-2"><label className="erp-label">Shipping Address <button type="button" tabIndex={-1} className="text-[11px] text-blue-700 underline ml-1" onClick={() => set('shipping_address', info.billing_address)}>same as billing</button></label>
                <textarea className="erp-input" rows={2} value={info.shipping_address} onChange={e => set('shipping_address', e.target.value)} /></div>
            <div className="erp-field"><label className="erp-label">PAN / VAT No.</label><input className="erp-input" value={info.pan} onChange={e => set('pan', e.target.value)} /></div>
            <div className="erp-field"><label className="erp-label">Phone</label><input className="erp-input" value={info.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div className="erp-field"><label className="erp-label">E-mail</label><input className="erp-input" value={info.email} onChange={e => set('email', e.target.value)} /></div>
            <label className="flex items-end gap-2 text-sm pb-1"><input type="checkbox" checked={!!info.update_master} onChange={e => set('update_master', e.target.checked)} /> Also update these in the {partyLabel.toLowerCase()} master</label>
        </div>
    );
}

/**
 * <PartyFooterTabs partyId={form.customer_ledger_id} partyLabel="Customer" info={partyInfo} onChange={setPartyInfo}
 *     tabs={[{ key: 'accounts', label: 'Accounts', content: <...> }]} />
 */
export default function PartyFooterTabs({ partyId, partyLabel = 'Party', info, onChange, tabs = [], defaultTab }) {
    const [tab, setTab] = useState(defaultTab || 'party');
    const all = [{ key: 'party', label: `🏠 ${partyLabel} Details` }, ...tabs];
    return (
        <div className="border-t border-[#aca899]">
            <div className="erp-tabs">
                {all.map(t => <button key={t.key} type="button" className={`erp-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
            </div>
            <div className="p-3 bg-[#f0f0f0]">
                {/* kept mounted so the party details fill in even while another tab is open */}
                <div className={tab === 'party' ? '' : 'hidden'}><PartyDetailsPanel partyId={partyId} partyLabel={partyLabel} info={info} onChange={onChange} /></div>
                {all.filter(t => t.key !== 'party' && t.key === tab).map(t => <div key={t.key}>{t.content}</div>)}
            </div>
        </div>
    );
}
