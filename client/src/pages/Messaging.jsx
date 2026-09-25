// =============================================
// Messaging.jsx  (/messaging)
// Email / SMS / WhatsApp / Viber (server: utils/messaging.js)
//   Templates    per channel + event with {{placeholders}}; ready-made defaults
//   Auto-send    which event sends what automatically (after posting)
//   Reminders    outstanding reminders to many customers at once
//   Log          sent / failed / WhatsApp-Viber links waiting to be opened
//   Settings     SMTP, SMS gateway (Sparrow / Aakash / custom), WhatsApp
//                (free click-to-chat or Cloud API), country code
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TABS = [['templates', 'Templates'], ['rules', 'Auto-send'], ['reminders', 'Reminders'], ['log', 'Log'], ['settings', 'Settings']];
const blank = { channel: 'whatsapp', event: 'sales_bill_posted', name: '', subject: '', body: '', is_default: true, is_active: true };

export default function Messaging() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'templates');
    const [meta, setMeta] = useState({ channels: [], events: [], placeholders: [] });
    const [tpls, setTpls] = useState([]);
    const [form, setForm] = useState(blank);
    const [rules, setRules] = useState([]);
    const [settings, setSettings] = useState(null);
    const [log, setLog] = useState([]);
    const [logStatus, setLogStatus] = useState('');
    const [parties, setParties] = useState([]);
    const [picked, setPicked] = useState(() => new Set());
    const [remCh, setRemCh] = useState('sms');
    const [remResult, setRemResult] = useState(null);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');
    const say = (m, e) => { setMsg(e ? '' : m); setError(e ? m : ''); };

    useEffect(() => { authFetch('/api/messaging/meta').then(r => setMeta(r.data)).catch(() => {}); }, [authFetch]);
    const loadTpls = useCallback(() => authFetch('/api/messaging/templates').then(r => setTpls(r.data || [])).catch(e => say(e.message, true)), [authFetch]);
    useEffect(() => {
        if (tab === 'templates' || tab === 'rules') loadTpls();
        if (tab === 'rules') authFetch('/api/messaging/rules').then(r => setRules(r.data || [])).catch(e => say(e.message, true));
        if (tab === 'settings') authFetch('/api/messaging/settings').then(r => setSettings(r.data)).catch(e => say(e.message, true));
        if (tab === 'log') authFetch(`/api/messaging/log${logStatus ? `?status=${logStatus}` : ''}`).then(r => setLog(r.data || [])).catch(e => say(e.message, true));
        if (tab === 'reminders') authFetch('/api/control-reports/credit_exceed').then(r => { setParties(r.data.rows || []); setPicked(new Set((r.data.rows || []).map(x => x.id))); }).catch(e => say(e.message, true));
    }, [tab, logStatus, authFetch, loadTpls]);

    const saveTpl = async () => { try { await authFetch('/api/messaging/templates', { method: 'POST', body: JSON.stringify(form) }); setForm(blank); loadTpls(); say('Template saved'); } catch (e) { say(e.message, true); } };
    const delTpl = async id => { if (!window.confirm('Delete this template?')) return; try { await authFetch(`/api/messaging/templates/${id}`, { method: 'DELETE' }); loadTpls(); } catch (e) { say(e.message, true); } };
    const defaults = async () => { try { const r = await authFetch('/api/messaging/templates/defaults', { method: 'POST' }); loadTpls(); say(`${r.data.added} default template(s) added`); } catch (e) { say(e.message, true); } };
    const ruleOf = (ev, ch) => rules.find(r => r.event === ev && r.channel === ch) || { event: ev, channel: ch, enabled: false, template_id: '' };
    const setRule = (ev, ch, patch) => setRules(rs => { const x = { ...ruleOf(ev, ch), ...patch }; return [...rs.filter(r => !(r.event === ev && r.channel === ch)), x]; });
    const saveRules = async () => { try { setRules((await authFetch('/api/messaging/rules', { method: 'PUT', body: JSON.stringify({ rules }) })).data); say('Auto-send saved'); } catch (e) { say(e.message, true); } };
    const saveSettings = async () => { try { setSettings((await authFetch('/api/messaging/settings', { method: 'PUT', body: JSON.stringify(settings) })).data); say('Settings saved'); } catch (e) { say(e.message, true); } };
    const remind = async () => {
        if (!picked.size) return say('Tick the customers', true);
        try { const r = (await authFetch('/api/messaging/reminders', { method: 'POST', body: JSON.stringify({ channel: remCh, party_ids: [...picked] }) })).data; setRemResult(r); say(`Sent ${r.sent}, links ${r.links}, failed ${r.failed}`); }
        catch (e) { say(e.message, true); }
    };
    const openLink = async r => { window.open(r.link, '_blank', 'noopener'); try { await authFetch(`/api/messaging/log/${r.id}/opened`, { method: 'POST' }); setLog(l => l.map(x => (x.id === r.id ? { ...x, status: 'sent' } : x))); } catch { /* ignore */ } };
    const evLabel = k => meta.events.find(e => e.key === k)?.label || k;
    const S = (k, v) => setSettings(s => ({ ...s, [k]: v }));

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">📨 Messaging - Email · SMS · WhatsApp · Viber</span></div>
                    <div className="erp-tab-content">
                        <div className="flex flex-wrap gap-2 mb-3">{TABS.map(([k, l]) => <button key={k} className={`erp-btn ${tab === k ? 'primary' : ''}`} onClick={() => { setTab(k); say(''); }}>{l}</button>)}</div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}

                        {tab === 'templates' && (<>
                            <div className="border rounded-lg p-3 mb-3 grid grid-cols-1 md:grid-cols-4 gap-3">
                                <div className="erp-field"><label className="erp-label">Channel</label><select className="erp-select" value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>{meta.channels.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
                                <div className="erp-field"><label className="erp-label">Event</label><select className="erp-select" value={form.event} onChange={e => setForm({ ...form, event: e.target.value })}>{meta.events.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
                                <div className="erp-field"><label className="erp-label">Name</label><input className="erp-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                                <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked })} /> Default for this event</label>
                                {form.channel === 'email' && <div className="erp-field md:col-span-4"><label className="erp-label">Subject</label><input className="erp-input" value={form.subject || ''} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>}
                                <div className="erp-field md:col-span-3"><label className="erp-label">Message {form.channel === 'sms' ? `(${form.body.length}/480)` : ''}</label><textarea className="erp-input" rows={6} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></div>
                                <div className="text-xs"><p className="font-semibold mb-1">Placeholders (click to add)</p><div className="flex flex-wrap gap-1">{meta.placeholders.map(p => <button key={p} className="border rounded px-1 bg-slate-50" onClick={() => setForm(f => ({ ...f, body: `${f.body}{{${p}}}` }))}>{`{{${p}}}`}</button>)}</div></div>
                                <div className="md:col-span-4 flex gap-2"><button className="erp-btn primary" onClick={saveTpl}>💾 {form.id ? 'Update' : 'Save'} template</button>{form.id && <button className="erp-btn" onClick={() => setForm(blank)}>New</button>}<button className="erp-btn" onClick={defaults}>⭐ Add ready-made templates</button></div>
                            </div>
                            <table className="erp-grid-table text-sm"><thead><tr><th>Event</th><th>Channel</th><th>Name</th><th>Message</th><th>Default</th><th /></tr></thead>
                                <tbody>{tpls.map(x => <tr key={x.id}><td>{evLabel(x.event)}</td><td>{x.channel}</td><td>{x.name}</td><td className="text-xs whitespace-pre-line max-w-md">{x.subject ? <b>{x.subject}{'\n'}</b> : ''}{String(x.body).slice(0, 200)}</td><td>{x.is_default ? '✔' : ''}</td>
                                    <td className="whitespace-nowrap"><button className="text-xs text-blue-600 mr-2" onClick={() => setForm({ ...x })}>Edit</button><button className="text-xs text-red-600" onClick={() => delTpl(x.id)}>Delete</button></td></tr>)}</tbody></table>
                            {tpls.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No templates - click "Add ready-made templates".</p>}
                        </>)}

                        {tab === 'rules' && (<>
                            <table className="erp-grid-table text-sm"><thead><tr><th>When</th>{meta.channels.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
                                <tbody>{meta.events.filter(e => !['custom', 'outstanding_reminder'].includes(e.key)).map(ev => (
                                    <tr key={ev.key}><td>{ev.label}</td>{meta.channels.map(ch => { const r = ruleOf(ev.key, ch.key); const list = tpls.filter(x => x.event === ev.key && x.channel === ch.key); return (
                                        <td key={ch.key}><label className="flex items-center gap-1"><input type="checkbox" checked={!!r.enabled} disabled={!list.length} onChange={e => setRule(ev.key, ch.key, { enabled: e.target.checked })} /> auto</label>
                                            {list.length > 1 && <select className="erp-select text-xs mt-1" value={r.template_id || ''} onChange={e => setRule(ev.key, ch.key, { template_id: e.target.value })}><option value="">Default</option>{list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
                                            {!list.length && <span className="text-[11px] text-gray-400">no template</span>}</td>); })}</tr>))}</tbody></table>
                            <button className="erp-btn primary mt-3" onClick={saveRules}>💾 Save auto-send</button>
                            <p className="text-xs text-gray-500 mt-2">Email, SMS and WhatsApp Cloud API go out by themselves after posting. WhatsApp (link mode) and Viber cannot be sent without a person - they wait in the Log with an Open button. A document never gets the same message twice.</p>
                        </>)}

                        {tab === 'reminders' && (<>
                            <div className="flex flex-wrap gap-2 items-end mb-3">
                                <div className="erp-field"><label className="erp-label">Send by</label><select className="erp-select" value={remCh} onChange={e => setRemCh(e.target.value)}>{meta.channels.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
                                <button className="erp-btn primary" onClick={remind}>📨 Send reminders ({picked.size})</button>
                            </div>
                            <p className="text-xs text-gray-500 mb-2">Customers above their credit limit or with overdue bills (Credit Limit Exceeded / Overdue report).</p>
                            <table className="erp-grid-table text-sm"><thead><tr><th><input type="checkbox" checked={picked.size === parties.length && parties.length > 0} onChange={e => setPicked(new Set(e.target.checked ? parties.map(p => p.id) : []))} /></th><th>Customer</th><th>Phone</th><th className="text-right">Balance</th><th className="text-right">Overdue</th><th>Result</th></tr></thead>
                                <tbody>{parties.map(p => { const res = remResult?.results.find(x => x.party_id === p.id); return <tr key={p.id}><td><input type="checkbox" checked={picked.has(p.id)} onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} /></td>
                                    <td>{p.name}</td><td>{p.phone}</td><td className="text-right">{fmt(p.balance)}</td><td className="text-right">{fmt(p.overdue)}</td>
                                    <td className="text-xs">{res ? (res.link ? <a href={res.link} target="_blank" rel="noopener noreferrer" className="text-green-700 underline">Open</a> : res.status === 'failed' ? <span className="text-red-600">{res.error}</span> : res.status) : ''}</td></tr>; })}</tbody></table>
                        </>)}

                        {tab === 'log' && (<>
                            <select className="erp-select mb-2" style={{ width: 'auto' }} value={logStatus} onChange={e => setLogStatus(e.target.value)}><option value="">All</option><option value="link">Waiting to open (WhatsApp / Viber)</option><option value="sent">Sent</option><option value="failed">Failed</option></select>
                            <table className="erp-grid-table text-sm"><thead><tr><th>When</th><th>Channel</th><th>Event</th><th>Party</th><th>To</th><th>Message</th><th>Status</th><th /></tr></thead>
                                <tbody>{log.map(r => <tr key={r.id} className={r.status === 'failed' ? 'text-red-700' : ''}><td className="text-xs">{String(r.created_at).replace('T', ' ').slice(0, 16)}</td><td>{r.channel}{r.is_auto ? ' (auto)' : ''}</td><td className="text-xs">{evLabel(r.event)}</td><td>{r.party_name}</td><td className="text-xs">{r.recipient}</td>
                                    <td className="text-xs max-w-xs truncate" title={r.body}>{r.subject ? `${r.subject} - ` : ''}{r.body}</td><td>{r.status}{r.error ? <div className="text-[11px]">{r.error}</div> : ''}</td>
                                    <td>{r.status === 'link' && r.link && <button className="text-xs text-green-700 underline" onClick={() => openLink(r)}>Open</button>}</td></tr>)}</tbody></table>
                        </>)}

                        {tab === 'settings' && settings && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-4xl">
                                <p className="md:col-span-3 font-semibold">Email (SMTP - e.g. Gmail smtp.gmail.com 587 with an app password)</p>
                                <div className="erp-field"><label className="erp-label">SMTP host</label><input className="erp-input" value={settings.smtp_host || ''} onChange={e => S('smtp_host', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">Port</label><input type="number" className="erp-input" value={settings.smtp_port || 587} onChange={e => S('smtp_port', e.target.value)} /></div>
                                <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={!!settings.smtp_secure} onChange={e => S('smtp_secure', e.target.checked)} /> SSL (port 465)</label>
                                <div className="erp-field"><label className="erp-label">User</label><input className="erp-input" value={settings.smtp_user || ''} onChange={e => S('smtp_user', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">Password {settings.smtp_password ? '(stored)' : ''}</label><input type="password" className="erp-input" placeholder={settings.smtp_password ? 'leave blank to keep' : ''} onChange={e => S('smtp_password', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">From email</label><input className="erp-input" value={settings.from_email || ''} onChange={e => S('from_email', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">From name</label><input className="erp-input" value={settings.from_name || ''} onChange={e => S('from_name', e.target.value)} /></div>
                                <p className="md:col-span-3 font-semibold mt-2">SMS</p>
                                <div className="erp-field"><label className="erp-label">Gateway</label><select className="erp-select" value={settings.sms_gateway || 'none'} onChange={e => S('sms_gateway', e.target.value)}><option value="none">None</option><option value="sparrow">Sparrow SMS</option><option value="aakash">Aakash SMS</option><option value="custom">Other (HTTP URL)</option></select></div>
                                <div className="erp-field"><label className="erp-label">Token {settings.sms_token ? '(stored)' : ''}</label><input type="password" className="erp-input" placeholder={settings.sms_token ? 'leave blank to keep' : ''} onChange={e => S('sms_token', e.target.value)} /></div>
                                <div className="erp-field"><label className="erp-label">Sender / identity</label><input className="erp-input" value={settings.sms_sender || ''} onChange={e => S('sms_sender', e.target.value)} /></div>
                                {settings.sms_gateway === 'custom' && <div className="erp-field md:col-span-3"><label className="erp-label">URL - use {'{to} {text} {token} {sender}'}</label><input className="erp-input" value={settings.sms_custom_url || ''} onChange={e => S('sms_custom_url', e.target.value)} /></div>}
                                <p className="md:col-span-3 font-semibold mt-2">WhatsApp / Viber</p>
                                <div className="erp-field"><label className="erp-label">WhatsApp</label><select className="erp-select" value={settings.whatsapp_mode || 'link'} onChange={e => S('whatsapp_mode', e.target.value)}><option value="link">Free: open WhatsApp with the message (click-to-chat)</option><option value="cloud_api">WhatsApp Cloud API (automatic)</option></select></div>
                                {settings.whatsapp_mode === 'cloud_api' && <>
                                    <div className="erp-field"><label className="erp-label">Access token {settings.whatsapp_token ? '(stored)' : ''}</label><input type="password" className="erp-input" placeholder={settings.whatsapp_token ? 'leave blank to keep' : ''} onChange={e => S('whatsapp_token', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Phone number id</label><input className="erp-input" value={settings.whatsapp_phone_id || ''} onChange={e => S('whatsapp_phone_id', e.target.value)} /></div>
                                </>}
                                <div className="erp-field"><label className="erp-label">Country code</label><input className="erp-input" value={settings.default_country_code || '977'} onChange={e => S('default_country_code', e.target.value)} /></div>
                                <p className="md:col-span-3 text-xs text-gray-500">Viber opens the Viber app with the message ready (Viber has no free sending API). Parties' email and mobile come from Chart of Accounts (Email, Contact person mobile / Office phone).</p>
                                <div className="md:col-span-3"><button className="erp-btn primary" onClick={saveSettings}>💾 Save settings</button></div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
