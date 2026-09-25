// =============================================
// NotificationSettings.tsx  (/notification-settings)
// Each user chooses how they hear about tasks and darta / chalani:
// popup in the ERP (always in the bell), and copies by email / SMS /
// WhatsApp / Viber (sent through Messaging > Settings: SMTP, SMS gateway,
// WhatsApp Cloud API). Also: which kinds to mute, how early to remind,
// desktop notifications, and a test.
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import type { AuthFetch } from '../types/erp';

interface Settings { popup: boolean; email: boolean; sms: boolean; whatsapp: boolean; viber: boolean; email_address: string | null; mobile: string | null; muted_kinds: string[]; reminder_hours: number; kinds: Record<string, string> }

export default function NotificationSettings() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [s, setS] = useState<Settings | null>(null);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');
    const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
    useEffect(() => { authFetch<Settings>('/api/notifications/settings').then(r => setS(r.data)).catch((e: Error) => setError(e.message)); }, [authFetch]);
    if (!s) return <Layout><div className="p-6">{error ? <p className="text-red-600">{error}</p> : 'Loading…'}</div></Layout>;
    const set = (k: keyof Settings, v: unknown) => setS({ ...s, [k]: v } as Settings);
    const save = async () => {
        setMsg(''); setError('');
        try { const r = await authFetch<Settings>('/api/notifications/settings', { method: 'PUT', body: JSON.stringify(s) }); setS({ ...r.data, kinds: s.kinds }); setMsg('Saved'); }
        catch (e) { setError((e as Error).message); }
    };
    const test = async () => {
        setMsg(''); setError('');
        try {
            await save();
            const r = await authFetch<{ created: number; sent: { channel: string }[]; links: { channel: string; link: string }[] }>('/api/notifications/test', { method: 'POST', body: '{}' });
            setMsg(`Test sent - watch the 🔔 (within 30 s)${r.data.sent.length ? `; also sent by ${r.data.sent.map(x => x.channel).join(', ')}` : ''}${r.data.links.length ? `; ${r.data.links.map(x => x.channel).join(', ')} need the Cloud API in Messaging > Settings to send by themselves` : ''}`);
        } catch (e) { setError((e as Error).message); }
    };
    const ch = (k: 'email' | 'sms' | 'whatsapp' | 'viber', label: string, note: string) => (
        <label className="flex items-start gap-2 py-1"><input type="checkbox" className="mt-1" checked={s[k]} onChange={e => set(k, e.target.checked)} /><span><b>{label}</b><span className="block text-xs text-gray-500">{note}</span></span></label>
    );
    return (
        <Layout>
            <div className="p-4 md:p-6 max-w-3xl">
                <div className="erp-card">
                    <div className="erp-header">🔔 My Notification Settings</div>
                    <div className="erp-tab-content space-y-4">
                        {error && <p className="text-sm text-red-600">{error}</p>}
                        {msg && <p className="text-sm text-green-700">{msg}</p>}
                        <div>
                            <p className="font-semibold text-sm mb-1">In the ERP</p>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={s.popup} onChange={e => set('popup', e.target.checked)} /> Show a popup when something new arrives (the 🔔 list always keeps them)</label>
                            <div className="flex items-center gap-2 mt-2 text-sm">
                                <span>Desktop notifications when the ERP tab is in the background:</span>
                                {perm === 'granted' ? <span className="text-green-700">allowed ✔</span> : perm === 'denied' ? <span className="text-gray-500">blocked in this browser</span>
                                    : <button type="button" className="erp-btn" onClick={() => Notification.requestPermission().then(setPerm)}>Allow</button>}
                            </div>
                        </div>
                        <div>
                            <p className="font-semibold text-sm mb-1">Also send me a copy by</p>
                            {ch('email', 'Email', 'Uses the SMTP account in Messaging > Settings')}
                            {ch('sms', 'SMS', 'Uses the SMS gateway in Messaging > Settings')}
                            {ch('whatsapp', 'WhatsApp', 'Sent automatically with the WhatsApp Cloud API (free tier) set in Messaging > Settings; otherwise the sender gets a ready-to-send WhatsApp button')}
                            {ch('viber', 'Viber', 'The sender gets a ready-to-send Viber button')}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                                <div className="erp-field"><label className="erp-label">Email (blank = my login email)</label><input className="erp-input" value={s.email_address || ''} onChange={e => set('email_address', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">Mobile (blank = my phone in Users)</label><input className="erp-input" value={s.mobile || ''} onChange={e => set('mobile', e.target.value)} /></div>
                            </div>
                        </div>
                        <div>
                            <p className="font-semibold text-sm mb-1">Remind me before a task is due</p>
                            <select className="erp-select !w-auto" value={s.reminder_hours} onChange={e => set('reminder_hours', Number(e.target.value))}>
                                {[1, 2, 4, 8, 24, 48, 72].map(h => <option key={h} value={h}>{h < 24 ? `${h} hour(s)` : `${h / 24} day(s)`} before</option>)}
                            </select>
                        </div>
                        <div>
                            <p className="font-semibold text-sm mb-1">Do not send copies for</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-sm">
                                {Object.entries(s.kinds).map(([k, l]) => (
                                    <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={s.muted_kinds.includes(k)} onChange={e => set('muted_kinds', e.target.checked ? [...s.muted_kinds, k] : s.muted_kinds.filter(x => x !== k))} /> {l}</label>
                                ))}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Muted kinds still appear in the 🔔 list; only the email / SMS / WhatsApp / Viber copy is skipped.</p>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" className="erp-btn primary" onClick={save}>💾 Save</button>
                            <button type="button" className="erp-btn" onClick={test}>Send me a test</button>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
