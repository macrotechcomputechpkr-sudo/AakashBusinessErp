// =============================================
// PricingMasters.jsx
// Masters behind automatic sales pricing (resolved by
// /api/resolve-sales-price in Sales Bill / Order / Quotation):
//   * Rate Category  -> which product rate tier (SR1..SR5) a customer gets
//   * Discount Group -> with the product's Company, gives a discount %
//   * Discount Matrix -> Discount Group x Product Company grid of %
// A customer gets a Rate Category and a Discount Group on their ledger
// (Chart of Accounts > Ledger Accounts).
// =============================================

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import Layout from '../components/Layout';

export default function PricingMasters() {
    const { authFetch } = useAuth();
    const enterFormRef0 = useRef(null);
    useEnterKeyNavigation(enterFormRef0);
    const enterFormRef1 = useRef(null);
    useEnterKeyNavigation(enterFormRef1);
    const [tab, setTab] = useState('matrix');
    const [rateCats, setRateCats] = useState([]);
    const [groups, setGroups] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [matrix, setMatrix] = useState({});        // saved: {groupId: {companyId: pct}}
    const [draft, setDraft] = useState({});          // edits in progress, same shape
    const [rcForm, setRcForm] = useState({ id: null, category_name: '', sr_tier: 1, is_active: true });
    const [dgForm, setDgForm] = useState({ id: null, group_name: '' });
    const [companyFilter, setCompanyFilter] = useState('');
    const [alert, setAlert] = useState(null);
    const [saving, setSaving] = useState(false);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [rc, dg, pc, dm] = await Promise.all([
                authFetch('/api/rate-categories'), authFetch('/api/discount-groups'),
                authFetch('/api/product-companies'), authFetch('/api/discount-matrix')
            ]);
            setRateCats(rc.data || []);
            setGroups(dg.data || []);
            setCompanies(pc.data || []);
            const m = {};
            (dm.data || []).forEach(c => { (m[c.discount_group_id] = m[c.discount_group_id] || {})[c.product_company_id] = Number(c.discount_percent); });
            setMatrix(m);
            setDraft({});
        } catch (err) { showAlert(err.message, 'danger'); }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    // ---------- Rate Categories ----------
    const saveRateCat = async (e) => {
        e.preventDefault();
        if (!rcForm.category_name.trim()) return showAlert('Name is required', 'danger');
        try {
            const body = JSON.stringify({ category_name: rcForm.category_name.trim(), sr_tier: Number(rcForm.sr_tier), is_active: rcForm.is_active });
            if (rcForm.id) await authFetch(`/api/rate-categories/${rcForm.id}`, { method: 'PUT', body });
            else await authFetch('/api/rate-categories', { method: 'POST', body });
            showAlert(rcForm.id ? 'Rate category updated' : 'Rate category created', 'success');
            setRcForm({ id: null, category_name: '', sr_tier: 1, is_active: true });
            load();
        } catch (err) { showAlert(err.message, 'danger'); }
    };
    const deleteRateCat = async (r) => {
        if (!window.confirm(`Delete rate category "${r.category_name}"?`)) return;
        try { await authFetch(`/api/rate-categories/${r.id}`, { method: 'DELETE' }); showAlert('Deleted', 'warning'); load(); }
        catch (err) { showAlert(err.message, 'danger'); }
    };

    // ---------- Discount Groups ----------
    const saveGroup = async (e) => {
        e.preventDefault();
        if (!dgForm.group_name.trim()) return showAlert('Name is required', 'danger');
        try {
            const body = JSON.stringify({ group_name: dgForm.group_name.trim() });
            if (dgForm.id) await authFetch(`/api/discount-groups/${dgForm.id}`, { method: 'PUT', body });
            else await authFetch('/api/discount-groups', { method: 'POST', body });
            showAlert(dgForm.id ? 'Discount group updated' : 'Discount group created', 'success');
            setDgForm({ id: null, group_name: '' });
            load();
        } catch (err) { showAlert(err.message, 'danger'); }
    };
    const deleteGroup = async (g) => {
        if (!window.confirm(`Delete discount group "${g.group_name}"? Its discount % for every company is removed too.`)) return;
        try { await authFetch(`/api/discount-groups/${g.id}`, { method: 'DELETE' }); showAlert('Deleted', 'warning'); load(); }
        catch (err) { showAlert(err.message, 'danger'); }
    };

    // ---------- Matrix ----------
    const cellValue = (gid, cid) => draft[gid]?.[cid] !== undefined ? draft[gid][cid] : (matrix[gid]?.[cid] ?? '');
    const setCell = (gid, cid, v) => setDraft(d => ({ ...d, [gid]: { ...(d[gid] || {}), [cid]: v } }));
    const changedGroupIds = Object.keys(draft).filter(gid => Object.entries(draft[gid]).some(([cid, v]) => String(v) !== String(matrix[gid]?.[cid] ?? '')));
    const fillRow = (gid, v) => setDraft(d => ({ ...d, [gid]: Object.fromEntries(companies.map(c => [c.id, v])) }));
    const fillColumn = (cid, v) => setDraft(d => { const n = { ...d }; groups.forEach(g => { n[g.id] = { ...(n[g.id] || {}), [cid]: v }; }); return n; });

    const saveMatrix = async () => {
        // Validate first so nothing is half-saved.
        for (const gid of changedGroupIds) for (const [cid, v] of Object.entries(draft[gid])) {
            if (v === '') continue;
            const n = Number(v);
            if (Number.isNaN(n) || n < 0 || n > 100) {
                const g = groups.find(x => x.id === gid)?.group_name, c = companies.find(x => x.id === cid)?.company_name;
                return showAlert(`${g} / ${c}: discount must be between 0 and 100`, 'danger');
            }
        }
        setSaving(true);
        try {
            for (const gid of changedGroupIds) {
                const cells = Object.entries(draft[gid]).map(([cid, v]) => ({ product_company_id: cid, discount_percent: v === '' ? 0 : Number(v) }));
                await authFetch(`/api/discount-matrix/${gid}`, { method: 'PUT', body: JSON.stringify({ cells }) });
            }
            showAlert(`Saved ${changedGroupIds.length} discount group(s)`, 'success');
            load();
        } catch (err) { showAlert(err.message, 'danger'); }
        finally { setSaving(false); }
    };

    const visibleCompanies = useMemo(() => {
        const t = companyFilter.trim().toLowerCase();
        return t ? companies.filter(c => String(c.company_name).toLowerCase().includes(t)) : companies;
    }, [companies, companyFilter]);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">💲 Rate Category & Discount Group</span></div>
            {alert && <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm border-l-4 ${alert.type === 'success' ? 'bg-green-50 border-green-500' : alert.type === 'danger' ? 'bg-red-50 border-red-500' : 'bg-yellow-50 border-yellow-500'}`}>{alert.message}</div>}

            <div className="flex gap-1 px-4 pt-3 border-b">
                {[['matrix', 'Discount Matrix'], ['groups', 'Discount Groups'], ['rate', 'Rate Categories']].map(([k, l]) =>
                    <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm border-b-2 ${tab === k ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-500'}`}>{l}</button>)}
            </div>

            <div className="erp-tab-content">
                <p className="text-xs text-gray-500 mb-3">Set a customer's Rate Category and Discount Group on their ledger (Chart of Accounts). Sales Bill, Order and Quotation then fill the rate and discount automatically when a product is chosen.</p>

                {tab === 'rate' && (
                    <>
                        <form ref={enterFormRef0} onSubmit={saveRateCat} className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 items-end">
                            <div className="erp-field"><label className="erp-label">Category Name</label><input className="erp-input" value={rcForm.category_name} onChange={e => setRcForm({ ...rcForm, category_name: e.target.value })} placeholder="e.g. Wholesale" /></div>
                            <div className="erp-field"><label className="erp-label">Uses Product Rate</label>
                                <select className="erp-select" value={rcForm.sr_tier} onChange={e => setRcForm({ ...rcForm, sr_tier: e.target.value })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Sales Rate {n} (SR{n})</option>)}</select></div>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rcForm.is_active} onChange={e => setRcForm({ ...rcForm, is_active: e.target.checked })} /> Active</label>
                            <div className="flex gap-2">
                                {rcForm.id && <button type="button" className="erp-btn" onClick={() => setRcForm({ id: null, category_name: '', sr_tier: 1, is_active: true })}>Cancel</button>}
                                <button type="submit" className="erp-btn primary">{rcForm.id ? 'Update' : 'Add'}</button>
                            </div>
                        </form>
                        <table className="erp-grid-table"><thead><tr><th>Name</th><th>Product Rate Used</th><th>Status</th><th></th></tr></thead>
                            <tbody>{rateCats.map(r => (
                                <tr key={r.id}><td>{r.category_name}</td><td>SR{r.sr_tier}</td><td>{r.is_active ? 'Active' : 'Inactive'}</td>
                                    <td className="flex gap-2 justify-center"><button onClick={() => setRcForm({ id: r.id, category_name: r.category_name, sr_tier: r.sr_tier, is_active: r.is_active })} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                        <button onClick={() => deleteRateCat(r)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Delete</button></td></tr>))}
                                {rateCats.length === 0 && <tr><td colSpan={4} className="text-center text-gray-400 py-4">No rate categories yet.</td></tr>}</tbody></table>
                    </>
                )}

                {tab === 'groups' && (
                    <>
                        <form ref={enterFormRef1} onSubmit={saveGroup} className="flex gap-3 mb-4 items-end">
                            <div className="erp-field flex-1 max-w-sm"><label className="erp-label">Discount Group Name</label><input className="erp-input" value={dgForm.group_name} onChange={e => setDgForm({ ...dgForm, group_name: e.target.value })} placeholder="e.g. Retailer A" /></div>
                            {dgForm.id && <button type="button" className="erp-btn" onClick={() => setDgForm({ id: null, group_name: '' })}>Cancel</button>}
                            <button type="submit" className="erp-btn primary">{dgForm.id ? 'Update' : 'Add'}</button>
                        </form>
                        <table className="erp-grid-table"><thead><tr><th>Name</th><th>Companies with a discount</th><th></th></tr></thead>
                            <tbody>{groups.map(g => (
                                <tr key={g.id}><td>{g.group_name}</td><td>{Object.values(matrix[g.id] || {}).filter(v => v > 0).length}</td>
                                    <td className="flex gap-2 justify-center"><button onClick={() => setDgForm({ id: g.id, group_name: g.group_name })} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Edit</button>
                                        <button onClick={() => deleteGroup(g)} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Delete</button></td></tr>))}
                                {groups.length === 0 && <tr><td colSpan={3} className="text-center text-gray-400 py-4">No discount groups yet.</td></tr>}</tbody></table>
                    </>
                )}

                {tab === 'matrix' && (
                    groups.length === 0 || companies.length === 0 ? (
                        <p className="text-sm text-gray-500">Create at least one Discount Group (and Product Companies in the product masters) to fill the matrix.</p>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center gap-3 mb-3">
                                <input className="border rounded-lg px-3 py-1.5 text-sm" placeholder="Filter companies…" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} />
                                <button onClick={saveMatrix} disabled={saving || changedGroupIds.length === 0} className="erp-btn primary">{saving ? 'Saving…' : `💾 Save changes${changedGroupIds.length ? ` (${changedGroupIds.length} group${changedGroupIds.length > 1 ? 's' : ''})` : ''}`}</button>
                                {changedGroupIds.length > 0 && <button onClick={() => setDraft({})} className="erp-btn">Discard</button>}
                                <span className="text-xs text-gray-400">Discount % for each Discount Group (rows) on each Product Company (columns). Blank = 0.</span>
                            </div>
                            <div className="overflow-auto border rounded-lg" style={{ maxHeight: '65vh' }}>
                                <table className="text-sm border-collapse">
                                    <thead className="sticky top-0 bg-slate-100 z-10">
                                        <tr>
                                            <th className="px-3 py-2 text-left border-b sticky left-0 bg-slate-100">Discount Group \ Company</th>
                                            {visibleCompanies.map(c => (
                                                <th key={c.id} className="px-2 py-2 border-b text-xs font-semibold whitespace-nowrap">
                                                    <div>{c.company_name}</div>
                                                    <input type="number" step="0.01" placeholder="all %" title="Set this % for every group"
                                                        className="mt-1 w-16 border rounded px-1 text-xs font-normal" onKeyDown={e => { if (e.key === 'Enter') { fillColumn(c.id, e.currentTarget.value); e.currentTarget.value = ''; } }} />
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {groups.map(g => (
                                            <tr key={g.id} className={changedGroupIds.includes(g.id) ? 'bg-yellow-50' : ''}>
                                                <td className="px-3 py-1 border-b sticky left-0 bg-white whitespace-nowrap">
                                                    <div className="font-medium">{g.group_name}</div>
                                                    <input type="number" step="0.01" placeholder="all %" title="Set this % for every company"
                                                        className="w-16 border rounded px-1 text-xs" onKeyDown={e => { if (e.key === 'Enter') { fillRow(g.id, e.currentTarget.value); e.currentTarget.value = ''; } }} />
                                                </td>
                                                {visibleCompanies.map(c => {
                                                    const v = cellValue(g.id, c.id);
                                                    const changed = draft[g.id]?.[c.id] !== undefined && String(draft[g.id][c.id]) !== String(matrix[g.id]?.[c.id] ?? '');
                                                    return (
                                                        <td key={c.id} className="px-1 py-1 border-b text-center">
                                                            <input type="number" step="0.01" min="0" max="100" value={v} onChange={e => setCell(g.id, c.id, e.target.value)}
                                                                className={`w-16 border rounded px-1 text-right ${changed ? 'border-amber-500 bg-amber-50' : ''}`} />
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">Tip: type a % in a header box and press Enter to fill that whole column or row.</p>
                        </>
                    )
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
