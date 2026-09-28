// =============================================
// utils/taxReconciliation.js
// Tally the tax / trading registers against the books (GL), document by
// document, so every rupee of difference is explained:
//
//   vat       VAT register (sales, returns, notes, expense bills, taxable
//             JV sales / purchases)            <->  every VAT ledger
//   sales     Sales register (bills, returns, non-saleable returns,
//             JV sales) - value without VAT    <->  sales accounts
//   purchase  Purchase register (bills, returns, non-saleable returns,
//             expense bills, JV purchases) - value without claimed VAT
//                                              <->  purchase / goods accounts
//   tds       TDS on bills, JVs (TDS type and taxable JVs), expense
//             bills and JV lines with TDS %    <->  TDS ledgers
//
// One signed figure per section so that register and books add up the
// same way:  vat / sales / tds = Cr - Dr,  purchase = Dr - Cr.
// (Input VAT and TDS receivable therefore show as minus.)
//
// Each row is one document (a Bill that came from a GRN is kept with that
// GRN, since the goods were booked at GRN time):
//   matched        register = books
//   difference     both have it, amounts differ
//   register_only  in the register, nothing in these accounts
//   books_only     posted to these accounts but not in the register
//                  (a normal JV to the VAT ledger, a GRN not billed yet ...)
// Sum of the books column = the whole movement of those accounts for the
// dates, so the summary ties to the ledger report.
// The accounts compared are found automatically (System Control, products,
// documents, taxable JVs, VAT terms); ?ledger_ids= overrides them.
// =============================================

const { allVatLedgerIds } = require('./vatLedger');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// register doc type -> the GL batch document_type it posts under
const BATCH_TYPE = {
    sales: 'sales_bill', sales_return: 'sales_return', credit_note: 'credit_note', jv_sales: 'journal_voucher',
    purchase: 'purchase_bill', purchase_return: 'purchase_return', debit_note: 'debit_note', jv_purchase: 'journal_voucher',
    purchase_expense: 'purchase_additional_expense',
    sales_nonsalable_return: 'sales_nonsalable_return', purchase_nonsalable_return: 'purchase_nonsalable_return'
};
// GL document_type -> label + table (to show the number of a books-only document)
const BOOK_DOCS = {
    sales_bill: ['Sales Bill', 'sales_bills'], sales_return: ['Sales Return', 'sales_returns'], credit_note: ['Credit Note', 'credit_notes'],
    purchase_bill: ['Purchase Bill', 'purchase_bills'], purchase_return: ['Purchase Return', 'purchase_returns'], debit_note: ['Debit Note', 'debit_notes'],
    purchase_grn: ['GRN', 'purchase_grns'], purchase_additional_expense: ['Additional Expense', 'purchase_additional_expenses'],
    journal_voucher: ['Journal Voucher', 'journal_vouchers'], cash_bank_entry: ['Cash / Bank Entry', 'cash_bank_entries'],
    sales_nonsalable_return: ['Sales Non-saleable Return', 'sales_nonsaleable_returns'], purchase_nonsalable_return: ['Purchase Non-saleable Return', 'purchase_nonsaleable_returns'],
    sales_additional: ['Sales Additional', 'sales_additional_entries'], pdc: ['PDC', 'pdc_vouchers'], stock_adjustment: ['Stock Adjustment', 'stock_adjustments'],
    production: ['Production', 'production_orders'], interest_posting: ['Interest Posting', null], agent_commission: ['Agent Commission', null],
    sales_bill_settle: ['Sales Bill (settlement)', 'sales_bills'], purchase_bill_settle: ['Purchase Bill (settlement)', 'purchase_bills']
};

const SECTIONS = {
    vat: { label: 'VAT', convention: 'Cr - Dr (output VAT +, input VAT -)', types: ['sales', 'sales_return', 'credit_note', 'jv_sales', 'purchase', 'purchase_return', 'debit_note', 'purchase_expense', 'jv_purchase'] },
    sales: { label: 'Sales Account', convention: 'Cr - Dr (sales +, returns -)', types: ['sales', 'sales_return', 'jv_sales', 'sales_nonsalable_return'] },
    purchase: { label: 'Purchase Account', convention: 'Dr - Cr (purchases +, returns -)', types: ['purchase', 'purchase_return', 'purchase_expense', 'jv_purchase', 'purchase_nonsalable_return'] },
    tds: { label: 'TDS', convention: 'Cr - Dr (TDS payable +, TDS receivable -)', types: [] }
};

