// =============================================
// LedgerReport.jsx
// Advanced (party) Ledger Report.
// The options panel on top is small and holds only how the report reads:
// dates, view (Detail / Summary / Monthly), sort, and ticks - Remarks,
// Product details, Billing terms product-wise / bill-wise, Doc. Agent,
// Ledger details (PAN, phone, address, agent), Page break per ledger,
// PDC balance, PDC separate (Summary only), LC / BG / PDC details, Pending
// bills, Group subtotals, Hide zero balance.
// Filters (which ledgers / entries) are behind "🔽 Filters": Ledger,
// Group (incl. sub-groups), Customer / Supplier Category (if enabled),
// Area, Agent (the party's master agent), Doc. Agent (the agent chosen on
// the transaction), Route, Product Company, Narration, Document type,
// balance side / minimum balance.
// After Show the panel folds to one line (⚙ Options / 🔽 Filters / 🔄 Reload).
// Every setting can be saved as a named view (SavedViewsBar).
// =============================================

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import SavedViewsBar from '../components/SavedViewsBar';
import Layout from '../components/Layout';
import { formatDateForDisplay } from '../utils/nepaliDateUtils';

// GL document_type -> Document Designer document type, for Print links.
const PRINT_TYPE = {
    sales_additional: 'sales_additional_entry', pdc: 'pdc_voucher', production: 'production_order',
    sales_nonsalable_return: 'sales_nonsaleable_return', purchase_nonsalable_return: 'purchase_nonsaleable_return'
};

const today = new Date().toISOString().slice(0, 10);
const DEFAULT_CONFIG = {
    date_from: `${today.slice(0, 4)}-01-01`, date_to: today,
    ledger_id: '', account_group_id: '', ledger_category_id: '', area_id: '', agent_id: '', doc_agent_id: '', route_id: '', product_company_id: '',
    models: [], document_types: [], narration: '',
    mode: 'detail', group_wise: true, sort_on: 'name',
    show_remarks: true, include_items: false, term_product: false, term_bill: false, show_doc_agent: false, show_ledger_details: false, page_break: false,
    show_pdc_balance: false, pdc_separate: false, include_lc_bg: false, include_bill_wise: false, hide_zero: true, balance_side: '', min_balance: ''
};
// the ticks of the options panel: [key, label, only in this view]
const OPTIONS = [
    ['show_remarks', 'Remarks / Narration'], ['include_items', 'Product Details', 'detail'], ['term_product', 'Billing Terms (product-wise)', 'detail'],
    ['term_bill', 'Billing Terms (bill-wise)', 'detail'], ['show_doc_agent', 'Doc. Agent', 'detail'], ['show_ledger_details', 'Ledger Details'],
    ['page_break', 'Page Break (each ledger)'], ['show_pdc_balance', 'Show PDC Balance'], ['pdc_separate', 'PDC Separate (Summary only)', 'summary'],
    ['include_lc_bg', 'LC / BG / PDC Details'], ['include_bill_wise', 'Pending Bills'], ['group_wise', 'Ledger Group Wise'], ['hide_zero', 'Hide Zero Balance']
];
const FILTER_KEYS = ['ledger_id', 'account_group_id', 'ledger_category_id', 'area_id', 'agent_id', 'doc_agent_id', 'route_id', 'product_company_id', 'narration', 'balance_side', 'min_balance'];

const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = n => `${fmt(Math.abs(n))} ${n >= 0 ? 'Dr' : 'Cr'}`;

