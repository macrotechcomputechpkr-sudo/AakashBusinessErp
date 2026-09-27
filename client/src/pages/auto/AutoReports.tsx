// =============================================
// auto/AutoReports.tsx  (/auto/reports?view=)
//   enquiries      by source / model / salesperson / status, conversion %, lost reasons
//   vehicle_sales  vehicle delivery register
//   job_cards      workshop revenue by service type + job card register
//   parts          parts issued for job cards: qty, cost, sold, free, margin
//   outside_work   outside work register with margin
//   technicians    jobs, labour hours and amount per technician
// Server: utils/automobile.js report().
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Msg, NavWindow, errText, n0, n2, pct } from '../../components/poultry/common';

type Row = Record<string, unknown>;
const VIEWS: [string, string][] = [['enquiries', '📋 Enquiries'], ['vehicle_sales', '🔑 Vehicle Deliveries'], ['job_cards', '🔧 Job Cards'], ['parts', '📦 Parts Issued'], ['outside_work', '🚚 Outside Work'], ['technicians', '👨‍🔧 Technicians']];
type Col = [string, string, 'n' | 't' | 'i' | 'p'];
const num = (v: unknown) => Number(v) || 0;
function Grid({ rows, cols, total = [] }: { rows: Row[]; cols: Col[]; total?: string[] }) {
    const fmt = (v: unknown, t: string) => (t === 'n' ? n2(num(v)) : t === 'i' ? n0(num(v)) : t === 'p' ? pct(num(v)) : String(v ?? ''));
    return (
        <div className="overflow-x-auto">
            <table className="erp-grid-table">
                <thead><tr>{cols.map(([k, l, t]) => <th key={k} className={t === 't' ? 'text-left' : 'text-right'}>{l}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(([k, , t]) => <td key={k} className={t === 't' ? '' : 'text-right'}>{fmt(r[k], t)}</td>)}</tr>)}
                    {!rows.length && <tr><td colSpan={cols.length} className="text-center text-gray-500 py-4">Nothing to show.</td></tr>}</tbody>
                {total.length > 0 && rows.length > 0 && <tfoot><tr>{cols.map(([k, , t], i) => <td key={k} className={t === 't' ? '' : 'text-right'}>{i === 0 ? 'Total' : total.includes(k) ? (t === 'i' ? n0 : n2)(rows.reduce((s, r) => s + num(r[k]), 0)) : ''}</td>)}</tr></tfoot>}
            </table>
        </div>
    );
}
const FUNNEL: Col[] = [['label', '', 't'], ['total', 'Enquiries', 'i'], ['open', 'Open', 'i'], ['booked', 'Booked', 'i'], ['delivered', 'Delivered', 'i'], ['lost', 'Lost', 'i'], ['conversion_pct', 'Conversion', 'p']];

