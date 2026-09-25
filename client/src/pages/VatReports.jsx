// =============================================
// VatReports.jsx
// Nepal VAT reporting suite, all driven by /api/vat-reports/*:
//   Register (bill / party / item / month / summary, with or without
//   items), Monthly Summary (bill counts, output/input/net VAT),
//   Above Threshold (monthly upload list / Annex 13 fiscal-year list),
//   VAT Return figures, all-in-one VAT Ledger, TDS, and VAT Months setup.
// Every tab: Save As (named views) + Excel-ready CSV export in English
// or Nepali (Devanagari headers, BS dates where the VAT month is set).
// =============================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import SavedViewsBar from '../components/SavedViewsBar';

const TABS = [
    ['register', 'Register'], ['monthly', 'Monthly Summary'], ['threshold', 'Above Threshold / Annex 13'],
    ['vat_return', 'VAT Return'], ['vat_ledger', 'VAT Ledger'], ['tds', 'TDS'], ['periods', 'VAT Months Setup']
];
const VIEWS = [['bill', 'Bill-wise'], ['party', 'Customer / Supplier-wise'], ['item', 'Item-wise'], ['month', 'Month-wise'], ['summary', 'Summary']];

// Column definitions: key, English header, Nepali header, numeric?
const COLS = {
    doc_date: ['Date (AD)', 'मिति (ई.सं.)'], bs_date: ['Date (BS)', 'मिति (वि.सं.)'], doc_label: ['Type', 'किसिम'], doc_no: ['Bill No', 'बिल नं.'],
    party_bill_no: ['Party Bill No', 'पार्टी बिल नं.'], party_name: ['Name', 'नाम'], party_pan: ['PAN / VAT No', 'स्थायी लेखा नं.'],
    label: ['Group', 'समूह'], label_np: ['Month', 'महिना'], count: ['No. of Bills', 'बिल संख्या'], bill_count: ['No. of Bills', 'बिल संख्या'],
    product_name: ['Item / Ledger', 'वस्तु / खाता'], qty: ['Qty', 'परिमाण'], uom: ['Unit', 'एकाइ'], rate: ['Rate', 'दर'], discount: ['Discount', 'छुट'],
    taxable: ['Taxable Amount', 'करयोग्य रकम'], exempt: ['Exempt Amount', 'कर छुट रकम'], vat: ['VAT', 'मू.अ.क.'], total: ['Total', 'जम्मा'],
    import_taxable: ['Import (Taxable)', 'पैठारी (करयोग्य)'], amount: ['Amount', 'रकम'], basis_amount: ['Amount (Basis)', 'कारोबार रकम'], side: ['Side', 'पक्ष'],
    vat_out: ['VAT Out (Sales)', 'बिक्री मू.अ.क.'], vat_in: ['VAT In (Purchase)', 'खरिद मू.अ.क.'], running_payable: ['Running Payable', 'तिर्नुपर्ने (क्रमिक)'],
    vat_accounts: ['VAT Account', 'मू.अ.क. खाता'], base_amount: ['Base Amount', 'आधार रकम'], tds_percent: ['TDS %', 'अग्रिम कर %'], tds_amount: ['TDS Amount', 'अग्रिम कर रकम']
};
const NUMERIC = new Set(['count', 'bill_count', 'qty', 'rate', 'discount', 'taxable', 'exempt', 'vat', 'total', 'import_taxable', 'amount', 'basis_amount', 'vat_out', 'vat_in', 'running_payable', 'base_amount', 'tds_percent', 'tds_amount']);
const LABEL_NP = { Sales: 'बिक्री', 'Sales Return': 'बिक्री फिर्ता', 'Credit Note': 'क्रेडिट नोट', Purchase: 'खरिद', 'Purchase Return': 'खरिद फिर्ता', 'Debit Note': 'डेबिट नोट', sales: 'बिक्री', purchase: 'खरिद' };

const defaultConfig = () => ({
    doc_types: ['sales'], view: 'bill', include_items: false, date_from: '', date_to: '', party_ledger_id: '',
    min_amount: '', max_amount: '', pan: '', vat: '', invoice_type: '', product_name: '',
    threshold: 100000, basis: 'excl_vat', side: '', carry_forward_credit: '', opening: '', include_exempt: false, vat_ledger_id: ''
});

