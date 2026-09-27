// =============================================
// construction/ConstructionSites.tsx  (/construction/sites?id=&tab=&new=1)
// Contract sites (thekka) - own contracts and petti thekka taken from a main
// contractor - and everything booked against one site:
//   Overview   contract, billed %, cost heads, profit / loss, budget vs actual
//   Contract   client / main contractor, amount, VAT / retention / TDS / advance, budget
//   BOQ        contract items with qty billed so far
//   Running Bills   RA bills to the client (work done, VAT, retention, TDS, advance)
//   Material   issued from store or straight from a purchase bill; returns
//   Wages      labour wage sheets (days x rate + OT)
//   Petti Thekka    work given to sub-contractors and their bills
//   Other Cost vouchers booked with the site's cost center
// Server: utils/construction.js.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Kpi, Msg, NavWindow, SearchablePopupSelect, errText, n2, pct, today, useLookups } from '../../components/poultry/common';
import { LedgerPick, STATUS_LABEL } from './common';
import type { Boq, Site, SiteDetail, Subcontract } from './common';

type SiteForm = Record<string, string | number | null>;
const blankSite = (): SiteForm => ({ site_code: '', site_name: '', contract_type: 'main', client_ledger_id: '', employer_name: '', contract_no: '', contract_date: '', start_date: today(), end_date: '',
    contract_amount: '', vat_percent: '', retention_percent: '', tds_percent: '', advance_amount: '', advance_recovery_percent: '', budget_material: '', budget_labour: '', budget_subcontract: '', budget_other: '',
    location: '', site_engineer: '', warehouse_id: '', status: 'active', remarks: '' });
const TABS: [string, string][] = [['overview', '📊 Overview'], ['contract', '📝 Contract'], ['boq', '📐 BOQ'], ['ra', '🧾 Running Bills'], ['material', '🧱 Material'], ['wages', '👷 Wages'], ['sub', '🤝 Petti Thekka'], ['other', '💸 Other Cost']];
const red = (v: number) => (v < 0 ? 'text-red-700' : '');

