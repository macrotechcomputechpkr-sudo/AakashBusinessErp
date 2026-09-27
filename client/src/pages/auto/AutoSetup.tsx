// =============================================
// auto/AutoSetup.tsx  (/auto/setup)
// Ledgers the workshop posts to, the parts store, VAT %, service interval,
// free-service schedule given at delivery and the PDI checklist.
// Server: utils/automobile.js.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Msg, NavWindow, errText, useLookups } from '../../components/poultry/common';
import { LedgerPick } from '../construction/common';

interface FreeSvc { name: string; days: number | string; km: number | string }
interface Settings { [k: string]: unknown; free_services: FreeSvc[]; pdi_checklist: string[] }
const LEDGERS: [string, string][] = [
    ['parts_sales_ledger_id', 'Spare Parts Sales'], ['labour_income_ledger_id', 'Labour / Service Income'], ['outside_work_income_ledger_id', 'Outside Work Income (charged to customer)'],
    ['outside_work_cost_ledger_id', 'Outside Work Cost'], ['parts_consumption_ledger_id', 'Parts Consumed (cost)'], ['cash_ledger_id', 'Cash (walk-in job cards)']
];

export default function AutoSetup() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const L = useLookups(authFetch, { ledgers: true });
    const [s, setS] = useState<Settings | null>(null);
    const [pdiText, setPdiText] = useState('');
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        try { const r = (await authFetch<Settings>('/api/auto/settings')).data; setS(r); setPdiText(r.pdi_checklist.join('\n')); } catch (e) { setErr(errText(e)); }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);
    const save = async () => {
        setOk(''); setErr('');
        try {
            const r = (await authFetch<Settings>('/api/auto/settings', { method: 'PUT', body: JSON.stringify({ ...s, pdi_checklist: pdiText.split('\n').map(x => x.trim()).filter(Boolean) }) })).data;
            setS(r); setPdiText(r.pdi_checklist.join('\n')); setOk('Automobile setup saved');
        } catch (e) { setErr(errText(e)); }
    };
    const setFs = (i: number, patch: Partial<FreeSvc>) => s && setS({ ...s, free_services: s.free_services.map((f, k) => (k === i ? { ...f, ...patch } : f)) });
    return (
        <Layout>
            <NavWindow title="⚙️ Automobile Setup" tools={<button type="button" className="nav-tool-btn" onClick={save}>💾 Save</button>}>
                <Msg ok={ok} err={err} />
                {!s ? <p className="text-sm text-gray-500">Loading…</p> : (
                    <>
                        <GroupBox title="Workshop ledgers">
                            <div className="nav-form-grid">
                                {LEDGERS.map(([k, l]) => (
                                    <React.Fragment key={k}><label className="nav-label">{l}</label>
                                        <LedgerPick listKey={`auto_${k}`} ledgers={L.ledgers} value={String(s[k] || '')} onChange={v => setS({ ...s, [k]: v || null })} /></React.Fragment>
                                ))}
                                <label className="nav-label">Parts store (warehouse)</label>
                                <select className="nav-select" value={String(s.parts_warehouse_id || '')} onChange={e => setS({ ...s, parts_warehouse_id: e.target.value || null })}><option value="">—</option>{L.warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}</select>
                                <label className="nav-label">VAT % on job cards</label><input type="number" className="nav-input" value={String(s.vat_percent ?? '')} onChange={e => setS({ ...s, vat_percent: e.target.value })} />
                            </div>
                        </GroupBox>
                        <GroupBox title="Service reminders">
                            <div className="nav-form-grid">
                                <label className="nav-label">Next paid service after (days)</label><input type="number" className="nav-input" value={String(s.service_interval_days ?? '')} onChange={e => setS({ ...s, service_interval_days: e.target.value })} />
                                <label className="nav-label">… or after (km)</label><input type="number" className="nav-input" value={String(s.service_interval_km ?? '')} onChange={e => setS({ ...s, service_interval_km: e.target.value })} />
                            </div>
                            <table className="erp-grid-table mt-2">
                                <thead><tr><th>Free service given at vehicle delivery</th><th>Days after delivery</th><th>Km</th><th /></tr></thead>
                                <tbody>{s.free_services.map((f, i) => (
                                    <tr key={i}><td><input className="nav-input" value={f.name} onChange={e => setFs(i, { name: e.target.value })} /></td>
                                        <td><input type="number" className="nav-input" style={{ width: 90 }} value={f.days} onChange={e => setFs(i, { days: e.target.value })} /></td>
                                        <td><input type="number" className="nav-input" style={{ width: 100 }} value={f.km} onChange={e => setFs(i, { km: e.target.value })} /></td>
                                        <td><button type="button" className="nav-btn small" onClick={() => setS({ ...s, free_services: s.free_services.filter((_, k) => k !== i) })}>✕</button></td></tr>
                                ))}</tbody>
                                <tfoot><tr><td colSpan={4}><button type="button" className="nav-btn small" onClick={() => setS({ ...s, free_services: [...s.free_services, { name: `${s.free_services.length + 1} free service`, days: 360, km: 15000 }] })}>➕ Free service</button></td></tr></tfoot>
                            </table>
                        </GroupBox>
                        <GroupBox title="PDI checklist (one item per line)">
                            <textarea className="nav-input" style={{ height: 220, width: '100%' }} value={pdiText} onChange={e => setPdiText(e.target.value)} />
                        </GroupBox>
                    </>
                )}
            </NavWindow>
        </Layout>
    );
}
