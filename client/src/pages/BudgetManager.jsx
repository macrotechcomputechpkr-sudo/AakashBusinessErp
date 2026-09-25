// =============================================
// BudgetManager.jsx  (/budgets)
// Budgets with accounting dimensions (server: utils/budgetReports.js)
//   Budget     name + period; amount per line as a total (spread evenly over
//              the months) or month by month
//   Lines      a ledger or an account group, optionally narrowed to a
//              sub-ledger, cost center, unit, branch and / or document class
//   Reports    Budget vs Actual (variance), Month-wise (with cumulative),
//              by dimension (ledger / group / sub-ledger / cost center / unit /
//              branch / doc class / statement), Unbudgeted spending, and the
//              transactions behind any line
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthsOf = (from, to) => {
    const out = [];
    if (!from || !to || to < from) return out;
    for (let d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= to.slice(0, 7); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(d.toISOString().slice(0, 7));
    return out;
};
const DIMS = [['sub_ledger_id', 'Sub-ledger', 'subs', 'sub_ledger_name'], ['cost_center_id', 'Cost Center', 'ccs', 'cost_center_name'], ['business_unit_id', 'Unit', 'bus', 'unit_name'], ['branch_id', 'Branch', 'branches', 'branch_name'], ['doc_class_id', 'Doc Class', 'cats', 'category_name']];
const VIEWS = [['variance', 'Budget vs Actual'], ['monthly', 'Month-wise'], ['by_dimension', 'By Dimension'], ['unbudgeted', 'Unbudgeted Actuals']];
const newLine = () => ({ target_type: 'ledger', ledger_id: '', account_group_id: '', sub_ledger_id: '', cost_center_id: '', business_unit_id: '', branch_id: '', doc_class_id: '', amount: '', month_amounts: {}, remarks: '' });

export default function BudgetManager() {
    const { authFetch } = useAuth();
    const [m, setM] = useState({ ledgers: [], groups: [], subs: [], ccs: [], bus: [], branches: [], cats: [] });
    const [budgets, setBudgets] = useState([]);
    const [sel, setSel] = useState('');
    const [head, setHead] = useState({ budget_name: '', date_from: '', date_to: '', split_type: 'total', notes: '' });
    const [lines, setLines] = useState([]);
    const [view, setView] = useState('variance');
    const [dim, setDim] = useState('cost_center');
    const [report, setReport] = useState(null);
    const [drill, setDrill] = useState(null);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');

    useEffect(() => {
        const load = u => authFetch(u).then(r => r.data || []).catch(() => []);
        Promise.all([load('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc'), load('/api/account-groups'), load('/api/sub-ledgers'), load('/api/cost-centers'), load('/api/business-units'), load('/api/branches'), load('/api/document-numbering-categories')])
            .then(([ledgers, groups, subs, ccs, bus, branches, cats]) => setM({ ledgers, groups, subs, ccs, bus, branches, cats }));
    }, [authFetch]);
    const loadBudgets = useCallback(() => authFetch('/api/budgets').then(r => setBudgets(r.data || [])).catch(e => setError(e.message)), [authFetch]);
    useEffect(() => { loadBudgets(); }, [loadBudgets]);

    const open = async id => {
        setSel(id); setReport(null); setDrill(null); setMsg(''); setError('');
        if (!id) { setHead({ budget_name: '', date_from: '', date_to: '', split_type: 'total', notes: '' }); setLines([newLine()]); return; }
        const b = budgets.find(x => x.id === id);
        setHead({ id, budget_name: b.budget_name, date_from: String(b.date_from).slice(0, 10), date_to: String(b.date_to).slice(0, 10), split_type: b.split_type || 'total', notes: b.notes || '' });
        const r = await authFetch(`/api/budgets/${id}/lines`);
        setLines((r.data || []).map(l => ({ ...newLine(), ...Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v ?? ''])), target_type: l.ledger_id ? 'ledger' : 'group', month_amounts: l.month_amounts || {} })));
    };
    const months = useMemo(() => monthsOf(head.date_from, head.date_to), [head.date_from, head.date_to]);
    const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    const lineTotal = l => (head.split_type === 'monthly' ? months.reduce((s, k) => s + (Number(l.month_amounts?.[k]) || 0), 0) : Number(l.amount) || 0);

    const save = async () => {
        setError(''); setMsg('');
        try {
            const b = (await authFetch('/api/budgets', { method: 'POST', body: JSON.stringify(head) })).data;
            const payload = lines.filter(l => l.ledger_id || l.account_group_id).map(l => ({
                ledger_id: l.target_type === 'ledger' ? l.ledger_id : null, account_group_id: l.target_type === 'group' ? l.account_group_id : null,
                ...Object.fromEntries(DIMS.map(([k]) => [k, l[k] || null])), amount: lineTotal(l), month_amounts: head.split_type === 'monthly' ? l.month_amounts : null, remarks: l.remarks || null
            }));
            await authFetch(`/api/budgets/${b.id}/lines`, { method: 'PUT', body: JSON.stringify({ lines: payload }) });
            await loadBudgets(); setSel(b.id); setHead(h => ({ ...h, id: b.id })); setMsg(`Saved ${payload.length} line(s)`);
        } catch (e) { setError(e.message); }
    };
    const run = useCallback(async () => {
        if (!sel) return;
        setError(''); setDrill(null);
        try { setReport((await authFetch(`/api/budget-reports/${view}?budget_id=${sel}&dimension=${dim}`)).data); } catch (e) { setError(e.message); setReport(null); }
    }, [authFetch, sel, view, dim]);
    useEffect(() => { if (sel) run(); }, [run, sel]);
    const openDrill = async id => { try { setDrill((await authFetch(`/api/budget-reports/transactions?budget_id=${sel}&line_id=${id}`)).data); } catch (e) { setError(e.message); } };
    const pick = (i, l, key, list, label, name) => (
        <select className="erp-select" value={l[key] || ''} onChange={e => setLine(i, { [key]: e.target.value })} title={label}><option value="">{label}: any</option>{list.map(x => <option key={x.id} value={x.id}>{name === 'category_name' ? `${x.category_name} (${x.voucher_type})` : x[name]}</option>)}</select>
    );
    const varCls = r => (r.favourable ? 'text-green-700' : 'text-red-600');

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">💼 Budget & Budget Variance (Ledger · Sub-ledger · Cost Center · Unit · Doc Class)</span></div>
                    <div className="erp-tab-content">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
                            <div className="erp-field"><label className="erp-label">Budget</label>
                                <select className="erp-select" value={sel} onChange={e => open(e.target.value)}><option value="">+ New budget</option>{budgets.map(b => <option key={b.id} value={b.id}>{b.budget_name}</option>)}</select></div>
                            <div className="erp-field"><label className="erp-label">Name</label><input className="erp-input" value={head.budget_name} onChange={e => setHead({ ...head, budget_name: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={head.date_from} onChange={e => setHead({ ...head, date_from: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={head.date_to} onChange={e => setHead({ ...head, date_to: e.target.value })} /></div>
                            <div className="erp-field"><label className="erp-label">Amounts</label>
                                <select className="erp-select" value={head.split_type} onChange={e => setHead({ ...head, split_type: e.target.value })}><option value="total">Total for the period</option><option value="monthly">Month by month</option></select></div>
                            <div className="erp-field"><label className="erp-label">Notes</label><input className="erp-input" value={head.notes} onChange={e => setHead({ ...head, notes: e.target.value })} /></div>
                        </div>
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}

                        <div className="overflow-x-auto border rounded-lg mb-3">
                            <table className="erp-grid-table text-xs">
                                <thead><tr><th>Target</th><th>Ledger / Group</th>{DIMS.map(d => <th key={d[0]}>{d[1]}</th>)}{head.split_type === 'monthly' ? months.map(k => <th key={k}>{k}</th>) : <th>Amount</th>}<th>Total</th><th>Remarks</th><th /></tr></thead>
                                <tbody>{lines.map((l, i) => (
                                    <tr key={i}>
                                        <td><select className="erp-select" value={l.target_type} onChange={e => setLine(i, { target_type: e.target.value })}><option value="ledger">Ledger</option><option value="group">Group</option></select></td>
                                        <td style={{ minWidth: 180 }}>{l.target_type === 'ledger'
                                            ? <select className="erp-select" value={l.ledger_id} onChange={e => setLine(i, { ledger_id: e.target.value })}><option value="">Choose…</option>{m.ledgers.map(x => <option key={x.id} value={x.id}>{x.account_name}</option>)}</select>
                                            : <select className="erp-select" value={l.account_group_id} onChange={e => setLine(i, { account_group_id: e.target.value })}><option value="">Choose…</option>{m.groups.map(x => <option key={x.id} value={x.id}>{x.group_name}</option>)}</select>}</td>
                                        {DIMS.map(([k, label, list, name]) => <td key={k} style={{ minWidth: 120 }}>{pick(i, l, k, k === 'sub_ledger_id' && l.ledger_id ? m.subs.filter(s => !s.main_ledger_id || s.main_ledger_id === l.ledger_id) : m[list], label, name)}</td>)}
                                        {head.split_type === 'monthly'
                                            ? months.map(k => <td key={k}><input type="number" className="erp-input" style={{ width: 90 }} value={l.month_amounts?.[k] ?? ''} onChange={e => setLine(i, { month_amounts: { ...l.month_amounts, [k]: e.target.value } })} /></td>)
                                            : <td><input type="number" className="erp-input" style={{ width: 110 }} value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} /></td>}
                                        <td className="text-right font-semibold">{fmt(lineTotal(l))}</td>
                                        <td><input className="erp-input" style={{ width: 120 }} value={l.remarks || ''} onChange={e => setLine(i, { remarks: e.target.value })} /></td>
                                        <td><button className="text-red-600" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>✕</button></td>
                                    </tr>))}</tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-4">
                            <button className="erp-btn" onClick={() => setLines(ls => [...ls, newLine()])}>➕ Line</button>
                            {head.split_type === 'monthly' && <button className="erp-btn" title="Spread each line's Amount / current total evenly over the months" onClick={() => setLines(ls => ls.map(l => { const t = lineTotal(l) || Number(l.amount) || 0; const per = Math.round((t / (months.length || 1)) * 100) / 100; return { ...l, month_amounts: Object.fromEntries(months.map(k => [k, per])) }; }))}>⇔ Spread evenly</button>}
                            <button className="erp-btn primary" onClick={save}>💾 Save budget</button>
                            {sel && <button className="erp-btn" onClick={async () => { if (window.confirm('Delete this budget?')) { await authFetch(`/api/budgets/${sel}`, { method: 'DELETE' }); await loadBudgets(); open(''); } }}>🗑 Delete</button>}
                            <span className="text-sm ml-auto">Budget total <b>{fmt(lines.reduce((s, l) => s + lineTotal(l), 0))}</b></span>
                        </div>

                        {sel && (<>
                            <div className="flex flex-wrap gap-2 mb-3 items-end no-print">
                                {VIEWS.map(([k, l]) => <button key={k} className={`erp-btn ${view === k ? 'primary' : ''}`} onClick={() => setView(k)}>{l}</button>)}
                                {view === 'by_dimension' && <select className="erp-select" style={{ width: 'auto' }} value={dim} onChange={e => setDim(e.target.value)}>{[['ledger', 'Ledger'], ['group', 'Account Group'], ['section', 'Statement section'], ['sub_ledger', 'Sub-ledger'], ['cost_center', 'Cost Center'], ['business_unit', 'Unit'], ['branch', 'Branch'], ['doc_class', 'Doc Class']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
                                <button className="erp-btn" onClick={() => window.print()}>🖨 Print</button>
                            </div>
                            {report && view === 'variance' && (
                                <table className="erp-grid-table text-sm"><thead><tr><th>Ledger / Group</th><th>Dimensions</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Variance</th><th className="text-right">Var %</th><th className="text-right">Achieved %</th><th /></tr></thead>
                                    <tbody>{report.rows.map(r => <tr key={r.id}><td>{r.name} <span className="text-xs text-gray-400">({r.target_type})</span></td><td className="text-xs">{r.dims_label || '—'}</td><td className="text-right">{fmt(r.budget)}</td><td className="text-right">{fmt(r.actual)}</td>
                                        <td className={`text-right ${varCls(r)}`}>{fmt(r.variance)}</td><td className={`text-right ${varCls(r)}`}>{r.variance_pct ?? '—'}{r.variance_pct !== null ? '%' : ''}</td><td className="text-right">{r.achievement_pct ?? '—'}{r.achievement_pct !== null ? '%' : ''}</td>
                                        <td><button className="text-xs text-blue-600" onClick={() => openDrill(r.id)}>Entries</button></td></tr>)}
                                        <tr className="font-bold bg-slate-50"><td colSpan={2}>Total</td><td className="text-right">{fmt(report.totals.budget)}</td><td className="text-right">{fmt(report.totals.actual)}</td><td className="text-right">{fmt(report.totals.variance)}</td><td colSpan={3} /></tr></tbody></table>
                            )}
                            {report && view === 'monthly' && (
                                <div className="overflow-x-auto"><table className="erp-grid-table text-xs"><thead><tr><th>Line</th>{report.months.map(k => <th key={k} className="text-center" colSpan={3}>{k}</th>)}</tr><tr><th />{report.months.map(k => <React.Fragment key={k}><th className="text-right">Bud.</th><th className="text-right">Act.</th><th className="text-right">Var.</th></React.Fragment>)}</tr></thead>
                                    <tbody>{report.rows.map(r => <tr key={r.id}><td>{r.name}{r.dims_label ? <div className="text-gray-400">{r.dims_label}</div> : ''}</td>{r.months.map(x => <React.Fragment key={x.key}><td className="text-right">{fmt(x.budget)}</td><td className="text-right">{fmt(x.actual)}</td><td className={`text-right ${(['trading_expense', 'indirect_expense'].includes(r.section) ? x.variance <= 0 : x.variance >= 0) ? 'text-green-700' : 'text-red-600'}`}>{fmt(x.variance)}</td></React.Fragment>)}</tr>)}
                                        <tr className="font-bold bg-slate-50"><td>Total</td>{report.totals.map(x => <React.Fragment key={x.key}><td className="text-right">{fmt(x.budget)}</td><td className="text-right">{fmt(x.actual)}</td><td className="text-right">{fmt(x.variance)}</td></React.Fragment>)}</tr>
                                        <tr className="bg-blue-50"><td>Cumulative</td>{report.cumulative.map(x => <React.Fragment key={x.key}><td className="text-right">{fmt(x.budget)}</td><td className="text-right">{fmt(x.actual)}</td><td className="text-right">{fmt(x.variance)}</td></React.Fragment>)}</tr></tbody></table></div>
                            )}
                            {report && view === 'by_dimension' && (
                                <table className="erp-grid-table text-sm"><thead><tr><th>{dim.replace('_', ' ')}</th><th>Lines</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Variance</th><th className="text-right">Achieved %</th></tr></thead>
                                    <tbody>{report.rows.map(r => <tr key={r.key || r.name}><td>{r.name}</td><td>{r.lines}</td><td className="text-right">{fmt(r.budget)}</td><td className="text-right">{fmt(r.actual)}</td><td className={`text-right ${varCls(r)}`}>{fmt(r.variance)}</td><td className="text-right">{r.achievement_pct ?? '—'}</td></tr>)}
                                        <tr className="font-bold bg-slate-50"><td colSpan={2}>Total</td><td className="text-right">{fmt(report.totals.budget)}</td><td className="text-right">{fmt(report.totals.actual)}</td><td className="text-right">{fmt(report.totals.variance)}</td><td /></tr></tbody></table>
                            )}
                            {report && view === 'unbudgeted' && (
                                <table className="erp-grid-table text-sm"><thead><tr><th>Ledger</th><th>Group</th><th>Cost Center</th><th>Unit</th><th>Entries</th><th className="text-right">Actual</th></tr></thead>
                                    <tbody>{report.rows.map((r, i) => <tr key={i}><td>{r.ledger_name}</td><td className="text-xs">{r.group_name}</td><td>{r.cost_center}</td><td>{r.business_unit}</td><td>{r.entries}</td><td className="text-right">{fmt(r.actual)}</td></tr>)}
                                        <tr className="font-bold bg-slate-50"><td colSpan={5}>Total P&L actuals without a budget line</td><td className="text-right">{fmt(report.totals.actual)}</td></tr></tbody></table>
                            )}
                            {drill && (
                                <div className="border rounded-lg p-3 mt-3">
                                    <div className="flex justify-between mb-2"><p className="font-semibold">{drill.line.name} {drill.line.dims_label ? `· ${drill.line.dims_label}` : ''} - entries</p><button className="text-sm" onClick={() => setDrill(null)}>✕</button></div>
                                    <table className="erp-grid-table text-xs"><thead><tr><th>Date</th><th>Document</th><th>No</th><th>Ledger</th><th>Narration</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Running</th></tr></thead>
                                        <tbody>{drill.rows.map((r, i) => <tr key={i}><td>{r.date}</td><td>{r.doc_label}</td><td>{r.doc_no}</td><td>{r.ledger_name}</td><td>{r.narration}</td><td className="text-right">{r.debit ? fmt(r.debit) : ''}</td><td className="text-right">{r.credit ? fmt(r.credit) : ''}</td><td className="text-right">{fmt(r.running)}</td></tr>)}</tbody></table>
                                </div>
                            )}
                            <p className="text-xs text-gray-500 mt-2">Actual = movement inside the budget period in the account's natural direction (income / liabilities credit-positive, expenses / assets debit-positive). Green = favourable.</p>
                        </>)}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
