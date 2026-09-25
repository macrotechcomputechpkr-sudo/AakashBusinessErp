// =============================================
// utils/bankReco.js
// Bank Reconciliation.
//
// BOOK side: every line of a bank ledger in ledger_transaction_lines, with
// its document (type / no / party / cheque or ref no / narration) and the
// ledgers on the other side of the entry. Debit = money into the bank
// (deposit), credit = money out (withdrawal / cheque issued).
//
// BANK side: statement lines uploaded from the bank's Excel / CSV (read in
// the browser). A fingerprint (date | amounts | balance | description |
// repeat no) skips lines already imported from an overlapping statement.
//
// CLEARING: a book line is cleared on a date - ticked by hand, or matched to
// a statement line (cleared on the statement's date).
//
// MATCHING ENGINE - free, runs here, no outside service. Every statement
// line is compared with every uncleared book line of the same direction
// and amount; the pair gets a score out of 100 from:
//   amount        same amount (required) ................ 20
//   cheque / ref  same cheque or reference number ....... 40
//   date          days between book and bank date ...... up to 30
//                 (bank after book is normal for cheques; a date beyond the
//                 window is allowed only when the cheque no matches)
//   text          party / ledger names, doc no and narration found in the
//                 bank's description (fuzzy, typo-tolerant) .. up to 30
//   unique        the only candidate on both sides ...... +15
// Pairs are taken best score first, one to one. A statement line left over
// is then tried against 2-4 book lines of the same direction within the
// window whose amounts add up to it (one deposit slip, several cheques).
// Score >= 80 = high confidence (safe to auto-apply); 50-79 = review.
//
// BRS as on a date:
//   balance as per books
//   + cheques issued / payments not yet cleared by the bank
//   - deposits not yet credited by the bank
//   + bank credits not in the books (interest, direct deposits)
//   - bank debits not in the books (charges, direct debits)
//   = balance as per bank, compared with the statement's running balance.
// =============================================

const { loadGroups } = require('./financialEngine');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
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
const httpError = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------------------------------------------------------------- ledgers
// Cash / bank ledgers: under the Cash & Bank or Bank Overdraft groups, or
// tagged cash / bank. Bank = tagged bank, has a bank account no, or sits in
// an overdraft / bank-named group; the rest of Cash & Bank is cash.
async function cashBankLedgers(c, t) {
    const groups = await loadGroups(c, t);
    const ledgers = await fetchAll(() => c.from('ledger_accounts').select('*').eq('tenant_id', t).order('id'));
    const out = [];
    ledgers.forEach(l => {
        const g = groups[l.account_group_id];
        const anchor = g ? g.anchor : null;
        const tagged = [l.category_type, l.account_type].filter(Boolean);
        if (!(anchor === 'CASH_BANK' || anchor === 'BANK_OVERDRAFT' || tagged.includes('bank') || tagged.includes('cash'))) return;
        if (l.is_active === false) return;
        const bankish = tagged.includes('bank') || !!l.bank_account_number || anchor === 'BANK_OVERDRAFT' || /bank|od\b|overdraft/i.test(g?.group_name || '');
        out.push({ id: l.id, code: l.account_code || '', name: l.account_name, kind: anchor === 'BANK_OVERDRAFT' ? 'overdraft' : bankish && !tagged.includes('cash') ? 'bank' : 'cash',
            bank_name: l.bank_name || '', account_number: l.bank_account_number || '', limit: Number(l.credit_limit) || 0, group_name: g?.group_name || '',
            opening: (l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0) });
    });
    return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

// Signed (Dr +) balance of ledgers at the end of asOn: { id: balance }
async function balancesAsOn(c, t, ledgers, asOn) {
    const out = Object.fromEntries(ledgers.map(l => [l.id, l.opening || 0]));
    const ids = ledgers.map(l => l.id);
    const lines = await inChunks(ids, ch => fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)')
        .eq('tenant_id', t).in('ledger_account_id', ch).lte('batch.batch_date', asOn).order('id')), 50);
    lines.forEach(l => { out[l.ledger_account_id] = (out[l.ledger_account_id] || 0) + (Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0); });
    Object.keys(out).forEach(k => { out[k] = round2(out[k]); });
    return out;
}

