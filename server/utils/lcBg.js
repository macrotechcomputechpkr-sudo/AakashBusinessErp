// =============================================
// utils/lcBg.js
// Letters of Credit, Bank Guarantees and PDCs together:
//   lcReport / bgReport   registers with status, days to expiry, LC use
//                         (mapped purchase bills), amendment history
//   dashboard             open LCs / BGs expired but still open, expiring in
//                         N days, PDCs matured / due, totals
//   partyInstruments      a party's LCs, BGs and PDCs (party ledger view)
//   lcAction / bgAction   extend expiry, amend amount, close / release,
//                         invoke, cancel, reopen - every change is logged in
//                         lc_bg_events
// =============================================

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const today = () => new Date().toISOString().slice(0, 10);
const daysTo = (from, to) => (to ? Math.round((Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) : null);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}
async function names(c, ids) {
    const u = [...new Set(ids.filter(Boolean))];
    return Object.fromEntries((await inChunks(u, async ch => { const { data } = await c.from('ledger_accounts').select('id, account_name').in('id', ch); return data || []; })).map(x => [x.id, x.account_name]));
}
function expiryState(status, expiry, asOn, within) {
    if (status !== 'open') return status;
    const d = daysTo(asOn, expiry);
    if (d === null) return 'open';
    if (d < 0) return 'expired_open';
    if (d <= within) return 'expiring';
    return 'open';
}

async function lcReport(c, t, q = {}) {
    const asOn = q.as_on || today(), within = parseInt(q.within_days, 10) || 30;
    const lcs = await fetchAll(() => { let x = c.from('letters_of_credit').select('*').eq('tenant_id', t); if (q.party_id) x = x.eq('vendor_ledger_id', q.party_id); return x.order('id'); });
    const maps = await inChunks(lcs.map(l => l.id), async ch => { const { data } = await c.from('lc_bill_mappings').select('lc_id, mapped_amount, purchase_bill_id').in('lc_id', ch); return data || []; });
    const events = await inChunks(lcs.map(l => l.id), async ch => { const { data } = await c.from('lc_bg_events').select('*').eq('instrument', 'lc').in('instrument_id', ch); return data || []; });
    const n = await names(c, lcs.flatMap(l => [l.vendor_ledger_id, l.bank_ledger_id]));
    const used = {}, bills = {};
    maps.forEach(m => { used[m.lc_id] = (used[m.lc_id] || 0) + Number(m.mapped_amount); bills[m.lc_id] = (bills[m.lc_id] || 0) + 1; });
    let rows = lcs.map(l => {
        const utilized = round2(used[l.id] || 0);
        return { instrument: 'lc', id: l.id, number: l.lc_number, party_id: l.vendor_ledger_id, party_name: n[l.vendor_ledger_id] || '', bank_name: l.lc_bank_name || n[l.bank_ledger_id] || '',
            amount: round2(l.lc_amount), margin: round2(l.margin_amount), utilized, remaining: round2(Number(l.lc_amount) - utilized), bills: bills[l.id] || 0,
            utilized_pct: Number(l.lc_amount) ? round2(utilized * 100 / Number(l.lc_amount)) : 0, currency: l.currency || 'NPR',
            issue_date: l.issue_date, expiry_date: l.expiry_date, days_to_expiry: daysTo(asOn, l.expiry_date), status: l.status, state: expiryState(l.status, l.expiry_date, asOn, within),
            narration: l.narration || '', history: events.filter(e => e.instrument_id === l.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) };
    });
    rows = filterRows(rows, q);
    return { as_on: asOn, within_days: within, rows, totals: totals(rows) };
}

