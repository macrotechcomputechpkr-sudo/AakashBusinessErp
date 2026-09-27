// =============================================
// PricingMasters.jsx
// Masters behind automatic sales pricing (resolved by
// /api/resolve-sales-price in Sales Bill / Order / Quotation / Delivery):
//   * Multiple Rate Type -> Sr1..Sr5 captions + enable (Product Master labels)
//   * Rate Category      -> Sr tier + own product / unit / rate rows
//   * Discount Category  -> billing term, effect on rate, qty / value rules
//   * Company Discount Matrix -> Discount Category x Product Company %
//     (used when no rule of the category fits)
// ?tab=rate_types|rate|discount|matrix
// A customer gets a Rate Category and a Discount Group on their ledger
// (Chart of Accounts > Ledger Accounts).
// =============================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import { RateTypesEditor, RateCategoryEditor, DiscountCategoryEditor } from '../components/pricing/PricingEditors';

export default function PricingMasters() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'rate_types');
    const [groups, setGroups] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [matrix, setMatrix] = useState({});        // saved: {groupId: {companyId: pct}}
    const [draft, setDraft] = useState({});          // edits in progress, same shape
    const [companyFilter, setCompanyFilter] = useState('');
    const [alert, setAlert] = useState(null);
    const [saving, setSaving] = useState(false);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [dg, pc, dm] = await Promise.all([
                authFetch('/api/discount-groups'), authFetch('/api/product-companies'), authFetch('/api/discount-matrix')
            ]);
            setGroups(dg.data || []);
            setCompanies(pc.data || []);
            const m = {};
            (dm.data || []).forEach(c => { (m[c.discount_group_id] = m[c.discount_group_id] || {})[c.product_company_id] = Number(c.discount_percent); });
            setMatrix(m);
            setDraft({});
        } catch (err) { showAlert(err.message, 'danger'); }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

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
            <div className="erp-header"><span className="erp-header-title">💲 Rate Types, Rate Category & Discount Category</span></div>
            {alert && <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm border-l-4 ${alert.type === 'success' ? 'bg-green-50 border-green-500' : alert.type === 'danger' ? 'bg-red-50 border-red-500' : 'bg-yellow-50 border-yellow-500'}`}>{alert.message}</div>}

            <div className="erp-tabs">
                {[['rate_types', '📊 Multiple Rate Type'], ['rate', '👥 Rate Category'], ['discount', '🏷️ Discount Category'], ['matrix', '🏢 Company Discount Matrix']].map(([k, l]) =>
                    <button key={k} type="button" onClick={() => setTab(k)} className={`erp-tab ${tab === k ? 'active' : ''}`}>{l}</button>)}
            </div>

            <div className="erp-tab-content">
                <p className="text-xs text-gray-500 mb-3">Set a customer's Rate Category and Discount Category on their ledger (Chart of Accounts). Sales Quotation, Order, Delivery and Bill then fill the rate and discount automatically when a product is chosen.</p>

                {tab === 'rate_types' && <RateTypesEditor />}
                {tab === 'rate' && <RateCategoryEditor />}
                {tab === 'discount' && <DiscountCategoryEditor onChanged={load} />}

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
