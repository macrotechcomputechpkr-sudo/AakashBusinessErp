// =============================================
// FixedAssets.jsx
// Fixed asset register and depreciation (server/utils/fixedAssets.js)
//   Register      assets with cost, depreciation to date, book value; add /
//                 edit; dispose (sale / scrap) - selling the asset's product
//                 on a Sales Bill disposes it automatically
//   Depreciation  preview and post up to a date (SLM / WDV, per day), never
//                 the same days twice; runs list with cancel
//   Schedule      period schedule: cost (opening, additions, disposals),
//                 depreciation (opening, charge, on disposals), net book value,
//                 gain / loss - by asset, or grouped by ledger / branch /
//                 cost center / tax block / method
//   Detail        every depreciation entry (asset, days, book value, amount)
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import useLedgerPurposes from '../components/useLedgerPurposes';

const fmt2 = n => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const iso = d => d.toISOString().slice(0, 10);
const emptyAsset = { asset_code: '', asset_name: '', product_id: '', asset_ledger_id: '', accumulated_dep_ledger_id: '', dep_expense_ledger_id: '', disposal_ledger_id: '', branch_id: '', cost_center_id: '',
    location: '', purchase_date: '', put_to_use_date: '', cost: '', opening_accumulated_dep: 0, depreciated_upto: '', method: 'wdv', rate: '', salvage_value: 0, tax_block: '', notes: '' };
const TAX_BLOCKS = [['', '—'], ['A', 'A - Buildings (5%)'], ['B', 'B - Computers, furniture, office equipment (25%)'], ['C', 'C - Vehicles (20%)'], ['D', 'D - Plant & machinery, other (15%)'], ['E', 'E - Intangibles']];

