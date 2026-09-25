// =============================================
// ConfirmationLetters.jsx
// Account (balance) confirmation letters for customers / suppliers.
// One letter per ledger, per billing name, or per PAN (ledgers sharing it
// are added up). Built-in formats (English, Nepali, with reply slip) and a
// designer: subject / body with placeholders, letterhead, font, margins,
// statement of account, open bills and a reply slip - saved as templates
// (document_templates, type confirmation_letter).
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { amountToWords } from '../utils/numberToWords';

const fmt2 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);
const PLACEHOLDERS = ['date', 'as_on', 'from', 'party_name', 'party_address', 'party_pan', 'party_phone', 'ledger_names', 'balance', 'dr_cr', 'balance_words', 'balance_side_text',
    'company_name', 'company_address', 'company_pan', 'company_phone', 'company_email'];
export const BUILTIN_LETTERS = [
    { id: 'builtin-en', template_name: 'Standard (English)', builtin: true, config: {
        font_family: 'Georgia, serif', font_size: 11, margin_mm: 20, letterhead: true, subject: 'Confirmation of Account Balance as on {{as_on}}',
        body: 'Date: {{date}}\n\nTo,\n{{party_name}}\n{{party_address}}\nPAN / VAT: {{party_pan}}\n\nDear Sir / Madam,\n\nAs per our books of account, the balance of your account as on {{as_on}} is NRs. {{balance}} ({{dr_cr}}) - {{balance_side_text}}.\n\n({{balance_words}})\n\nPlease check the balance with your books and confirm it by signing and returning a copy of this letter. If the balance differs, please send us a statement of your account so that the difference can be reconciled. If we do not hear from you within 15 days, the balance will be treated as correct.\n\nThank you.',
        signature: 'For {{company_name}}\n\n\n______________________\nAuthorised Signatory', show_statement: false, show_bills: false, reply_slip: false } },
    { id: 'builtin-np', template_name: 'Standard (Nepali)', builtin: true, config: {
        font_family: "'Noto Sans Devanagari', 'Mangal', sans-serif", font_size: 12, margin_mm: 20, letterhead: true, subject: 'मिति {{as_on}} सम्मको हिसाब मिलान सम्बन्धमा',
        body: 'मिति: {{date}}\n\nश्री {{party_name}}\n{{party_address}}\nपान / भ्याट नं.: {{party_pan}}\n\nमहोदय,\n\nहाम्रो लेखा अनुसार मिति {{as_on}} सम्म तपाईंको खातामा रु. {{balance}} ({{dr_cr}}) बाँकी देखिएको छ - {{balance_side_text}}।\n\nकृपया उक्त रकम तपाईंको हिसाबसँग भिडाई यो पत्रको प्रतिलिपिमा हस्ताक्षर गरी पठाइदिनुहुन अनुरोध छ। रकम फरक परेमा तपाईंको हिसाब विवरण पठाइदिनुहोला। १५ दिनभित्र जानकारी प्राप्त नभएमा उक्त रकम सही मानिनेछ।\n\nधन्यवाद।',
        signature: '{{company_name}} को तर्फबाट\n\n\n______________________\nअधिकृत हस्ताक्षर', show_statement: false, show_bills: false, reply_slip: false } },
    { id: 'builtin-reply', template_name: 'With statement + reply slip', builtin: true, config: {
        font_family: 'Arial, sans-serif', font_size: 10, margin_mm: 15, letterhead: true, subject: 'Balance Confirmation - {{as_on}}',
        body: 'Date: {{date}}\n\n{{party_name}}\n{{party_address}}   PAN: {{party_pan}}\n\nWe give below your account in our books for the period {{from}} to {{as_on}}. The closing balance is NRs. {{balance}} {{dr_cr}} ({{balance_side_text}}). Kindly confirm by returning the slip below.',
        signature: 'For {{company_name}}\nAccounts Department', show_statement: true, show_bills: true, reply_slip: true } }
];

function fill(text, ctx) { return String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (ctx[k] !== undefined && ctx[k] !== null ? ctx[k] : '')); }
function contextFor(row, data) {
    const today = new Date().toISOString().slice(0, 10);
    const receivable = row.balance > 0;
    return {
        date: today, as_on: data.as_on, from: data.from || '', party_name: row.name, party_address: row.address, party_pan: row.pan, party_phone: row.phone,
        ledger_names: row.ledgers.map(l => l.name).join(', '), balance: fmt2(row.balance_abs), dr_cr: row.dr_cr, balance_words: amountToWords(row.balance_abs, 'Nrs'),
        balance_side_text: row.balance === 0 ? 'nil balance' : receivable ? 'receivable from you' : 'payable to you',
        company_name: data.company.name, company_address: data.company.address, company_pan: data.company.pan, company_phone: data.company.phone, company_email: data.company.email
    };
}

