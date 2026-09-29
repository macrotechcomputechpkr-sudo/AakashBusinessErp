// =============================================
// ReportViews.jsx - "📁 Views" on the title bar of every screen (Layout)
// Customise any report and keep it: Save As a named view (mine or shared
// with colleagues, one of mine opens by default), open it again later.
// A view keeps, for this screen:
//   * the active tab(s) (.erp-tab.active)
//   * the filter / option fields above the report (dates, selects, ticks,
//     amounts - pickers with a pop-up list are not kept)
//   * every report table's column filters, sort and hidden columns
//     (hooks/useExcelTableFilters.tsx; ▾ in a header > Hide this column,
//     Columns below to show them again)
//   * ▦ Grid / 📄 Report choice of each report table (hooks/useSmartTables)
//     and each grid's full state: search, filters, sort levels, groups,
//     footers, added columns, data bars, 📊 chart (grid/gridRegistry.js)
// Opening a view puts the fields back, presses the report's Show / Run
// button and puts the table filters back once the rows are in.
// Stored with the saved report views of the screen (/api/saved-report-views,
// report key "page:<path>"); screens with their own saved views keep them.
// =============================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { captureTables, restoreTables, resetTables, reportTables, tableHeaders, hiddenColumns, setColumnHidden } from '../hooks/useExcelTableFilters';
import { captureSmartModes, restoreSmartModes } from '../hooks/useSmartTables';
import { captureGrids, restoreGrids, resetGrids } from './grid/gridRegistry';

const txt = el => (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').replace(/[*▾▴•]/g, '').trim();
const SKIP_TYPES = new Set(['hidden', 'password', 'file', 'button', 'submit', 'reset', 'image']);

function labelOf(el, root) {
    if (el.id) { const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return txt(l); }
    const wrap = el.closest('label');
    if (wrap) return txt(wrap);
    const field = el.closest('.erp-field');
    if (field) { const l = field.querySelector('.erp-label, label'); if (l) return txt(l); }
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
}
/** the option / filter fields of the screen (not in tables, not pop-up pickers) */
function fields(root) {
    const seen = {};
    return Array.from(root.querySelectorAll('input, select, textarea')).filter(el => !SKIP_TYPES.has(el.type) && !el.disabled && !el.closest('table, [data-no-view], .sps-row')).map(el => {
        const base = `${el.tagName}:${el.type || ''}:${labelOf(el, root)}`;
        seen[base] = (seen[base] || 0) + 1;
        return { el, key: `${base}#${seen[base]}` };
    });
}
function captureFields(root) {
    return fields(root).map(({ el, key }) => ({ key, value: el.type === 'checkbox' || el.type === 'radio' ? undefined : el.value, checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined }));
}
// set a React-controlled field the way typing would
function setNative(el, v) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}
function applyFields(root, saved) {
    const byKey = Object.fromEntries((saved || []).map(f => [f.key, f]));
    fields(root).forEach(({ el, key }) => {
        const f = byKey[key];
        if (!f) return;
        if (f.checked !== undefined) { if (el.checked !== f.checked) el.click(); }
        else if (f.value !== undefined && el.value !== f.value) setNative(el, f.value);
    });
}
const activeTabs = root => Array.from(root.querySelectorAll('.erp-tab.active, [role="tab"][aria-selected="true"]')).map(txt).filter(Boolean);
function applyTabs(root, tabs) {
    (tabs || []).forEach(t => {
        const b = Array.from(root.querySelectorAll('.erp-tab, [role="tab"]')).find(x => txt(x) === t);
        if (b && !b.classList.contains('active')) b.click();
    });
}
// the report's own Show / Run button
function runButton(root) {
    const btns = Array.from(root.querySelectorAll('button')).filter(b => !b.disabled && !b.closest('table, .sg-mount, [data-no-view]') && /(^|\s|🔍)(show|run|generate|load|view report|search|refresh report)\b/i.test(txt(b)));
    return btns.find(b => b.classList.contains('primary')) || btns[0] || null;
}

