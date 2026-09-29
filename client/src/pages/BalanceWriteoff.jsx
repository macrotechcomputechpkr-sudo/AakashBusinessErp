// =============================================
// BalanceWriteoff.jsx  (/balance-writeoff; Journal Voucher > Small Balance Write-off)
// Nil many small customer / supplier balances in one Journal Voucher
// (jv_type 'balance_writeoff', server: utils/balanceWriteoff.js):
//   choose customers / suppliers / both, Dr / Cr / both balances, "up to"
//   amount (e.g. 50), date, area / agent -> list -> tick all or some ->
//   Dr balances: Dr discount allowed / Cr party; Cr balances: Dr party /
//   Cr discount received. Open bills of each party are settled too.
// Cancel the voucher in Journal Voucher to undo it (GL and bill-wise).
// =============================================
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useAuth } from '../contexts/AuthContext';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);

export default function BalanceWriteoff() {
    const { authFetch } = useAuth();
    const [m, setM] = useState({ ledgers: [], areas: [], agents: [] });
    const [f, setF] = useState({ side: 'customer', balance: 'both', max_amount: 50, min_amount: '', as_on: iso(new Date()), area_ids: [], agent_ids: [] });
    const [post, setPost] = useState({ dr_ledger_id: '', cr_ledger_id: '', narration: '' });
    const [data, setData] = useState(null);
    const [picked, setPicked] = useState(() => new Set());
    const [reg, setReg] = useState([]);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const loadReg = () => authFetch('/api/balance-writeoff/register').then(r => setReg(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    useEffect(() => {
        const load = u => authFetch(u).then(r => r.data || []).catch(() => []);
        Promise.all([load('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc'), load('/api/areas'), load('/api/salesman-agents')]).then(([l, a, g]) => setM({
            ledgers: Array.isArray(l) ? l : l.rows || [], areas: (a || []).map(x => ({ id: x.id, name: x.area_name })), agents: (g || []).map(x => ({ id: x.id, name: x.agent_name })) }));
        loadReg();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authFetch]);
    const discountLedgers = useMemo(() => m.ledgers.filter(l => !['sales', 'purchase', 'both', 'cash', 'bank'].includes(l.category_type)), [m.ledgers]);

    const preview = async () => {
        setBusy(true); setError(''); setMsg('');
        const p = new URLSearchParams({ side: f.side, balance: f.balance, max_amount: f.max_amount, as_on: f.as_on });
        if (f.min_amount) p.set('min_amount', f.min_amount);
        if (f.area_ids.length) p.set('area_ids', f.area_ids.join(','));
        if (f.agent_ids.length) p.set('agent_ids', f.agent_ids.join(','));
        try { const r = (await authFetch(`/api/balance-writeoff/preview?${p}`)).data; if (!r || !Array.isArray(r.rows)) throw new Error('No data returned'); setData(r); setPicked(new Set(r.rows.map(x => x.party_id))); } catch (e) { setError(e.message); }
        setBusy(false);
    };
    const ticked = (data?.rows || []).filter(r => picked.has(r.party_id));
    const dr = ticked.filter(r => r.nature === 'dr').reduce((s, r) => s + r.amount, 0), cr = ticked.filter(r => r.nature === 'cr').reduce((s, r) => s + r.amount, 0);
    const doPost = async () => {
        if (!ticked.length) return setError('Tick the parties');
        if (!window.confirm(`Write off ${ticked.length} balance(s)? One Journal Voucher: Dr balances ${fmt(dr)}, Cr balances ${fmt(cr)}.`)) return;
        setBusy(true); setError('');
        try {
            const r = (await authFetch('/api/balance-writeoff/post', { method: 'POST', body: JSON.stringify({ ...post, as_on: f.as_on, max_amount: f.max_amount, party_ids: ticked.map(x => x.party_id) }) })).data;
            setMsg(`Journal Voucher ${r.doc_no} posted: ${r.parties} parties nil (Dr ${fmt(r.dr_total)}, Cr ${fmt(r.cr_total)}); bill-wise settled for ${r.bill_wise_settled}.`);
            setData(null); loadReg();
        } catch (e) { setError(e.message); }
        setBusy(false);
    };

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">🧹 Small Balance Write-off</span></div>
                    <div className="p-3 text-sm">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 items-end">
                            <div className="erp-field"><label className="erp-label">Parties</label><select className="erp-select" value={f.side} onChange={e => setF({ ...f, side: e.target.value })}><option value="customer">Customers</option><option value="supplier">Suppliers</option><option value="both">Both</option></select></div>
                            <div className="erp-field"><label className="erp-label">Balances</label><select className="erp-select" value={f.balance} onChange={e => setF({ ...f, balance: e.target.value })}><option value="both">Dr and Cr</option><option value="dr">Dr only (they owe)</option><option value="cr">Cr only (we owe / advance)</option></select></div>
                            <div className="erp-field"><label className="erp-label">Up to amount</label><input type="number" className="erp-input" value={f.max_amount} onChange={e => setF({ ...f, max_amount: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">From amount</label><input type="number" className="erp-input" placeholder="0" value={f.min_amount} onChange={e => setF({ ...f, min_amount: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">Balance on / JV date</label><input type="date" className="erp-input" value={f.as_on} onChange={e => setF({ ...f, as_on: e.target.value })} /></div>
                            <MultiPick label="Area" items={m.areas} value={f.area_ids} onChange={v => setF({ ...f, area_ids: v })} />
                            <MultiPick label="Agent" items={m.agents} value={f.agent_ids} onChange={v => setF({ ...f, agent_ids: v })} />
                            <button className="erp-btn primary" onClick={preview} disabled={busy}>▶ List balances</button>
                        </div>
                        {error && <div className="nav-msg err">{error}</div>}
                        {msg && <div className="nav-msg ok">{msg}</div>}
                        {data && (<>
                            <div className="overflow-x-auto mt-3"><table className="erp-grid-table w-full">
                                <thead><tr><th><input type="checkbox" title="Tick all" checked={data.rows.length > 0 && data.rows.every(r => picked.has(r.party_id))} onChange={e => setPicked(e.target.checked ? new Set(data.rows.map(r => r.party_id)) : new Set())} /></th>
                                    <th>Code</th><th>Party</th><th>Type</th><th className="text-right">Balance</th><th>Entry</th></tr></thead>
                                <tbody>{data.rows.map(r => (
                                    <tr key={r.party_id} className={picked.has(r.party_id) ? 'bg-blue-50' : ''}>
                                        <td><input type="checkbox" checked={picked.has(r.party_id)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(r.party_id)) n.delete(r.party_id); else n.add(r.party_id); return n; })} /></td>
                                        <td>{r.code}</td><td>{r.name}{!r.active && <span className="text-xs text-gray-400"> (inactive)</span>}</td><td className="capitalize">{r.category}</td>
                                        <td className="text-right">{fmt(r.amount)} {r.nature === 'dr' ? 'Dr' : 'Cr'}</td>
                                        <td className="text-xs">{r.nature === 'dr' ? 'Cr party · Dr discount allowed' : 'Dr party · Cr discount received'}</td>
                                    </tr>))}
                                    {data.rows.length === 0 && <tr><td colSpan={6} className="text-center text-gray-400 py-3">No balance up to {fmt(data.max_amount)} on {data.as_on}.</td></tr>}</tbody>
                            </table></div>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end mt-3 border rounded p-3">
                                <div className="erp-field"><label className="erp-label">Discount allowed ledger (for Dr balances)</label>
                                    <select className="erp-select" value={post.dr_ledger_id} onChange={e => setPost({ ...post, dr_ledger_id: e.target.value })}><option value="">Choose</option>{discountLedgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></div>
                                <div className="erp-field"><label className="erp-label">Discount received ledger (for Cr balances)</label>
                                    <select className="erp-select" value={post.cr_ledger_id} onChange={e => setPost({ ...post, cr_ledger_id: e.target.value })}><option value="">Choose</option>{discountLedgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></div>
                                <div className="erp-field"><label className="erp-label">Narration</label><input className="erp-input" value={post.narration} placeholder={`Small balance write-off (up to ${f.max_amount})`} onChange={e => setPost({ ...post, narration: e.target.value })} /></div>
                                <div><p className="mb-1">{ticked.length} ticked · Dr {fmt(dr)} · Cr {fmt(cr)}</p><button className="erp-btn primary" disabled={busy || !ticked.length} onClick={doPost}>✔ Post write-off JV</button></div>
                            </div>
                        </>)}
                        <p className="font-semibold mt-4 mb-1">Write-off vouchers</p>
                        <table className="erp-grid-table w-full">
                            <thead><tr><th>JV No</th><th>Date</th><th>Status</th><th className="text-right">Amount</th><th>Parties</th></tr></thead>
                            <tbody>{reg.map(j => <tr key={j.id} className={j.status === 'cancelled' ? 'line-through text-gray-400' : ''}><td>{j.doc_no}</td><td>{String(j.doc_date).slice(0, 10)}</td><td>{j.status}</td><td className="text-right">{fmt(j.total_debit)}</td>
                                <td className="text-xs">{(j.parties || []).slice(0, 6).map(p => `${p.name} ${fmt(p.amount)} ${p.nature === 'dr' ? 'Dr' : 'Cr'}`).join(' · ')}{(j.parties || []).length > 6 ? ` +${j.parties.length - 6} more` : ''}</td></tr>)}
                                {reg.length === 0 && <tr><td colSpan={5} className="text-center text-gray-400 py-2">None yet.</td></tr>}</tbody>
                        </table>
                        <p className="text-xs text-gray-500 mt-2">To undo: cancel the voucher in <Link to="/journal-voucher" className="text-blue-600">Journal Voucher</Link> - the ledger entry and the bill-wise settlements are reversed.</p>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
