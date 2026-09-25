// =============================================
// StockMovementReport.jsx
// Per item: Opening Qty/Amount | In by module | Out by module | Closing
// Qty/Rate/Amount, for any period and valuation method. Same engine as the
// financial statements, so the closing value equals Closing Stock there.
// Opened directly or by zooming into Opening / Closing Stock in Financial
// Reports (?date_from=&date_to=&stock_method=).
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import SavedViewsBar from '../components/SavedViewsBar';

const iso = d => d.toISOString().slice(0, 10);
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q4 = n => { const v = Number(n || 0); return Math.abs(v) < 1e-9 ? '' : String(Math.round(v * 10000) / 10000); };
const METHOD_LABELS = { weighted_average: 'Weighted Average (periodic)', moving_average: 'Moving Average (perpetual)', fifo: 'FIFO', lifo: 'LIFO (not NFRS - comparison)', last_purchase: 'Last Purchase Rate' };

const fromUrl = () => {
    const q = new URLSearchParams(window.location.search);
    const picked = {};
    ['date_from', 'date_to', 'stock_method', 'product_company_id', 'product_group_id', 'product_id'].forEach(k => { if (q.get(k)) picked[k] = q.get(k); });
    return picked;
};
const defaultConfig = () => ({ date_from: `${new Date().getFullYear()}-01-01`, date_to: iso(new Date()), stock_method: 'weighted_average',
    product_group_id: '', product_company_id: '', product_id: '', hide_zero: true, show_value: true, columns: 'summary' });

