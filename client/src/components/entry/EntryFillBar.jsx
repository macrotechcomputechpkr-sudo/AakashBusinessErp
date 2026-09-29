// =============================================
// components/entry/EntryFillBar.jsx
// The fill bar at the top of every transaction form - ONE line: the actions,
// then one "📄 Template ▾" drop-down with:
//   From Template     - a saved template fills the new entry
//   Save as Template  - what is typed now, saved under a name (for everyone,
//                       or only for me)
//   From Previous     - a posted entry of this screen copied into a new one
//                       (new number and today's date)
//   From Draft        - a temporary draft (Save as Draft, /api/entry-drafts)
//                       fills the entry; saving the entry deletes the draft
// Templates: /api/entry-templates (documentActionRoutes.js). Previous entries
// and drafts come from the screen's own list (GET /api/<api>).
// Action bar in front (every entry form, NAV "Home" actions):
//   New · Save · Save as Draft - the form's own buttons
//   Modify · Cancel · Remove  - pick an entry of this screen; the entry's own
//                               list action runs (same checks, IRD reverse ...)
//   Print                     - this entry when saved, else pick one
//   an open saved draft: Remove / Print act on it directly (docId)
// =============================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { EntryPopup } from './EntryParts';
import { asNewCopy } from './DocActions';
import { setCurrentDraft } from './entryDrafts';

const amountOf = r => r.grand_total ?? r.net_amount ?? r.total_amount ?? r.total ?? r.amount ?? r.total_debit ?? '';
const partyOf = r => r.customer_name_snapshot || r.vendor_name_snapshot || r.party_name_snapshot || r.ledger_name_snapshot || r.customer_name || r.vendor_name || r.party_name || r.customer?.account_name || r.vendor?.account_name || r.ledger?.account_name || r.narration || '';
const fmtAmt = v => (v === '' || v === null || v === undefined ? '' : (Number(v) || 0).toFixed(2));
const dateOf = r => String(r.doc_date || r.voucher_date || r.created_at || '').slice(0, 10);

/**
 * voucherType: template key (e.g. 'sales_bill'); api: list endpoint ('sales-bills');
 * form: what is typed now; onFill(payload): fill the new entry; onCopy(row): the screen's own copy of a
 * previous entry; editing: an entry is open for edit
 */
// list endpoint -> print layout type (/print/<type>/<id>)
const PRINT_TYPE = { 'journal-vouchers': 'journal_voucher', 'pdc-vouchers': 'pdc_voucher', 'production-orders': 'production_order', 'purchase-additional-expenses': 'purchase_additional_expense',
    'purchase-nonsaleable-returns': 'purchase_nonsaleable_return', 'sales-additional-entries': 'sales_additional_entry', 'sales-nonsaleable-returns': 'sales_nonsaleable_return' };
const ACTION = { modify: ['Modify', 'Modify'], cancel: ['Cancel', 'Cancel'], remove: ['Remove', 'Remove'], print: ['Print', 'Print'] };
const textOf = el => (el.textContent || '').replace(/\s+/g, ' ').trim();