async function inChunks(ids, size, fn) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...((await fn(ids.slice(i, i + size))) || []));
    return out;
}
const safe = async (p, fallback = []) => { try { const r = await p; return r.error ? fallback : (r.data || fallback); } catch { return fallback; } };
const dated = (q, from, to, col = 'doc_date') => { if (from) q = q.gte(col, from); if (to) q = q.lte(col, to); return q; };

// ---------- the accounts of each section ----------
async function sectionLedgers(c, t, section, { from, to }) {
    const sys = (await safe(c.from('system_control_settings').select('*').eq('tenant_id', t).limit(1)))[0] || {};
    const ids = new Set();
    const add = (...xs) => xs.forEach(x => { if (x) ids.add(x); });
    const distinct = async (table, col, extra = q => q) => (await safe(extra(dated(c.from(table).select(col).eq('tenant_id', t), from, to)).limit(20000))).forEach(r => add(r[col]));
    const jvOther = async type => {
        const jvs = await safe(dated(c.from('journal_vouchers').select('id, party_ledger_id, tds_ledger_id').eq('tenant_id', t).eq('status', 'posted').eq('tax_entry_type', type), from, to).limit(20000));
        if (!jvs.length) return;
        const skip = new Set([...jvs.flatMap(j => [j.party_ledger_id, j.tds_ledger_id]), ...(await allVatLedgerIds(c, t)), sys.tds_ledger_id, sys.sales_tds_ledger_id].filter(Boolean));
        (await inChunks(jvs.map(j => j.id), 200, async ch => safe(c.from('journal_voucher_details').select('ledger_id').in('jv_id', ch))))
            .forEach(d => { if (!skip.has(d.ledger_id)) add(d.ledger_id); });
    };
    if (section === 'vat') (await allVatLedgerIds(c, t)).forEach(x => add(x));
    if (section === 'sales') {
        add(sys.sales_account_ledger_id, sys.sales_return_account_ledger_id);
        (await safe(c.from('products').select('sales_account_ledger_id, sales_return_account_ledger_id, sales_nonsaleable_return_account_ledger_id').eq('tenant_id', t).limit(50000)))
            .forEach(p => add(p.sales_account_ledger_id, p.sales_return_account_ledger_id, p.sales_nonsaleable_return_account_ledger_id));
        for (const tb of ['sales_bills', 'sales_returns', 'sales_nonsaleable_returns']) await distinct(tb, 'sales_account_ledger_id');
        await jvOther('sales');
    }
    if (section === 'purchase') {
        add(sys.purchase_account_ledger_id, sys.purchase_return_account_ledger_id);
        (await safe(c.from('products').select('purchase_account_ledger_id, purchase_return_account_ledger_id, purchase_nonsaleable_return_account_ledger_id').eq('tenant_id', t).limit(50000)))
            .forEach(p => add(p.purchase_account_ledger_id, p.purchase_return_account_ledger_id, p.purchase_nonsaleable_return_account_ledger_id));
        for (const tb of ['purchase_bills', 'purchase_grns', 'purchase_returns', 'purchase_nonsaleable_returns']) await distinct(tb, 'goods_account_ledger_id');
        const exps = await safe(dated(c.from('purchase_additional_expenses').select('id').eq('tenant_id', t).eq('status', 'posted'), from, to).limit(20000));
        (await inChunks(exps.map(e => e.id), 200, async ch => safe(c.from('purchase_additional_expense_lines').select('expense_ledger_id, entry_sign, bill_type').in('expense_id', ch))))
            .filter(l => l.entry_sign !== 'deduct' && ['taxable', 'non_taxable'].includes(l.bill_type)).forEach(l => add(l.expense_ledger_id));
        await jvOther('purchase');
    }
    if (section === 'tds') {
        add(sys.tds_ledger_id, sys.sales_tds_ledger_id);
        for (const tb of ['purchase_bills', 'sales_bills', 'journal_vouchers']) await distinct(tb, 'tds_ledger_id', q => q.gt('tds_amount', 0));
        const exps = await safe(dated(c.from('purchase_additional_expenses').select('id').eq('tenant_id', t).eq('status', 'posted'), from, to).limit(20000));
        (await inChunks(exps.map(e => e.id), 200, async ch => safe(c.from('purchase_additional_expense_lines').select('expense_ledger_id, entry_sign, is_tds, rate_percent').in('expense_id', ch))))
            .filter(l => l.entry_sign === 'deduct' && (l.is_tds || Number(l.rate_percent) > 0)).forEach(l => add(l.expense_ledger_id));
    }
    return [...ids];
}

