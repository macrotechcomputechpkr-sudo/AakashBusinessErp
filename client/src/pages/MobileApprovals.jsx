// =============================================
// MobileApprovals.jsx  (/mobile-approvals)
// Cash receipts and sales returns the salesmen entered on the phone
// (server: utils/mobileEntries.js). They wait here as drafts - no accounts
// or stock effect - until posted: tick one, several or all and Post. Each is
// posted through its own screen's posting (Cash / Bank Receipt, Sales
// Return), so GL, stock, bill-wise settlement and IRD work as usual. The
// salesman (agent) is already tagged on each entry. Open an entry in its
// screen to change it before posting.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useAuth } from '../contexts/AuthContext';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);

export default function MobileApprovals() {
    const { authFetch } = useAuth();
    const [agents, setAgents] = useState([]);
    const [f, setF] = useState({ type: 'all', status: 'pending', agent_id: [], date_from: iso(new Date(Date.now() - 30 * 86400000)), date_to: iso(new Date()) });
    const [data, setData] = useState(null);
    const [picked, setPicked] = useState(() => new Set());
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    useEffect(() => { authFetch('/api/salesman-agents').then(r => setAgents((r.data || []).map(a => ({ id: a.id, name: a.agent_name })))).catch(() => {}); }, [authFetch]);
    const load = useCallback(async () => {
        setBusy(true); setError('');
        const p = new URLSearchParams({ type: f.type, status: f.status, date_from: f.date_from, date_to: f.date_to });
        if (f.agent_id.length) p.set('agent_id', f.agent_id.join(','));
        try { setData((await authFetch(`/api/mobile-entries/pending?${p}`)).data); setPicked(new Set()); } catch (e) { setError(e.message); }
        setBusy(false);
    }, [authFetch, f]);
    useEffect(() => { load(); }, [load]);

    const key = r => `${r.type}:${r.id}`;
    const open = useMemo(() => (data?.rows || []).filter(r => r.status === 'draft'), [data]);
    const allTicked = open.length > 0 && open.every(r => picked.has(key(r)));
    const toggle = r => setPicked(s => { const n = new Set(s); if (n.has(key(r))) n.delete(key(r)); else n.add(key(r)); return n; });
    const tickedRows = (data?.rows || []).filter(r => picked.has(key(r)));
    const post = async () => {
        if (!tickedRows.length) return setError('Tick the entries to post');
        if (!window.confirm(`Post ${tickedRows.length} entr${tickedRows.length === 1 ? 'y' : 'ies'}? Accounts (and stock for returns) move now.`)) return;
        setBusy(true); setError(''); setMsg('');
        try {
            const r = (await authFetch('/api/mobile-entries/post', { method: 'POST', body: JSON.stringify({ items: tickedRows.map(x => ({ type: x.type, id: x.id })) }) })).data;
            const failed = r.results.filter(x => !x.ok);
            setMsg(`Posted ${r.posted}${failed.length ? ` · not posted ${failed.length}: ${failed.map(x => `${x.doc_no || ''} ${x.error}`).join('; ')}` : ''}`);
            load();
        } catch (e) { setError(e.message); }
        setBusy(false);
    };

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">📲 Mobile Approvals</span></div>
                    <div className="p-3">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3 items-end">
                            <div className="erp-field"><label className="erp-label">Type</label>
                                <select className="erp-select" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="all">Receipts and Returns</option><option value="receipt">Cash Receipts</option><option value="return">Sales Returns</option></select></div>
                            <div className="erp-field"><label className="erp-label">Status</label>
                                <select className="erp-select" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="pending">Pending approval</option><option value="posted">Posted</option><option value="all">All</option></select></div>
                            <MultiPick label="Salesman" items={agents} value={f.agent_id} onChange={v => setF({ ...f, agent_id: v })} />
                            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
                            <button className="erp-btn" onClick={load} disabled={busy}>↻ Refresh</button>
                        </div>
                        {error && <div className="nav-msg err mb-2">{error}</div>}
                        {msg && <div className="nav-msg ok mb-2">{msg}</div>}
                        {data && (
                            <>
                                <p className="text-sm mb-2">Receipts <b>{data.totals.receipts}</b> ({fmt(data.totals.receipt_amount)}) · Returns <b>{data.totals.returns}</b> ({fmt(data.totals.return_amount)})</p>
                                <div className="overflow-x-auto">
                                    <table className="erp-grid-table text-sm w-full">
                                        <thead><tr>
                                            <th><input type="checkbox" title="Tick all" checked={allTicked} disabled={!open.length} onChange={e => setPicked(e.target.checked ? new Set(open.map(key)) : new Set())} /></th>
                                            <th>Type</th><th>No</th><th>Date</th><th>Salesman</th><th>Route</th><th>Customer</th><th>Detail</th><th>Remarks</th><th className="text-right">Amount</th><th>Status</th><th />
                                        </tr></thead>
                                        <tbody>
                                            {data.rows.map(r => (
                                                <tr key={key(r)} className={picked.has(key(r)) ? 'bg-blue-50' : ''}>
                                                    <td><input type="checkbox" disabled={r.status !== 'draft'} checked={picked.has(key(r))} onChange={() => toggle(r)} /></td>
                                                    <td>{r.type === 'receipt' ? '💵 Receipt' : '↩ Return'}</td><td className="font-mono">{r.doc_no}</td><td>{r.doc_date}</td><td>{r.agent_name}</td><td>{r.route_name}</td><td>{r.party}</td>
                                                    <td className="text-xs">{r.detail}</td><td className="text-xs">{r.remarks}</td><td className="text-right">{fmt(r.amount)}</td>
                                                    <td className={r.status === 'draft' ? 'text-amber-700' : 'text-green-700'}>{r.status === 'draft' ? 'Pending' : r.status}</td>
                                                    <td><Link className="text-xs text-blue-600" to={r.type === 'receipt' ? '/cash-bank-entry' : '/sales-return'}>Open screen</Link></td>
                                                </tr>
                                            ))}
                                            {data.rows.length === 0 && <tr><td colSpan={12} className="text-center text-gray-400 py-4">Nothing {f.status === 'pending' ? 'waiting for approval' : 'found'}.</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex items-center justify-between mt-3">
                                    <span className="text-sm">{tickedRows.length} ticked · <b>{fmt(tickedRows.reduce((s, r) => s + r.amount, 0))}</b></span>
                                    <button className="erp-btn primary" disabled={busy || !tickedRows.length} onClick={post}>✔ Post ticked</button>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">Entries from the salesman's phone stay pending (no accounts / stock effect) until posted here. The salesman is already tagged as the agent on each.</p>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
