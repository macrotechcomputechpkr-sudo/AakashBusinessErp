// =============================================
// FinancialReports.jsx
// Trial Balance | Profit & Loss | Balance Sheet | Ratios | Cash Flow |
// Funds Flow | Stock Valuation | Group Mapping - one engine behind all
// (server/utils/financialEngine.js), so every figure agrees.
// Period presets (month / quarter / fiscal year / custom), level (group /
// sub-group / ledger), % column, and column modes: period only, Opening |
// Period | Closing, month-wise columns, or comparison with another period.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import SavedViewsBar from '../components/SavedViewsBar';

const TABS = [['tb', 'Trial Balance'], ['pl', 'Profit & Loss'], ['bs', 'Balance Sheet'], ['ratios', 'Ratio Analysis'], ['cash', 'Cash Flow'], ['funds', 'Funds Flow'], ['notes', 'Schedules / Notes'], ['budget', 'Budget vs Actual'], ['stock', 'Stock Valuation'], ['map', 'Group Mapping']];
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(new Date(s + 'T00:00:00Z').getTime() + n * 86400000));
const fmt = n => (n === null || n === undefined || Number.isNaN(n)) ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = n => Math.abs(n || 0) < 0.005 ? '' : `${fmt(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`;
const pctOf = (v, base) => base ? `${(v * 100 / base).toFixed(2)}%` : '';

const defaultConfig = () => ({ preset: 'this_fy', date_from: '', date_to: iso(new Date()), stock_method: 'weighted_average', level: 'sub', mode: 'period',
    compare_from: '', compare_to: '', product_company_id: '', show_pct: true, manual_closing_stock: '' });

// Flatten a statement tree to rows, honouring the chosen level.
function flatten(nodes, level, depth = 0, out = []) {
    (nodes || []).forEach(n => {
        const isLedger = n.type === 'ledger';
        const show = isLedger ? level === 'ledger' : (level === 'group' ? depth === 0 : true);
        if (show) out.push({ key: `${n.type}:${n.id}`, name: n.name, depth, type: n.type, amount: n.amount, node: n });
        if (n.children && n.children.length && level !== 'group') flatten(n.children, level, depth + 1, out);
    });
    return out;
}
// Merge several trees (one per column) into rows with one value per column.
function mergeColumns(treeList, level) {
    const order = [], byKey = {};
    treeList.forEach((tree, ci) => flatten(tree, level).forEach(r => {
        if (!byKey[r.key]) { byKey[r.key] = { ...r, values: Array(treeList.length).fill(0) }; order.push(r.key); }
        byKey[r.key].values[ci] = r.amount;
    }));
    return order.map(k => byKey[k]);
}

// Drill-down into the Ledger Report: a ledger -> its entries, a group -> its ledgers.
function drillHref(row, from, to) {
    if (!row || !row.node) return null;
    if (row.type === 'ledger') return `/ledger-report?ledger_id=${row.node.id}&date_from=${from}&date_to=${to}&mode=detail`;
    if (row.type === 'group' && row.node.id && !String(row.node.id).startsWith('(')) return `/ledger-report?account_group_id=${row.node.id}&date_from=${from}&date_to=${to}&mode=summary`;
    if (row.type === 'stock') return stockHref(from, to, row.method);
    return null;
}
// Zoom into Opening / Closing Stock: item-wise opening, in / out, closing (same engine, same figures).
const stockHref = (from, to, method) => `/stock-movement?date_from=${from}&date_to=${to}&stock_method=${method || 'weighted_average'}`;
const DrillName = ({ row, from, to, method }) => {
    const href = drillHref(row.type === 'stock' ? { ...row, method } : row, from, to);
    return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline" title="Open in Ledger Report">{row.name}</a> : <span>{row.name}</span>;
};

