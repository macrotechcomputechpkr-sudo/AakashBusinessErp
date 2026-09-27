// =============================================
// construction/ConstructionSetup.tsx  (/construction/setup)
// Ledgers the construction postings use (contract revenue, retention and TDS
// receivable / payable, sub-contract cost, wages), the store material goes
// out of, and default VAT / retention / TDS %. Server: utils/construction.js.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Layout from '../../components/Layout';
import type { AuthFetch } from '../../types/erp';
import { GroupBox, Msg, NavWindow, errText, useLookups } from '../../components/poultry/common';
import { LedgerPick } from './common';

type Settings = Record<string, string | number | null>;
const LEDGERS: [string, string, string][] = [
    ['revenue_ledger_id', 'Contract Revenue (work done)', 'Income ledger - running bills to the client are credited here'],
    ['retention_receivable_ledger_id', 'Retention Receivable', 'Retention the client holds back from each running bill'],
    ['tds_receivable_ledger_id', 'TDS Receivable (advance tax)', 'TDS the client deducts from each running bill'],
    ['subcontract_cost_ledger_id', 'Sub-contract (Petti Thekka) Cost', 'Expense ledger - bills of sub-contractors you give work to'],
    ['retention_payable_ledger_id', 'Retention Payable', 'Retention you hold back from sub-contractors'],
    ['tds_payable_ledger_id', 'TDS Payable', 'TDS you deduct from sub-contractors'],
    ['wages_ledger_id', 'Site Wages', 'Expense ledger - labour wage sheets'],
    ['wages_payable_ledger_id', 'Wages Payable (default)', 'Credited when a wage sheet does not name cash / bank / labour contractor'],
    ['material_ledger_id', 'Material Consumed at Site', 'Used when stock adjustments post to the GL']
];

export default function ConstructionSetup() {
    const { authFetch } = useAuth() as { authFetch: AuthFetch };
    const L = useLookups(authFetch, { ledgers: true });
    const [s, setS] = useState<Settings | null>(null);
    const [ok, setOk] = useState('');
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        try { setS((await authFetch<Settings>('/api/construction/settings')).data); } catch (e) { setErr(errText(e)); }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);
    const save = async () => {
        setOk(''); setErr('');
        try { setS((await authFetch<Settings>('/api/construction/settings', { method: 'PUT', body: JSON.stringify(s) })).data); setOk('Construction setup saved'); } catch (e) { setErr(errText(e)); }
    };
    return (
        <Layout>
            <NavWindow title="⚙️ Construction Setup" tools={<button type="button" className="nav-tool-btn" onClick={save}>💾 Save</button>}>
                <Msg ok={ok} err={err} />
                {!s ? <p className="text-sm text-gray-500">Loading…</p> : (
                    <>
                        <GroupBox title="Ledgers">
                            <div className="nav-form-grid">
                                {LEDGERS.map(([k, label, hint]) => (
                                    <React.Fragment key={k}>
                                        <label className="nav-label" title={hint}>{label}</label>
                                        <LedgerPick listKey={`cons_${k}`} ledgers={L.ledgers} value={String(s[k] || '')} onChange={v => setS({ ...s, [k]: v || null })} />
                                    </React.Fragment>
                                ))}
                            </div>
                        </GroupBox>
                        <GroupBox title="Defaults for a new site / sub-contract">
                            <div className="nav-form-grid">
                                <label className="nav-label">Material store (warehouse)</label>
                                <select className="nav-select" value={String(s.default_warehouse_id || '')} onChange={e => setS({ ...s, default_warehouse_id: e.target.value || null })}>
                                    <option value="">—</option>{L.warehouses.map(w => <option key={w.id} value={w.id}>{w.warehouse_name}</option>)}
                                </select>
                                {([['default_vat_percent', 'VAT %'], ['default_retention_percent', 'Retention %'], ['default_tds_percent', 'TDS %']] as [string, string][]).map(([k, l]) => (
                                    <React.Fragment key={k}>
                                        <label className="nav-label">{l}</label>
                                        <input type="number" className="nav-input" value={String(s[k] ?? '')} onChange={e => setS({ ...s, [k]: e.target.value })} />
                                    </React.Fragment>
                                ))}
                            </div>
                        </GroupBox>
                        <p className="text-xs text-gray-600">Every site gets its own Cost Center. Any purchase, payment or journal booked with that cost center is counted as that site's other cost / income automatically.</p>
                    </>
                )}
            </NavWindow>
        </Layout>
    );
}