export default function ConstructionSites() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [params, setParams] = useSearchParams();
    const id = params.get('id');
    const isNew = !!params.get('new');
    const tab = params.get('tab') || 'overview';
    const status = params.get('status') || 'active';
    const L = useLookups(authFetch, { ledgers: true });
    const [rows, setRows] = useState<Site[]>([]);
    const [d, setD] = useState<SiteDetail | null>(null);
    const [form, setForm] = useState<SiteForm>(blankSite());
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const [warn, setWarn] = useState<string[]>([]);

    const loadList = useCallback(async () => {
        try { setRows((await authFetch<Site[]>(`/api/construction/sites?status=${status}`)).data); } catch (e) { setErr(errText(e)); }
    }, [authFetch, status]);
    const loadOne = useCallback(async () => {
        if (!id) { setD(null); return; }
        try {
            const r = (await authFetch<SiteDetail>(`/api/construction/sites/${id}`)).data;
            setD(r);
            const f: SiteForm = blankSite();
            Object.keys(f).forEach(k => { const v = (r as unknown as Record<string, unknown>)[k]; f[k] = v === null || v === undefined ? '' : (v as string | number); });
            setForm(f);
        } catch (e) { setErr(errText(e)); }
    }, [authFetch, id]);
    useEffect(() => { if (!id && !isNew) loadList(); }, [loadList, id, isNew]);
    useEffect(() => { loadOne(); }, [loadOne]);
    useEffect(() => { if (isNew) setForm(blankSite()); }, [isNew]);

    const run = async (fn: () => Promise<unknown>, done: string) => {
        setOk(''); setErr(''); setWarn([]);
        try {
            const r = await fn() as { data?: { warnings?: string[] } };
            if (r?.data?.warnings?.length) setWarn(r.data.warnings);
            setOk(done);
            await loadOne();
            return true;
        } catch (e) { setErr(errText(e)); return false; }
    };
    const call = (url: string, body?: unknown, method = 'POST') => authFetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const go = (p: Record<string, string>) => setParams(p);

    const siteForm = (
        <>
            <GroupBox title="Site / contract">
                <div className="nav-form-grid">
                    <label className="nav-label required">Site code</label><input className="nav-input" value={String(form.site_code)} onChange={e => setForm({ ...form, site_code: e.target.value.toUpperCase() })} />
                    <label className="nav-label required">Site / work name</label><input className="nav-input" value={String(form.site_name)} onChange={e => setForm({ ...form, site_name: e.target.value })} />
                    <label className="nav-label">Contract type</label>
                    <select className="nav-select" value={String(form.contract_type)} onChange={e => setForm({ ...form, contract_type: e.target.value })}>
                        <option value="main">Own contract with the client</option><option value="sub">Petti thekka taken from a main contractor</option>
                    </select>
                    <label className="nav-label required">{form.contract_type === 'sub' ? 'Main contractor (ledger)' : 'Client (ledger)'}</label>
                    <LedgerPick listKey="cons_client" ledgers={L.ledgers} value={String(form.client_ledger_id || '')} onChange={v => setForm({ ...form, client_ledger_id: v })} />
                    {form.contract_type === 'sub' && <><label className="nav-label">Project owner / employer</label><input className="nav-input" value={String(form.employer_name)} onChange={e => setForm({ ...form, employer_name: e.target.value })} /></>}
                    <label className="nav-label">Contract no.</label><input className="nav-input" value={String(form.contract_no)} onChange={e => setForm({ ...form, contract_no: e.target.value })} />
                    <label className="nav-label">Contract date</label><input type="date" className="nav-input" value={String(form.contract_date)} onChange={e => setForm({ ...form, contract_date: e.target.value })} />
                    <label className="nav-label">Start / finish</label>
                    <div className="flex gap-1"><input type="date" className="nav-input" value={String(form.start_date)} onChange={e => setForm({ ...form, start_date: e.target.value })} /><input type="date" className="nav-input" value={String(form.end_date)} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
                    <label className="nav-label">Location</label><input className="nav-input" value={String(form.location)} onChange={e => setForm({ ...form, location: e.target.value })} />
                    <label className="nav-label">Site engineer / in-charge</label><input className="nav-input" value={String(form.site_engineer)} onChange={e => setForm({ ...form, site_engineer: e.target.value })} />
                    <label className="nav-label">Material store</label>
                    <select className="nav-select" value={String(form.warehouse_id || '')} onChange={e => setForm({ ...form, warehouse_id: e.target.value })}><option value="">Setup default</option>{L.warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}</select>
                    {!isNew && <><label className="nav-label">Status</label>
                        <select className="nav-select" value={String(form.status)} onChange={e => setForm({ ...form, status: e.target.value })}>{['active', 'on_hold', 'completed', 'closed'].map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select></>}
                </div>
            </GroupBox>
            <GroupBox title="Contract amount & deductions">
                <div className="nav-form-grid">
                    {([['contract_amount', 'Contract amount (without VAT)'], ['vat_percent', 'VAT %'], ['retention_percent', 'Retention %'], ['tds_percent', 'TDS %'], ['advance_amount', 'Mobilisation advance received'], ['advance_recovery_percent', 'Advance recovery % per bill']] as [string, string][]).map(([k, l]) => (
                        <React.Fragment key={k}><label className="nav-label">{l}</label><input type="number" className="nav-input" placeholder={k.endsWith('percent') ? 'setup default' : ''} value={String(form[k] ?? '')} onChange={e => setForm({ ...form, [k]: e.target.value })} /></React.Fragment>
                    ))}
                </div>
            </GroupBox>
            <GroupBox title="Budget (estimated cost)">
                <div className="nav-form-grid">
                    {([['budget_material', 'Material'], ['budget_labour', 'Labour / wages'], ['budget_subcontract', 'Petti thekka (sub-contract)'], ['budget_other', 'Other']] as [string, string][]).map(([k, l]) => (
                        <React.Fragment key={k}><label className="nav-label">{l}</label><input type="number" className="nav-input" value={String(form[k] ?? '')} onChange={e => setForm({ ...form, [k]: e.target.value })} /></React.Fragment>
                    ))}
                    <label className="nav-label">Remarks</label><input className="nav-input" value={String(form.remarks)} onChange={e => setForm({ ...form, remarks: e.target.value })} />
                </div>
            </GroupBox>
        </>
    );
    const cleanForm = () => {
        const b: Record<string, unknown> = { ...form };
        Object.keys(b).forEach(k => { if (b[k] === '' && (k.endsWith('percent'))) delete b[k]; });
        return b;
    };

    // ---------------------------------------------------------------- new site
    if (isNew) {
        return (
            <Layout>
                <NavWindow title="🏗️ New Site / Contract" tools={<button type="button" className="nav-tool-btn" onClick={() => go({})}>← Sites</button>}>
                    <Msg ok={ok} err={err} />
                    {siteForm}
                    <div className="flex justify-end gap-2">
                        <button type="button" className="nav-btn" onClick={() => go({})}>Cancel</button>
                        <button type="button" className="nav-btn primary" onClick={async () => {
                            setErr('');
                            try { const r = await authFetch<Site>('/api/construction/sites', { method: 'POST', body: JSON.stringify(cleanForm()) }); go({ id: r.data.id, tab: 'boq' }); }
                            catch (e) { setErr(errText(e)); }
                        }}>💾 Save site</button>
                    </div>
                </NavWindow>
            </Layout>
        );
    }

    // ---------------------------------------------------------------- one site
    if (id && d) {
        const s = d.summary;
        return (
            <Layout>
                <NavWindow wide title={<>🏗️ {d.site_code} · {d.site_name} <span className="font-normal">({d.contract_type === 'sub' ? 'petti thekka from ' : ''}{d.client_name || 'no client'} · {STATUS_LABEL[d.status]})</span></>} tools={<>
                    <button type="button" className="nav-tool-btn" onClick={() => go({})}>← Sites</button>
                    <span className="nav-tool-sep" />
                    {TABS.map(([k, l]) => <button key={k} type="button" className={`nav-tool-btn ${tab === k ? 'active' : ''}`} onClick={() => go({ id: d.id, tab: k })}>{l}</button>)}
                    <span className="nav-tool-sep" />
                    <button type="button" className="nav-tool-btn" onClick={loadOne}>🔄 Refresh</button>
                    <button type="button" className="nav-tool-btn" onClick={() => window.print()}>🖨️ Print</button>
                </>}>
                    <Msg ok={ok} err={err} warn={warn} />
                    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                        <Kpi label="Contract" value={n2(s.contract.amount)} sub={`to bill ${n2(s.contract.balance_to_bill)}`} />
                        <Kpi label="Billed (work done)" tone="orange" value={pct(s.contract.billed_pct)} sub={`${n2(s.contract.billed_gross)} · ${s.contract.ra_bills} RA`} />
                        <Kpi label="Total cost" value={n2(s.cost.total)} sub={`budget used ${pct(s.budget_used_pct)}`} />
                        <Kpi label="Profit / loss" tone={s.profit >= 0 ? 'green' : 'red'} value={n2(s.profit)} sub={`margin ${pct(s.margin_pct)}`} />
                        <Kpi label="Retention held by client" value={n2(s.contract.retention_held)} sub={`TDS ${n2(s.contract.tds_deducted)}`} />
                        <Kpi label="Advance left to recover" value={n2(s.contract.advance_left)} />
                    </div>
                    {tab === 'overview' && <Overview d={d} />}
                    {tab === 'contract' && (
                        <>
                            {siteForm}
                            <div className="flex justify-end"><button type="button" className="nav-btn primary" onClick={() => run(() => call(`/api/construction/sites/${d.id}`, cleanForm(), 'PUT'), 'Site saved')}>💾 Save</button></div>
                        </>
                    )}
                    {tab === 'boq' && <BoqTab d={d} save={items => run(() => call(`/api/construction/sites/${d.id}/boq`, { items }, 'PUT'), 'BOQ saved')} />}
                    {tab === 'ra' && <RaTab d={d} run={run} call={call} />}
                    {tab === 'material' && <MaterialTab d={d} run={run} call={call} authFetch={authFetch} L={L} />}
                    {tab === 'wages' && <WagesTab d={d} run={run} call={call} L={L} />}
                    {tab === 'sub' && <SubTab d={d} run={run} call={call} L={L} />}
                    {tab === 'other' && (
                        <GroupBox title="Other cost / income - vouchers booked with this site's cost center">
                            <table className="erp-grid-table">
                                <thead><tr><th>Date</th><th>Document</th><th>No.</th><th>Ledger</th><th>Narration</th><th className="text-right">Cost</th><th className="text-right">Income</th></tr></thead>
                                <tbody>{d.other_lines.map((l, i) => (
                                    <tr key={i}><td>{l.date}</td><td>{l.doc_label}</td><td className="font-mono">{l.doc_no}</td><td>{l.ledger_name}</td><td>{l.narration}</td>
                                        <td className="text-right">{l.kind === 'expense' ? n2(l.amount) : ''}</td><td className="text-right">{l.kind === 'income' ? n2(l.amount) : ''}</td></tr>
                                ))}
                                {d.other_lines.length === 0 && <tr><td colSpan={7} className="text-center text-gray-500 py-4">Nothing yet. Choose this site's cost center on a payment, purchase or journal to charge it here.</td></tr>}</tbody>
                                <tfoot><tr><td colSpan={5}>Total</td><td className="text-right">{n2(s.cost.other)}</td><td className="text-right">{n2(s.revenue.other_income)}</td></tr></tfoot>
                            </table>
                        </GroupBox>
                    )}
                </NavWindow>
            </Layout>
        );
    }

    // ---------------------------------------------------------------- list
    return (
        <Layout>
            <NavWindow wide title="🏗️ Construction Sites / Contracts" tools={<>
                <button type="button" className="nav-tool-btn" onClick={() => go({ new: '1' })}>➕ New site</button>
                <span className="nav-tool-sep" />
                {([['active', 'Running'], ['completed', 'Completed'], ['all', 'All']] as [string, string][]).map(([k, l]) => (
                    <button key={k} type="button" className={`nav-tool-btn ${status === k ? 'active' : ''}`} onClick={() => go({ status: k })}>{l}</button>
                ))}
                <span className="nav-tool-sep" />
                <button type="button" className="nav-tool-btn" onClick={loadList}>🔄 Refresh</button>
                <a className="nav-tool-btn" href="/construction/reports?view=profitability">📊 Reports</a>
            </>}>
                <Msg err={err} />
                {id && !d && !err && <p className="text-sm text-gray-500">Loading…</p>}
                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>Code</th><th>Site</th><th>Type</th><th>Client / main contractor</th><th>Status</th><th className="text-right">Contract</th><th className="text-right">Billed %</th><th className="text-right">Billed</th>
                            <th className="text-right">Material</th><th className="text-right">Wages</th><th className="text-right">Petti thekka</th><th className="text-right">Other</th><th className="text-right">Profit / loss</th></tr></thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id} className="cursor-pointer" onClick={() => go({ id: r.id })}>
                                    <td className="font-mono text-blue-700 underline">{r.site_code}</td><td>{r.site_name}</td><td>{r.contract_type === 'sub' ? 'Petti thekka' : 'Own contract'}</td><td>{r.client_name}</td><td>{STATUS_LABEL[r.status]}</td>
                                    <td className="text-right">{n2(r.summary.contract.amount)}</td><td className="text-right">{pct(r.summary.contract.billed_pct)}</td><td className="text-right">{n2(r.summary.revenue.billed)}</td>
                                    <td className="text-right">{n2(r.summary.cost.material)}</td><td className="text-right">{n2(r.summary.cost.wages)}</td><td className="text-right">{n2(r.summary.cost.subcontract)}</td><td className="text-right">{n2(r.summary.cost.other)}</td>
                                    <td className={`text-right ${red(r.summary.profit)}`}>{n2(r.summary.profit)}</td>
                                </tr>
                            ))}
                            {rows.length === 0 && <tr><td colSpan={13} className="text-center text-gray-500 py-6">No sites. Click “New site”.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </NavWindow>
        </Layout>
    );
}

