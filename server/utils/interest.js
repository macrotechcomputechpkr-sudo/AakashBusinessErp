// =============================================
// utils/interest.js
// Interest on overdue customer balances.
//
// Who: customer ledgers (Sundry Debtors) with an Interest % on the ledger
//      master (or a rate given for the run).
// What: every debit on the ledger is a "bill" - its due date is the bill's
//      own Due Date (sales bills etc.), else the entry date + the ledger's
//      Credit Days. Credits (receipts, returns, credit notes) settle the
//      oldest bills first (FIFO, by date), so a bill's unpaid amount is known
//      day by day. Interest runs on the unpaid amount of each bill for every
//      day after its due date (+ optional grace days):
//          interest = unpaid x rate% x days / day basis (365)
//      one line per stretch of days with the same unpaid amount.
// Never twice: posted runs keep their lines; a bill's next interest starts
//      the day after the last day already charged (runs that were cancelled
//      don't count). Interest entries themselves are not charged interest.
// Posting: Dr each customer, Cr the interest income ledger (GL document
//      type 'interest_posting'); a run can be cancelled (GL reversed).
// =============================================

const { loadGroups } = require('./financialEngine');
const { classifyLedgers, allowed } = require('./ledgerPurpose');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);   // b - a
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
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
const DUE_TABLE = { sales_bill: 'sales_bills', sales_additional: 'sales_additional_entries', debit_note: 'debit_notes', journal_voucher: 'journal_vouchers', pdc: 'pdc_vouchers', cash_bank_entry: 'cash_bank_entries' };

// Pure: one ledger's bills and their interest lines.
// events: [{ date, dr, cr, key, doc_no, due_date, no_interest }]
function ledgerInterest(events, { rate, asOn, graceDays = 0, dayBasis = 365, chargedUpto = {} }) {
    const bills = [];
    let advance = 0;                                     // credits not yet used (advance / on account)
    const settle = (date, amount) => {
        let left = amount;
        for (const b of bills) {
            if (left <= 0.005) break;
            if (b.remaining <= 0.005) continue;
            const take = Math.min(b.remaining, left);
            b.remaining = round2(b.remaining - take); b.changes.push({ date, remaining: b.remaining });
            left = round2(left - take);
        }
        return left;
    };
    [...events].sort((a, b) => a.date.localeCompare(b.date) || (b.dr - a.dr)).forEach(e => {
        if (e.dr > 0) {
            const b = { key: e.key, doc_no: e.doc_no, date: e.date, due_date: e.due_date || e.date, amount: round2(e.dr), remaining: round2(e.dr), changes: [], no_interest: !!e.no_interest };
            bills.push(b);
            if (advance > 0.005) { const used = Math.min(advance, b.remaining); b.remaining = round2(b.remaining - used); advance = round2(advance - used); if (used) b.changes.push({ date: e.date, remaining: b.remaining }); }
        }
        if (e.cr > 0) advance = round2(advance + settle(e.date, e.cr));
    });
    const lines = [];
    bills.forEach(b => {
        if (b.no_interest) return;
        const start0 = addDays(b.due_date, graceDays + 1);                          // first day interest runs
        const already = chargedUpto[b.key] ? addDays(chargedUpto[b.key], 1) : null;
        const start = already && already > start0 ? already : start0;
        if (start > asOn) return;
        // unpaid amount on each day: piecewise from the changes
        let unpaid = b.amount, cursor = start;
        const steps = b.changes.filter(ch => ch.date < asOn || ch.date === asOn);
        steps.forEach(ch => { if (ch.date < start) unpaid = ch.remaining; });
        const pieces = steps.filter(ch => ch.date >= start);
        for (const ch of pieces) {
            // the amount paid on a day stops earning interest from that day
            const end = addDays(ch.date, -1);
            if (end >= cursor && unpaid > 0.005) lines.push({ key: b.key, doc_no: b.doc_no, doc_date: b.date, due_date: b.due_date, from_date: cursor, to_date: end, days: daysBetween(cursor, end) + 1, principal: round2(unpaid) });
            unpaid = ch.remaining;
            if (ch.date > cursor) cursor = ch.date;
        }
        if (unpaid > 0.005 && cursor <= asOn) lines.push({ key: b.key, doc_no: b.doc_no, doc_date: b.date, due_date: b.due_date, from_date: cursor, to_date: asOn, days: daysBetween(cursor, asOn) + 1, principal: round2(unpaid) });
    });
    return lines.map(l => ({ ...l, rate, interest: round2(l.principal * rate / 100 * l.days / dayBasis) })).filter(l => l.interest > 0);
}