// ---------------------------------------------------------------- book lines
const DOC_TABLE = {
    cash_bank_entry: ['Cash / Bank Entry', 'cash_bank_entries'], pdc: ['PDC', 'pdc_vouchers'], journal_voucher: ['Journal', 'journal_vouchers'],
    sales_bill: ['Sales Bill', 'sales_bills'], sales_return: ['Sales Return', 'sales_returns'], purchase_bill: ['Purchase Bill', 'purchase_bills'],
    purchase_return: ['Purchase Return', 'purchase_returns'], credit_note: ['Credit Note', 'credit_notes'], debit_note: ['Debit Note', 'debit_notes'],
    sales_additional: ['Sales Additional', 'sales_additional_entries'], purchase_additional_expense: ['Purchase Expense', 'purchase_additional_expenses'],
    bulk_cash_settlement: ['Bulk Settlement', 'bulk_cash_settlements']
};

async function bookLines(c, t, bankId, { from = null, to, uncleared = false } = {}) {
    // period lines, plus (for reconciling) every earlier line still uncleared
    const lines = await fetchAll(() => {
        let q = c.from('ledger_transaction_lines').select('id, debit_amount, credit_amount, narration, batch_id, batch:batch_id!inner(id, batch_date, document_type, document_id, narration)')
            .eq('tenant_id', t).eq('ledger_account_id', bankId);
        if (to) q = q.lte('batch.batch_date', to);
        return q.order('id');
    });
    const marks = await inChunks(lines.map(l => l.id), async ids => {
        const { data, error } = await c.from('bank_reconciliation_marks').select('ledger_line_id, cleared_date, statement_line_id, method, score, remarks').eq('tenant_id', t).in('ledger_line_id', ids);
        if (error) throw error; return data || [];
    });
    const markOf = Object.fromEntries(marks.map(m => [m.ledger_line_id, m]));
    let rows = lines.map(l => ({ l, date: String(l.batch.batch_date).slice(0, 10), mark: markOf[l.id] || null }));
    if (from) rows = rows.filter(x => x.date >= from || (uncleared && (!x.mark || (to && String(x.mark.cleared_date).slice(0, 10) > to))));
    // documents
    const byType = {};
    rows.forEach(({ l }) => { if (DOC_TABLE[l.batch.document_type]) (byType[l.batch.document_type] = byType[l.batch.document_type] || new Set()).add(l.batch.document_id); });
    const docs = {};
    for (const [type, ids] of Object.entries(byType)) {
        (await inChunks([...ids], async ch => { const { data } = await c.from(DOC_TABLE[type][1]).select('*').in('id', ch); return data || []; }))
            .forEach(h => { docs[`${type}:${h.id}`] = h; });
    }
    // the other side of each entry
    const batchIds = [...new Set(rows.map(x => x.l.batch_id))];
    const others = await inChunks(batchIds, async ch => {
        const { data, error } = await c.from('ledger_transaction_lines').select('batch_id, ledger_account_id').in('batch_id', ch).neq('ledger_account_id', bankId);
        if (error) throw error; return data || [];
    });
    const ledgerIds = [...new Set(others.map(o => o.ledger_account_id))];
    const names = Object.fromEntries((await inChunks(ledgerIds, async ch => {
        const { data } = await c.from('ledger_accounts').select('id, account_name').in('id', ch); return data || [];
    })).map(x => [x.id, x.account_name]));
    const otherOf = {};
    others.forEach(o => { const s = otherOf[o.batch_id] = otherOf[o.batch_id] || new Set(); if (names[o.ledger_account_id]) s.add(names[o.ledger_account_id]); });
    return rows.map(({ l, date, mark }) => {
        const type = l.batch.document_type, h = docs[`${type}:${l.batch.document_id}`] || {};
        const dr = Number(l.debit_amount) || 0, cr = Number(l.credit_amount) || 0;
        return {
            id: l.id, date, document_type: type, doc_label: DOC_TABLE[type]?.[0] || type, document_id: l.batch.document_id, doc_no: h.doc_no || '',
            party: h.party_name_snapshot || h.customer_name_snapshot || h.vendor_name_snapshot || '', counter: [...(otherOf[l.batch_id] || [])].join(', '),
            ref_no: h.cheque_no || h.ref_no || h.instrument_no || '', mode: h.payment_mode || (type === 'pdc' ? 'cheque' : ''),
            narration: l.narration || l.batch.narration || h.narration || '',
            deposit: round2(dr), withdrawal: round2(cr), amount: round2(dr - cr),
            cleared_date: mark ? String(mark.cleared_date).slice(0, 10) : null, statement_line_id: mark?.statement_line_id || null, method: mark?.method || null, score: mark?.score ?? null
        };
    }).sort((a, b) => a.date.localeCompare(b.date) || String(a.doc_no).localeCompare(String(b.doc_no)));
}