type Run = (fn: () => Promise<unknown>, done: string) => Promise<boolean>;
type Call = (url: string, body?: unknown, method?: string) => Promise<unknown>;
type Lookups = ReturnType<typeof useLookups>;

function Overview({ d }: { d: SiteDetail }) {
    const s = d.summary;
    const rowsB: [string, number, number][] = [['Material', s.cost.material, s.budget.material], ['Labour / wages', s.cost.wages, s.budget.labour], ['Petti thekka (sub-contract)', s.cost.subcontract, s.budget.subcontract], ['Other cost', s.cost.other, s.budget.other]];
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <GroupBox title="Profit / loss of the site">
                <table className="erp-grid-table"><tbody>
                    <tr><td>Work billed (running bills, without VAT)</td><td className="text-right">{n2(s.revenue.billed)}</td></tr>
                    <tr><td>Other income</td><td className="text-right">{n2(s.revenue.other_income)}</td></tr>
                    <tr className="font-semibold"><td>Total income</td><td className="text-right">{n2(s.revenue.total)}</td></tr>
                    <tr><td>Less: material</td><td className="text-right">{n2(s.cost.material)}</td></tr>
                    <tr><td>Less: wages</td><td className="text-right">{n2(s.cost.wages)}</td></tr>
                    <tr><td>Less: petti thekka (sub-contract)</td><td className="text-right">{n2(s.cost.subcontract)}</td></tr>
                    <tr><td>Less: other cost</td><td className="text-right">{n2(s.cost.other)}</td></tr>
                </tbody><tfoot><tr><td>Profit / loss</td><td className={`text-right ${red(s.profit)}`}>{n2(s.profit)}</td></tr></tfoot></table>
            </GroupBox>
            <GroupBox title="Budget vs actual">
                <table className="erp-grid-table">
                    <thead><tr><th>Head</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Left</th><th className="text-right">Used</th></tr></thead>
                    <tbody>{rowsB.map(([l, a, b]) => (
                        <tr key={l}><td>{l}</td><td className="text-right">{n2(b)}</td><td className="text-right">{n2(a)}</td><td className={`text-right ${red(b - a)}`}>{n2(b - a)}</td><td className="text-right">{b ? pct((a * 100) / b) : '—'}</td></tr>
                    ))}</tbody>
                    <tfoot><tr><td>Total</td><td className="text-right">{n2(s.budget.total)}</td><td className="text-right">{n2(s.cost.total)}</td><td className={`text-right ${red(s.budget.total - s.cost.total)}`}>{n2(s.budget.total - s.cost.total)}</td><td className="text-right">{pct(s.budget_used_pct)}</td></tr></tfoot>
                </table>
            </GroupBox>
            <GroupBox title="Client account of this site">
                <table className="erp-grid-table"><tbody>
                    <tr><td>Billed incl. VAT</td><td className="text-right">{n2(s.contract.billed_gross + s.contract.vat)}</td></tr>
                    <tr><td>Retention held</td><td className="text-right">{n2(s.contract.retention_held)}</td></tr>
                    <tr><td>TDS deducted</td><td className="text-right">{n2(s.contract.tds_deducted)}</td></tr>
                    <tr><td>Advance recovered</td><td className="text-right">{n2(s.contract.advance_recovered)}</td></tr>
                </tbody><tfoot><tr><td>Net payable by the client on bills</td><td className="text-right">{n2(s.contract.net_receivable)}</td></tr></tfoot></table>
            </GroupBox>
            <GroupBox title="Petti thekka given">
                <table className="erp-grid-table"><tbody>
                    <tr><td>Sub-contracts</td><td className="text-right">{s.subcontracts.count}</td></tr>
                    <tr><td>Given (contract value)</td><td className="text-right">{n2(s.subcontracts.given)}</td></tr>
                    <tr><td>Billed by sub-contractors</td><td className="text-right">{n2(s.subcontracts.billed)}</td></tr>
                    <tr><td>Retention held from them</td><td className="text-right">{n2(s.subcontracts.retention_held)}</td></tr>
                    <tr><td>TDS deducted</td><td className="text-right">{n2(s.subcontracts.tds)}</td></tr>
                </tbody></table>
                {(s.drafts.ra + s.drafts.wages + s.drafts.sub_bills) > 0 && <p className="text-xs text-orange-700 mt-1">Not posted yet: {s.drafts.ra} running bill(s), {s.drafts.wages} wage sheet(s), {s.drafts.sub_bills} sub-contract bill(s).</p>}
            </GroupBox>
        </div>
    );
}

