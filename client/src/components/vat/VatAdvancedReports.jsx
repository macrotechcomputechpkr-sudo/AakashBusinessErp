// =============================================
// components/vat/VatAdvancedReports.jsx
// The advanced VAT report tabs of VatReports.jsx (server: utils/vatAnnex.js):
//   annex13        Annexure 13 - party-wise opening, capital / other / goods
//                  purchase and sales, closing, Debtor / Creditor, PAN
//   sp_monthly     month-wise Sales and Purchase side by side (invoices, total,
//                  non-taxable, export / import, taxable, tax) with grand total
//   party_summary  party-wise VAT summary, sales and purchase combined
// Each has its own include options (returns, debit / credit notes, additional
// bills, JVs), sort, PAN / amount filters, print and Excel (CSV) export.
// =============================================
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const f2 = n => Number(n || 0).toFixed(2);
const INCLUDES = [
    ['include_purchase_return', 'Include Purchase Return'], ['include_sales_return', 'Include Sales Return'],
    ['include_debit_note', 'Include Debit Note'], ['include_credit_note', 'Include Credit Note'],
    ['include_additional', 'Include Additional Bills (PA / PE / SE)'], ['include_jv', 'Include Taxable JV']
];
const defaults = () => ({ date_from: '', date_to: '', sort_on: 'name', min_amount: '', pan: '', side: '', show_pan: true, hide_opening_closing: false,
    ...Object.fromEntries(INCLUDES.map(([k]) => [k, true])) });

