// =============================================
// BankReconciliation.jsx
//   Reconcile   book entries of the bank (uncleared + the period) beside
//               the uploaded bank statement lines. Manual: tick entries and
//               mark them cleared on a date, or pick a bank line and the
//               book entries that make it up and Match. Auto match: the
//               in-app matching engine (amount, cheque / ref no, date,
//               fuzzy party / narration text) proposes pairs with a score -
//               apply the high-confidence ones or the ones you tick.
//   Upload      bank statement Excel (.xlsx) / CSV / text / HTML-".xls";
//               header and columns detected, adjustable; lines already
//               imported are skipped.
//   BRS         Bank Reconciliation Statement as on a date.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import { FIELDS, readStatementFile, detectColumns, toLines } from '../utils/bankStatement';
import { bsToAd } from '../utils/bsCalendar';

const fmt2 = n => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const iso = d => d.toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

export default function BankReconciliation() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState('reconcile');
    const [banks, setBanks] = useState([]);
    const [bankId, setBankId] = useState('');
    const [range, setRange] = useState({ from: monthStart(), to: iso(new Date()) });
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    // reconcile
    const [book, setBook] = useState([]);
    const [stmt, setStmt] = useState([]);
    const [ticked, setTicked] = useState(() => new Set());
    const [clearDate, setClearDate] = useState(iso(new Date()));
    const [bookFilter, setBookFilter] = useState('uncleared');
    const [picked, setPicked] = useState(null);             // statement line being matched by hand
    const [auto, setAuto] = useState(null);
    const [autoCfg, setAutoCfg] = useState({ window_days: 7, min_score: 50 });
    const [autoSel, setAutoSel] = useState(() => new Set());
    const [busy, setBusy] = useState(false);
    // upload
    const [file, setFile] = useState(null);
    const [rows, setRows] = useState(null);
    const [headerIndex, setHeaderIndex] = useState(-1);
    const [mapping, setMapping] = useState({});
    const [dayFirst, setDayFirst] = useState('auto');
    const [statements, setStatements] = useState([]);
    // brs
    const [asOn, setAsOn] = useState(iso(new Date()));
    const [brs, setBrs] = useState(null);

    useEffect(() => {
        authFetch('/api/bank-reco/ledgers').then(r => {
            const list = (r.data || []).filter(l => l.kind !== 'cash');
            setBanks(list);
            if (list.length) setBankId(id => id || list[0].id);
        }).catch(e => setError(e.message));
    }, [authFetch]);

    const load = useCallback(async () => {
        if (!bankId) return;
        setError('');
        try {
            const [b, s, st] = await Promise.all([
                authFetch(`/api/bank-reco/book?bank_ledger_id=${bankId}&from=${range.from}&to=${range.to}&uncleared=true`),
                authFetch(`/api/bank-reco/statement-lines?bank_ledger_id=${bankId}&from=${range.from}&to=${range.to}`),
                authFetch(`/api/bank-reco/statements?bank_ledger_id=${bankId}`)
            ]);
            setBook(b.data || []); setStmt(s.data || []); setStatements(st.data || []); setTicked(new Set()); setPicked(null);
        } catch (e) { setError(e.message); }
    }, [authFetch, bankId, range]);
    useEffect(() => { load(); }, [load]);

    const call = async (url, body, okMsg) => {
        setBusy(true); setError(''); setMsg('');
        try { const r = await authFetch(url, { method: 'POST', body: JSON.stringify({ bank_ledger_id: bankId, ...body }) }); setMsg(okMsg ? okMsg(r.data) : 'Done'); await load(); return r.data; }
        catch (e) { setError(e.message); return null; }
        finally { setBusy(false); }
    };

    // ---- reconcile
    const shownBook = useMemo(() => {
        let list = book;
        if (bookFilter === 'uncleared') list = list.filter(b => !b.cleared_date || b.cleared_date > range.to);
        if (bookFilter === 'cleared') list = list.filter(b => b.cleared_date && b.cleared_date <= range.to);
        if (picked) list = list.filter(b => !b.cleared_date && Math.sign(b.amount) === (picked.deposit ? 1 : -1));
        return list;
    }, [book, bookFilter, picked, range.to]);
    const tickedSum = book.filter(b => ticked.has(b.id)).reduce((s, b) => s + b.amount, 0);
    const pickedAmt = picked ? (picked.deposit ? picked.deposit : -picked.withdrawal) : 0;
    const toggle = id => setTicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const runAuto = async apply => {
        const r = await call('/api/bank-reco/auto-match', { ...autoCfg, from: range.from, to: range.to, apply: apply || false, selected: [...autoSel] },
            d => (apply ? `${d.applied} match(es) applied` : `${d.proposals.length} match(es) found - review and apply`));
        if (r && !apply) { setAuto(r); setAutoSel(new Set(r.proposals.filter(p => p.confidence === 'high').map(p => p.statement_line_id))); }
        if (r && apply) setAuto(null);
    };
    const bookTotals = { dep: shownBook.reduce((s, b) => s + b.deposit, 0), wd: shownBook.reduce((s, b) => s + b.withdrawal, 0) };

    // ---- upload
    const onFile = async f => {
        setFile(f); setRows(null); setError(''); setMsg('');
        if (!f) return;
        try {
            const r = await readStatementFile(f);
            const d = detectColumns(r);
            setRows(r); setHeaderIndex(d.headerIndex); setMapping(d.mapping);
            if (d.headerIndex < 0) setError('Could not find the header row (Date / Debit / Credit / Balance). Pick it below.');
        } catch (e) { setError(e.message); }
    };
    const parsed = useMemo(() => (rows && headerIndex >= 0 && mapping.date !== undefined
        ? toLines(rows, headerIndex, mapping, { dayFirst: dayFirst === 'auto' ? null : dayFirst === 'dmy', bsToAd }) : null), [rows, headerIndex, mapping, dayFirst]);
    const doImport = async () => {
        if (!parsed?.lines.length) return;
        const r = await call('/api/bank-reco/statements', { file_name: file?.name || '', lines: parsed.lines },
            d => `Imported ${d.imported} line(s) ${d.from} to ${d.to}${d.skipped_duplicates ? ` · ${d.skipped_duplicates} already imported, skipped` : ''}`);
        if (r) { setRows(null); setFile(null); setTab('reconcile'); }
    };
    const delStatement = async id => {
        if (!window.confirm('Delete this statement and its matches?')) return;
        setBusy(true);
        try { await authFetch(`/api/bank-reco/statements/${id}?bank_ledger_id=${bankId}`, { method: 'DELETE' }); await load(); } catch (e) { setError(e.message); }
        setBusy(false);
    };

    // ---- brs
    const runBrs = useCallback(async () => {
        if (!bankId) return;
        try { setBrs((await authFetch(`/api/bank-reco/brs?bank_ledger_id=${bankId}&as_on=${asOn}`)).data); } catch (e) { setError(e.message); }
    }, [authFetch, bankId, asOn]);
    useEffect(() => { if (tab === 'brs') runBrs(); }, [tab, runBrs]);

    const BrsBlock = ({ title, list, total, sign, cols }) => (
        <div className="mb-3">
            <div className="flex justify-between font-medium"><span>{sign} {title}</span><span className="tabular-nums">{fmt2(total)}</span></div>
            {list.length > 0 && (
                <table className="w-full text-xs text-gray-600 ml-4"><tbody>{list.map(x => (
                    <tr key={x.id}>{cols(x).map((v, i) => <td key={i} className={i === cols(x).length - 1 ? 'text-right tabular-nums pr-4' : 'pr-3'}>{v}</td>)}</tr>
                ))}</tbody></table>
            )}
        </div>
    );

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">🏦 Bank Reconciliation</span></div>
            <div className="erp-tab-content">
                <div className="flex flex-wrap gap-3 items-end mb-3 print:hidden">
                    <div className="erp-field"><label className="erp-label">Bank</label>
                        <select className="erp-select" value={bankId} onChange={e => { setBankId(e.target.value); setAuto(null); setBrs(null); }}>
                            {banks.map(b => <option key={b.id} value={b.id}>{b.name}{b.account_number ? ` · ${b.account_number}` : ''}{b.kind === 'overdraft' ? ' (OD)' : ''}</option>)}
                        </select></div>
                    <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></div>
                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></div>
                    <div className="flex gap-1 ml-auto">
                        {[['reconcile', '🔗 Reconcile'], ['upload', '⬆ Upload Statement'], ['brs', '📄 BRS']].map(([k, l]) => (
                            <button key={k} className={`px-3 py-2 text-sm rounded ${tab === k ? 'bg-blue-600 text-white' : 'bg-gray-100'}`} onClick={() => setTab(k)}>{l}</button>
                        ))}
                    </div>
                </div>
                {!banks.length && <p className="text-sm text-gray-500">No bank ledgers found (ledgers under Cash &amp; Bank tagged bank, with a bank account no, or under Bank Overdraft).</p>}
                {error && <p className="text-sm text-red-600 mb-2 print:hidden">{error}</p>}
                {msg && <p className="text-sm text-green-700 mb-2 print:hidden">{msg}</p>}

                {tab === 'reconcile' && bankId && (
                    <>
                        <div className="flex flex-wrap gap-2 items-center mb-2 p-2 bg-gray-50 rounded text-sm">
                            <b>Auto match</b>
                            <label>date window <input type="number" min="0" max="60" className="border rounded px-1 w-14" value={autoCfg.window_days} onChange={e => setAutoCfg(c => ({ ...c, window_days: e.target.value }))} /> days</label>
                            <label>min score <input type="number" min="30" max="100" className="border rounded px-1 w-14" value={autoCfg.min_score} onChange={e => setAutoCfg(c => ({ ...c, min_score: e.target.value }))} /></label>
                            <button className="erp-btn primary" disabled={busy} onClick={() => runAuto(false)}>🔍 Find matches</button>
                            <button className="erp-btn" disabled={busy} onClick={() => runAuto('high')}>⚡ Apply high-confidence directly</button>
                            <span className="text-xs text-gray-500">Scores amount, cheque/ref no, date gap and party / narration text - nothing leaves your server.</span>
                        </div>
                        {auto && (
                            <div className="mb-3 border rounded p-2">
                                <div className="flex items-center gap-2 mb-1 text-sm">
                                    <b>{auto.proposals.length} proposed match(es)</b>
                                    <button className="erp-btn primary" disabled={busy || !autoSel.size} onClick={() => runAuto('selected')}>✔ Apply ticked ({autoSel.size})</button>
                                    <button className="erp-btn" onClick={() => setAuto(null)}>Close</button>
                                </div>
                                <div className="max-h-72 overflow-auto">
                                    <table className="erp-grid-table w-full text-xs">
                                        <thead><tr><th /><th className="text-left">Bank date</th><th className="text-left">Bank description</th><th className="text-right">Amount</th><th className="text-left">Book entries</th><th className="text-right">Score</th><th className="text-left">Why</th></tr></thead>
                                        <tbody>{auto.proposals.map(p => (
                                            <tr key={p.statement_line_id} className={p.confidence === 'high' ? 'bg-green-50' : 'bg-yellow-50'}>
                                                <td><input type="checkbox" checked={autoSel.has(p.statement_line_id)} onChange={() => setAutoSel(s => { const n = new Set(s); if (n.has(p.statement_line_id)) n.delete(p.statement_line_id); else n.add(p.statement_line_id); return n; })} /></td>
                                                <td>{p.statement.txn_date}</td><td>{p.statement.description} {p.statement.ref_no}</td>
                                                <td className="text-right tabular-nums">{fmt2(p.statement.deposit || -p.statement.withdrawal)}</td>
                                                <td>{p.books.map(b => `${b.date} ${b.doc_no} ${b.party || b.counter} ${b.ref_no ? `#${b.ref_no}` : ''} (${fmt2(b.amount)})`).join(' + ')}</td>
                                                <td className="text-right font-semibold">{p.score}</td><td>{p.reason}</td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>
                                {auto.unmatched_statement.length > 0 && <p className="text-xs text-gray-600 mt-1">Not found in books: {auto.unmatched_statement.slice(0, 8).map(s => `${s.description} (${fmt2(s.deposit || -s.withdrawal)}) → ${s.suggestion}`).join(' · ')}{auto.unmatched_statement.length > 8 ? ' …' : ''}</p>}
                            </div>
                        )}
                        <div className="grid lg:grid-cols-2 gap-4">
                            <div>
                                <div className="flex flex-wrap items-center gap-2 mb-1 text-sm">
                                    <b>Books</b>
                                    <select className="border rounded px-1" value={bookFilter} onChange={e => setBookFilter(e.target.value)}>
                                        <option value="uncleared">Uncleared</option><option value="cleared">Cleared</option><option value="all">All</option>
                                    </select>
                                    <span>cleared on</span><input type="date" className="border rounded px-1" value={clearDate} onChange={e => setClearDate(e.target.value)} />
                                    <button className="erp-btn" disabled={busy || !ticked.size} onClick={() => call('/api/bank-reco/clear', { items: [...ticked].map(id => ({ id, cleared_date: clearDate })) }, d => `${d.cleared} entr(ies) marked cleared`)}>✔ Mark cleared</button>
                                    <button className="erp-btn" disabled={busy || !ticked.size} onClick={() => call('/api/bank-reco/unclear', { line_ids: [...ticked] }, d => `${d.uncleared} entr(ies) uncleared`)}>↺ Unclear</button>
                                    {picked && (
                                        <>
                                            <span className={Math.abs(tickedSum - pickedAmt) < 0.005 ? 'text-green-700' : 'text-orange-700'}>ticked {fmt2(tickedSum)} / bank {fmt2(pickedAmt)}</span>
                                            <button className="erp-btn primary" disabled={busy || Math.abs(tickedSum - pickedAmt) >= 0.005} onClick={() => call('/api/bank-reco/match', { statement_line_id: picked.id, book_line_ids: [...ticked] }, () => 'Matched')}>🔗 Match</button>
                                            <button className="erp-btn" onClick={() => setPicked(null)}>✕</button>
                                        </>
                                    )}
                                </div>
                                <div className="max-h-[60vh] overflow-auto">
                                    <table className="erp-grid-table w-full text-xs">
                                        <thead><tr><th /><th className="text-left">Date</th><th className="text-left">Document</th><th className="text-left">Party / Ledger</th><th className="text-left">Chq / Ref</th>
                                            <th className="text-right">Deposit</th><th className="text-right">Withdrawal</th><th className="text-left">Cleared</th></tr></thead>
                                        <tbody>
                                            {shownBook.map(b => (
                                                <tr key={b.id} className={`cursor-pointer ${ticked.has(b.id) ? 'bg-yellow-50' : ''}`} onClick={() => toggle(b.id)}>
                                                    <td><input type="checkbox" readOnly checked={ticked.has(b.id)} /></td>
                                                    <td>{b.date}</td><td>{b.doc_no} <span className="text-gray-400">{b.doc_label}</span></td>
                                                    <td title={b.narration}>{b.party || b.counter}</td><td>{b.ref_no}</td>
                                                    <td className="text-right tabular-nums">{b.deposit ? fmt2(b.deposit) : ''}</td><td className="text-right tabular-nums">{b.withdrawal ? fmt2(b.withdrawal) : ''}</td>
                                                    <td>{b.cleared_date ? `${b.cleared_date}${b.method === 'auto' ? ` (auto ${b.score ?? ''})` : ''}` : ''}</td>
                                                </tr>
                                            ))}
                                            {!shownBook.length && <tr><td colSpan={8} className="text-center text-gray-400 py-3">Nothing here.</td></tr>}
                                        </tbody>
                                        <tfoot><tr className="font-semibold"><td colSpan={5} className="text-right">Total</td><td className="text-right tabular-nums">{fmt2(bookTotals.dep)}</td><td className="text-right tabular-nums">{fmt2(bookTotals.wd)}</td><td /></tr></tfoot>
                                    </table>
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1 text-sm"><b>Bank statement</b><span className="text-xs text-gray-500">click an unmatched line, tick its book entries, Match</span></div>
                                <div className="max-h-[60vh] overflow-auto">
                                    <table className="erp-grid-table w-full text-xs">
                                        <thead><tr><th className="text-left">Date</th><th className="text-left">Description</th><th className="text-right">Withdrawal</th><th className="text-right">Deposit</th><th className="text-right">Balance</th><th className="text-left">Status</th></tr></thead>
                                        <tbody>
                                            {stmt.map(s => (
                                                <tr key={s.id} className={`${picked?.id === s.id ? 'bg-blue-100' : s.status === 'matched' ? 'bg-green-50' : s.status === 'ignored' ? 'text-gray-400' : 'cursor-pointer hover:bg-blue-50'}`}
                                                    onClick={() => { if (s.status === 'unmatched') { setPicked(s); setTicked(new Set()); } }}>
                                                    <td>{s.txn_date}</td><td>{s.description}{s.ref_no ? <span className="text-gray-400"> #{s.ref_no}</span> : null}</td>
                                                    <td className="text-right tabular-nums">{s.withdrawal ? fmt2(s.withdrawal) : ''}</td><td className="text-right tabular-nums">{s.deposit ? fmt2(s.deposit) : ''}</td>
                                                    <td className="text-right tabular-nums">{fmt2(s.balance)}</td>
                                                    <td onClick={e => e.stopPropagation()} className="whitespace-nowrap">
                                                        {s.status === 'matched' && <>✔ {s.match_score ? `(${s.match_score})` : ''} <button className="text-red-600 underline" onClick={() => call('/api/bank-reco/unmatch', { statement_line_id: s.id }, () => 'Unmatched')}>undo</button></>}
                                                        {s.status === 'unmatched' && <button className="text-gray-600 underline" onClick={() => call('/api/bank-reco/ignore', { statement_line_ids: [s.id], ignored: true }, () => 'Ignored')}>ignore</button>}
                                                        {s.status === 'ignored' && <button className="text-gray-600 underline" onClick={() => call('/api/bank-reco/ignore', { statement_line_ids: [s.id], ignored: false }, () => 'Restored')}>restore</button>}
                                                    </td>
                                                </tr>
                                            ))}
                                            {!stmt.length && <tr><td colSpan={6} className="text-center text-gray-400 py-3">No statement lines in this period - upload the bank statement, or reconcile by hand on the left.</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'upload' && bankId && (
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <input type="file" accept=".xlsx,.csv,.txt,.tsv,.xls,.htm,.html" onChange={e => onFile(e.target.files[0] || null)} />
                            <span className="text-xs text-gray-500">Excel (.xlsx), CSV, text, or the HTML “.xls” many banks give. Old binary .xls: save as .xlsx first.</span>
                        </div>
                        {rows && (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-2 text-sm">
                                    <div className="erp-field"><label className="erp-label">Header row</label>
                                        <select className="erp-select" value={headerIndex} onChange={e => setHeaderIndex(Number(e.target.value))}>
                                            <option value={-1}>—</option>
                                            {rows.slice(0, 40).map((r, i) => <option key={i} value={i}>{i + 1}: {r.filter(Boolean).join(' | ').slice(0, 50)}</option>)}
                                        </select></div>
                                    {FIELDS.map(f => (
                                        <div key={f.key} className="erp-field"><label className="erp-label">{f.label}</label>
                                            <select className="erp-select" value={mapping[f.key] ?? ''} onChange={e => setMapping(m => { const n = { ...m }; if (e.target.value === '') delete n[f.key]; else n[f.key] = Number(e.target.value); return n; })}>
                                                <option value="">—</option>
                                                {(rows[headerIndex] || rows[0] || []).map((h, i) => <option key={i} value={i}>{String(h || `Column ${i + 1}`).slice(0, 30)}</option>)}
                                            </select></div>
                                    ))}
                                    <div className="erp-field"><label className="erp-label">Date order</label>
                                        <select className="erp-select" value={dayFirst} onChange={e => setDayFirst(e.target.value)}>
                                            <option value="auto">Auto{parsed ? ` (${parsed.dayFirst ? 'DD/MM' : 'MM/DD'})` : ''}</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option>
                                        </select></div>
                                </div>
                                {parsed && (
                                    <>
                                        <div className="text-sm">
                                            {parsed.lines.length} transaction line(s) · withdrawals {fmt2(parsed.lines.reduce((s, l) => s + l.withdrawal, 0))} · deposits {fmt2(parsed.lines.reduce((s, l) => s + l.deposit, 0))}
                                            {parsed.lines.length > 0 && ` · ${parsed.lines[0].txn_date} to ${parsed.lines[parsed.lines.length - 1].txn_date}`}
                                            <button className="erp-btn primary ml-3" disabled={busy || !parsed.lines.length} onClick={doImport}>⬆ Import into {banks.find(b => b.id === bankId)?.name}</button>
                                        </div>
                                        {parsed.skipped.length > 0 && <p className="text-xs text-orange-700">Rows not read (no date): {parsed.skipped.slice(0, 5).map(s => `row ${s.row}: ${s.text}`).join(' · ')}{parsed.skipped.length > 5 ? ` … (${parsed.skipped.length})` : ''}</p>}
                                        <div className="max-h-80 overflow-auto">
                                            <table className="erp-grid-table w-full text-xs">
                                                <thead><tr><th className="text-left">Date</th><th className="text-left">Value</th><th className="text-left">Description</th><th className="text-left">Ref</th><th className="text-right">Withdrawal</th><th className="text-right">Deposit</th><th className="text-right">Balance</th></tr></thead>
                                                <tbody>{parsed.lines.slice(0, 200).map((l, i) => (
                                                    <tr key={i}><td>{l.txn_date}</td><td>{l.value_date || ''}</td><td>{l.description}</td><td>{l.ref_no}</td><td className="text-right tabular-nums">{l.withdrawal ? fmt2(l.withdrawal) : ''}</td><td className="text-right tabular-nums">{l.deposit ? fmt2(l.deposit) : ''}</td><td className="text-right tabular-nums">{fmt2(l.balance)}</td></tr>
                                                ))}</tbody>
                                            </table>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                        <div>
                            <div className="font-medium text-sm mb-1">Imported statements</div>
                            <table className="erp-grid-table w-full text-xs">
                                <thead><tr><th className="text-left">Imported</th><th className="text-left">File</th><th className="text-left">Period</th><th className="text-right">Lines</th><th className="text-right">Skipped (dup.)</th><th className="text-right">Closing balance</th><th /></tr></thead>
                                <tbody>{statements.map(s => (
                                    <tr key={s.id}><td>{String(s.created_at || '').slice(0, 16).replace('T', ' ')}</td><td>{s.file_name}</td><td>{s.statement_from} – {s.statement_to}</td>
                                        <td className="text-right">{s.line_count}</td><td className="text-right">{s.skipped_duplicates || ''}</td><td className="text-right tabular-nums">{fmt2(s.closing_balance)}</td>
                                        <td><button className="text-red-600 underline" onClick={() => delStatement(s.id)}>delete</button></td></tr>
                                ))}
                                {!statements.length && <tr><td colSpan={7} className="text-center text-gray-400 py-2">None yet.</td></tr>}</tbody>
                            </table>
                        </div>
                    </div>
                )}

                {tab === 'brs' && bankId && (
                    <div>
                        <div className="flex gap-2 items-end mb-3 print:hidden">
                            <div className="erp-field"><label className="erp-label">As on</label><input type="date" className="erp-input" value={asOn} onChange={e => setAsOn(e.target.value)} /></div>
                            <button className="erp-btn primary" onClick={runBrs}>🔍 Show</button>
                            {brs && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                        </div>
                        {brs && (
                            <div className="max-w-3xl text-sm">
                                <div className="text-center mb-3"><div className="font-bold text-base">Bank Reconciliation Statement</div><div>{brs.bank.name}{brs.bank.account_number ? ` · A/c ${brs.bank.account_number}` : ''} · as on {brs.as_on}</div></div>
                                <div className="flex justify-between font-bold border-b pb-1 mb-2"><span>Balance as per books</span><span className="tabular-nums">{fmt2(brs.balance_per_books)}</span></div>
                                <BrsBlock title="Cheques issued / payments not yet presented" sign="Add:" list={brs.cheques_not_presented} total={brs.cheques_not_presented_total} cols={x => [x.date, `${x.doc_no} ${x.party || x.counter}`, x.ref_no, fmt2(x.withdrawal)]} />
                                <BrsBlock title="Deposits not yet credited by bank" sign="Less:" list={brs.deposits_not_credited} total={brs.deposits_not_credited_total} cols={x => [x.date, `${x.doc_no} ${x.party || x.counter}`, x.ref_no, fmt2(x.deposit)]} />
                                <BrsBlock title="Credited by bank, not in books" sign="Add:" list={brs.bank_credits_not_in_books} total={brs.bank_credits_total} cols={x => [x.txn_date, x.description, x.suggestion, fmt2(x.deposit)]} />
                                <BrsBlock title="Debited by bank, not in books" sign="Less:" list={brs.bank_debits_not_in_books} total={brs.bank_debits_total} cols={x => [x.txn_date, x.description, x.suggestion, fmt2(x.withdrawal)]} />
                                <div className="flex justify-between font-bold border-t pt-1"><span>Balance as per bank (computed)</span><span className="tabular-nums">{fmt2(brs.balance_per_bank_computed)}</span></div>
                                {brs.statement_balance ? (
                                    <>
                                        <div className="flex justify-between mt-1"><span>Balance as per bank statement ({brs.statement_balance.date})</span><span className="tabular-nums">{fmt2(brs.statement_balance.balance)}</span></div>
                                        <div className={`flex justify-between font-semibold ${Math.abs(brs.difference) < 0.005 ? 'text-green-700' : 'text-red-600'}`}><span>Difference</span><span className="tabular-nums">{fmt2(brs.difference)}{Math.abs(brs.difference) < 0.005 ? ' ✔ reconciled' : ''}</span></div>
                                    </>
                                ) : <p className="text-xs text-gray-500 mt-1">No statement balance up to this date - upload the statement to compare.</p>}
                                {brs.ignored_lines > 0 && <p className="text-xs text-gray-500 mt-2">{brs.ignored_lines} ignored statement line(s) are left out.</p>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
