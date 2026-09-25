// =============================================
// PartySummaryReport.jsx
// Per customer / supplier: Opening, Purchase, Sales, Purchase Return,
// Sales Return, Debit Note, Credit Note, Receipt, Payment, Closing.
// JV entries appear under Debit Note (party Dr) / Credit Note (party Cr).
// Data: /api/party-summary (straight from the GL, reconciled per row).
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import SavedViewsBar from '../components/SavedViewsBar';

const COLS = [
    ['purchase', 'Purchase'], ['sales', 'Sales'], ['purchase_return', 'Pur. Return'], ['sales_return', 'Sales Return'],
    ['debit_note', 'Debit Note'], ['credit_note', 'Credit Note'], ['receipt', 'Receipt'], ['payment', 'Payment']
];
const today = () => new Date().toISOString().slice(0, 10);
const defaultConfig = () => ({
    date_from: `${new Date().getFullYear()}-01-01`, date_to: today(), party_scope: 'all', account_group_id: '', party_ledger_id: '',
    area_id: '', agent_id: '', route_id: '', ledger_category_id: '', product_company_id: '', hide_zero: true, balance_side: '', pdc_separate: false
});
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = n => Math.abs(n) < 0.005 ? '0.00' : `${fmt(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`;

export default function PartySummaryReport() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [masters, setMasters] = useState({ groups: [], parties: [], areas: [], agents: [], routes: [], categories: [], companies: [] });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    useEffect(() => {
        const load = async (url) => { try { return (await authFetch(url)).data || []; } catch { return []; } };
        Promise.all([load('/api/account-groups'), load('/api/ledger-accounts?pageSize=1000'), load('/api/areas'), load('/api/salesman-agents'),
            load('/api/routes'), load('/api/ledger-categories'), load('/api/product-companies')])
            .then(([groups, parties, areas, agents, routes, categories, companies]) => setMasters({ groups, parties, areas, agents, routes, categories, companies }));
    }, [authFetch]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams();
            Object.entries(cfg).forEach(([k, v]) => { if (v !== '' && v !== false && v !== null) p.set(k, v === true ? 'true' : v); });
            setData({ ...(await authFetch(`/api/party-summary?${p}`)).data, pdc_separate: !!cfg.pdc_separate });
        } catch (err) { setError(err.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const exportCsv = () => {
        const cs = data?.pdc_separate ? [...COLS, ['pdc_received', 'PDC Received'], ['pdc_issued', 'PDC Issued']] : COLS;
        const head = ['Party', 'Code', 'Group', 'PAN', 'Opening', ...cs.map(c => c[1]), 'Others Dr', 'Others Cr', 'Closing', ...(data?.pdc_separate ? ['Pending PDC Received', 'Pending PDC Issued', 'Closing after PDC'] : [])];
        const signed = n => (Number(n) || 0).toFixed(2);
        const pd = r => (data?.pdc_separate ? [signed(r.pdc_pending_received), signed(r.pdc_pending_issued), signed(r.closing_after_pdc)] : []);
        const lines = (data?.rows || []).map(r => [r.party_name, r.account_code, r.group_name, r.pan || '', signed(r.opening), ...cs.map(([k]) => signed(r[k])), signed(r.others_dr), signed(r.others_cr), signed(r.closing), ...pd(r)]);
        if (data?.totals) lines.push(['TOTAL', '', '', '', signed(data.totals.opening), ...cs.map(([k]) => signed(data.totals[k])), signed(data.totals.others_dr), signed(data.totals.others_cr), signed(data.totals.closing), ...pd(data.totals)]);
        const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\uFEFF' + [head, ...lines].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `party_summary_${config.date_from}_${config.date_to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    const picker = (key, list, label, getLabel, placeholder = 'All') => (
        <div className="erp-field">
            <label className="erp-label">{label}</label>
            <SearchablePopupSelect listKey={`party_summary_${key}`} columns={[{ key: 'label', label: 'Name' }]} defaultVisibleKeys={['label']}
                items={list.map(i => ({ ...i, label: getLabel(i) }))} getId={i => i.id} getLabel={getLabel} searchKeys={['label']}
                value={config[key]} onChange={v => set(key, v)} placeholder={placeholder} />
        </div>
    );
    const showOthers = data && (Math.abs(data.totals?.others_dr || 0) > 0.005 || Math.abs(data.totals?.others_cr || 0) > 0.005);
    const pdcOn = !!data?.pdc_separate;
    const cols = pdcOn ? [...COLS, ['pdc_received', 'PDC Received'], ['pdc_issued', 'PDC Issued']] : COLS;

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">👥 Party Summary</span></div>
            <div className="erp-tab-content">
                <SavedViewsBar reportKey="party_summary" getConfig={() => config} onApply={cfg => { const merged = { ...defaultConfig(), ...cfg }; setConfig(merged); run(merged); }} onReset={() => { setConfig(defaultConfig()); setData(null); }} />
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 my-3">
                    <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">Parties</label>
                        <select className="erp-select" value={config.party_scope} onChange={e => set('party_scope', e.target.value)} disabled={!!config.account_group_id}>
                            <option value="all">Customers & Suppliers</option><option value="customers">Customers</option><option value="suppliers">Suppliers</option>
                        </select></div>
                    {picker('account_group_id', masters.groups, 'Account Group (overrides Parties)', g => g.group_name)}
                    {picker('party_ledger_id', masters.parties, 'Single Party', l => l.account_name)}
                    {picker('ledger_category_id', masters.categories, 'Ledger Category', c => c.category_name)}
                    {picker('area_id', masters.areas, 'Area', a => a.area_name)}
                    {picker('agent_id', masters.agents, 'Agent', a => a.agent_name)}
                    {picker('route_id', masters.routes, 'Route', r => r.route_name)}
                    {picker('product_company_id', masters.companies, 'Product Company', c => c.company_name)}
                    <div className="erp-field"><label className="erp-label">Closing balance</label>
                        <select className="erp-select" value={config.balance_side} onChange={e => set('balance_side', e.target.value)}>
                            <option value="">Any</option><option value="dr">Debit (receivable) only</option><option value="cr">Credit (payable) only</option>
                        </select></div>
                    <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={config.hide_zero} onChange={e => set('hide_zero', e.target.checked)} /> Hide parties with nothing to show</label>
                    <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={config.pdc_separate} onChange={e => set('pdc_separate', e.target.checked)} /> Show PDC separately (matured + pending cheques)</label>
                </div>
                <div className="flex gap-2 mb-3">
                    <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data?.rows?.length > 0 && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                </div>
                <p className="text-xs text-gray-500 mb-2">JV entries are shown under Debit Note (party debited) or Credit Note (party credited). Cash/Bank and PDC: party credited = Receipt, debited = Payment (tick "Show PDC separately" to split matured PDCs into their own columns and see pending cheques).{config.product_company_id ? ' Company view: only that company\u2019s entries; the ledger\u2019s master opening is not included.' : ''}</p>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {data && data.all_reconcile === false && <p className="text-sm text-red-600 mb-2">Some rows do not reconcile - please report this.</p>}
                {data && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table text-sm">
                            <thead><tr><th>Party</th><th className="text-right">Opening</th>{cols.map(([k, l]) => <th key={k} className="text-right">{l}</th>)}{showOthers && <><th className="text-right">Others Dr</th><th className="text-right">Others Cr</th></>}<th className="text-right">Closing</th>{pdcOn && <><th className="text-right">Pending PDC Recd.</th><th className="text-right">Pending PDC Issued</th><th className="text-right">Closing after PDC</th></>}</tr></thead>
                            <tbody>
                                {data.rows.map(r => (
                                    <tr key={r.ledger_id}>
                                        <td><a href={`/ledger-report?ledger_id=${r.ledger_id}&date_from=${config.date_from}&date_to=${config.date_to}&mode=detail`} target="_blank" rel="noopener noreferrer" className="hover:underline" title="Open ledger">{r.party_name}</a><div className="text-xs text-gray-400">{r.group_name}{r.pan ? ` · PAN ${r.pan}` : ''}</div></td>
                                        <td className="text-right">{drcr(r.opening)}</td>
                                        {cols.map(([k]) => <td key={k} className="text-right">{Math.abs(r[k]) < 0.005 ? '' : fmt(r[k])}</td>)}
                                        {showOthers && <><td className="text-right">{r.others_dr ? fmt(r.others_dr) : ''}</td><td className="text-right">{r.others_cr ? fmt(r.others_cr) : ''}</td></>}
                                        <td className="text-right font-semibold">{drcr(r.closing)}</td>
                                        {pdcOn && <><td className="text-right">{r.pdc_pending_received ? fmt(r.pdc_pending_received) : ''}</td><td className="text-right">{r.pdc_pending_issued ? fmt(r.pdc_pending_issued) : ''}</td><td className="text-right font-semibold">{drcr(r.closing_after_pdc)}</td></>}
                                    </tr>
                                ))}
                                {data.totals && (
                                    <tr className="font-semibold bg-slate-50">
                                        <td>Total ({data.rows.length})</td><td className="text-right">{drcr(data.totals.opening)}</td>
                                        {cols.map(([k]) => <td key={k} className="text-right">{fmt(data.totals[k])}</td>)}
                                        {showOthers && <><td className="text-right">{fmt(data.totals.others_dr)}</td><td className="text-right">{fmt(data.totals.others_cr)}</td></>}
                                        <td className="text-right">{drcr(data.totals.closing)}</td>
                                        {pdcOn && <><td className="text-right">{fmt(data.totals.pdc_pending_received)}</td><td className="text-right">{fmt(data.totals.pdc_pending_issued)}</td><td className="text-right">{drcr(data.totals.closing_after_pdc)}</td></>}
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        {data.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No parties for these filters.</p>}
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