// Budget vs Actual: pick / create a budget, edit its lines, see variance.
function BudgetPanel({ authFetch }) {
    const [budgets, setBudgets] = useState([]);
    const [sel, setSel] = useState('');
    const [head, setHead] = useState({ budget_name: '', date_from: '', date_to: '' });
    const [lines, setLines] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [report, setReport] = useState(null);
    const [msg, setMsg] = useState('');
    const loadBudgets = useCallback(() => authFetch('/api/budgets').then(r => setBudgets(r.data || [])).catch(e => setMsg(e.message)), [authFetch]);
    useEffect(() => {
        loadBudgets();
        authFetch('/api/ledger-accounts?pageSize=1000&sortBy=account_name&sortDir=asc').then(r => setLedgers(r.data || [])).catch(() => {});
        authFetch('/api/account-groups').then(r => setGroups(r.data || [])).catch(() => {});
    }, [authFetch, loadBudgets]);
    const open = async (id) => {
        setSel(id); setReport(null); setMsg('');
        if (!id) { setHead({ budget_name: '', date_from: '', date_to: '' }); setLines([]); return; }
        const b = budgets.find(x => x.id === id);
        setHead({ id, budget_name: b.budget_name, date_from: String(b.date_from).slice(0, 10), date_to: String(b.date_to).slice(0, 10) });
        const r = await authFetch(`/api/budgets/${id}/lines`);
        setLines((r.data || []).map(l => ({ kind: l.ledger_id ? 'ledger' : 'group', target: l.ledger_id || l.account_group_id, amount: l.amount, remarks: l.remarks || '' })));
    };
    const save = async () => {
        setMsg('');
        try {
            const b = (await authFetch('/api/budgets', { method: 'POST', body: JSON.stringify(head) })).data;
            const payload = lines.filter(l => l.target).map(l => ({ ledger_id: l.kind === 'ledger' ? l.target : null, account_group_id: l.kind === 'group' ? l.target : null, amount: Number(l.amount) || 0, remarks: l.remarks }));
            await authFetch(`/api/budgets/${b.id}/lines`, { method: 'PUT', body: JSON.stringify({ lines: payload }) });
            await loadBudgets(); setSel(b.id); setHead(h => ({ ...h, id: b.id })); setMsg('Saved');
        } catch (e) { setMsg(e.message); }
    };
    const show = async () => { try { setReport((await authFetch(`/api/financial/budget-vs-actual?budget_id=${sel}`)).data); } catch (e) { setMsg(e.message); } };
    const setLine = (i, patch) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
    return (<div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
            <div className="erp-field"><label className="erp-label">Budget</label>
                <select className="erp-select" value={sel} onChange={e => open(e.target.value)}><option value="">+ New budget</option>{budgets.map(b => <option key={b.id} value={b.id}>{b.budget_name}</option>)}</select></div>
            <div className="erp-field"><label className="erp-label">Name</label><input className="erp-input" value={head.budget_name} onChange={e => setHead({ ...head, budget_name: e.target.value })} /></div>
            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={head.date_from} onChange={e => setHead({ ...head, date_from: e.target.value })} /></div>
            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={head.date_to} onChange={e => setHead({ ...head, date_to: e.target.value })} /></div>
        </div>
        <table className="erp-grid-table text-sm mb-2"><thead><tr><th>Type</th><th>Ledger / Group</th><th className="text-right">Budget amount</th><th>Remarks</th><th /></tr></thead><tbody>
            {lines.map((l, i) => <tr key={i}>
                <td><select className="erp-select" value={l.kind} onChange={e => setLine(i, { kind: e.target.value, target: '' })}><option value="ledger">Ledger</option><option value="group">Group</option></select></td>
                <td><select className="erp-select" value={l.target} onChange={e => setLine(i, { target: e.target.value })}><option value="">Select…</option>
                    {(l.kind === 'ledger' ? ledgers.map(x => [x.id, x.account_name]) : groups.map(x => [x.id, x.group_name])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></td>
                <td><input type="number" className="erp-input text-right" value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} /></td>
                <td><input className="erp-input" value={l.remarks} onChange={e => setLine(i, { remarks: e.target.value })} /></td>
                <td><button className="erp-btn" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>✕</button></td></tr>)}
        </tbody></table>
        <div className="flex gap-2 mb-3 no-print">
            <button className="erp-btn" onClick={() => setLines(ls => [...ls, { kind: 'ledger', target: '', amount: '', remarks: '' }])}>+ Line</button>
            <button className="erp-btn primary" onClick={save}>💾 Save budget</button>
            {sel && <button className="erp-btn" onClick={show}>📈 Budget vs Actual</button>}
            {sel && <button className="erp-btn" onClick={async () => { if (window.confirm('Delete this budget?')) { await authFetch(`/api/budgets/${sel}`, { method: 'DELETE' }); await loadBudgets(); open(''); } }}>🗑 Delete</button>}
            {msg && <span className="text-sm text-gray-600 self-center">{msg}</span>}
        </div>
        {report && (<table className="erp-grid-table text-sm"><thead><tr><th>Ledger / Group</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Variance</th><th className="text-right">Variance %</th><th className="text-right">Achieved %</th></tr></thead><tbody>
            {report.rows.map(r => <tr key={r.id}><td>{r.name} <span className="text-xs text-gray-400">({r.target_type})</span></td><td className="text-right">{fmt(r.budget)}</td><td className="text-right">{fmt(r.actual)}</td>
                <td className={`text-right font-semibold ${r.favourable ? 'text-green-700' : 'text-red-600'}`}>{fmt(r.variance)}</td><td className="text-right">{r.variance_pct === null ? '' : `${r.variance_pct}%`}</td><td className="text-right">{r.achievement_pct === null ? '' : `${r.achievement_pct}%`}</td></tr>)}
            <tr className="font-bold bg-slate-50"><td>Total</td><td className="text-right">{fmt(report.totals.budget)}</td><td className="text-right">{fmt(report.totals.actual)}</td><td className="text-right">{fmt(report.totals.variance)}</td><td /><td /></tr>
        </tbody></table>)}
        {report && <p className="text-xs text-gray-500 mt-1">Green = favourable (income above budget, costs below). Income and liabilities are compared as positive figures.</p>}
    </div>);
}

export default function FinancialReports() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'pl'); // ?tab= deep link from the Report Center
    const [config, setConfig] = useState(defaultConfig());
    const [fyStart, setFyStart] = useState(null);
    const [meta, setMeta] = useState({ stock_methods: {} });
    const [companies, setCompanies] = useState([]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    useEffect(() => {
        authFetch('/api/financial/meta').then(r => setMeta(r.data)).catch(() => {});
        authFetch(`/api/financial/fy-start?date=${iso(new Date())}`).then(r => setFyStart(r.data.fy_start)).catch(() => setFyStart(`${new Date().getFullYear()}-01-01`));
        authFetch('/api/product-companies').then(r => setCompanies(r.data || [])).catch(() => {});
    }, [authFetch]);

    // Period presets
    const applyPreset = useCallback((preset, base = config) => {
        const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth();
        let from = base.date_from, to = base.date_to;
        if (preset === 'this_month') { from = iso(new Date(Date.UTC(y, m, 1))); to = iso(now); }
        if (preset === 'last_month') { from = iso(new Date(Date.UTC(y, m - 1, 1))); to = iso(new Date(Date.UTC(y, m, 0))); }
        if (preset === 'this_quarter') { const q = Math.floor(m / 3) * 3; from = iso(new Date(Date.UTC(y, q, 1))); to = iso(now); }
        if (preset === 'this_fy' && fyStart) { from = fyStart; to = iso(now); }
        if (preset === 'last_fy' && fyStart) { to = addDays(fyStart, -1); from = iso(new Date(Date.UTC(Number(fyStart.slice(0, 4)) - 1, Number(fyStart.slice(5, 7)) - 1, Number(fyStart.slice(8, 10))))); }
        return { ...base, preset, date_from: from, date_to: to };
    }, [config, fyStart]);
    useEffect(() => { if (fyStart && !config.date_from) setConfig(c => applyPreset(c.preset, c)); }, [fyStart]); // eslint-disable-line react-hooks/exhaustive-deps

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError(''); setData(null);
        try {
            const p = new URLSearchParams();
            const put = (k, v) => { if (v !== '' && v !== null && v !== undefined) p.set(k, v); };
            put('stock_method', cfg.stock_method); put('product_company_id', cfg.product_company_id);
            let url;
            if (tab === 'tb') { put('date_from', cfg.date_from); put('date_to', cfg.date_to); url = '/api/financial/trial-balance'; }
            else if (tab === 'pl') {
                put('date_from', cfg.date_from); put('date_to', cfg.date_to); put('manual_closing_stock', cfg.stock_method === 'manual' ? cfg.manual_closing_stock : '');
                if (cfg.mode === 'opc') put('columns', 'opening_period_closing');
                if (cfg.mode === 'monthly') put('monthly', 'true');
                if (cfg.mode === 'compare') { put('compare_from', cfg.compare_from); put('compare_to', cfg.compare_to); }
                url = '/api/financial/profit-loss';
            } else if (tab === 'bs') {
                put('as_of', cfg.date_to); put('manual_stock', cfg.stock_method === 'manual' ? cfg.manual_closing_stock : '');
                if (cfg.mode === 'opc') { put('columns', 'opening_period_closing'); put('date_from', cfg.date_from); }
                if (cfg.mode === 'compare') put('compare_as_of', cfg.compare_to);
                url = '/api/financial/balance-sheet';
            } else if (['ratios', 'cash', 'funds'].includes(tab)) { put('date_from', cfg.date_from); put('date_to', cfg.date_to); url = '/api/financial/ratios-flows'; }
            else if (tab === 'notes') { put('date_from', cfg.date_from); put('date_to', cfg.date_to); url = '/api/financial/schedules'; }
            else if (tab === 'stock') { put('as_of', cfg.date_to); url = '/api/financial/stock-valuation'; }
            else url = '/api/financial/mapping';
            setData((await authFetch(`${url}?${p}`)).data);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }, [authFetch, config, tab]);

    // ---------- P&L column model ----------
    const plModel = useMemo(() => {
        if (tab !== 'pl' || !data?.current) return null;
        const d = data;
        let cols, heads;
        if (config.mode === 'opc' && d.columns) { cols = [d.columns.opening, d.columns.period, d.columns.closing]; heads = [`Opening (${d.columns.fy_start} →)`, 'Period', 'Closing (YTD)']; }
        else if (config.mode === 'monthly' && d.monthly) { cols = d.monthly.map(m => m.pl); heads = d.monthly.map(m => m.label); }
        else if (config.mode === 'compare' && d.compare) { cols = [d.current, d.compare]; heads = ['Current', 'Compared']; }
        else { cols = [d.current]; heads = ['Amount']; }
        cols = cols.map(c => c || { trading_income: [], trading_expense: [], indirect_income: [], indirect_expense: [], opening_stock: 0, closing_stock: 0, stock_account_movement: 0, net_sales: 0, cogs: 0, gross_profit: 0, other_income: 0, overheads: 0, net_profit: 0 });
        return { cols, heads };
    }, [tab, data, config.mode]);

    const exportCsv = (rows, heads) => {
        const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\uFEFF' + [heads, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${tab}_${config.date_from}_${config.date_to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    const Section = ({ title, trees, cols, pctBase, sign = 1 }) => {
        const rows = mergeColumns(trees, config.level);
        return (<>
            <tr className="bg-slate-50"><td colSpan={cols + 2} className="font-semibold">{title}</td></tr>
            {rows.map(r => (
                <tr key={r.key} className={r.type === 'group' ? 'font-medium' : 'text-gray-600'}>
                    <td style={{ paddingLeft: 12 + r.depth * 18 }}><DrillName row={r} from={config.date_from} to={config.date_to} /></td>
                    {r.values.map((v, i) => <td key={i} className="text-right">{fmt(sign * v)}</td>)}
                    {config.show_pct && <td className="text-right text-xs text-gray-500">{pctOf(r.values[r.values.length === 3 && config.mode === 'opc' ? 1 : 0], pctBase)}</td>}
                </tr>))}
        </>);
    };
    const TotalRow = ({ label, values, strong, pctBase, pctIndex = 0 }) => (
        <tr className={strong ? 'font-bold bg-blue-50' : 'font-semibold'}><td>{label}</td>{values.map((v, i) => <td key={i} className="text-right">{fmt(v)}</td>)}
            {config.show_pct && <td className="text-right text-xs">{pctOf(values[pctIndex], pctBase)}</td>}</tr>);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">📊 Financial Reports</span></div>
            <div className="flex flex-wrap gap-1 px-4 pt-3 border-b no-print">
                {TABS.map(([k, l]) => <button key={k} onClick={() => { setTab(k); setData(null); }} className={`px-3 py-2 text-sm border-b-2 ${tab === k ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-500'}`}>{l}</button>)}
            </div>
            <div className="erp-tab-content">
                <div className="no-print"><SavedViewsBar reportKey={`financial:${tab}`} getConfig={() => config} onApply={cfg => { const m = { ...defaultConfig(), ...cfg }; setConfig(m); run(m); }} onReset={() => { setConfig(applyPreset('this_fy', defaultConfig())); setData(null); }} /></div>
                {tab !== 'budget' && <><div className="grid grid-cols-2 md:grid-cols-6 gap-3 my-3 no-print">
                    <div className="erp-field"><label className="erp-label">Period</label>
                        <select className="erp-select" value={config.preset} onChange={e => setConfig(applyPreset(e.target.value))}>
                            <option value="this_month">This Month</option><option value="last_month">Last Month</option><option value="this_quarter">This Quarter</option>
                            <option value="this_fy">This Fiscal Year</option><option value="last_fy">Last Fiscal Year</option><option value="custom">Custom</option>
                        </select></div>
                    {tab !== 'stock' && tab !== 'map' && <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => setConfig(c => ({ ...c, preset: 'custom', date_from: e.target.value }))} /></div>}
                    <div className="erp-field"><label className="erp-label">{tab === 'bs' || tab === 'stock' ? 'As of' : 'To'}</label><input type="date" className="erp-input" value={config.date_to} onChange={e => setConfig(c => ({ ...c, preset: 'custom', date_to: e.target.value }))} /></div>
                    {['pl', 'bs', 'ratios', 'cash', 'funds', 'stock'].includes(tab) && <div className="erp-field"><label className="erp-label">Stock valuation</label>
                        <select className="erp-select" value={config.stock_method} onChange={e => set('stock_method', e.target.value)}>
                            {Object.entries(meta.stock_methods || {}).filter(([k]) => tab !== 'stock' || k !== 'manual').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select></div>}
                    {config.stock_method === 'manual' && ['pl', 'bs'].includes(tab) && <div className="erp-field"><label className="erp-label">Closing stock value</label><input type="number" className="erp-input" value={config.manual_closing_stock} onChange={e => set('manual_closing_stock', e.target.value)} /></div>}
                    {['tb', 'pl', 'bs', 'notes'].includes(tab) && <div className="erp-field"><label className="erp-label">Level</label>
                        <select className="erp-select" value={config.level} onChange={e => set('level', e.target.value)}>
                            <option value="group">Main groups</option><option value="sub">Groups & sub-groups</option><option value="ledger">Ledger detail</option>
                        </select></div>}
                    {['pl', 'bs'].includes(tab) && <div className="erp-field"><label className="erp-label">Columns</label>
                        <select className="erp-select" value={config.mode} onChange={e => set('mode', e.target.value)}>
                            <option value="period">{tab === 'pl' ? 'Period only' : 'As of date only'}</option>
                            <option value="opc">Opening | {tab === 'pl' ? 'Period' : 'Movement'} | Closing</option>
                            {tab === 'pl' && <option value="monthly">Month-wise columns</option>}
                            <option value="compare">Compare with another period</option>
                        </select></div>}
                    {config.mode === 'compare' && ['pl', 'bs'].includes(tab) && <>
                        {tab === 'pl' && <div className="erp-field"><label className="erp-label">Compare from</label><input type="date" className="erp-input" value={config.compare_from} onChange={e => set('compare_from', e.target.value)} /></div>}
                        <div className="erp-field"><label className="erp-label">{tab === 'pl' ? 'Compare to' : 'Compare as of'}</label><input type="date" className="erp-input" value={config.compare_to} onChange={e => set('compare_to', e.target.value)} /></div>
                    </>}
                    {tab !== 'stock' && tab !== 'map' && <div className="erp-field"><label className="erp-label">Product Company</label>
                        <select className="erp-select" value={config.product_company_id} onChange={e => set('product_company_id', e.target.value)}>
                            <option value="">All</option>{companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                        </select></div>}
                    {['pl', 'bs'].includes(tab) && <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={config.show_pct} onChange={e => set('show_pct', e.target.checked)} /> Show %</label>}
                </div>
                <style>{`@media print { .no-print, nav, aside, header, .erp-header, .erp-bottombar { display: none !important; } .erp-card { box-shadow: none !important; border: none !important; } body { background: #fff; } .print-title { display: block !important; } }`}</style>
                <div className="flex gap-2 mb-3 no-print">
                    <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                </div>
                </>}
                <h2 className="print-title hidden text-lg font-bold mb-2">{(TABS.find(x => x[0] === tab) || [])[1]} - {tab === 'bs' || tab === 'stock' ? `as of ${config.date_to}` : `${config.date_from} to ${config.date_to}`}</h2>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

                {/* ---------------- Trial Balance ---------------- */}
                {tab === 'tb' && data?.tree && (() => {
                    const rows = flatten(data.tree, config.level);
                    const heads = ['Particulars', 'Opening', 'Debit', 'Credit', 'Closing'];
                    return (<div className="overflow-x-auto">
                        {data.difference !== 0 && <p className="text-sm text-amber-700 mb-2">Trial balance differs by {fmt(data.difference)} - the ledger opening balances do not balance (shown as "Difference in Opening Balances" on the Balance Sheet).</p>}
                        {data.unmapped_groups?.length > 0 && <p className="text-xs text-amber-700 mb-2">Groups without an NFRS category: {data.unmapped_groups.join(', ')}</p>}
                        <button className="erp-btn mb-2" onClick={() => exportCsv(rows.map(r => [' '.repeat(r.depth * 2) + r.name, r.node.opening, r.node.dr, r.node.cr, r.node.closing]), heads)}>⬇ Excel</button>
                        <table className="erp-grid-table text-sm"><thead><tr>{heads.map((h, i) => <th key={h} className={i ? 'text-right' : ''}>{h}</th>)}</tr></thead><tbody>
                            {rows.map(r => <tr key={r.key} className={r.type === 'group' ? 'font-medium' : 'text-gray-600'}><td style={{ paddingLeft: 12 + r.depth * 18 }}><DrillName row={r} from={config.date_from} to={config.date_to} /></td>
                                <td className="text-right">{drcr(r.node.opening)}</td><td className="text-right">{fmt(r.node.dr)}</td><td className="text-right">{fmt(r.node.cr)}</td><td className="text-right">{drcr(r.node.closing)}</td></tr>)}
                            <tr className="font-bold bg-slate-50"><td>Total</td><td className="text-right">{fmt(data.totals.opening_dr)} Dr / {fmt(data.totals.opening_cr)} Cr</td><td className="text-right">{fmt(data.totals.dr)}</td><td className="text-right">{fmt(data.totals.cr)}</td><td className="text-right">{fmt(data.totals.closing_dr)} Dr / {fmt(data.totals.closing_cr)} Cr</td></tr>
                        </tbody></table></div>);
                })()}

                {/* ---------------- Profit & Loss ---------------- */}
                {tab === 'pl' && plModel && (() => {
                    const { cols, heads } = plModel; const n = cols.length;
                    const base = cols[config.mode === 'opc' ? 1 : 0].net_sales;
                    const v = f => cols.map(c => c[f]);
                    const pi = config.mode === 'opc' ? 1 : 0;
                    return (<div className="overflow-x-auto">
                        <p className="text-xs text-gray-500 mb-2">Stock valued by {cols[0].stock_method_label || config.stock_method}. % is of Net Sales{config.mode === 'opc' ? ' for the period' : ''}.</p>
                        {cols.some(c => c.stock_warnings?.length) && <p className="text-xs text-amber-700 mb-2">{[...new Set(cols.flatMap(c => c.stock_warnings || []))].join(' · ')}</p>}
                        <table className="erp-grid-table text-sm"><thead><tr><th>Particulars</th>{heads.map(h => <th key={h} className="text-right">{h}</th>)}{config.show_pct && <th className="text-right">%</th>}</tr></thead><tbody>
                            <Section title="Sales (net of returns)" trees={cols.map(c => c.trading_income)} cols={n} pctBase={base} />
                            <TotalRow label="Net Sales" values={v('net_sales')} pctBase={base} pctIndex={pi} />
                            <tr className="bg-slate-50"><td colSpan={n + 2} className="font-semibold">Cost of Goods Sold</td></tr>
                            <tr><td style={{ paddingLeft: 30 }}><a className="hover:underline" target="_blank" rel="noopener noreferrer" title="Item-wise stock movement" href={stockHref(config.date_from, config.date_to, config.stock_method)}>Opening Stock</a></td>{v('opening_stock').map((x, i) => <td key={i} className="text-right">{fmt(x)}</td>)}{config.show_pct && <td />}</tr>
                            <Section title="Add: Purchases (net)" trees={cols.map(c => c.trading_expense)} cols={n} pctBase={base} />
                            {cols.some(c => Math.abs(c.stock_account_movement) > 0.005) && <tr><td style={{ paddingLeft: 30 }}>Add: Purchases booked to stock account</td>{v('stock_account_movement').map((x, i) => <td key={i} className="text-right">{fmt(x)}</td>)}{config.show_pct && <td />}</tr>}
                            <tr><td style={{ paddingLeft: 30 }}><a className="hover:underline" target="_blank" rel="noopener noreferrer" title="Item-wise stock movement" href={stockHref(config.date_from, config.date_to, config.stock_method)}>Less: Closing Stock</a></td>{v('closing_stock').map((x, i) => <td key={i} className="text-right">({fmt(x)})</td>)}{config.show_pct && <td />}</tr>
                            <TotalRow label="Cost of Goods Sold" values={v('cogs')} pctBase={base} pctIndex={pi} />
                            <TotalRow label="Gross Profit" values={v('gross_profit')} strong pctBase={base} pctIndex={pi} />
                            <Section title="Add: Other Income" trees={cols.map(c => c.indirect_income)} cols={n} pctBase={base} />
                            <Section title="Less: Indirect Expenses" trees={cols.map(c => c.indirect_expense)} cols={n} pctBase={base} />
                            <TotalRow label="Net Profit / (Loss)" values={v('net_profit')} strong pctBase={base} pctIndex={pi} />
                            {config.mode === 'compare' && n === 2 && <tr className="text-xs text-gray-600"><td>Change in Net Profit</td><td className="text-right" colSpan={2}>{fmt(cols[0].net_profit - cols[1].net_profit)} {cols[1].net_profit ? `(${((cols[0].net_profit - cols[1].net_profit) * 100 / Math.abs(cols[1].net_profit)).toFixed(2)}%)` : ''}</td>{config.show_pct && <td />}</tr>}
                        </tbody></table></div>);
                })()}

                {/* ---------------- Balance Sheet ---------------- */}
                {tab === 'bs' && data?.current && (() => {
                    const cur = data.current;
                    let cols = [cur], heads = ['Amount'];
                    if (config.mode === 'opc' && data.opening) { cols = [data.opening, cur]; heads = ['Opening', 'Closing']; }
                    if (config.mode === 'compare' && data.compare) { cols = [cur, data.compare]; heads = ['Current', 'Compared']; }
                    const withMove = cols.length === 2;
                    const block = (title, key, total) => {
                        const rows = mergeColumns(cols.map(c => c[key]), config.level);
                        return (<>
                            <tr className="bg-slate-50"><td colSpan={heads.length + (withMove ? 3 : 2)} className="font-semibold">{title}</td></tr>
                            {rows.map(r => <tr key={r.key} className={r.type === 'group' || r.type === 'stock' || r.type === 'profit' ? 'font-medium' : 'text-gray-600'}>
                                <td style={{ paddingLeft: 12 + r.depth * 18 }}><DrillName row={r} from={fyStart || config.date_from} to={config.date_to} method={config.stock_method} /></td>{r.values.map((x, i) => <td key={i} className="text-right">{fmt(x)}</td>)}
                                {withMove && <td className="text-right text-gray-600">{fmt(r.values[config.mode === 'opc' ? 1 : 0] - r.values[config.mode === 'opc' ? 0 : 1])}</td>}
                                {config.show_pct && <td className="text-right text-xs text-gray-500">{pctOf(r.values[config.mode === 'opc' ? 1 : 0], total)}</td>}</tr>)}
                        </>);
                    };
                    const totA = cols.map(c => c.total_assets), totL = cols.map(c => c.total_liabilities_equity);
                    const mainTotal = config.mode === 'opc' ? cur.total_assets : cols[0].total_assets;
                    return (<div className="overflow-x-auto">
                        {cols.some(c => !c.balanced) && <p className="text-sm text-red-600 mb-2">Balance Sheet does not balance - please report this.</p>}
                        {Math.abs(cur.opening_difference) > 0.005 && <p className="text-xs text-amber-700 mb-2">Opening balances (ledgers + product opening stock) differ by {fmt(cur.opening_difference)} - shown as "Difference in Opening Balances".</p>}
                        <table className="erp-grid-table text-sm"><thead><tr><th>Particulars</th>{heads.map(h => <th key={h} className="text-right">{h}</th>)}{withMove && <th className="text-right">{config.mode === 'opc' ? 'Movement' : 'Change'}</th>}{config.show_pct && <th className="text-right">% of total</th>}</tr></thead><tbody>
                            {block('Assets', 'assets', mainTotal)}
                            <tr className="font-bold bg-blue-50"><td>Total Assets</td>{totA.map((x, i) => <td key={i} className="text-right">{fmt(x)}</td>)}{withMove && <td className="text-right">{fmt(config.mode === 'opc' ? totA[1] - totA[0] : totA[0] - totA[1])}</td>}{config.show_pct && <td />}</tr>
                            {block('Liabilities', 'liabilities', mainTotal)}
                            {block("Equity (Owners' Funds)", 'equity', mainTotal)}
                            <tr className="font-bold bg-blue-50"><td>Total Liabilities & Equity</td>{totL.map((x, i) => <td key={i} className="text-right">{fmt(x)}</td>)}{withMove && <td className="text-right">{fmt(config.mode === 'opc' ? totL[1] - totL[0] : totL[0] - totL[1])}</td>}{config.show_pct && <td />}</tr>
                        </tbody></table></div>);
                })()}

                {/* ---------------- Ratios ---------------- */}
                {tab === 'ratios' && data?.ratios && (<div className="overflow-x-auto">
                    <table className="erp-grid-table text-sm"><thead><tr><th>Category</th><th>Ratio</th><th className="text-right">Value</th><th>Formula</th></tr></thead><tbody>
                        {data.ratios.map(r => <tr key={r.key}><td className="text-gray-500">{r.category}</td><td>{r.label}</td>
                            <td className="text-right font-semibold">{r.value === null ? 'n/a' : r.unit === '%' ? `${r.value}%` : r.unit === 'days' ? `${r.value} days` : r.unit === 'amount' ? fmt(r.value) : `${r.value} : 1`}</td>
                            <td className="text-xs text-gray-500">{r.formula}</td></tr>)}
                    </tbody></table>
                    <p className="text-xs text-gray-500 mt-2">Period of {data.days} days. Averages use the opening ({config.date_from}) and closing ({config.date_to}) positions.</p>
                </div>)}

                {/* ---------------- Cash Flow ---------------- */}
                {tab === 'cash' && data?.cash_flow && (() => { const cf = data.cash_flow; const L = (list) => list.map((x, i) => <tr key={i}><td style={{ paddingLeft: 30 }}>{x.name}</td><td className="text-right">{fmt(x.amount)}</td></tr>); return (
                    <table className="erp-grid-table text-sm max-w-3xl"><tbody>
                        <tr className="bg-slate-50 font-semibold"><td colSpan={2}>A. Cash flow from Operating activities</td></tr>
                        <tr><td style={{ paddingLeft: 30 }}>Net Profit</td><td className="text-right">{fmt(cf.net_profit)}</td></tr>{L(cf.operating)}
                        <tr className="font-semibold"><td>Net cash from operating activities</td><td className="text-right">{fmt(cf.operating_total)}</td></tr>
                        <tr className="bg-slate-50 font-semibold"><td colSpan={2}>B. Cash flow from Investing activities</td></tr>{L(cf.investing)}
                        <tr className="font-semibold"><td>Net cash from investing activities</td><td className="text-right">{fmt(cf.investing_total)}</td></tr>
                        <tr className="bg-slate-50 font-semibold"><td colSpan={2}>C. Cash flow from Financing activities</td></tr>{L(cf.financing)}
                        <tr className="font-semibold"><td>Net cash from financing activities</td><td className="text-right">{fmt(cf.financing_total)}</td></tr>
                        <tr className="font-bold bg-blue-50"><td>Net increase / (decrease) in cash (A+B+C)</td><td className="text-right">{fmt(cf.net_change)}</td></tr>
                        <tr><td>Cash & Bank at beginning</td><td className="text-right">{fmt(cf.opening_cash)}</td></tr>
                        <tr className="font-bold"><td>Cash & Bank at end</td><td className="text-right">{fmt(cf.closing_cash)}</td></tr>
                        <tr><td colSpan={2} className={`text-xs ${cf.reconciles ? 'text-green-700' : 'text-red-600'}`}>{cf.reconciles ? '✓ Reconciles with the Cash & Bank balances' : '✗ Does not reconcile - please report this'}</td></tr>
                    </tbody></table>); })()}

                {/* ---------------- Funds Flow ---------------- */}
                {tab === 'funds' && data?.funds_flow && (() => { const ff = data.funds_flow; return (
                    <div className="grid md:grid-cols-2 gap-4 max-w-5xl">
                        <table className="erp-grid-table text-sm"><thead><tr><th>Sources of Funds</th><th className="text-right">Amount</th></tr></thead><tbody>
                            {ff.sources.map((x, i) => <tr key={i}><td>{x.name}</td><td className="text-right">{fmt(x.amount)}</td></tr>)}
                            <tr className="font-bold"><td>Total Sources</td><td className="text-right">{fmt(ff.total_sources)}</td></tr></tbody></table>
                        <table className="erp-grid-table text-sm"><thead><tr><th>Applications of Funds</th><th className="text-right">Amount</th></tr></thead><tbody>
                            {ff.applications.map((x, i) => <tr key={i}><td>{x.name}</td><td className="text-right">{fmt(x.amount)}</td></tr>)}
                            <tr className="font-semibold"><td>Increase in Working Capital</td><td className="text-right">{fmt(ff.increase_in_working_capital)}</td></tr>
                            <tr className="font-bold"><td>Total Applications</td><td className="text-right">{fmt(ff.total_applications + ff.increase_in_working_capital)}</td></tr></tbody></table>
                        <p className={`text-xs md:col-span-2 ${ff.reconciles ? 'text-green-700' : 'text-red-600'}`}>Working capital {fmt(ff.working_capital_opening)} → {fmt(ff.working_capital_closing)}. {ff.reconciles ? '✓ Reconciles' : '✗ Does not reconcile - please report this'}</p>
                    </div>); })()}

                {tab === 'budget' && <BudgetPanel authFetch={authFetch} />}
                {/* ---------------- Schedules / Notes ---------------- */}
                {tab === 'notes' && data?.notes && (<div className="space-y-6">
                    {data.notes.map(n => {
                        const rows = flatten(n.tree, config.level);
                        return (<div key={n.group_id} className="break-inside-avoid">
                            <h3 className="font-semibold mb-1">Note {n.note_no}: {n.title} <span className="text-xs text-gray-500 font-normal">({n.section_title})</span></h3>
                            <table className="erp-grid-table text-sm"><thead><tr><th>Particulars</th><th className="text-right">Opening</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Closing</th></tr></thead><tbody>
                                {rows.map(r => <tr key={r.key} className={r.type === 'group' ? 'font-medium' : 'text-gray-600'}><td style={{ paddingLeft: 12 + r.depth * 18 }}><DrillName row={r} from={config.date_from} to={config.date_to} /></td>
                                    <td className="text-right">{drcr(r.node.opening)}</td><td className="text-right">{fmt(r.node.dr)}</td><td className="text-right">{fmt(r.node.cr)}</td><td className="text-right">{drcr(r.node.closing)}</td></tr>)}
                                <tr className="font-bold bg-slate-50"><td>Total - Note {n.note_no}</td><td className="text-right">{drcr(n.opening)}</td><td className="text-right">{fmt(n.dr)}</td><td className="text-right">{fmt(n.cr)}</td><td className="text-right">{drcr(n.closing)}</td></tr>
                            </tbody></table></div>);
                    })}
                    {data.difference !== 0 && <p className="text-xs text-amber-700">Notes net to {fmt(data.difference)}: the ledger opening balances do not balance.</p>}
                </div>)}
                {/* ---------------- Stock Valuation ---------------- */}
                {tab === 'stock' && data?.summary && (<div>
                    <table className="erp-grid-table text-sm max-w-xl mb-4"><thead><tr><th>Method</th><th className="text-right">Closing Stock as of {data.as_of}</th></tr></thead><tbody>
                        {data.summary.map(s => <tr key={s.method} className={s.method === config.stock_method ? 'font-semibold bg-blue-50' : ''}><td>{s.label}</td><td className="text-right">{fmt(s.value)}</td></tr>)}
                    </tbody></table>
                    <p className="text-xs text-gray-500 mb-2"><a className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer" href={stockHref(fyStart || config.date_from, config.date_to, config.stock_method)}>📦 Item-wise movement (opening, in / out, closing) →</a> Item detail - {data.detail.method_label}. {data.detail.warnings?.join(' · ')}</p>
                    <table className="erp-grid-table text-sm"><thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Value</th></tr></thead><tbody>
                        {data.detail.lines.map(l => <tr key={l.product_id}><td>{l.product_name}</td><td className="text-right">{l.qty}</td><td className="text-right">{fmt(l.rate)}</td><td className="text-right">{fmt(l.value)}</td></tr>)}
                        <tr className="font-bold"><td colSpan={3}>Total</td><td className="text-right">{fmt(data.detail.value)}</td></tr>
                    </tbody></table>
                </div>)}

                {/* ---------------- Mapping ---------------- */}
                {tab === 'map' && Array.isArray(data) && (<div className="overflow-x-auto">
                    <p className="text-xs text-gray-500 mb-2">Where each account group lands. Blank values are inherited from the parent group; change them in Chart of Accounts.</p>
                    <table className="erp-grid-table text-sm"><thead><tr><th>Group</th><th>Statement section</th><th>NFRS</th><th>Classification</th><th>Cash flow</th><th>Funds flow</th><th>Ratio use</th></tr></thead><tbody>
                        {data.map(g => <tr key={g.id} className={g.section === 'unmapped' ? 'bg-red-50' : ''}><td>{g.group_name}</td><td>{g.section.replace(/_/g, ' ')}</td><td>{g.nfrs_category}</td><td>{g.nfrs_classification}</td><td>{g.cash_flow_category}</td><td>{g.funds_flow_type}</td><td>{g.ratio_analysis_category}{g.anchor ? ` (${g.anchor})` : ''}</td></tr>)}
                    </tbody></table></div>)}
            </div>
        </div>
        </div>
        </Layout>
    );
}