async function bgReport(c, t, q = {}) {
    const asOn = q.as_on || today(), within = parseInt(q.within_days, 10) || 30;
    const bgs = await fetchAll(() => { let x = c.from('bank_guarantees').select('*').eq('tenant_id', t); if (q.party_id) x = x.eq('party_ledger_id', q.party_id); if (q.direction) x = x.eq('direction', q.direction); return x.order('id'); });
    const events = await inChunks(bgs.map(b => b.id), async ch => { const { data } = await c.from('lc_bg_events').select('*').eq('instrument', 'bg').in('instrument_id', ch); return data || []; });
    const n = await names(c, bgs.flatMap(b => [b.party_ledger_id, b.bank_ledger_id]));
    let rows = bgs.map(b => ({ instrument: 'bg', id: b.id, number: b.bg_number, direction: b.direction, bg_type: b.bg_type, party_id: b.party_ledger_id, party_name: n[b.party_ledger_id] || '',
        bank_name: b.bank_name || n[b.bank_ledger_id] || '', bank_ledger_id: b.bank_ledger_id, amount: round2(b.amount), margin: round2(b.margin_amount), commission: round2(b.commission_amount), currency: b.currency || 'NPR',
        issue_date: b.issue_date, expiry_date: b.expiry_date, claim_expiry_date: b.claim_expiry_date, days_to_expiry: daysTo(asOn, b.expiry_date), status: b.status,
        state: expiryState(b.status, b.expiry_date, asOn, within), narration: b.narration || '',
        history: events.filter(e => e.instrument_id === b.id).sort((a, b2) => String(a.created_at).localeCompare(String(b2.created_at))) }));
    rows = filterRows(rows, q);
    return { as_on: asOn, within_days: within, rows, totals: totals(rows) };
}
function filterRows(rows, q) {
    let r = rows;
    const st = csv(q.statuses);
    if (st.length) r = r.filter(x => st.includes(x.status) || st.includes(x.state));
    if (q.expiry_from) r = r.filter(x => x.expiry_date && String(x.expiry_date) >= q.expiry_from);
    if (q.expiry_to) r = r.filter(x => x.expiry_date && String(x.expiry_date) <= q.expiry_to);
    if (q.search) { const s = q.search.toLowerCase(); r = r.filter(x => [x.number, x.party_name, x.bank_name, x.narration].some(v => String(v || '').toLowerCase().includes(s))); }
    return r.sort((a, b) => String(a.expiry_date || '9999').localeCompare(String(b.expiry_date || '9999')));
}
const totals = rows => ({ count: rows.length, amount: round2(rows.reduce((s, r) => s + r.amount, 0)), open_amount: round2(rows.filter(r => r.status === 'open').reduce((s, r) => s + (r.remaining ?? r.amount), 0)),
    expiring: rows.filter(r => r.state === 'expiring').length, expired_open: rows.filter(r => r.state === 'expired_open').length });

async function pdcDue(c, t, q = {}) {
    const asOn = q.as_on || today(), within = parseInt(q.within_days, 10) || 30;
    const rows = await fetchAll(() => { let x = c.from('pdc_vouchers').select('*').eq('tenant_id', t).eq('status', 'pending'); if (q.party_id) x = x.eq('party_ledger_id', q.party_id); return x.order('cheque_date'); });
    return rows.map(p => ({ id: p.id, doc_no: p.doc_no, voucher_type: p.voucher_type, party_id: p.party_ledger_id, party_name: p.party_name_snapshot || '', cheque_no: p.cheque_no,
        cheque_date: String(p.cheque_date).slice(0, 10), bank_name: p.bank_name || '', bank_ledger_id: p.bank_ledger_id, amount: round2(p.amount), days: daysTo(asOn, p.cheque_date),
        state: daysTo(asOn, p.cheque_date) < 0 ? 'matured' : daysTo(asOn, p.cheque_date) <= within ? 'due_soon' : 'later' }));
}