async function computeInterest(c, t, q) {
    const asOn = q.as_on;
    if (!asOn) throw httpError('Choose the date up to which interest is calculated');
    const graceDays = Math.max(0, parseInt(q.grace_days, 10) || 0);
    const dayBasis = [360, 365, 366].includes(Number(q.day_basis)) ? Number(q.day_basis) : 365;
    const rateOverride = q.rate !== undefined && q.rate !== '' ? Number(q.rate) : null;
    const partyIds = csv(q.party_ids);
    const minInterest = Number(q.min_interest) || 0;

    const groups = await loadGroups(c, t);
    let parties = (await fetchAll(() => c.from('ledger_accounts').select('id, account_code, account_name, account_group_id, interest_rate, credit_days, opening_balance, opening_balance_type, opening_balance_date, is_active').eq('tenant_id', t).order('id')))
        .filter(l => groups[l.account_group_id]?.anchor === 'RECEIVABLES' && l.is_active !== false)
        .filter(l => !partyIds.length || partyIds.includes(l.id))
        .map(l => ({ ...l, rate: rateOverride !== null ? rateOverride : Number(l.interest_rate) || 0 }))
        .filter(l => l.rate > 0);
    if (!parties.length) return { as_on: asOn, parties: [], lines: [], totals: { parties: 0, interest: 0 } };
    const ids = parties.map(p => p.id);

    const gl = await inChunks(ids, ch => fetchAll(() => c.from('ledger_transaction_lines').select('id, ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date, document_type, document_id)')
        .eq('tenant_id', t).in('ledger_account_id', ch).lte('batch.batch_date', asOn).order('id')), 50);
    // due dates of the documents
    const byType = {};
    gl.forEach(l => { if (Number(l.debit_amount) > 0 && DUE_TABLE[l.batch.document_type]) (byType[l.batch.document_type] = byType[l.batch.document_type] || new Set()).add(l.batch.document_id); });
    const docs = {};
    for (const [type, set] of Object.entries(byType)) {
        (await inChunks([...set], async ch => { const { data } = await c.from(DUE_TABLE[type]).select('*').in('id', ch); return data || []; }))
            .forEach(h => { docs[`${type}:${h.id}`] = { doc_no: h.doc_no || '', due_date: h.due_date ? String(h.due_date).slice(0, 10) : null }; });
    }
    // days already charged, per bill
    const posted = await inChunks(ids, async ch => {
        const { data, error } = await c.from('interest_run_lines').select('ledger_id, source_key, to_date, run:run_id!inner(status)').eq('tenant_id', t).in('ledger_id', ch).eq('run.status', 'posted');
        if (error) return [];
        return data || [];
    });
    const upto = {};
    posted.forEach(p => { const k = `${p.ledger_id}|${p.source_key}`, d = String(p.to_date).slice(0, 10); if (!upto[k] || d > upto[k]) upto[k] = d; });

    const lines = [];
    const out = [];
    parties.forEach(p => {
        const events = [];
        const ob = (p.opening_balance_type === 'cr' ? -1 : 1) * (Number(p.opening_balance) || 0);
        if (ob) { const d = p.opening_balance_date ? String(p.opening_balance_date).slice(0, 10) : '2000-01-01';
            events.push({ date: d, dr: ob > 0 ? ob : 0, cr: ob < 0 ? -ob : 0, key: `opening:${p.id}`, doc_no: 'Opening', due_date: addDays(d, Number(p.credit_days) || 0) }); }
        gl.filter(l => l.ledger_account_id === p.id).forEach(l => {
            const date = String(l.batch.batch_date).slice(0, 10), type = l.batch.document_type, dk = `${type}:${l.batch.document_id}`, info = docs[dk] || {};
            events.push({ date, dr: Number(l.debit_amount) || 0, cr: Number(l.credit_amount) || 0, key: dk, doc_no: info.doc_no || type,
                due_date: info.due_date || addDays(date, Number(p.credit_days) || 0), no_interest: type === 'interest_posting' });
        });
        const chargedUpto = {};
        Object.entries(upto).forEach(([k, d]) => { const [lid, sk] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]; if (lid === p.id) chargedUpto[sk] = d; });
        const ls = ledgerInterest(events, { rate: p.rate, asOn, graceDays, dayBasis, chargedUpto }).map(l => ({ ...l, ledger_id: p.id, party_name: p.account_name }));
        const total = round2(ls.reduce((s, l) => s + l.interest, 0));
        if (total < Math.max(0.01, minInterest)) return;
        lines.push(...ls);
        const balance = round2(events.reduce((s, e) => s + e.dr - e.cr, 0));
        out.push({ ledger_id: p.id, code: p.account_code || '', name: p.account_name, rate: p.rate, credit_days: Number(p.credit_days) || 0, balance, bills: new Set(ls.map(l => l.key)).size, interest: total });
    });
    out.sort((a, b) => b.interest - a.interest);
    return { as_on: asOn, grace_days: graceDays, day_basis: dayBasis, parties: out, lines, totals: { parties: out.length, interest: round2(out.reduce((s, x) => s + x.interest, 0)) } };
}

