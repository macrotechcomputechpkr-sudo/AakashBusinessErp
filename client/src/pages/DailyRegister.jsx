// =============================================
// DailyRegister.jsx  (/daily-register)
// The counter's one-page day sheet (server: utils/dailyRegister.js), laid out
// like the paper register:
//   Sales (Cash A / Credit B) | Purchase (Cash C / Credit D) + Received /
//   Bank withdraw (Cash E / Bank F) | Expenses / Bank deposit (Cash G / Bank H)
//   | Return / Exchange (Customer I / Supplier J) + cash summary, sales /
//   purchase to date, stock and profit, cash denomination count, today's note.
// Filters: date (or period), user, salesman / agent. Print on one page.
// The denomination count and note are kept in this browser per date.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useAuth } from '../contexts/AuthContext';

const fmt = n => (n === null || n === undefined || n === '' ? '' : Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00');
const iso = d => d.toISOString().slice(0, 10);
const DENOMS = [1000, 500, 100, 50, 20, 10, 5];
const store = {
    get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
};

function Panel({ title, children }) {
    return <div className="dr-panel"><div className="dr-title">{title}</div>{children}</div>;
}
function Section({ cols, rows, render, totals, empty = 3 }) {
    return (
        <table className="dr-table">
            <thead><tr>{cols.map(([l, w], i) => <th key={i} style={w ? { width: w } : undefined}>{l}</th>)}</tr></thead>
            <tbody>
                {rows.map(render)}
                {Array.from({ length: Math.max(0, empty - rows.length) }).map((_, i) => <tr key={`e${i}`}>{cols.map((c, j) => <td key={j}>&nbsp;</td>)}</tr>)}
            </tbody>
            <tfoot><tr className="dr-total">{totals}</tr></tfoot>
        </table>
    );
}

export default function DailyRegister() {
    const { authFetch, tenant } = useAuth();
    const [m, setM] = useState({ users: [], agents: [] });
    const [f, setF] = useState({ date_from: iso(new Date()), date_to: iso(new Date()), user_ids: [], agent_ids: [], party_agent_ids: [] });
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const key = `daily_register_${f.date_from}_${f.date_to}`;
    const [count, setCount] = useState({});
    const [note, setNote] = useState('');

    useEffect(() => {
        const load = u => authFetch(u).then(r => r.data).catch(() => []);
        Promise.all([load('/api/users?pageSize=500'), load('/api/salesman-agents')]).then(([u, a]) => setM({
            users: (Array.isArray(u) ? u : u?.users || []).map(x => ({ id: x.id, name: x.full_name || x.email })), agents: (a || []).map(x => ({ id: x.id, name: x.agent_name })) }));
    }, [authFetch]);
    useEffect(() => { const s = store.get(key) || {}; setCount(s.count || {}); setNote(s.note || ''); }, [key]);
    useEffect(() => { store.set(key, { count, note }); }, [key, count, note]);

    const run = useCallback(async () => {
        setBusy(true); setError('');
        const p = new URLSearchParams({ date_from: f.date_from, date_to: f.date_to });
        if (f.user_ids.length) p.set('user_ids', f.user_ids.join(','));
        if (f.agent_ids.length) p.set('agent_ids', f.agent_ids.join(','));
        if ((f.party_agent_ids || []).length) p.set('party_agent_ids', f.party_agent_ids.join(','));
        try { const d = (await authFetch(`/api/daily-register?${p}`)).data; if (!d || !d.totals) throw new Error('No data returned'); setData(d); } catch (e) { setError(e.message); setData(null); }
        setBusy(false);
    }, [authFetch, f]);
    useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const countTotal = useMemo(() => DENOMS.reduce((s, d) => s + d * (Number(count[d]) || 0), 0) + (Number(count.coin) || 0), [count]);
    const T = data?.totals || {};
    const cash = data?.cash || {};
    const tr = data?.trading || {};
    const pf = data?.profit || {};

    return (
        <Layout>
            <style>{`
                .dr-sheet { background:#fff; padding:10px; font-family: Arial, sans-serif; font-size:12px; color:#000; }
                .dr-head { text-align:center; } .dr-head h2 { margin:0; font-size:18px; font-weight:bold; }
                .dr-date { display:flex; justify-content:space-between; font-weight:bold; margin:6px 2px 8px; }
                .dr-grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:8px; align-items:start; }
                .dr-panel { border:1px solid #000; background:#fff; }
                .dr-title { text-align:center; font-weight:bold; padding:3px; border-bottom:1px solid #000; background:#f0f0f0; }
                .dr-table { width:100%; border-collapse:collapse; }
                .dr-table th, .dr-table td { border:1px solid #000; padding:2px 3px; font-size:11px; height:20px; }
                .dr-table th { background:#f0f0f0; text-align:center; }
                .dr-table td.n { text-align:right; font-variant-numeric: tabular-nums; }
                .dr-total td { font-weight:bold; background:#f8f8f8; }
                .dr-sum td.l { font-weight:bold; background:#fafafa; } .dr-sum td.v { text-align:right; font-weight:bold; background:#f0f7ff; }
                .dr-count input { width:100%; border:none; text-align:right; background:transparent; font-size:11px; }
                .dr-note textarea { width:100%; min-height:48px; border:none; font-size:11px; resize:vertical; }
                .dr-foot { display:flex; justify-content:space-between; margin-top:12px; font-size:11px; }
                @media (max-width: 1100px) { .dr-grid { grid-template-columns: 1fr 1fr; } }
                @media (max-width: 640px) { .dr-grid { grid-template-columns: 1fr; } }
                @media print { .dr-grid { grid-template-columns: repeat(4, minmax(0,1fr)); } .dr-sheet { padding:0; } }
            `}</style>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header print:hidden"><span className="erp-header-title">🗒 Daily Register</span></div>
                    <div className="p-3 print:hidden">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
                            <div className="erp-field"><label className="erp-label">Date</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value, date_to: e.target.value > f.date_to ? e.target.value : f.date_to })} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
                            <MultiPick label="User" items={m.users} value={f.user_ids} onChange={v => setF({ ...f, user_ids: v })} allLabel="All users" />
                            <MultiPick label="Doc. Agent (on the voucher)" items={m.agents} value={f.agent_ids} onChange={v => setF({ ...f, agent_ids: v })} allLabel="All agents" />
                            <MultiPick label="Agent (party master)" items={m.agents} value={f.party_agent_ids || []} onChange={v => setF({ ...f, party_agent_ids: v })} allLabel="All agents" />
                            <button className="erp-btn primary" onClick={run} disabled={busy}>{busy ? '…' : '▶ Show'}</button>
                            {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print</button>}
                        </div>
                        {error && <div className="nav-msg err">{error}</div>}
                    </div>

                    {data && (
                        <div className="dr-sheet" data-no-excel>
                            <div className="dr-head"><h2>{tenant?.company_name || 'Register'}</h2><div>Daily Register - Sales, Purchase, Expenses, Return</div></div>
                            <div className="dr-date"><span>Date: {data.from === data.to ? data.from : `${data.from} to ${data.to}`}</span>
                                <span>{[data.filter_names?.users?.length ? `User: ${data.filter_names.users.join(', ')}` : '', data.filter_names?.agents?.length ? `Agent: ${data.filter_names.agents.join(', ')}` : ''].filter(Boolean).join(' · ')}</span></div>
                            <div className="dr-grid">
                                <Panel title="Sales">
                                    <Section cols={[['Bill No.', 70], ['Particulars'], ['Cash (A)', 70], ['Credit (B)', 70]]} rows={data.sales} empty={12}
                                        render={(r, i) => <tr key={i}><td>{r.doc_no}</td><td>{r.particulars}</td><td className="n">{r.cash ? fmt(r.cash) : ''}</td><td className="n">{r.credit ? fmt(r.credit) : ''}</td></tr>}
                                        totals={<><td colSpan={2}>Total</td><td className="n">{fmt(T.A)}</td><td className="n">{fmt(T.B)}</td></>} />
                                </Panel>

                                <Panel title="Purchase">
                                    <Section cols={[['Bill No.', 70], ['Particulars'], ['Cash (C)', 70], ['Credit (D)', 70]]} rows={data.purchase} empty={6}
                                        render={(r, i) => <tr key={i}><td>{r.doc_no}</td><td>{r.particulars}</td><td className="n">{r.cash ? fmt(r.cash) : ''}</td><td className="n">{r.credit ? fmt(r.credit) : ''}</td></tr>}
                                        totals={<><td colSpan={2}>Total</td><td className="n">{fmt(T.C)}</td><td className="n">{fmt(T.D)}</td></>} />
                                    <Section cols={[['S.N.', 32], ['Received / Bank Withdraw'], ['Cash (E)', 70], ['Bank (F)', 70]]} rows={data.received} empty={6}
                                        render={(r, i) => <tr key={i}><td>{i + 1}</td><td>{r.particulars}{r.kind === 'Bank withdraw' ? ' (withdraw)' : ''}</td><td className="n">{r.cash ? fmt(r.cash) : ''}</td><td className="n">{r.bank ? fmt(r.bank) : ''}</td></tr>}
                                        totals={<><td colSpan={2}>Total</td><td className="n">{fmt(T.E)}</td><td className="n">{fmt(T.F)}</td></>} />
                                </Panel>

                                <Panel title="Expenses / Bank Deposit">
                                    <Section cols={[['Particulars'], ['Cash (G)', 75], ['Chq / Bank (H)', 75]]} rows={data.expenses} empty={14}
                                        render={(r, i) => <tr key={i}><td>{r.particulars}{r.kind === 'Bank deposit' ? ' (deposit)' : ''}</td><td className="n">{r.cash ? fmt(r.cash) : ''}</td><td className="n">{r.bank ? fmt(r.bank) : ''}</td></tr>}
                                        totals={<><td>Total</td><td className="n">{fmt(T.G)}</td><td className="n">{fmt(T.H)}</td></>} />
                                </Panel>

                                <Panel title="Return / Exchange">
                                    <Section cols={[['Bill No.', 70], ['Particular'], ['Customer (I)', 70], ['Supplier (J)', 70]]} rows={data.returns} empty={4}
                                        render={(r, i) => <tr key={i}><td>{r.doc_no}</td><td>{r.particulars}</td><td className="n">{r.side === 'customer' ? fmt(r.amount) : ''}</td><td className="n">{r.side === 'supplier' ? fmt(r.amount) : ''}</td></tr>}
                                        totals={<><td colSpan={2}>Total</td><td className="n">{fmt(T.I)}</td><td className="n">{fmt(T.J)}</td></>} />
                                    <table className="dr-table dr-sum"><tbody>
                                        {!data.filtered && <tr><td className="l">Opening Cash BL</td><td className="v">{fmt(cash.opening)}</td></tr>}
                                        <tr><td className="l">Add: Cash Sales (A)</td><td className="v">{fmt(cash.cash_sales)}</td></tr>
                                        <tr><td className="l">Add: Cash Received (E)</td><td className="v">{fmt(cash.received_cash)}</td></tr>
                                        {cash.supplier_return_cash ? <tr><td className="l">Add: Cash from supplier returns</td><td className="v">{fmt(cash.supplier_return_cash)}</td></tr> : null}
                                        <tr><td className="l">Less: Cash Purchase (C)</td><td className="v">{fmt(cash.cash_purchase)}</td></tr>
                                        <tr><td className="l">Less: Expenses / Deposit (G)</td><td className="v">{fmt(cash.paid_cash)}</td></tr>
                                        {cash.refunds ? <tr><td className="l">Less: Cash refund on returns</td><td className="v">{fmt(cash.refunds)}</td></tr> : null}
                                        <tr><td className="l">{data.filtered ? 'Net cash of these vouchers' : 'Expected Closing BL'}</td><td className="v">{fmt(cash.expected_closing)}</td></tr>
                                        {!data.filtered && <tr><td className="l">Other cash entries (JV ...)</td><td className="v">{fmt(cash.other)}</td></tr>}
                                        {!data.filtered && <tr><td className="l">Closing Cash BL (books)</td><td className="v">{fmt(cash.closing)}</td></tr>}
                                    </tbody></table>
                                    <table className="dr-table dr-sum"><thead><tr><th>Sales</th><th>Rs.</th><th>Purchase</th><th>Rs.</th></tr></thead><tbody>
                                        {tr.opening_sales !== undefined && <tr><td className="l">Opening Sales</td><td className="v">{fmt(tr.opening_sales)}</td><td className="l">Opening Purchase</td><td className="v">{fmt(tr.opening_purchase)}</td></tr>}
                                        <tr><td className="l">Add: Today's Sales</td><td className="v">{fmt(tr.today_sales)}</td><td className="l">Add: Today's Purchase</td><td className="v">{fmt(tr.today_purchase)}</td></tr>
                                        <tr><td className="l">Less: Return</td><td className="v">{fmt(tr.today_sales_return)}</td><td className="l">Less: Return</td><td className="v">{fmt(tr.today_purchase_return)}</td></tr>
                                        <tr><td className="l">Net Sales</td><td className="v">{fmt(tr.net_sales)}</td><td className="l">Net Purchase</td><td className="v">{fmt(tr.net_purchase)}</td></tr>
                                        {tr.sales_to_date !== undefined && <tr><td className="l">Sales to date</td><td className="v">{fmt(tr.sales_to_date)}</td><td className="l">Purchase to date</td><td className="v">{fmt(tr.purchase_to_date)}</td></tr>}
                                        {!data.filtered && !pf.error && <>
                                            <tr><td className="l">Gross Profit</td><td className="v">{fmt(pf.gross_profit)}</td><td className="l">Opening Stock</td><td className="v">{fmt(pf.opening_stock)}</td></tr>
                                            <tr><td className="l">Net Profit</td><td className="v">{fmt(pf.net_profit)}</td><td className="l">Closing Stock</td><td className="v">{fmt(pf.closing_stock)}</td></tr>
                                        </>}
                                    </tbody></table>
                                    <table className="dr-table dr-count"><tbody>
                                        <tr><td colSpan={3} style={{ fontWeight: 'bold' }}>Cash Detail (count):</td></tr>
                                        {DENOMS.map(d => <tr key={d}><td>{d} x</td><td><input type="number" min="0" value={count[d] || ''} onChange={e => setCount(c => ({ ...c, [d]: e.target.value }))} /></td><td className="n">{Number(count[d]) ? fmt(d * Number(count[d])) : ''}</td></tr>)}
                                        <tr><td>Coin</td><td><input type="number" min="0" step="any" value={count.coin || ''} onChange={e => setCount(c => ({ ...c, coin: e.target.value }))} /></td><td className="n">{Number(count.coin) ? fmt(count.coin) : ''}</td></tr>
                                        <tr className="dr-total"><td colSpan={2}>Total counted</td><td className="n">{fmt(countTotal)}</td></tr>
                                        {!data.filtered && <tr><td colSpan={2}>Difference with books</td><td className="n" style={{ color: Math.abs(countTotal - (cash.closing || 0)) > 0.5 ? '#b00' : '#060' }}>{fmt(countTotal - (cash.closing || 0))}</td></tr>}
                                    </tbody></table>
                                    <div className="dr-note" style={{ borderTop: '1px solid #000', padding: 4 }}><div style={{ fontWeight: 'bold' }}>Today's Note:</div>
                                        <textarea value={note} placeholder="Write note here..." onChange={e => setNote(e.target.value)} /></div>
                                </Panel>
                            </div>
                            <div className="dr-foot"><div>{tenant?.company_name} &nbsp;|&nbsp; Prepared by: ______________</div><div style={{ fontWeight: 'bold' }}>Verified by: ______________</div></div>
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
}
