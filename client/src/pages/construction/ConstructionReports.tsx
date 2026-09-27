// =============================================
// construction/ConstructionReports.tsx  (/construction/reports?view=)
//   profitability  site-wise contract, billed, cost heads, profit / loss, budget
//   ra_register    running bills to clients (VAT, retention, TDS, advance, net)
//   subcontractors petti thekka given: contract, billed, balance, retention, TDS
//   material       material consumed per site and item
//   wages          labour per site and trade (workers, days, amount)
// Server: utils/construction.js report().
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { Msg, NavWindow, errText, n0, n2, pct } from '../../components/poultry/common';
import { STATUS_LABEL } from './common';

const VIEWS: [string, string][] = [['profitability', '💰 Site Profit / Loss'], ['ra_register', '🧾 Running Bills'], ['subcontractors', '🤝 Petti Thekka'], ['material', '🧱 Material'], ['wages', '👷 Wages']];
type Row = Record<string, string | number | null>;
const num = (v: unknown) => Number(v) || 0;
const COLS: Record<string, [string, string, 'n' | 't' | 'p' | 'i'][]> = {
    profitability: [['site_code', 'Code', 't'], ['site_name', 'Site', 't'], ['client_name', 'Client', 't'], ['status', 'Status', 't'], ['contract_amount', 'Contract', 'n'], ['billed', 'Billed', 'n'], ['billed_pct', 'Billed %', 'p'],
        ['material', 'Material', 'n'], ['wages', 'Wages', 'n'], ['subcontract', 'Petti thekka', 'n'], ['other_cost', 'Other', 'n'], ['total_cost', 'Total cost', 'n'], ['profit', 'Profit / loss', 'n'], ['margin_pct', 'Margin', 'p'], ['budget_used_pct', 'Budget used', 'p'], ['retention_held', 'Retention held', 'n']],
    ra_register: [['doc_no', 'Bill', 't'], ['doc_date', 'Date', 't'], ['site_code', 'Site', 't'], ['client_name', 'Client', 't'], ['status', 'Status', 't'], ['gross_amount', 'Work done', 'n'], ['vat_amount', 'VAT', 'n'],
        ['retention_amount', 'Retention', 'n'], ['tds_amount', 'TDS', 'n'], ['advance_recovery', 'Advance', 'n'], ['other_deduction', 'Other', 'n'], ['net_amount', 'Net', 'n']],
    subcontractors: [['site_code', 'Site', 't'], ['subcontractor_name', 'Sub-contractor', 't'], ['work_description', 'Work', 't'], ['status', 'Status', 't'], ['contract_amount', 'Given', 'n'], ['billed', 'Billed', 'n'], ['progress_pct', 'Done', 'p'],
        ['balance', 'Balance', 'n'], ['retention_held', 'Retention held', 'n'], ['tds', 'TDS', 'n'], ['bills', 'Bills', 'i']],
    material: [['site_code', 'Site', 't'], ['site_name', 'Site name', 't'], ['product_name', 'Item', 't'], ['qty_out', 'Sent', 'n'], ['qty_in', 'Returned', 'n'], ['net_qty', 'Net used', 'n'], ['amount', 'Amount', 'n']],
    wages: [['site_code', 'Site', 't'], ['site_name', 'Site name', 't'], ['trade', 'Trade', 't'], ['workers', 'Workers', 'i'], ['days', 'Man-days', 'n'], ['ot_hours', 'OT hours', 'n'], ['avg_per_day', 'Avg / day', 'n'], ['amount', 'Amount', 'n']]
};
const TOTAL = ['contract_amount', 'billed', 'material', 'wages', 'subcontract', 'other_cost', 'total_cost', 'profit', 'retention_held', 'gross_amount', 'vat_amount', 'retention_amount', 'tds_amount', 'advance_recovery', 'other_deduction', 'net_amount', 'balance', 'tds', 'amount', 'days', 'ot_hours'];

export default function ConstructionReports() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const view = params.get('view') || 'profitability';
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [rows, setRows] = useState<Row[] | null>(null);
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        setErr(''); setRows(null);
        try {
            const qs = new URLSearchParams({ ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) });
            setRows((await authFetch<Row[]>(`/api/construction/reports/${view}?${qs}`)).data);
        } catch (e) { setErr(errText(e)); }
    }, [authFetch, view, from, to]);
    useEffect(() => { load(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
    const cols = COLS[view] || [];
    const fmt = (v: unknown, t: string) => (t === 'n' ? n2(num(v)) : t === 'p' ? (v === null || v === undefined ? '—' : pct(num(v))) : t === 'i' ? n0(num(v)) : String(v === null || v === undefined ? '' : (STATUS_LABEL[String(v)] || v)));
    return (
        <Layout>
            <NavWindow wide title="📊 Construction Reports" tools={<>
                {VIEWS.map(([k, l]) => <button key={k} type="button" className={`nav-tool-btn ${view === k ? 'active' : ''}`} onClick={() => setParams({ view: k })}>{l}</button>)}
                <span className="nav-tool-sep" />
                {['ra_register', 'wages'].includes(view) && <>
                    <label className="text-xs">From</label><input type="date" className="nav-input" style={{ width: 140, height: 24 }} value={from} onChange={e => setFrom(e.target.value)} />
                    <label className="text-xs">to</label><input type="date" className="nav-input" style={{ width: 140, height: 24 }} value={to} onChange={e => setTo(e.target.value)} />
                </>}
                <button type="button" className="nav-tool-btn" onClick={load}>▶ Show</button>
                <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
            </>}>
                <Msg err={err} />
                {!rows && !err && <p className="text-sm text-gray-500">Loading…</p>}
                {rows && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead><tr>{cols.map(([k, l, t]) => <th key={k} className={t === 't' ? 'text-left' : 'text-right'}>{l}</th>)}</tr></thead>
                            <tbody>{rows.map((r, i) => (
                                <tr key={i} className={r.site_id || (view === 'profitability' && r.id) ? 'cursor-pointer' : ''} onClick={() => { const sid = view === 'profitability' ? r.id : r.site_id; if (sid) window.location.href = `/construction/sites?id=${sid}`; }}>
                                    {cols.map(([k, , t]) => <td key={k} className={`${t === 't' ? '' : 'text-right'} ${k === 'profit' && num(r[k]) < 0 ? 'text-red-700' : ''}`}>{fmt(r[k], t)}</td>)}
                                </tr>
                            ))}
                            {rows.length === 0 && <tr><td colSpan={cols.length} className="text-center text-gray-500 py-6">Nothing to show.</td></tr>}</tbody>
                            {rows.length > 0 && <tfoot><tr>{cols.map(([k, , t], i) => <td key={k} className={t === 't' ? '' : 'text-right'}>{i === 0 ? 'Total' : TOTAL.includes(k) ? n2(rows.filter(r => r.status !== 'cancelled').reduce((s, r) => s + num(r[k]), 0)) : ''}</td>)}</tr></tfoot>}
                        </table>
                        {view === 'ra_register' && <p className="text-xs text-gray-600 mt-1">Totals leave out cancelled bills.</p>}
                    </div>
                )}
            </NavWindow>
        </Layout>
    );
}