// ---------------------------------------------------------------- statement import
const normDesc = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function fingerprintLines(lines) {
    const seen = {};
    return lines.map(x => {
        const base = [x.txn_date, round2(x.withdrawal).toFixed(2), round2(x.deposit).toFixed(2), x.balance === null || x.balance === undefined || x.balance === '' ? '' : round2(x.balance).toFixed(2), normDesc(x.description).slice(0, 180), String(x.ref_no || '').trim()].join('|');
        seen[base] = (seen[base] || 0) + 1;
        return `${base}#${seen[base]}`.slice(0, 300);
    });
}
function cleanLine(x, i) {
    const date = String(x.txn_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(`Line ${i + 1}: date "${x.txn_date}" is not YYYY-MM-DD`);
    const num = v => (v === null || v === undefined || v === '' ? 0 : Number(String(v).replace(/,/g, '')));
    let w = num(x.withdrawal), d = num(x.deposit);
    if (!Number.isFinite(w) || !Number.isFinite(d)) throw httpError(`Line ${i + 1}: amount is not a number`);
    if (w < 0) { d += -w; w = 0; }
    if (d < 0) { w += -d; d = 0; }
    const bal = x.balance === null || x.balance === undefined || x.balance === '' ? null : num(x.balance);
    return { txn_date: date, value_date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.value_date || '')) ? x.value_date : null, description: String(x.description || '').slice(0, 2000),
        ref_no: String(x.ref_no || '').slice(0, 100) || null, withdrawal: round2(w), deposit: round2(d), balance: Number.isFinite(bal) ? round2(bal) : null };
}

async function importStatement(c, t, userId, body) {
    const bankId = body.bank_ledger_id;
    if (!bankId) throw httpError('Choose the bank ledger');
    const raw = Array.isArray(body.lines) ? body.lines : [];
    if (!raw.length) throw httpError('The statement has no transaction lines');
    if (raw.length > 20000) throw httpError('Too many lines in one statement (max 20000)');
    const lines = raw.map(cleanLine).filter(x => x.withdrawal || x.deposit);
    const fps = fingerprintLines(lines);
    const existing = new Set((await inChunks(fps, async ch => {
        const { data, error } = await c.from('bank_statement_lines').select('fingerprint').eq('tenant_id', t).eq('bank_ledger_id', bankId).in('fingerprint', ch);
        if (error) throw error; return data || [];
    }, 100)).map(x => x.fingerprint));
    const fresh = lines.map((x, i) => ({ ...x, fingerprint: fps[i] })).filter(x => !existing.has(x.fingerprint));
    const dates = lines.map(x => x.txn_date).sort();
    const withBal = lines.filter(x => x.balance !== null);
    const { data: st, error } = await c.from('bank_statements').insert({
        tenant_id: t, bank_ledger_id: bankId, file_name: String(body.file_name || '').slice(0, 255) || null, statement_from: dates[0], statement_to: dates[dates.length - 1],
        opening_balance: withBal.length ? round2(withBal[0].balance + withBal[0].withdrawal - withBal[0].deposit) : null, closing_balance: withBal.length ? withBal[withBal.length - 1].balance : null,
        line_count: fresh.length, skipped_duplicates: lines.length - fresh.length, created_by: userId || null
    }).select('id').single();
    if (error) throw error;
    const rows = fresh.map((x, i) => ({ tenant_id: t, statement_id: st.id, bank_ledger_id: bankId, line_no: i + 1, ...x, status: 'unmatched' }));
    for (let i = 0; i < rows.length; i += 500) {
        const { error: e2 } = await c.from('bank_statement_lines').insert(rows.slice(i, i + 500));
        if (e2) throw e2;
    }
    return { statement_id: st.id, imported: rows.length, skipped_duplicates: lines.length - fresh.length, from: dates[0], to: dates[dates.length - 1] };
}