export default function AutoReports() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const view = params.get('view') || 'enquiries';
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [data, setData] = useState<unknown>(null);
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        setErr(''); setData(null);
        try { setData((await authFetch(`/api/auto/reports/${view}?${new URLSearchParams({ ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) })}`)).data); } catch (e) { setErr(errText(e)); }
    }, [authFetch, view, from, to]);
    useEffect(() => { load(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
    const d = data as Record<string, Row[]> & Row[];
    return (
        <Layout>
            <NavWindow wide title="📊 Automobile Reports" tools={<>
                {VIEWS.map(([k, l]) => <button key={k} type="button" className={`nav-tool-btn ${view === k ? 'active' : ''}`} onClick={() => setParams({ view: k })}>{l}</button>)}
                <span className="nav-tool-sep" />
                <label className="text-xs">From</label><input type="date" className="nav-input" style={{ width: 140, height: 24 }} value={from} onChange={e => setFrom(e.target.value)} />
                <label className="text-xs">to</label><input type="date" className="nav-input" style={{ width: 140, height: 24 }} value={to} onChange={e => setTo(e.target.value)} />
                <button type="button" className="nav-tool-btn" onClick={load}>▶ Show</button>
                <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
            </>}>
                <Msg err={err} />
                {!data && !err && <p className="text-sm text-gray-500">Loading…</p>}
                {data !== null && view === 'enquiries' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {([['by_source', 'By source'], ['by_model', 'By model'], ['by_salesperson', 'By salesperson'], ['lost_reasons', 'Lost - reasons']] as [string, string][]).map(([k, l]) => (
                            <GroupBox key={k} title={l}><Grid rows={d[k] || []} cols={FUNNEL} total={['total', 'open', 'booked', 'delivered', 'lost']} /></GroupBox>
                        ))}
                    </div>
                )}
                {data !== null && view === 'vehicle_sales' && <Grid rows={d} total={['keys_given']} cols={[['doc_no', 'Delivery', 't'], ['delivery_date', 'Date', 't'], ['customer_name', 'Customer', 't'], ['customer_phone', 'Phone', 't'], ['model_name', 'Model', 't'], ['variant', 'Variant', 't'], ['color', 'Colour', 't'], ['chassis_no', 'Chassis', 't'], ['engine_no', 'Engine', 't'], ['reg_no', 'Reg. no.', 't'], ['finance_company', 'Finance', 't']]} />}
                {data !== null && view === 'job_cards' && (
                    <>
                        <GroupBox title="Workshop revenue by service type (delivered jobs, without VAT)">
                            <Grid rows={d.by_type || []} total={['jobs', 'delivered', 'parts', 'labour', 'outside', 'discount', 'net']} cols={[['service_type', 'Type', 't'], ['jobs', 'Jobs', 'i'], ['delivered', 'Delivered', 'i'], ['parts', 'Parts', 'n'], ['labour', 'Labour', 'n'], ['outside', 'Outside work', 'n'], ['discount', 'Discount', 'n'], ['net', 'Net', 'n']]} />
                        </GroupBox>
                        <GroupBox title="Job cards">
                            <Grid rows={d.jobs || []} total={['total_amount']} cols={[['doc_no', 'Job', 't'], ['date_in', 'In', 't'], ['reg_no', 'Reg.', 't'], ['model_name', 'Model', 't'], ['customer_name', 'Customer', 't'], ['service_type', 'Type', 't'], ['technician', 'Technician', 't'], ['status', 'Status', 't'], ['delivered_on', 'Delivered', 't'], ['total_amount', 'Amount', 'n']]} />
                        </GroupBox>
                    </>
                )}
                {data !== null && view === 'parts' && <Grid rows={d} total={['cost', 'sale', 'margin']} cols={[['product_code', 'Code', 't'], ['product_name', 'Part', 't'], ['qty', 'Qty issued', 'n'], ['free_qty', 'Of which free / warranty', 'n'], ['cost', 'Cost', 'n'], ['sale', 'Sold', 'n'], ['margin', 'Margin', 'n']]} />}
                {data !== null && view === 'outside_work' && <Grid rows={d} total={['cost_amount', 'charge_amount', 'margin']} cols={[['doc_no', 'No.', 't'], ['job_no', 'Job', 't'], ['customer_name', 'Customer', 't'], ['vendor_name', 'Workshop', 't'], ['work_description', 'Work', 't'], ['sent_date', 'Sent', 't'], ['received_date', 'Back', 't'], ['status', 'Status', 't'], ['cost_amount', 'Cost', 'n'], ['charge_amount', 'Charged', 'n'], ['margin', 'Margin', 'n']]} />}
                {data !== null && view === 'technicians' && <Grid rows={d} total={['jobs', 'labour_hours', 'labour', 'parts']} cols={[['technician', 'Technician', 't'], ['jobs', 'Jobs', 'i'], ['labour_hours', 'Labour hours', 'n'], ['labour', 'Labour', 'n'], ['parts', 'Parts sold', 'n']]} />}
            </NavWindow>
        </Layout>
    );
}
