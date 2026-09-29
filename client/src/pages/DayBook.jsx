// =============================================
// DayBook.jsx  (/day-book)
// All-in-one Day Book (server: utils/dayBook.js). For a day or a period:
//   headline      sales (cash / credit), returns, purchase (cash / credit),
//                 receipts and payments (cash / bank), PDC
//   by type       every voucher type: count, cash, bank, credit, PDC, adjustment
//   cash & bank   receipts / payments per cash and bank ledger (opening and
//                 closing too when the whole business is shown)
//   parties       party-wise credit summary with closing balance
//   agent / user  totals per salesman and per user
//   vouchers      the list of every voucher
// Filters: user (who entered it), salesman / agent, voucher types, party,
// drafts. Without user / agent it is the overall day book.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useAuth } from '../contexts/AuthContext';

const fmt = n => (Number(n) ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmt0 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = n => (Math.abs(Number(n) || 0) < 0.005 ? '0.00' : `${fmt0(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`);
const iso = d => d.toISOString().slice(0, 10);
const SECTIONS = [['headline', 'Summary'], ['types', 'By voucher type'], ['cash', 'Cash & Bank'], ['parties', 'Party-wise credit'], ['agents', 'By agent'], ['users', 'By user'], ['rows', 'Voucher list']];

export default function DayBook() {
    const { authFetch } = useAuth();
    const [m, setM] = useState({ users: [], agents: [], types: [], parties: [] });
    const [f, setF] = useState({ date_from: iso(new Date()), date_to: iso(new Date()), user_ids: [], agent_ids: [], party_agent_ids: [], voucher_types: [], party_ids: [], include_draft: false });
    const [show, setShow] = useState(() => SECTIONS.map(s => s[0]));
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const load = u => authFetch(u).then(r => r.data).catch(() => []);
        Promise.all([load('/api/users?pageSize=500'), load('/api/salesman-agents'), load('/api/day-book/types'), load('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc')]).then(([u, a, ty, l]) => setM({
            users: (Array.isArray(u) ? u : u?.users || []).map(x => ({ id: x.id, name: x.full_name || x.email })),
            agents: (a || []).map(x => ({ id: x.id, name: x.agent_name })),
            types: (ty || []).map(x => ({ id: x.key, name: `${x.label} (${x.group})` })),
            parties: (Array.isArray(l) ? l : l?.rows || []).filter(x => ['sales', 'purchase', 'both'].includes(x.category_type)).map(x => ({ id: x.id, name: x.account_name }))
        }));
    }, [authFetch]);

    const run = useCallback(async () => {
        setBusy(true); setError('');
        const p = new URLSearchParams({ date_from: f.date_from, date_to: f.date_to, include_draft: f.include_draft ? 'true' : 'false' });
        ['user_ids', 'agent_ids', 'party_agent_ids', 'voucher_types', 'party_ids'].forEach(k => { if ((f[k] || []).length) p.set(k, f[k].join(',')); });
        try { const d = (await authFetch(`/api/day-book?${p}`)).data; setData(d && d.headline ? d : null); if (!d || !d.headline) setError('No day book data returned'); } catch (e) { setError(e.message); setData(null); }
        setBusy(false);
    }, [authFetch, f]);
    useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const S = k => show.includes(k);
    const h = data?.headline;
    const card = (label, value, sub) => (
        <div className="border rounded px-2 py-1 bg-white"><div className="text-[11px] text-gray-500">{label}</div><div className="font-bold tabular-nums">{fmt0(value)}</div>{sub && <div className="text-[11px] text-gray-500">{sub}</div>}</div>
    );
    const title = data ? `Day Book ${data.from === data.to ? data.from : `${data.from} to ${data.to}`}${data.filter_names.agents.length ? ` · Agent: ${data.filter_names.agents.join(', ')}` : ''}${data.filter_names.users.length ? ` · User: ${data.filter_names.users.join(', ')}` : ''}${data.filter_names.types.length ? ` · ${data.filter_names.types.join(', ')}` : ''}` : 'Day Book';

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header print:hidden"><span className="erp-header-title">📘 Day Book</span></div>
                    <div className="p-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 items-end print:hidden">
                            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
                            <MultiPick label="User" items={m.users} value={f.user_ids} onChange={v => setF({ ...f, user_ids: v })} allLabel="All users" />
                            <MultiPick label="Doc. Agent (on the voucher)" items={m.agents} value={f.agent_ids} onChange={v => setF({ ...f, agent_ids: v })} allLabel="All agents" />
                            <MultiPick label="Agent (party master)" items={m.agents} value={f.party_agent_ids || []} onChange={v => setF({ ...f, party_agent_ids: v })} allLabel="All agents" />
                            <MultiPick label="Voucher type" items={m.types} value={f.voucher_types} onChange={v => setF({ ...f, voucher_types: v })} allLabel="All types" />
                            <MultiPick label="Party" items={m.parties} value={f.party_ids} onChange={v => setF({ ...f, party_ids: v })} allLabel="All parties" />
                            <label className="flex items-center gap-1 text-sm mb-1"><input type="checkbox" checked={f.include_draft} onChange={e => setF({ ...f, include_draft: e.target.checked })} /> Drafts / pending too</label>
                            <div className="flex gap-1"><button className="erp-btn primary" onClick={run} disabled={busy}>{busy ? '…' : '▶ Show'}</button>{data && <button className="erp-btn" onClick={() => window.print()}>🖨</button>}</div>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs mt-2 print:hidden">
                            <span className="text-gray-500">Show:</span>
                            {SECTIONS.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={S(k)} onChange={() => setShow(s => (s.includes(k) ? s.filter(x => x !== k) : [...s, k]))} /> {l}</label>)}
                        </div>
                        {error && <div className="nav-msg err">{error}</div>}
                    </div>

                    {data && (
                        <div className="px-3 pb-3 text-sm">
                            <h2 className="font-bold text-base">{title}</h2>
                            <p className="text-xs text-gray-500 mb-2">{data.totals.vouchers} vouchers{data.filtered ? ' · filtered' : ' · whole business'}{data.include_draft ? ' · drafts included' : ' · posted only'}</p>

                            {S('headline') && (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-3">
                                    {card('Sales', h.sales, `Cash ${fmt0(h.sales_cash)} · Credit ${fmt0(h.sales_credit)}`)}
                                    {card('Sales Return', h.sales_return)}
                                    {card('Net Sales', h.sales - h.sales_return)}
                                    {card('Purchase', h.purchase, `Cash ${fmt0(h.purchase_cash)} · Credit ${fmt0(h.purchase_credit)}`)}
                                    {card('Purchase Return', h.purchase_return)}
                                    {card('Receipts', h.receipts, `Cash ${fmt0(h.receipts_cash)} · Bank ${fmt0(h.receipts_bank)}`)}
                                    {card('Payments', h.payments, `Cash ${fmt0(h.payments_cash)} · Bank ${fmt0(h.payments_bank)}`)}
                                    {card('PDC', h.pdc_received + h.pdc_issued, `Received ${fmt0(h.pdc_received)} · Issued ${fmt0(h.pdc_issued)}`)}
                                </div>
                            )}

                            {S('types') && (<>
                                <p className="font-semibold mt-2 mb-1">By voucher type</p>
                                <div className="overflow-x-auto"><table className="erp-grid-table w-full">
                                    <thead><tr><th>Group</th><th>Voucher type</th><th className="text-right">Count</th><th className="text-right">Cash</th><th className="text-right">Bank</th><th className="text-right">Credit</th><th className="text-right">PDC</th><th className="text-right">Adjustment</th><th className="text-right">Total</th></tr></thead>
                                    <tbody>{data.summary.map(s => <tr key={s.type}><td className="text-gray-500">{s.group}</td><td>{s.label}</td><td className="text-right">{s.count}</td><td className="text-right">{fmt(s.cash)}</td><td className="text-right">{fmt(s.bank)}</td><td className="text-right">{fmt(s.credit)}</td><td className="text-right">{fmt(s.pdc)}</td><td className="text-right">{fmt(s.adjustment)}</td><td className="text-right font-semibold">{fmt(s.total)}</td></tr>)}
                                        {data.summary.length === 0 && <tr><td colSpan={9} className="text-center text-gray-400 py-3">No vouchers.</td></tr>}</tbody>
                                </table></div>
                            </>)}

                            {S('cash') && (<>
                                <p className="font-semibold mt-3 mb-1">Cash & Bank {data.filtered && <span className="text-xs font-normal text-gray-500">(movement of the vouchers shown)</span>}</p>
                                <div className="overflow-x-auto"><table className="erp-grid-table w-full">
                                    <thead><tr><th>Ledger</th><th>Type</th>{!data.filtered && <th className="text-right">Opening</th>}<th className="text-right">Receipts (Dr)</th><th className="text-right">Payments (Cr)</th><th className="text-right">Net</th>{!data.filtered && <th className="text-right">Closing</th>}</tr></thead>
                                    <tbody>{data.cash_bank.map(x => <tr key={x.ledger_id}><td>{x.ledger}</td><td className="capitalize">{x.kind}</td>{!data.filtered && <td className="text-right">{drcr(x.opening)}</td>}<td className="text-right">{fmt(x.receipts)}</td><td className="text-right">{fmt(x.payments)}</td><td className="text-right">{fmt(x.net)}</td>{!data.filtered && <td className="text-right font-semibold">{drcr(x.closing)}</td>}</tr>)}
                                        {[['Cash total', data.cash_total], ['Bank total', data.bank_total]].map(([l, x]) => <tr key={l} className="font-semibold bg-slate-50"><td colSpan={2}>{l}</td>{!data.filtered && <td className="text-right">{drcr(x.opening)}</td>}<td className="text-right">{fmt0(x.receipts)}</td><td className="text-right">{fmt0(x.payments)}</td><td className="text-right">{fmt0(x.net)}</td>{!data.filtered && <td className="text-right">{drcr(x.closing)}</td>}</tr>)}</tbody>
                                </table></div>
                            </>)}

                            {S('parties') && (<>
                                <p className="font-semibold mt-3 mb-1">Party-wise credit summary</p>
                                <div className="overflow-x-auto"><table className="erp-grid-table w-full">
                                    <thead><tr><th>Party</th><th className="text-right">Cash Sales</th><th className="text-right">Credit Sales</th><th className="text-right">Sales Return</th><th className="text-right">Receipt</th><th className="text-right">Cash Purchase</th><th className="text-right">Credit Purchase</th><th className="text-right">Purch. Return</th><th className="text-right">Payment</th><th className="text-right">Notes / JV</th><th className="text-right">PDC</th><th className="text-right">Net credit (+ owes more)</th><th className="text-right">Closing Balance</th></tr></thead>
                                    <tbody>{data.parties.map(p => <tr key={p.party_id}><td>{p.party}</td><td className="text-right">{fmt(p.cash_sales)}</td><td className="text-right">{fmt(p.credit_sales)}</td><td className="text-right">{fmt(p.sales_return)}</td><td className="text-right">{fmt(p.receipt)}</td><td className="text-right">{fmt(p.cash_purchase)}</td><td className="text-right">{fmt(p.credit_purchase)}</td><td className="text-right">{fmt(p.purchase_return)}</td><td className="text-right">{fmt(p.payment)}</td><td className="text-right">{fmt(p.notes)}</td><td className="text-right">{fmt(p.pdc)}</td><td className={`text-right font-semibold ${p.net_credit > 0 ? 'text-red-700' : 'text-green-700'}`}>{fmt(p.net_credit)}</td><td className="text-right">{drcr(p.closing_balance)}</td></tr>)}
                                        {data.parties.length > 0 && <tr className="font-semibold bg-slate-50"><td>Total ({data.parties.length})</td>{['cash_sales', 'credit_sales', 'sales_return', 'receipt', 'cash_purchase', 'credit_purchase', 'purchase_return', 'payment', 'notes', 'pdc', 'net_credit'].map(k => <td key={k} className="text-right">{fmt0(data.parties.reduce((s, p) => s + p[k], 0))}</td>)}<td /></tr>}</tbody>
                                </table></div>
                            </>)}

                            {[['agents', 'By salesman / agent', data.by_agent], ['users', 'By user', data.by_user]].filter(([k]) => S(k)).map(([k, l, list]) => (
                                <React.Fragment key={k}>
                                    <p className="font-semibold mt-3 mb-1">{l}</p>
                                    <div className="overflow-x-auto"><table className="erp-grid-table w-full">
                                        <thead><tr><th>{k === 'agents' ? 'Agent' : 'User'}</th><th className="text-right">Vouchers</th><th className="text-right">Sales</th><th className="text-right">Cash Sales</th><th className="text-right">Credit Sales</th><th className="text-right">Returns</th><th className="text-right">Receipts</th><th className="text-right">Purchases</th><th className="text-right">Payments</th><th className="text-right">PDC</th></tr></thead>
                                        <tbody>{list.map(x => <tr key={x.id || 'none'}><td>{x.name}</td><td className="text-right">{x.vouchers}</td><td className="text-right">{fmt(x.sales)}</td><td className="text-right">{fmt(x.sales_cash)}</td><td className="text-right">{fmt(x.sales_credit)}</td><td className="text-right">{fmt(x.returns)}</td><td className="text-right">{fmt(x.receipts)}</td><td className="text-right">{fmt(x.purchases)}</td><td className="text-right">{fmt(x.payments)}</td><td className="text-right">{fmt(x.pdc)}</td></tr>)}</tbody>
                                    </table></div>
                                </React.Fragment>
                            ))}

                            {S('rows') && (<>
                                <p className="font-semibold mt-3 mb-1">Vouchers</p>
                                <div className="overflow-x-auto"><table className="erp-grid-table w-full">
                                    <thead><tr><th>Date</th><th>Type</th><th>No</th><th>Party</th><th>Mode</th><th>Agent</th><th>User</th><th className="text-right">Cash</th><th className="text-right">Bank</th><th className="text-right">Credit</th><th className="text-right">PDC / Adj.</th><th className="text-right">Amount</th></tr></thead>
                                    <tbody>{data.rows.map(r => <tr key={`${r.type}:${r.id}:${r.party_id || ''}`} className={r.status !== 'posted' ? 'text-gray-500 italic' : ''}><td>{r.date}</td><td>{r.type_label}</td><td className="font-mono">{r.doc_no}</td><td>{r.party}</td><td className="text-xs">{r.mode}{r.cash_bank ? ` · ${r.cash_bank}` : ''}{r.status !== 'posted' ? ` · ${r.status}` : ''}</td><td>{r.agent_name}</td><td className="text-xs">{r.user_name}</td>
                                        <td className="text-right">{fmt(r.cash)}</td><td className="text-right">{fmt(r.bank)}</td><td className="text-right">{fmt(r.credit)}</td><td className="text-right">{fmt(r.pdc || r.adjustment)}</td><td className="text-right font-semibold">{fmt(r.amount)}</td></tr>)}</tbody>
                                    <tfoot><tr className="font-bold bg-blue-50"><td colSpan={7}>Total</td><td className="text-right">{fmt0(data.totals.cash)}</td><td className="text-right">{fmt0(data.totals.bank)}</td><td className="text-right">{fmt0(data.totals.credit)}</td><td className="text-right">{fmt0(data.totals.pdc + data.totals.adjustment)}</td><td className="text-right">{fmt0(data.totals.amount)}</td></tr></tfoot>
                                </table></div>
                            </>)}
                            <p className="text-xs text-gray-500 mt-2">Cash / credit: a cash bill is cash; money received on a credit bill counts as cash; returns by their settlement (cash refund / credit). Receipts and payments are split by their cash or bank ledger. Net credit = credit sales - returns - receipts - credit purchases + purchase returns + payments.</p>
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
}