export default function VatAdvancedReports({ tab, quickPeriods = [], lang = 'en' }) {
    const { authFetch } = useAuth();
    const [f, setF] = useState(defaults());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    const np = lang === 'np';

    const run = async () => {
        setLoading(true); setErr(''); setData(null);
        try {
            const p = new URLSearchParams();
            ['date_from', 'date_to', 'sort_on', 'min_amount', 'pan', 'side'].forEach(k => { if (f[k]) p.set(k, f[k]); });
            INCLUDES.forEach(([k]) => p.set(k, f[k] ? 'true' : 'false'));
            if (f.hide_opening_closing) p.set('hide_opening_closing', 'true');
            const url = { annex13: '/api/vat-reports/annex13', sp_monthly: '/api/vat-reports/monthly-sales-purchase', party_summary: '/api/vat-reports/party-summary' }[tab];
            setData((await authFetch(`${url}?${p}`)).data);
        } catch (e) { setErr(e.message); } finally { setLoading(false); }
    };
    const fy = () => { if (quickPeriods.length) setF(x => ({ ...x, date_from: quickPeriods[0].start_date, date_to: quickPeriods[quickPeriods.length - 1].end_date })); };

    // ---- table definition per tab: [key, English, Nepali, numeric] ----
    const cols = (() => {
        if (tab === 'annex13') return [
            ['party_code', 'Party Code', 'कोड'], ['party_name', 'Party Name', 'नाम'], ...(f.show_pan ? [['party_pan', 'PAN No.', 'स्थायी लेखा नं.']] : []), ['debtor_creditor', 'Debtors / Creditors', 'ऋणी / साहु'],
            ...(f.hide_opening_closing ? [] : [['opening_balance', 'Opening Balance', 'सुरु मौज्दात', 1]]),
            ['capital_purchase', 'Capital Purchase', 'पूँजीगत खरिद', 1], ['other_purchase', 'Other Purchase', 'अन्य खरिद', 1], ['goods_purchase', 'Goods Purchase', 'वस्तु खरिद', 1],
            ['capital_sales', 'Capital Sales', 'पूँजीगत बिक्री', 1], ['other_sales', 'Other Sales', 'अन्य बिक्री', 1], ['goods_sales', 'Goods Sales', 'वस्तु बिक्री', 1],
            ...(f.hide_opening_closing ? [] : [['closing_balance', 'Closing Balance', 'अन्तिम मौज्दात', 1]])];
        if (tab === 'party_summary') return [
            ...(f.show_pan ? [['party_pan', 'PAN', 'स्थायी लेखा नं.']] : []), ['party_name', 'Name of Tax Payer', 'करदाताको नाम'], ['ps', 'Purchase / Sale', 'खरिद / बिक्री'], ['bills', 'Bills', 'बिल संख्या', 2],
            ['taxable', 'Taxable Amount', 'करयोग्य रकम', 1], ['exempt', 'Exempted Amount', 'कर छुट रकम', 1], ['vat', 'VAT', 'मू.अ.क.', 1], ['total', 'Total', 'जम्मा', 1]];
        return [];
    })();
    const SP_S = [['count', 'No. of Invoice', 'बिल संख्या'], ['total', 'Total Sales', 'जम्मा बिक्री'], ['non_taxable', 'Non Taxable', 'कर छुट'], ['export', 'Export', 'निर्यात'], ['taxable', 'Taxable', 'करयोग्य'], ['tax', 'Tax', 'कर']];
    const SP_P = [['count', 'No. of Invoice', 'बिल संख्या'], ['total', 'Total Purchase', 'जम्मा खरिद'], ['non_taxable', 'Non Taxable', 'कर छुट'], ['taxable', 'Taxable', 'करयोग्य'], ['tax', 'Tax', 'कर'], ['import_taxable', 'Import Taxable', 'पैठारी करयोग्य'], ['import_tax', 'Import Tax', 'पैठारी कर']];

    const exportCsv = () => {
        let head, body;
        if (tab === 'sp_monthly') {
            head = [np ? 'महिना' : 'Particular', ...SP_S.map(c => `Sales - ${c[1]}`), ...SP_P.map(c => `Purchase - ${c[1]}`)];
            body = [...data.rows, { label: 'Grand Total', label_np: 'जम्मा', sales: data.totals.sales, purchase: data.totals.purchase }]
                .map(r => [np ? r.label_np : r.label, ...SP_S.map(c => (c[0] === 'count' ? r.sales[c[0]] : f2(r.sales[c[0]]))), ...SP_P.map(c => (c[0] === 'count' ? r.purchase[c[0]] : f2(r.purchase[c[0]])))]);
        } else {
            head = cols.map(c => c[np ? 2 : 1]);
            body = [...data.rows.map(r => cols.map(c => (c[3] ? f2(r[c[0]]) : r[c[0]] ?? ''))), cols.map((c, i) => (i === 0 ? 'Total' : c[3] && tot[c[0]] !== undefined ? f2(tot[c[0]]) : ''))];
        }
        const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...body].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `${tab}_${f.date_from || 'all'}_${f.date_to || 'all'}.csv`; a.click();
    };
    const tot = data ? (tab === 'party_summary' ? data.totals.all : data.totals) : {};
    const title = { annex13: 'Annexure 13 - SB, PB, PA, PR, PE, SR, SE, DN, CN', sp_monthly: 'Sales Purchase (Monthly Summary)', party_summary: 'Party-wise VAT Summary - Sales / Purchase Combined' }[tab];
    const includedText = INCLUDES.filter(([k]) => f[k]).map(([, l]) => l.replace('Include ', '')).join(', ');

    return (
        <div className="my-3">
            <div className="border border-[#aca899] bg-[#f4f2ea] p-3 grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={f.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={f.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                <div className="erp-field"><label className="erp-label">VAT Month</label>
                    <select className="erp-select" value="" onChange={e => { const p = quickPeriods.find(x => x.id === e.target.value); if (p) setF(x => ({ ...x, date_from: p.start_date, date_to: p.end_date })); }}>
                        <option value="">{quickPeriods.length ? 'Choose month…' : 'Not set up'}</option>{quickPeriods.map(p => <option key={p.id} value={p.id}>{p.period_name} {p.bs_year}</option>)}</select></div>
                <div className="flex items-end"><button type="button" className="nav-btn small" onClick={fy} disabled={!quickPeriods.length}>Whole fiscal year</button></div>
                {tab !== 'sp_monthly' && <div className="erp-field"><label className="erp-label">Sort On</label>
                    <select className="erp-select" value={f.sort_on} onChange={e => set('sort_on', e.target.value)}>
                        <option value="name">Party Name</option>{tab === 'annex13' && <option value="code">Party Code</option>}<option value="pan">PAN</option><option value="amount">Amount (high first)</option></select></div>}
                {tab === 'party_summary' && <div className="erp-field"><label className="erp-label">Purchase / Sale</label>
                    <select className="erp-select" value={f.side} onChange={e => set('side', e.target.value)}><option value="">Both</option><option value="sales">Sales</option><option value="purchase">Purchase</option></select></div>}
                {tab !== 'sp_monthly' && <div className="erp-field"><label className="erp-label">PAN</label>
                    <select className="erp-select" value={f.pan} onChange={e => set('pan', e.target.value)}><option value="">Any</option><option value="with">With PAN</option><option value="without">Without PAN</option></select></div>}
                {tab !== 'sp_monthly' && <div className="erp-field"><label className="erp-label">Transaction / Balance Amount ≥</label>
                    <input type="number" className="erp-input" value={f.min_amount} onChange={e => set('min_amount', e.target.value)} placeholder="blank / 0 = no filter" /></div>}
                <div className="md:col-span-4 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 pt-1">
                    {INCLUDES.map(([k, l]) => <label key={k} className="flex items-center justify-between gap-2 border-b border-dotted border-gray-300 py-0.5">{l}<input type="checkbox" checked={!!f[k]} onChange={e => set(k, e.target.checked)} /></label>)}
                    {tab !== 'sp_monthly' && <label className="flex items-center justify-between gap-2 border-b border-dotted border-gray-300 py-0.5">Show PAN No<input type="checkbox" checked={f.show_pan} onChange={e => set('show_pan', e.target.checked)} /></label>}
                    {tab === 'annex13' && <label className="flex items-center justify-between gap-2 border-b border-dotted border-gray-300 py-0.5">Hide Opening / Closing<input type="checkbox" checked={f.hide_opening_closing} onChange={e => set('hide_opening_closing', e.target.checked)} /></label>}
                </div>
                <div className="md:col-span-4 flex gap-2 pt-1">
                    <button type="button" className="erp-btn primary" onClick={run} disabled={loading}>{loading ? 'Loading…' : '🔍 Show'}</button>
                    {data && <><button type="button" className="erp-btn" onClick={exportCsv}>⬇ Export</button><button type="button" className="erp-btn" onClick={() => window.print()}>🖨 Print</button></>}
                </div>
            </div>
            {err && <p className="text-sm text-red-700 mt-2">{err}</p>}
            {data && (
                <div className="mt-3 overflow-x-auto" data-no-excel>
                    <div className="text-center mb-2"><div className="font-semibold">{title}</div>
                        <div className="text-xs text-gray-600">{f.date_from || data.from ? `for the period ${f.date_from || data.from || ''} to ${f.date_to || data.to || ''}` : ''}{includedText ? ` · Including ${includedText}` : ''}</div></div>
                    {tab === 'sp_monthly' ? (
                        <table className="erp-grid-table">
                            <thead>
                                <tr><th rowSpan={2}>{np ? 'महिना' : 'Particular'}</th><th colSpan={SP_S.length} className="text-center">{np ? 'बिक्री' : 'Sales'}</th><th colSpan={SP_P.length} className="text-center">{np ? 'खरिद' : 'Purchase'}</th></tr>
                                <tr>{SP_S.map(c => <th key={`s${c[0]}`} className="text-right">{c[np ? 2 : 1]}</th>)}{SP_P.map(c => <th key={`p${c[0]}`} className="text-right">{c[np ? 2 : 1]}</th>)}</tr>
                            </thead>
                            <tbody>{data.rows.map(r => (
                                <tr key={r.period_key}><td className="whitespace-nowrap">{(np ? r.label_np : r.label).toUpperCase()}</td>
                                    {SP_S.map(c => <td key={`s${c[0]}`} className="text-right">{c[0] === 'count' ? r.sales.count : f2(r.sales[c[0]])}</td>)}
                                    {SP_P.map(c => <td key={`p${c[0]}`} className="text-right">{c[0] === 'count' ? r.purchase.count : f2(r.purchase[c[0]])}</td>)}</tr>
                            ))}</tbody>
                            <tfoot><tr className="font-bold bg-gray-100"><td className="text-right text-blue-800">Grand Total ⇒</td>
                                {SP_S.map(c => <td key={`s${c[0]}`} className="text-right">{c[0] === 'count' ? data.totals.sales.count : f2(data.totals.sales[c[0]])}</td>)}
                                {SP_P.map(c => <td key={`p${c[0]}`} className="text-right">{c[0] === 'count' ? data.totals.purchase.count : f2(data.totals.purchase[c[0]])}</td>)}</tr></tfoot>
                        </table>
                    ) : (
                        <table className="erp-grid-table">
                            <thead><tr>{cols.map(c => <th key={c[0]} className={c[3] ? 'text-right' : ''}>{c[np ? 2 : 1]}</th>)}</tr></thead>
                            <tbody>{data.rows.map((r, i) => (
                                <tr key={i}>{cols.map(c => <td key={c[0]} className={c[3] ? `text-right ${Number(r[c[0]]) < 0 ? 'text-red-700' : ''}` : ''}>{c[3] === 2 ? r[c[0]] : c[3] ? f2(r[c[0]]) : r[c[0]]}</td>)}</tr>
                            ))}</tbody>
                            <tfoot><tr className="font-bold bg-gray-100">{cols.map((c, i) => <td key={c[0]} className={c[3] ? 'text-right' : ''}>{i === 0 ? `Total (${data.rows.length})` : c[3] && tot[c[0]] !== undefined ? (c[3] === 2 ? tot[c[0]] : f2(tot[c[0]])) : ''}</td>)}</tr>
                                {tab === 'party_summary' && !f.side && ['sales', 'purchase'].map(sd => (
                                    <tr key={sd} className="bg-gray-50">{cols.map((c, i) => <td key={c[0]} className={c[3] ? 'text-right' : ''}>{i === 0 ? (sd === 'sales' ? 'Sales (S)' : 'Purchase (P)') : c[3] && data.totals[sd][c[0]] !== undefined ? (c[3] === 2 ? data.totals[sd][c[0]] : f2(data.totals[sd][c[0]])) : ''}</td>)}</tr>
                                ))}</tfoot>
                        </table>
                    )}
                    {data.rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nothing found for these filters.</p>}
                    {tab === 'annex13' && <p className="text-xs text-gray-500 mt-1">Goods = inventory items; Capital = fixed-asset items and capital JVs; Other = services / non-inventory items, additional bills, JVs and debit / credit notes. Amounts are without VAT, net of the returns / notes included. Balances from the general ledger (D = debtor, C = creditor group).</p>}
                    {tab === 'sp_monthly' && <p className="text-xs text-gray-500 mt-1">Export = sales in a foreign currency. Import = the import taxable of purchase bills and the Customs (Bhansar) rows of additional bills; their VAT is the Import Tax.</p>}
                </div>
            )}
        </div>
    );
}