export default function LedgerReport() {
    const { authFetch } = useAuth();
    // Drill-down: /ledger-report?ledger_id=..|account_group_id=..&date_from=..&date_to=..&mode=detail|summary
    // (opened from Financial Reports / Party Summary) pre-fills and runs once.
    const urlConfig = (() => {
        const q = new URLSearchParams(window.location.search);
        const keys = ['ledger_id', 'account_group_id', 'date_from', 'date_to', 'mode', 'product_company_id'];
        const picked = Object.fromEntries(keys.filter(k => q.get(k)).map(k => [k, q.get(k)]));
        return Object.keys(picked).length ? { ...DEFAULT_CONFIG, ...picked } : null;
    })();
    const [config, setConfig] = useState(urlConfig || DEFAULT_CONFIG);
    const [meta, setMeta] = useState({ models: [], document_types: [] });
    const [masters, setMasters] = useState({ ledgers: [], groups: [], categories: [], areas: [], agents: [], routes: [], companies: [] });
    const [categorySetting, setCategorySetting] = useState({ enabled: false, label: 'Ledger Category' });
    const [result, setResult] = useState(null);
    const [expanded, setExpanded] = useState({});
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);
    // the options panel folds to one line after Show; Filters open on request
    const [optionsOpen, setOptionsOpen] = useState(!urlConfig);
    const [filtersOpen, setFiltersOpen] = useState(false);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 5000); };
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    const loadMasters = useCallback(async () => {
        try {
            const [m, ldg, grp, cats, catSet, ar, ag, rt, pc] = await Promise.all([
                authFetch('/api/ledger-report/meta'),
                authFetch('/api/ledger-accounts?pageSize=2000'),
                authFetch('/api/account-groups'),
                authFetch('/api/ledger-categories'),
                authFetch('/api/company/ledger-category-setting'),
                authFetch('/api/areas'), authFetch('/api/salesman-agents'), authFetch('/api/routes'), authFetch('/api/product-companies')
            ]);
            setMeta({ models: m.data?.models || [], document_types: m.data?.document_types || [] });
            setMasters({ ledgers: ldg.data || [], groups: grp.data || [], categories: cats.data || [], areas: ar.data || [], agents: ag.data || [], routes: rt.data || [], companies: pc.data || [] });
            setCategorySetting(catSet.data || { enabled: false, label: 'Ledger Category' });
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { loadMasters(); }, [loadMasters]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (urlConfig) runReport(urlConfig); }, []);

    const runReport = async (cfg = config) => {
        setLoading(true);
        try {
            const p = new URLSearchParams();
            p.set('date_from', cfg.date_from); p.set('date_to', cfg.date_to); p.set('mode', cfg.mode);
            if (cfg.ledger_id) p.set('ledger_ids', cfg.ledger_id);
            ['account_group_id', 'area_id', 'agent_id', 'doc_agent_id', 'route_id', 'product_company_id', 'narration'].forEach(k => { if (cfg[k]) p.set(k, cfg[k]); });
            if (cfg.ledger_category_id && categorySetting.enabled) p.set('ledger_category_id', cfg.ledger_category_id);
            if (cfg.document_types.length) p.set('document_types', cfg.document_types.join(','));
            else if (cfg.models.length) p.set('models', cfg.models.join(','));
            ['include_items', 'include_lc_bg', 'include_bill_wise'].forEach(k => { if (cfg[k]) p.set(k, 'true'); });
            if (cfg.term_product || cfg.term_bill || cfg.include_terms) p.set('include_terms', 'true');
            if (cfg.show_pdc_balance || cfg.pdc_separate) p.set('pdc_separate', 'true');
            p.set('hide_zero', cfg.hide_zero ? 'true' : 'false');
            if (cfg.balance_side) p.set('balance_side', cfg.balance_side);
            if (Number(cfg.min_balance) > 0) p.set('min_balance', cfg.min_balance);
            const res = await authFetch(`/api/ledger-report?${p}`);
            setResult(res.data);
            // A single ledger opens expanded; many start collapsed.
            setExpanded(res.data.ledgers.length === 1 ? { [res.data.ledgers[0].ledger_id]: true } : {});
            if (res.data.ledgers.length === 0) showAlert('No ledger movement for these filters', 'info');
            else { setOptionsOpen(false); setFiltersOpen(false); }
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setLoading(false);
        }
    };

    const toggleInList = (key, value) => setConfig(c => ({ ...c, [key]: c[key].includes(value) ? c[key].filter(x => x !== value) : [...c[key], value] }));

    const exportCsv = () => {
        if (!result) return;
        const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [['Ledger', 'Group', 'Date', 'Document', 'Doc No', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance'].map(esc).join(',')];
        result.ledgers.forEach(l => {
            lines.push([l.account_name, l.group_name, '', 'Opening', '', '', '', '', '', l.opening].map(esc).join(','));
            (l.entries || []).forEach(e => lines.push([l.account_name, l.group_name, e.date, e.document_label, e.doc_no, e.particulars.join('; '), e.narration, e.debit, e.credit, e.balance].map(esc).join(',')));
            (l.monthly || []).forEach(m => lines.push([l.account_name, l.group_name, m.month, 'Month total', '', '', '', m.debit, m.credit, m.closing].map(esc).join(',')));
            lines.push([l.account_name, l.group_name, '', 'Closing', '', '', '', l.total_debit, l.total_credit, l.closing].map(esc).join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ledger-report_${config.date_from}_${config.date_to}.csv`;
        a.click();
    };

    const picker = (key, items, getLabel, label, listKey) => (
        <div className="erp-field">
            <label className="erp-label">{label}</label>
            <SearchablePopupSelect
                listKey={listKey}
                columns={[{ key: 'label', label: 'Name' }]} defaultVisibleKeys={['label']}
                items={items.map(i => ({ ...i, label: getLabel(i) }))} getId={i => i.id} getLabel={getLabel} searchKeys={['label']}
                value={config[key]} onChange={v => set(key, v)} placeholder="All"
            />
        </div>
    );

    const activeFilters = FILTER_KEYS.filter(k => config[k]).length + (config.document_types.length || config.models.length ? 1 : 0);
    const hasPdc = !!(result?.ledgers || []).some(l => l.pdc);
    // PDC Dr / Cr apart from other entries (Summary only); pending PDC and the balance after it
    const pdcSplit = hasPdc && !!config.pdc_separate && result?.mode === 'summary';
    const pdcBal = hasPdc && (!!config.show_pdc_balance || pdcSplit);
    const SORTERS = {
        name: (a, b) => String(a.account_name).localeCompare(String(b.account_name)),
        code: (a, b) => String(a.account_code || '').localeCompare(String(b.account_code || ''), undefined, { numeric: true }),
        short_name: (a, b) => String(a.short_name || a.account_name).localeCompare(String(b.short_name || b.account_name)),
        closing: (a, b) => (Number(b.closing) || 0) - (Number(a.closing) || 0)
    };
    const ledgers = [...(result?.ledgers || [])].sort(SORTERS[config.sort_on] || SORTERS.name);
    const ledgersByGroup = {};
    ledgers.forEach(l => { (ledgersByGroup[l.group_id || 'none'] = ledgersByGroup[l.group_id || 'none'] || []).push(l); });

    // columns that come and go with the ticks (Remarks, Doc. Agent)
    const extra = (config.show_remarks ? 1 : 0) + (config.show_doc_agent ? 1 : 0);
    // Billing Terms product-wise = line terms, bill-wise = document terms
    const termsOf = e => (e.terms || []).filter(t => (t.level === 'Line' ? config.term_product : config.term_bill));
    const ledgerDetails = l => {
        const d = l.details || {};
        return [d.pan && `PAN ${d.pan}`, d.phone && `☎ ${d.phone}`, d.address, d.agent && `Agent: ${d.agent}`, d.credit_days ? `Credit ${d.credit_days} days` : null].filter(Boolean).join(' · ');
    };

    const renderLedger = (l) => {
        const isOpen = !!expanded[l.ledger_id];
        const over = l.credit_limit_used_percent !== null && l.credit_limit_used_percent >= 100;
        return (
            <div key={l.ledger_id} className={`border rounded-lg mb-2 ${config.page_break ? 'lr-page-break' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 cursor-pointer" onClick={() => setExpanded(e => ({ ...e, [l.ledger_id]: !isOpen }))}>
                    <span className="font-semibold text-sm">{result.mode !== 'summary' ? (isOpen ? '▾ ' : '▸ ') : ''}{l.account_name} <span className="text-xs text-gray-400">{l.account_code}</span></span>
                    <span className="text-xs flex flex-wrap gap-3">
                        <span>Opening: <b>{drcr(l.opening)}</b></span>
                        <span>Dr: <b>{fmt(l.total_debit)}</b></span>
                        <span>Cr: <b>{fmt(l.total_credit)}</b></span>
                        <span>Closing: <b>{drcr(l.closing)}</b></span>
                        {config.show_pdc_balance && l.pdc && (l.pdc.pending_received > 0 || l.pdc.pending_issued > 0) && <span className="text-purple-700">Pending PDC: Recd {fmt(l.pdc.pending_received)} · Issued {fmt(l.pdc.pending_issued)} → after PDC <b>{drcr(l.pdc.closing_after_pending)}</b></span>}
                        {l.credit_limit_used_percent !== null && <span className={over ? 'text-red-600 font-semibold' : 'text-gray-500'}>Credit limit used: {l.credit_limit_used_percent}%</span>}
                    </span>
                </div>
                {config.show_ledger_details && ledgerDetails(l) && <div className="px-3 py-1 text-[11px] text-gray-600 border-t bg-white">{ledgerDetails(l)}</div>}

                {isOpen && result.mode === 'detail' && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead><tr><th>Date</th><th>Document</th><th>Doc No</th><th>Particulars</th>{config.show_remarks && <th>Remarks / Narration</th>}{config.show_doc_agent && <th>Doc. Agent</th>}<th>Debit</th><th>Credit</th><th>Balance</th><th></th></tr></thead>
                            <tbody>
                                <tr className="bg-amber-50"><td colSpan={extra + 6} className="font-semibold">Opening Balance</td><td className="font-semibold">{drcr(l.opening)}</td><td></td></tr>
                                {l.entries.map((e, i) => (
                                    <React.Fragment key={i}>
                                        <tr>
                                            <td>{formatDateForDisplay(e.date, 'dual')}</td>
                                            <td className="text-xs">{e.document_label}</td>
                                            <td>{e.doc_no || '—'}</td>
                                            <td>{e.particulars.length > 1 ? <span title={e.particulars.join(', ')}>{e.particulars[0]} <span className="text-xs text-gray-400">+{e.particulars.length - 1} more</span></span> : (e.particulars[0] || '—')}</td>
                                            {config.show_remarks && <td className="text-xs text-gray-500">{[e.remarks, e.narration].filter((x, j, a) => x && a.indexOf(x) === j).join(' · ')}</td>}
                                            {config.show_doc_agent && <td className="text-xs">{e.doc_agent || ''}</td>}
                                            <td>{e.debit ? fmt(e.debit) : ''}</td>
                                            <td>{e.credit ? fmt(e.credit) : ''}</td>
                                            <td>{drcr(e.balance)}</td>
                                            <td><a href={`/print/${PRINT_TYPE[e.document_type] || e.document_type}/${e.document_id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600" onClick={ev => ev.stopPropagation()}>🖨️</a></td>
                                        </tr>
                                        {config.include_items && e.items && e.items.length > 0 && (
                                            <tr><td></td><td colSpan={extra + 7} className="p-0">
                                                <table className="w-full text-xs bg-blue-50/40">
                                                    <thead><tr className="text-gray-500"><th className="text-left px-2">Item</th><th className="text-left px-2">Batch</th><th className="text-right px-2">Qty</th><th className="text-right px-2">Free</th><th className="text-right px-2">Rate</th><th className="text-right px-2">Disc %</th><th className="text-right px-2">Disc Amt</th><th className="text-right px-2">Amount</th></tr></thead>
                                                    <tbody>{e.items.map((it, j) => (
                                                        <tr key={j}><td className="px-2">{it.product_name}</td><td className="px-2">{it.batch_no || '—'}</td>
                                                            <td className="text-right px-2">{it.qty} {it.uom || ''}{it.alt_qty ? ` + ${it.alt_qty}` : ''}</td><td className="text-right px-2">{it.free_qty || '—'}</td>
                                                            <td className="text-right px-2">{fmt(it.rate)}</td><td className="text-right px-2">{it.discount_percent ?? '—'}</td>
                                                            <td className="text-right px-2">{it.discount_amount !== null ? fmt(it.discount_amount) : '—'}</td><td className="text-right px-2">{fmt(it.amount)}</td></tr>
                                                    ))}</tbody>
                                                </table>
                                            </td></tr>
                                        )}
                                        {termsOf(e).length > 0 && (
                                            <tr><td></td><td colSpan={extra + 7} className="p-0">
                                                <table className="w-full text-xs bg-purple-50/40">
                                                    <thead><tr className="text-gray-500"><th className="text-left px-2">Billing Term</th><th className="text-left px-2">Level</th><th className="text-right px-2">%</th><th className="text-right px-2">Amount</th></tr></thead>
                                                    <tbody>{termsOf(e).map((t, j) => (
                                                        <tr key={j}><td className="px-2">{t.term_name} <span className="text-gray-400">{t.term_code}</span></td><td className="px-2">{t.level}</td>
                                                            <td className="text-right px-2">{t.rate_percent !== null ? t.rate_percent : '—'}</td><td className="text-right px-2">{fmt(t.amount)}</td></tr>
                                                    ))}</tbody>
                                                </table>
                                            </td></tr>
                                        )}
                                    </React.Fragment>
                                ))}
                                <tr className="bg-slate-50 font-semibold"><td colSpan={extra + 4}>Closing Balance</td><td>{fmt(l.total_debit)}</td><td>{fmt(l.total_credit)}</td><td>{drcr(l.closing)}</td><td></td></tr>
                            </tbody>
                        </table>
                    </div>
                )}

                {isOpen && result.mode === 'monthly' && (
                    <table className="erp-grid-table">
                        <thead><tr><th>Month</th><th>Debit</th><th>Credit</th><th>Closing</th></tr></thead>
                        <tbody>
                            <tr className="bg-amber-50"><td>Opening</td><td></td><td></td><td>{drcr(l.opening)}</td></tr>
                            {(l.monthly || []).map(m => <tr key={m.month}><td>{m.month}</td><td>{fmt(m.debit)}</td><td>{fmt(m.credit)}</td><td>{drcr(m.closing)}</td></tr>)}
                        </tbody>
                    </table>
                )}

                {isOpen && l.lc_bg && (l.lc_bg.lcs.length > 0 || l.lc_bg.bg || l.lc_bg.legacy_lc || (l.lc_bg.bgs || []).length > 0 || (l.lc_bg.pdcs || []).length > 0) && (
                    <div className="px-3 py-2 text-xs border-t">
                        <p className="font-semibold text-gray-500 mb-1">LC / BG / PDC</p>
                        {l.lc_bg.lcs.map((lc, i) => (
                            <p key={i} className={lc.is_expired ? 'text-red-600' : ''}>LC {lc.lc_number} ({lc.bank || '—'}) — Amount {fmt(lc.amount)}, Used {fmt(lc.utilized)}, <b>Remaining {fmt(lc.remaining)}</b>, Expiry {lc.expiry_date || '—'} [{lc.status}{lc.is_expired ? ', expired' : ''}]</p>
                        ))}
                        {l.lc_bg.lcs.length === 0 && l.lc_bg.legacy_lc && <p>LC {l.lc_bg.legacy_lc.lc_number} ({l.lc_bg.legacy_lc.bank || '—'}) — {fmt(l.lc_bg.legacy_lc.amount)}, Expiry {l.lc_bg.legacy_lc.expiry_date || '—'}</p>}
                        {(l.lc_bg.bgs || []).map((b, i) => (
                            <p key={`bg${i}`} className={b.is_expired && b.status === 'open' ? 'text-red-600' : ''}>BG {b.bg_number} ({b.direction === 'issued' ? 'issued for us' : 'received'} · {b.bg_type.replace('_', ' ')}, {b.bank || '—'}) — {fmt(b.amount)}, Expiry {b.expiry_date || '—'} [{b.status}{b.is_expired && b.status === 'open' ? ', expired' : ''}]</p>
                        ))}
                        {(l.lc_bg.pdcs || []).map((x, i) => (
                            <p key={`pdc${i}`} className={x.matured ? 'text-orange-700' : x.status === 'pending' ? '' : 'text-gray-400'}>PDC {x.doc_no} {x.voucher_type} · chq {x.cheque_no} {x.bank || ''} dated {x.cheque_date} — {fmt(x.amount)} [{x.status}{x.matured ? ', matured' : ''}]</p>
                        ))}
                        {!(l.lc_bg.bgs || []).length && l.lc_bg.bg && <p className={l.lc_bg.bg.is_expired ? 'text-red-600' : ''}>BG {l.lc_bg.bg.bg_number} ({l.lc_bg.bg.bank || '—'}) — {fmt(l.lc_bg.bg.amount)}, Expiry {l.lc_bg.bg.expiry_date || '—'}{l.lc_bg.bg.is_expired ? ' (expired)' : ''}</p>}
                    </div>
                )}

                {isOpen && l.pending_bills && l.pending_bills.length > 0 && (
                    <div className="px-3 py-2 text-xs border-t">
                        <p className="font-semibold text-gray-500 mb-1">Pending Bills (bill-wise)</p>
                        <table className="w-full">
                            <thead><tr className="text-gray-500"><th className="text-left">Doc No</th><th className="text-left">Date</th><th className="text-right">Days</th><th className="text-right">Total</th><th className="text-right">Pending</th><th className="text-left pl-2">Dr/Cr</th></tr></thead>
                            <tbody>{l.pending_bills.map((b, i) => (
                                <tr key={i}><td>{b.doc_no}</td><td>{b.date}</td><td className="text-right">{b.days ?? '—'}</td><td className="text-right">{fmt(b.total_amount)}</td><td className="text-right font-semibold">{fmt(b.remaining_amount)}</td><td className="pl-2 uppercase">{b.nature}</td></tr>
                            ))}</tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header">
                <span className="erp-header-title">📒 Ledger Report</span>
                {result && <div className="erp-header-actions"><button type="button" onClick={exportCsv} className="erp-header-btn">⬇️ Export CSV</button></div>}
            </div>
            {alert && <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm border-l-4 ${alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 'bg-yellow-50 border-yellow-500 text-yellow-800'}`}>{alert.message}</div>}

            <div className="erp-tab-content">
                <SavedViewsBar
                    reportKey="ledger_report"
                    getConfig={() => config}
                    onApply={cfg => { const merged = { ...DEFAULT_CONFIG, ...cfg }; setConfig(merged); runReport(merged); }}
                    onReset={() => { setConfig(DEFAULT_CONFIG); setResult(null); }}
                />

                {optionsOpen || !result ? (
                    <div className="lr-options border rounded p-2 mb-2 bg-slate-50/60 no-print">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                            <div className="erp-field"><label className="erp-label">Date From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">Date To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                            <div className="erp-field">
                                <label className="erp-label">View Mode</label>
                                <select className="erp-select" value={config.mode} onChange={e => set('mode', e.target.value)}>
                                    <option value="detail">Detail (every entry)</option>
                                    <option value="summary">Summary (per ledger)</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </div>
                            <div className="erp-field">
                                <label className="erp-label">Sort On</label>
                                <select className="erp-select" value={config.sort_on} onChange={e => set('sort_on', e.target.value)}>
                                    <option value="name">Ledger Name</option>
                                    <option value="code">Ledger Code</option>
                                    <option value="short_name">Short Name</option>
                                    <option value="closing">Closing Balance</option>
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-0.5 mt-2 text-[13px]">
                            {OPTIONS.map(([k, label, only]) => {
                                const off = !!only && only !== config.mode;
                                return (
                                    <label key={k} className={`flex items-center gap-1.5 ${off ? 'text-gray-400' : ''}`} title={off ? `Only in ${only} view` : ''}>
                                        <input type="checkbox" checked={!!config[k]} disabled={off} onChange={e => set(k, e.target.checked)} /> {label}
                                    </label>
                                );
                            })}
                        </div>

                        <div className="mt-2 border-t pt-1.5">
                            <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => setFiltersOpen(o => !o)}>
                                {filtersOpen ? '▾' : '▸'} 🔽 Filters{activeFilters ? ` (${activeFilters} on)` : ''}
                            </button>
                            {filtersOpen && (
                                <div data-no-fold className="mt-1.5">
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                        {picker('ledger_id', masters.ledgers, i => i.account_name, 'Ledger', 'lr_ledger')}
                                        {picker('account_group_id', masters.groups, i => i.group_name, 'Group (incl. sub-groups)', 'lr_group')}
                                        {categorySetting.enabled && picker('ledger_category_id', masters.categories, i => i.category_name, categorySetting.label || 'Ledger Category', 'lr_category')}
                                        {picker('area_id', masters.areas, i => i.area_name, 'Area', 'lr_area')}
                                        {picker('agent_id', masters.agents, i => i.agent_name, 'Agent (ledger master)', 'lr_agent')}
                                        {picker('doc_agent_id', masters.agents, i => i.agent_name, 'Doc. Agent (on the transaction)', 'lr_doc_agent')}
                                        {picker('route_id', masters.routes, i => i.route_name, 'Route', 'lr_route')}
                                        {picker('product_company_id', masters.companies, i => i.company_name, 'Product Company', 'lr_company')}
                                        <div className="erp-field"><label className="erp-label">Narration contains</label><input className="erp-input" value={config.narration} onChange={e => set('narration', e.target.value)} /></div>
                                        <div className="erp-field">
                                            <label className="erp-label">Closing balance</label>
                                            <select className="erp-select" value={config.balance_side || ''} onChange={e => set('balance_side', e.target.value)}>
                                                <option value="">Any balance</option>
                                                <option value="dr">Debit only (receivable)</option>
                                                <option value="cr">Credit only (payable)</option>
                                            </select>
                                        </div>
                                        <div className="erp-field"><label className="erp-label">Min balance</label><input type="number" className="erp-input" value={config.min_balance || ''} onChange={e => set('min_balance', e.target.value)} placeholder="0" /></div>
                                    </div>
                                    <div className="mt-2">
                                        <p className="text-[11px] font-semibold text-gray-500 uppercase">Document Type <span className="normal-case font-normal text-gray-400">(none ticked = all)</span></p>
                                        <div className="flex flex-wrap gap-3">
                                            {meta.models.map(m => (
                                                <label key={m.key} className="flex items-center gap-1 text-sm font-medium"><input type="checkbox" checked={config.models.includes(m.key)} onChange={() => toggleInList('models', m.key)} /> {m.label}</label>
                                            ))}
                                        </div>
                                        <div className="flex flex-wrap gap-x-3">
                                            {meta.document_types.filter(d => config.models.length === 0 || config.models.includes(d.model)).map(d => (
                                                <label key={d.key} className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={config.document_types.includes(d.key)} onChange={() => toggleInList('document_types', d.key)} /> {d.label}</label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 mt-2">
                            <button type="button" onClick={() => runReport()} disabled={loading} className="erp-btn primary">{loading ? 'Loading…' : '🔍 Show Report'}</button>
                            {result && <button type="button" className="erp-btn" onClick={() => { setOptionsOpen(false); setFiltersOpen(false); }}>✕ Hide options</button>}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2 mb-2 text-xs border rounded px-2 py-1 bg-slate-50 no-print">
                        <span className="font-semibold">{config.date_from} → {config.date_to}</span>
                        <span className="text-gray-500">· {({ detail: 'Detail', summary: 'Summary', monthly: 'Monthly' })[config.mode]}{activeFilters ? ` · ${activeFilters} filter(s)` : ''}</span>
                        <span className="flex-1" />
                        <button type="button" className="erp-btn" onClick={() => setOptionsOpen(true)}>⚙ Options</button>
                        <button type="button" className="erp-btn" onClick={() => { setOptionsOpen(true); setFiltersOpen(true); }}>🔽 Filters</button>
                        <button type="button" className="erp-btn primary" disabled={loading} onClick={() => runReport()}>{loading ? 'Loading…' : '🔄 Reload'}</button>
                    </div>
                )}

                {result && result.ledgers.length > 0 && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                            <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">Opening</p><p className="font-semibold">{drcr(result.totals.opening)}</p></div>
                            <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">Total Debit</p><p className="font-semibold">{fmt(result.totals.total_debit)}</p></div>
                            <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">Total Credit</p><p className="font-semibold">{fmt(result.totals.total_credit)}</p></div>
                            <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">Closing ({result.ledgers.length} ledgers)</p><p className="font-semibold">{drcr(result.totals.closing)}</p></div>
                        </div>

                        {result.mode === 'summary' ? (
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead><tr><th>Ledger</th><th>Group</th><th>Opening</th>{pdcSplit ? <><th>Debit (excl. PDC)</th><th>Credit (excl. PDC)</th><th>PDC Dr</th><th>PDC Cr</th></> : <><th>Debit</th><th>Credit</th></>}<th>Closing</th>{pdcBal && <><th>Pending PDC Recd.</th><th>Pending PDC Issued</th><th>Closing after PDC</th></>}<th>Credit Limit Used</th></tr></thead>
                                    <tbody>
                                        {(config.group_wise ? result.groups : [{ group_id: '__all', group_name: null }]).map(g => (
                                            <React.Fragment key={g.group_id || 'none'}>
                                                {config.group_wise && <tr className="bg-slate-100 font-semibold"><td colSpan={2}>{g.group_name} ({g.ledger_count})</td><td>{drcr(g.opening)}</td><td>{fmt(g.total_debit)}</td><td>{fmt(g.total_credit)}</td>{pdcSplit && <><td></td><td></td></>}<td>{drcr(g.closing)}</td>{pdcBal && <><td></td><td></td><td></td></>}<td></td></tr>}
                                                {(config.group_wise ? (ledgersByGroup[g.group_id || 'none'] || []) : ledgers).map(l => (
                                                    <tr key={l.ledger_id}>
                                                        <td>{l.account_name}{config.show_ledger_details && ledgerDetails(l) && <div className="text-[11px] text-gray-500">{ledgerDetails(l)}</div>}</td><td className="text-xs text-gray-500">{l.group_name}</td>
                                                        <td>{drcr(l.opening)}</td>
                                                        {pdcSplit && l.pdc ? <><td>{fmt(l.pdc.debit_excl_pdc)}</td><td>{fmt(l.pdc.credit_excl_pdc)}</td><td>{l.pdc.posted_debit ? fmt(l.pdc.posted_debit) : ''}</td><td>{l.pdc.posted_credit ? fmt(l.pdc.posted_credit) : ''}</td></> : pdcSplit ? <><td>{fmt(l.total_debit)}</td><td>{fmt(l.total_credit)}</td><td></td><td></td></> : <><td>{fmt(l.total_debit)}</td><td>{fmt(l.total_credit)}</td></>}
                                                        <td>{drcr(l.closing)}</td>
                                                        {pdcBal && (l.pdc ? <><td>{l.pdc.pending_received ? fmt(l.pdc.pending_received) : ''}</td><td>{l.pdc.pending_issued ? fmt(l.pdc.pending_issued) : ''}</td><td className="font-semibold">{drcr(l.pdc.closing_after_pending)}</td></> : <><td></td><td></td><td>{drcr(l.closing)}</td></>)}
                                                        <td className={l.credit_limit_used_percent >= 100 ? 'text-red-600 font-semibold' : ''}>{l.credit_limit_used_percent !== null ? `${l.credit_limit_used_percent}%` : '—'}</td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : config.group_wise ? (
                            result.groups.map(g => (
                                <div key={g.group_id || 'none'} className="mb-4">
                                    <div className="flex justify-between text-sm font-semibold bg-slate-100 rounded px-3 py-1.5 mb-2">
                                        <span>{g.group_name} ({g.ledger_count})</span>
                                        <span>Dr {fmt(g.total_debit)} · Cr {fmt(g.total_credit)} · Closing {drcr(g.closing)}</span>
                                    </div>
                                    {(ledgersByGroup[g.group_id || 'none'] || []).map(renderLedger)}
                                </div>
                            ))
                        ) : ledgers.map(renderLedger)}
                    </>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
