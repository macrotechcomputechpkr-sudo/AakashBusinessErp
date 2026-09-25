// =============================================
// SearchablePopupSelect.jsx
// A keyboard-first "combobox" replacing plain <select> for master-data
// pickers (Department, Designation, Security Group, and any future
// picker like Products), matching the classic ERP/Tally-style flow:
//
//   Enter (popup closed)  -> opens the popup, highlights the first row
//   Type anything          -> filters the list live, popup opens automatically
//   Arrow Up/Down           -> move the highlight
//   Enter (popup open)     -> selects the highlighted row, closes the
//                              popup, AND advances focus to the next form
//                              field (via focusNextInForm) - so the whole
//                              form stays keyboard-driven end to end.
//   Escape                  -> closes without changing the selection
//
// The popup also has a "⚙️ Columns" panel: check/uncheck which columns are
// visible, reorder them with ↑/↓, and save the current layout as a named
// preset shared "All users", private "Just me", or "Selected users" (a
// specific list of teammates) - exactly the "with buy rate / without buy
// rate" style multi-preset request. `columns` is a superset the caller
// defines; this component and its preset system are list-agnostic, so the
// same mechanism works unchanged for a future Product/Item picker.
// =============================================

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { focusNextInForm } from '../hooks/useEnterKeyNavigation';

