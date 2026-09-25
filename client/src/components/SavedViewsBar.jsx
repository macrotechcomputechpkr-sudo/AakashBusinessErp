// =============================================
// SavedViewsBar.jsx
// "Report Default Ra User Le Option Ra Filter Change Garera Save As
// Garne Option Dine. Tyo Multiple Rakhna Pawos" - drop onto any report
// page. The page owns its filter/option state; this bar only needs:
//   reportKey  - unique id of the report (e.g. 'ledger_report')
//   getConfig  - () => current filter/option state (plain JSON)
//   onApply    - (config) => page restores that state
//   onReset    - () => page restores its built-in Default
// The built-in Default is never stored, so it can't be overwritten.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function SavedViewsBar({ reportKey, getConfig, onApply, onReset }) {
    const { authFetch } = useAuth();
    const [views, setViews] = useState([]);
    const [activeId, setActiveId] = useState('');
    const [saveAsOpen, setSaveAsOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [newShared, setNewShared] = useState(false);
    const [newDefault, setNewDefault] = useState(false);
    const [message, setMessage] = useState(null);
    const autoApplied = useRef(false);

    const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 4000); };

    const loadViews = useCallback(async () => {
        try {
            const res = await authFetch(`/api/saved-report-views?report_key=${encodeURIComponent(reportKey)}`);
            setViews(res.data || []);
            return res.data || [];
        } catch (err) {
            flash(err.message, 'danger');
            return [];
        }
    }, [authFetch, reportKey]);

    // Re-load when the report changes (e.g. Register switched module),
    // and open the person's own default view once, automatically.
    useEffect(() => {
        autoApplied.current = false;
        setActiveId('');
        loadViews().then(list => {
            const mine = list.find(v => v.is_default && v.is_mine);
            if (mine && !autoApplied.current) {
                autoApplied.current = true;
                setActiveId(mine.id);
                onApply(mine.config_json || {});
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reportKey]);

    const active = views.find(v => v.id === activeId) || null;

    const selectView = (id) => {
        setActiveId(id);
        if (!id) { onReset(); return; }
        const v = views.find(x => x.id === id);
        if (v) onApply(v.config_json || {});
    };

    const handleSave = async () => {
        if (!active) { setSaveAsOpen(true); return; }
        if (!active.is_mine) { flash('This view was shared by a colleague - use Save As to keep your own copy', 'danger'); return; }
        try {
            await authFetch(`/api/saved-report-views/${active.id}`, { method: 'PUT', body: JSON.stringify({ config_json: getConfig() }) });
            flash(`"${active.view_name}" saved`);
            loadViews();
        } catch (err) { flash(err.message, 'danger'); }
    };

    const handleSaveAs = async () => {
        if (!newName.trim()) return flash('Give the view a name', 'danger');
        try {
            const res = await authFetch('/api/saved-report-views', {
                method: 'POST',
                body: JSON.stringify({ report_key: reportKey, view_name: newName.trim(), config_json: getConfig(), is_shared: newShared, is_default: newDefault })
            });
            await loadViews();
            setActiveId(res.data.id);
            setSaveAsOpen(false); setNewName(''); setNewShared(false); setNewDefault(false);
            flash(res.message);
        } catch (err) { flash(err.message, 'danger'); }
    };

    const handleDelete = async () => {
        if (!active || !active.is_mine) return;
        if (!window.confirm(`Delete saved view "${active.view_name}"?`)) return;
        try {
            await authFetch(`/api/saved-report-views/${active.id}`, { method: 'DELETE' });
            setActiveId(''); onReset(); loadViews();
            flash('View deleted', 'warning');
        } catch (err) { flash(err.message, 'danger'); }
    };

    const toggleMyDefault = async () => {
        if (!active || !active.is_mine) return;
        try {
            await authFetch(`/api/saved-report-views/${active.id}`, { method: 'PUT', body: JSON.stringify({ is_default: !active.is_default }) });
            flash(active.is_default ? 'No longer opens by default' : `"${active.view_name}" will open by default`);
            loadViews();
        } catch (err) { flash(err.message, 'danger'); }
    };

    return (
        <div className="border rounded-lg p-2 mb-3 bg-slate-50">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-500">📁 View:</span>
                <select className="erp-select max-w-xs" value={activeId} onChange={e => selectView(e.target.value)}>
                    <option value="">Default</option>
                    {views.filter(v => v.is_mine).length > 0 && (
                        <optgroup label="My Views">
                            {views.filter(v => v.is_mine).map(v => <option key={v.id} value={v.id}>{v.view_name}{v.is_default ? ' ⭐' : ''}{v.is_shared ? ' 👥' : ''}</option>)}
                        </optgroup>
                    )}
                    {views.filter(v => !v.is_mine).length > 0 && (
                        <optgroup label="Shared by Colleagues">
                            {views.filter(v => !v.is_mine).map(v => <option key={v.id} value={v.id}>{v.view_name}</option>)}
                        </optgroup>
                    )}
                </select>
                <button type="button" onClick={handleSave} className="erp-btn" title={active ? 'Overwrite this view with the current filters' : 'Save current filters as a new view'}>💾 Save</button>
                <button type="button" onClick={() => setSaveAsOpen(s => !s)} className="erp-btn">📄 Save As</button>
                {active?.is_mine && (
                    <>
                        <button type="button" onClick={toggleMyDefault} className="erp-btn">{active.is_default ? '☆ Unset Default' : '⭐ Open by Default'}</button>
                        <button type="button" onClick={handleDelete} className="erp-btn text-red-600">🗑 Delete</button>
                    </>
                )}
                {message && <span className={`text-xs ml-2 ${message.type === 'danger' ? 'text-red-600' : message.type === 'warning' ? 'text-amber-600' : 'text-green-700'}`}>{message.text}</span>}
            </div>
            {saveAsOpen && (
                <div className="flex flex-wrap items-center gap-3 mt-2">
                    <input className="erp-input max-w-xs" autoFocus placeholder="View name, e.g. Customer Wise" value={newName} onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveAs(); } }} />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={newShared} onChange={e => setNewShared(e.target.checked)} /> Share with colleagues</label>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={newDefault} onChange={e => setNewDefault(e.target.checked)} /> Open this by default</label>
                    <button type="button" onClick={handleSaveAs} className="erp-btn primary">Save View</button>
                    <button type="button" onClick={() => setSaveAsOpen(false)} className="erp-btn">Cancel</button>
                </div>
            )}
        </div>
    );
}