export default function StockMovementReport() {
    const { authFetch } = useAuth();
    const initial = fromUrl();
    const [config, setConfig] = useState({ ...defaultConfig(), ...initial });
    const [masters, setMasters] = useState({ groups: [], companies: [], products: [] });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    useEffect(() => {
        const load = async u => { try { return (await authFetch(u)).data || []; } catch { return []; } };
        Promise.all([load('/api/product-groups'), load('/api/product-companies'), load('/api/products?pageSize=2000')])
            .then(([groups, companies, products]) => setMasters({ groups, companies, products }));
    }, [authFetch]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams();
            ['date_from', 'date_to', 'stock_method', 'product_group_id', 'product_company_id', 'product_id'].forEach(k => { if (cfg[k]) p.set(k, cfg[k]); });
            p.set('hide_zero', cfg.hide_zero ? 'true' : 'false');
            p.set('columns', cfg.columns || 'summary');
            setData((await authFetch(`/api/stock/movement?${p}`)).data);
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);
    // Zoomed in from Financial Reports: run straight away.
    useEffect(() => { if (initial.date_to) run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const exportCsv = () => {
        if (!data) return;
        const head = ['Item', 'Code', 'Opening Qty', 'Opening Amount',
            ...data.modules_in.flatMap(m => [`IN ${m.label} Qty`, `IN ${m.label} Amount`]), 'Total In Qty', 'Total In Amount',
            ...data.modules_out.flatMap(m => [`OUT ${m.label} Qty`, `OUT ${m.label} Amount`]), 'Total Out Qty', 'Total Out Amount',
            'Closing Qty', 'Closing Rate', 'Closing Amount'];
        const cell = (obj, k) => obj[k] ? [obj[k].qty, obj[k].value] : [0, 0];
        const rows = data.rows.map(r => [r.product_name, r.product_code, r.opening_qty, r.opening_value,
            ...data.modules_in.flatMap(m => cell(r.in, m.key)), r.in_qty, r.in_value,
            ...data.modules_out.flatMap(m => cell(r.out, m.key)), r.out_qty, r.out_value, r.closing_qty, r.closing_rate, r.closing_value]);
        const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\uFEFF' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `stock_movement_${config.date_from}_${config.date_to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    const V = config.show_value;
    const pair = (b) => <>{<td className="text-right">{b ? q4(b.qty) : ''}</td>}{V && <td className="text-right text-gray-600">{b && b.value ? fmt(b.value) : ''}</td>}</>;
    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">📦 Stock Movement</span></div>
            <div className="erp-tab-content">
                <SavedViewsBar reportKey="stock_movement" getConfig={() => config} onApply={cfg => { const m = { ...defaultConfig(), ...cfg }; setConfig(m); run(m); }} onReset={() => { setConfig(defaultConfig()); setData(null); }} />
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 my-3">
                    <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">Valuation method</label>
                        <select className="erp-select" value={config.stock_method} onChange={e => set('stock_method', e.target.value)}>{Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                    <div className="erp-field"><label className="erp-label">Product Group</label>
                        <select className="erp-select" value={config.product_group_id} onChange={e => set('product_group_id', e.target.value)}><option value="">All</option>{masters.groups.map(g => <option key={g.id} value={g.id}>{g.group_name}</option>)}</select></div>
                    <div className="erp-field"><label className="erp-label">Product Company</label>
                        <select className="erp-select" value={config.product_company_id} onChange={e => set('product_company_id', e.target.value)}><option value="">All</option>{masters.companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></div>
                    <div className="erp-field"><label className="erp-label">Item</label>
                        <select className="erp-select" value={config.product_id} onChange={e => set('product_id', e.target.value)}><option value="">All</option>{masters.products.map(p => <option key={p.id} value={p.id}>{p.product_name}</option>)}</select></div>
                    <div className="erp-field"><label className="erp-label">Columns</label>
                        <select className="erp-select" value={config.columns} onChange={e => set('columns', e.target.value)}>
                            <option value="summary">Normal - Purchase / Sales (GRN + Bill together)</option>
                            <option value="detail">Module-wise (GRN, Bill, Delivery ... separately)</option>
                        </select></div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.show_value} onChange={e => set('show_value', e.target.checked)} /> Show amounts</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.hide_zero} onChange={e => set('hide_zero', e.target.checked)} /> Hide items with no stock or movement</label>
                </div>
                <div className="flex gap-2 mb-3">
                    <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data?.rows?.length > 0 && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                    {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {data && <p className="text-xs text-gray-500 mb-2">Valued by {data.method_label}. Closing amount equals Closing Stock in Financial Reports for the same date and method. {data.reconciles ? '✓ Opening + In − Out = Closing for every item.' : '✗ Some items do not reconcile - please report this.'}</p>}
                {data?.warnings?.length > 0 && <p className="text-xs text-amber-700 mb-2">{data.warnings.join(' · ')}</p>}
                {data && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table text-sm">
                            <thead>
                                <tr>
                                    <th rowSpan={2}>Item</th>
                                    <th colSpan={V ? 2 : 1} className="text-center">Opening</th>
                                    {data.modules_in.map(m => <th key={'i' + m.key} colSpan={V ? 2 : 1} className="text-center bg-green-50">In: {m.label}</th>)}
                                    <th colSpan={V ? 2 : 1} className="text-center bg-green-100">Total In</th>
                                    {data.modules_out.map(m => <th key={'o' + m.key} colSpan={V ? 2 : 1} className="text-center bg-red-50">Out: {m.label}</th>)}
                                    <th colSpan={V ? 2 : 1} className="text-center bg-red-100">Total Out</th>
                                    <th colSpan={V ? 3 : 1} className="text-center">Closing</th>
                                </tr>
                                <tr>
                                    {Array.from({ length: 1 + data.modules_in.length + 1 + data.modules_out.length + 1 }).map((_, i) => <React.Fragment key={i}><th className="text-right">Qty</th>{V && <th className="text-right">Amount</th>}</React.Fragment>)}
                                    <th className="text-right">Qty</th>{V && <><th className="text-right">Rate</th><th className="text-right">Amount</th></>}
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map(r => (
                                    <tr key={r.product_id}>
                                        <td>{r.product_name}{r.product_code ? <span className="text-xs text-gray-400"> · {r.product_code}</span> : null}</td>
                                        {pair({ qty: r.opening_qty, value: r.opening_value })}
                                        {data.modules_in.map(m => <React.Fragment key={'i' + m.key}>{pair(r.in[m.key])}</React.Fragment>)}
                                        {pair({ qty: r.in_qty, value: r.in_value })}
                                        {data.modules_out.map(m => <React.Fragment key={'o' + m.key}>{pair(r.out[m.key])}</React.Fragment>)}
                                        {pair({ qty: r.out_qty, value: r.out_value })}
                                        <td className="text-right font-semibold">{q4(r.closing_qty)}</td>
                                        {V && <><td className="text-right">{r.closing_rate ? fmt(r.closing_rate) : ''}</td><td className="text-right font-semibold">{fmt(r.closing_value)}</td></>}
                                    </tr>
                                ))}
                                {V && data.rows.length > 0 && (
                                    <tr className="font-bold bg-slate-50">
                                        <td>Total ({data.rows.length} items)</td>
                                        <td /><td className="text-right">{fmt(data.totals.opening_value)}</td>
                                        {data.modules_in.map(m => <React.Fragment key={'ti' + m.key}><td /><td className="text-right">{fmt(data.totals.in[m.key]?.value)}</td></React.Fragment>)}
                                        <td /><td className="text-right">{fmt(data.totals.in_value)}</td>
                                        {data.modules_out.map(m => <React.Fragment key={'to' + m.key}><td /><td className="text-right">{fmt(data.totals.out[m.key]?.value)}</td></React.Fragment>)}
                                        <td /><td className="text-right">{fmt(data.totals.out_value)}</td>
                                        <td /><td /><td className="text-right">{fmt(data.totals.closing_value)}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        {data.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No stock or movement for these filters.</p>}
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
