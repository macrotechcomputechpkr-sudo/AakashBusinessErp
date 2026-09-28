// =============================================
// components/MasterCodesEditor.tsx  (System Control > Master Codes)
// How the automatic, read-only master codes look:
//   <fiscal year><separator><TYPE><running number>, e.g. 8182LDG000001
// per master: TYPE letters, separator after the year, body length (digits) and
// total length (the longest code allowed). Ledgers are numbered per type
// (Customer / Supplier / Both / General); Ledger Group has its own. The number
// restarts every fiscal year. Server: routes/masterCodeRoutes.js.
// =============================================
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { AuthFetch } from '../types/erp';

interface Fmt { key: string; label: string; prefix: string; sep: string; digits: number; max_len?: number; example?: string }
interface Data { fy: string; use_fy: boolean; masters: Fmt[] }

const build = (f: Fmt, fy: string, useFy: boolean) => `${useFy ? fy : ''}${useFy && fy ? f.sep : ''}${f.prefix}${'1'.padStart(Number(f.digits) || 6, '0')}`;

export default function MasterCodesEditor() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const [d, setD] = useState<Data | null>(null);
    const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
    useEffect(() => { authFetch<Data>('/api/master-codes/formats').then(r => setD(r.data)).catch(e => setMsg({ err: (e as Error).message })); }, [authFetch]);
    if (!d) return <p className="text-sm text-gray-500">{msg.err || 'Loading…'}</p>;
    const fy = d.fy || '8182';
    const set = (i: number, p: Partial<Fmt>) => setD({ ...d, masters: d.masters.map((m, j) => (j === i ? { ...m, ...p } : m)) });
    const save = async () => {
        setMsg({});
        try { await authFetch('/api/master-codes/formats', { method: 'PUT', body: JSON.stringify({ use_fy: d.use_fy, masters: d.masters }) }); setMsg({ ok: 'Master code format saved - new records use it' }); } catch (e) { setMsg({ err: (e as Error).message }); }
    };
    return (
        <div>
            <div className="nav-groupbox">
                <span className="nav-groupbox-title">Master codes (automatic, read-only on the form)</span>
                <p className="text-xs text-gray-600 mb-2">Code = fiscal year + separator + TYPE + running number. The running number restarts each fiscal year. Current fiscal year code: <b>{d.fy || '— (no current fiscal year)'}</b>. Existing codes are not changed.</p>
                <label className="nav-check mb-2"><input type="checkbox" checked={d.use_fy} onChange={e => setD({ ...d, use_fy: e.target.checked })} /> Start codes with the fiscal year (e.g. 8182)</label>
                {msg.err && <div className="nav-msg err">{msg.err}</div>}
                {msg.ok && <div className="nav-msg ok">{msg.ok}</div>}
                <div className="overflow-x-auto">
                    <table className="erp-grid-table" data-no-excel>
                        <thead><tr><th>Master</th><th>TYPE letters</th><th>Separator after year</th><th>Body length</th><th>Total length</th><th>First code will look like</th></tr></thead>
                        <tbody>{d.masters.map((m, i) => (
                            <tr key={m.key}>
                                <td>{m.label}</td>
                                <td><input className="nav-input" style={{ width: 100 }} maxLength={6} value={m.prefix} onChange={e => set(i, { prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></td>
                                <td><select className="nav-select" style={{ width: 130 }} value={m.sep} onChange={e => set(i, { sep: e.target.value })}><option value="">none</option><option value="-">- (dash)</option><option value="/">/ (slash)</option></select></td>
                                <td><input type="number" min={3} max={9} className="nav-input" style={{ width: 70 }} value={m.digits} onChange={e => set(i, { digits: Number(e.target.value) })} /></td>
                                <td><input type="number" min={6} max={40} className="nav-input" style={{ width: 70 }} value={m.max_len || 15} onChange={e => set(i, { max_len: Number(e.target.value) })} title="Longest code allowed" /></td>
                                <td className="font-mono font-semibold text-[#1a4a8a]">{build(m, fy, d.use_fy)}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
                <div className="mt-3"><button type="button" className="nav-btn primary" onClick={save}>💾 Save code format</button></div>
            </div>
        </div>
    );
}