async function statementLines(c, t, bankId, { from = null, to = null, status = null } = {}) {
    return (await fetchAll(() => {
        let q = c.from('bank_statement_lines').select('*').eq('tenant_id', t).eq('bank_ledger_id', bankId);
        if (from) q = q.gte('txn_date', from);
        if (to) q = q.lte('txn_date', to);
        if (status) q = q.in('status', csv(status));
        return q.order('txn_date').order('line_no');
    })).map(x => ({ ...x, txn_date: String(x.txn_date).slice(0, 10), withdrawal: Number(x.withdrawal) || 0, deposit: Number(x.deposit) || 0, balance: x.balance === null ? null : Number(x.balance) }));
}

// ---------------------------------------------------------------- matching engine
const STOP = new Set(['the', 'and', 'for', 'from', 'by', 'chq', 'cheque', 'cq', 'ref', 'trf', 'transfer', 'txn', 'fund', 'neft', 'rtgs', 'ips', 'connectips', 'deposit', 'dep',
    'withdrawal', 'wdl', 'cash', 'clg', 'clearing', 'inward', 'outward', 'being', 'amount', 'paid', 'received', 'payment', 'receipt', 'ltd', 'pvt', 'private', 'limited',
    'bank', 'acc', 'account', 'with', 'via', 'mobile', 'online', 'branch', 'entry', 'voucher', 'bill', 'against', 'towards', 'sales', 'purchase', 'npr', 'nrs', 'rs']);
const tokens = s => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').split(' ').filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
const digitRuns = s => (String(s || '').match(/\d{4,}/g) || []).map(d => d.replace(/^0+/, '')).filter(d => d.length >= 3);
function dice(a, b) {                                     // bigram similarity 0..1, typo tolerant
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bg = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
    const A = bg(a), B = bg(b);
    let inter = 0;
    A.forEach((n, k) => { inter += Math.min(n, B.get(k) || 0); });
    return (2 * inter) / (a.length - 1 + b.length - 1);
}
// share of the book's words found (fuzzily) in the bank description
function textScore(bookText, stmtTokens) {
    const bt = [...new Set(tokens(bookText))];
    if (!bt.length || !stmtTokens.length) return 0;
    let hit = 0;
    bt.forEach(w => { const best = Math.max(...stmtTokens.map(s => (s.includes(w) || w.includes(s) && s.length >= 4 ? 1 : dice(w, s)))); if (best >= 0.75) hit += best; });
    return Math.min(1, hit / Math.min(bt.length, 3));
}