async function nextNo(c, t, table, prefix) {
    const { data } = await c.from(table).select('doc_no').eq('tenant_id', t);
    const n = (data || []).map(r => Number(String(r.doc_no).replace(/\D/g, '')) || 0).reduce((a, b) => Math.max(a, b), 0) + 1;
    return `${prefix}-${String(n).padStart(4, '0')}`;
}

async function postInterest(c, t, userId, body) {
    if (!body.interest_ledger_id) throw httpError('Choose the interest income ledger');
    const cls = await classifyLedgers(c, t, [body.interest_ledger_id]);
    const x = cls[body.interest_ledger_id];
    if (!x || !(allowed(x, 'sales_goods') || x.statement === 'unmapped')) throw httpError('Interest ledger must be a Profit & Loss income ledger');
    const calc = await computeInterest(c, t, body);
    const chosen = csv(body.post_party_ids);
    const parties = chosen.length ? calc.parties.filter(p => chosen.includes(p.ledger_id)) : calc.parties;
    if (!parties.length) throw httpError('Nothing to post - no interest for the chosen parties');
    const keep = new Set(parties.map(p => p.ledger_id));
    const lines = calc.lines.filter(l => keep.has(l.ledger_id));
    const total = round2(parties.reduce((s, p) => s + p.interest, 0));
    const postingDate = body.posting_date || calc.as_on;
    const docNo = await nextNo(c, t, 'interest_runs', 'INT');
    const { data: run, error } = await c.from('interest_runs').insert({ tenant_id: t, status: 'posted', doc_no: docNo, posting_date: postingDate, period_to: calc.as_on, interest_ledger_id: body.interest_ledger_id,
        day_basis: calc.day_basis, grace_days: calc.grace_days, total_interest: total, party_count: parties.length, narration: body.narration || `Interest on overdue up to ${calc.as_on}`, created_by: userId || null }).select().single();
    if (error) throw error;
    const rows = lines.map(l => ({ tenant_id: t, run_id: run.id, ledger_id: l.ledger_id, source_type: l.key.startsWith('opening:') ? 'opening' : l.key.split(':')[0], source_id: l.key.startsWith('opening:') ? null : l.key.split(':')[1],
        source_key: l.key, doc_no: l.doc_no, doc_date: l.doc_date, due_date: l.due_date, from_date: l.from_date, to_date: l.to_date, days: l.days, principal: l.principal, rate: l.rate, interest: l.interest }));
    for (let i = 0; i < rows.length; i += 500) { const { error: e } = await c.from('interest_run_lines').insert(rows.slice(i, i + 500)); if (e) throw e; }
    const { data: batch, error: e2 } = await c.from('ledger_transaction_batches').insert({ tenant_id: t, document_type: 'interest_posting', document_id: run.id, batch_date: postingDate, narration: `Interest ${docNo} up to ${calc.as_on}`, created_by: userId || null }).select().single();
    if (e2) throw e2;
    const gl = parties.map(p => ({ tenant_id: t, batch_id: batch.id, ledger_account_id: p.ledger_id, debit_amount: p.interest, credit_amount: 0, narration: `Interest @${p.rate}% on overdue bills up to ${calc.as_on}` }))
        .concat([{ tenant_id: t, batch_id: batch.id, ledger_account_id: body.interest_ledger_id, debit_amount: 0, credit_amount: total, narration: `Interest ${docNo}` }]);
    const { error: e3 } = await c.from('ledger_transaction_lines').insert(gl);
    if (e3) throw e3;
    return { run_id: run.id, doc_no: docNo, parties: parties.length, total };
}

