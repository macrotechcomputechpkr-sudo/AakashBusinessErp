// =============================================
// ManualDocumentPrinting.jsx
// Print documents in bulk: pick the document type and date range, filter
// by customer / vendor, agent, area, route, branch, status, printed / not
// printed and a From - To document number range. Only the matching
// documents are listed (with the From - To numbers they span); tag them
// (one by one, all, or a number range) and print the tagged ones together
// in the chosen print template - or print one at a time.
// =============================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import MultiPick from '../components/MultiPick';
import { useUdfColumns } from '../components/UdfColumns';
import { BATCH_PREFIX } from './BatchPrint';

const fmt2 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => d.toISOString().slice(0, 10);
const cmpNo = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
const STATUSES = [{ id: 'posted', name: 'Posted' }, { id: 'draft', name: 'Draft' }, { id: 'approved', name: 'Approved' }, { id: 'confirmed', name: 'Confirmed' },
    { id: 'pending', name: 'Pending' }, { id: 'in_transit', name: 'In transit' }, { id: 'received', name: 'Received' }, { id: 'cancelled', name: 'Cancelled' }];
const defaultConfig = () => {
    const d = new Date();
    return { document_type: 'sales_bill', from_date: iso(d), to_date: iso(d), party_ids: [], agent_ids: [], area_ids: [], route_ids: [], branch_ids: [],
        statuses: ['posted'], doc_no_from: '', doc_no_to: '', printed: 'all', search: '' };
};