// ---------- the register side: [{ key, type, label, doc_no, doc_date, party_name, amount, side }] ----------
async function nonSaleable(c, t, type, { from, to }) {
    const table = type === 'sales_nonsalable_return' ? 'sales_nonsaleable_returns' : 'purchase_nonsaleable_returns';
    const party = type === 'sales_nonsalable_return' ? 'customer' : 'vendor';
    return (await safe(dated(c.from(table).select('*').eq('tenant_id', t).eq('status', 'posted'), from, to).limit(20000))).map(h => ({
        type, id: h.id, label: type === 'sales_nonsalable_return' ? 'Sales Non-saleable Return' : 'Purchase Non-saleable Return', doc_no: h.doc_no, doc_date: h.doc_date,
        party_name: h[`${party}_name_snapshot`] || '', amount: -round2(h.total_amount), side: party === 'customer' ? 'sales' : 'purchase'
    }));
}

async function registerRows(c, t, section, { from, to, loadTaxDocs }) {
    const out = [];
    if (section === 'tds') {
        for (const [table, party, label, sign] of [['purchase_bills', 'vendor', 'Purchase Bill', 1], ['sales_bills', 'customer', 'Sales Bill', -1]]) {
            (await safe(dated(c.from(table).select(`id, doc_no, doc_date, ${party}_name_snapshot, tds_amount`).eq('tenant_id', t).eq('status', 'posted').gt('tds_amount', 0), from, to).limit(20000)))
                .forEach(b => out.push({ type: table === 'purchase_bills' ? 'purchase' : 'sales', id: b.id, label: `${label} TDS`, doc_no: b.doc_no, doc_date: b.doc_date, party_name: b[`${party}_name_snapshot`] || '', amount: round2(sign * b.tds_amount), side: sign > 0 ? 'purchase' : 'sales' }));
        }
        const jvs = await safe(dated(c.from('journal_vouchers').select('id, doc_no, doc_date, party_name_snapshot, tds_amount, tds_side, tax_entry_type, jv_type').eq('tenant_id', t).eq('status', 'posted'), from, to).limit(20000));
        jvs.filter(j => Number(j.tds_amount) > 0).forEach(j => {
            const sales = (j.tds_side || j.tax_entry_type) === 'sales';
            out.push({ type: 'jv', id: j.id, label: 'Journal Voucher TDS', doc_no: j.doc_no, doc_date: j.doc_date, party_name: j.party_name_snapshot || '', amount: round2((sales ? -1 : 1) * j.tds_amount), side: sales ? 'sales' : 'purchase' });
        });
        // JV lines carrying a TDS % (the older way) - withheld by us
        const lines = await inChunks(jvs.map(j => j.id), 200, async ch => safe(c.from('journal_voucher_details').select('jv_id, ledger_name_snapshot, debit_amount, credit_amount, tds_percent').in('jv_id', ch).gt('tds_percent', 0)));
        const jvById = Object.fromEntries(jvs.map(j => [j.id, j]));
        lines.forEach(l => {
            const j = jvById[l.jv_id], base = Number(l.debit_amount || 0) || Number(l.credit_amount || 0);
            out.push({ type: 'jv', id: l.jv_id, label: 'Journal Voucher TDS', doc_no: j.doc_no, doc_date: j.doc_date, party_name: l.ledger_name_snapshot || '', amount: round2(base * Number(l.tds_percent) / 100), side: 'purchase' });
        });
        const exps = await safe(dated(c.from('purchase_additional_expenses').select('id, doc_no, doc_date, vendor_name_snapshot').eq('tenant_id', t).eq('status', 'posted'), from, to).limit(20000));
        const expById = Object.fromEntries(exps.map(e => [e.id, e]));
        (await inChunks(exps.map(e => e.id), 200, async ch => safe(c.from('purchase_additional_expense_lines').select('expense_id, entry_sign, is_tds, rate_percent, amount, party_name_snapshot').in('expense_id', ch))))
            .filter(l => l.entry_sign === 'deduct' && (l.is_tds || Number(l.rate_percent) > 0))
            .forEach(l => { const h = expById[l.expense_id]; out.push({ type: 'purchase_expense', id: h.id, label: 'Additional Expense TDS', doc_no: h.doc_no, doc_date: h.doc_date, party_name: l.party_name_snapshot || h.vendor_name_snapshot || '', amount: round2(l.amount), side: 'purchase' }); });
        return out;
    }
    for (const type of SECTIONS[section].types) {
        if (type.endsWith('nonsalable_return')) { out.push(...await nonSaleable(c, t, type, { from, to })); continue; }
        const docs = await loadTaxDocs(c, t, type, { dateFrom: from, dateTo: to });
        docs.forEach(d => {
            const notClaimed = Number(d.vat_by_ledger?.not_claimed || 0);
            let amount;
            if (section === 'vat') amount = (d.side === 'sales' ? 1 : -1) * d.sign * (d.vat - notClaimed);
            else if (section === 'sales') amount = d.sign * (d.taxable + d.exempt);
            else amount = d.sign * (d.taxable + d.exempt + notClaimed);
            out.push({ type, id: d.document_id || d.id, label: d.doc_label, doc_no: d.doc_no, doc_date: d.doc_date, party_name: d.party_name, amount: round2(amount), side: d.side });
        });
    }
    return out;
}

