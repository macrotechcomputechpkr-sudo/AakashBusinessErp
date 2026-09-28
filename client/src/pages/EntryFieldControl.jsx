// =============================================
// EntryFieldControl.jsx
// Per-field control of every voucher type's Master + Detail fields:
// Enable / Read Only / Hide / Compulsory, for everyone (Global), for a User
// Group, or for one User. Priority when a person enters a voucher: their
// own User rule, then their User Group's rule, then the Global rule.
// Pick the voucher type and who it is for, set the modes in the grid and
// Save - "Inherit" (group / user) removes that level's rule.
// Server: routes/entryFieldControlRoutes.js (PUT /entry-field-controls/bulk)
// =============================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';

const FALLBACK_TYPES = [
    ['sales_quotation', 'Sales Quotation'], ['sales_order', 'Sales Order'], ['sales_delivery', 'Sales Delivery / Challan'], ['sales_bill', 'Sales Bill'],
    ['sales_return', 'Sales Return'], ['sales_nonsalable_return', 'Sales Non-saleable Return'], ['sales_additional', 'Sales Additional Expense'],
    ['purchase_requisition', 'Purchase Requisition'], ['purchase_quotation', 'Purchase Quotation'], ['purchase_order', 'Purchase Order'], ['purchase_grn', 'Purchase GRN'],
    ['purchase_bill', 'Purchase Bill'], ['purchase_return', 'Purchase Return'], ['purchase_nonsalable_return', 'Purchase Non-saleable Return'], ['purchase_additional', 'Purchase Additional Expense'],
    ['cash_bank_entry', 'Cash / Bank Receipt & Payment'], ['journal', 'Journal Voucher'], ['cash', 'Cash Voucher'], ['bank', 'Bank Voucher'], ['pdc', 'PDC (Post-Dated Cheque)'],
    ['debit_note', 'Debit Note'], ['credit_note', 'Credit Note'], ['stock_transfer', 'Stock Transfer'], ['production', 'Production Entry']
].map(([value, label]) => ({ value, label }));

const MODES = [
    { value: 'enabled', label: 'Enable', cls: 'text-green-700' },
    { value: 'readonly', label: 'Read Only', cls: 'text-amber-700' },
    { value: 'disabled', label: 'Hide', cls: 'text-gray-600' },
    { value: 'compulsory', label: 'Compulsory', cls: 'text-red-700' }
];
const modeLabel = m => (MODES.find(x => x.value === m) || { label: 'Enable' }).label;
const SOURCE = { user: 'User rule', user_group: 'Group rule', global: 'Global rule', default: 'Default' };