function BoqTab({ d, save }: { d: SiteDetail; save: (items: Boq[]) => void }) {
    const [items, setItems] = useState<Boq[]>(d.boq.length ? d.boq : [{ item_no: '1', description: '', unit: '', qty: '', rate: '' }]);
    useEffect(() => { setItems(d.boq.length ? d.boq : [{ item_no: '1', description: '', unit: '', qty: '', rate: '' }]); }, [d.boq]);
    const set = (i: number, patch: Partial<Boq>) => setItems(x => x.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const total = items.reduce((t, r) => t + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
    return (
        <GroupBox title="Bill of quantities (contract items)">
            <div className="overflow-x-auto">
                <table className="erp-grid-table">
                    <thead><tr><th style={{ width: 60 }}>No.</th><th style={{ minWidth: 280 }}>Description</th><th style={{ width: 70 }}>Unit</th><th>Qty</th><th>Rate</th><th className="text-right">Amount</th><th className="text-right">Billed qty</th><th className="text-right">Balance</th><th className="text-right">Done</th><th /></tr></thead>
                    <tbody>{items.map((r, i) => (
                        <tr key={r.id || i}>
                            <td><input className="nav-input" value={r.item_no || ''} onChange={e => set(i, { item_no: e.target.value })} /></td>
                            <td><input className="nav-input" value={r.description} onChange={e => set(i, { description: e.target.value })} /></td>
                            <td><input className="nav-input" value={r.unit || ''} onChange={e => set(i, { unit: e.target.value })} /></td>
                            <td><input type="number" className="nav-input" style={{ width: 100 }} value={r.qty} onChange={e => set(i, { qty: e.target.value })} /></td>
                            <td><input type="number" className="nav-input" style={{ width: 100 }} value={r.rate} onChange={e => set(i, { rate: e.target.value })} /></td>
                            <td className="text-right">{n2((Number(r.qty) || 0) * (Number(r.rate) || 0))}</td>
                            <td className="text-right">{r.billed_qty ? n2(r.billed_qty) : ''}</td><td className="text-right">{r.balance_qty !== undefined ? n2(r.balance_qty) : ''}</td><td className="text-right">{r.progress_pct ? pct(r.progress_pct) : ''}</td>
                            <td>{!r.billed_qty && <button type="button" className="nav-btn small" onClick={() => setItems(x => x.filter((_, k) => k !== i))}>✕</button>}</td>
                        </tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={2}><button type="button" className="nav-btn small" onClick={() => setItems(x => [...x, { item_no: String(x.length + 1), description: '', unit: '', qty: '', rate: '' }])}>➕ Item</button></td>
                        <td colSpan={3}>BOQ total</td><td className="text-right">{n2(total)}</td><td colSpan={4} /></tr></tfoot>
                </table>
            </div>
            <div className="flex justify-end mt-2"><button type="button" className="nav-btn primary" onClick={() => save(items)}>💾 Save BOQ</button></div>
        </GroupBox>
    );
}

function RaTab({ d, run, call }: { d: SiteDetail; run: Run; call: Call }) {
    const [f, setF] = useState({ doc_date: today(), period_from: '', period_to: '', gross_amount: '', retention_percent: '', tds_percent: '', advance_recovery: '', other_deduction: '', narration: '' });
    const [qty, setQty] = useState<Record<string, string>>({});
    const lines = d.boq.filter(b => Number(qty[b.id || '']) > 0).map(b => ({ boq_item_id: b.id, qty: Number(qty[b.id || '']) }));
    const gross = d.boq.length ? d.boq.reduce((t, b) => t + (Number(qty[b.id || '']) || 0) * Number(b.rate), 0) : Number(f.gross_amount) || 0;
    const vat = gross * Number(d.vat_percent) / 100;
    const ret = gross * (f.retention_percent !== '' ? Number(f.retention_percent) : Number(d.retention_percent)) / 100;
    const tds = gross * (f.tds_percent !== '' ? Number(f.tds_percent) : Number(d.tds_percent)) / 100;
    const adv = f.advance_recovery !== '' ? Number(f.advance_recovery) : gross * Number(d.advance_recovery_percent) / 100;
    const net = gross + vat - ret - tds - adv - (Number(f.other_deduction) || 0);
    const save = (post: boolean) => run(() => call(`/api/construction/sites/${d.id}/ra-bills`, { ...f, ...(d.boq.length ? { lines } : {}), post }), post ? 'Running bill posted' : 'Running bill saved as draft')
        .then(done => { if (done) setQty({}); });
    const cumulative = d.ra_bills.filter(b => b.status === 'posted').reduce((t, b) => t + Number(b.gross_amount), 0);
    return (
        <>
            {d.status !== 'closed' && (
                <GroupBox title={`New running bill (RA ${d.ra_bills.length + 1}) - billed so far ${n2(cumulative)} of ${n2(d.contract_amount)}`}>
                    <div className="nav-form-grid">
                        <label className="nav-label required">Bill date</label><input type="date" className="nav-input" value={f.doc_date} onChange={e => setF({ ...f, doc_date: e.target.value })} />
                        <label className="nav-label">Work period</label>
                        <div className="flex gap-1"><input type="date" className="nav-input" value={f.period_from} onChange={e => setF({ ...f, period_from: e.target.value })} /><input type="date" className="nav-input" value={f.period_to} onChange={e => setF({ ...f, period_to: e.target.value })} /></div>
                        {!d.boq.length && <><label className="nav-label required">Work done (without VAT)</label><input type="number" className="nav-input" value={f.gross_amount} onChange={e => setF({ ...f, gross_amount: e.target.value })} /></>}
                    </div>
                    {d.boq.length > 0 && (
                        <table className="erp-grid-table mt-2">
                            <thead><tr><th>No.</th><th>Item</th><th>Unit</th><th className="text-right">BOQ qty</th><th className="text-right">Billed before</th><th className="text-right">Balance</th><th>This bill qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
                            <tbody>{d.boq.map(b => (
                                <tr key={b.id}><td>{b.item_no}</td><td>{b.description}</td><td>{b.unit}</td><td className="text-right">{n2(Number(b.qty))}</td><td className="text-right">{n2(b.billed_qty)}</td><td className="text-right">{n2(b.balance_qty)}</td>
                                    <td><input type="number" className="nav-input" style={{ width: 100 }} value={qty[b.id || ''] || ''} onChange={e => setQty({ ...qty, [b.id || '']: e.target.value })} /></td>
                                    <td className="text-right">{n2(Number(b.rate))}</td><td className="text-right">{n2((Number(qty[b.id || '']) || 0) * Number(b.rate))}</td></tr>
                            ))}</tbody>
                        </table>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                        <div className="nav-form-grid">
                            <label className="nav-label">Retention %</label><input type="number" className="nav-input" placeholder={String(d.retention_percent)} value={f.retention_percent} onChange={e => setF({ ...f, retention_percent: e.target.value })} />
                            <label className="nav-label">TDS %</label><input type="number" className="nav-input" placeholder={String(d.tds_percent)} value={f.tds_percent} onChange={e => setF({ ...f, tds_percent: e.target.value })} />
                            <label className="nav-label">Advance recovery</label><input type="number" className="nav-input" placeholder={n2(gross * Number(d.advance_recovery_percent) / 100)} value={f.advance_recovery} onChange={e => setF({ ...f, advance_recovery: e.target.value })} />
                            <label className="nav-label">Other deduction</label><input type="number" className="nav-input" value={f.other_deduction} onChange={e => setF({ ...f, other_deduction: e.target.value })} />
                            <label className="nav-label">Narration</label><input className="nav-input" value={f.narration} onChange={e => setF({ ...f, narration: e.target.value })} />
                        </div>
                        <table className="erp-grid-table"><tbody>
                            <tr><td>Work done this bill</td><td className="text-right">{n2(gross)}</td></tr>
                            <tr><td>Add VAT {d.vat_percent}%</td><td className="text-right">{n2(vat)}</td></tr>
                            <tr><td>Less retention</td><td className="text-right">-{n2(ret)}</td></tr>
                            <tr><td>Less TDS</td><td className="text-right">-{n2(tds)}</td></tr>
                            <tr><td>Less advance recovery</td><td className="text-right">-{n2(adv)}</td></tr>
                            <tr><td>Less other deduction</td><td className="text-right">-{n2(Number(f.other_deduction) || 0)}</td></tr>
                        </tbody><tfoot><tr><td>Net payable by the client</td><td className="text-right">{n2(net)}</td></tr></tfoot></table>
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                        <button type="button" className="nav-btn" disabled={!(gross > 0)} onClick={() => save(false)}>💾 Save draft</button>
                        <button type="button" className="nav-btn primary" disabled={!(gross > 0)} onClick={() => save(true)}>✔ Post running bill</button>
                    </div>
                </GroupBox>
            )}
            <GroupBox title="Running bills">
                <div className="overflow-x-auto">
                    <table className="erp-grid-table">
                        <thead><tr><th>Bill</th><th>Date</th><th>Period</th><th>Status</th><th className="text-right">Work done</th><th className="text-right">VAT</th><th className="text-right">Retention</th><th className="text-right">TDS</th><th className="text-right">Advance</th><th className="text-right">Other</th><th className="text-right">Net</th><th /></tr></thead>
                        <tbody>{d.ra_bills.map(b => (
                            <tr key={b.id} className={b.status === 'cancelled' ? 'text-gray-400 line-through' : ''}>
                                <td className="font-mono">{b.doc_no}</td><td>{b.doc_date}</td><td className="text-xs">{b.period_from ? `${b.period_from} → ${b.period_to || ''}` : ''}</td><td>{STATUS_LABEL[b.status]}</td>
                                <td className="text-right">{n2(b.gross_amount)}</td><td className="text-right">{n2(b.vat_amount)}</td><td className="text-right">{n2(b.retention_amount)}</td><td className="text-right">{n2(b.tds_amount)}</td>
                                <td className="text-right">{n2(b.advance_recovery)}</td><td className="text-right">{n2(b.other_deduction)}</td><td className="text-right font-semibold">{n2(b.net_amount)}</td>
                                <td className="whitespace-nowrap">
                                    {b.status === 'draft' && <button type="button" className="nav-btn small primary" onClick={() => run(() => call(`/api/construction/ra-bills/${b.id}/status`, { status: 'posted' }, 'PUT'), `${b.doc_no} posted`)}>Post</button>}
                                    {b.status === 'draft' && <button type="button" className="nav-btn small danger" onClick={() => window.confirm(`Delete draft ${b.doc_no}?`) && run(() => call(`/api/construction/ra-bills/${b.id}`, undefined, 'DELETE'), 'Deleted')}>✕</button>}
                                    {b.status === 'posted' && <button type="button" className="nav-btn small danger" onClick={() => { const why = window.prompt(`Cancel ${b.doc_no}? Reason:`); if (why) run(() => call(`/api/construction/ra-bills/${b.id}/status`, { status: 'cancelled', cancellation_reason: why }, 'PUT'), `${b.doc_no} cancelled`); }}>Cancel</button>}
                                </td>
                            </tr>
                        ))}
                        {d.ra_bills.length === 0 && <tr><td colSpan={12} className="text-center text-gray-500 py-4">No running bills yet.</td></tr>}</tbody>
                    </table>
                </div>
            </GroupBox>
        </>
    );
}

interface PbLine { bill_detail_id: string; product_name: string; uom_name: string; qty: number; issued: number; left: number; rate: number }
function MaterialTab({ d, run, call, authFetch, L }: { d: SiteDetail; run: Run; call: Call; authFetch: AuthFetch; L: Lookups }) {
    const [mode, setMode] = useState<'store' | 'purchase' | 'return'>('store');
    const [date, setDate] = useState(today());
    const [lines, setLines] = useState([{ product_id: '', qty: '', uom_id: '', rate: '' }]);
    const [bills, setBills] = useState<{ id: string; doc_no: string; doc_date: string; vendor_name: string; items: string }[]>([]);
    const [billId, setBillId] = useState('');
    const [pbLines, setPbLines] = useState<PbLine[]>([]);
    const [pq, setPq] = useState<Record<string, string>>({});
    useEffect(() => { if (mode === 'purchase') authFetch<typeof bills>('/api/construction/purchase-bills').then(r => setBills(r.data)).catch(() => undefined); }, [authFetch, mode]);
    useEffect(() => { setPbLines([]); setPq({}); if (billId) authFetch<{ lines: PbLine[] }>(`/api/construction/purchase-bills/${billId}`).then(r => setPbLines(r.data.lines)).catch(() => undefined); }, [authFetch, billId]);
    const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(x => x.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const submit = async () => {
        const body = mode === 'purchase'
            ? { issue_date: date, purchase_bill_id: billId, lines: Object.entries(pq).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ bill_detail_id: k, qty: Number(v) })) }
            : { issue_date: date, direction: mode === 'return' ? 'in' : 'out', lines: lines.filter(l => l.product_id && Number(l.qty) > 0).map(l => ({ ...l, qty: Number(l.qty), rate: l.rate === '' ? undefined : Number(l.rate) })) };
        const done = await run(() => call(`/api/construction/sites/${d.id}/materials`, body), mode === 'return' ? 'Material returned to store' : 'Material sent to site - site cost updated');
        if (done) { setLines([{ product_id: '', qty: '', uom_id: '', rate: '' }]); setPq({}); setBillId(''); }
    };
    return (
        <>
            <GroupBox title="Material to / from the site">
                <div className="flex flex-wrap gap-4 mb-2 text-sm">
                    {([['store', '📦 From store (stock cost)'], ['purchase', '🛒 Straight from a purchase bill (bill price)'], ['return', '↩ Returned from site to store']] as [typeof mode, string][]).map(([k, l]) => (
                        <label key={k} className="flex items-center gap-1"><input type="radio" checked={mode === k} onChange={() => setMode(k)} /> {l}</label>
                    ))}
                </div>
                <div className="nav-form-grid">
                    <label className="nav-label required">Date</label><input type="date" className="nav-input" value={date} onChange={e => setDate(e.target.value)} />
                    {mode === 'purchase' && <>
                        <label className="nav-label required">Purchase bill</label>
                        <select className="nav-select" value={billId} onChange={e => setBillId(e.target.value)}><option value="">— purchases with items left —</option>{bills.map(b => <option key={b.id} value={b.id}>{b.doc_no} · {b.doc_date} · {b.vendor_name} · {b.items}</option>)}</select>
                    </>}
                </div>
                {mode === 'purchase' ? pbLines.length > 0 && (
                    <table className="erp-grid-table mt-2">
                        <thead><tr><th>Item</th><th className="text-right">Bought</th><th className="text-right">Already sent</th><th className="text-right">Left</th><th className="text-right">Rate</th><th>Qty to this site</th><th className="text-right">Amount</th></tr></thead>
                        <tbody>{pbLines.map(l => (
                            <tr key={l.bill_detail_id}><td>{l.product_name}</td><td className="text-right">{n2(l.qty)} {l.uom_name}</td><td className="text-right">{n2(l.issued)}</td><td className="text-right">{n2(l.left)}</td><td className="text-right">{n2(l.rate)}</td>
                                <td><input type="number" className="nav-input" style={{ width: 100 }} disabled={!l.left} value={pq[l.bill_detail_id] || ''} onChange={e => setPq({ ...pq, [l.bill_detail_id]: e.target.value })} /></td>
                                <td className="text-right">{n2((Number(pq[l.bill_detail_id]) || 0) * l.rate)}</td></tr>
                        ))}</tbody>
                    </table>
                ) : (
                    <table className="erp-grid-table mt-2">
                        <thead><tr><th style={{ minWidth: 240 }}>Item</th><th>Qty</th><th>Unit</th><th>{mode === 'return' ? 'Rate (blank = stock cost)' : 'Rate (blank = stock cost)'}</th><th /></tr></thead>
                        <tbody>{lines.map((l, i) => (
                            <tr key={i}>
                                <td><SearchablePopupSelect listKey="cons_material_picker" columns={[{ key: 'product_code', label: 'Code' }, { key: 'product_name', label: 'Name' }]} defaultVisibleKeys={['product_name']}
                                    items={L.products} getId={p => p.id} getLabel={p => p.product_name} searchKeys={['product_name', 'product_code']} value={l.product_id} onChange={v => setLine(i, { product_id: v, uom_id: '' })} placeholder="Item" /></td>
                                <td><input type="number" className="nav-input" style={{ width: 100 }} value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} /></td>
                                <td><select className="nav-select" value={l.uom_id} onChange={e => setLine(i, { uom_id: e.target.value })}><option value="">Base unit</option>{L.unitsOf(l.product_id).map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select></td>
                                <td><input type="number" className="nav-input" style={{ width: 110 }} value={l.rate} onChange={e => setLine(i, { rate: e.target.value })} /></td>
                                <td><button type="button" className="nav-btn small" onClick={() => setLines(x => (x.length > 1 ? x.filter((_, k) => k !== i) : x))}>✕</button></td>
                            </tr>
                        ))}</tbody>
                        <tfoot><tr><td colSpan={5}><button type="button" className="nav-btn small" onClick={() => setLines(x => [...x, { product_id: '', qty: '', uom_id: '', rate: '' }])}>➕ Item</button></td></tr></tfoot>
                    </table>
                )}
                <div className="flex justify-end mt-2"><button type="button" className="nav-btn primary" onClick={submit}>💾 {mode === 'return' ? 'Return to store' : 'Send to site'}</button></div>
            </GroupBox>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <GroupBox title="Material consumed - by item">
                    <table className="erp-grid-table">
                        <thead><tr><th>Item</th><th className="text-right">Sent</th><th className="text-right">Returned</th><th className="text-right">Net used</th><th className="text-right">Amount</th></tr></thead>
                        <tbody>{d.material_by_item.map(m => <tr key={m.product_id}><td>{m.product_name}</td><td className="text-right">{n2(m.qty_out)}</td><td className="text-right">{n2(m.qty_in)}</td><td className="text-right">{n2(m.net_qty)}</td><td className="text-right">{n2(m.amount)}</td></tr>)}</tbody>
                        <tfoot><tr><td colSpan={4}>Total</td><td className="text-right">{n2(d.summary.cost.material)}</td></tr></tfoot>
                    </table>
                </GroupBox>
                <GroupBox title="Material entries">
                    <table className="erp-grid-table">
                        <thead><tr><th>Date</th><th>Type</th><th>Items</th><th className="text-right">Amount</th><th>Stock doc</th><th /></tr></thead>
                        <tbody>{d.material_issues.map(i => (
                            <tr key={i.id} className={i.adjustment_status === 'cancelled' ? 'text-gray-400 line-through' : ''}><td>{i.issue_date}</td><td>{i.direction === 'in' ? 'Return' : i.bill_no ? `From ${i.bill_no}` : 'From store'}</td>
                                <td className="text-xs">{i.lines.map(l => `${l.product_name} ${n2(l.qty)}`).join(', ')}</td><td className="text-right">{n2(i.total_amount)}</td><td>{i.adjustment_no}</td>
                                <td><button type="button" className="nav-btn small danger" onClick={() => window.confirm('Remove this entry? The stock goes back.') && run(() => call(`/api/construction/materials/${i.id}`, undefined, 'DELETE'), 'Removed')}>✕</button></td></tr>
                        ))}</tbody>
                    </table>
                </GroupBox>
            </div>
        </>
    );
}

function WagesTab({ d, run, call, L }: { d: SiteDetail; run: Run; call: Call; L: Lookups }) {
    const blank = () => ({ worker_name: '', trade: '', days: '', rate: '', ot_hours: '', ot_rate: '' });
    const [f, setF] = useState({ doc_date: today(), period_from: '', period_to: '', pay_ledger_id: '', narration: '' });
    const [lines, setLines] = useState([blank()]);
    const setLine = (i: number, patch: Partial<ReturnType<typeof blank>>) => setLines(x => x.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    const amt = (l: ReturnType<typeof blank>) => (Number(l.days) || 0) * (Number(l.rate) || 0) + (Number(l.ot_hours) || 0) * (Number(l.ot_rate) || 0);
    const total = lines.reduce((t, l) => t + amt(l), 0);
    const save = (post: boolean) => run(() => call(`/api/construction/sites/${d.id}/wage-sheets`, { ...f, lines, post }), post ? 'Wage sheet posted' : 'Wage sheet saved as draft').then(ok2 => { if (ok2) setLines([blank()]); });
    return (
        <>
            <GroupBox title="New wage sheet (hajiri)">
                <div className="nav-form-grid">
                    <label className="nav-label required">Date</label><input type="date" className="nav-input" value={f.doc_date} onChange={e => setF({ ...f, doc_date: e.target.value })} />
                    <label className="nav-label">Period</label>
                    <div className="flex gap-1"><input type="date" className="nav-input" value={f.period_from} onChange={e => setF({ ...f, period_from: e.target.value })} /><input type="date" className="nav-input" value={f.period_to} onChange={e => setF({ ...f, period_to: e.target.value })} /></div>
                    <label className="nav-label">Paid from / payable to</label>
                    <LedgerPick listKey="cons_wage_pay" ledgers={L.ledgers} value={f.pay_ledger_id} onChange={v => setF({ ...f, pay_ledger_id: v })} placeholder="Cash / bank / labour contractor (blank = wages payable)" />
                    <label className="nav-label">Narration</label><input className="nav-input" value={f.narration} onChange={e => setF({ ...f, narration: e.target.value })} />
                </div>
                <table className="erp-grid-table mt-2">
                    <thead><tr><th style={{ minWidth: 180 }}>Worker</th><th>Trade</th><th>Days</th><th>Rate / day</th><th>OT hours</th><th>OT rate</th><th className="text-right">Amount</th><th /></tr></thead>
                    <tbody>{lines.map((l, i) => (
                        <tr key={i}>
                            <td><input className="nav-input" value={l.worker_name} onChange={e => setLine(i, { worker_name: e.target.value })} /></td>
                            <td><input className="nav-input" list="trades" style={{ width: 120 }} value={l.trade} onChange={e => setLine(i, { trade: e.target.value })} /></td>
                            {(['days', 'rate', 'ot_hours', 'ot_rate'] as const).map(k => <td key={k}><input type="number" className="nav-input" style={{ width: 90 }} value={l[k]} onChange={e => setLine(i, { [k]: e.target.value })} /></td>)}
                            <td className="text-right">{n2(amt(l))}</td>
                            <td><button type="button" className="nav-btn small" onClick={() => setLines(x => (x.length > 1 ? x.filter((_, k) => k !== i) : x))}>✕</button></td>
                        </tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={6}><button type="button" className="nav-btn small" onClick={() => setLines(x => [...x, blank()])}>➕ Worker</button></td><td className="text-right">{n2(total)}</td><td /></tr></tfoot>
                </table>
                <datalist id="trades"><option value="Mason" /><option value="Helper" /><option value="Carpenter" /><option value="Bar bender" /><option value="Operator" /><option value="Driver" /><option value="Supervisor" /></datalist>
                <div className="flex justify-end gap-2 mt-2">
                    <button type="button" className="nav-btn" disabled={!total} onClick={() => save(false)}>💾 Save draft</button>
                    <button type="button" className="nav-btn primary" disabled={!total} onClick={() => save(true)}>✔ Post</button>
                </div>
            </GroupBox>
            <GroupBox title="Wage sheets">
                <table className="erp-grid-table">
                    <thead><tr><th>No.</th><th>Date</th><th>Period</th><th>Paid from / payable to</th><th>Status</th><th className="text-right">Amount</th><th /></tr></thead>
                    <tbody>{d.wage_sheets.map(w => (
                        <tr key={w.id} className={w.status === 'cancelled' ? 'text-gray-400 line-through' : ''}><td className="font-mono">{w.doc_no}</td><td>{w.doc_date}</td><td className="text-xs">{w.period_from ? `${w.period_from} → ${w.period_to || ''}` : ''}</td><td>{w.pay_ledger_name}</td><td>{STATUS_LABEL[w.status]}</td><td className="text-right">{n2(w.total_amount)}</td>
                            <td className="whitespace-nowrap">
                                {w.status === 'draft' && <button type="button" className="nav-btn small primary" onClick={() => run(() => call(`/api/construction/wage-sheets/${w.id}/status`, { status: 'posted' }, 'PUT'), `${w.doc_no} posted`)}>Post</button>}
                                {w.status === 'draft' && <button type="button" className="nav-btn small danger" onClick={() => run(() => call(`/api/construction/wage-sheets/${w.id}`, undefined, 'DELETE'), 'Deleted')}>✕</button>}
                                {w.status === 'posted' && <button type="button" className="nav-btn small danger" onClick={() => { const why = window.prompt('Cancel reason:'); if (why) run(() => call(`/api/construction/wage-sheets/${w.id}/status`, { status: 'cancelled', cancellation_reason: why }, 'PUT'), 'Cancelled'); }}>Cancel</button>}
                            </td></tr>
                    ))}
                    {d.wage_sheets.length === 0 && <tr><td colSpan={7} className="text-center text-gray-500 py-4">No wage sheets yet.</td></tr>}</tbody>
                    <tfoot><tr><td colSpan={5}>Posted wages</td><td className="text-right">{n2(d.summary.cost.wages)}</td><td /></tr></tfoot>
                </table>
            </GroupBox>
        </>
    );
}

function SubTab({ d, run, call, L }: { d: SiteDetail; run: Run; call: Call; L: Lookups }) {
    const [f, setF] = useState({ subcontractor_ledger_id: '', work_description: '', contract_amount: '', retention_percent: '', tds_percent: '', start_date: today(), end_date: '' });
    const [billFor, setBillFor] = useState<Subcontract | null>(null);
    const [bf, setBf] = useState({ doc_date: today(), party_bill_no: '', gross_amount: '', advance_recovery: '', other_deduction: '', narration: '' });
    const preview = useMemo(() => {
        if (!billFor) return null;
        const g = Number(bf.gross_amount) || 0;
        const vat = g * billFor.vat_percent / 100, ret = g * billFor.retention_percent / 100, tds = g * billFor.tds_percent / 100;
        return { g, vat, ret, tds, net: g + vat - ret - tds - (Number(bf.advance_recovery) || 0) - (Number(bf.other_deduction) || 0) };
    }, [billFor, bf]);
    return (
        <>
            <GroupBox title="Give petti thekka (sub-contract) on this site">
                <div className="nav-form-grid">
                    <label className="nav-label required">Sub-contractor (ledger)</label>
                    <LedgerPick listKey="cons_subcon" ledgers={L.ledgers} value={f.subcontractor_ledger_id} onChange={v => setF({ ...f, subcontractor_ledger_id: v })} />
                    <label className="nav-label required">Work given</label><input className="nav-input" value={f.work_description} onChange={e => setF({ ...f, work_description: e.target.value })} />
                    <label className="nav-label">Contract amount</label><input type="number" className="nav-input" value={f.contract_amount} onChange={e => setF({ ...f, contract_amount: e.target.value })} />
                    <label className="nav-label">Retention % / TDS %</label>
                    <div className="flex gap-1"><input type="number" className="nav-input" placeholder="setup default" value={f.retention_percent} onChange={e => setF({ ...f, retention_percent: e.target.value })} /><input type="number" className="nav-input" placeholder="setup default" value={f.tds_percent} onChange={e => setF({ ...f, tds_percent: e.target.value })} /></div>
                    <label className="nav-label">Start / finish</label>
                    <div className="flex gap-1"><input type="date" className="nav-input" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} /><input type="date" className="nav-input" value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} /></div>
                </div>
                <div className="flex justify-end mt-2"><button type="button" className="nav-btn primary" onClick={() => run(() => call(`/api/construction/sites/${d.id}/subcontracts`, f), 'Petti thekka saved').then(x => { if (x) setF({ ...f, work_description: '', contract_amount: '' }); })}>💾 Save</button></div>
            </GroupBox>
            {billFor && preview && (
                <GroupBox title={`Bill from ${billFor.subcontractor_name} - ${billFor.work_description}`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="nav-form-grid">
                            <label className="nav-label required">Date</label><input type="date" className="nav-input" value={bf.doc_date} onChange={e => setBf({ ...bf, doc_date: e.target.value })} />
                            <label className="nav-label">Their bill no.</label><input className="nav-input" value={bf.party_bill_no} onChange={e => setBf({ ...bf, party_bill_no: e.target.value })} />
                            <label className="nav-label required">Work done (without VAT)</label><input type="number" className="nav-input" value={bf.gross_amount} onChange={e => setBf({ ...bf, gross_amount: e.target.value })} />
                            <label className="nav-label">Advance recovery</label><input type="number" className="nav-input" value={bf.advance_recovery} onChange={e => setBf({ ...bf, advance_recovery: e.target.value })} />
                            <label className="nav-label">Other deduction</label><input type="number" className="nav-input" value={bf.other_deduction} onChange={e => setBf({ ...bf, other_deduction: e.target.value })} />
                        </div>
                        <table className="erp-grid-table"><tbody>
                            <tr><td>Work done</td><td className="text-right">{n2(preview.g)}</td></tr>
                            <tr><td>Add VAT {billFor.vat_percent}%</td><td className="text-right">{n2(preview.vat)}</td></tr>
                            <tr><td>Less retention {billFor.retention_percent}%</td><td className="text-right">-{n2(preview.ret)}</td></tr>
                            <tr><td>Less TDS {billFor.tds_percent}%</td><td className="text-right">-{n2(preview.tds)}</td></tr>
                        </tbody><tfoot><tr><td>Net payable to the sub-contractor</td><td className="text-right">{n2(preview.net)}</td></tr></tfoot></table>
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                        <button type="button" className="nav-btn" onClick={() => setBillFor(null)}>Close</button>
                        <button type="button" className="nav-btn" disabled={!preview.g} onClick={() => run(() => call(`/api/construction/subcontracts/${billFor.id}/bills`, { ...bf, post: false }), 'Bill saved as draft')}>💾 Save draft</button>
                        <button type="button" className="nav-btn primary" disabled={!preview.g} onClick={() => run(() => call(`/api/construction/subcontracts/${billFor.id}/bills`, { ...bf, post: true }), 'Sub-contract bill posted').then(x => { if (x) setBillFor(null); })}>✔ Post bill</button>
                    </div>
                </GroupBox>
            )}
            {d.subcontracts.map(sc => (
                <GroupBox key={sc.id} title={`${sc.subcontractor_name} - ${sc.work_description} (${STATUS_LABEL[sc.status] || sc.status})`}>
                    <div className="flex flex-wrap gap-4 text-sm mb-2">
                        <span>Given: <b>{n2(sc.contract_amount)}</b></span><span>Billed: <b>{n2(sc.billed)}</b> ({pct(sc.progress_pct)})</span><span>Balance: <b>{n2(sc.balance)}</b></span>
                        <span>Retention held: {n2(sc.retention_held)}</span><span>TDS: {n2(sc.tds)}</span>
                        <button type="button" className="nav-btn small primary ml-auto" onClick={() => { setBillFor(sc); setBf({ doc_date: today(), party_bill_no: '', gross_amount: '', advance_recovery: '', other_deduction: '', narration: '' }); }}>➕ Bill from sub-contractor</button>
                    </div>
                    <table className="erp-grid-table">
                        <thead><tr><th>No.</th><th>Their bill</th><th>Date</th><th>Status</th><th className="text-right">Work done</th><th className="text-right">VAT</th><th className="text-right">Retention</th><th className="text-right">TDS</th><th className="text-right">Net payable</th><th /></tr></thead>
                        <tbody>{sc.bills.map(b => (
                            <tr key={b.id} className={b.status === 'cancelled' ? 'text-gray-400 line-through' : ''}><td className="font-mono">{b.doc_no}</td><td>{b.party_bill_no}</td><td>{b.doc_date}</td><td>{STATUS_LABEL[b.status]}</td>
                                <td className="text-right">{n2(b.gross_amount)}</td><td className="text-right">{n2(b.vat_amount)}</td><td className="text-right">{n2(b.retention_amount)}</td><td className="text-right">{n2(b.tds_amount)}</td><td className="text-right">{n2(b.net_amount)}</td>
                                <td className="whitespace-nowrap">
                                    {b.status === 'draft' && <button type="button" className="nav-btn small primary" onClick={() => run(() => call(`/api/construction/subcontract-bills/${b.id}/status`, { status: 'posted' }, 'PUT'), `${b.doc_no} posted`)}>Post</button>}
                                    {b.status === 'draft' && <button type="button" className="nav-btn small danger" onClick={() => run(() => call(`/api/construction/subcontract-bills/${b.id}`, undefined, 'DELETE'), 'Deleted')}>✕</button>}
                                    {b.status === 'posted' && <button type="button" className="nav-btn small danger" onClick={() => { const why = window.prompt('Cancel reason:'); if (why) run(() => call(`/api/construction/subcontract-bills/${b.id}/status`, { status: 'cancelled', cancellation_reason: why }, 'PUT'), 'Cancelled'); }}>Cancel</button>}
                                </td></tr>
                        ))}
                        {sc.bills.length === 0 && <tr><td colSpan={10} className="text-center text-gray-500">No bills yet.</td></tr>}</tbody>
                    </table>
                </GroupBox>
            ))}
            {d.subcontracts.length === 0 && <p className="text-sm text-gray-500">No petti thekka given on this site.</p>}
        </>
    );
}
