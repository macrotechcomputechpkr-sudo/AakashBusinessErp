// =============================================
// LcBgDashboard.jsx
// LC, Bank Guarantee and PDC in one place (server/utils/lcBg.js):
//   Dashboard   open amounts, LCs / BGs expiring within N days or expired
//               but still open, PDCs matured / due - with actions right there
//   LC report   amount, used on bills, remaining, expiry, history
//   BG register received / issued guarantees - add, edit, report, history
//   PDC due     pending cheques by date - post / return / cancel
// Actions: LC extend / amend / close / cancel / reopen; BG extend / amend /
// release / invoke / cancel / mark expired / reopen - all logged.
// =============================================
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

const fmt2 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);
const STATE = { expiring: 'bg-orange-100 text-orange-800', expired_open: 'bg-red-100 text-red-700', open: 'bg-green-50 text-green-700', matured: 'bg-red-100 text-red-700', due_soon: 'bg-orange-100 text-orange-800' };
const LC_ACTIONS = [['extend', 'Extend'], ['amend', 'Amend amount'], ['close', 'Close'], ['cancel', 'Cancel'], ['reopen', 'Reopen']];
const BG_ACTIONS = [['extend', 'Extend'], ['amend', 'Amend amount'], ['release', 'Release'], ['invoke', 'Invoke'], ['expire', 'Mark expired'], ['cancel', 'Cancel'], ['reopen', 'Reopen']];
const emptyBg = { bg_number: '', direction: 'received', bg_type: 'performance', party_ledger_id: '', bank_name: '', bank_ledger_id: '', amount: '', margin_amount: '', commission_amount: '', issue_date: '', expiry_date: '', claim_expiry_date: '', narration: '' };