export default function VatReports() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'register'); // ?tab= deep link from the Report Center
    const [meta, setMeta] = useState({ doc_types: [], periods: [], fiscal_years: [], bs_months: [] });
    const [parties, setParties] = useState([]);
    const [config, setConfig] = useState(defaultConfig());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState(null);
    const [lang, setLang] = useState('en');
    const [periodFy, setPeriodFy] = useState('');
    const [periodStarts, setPeriodStarts] = useState(Array(12).fill(''));

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 7000); };
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    const loadMeta = useCallback(async () => {
        try {
            const [m, l] = await Promise.all([authFetch('/api/vat-reports/meta'), authFetch('/api/ledger-accounts?pageSize=500')]);
            setMeta(m.data);
            setParties(l.data || []);
            const current = (m.data.fiscal_years || []).find(y => y.is_current) || (m.data.fiscal_years || [])[0];
            if (current) setPeriodFy(current.id);
        } catch (err) { showAlert(err.message, 'danger'); }
    }, [authFetch]);
    useEffect(() => { loadMeta(); }, [loadMeta]);

    // Load saved month starts when the setup tab's fiscal year changes.
    useEffect(() => {
        const fy = meta.fiscal_years.find(y => y.id === periodFy);
        if (!fy) return;
        const existing = meta.periods.filter(p => p.fiscal_year_id === periodFy).sort((a, b) => a.period_no - b.period_no);
        setPeriodStarts(existing.length === 12 ? existing.map(p => p.start_date) : [fy.start_date_eng, ...Array(11).fill('')]);
    }, [periodFy, meta]);

    const quickPeriods = useMemo(() => [...meta.periods].sort((a, b) => a.start_date.localeCompare(b.start_date)), [meta.periods]);

    const run = async (cfg = config) => {
        if (tab === 'periods') return;
        setLoading(true); setData(null);
        try {
            const p = new URLSearchParams();
            const put = (k, v) => { if (v !== '' && v !== null && v !== undefined && v !== false) p.set(k, v); };
            ['date_from', 'date_to', 'party_ledger_id', 'min_amount', 'max_amount', 'pan', 'vat', 'invoice_type'].forEach(k => put(k, cfg[k]));
            let url;
            if (tab === 'register') { put('doc_types', cfg.doc_types.join(',')); put('view', cfg.view); put('include_items', cfg.include_items ? 'true' : ''); put('product_name', cfg.product_name); url = '/api/vat-reports/register'; }
            else if (tab === 'monthly') url = '/api/vat-reports/monthly-summary';
            else if (tab === 'threshold') { put('threshold', cfg.threshold); put('basis', cfg.basis); put('side', cfg.side); url = '/api/vat-reports/above-threshold'; }
            else if (tab === 'vat_return') { put('carry_forward_credit', cfg.carry_forward_credit); url = '/api/vat-reports/vat-return'; }
            else if (tab === 'vat_ledger') { put('opening', cfg.opening); put('include_exempt', cfg.include_exempt ? 'true' : ''); put('vat_ledger_id', cfg.vat_ledger_id); url = '/api/vat-reports/vat-ledger'; }
            else if (tab === 'tds') url = '/api/vat-reports/tds';
            const res = await authFetch(`${url}?${p}`);
            setData(res.data);
        } catch (err) { showAlert(err.message, 'danger'); }
        finally { setLoading(false); }
    };

    const fillFromCalendar = async () => {
        try {
            const res = await authFetch(`/api/vat-reports/periods/suggest/${periodFy}`);
            setPeriodStarts(res.data.start_dates);
            showAlert(res.data.warning || `Filled from the calendar for BS ${res.data.bs_year} - review, then Save.`, res.data.warning ? 'danger' : 'success');
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    const savePeriods = async () => {
        try {
            const res = await authFetch(`/api/vat-reports/periods/${periodFy}`, { method: 'PUT', body: JSON.stringify({ start_dates: periodStarts }) });
            showAlert(res.message || 'Saved', 'success');
            loadMeta();
        } catch (err) { showAlert(err.message, 'danger'); }
    };

    // ----- Table columns per tab/view -----
    const columns = useMemo(() => {
        if (!data) return [];
        if (tab === 'register') {
            if (data.view === 'bill') return ['doc_date', 'bs_date', 'doc_label', 'doc_no', 'party_bill_no', 'party_name', 'party_pan', 'taxable', 'exempt', 'vat', 'total', ...(config.doc_types.includes('purchase') ? ['import_taxable'] : [])];
            if (data.view === 'item') return ['doc_date', 'bs_date', 'doc_label', 'doc_no', 'party_name', 'party_pan', 'product_name', 'qty', 'uom', 'rate', 'discount', 'taxable', 'exempt', 'vat', 'amount'];
            if (data.view === 'party') return ['doc_label', 'label', 'party_pan', 'count', 'taxable', 'exempt', 'vat', 'total'];
            if (data.view === 'month') return ['label', 'doc_label', 'count', 'taxable', 'exempt', 'vat', 'total'];
            return ['label', 'count', 'taxable', 'exempt', 'vat', 'total', 'import_taxable'];
        }
        if (tab === 'threshold') return ['side', 'party_name', 'party_pan', 'bill_count', 'taxable', 'exempt', 'vat', 'total', 'basis_amount'];
        if (tab === 'vat_ledger') return ['doc_date', 'bs_date', 'doc_label', 'doc_no', 'party_bill_no', 'party_name', 'party_pan', 'vat_accounts', 'taxable', 'exempt', 'vat_out', 'vat_in', 'running_payable'];
        if (tab === 'tds') return ['doc_date', 'doc_no', 'party_name', 'party_pan', 'base_amount', 'tds_percent', 'tds_amount'];
        return [];
    }, [data, tab, config.doc_types]);

    const cellValue = (row, key, forLang) => {
        const v = row[key];
        if (key === 'doc_label' || key === 'side') return forLang === 'np' ? (LABEL_NP[v] || v) : v;
        if (key === 'label' && tab === 'register' && data?.view === 'month' && forLang === 'np') return row.label_np || v;
        if (v === null || v === undefined) return '';
        if (NUMERIC.has(key)) return Number(v).toFixed(key === 'qty' ? 2 : key === 'tds_percent' ? 2 : 2);
        return v;
    };

    // ----- CSV export (UTF-8 BOM so Excel shows Devanagari) -----
    const exportCsv = (forLang) => {
        let headers, body;
        if (tab === 'monthly' && data) {
            const types = data.doc_types;
            headers = [forLang === 'np' ? 'महिना' : 'Month', ...types.flatMap(t => [`${forLang === 'np' ? t.label_np : t.label} - ${forLang === 'np' ? 'बिल संख्या' : 'Bills'}`, `${forLang === 'np' ? t.label_np : t.label} - ${forLang === 'np' ? 'जम्मा' : 'Total'}`, `${forLang === 'np' ? t.label_np : t.label} - ${forLang === 'np' ? 'मू.अ.क.' : 'VAT'}`]),
                forLang === 'np' ? 'बिक्री मू.अ.क.' : 'Output VAT', forLang === 'np' ? 'खरिद मू.अ.क.' : 'Input VAT', forLang === 'np' ? 'खुद मू.अ.क.' : 'Net VAT'];
            body = data.rows.map(r => [forLang === 'np' ? r.label_np : r.label, ...types.flatMap(t => [r.types[t.key]?.count || 0, (r.types[t.key]?.total || 0).toFixed(2), (r.types[t.key]?.vat || 0).toFixed(2)]), r.output_vat.toFixed(2), r.input_vat.toFixed(2), r.net_vat.toFixed(2)]);
        } else if (tab === 'vat_return' && data) {
            body = vatReturnRows(data).map(([en, np, v]) => [forLang === 'np' ? np : en, v === null ? '' : Number(v).toFixed(2)]);
            headers = [forLang === 'np' ? 'विवरण' : 'Particulars', forLang === 'np' ? 'रकम' : 'Amount'];
        } else {
            const withSn = tab === 'threshold';
            headers = [...(withSn ? [forLang === 'np' ? 'क्र.सं.' : 'S.N.'] : []), ...columns.map(k => COLS[k][forLang === 'np' ? 1 : 0])];
            body = (data?.rows || []).map((r, i) => [...(withSn ? [i + 1] : []), ...columns.map(k => cellValue(r, k, forLang))]);
        }
        const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        // Digits stay 0-9 even in the Nepali file: PAN, bill numbers and
        // amounts in Devanagari digits are rejected by upload templates.
        const out = body;
        const csv = '\uFEFF' + [headers, ...out].map(r => r.map(esc).join(',')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `vat_${tab}${tab === 'register' ? '_' + data?.view : ''}_${config.date_from || 'all'}_${config.date_to || 'all'}_${forLang}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const partyPicker = (
        <SearchablePopupSelect listKey="vat_party_picker" columns={[{ key: 'account_name', label: 'Name' }, { key: 'pan_number', label: 'PAN' }]} defaultVisibleKeys={['account_name']}
            items={parties} getId={p => p.id} getLabel={p => p.account_name} searchKeys={['account_name', 'pan_number']}
            value={config.party_ledger_id} onChange={v => set('party_ledger_id', v)} placeholder="All Customers / Suppliers" />
    );

    const rows = data?.rows || [];
    const fmt = n => Number(n || 0).toFixed(2);

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">🧾 VAT & Tax Reports</span></div>
            {alert && <div className={`mx-4 mt-3 px-4 py-3 rounded-lg text-sm border-l-4 ${alert.type === 'success' ? 'bg-green-50 border-green-500' : alert.type === 'danger' ? 'bg-red-50 border-red-500' : 'bg-yellow-50 border-yellow-500'}`}>{alert.message}</div>}

            <div className="flex flex-wrap gap-1 px-4 pt-3 border-b">
                {TABS.map(([k, l]) => <button key={k} onClick={() => { setTab(k); setData(null); }} className={`px-3 py-2 text-sm border-b-2 ${tab === k ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-500'}`}>{l}</button>)}
            </div>

            <div className="erp-tab-content">
                {meta.periods.length === 0 && tab !== 'periods' && (
                    <div className="mb-3 px-3 py-2 rounded bg-amber-50 border-l-4 border-amber-500 text-xs text-amber-900">
                        VAT months (Shrawan–Ashadh) are not set yet, so month-wise figures use English calendar months and BS dates are left blank. Set them once per fiscal year in <b>VAT Months Setup</b>.
                    </div>
                )}

                {tab === 'periods' ? (
                    <div className="max-w-2xl">
                        <p className="text-sm text-gray-600 mb-3">Enter the English (AD) date on which each Nepali month starts, from the official calendar. Month end dates are worked out automatically. This makes month-wise VAT figures and BS dates exact.</p>
                        <div className="erp-field mb-3 max-w-xs">
                            <label className="erp-label">Fiscal Year</label>
                            <select className="erp-select" value={periodFy} onChange={e => setPeriodFy(e.target.value)}>
                                {meta.fiscal_years.map(y => <option key={y.id} value={y.id}>{y.fiscal_year_nepali || y.fiscal_year_name} ({y.start_date_eng} → {y.end_date_eng})</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {meta.bs_months.map(([en, np], i) => (
                                <div key={en} className="erp-field">
                                    <label className="erp-label">{i + 1}. {en} ({np}) starts</label>
                                    <input type="date" className="erp-input" value={periodStarts[i] || ''} disabled={i === 0} onChange={e => setPeriodStarts(s => s.map((v, j) => j === i ? e.target.value : v))} />
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-2">Shrawan always starts on the fiscal year start date. Each month must be 29–32 days long; the system checks this before saving.</p>
                        <div className="flex gap-2 mt-3">
                            <button onClick={fillFromCalendar} className="erp-btn" disabled={!meta.bs_calendar?.accurate}
                                title={meta.bs_calendar?.accurate ? 'Fill all 12 dates from the Nepali calendar' : 'Nepali calendar package not installed on the server'}>📅 Fill from Nepali calendar</button>
                            <button onClick={savePeriods} className="erp-btn primary">Save VAT Months</button>
                        </div>
                        {!meta.bs_calendar?.accurate && <p className="text-xs text-amber-700 mt-2">Nepali calendar package is not active on the server ({meta.bs_calendar?.reason || 'unknown'}), so dates must be typed in.</p>}
                    </div>
                ) : (
                    <>
                        <SavedViewsBar reportKey={`vat:${tab}`} getConfig={() => config} onApply={cfg => { const merged = { ...defaultConfig(), ...cfg }; setConfig(merged); run(merged); }} onReset={() => { setConfig(defaultConfig()); setData(null); }} />

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 my-3">
                            <div className="erp-field">
                                <label className="erp-label">VAT Month (quick pick)</label>
                                <select className="erp-select" value="" onChange={e => { const p = quickPeriods.find(x => x.id === e.target.value); if (p) setConfig(c => ({ ...c, date_from: p.start_date, date_to: p.end_date })); }}>
                                    <option value="">{quickPeriods.length ? 'Choose month…' : 'Not set up'}</option>
                                    {quickPeriods.map(p => <option key={p.id} value={p.id}>{p.period_name} {p.bs_year} ({p.period_name_np})</option>)}
                                </select>
                            </div>
                            <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                            <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                            {['register', 'vat_ledger'].includes(tab) && <div className="erp-field"><label className="erp-label">Customer / Supplier</label>{partyPicker}</div>}

                            {tab === 'register' && (
                                <>
                                    <div className="erp-field md:col-span-2">
                                        <label className="erp-label">Documents</label>
                                        <div className="flex flex-wrap gap-3 text-sm pt-1">
                                            {meta.doc_types.map(t => (
                                                <label key={t.key} className="flex items-center gap-1"><input type="checkbox" checked={config.doc_types.includes(t.key)}
                                                    onChange={e => set('doc_types', e.target.checked ? [...config.doc_types, t.key] : config.doc_types.filter(x => x !== t.key))} /> {t.label}</label>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="erp-field"><label className="erp-label">View</label>
                                        <select className="erp-select" value={config.view} onChange={e => set('view', e.target.value)}>{VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                                    {config.view === 'bill' && <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={config.include_items} onChange={e => set('include_items', e.target.checked)} /> Show items under each bill</label>}
                                    {config.view === 'item' && <div className="erp-field"><label className="erp-label">Item contains</label><input className="erp-input" value={config.product_name} onChange={e => set('product_name', e.target.value)} /></div>}
                                </>
                            )}
                            {['register', 'vat_ledger'].includes(tab) && (
                                <>
                                    <div className="erp-field"><label className="erp-label">Bill Amount ≥</label><input type="number" className="erp-input" value={config.min_amount} onChange={e => set('min_amount', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Bill Amount ≤</label><input type="number" className="erp-input" value={config.max_amount} onChange={e => set('max_amount', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">PAN</label>
                                        <select className="erp-select" value={config.pan} onChange={e => set('pan', e.target.value)}><option value="">Any</option><option value="with">With PAN only</option><option value="without">Without PAN only</option></select></div>
                                    <div className="erp-field"><label className="erp-label">VAT</label>
                                        <select className="erp-select" value={config.vat} onChange={e => set('vat', e.target.value)}><option value="">Any</option><option value="taxable">Bills with VAT</option><option value="exempt">Bills without VAT</option></select></div>
                                </>
                            )}
                            {tab === 'threshold' && (
                                <>
                                    <div className="erp-field"><label className="erp-label">Threshold (above)</label><input type="number" className="erp-input" value={config.threshold} onChange={e => set('threshold', e.target.value)} /></div>
                                    <div className="erp-field"><label className="erp-label">Measure on</label>
                                        <select className="erp-select" value={config.basis} onChange={e => set('basis', e.target.value)}><option value="excl_vat">Amount excluding VAT</option><option value="incl_vat">Amount including VAT</option></select></div>
                                    <div className="erp-field"><label className="erp-label">Side</label>
                                        <select className="erp-select" value={config.side} onChange={e => set('side', e.target.value)}><option value="">Sales & Purchase</option><option value="sales">Sales only</option><option value="purchase">Purchase only</option></select></div>
                                    <p className="text-xs text-gray-500 md:col-span-4">For the <b>monthly upload</b>, pick one VAT month. For <b>Annex 13</b>, set From/To to the whole fiscal year. Amounts are net of returns and credit/debit notes.</p>
                                </>
                            )}
                            {tab === 'vat_return' && <div className="erp-field"><label className="erp-label">Credit brought forward</label><input type="number" className="erp-input" value={config.carry_forward_credit} onChange={e => set('carry_forward_credit', e.target.value)} /></div>}
                            {tab === 'vat_ledger' && (
                                <>
                                    <div className="erp-field"><label className="erp-label">VAT Account</label>
                                        <select className="erp-select" value={config.vat_ledger_id} onChange={e => set('vat_ledger_id', e.target.value)}>
                                            <option value="">All VAT accounts</option>
                                            {(meta.vat_ledgers || []).map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}
                                        </select></div>
                                    <div className="erp-field"><label className="erp-label">Opening payable</label><input type="number" className="erp-input" value={config.opening} onChange={e => set('opening', e.target.value)} /></div>
                                    <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={config.include_exempt} onChange={e => set('include_exempt', e.target.checked)} /> Include bills without VAT</label>
                                </>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mb-4">
                            <button onClick={() => run()} disabled={loading} className="erp-btn primary">{loading ? 'Loading…' : '🔍 Show'}</button>
                            {data && <>
                                <button onClick={() => exportCsv('en')} className="erp-btn">⬇ Excel (English)</button>
                                <button onClick={() => exportCsv('np')} className="erp-btn">⬇ Excel (नेपाली)</button>
                            </>}
                            <label className="text-xs text-gray-500 ml-2">On-screen language:
                                <select className="ml-1 border rounded px-1" value={lang} onChange={e => setLang(e.target.value)}><option value="en">English</option><option value="np">नेपाली</option></select></label>
                        </div>

                        {data && tab === 'monthly' && (
                            <div className="overflow-x-auto">
                                <table className="erp-grid-table">
                                    <thead><tr><th>{lang === 'np' ? 'महिना' : 'Month'}</th>{data.doc_types.map(t => <th key={t.key} colSpan={2}>{lang === 'np' ? t.label_np : t.label}</th>)}<th>Output VAT</th><th>Input VAT</th><th>Net VAT</th></tr>
                                        <tr><th></th>{data.doc_types.map(t => <React.Fragment key={t.key}><th>Bills</th><th>Total / VAT</th></React.Fragment>)}<th></th><th></th><th></th></tr></thead>
                                    <tbody>{data.rows.map(r => (
                                        <tr key={r.period_key}><td>{lang === 'np' ? r.label_np : r.label}</td>
                                            {data.doc_types.map(t => <React.Fragment key={t.key}><td>{r.types[t.key]?.count || 0}</td><td>{fmt(r.types[t.key]?.total)} / {fmt(r.types[t.key]?.vat)}</td></React.Fragment>)}
                                            <td>{fmt(r.output_vat)}</td><td>{fmt(r.input_vat)}</td><td className={`font-semibold ${r.net_vat < 0 ? 'text-green-700' : ''}`}>{fmt(r.net_vat)}</td></tr>))}</tbody>
                                </table>
                                {data.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No posted documents in this range.</p>}
                            </div>
                        )}

                        {data && tab === 'vat_return' && (
                            <div className="max-w-2xl">
                                <table className="erp-grid-table"><tbody>
                                    {vatReturnRows(data).map(([en, np, v, strong], i) => (
                                        <tr key={i} className={strong ? 'font-semibold bg-slate-50' : ''}><td>{lang === 'np' ? np : en}</td><td className="text-right">{v === null ? '' : fmt(v)}</td></tr>
                                    ))}
                                </tbody></table>
                                {data.gl_check ? (
                                    <div className="mt-3 text-xs border rounded p-3">
                                        <p className="font-semibold mb-1">Check against the VAT accounts in GL for the same dates</p>
                                        {Object.entries(data.gl_check.by_ledger || {}).map(([k, v]) => <div key={k}>{k}: net credit {fmt(v)}</div>)}
                                        <div className="text-gray-500 mt-1">By document: {Object.entries(data.gl_check.by_document_type).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}</div>
                                        <div className="mt-1">GL net credit {fmt(data.gl_check.net_credit)} vs report net VAT {fmt(data.output_vat - data.input_vat)}
                                            {Math.abs(data.gl_check.net_credit - (data.output_vat - data.input_vat)) > 0.01 && <span className="text-red-600"> — differs by {fmt(data.gl_check.net_credit - (data.output_vat - data.input_vat))}</span>}</div>
                                    </div>
                                ) : <p className="text-xs text-amber-700 mt-2">No VAT account found (System Control VAT ledger or a VAT billing term ledger), so the GL check is skipped.</p>}
                            </div>
                        )}

                        {data && !['monthly', 'vat_return'].includes(tab) && (
                            <div className="overflow-x-auto">
                                {tab === 'threshold' && data.without_pan > 0 && <p className="text-xs text-red-600 mb-2">{data.without_pan} part{data.without_pan > 1 ? 'ies' : 'y'} above the threshold have no PAN on their ledger.</p>}
                                <table className="erp-grid-table">
                                    <thead><tr>{tab === 'threshold' && <th>{lang === 'np' ? 'क्र.सं.' : 'S.N.'}</th>}{columns.map(k => <th key={k} className={NUMERIC.has(k) ? 'text-right' : ''}>{COLS[k][lang === 'np' ? 1 : 0]}</th>)}</tr></thead>
                                    <tbody>
                                        {rows.map((r, i) => (
                                            <React.Fragment key={i}>
                                                <tr>{tab === 'threshold' && <td>{i + 1}</td>}{columns.map(k => <td key={k} className={NUMERIC.has(k) ? 'text-right' : ''}>{cellValue(r, k, lang)}</td>)}</tr>
                                                {tab === 'register' && data.view === 'bill' && config.include_items && (r.lines || []).map((l, j) => (
                                                    <tr key={`${i}-${j}`} className="text-xs text-gray-500 bg-slate-50">
                                                        <td colSpan={5}></td><td colSpan={2}>↳ {l.product_name} {l.qty !== null ? `× ${l.qty} ${l.uom || ''} @ ${fmt(l.rate)}` : ''}</td>
                                                        <td className="text-right">{fmt(l.taxable)}</td><td className="text-right">{fmt(l.exempt)}</td><td className="text-right">{fmt(l.vat)}</td><td className="text-right">{fmt(l.amount)}</td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                        {data.totals && (
                                            <tr className="font-semibold bg-slate-50">{tab === 'threshold' && <td></td>}
                                                {columns.map((k, idx) => <td key={k} className={NUMERIC.has(k) ? 'text-right' : ''}>{idx === 0 ? 'Total' : (data.totals[k] !== undefined && NUMERIC.has(k) && k !== 'running_payable' ? fmt(data.totals[k]) : k === 'count' ? data.totals.count : '')}</td>)}</tr>
                                        )}
                                    </tbody>
                                </table>
                                {rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nothing found for these filters.</p>}
                                {tab === 'vat_ledger' && <p className="text-sm mt-2">Opening {fmt(data.opening)} → Closing <b>{fmt(data.closing)}</b> {data.closing < 0 ? '(credit to carry forward)' : '(payable)'}</p>}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}

// VAT return rows: [English, Nepali, amount, isTotalRow]
function vatReturnRows(d) {
    return [
        ['Taxable sales', 'करयोग्य बिक्री', d.sales.taxable], ['VAT on sales', 'बिक्रीमा मू.अ.क.', d.sales.vat], ['Exempt sales', 'कर छुट बिक्री', d.sales.exempt],
        ['Less: sales returns (taxable)', 'घटाउने: बिक्री फिर्ता (करयोग्य)', d.sales_return.taxable], ['Less: VAT on sales returns', 'घटाउने: बिक्री फिर्ता मू.अ.क.', d.sales_return.vat],
        ['Less: credit notes (taxable)', 'घटाउने: क्रेडिट नोट (करयोग्य)', d.credit_note.taxable], ['Less: VAT on credit notes', 'घटाउने: क्रेडिट नोट मू.अ.क.', d.credit_note.vat],
        ['Net output VAT', 'खुद बिक्री मू.अ.क.', d.output_vat, true],
        ['Taxable purchases (domestic)', 'करयोग्य खरिद (स्वदेशी)', d.purchase.taxable], ['Taxable imports', 'करयोग्य पैठारी', d.purchase.import_taxable],
        ['VAT on purchases', 'खरिदमा मू.अ.क.', d.purchase.vat], ['Exempt purchases', 'कर छुट खरिद', d.purchase.exempt],
        ['Less: purchase returns (taxable)', 'घटाउने: खरिद फिर्ता (करयोग्य)', d.purchase_return.taxable], ['Less: VAT on purchase returns', 'घटाउने: खरिद फिर्ता मू.अ.क.', d.purchase_return.vat],
        ['Less: debit notes (taxable)', 'घटाउने: डेबिट नोट (करयोग्य)', d.debit_note.taxable], ['Less: VAT on debit notes', 'घटाउने: डेबिट नोट मू.अ.क.', d.debit_note.vat],
        ['Net input VAT', 'खुद खरिद मू.अ.क.', d.input_vat, true],
        ['Credit brought forward', 'अघिल्लो महिनाको बाँकी मिलान', d.carry_forward_credit],
        ['VAT payable', 'तिर्नुपर्ने मू.अ.क.', d.net_vat_payable, true], ['Credit to carry forward', 'अर्को महिना सार्ने मिलान', d.credit_to_carry_forward, true],
        ['Number of sales bills', 'बिक्री बिल संख्या', d.sales.count], ['Number of purchase bills', 'खरिद बिल संख्या', d.purchase.count]
    ];
}
