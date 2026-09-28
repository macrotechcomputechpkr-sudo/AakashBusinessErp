// =============================================
// components/entry/EntryFillBar.jsx
// The fill bar at the top of every transaction form:
//   From Template     - a saved template fills the new entry
//   Save as Template  - what is typed now, saved under a name (for everyone,
//                       or only for me)
//   From Previous     - a posted entry of this screen copied into a new one
//                       (new number and today's date)
//   From Draft        - a saved draft opens for finishing; saving it posts
//                       that same document, so the draft does not stay behind
// Templates: /api/entry-templates (documentActionRoutes.js). Previous entries
// and drafts come from the screen's own list (GET /api/<api>).
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { EntryPopup } from './EntryParts';
import { asNewCopy } from './DocActions';

const amountOf = r => r.grand_total ?? r.net_amount ?? r.total_amount ?? r.total ?? r.amount ?? r.total_debit ?? '';
const partyOf = r => r.customer_name_snapshot || r.vendor_name_snapshot || r.party_name_snapshot || r.ledger_name_snapshot || r.customer_name || r.vendor_name || r.party_name || r.customer?.account_name || r.vendor?.account_name || r.ledger?.account_name || r.narration || '';
const fmtAmt = v => (v === '' || v === null || v === undefined ? '' : (Number(v) || 0).toFixed(2));
const dateOf = r => String(r.doc_date || r.voucher_date || r.created_at || '').slice(0, 10);

/**
 * voucherType: template key (e.g. 'sales_bill'); api: list endpoint ('sales-bills');
 * form: what is typed now; onFill(payload): fill the new entry; onCopy(row): the screen's own copy of a
 * previous entry; onOpenDraft(row): the screen's own edit of a draft; editing: an entry is open for edit
 */
export default function EntryFillBar({ voucherType, api, form, onFill, onCopy, onOpenDraft, editing }) {
    const { authFetch } = useAuth();
    const [open, setOpen] = useState(null); // 'template' | 'previous' | 'draft'
    const [templates, setTemplates] = useState([]);
    const [rows, setRows] = useState([]);
    const [q, setQ] = useState('');
    const [msg, setMsg] = useState('');

    const loadTemplates = useCallback(async () => {
        try { const r = await authFetch(`/api/entry-templates?voucher_type=${voucherType}`); setTemplates(r.data || []); } catch { setTemplates([]); }
    }, [authFetch, voucherType]);
    const loadRows = useCallback(async () => {
        try { const r = await authFetch(`/api/${api}`); setRows(Array.isArray(r.data) ? r.data : (r.data?.rows || [])); } catch { setRows([]); }
    }, [authFetch, api]);
    useEffect(() => { loadRows(); loadTemplates(); }, [loadRows, loadTemplates]);

    const flash = m => { setMsg(m); setTimeout(() => setMsg(''), 3000); };
    const drafts = rows.filter(r => r.status === 'draft');
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
    const pickDraft = r => { setOpen(null); onOpenDraft(r); };
    const show = what => { setQ(''); setOpen(what); if (what === 'template') loadTemplates(); else loadRows(); };

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
        <div className="ent-fillbar" data-enter-nav="off">
            <span className="ent-fillbar-cap">Fill from</span>
            <button type="button" className="nav-btn small" disabled={editing} onClick={() => show('template')} title="Fill this entry from a saved template">📄 Template{templates.length ? ` (${templates.length})` : ''}</button>
            <button type="button" className="nav-btn small" disabled={editing} onClick={() => show('previous')} title="Copy a previous entry into this one">⟲ Previous Entry</button>
            <button type="button" className="nav-btn small" disabled={editing} onClick={() => show('draft')} title="Finish a saved draft (the draft becomes this entry)">📝 Draft{drafts.length ? ` (${drafts.length})` : ''}</button>
            <span className="ent-fillbar-sep" />
            <button type="button" className="nav-btn small" onClick={saveTemplate} title="Save what is typed now as a template">💾 Save as Template</button>
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
            {open === 'draft' && (
                <EntryPopup title="Finish a Draft" onClose={() => setOpen(null)} width={760}>
                    {list(drafts, pickDraft, 'No drafts saved.')}
                    <p className="ent-note mt-2">The draft opens as it is; when it is saved it becomes the entry and is no longer a draft.</p>
                </EntryPopup>
            )}
        </div>
    );
}