async function dashboard(c, t, q = {}) {
    const [lc, bg, pdc] = await Promise.all([lcReport(c, t, q), bgReport(c, t, q), pdcDue(c, t, q)]);
    const attention = [
        ...lc.rows.filter(r => ['expiring', 'expired_open'].includes(r.state)),
        ...bg.rows.filter(r => ['expiring', 'expired_open'].includes(r.state))
    ].sort((a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0));
    const sum = (a, f = x => x.amount) => round2(a.reduce((s, x) => s + f(x), 0));
    return {
        as_on: lc.as_on, within_days: lc.within_days, attention,
        pdc: pdc.filter(p => p.state !== 'later'),
        cards: {
            lc_open: { count: lc.rows.filter(r => r.status === 'open').length, amount: sum(lc.rows.filter(r => r.status === 'open')), remaining: sum(lc.rows.filter(r => r.status === 'open'), x => x.remaining) },
            lc_expiring: lc.totals.expiring, lc_expired_open: lc.totals.expired_open,
            bg_received_open: { count: bg.rows.filter(r => r.status === 'open' && r.direction === 'received').length, amount: sum(bg.rows.filter(r => r.status === 'open' && r.direction === 'received')) },
            bg_issued_open: { count: bg.rows.filter(r => r.status === 'open' && r.direction === 'issued').length, amount: sum(bg.rows.filter(r => r.status === 'open' && r.direction === 'issued')) },
            bg_expiring: bg.totals.expiring, bg_expired_open: bg.totals.expired_open,
            pdc_received_matured: { count: pdc.filter(p => p.state === 'matured' && p.voucher_type === 'received').length, amount: sum(pdc.filter(p => p.state === 'matured' && p.voucher_type === 'received')) },
            pdc_issued_matured: { count: pdc.filter(p => p.state === 'matured' && p.voucher_type === 'issued').length, amount: sum(pdc.filter(p => p.state === 'matured' && p.voucher_type === 'issued')) },
            pdc_due_soon: { count: pdc.filter(p => p.state === 'due_soon').length, amount: sum(pdc.filter(p => p.state === 'due_soon')) }
        }
    };
}

async function partyInstruments(c, t, partyId) {
    const [lc, bg, pdcs] = await Promise.all([lcReport(c, t, { party_id: partyId }), bgReport(c, t, { party_id: partyId }),
        fetchAll(() => c.from('pdc_vouchers').select('id, doc_no, voucher_type, cheque_no, cheque_date, amount, bank_name, status').eq('tenant_id', t).eq('party_ledger_id', partyId).order('cheque_date'))]);
    return { lcs: lc.rows, bgs: bg.rows, pdcs: pdcs.map(p => ({ ...p, amount: round2(p.amount), cheque_date: String(p.cheque_date).slice(0, 10) })) };
}