export default function SearchablePopupSelect({
    listKey,
    columns,               // [{ key, label }] - full superset of available columns
    defaultVisibleKeys,    // string[] - which column keys show before any preset is picked
    items,                 // array of data rows
    getId,                 // (item) => string
    getLabel,              // (item) => string, shown in the closed input
    searchKeys,            // string[] - fields matched against the typed search text
    value,
    onChange,              // (id, item) => void
    placeholder = 'Search...',
    onAddNew,               // optional () => void, rendered as a footer button in the popup
    required = false,
    disabled = false,
    onLastField             // optional () => bool, forwarded to focusNextInForm for tab-aware forms
}) {
    const { authFetch, isSuperAdmin } = useAuth();
    const containerRef = useRef(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [highlight, setHighlight] = useState(0);
    const [colPanelOpen, setColPanelOpen] = useState(false);
    const [saveAsOpen, setSaveAsOpen] = useState(false);

    const defaultColumnsConfig = useMemo(
        () => columns.map((c, i) => ({ key: c.key, visible: defaultVisibleKeys.includes(c.key), order: i })),
        [columns, defaultVisibleKeys]
    );
    const [columnsConfig, setColumnsConfig] = useState(defaultColumnsConfig);

    const [presets, setPresets] = useState([]);
    const [activePresetId, setActivePresetId] = useState(null);
    const [tenantUsers, setTenantUsers] = useState([]);
    const [saveForm, setSaveForm] = useState({ name: '', scope: 'me', selectedUserIds: [] });

    const selectedItem = useMemo(() => items.find(i => getId(i) === value), [items, value, getId]);

    const applyPreset = useCallback((preset) => {
        setColumnsConfig(preset.columns);
        setActivePresetId(preset.id);
        localStorage.setItem(`preset_${listKey}`, preset.id);
    }, [listKey]);

    // ---------- load presets ----------
    const loadPresets = useCallback(async () => {
        try {
            const res = await authFetch(`/api/list-presets?list_key=${encodeURIComponent(listKey)}`);
            const list = res.data || [];
            setPresets(list);

            const remembered = localStorage.getItem(`preset_${listKey}`);
            const toApply = list.find(p => p.id === remembered) || list.find(p => p.is_default);
            if (toApply) applyPreset(toApply);
        } catch (err) {
            // Non-fatal - the picker still works with the built-in default columns.
        }
    }, [authFetch, listKey, applyPreset]);

    useEffect(() => { loadPresets(); }, [loadPresets]);

    const loadTenantUsers = useCallback(async () => {
        try {
            const res = await authFetch('/api/users?pageSize=100&sortBy=full_name&sortDir=asc');
            setTenantUsers(res.data || []);
        } catch (err) {
            setTenantUsers([]); // user may lack permission to list users - "Selected users" scope will just show none to pick
        }
    }, [authFetch]);

    // ---------- filtering ----------
    const filtered = useMemo(() => {
        if (!search.trim()) return items;
        const s = search.toLowerCase();
        return items.filter(item => searchKeys.some(k => String(item[k] || '').toLowerCase().includes(s)));
    }, [items, search, searchKeys]);

    useEffect(() => { setHighlight(0); }, [search, open]);

    // ---------- click outside closes the popup ----------
    useEffect(() => {
        const onClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
                setColPanelOpen(false);
                setSaveAsOpen(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    const openPopup = () => { if (!disabled) setOpen(true); };

    const selectItem = (item) => {
        if (item) onChange(getId(item), item);
        setOpen(false);
        setSearch('');
        const form = inputRef.current?.closest('form');
        if (form) focusNextInForm(form, inputRef.current, onLastField);
        else inputRef.current?.focus();
    };

    const handleKeyDown = (e) => {
        if (disabled) return;

        if (!open) {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation(); // opt out of the generic form-level Enter handler
                openPopup();
            }
            return; // any other key (typing) is handled by onChange below, which also opens the popup
        }

        // popup is open
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight(h => Math.min(h + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight(h => Math.max(h - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            selectItem(filtered[highlight] || filtered[0]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setSearch('');
        }
    };

    const visibleColumns = columnsConfig
        .filter(c => c.visible)
        .sort((a, b) => a.order - b.order)
        .map(c => columns.find(col => col.key === c.key))
        .filter(Boolean);

    const toggleColumnVisible = (key) => {
        setColumnsConfig(cfg => cfg.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
    };

    const moveColumn = (key, dir) => {
        setColumnsConfig(cfg => {
            const sorted = [...cfg].sort((a, b) => a.order - b.order);
            const idx = sorted.findIndex(c => c.key === key);
            const swapIdx = idx + dir;
            if (swapIdx < 0 || swapIdx >= sorted.length) return cfg;
            const tmp = sorted[idx].order;
            sorted[idx].order = sorted[swapIdx].order;
            sorted[swapIdx].order = tmp;
            return sorted.map(c => ({ ...c }));
        });
    };

    const openSaveAs = () => {
        setSaveForm({ name: '', scope: 'me', selectedUserIds: [] });
        if (tenantUsers.length === 0) loadTenantUsers();
        setSaveAsOpen(true);
    };

    const savePreset = async () => {
        if (!saveForm.name.trim()) return;
        try {
            const res = await authFetch('/api/list-presets', {
                method: 'POST',
                body: JSON.stringify({
                    list_key: listKey,
                    preset_name: saveForm.name.trim(),
                    columns: columnsConfig,
                    scope: saveForm.scope,
                    allowed_user_ids: saveForm.scope === 'selected' ? saveForm.selectedUserIds : undefined
                })
            });
            setPresets(p => [...p, res.data]);
            applyPreset(res.data);
            setSaveAsOpen(false);
        } catch (err) {
            alert(err.message);
        }
    };

    const updateActivePreset = async () => {
        if (!activePresetId) return;
        try {
            await authFetch(`/api/list-presets/${activePresetId}`, {
                method: 'PUT',
                body: JSON.stringify({ columns: columnsConfig })
            });
        } catch (err) {
            alert(err.message);
        }
    };

    const deleteActivePreset = async () => {
        if (!activePresetId) return;
        if (!window.confirm('Delete this preset?')) return;
        try {
            await authFetch(`/api/list-presets/${activePresetId}`, { method: 'DELETE' });
            setPresets(p => p.filter(x => x.id !== activePresetId));
            setActivePresetId(null);
            localStorage.removeItem(`preset_${listKey}`);
        } catch (err) {
            alert(err.message);
        }
    };

    return (
        <div className="relative" ref={containerRef}>
            <div className="flex gap-2">
                <input
                    ref={inputRef}
                    type="text"
                    required={required}
                    disabled={disabled}
                    className="flex-1 border rounded-lg px-3 py-2"
                    placeholder={placeholder}
                    value={open ? search : (selectedItem ? getLabel(selectedItem) : '')}
                    onFocus={openPopup}
                    onClick={openPopup}
                    onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                />
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setColPanelOpen(o => !o)}
                    className="px-2 py-2 border rounded-lg text-sm text-gray-500 hover:bg-gray-50"
                    title="Column settings"
                >
                    ⚙️
                </button>
            </div>

            {open && (
                <div className="absolute z-30 mt-1 w-full min-w-[420px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {presets.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 text-xs">
                            <span className="text-gray-500">Preset:</span>
                            <select
                                data-enter-skip="true"
                                className="border rounded px-2 py-1 text-xs flex-1"
                                value={activePresetId || ''}
                                onChange={(e) => {
                                    const p = presets.find(x => x.id === e.target.value);
                                    if (p) applyPreset(p); else { setColumnsConfig(defaultColumnsConfig); setActivePresetId(null); }
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <option value="">Default columns</option>
                                {presets.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {p.preset_name} {p.scope === 'all' ? '(All users)' : p.scope === 'selected' ? '(Selected users)' : '(Me)'}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {colPanelOpen && (
                        <div className="p-3 border-b bg-gray-50 space-y-2">
                            <p className="text-xs font-semibold text-gray-500">Columns (check to show, arrows to reorder)</p>
                            {[...columnsConfig].sort((a, b) => a.order - b.order).map(c => {
                                const col = columns.find(x => x.key === c.key);
                                if (!col) return null;
                                return (
                                    <div key={c.key} className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" data-enter-skip="true" checked={c.visible} onChange={() => toggleColumnVisible(c.key)} />
                                        <span className="flex-1">{col.label}</span>
                                        <button type="button" tabIndex={-1} onClick={() => moveColumn(c.key, -1)} className="text-gray-400 hover:text-gray-700">↑</button>
                                        <button type="button" tabIndex={-1} onClick={() => moveColumn(c.key, 1)} className="text-gray-400 hover:text-gray-700">↓</button>
                                    </div>
                                );
                            })}
                            <div className="flex gap-2 pt-2 border-t">
                                <button type="button" tabIndex={-1} onClick={openSaveAs} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">💾 Save as new preset</button>
                                {activePresetId && <button type="button" tabIndex={-1} onClick={updateActivePreset} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">Update preset</button>}
                                {activePresetId && <button type="button" tabIndex={-1} onClick={deleteActivePreset} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Delete</button>}
                            </div>

                            {saveAsOpen && (
                                <div className="mt-2 p-2 border rounded-lg bg-white space-y-2">
                                    <input
                                        data-enter-skip="true"
                                        className="w-full border rounded px-2 py-1 text-sm"
                                        placeholder='Preset name, e.g. "With Buy Rate"'
                                        value={saveForm.name}
                                        onChange={e => setSaveForm({ ...saveForm, name: e.target.value })}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); savePreset(); }
                                            if (e.key === 'Escape') { e.stopPropagation(); setSaveAsOpen(false); }
                                        }}
                                    />
                                    <div className="flex gap-3 text-xs">
                                        <label className="flex items-center gap-1">
                                            <input type="radio" data-enter-skip="true" checked={saveForm.scope === 'me'} onChange={() => setSaveForm({ ...saveForm, scope: 'me' })} /> Just me
                                        </label>
                                        <label className="flex items-center gap-1">
                                            <input type="radio" data-enter-skip="true" checked={saveForm.scope === 'all'} onChange={() => setSaveForm({ ...saveForm, scope: 'all' })} /> All users
                                        </label>
                                        <label className="flex items-center gap-1">
                                            <input type="radio" data-enter-skip="true" checked={saveForm.scope === 'selected'}
                                                onChange={() => { setSaveForm({ ...saveForm, scope: 'selected' }); loadTenantUsers(); }} /> Selected users
                                        </label>
                                    </div>
                                    {saveForm.scope === 'selected' && (
                                        <div className="max-h-28 overflow-y-auto border rounded p-1 space-y-1">
                                            {tenantUsers.length === 0 && <p className="text-xs text-gray-400">No users available (or you lack permission to list them).</p>}
                                            {tenantUsers.map(u => (
                                                <label key={u.id} className="flex items-center gap-1 text-xs">
                                                    <input
                                                        type="checkbox"
                                                        data-enter-skip="true"
                                                        checked={saveForm.selectedUserIds.includes(u.id)}
                                                        onChange={(e) => {
                                                            setSaveForm(f => ({
                                                                ...f,
                                                                selectedUserIds: e.target.checked
                                                                    ? [...f.selectedUserIds, u.id]
                                                                    : f.selectedUserIds.filter(id => id !== u.id)
                                                            }));
                                                        }}
                                                    />
                                                    {u.full_name}
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                    {saveForm.scope !== 'me' && !isSuperAdmin && (
                                        <p className="text-xs text-amber-600">Shared presets require the "company settings" permission - save may be rejected otherwise.</p>
                                    )}
                                    <div className="flex justify-end gap-2">
                                        <button type="button" tabIndex={-1} onClick={() => setSaveAsOpen(false)} className="px-2 py-1 border rounded text-xs">Cancel</button>
                                        <button type="button" tabIndex={-1} onClick={savePreset} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Save</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div ref={listRef} className="max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    {visibleColumns.map(col => (
                                        <th key={col.key} className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500 uppercase">{col.label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && (
                                    <tr><td colSpan={visibleColumns.length || 1} className="text-center text-gray-400 py-4">No matches</td></tr>
                                )}
                                {filtered.map((item, i) => (
                                    <tr
                                        key={getId(item)}
                                        onMouseEnter={() => setHighlight(i)}
                                        onClick={() => selectItem(item)}
                                        className={`cursor-pointer ${i === highlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                    >
                                        {visibleColumns.map(col => (
                                            <td key={col.key} className="px-3 py-1.5">{col.render ? col.render(item) : (item[col.key] ?? '-')}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {onAddNew && (
                        <div className="border-t p-2">
                            <button type="button" tabIndex={-1} onClick={() => { setOpen(false); onAddNew(); }} className="w-full px-3 py-1.5 bg-purple-600 text-white rounded text-sm">➕ Add New</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
