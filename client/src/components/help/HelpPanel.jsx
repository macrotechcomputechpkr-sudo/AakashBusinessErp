// =============================================
// components/help/HelpPanel.jsx
// "❓ Help" of the window toolbar: the help of the screen that is open -
// what it is for, how to use it, what it does to accounts / stock / VAT,
// and every field on it (searchable). Super admin also gets the PDF of
// this menu. The Help Center (/help) has all manuals.
// =============================================
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHelpCatalog, pageHelp } from './helpCatalog';

export default function HelpPanel({ pathname, isSuperAdmin, onClose }) {
    const catalog = useHelpCatalog();
    const [q, setQ] = useState('');
    const help = useMemo(() => pageHelp(catalog, pathname), [catalog, pathname]);
    const fields = (help?.fields || []).filter(([l, t]) => !q || `${l} ${t}`.toLowerCase().includes(q.toLowerCase()));
    const effects = help ? [['Accounts', help.accounts], ['Stock', help.stock], ['VAT', help.vat], ['Other modules', help.other]].filter(([, v]) => v) : [];

    return (
        <aside className="help-panel no-print" role="complementary" aria-label="Help">
            <div className="help-panel-head">
                <span>❓ Help{help ? ` - ${help.title}` : ''}</span>
                <button type="button" className="nav-wc-btn close" title="Close help" onClick={onClose}>✕</button>
            </div>
            <div className="help-panel-body">
                {!catalog && <p className="text-xs text-gray-500">Loading…</p>}
                {catalog && !help && <p className="text-sm">No screen help for this page yet. See the manuals in the <Link to="/help-center" onClick={onClose}>Help Center</Link>.</p>}
                {help && (
                    <>
                        <p className="text-sm mb-2">{help.purpose}</p>
                        <div className="flex flex-wrap gap-1 mb-2">
                            {isSuperAdmin && <a className="nav-btn small" href={help.pdf} target="_blank" rel="noreferrer">📄 PDF of this menu</a>}
                            <Link className="nav-btn small" to="/help-center" onClick={onClose}>📚 Help Center</Link>
                        </div>
                        {help.steps?.length > 0 && (
                            <section><h4>How to use</h4><ol>{help.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></section>
                        )}
                        {effects.length > 0 && (
                            <section><h4>Effect</h4>
                                <table data-no-smart className="help-table"><tbody>{effects.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
                            </section>
                        )}
                        {help.fields?.length > 0 && (
                            <section><h4>Fields ({help.fields.length})</h4>
                                <input className="erp-input mb-1" placeholder="Find a field…" value={q} onChange={e => setQ(e.target.value)} />
                                <table data-no-smart className="help-table"><tbody>{fields.map(([l, t]) => <tr key={l}><th>{l}</th><td>{t}</td></tr>)}</tbody></table>
                            </section>
                        )}
                        {help.tips?.length > 0 && (
                            <section><h4>Tips</h4><ul>{help.tips.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
                        )}
                        <p className="text-xs text-gray-500 mt-2">Hover a field caption on the form to see its help. Captions with help are underlined with dots.</p>
                    </>
                )}
            </div>
        </aside>
    );
}
