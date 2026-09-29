// =============================================
// utils/dayBook.js
// All-in-one Day Book (/api/day-book, pages/DayBook.jsx): every voucher of
// the period read from the documents themselves, so it can be filtered by
// who made it (user) and by the salesman / agent on it.
//
// Filters: date_from / date_to, user_ids (created_by), agent_ids (the
//   document's agent - a Cash / Bank entry also by the agent of its lines),
//   voucher_types (see TYPES), party_ids, include_draft (drafts / pending too).
//   No user / agent = the whole business.
// Output:
//   summary   per voucher type: count, cash, credit, total (sales / purchase
//             bills split into cash and credit; money received on a credit
//             bill counts as cash; returns by their settlement)
//   cash_bank cash and bank separately: receipts and payments of the shown
//             vouchers (from their ledger postings); opening / closing only
//             when no user / agent / type / party filter narrows the book
//   parties   party-wise credit summary: credit sales, sales returns,
//             receipts, credit purchases, purchase returns, payments, notes,
//             PDC, net movement and closing balance
//   rows      every voucher: date, type, no, party, agent, user, mode
//             (cash / bank / credit / pdc / adjustment), amount
//   by_agent / by_user  totals per agent / user
// =============================================
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const csv = v => (Array.isArray(v) ? v : v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
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

// voucher type -> label, group, GL document_type
const TYPES = {
    sales_bill: ['Sales Bill', 'Sales', 'sales_bill'],
    sales_return: ['Sales Return', 'Sales', 'sales_return'],
    sales_nonsaleable_return: ['Sales Non-saleable Return', 'Sales', 'sales_nonsalable_return'],
    sales_additional: ['Sales Additional', 'Sales', 'sales_additional'],
    purchase_bill: ['Purchase Bill', 'Purchase', 'purchase_bill'],
    purchase_return: ['Purchase Return', 'Purchase', 'purchase_return'],
    purchase_additional: ['Purchase Additional', 'Purchase', 'purchase_additional_expense'],
    receipt: ['Cash / Bank Receipt', 'Cash / Bank', 'cash_bank_entry'],
    payment: ['Cash / Bank Payment', 'Cash / Bank', 'cash_bank_entry'],
    pdc_received: ['PDC Received', 'PDC', 'pdc'],
    pdc_issued: ['PDC Issued', 'PDC', 'pdc'],
    journal: ['Journal Voucher', 'Journal', 'journal_voucher'],
    credit_note: ['Credit Note', 'Journal', 'credit_note'],
    debit_note: ['Debit Note', 'Journal', 'debit_note']
};
const TYPE_LIST = Object.entries(TYPES).map(([key, [label, group]]) => ({ key, label, group }));

// party effect sign (Dr + / Cr -) and the party-summary column of each type
const PARTY_COL = { sales_bill: 'credit_sales', sales_return: 'sales_return', sales_nonsaleable_return: 'sales_return', sales_additional: 'credit_sales',
    purchase_bill: 'credit_purchase', purchase_return: 'purchase_return', purchase_additional: 'credit_purchase', receipt: 'receipt', payment: 'payment',
    credit_note: 'notes', debit_note: 'notes', journal: 'notes', pdc_received: 'pdc', pdc_issued: 'pdc' };

async function loadDocs(c, t, f) {
    const statuses = f.includeDraft ? ['posted', 'draft', 'pending', 'approved', 'awaiting_approval'] : ['posted'];
    const base = (table, cols, dateCol = 'doc_date') => fetchAll(() => c.from(table).select(cols).eq('tenant_id', t).in('status', statuses).gte(dateCol, f.from).lte(dateCol, f.to).order('id'));
    const want = k => !f.types.length || f.types.includes(k);
    const safe = p => p.catch(() => []);
    const [sb, sr, snr, sa, pb, pr, pa, cb, pdc, jv, cn, dn] = await Promise.all([
        want('sales_bill') ? safe(base('sales_bills', 'id, doc_no, doc_date, status, customer_ledger_id, customer_name_snapshot, agent_id, invoice_type, total_amount, total_tax_amount, received_amount, created_by')) : [],
        want('sales_return') ? safe(base('sales_returns', 'id, doc_no, doc_date, status, customer_ledger_id, customer_name_snapshot, agent_id, settlement_type, total_amount, created_by')) : [],
        want('sales_nonsaleable_return') ? safe(base('sales_nonsaleable_returns', 'id, doc_no, doc_date, status, customer_ledger_id, customer_name_snapshot, settlement_type, total_amount, created_by')) : [],
        want('sales_additional') ? safe(base('sales_additional_entries', 'id, doc_no, doc_date, status, customer_ledger_id, customer_name_snapshot, agent_id, total_amount, created_by')) : [],
        want('purchase_bill') ? safe(base('purchase_bills', 'id, doc_no, doc_date, status, vendor_ledger_id, vendor_name_snapshot, cash_vendor_name, agent_id, invoice_type, total_amount, created_by')) : [],
        want('purchase_return') ? safe(base('purchase_returns', 'id, doc_no, doc_date, status, vendor_ledger_id, vendor_name_snapshot, cash_vendor_name, agent_id, invoice_type, total_amount, created_by')) : [],
        want('purchase_additional') ? safe(base('purchase_additional_expenses', 'id, doc_no, doc_date, status, vendor_ledger_id, vendor_name_snapshot, cash_vendor_name, agent_id, invoice_type, total_amount, created_by')) : [],
        want('receipt') || want('payment') ? safe(base('cash_bank_entries', 'id, doc_no, doc_date, status, entry_type, cash_bank_ledger_id, party_ledger_id, party_name_snapshot, agent_id, amount, total_receipt, total_payment, line_count, payment_mode, created_by, entry_source')) : [],
        want('pdc_received') || want('pdc_issued') ? safe(fetchAll(() => c.from('pdc_vouchers').select('id, doc_no, doc_date, status, voucher_type, party_ledger_id, party_name_snapshot, amount, cheque_date, created_by').eq('tenant_id', t)
            .in('status', f.includeDraft ? ['pending', 'posted', 'returned'] : ['pending', 'posted']).gte('doc_date', f.from).lte('doc_date', f.to).order('id'))) : [],
        want('journal') ? safe(base('journal_vouchers', 'id, doc_no, doc_date, status, party_ledger_id, party_name_snapshot, total_debit, jv_type, created_by')) : [],
        want('credit_note') ? safe(base('credit_notes', 'id, doc_no, doc_date, status, party_ledger_id, party_name_snapshot, agent_id, total_amount, created_by')) : [],
        want('debit_note') ? safe(base('debit_notes', 'id, doc_no, doc_date, status, party_ledger_id, party_name_snapshot, agent_id, total_amount, created_by')) : []
    ]);
    // lines of multi-line cash / bank entries (party + agent per line)
    const multi = cb.filter(x => Number(x.line_count) > 0).map(x => x.id);
    const cbLines = multi.length ? await safe(inChunks(multi, async ch => (await c.from('cash_bank_entry_lines').select('entry_id, ledger_id, ledger_name_snapshot, agent_id, receipt_amount, payment_amount').in('entry_id', ch)).data || [])) : [];
    return { sb, sr, snr, sa, pb, pr, pa, cb, cbLines, pdc, jv, cn, dn };
}

async function dayBook(c, t, q) {
    const f = { from: q.date_from, to: q.date_to || q.date_from, userIds: csv(q.user_ids), agentIds: csv(q.agent_ids), types: csv(q.voucher_types).filter(k => TYPES[k]),
        partyIds: csv(q.party_ids), includeDraft: q.include_draft === 'true' };
    if (!f.from) throw httpError('Choose the date');
    if (f.to < f.from) throw httpError('To date must be on or after From date');
    const D = await loadDocs(c, t, f);
    const L = Object.fromEntries((await fetchAll(() => c.from('ledger_accounts').select('id, account_name, account_code, category_type, opening_balance, opening_balance_type').eq('tenant_id', t).order('id'))).map(l => [l.id, l]));
    const cashOrBank = id => (L[id]?.category_type === 'bank' ? 'bank' : 'cash');

    // one row per voucher (a multi-line cash / bank entry: one row per party line)
    const rows = [];
    const add = (type, d, x) => rows.push({ type, type_label: TYPES[type][0], group: TYPES[type][1], doc_type: TYPES[type][2], id: d.id, doc_no: d.doc_no, date: String(d.doc_date).slice(0, 10), status: d.status,
        user_id: d.created_by || null, agent_id: d.agent_id || null, cash: 0, bank: 0, credit: 0, pdc: 0, adjustment: 0, ...x, amount: round2(x.amount) });
    D.sb.forEach(d => {
        const total = Number(d.total_amount) || 0, got = Math.min(total, Number(d.received_amount) || 0);
        const cash = d.invoice_type === 'cash' ? total : got;
        add('sales_bill', d, { party_id: d.customer_ledger_id, party: d.customer_name_snapshot, mode: d.invoice_type === 'cash' ? 'Cash' : got ? 'Credit (part received)' : 'Credit', cash: round2(cash), credit: round2(total - cash), amount: total, vat: round2(d.total_tax_amount) });
    });
    D.sr.forEach(d => add('sales_return', d, { party_id: d.customer_ledger_id, party: d.customer_name_snapshot, mode: d.settlement_type === 'cash_refund' ? 'Cash refund' : 'Credit',
        cash: d.settlement_type === 'cash_refund' ? round2(d.total_amount) : 0, credit: d.settlement_type === 'cash_refund' ? 0 : round2(d.total_amount), amount: d.total_amount }));
    D.snr.forEach(d => add('sales_nonsaleable_return', d, { party_id: d.customer_ledger_id, party: d.customer_name_snapshot, mode: d.settlement_type === 'cash_refund' ? 'Cash refund' : 'Credit',
        cash: d.settlement_type === 'cash_refund' ? round2(d.total_amount) : 0, credit: d.settlement_type === 'cash_refund' ? 0 : round2(d.total_amount), amount: d.total_amount }));
    D.sa.forEach(d => add('sales_additional', d, { party_id: d.customer_ledger_id, party: d.customer_name_snapshot, mode: 'Credit', credit: round2(d.total_amount), amount: d.total_amount }));
    [['purchase_bill', D.pb], ['purchase_return', D.pr], ['purchase_additional', D.pa]].forEach(([type, list]) => list.forEach(d => {
        const isCash = d.invoice_type === 'cash';
        add(type, d, { party_id: d.vendor_ledger_id, party: d.vendor_name_snapshot || d.cash_vendor_name, mode: isCash ? 'Cash' : 'Credit', cash: isCash ? round2(d.total_amount) : 0, credit: isCash ? 0 : round2(d.total_amount), amount: d.total_amount });
    }));
    D.cb.forEach(d => {
        const kind = cashOrBank(d.cash_bank_ledger_id), mode = kind === 'bank' ? 'Bank' : 'Cash';
        const lines = D.cbLines.filter(l => l.entry_id === d.id);
        if (lines.length) {
            lines.forEach(l => {
                const rec = Number(l.receipt_amount) || 0, pay = Number(l.payment_amount) || 0;
                const type = rec > 0 ? 'receipt' : 'payment';
                if (f.types.length && !f.types.includes(type)) return;
                add(type, { ...d, agent_id: l.agent_id || d.agent_id }, { party_id: l.ledger_id, party: l.ledger_name_snapshot || L[l.ledger_id]?.account_name, mode, [kind]: round2(rec || pay), amount: rec || pay, cash_bank: L[d.cash_bank_ledger_id]?.account_name });
            });
            return;
        }
        const type = d.entry_type === 'receipt' ? 'receipt' : 'payment';
        if (f.types.length && !f.types.includes(type)) return;
        add(type, d, { party_id: d.party_ledger_id, party: d.party_name_snapshot || L[d.party_ledger_id]?.account_name, mode: `${mode}${d.payment_mode && !['cash'].includes(d.payment_mode) ? ` · ${d.payment_mode}` : ''}${d.entry_source === 'mobile' ? ' · mobile' : ''}`,
            [kind]: round2(d.amount), amount: d.amount, cash_bank: L[d.cash_bank_ledger_id]?.account_name });
    });
    D.pdc.forEach(d => {
        const type = d.voucher_type === 'issued' ? 'pdc_issued' : 'pdc_received';
        if (f.types.length && !f.types.includes(type)) return;
        add(type, d, { party_id: d.party_ledger_id, party: d.party_name_snapshot, mode: `PDC · cheque ${String(d.cheque_date || '').slice(0, 10)} · ${d.status}`, pdc: round2(d.amount), amount: d.amount });
    });
    D.jv.forEach(d => add('journal', d, { party_id: d.party_ledger_id, party: d.party_name_snapshot || '', mode: d.jv_type ? `Adjustment · ${d.jv_type}` : 'Adjustment', adjustment: round2(d.total_debit), amount: d.total_debit }));
    D.cn.forEach(d => add('credit_note', d, { party_id: d.party_ledger_id, party: d.party_name_snapshot, mode: 'Adjustment', adjustment: round2(d.total_amount), amount: d.total_amount }));
    D.dn.forEach(d => add('debit_note', d, { party_id: d.party_ledger_id, party: d.party_name_snapshot, mode: 'Adjustment', adjustment: round2(d.total_amount), amount: d.total_amount }));

    rows.forEach(r => { if (!r.party && r.party_id) r.party = L[r.party_id]?.account_name || ''; });
    // filters: user, agent, party
    let shown = rows;
    if (f.userIds.length) shown = shown.filter(r => f.userIds.includes(r.user_id));
    if (f.agentIds.length) shown = shown.filter(r => f.agentIds.includes(r.agent_id));
    if (f.partyIds.length) shown = shown.filter(r => f.partyIds.includes(r.party_id));

    const [users, agents] = await Promise.all([
        fetchAll(() => c.from('users').select('id, full_name, email').eq('tenant_id', t).order('id')).catch(() => []),
        fetchAll(() => c.from('salesman_agents').select('id, agent_name').eq('tenant_id', t).order('id')).catch(() => [])
    ]);
    const U = Object.fromEntries(users.map(u => [u.id, u.full_name || u.email])), A = Object.fromEntries(agents.map(a => [a.id, a.agent_name]));
    shown.forEach(r => { r.user_name = U[r.user_id] || ''; r.agent_name = A[r.agent_id] || ''; });
    shown.sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group) || String(a.doc_no).localeCompare(String(b.doc_no)));

    // ---- summary per voucher type ----
    const sum = (list, k) => round2(list.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    const summary = Object.keys(TYPES).map(k => {
        const list = shown.filter(r => r.type === k);
        return { type: k, label: TYPES[k][0], group: TYPES[k][1], count: list.length, cash: sum(list, 'cash'), bank: sum(list, 'bank'), credit: sum(list, 'credit'), pdc: sum(list, 'pdc'), adjustment: sum(list, 'adjustment'), total: sum(list, 'amount') };
    }).filter(s => s.count);

    // ---- cash / bank: postings of the shown vouchers on cash / bank ledgers ----
    const narrowed = f.userIds.length || f.agentIds.length || f.types.length || f.partyIds.length;
    const cbIds = Object.values(L).filter(l => ['cash', 'bank'].includes(l.category_type)).map(l => l.id);
    let cashBank = [];
    if (cbIds.length) {
        const gl = await inChunks(cbIds, ch => fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date, document_type, document_id)')
            .eq('tenant_id', t).in('ledger_account_id', ch).lte('batch.batch_date', f.to).order('id')), 100);
        const docKeys = new Set(shown.map(r => `${r.doc_type}:${r.id}`));
        const acc = {};
        gl.forEach(l => {
            const id = l.ledger_account_id, d = String(l.batch.batch_date).slice(0, 10), amt = Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
            const a = (acc[id] = acc[id] || { ledger_id: id, ledger: L[id]?.account_name || '?', kind: L[id]?.category_type, opening: (L[id]?.opening_balance_type === 'cr' ? -1 : 1) * (Number(L[id]?.opening_balance) || 0), receipts: 0, payments: 0 });
            if (d < f.from) { a.opening += amt; return; }
            if (narrowed && !docKeys.has(`${l.batch.document_type}:${l.batch.document_id}`)) return;
            a.receipts += Number(l.debit_amount || 0); a.payments += Number(l.credit_amount || 0);
        });
        cashBank = Object.values(acc).map(a => ({ ...a, opening: narrowed ? null : round2(a.opening), receipts: round2(a.receipts), payments: round2(a.payments), net: round2(a.receipts - a.payments),
            closing: narrowed ? null : round2(a.opening + a.receipts - a.payments) })).filter(a => a.receipts || a.payments || (a.opening && !narrowed))
            .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || a.ledger.localeCompare(b.ledger));
    }
    const cbTotal = kind => { const list = cashBank.filter(x => (kind === 'bank' ? x.kind === 'bank' : x.kind !== 'bank')); return { receipts: sum(list, 'receipts'), payments: sum(list, 'payments'), net: sum(list, 'net'), opening: narrowed ? null : sum(list, 'opening'), closing: narrowed ? null : sum(list, 'closing') }; };

    // ---- party-wise credit summary ----
    const P = {};
    shown.forEach(r => {
        if (!r.party_id) return;
        const p = (P[r.party_id] = P[r.party_id] || { party_id: r.party_id, party: r.party || L[r.party_id]?.account_name || '', credit_sales: 0, sales_return: 0, receipt: 0, credit_purchase: 0, purchase_return: 0, payment: 0, notes: 0, pdc: 0, cash_sales: 0, cash_purchase: 0 });
        const col = PARTY_COL[r.type];
        if (r.type === 'sales_bill') { p.credit_sales += r.credit; p.cash_sales += r.cash; }
        else if (r.type === 'purchase_bill' || r.type === 'purchase_additional') { p.credit_purchase += r.credit; p.cash_purchase += r.cash; }
        else if (col === 'sales_return' || col === 'purchase_return') p[col] += r.credit;
        else p[col] += r.amount;
    });
    const partyIds = Object.keys(P);
    const bal = {};
    if (partyIds.length) {
        const gl = await inChunks(partyIds, ch => fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)')
            .eq('tenant_id', t).in('ledger_account_id', ch).lte('batch.batch_date', f.to).order('id')), 100);
        gl.forEach(l => { bal[l.ledger_account_id] = (bal[l.ledger_account_id] || 0) + Number(l.debit_amount || 0) - Number(l.credit_amount || 0); });
    }
    const parties = Object.values(P).map(p => {
        const opening = (L[p.party_id]?.opening_balance_type === 'cr' ? -1 : 1) * (Number(L[p.party_id]?.opening_balance) || 0);
        const out = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]));
        // credit effect on the party: + what they owe more, - what they owe less (notes / JV not signed here)
        out.net_credit = round2(p.credit_sales - p.sales_return - p.receipt - p.credit_purchase + p.purchase_return + p.payment);
        out.closing_balance = round2(opening + (bal[p.party_id] || 0));
        return out;
    }).sort((a, b) => a.party.localeCompare(b.party));

    // ---- per agent / user ----
    const groupBy = (key, nameKey) => {
        const g = {};
        shown.forEach(r => {
            const k = r[key] || '';
            const x = (g[k] = g[k] || { id: k || null, name: r[nameKey] || '(none)', vouchers: 0, sales: 0, sales_cash: 0, sales_credit: 0, returns: 0, receipts: 0, purchases: 0, payments: 0, pdc: 0 });
            x.vouchers++;
            if (r.type === 'sales_bill') { x.sales += r.amount; x.sales_cash += r.cash; x.sales_credit += r.credit; }
            if (r.type === 'sales_return' || r.type === 'sales_nonsaleable_return') x.returns += r.amount;
            if (r.type === 'receipt') x.receipts += r.amount;
            if (r.type === 'purchase_bill') x.purchases += r.amount;
            if (r.type === 'payment') x.payments += r.amount;
            if (r.group === 'PDC') x.pdc += r.amount;
        });
        return Object.values(g).map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' && k !== 'vouchers' ? round2(v) : v]))).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    };

    const totals = { vouchers: shown.length, cash: sum(shown, 'cash'), bank: sum(shown, 'bank'), credit: sum(shown, 'credit'), pdc: sum(shown, 'pdc'), adjustment: sum(shown, 'adjustment'), amount: sum(shown, 'amount') };
    const pick = k => summary.find(s => s.type === k) || { cash: 0, bank: 0, credit: 0, total: 0, count: 0 };
    const headline = {
        sales: pick('sales_bill').total, sales_cash: pick('sales_bill').cash, sales_credit: pick('sales_bill').credit,
        sales_return: round2(pick('sales_return').total + pick('sales_nonsaleable_return').total),
        purchase: pick('purchase_bill').total, purchase_cash: pick('purchase_bill').cash, purchase_credit: pick('purchase_bill').credit, purchase_return: pick('purchase_return').total,
        receipts: round2(pick('receipt').cash + pick('receipt').bank), receipts_cash: pick('receipt').cash, receipts_bank: pick('receipt').bank,
        payments: round2(pick('payment').cash + pick('payment').bank), payments_cash: pick('payment').cash, payments_bank: pick('payment').bank,
        pdc_received: pick('pdc_received').total, pdc_issued: pick('pdc_issued').total
    };
    return {
        from: f.from, to: f.to, filtered: !!narrowed, include_draft: f.includeDraft,
        filter_names: { users: f.userIds.map(id => U[id] || id), agents: f.agentIds.map(id => A[id] || id), types: f.types.map(k => TYPES[k][0]) },
        headline, summary, cash_bank: cashBank, cash_total: cbTotal('cash'), bank_total: cbTotal('bank'), parties,
        by_agent: groupBy('agent_id', 'agent_name'), by_user: groupBy('user_id', 'user_name'), rows: shown, totals
    };
}

module.exports = { dayBook, TYPE_LIST };