export function Letter({ row, data, cfg }) {
    const ctx = contextFor(row, data);
    const para = t => fill(t, ctx).split('\n').map((l, i) => <div key={i} style={{ minHeight: '1.2em' }}>{l}</div>);
    return (
        <div className="letter-page bg-white" style={{ fontFamily: cfg.font_family, fontSize: `${cfg.font_size}pt`, padding: `${cfg.margin_mm}mm`, width: '210mm', minHeight: '297mm', boxSizing: 'border-box', lineHeight: 1.45 }}>
            {cfg.letterhead && (
                <div style={{ textAlign: 'center', borderBottom: '1px solid #333', paddingBottom: '3mm', marginBottom: '6mm' }}>
                    <div style={{ fontSize: `${cfg.font_size + 5}pt`, fontWeight: 700 }}>{data.company.name}</div>
                    <div>{data.company.address}</div>
                    <div>{[data.company.pan && `PAN: ${data.company.pan}`, data.company.phone, data.company.email].filter(Boolean).join(' · ')}</div>
                </div>
            )}
            {cfg.subject && <div style={{ fontWeight: 700, textAlign: 'center', textDecoration: 'underline', margin: '0 0 5mm' }}>{fill(cfg.subject, ctx)}</div>}
            <div>{para(cfg.body)}</div>
            {cfg.show_bills && (row.open_bills || []).length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4mm 0', fontSize: `${cfg.font_size - 1}pt` }}>
                    <thead><tr>{['Bill No', 'Date', 'Bill Amount', 'Unpaid'].map(h => <th key={h} style={{ border: '1px solid #999', padding: '1mm 2mm', textAlign: h === 'Bill No' || h === 'Date' ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                    <tbody>{row.open_bills.map((b, i) => <tr key={i}><td style={{ border: '1px solid #ccc', padding: '1mm 2mm' }}>{b.doc_no}</td><td style={{ border: '1px solid #ccc', padding: '1mm 2mm' }}>{b.date}</td>
                        <td style={{ border: '1px solid #ccc', padding: '1mm 2mm', textAlign: 'right' }}>{fmt2(b.total)}</td><td style={{ border: '1px solid #ccc', padding: '1mm 2mm', textAlign: 'right' }}>{fmt2(b.remaining)}</td></tr>)}</tbody>
                </table>
            )}
            {cfg.show_statement && row.statement && (
                <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4mm 0', fontSize: `${cfg.font_size - 1}pt` }}>
                    <thead><tr>{['Date', 'Particulars', 'Debit', 'Credit', 'Balance'].map(h => <th key={h} style={{ border: '1px solid #999', padding: '1mm 2mm', textAlign: ['Date', 'Particulars'].includes(h) ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                    <tbody>
                        <tr><td style={{ border: '1px solid #ccc', padding: '1mm 2mm' }}>{data.from}</td><td style={{ border: '1px solid #ccc', padding: '1mm 2mm' }}>Opening balance</td><td colSpan={2} style={{ border: '1px solid #ccc' }} />
                            <td style={{ border: '1px solid #ccc', padding: '1mm 2mm', textAlign: 'right' }}>{fmt2(Math.abs(row.opening))} {row.opening >= 0 ? 'Dr' : 'Cr'}</td></tr>
                        {row.statement.map((s, i) => (
                            <tr key={i}><td style={{ border: '1px solid #ccc', padding: '1mm 2mm' }}>{s.date}</td><td style={{ border: '1px solid #ccc', padding: '1mm 2mm' }}>{s.narration || s.type.replace(/_/g, ' ')}</td>
                                <td style={{ border: '1px solid #ccc', padding: '1mm 2mm', textAlign: 'right' }}>{s.debit ? fmt2(s.debit) : ''}</td><td style={{ border: '1px solid #ccc', padding: '1mm 2mm', textAlign: 'right' }}>{s.credit ? fmt2(s.credit) : ''}</td>
                                <td style={{ border: '1px solid #ccc', padding: '1mm 2mm', textAlign: 'right' }}>{fmt2(Math.abs(s.balance))} {s.balance >= 0 ? 'Dr' : 'Cr'}</td></tr>
                        ))}
                    </tbody>
                </table>
            )}
            <div style={{ marginTop: '8mm' }}>{para(cfg.signature)}</div>
            {cfg.reply_slip && (
                <div style={{ marginTop: '10mm', borderTop: '1px dashed #333', paddingTop: '4mm' }}>
                    <div style={{ fontWeight: 700 }}>Reply slip - to {data.company.name}</div>
                    <div>We confirm that the balance of our account with you as on {ctx.as_on} is NRs. {ctx.balance} ({ctx.dr_cr === 'Dr' ? 'payable by us' : 'receivable by us'}).</div>
                    <div style={{ marginTop: '2mm' }}>☐ Agreed &nbsp;&nbsp; ☐ Not agreed - our balance is NRs. ____________________ (statement attached)</div>
                    <div style={{ marginTop: '8mm', display: 'flex', justifyContent: 'space-between' }}><span>For {ctx.party_name}</span><span>Signature &amp; seal ______________</span><span>Date ________</span></div>
                </div>
            )}
        </div>
    );
}

export default function ConfirmationLetters() {
    const { authFetch } = useAuth();
    const [cfg, setCfg] = useState({ party_type: 'customer', group_by: 'ledger', as_on: iso(new Date()), from: '', party_ids: [], area_ids: [], agent_ids: [], min_balance: '', include_zero: false });
    const [masters, setMasters] = useState({ parties: [], areas: [], agents: [] });
    const [data, setData] = useState(null);
    const [tagged, setTagged] = useState(() => new Set());
    const [templates, setTemplates] = useState([]);
    const [tplId, setTplId] = useState('builtin-en');
    const [design, setDesign] = useState(null);                  // template being edited
    const [printing, setPrinting] = useState(false);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));

    const loadTemplates = useCallback(() => authFetch('/api/document-templates?type=confirmation_letter').then(r => {
        const list = r.data || [];
        setTemplates(list);
        const def = list.find(x => x.is_default);
        if (def) setTplId(id => (id.startsWith('builtin') ? def.id : id));
    }).catch(() => setTemplates([])), [authFetch]);
    useEffect(() => {
        loadTemplates();
        const list = (url, map) => authFetch(url).then(r => (r.data || []).map(map)).catch(() => []);
        Promise.all([list('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc', l => ({ id: l.id, name: l.account_name })), list('/api/areas', a => ({ id: a.id, name: a.area_name })), list('/api/salesman-agents', a => ({ id: a.id, name: a.agent_name }))])
            .then(([parties, areas, agents]) => setMasters({ parties, areas, agents }));
    }, [authFetch, loadTemplates]);
    const allTemplates = useMemo(() => [...BUILTIN_LETTERS, ...templates], [templates]);
    const tpl = allTemplates.find(x => x.id === tplId) || BUILTIN_LETTERS[0];
    const activeCfg = design ? design.config : tpl.config;
    const needStatement = activeCfg.show_statement, needBills = activeCfg.show_bills;

    const run = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ party_type: cfg.party_type, group_by: cfg.group_by, as_on: cfg.as_on, include_zero: String(cfg.include_zero) });
            if (cfg.from) p.set('from', cfg.from);
            if (cfg.min_balance) p.set('min_balance', cfg.min_balance);
            ['party_ids', 'area_ids', 'agent_ids'].forEach(k => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            if (needStatement && cfg.from) p.set('with_statement', 'true');
            if (needBills) p.set('with_open_bills', 'true');
            const r = await authFetch(`/api/confirmation-letters?${p}`);
            setData(r.data); setTagged(new Set((r.data.rows || []).map(x => x.key)));
        } catch (e) { setError(e.message); setData(null); }
        setLoading(false);
    }, [authFetch, cfg, needStatement, needBills]);

    const rows = data?.rows || [];
    const chosen = rows.filter(r => tagged.has(r.key));
    const doPrint = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 300); };
    const saveTemplate = async asNew => {
        setError(''); setMsg('');
        try {
            const body = { template_type: 'confirmation_letter', template_name: design.template_name, config: design.config, is_default: !!design.is_default };
            const r = asNew || !design.id || String(design.id).startsWith('builtin')
                ? await authFetch('/api/document-templates', { method: 'POST', body: JSON.stringify(body) })
                : await authFetch(`/api/document-templates/${design.id}`, { method: 'PUT', body: JSON.stringify(body) });
            await loadTemplates(); setTplId(r.data.id); setDesign(null); setMsg('Template saved');
        } catch (e) { setError(e.message); }
    };
    const delTemplate = async () => {
        if (!window.confirm('Delete this template?')) return;
        try { await authFetch(`/api/document-templates/${design.id}`, { method: 'DELETE' }); await loadTemplates(); setTplId('builtin-en'); setDesign(null); } catch (e) { setError(e.message); }
    };
    const exportCsv = () => {
        const head = ['Party', 'PAN', 'Address', 'Ledgers', 'Balance', 'Dr/Cr', 'Email', 'Phone'];
        const body = rows.map(r => [r.name, r.pan, r.address, r.ledgers.map(l => l.name).join(' + '), r.balance_abs, r.dr_cr, r.email, r.phone]);
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...body].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `confirmation_${cfg.party_type}_${cfg.as_on}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };
    const preview = chosen[0] || rows[0];

    return (
        <Layout>
        <style>{`@media print { body * { visibility: hidden !important; } .letters-print, .letters-print * { visibility: visible !important; } .letters-print { position: absolute; left: 0; top: 0; }
            .letter-page { break-after: page; page-break-after: always; } .letter-page:last-child { break-after: auto; } @page { size: A4; margin: 0; } }`}</style>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">✉ Account Confirmation Letters</span></div>
            <div className="erp-tab-content">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-3">
                    <div className="erp-field"><label className="erp-label">Parties</label>
                        <select className="erp-select" value={cfg.party_type} onChange={e => set('party_type', e.target.value)}><option value="customer">Customers</option><option value="supplier">Suppliers</option><option value="all">Both</option></select></div>
                    <div className="erp-field"><label className="erp-label">One letter per</label>
                        <select className="erp-select" value={cfg.group_by} onChange={e => set('group_by', e.target.value)}><option value="ledger">Ledger</option><option value="billing_name">Billing name</option><option value="pan">PAN / VAT no</option></select></div>
                    <div className="erp-field"><label className="erp-label">Balance as on</label><input type="date" className="erp-input" value={cfg.as_on} onChange={e => set('as_on', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">Statement from</label><input type="date" className="erp-input" value={cfg.from} onChange={e => set('from', e.target.value)} /></div>
                    <MultiPick label="Party" items={masters.parties} value={cfg.party_ids} onChange={v => set('party_ids', v)} />
                    <MultiPick label="Area" items={masters.areas} value={cfg.area_ids} onChange={v => set('area_ids', v)} />
                    <MultiPick label="Agent" items={masters.agents} value={cfg.agent_ids} onChange={v => set('agent_ids', v)} />
                    <div className="erp-field"><label className="erp-label">Min balance</label><input type="number" className="erp-input" value={cfg.min_balance} onChange={e => set('min_balance', e.target.value)} /></div>
                    <label className="flex items-center gap-1 text-sm mt-5"><input type="checkbox" checked={cfg.include_zero} onChange={e => set('include_zero', e.target.checked)} /> Include nil balances</label>
                    <div className="erp-field"><label className="erp-label">Letter format</label>
                        <select className="erp-select" value={tplId} onChange={e => { setTplId(e.target.value); setDesign(null); }}>
                            {allTemplates.map(x => <option key={x.id} value={x.id}>{x.template_name}{x.is_default ? ' (default)' : ''}{x.builtin ? ' · built-in' : ''}</option>)}
                        </select></div>
                </div>
                <div className="flex flex-wrap gap-2 mb-3 items-center">
                    <button className="erp-btn primary" onClick={run} disabled={loading}>{loading ? 'Loading…' : '🔍 Show parties'}</button>
                    <button className="erp-btn" onClick={() => setDesign(design ? null : { id: tpl.builtin ? null : tpl.id, template_name: tpl.builtin ? `${tpl.template_name} (copy)` : tpl.template_name, is_default: !!tpl.is_default, config: { ...tpl.config } })}>🎨 {design ? 'Close designer' : 'Design format'}</button>
                    {data && <button className="erp-btn" disabled={!chosen.length} onClick={doPrint}>🖨 Print {chosen.length} letter(s)</button>}
                    {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                    {(needStatement && !cfg.from) && <span className="text-xs text-orange-700">This format prints a statement - set "Statement from".</span>}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}

                {design && (
                    <div className="grid lg:grid-cols-2 gap-4 mb-4 border rounded p-3 bg-gray-50">
                        <div className="space-y-2 text-sm">
                            <div className="erp-field"><label className="erp-label">Template name</label><input className="erp-input" value={design.template_name} onChange={e => setDesign(d => ({ ...d, template_name: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">Subject</label><input className="erp-input" value={design.config.subject} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, subject: e.target.value } }))} /></div>
                            <div className="erp-field"><label className="erp-label">Body</label>
                                <textarea className="erp-input font-mono" style={{ height: '18rem' }} rows={12} value={design.config.body} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, body: e.target.value } }))} /></div>
                            <div className="flex flex-wrap gap-1">{PLACEHOLDERS.map(p => <button key={p} type="button" className="text-[11px] px-1.5 py-0.5 bg-white border rounded" onClick={() => setDesign(d => ({ ...d, config: { ...d.config, body: `${d.config.body}{{${p}}}` } }))}>{`{{${p}}}`}</button>)}</div>
                            <div className="erp-field"><label className="erp-label">Signature block</label><textarea className="erp-input" style={{ height: '6rem' }} rows={4} value={design.config.signature} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, signature: e.target.value } }))} /></div>
                            <div className="flex flex-wrap gap-3 items-center">
                                <label>Font <select className="border rounded px-1" value={design.config.font_family} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, font_family: e.target.value } }))}>
                                    {['Georgia, serif', 'Arial, sans-serif', "'Times New Roman', serif", "'Noto Sans Devanagari', 'Mangal', sans-serif"].map(f => <option key={f} value={f}>{f.split(',')[0].replace(/'/g, '')}</option>)}</select></label>
                                <label>Size <input type="number" className="border rounded px-1 w-14" value={design.config.font_size} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, font_size: Number(e.target.value) || 11 } }))} /> pt</label>
                                <label>Margin <input type="number" className="border rounded px-1 w-14" value={design.config.margin_mm} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, margin_mm: Number(e.target.value) || 15 } }))} /> mm</label>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                {[['letterhead', 'Company letterhead'], ['show_statement', 'Statement of account'], ['show_bills', 'Open bills'], ['reply_slip', 'Reply slip']].map(([k, l]) => (
                                    <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={!!design.config[k]} onChange={e => setDesign(d => ({ ...d, config: { ...d.config, [k]: e.target.checked } }))} /> {l}</label>
                                ))}
                                <label className="flex items-center gap-1"><input type="checkbox" checked={!!design.is_default} onChange={e => setDesign(d => ({ ...d, is_default: e.target.checked }))} /> Default format</label>
                            </div>
                            <div className="flex gap-2">
                                <button className="erp-btn primary" onClick={() => saveTemplate(false)}>💾 Save</button>
                                <button className="erp-btn" onClick={() => saveTemplate(true)}>Save as new</button>
                                {design.id && !String(design.id).startsWith('builtin') && <button className="erp-btn" onClick={delTemplate}>🗑 Delete</button>}
                            </div>
                        </div>
                        <div className="overflow-auto max-h-[80vh] bg-gray-200 p-2">
                            <div style={{ transform: 'scale(0.62)', transformOrigin: 'top left', width: '210mm' }}>
                                {data && preview ? <Letter row={preview} data={data} cfg={design.config} /> : <div className="p-6 text-gray-500">Show parties to preview a letter.</div>}
                            </div>
                        </div>
                    </div>
                )}

                {data && (
                    <>
                        <div className="text-sm mb-2">{data.totals.parties} letter(s) · receivable {fmt2(data.totals.receivable)} · payable {fmt2(data.totals.payable)}{data.merged ? ` · ${data.merged} combine more than one ledger` : ''}</div>
                        <table className="erp-grid-table w-full text-sm">
                            <thead><tr><th><input type="checkbox" checked={rows.length > 0 && chosen.length === rows.length} onChange={() => setTagged(chosen.length === rows.length ? new Set() : new Set(rows.map(r => r.key)))} /></th>
                                <th className="text-left">Party</th><th className="text-left">PAN</th><th className="text-left">Ledgers</th><th className="text-left">Address</th><th className="text-right">Balance</th><th /></tr></thead>
                            <tbody>{rows.map(r => (
                                <tr key={r.key} className={tagged.has(r.key) ? 'bg-yellow-50' : ''} onClick={() => setTagged(s => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}>
                                    <td><input type="checkbox" readOnly checked={tagged.has(r.key)} /></td><td>{r.name}</td><td>{r.pan}</td>
                                    <td className="text-xs">{r.ledgers.map(l => `${l.name} (${fmt2(Math.abs(l.balance))} ${l.balance >= 0 ? 'Dr' : 'Cr'})`).join(' + ')}</td><td className="text-xs">{r.address}</td>
                                    <td className="text-right tabular-nums">{fmt2(r.balance_abs)} {r.dr_cr}</td><td className="text-xs text-gray-500">{r.position === 'receivable' ? 'they owe us' : r.position === 'payable' ? 'we owe them' : ''}</td>
                                </tr>
                            ))}{!rows.length && <tr><td colSpan={7} className="text-center text-gray-400 py-3">No parties with a balance.</td></tr>}</tbody>
                        </table>
                    </>
                )}
            </div>
        </div>
        </div>
        {printing && data && <div className="letters-print">{chosen.map(r => <Letter key={r.key} row={r} data={data} cfg={activeCfg} />)}</div>}
        </Layout>
    );
}
