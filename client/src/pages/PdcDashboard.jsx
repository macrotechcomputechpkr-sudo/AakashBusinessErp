// =============================================
// PdcDashboard.jsx
// PDC Dashboard & Report (server: utils/pdcReport.js) - post-dated cheques
// received and issued as on a date:
//   cards   - matured (ready to post), due within N days, not matured,
//             posted - partly adjusted, returned, cancelled
//   report  - filters: received / issued, status (pending, posted, partly
//             adjusted, returned, cancelled), maturity, cheque / entry date
//             range, party, bank ledger, bank name, cheque no, amount range;
//             group by party / bank / cheque month / status
//   actions - Post (posting date, bank ledger, posting no), Return / Bounce,
//             Cancel - one cheque or the ticked ones - through the normal PDC
//             status API (GL + bill-wise settlement happen there)
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';

const iso = d => d.toISOString().slice(0, 10);
const fmt2 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUSES = [['pending', 'Pending'], ['partly_adjusted', 'Posted - partly adjusted'], ['posted', 'Posted'], ['returned', 'Returned'], ['cancelled', 'Cancelled']];
const MATURITY = [['matured', 'Matured (past cheque date)'], ['due_today', 'Due today'], ['due_within', 'Due within N days'], ['not_matured', 'Not matured']];
const BADGE = { pending: 'bg-yellow-100 text-yellow-800', partly_adjusted: 'bg-orange-100 text-orange-800', posted: 'bg-green-100 text-green-800', returned: 'bg-red-100 text-red-800', cancelled: 'bg-gray-200 text-gray-600' };
const MAT_BADGE = { matured: 'text-red-700 font-semibold', due_today: 'text-orange-700 font-semibold', due_within: 'text-amber-700', not_matured: 'text-gray-500' };

const defaultConfig = () => ({ as_on: iso(new Date()), due_within: '7', voucher_type: '', statuses: ['pending'], maturity: [], date_basis: 'cheque_date', date_from: '', date_to: '',
    party_ids: [], bank_ledger_ids: [], bank_name: '', cheque_no: '', amount_min: '', amount_max: '', group_by: '' });

