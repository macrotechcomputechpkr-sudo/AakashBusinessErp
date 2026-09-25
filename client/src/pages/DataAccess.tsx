// =============================================
// DataAccess.tsx  (/data-access)
// Which ledgers, sub-ledgers, products, product companies, product
// groups, customer categories and areas a user or security group may see.
// The server applies the rules to every list, picker, report and save
// (server/utils/dataAccess.js, database/122).
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import type { AuthFetch } from '../types/erp';

type Mode = 'inherit' | 'all' | 'only' | 'except';
interface Dim { key: string; label: string; tree: boolean }
interface Opt { id: string; name: string; parent_id: string | null; party?: boolean }
interface Rule { dimension: string; mode: Mode; ids: string[]; applies_to?: 'parties' | 'all' }
interface Subjects { users: { id: string; full_name: string; email: string; security_group_id: string | null; is_company_admin: boolean }[]; groups: { id: string; group_name: string }[] }
interface Preview { restricted: boolean; dims: Record<string, { total: number; visible: number }> }

const MODE_LABEL: Record<Mode, string> = { inherit: 'Same as security group', all: 'All (no restriction)', only: 'Only the ticked ones', except: 'All except the ticked ones' };

/** Options in tree order with depth, for groups / areas. */
function ordered(list: Opt[]): (Opt & { depth: number })[] {
    const kids = new Map<string | null, Opt[]>();
    list.forEach(o => { const p = o.parent_id && list.some(x => x.id === o.parent_id) ? o.parent_id : null; kids.set(p, [...(kids.get(p) || []), o]); });
    const out: (Opt & { depth: number })[] = [];
    const walk = (p: string | null, depth: number) => (kids.get(p) || []).forEach(o => { out.push({ ...o, depth }); walk(o.id, depth + 1); });
    walk(null, 0);
    return out;
}