export default function ReportViews({ rootRef }) {
    const { authFetch } = useAuth();
    const location = useLocation();
    const reportKey = `page:${location.pathname}`.slice(0, 60);
    const [open, setOpen] = useState(false);
    const [views, setViews] = useState([]);
    const [activeId, setActiveId] = useState('');
    const [name, setName] = useState('');
    const [shared, setShared] = useState(false);
    const [asDefault, setAsDefault] = useState(false);
    const [msg, setMsg] = useState(null);
    const [, force] = useState(0);
    const btnRef = useRef(null), boxRef = useRef(null), autoDone = useRef('');

    const load = useCallback(() => authFetch(`/api/saved-report-views?report_key=${encodeURIComponent(reportKey)}`).then(r => { setViews(r.data || []); return r.data || []; }).catch(() => []), [authFetch, reportKey]);

    const applyView = useCallback(async v => {
        const root = rootRef.current;
        if (!root || !v) return;
        const c = v.config_json || {};
        applyTabs(root, c.tabs);
        await new Promise(r => setTimeout(r, 250));
        applyFields(root, c.fields);
        await new Promise(r => setTimeout(r, 250));
        if (c.modes) restoreSmartModes(c.modes);
        restoreGrids(c.grids || {});
        restoreTables(root, c.tables || []);
        if (c.auto_run !== false) { const b = runButton(root); if (b) b.click(); }
        setActiveId(v.id);
    }, [rootRef]);

    // a view of mine marked default opens by itself once per visit of the screen
    useEffect(() => {
        setActiveId(''); setViews([]);
        let alive = true;
        load().then(list => {
            const def = list.find(v => v.is_default && v.is_mine);
            if (alive && def && autoDone.current !== location.pathname) { autoDone.current = location.pathname; setTimeout(() => applyView(def), 900); }
        });
        return () => { alive = false; };
    }, [load, location.pathname, applyView]);

    useEffect(() => {
        if (!open) return undefined;
        const close = e => { if (boxRef.current && !boxRef.current.contains(e.target) && !btnRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const flash = (m, t = 'ok') => { setMsg({ m, t }); setTimeout(() => setMsg(null), 3500); };
    const config = () => { const root = rootRef.current; return { tabs: activeTabs(root), fields: captureFields(root), tables: captureTables(root), modes: captureSmartModes(), grids: captureGrids(root), auto_run: true }; };
    const saveAs = async () => {
        if (!name.trim()) return flash('Give the view a name', 'err');
        try {
            const r = await authFetch('/api/saved-report-views', { method: 'POST', body: JSON.stringify({ report_key: reportKey, view_name: name.trim(), config_json: config(), is_shared: shared, is_default: asDefault }) });
            setName(''); setShared(false); setAsDefault(false); setActiveId(r.data?.id || ''); await load(); flash(`"${r.data?.view_name || name}" saved`);
        } catch (e) { flash(e.message, 'err'); }
    };
    const active = views.find(v => v.id === activeId);
    const overwrite = async () => {
        if (!active?.is_mine) return;
        try { await authFetch(`/api/saved-report-views/${active.id}`, { method: 'PUT', body: JSON.stringify({ config_json: config() }) }); flash(`"${active.view_name}" updated`); load(); } catch (e) { flash(e.message, 'err'); }
    };
    const toggleDefault = async () => {
        if (!active?.is_mine) return;
        try { await authFetch(`/api/saved-report-views/${active.id}`, { method: 'PUT', body: JSON.stringify({ is_default: !active.is_default }) }); load(); } catch (e) { flash(e.message, 'err'); }
    };
    const remove = async () => {
        if (!active?.is_mine || !window.confirm(`Delete view "${active.view_name}"?`)) return;
        try { await authFetch(`/api/saved-report-views/${active.id}`, { method: 'DELETE' }); setActiveId(''); load(); } catch (e) { flash(e.message, 'err'); }
    };

    const tables = open ? reportTables(rootRef.current) : [];
    const r = btnRef.current?.getBoundingClientRect();
    return (
        <>
            <button ref={btnRef} type="button" className="nav-pt-btn" title="Views: save this report's filters, options and columns as a named view, open it again" onClick={() => setOpen(o => !o)}>📁{active ? ` ${active.view_name}` : ''}</button>
            {open && createPortal(
                <div ref={boxRef} data-no-view data-enter-nav="off" className="fixed z-[1000] bg-white border border-slate-300 rounded-lg shadow-xl text-sm text-gray-800 w-[360px] max-h-[80vh] overflow-y-auto"
                    style={{ top: (r?.bottom || 60) + 4, left: Math.max(8, Math.min((r?.left || 8), window.innerWidth - 370)) }}>
                    <div className="px-3 py-2 border-b bg-slate-50 font-semibold">📁 Views of this report</div>
                    <div className="p-3 space-y-2">
                        <div className="max-h-44 overflow-y-auto border rounded">
                            {views.length === 0 && <p className="text-xs text-gray-500 p-2">No saved view yet - set the filters / columns, then Save As below.</p>}
                            {views.map(v => (
                                <button key={v.id} type="button" onClick={() => { applyView(v); setOpen(false); }} className={`w-full text-left px-2 py-1 hover:bg-blue-50 flex justify-between ${v.id === activeId ? 'bg-blue-50 font-semibold' : ''}`}>
                                    <span>{v.view_name}{v.is_default && v.is_mine ? ' ⭐' : ''}</span><span className="text-[10px] text-gray-500">{v.is_mine ? (v.is_shared ? 'mine · shared' : 'mine') : 'shared'}</span>
                                </button>
                            ))}
                        </div>
                        {active?.is_mine && (
                            <div className="flex flex-wrap gap-1">
                                <button type="button" className="nav-btn small" onClick={overwrite}>💾 Save changes to "{active.view_name}"</button>
                                <button type="button" className="nav-btn small" onClick={toggleDefault}>{active.is_default ? '☆ Not default' : '⭐ Open by default'}</button>
                                <button type="button" className="nav-btn small text-red-700" onClick={remove}>🗑</button>
                            </div>
                        )}
                        <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-600 mb-1">Save As a new view</div>
                            <input className="erp-input" placeholder="View name, e.g. Month-wise with PAN" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveAs(); } }} />
                            <div className="flex gap-3 mt-1 text-xs">
                                <label className="flex items-center gap-1"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} /> Share with colleagues</label>
                                <label className="flex items-center gap-1"><input type="checkbox" checked={asDefault} onChange={e => setAsDefault(e.target.checked)} /> Open by default</label>
                            </div>
                            <button type="button" className="erp-btn primary mt-1" onClick={saveAs}>📄 Save As</button>
                        </div>
                        <div className="border-t pt-2">
                            <div className="flex justify-between items-center"><span className="text-xs font-semibold text-gray-600">Columns (customise)</span>
                                <button type="button" className="text-xs underline" onClick={() => { resetTables(rootRef.current); resetGrids(rootRef.current); force(x => x + 1); }}>Reset filters & columns</button></div>
                            {tables.length === 0 && <p className="text-xs text-gray-500">Show the report first - its columns are listed here (▾ in a column header filters, sorts or hides it).</p>}
                            {tables.map((t, ti) => {
                                const hid = new Set(hiddenColumns(t));
                                return (
                                    <div key={ti} className="mt-1">
                                        {tables.length > 1 && <div className="text-[11px] text-gray-500">Table {ti + 1}</div>}
                                        <div className="grid grid-cols-2 gap-x-2">
                                            {tableHeaders(t).map((h, ci) => (
                                                <label key={ci} className="flex items-center gap-1 text-xs truncate"><input type="checkbox" checked={!hid.has(ci)} onChange={e => { setColumnHidden(t, ci, !e.target.checked); force(x => x + 1); }} /> {h || `Column ${ci + 1}`}</label>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {msg && <p className={`text-xs ${msg.t === 'err' ? 'text-red-700' : 'text-green-700'}`}>{msg.m}</p>}
                        <p className="text-[10px] text-gray-500">A view keeps the tab, the filter / option fields (not pop-up pickers), every table's filters, sort and hidden columns, and each ▦ Grid's groups, totals, added columns and 📊 chart.</p>
                    </div>
                </div>, document.body)}
        </>
    );
}
