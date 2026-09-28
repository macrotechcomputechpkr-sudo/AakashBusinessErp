// =============================================
// HelpCenter.jsx  (/help-center, Tools > Help Center)
// All manuals of the system, to read in the browser or download:
//   * User Manual (complete) and one per Business Nature
//   * IRD Billing - System Architecture and User Manual (every user)
//   * Developer Guide and the logic audit (super admin)
//   * the PDF of every menu screen (super admin) - the same help each
//     screen shows under ❓ Help
// The files are built by docs/tools/build_help.py into public/help (and
// kept in docs/pdf in the code).
// =============================================
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';

export default function HelpCenter() {
    const { isSuperAdmin } = useAuth();
    const [index, setIndex] = useState(null);
    const [err, setErr] = useState('');
    const [q, setQ] = useState('');

    useEffect(() => {
        fetch('/help/index.json').then(r => (r.ok ? r.json() : Promise.reject(new Error('Help files not found - run docs/tools/build_help.py'))))
            .then(setIndex).catch(e => setErr(e.message));
    }, []);

    const groups = useMemo(() => {
        const out = {};
        (index?.manuals || []).filter(m => m.audience !== 'admin' || isSuperAdmin).forEach(m => { (out[m.group] = out[m.group] || []).push(m); });
        return out;
    }, [index, isSuperAdmin]);
    const menus = useMemo(() => {
        const out = {};
        (index?.menus || []).filter(m => !q || `${m.title} ${m.module}`.toLowerCase().includes(q.toLowerCase())).forEach(m => { (out[m.module] = out[m.module] || []).push(m); });
        return out;
    }, [index, q]);

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">📚 Help Center</span></div>
                    <div className="p-3">
                        {err && <div className="nav-msg err">{err}</div>}
                        {!index && !err && <p className="text-sm text-gray-500">Loading…</p>}
                        {index && (
                            <>
                                <p className="text-sm mb-3">Every screen also has <b>❓ Help</b> on its toolbar (what it does, how to use it, its effect on accounts / stock / VAT, every field), and a tooltip on each field caption. Edition {index.built}.</p>
                                {Object.entries(groups).map(([g, list]) => (
                                    <div key={g} className="nav-groupbox">
                                        <span className="nav-groupbox-title">{g}</span>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {list.map(m => (
                                                <div key={m.file} className="flex items-start justify-between gap-2 border-b border-gray-200 py-1">
                                                    <div><div className="font-semibold text-sm">{m.title}</div><div className="text-xs text-gray-600">{m.subtitle}</div></div>
                                                    <div className="flex gap-1 shrink-0">
                                                        <a className="nav-btn small" href={m.file} target="_blank" rel="noreferrer">👁 Read</a>
                                                        <a className="nav-btn small" href={m.file} download>⬇ PDF</a>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                {isSuperAdmin ? (
                                    <div className="nav-groupbox">
                                        <span className="nav-groupbox-title">Menu help - PDF of every screen ({index.menus.length})</span>
                                        <input className="erp-input mb-2" style={{ maxWidth: 320 }} placeholder="Find a menu…" value={q} onChange={e => setQ(e.target.value)} />
                                        {Object.entries(menus).map(([mod, list]) => (
                                            <div key={mod} className="mb-2">
                                                <div className="text-xs font-bold text-[#1a4a8a] uppercase">{mod}</div>
                                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                                    {list.map(m => <span key={m.path}><Link to={m.path}>{m.title}</Link> <a href={m.pdf} target="_blank" rel="noreferrer" title="PDF">📄</a></span>)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-500">Open any screen and use ❓ Help on its toolbar for that screen's help.</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