export default function PdcDashboard() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [data, setData] = useState(null);
    const [parties, setParties] = useState([]);
    const [ledgers, setLedgers] = useState([]);
    const [selected, setSelected] = useState(() => new Set());
    const [modal, setModal] = useState(null);            // { action, rows, posting_date_mode, posting_date, bank_ledger_id, posting_no, reason }
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState([]);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const toggle = (k, v) => setConfig(c => ({ ...c, [k]: c[k].includes(v) ? c[k].filter(x => x !== v) : [...c[k], v] }));

    useEffect(() => {
        authFetch('/api/reports/ageing/meta').then(r => setParties([...(r.data?.customers || []), ...(r.data?.suppliers || [])].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
        authFetch('/api/ledger-accounts?pageSize=1000&sortBy=account_name&sortDir=asc').then(r => setLedgers((r.data || []).map(l => ({ id: l.id, name: l.account_name })))).catch(() => {});
    }, [authFetch]);

    const run = useCallback(async (cfg = config) => {
        setError('');
        try {
            const p = new URLSearchParams({ as_on: cfg.as_on, due_within: cfg.due_within || '7', date_basis: cfg.date_basis });
            ['voucher_type', 'date_from', 'date_to', 'bank_name', 'cheque_no', 'amount_min', 'amount_max', 'group_by'].forEach(k => { if (cfg[k] !== '') p.set(k, cfg[k]); });
            ['statuses', 'maturity', 'party_ids', 'bank_ledger_ids'].forEach(k => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            setData((await authFetch(`/api/reports/pdc?${p}`)).data); setSelected(new Set());
        } catch (e) { setError(e.message); }
    }, [authFetch, config]);
    useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // A card sets the filters and shows its cheques.
    const openCard = (type, statuses, maturity) => { const next = { ...config, voucher_type: type, statuses, maturity }; setConfig(next); run(next); };
    const rows = useMemo(() => data?.rows || [], [data]);
    const selRows = rows.filter(r => selected.has(r.id));
    const toggleRow = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const openAction = (action, list) => {
        if (!list.length) return;
        setResults([]);
        setModal({ action, rows: list, posting_date_mode: 'cheque', posting_date: iso(new Date()), bank_ledger_id: '', posting_no: '', reason: '' });
    };
    const doAction = async () => {
        const m = modal;
        if (m.action !== 'post' && !m.reason.trim()) { setError('A reason is required'); return; }
        if (m.action === 'post' && m.rows.some(r => !r.bank_ledger_id) && !m.bank_ledger_id) { setError('Choose the Bank Ledger for cheques that have none'); return; }
        setBusy(true); setError('');
        const out = [];
        for (const r of m.rows) {
            const body = m.action === 'post'
                ? { status: 'posted', posting_date: m.posting_date_mode === 'cheque' ? (r.cheque_date > iso(new Date()) ? iso(new Date()) : r.cheque_date) : m.posting_date,
                    posting_no: m.posting_no || undefined, bank_ledger_id: r.bank_ledger_id ? undefined : m.bank_ledger_id }
                : m.action === 'return' ? { status: 'returned', return_reason: m.reason } : { status: 'cancelled', cancellation_reason: m.reason };
            try { await authFetch(`/api/pdc-vouchers/${r.id}/status`, { method: 'PUT', body: JSON.stringify(body) }); out.push({ doc_no: r.doc_no, ok: true }); }
            catch (e) { out.push({ doc_no: r.doc_no, ok: false, error: e.message }); }
        }
        setResults(out); setBusy(false); setModal(null); run();
    };

    const exportCsv = () => {
        if (!data) return;
        const head = ['Doc No', 'Date', 'Type', 'Party', 'Cheque No', 'Cheque Date', 'Days to maturity', 'Bank', 'Bank Ledger', 'Amount', 'Status', 'Maturity', 'Adjusted', 'Unadjusted', 'Posting Date', 'Reason'];
        const lines = rows.map(r => [r.doc_no, r.doc_date, r.voucher_type, r.party_name, r.cheque_no, r.cheque_date, r.days_to_maturity ?? '', r.bank_name, r.bank_ledger_name, r.amount, r.status_label, r.maturity || '',
            r.adjusted ?? '', r.unadjusted ?? '', r.posting_date || '', r.return_reason || r.cancellation_reason || '']);
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...lines].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `pdc_${data.as_on}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    const card = (type, label, key, statuses, maturity, tone) => {
        const s = data?.summary?.[type]?.[key] || { count: 0, amount: 0 };
        return (
            <button key={`${type}${key}`} className={`text-left border rounded-lg p-2 hover:shadow ${tone}`} onClick={() => openCard(type, statuses, maturity)}>
                <div className="text-xs text-gray-600">{label}</div>
                <div className="text-lg font-bold tabular-nums">{fmt2(s.amount)}</div>
                <div className="text-xs text-gray-500">{s.count} cheque{s.count === 1 ? '' : 's'}</div>
            </button>
        );
    };
    const rowView = r => (
        <tr key={r.id} className={r.maturity === 'matured' ? 'bg-red-50' : r.maturity === 'due_today' ? 'bg-orange-50' : ''}>
            <td className="print:hidden">{r.status === 'pending' && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />}</td>
            <td>{r.doc_no}<div className="text-[10px] text-gray-400">{r.doc_date}</div></td>
            <td className={r.voucher_type === 'received' ? 'text-green-700' : 'text-blue-700'}>{r.voucher_type === 'received' ? 'Received' : 'Issued'}</td>
            <td>{r.party_name}{r.sub_ledger_name ? <span className="text-xs text-gray-400"> / {r.sub_ledger_name}</span> : null}</td>
            <td>{r.cheque_no}{r.is_online_pdc ? <span className="text-[10px] ml-1 text-gray-500">online</span> : null}</td>
            <td>{r.cheque_date}</td>
            <td className={`text-right ${MAT_BADGE[r.maturity] || ''}`}>{r.days_to_maturity === null ? '' : r.days_to_maturity < 0 ? `${-r.days_to_maturity} days ago` : r.days_to_maturity === 0 ? 'today' : `in ${r.days_to_maturity} d`}</td>
            <td>{r.bank_name}<div className="text-[10px] text-gray-400">{r.bank_ledger_name}</div></td>
            <td className="text-right tabular-nums font-semibold">{fmt2(r.amount)}</td>
            <td><span className={`px-2 py-0.5 rounded text-xs ${BADGE[r.view_status]}`}>{r.status_label}</span>
                {r.view_status === 'partly_adjusted' && <div className="text-[10px] text-orange-700">unadjusted {fmt2(r.unadjusted)}</div>}
                {(r.return_reason || r.cancellation_reason) && <div className="text-[10px] text-gray-500">{r.return_reason || r.cancellation_reason}</div>}
                {r.posting_date && <div className="text-[10px] text-gray-500">posted {r.posting_date}</div>}</td>
            <td className="print:hidden whitespace-nowrap">
                {r.status === 'pending' && <button className="px-2 py-1 bg-green-600 text-white rounded text-xs mr-1" onClick={() => openAction('post', [r])}>Post</button>}
                {['pending', 'posted'].includes(r.status) && <button className="px-2 py-1 bg-orange-600 text-white rounded text-xs mr-1" onClick={() => openAction('return', [r])}>{r.status === 'posted' ? 'Bounce' : 'Return'}</button>}
                {r.status === 'pending' && <button className="px-2 py-1 bg-red-600 text-white rounded text-xs" onClick={() => openAction('cancel', [r])}>Cancel</button>}
            </td>
        </tr>
    );
    const head = (
        <thead><tr>
            <th className="print:hidden"><input type="checkbox" checked={rows.some(r => r.status === 'pending') && rows.filter(r => r.status === 'pending').every(r => selected.has(r.id))}
                onChange={e => setSelected(e.target.checked ? new Set(rows.filter(r => r.status === 'pending').map(r => r.id)) : new Set())} /></th>
            <th className="text-left">PDC</th><th className="text-left">Type</th><th className="text-left">Party</th><th className="text-left">Cheque No</th><th className="text-left">Cheque Date</th>
            <th className="text-right">Maturity</th><th className="text-left">Bank</th><th className="text-right">Amount</th><th className="text-left">Status</th><th className="print:hidden" />
        </tr></thead>
    );

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header print:hidden"><span className="erp-header-title">🏦 PDC Dashboard & Report</span></div>
            <div className="erp-tab-content">
                <div className="print:hidden">
                    {data && ['received', 'issued'].map(type => (
                        <div key={type} className="mb-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{type === 'received' ? '📥 Received (from customers)' : '📤 Issued (to suppliers)'}</p>
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                                {card(type, '⚠ Matured - to post', 'matured', ['pending'], ['matured', 'due_today'], 'border-red-300 bg-red-50')}
                                {card(type, `Due within ${data.due_within} days`, 'due_within', ['pending'], ['due_within'], 'border-amber-300 bg-amber-50')}
                                {card(type, 'Not matured', 'not_matured', ['pending'], ['not_matured'], 'bg-white')}
                                {card(type, 'Posted - partly adjusted', 'partly_adjusted', ['partly_adjusted'], [], 'border-orange-300 bg-orange-50')}
                                {card(type, 'Returned / Bounced', 'returned', ['returned'], [], 'bg-white')}
                                {card(type, 'Cancelled', 'cancelled', ['cancelled'], [], 'bg-white')}
                            </div>
                        </div>
                    ))}

                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
                        <div className="erp-field"><label className="erp-label">As on</label><input type="date" className="erp-input" value={config.as_on} onChange={e => set('as_on', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">Type</label>
                            <select className="erp-select" value={config.voucher_type} onChange={e => set('voucher_type', e.target.value)}><option value="">Received + Issued</option><option value="received">Received</option><option value="issued">Issued</option></select></div>
                        <div className="erp-field"><label className="erp-label">Date range on</label>
                            <select className="erp-select" value={config.date_basis} onChange={e => set('date_basis', e.target.value)}><option value="cheque_date">Cheque date</option><option value="doc_date">Entry date</option></select></div>
                        <div className="erp-field"><label className="erp-label">From</label><input type="date" className="erp-input" value={config.date_from} onChange={e => set('date_from', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">To</label><input type="date" className="erp-input" value={config.date_to} onChange={e => set('date_to', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">"Due within" days</label><input type="number" className="erp-input" value={config.due_within} onChange={e => set('due_within', e.target.value)} /></div>
                        <MultiPick label="Party" items={parties} value={config.party_ids} onChange={v => set('party_ids', v)} />
                        <MultiPick label="Bank Ledger" items={ledgers} value={config.bank_ledger_ids} onChange={v => set('bank_ledger_ids', v)} />
                        <div className="erp-field"><label className="erp-label">Bank name</label><input className="erp-input" value={config.bank_name} onChange={e => set('bank_name', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">Cheque no</label><input className="erp-input" value={config.cheque_no} onChange={e => set('cheque_no', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} /></div>
                        <div className="erp-field"><label className="erp-label">Amount from</label><input type="number" className="erp-input" value={config.amount_min} onChange={e => set('amount_min', e.target.value)} /></div>
                        <div className="erp-field"><label className="erp-label">Amount to</label><input type="number" className="erp-input" value={config.amount_max} onChange={e => set('amount_max', e.target.value)} /></div>
                    </div>
                    <div className="flex flex-wrap gap-4 items-center text-sm mb-2">
                        <span className="text-gray-500">Status:</span>
                        {STATUSES.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={config.statuses.includes(k)} onChange={() => toggle('statuses', k)} /> {l}</label>)}
                    </div>
                    <div className="flex flex-wrap gap-4 items-center text-sm mb-3">
                        <span className="text-gray-500">Maturity:</span>
                        {MATURITY.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={config.maturity.includes(k)} onChange={() => toggle('maturity', k)} /> {l}</label>)}
                        <label className="flex items-center gap-2 ml-4">Group by
                            <select className="erp-select w-auto" value={config.group_by} onChange={e => set('group_by', e.target.value)}>
                                <option value="">None</option><option value="party">Party</option><option value="bank">Bank</option><option value="cheque_month">Cheque month</option><option value="status">Status</option>
                            </select></label>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                        <button className="erp-btn primary" onClick={() => run()}>🔍 Show</button>
                        <button className="erp-btn" disabled={!selRows.length} onClick={() => openAction('post', selRows)}>✔ Post ticked ({selRows.length})</button>
                        <button className="erp-btn" disabled={!selRows.length} onClick={() => openAction('cancel', selRows)}>✕ Cancel ticked</button>
                        {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                        {data && <button className="erp-btn" onClick={() => window.print()}>🖨 Print / PDF</button>}
                        <button className="erp-btn" onClick={() => { const d = defaultConfig(); setConfig(d); run(d); }}>↺ Reset</button>
                    </div>
                    {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                    {results.length > 0 && (
                        <div className="mb-3 border rounded p-2 text-sm bg-gray-50">
                            {results.map((x, i) => <div key={i} className={x.ok ? 'text-green-700' : 'text-red-700'}>{x.ok ? '✓' : '✗'} {x.doc_no}{x.error ? ` - ${x.error}` : ''}</div>)}
                        </div>
                    )}
                </div>

                {data && (
                    <div className="overflow-x-auto text-sm">
                        <p className="text-xs text-gray-600 mb-1">As on {data.as_on} · {data.totals.count} cheques · Received {fmt2(data.totals.received)} · Issued {fmt2(data.totals.issued)}</p>
                        <table className="erp-grid-table w-full">
                            {head}
                            <tbody>
                                {data.groups ? data.groups.map(g => (
                                    <React.Fragment key={g.key}>
                                        <tr className="bg-gray-100 font-semibold"><td className="print:hidden" /><td colSpan={7}>{g.key} <span className="font-normal text-xs text-gray-500">({g.rows.length})</span></td>
                                            <td className="text-right tabular-nums">{g.received ? `R ${fmt2(g.received)}` : ''}{g.received && g.issued ? ' / ' : ''}{g.issued ? `I ${fmt2(g.issued)}` : ''}</td><td colSpan={2} /></tr>
                                        {g.rows.map(rowView)}
                                    </React.Fragment>
                                )) : rows.map(rowView)}
                                {rows.length === 0 && <tr><td colSpan={11} className="text-center text-gray-400 py-4">No PDC for these filters.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}

                {modal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
                        <div className="bg-white rounded-xl w-full max-w-md">
                            <div className="erp-header"><span className="erp-header-title">{modal.action === 'post' ? '✔ Post' : modal.action === 'return' ? '↩ Return / Bounce' : '✕ Cancel'} - {modal.rows.length} cheque(s), {fmt2(modal.rows.reduce((s, r) => s + r.amount, 0))}</span></div>
                            <div className="p-4 space-y-3 text-sm">
                                {error && <p className="text-sm text-red-600">{error}</p>}
                                <div className="max-h-32 overflow-y-auto text-xs text-gray-600">{modal.rows.map(r => <div key={r.id}>{r.doc_no} · {r.party_name} · chq {r.cheque_no} ({r.cheque_date}) · {fmt2(r.amount)}</div>)}</div>
                                {modal.action === 'post' ? (<>
                                    <div className="erp-field"><label className="erp-label">Posting date</label>
                                        <select className="erp-select" value={modal.posting_date_mode} onChange={e => setModal(m => ({ ...m, posting_date_mode: e.target.value }))}>
                                            <option value="cheque">Each cheque's date (today if not yet due)</option><option value="fixed">One date for all</option>
                                        </select>
                                        {modal.posting_date_mode === 'fixed' && <input type="date" className="erp-input mt-1" value={modal.posting_date} onChange={e => setModal(m => ({ ...m, posting_date: e.target.value }))} />}</div>
                                    {modal.rows.some(r => !r.bank_ledger_id) && (
                                        <div className="erp-field"><label className="erp-label">Bank Ledger <span className="req">*</span> <span className="hint">(for cheques without one)</span></label>
                                            <select className="erp-select" value={modal.bank_ledger_id} onChange={e => setModal(m => ({ ...m, bank_ledger_id: e.target.value }))}>
                                                <option value="">Choose bank ledger</option>{ledgers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                                            </select></div>
                                    )}
                                    <div className="erp-field"><label className="erp-label">Posting / Deposit No</label><input className="erp-input" value={modal.posting_no} onChange={e => setModal(m => ({ ...m, posting_no: e.target.value }))} /></div>
                                    <p className="text-xs text-gray-500">Posting makes the GL entry (Bank / Party) and, with bill-to-bill on, adjusts the party's bills (FIFO or as set on the PDC).</p>
                                </>) : (
                                    <div className="erp-field"><label className="erp-label">Reason <span className="req">*</span></label>
                                        <input className="erp-input" value={modal.reason} placeholder={modal.action === 'return' ? 'e.g. insufficient funds' : 'e.g. party replaced the cheque'} onChange={e => setModal(m => ({ ...m, reason: e.target.value }))} />
                                        {modal.action === 'return' && modal.rows.some(r => r.status === 'posted') && <p className="text-xs text-orange-700 mt-1">Posted cheques: the GL entry and bill adjustments are reversed.</p>}</div>
                                )}
                            </div>
                            <div className="erp-bottombar"><div />
                                <div className="erp-bottombar-actions">
                                    <button className="erp-btn" onClick={() => setModal(null)}>Close</button>
                                    <button className="erp-btn primary" disabled={busy} onClick={doAction}>{busy ? 'Working…' : 'Confirm'}</button>
                                </div></div>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