async function cancelInterest(c, t, userId, runId, reason) {
    if (!reason) throw httpError('Give a reason for cancelling');
    const { data: run } = await c.from('interest_runs').select('*').eq('tenant_id', t).eq('id', runId).maybeSingle();
    if (!run) throw httpError('Interest run not found', 404);
    if (run.status === 'cancelled') throw httpError('Already cancelled');
    const { data: batches } = await c.from('ledger_transaction_batches').select('id').eq('document_type', 'interest_posting').eq('document_id', runId);
    for (const b of batches || []) { await c.from('ledger_transaction_lines').delete().eq('batch_id', b.id); await c.from('ledger_transaction_batches').delete().eq('id', b.id); }
    const { error } = await c.from('interest_runs').update({ status: 'cancelled', cancellation_reason: reason, cancelled_at: new Date().toISOString(), cancelled_by: userId || null }).eq('id', runId);
    if (error) throw error;
    return { ok: true };
}

// Register of posted interest: runs, and per party / bill what has been charged up to when.
async function interestRegister(c, t, q) {
    const runs = await fetchAll(() => c.from('interest_runs').select('*').eq('tenant_id', t).order('posting_date', { ascending: false }));
    const lines = await inChunks(runs.map(r => r.id), async ch => { const { data } = await c.from('interest_run_lines').select('*').in('run_id', ch); return data || []; });
    const names = Object.fromEntries((await inChunks([...new Set(lines.map(l => l.ledger_id))], async ch => { const { data } = await c.from('ledger_accounts').select('id, account_name').in('id', ch); return data || []; })).map(x => [x.id, x.account_name]));
    const runById = Object.fromEntries(runs.map(r => [r.id, r]));
    let rows = lines.map(l => ({ ...l, party_name: names[l.ledger_id] || '', run_no: runById[l.run_id]?.doc_no, run_status: runById[l.run_id]?.status, posting_date: runById[l.run_id]?.posting_date }));
    if (q.party_id) rows = rows.filter(r => r.ledger_id === q.party_id);
    if (q.run_id) rows = rows.filter(r => r.run_id === q.run_id);
    const byBill = {};
    rows.filter(r => r.run_status === 'posted').forEach(r => {
        const k = `${r.ledger_id}|${r.source_key}`;
        const b = byBill[k] = byBill[k] || { ledger_id: r.ledger_id, party_name: r.party_name, doc_no: r.doc_no, doc_date: r.doc_date, due_date: r.due_date, charged_upto: null, days: 0, interest: 0, runs: new Set() };
        const d = String(r.to_date).slice(0, 10); if (!b.charged_upto || d > b.charged_upto) b.charged_upto = d;
        b.days += r.days; b.interest = round2(b.interest + Number(r.interest)); b.runs.add(r.run_no);
    });
    return { runs, lines: rows.sort((a, b) => String(a.party_name).localeCompare(String(b.party_name)) || String(a.from_date).localeCompare(String(b.from_date))),
        bills: Object.values(byBill).map(b => ({ ...b, runs: [...b.runs].join(', ') })).sort((a, b) => a.party_name.localeCompare(b.party_name)) };
}

module.exports = { ledgerInterest, computeInterest, postInterest, cancelInterest, interestRegister, nextNo };