export default function EntryFillBar({ voucherType, api, form, onFill, onCopy, editing, docId }) {
    const { authFetch } = useAuth();
    const barRef = useRef(null);
    const [open, setOpen] = useState(null); // 'template' | 'previous' | 'draft' | 'pick:<action>'
    const [templates, setTemplates] = useState([]);
    const [drafts, setDrafts] = useState([]);
    const [rows, setRows] = useState([]);
    const [q, setQ] = useState('');
    const [msg, setMsg] = useState('');
    const [fillMenu, setFillMenu] = useState(false);

    const loadTemplates = useCallback(async () => {
        try { const r = await authFetch(`/api/entry-templates?voucher_type=${voucherType}`); setTemplates(r.data || []); } catch { setTemplates([]); }
    }, [authFetch, voucherType]);
    const loadRows = useCallback(async () => {
        try { const r = await authFetch(`/api/${api}`); setRows(Array.isArray(r.data) ? r.data : (r.data?.rows || [])); } catch { setRows([]); }
    }, [authFetch, api]);
    const loadDrafts = useCallback(async () => {
        try { const r = await authFetch(`/api/entry-drafts?voucher_type=${voucherType}`); setDrafts(r.data || []); } catch { setDrafts([]); }
    }, [authFetch, voucherType]);
    useEffect(() => { loadRows(); loadTemplates(); loadDrafts(); }, [loadRows, loadTemplates, loadDrafts]);
    // a new form starts with no draft behind it
    useEffect(() => { setCurrentDraft(voucherType, null); }, [voucherType]);

    const flash = m => { setMsg(m); setTimeout(() => setMsg(''), 3000); };
    const previous = rows.filter(r => r.status && !['draft', 'cancelled', 'rejected'].includes(r.status))
        .sort((a, b) => String(dateOf(b)).localeCompare(dateOf(a)) || String(b.doc_no || '').localeCompare(String(a.doc_no || '')));
    const match = r => !q || `${r.doc_no || ''} ${partyOf(r)} ${dateOf(r)}`.toLowerCase().includes(q.toLowerCase());

    const saveTemplate = async () => {
        const name = window.prompt('Template name');
        if (!name || !name.trim()) return;
        const personal = !window.confirm('Share this template with every user?\n\nOK = everyone · Cancel = only me');
        try {
            const r = await authFetch('/api/entry-templates', { method: 'POST', body: JSON.stringify({ voucher_type: voucherType, template_name: name.trim(), payload: asNewCopy(form), is_personal: personal }) });
            flash(r.replaced ? `Template "${name.trim()}" updated` : `Template "${name.trim()}" saved`);
            loadTemplates();
        } catch (e) { window.alert(e.message); }
    };
    const removeTemplate = async t => {
        if (!window.confirm(`Delete template "${t.template_name}"?`)) return;
        try { await authFetch(`/api/entry-templates/${t.id}`, { method: 'DELETE' }); loadTemplates(); } catch (e) { window.alert(e.message); }
    };
    const pickTemplate = t => { onFill(asNewCopy(t.payload || {})); setOpen(null); flash(`Filled from template "${t.template_name}"`); };
    const pickPrevious = r => { setOpen(null); onCopy(r); };
    const pickDraft = d => { setOpen(null); setCurrentDraft(voucherType, d.id); onFill(d.payload || {}); flash('Draft opened - Save to make it the entry (the draft is then removed)'); };
    const discardDraft = async d => {
        if (!window.confirm('Discard this draft?')) return;
        try { await authFetch(`/api/entry-drafts/${d.id}`, { method: 'DELETE' }); loadDrafts(); } catch (e) { window.alert(e.message); }
    };
    // ---- action bar: the form's own buttons, or the picked entry's list actions ----
    const formEl = () => barRef.current && barRef.current.closest('form');
    const card = () => barRef.current && barRef.current.closest('.erp-card');
    const buttonIn = (root, test) => root && [...root.querySelectorAll('button')].find(b => !barRef.current.contains(b) && test(textOf(b)));
    const newEntry = () => {
        // this bar goes away with the form: keep the card, close the form, then open a fresh one
        const c = card();
        const header = c && c.querySelector('.erp-header');
        const find = re => header && [...header.querySelectorAll('button')].find(b => re.test(textOf(b)));
        const close = find(/close/i);
        if (close) close.click();
        setTimeout(() => { const nb = find(/new/i); if (nb) nb.click(); }, 80);
    };
    const save = () => { const f = formEl(); if (f) f.requestSubmit(); };
    const saveDraft = () => { const b = buttonIn(formEl(), t => /save as draft/i.test(t)); if (b) b.click(); };
    const printUrl = id => `/print/${PRINT_TYPE[api] || voucherType}/${id}`;
    const runOn = (action, r) => {
        setOpen(null);
        if (action === 'print') { window.open(printUrl(r.id), '_blank', 'noopener'); return; }
        // the entry's own action button in the list below (DocActions: same checks and messages)
        const row = [...document.querySelectorAll('tr')].find(tr => !barRef.current.contains(tr) && [...tr.children].some(td => textOf(td) === String(r.doc_no || '')));
        const words = action === 'cancel' ? /^(⊘ )?cancel$|reverse/i : new RegExp(ACTION[action][1], 'i');
        const btn = row && [...row.querySelectorAll('button')].find(b => words.test(textOf(b).replace(/^[^A-Za-z]+/, '')));
        if (btn) btn.click();
        else window.alert(`${ACTION[action][0]} is not available for ${r.doc_no || 'this entry'} (${r.status || ''}).`);
    };
    const removeCurrent = async () => {
        if (!window.confirm('Remove this draft entry completely? This cannot be undone.')) return;
        try { await authFetch(`/api/${api}/${docId}`, { method: 'DELETE' }); window.location.reload(); } catch (e) { window.alert(e.message); }
    };
    const pick = action => { setQ(''); loadRows(); setOpen(`pick:${action}`); };
    const actionRows = action => rows.filter(r => r.status !== 'cancelled' && (action !== 'cancel' || r.status !== 'draft'))
        .sort((a, b) => String(dateOf(b)).localeCompare(dateOf(a)) || String(b.doc_no || '').localeCompare(String(a.doc_no || '')));

    const show = what => { setQ(''); setOpen(what); if (what === 'template') loadTemplates(); else if (what === 'draft') loadDrafts(); else loadRows(); };

    const list = (items, onPick, empty) => (
        <>
            <input className="erp-input mb-2" placeholder="Search number, party, date…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
            <table className="erp-grid-table">
                <thead><tr><th>No.</th><th>Date</th><th>Party / Narration</th><th className="text-right">Amount</th><th /></tr></thead>
                <tbody>
                    {items.filter(match).slice(0, 200).map(r => (
                        <tr key={r.id} className="cursor-pointer" onDoubleClick={() => onPick(r)}>
                            <td className="font-mono">{r.doc_no || '—'}</td><td>{dateOf(r)}</td><td className="truncate" style={{ maxWidth: 260 }}>{partyOf(r)}</td>
                            <td className="text-right">{fmtAmt(amountOf(r))}</td>
                            <td className="text-right"><button type="button" className="nav-btn small" onClick={() => onPick(r)}>Use</button></td>
                        </tr>
                    ))}
                    {items.filter(match).length === 0 && <tr><td colSpan={5} className="text-center">{empty}</td></tr>}
                </tbody>
            </table>
        </>
    );

    return (
        <div className="ent-fillbar" data-enter-nav="off" ref={barRef}>
            <span className="ent-actions">
                <button type="button" className="nav-tool-btn" onClick={newEntry} title="Start a new entry">➕ New</button>
                <button type="button" className="nav-tool-btn" onClick={() => pick('modify')} title="Open an entry of this screen to change it">✏️ Modify</button>
                <button type="button" className="nav-tool-btn" onClick={() => pick('cancel')} title="Cancel a posted entry (its accounts / stock effect is reversed)">⊘ Cancel</button>
                <button type="button" className="nav-tool-btn" onClick={() => (docId ? removeCurrent() : pick('remove'))} title={docId ? 'Remove this draft' : 'Remove an entry'}>🗑 Remove</button>
                <button type="button" className="nav-tool-btn" onClick={() => (docId ? window.open(printUrl(docId), '_blank', 'noopener') : pick('print'))} title={docId ? 'Print this entry' : 'Print an entry'}>🖨 Print</button>
                <button type="button" className="nav-tool-btn" onClick={saveDraft} title="Keep what is typed as a draft">📝 Draft</button>
                <button type="button" className="nav-tool-btn ent-action-save" onClick={save} title="Save (and post) this entry">💾 Save</button>
            </span>
            <span className="ent-fillbar-sep" />
            <span className="ent-fill-drop">
                <button type="button" className={`nav-tool-btn ${fillMenu ? 'active' : ''}`} onClick={() => setFillMenu(v => !v)} title="Fill this entry from a template, a previous entry or a draft - or save it as a template">📄 Template ▾</button>
                {fillMenu && (
                    <span className="ent-fill-menu" onMouseLeave={() => setFillMenu(false)}>
                        <button type="button" disabled={editing} onClick={() => { setFillMenu(false); show('template'); }}>📄 Fill from Template{templates.length ? ` (${templates.length})` : ''}</button>
                        <button type="button" disabled={editing} onClick={() => { setFillMenu(false); show('previous'); }}>⟲ Fill from Previous Entry</button>
                        <button type="button" disabled={editing} onClick={() => { setFillMenu(false); show('draft'); }}>📝 Open a Draft{drafts.length ? ` (${drafts.length})` : ''}</button>
                        <span className="ent-fill-menu-sep" />
                        <button type="button" onClick={() => { setFillMenu(false); saveTemplate(); }}>💾 Save as Template</button>
                    </span>
                )}
            </span>
            {msg && <span className="ent-note">{msg}</span>}
            {open === 'template' && (
                <EntryPopup title="Fill from Template" onClose={() => setOpen(null)} width={640}>
                    <table className="erp-grid-table">
                        <thead><tr><th>Template</th><th>For</th><th>Saved</th><th /></tr></thead>
                        <tbody>
                            {templates.map(t => (
                                <tr key={t.id} className="cursor-pointer" onDoubleClick={() => pickTemplate(t)}>
                                    <td className="font-semibold">{t.template_name}</td><td>{t.is_personal ? 'Only me' : 'Everyone'}</td><td>{String(t.updated_at || t.created_at || '').slice(0, 10)}</td>
                                    <td className="text-right whitespace-nowrap">
                                        <button type="button" className="nav-btn small primary" onClick={() => pickTemplate(t)}>Use</button>{' '}
                                        <button type="button" className="nav-btn small" onClick={() => removeTemplate(t)} title="Delete template">✕</button>
                                    </td>
                                </tr>
                            ))}
                            {templates.length === 0 && <tr><td colSpan={4} className="text-center">No templates yet - type an entry and use "Save as Template".</td></tr>}
                        </tbody>
                    </table>
                </EntryPopup>
            )}
            {open === 'previous' && (
                <EntryPopup title="Fill from a Previous Entry" onClose={() => setOpen(null)} width={760}>
                    {list(previous, pickPrevious, 'No previous entries.')}
                    <p className="ent-note mt-2">The entry is copied with a new number and today's date; change what is needed and save.</p>
                </EntryPopup>
            )}
            {String(open || '').startsWith('pick:') && (() => {
                const action = open.slice(5);
                return (
                    <EntryPopup title={`${ACTION[action][0]} - choose the entry`} onClose={() => setOpen(null)} width={760}>
                        {list(actionRows(action), r => runOn(action, r), 'No entries.')}
                        <p className="ent-note mt-2">{action === 'modify' ? 'A posted entry is reversed and reopened as a draft with the same number.' : action === 'cancel' ? 'Cancelling keeps the entry, marked cancelled; its accounts and stock effect is reversed.' : action === 'remove' ? 'Removing deletes the entry (a posted one is reversed first).' : 'Opens the print preview.'}</p>
                    </EntryPopup>
                );
            })()}
            {open === 'draft' && (
                <EntryPopup title="Open a Draft" onClose={() => setOpen(null)} width={720}>
                    <table className="erp-grid-table">
                        <thead><tr><th>Draft</th><th>Saved</th><th /></tr></thead>
                        <tbody>
                            {drafts.map(d => (
                                <tr key={d.id} className="cursor-pointer" onDoubleClick={() => pickDraft(d)}>
                                    <td>{d.label || 'Draft'}</td><td>{String(d.updated_at || d.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                                    <td className="text-right whitespace-nowrap">
                                        <button type="button" className="nav-btn small primary" onClick={() => pickDraft(d)}>Open</button>{' '}
                                        <button type="button" className="nav-btn small" onClick={() => discardDraft(d)} title="Discard draft">✕</button>
                                    </td>
                                </tr>
                            ))}
                            {drafts.length === 0 && <tr><td colSpan={3} className="text-center">No drafts saved.</td></tr>}
                        </tbody>
                    </table>
                    <p className="ent-note mt-2">A draft is kept apart - no number, no accounts or stock effect. Saving the entry removes the draft.</p>
                </EntryPopup>
            )}
        </div>
    );
}