export default function EntryFieldControl() {
    const { authFetch } = useAuth();
    const enterAreaRef = useRef(null);
    useEnterKeyNavigation(enterAreaRef);
    const [types, setTypes] = useState(FALLBACK_TYPES);
    const [voucherType, setVoucherType] = useState('sales_bill');
    const [scope, setScope] = useState('global');
    const [target, setTarget] = useState('');
    const [catalog, setCatalog] = useState([]);
    const [controls, setControls] = useState([]);
    const [groups, setGroups] = useState([]);
    const [users, setUsers] = useState([]);
    const [userModes, setUserModes] = useState({}); // resolved for the picked user
    const [draft, setDraft] = useState({}); // field_key -> mode | 'inherit'
    const [search, setSearch] = useState('');
    const [errors, setErrors] = useState([]);
    const [msg, setMsg] = useState(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);

    // pickers load once; a failure here must not empty the field list
    useEffect(() => {
        authFetch('/api/voucher-types').then(r => r.data?.length && setTypes(r.data)).catch(() => {});
        authFetch('/api/security-groups').then(r => setGroups(Array.isArray(r.data) ? r.data : [])).catch(() => {});
        authFetch('/api/users?pageSize=500').then(r => setUsers(Array.isArray(r.data) ? r.data : (r.data?.users || []))).catch(() => {});
    }, [authFetch]);

    const load = useCallback(async () => {
        setLoading(true);
        const errs = [];
        const [cat, ctl] = await Promise.all([
            authFetch(`/api/voucher-field-catalog?voucher_type=${voucherType}`).catch(e => { errs.push(`Field list: ${e.message}`); return { data: [] }; }),
            authFetch(`/api/entry-field-controls?voucher_type=${voucherType}`).catch(e => { errs.push(`Saved rules: ${e.message}`); return { data: [] }; })
        ]);
        setCatalog(cat.data || []);
        setControls(ctl.data || []);
        setErrors(errs);
        setDraft({});
        setLoading(false);
    }, [authFetch, voucherType]);
    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        setUserModes({});
        if (scope !== 'user' || !target) return;
        authFetch(`/api/entry-field-controls/resolve?voucher_type=${voucherType}&user_id=${target}`)
            .then(r => setUserModes(Object.fromEntries((r.data || []).map(f => [f.field_key, f]))))
            .catch(() => {});
    }, [authFetch, voucherType, scope, target, controls]);

    const ruleOf = useCallback((key, sc = scope, tg = target) => controls.find(c => c.field_key === key && c.scope === sc
        && (sc === 'global' || (sc === 'user_group' ? c.user_group_id === tg : c.user_id === tg))), [controls, scope, target]);

    // what the chosen level currently says, and what applies if it says nothing
    const current = useCallback((key) => {
        const own = ruleOf(key);
        if (scope === 'global') return { own: own ? own.mode : 'enabled', inherited: null };
        if (scope === 'user_group') {
            const g = ruleOf(key, 'global');
            return { own: own ? own.mode : 'inherit', inherited: { mode: g ? g.mode : 'enabled', from: g ? 'global' : 'default' } };
        }
        const u = users.find(x => x.id === target);
        const gRule = u?.security_group_id && ruleOf(key, 'user_group', u.security_group_id);
        const g = ruleOf(key, 'global');
        const inh = gRule ? { mode: gRule.mode, from: 'user_group' } : { mode: g ? g.mode : 'enabled', from: g ? 'global' : 'default' };
        return { own: own ? own.mode : 'inherit', inherited: inh, effective: userModes[key] };
    }, [ruleOf, scope, target, users, userModes]);

    const fields = useMemo(() => {
        const q = search.trim().toLowerCase();
        return catalog.filter(f => !q || `${f.field_label} ${f.field_key}`.toLowerCase().includes(q));
    }, [catalog, search]);
    // one rule per field key (master and detail share it)
    const keys = useMemo(() => [...new Set(fields.map(f => f.field_key))], [fields]);
    const valueOf = key => (draft[key] !== undefined ? draft[key] : current(key).own);
    const systemRequired = key => catalog.some(f => f.field_key === key && f.is_system_required);
    const setMode = (key, mode) => setDraft(d => {
        const n = { ...d, [key]: mode };
        if (n[key] === current(key).own) delete n[key];
        return n;
    });
    const setAll = (mode) => setDraft(() => {
        const n = {};
        keys.forEach(k => { if (mode === 'disabled' && systemRequired(k)) return; if (mode !== current(k).own) n[k] = mode; });
        return n;
    });
    const changed = Object.keys(draft).length;
    const needsTarget = scope !== 'global' && !target;

    const save = async () => {
        if (needsTarget) return setMsg({ type: 'danger', text: `Pick the ${scope === 'user' ? 'User' : 'User Group'} first` });
        setSaving(true);
        try {
            const r = await authFetch('/api/entry-field-controls/bulk', { method: 'PUT', body: JSON.stringify({
                voucher_type: voucherType, scope, user_group_id: scope === 'user_group' ? target : undefined, user_id: scope === 'user' ? target : undefined, modes: draft }) });
            setMsg({ type: 'success', text: `Saved - ${r.data.saved} rule(s) set, ${r.data.removed} removed` });
            await load();
        } catch (e) {
            setMsg({ type: 'danger', text: e.message });
        } finally { setSaving(false); }
    };

    const overridesSummary = useMemo(() => {
        const g = {}, u = {};
        controls.forEach(c => {
            if (c.scope === 'user_group') g[c.user_group_id] = (g[c.user_group_id] || 0) + 1;
            if (c.scope === 'user') u[c.user_id] = (u[c.user_id] || 0) + 1;
        });
        return { g, u };
    }, [controls]);

    const renderRows = (section) => {
        const list = fields.filter(f => f.section === section);
        if (!list.length) return <tr><td colSpan={9} className="px-3 py-2 text-xs text-gray-400">No {section} fields{search ? ' match' : ''}.</td></tr>;
        const seen = new Set();
        return list.map(f => {
            const shared = seen.has(f.field_key) || (section === 'detail' && catalog.some(x => x.section === 'master' && x.field_key === f.field_key));
            seen.add(f.field_key);
            const cur = current(f.field_key);
            const val = valueOf(f.field_key);
            const dirty = draft[f.field_key] !== undefined;
            const opts = scope === 'global' ? MODES : [{ value: 'inherit', label: 'Inherit', cls: 'text-blue-700' }, ...MODES];
            return (
                <tr key={`${section}:${f.field_key}`} className={`border-t ${dirty ? 'bg-yellow-50' : ''}`}>
                    <td className="px-3 py-1.5">
                        <div className="text-sm font-medium">{f.field_label}{f.is_system_required && <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1 rounded uppercase">System</span>}{f.auto_added && <span className="ml-2 text-[10px] bg-blue-50 text-blue-600 px-1 rounded">screen</span>}</div>
                        <div className="text-[11px] text-gray-400">{f.field_key}{shared ? ' · same rule as the master field' : ''}</div>
                    </td>
                    {opts.map(m => (
                        <td key={m.value} className="px-2 py-1.5 text-center">
                            <input type="radio" name={`${section}:${f.field_key}`} aria-label={`${f.field_label} ${m.label}`} checked={val === m.value}
                                disabled={shared || (m.value === 'disabled' && f.is_system_required)} onChange={() => setMode(f.field_key, m.value)} />
                        </td>
                    ))}
                    <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">
                        {scope === 'global' ? '' : val === 'inherit' ? `${modeLabel(cur.inherited.mode)} (${SOURCE[cur.inherited.from]})` : modeLabel(val)}
                        {scope === 'user' && cur.effective && draft[f.field_key] === undefined && <div className="text-[11px]">now: {modeLabel(cur.effective.effective_mode)}</div>}
                    </td>
                </tr>
            );
        });
    };

    const head = scope === 'global' ? MODES : [{ value: 'inherit', label: 'Inherit' }, ...MODES];
    const table = (section, title) => (
        <div className="bg-white border rounded-lg mb-4 overflow-x-auto">
            <p className="text-xs font-semibold text-gray-600 uppercase px-3 pt-3 pb-1">{title}</p>
            <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-xs text-gray-600">
                    <th className="text-left px-3 py-1.5">Field</th>
                    {head.map(m => <th key={m.value} className="px-2 py-1.5 w-20">{m.label}</th>)}
                    <th className="text-left px-3 py-1.5">{scope === 'global' ? '' : 'Applies'}</th>
                </tr></thead>
                <tbody>{renderRows(section)}</tbody>
            </table>
        </div>
    );

    return (
        <Layout>
            <div ref={enterAreaRef} className="max-w-6xl mx-auto p-4">
                <h1 className="text-2xl font-bold mb-1">Entry Field Control</h1>
                <p className="text-xs text-gray-500 mb-4">
                    For each field choose Enable, Read Only, Hide or Compulsory - for everyone (Global), a User Group, or one User.
                    A person gets their own User rule first, then their Group&apos;s, then the Global one. &quot;Inherit&quot; removes that level&apos;s rule.
                </p>

                {errors.map(e => <div key={e} className="mb-2 px-3 py-2 rounded bg-red-50 border-l-4 border-red-500 text-red-800 text-sm">{e}</div>)}
                {msg && <div className={`mb-3 px-3 py-2 rounded text-sm border-l-4 ${msg.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' : 'bg-red-50 border-red-500 text-red-800'}`}>{msg.text} <button type="button" className="ml-2" onClick={() => setMsg(null)}>✕</button></div>}

                <div className="bg-white border rounded-lg p-3 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                    <div>
                        <label className="block text-xs font-medium mb-1">Voucher Type</label>
                        <select className="erp-input w-full" value={voucherType} onChange={e => { if (!changed || window.confirm('Discard unsaved changes?')) setVoucherType(e.target.value); }}>
                            {types.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1">Apply to</label>
                        <select className="erp-input w-full" value={scope} onChange={e => { setScope(e.target.value); setTarget(''); setDraft({}); }}>
                            <option value="global">Everyone (Global)</option>
                            <option value="user_group">A User Group</option>
                            <option value="user">A User</option>
                        </select>
                    </div>
                    <div className="min-w-0">
                        {scope !== 'global' && <>
                            <label className="block text-xs font-medium mb-1">{scope === 'user' ? 'User' : 'User Group'}</label>
                            {scope === 'user_group' ? (
                                <SearchablePopupSelect listKey="efc_group_picker" columns={[{ key: 'group_name', label: 'Group' }, { key: 'group_code', label: 'Code' }]} defaultVisibleKeys={['group_name', 'group_code']}
                                    items={groups} getId={g => g.id} getLabel={g => g.group_name} searchKeys={['group_name', 'group_code']} value={target} onChange={v => { setTarget(v); setDraft({}); }} placeholder="Select group" />
                            ) : (
                                <SearchablePopupSelect listKey="efc_user_picker" columns={[{ key: 'full_name', label: 'Name' }, { key: 'email', label: 'Email' }]} defaultVisibleKeys={['full_name', 'email']}
                                    items={users} getId={u => u.id} getLabel={u => u.full_name || u.email} searchKeys={['full_name', 'email']} value={target} onChange={v => { setTarget(v); setDraft({}); }} placeholder="Select user" />
                            )}
                        </>}
                    </div>
                    <div>
                        <label className="block text-xs font-medium mb-1">Find field</label>
                        <input className="erp-input w-full" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or key" />
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                    <span className="text-gray-600">Set all shown to:</span>
                    {head.map(m => <button key={m.value} type="button" className="nav-btn small" disabled={needsTarget} onClick={() => setAll(m.value)}>{m.label}</button>)}
                    <span className="flex-1" />
                    {(Object.keys(overridesSummary.g).length > 0 || Object.keys(overridesSummary.u).length > 0) && (
                        <span className="text-gray-500">Rules here: {Object.entries(overridesSummary.g).map(([id, n]) => `${groups.find(g => g.id === id)?.group_name || 'group'} (${n})`)
                            .concat(Object.entries(overridesSummary.u).map(([id, n]) => `${users.find(u => u.id === id)?.full_name || 'user'} (${n})`)).join(', ')}</span>
                    )}
                </div>

                {loading ? <p className="text-sm text-gray-500">Loading…</p> : catalog.length === 0 && !errors.length ? (
                    <p className="text-sm text-gray-500 bg-white border rounded p-4">No fields are listed for this voucher type yet. Open its entry screen once - the fields it shows are added here automatically.</p>
                ) : needsTarget ? (
                    <p className="text-sm text-gray-500 bg-white border rounded p-4">Pick the {scope === 'user' ? 'User' : 'User Group'} to see and change its rules.</p>
                ) : (
                    <>
                        {table('master', 'Master (header) fields')}
                        {table('detail', 'Detail (line item) fields')}
                    </>
                )}

                <div className="sticky bottom-0 bg-white border-t py-2 flex items-center gap-3">
                    <span className="text-sm text-gray-600">{changed ? `${changed} unsaved change(s)` : 'No changes'}</span>
                    <button type="button" className="erp-btn primary" disabled={!changed || saving || needsTarget} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
                    <button type="button" className="erp-btn" disabled={!changed} onClick={() => setDraft({})}>Undo changes</button>
                </div>
            </div>
        </Layout>
    );
}
