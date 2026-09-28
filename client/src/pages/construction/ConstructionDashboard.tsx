// =============================================
// construction/ConstructionDashboard.tsx  (/construction)
// All sites at a glance: contract value, billed %, cost, profit / loss,
// retention held and what is still to bill. Server: utils/construction.js dashboard().
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { Kpi, Msg, NavWindow, errText, n2, pct } from '../../components/poultry/common';
import { STATUS_LABEL } from './common';

interface Dash {
    kpis: { sites: number; active: number; contract_value: number; billed: number; cost: number; profit: number; retention_held: number; to_bill: number };
    sites: { id: string; site_code: string; site_name: string; contract_type: string; client_name: string; status: string; contract_amount: number; billed_pct: number | null; billed: number; cost: number; profit: number; budget_used_pct: number | null; end_date: string | null; drafts: { ra: number; wages: number; sub_bills: number } }[];
}

export default function ConstructionDashboard() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [d, setD] = useState<Dash | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => { authFetch<Dash>('/api/construction/dashboard').then(r => setD(r.data)).catch(e => setErr(errText(e))); }, [authFetch]);
    const k = d?.kpis;
    return (
        <Layout>
            <NavWindow wide title="🏗️ Construction Dashboard" tools={<>
                <a className="nav-tool-btn" href="/construction/sites">🏗️ Sites</a><a className="nav-tool-btn" href="/construction/sites?new=1">➕ New site</a>
                <a className="nav-tool-btn" href="/construction/reports?view=profitability">📊 Reports</a><a className="nav-tool-btn" href="/construction/setup">⚙️ Setup</a>
            </>}>
                <Msg err={err} />
                {k && (
                    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                        <Kpi label="Running sites" value={`${k.active} / ${k.sites}`} />
                        <Kpi label="Contract value (running)" value={n2(k.contract_value)} sub={`still to bill ${n2(k.to_bill)}`} />
                        <Kpi label="Billed (all sites)" tone="orange" value={n2(k.billed)} />
                        <Kpi label="Cost (all sites)" value={n2(k.cost)} />
                        <Kpi label="Profit / loss" tone={k.profit >= 0 ? 'green' : 'red'} value={n2(k.profit)} />
                        <Kpi label="Retention held by clients" value={n2(k.retention_held)} />
                    </div>
                )}
                {d && (
                    <div className="overflow-x-auto">
                        <table className="erp-grid-table">
                            <thead><tr><th>Site</th><th>Type</th><th>Client</th><th>Status</th><th>Finish</th><th className="text-right">Contract</th><th className="text-right">Billed %</th><th className="text-right">Billed</th><th className="text-right">Cost</th><th className="text-right">Budget used</th><th className="text-right">Profit / loss</th><th>Pending</th></tr></thead>
                            <tbody>{d.sites.map(s => (
                                <tr key={s.id} className="cursor-pointer" onClick={() => { window.location.href = `/construction/sites?id=${s.id}`; }}>
                                    <td><span className="font-mono text-blue-700 underline">{s.site_code}</span> {s.site_name}</td><td>{s.contract_type === 'sub' ? 'Petti thekka' : 'Own'}</td><td>{s.client_name}</td><td>{STATUS_LABEL[s.status]}</td><td>{s.end_date || ''}</td>
                                    <td className="text-right">{n2(s.contract_amount)}</td><td className="text-right">{pct(s.billed_pct)}</td><td className="text-right">{n2(s.billed)}</td><td className="text-right">{n2(s.cost)}</td>
                                    <td className={`text-right ${(s.budget_used_pct || 0) > 100 ? 'text-red-700' : ''}`}>{pct(s.budget_used_pct)}</td><td className={`text-right ${s.profit < 0 ? 'text-red-700' : ''}`}>{n2(s.profit)}</td>
                                    <td className="text-xs text-orange-700">{[s.drafts.ra && `${s.drafts.ra} RA`, s.drafts.wages && `${s.drafts.wages} wage`, s.drafts.sub_bills && `${s.drafts.sub_bills} sub bill`].filter(Boolean).join(', ')}</td>
                                </tr>
                            ))}
                            {d.sites.length === 0 && <tr><td colSpan={12} className="text-center text-gray-500 py-6">No sites yet.</td></tr>}</tbody>
                        </table>
                    </div>
                )}
            </NavWindow>
        </Layout>
    );
}
