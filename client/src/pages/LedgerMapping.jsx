// =============================================
// LedgerMapping.jsx
// Bulk reassignment tool: pick a target (Account Group / Agent / Area),
// checkbox-select which ledger accounts should point at it, and Apply.
// Original implementation - our own naming/API/design, not copied from
// any reference software; only the general "bulk mapping" concept.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import Layout from '../components/Layout';

const TABS = [
    { key: 'account_group_id', label: 'Group', targetEndpoint: '/api/account-groups', targetLabelKey: 'group_name' },
    { key: 'agent_id', label: 'Agent', targetEndpoint: '/api/salesman-agents', targetLabelKey: 'agent_name' },
    { key: 'area_id', label: 'Area', targetEndpoint: '/api/areas', targetLabelKey: 'area_name' }
];

export default function LedgerMapping() {
    const { authFetch } = useAuth();
    const enterAreaRef = useRef(null);
    useEnterKeyNavigation(enterAreaRef);
    const [tab, setTab] = useState(TABS[0].key);
    const [ledgers, setLedgers] = useState([]);
    const [targets, setTargets] = useState([]);
    const [selectedTarget, setSelectedTarget] = useState('');
    const [checked, setChecked] = useState({});
    const [search, setSearch] = useState('');
    const [alert, setAlert] = useState(null);
    const [loading, setLoading] = useState(false);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };
    const activeTab = TABS.find(t => t.key === tab);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [ledgerRes, targetRes] = await Promise.all([
                authFetch(`/api/ledger-accounts/mapping-list?field=${tab}`),
                authFetch(activeTab.targetEndpoint)
            ]);
            setLedgers(ledgerRes.data || []);
            setTargets(targetRes.data || []);
            setChecked({});
            setSelectedTarget('');
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authFetch, tab]);

    useEffect(() => { load(); }, [load]);

    const targetLabelFor = (id) => {
        if (!id) return '—';
        const t = targets.find(x => x.id === id);
        return t ? t[activeTab.targetLabelKey] : '—';
    };

    const filteredLedgers = ledgers.filter(l => (l.account_name + l.account_code).toLowerCase().includes(search.toLowerCase()));
    const allChecked = filteredLedgers.length > 0 && filteredLedgers.every(l => checked[l.id]);

    const toggleAll = (value) => setChecked(c => { const n = { ...c }; filteredLedgers.forEach(l => { n[l.id] = value; }); return n; });
    const invertAll = () => setChecked(c => { const n = { ...c }; filteredLedgers.forEach(l => { n[l.id] = !c[l.id]; }); return n; });
    const toggleOne = (id) => setChecked(c => ({ ...c, [id]: !c[id] }));

    const apply = async () => {
        const ids = Object.entries(checked).filter(([, v]) => v).map(([id]) => id);
        if (ids.length === 0) return showAlert('Select at least one ledger account first', 'danger');
        try {
            const res = await authFetch('/api/ledger-accounts/bulk-map', {
                method: 'PUT',
                body: JSON.stringify({ field: tab, target_id: selectedTarget || null, ledger_account_ids: ids })
            });
            showAlert(res.message, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    return (
        <Layout>
        <div ref={enterAreaRef} className="max-w-5xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Ledger Mapping</h1>
            <p className="text-sm text-gray-500 mb-4">Bulk-assign many ledger accounts to a Group, Agent, or Area at once.</p>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            <div className="flex gap-2 mb-4 border-b">
                {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="bg-white border rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Assign selected ledgers to this {activeTab.label}</label>
                    <select className="erp-input" value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)}>
                        <option value="">(Clear mapping)</option>
                        {targets.map(t => <option key={t.id} value={t.id}>{t[activeTab.targetLabelKey]}</option>)}
                    </select>
                </div>
                <button onClick={apply} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">Apply to Selected</button>
            </div>

            <div className="bg-white border rounded-xl overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 p-3 border-b">
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Search ledgers..." className="flex-1 min-w-[160px] border rounded px-2 py-1.5 text-sm" />
                    <button onClick={() => toggleAll(true)} className="px-2 py-1.5 border rounded text-xs">Select All</button>
                    <button onClick={() => toggleAll(false)} className="px-2 py-1.5 border rounded text-xs">Deselect All</button>
                    <button onClick={invertAll} className="px-2 py-1.5 border rounded text-xs">Invert</button>
                </div>
                <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-3 py-2 w-10"><input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} /></th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Ledger</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Current {activeTab.label}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan={3} className="text-center py-8 text-gray-400">Loading…</td></tr>}
                            {!loading && filteredLedgers.length === 0 && <tr><td colSpan={3} className="text-center py-8 text-gray-400">No ledger accounts found.</td></tr>}
                            {filteredLedgers.map(l => (
                                <tr key={l.id} className="border-t hover:bg-gray-50">
                                    <td className="px-3 py-2"><input type="checkbox" checked={!!checked[l.id]} onChange={() => toggleOne(l.id)} /></td>
                                    <td className="px-3 py-2">{l.account_name} <span className="text-xs text-gray-400">({l.account_code})</span></td>
                                    <td className="px-3 py-2 text-gray-600">{targetLabelFor(l[tab])}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        </Layout>
    );
}