// ---------- the books side ----------
async function bookLines(c, t, ledgerIds, { from, to }) {
    const out = [];
    for (let i = 0; i < ledgerIds.length; i += 100) {
        const chunk = ledgerIds.slice(i, i + 100);
        for (let at = 0; ; at += 1000) {
            let q = c.from('ledger_transaction_lines')
                .select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(id, batch_date, document_type, document_id, narration)')
                .eq('tenant_id', t).in('ledger_account_id', chunk);
            if (from) q = q.gte('batch.batch_date', from);
            if (to) q = q.lte('batch.batch_date', to);
            const { data, error } = await q.range(at, at + 999);
            if (error) throw error;
            out.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
    }
    return out;
}

async function reconcile(c, t, section, { from, to, ledgerIds, loadTaxDocs }) {
    if (!SECTIONS[section]) throw Object.assign(new Error(`Unknown section "${section}"`), { status: 400 });
    const ledgers = ledgerIds && ledgerIds.length ? ledgerIds : await sectionLedgers(c, t, section, { from, to });
    const reg = await registerRows(c, t, section, { from, to, loadTaxDocs });
    const book = ledgers.length ? await bookLines(c, t, ledgers, { from, to }) : [];

    // a Bill that came from a GRN is reconciled together with that GRN
    const billIds = [...new Set(reg.filter(r => r.type === 'purchase').map(r => r.id))];
    const bills = await inChunks(billIds, 200, async ch => safe(c.from('purchase_bills').select('id, source_grn_id').in('id', ch)));
    const grnOfBill = Object.fromEntries(bills.filter(b => b.source_grn_id).map(b => [b.id, b.source_grn_id]));
    const bookBillIds = [...new Set(book.filter(l => l.batch.document_type === 'purchase_bill').map(l => l.batch.document_id).filter(id => !(id in grnOfBill)))];
    (await inChunks(bookBillIds, 200, async ch => safe(c.from('purchase_bills').select('id, source_grn_id').in('id', ch)))).forEach(b => { if (b.source_grn_id) grnOfBill[b.id] = b.source_grn_id; });

    const keyOf = (docType, id) => (docType === 'purchase_bill' && grnOfBill[id] ? `purchase_grn:${grnOfBill[id]}` : `${docType}:${id}`);
    const rows = new Map();
    const rowFor = key => {
        if (!rows.has(key)) rows.set(key, { key, label: '', doc_no: '', doc_date: null, party_name: '', register: 0, books: 0, books_debit: 0, books_credit: 0, docs: [], ledgers: {}, in_register: false, in_books: false, types: new Set() });
        return rows.get(key);
    };
    reg.forEach(r => {
        const batchType = r.type === 'jv' ? 'journal_voucher' : (BATCH_TYPE[r.type] || r.type);
        const row = rowFor(keyOf(batchType, r.id));
        row.in_register = true;
        row.register = round2(row.register + r.amount);
        if (!row.docs.includes(r.doc_no)) row.docs.push(r.doc_no);
        row.label = row.label || r.label; row.doc_date = row.doc_date || r.doc_date; row.party_name = row.party_name || r.party_name;
        row.types.add(r.label);
    });
    const names = Object.fromEntries((await inChunks(ledgers, 200, async ch => safe(c.from('ledger_accounts').select('id, account_code, account_name').in('id', ch)))).map(l => [l.id, l]));
    const debitNature = section === 'purchase';
    book.forEach(l => {
        const b = l.batch;
        const row = rowFor(keyOf(b.document_type, b.document_id));
        const dr = Number(l.debit_amount || 0), cr = Number(l.credit_amount || 0);
        row.in_books = true;
        row.books_debit = round2(row.books_debit + dr); row.books_credit = round2(row.books_credit + cr);
        row.books = round2(row.books + (debitNature ? dr - cr : cr - dr));
        const n = names[l.ledger_account_id]?.account_name || l.ledger_account_id;
        row.ledgers[n] = round2((row.ledgers[n] || 0) + (debitNature ? dr - cr : cr - dr));
        if (!row.in_register) {
            row.book_type = row.book_type || (row.key.startsWith('purchase_grn:') ? 'purchase_grn' : b.document_type);
            row.book_id = row.book_id || (row.key.startsWith('purchase_grn:') ? row.key.slice(13) : b.document_id);
            row.doc_date = row.doc_date || b.batch_date; row.narration = row.narration || b.narration;
        }
    });

    // number / label of books-only documents
    const need = {};
    [...rows.values()].filter(r => !r.in_register).forEach(r => { (need[r.book_type] = need[r.book_type] || []).push(r); });
    for (const [type, list] of Object.entries(need)) {
        const [label, table] = BOOK_DOCS[type] || [type.replace(/_/g, ' '), null];
        const nos = table ? Object.fromEntries((await inChunks([...new Set(list.map(r => r.book_id))], 200, async ch => safe(c.from(table).select('id, doc_no').in('id', ch)))).map(d => [d.id, d.doc_no])) : {};
        list.forEach(r => { r.label = label; r.doc_no = nos[r.book_id] || ''; r.docs = r.doc_no ? [r.doc_no] : []; });
    }
    // a GRN row that also holds its bills
    rows.forEach(r => { if (r.key.startsWith('purchase_grn:') && r.in_register) r.label = 'Purchase Bill (with GRN)'; });

    const out = [...rows.values()].map(r => {
        const diff = round2(r.books - r.register);
        const status = !r.in_books ? 'register_only' : !r.in_register ? 'books_only' : Math.abs(diff) < 0.01 ? 'matched' : 'difference';
        return {
            key: r.key, label: r.label, doc_no: r.docs.join(', '), doc_date: r.doc_date, party_name: r.party_name, narration: r.narration || '',
            register: r.register, books: r.books, books_debit: r.books_debit, books_credit: r.books_credit, difference: diff, status,
            accounts: Object.entries(r.ledgers).map(([n, a]) => `${n} ${a.toFixed(2)}`).join('; ')
        };
    }).filter(r => r.status !== 'matched' || Math.abs(r.register) >= 0.01 || Math.abs(r.books) >= 0.01)
        .sort((a, b) => String(a.doc_date || '').localeCompare(String(b.doc_date || '')) || String(a.doc_no).localeCompare(String(b.doc_no)));

    const sum = (list, k) => round2(list.reduce((s, r) => s + r[k], 0));
    const byStatus = s => out.filter(r => r.status === s);
    const byType = {};
    out.forEach(r => { const x = byType[r.label] = byType[r.label] || { label: r.label, count: 0, register: 0, books: 0 }; x.count++; x.register = round2(x.register + r.register); x.books = round2(x.books + r.books); });
    const summary = {
        register: sum(out, 'register'), books: sum(out, 'books'), difference: round2(sum(out, 'books') - sum(out, 'register')),
        books_debit: sum(out, 'books_debit'), books_credit: sum(out, 'books_credit'),
        count: { all: out.length, matched: byStatus('matched').length, difference: byStatus('difference').length, register_only: byStatus('register_only').length, books_only: byStatus('books_only').length },
        amount: {
            difference: round2(sum(byStatus('difference'), 'books') - sum(byStatus('difference'), 'register')),
            register_only: sum(byStatus('register_only'), 'register'), books_only: sum(byStatus('books_only'), 'books')
        },
        by_type: Object.values(byType).map(x => ({ ...x, difference: round2(x.books - x.register) })).sort((a, b) => a.label.localeCompare(b.label))
    };
    summary.tallied = Math.abs(summary.difference) < 0.01 && summary.count.difference === 0 && summary.count.register_only === 0 && summary.count.books_only === 0;
    return {
        section, label: SECTIONS[section].label, convention: SECTIONS[section].convention, period: { from: from || null, to: to || null },
        ledgers: ledgers.map(id => ({ id, code: names[id]?.account_code || '', name: names[id]?.account_name || id })),
        summary, rows: out
    };
}

module.exports = { reconcile, sectionLedgers, SECTIONS };