export default function ManualDocumentPrinting() {
    const { authFetch } = useAuth();
    const [config, setConfig] = useState(defaultConfig());
    const [types, setTypes] = useState([]);
    const [masters, setMasters] = useState({ parties: [], agents: [], areas: [], routes: [], branches: [] });
    const [templates, setTemplates] = useState([]);
    const [templateId, setTemplateId] = useState('');
    const [data, setData] = useState(null);
    const [tagged, setTagged] = useState(() => new Set());
    const [range, setRange] = useState({ from: '', to: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));
    const typeInfo = types.find(t => t.key === config.document_type);
    const udf = useUdfColumns(`manual-print-${config.document_type}`, [config.document_type]);
    const udfLoad = udf.load;
    useEffect(() => { if (data) udfLoad(data.rows, { doc: 'id' }); }, [data, udfLoad]);

    useEffect(() => {
        const list = (url, map) => authFetch(url).then(r => (r.data || []).map(map)).catch(() => []);
        authFetch('/api/document-types').then(r => setTypes(r.data || [])).catch(e => setError(e.message));
        Promise.all([
            list('/api/ledger-accounts?pageSize=5000&sortBy=account_name&sortDir=asc', l => ({ id: l.id, name: l.account_code ? `${l.account_name} · ${l.account_code}` : l.account_name })),
            list('/api/salesman-agents', a => ({ id: a.id, name: a.agent_name })),
            list('/api/areas', a => ({ id: a.id, name: a.parent?.area_name ? `${a.area_name} (${a.parent.area_name})` : a.area_name })),
            list('/api/routes', r => ({ id: r.id, name: r.route_name })),
            list('/api/branches', b => ({ id: b.id, name: b.branch_name }))
        ]).then(([parties, agents, areas, routes, branches]) => setMasters({ parties, agents, areas, routes, branches }));
    }, [authFetch]);
    useEffect(() => {
        setTemplates([]); setTemplateId('');
        authFetch(`/api/print-templates?document_type=${config.document_type}`).then(r => {
            const t = r.data || [];
            setTemplates(t);
            setTemplateId((t.find(x => x.is_default) || t[0] || {}).id || '');
        }).catch(() => setTemplates([]));
    }, [authFetch, config.document_type]);

    const run = useCallback(async (cfg = config) => {
        setLoading(true); setError('');
        try {
            const p = new URLSearchParams({ document_type: cfg.document_type, printed: cfg.printed });
            ['from_date', 'to_date', 'doc_no_from', 'doc_no_to', 'search'].forEach(k => { if (cfg[k]) p.set(k, cfg[k]); });
            ['party_ids', 'agent_ids', 'area_ids', 'route_ids', 'branch_ids', 'statuses'].forEach(k => { if (cfg[k].length) p.set(k, cfg[k].join(',')); });
            const res = await authFetch(`/api/document-print/list?${p}`);
            setData(res.data); setTagged(new Set());
            setRange({ from: res.data.summary.doc_no_from, to: res.data.summary.doc_no_to });
        } catch (e) { setError(e.message); setData(null); }
        finally { setLoading(false); }
    }, [authFetch, config]);

    const rows = useMemo(() => data?.rows || [], [data]);
    const toggle = id => setTagged(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const allTagged = rows.length > 0 && rows.every(r => tagged.has(r.id));
    const tagRange = () => setTagged(new Set(rows.filter(r => (!range.from || cmpNo(r.doc_no, range.from) >= 0) && (!range.to || cmpNo(r.doc_no, range.to) <= 0)).map(r => r.id)));
    const taggedRows = rows.filter(r => tagged.has(r.id));
    const taggedAmount = taggedRows.reduce((s, r) => s + r.amount, 0);

    const printTagged = () => {
        if (!taggedRows.length) return;
        const key = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        try {
            // keep only the last few jobs
            Object.keys(localStorage).filter(k => k.startsWith(BATCH_PREFIX)).sort().slice(0, -5).forEach(k => localStorage.removeItem(k));
            localStorage.setItem(BATCH_PREFIX + key, JSON.stringify({ ids: taggedRows.map(r => r.id), template_id: templateId }));
            window.open(`/print-batch/${data.document_type}?key=${key}`, '_blank');
        } catch {
            window.open(`/print-batch/${data.document_type}?ids=${taggedRows.map(r => r.id).join(',')}${templateId ? `&template_id=${templateId}` : ''}`, '_blank');
        }
    };
    const exportCsv = () => {
        const head = ['Doc No', 'Date', 'Party', 'Agent', 'Area', 'Route', 'Branch', 'Status', 'Amount', 'Printed', ...udf.columns.map(c => c.label)];
        const body = rows.map(r => [r.doc_no, r.doc_date, r.party_name, r.agent_name, r.area_name, r.route_name, r.branch_name, r.status, r.amount, r.print_count, ...udf.values(r, { doc: 'id' }).map(x => x.value)]);
        const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : v ?? '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...body].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `documents_${config.document_type}_${config.from_date}_${config.to_date}.csv`; a.click(); URL.revokeObjectURL(a.href);
    };

    const groups = [...new Set(types.map(t => t.group))];
    const partyWord = typeInfo?.party_side === 'vendor' ? 'Vendor' : typeInfo?.party_side === 'customer' ? 'Customer' : 'Party';

    return (
        <Layout>
        <div className="erp-shell px-4">
        <div className="erp-card">
            <div className="erp-header"><span className="erp-header-title">🖨 Manual Document Printing</span></div>
            <div className="erp-tab-content">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-3">
                    <div className="erp-field"><label className="erp-label">Document</label>
                        <select className="erp-select" value={config.document_type} onChange={e => { set('document_type', e.target.value); setData(null); }}>
                            {groups.map(g => <optgroup key={g} label={g}>{types.filter(t => t.group === g).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>)}
                        </select></div>
                    <div className="erp-field"><label className="erp-label">From Date</label><input type="date" className="erp-input" value={config.from_date} onChange={e => set('from_date', e.target.value)} /></div>
                    <div className="erp-field"><label className="erp-label">To Date</label><input type="date" className="erp-input" value={config.to_date} onChange={e => set('to_date', e.target.value)} /></div>
                    {typeInfo?.has_party !== false && <MultiPick label={partyWord} items={masters.parties} value={config.party_ids} onChange={v => set('party_ids', v)} />}
                    <MultiPick label="Agent" items={masters.agents} value={config.agent_ids} onChange={v => set('agent_ids', v)} />
                    <MultiPick label="Area" items={masters.areas} value={config.area_ids} onChange={v => set('area_ids', v)} />
                    <MultiPick label="Route" items={masters.routes} value={config.route_ids} onChange={v => set('route_ids', v)} />
                    <MultiPick label="Branch" items={masters.branches} value={config.branch_ids} onChange={v => set('branch_ids', v)} />
                    <MultiPick label="Status" items={STATUSES} value={config.statuses} onChange={v => set('statuses', v)} allLabel="Any" />
                    <div className="erp-field"><label className="erp-label">Doc No From</label><input className="erp-input" value={config.doc_no_from} onChange={e => set('doc_no_from', e.target.value)} placeholder="e.g. SB-100" /></div>
                    <div className="erp-field"><label className="erp-label">Doc No To</label><input className="erp-input" value={config.doc_no_to} onChange={e => set('doc_no_to', e.target.value)} placeholder="e.g. SB-150" /></div>
                    <div className="erp-field"><label className="erp-label">Printed</label>
                        <select className="erp-select" value={config.printed} onChange={e => set('printed', e.target.value)}>
                            <option value="all">All</option><option value="not_printed">Not printed yet</option><option value="printed">Already printed</option>
                        </select></div>
                    <div className="erp-field"><label className="erp-label">Search</label>
                        <input className="erp-input" value={config.search} onChange={e => set('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} placeholder="doc no / party / narration" /></div>
                    <div className="erp-field"><label className="erp-label">Print Template</label>
                        <select className="erp-select" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                            {!templates.length && <option value="">Default template</option>}
                            {templates.map(t => <option key={t.id} value={t.id}>{t.template_name}{t.is_default ? ' (default)' : ''}</option>)}
                        </select></div>
                </div>
                <div className="flex flex-wrap gap-2 mb-3 items-center">
                    <button className="erp-btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : '🔍 Show documents'}</button>
                    {data && <button className="erp-btn" onClick={exportCsv}>⬇ Excel</button>}
                    {udf.picker}
                    <button className="erp-btn" onClick={() => { setConfig(defaultConfig()); setData(null); }}>↺ Reset</button>
                </div>
                {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

                {data && (
                    <>
                        <div className="flex flex-wrap items-center gap-3 p-2 mb-2 bg-blue-50 rounded text-sm">
                            <span><b>{data.summary.count}</b> {data.label}{data.summary.count ? <> · from <b>{data.summary.doc_no_from}</b> to <b>{data.summary.doc_no_to}</b></> : null} · {fmt2(data.summary.amount)}</span>
                            <span className="ml-auto flex items-center gap-1">
                                Tag doc no <input className="border rounded px-2 py-0.5 w-28" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                                to <input className="border rounded px-2 py-0.5 w-28" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
                                <button className="erp-btn" onClick={tagRange}>Tag range</button>
                                <button className="erp-btn" onClick={() => setTagged(new Set())}>Untag all</button>
                            </span>
                        </div>
                        <div className="flex items-center gap-3 mb-2">
                            <button className="erp-btn primary" disabled={!taggedRows.length} onClick={printTagged}>🖨 Print tagged ({taggedRows.length})</button>
                            {taggedRows.length > 0 && <span className="text-sm text-gray-600">Tagged {taggedRows[0].doc_no}{taggedRows.length > 1 ? ` … ${taggedRows[taggedRows.length - 1].doc_no}` : ''} · {fmt2(taggedAmount)}</span>}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="erp-grid-table w-full text-sm">
                                <thead><tr>
                                    <th><input type="checkbox" checked={allTagged} onChange={() => setTagged(allTagged ? new Set() : new Set(rows.map(r => r.id)))} /></th>
                                    <th className="text-left">Doc No</th><th className="text-left">Date</th>
                                    {data.has_party && <th className="text-left">{partyWord}</th>}
                                    <th className="text-left">Agent</th><th className="text-left">Area</th><th className="text-left">Route</th><th className="text-left">Branch</th>
                                    <th className="text-left">Status</th><th className="text-right">Amount</th><th className="text-center">Printed</th>
                                    {udf.headers('text-left')}<th />
                                </tr></thead>
                                <tbody>
                                    {rows.map(r => (
                                        <tr key={r.id} className={`cursor-pointer ${tagged.has(r.id) ? 'bg-yellow-50' : 'hover:bg-blue-50'}`} onClick={() => toggle(r.id)}>
                                            <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={tagged.has(r.id)} onChange={() => toggle(r.id)} /></td>
                                            <td className="font-medium">{r.doc_no}</td><td>{r.doc_date}</td>
                                            {data.has_party && <td>{r.party_name}{r.party_address ? <div className="text-[10px] text-gray-400">{r.party_address}</div> : null}</td>}
                                            <td>{r.agent_name}</td><td>{r.area_name}</td><td>{r.route_name}</td><td>{r.branch_name}</td>
                                            <td>{r.status}</td><td className="text-right tabular-nums">{fmt2(r.amount)}</td>
                                            <td className="text-center text-xs" title={r.last_printed_at || ''}>{r.print_count ? `✓ ${r.print_count}` : '—'}</td>
                                            {udf.cells(r, { doc: 'id' }, '')}
                                            <td onClick={e => e.stopPropagation()}>
                                                <a href={`/print/${data.document_type}/${r.id}${templateId ? `?template_id=${templateId}` : ''}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-purple-600 text-white rounded text-xs">🖨</a>
                                            </td>
                                        </tr>
                                    ))}
                                    {!rows.length && <tr><td colSpan={12 + udf.count} className="text-center text-gray-400 py-4">No documents for these filters.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
        </div>
        </Layout>
    );
}