function scorePair(s, b, opts) {
    const amtS = s.deposit ? s.deposit : -s.withdrawal;
    if (Math.abs(amtS - b.amount) > 0.005) return null;
    const window = opts.window;
    const d = dayDiff(b.date, s.txn_date);                  // + = bank after book
    const bookRefs = digitRuns(b.ref_no).concat(digitRuns(b.doc_no).filter(x => x.length >= 5));
    const stmtRefs = new Set(digitRuns(s.ref_no).concat(digitRuns(s.description)));
    const refHit = bookRefs.some(r => stmtRefs.has(r));
    if (Math.abs(d) > window && !(refHit && d >= -window && d <= 60)) return null;
    let score = 20, why = ['amount'];
    if (refHit) { score += 40; why.push('cheque/ref no'); }
    const dateScore = Math.abs(d) <= window ? 30 * (1 - Math.abs(d) / (window + 1)) * (d < 0 ? 0.7 : 1) : 5;
    score += dateScore; why.push(d === 0 ? 'same date' : `${Math.abs(d)} day(s) ${d > 0 ? 'later' : 'earlier'} in bank`);
    const st = s._tokens || (s._tokens = tokens(`${s.description} ${s.ref_no || ''}`));
    const ts = Math.max(textScore(b.party, st), textScore(b.counter, st), textScore(`${b.narration} ${b.doc_no}`, st) * 0.8);
    if (ts > 0) { score += 30 * ts; why.push(`text ${Math.round(ts * 100)}%`); }
    return { score: Math.min(100, Math.round(score)), why, days: d, ref: refHit };
}

// stmts: statement lines (unmatched), books: book lines (uncleared) -> proposals
function matchEngine(stmts, books, { window = 7, minScore = 50, groups = true } = {}) {
    const opts = { window };
    const pairs = [];
    const candS = {}, candB = {};
    stmts.forEach(s => books.forEach(b => {
        const r = scorePair(s, b, opts);
        if (!r) return;
        pairs.push({ s, b, ...r });
        candS[s.id] = (candS[s.id] || 0) + 1; candB[b.id] = (candB[b.id] || 0) + 1;
    }));
    pairs.forEach(p => { if (candS[p.s.id] === 1 && candB[p.b.id] === 1) { p.score = Math.min(100, p.score + 15); p.why.push('only candidate'); } });
    pairs.sort((a, b) => b.score - a.score || Math.abs(a.days) - Math.abs(b.days));
    const usedS = new Set(), usedB = new Set(), out = [];
    pairs.forEach(p => {
        if (p.score < minScore || usedS.has(p.s.id) || usedB.has(p.b.id)) return;
        usedS.add(p.s.id); usedB.add(p.b.id);
        out.push({ statement_line_id: p.s.id, book_line_ids: [p.b.id], score: p.score, confidence: p.score >= 80 ? 'high' : 'review', reason: p.why.join(', '), kind: 'one' });
    });
    if (groups) {
        // one bank line = several book lines (2-4) of the same direction within the window
        stmts.filter(s => !usedS.has(s.id)).forEach(s => {
            const target = s.deposit ? s.deposit : -s.withdrawal;
            const pool = books.filter(b => !usedB.has(b.id) && Math.sign(b.amount) === Math.sign(target) && Math.abs(b.amount) < Math.abs(target) && Math.abs(dayDiff(b.date, s.txn_date)) <= window)
                .sort((a, b) => Math.abs(dayDiff(a.date, s.txn_date)) - Math.abs(dayDiff(b.date, s.txn_date))).slice(0, 14);
            let found = null;
            const walk = (start, picked, sum) => {
                if (found || picked.length > 4) return;
                if (picked.length >= 2 && Math.abs(sum - target) < 0.005) { found = [...picked]; return; }
                for (let i = start; i < pool.length && !found; i++) {
                    const next = sum + pool[i].amount;
                    if (Math.abs(next) - Math.abs(target) > 0.005) continue;
                    picked.push(pool[i]); walk(i + 1, picked, next); picked.pop();
                }
            };
            walk(0, [], 0);
            if (found) {
                found.forEach(b => usedB.add(b.id)); usedS.add(s.id);
                const maxDays = Math.max(...found.map(b => Math.abs(dayDiff(b.date, s.txn_date))));
                const score = Math.round(55 + 20 * (1 - maxDays / (window + 1)));
                if (score >= minScore) out.push({ statement_line_id: s.id, book_line_ids: found.map(b => b.id), score, confidence: 'review', reason: `${found.length} book entries add up to this bank line`, kind: 'group' });
            }
        });
    }
    return out;
}

