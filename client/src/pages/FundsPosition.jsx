// =============================================
// FundsPosition.jsx
// Net Position of Funds (server/utils/fundsPosition.js): cash, banks (with
// uncleared cheques / deposits from Bank Reconciliation and the bank's
// statement balance), overdrafts and unused limits, PDC in hand / issued,
// receivables / payables, and a day / week-wise forecast from PDC dates.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt2 = n => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const neg = n => (Number(n) < 0 ? 'text-red-600' : '');

export default function FundsPosition() {
    const { authFetch } = useAuth();
    const [cfg, setCfg] = useState({ as_on: new Date().toISOString().slice(0, 10), horizon_days: 30, forecast_step: '', with_reco: true });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPdc, setShowPdc] = useState('');

    const run = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ as_on: cfg.as_on, horizon_days: String(cfg.horizon_days), with_reco: String(cfg.with_reco) });
            if (cfg.forecast_step) p.set('forecast_step', cfg.forecast_step);
            setData((await authFetch(`/api/reports/funds-position?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, cfg]);
    useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const S = data?.summary;
    const Line = ({ label, value, strong, sign, hint }) => (
        <tr className={strong ? 'font-bold bg-blue-50' : ''}>
            <td className="py-1 pr-4">{sign && <span className="text-gray-400 mr-1">{sign}</span>}{label}{hint && <span className="text-xs text-gray-400 ml-2">{hint}</span>}</td>
            <td className={`py-1 text-right tabular-nums ${neg(value)}`}>{fmt2(value)}</td>
        </tr>
    );

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">💰 Net Position of Funds</span></div>
            <div className="erp-tab-content">
                <div className="flex flex-wrap gap-3 items-end mb-3 print:hidden">
                    <div className="erp-field"><label className="erp-label">As on</label><input type="date" className="erp-input" value={cfg.as_on} onChange={e => setCfg(c => ({ ...c, as_on: e.target.value }))} /></div>
                    <div className="erp-field"><label className="erp-label">Forecast days</label><input type="number" min="7" max="180" className="erp-input w-24" value={cfg.horizon_days} onChange={e => setCfg(c => ({ ...c, horizon_days: e.target.value }))} /></div>
                    <div className="erp-field"><label className="erp-label">Forecast by</label>
                        <select className="erp-select" value={cfg.forecast_step} onChange={e => setCfg(c => ({ ...c, forecast_step: e.target.value }))}>
                            <option value="">Auto</option><option value="day">Day</option><option value="week">Week</option>
                        </select></div>
                    <label className="flex items-center gap-1 text-sm mb-2"><input type="checkbox" checked={cfg.with_reco} onChange={e => setCfg(c => ({ ...c, with_reco: e.target.checked }))} /> Uncleared cheques from Bank Reconciliation</label>
                    <button className="erp-btn primary" onClick={run} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {data && (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[['Net funds available', S.net_funds], ['After PDC', S.net_after_pdc], ['Net working funds', S.net_working_funds], ['Funds incl. unused limits', S.funds_with_limits]].map(([l, v]) => (
                                <div key={l} className="border rounded p-3"><div className="text-xs text-gray-500">{l}</div><div className={`text-xl font-semibold tabular-nums ${neg(v)}`}>{fmt2(v)}</div></div>
                            ))}
                        </div>
                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <div className="font-semibold mb-1">Position as on {data.as_on}</div>
                                <table className="w-full text-sm"><tbody>
                                    <Line label="Cash in hand" value={S.cash_in_hand} />
                                    <Line label="Bank balances (books, overdraft as minus)" value={S.bank_balance} sign="+" />
                                    <Line label="Net funds available" value={S.net_funds} strong />
                                    <Line label="PDC received, not yet deposited / posted" value={S.pdc_received} sign="+" />
                                    <Line label="PDC issued, not yet posted" value={-S.pdc_issued} sign="−" />
                                    <Line label="Net funds after PDC" value={S.net_after_pdc} strong />
                                    <Line label="Receivables (net of customer advances)" value={S.net_receivable} sign="+" hint={`gross ${fmt2(S.receivables)} · advances ${fmt2(S.advance_from_customers)}`} />
                                    <Line label="Payables (net of supplier advances)" value={-S.net_payable} sign="−" hint={`gross ${fmt2(S.payables)} · advances ${fmt2(S.advance_to_suppliers)}`} />
                                    <Line label="Net working funds" value={S.net_working_funds} strong />
                                    <Line label="Unused overdraft / bank limits" value={S.unused_limits} sign="+" />
                                    <Line label="Funds available including limits" value={S.funds_with_limits} strong />
                                </tbody></table>
                                {(S.uncleared_issued > 0 || S.uncleared_deposits > 0) && (
                                    <p className="text-xs text-gray-500 mt-2">Bank books include cheques issued not yet presented {fmt2(S.uncleared_issued)} and deposits not yet credited {fmt2(S.uncleared_deposits)}.</p>
                                )}
                            </div>
                            <div>
                                <div className="font-semibold mb-1">Cash & Bank</div>
                                <table className="erp-grid-table w-full text-sm">
                                    <thead><tr><th className="text-left">Ledger</th><th className="text-right">Books</th><th className="text-right">Chq not presented</th><th className="text-right">Dep. not credited</th>
                                        <th className="text-right">Cleared balance</th><th className="text-right">Statement</th><th className="text-right">Unused limit</th></tr></thead>
                                    <tbody>
                                        {data.cash.map(l => <tr key={l.id}><td>{l.name}</td><td className={`text-right tabular-nums ${neg(l.balance)}`}>{fmt2(l.balance)}</td><td colSpan={5} className="text-xs text-gray-400">cash</td></tr>)}
                                        {data.banks.map(b => (
                                            <tr key={b.id}>
                                                <td>{b.name}{b.kind === 'overdraft' && <span className="text-[10px] ml-1 text-orange-700">OD</span>}{b.account_number ? <div className="text-[10px] text-gray-400">{b.bank_name} {b.account_number}</div> : null}</td>
                                                <td className={`text-right tabular-nums ${neg(b.book_balance)}`}>{fmt2(b.book_balance)}</td>
                                                <td className="text-right tabular-nums">{b.uncleared_issued ? fmt2(b.uncleared_issued) : ''}</td>
                                                <td className="text-right tabular-nums">{b.uncleared_deposits ? fmt2(b.uncleared_deposits) : ''}</td>
                                                <td className={`text-right tabular-nums ${neg(b.cleared_balance)}`}>{fmt2(b.cleared_balance)}</td>
                                                <td className="text-right tabular-nums">{b.statement_balance === null ? '' : <>{fmt2(b.statement_balance)}<div className="text-[10px] text-gray-400">{b.statement_date}</div></>}</td>
                                                <td className="text-right tabular-nums">{b.unused_limit ? fmt2(b.unused_limit) : ''}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="flex gap-2 mt-3 text-sm">
                                    <button className="erp-btn" onClick={() => setShowPdc(showPdc === 'received' ? '' : 'received')}>PDC received ({data.pdc_received.count}) {fmt2(data.pdc_received.total)}</button>
                                    <button className="erp-btn" onClick={() => setShowPdc(showPdc === 'issued' ? '' : 'issued')}>PDC issued ({data.pdc_issued.count}) {fmt2(data.pdc_issued.total)}</button>
                                </div>
                                {showPdc && (
                                    <table className="erp-grid-table w-full text-xs mt-2">
                                        <thead><tr><th className="text-left">PDC</th><th className="text-left">Party</th><th className="text-left">Cheque</th><th className="text-left">Cheque Date</th><th className="text-right">Amount</th></tr></thead>
                                        <tbody>{data[`pdc_${showPdc}`].list.map(p => (
                                            <tr key={p.id} className={p.cheque_date <= data.as_on ? 'text-orange-700' : ''}><td>{p.doc_no}</td><td>{p.party_name_snapshot}</td><td>{p.cheque_no} {p.bank_name}</td><td>{p.cheque_date}{p.cheque_date <= data.as_on ? ' (matured)' : ''}</td><td className="text-right tabular-nums">{fmt2(p.amount)}</td></tr>
                                        ))}</tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                        <div>
                            <div className="font-semibold mb-1">Funds forecast (next {data.horizon_days} days, by PDC cheque dates)</div>
                            <table className="erp-grid-table w-full text-sm">
                                <thead><tr><th className="text-left">Period</th><th className="text-right">Opening</th><th className="text-right">PDC in</th><th className="text-right">PDC out</th><th className="text-right">Closing</th><th className="text-right">Closing + unused limits</th></tr></thead>
                                <tbody>{data.forecast.map((r, i) => (
                                    <tr key={i} className={r.shortfall ? 'bg-red-50' : ''}>
                                        <td>{r.label}</td><td className={`text-right tabular-nums ${neg(r.opening)}`}>{fmt2(r.opening)}</td>
                                        <td className="text-right tabular-nums text-green-700">{r.inflow ? fmt2(r.inflow) : ''}</td><td className="text-right tabular-nums text-red-700">{r.outflow ? fmt2(r.outflow) : ''}</td>
                                        <td className={`text-right tabular-nums font-semibold ${neg(r.closing)}`}>{fmt2(r.closing)}</td>
                                        <td className={`text-right tabular-nums ${neg(r.with_limits)}`}>{fmt2(r.with_limits)}{r.shortfall ? ' ⚠' : ''}</td>
                                    </tr>
                                ))}</tbody>
                            </table>
                            {data.lowest_point && <p className="text-xs text-gray-600 mt-1">Lowest point: {fmt2(data.lowest_point.closing)} ({data.lowest_point.label}).</p>}
                        </div>
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
