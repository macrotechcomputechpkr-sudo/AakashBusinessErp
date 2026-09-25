// =============================================
// InterestPosting.jsx
// Interest on overdue customer bills (server/utils/interest.js):
//   Calculate  up to a date - each customer with an Interest % (ledger
//              master) or a rate for this run; bills past their due date
//              (bill due date, else date + credit days, + grace days);
//              receipts settle oldest bills first. Days already charged in
//              an earlier posting are never charged again.
//   Post       Dr customer / Cr interest income ledger, one run per posting
//   Register   runs (cancel = GL reversed) and, per bill, charged up to when
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import useLedgerPurposes from '../components/useLedgerPurposes';

const fmt2 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);

export default function InterestPosting() {
    const { authFetch } = useAuth();
    const lp = useLedgerPurposes();
    const [tab, setTab] = useState('calc');
    const [cfg, setCfg] = useState({ as_on: iso(new Date()), posting_date: iso(new Date()), grace_days: 0, day_basis: 365, rate: '', party_ids: [], min_interest: '', interest_ledger_id: '' });
    const [ledgers, setLedgers] = useState([]);
    const [calc, setCalc] = useState(null);
    const [picked, setPicked] = useState(() => new Set());
    const [open, setOpen] = useState(null);
    const [reg, setReg] = useState(null);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);
    const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
    useEffect(() => { authFetch('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc').then(r => setLedgers(r.data || [])).catch(() => {}); }, [authFetch]);

    const params = () => {
        const p = new URLSearchParams({ as_on: cfg.as_on, grace_days: String(cfg.grace_days || 0), day_basis: String(cfg.day_basis) });
        if (cfg.rate !== '') p.set('rate', cfg.rate);
        if (cfg.min_interest) p.set('min_interest', cfg.min_interest);
        if (cfg.party_ids.length) p.set('party_ids', cfg.party_ids.join(','));
        return p;
    };
    const calculate = async () => {
        setBusy(true); setError(''); setMsg('');
        try { const r = await authFetch(`/api/interest/calculate?${params()}`); setCalc(r.data); setPicked(new Set(r.data.parties.map(p => p.ledger_id))); }
        catch (e) { setError(e.message); }
        setBusy(false);
    };
    const post = async () => {
        if (!cfg.interest_ledger_id) return setError('Choose the interest income ledger');
        if (!window.confirm(`Post interest ${fmt2(calc.parties.filter(p => picked.has(p.ledger_id)).reduce((s, p) => s + p.interest, 0))} for ${picked.size} customer(s)?`)) return;
        setBusy(true); setError('');
        try {
            const body = Object.fromEntries(params());
            const r = await authFetch('/api/interest/post', { method: 'POST', body: JSON.stringify({ ...body, posting_date: cfg.posting_date, interest_ledger_id: cfg.interest_ledger_id, post_party_ids: [...picked].join(',') }) });
            setMsg(`Posted ${r.data.doc_no}: ${r.data.parties} customer(s), ${fmt2(r.data.total)}`); setCalc(null);
        } catch (e) { setError(e.message); }
        setBusy(false);
    };
    const loadReg = useCallback(async () => { try { setReg((await authFetch('/api/interest/register')).data); } catch (e) { setError(e.message); } }, [authFetch]);
    useEffect(() => { if (tab === 'register') loadReg(); }, [tab, loadReg]);
    const cancel = async run => {
        const reason = window.prompt(`Cancel ${run.doc_no}? Reason:`);
        if (!reason) return;
        try { await authFetch(`/api/interest/runs/${run.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); setMsg(`${run.doc_no} cancelled`); loadReg(); } catch (e) { setError(e.message); }
    };
    const customers = ledgers.map(l => ({ id: l.id, name: l.account_name }));

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">% Interest on Overdue (Customers)</span></div>
            <div className="erp-tab-content">
                <div className="flex gap-1 mb-3 border-b">
                    {[['calc', 'Calculate & Post'], ['register', 'Posted Register']].map(([k, l]) => <button key={k} className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => setTab(k)}>{l}</button>)}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}
                {tab === 'calc' && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-3">
                            <div className="erp-field"><label className="erp-label">Interest up to</label><input type="date" className="erp-input" value={cfg.as_on} onChange={e => set('as_on', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">Grace days</label><input type="number" min="0" className="erp-input" value={cfg.grace_days} onChange={e => set('grace_days', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">Day basis</label><select className="erp-select" value={cfg.day_basis} onChange={e => set('day_basis', e.target.value)}><option value={365}>365</option><option value={360}>360</option><option value={366}>366</option></select></div>
                            <div className="erp-field"><label className="erp-label">Rate % (blank = ledger's)</label><input type="number" step="0.01" className="erp-input" value={cfg.rate} onChange={e => set('rate', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">Min interest</label><input type="number" className="erp-input" value={cfg.min_interest} onChange={e => set('min_interest', e.target.value)} /></div>
                            <div className="md:col-span-2"><MultiPick label="Customers" items={customers} value={cfg.party_ids} onChange={v => set('party_ids', v)} /></div>
                            <div className="flex items-end"><button className="erp-btn primary" onClick={calculate} disabled={busy}>🔍 Calculate</button></div>
                        </div>
                        {calc && (
                            <>
                                <div className="flex flex-wrap gap-3 items-end mb-3 p-2 bg-blue-50 rounded">
                                    <span className="text-sm">{calc.totals.parties} customer(s) · interest <b>{fmt2(calc.totals.interest)}</b></span>
                                    <div className="erp-field"><label className="erp-label">Posting date</label><input type="date" className="erp-input" value={cfg.posting_date} onChange={e => set('posting_date', e.target.value)} /></div>
                                    <div className="erp-field w-64"><label className="erp-label">Interest income ledger</label>
                                        <select className="erp-select" value={cfg.interest_ledger_id} onChange={e => set('interest_ledger_id', e.target.value)}>
                                            <option value="">— choose —</option>
                                            {lp.filter(ledgers, 'sales_goods', cfg.interest_ledger_id).map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}
                                        </select></div>
                                    <button className="erp-btn primary" disabled={busy || !picked.size} onClick={post}>✔ Post interest for {picked.size}</button>
                                </div>
                                <table className="erp-grid-table w-full text-sm">
                                    <thead><tr><th><input type="checkbox" checked={picked.size === calc.parties.length && calc.parties.length > 0} onChange={() => setPicked(picked.size === calc.parties.length ? new Set() : new Set(calc.parties.map(p => p.ledger_id)))} /></th>
                                        <th className="text-left">Customer</th><th className="text-right">Rate %</th><th className="text-right">Credit days</th><th className="text-right">Balance</th><th className="text-right">Overdue bills</th><th className="text-right">Interest</th><th /></tr></thead>
                                    <tbody>{calc.parties.map(p => (
                                        <React.Fragment key={p.ledger_id}>
                                            <tr>
                                                <td><input type="checkbox" checked={picked.has(p.ledger_id)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(p.ledger_id)) n.delete(p.ledger_id); else n.add(p.ledger_id); return n; })} /></td>
                                                <td>{p.name}</td><td className="text-right">{p.rate}</td><td className="text-right">{p.credit_days}</td><td className="text-right tabular-nums">{fmt2(p.balance)}</td>
                                                <td className="text-right">{p.bills}</td><td className="text-right tabular-nums font-semibold">{fmt2(p.interest)}</td>
                                                <td><button className="text-blue-600 text-xs underline" onClick={() => setOpen(open === p.ledger_id ? null : p.ledger_id)}>{open === p.ledger_id ? 'hide' : 'details'}</button></td>
                                            </tr>
                                            {open === p.ledger_id && (
                                                <tr><td colSpan={8} className="bg-gray-50">
                                                    <table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="text-left">Bill</th><th className="text-left">Bill date</th><th className="text-left">Due</th><th className="text-left">From</th><th className="text-left">To</th><th className="text-right">Days</th><th className="text-right">Unpaid</th><th className="text-right">Interest</th></tr></thead>
                                                        <tbody>{calc.lines.filter(l => l.ledger_id === p.ledger_id).map((l, i) => <tr key={i}><td>{l.doc_no}</td><td>{l.doc_date}</td><td>{l.due_date}</td><td>{l.from_date}</td><td>{l.to_date}</td><td className="text-right">{l.days}</td><td className="text-right tabular-nums">{fmt2(l.principal)}</td><td className="text-right tabular-nums">{fmt2(l.interest)}</td></tr>)}</tbody></table>
                                                </td></tr>
                                            )}
                                        </React.Fragment>
                                    ))}{!calc.parties.length && <tr><td colSpan={8} className="text-center text-gray-400 py-3">No overdue interest - customers need an Interest % on the ledger (or a rate above), and bills past their due date not already charged.</td></tr>}</tbody>
                                </table>
                            </>
                        )}
                    </>
                )}
                {tab === 'register' && reg && (
                    <div className="space-y-4">
                        <table className="erp-grid-table w-full text-sm">
                            <thead><tr><th className="text-left">Run</th><th className="text-left">Posted on</th><th className="text-left">Up to</th><th className="text-right">Customers</th><th className="text-right">Interest</th><th className="text-left">Status</th><th /></tr></thead>
                            <tbody>{reg.runs.map(r => (
                                <tr key={r.id} className={r.status === 'cancelled' ? 'text-gray-400' : ''}><td>{r.doc_no}</td><td>{r.posting_date}</td><td>{r.period_to}</td><td className="text-right">{r.party_count}</td><td className="text-right tabular-nums">{fmt2(r.total_interest)}</td>
                                    <td>{r.status}{r.cancellation_reason ? ` (${r.cancellation_reason})` : ''}</td><td>{r.status === 'posted' && <button className="text-red-600 underline text-xs" onClick={() => cancel(r)}>cancel</button>}</td></tr>
                            ))}{!reg.runs.length && <tr><td colSpan={7} className="text-center text-gray-400 py-3">No interest posted yet.</td></tr>}</tbody>
                        </table>
                        <div>
                            <div className="font-semibold text-sm mb-1">Bills - interest charged up to</div>
                            <table className="erp-grid-table w-full text-sm">
                                <thead><tr><th className="text-left">Customer</th><th className="text-left">Bill</th><th className="text-left">Bill date</th><th className="text-left">Due</th><th className="text-left">Charged up to</th><th className="text-right">Days</th><th className="text-right">Interest</th><th className="text-left">Runs</th></tr></thead>
                                <tbody>{reg.bills.map((b, i) => <tr key={i}><td>{b.party_name}</td><td>{b.doc_no}</td><td>{b.doc_date}</td><td>{b.due_date}</td><td className="font-semibold">{b.charged_upto}</td><td className="text-right">{b.days}</td><td className="text-right tabular-nums">{fmt2(b.interest)}</td><td>{b.runs}</td></tr>)}</tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