// Suggested nature of a bank line that is not in the books.
function suggestNature(s) {
    const d = String(s.description || '').toLowerCase();
    if (/(charge|commission|comm\b|fee|sms|service|swift|stmt|statement|cheque book|chq book|annual|renewal|penal)/.test(d)) return 'Bank charges';
    if (/(interest|int\.?\s*(pd|paid|cr|credit|app|capitali))/.test(d)) return s.deposit ? 'Interest received' : 'Interest paid';
    if (/(tds|tax deducted|withholding)/.test(d)) return 'TDS';
    if (/(loan|emi|installment|instalment)/.test(d)) return 'Loan';
    if (/(return|bounce|dishono|unpaid|insufficient)/.test(d)) return 'Cheque returned';
    if (/(atm|pos|card)/.test(d)) return 'Card / ATM';
    return s.deposit ? 'Direct deposit' : 'Direct debit';
}

async function autoMatch(c, t, userId, body) {
    const bankId = body.bank_ledger_id;
    if (!bankId) throw httpError('Choose the bank ledger');
    const window = Math.min(60, Math.max(0, parseInt(body.window_days, 10) || 7));
    const minScore = Math.min(100, Math.max(30, parseInt(body.min_score, 10) || 50));
    const stmts = (await statementLines(c, t, bankId, { from: body.from || null, to: body.to || null, status: 'unmatched' }));
    const books = (await bookLines(c, t, bankId, { to: body.to ? addDays(body.to, window) : null })).filter(b => !b.cleared_date);
    const proposals = matchEngine(stmts, books, { window, minScore, groups: body.groups !== false });
    const sById = Object.fromEntries(stmts.map(s => [s.id, s])), bById = Object.fromEntries(books.map(b => [b.id, b]));
    const detailed = proposals.map(p => ({ ...p, statement: strip(sById[p.statement_line_id]), books: p.book_line_ids.map(id => bById[id]) }));
    let applied = 0;
    if (body.apply) {
        const only = body.apply === 'high' ? detailed.filter(p => p.confidence === 'high') : body.apply === 'selected' ? detailed.filter(p => (body.selected || []).includes(p.statement_line_id)) : detailed;
        for (const p of only) { await linkLines(c, t, userId, bankId, p.statement_line_id, p.book_line_ids, 'auto', p.score); applied++; }
    }
    const matchedS = new Set(proposals.map(p => p.statement_line_id));
    return { proposals: detailed, applied, window_days: window, min_score: minScore,
        unmatched_statement: stmts.filter(s => !matchedS.has(s.id)).map(s => ({ ...strip(s), suggestion: suggestNature(s) })), uncleared_book_count: books.length };
}
const strip = s => (s ? (({ _tokens, ...rest }) => rest)(s) : s);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function linkLines(c, t, userId, bankId, statementLineId, bookLineIds, method = 'manual', score = null) {
    const { data: s, error } = await c.from('bank_statement_lines').select('id, txn_date, deposit, withdrawal, bank_ledger_id, status').eq('tenant_id', t).eq('id', statementLineId).maybeSingle();
    if (error) throw error;
    if (!s || s.bank_ledger_id !== bankId) throw httpError('Statement line not found for this bank', 404);
    const ids = [...new Set(bookLineIds || [])];
    if (!ids.length) throw httpError('Pick the book entries to match');
    const { data: lines, error: e2 } = await c.from('ledger_transaction_lines').select('id, ledger_account_id, debit_amount, credit_amount').eq('tenant_id', t).in('id', ids);
    if (e2) throw e2;
    if ((lines || []).length !== ids.length || lines.some(l => l.ledger_account_id !== bankId)) throw httpError('Some entries are not lines of this bank ledger');
    const sum = round2(lines.reduce((a, l) => a + (Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0), 0));
    const target = round2((Number(s.deposit) || 0) - (Number(s.withdrawal) || 0));
    if (Math.abs(sum - target) > 0.005) throw httpError(`Amounts differ: bank ${target.toFixed(2)}, books ${sum.toFixed(2)}`);
    await c.from('bank_reconciliation_marks').delete().eq('tenant_id', t).in('ledger_line_id', ids);
    const { error: e3 } = await c.from('bank_reconciliation_marks').insert(ids.map(id => ({ tenant_id: t, bank_ledger_id: bankId, ledger_line_id: id,
        cleared_date: String(s.txn_date).slice(0, 10), statement_line_id: s.id, method, score, created_by: userId || null })));
    if (e3) throw e3;
    const { error: e4 } = await c.from('bank_statement_lines').update({ status: 'matched', match_score: score, matched_at: new Date().toISOString(), matched_by: userId || null }).eq('id', s.id);
    if (e4) throw e4;
    return { matched: ids.length };
}

