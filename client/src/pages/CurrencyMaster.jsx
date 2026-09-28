// =============================================
// CurrencyMaster.jsx
// Currencies used on sales / purchase entries: code, name, symbol and the
// current exchange rate (1 unit = rate in the local currency). One is the
// local currency (rate 1). An entry takes the rate from here when its
// currency is picked and can change it for that entry.
// Server: routes/currencyRoutes.js.
// =============================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import Layout from '../components/Layout';
import { clearCurrencies } from '../components/entry/CurrencyField';

const emptyForm = { currency_code: '', currency_name: '', symbol: '', exchange_rate: '' };

export default function CurrencyMaster() {
    const { authFetch } = useAuth();
    const [rows, setRows] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState(null);
    const formRef = useRef(null);
    useEnterKeyNavigation(formRef);

    const load = useCallback(async () => {
        try { setRows((await authFetch('/api/currencies?all=1')).data || []); } catch (e) { setMsg({ err: e.message }); }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const base = rows.find(r => r.is_base);
    const reset = () => { setForm(emptyForm); setEditingId(null); };
    const save = async e => {
        e.preventDefault();
        setMsg(null);
        try {
            if (editingId) await authFetch(`/api/currencies/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
            else await authFetch('/api/currencies', { method: 'POST', body: JSON.stringify(form) });
            clearCurrencies();
            setMsg({ ok: editingId ? 'Currency updated' : 'Currency added' });
            reset(); load();
        } catch (err) { setMsg({ err: err.message }); }
    };
    const act = async (r, body, method = 'PUT') => {
        setMsg(null);
        try { await authFetch(`/api/currencies/${r.id}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); clearCurrencies(); load(); } catch (err) { setMsg({ err: err.message }); }
    };

    return (
        <Layout>
            <div className="max-w-4xl mx-auto p-4">
                <h1 className="text-xl font-bold mb-1">Currencies</h1>
                <p className="text-xs text-gray-500 mb-3">Local currency: <b>{base ? `${base.currency_code} (${base.currency_name})` : '—'}</b>. Rate = how much one unit is in the local currency; an entry can change it for itself.</p>
                {msg?.err && <div className="nav-msg err">{msg.err}</div>}
                {msg?.ok && <div className="nav-msg ok">{msg.ok}</div>}
                <form ref={formRef} onSubmit={save} className="nav-groupbox grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                    <span className="nav-groupbox-title">{editingId ? 'Edit currency' : 'New currency'}</span>
                    <div><label className="erp-label">Code *</label><input className="erp-input" maxLength={10} value={form.currency_code} onChange={e => setForm({ ...form, currency_code: e.target.value.toUpperCase() })} placeholder="USD" required /></div>
                    <div className="md:col-span-2"><label className="erp-label">Name *</label><input className="erp-input" value={form.currency_name} onChange={e => setForm({ ...form, currency_name: e.target.value })} placeholder="US Dollar" required /></div>
                    <div><label className="erp-label">Symbol</label><input className="erp-input" maxLength={10} value={form.symbol || ''} onChange={e => setForm({ ...form, symbol: e.target.value })} placeholder="$" /></div>
                    <div><label className="erp-label">Rate ({base?.currency_code || 'local'})</label><input type="number" step="0.0001" min="0" className="erp-input" value={form.exchange_rate} onChange={e => setForm({ ...form, exchange_rate: e.target.value })} disabled={editingId && rows.find(r => r.id === editingId)?.is_base} required /></div>
                    <div className="md:col-span-5 flex gap-2 justify-end">
                        {editingId && <button type="button" className="nav-btn" onClick={reset}>Cancel</button>}
                        <button type="submit" className="nav-btn primary">{editingId ? 'Update' : 'Add'}</button>
                    </div>
                </form>
                <table className="erp-grid-table mt-3">
                    <thead><tr><th>Code</th><th>Name</th><th>Symbol</th><th className="text-right">Rate</th><th>Local?</th><th>Active</th><th /></tr></thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.id} className={r.is_active === false ? 'text-gray-400' : ''}>
                                <td className="font-mono font-semibold">{r.currency_code}</td><td>{r.currency_name}</td><td>{r.symbol || ''}</td>
                                <td className="text-right">{Number(r.exchange_rate).toFixed(4)}</td><td>{r.is_base ? '✓ local' : ''}</td><td>{r.is_active === false ? 'No' : 'Yes'}</td>
                                <td className="text-right whitespace-nowrap">
                                    <button type="button" className="nav-btn small" onClick={() => { setEditingId(r.id); setForm({ currency_code: r.currency_code, currency_name: r.currency_name, symbol: r.symbol || '', exchange_rate: r.exchange_rate }); }}>Edit</button>{' '}
                                    {!r.is_base && r.is_active !== false && <button type="button" className="nav-btn small" onClick={() => act(r, { is_base: true })} title="Make this the local currency">Set local</button>}{' '}
                                    {!r.is_base && (r.is_active === false
                                        ? <button type="button" className="nav-btn small" onClick={() => act(r, { is_active: true })}>Activate</button>
                                        : <button type="button" className="nav-btn small" onClick={() => act(r, null, 'DELETE')}>Remove</button>)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Layout>
    );
}