// ---------- actions ----------
const LC_ACTIONS = { extend: 'Extend expiry', amend: 'Amend amount', close: 'Close', cancel: 'Cancel', reopen: 'Reopen' };
const BG_ACTIONS = { extend: 'Extend expiry', amend: 'Amend amount', release: 'Release / return', invoke: 'Invoke (claim)', cancel: 'Cancel', expire: 'Mark expired', reopen: 'Reopen' };
async function logEvent(c, t, userId, instrument, id, action, oldV, newV, remarks, date) {
    await c.from('lc_bg_events').insert({ tenant_id: t, instrument, instrument_id: id, action, action_date: date || today(), old_values: oldV, new_values: newV, remarks: remarks || null, created_by: userId || null });
}
async function lcAction(c, t, userId, id, body) {
    const { data: lc } = await c.from('letters_of_credit').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!lc) throw httpError('LC not found', 404);
    const a = body.action, up = {};
    if (!LC_ACTIONS[a]) throw httpError('Unknown action');
    if (a === 'extend') { if (!body.expiry_date) throw httpError('Give the new expiry date'); if (lc.expiry_date && body.expiry_date <= String(lc.expiry_date).slice(0, 10)) throw httpError('New expiry must be after the current one'); up.expiry_date = body.expiry_date; if (lc.status !== 'open') up.status = 'open'; }
    if (a === 'amend') { const amt = Number(body.amount); if (!(amt > 0)) throw httpError('Give the new LC amount');
        const { data: m } = await c.from('lc_bill_mappings').select('mapped_amount').eq('lc_id', id); const usedAmt = (m || []).reduce((s, x) => s + Number(x.mapped_amount), 0);
        if (amt < usedAmt) throw httpError(`LC amount cannot go below what is already used (${round2(usedAmt)})`); up.lc_amount = amt; }
    if (a === 'close') { if (lc.status !== 'open') throw httpError('Only an open LC can be closed'); up.status = 'closed'; }
    if (a === 'cancel') { if (lc.status === 'cancelled') throw httpError('Already cancelled'); up.status = 'cancelled'; }
    if (a === 'reopen') { if (lc.status === 'open') throw httpError('Already open'); up.status = 'open'; }
    const oldV = Object.fromEntries(Object.keys(up).map(k => [k, lc[k]]));
    const { error } = await c.from('letters_of_credit').update({ ...up, updated_by: userId || null, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await logEvent(c, t, userId, 'lc', id, a, oldV, up, body.remarks, body.action_date);
    return { ok: true, updated: up };
}
async function bgAction(c, t, userId, id, body) {
    const { data: bg } = await c.from('bank_guarantees').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!bg) throw httpError('BG not found', 404);
    const a = body.action, up = {};
    if (!BG_ACTIONS[a]) throw httpError('Unknown action');
    if (a === 'extend') { if (!body.expiry_date) throw httpError('Give the new expiry date'); if (bg.expiry_date && body.expiry_date <= String(bg.expiry_date).slice(0, 10)) throw httpError('New expiry must be after the current one'); up.expiry_date = body.expiry_date; if (body.claim_expiry_date) up.claim_expiry_date = body.claim_expiry_date; if (bg.status === 'expired') up.status = 'open'; }
    if (a === 'amend') { const amt = Number(body.amount); if (!(amt > 0)) throw httpError('Give the new BG amount'); up.amount = amt; }
    if (['release', 'invoke', 'cancel', 'expire'].includes(a)) { if (bg.status !== 'open') throw httpError('Only an open BG can be changed this way'); up.status = { release: 'released', invoke: 'invoked', cancel: 'cancelled', expire: 'expired' }[a]; }
    if (a === 'reopen') { if (bg.status === 'open') throw httpError('Already open'); up.status = 'open'; }
    const oldV = Object.fromEntries(Object.keys(up).map(k => [k, bg[k]]));
    const { error } = await c.from('bank_guarantees').update({ ...up, updated_by: userId || null, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await logEvent(c, t, userId, 'bg', id, a, oldV, up, body.remarks, body.action_date);
    return { ok: true, updated: up };
}
const BG_FIELDS = ['bg_number', 'direction', 'bg_type', 'party_ledger_id', 'bank_ledger_id', 'bank_name', 'amount', 'margin_amount', 'commission_amount', 'currency', 'issue_date', 'expiry_date', 'claim_expiry_date', 'narration'];
function bgBody(b) {
    const out = {};
    BG_FIELDS.forEach(k => { if (b[k] !== undefined) out[k] = b[k] === '' ? null : b[k]; });
    if (out.bg_number !== undefined && !String(out.bg_number || '').trim()) throw httpError('BG number is required');
    if (out.amount !== undefined && !(Number(out.amount) >= 0)) throw httpError('Amount must be a number');
    if (out.issue_date && out.expiry_date && out.expiry_date < out.issue_date) throw httpError('Expiry cannot be before issue date');
    return out;
}
async function saveBg(c, t, userId, id, body) {
    const row = bgBody(body);
    if (id) {
        const { data, error } = await c.from('bank_guarantees').update({ ...row, updated_by: userId || null, updated_at: new Date().toISOString() }).eq('tenant_id', t).eq('id', id).select().single();
        if (error) throw error; return data;
    }
    if (!row.bg_number) throw httpError('BG number is required');
    const { data, error } = await c.from('bank_guarantees').insert({ ...row, tenant_id: t, status: 'open', created_by: userId || null }).select().single();
    if (error) throw error;
    await logEvent(c, t, userId, 'bg', data.id, 'create', null, row, body.remarks);
    return data;
}

module.exports = { lcReport, bgReport, pdcDue, dashboard, partyInstruments, lcAction, bgAction, saveBg, LC_ACTIONS, BG_ACTIONS };
