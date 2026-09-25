// =============================================
// AgentTargets.jsx  (/agent-targets)
// Salesman / agent targets and commission (server: utils/agentTargets.js)
//   Targets       one target, or generate month / quarter / year targets for
//                 many salesmen at once; all products or one product /
//                 product group / product company / category; qty and / or
//                 value; commission % of value, rate per qty or fixed, with
//                 a minimum achievement %
//   Achievement   target vs achieved (bills - returns, net of VAT), balance,
//                 commission; tick and post commission (Dr expense / Cr
//                 payable) - targets already posted are skipped
//   Performance   month / quarter / year sales per salesman / product /
//                 group / company, with or without targets
//   Register      posted commissions; cancel reverses the GL entry
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q4 = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const iso = d => d.toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`, yearEnd = () => `${new Date().getFullYear()}-12-31`;
const DIMS = [['all', 'All products'], ['product', 'Product'], ['product_group', 'Product Group'], ['product_company', 'Product Company'], ['category', 'Product Category']];
const BASIS = [['value_percent', '% of achieved value'], ['qty_rate', 'Rate per achieved qty'], ['fixed', 'Fixed amount']];
const blank = () => ({ agent_ids: [], period_type: 'month', date_from: yearStart(), date_to: yearEnd(), split: 'each', dimension: 'all', dimension_id: '', target_qty: '', target_value: '', commission_basis: 'value_percent', commission_rate: '', fixed_commission: '', min_achievement_pct: '', remarks: '' });

export default function AgentTargets() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'ach');
    const [m, setM] = useState({ agents: [], product: [], product_group: [], product_company: [], category: [], ledgers: [] });
    const [form, setForm] = useState(blank());
    const [f, setF] = useState({ agent_id: [], date_from: yearStart(), date_to: yearEnd(), period_type: '', dimension: '' });
    const [ach, setAch] = useState(null);
    const [picked, setPicked] = useState(() => new Set());
    const [post, setPost] = useState({ posting_date: iso(new Date()), expense_ledger_id: '', payable_ledger_id: '' });
    const [perf, setPerf] = useState(null);
    const [perfCfg, setPerfCfg] = useState({ group_by: 'agent', period_type: 'month', measure: 'value' });
    const [reg, setReg] = useState(null);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const load = u => authFetch(u).then(r => r.data || []).catch(() => []);
        Promise.all([load('/api/salesman-agents'), load('/api/products?pageSize=5000'), load('/api/product-groups'), load('/api/product-companies'), load('/api/product-categories'), load('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc')])
            .then(([agents, product, product_group, product_company, category, ledgers]) => setM({ agents, product, product_group, product_company, category, ledgers }));
    }, [authFetch]);
    const dimName = { product: 'product_name', product_group: 'group_name', product_company: 'company_name', category: 'category_name' };
    const qs = useCallback(extra => {
        const p = new URLSearchParams();
        Object.entries({ ...f, ...extra }).forEach(([k, v]) => { if (Array.isArray(v) ? v.length : v) p.set(k, Array.isArray(v) ? v.join(',') : v); });
        return p;
    }, [f]);

    const loadAch = useCallback(async () => {
        setBusy(true); setError('');
        try { const r = (await authFetch(`/api/agent-targets/achievement?${qs()}`)).data; setAch(r); setPicked(new Set(r.rows.filter(x => !x.posted && x.commission > 0 && x.period_over).map(x => x.id))); }
        catch (e) { setError(e.message); }
        setBusy(false);
    }, [authFetch, qs]);
    const loadPerf = useCallback(async () => {
        setBusy(true); setError('');
        try { setPerf((await authFetch(`/api/agent-targets/performance?${qs({ group_by: perfCfg.group_by, period_type: perfCfg.period_type })}`)).data); } catch (e) { setError(e.message); }
        setBusy(false);
    }, [authFetch, qs, perfCfg]);
    const loadReg = useCallback(async () => {
        try { setReg((await authFetch(`/api/agent-commission/register?${qs({ period_type: '', dimension: '' })}`)).data); } catch (e) { setError(e.message); }
    }, [authFetch, qs]);
    useEffect(() => { if (tab === 'ach' || tab === 'targets') loadAch(); if (tab === 'perf') loadPerf(); if (tab === 'reg') loadReg(); }, [tab, loadAch, loadPerf, loadReg]);

    const generate = async single => {
        setError(''); setMsg('');
        try {
            const body = { ...form, agent_ids: form.agent_ids };
            if (!body.agent_ids.length) return setError('Choose at least one salesman');
            const r = single
                ? await Promise.all(body.agent_ids.map(a => authFetch('/api/agent-targets', { method: 'POST', body: JSON.stringify({ ...body, agent_id: a, period_type: 'custom', period_from: body.date_from, period_to: body.date_to, period_label: `${body.date_from} - ${body.date_to}` }) })))
                : (await authFetch('/api/agent-targets/generate', { method: 'POST', body: JSON.stringify(body) })).data;
            setMsg(single ? `${r.length} target(s) saved` : `${r.created} target(s) created over ${r.periods} period(s)${r.skipped ? `, ${r.skipped} already existed` : ''}`);
            loadAch();
        } catch (e) { setError(e.message); }
    };
    const del = async id => { if (!window.confirm('Delete this target?')) return; try { await authFetch(`/api/agent-targets/${id}`, { method: 'DELETE' }); loadAch(); } catch (e) { setError(e.message); } };
    const postNow = async () => {
        const rows = ach.rows.filter(r => picked.has(r.id));
        if (!rows.length) return setError('Tick the targets to post');
        if (!window.confirm(`Post commission ${fmt(rows.reduce((s, r) => s + r.commission, 0))} for ${rows.length} target(s)?`)) return;
        setBusy(true); setError('');
        try {
            const r = (await authFetch('/api/agent-targets/post-commission', { method: 'POST', body: JSON.stringify({ ...post, target_ids: [...picked] }) })).data;
            setMsg(`Posted ${r.posted} (${fmt(r.total)}), skipped ${r.skipped}${r.results.filter(x => x.skipped).length ? `: ${r.results.filter(x => x.skipped).map(x => `${x.agent_name} - ${x.reason}`).join('; ')}` : ''}`);
            loadAch();
        } catch (e) { setError(e.message); }
        setBusy(false);
    };
    const cancel = async id => {
        const reason = window.prompt('Reason for cancelling this commission posting?');
        if (!reason) return;
        try { await authFetch(`/api/agent-commission/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); loadReg(); } catch (e) { setError(e.message); }
    };
    const setF2 = (k, v) => setForm(x => ({ ...x, [k]: v }));
    const agentItems = useMemo(() => m.agents.map(a => ({ id: a.id, name: a.agent_name })), [m.agents]);

    const filterBar = (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3 no-print">
            <MultiPick label="Salesman" items={agentItems} value={f.agent_id} onChange={v => setF({ ...f, agent_id: v })} />
            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></div>
            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></div>
            {tab !== 'perf' && tab !== 'reg' && <>
                <div className="erp-field"><label className="erp-label">Period type</label>
                    <select className="erp-select" value={f.period_type} onChange={e => setF({ ...f, period_type: e.target.value })}><option value="">All</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option><option value="custom">Custom</option></select></div>
                <div className="erp-field"><label className="erp-label">Target on</label>
                    <select className="erp-select" value={f.dimension} onChange={e => setF({ ...f, dimension: e.target.value })}><option value="">All</option>{DIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            </>}
        </div>
    );

    return (
        <Layout>
            <div className="erp-shell px-4">
                <div className="erp-card">
                    <div className="erp-header"><span className="erp-header-title">🎯 Salesman Targets & Commission</span></div>
                    <div className="erp-tab-content">
                        <div className="flex flex-wrap gap-2 mb-3 no-print">{[['ach', 'Achievement & Commission'], ['targets', 'Set Targets'], ['perf', 'Performance (month / qtr / year)'], ['reg', 'Commission Register']].map(([k, l]) => <button key={k} className={`erp-btn ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
                        {filterBar}
                        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                        {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}

                        {tab === 'targets' && (
                            <div className="border rounded-lg p-3 mb-3">
                                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                                    <MultiPick label="Salesman(s)" items={agentItems} value={form.agent_ids} onChange={v => setF2('agent_ids', v)} allLabel="Choose…" />
                                    <div className="erp-field"><label className="erp-label">Periods</label>
                                        <select className="erp-select" value={form.period_type} onChange={e => setF2('period_type', e.target.value)}><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Yearly</option></select></div>
                                    <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={form.date_from} onChange={e => setF2('date_from', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={form.date_to} onChange={e => setF2('date_to', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Qty / value given are</label>
                                        <select className="erp-select" value={form.split} onChange={e => setF2('split', e.target.value)}><option value="each">for each period</option><option value="divide">for the whole range (divide)</option></select></div>
                                    <div className="erp-field"><label className="erp-label">Target on</label>
                                        <select className="erp-select" value={form.dimension} onChange={e => { setF2('dimension', e.target.value); setF2('dimension_id', ''); }}>{DIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                                    {form.dimension !== 'all' && <div className="erp-field"><label className="erp-label">{DIMS.find(d => d[0] === form.dimension)[1]}</label>
                                        <select className="erp-select" value={form.dimension_id} onChange={e => setF2('dimension_id', e.target.value)}><option value="">Choose…</option>{(m[form.dimension] || []).map(x => <option key={x.id} value={x.id}>{x[dimName[form.dimension]]}</option>)}</select></div>}
                                    <div className="erp-field"><label className="erp-label">Target Qty (base unit)</label><input type="number" className="erp-input" value={form.target_qty} onChange={e => setF2('target_qty', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Target Value (excl. VAT)</label><input type="number" className="erp-input" value={form.target_value} onChange={e => setF2('target_value', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Commission</label>
                                        <select className="erp-select" value={form.commission_basis} onChange={e => setF2('commission_basis', e.target.value)}>{BASIS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                                    {form.commission_basis !== 'fixed'
                                        ? <div className="erp-field"><label className="erp-label">{form.commission_basis === 'qty_rate' ? 'Rate per qty' : 'Commission %'}</label><input type="number" className="erp-input" value={form.commission_rate} onChange={e => setF2('commission_rate', e.target.value)} /></div>
                                        : <div className="erp-field"><label className="erp-label">Fixed amount</label><input type="number" className="erp-input" value={form.fixed_commission} onChange={e => setF2('fixed_commission', e.target.value)} /></div>}
                                    <div className="erp-field"><label className="erp-label">Min achievement % for commission</label><input type="number" className="erp-input" value={form.min_achievement_pct} onChange={e => setF2('min_achievement_pct', e.target.value)} /></div>
                                </div>
                                <div className="flex gap-2 mt-3">
                                    <button className="erp-btn primary" onClick={() => generate(false)}>⚡ Generate {form.period_type === 'month' ? 'monthly' : form.period_type === 'quarter' ? 'quarterly' : 'yearly'} targets</button>
                                    <button className="erp-btn" onClick={() => generate(true)} title="One target covering the whole From - To range">➕ One target for the whole range</button>
                                </div>
                            </div>
                        )}

                        {(tab === 'ach' || tab === 'targets') && ach && (<>
                            {tab === 'ach' && ach.by_agent.length > 0 && (
                                <table className="erp-grid-table text-sm mb-3"><thead><tr><th>Salesman</th><th>Targets</th><th className="text-right">Target Value</th><th className="text-right">Achieved</th><th className="text-right">Ach. %</th><th className="text-right">Commission</th><th className="text-right">Posted</th><th className="text-right">Unposted</th></tr></thead>
                                    <tbody>{ach.by_agent.map(a => <tr key={a.agent_id}><td>{a.agent_name}</td><td>{a.targets}</td><td className="text-right">{fmt(a.target_value)}</td><td className="text-right">{fmt(a.achieved_value)}</td><td className="text-right">{a.achievement_pct}%</td><td className="text-right">{fmt(a.commission)}</td><td className="text-right">{fmt(a.posted)}</td><td className="text-right">{fmt(a.unposted)}</td></tr>)}</tbody></table>
                            )}
                            <div className="overflow-x-auto"><table className="erp-grid-table text-sm">
                                <thead><tr>{tab === 'ach' && <th />}<th>Salesman</th><th>Period</th><th>Target on</th><th className="text-right">Target Qty</th><th className="text-right">Achieved Qty</th><th className="text-right">Target Value</th><th className="text-right">Achieved Value</th><th className="text-right">Returns</th><th className="text-right">Balance</th><th className="text-right">Ach. %</th><th>Commission rule</th><th className="text-right">Commission</th><th>Posted</th>{tab === 'targets' && <th />}</tr></thead>
                                <tbody>{ach.rows.map(r => (
                                    <tr key={r.id} className={r.posted ? 'bg-green-50' : !r.eligible ? 'text-gray-500' : ''}>
                                        {tab === 'ach' && <td><input type="checkbox" disabled={r.posted || !(r.commission > 0)} checked={picked.has(r.id)} onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>}
                                        <td>{r.agent_name}</td><td className="text-xs">{r.period_label || `${r.period_from} - ${r.period_to}`}{!r.period_over && <span className="text-amber-600"> (running)</span>}</td>
                                        <td className="text-xs">{r.dimension_label}{r.dimension !== 'all' ? `: ${r.dimension_name}` : ''}</td>
                                        <td className="text-right">{q4(r.target_qty)}</td><td className="text-right">{q4(r.achieved_qty)}</td><td className="text-right">{fmt(r.target_value)}</td><td className="text-right">{fmt(r.achieved_value)}</td>
                                        <td className="text-right">{r.returns_value ? fmt(r.returns_value) : ''}</td><td className="text-right">{r.target_value ? fmt(r.balance_value) : q4(r.balance_qty)}</td>
                                        <td className={`text-right font-semibold ${r.achievement_pct >= 100 ? 'text-green-700' : r.achievement_pct < 50 ? 'text-red-600' : ''}`}>{r.achievement_pct}%</td>
                                        <td className="text-xs">{r.commission_basis === 'fixed' ? `Fixed ${fmt(r.fixed_commission)}` : r.commission_basis === 'qty_rate' ? `${r.commission_rate}/qty` : `${r.commission_rate}%`}{Number(r.min_achievement_pct) ? ` if ≥ ${r.min_achievement_pct}%` : ''}</td>
                                        <td className="text-right">{fmt(r.commission)}</td>
                                        <td className="text-xs">{r.posted ? `✔ ${r.posting_no}` : ''}</td>
                                        {tab === 'targets' && <td>{!r.posted && <button className="text-xs text-red-600" onClick={() => del(r.id)}>Delete</button>}</td>}
                                    </tr>))}
                                    <tr className="font-semibold bg-slate-50"><td colSpan={tab === 'ach' ? 6 : 5}>Total</td><td className="text-right">{fmt(ach.totals.target_value)}</td><td className="text-right">{fmt(ach.totals.achieved_value)}</td><td colSpan={4} /><td className="text-right">{fmt(ach.totals.commission)}</td><td colSpan={2} /></tr>
                                </tbody>
                            </table></div>
                            {ach.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No targets in this range - set them under "Set Targets".</p>}
                            {tab === 'ach' && (
                                <div className="border rounded-lg p-3 mt-3 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                                    <div className="erp-field"><label className="erp-label">Posting date</label><input type="date" className="erp-input" value={post.posting_date} onChange={e => setPost({ ...post, posting_date: e.target.value })} /></div>
                                    <div className="erp-field"><label className="erp-label">Commission expense ledger</label>
                                        <select className="erp-select" value={post.expense_ledger_id} onChange={e => setPost({ ...post, expense_ledger_id: e.target.value })}><option value="">Salesman's default</option>{m.ledgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></div>
                                    <div className="erp-field"><label className="erp-label">Commission payable ledger</label>
                                        <select className="erp-select" value={post.payable_ledger_id} onChange={e => setPost({ ...post, payable_ledger_id: e.target.value })}><option value="">Salesman's default</option>{m.ledgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></div>
                                    <p className="text-sm">{picked.size} ticked · <b>{fmt(ach.rows.filter(r => picked.has(r.id)).reduce((s, r) => s + r.commission, 0))}</b></p>
                                    <button className="erp-btn primary" disabled={busy || !picked.size} onClick={postNow}>✔ Post commission</button>
                                </div>
                            )}
                        </>)}

                        {tab === 'perf' && (<>
                            <div className="flex flex-wrap gap-3 mb-3 items-end no-print">
                                <div className="erp-field"><label className="erp-label">Rows</label><select className="erp-select" value={perfCfg.group_by} onChange={e => setPerfCfg({ ...perfCfg, group_by: e.target.value })}><option value="agent">Salesman</option><option value="product">Salesman × Product</option><option value="product_group">Salesman × Product Group</option><option value="product_company">Salesman × Product Company</option></select></div>
                                <div className="erp-field"><label className="erp-label">Columns</label><select className="erp-select" value={perfCfg.period_type} onChange={e => setPerfCfg({ ...perfCfg, period_type: e.target.value })}><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select></div>
                                <div className="erp-field"><label className="erp-label">Show</label><select className="erp-select" value={perfCfg.measure} onChange={e => setPerfCfg({ ...perfCfg, measure: e.target.value })}><option value="value">Value</option><option value="qty">Qty</option></select></div>
                            </div>
                            {perf && <div className="overflow-x-auto"><table className="erp-grid-table text-sm">
                                <thead><tr><th>Salesman</th>{perfCfg.group_by !== 'agent' && <th>Name</th>}{perf.columns.map(c => <th key={c.label} className="text-right">{c.label}</th>)}<th className="text-right">Total</th></tr></thead>
                                <tbody>{perf.rows.map((r, i) => <tr key={i}><td>{r.agent_name}</td>{perfCfg.group_by !== 'agent' && <td>{r.name}</td>}{(perfCfg.measure === 'qty' ? r.qty : r.value).map((v, j) => <td key={j} className="text-right">{perfCfg.measure === 'qty' ? q4(v) : fmt(v)}</td>)}<td className="text-right font-semibold">{perfCfg.measure === 'qty' ? q4(r.total_qty) : fmt(r.total_value)}</td></tr>)}</tbody>
                            </table></div>}
                        </>)}

                        {tab === 'reg' && reg && (
                            <table className="erp-grid-table text-sm"><thead><tr><th>No</th><th>Date</th><th>Salesman</th><th>Period</th><th>Target on</th><th className="text-right">Target</th><th className="text-right">Achieved</th><th className="text-right">Ach. %</th><th className="text-right">Commission</th><th>Expense / Payable</th><th>Status</th><th /></tr></thead>
                                <tbody>{reg.map(r => <tr key={r.id} className={r.status === 'cancelled' ? 'text-gray-400 line-through' : ''}><td>{r.doc_no}</td><td>{String(r.posting_date).slice(0, 10)}</td><td>{r.agent_name}</td><td className="text-xs">{r.period_label}</td><td className="text-xs">{r.dimension_name}</td>
                                    <td className="text-right">{fmt(r.target_value)}</td><td className="text-right">{fmt(r.achieved_value)}</td><td className="text-right">{r.achievement_pct}%</td><td className="text-right">{fmt(r.commission_amount)}</td><td className="text-xs">{r.expense_ledger} / {r.payable_ledger}</td><td>{r.status}</td>
                                    <td>{r.status === 'posted' && <button className="text-xs text-red-600" onClick={() => cancel(r.id)}>Cancel</button>}</td></tr>)}</tbody></table>
                        )}
                    </div>
                </div>
            </div>
        </Layout>
    );
}