export default function LcBgDashboard() {
    const { authFetch } = useAuth();
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'dash'); // ?tab= deep link from the Report Center
    const [asOn, setAsOn] = useState(iso(new Date()));
    const [within, setWithin] = useState(30);
    const [dash, setDash] = useState(null);
    const [lc, setLc] = useState(null);
    const [bg, setBg] = useState(null);
    const [pdc, setPdc] = useState(null);
    const [ledgers, setLedgers] = useState([]);
    const [modal, setModal] = useState(null);      // { kind: 'lc'|'bg'|'pdc', row, action, ... }
    const [bgForm, setBgForm] = useState(null);
    const [history, setHistory] = useState(null);
    const [filter, setFilter] = useState({ status: '', search: '' });
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');

    useEffect(() => { authFetch('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc').then(r => setLedgers(r.data || [])).catch(() => {}); }, [authFetch]);
    const q = `as_on=${asOn}&within_days=${within}${filter.status ? `&statuses=${filter.status}` : ''}${filter.search ? `&search=${encodeURIComponent(filter.search)}` : ''}`;
    const load = useCallback(async () => {
        setError('');
        try {
            if (tab === 'dash') setDash((await authFetch(`/api/lc-bg/dashboard?as_on=${asOn}&within_days=${within}`)).data);
            if (tab === 'lc') setLc((await authFetch(`/api/lc-bg/lc-report?${q}`)).data);
            if (tab === 'bg') setBg((await authFetch(`/api/lc-bg/bg-report?${q}`)).data);
            if (tab === 'pdc') setPdc((await authFetch(`/api/lc-bg/dashboard?as_on=${asOn}&within_days=${within}`)).data.pdc);
        } catch (e) { setError(e.message); }
    }, [authFetch, tab, asOn, within, q]);
    useEffect(() => { load(); }, [load]);

    const act = async () => {
        const m = modal; setError('');
        try {
            if (m.kind === 'pdc') {
                if (m.action !== 'post' && !m.reason) throw new Error('A reason is required');
                const body = m.action === 'post' ? { status: 'posted', posting_date: m.date, bank_ledger_id: m.row.bank_ledger_id ? undefined : m.bank_ledger_id || undefined }
                    : m.action === 'return' ? { status: 'returned', return_reason: m.reason } : { status: 'cancelled', cancellation_reason: m.reason };
                await authFetch(`/api/pdc-vouchers/${m.row.id}/status`, { method: 'PUT', body: JSON.stringify(body) });
            } else {
                await authFetch(`/api/lc-bg/${m.kind}/${m.row.id}/action`, { method: 'POST', body: JSON.stringify({ action: m.action, expiry_date: m.date, amount: m.amount, remarks: m.reason, action_date: iso(new Date()) }) });
            }
            setMsg(`${m.row.number || m.row.doc_no}: ${m.action} done`); setModal(null); load();
        } catch (e) { setError(e.message); }
    };
    const saveBg = async () => {
        setError('');
        try {
            if (bgForm.id) await authFetch(`/api/lc-bg/bg/${bgForm.id}`, { method: 'PUT', body: JSON.stringify(bgForm) });
            else await authFetch('/api/lc-bg/bg', { method: 'POST', body: JSON.stringify(bgForm) });
            setMsg('BG saved'); setBgForm(null); load();
        } catch (e) { setError(e.message); }
    };
    const Badge = ({ s }) => <span className={`px-2 py-0.5 rounded text-xs ${STATE[s] || 'bg-gray-100 text-gray-600'}`}>{s.replace('_', ' ')}</span>;
    const actionButtons = (kind, row) => (kind === 'lc' ? LC_ACTIONS : BG_ACTIONS).filter(([a]) => (row.status === 'open' ? a !== 'reopen' : ['reopen', 'extend'].includes(a)))
        .map(([a, l]) => <button key={a} className="text-xs px-1.5 py-0.5 mr-1 mb-1 border rounded bg-white hover:bg-blue-50" onClick={() => setModal({ kind, row, action: a, date: '', amount: '', reason: '' })}>{l}</button>);
    const Table = ({ kind, rows }) => (
        <table className="erp-grid-table w-full text-sm">
            <thead><tr><th className="text-left">{kind.toUpperCase()} No</th>{kind === 'bg' && <th className="text-left">Type</th>}<th className="text-left">Party</th><th className="text-left">Bank</th><th className="text-right">Amount</th>
                {kind === 'lc' && <><th className="text-right">Used</th><th className="text-right">Remaining</th></>}<th className="text-left">Issue</th><th className="text-left">Expiry</th><th className="text-right">Days</th><th className="text-left">State</th><th className="text-left">Actions</th></tr></thead>
            <tbody>{rows.map(r => (
                <tr key={r.id}><td><button className="underline text-blue-700" onClick={() => setHistory(r)}>{r.number}</button></td>
                    {kind === 'bg' && <td className="text-xs">{r.direction === 'issued' ? 'Issued for us' : 'Received'} · {r.bg_type.replace('_', ' ')}</td>}
                    <td>{r.party_name}</td><td>{r.bank_name}</td><td className="text-right tabular-nums">{fmt2(r.amount)}</td>
                    {kind === 'lc' && <><td className="text-right tabular-nums">{fmt2(r.utilized)}</td><td className="text-right tabular-nums">{fmt2(r.remaining)}</td></>}
                    <td>{r.issue_date || ''}</td><td>{r.expiry_date || ''}</td><td className="text-right">{r.days_to_expiry ?? ''}</td><td><Badge s={r.state} /></td>
                    <td>{actionButtons(kind, r)}{kind === 'bg' && <button className="text-xs px-1.5 py-0.5 border rounded" onClick={() => setBgForm({ ...emptyBg, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)), id: r.id, bg_number: r.number, party_ledger_id: r.party_id || '', amount: r.amount })}>Edit</button>}</td></tr>
            ))}{!rows.length && <tr><td colSpan={12} className="text-center text-gray-400 py-3">Nothing here.</td></tr>}</tbody>
        </table>
    );
    const PdcTable = ({ rows }) => (
        <table className="erp-grid-table w-full text-sm">
            <thead><tr><th className="text-left">PDC</th><th className="text-left">Type</th><th className="text-left">Party</th><th className="text-left">Cheque</th><th className="text-left">Cheque date</th><th className="text-right">Days</th><th className="text-right">Amount</th><th className="text-left">State</th><th className="text-left">Actions</th></tr></thead>
            <tbody>{rows.map(p => (
                <tr key={p.id}><td>{p.doc_no}</td><td>{p.voucher_type}</td><td>{p.party_name}</td><td>{p.cheque_no} {p.bank_name}</td><td>{p.cheque_date}</td><td className="text-right">{p.days}</td><td className="text-right tabular-nums">{fmt2(p.amount)}</td><td><Badge s={p.state} /></td>
                    <td>{[['post', 'Post'], ['return', p.voucher_type === 'received' ? 'Return / bounce' : 'Return'], ['cancel', 'Cancel']].map(([a, l]) => <button key={a} className="text-xs px-1.5 py-0.5 mr-1 border rounded bg-white hover:bg-blue-50" onClick={() => setModal({ kind: 'pdc', row: p, action: a, date: p.cheque_date > iso(new Date()) ? iso(new Date()) : p.cheque_date, reason: '', bank_ledger_id: '' })}>{l}</button>)}</td></tr>
            ))}{!rows.length && <tr><td colSpan={9} className="text-center text-gray-400 py-3">No pending cheques due.</td></tr>}</tbody>
        </table>
    );
    const C = dash?.cards;

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">🏦 LC / BG / PDC</span></div>
            <div className="erp-tab-content">
                <div className="flex flex-wrap gap-3 items-end mb-3">
                    <div className="flex gap-1 border-b mr-auto">
                        {[['dash', '📊 Dashboard'], ['lc', 'LC Report'], ['bg', 'BG Register'], ['pdc', 'PDC Due']].map(([k, l]) => <button key={k} className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-blue-600 font-semibold text-blue-700' : 'text-gray-600'}`} onClick={() => setTab(k)}>{l}</button>)}
                    </div>
                    <div className="erp-field"><label className="erp-label">As on</label><input type="date" className="erp-input" value={asOn} onChange={e => setAsOn(e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">Expiring within (days)</label><input type="number" className="erp-input w-24" value={within} onChange={e => setWithin(Number(e.target.value) || 30)} /></div>
                    {['lc', 'bg'].includes(tab) && <>
                        <div className="erp-field"><label className="erp-label">Status</label><select className="erp-select" value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
                            <option value="">All</option><option value="open">Open</option><option value="expiring">Expiring</option><option value="expired_open">Expired, still open</option>
                            {tab === 'lc' ? <><option value="closed">Closed</option><option value="cancelled">Cancelled</option></> : <><option value="released">Released</option><option value="invoked">Invoked</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></>}</select></div>
                        <div className="erp-field"><label className="erp-label">Search</label><input className="erp-input" value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} /></div>
                    </>}
                    {tab === 'bg' && <button className="erp-btn primary" onClick={() => setBgForm({ ...emptyBg })}>➕ New BG</button>}
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                {msg && <p className="text-sm text-green-700 mb-2">{msg}</p>}

                {tab === 'dash' && C && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            {[['Open LCs', `${C.lc_open.count} · ${fmt2(C.lc_open.amount)}`, `remaining ${fmt2(C.lc_open.remaining)}`], ['LC expiring / expired-open', `${C.lc_expiring} / ${C.lc_expired_open}`, ''],
                                ['BG received (open)', `${C.bg_received_open.count} · ${fmt2(C.bg_received_open.amount)}`, ''], ['BG issued for us (open)', `${C.bg_issued_open.count} · ${fmt2(C.bg_issued_open.amount)}`, `expiring ${C.bg_expiring} · expired-open ${C.bg_expired_open}`],
                                ['PDC received - matured', `${C.pdc_received_matured.count} · ${fmt2(C.pdc_received_matured.amount)}`, 'deposit / post these'], ['PDC issued - matured', `${C.pdc_issued_matured.count} · ${fmt2(C.pdc_issued_matured.amount)}`, ''],
                                ['PDC due soon', `${C.pdc_due_soon.count} · ${fmt2(C.pdc_due_soon.amount)}`, `within ${dash.within_days} days`]].map(([l, v, h]) => (
                                <div key={l} className="border rounded p-3"><div className="text-xs text-gray-500">{l}</div><div className="text-lg font-semibold">{v}</div>{h && <div className="text-xs text-gray-500">{h}</div>}</div>
                            ))}
                        </div>
                        <div>
                            <div className="font-semibold text-sm mb-1">Needs attention - LC / BG expiring or expired but still open</div>
                            <table className="erp-grid-table w-full text-sm">
                                <thead><tr><th className="text-left">Kind</th><th className="text-left">No</th><th className="text-left">Party</th><th className="text-left">Bank</th><th className="text-right">Amount</th><th className="text-left">Expiry</th><th className="text-right">Days</th><th className="text-left">State</th><th className="text-left">Actions</th></tr></thead>
                                <tbody>{dash.attention.map(r => (
                                    <tr key={r.instrument + r.id}><td>{r.instrument.toUpperCase()}</td><td>{r.number}</td><td>{r.party_name}</td><td>{r.bank_name}</td><td className="text-right tabular-nums">{fmt2(r.remaining ?? r.amount)}</td><td>{r.expiry_date}</td><td className="text-right">{r.days_to_expiry}</td><td><Badge s={r.state} /></td><td>{actionButtons(r.instrument, r)}</td></tr>
                                ))}{!dash.attention.length && <tr><td colSpan={9} className="text-center text-gray-400 py-3">Nothing expiring.</td></tr>}</tbody>
                            </table>
                        </div>
                        <div><div className="font-semibold text-sm mb-1">PDC matured / due soon</div><PdcTable rows={dash.pdc} /></div>
                    </div>
                )}
                {tab === 'lc' && lc && <><div className="text-sm mb-2">{lc.totals.count} LC(s) · {fmt2(lc.totals.amount)} · open remaining {fmt2(lc.totals.open_amount)}</div><Table kind="lc" rows={lc.rows} /></>}
                {tab === 'bg' && bg && <><div className="text-sm mb-2">{bg.totals.count} BG(s) · {fmt2(bg.totals.amount)} · open {fmt2(bg.totals.open_amount)}</div><Table kind="bg" rows={bg.rows} /></>}
                {tab === 'pdc' && pdc && <PdcTable rows={pdc} />}
            </div>
        </div>
        </div>

        {modal && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg p-4 w-full max-w-md space-y-2 text-sm">
                    <div className="font-semibold">{modal.kind.toUpperCase()} {modal.row.number || modal.row.doc_no} - {modal.action}</div>
                    {['extend'].includes(modal.action) && <label className="block">New expiry date <input type="date" className="erp-input" value={modal.date} onChange={e => setModal(m => ({ ...m, date: e.target.value }))} /></label>}
                    {modal.action === 'amend' && <label className="block">New amount <input type="number" className="erp-input" value={modal.amount} onChange={e => setModal(m => ({ ...m, amount: e.target.value }))} /></label>}
                    {modal.kind === 'pdc' && modal.action === 'post' && (
                        <>
                            <label className="block">Posting date <input type="date" className="erp-input" value={modal.date} onChange={e => setModal(m => ({ ...m, date: e.target.value }))} /></label>
                            {!modal.row.bank_ledger_id && <label className="block">Bank ledger <select className="erp-select" value={modal.bank_ledger_id} onChange={e => setModal(m => ({ ...m, bank_ledger_id: e.target.value }))}><option value="">— choose —</option>{ledgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></label>}
                        </>
                    )}
                    {!(modal.kind === 'pdc' && modal.action === 'post') && <label className="block">{modal.kind === 'pdc' ? 'Reason *' : 'Remarks'} <input className="erp-input" value={modal.reason} onChange={e => setModal(m => ({ ...m, reason: e.target.value }))} /></label>}
                    <div className="flex justify-end gap-2 pt-2"><button className="erp-btn" onClick={() => setModal(null)}>Close</button><button className="erp-btn primary" onClick={act}>Confirm</button></div>
                </div>
            </div>
        )}
        {bgForm && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg p-4 w-full max-w-2xl text-sm">
                    <div className="font-semibold mb-2">{bgForm.id ? 'Edit' : 'New'} Bank Guarantee</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        <label>BG No *<input className="erp-input" value={bgForm.bg_number} onChange={e => setBgForm(f => ({ ...f, bg_number: e.target.value }))} /></label>
                        <label>Direction<select className="erp-select" value={bgForm.direction} onChange={e => setBgForm(f => ({ ...f, direction: e.target.value }))}><option value="received">Received from party</option><option value="issued">Issued for us (our bank)</option></select></label>
                        <label>Type<select className="erp-select" value={bgForm.bg_type} onChange={e => setBgForm(f => ({ ...f, bg_type: e.target.value }))}>{['performance', 'advance_payment', 'bid_bond', 'financial', 'customs', 'other'].map(x => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</select></label>
                        <label className="md:col-span-2">Party<select className="erp-select" value={bgForm.party_ledger_id || ''} onChange={e => setBgForm(f => ({ ...f, party_ledger_id: e.target.value }))}><option value="">—</option>{ledgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></label>
                        <label>Bank name<input className="erp-input" value={bgForm.bank_name || ''} onChange={e => setBgForm(f => ({ ...f, bank_name: e.target.value }))} /></label>
                        <label>Amount<input type="number" className="erp-input" value={bgForm.amount} onChange={e => setBgForm(f => ({ ...f, amount: e.target.value }))} /></label>
                        <label>Margin<input type="number" className="erp-input" value={bgForm.margin_amount || ''} onChange={e => setBgForm(f => ({ ...f, margin_amount: e.target.value }))} /></label>
                        <label>Commission<input type="number" className="erp-input" value={bgForm.commission_amount || ''} onChange={e => setBgForm(f => ({ ...f, commission_amount: e.target.value }))} /></label>
                        <label>Issue date<input type="date" className="erp-input" value={bgForm.issue_date || ''} onChange={e => setBgForm(f => ({ ...f, issue_date: e.target.value }))} /></label>
                        <label>Expiry date<input type="date" className="erp-input" value={bgForm.expiry_date || ''} onChange={e => setBgForm(f => ({ ...f, expiry_date: e.target.value }))} /></label>
                        <label>Claim expiry<input type="date" className="erp-input" value={bgForm.claim_expiry_date || ''} onChange={e => setBgForm(f => ({ ...f, claim_expiry_date: e.target.value }))} /></label>
                        <label className="md:col-span-3">Narration<input className="erp-input" value={bgForm.narration || ''} onChange={e => setBgForm(f => ({ ...f, narration: e.target.value }))} /></label>
                    </div>
                    <div className="flex justify-end gap-2 pt-3"><button className="erp-btn" onClick={() => setBgForm(null)}>Close</button><button className="erp-btn primary" onClick={saveBg}>💾 Save</button></div>
                </div>
            </div>
        )}
        {history && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setHistory(null)}>
                <div className="bg-white rounded-lg p-4 w-full max-w-lg text-sm" onClick={e => e.stopPropagation()}>
                    <div className="font-semibold mb-2">{history.instrument.toUpperCase()} {history.number} - history</div>
                    {(history.history || []).length ? (history.history || []).map((h, i) => (
                        <div key={i} className="border-b py-1"><b>{h.action}</b> on {String(h.action_date).slice(0, 10)} {h.new_values ? `→ ${Object.entries(h.new_values).map(([k, v]) => `${k}: ${v}`).join(', ')}` : ''} {h.old_values && Object.keys(h.old_values).length ? <span className="text-gray-500">(was {Object.entries(h.old_values).map(([k, v]) => `${k}: ${v ?? '—'}`).join(', ')})</span> : null}{h.remarks ? ` - ${h.remarks}` : ''}</div>
                    )) : <div className="text-gray-500">No changes recorded.</div>}
                    <div className="text-right mt-2"><button className="erp-btn" onClick={() => setHistory(null)}>Close</button></div>
                </div>
            </div>
        )}
        </Layout>
    );
}