export default function FixedAssets() {
    const { authFetch } = useAuth();
    const lp = useLedgerPurposes();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'register'); // ?tab= deep link from the Report Center
    const [assets, setAssets] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [masters, setMasters] = useState({ branches: [], ccs: [], products: [] });
    const [form, setForm] = useState(null);
    const [dispose, setDispose] = useState(null);
    const [dep, setDep] = useState({ period_to: iso(new Date()), posting_date: iso(new Date()) });
    const [preview, setPreview] = useState(null);
    const [pick, setPick] = useState(() => new Set());
    const [runs, setRuns] = useState(null);
    const [sch, setSch] = useState({ from: '', to: iso(new Date()), group_by: '' });
    const [schedule, setSchedule] = useState(null);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');

    const load = useCallback(async () => { try { setAssets((await authFetch('/api/fixed-assets')).data || []); } catch (e) { setError(e.message); } }, [authFetch]);
    useEffect(() => {
        load();
        authFetch('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc').then(r => setLedgers(r.data || [])).catch(() => {});
        const list = (url, map) => authFetch(url).then(r => (r.data || []).map(map)).catch(() => []);
        Promise.all([list('/api/branches', b => ({ id: b.id, name: b.branch_name })), list('/api/cost-centers', c => ({ id: c.id, name: c.cost_center_name })), list('/api/products?pageSize=5000', p => ({ id: p.id, name: p.product_name, item_type: p.item_type }))])
            .then(([branches, ccs, products]) => setMasters({ branches, ccs, products }));
    }, [authFetch, load]);
    const loadRuns = useCallback(async () => { try { setRuns((await authFetch('/api/fixed-assets/depreciation-detail')).data); } catch (e) { setError(e.message); } }, [authFetch]);
    useEffect(() => { if (tab === 'runs' || tab === 'detail') loadRuns(); }, [tab, loadRuns]);

    const save = async () => {
        setError('');
        try {
            const body = { ...form }; delete body.id;
            if (form.id) await authFetch(`/api/fixed-assets/${form.id}`, { method: 'PUT', body: JSON.stringify(body) });
            else await authFetch('/api/fixed-assets', { method: 'POST', body: JSON.stringify(body) });
            setMsg('Asset saved'); setForm(null); load();
        } catch (e) { setError(e.message); }
    };
    const doPreview = async () => {
        setError('');
        try { const r = await authFetch(`/api/fixed-assets/depreciation/preview?period_to=${dep.period_to}`); setPreview(r.data); setPick(new Set(r.data.rows.filter(x => x.depreciation > 0).map(x => x.asset_id))); } catch (e) { setError(e.message); }
    };
    const doPost = async () => {
        if (!window.confirm(`Post depreciation for ${pick.size} asset(s)?`)) return;
        try { const r = await authFetch('/api/fixed-assets/depreciation/post', { method: 'POST', body: JSON.stringify({ ...dep, post_asset_ids: [...pick].join(',') }) }); setMsg(`Posted ${r.data.doc_no}: ${fmt2(r.data.total)} on ${r.data.assets} asset(s)`); setPreview(null); load(); } catch (e) { setError(e.message); }
    };
    const doDispose = async () => {
        try {
            const r = await authFetch(`/api/fixed-assets/${dispose.asset.id}/dispose`, { method: 'POST', body: JSON.stringify(dispose) });
            setMsg(`${dispose.asset.asset_code} disposed (${r.data.doc_no}) - depreciation ${fmt2(r.data.depreciation)}, book value ${fmt2(r.data.book_value)}${r.data.gain_loss !== null ? `, gain / loss ${fmt2(r.data.gain_loss)}` : ''}`);
            setDispose(null); load();
        } catch (e) { setError(e.message); }
    };
    const cancelRun = async run => {
        const reason = window.prompt(`Cancel ${run.doc_no}? Reason:`);
        if (!reason) return;
        try { await authFetch(`/api/fixed-assets/runs/${run.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); setMsg(`${run.doc_no} cancelled`); loadRuns(); load(); } catch (e) { setError(e.message); }
    };
    const runSchedule = async () => {
        try { const p = new URLSearchParams({ to: sch.to, ...(sch.from ? { from: sch.from } : {}), ...(sch.group_by ? { group_by: sch.group_by } : {}) }); setSchedule((await authFetch(`/api/fixed-assets/schedule?${p}`)).data); } catch (e) { setError(e.message); }
    };
    const L = (purpose, key, label, req) => (
        <label className="erp-field"><span className="erp-label">{label}{req ? ' *' : ''}</span>
            <select className="erp-select" value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}>
                <option value="">—</option>{(purpose ? lp.filter(ledgers, purpose, form[key]) : ledgers).map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}
            </select></label>
    );
    const SCH_COLS = [['opening_cost', 'Opening cost'], ['additions', 'Additions'], ['disposals', 'Disposals'], ['closing_cost', 'Closing cost'], ['opening_dep', 'Opening dep.'], ['brought_in_dep', 'Dep. brought in'], ['charge', 'Charge'], ['dep_on_disposal', 'Dep. on disposal'], ['closing_dep', 'Closing dep.'], ['opening_nbv', 'Opening NBV'], ['closing_nbv', 'Closing NBV']];

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">🏗 Fixed Assets &amp; Depreciation</span></div>
            <div className="erp-tab-content">
                <div className="flex gap-1 mb-3 border-b">
                    {[['register', 'Register'], ['dep', 'Depreciation Posting'], ['runs', 'Runs'], ['schedule', 'Schedule Report'], ['detail', 'Depreciation Detail']].map(([k, l]) => <button key={k} className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => setTab(k)}>{l}</button>)}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}

                {tab === 'register' && (
                    <>
                        <button className="erp-btn primary mb-2" onClick={() => setForm({ ...emptyAsset })}>➕ New asset</button>
                        <table className="erp-grid-table w-full text-sm">
                            <thead><tr><th className="text-left">Code</th><th className="text-left">Asset</th><th className="text-left">Method</th><th className="text-right">Rate</th><th className="text-left">In use from</th><th className="text-right">Cost</th><th className="text-right">Depreciation</th><th className="text-right">Book value</th><th className="text-left">Dep. up to</th><th className="text-left">Status</th><th /></tr></thead>
                            <tbody>{assets.map(a => (
                                <tr key={a.id} className={a.status !== 'active' ? 'text-gray-400' : ''}><td>{a.asset_code}</td><td>{a.asset_name}{a.tax_block ? <span className="text-[10px] ml-1">block {a.tax_block}</span> : null}</td><td>{a.method.toUpperCase()}</td><td className="text-right">{a.rate}%</td><td>{String(a.put_to_use_date).slice(0, 10)}</td>
                                    <td className="text-right tabular-nums">{fmt2(a.cost)}</td><td className="text-right tabular-nums">{fmt2(a.accumulated)}</td><td className="text-right tabular-nums font-semibold">{fmt2(a.status === 'active' ? a.book_value : 0)}</td>
                                    <td>{a.depreciated_upto ? String(a.depreciated_upto).slice(0, 10) : ''}</td><td>{a.status}{a.disposal_date ? ` ${String(a.disposal_date).slice(0, 10)}` : ''}</td>
                                    <td className="whitespace-nowrap">{a.status === 'active' && <><button className="text-xs underline mr-2" onClick={() => setForm({ ...emptyAsset, ...Object.fromEntries(Object.entries(a).filter(([k, v]) => v !== null && k in emptyAsset)), id: a.id, put_to_use_date: String(a.put_to_use_date).slice(0, 10), depreciated_upto: a.depreciated_upto ? String(a.depreciated_upto).slice(0, 10) : '' })}>edit</button>
                                        <button className="text-xs underline text-red-600" onClick={() => setDispose({ asset: a, disposal_date: iso(new Date()), disposal_amount: '', scrap: false, receipt_ledger_id: '' })}>dispose</button></>}</td></tr>
                            ))}{!assets.length && <tr><td colSpan={11} className="text-center text-gray-400 py-3">No assets yet.</td></tr>}</tbody>
                        </table>
                    </>
                )}

                {tab === 'dep' && (
                    <>
                        <div className="flex flex-wrap gap-3 items-end mb-3">
                            <div className="erp-field"><label className="erp-label">Depreciate up to</label><input type="date" className="erp-input" value={dep.period_to} onChange={e => setDep(d => ({ ...d, period_to: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">Posting date</label><input type="date" className="erp-input" value={dep.posting_date} onChange={e => setDep(d => ({ ...d, posting_date: e.target.value }))} /></div>
                            <button className="erp-btn" onClick={doPreview}>🔍 Preview</button>
                            {preview && <button className="erp-btn primary" disabled={!pick.size} onClick={doPost}>✔ Post {fmt2(preview.rows.filter(r => pick.has(r.asset_id)).reduce((s, r) => s + r.depreciation, 0))}</button>}
                        </div>
                        {preview && (
                            <table className="erp-grid-table w-full text-sm">
                                <thead><tr><th /><th className="text-left">Asset</th><th className="text-left">Method</th><th className="text-left">From</th><th className="text-left">To</th><th className="text-right">Days</th><th className="text-right">Book value</th><th className="text-right">Depreciation</th><th className="text-right">Closing</th><th className="text-left">Credit to</th></tr></thead>
                                <tbody>{preview.rows.map(r => (
                                    <tr key={r.asset_id}><td><input type="checkbox" checked={pick.has(r.asset_id)} onChange={() => setPick(s => { const n = new Set(s); if (n.has(r.asset_id)) n.delete(r.asset_id); else n.add(r.asset_id); return n; })} /></td>
                                        <td>{r.asset_code} · {r.asset_name}</td><td>{r.method.toUpperCase()} {r.rate}%</td><td>{r.from_date}</td><td>{r.to_date}</td><td className="text-right">{r.days}</td>
                                        <td className="text-right tabular-nums">{fmt2(r.opening_value)}</td><td className="text-right tabular-nums font-semibold">{fmt2(r.depreciation)}</td><td className="text-right tabular-nums">{fmt2(r.closing_value)}</td><td className="text-xs">{r.direct ? 'asset ledger (value reduced)' : 'accumulated depreciation'}</td></tr>
                                ))}{!preview.rows.length && <tr><td colSpan={10} className="text-center text-gray-400 py-3">Nothing to depreciate up to this date.</td></tr>}</tbody>
                            </table>
                        )}
                    </>
                )}

                {tab === 'runs' && runs && (
                    <table className="erp-grid-table w-full text-sm">
                        <thead><tr><th className="text-left">Run</th><th className="text-left">Type</th><th className="text-left">Up to</th><th className="text-left">Posted</th><th className="text-right">Assets</th><th className="text-right">Amount</th><th className="text-left">Status</th><th /></tr></thead>
                        <tbody>{runs.runs.map(r => (
                            <tr key={r.id} className={r.status === 'cancelled' ? 'text-gray-400' : ''}><td>{r.doc_no}</td><td>{r.run_type}</td><td>{r.period_to}</td><td>{r.posting_date}</td><td className="text-right">{r.asset_count}</td><td className="text-right tabular-nums">{fmt2(r.total_amount)}</td>
                                <td>{r.status}{r.cancellation_reason ? ` (${r.cancellation_reason})` : ''}</td><td>{r.status === 'posted' && <button className="text-red-600 underline text-xs" onClick={() => cancelRun(r)}>cancel</button>}</td></tr>
                        ))}{!runs.runs.length && <tr><td colSpan={8} className="text-center text-gray-400 py-3">No runs yet.</td></tr>}</tbody>
                    </table>
                )}

                {tab === 'schedule' && (
                    <>
                        <div className="flex flex-wrap gap-3 items-end mb-3">
                            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={sch.from} onChange={e => setSch(s => ({ ...s, from: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={sch.to} onChange={e => setSch(s => ({ ...s, to: e.target.value }))} /></div>
                            <div className="erp-field"><label className="erp-label">Group by</label><select className="erp-select" value={sch.group_by} onChange={e => setSch(s => ({ ...s, group_by: e.target.value }))}>
                                <option value="">Asset</option><option value="asset_ledger">Asset ledger</option><option value="branch">Branch</option><option value="cost_center">Cost center</option><option value="tax_block">Tax block</option><option value="method">Method</option><option value="status">Status</option></select></div>
                            <button className="erp-btn primary" onClick={runSchedule}>🔍 Show</button>
                            {schedule && <button className="erp-btn" onClick={() => window.print()}>🖨 Print</button>}
                        </div>
                        {schedule && (
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table w-full text-xs">
                                    <thead><tr><th className="text-left">{schedule.group_by ? schedule.group_by.replace('_', ' ') : 'Asset'}</th>{SCH_COLS.map(([k, l]) => <th key={k} className="text-right">{l}</th>)}<th className="text-right">Gain / loss</th></tr></thead>
                                    <tbody>
                                        {(schedule.groups || [{ key: null, rows: schedule.rows }]).map(g => (
                                            <React.Fragment key={g.key || 'all'}>
                                                {g.key && <tr className="bg-gray-100 font-semibold"><td>{g.key}</td>{SCH_COLS.map(([k]) => <td key={k} className="text-right tabular-nums">{fmt2(g.totals[k])}</td>)}<td /></tr>}
                                                {g.rows.map(r => <tr key={r.asset_id}><td className={g.key ? 'pl-4' : ''}>{r.asset_code} · {r.asset_name}</td>{SCH_COLS.map(([k]) => <td key={k} className="text-right tabular-nums">{r[k] ? fmt2(r[k]) : ''}</td>)}<td className="text-right tabular-nums">{r.gain_loss !== null ? fmt2(r.gain_loss) : ''}</td></tr>)}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                    <tfoot><tr className="font-bold bg-blue-50"><td>Total</td>{SCH_COLS.map(([k]) => <td key={k} className="text-right tabular-nums">{fmt2(schedule.totals[k])}</td>)}<td /></tr></tfoot>
                                </table>
                            </div>
                        )}
                    </>
                )}

                {tab === 'detail' && runs && (
                    <table className="erp-grid-table w-full text-sm">
                        <thead><tr><th className="text-left">Asset</th><th className="text-left">Run</th><th className="text-left">From</th><th className="text-left">To</th><th className="text-right">Days</th><th className="text-left">Method</th><th className="text-right">Opening value</th><th className="text-right">Depreciation</th><th className="text-right">Closing</th><th className="text-right">Sale value</th><th className="text-right">Gain / loss</th></tr></thead>
                        <tbody>{runs.rows.map(e => (
                            <tr key={e.id} className={e.run_status === 'cancelled' ? 'text-gray-400 line-through' : ''}><td>{e.asset_code} · {e.asset_name}</td><td>{e.run_no} {e.run_type === 'disposal' ? '(disposal)' : ''}</td><td>{String(e.from_date).slice(0, 10)}</td><td>{String(e.to_date).slice(0, 10)}</td>
                                <td className="text-right">{e.days}</td><td>{String(e.method).toUpperCase()} {e.rate}%</td><td className="text-right tabular-nums">{fmt2(e.opening_value)}</td><td className="text-right tabular-nums">{fmt2(e.depreciation)}</td><td className="text-right tabular-nums">{fmt2(e.closing_value)}</td>
                                <td className="text-right tabular-nums">{fmt2(e.disposal_amount)}</td><td className="text-right tabular-nums">{fmt2(e.gain_loss)}</td></tr>
                        ))}</tbody>
                    </table>
                )}
            </div>
        </div>
        </div>

        {form && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-auto">
                <div className="bg-white rounded-lg p-4 w-full max-w-4xl text-sm">
                    <div className="font-semibold mb-2">{form.id ? 'Edit' : 'New'} fixed asset</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <label className="erp-field"><span className="erp-label">Code *</span><input className="erp-input" value={form.asset_code} onChange={e => setForm(f => ({ ...f, asset_code: e.target.value }))} /></label>
                        <label className="erp-field md:col-span-2"><span className="erp-label">Asset name *</span><input className="erp-input" value={form.asset_name} onChange={e => setForm(f => ({ ...f, asset_name: e.target.value }))} /></label>
                        <label className="erp-field"><span className="erp-label">Product (sold on sales bill)</span><select className="erp-select" value={form.product_id || ''} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}><option value="">—</option>{masters.products.map(p => <option key={p.id} value={p.id}>{p.name}{p.item_type === 'fixed_asset' ? ' (asset)' : ''}</option>)}</select></label>
                        {L('purchase_goods', 'asset_ledger_id', 'Asset ledger', true)}
                        {L(null, 'accumulated_dep_ledger_id', 'Accumulated dep. ledger (blank = reduce asset)')}
                        {L('cogs', 'dep_expense_ledger_id', 'Depreciation expense ledger', true)}
                        {L(null, 'disposal_ledger_id', 'Disposal / gain-loss ledger')}
                        <label className="erp-field"><span className="erp-label">Purchase date</span><input type="date" className="erp-input" value={form.purchase_date || ''} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} /></label>
                        <label className="erp-field"><span className="erp-label">Put to use *</span><input type="date" className="erp-input" value={form.put_to_use_date} onChange={e => setForm(f => ({ ...f, put_to_use_date: e.target.value }))} /></label>
                        <label className="erp-field"><span className="erp-label">Cost *</span><input type="number" className="erp-input" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} /></label>
                        <label className="erp-field"><span className="erp-label">Salvage value</span><input type="number" className="erp-input" value={form.salvage_value} onChange={e => setForm(f => ({ ...f, salvage_value: e.target.value }))} /></label>
                        <label className="erp-field"><span className="erp-label">Method</span><select className="erp-select" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}><option value="wdv">WDV (written down value)</option><option value="slm">SLM (straight line)</option></select></label>
                        <label className="erp-field"><span className="erp-label">Rate % p.a.</span><input type="number" step="0.01" className="erp-input" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} /></label>
                        <label className="erp-field"><span className="erp-label">Tax block</span><select className="erp-select" value={form.tax_block || ''} onChange={e => setForm(f => ({ ...f, tax_block: e.target.value }))}>{TAX_BLOCKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                        <label className="erp-field"><span className="erp-label">Dep. already charged (opening)</span><input type="number" className="erp-input" value={form.opening_accumulated_dep} onChange={e => setForm(f => ({ ...f, opening_accumulated_dep: e.target.value }))} /></label>
                        <label className="erp-field"><span className="erp-label">…charged up to</span><input type="date" className="erp-input" value={form.depreciated_upto || ''} onChange={e => setForm(f => ({ ...f, depreciated_upto: e.target.value }))} /></label>
                        <label className="erp-field"><span className="erp-label">Branch</span><select className="erp-select" value={form.branch_id || ''} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}><option value="">—</option>{masters.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                        <label className="erp-field"><span className="erp-label">Cost center</span><select className="erp-select" value={form.cost_center_id || ''} onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))}><option value="">—</option>{masters.ccs.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                        <label className="erp-field"><span className="erp-label">Location</span><input className="erp-input" value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></label>
                        <label className="erp-field md:col-span-4"><span className="erp-label">Notes</span><input className="erp-input" value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></label>
                    </div>
                    <div className="flex justify-end gap-2 pt-3"><button className="erp-btn" onClick={() => setForm(null)}>Close</button><button className="erp-btn primary" onClick={save}>💾 Save</button></div>
                </div>
            </div>
        )}
        {dispose && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg p-4 w-full max-w-md text-sm space-y-2">
                    <div className="font-semibold">Dispose {dispose.asset.asset_code} · {dispose.asset.asset_name}</div>
                    <p className="text-xs text-gray-500">Depreciation is posted up to the disposal date; the book value moves to the disposal ledger. If the asset is sold on a Sales Bill (its product), this happens automatically when that bill is posted.</p>
                    <label className="block">Date <input type="date" className="erp-input" value={dispose.disposal_date} onChange={e => setDispose(d => ({ ...d, disposal_date: e.target.value }))} /></label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={dispose.scrap} onChange={e => setDispose(d => ({ ...d, scrap: e.target.checked }))} /> Scrapped (no sale)</label>
                    {!dispose.scrap && <>
                        <label className="block">Sale value <input type="number" className="erp-input" value={dispose.disposal_amount} onChange={e => setDispose(d => ({ ...d, disposal_amount: e.target.value }))} /></label>
                        <label className="block">Received in (cash / bank / party) <select className="erp-select" value={dispose.receipt_ledger_id} onChange={e => setDispose(d => ({ ...d, receipt_ledger_id: e.target.value }))}><option value="">— not now (sales bill) —</option>{ledgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></label>
                    </>}
                    <div className="flex justify-end gap-2 pt-2"><button className="erp-btn" onClick={() => setDispose(null)}>Close</button><button className="erp-btn primary" onClick={doDispose}>Confirm</button></div>
                </div>
            </div>
        )}
        </Layout>
    );
}