async function unlinkStatementLine(c, t, bankId, statementLineId) {
    await c.from('bank_reconciliation_marks').delete().eq('tenant_id', t).eq('bank_ledger_id', bankId).eq('statement_line_id', statementLineId);
    const { error } = await c.from('bank_statement_lines').update({ status: 'unmatched', match_score: null, matched_at: null, matched_by: null }).eq('tenant_id', t).eq('id', statementLineId);
    if (error) throw error;
    return { ok: true };
}

async function setIgnored(c, t, bankId, ids, ignored, remarks) {
    const { error } = await c.from('bank_statement_lines').update({ status: ignored ? 'ignored' : 'unmatched', remarks: remarks || null }).eq('tenant_id', t).eq('bank_ledger_id', bankId)
        .in('id', ids).neq('status', 'matched');
    if (error) throw error;
    return { ok: true };
}

// Manual: tick book lines as cleared on a date (no statement needed).
async function clearManual(c, t, userId, bankId, items) {
    const valid = (items || []).filter(x => x.id && /^\d{4}-\d{2}-\d{2}$/.test(String(x.cleared_date || '')));
    if (!valid.length) throw httpError('Give each entry a cleared date');
    const ids = valid.map(x => x.id);
    const { data: lines, error } = await c.from('ledger_transaction_lines').select('id, ledger_account_id').eq('tenant_id', t).in('id', ids);
    if (error) throw error;
    if ((lines || []).length !== ids.length || lines.some(l => l.ledger_account_id !== bankId)) throw httpError('Some entries are not lines of this bank ledger');
    await c.from('bank_reconciliation_marks').delete().eq('tenant_id', t).in('ledger_line_id', ids);
    const { error: e2 } = await c.from('bank_reconciliation_marks').insert(valid.map(x => ({ tenant_id: t, bank_ledger_id: bankId, ledger_line_id: x.id, cleared_date: x.cleared_date,
        method: 'manual', remarks: x.remarks || null, created_by: userId || null })));
    if (e2) throw e2;
    return { cleared: valid.length };
}

async function unclear(c, t, bankId, ids) {
    const { data: marks } = await c.from('bank_reconciliation_marks').select('statement_line_id').eq('tenant_id', t).eq('bank_ledger_id', bankId).in('ledger_line_id', ids);
    const { error } = await c.from('bank_reconciliation_marks').delete().eq('tenant_id', t).eq('bank_ledger_id', bankId).in('ledger_line_id', ids);
    if (error) throw error;
    // a statement line left with no book entries goes back to unmatched
    const sIds = [...new Set((marks || []).map(m => m.statement_line_id).filter(Boolean))];
    for (const sid of sIds) {
        const { data: left } = await c.from('bank_reconciliation_marks').select('id').eq('tenant_id', t).eq('statement_line_id', sid);
        if (!(left || []).length) await c.from('bank_statement_lines').update({ status: 'unmatched', match_score: null }).eq('id', sid);
    }
    return { uncleared: ids.length };
}

