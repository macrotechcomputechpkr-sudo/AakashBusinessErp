// =============================================
// SendMessageModal.jsx
// Send a document (or a party reminder) by Email / SMS / WhatsApp / Viber.
//   <SendMessageModal documentType="sales_bill" documentId={id} onClose={...} />
//   <SendMessageModal partyId={ledgerId} event="outstanding_reminder" ... />
// The message is previewed from the chosen template and can be edited
// before sending; WhatsApp / Viber links open in a new tab.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const CH = [['whatsapp', '🟢 WhatsApp'], ['sms', '💬 SMS'], ['email', '✉ Email'], ['viber', '🟣 Viber']];

export default function SendMessageModal({ documentType, documentId, partyId, event, onClose }) {
    const { authFetch } = useAuth();
    const [channel, setChannel] = useState('whatsapp');
    const [templateId, setTemplateId] = useState('');
    const [pv, setPv] = useState(null);
    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setError(''); setMsg('');
        try {
            const r = (await authFetch('/api/messaging/preview', { method: 'POST', body: JSON.stringify({ channel, document_type: documentType, document_id: documentId, party_id: partyId, event, template_id: templateId || undefined }) })).data;
            setPv(r); setTo(r.to || ''); setSubject(r.subject || ''); setBody(r.body || '');
            if (!templateId && r.template_id) setTemplateId(r.template_id);
        } catch (e) { setError(e.message); setPv(null); setBody(''); }
    }, [authFetch, channel, documentType, documentId, partyId, event, templateId]);
    useEffect(() => { load(); }, [load]);

    const sendNow = async () => {
        setBusy(true); setError(''); setMsg('');
        try {
            const r = (await authFetch('/api/messaging/send', { method: 'POST', body: JSON.stringify({ channel, document_type: documentType, document_id: documentId, party_id: partyId, event, template_id: templateId || undefined, to, subject, body }) })).data;
            if (r.link) { window.open(r.link, '_blank', 'noopener'); if (r.log_id) authFetch(`/api/messaging/log/${r.log_id}/opened`, { method: 'POST' }).catch(() => {}); setMsg('Opened in ' + (channel === 'viber' ? 'Viber' : 'WhatsApp') + ' - press Send there'); }
            else setMsg(`Sent to ${r.to}`);
        } catch (e) { setError(e.message); }
        setBusy(false);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3 no-print" onClick={onClose}>
            <div className="bg-white rounded-xl w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-3"><p className="font-semibold">Send {pv?.party_name ? `to ${pv.party_name}` : ''}</p><button onClick={onClose}>✕</button></div>
                <div className="grid grid-cols-4 gap-2 mb-3">{CH.map(([k, l]) => <button key={k} className={`rounded py-2 text-sm border ${channel === k ? 'bg-blue-600 text-white' : ''}`} onClick={() => { setChannel(k); setTemplateId(''); }}>{l}</button>)}</div>
                {pv?.templates?.length > 0 && <div className="erp-field mb-2"><label className="erp-label">Template</label>
                    <select className="erp-select" value={templateId} onChange={e => setTemplateId(e.target.value)}>{pv.templates.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}
                <div className="erp-field mb-2"><label className="erp-label">{channel === 'email' ? 'Email' : 'Mobile (with country code)'}</label><input className="erp-input" value={to} onChange={e => setTo(e.target.value)} placeholder={channel === 'viber' ? 'optional - blank = choose in Viber' : ''} /></div>
                {channel === 'email' && <div className="erp-field mb-2"><label className="erp-label">Subject</label><input className="erp-input" value={subject} onChange={e => setSubject(e.target.value)} /></div>}
                <div className="erp-field mb-2"><label className="erp-label">Message {channel === 'sms' ? `(${body.length} chars)` : ''}</label><textarea className="erp-input" rows={8} value={body} onChange={e => setBody(e.target.value)} /></div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}
                <div className="flex gap-2 justify-end">
                    <button className="erp-btn" onClick={onClose}>Close</button>
                    <button className="erp-btn primary" disabled={busy || !body} onClick={sendNow}>{busy ? 'Sending…' : 'Send'}</button>
                </div>
                <p className="text-xs text-gray-500 mt-2">Templates, SMTP / SMS gateway and auto-send are set under Messaging.</p>
            </div>
        </div>
    );
}