function DimCard({ dim, rule, options, isUser, onChange }: { dim: Dim; rule: Rule; options: Opt[]; isUser: boolean; onChange: (r: Rule) => void }) {
    const [q, setQ] = useState('');
    const [partiesOnly, setPartiesOnly] = useState(true);
    const list = useMemo(() => {
        let l: (Opt & { depth: number })[] = dim.tree ? ordered(options) : options.map(o => ({ ...o, depth: 0 }));
        if (dim.key === 'ledger' && partiesOnly && rule.applies_to !== 'all') l = l.filter(o => o.party);
        const s = q.trim().toLowerCase();
        return s ? l.filter(o => o.name.toLowerCase().includes(s)) : l;
    }, [options, dim, q, partiesOnly, rule.applies_to]);
    const picked = new Set(rule.ids);
    const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); onChange({ ...rule, ids: Array.from(n) }); };
    const allShown = list.length > 0 && list.every(o => picked.has(o.id));
    const toggleShown = () => { const n = new Set(picked); list.forEach(o => (allShown ? n.delete(o.id) : n.add(o.id))); onChange({ ...rule, ids: Array.from(n) }); };
    const listing = rule.mode === 'only' || rule.mode === 'except';
    return (
        <div className={`border rounded-lg p-3 ${listing ? 'border-blue-300 bg-blue-50/30' : ''}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-semibold text-sm">{dim.label}</p>
                <select className="erp-select !w-auto text-sm" value={rule.mode} onChange={e => onChange({ ...rule, mode: e.target.value as Mode })}>
                    {(isUser ? ['inherit', 'all', 'only', 'except'] : ['all', 'only', 'except']).map(m => <option key={m} value={m}>{MODE_LABEL[m as Mode]}</option>)}
                </select>
            </div>
            {dim.key === 'ledger' && listing && (
                <div className="text-xs mb-2 space-y-1">
                    <label className="flex items-center gap-1"><input type="radio" checked={rule.applies_to !== 'all'} onChange={() => onChange({ ...rule, applies_to: 'parties' })} /> Applies to customer / supplier ledgers only (cash, bank, sales, expense ledgers stay usable)</label>
                    <label className="flex items-center gap-1"><input type="radio" checked={rule.applies_to === 'all'} onChange={() => onChange({ ...rule, applies_to: 'all' })} /> Applies to every ledger</label>
                    {rule.applies_to !== 'all' && <label className="flex items-center gap-1 text-gray-500"><input type="checkbox" checked={partiesOnly} onChange={e => setPartiesOnly(e.target.checked)} /> list parties only</label>}
                </div>
            )}
            {dim.tree && listing && <p className="text-[11px] text-gray-500 mb-1">Ticking a main {dim.key === 'area' ? 'area' : 'group'} includes everything under it.</p>}
            {listing && (
                <>
                    <input className="erp-input text-sm mb-1" placeholder={`Search ${dim.label.toLowerCase()}…`} value={q} onChange={e => setQ(e.target.value)} />
                    <div className="max-h-56 overflow-y-auto border rounded bg-white" data-enter-nav="off">
                        <label className="flex items-center gap-2 px-2 py-1 border-b bg-slate-50 text-xs font-semibold"><input type="checkbox" checked={allShown} onChange={toggleShown} /> Select all shown ({list.length})</label>
                        {list.slice(0, 2000).map(o => (
                            <label key={o.id} className="flex items-center gap-2 px-2 py-0.5 text-sm hover:bg-slate-50" style={{ paddingLeft: 8 + o.depth * 16 }}>
                                <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} /> {o.name}
                            </label>
                        ))}
                        {list.length === 0 && <p className="text-xs text-gray-400 p-2">Nothing to show</p>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{picked.size} ticked · {rule.mode === 'only' ? 'only these are visible' : 'these are hidden'}</p>
                </>
            )}
        </div>
    );
}

export default function DataAccess() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [dims, setDims] = useState<Dim[]>([]);
    const [subjects, setSubjects] = useState<Subjects>({ users: [], groups: [] });
    const [kind, setKind] = useState<'user' | 'group'>('user');
    const [subject, setSubject] = useState('');
    const [rules, setRules] = useState<Record<string, Rule>>({});
    const [options, setOptions] = useState<Record<string, Opt[]>>({});
    const [preview, setPreview] = useState<Preview | null>(null);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        Promise.all([authFetch<Dim[]>('/api/data-access/meta'), authFetch<Subjects>('/api/data-access/subjects')])
            .then(([m, s]) => {
                setDims(m.data); setSubjects(s.data);
                m.data.forEach(d => authFetch<Opt[]>(`/api/data-access/options/${d.key}`).then(r => setOptions(o => ({ ...o, [d.key]: r.data }))).catch(() => undefined));
            })
            .catch((e: Error) => setError(e.message));
    }, [authFetch]);

    const blank = useCallback((isUser: boolean): Record<string, Rule> => Object.fromEntries(dims.map(d => [d.key, { dimension: d.key, mode: (isUser ? 'inherit' : 'all') as Mode, ids: [] as string[], applies_to: 'parties' } as Rule])), [dims]);
    const load = useCallback(async () => {
        if (!subject) return;
        setError('');
        try {
            const r = await authFetch<Rule[]>(`/api/data-access/rules?${kind === 'user' ? 'user_id' : 'security_group_id'}=${subject}`);
            const next = blank(kind === 'user');
            r.data.forEach(x => { next[x.dimension] = { dimension: x.dimension, mode: x.mode, ids: x.ids || [], applies_to: x.applies_to || 'parties' }; });
            setRules(next);
            if (kind === 'user') authFetch<Preview>(`/api/data-access/preview?user_id=${subject}`).then(p => setPreview(p.data)).catch(() => setPreview(null));
            else setPreview(null);
        } catch (e) { setError((e as Error).message); }
    }, [authFetch, subject, kind, blank]);
    useEffect(() => { setMsg(''); load(); }, [load]);

    const save = async () => {
        setSaving(true); setMsg(''); setError('');
        try {
            await authFetch('/api/data-access/rules', { method: 'PUT', body: JSON.stringify({ [kind === 'user' ? 'user_id' : 'security_group_id']: subject, rules: Object.values(rules) }) });
            setMsg('Saved - the user sees the change within a minute (or at next sign-in).');
            load();
        } catch (e) { setError((e as Error).message); }
        finally { setSaving(false); }
    };
    const user = subjects.users.find(u => u.id === subject);
    const groupName = (id: string | null) => subjects.groups.find(g => g.id === id)?.group_name || '—';

    return (
        <Layout>
            <div className="p-4 md:p-6">
                <div className="erp-card">
                    <div className="erp-header">🔐 Data Access - what each user may see</div>
                    <div className="erp-tab-content">
                        <p className="text-sm text-gray-600 mb-3">Restrict ledgers, sub-ledgers, products, product companies, product groups, customer categories and areas. The rules apply to every list, picker, report and save. Company admins always see everything; a user's own setting wins over the security group's.</p>
                        <div className="flex flex-wrap items-end gap-3 mb-4" data-enter-scope>
                            <div className="erp-field"><label className="erp-label">Set rules for</label>
                                <select className="erp-select" value={kind} onChange={e => { setKind(e.target.value as 'user' | 'group'); setSubject(''); setRules({}); }}>
                                    <option value="user">A user</option><option value="group">A security group (all its users)</option></select></div>
                            <div className="erp-field min-w-[260px]"><label className="erp-label">{kind === 'user' ? 'User' : 'Security group'}</label>
                                <select className="erp-select" value={subject} onChange={e => setSubject(e.target.value)}>
                                    <option value="">- choose -</option>
                                    {kind === 'user' ? subjects.users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}{u.is_company_admin ? ' (admin)' : ''}</option>)
                                        : subjects.groups.map(g => <option key={g.id} value={g.id}>{g.group_name}</option>)}
                                </select></div>
                            {subject && <button type="button" className="erp-btn primary" onClick={save} disabled={saving}>💾 Save rules</button>}
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}
                        {user && (
                            <div className="text-sm mb-3 flex flex-wrap gap-2 items-center">
                                <span className="text-gray-600">Security group: <b>{groupName(user.security_group_id)}</b></span>
                                {user.is_company_admin && <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">Company admin - rules are not applied</span>}
                                {preview && Object.entries(preview.dims).map(([k, v]) => (
                                    <span key={k} className={`px-2 py-0.5 rounded text-xs border ${v.visible < v.total ? 'border-blue-400 text-blue-800' : 'text-gray-500'}`}>
                                        {dims.find(d => d.key === k)?.label}: {v.visible}/{v.total}</span>
                                ))}
                            </div>
                        )}
                        {subject && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                {dims.map(d => rules[d.key] && (
                                    <DimCard key={d.key} dim={d} rule={rules[d.key]} options={options[d.key] || []} isUser={kind === 'user'}
                                        onChange={r => setRules(x => ({ ...x, [d.key]: r }))} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