async function deleteStatement(c, t, bankId, statementId) {
    const lines = await fetchAll(() => c.from('bank_statement_lines').select('id').eq('tenant_id', t).eq('statement_id', statementId).order('id'));
    const ids = lines.map(l => l.id);
    for (let i = 0; i < ids.length; i += 150) await c.from('bank_reconciliation_marks').delete().eq('tenant_id', t).in('statement_line_id', ids.slice(i, i + 150));
    const { error } = await c.from('bank_statements').delete().eq('tenant_id', t).eq('bank_ledger_id', bankId).eq('id', statementId);
    if (error) throw error;
    return { deleted: ids.length };
}

async function statements(c, t, bankId) {
    const { data, error } = await c.from('bank_statements').select('*').eq('tenant_id', t).eq('bank_ledger_id', bankId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

// ---------------------------------------------------------------- BRS
async function brs(c, t, bankId, asOn) {
    if (!asOn) throw httpError('Choose the As on date');
    const ledgers = await cashBankLedgers(c, t);
    const bank = ledgers.find(l => l.id === bankId);
    if (!bank) throw httpError('Not a cash / bank ledger', 404);
    const book = (await balancesAsOn(c, t, [bank], asOn))[bankId] || 0;
    const lines = await bookLines(c, t, bankId, { to: asOn });
    const open = lines.filter(l => !l.cleared_date || l.cleared_date > asOn);
    const issued = open.filter(l => l.withdrawal > 0), deposits = open.filter(l => l.deposit > 0);
    const stmts = await statementLines(c, t, bankId, { to: asOn });
    // statement lines matched only to book entries dated after asOn count as "not in books" on asOn
    const bookDateOfStmt = {};
    lines.forEach(l => { if (l.statement_line_id) bookDateOfStmt[l.statement_line_id] = true; });
    const notInBooks = stmts.filter(s => s.status === 'unmatched' || (s.status === 'matched' && !bookDateOfStmt[s.id]));
    const bankCredits = notInBooks.filter(s => s.deposit > 0).map(s => ({ ...s, suggestion: suggestNature(s) }));
    const bankDebits = notInBooks.filter(s => s.withdrawal > 0).map(s => ({ ...s, suggestion: suggestNature(s) }));
    const sum = (a, k) => round2(a.reduce((x, y) => x + (Number(y[k]) || 0), 0));
    const computed = round2(book + sum(issued, 'withdrawal') - sum(deposits, 'deposit') + sum(bankCredits, 'deposit') - sum(bankDebits, 'withdrawal'));
    const withBal = stmts.filter(s => s.balance !== null);
    const last = withBal.length ? withBal[withBal.length - 1] : null;
    return {
        bank, as_on: asOn, balance_per_books: round2(book),
        cheques_not_presented: issued, cheques_not_presented_total: sum(issued, 'withdrawal'),
        deposits_not_credited: deposits, deposits_not_credited_total: sum(deposits, 'deposit'),
        bank_credits_not_in_books: bankCredits, bank_credits_total: sum(bankCredits, 'deposit'),
        bank_debits_not_in_books: bankDebits, bank_debits_total: sum(bankDebits, 'withdrawal'),
        balance_per_bank_computed: computed,
        statement_balance: last ? { date: last.txn_date, balance: last.balance } : null,
        difference: last ? round2(last.balance - computed) : null,
        ignored_lines: stmts.filter(s => s.status === 'ignored').length
    };
}

module.exports = { cashBankLedgers, balancesAsOn, bookLines, importStatement, statementLines, statements, deleteStatement, autoMatch, matchEngine, scorePair,
    linkLines, unlinkStatementLine, setIgnored, clearManual, unclear, brs, suggestNature, fingerprintLines, tokens, dice };
