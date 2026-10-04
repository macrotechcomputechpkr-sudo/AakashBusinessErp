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
//   stock     Purchase vs Stock: what each purchase is worth in the
//             purchase register (bill / GRN goods value without VAT,
//             returns, the costing part of additional bills) <-> the value
//             it put into stock (stock receipts at their cost, landed cost
//             of additional bills that reached a receipt). No GL here.
// Credit Notes (sales) and Debit Notes (purchase) that post to a sales /
// purchase account are part of those registers too.
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
const { nonStockIds } = require('./stockItems');
const { lineGoods } = require('./purchaseStockCost');

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
    tds: { label: 'TDS', convention: 'Cr - Dr (TDS payable +, TDS receivable -)', types: [] },
    stock: { label: 'Purchase vs Stock', convention: 'Purchase value vs the value put into stock (returns -)', types: [] }
};
// a friendlier name for the register rows
const LABEL = { purchase_expense: 'Purchase Additional' };

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

async function registerRows(c, t, section, { from, to, loadTaxDocs, ledgers }) {
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
    // Credit Note (sales) / Debit Note (purchase) lines posted to this section's accounts
    if ((section === 'sales' || section === 'purchase') && ledgers && ledgers.length) {
        const [table, detail, fk, label, type] = section === 'sales'
            ? ['credit_notes', 'credit_note_details', 'credit_note_id', 'Credit Note', 'credit_note']
            : ['debit_notes', 'debit_note_details', 'debit_note_id', 'Debit Note', 'debit_note'];
        const heads = await safe(dated(c.from(table).select('id, doc_no, doc_date, party_name_snapshot').eq('tenant_id', t).eq('status', 'posted'), from, to).limit(20000));
        const set = new Set(ledgers);
        const lines = await inChunks(heads.map(h => h.id), 200, async ch => safe(c.from(detail).select(`${fk}, ledger_id, amount`).in(fk, ch)));
        heads.forEach(h => {
            const amt = round2(lines.filter(l => l[fk] === h.id && set.has(l.ledger_id)).reduce((a, l) => a + Number(l.amount || 0), 0));
            if (amt) out.push({ type, id: h.id, label, doc_no: h.doc_no, doc_date: h.doc_date, party_name: h.party_name_snapshot || '', amount: -amt, side: section });
        });
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
            out.push({ type, id: d.document_id || d.id, label: LABEL[type] || d.doc_label, doc_no: d.doc_no, doc_date: d.doc_date, party_name: d.party_name, amount: round2(amount), side: d.side });
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
    if (section === 'stock') return reconcileStock(c, t, { from, to, loadTaxDocs });
    const ledgers = ledgerIds && ledgerIds.length ? ledgerIds : await sectionLedgers(c, t, section, { from, to });
    const reg = await registerRows(c, t, section, { from, to, loadTaxDocs, ledgers });
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

    return finish(section, rows, ledgers.map(id => ({ id, code: names[id]?.account_code || '', name: names[id]?.account_name || id })), from, to);
}

// rows (Map of { key, label, docs, register, books, ... }) -> the report
function finish(section, rows, ledgerList, from, to) {
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
    return { section, label: SECTIONS[section].label, convention: SECTIONS[section].convention, period: { from: from || null, to: to || null }, ledgers: ledgerList, summary, rows: out };
}


// ---------- Purchase vs Stock ----------
// Register: purchase bills (with their GRN), purchase returns - the share of
// their stock items (services, non-inventory and fixed assets never go to
// stock) - and the costing part of additional bills. Books: the value those documents put into stock -
// receipts at their cost without landed cost (base_unit_cost), returns at
// their cost, and the landed cost of each additional bill that reached a
// stock receipt.
async function reconcileStock(c, t, { from, to, loadTaxDocs }) {
    const rows = new Map();
    const rowFor = key => {
        if (!rows.has(key)) rows.set(key, { key, label: '', doc_no: '', doc_date: null, party_name: '', register: 0, books: 0, books_debit: 0, books_credit: 0, docs: [], ledgers: {}, in_register: false, in_books: false });
        return rows.get(key);
    };
    const addReg = (key, r) => {
        const row = rowFor(key);
        row.in_register = true; row.register = round2(row.register + r.amount);
        if (r.doc_no && !row.docs.includes(r.doc_no)) row.docs.push(r.doc_no);
        row.label = row.label || r.label; row.doc_date = row.doc_date || r.doc_date; row.party_name = row.party_name || r.party_name;
    };
    const addBook = (key, amt, what, date) => {
        const row = rowFor(key);
        row.in_books = true; row.books = round2(row.books + amt);
        if (amt > 0) row.books_debit = round2(row.books_debit + amt); else row.books_credit = round2(row.books_credit - amt);
        row.ledgers[what] = round2((row.ledgers[what] || 0) + amt);
        row.doc_date = row.doc_date || date;
    };

    // register
    const bills = await loadTaxDocs(c, t, 'purchase', { dateFrom: from, dateTo: to });
    const billHeads = await inChunks(bills.map(b => b.id), 200, async ch => safe(c.from('purchase_bills').select('id, source_grn_id').in('id', ch)));
    const grnOfBill = Object.fromEntries(billHeads.filter(b => b.source_grn_id).map(b => [b.id, b.source_grn_id]));
    const keyOf = (type, id) => (type === 'purchase_bill' && grnOfBill[id] ? `purchase_grn:${grnOfBill[id]}` : `${type}:${id}`);
    // only the stock items' share of a document goes to stock (no service / non-inventory / fixed asset lines).
    // Lines are valued the way the stock receipt was (utils/purchaseStockCost.lineGoods): product-wise
    // terms on their line, over-all terms shared by their own basis (qty / value); a term not
    // "included in costing" is in the purchase but not in stock - shown as excluded.
    const terms = await safe(c.from('billing_terms').select('id, tax_type, use_as, basis, include_in_costing').eq('tenant_id', t));
    const T = Object.fromEntries(terms.map(x => [x.id, x]));
    const info = id => ({ vat: T[id]?.tax_type === 'vat' || T[id]?.use_as === 'vat', costing: T[id]?.include_in_costing !== false, basis: T[id]?.basis || 'value' });
    const stockShare = async (detail, fk, docType, docs) => {
        const ids = docs.map(d => d.id);
        const lines = await inChunks(ids, 200, async ch => safe(c.from(detail).select(`id, ${fk}, product_id, amount, tax_amount, rate, qty`).in(fk, ch)));
        const docTerms = await inChunks(ids, 200, async ch => safe(c.from('document_billing_terms').select('document_id, billing_term_id, computed_amount').eq('document_type', docType).in('document_id', ch)));
        const lineTerms = await inChunks(ids, 200, async ch => safe(c.from('document_line_billing_terms').select('document_id, detail_id, billing_term_id, computed_amount').eq('document_type', docType).in('document_id', ch)));
        const skip = await nonStockIds(c, lines.map(l => l.product_id));
        const out = {};
        docs.forEach(doc => {
            const mine = lines.filter(l => l[fk] === doc.id);
            if (!mine.length) { out[doc.id] = { share: 1, excluded: 0 }; return; }
            const tm = { doc: docTerms.filter(x => x.document_id === doc.id).map(x => ({ amount: Number(x.computed_amount) || 0, ...info(x.billing_term_id) })), line: {} };
            lineTerms.filter(x => x.document_id === doc.id).forEach(x => { (tm.line[x.detail_id] = tm.line[x.detail_id] || []).push({ amount: Number(x.computed_amount) || 0, ...info(x.billing_term_id) }); });
            const head = { total_amount: Number(doc.taxable || 0) + Number(doc.exempt || 0) + mine.reduce((a, l) => a + Number(l.tax_amount || 0), 0) };
            const g = lineGoods(head, mine, () => 0, 0, tm);
            const sum = (list, k) => list.reduce((a, l) => a + (g[l.id][k] || 0), 0);
            const stockLines = mine.filter(l => !skip.has(l.product_id));
            const allIn = sum(mine, 'goods') + sum(mine, 'excluded');
            out[doc.id] = { share: allIn > 0 ? (sum(stockLines, 'goods') + sum(stockLines, 'excluded')) / allIn : 1, excluded: sum(stockLines, 'excluded') };
        });
        return out;
    };
    const regValue = (d, s) => round2((d.taxable + d.exempt) * s.share - s.excluded);
    const billShare = await stockShare('purchase_bill_details', 'bill_id', 'purchase_bill', bills);
    bills.forEach(d => { const v = regValue(d, billShare[d.id]); if (Math.abs(v) >= 0.01) addReg(keyOf('purchase_bill', d.id), { amount: v, doc_no: d.doc_no, doc_date: d.doc_date, party_name: d.party_name, label: 'Purchase Bill' }); });
    const rets = await loadTaxDocs(c, t, 'purchase_return', { dateFrom: from, dateTo: to });
    const retShare = await stockShare('purchase_return_details', 'return_id', 'purchase_return', rets);
    rets.forEach(d => { const v = regValue(d, retShare[d.id]); if (Math.abs(v) >= 0.01) addReg(`purchase_return:${d.id}`, { amount: -v, doc_no: d.doc_no, doc_date: d.doc_date, party_name: d.party_name, label: 'Purchase Return' }); });
    const exps = await safe(dated(c.from('purchase_additional_expenses').select('id, doc_no, doc_date, vendor_name_snapshot').eq('tenant_id', t).eq('status', 'posted'), from, to).limit(20000));
    const expLines = await inChunks(exps.map(e => e.id), 200, async ch => safe(c.from('purchase_additional_expense_lines').select('*').in('expense_id', ch)));
    exps.forEach(e => {
        // what goes to the cost of the goods: add lines less deduct lines (not TDS, not 'none'), plus VAT that cannot be claimed
        const amt = expLines.filter(l => l.expense_id === e.id && !l.is_tds && l.allocation_basis !== 'none')
            .reduce((a, l) => a + (l.entry_sign === 'deduct' ? -1 : 1) * (Number(l.amount || 0) + (l.vat_in_cost ? Number(l.vat_amount || 0) : 0)), 0);
        if (Math.abs(amt) >= 0.01) addReg(`purchase_additional_expense:${e.id}`, { amount: amt, doc_no: e.doc_no, doc_date: e.doc_date, party_name: e.vendor_name_snapshot || '', label: 'Purchase Additional' });
    });

    // books: stock receipts / returns of the period
    const moves = [];
    for (const type of ['purchase_grn', 'purchase_bill', 'purchase_return']) {
        for (let at = 0; ; at += 1000) {
            const { data, error } = await dated(c.from('stock_movements').select('*').eq('tenant_id', t).eq('source_type', type), from, to, 'movement_date').range(at, at + 999);
            if (error) throw error;
            moves.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
    }
    const moveBillIds = [...new Set(moves.filter(m => m.source_type === 'purchase_bill' && !(m.source_id in grnOfBill)).map(m => m.source_id))];
    (await inChunks(moveBillIds, 200, async ch => safe(c.from('purchase_bills').select('id, source_grn_id').in('id', ch)))).forEach(b => { if (b.source_grn_id) grnOfBill[b.id] = b.source_grn_id; });
    moves.forEach(m => {
        const base = m.base_unit_cost !== null && m.base_unit_cost !== undefined ? Number(m.base_unit_cost) : Number(m.unit_cost) || 0;
        const val = (Number(m.qty_in) || 0) * base - (Number(m.qty_out) || 0) * (Number(m.unit_cost) || 0);
        addBook(keyOf(m.source_type, m.source_id), round2(val), 'Stock', String(m.movement_date).slice(0, 10));
        const row = rows.get(keyOf(m.source_type, m.source_id));
        if (!row.in_register) { row.book_type = m.source_type; row.book_id = m.source_id; }
    });
    // books: landed cost of each additional bill that reached a stock receipt
    if (exps.length) {
        const allocs = await inChunks(exps.map(e => e.id), 200, async ch => safe(c.from('purchase_expense_allocations').select('*').in('expense_id', ch)));
        const grnD = [...new Set(allocs.map(a => a.source_grn_detail_id).filter(Boolean))];
        const billD = [...new Set(allocs.map(a => a.source_bill_detail_id).filter(Boolean))];
        const ordD = [...new Set(allocs.map(a => a.source_order_detail_id).filter(Boolean))];
        const billLines = billD.length ? await inChunks(billD, 200, async ch => safe(c.from('purchase_bill_details').select('id, source_grn_detail_id').in('id', ch))) : [];
        const recvDetail = new Set();
        const detailIds = [...grnD, ...billD, ...billLines.map(b => b.source_grn_detail_id).filter(Boolean)];
        (await inChunks([...new Set(detailIds)], 200, async ch => safe(c.from('stock_movements').select('source_detail_id, qty_in').in('source_detail_id', ch))))
            .filter(m => Number(m.qty_in) > 0).forEach(m => recvDetail.add(m.source_detail_id));
        const ordRecv = new Set();
        if (ordD.length) {
            for (const tb of ['purchase_grn_details', 'purchase_bill_details']) {
                const ls = await inChunks(ordD, 200, async ch => safe(c.from(tb).select('id, source_order_detail_id').in('source_order_detail_id', ch)));
                const got = new Set((await inChunks(ls.map(l => l.id), 200, async ch => safe(c.from('stock_movements').select('source_detail_id, qty_in').in('source_detail_id', ch)))).filter(m => Number(m.qty_in) > 0).map(m => m.source_detail_id));
                ls.forEach(l => { if (got.has(l.id)) ordRecv.add(l.source_order_detail_id); });
            }
        }
        const grnOfBillLine = Object.fromEntries(billLines.map(b => [b.id, b.source_grn_detail_id]));
        const reached = a => a.source_grn_detail_id ? recvDetail.has(a.source_grn_detail_id)
            : a.source_bill_detail_id ? recvDetail.has(grnOfBillLine[a.source_bill_detail_id] || a.source_bill_detail_id)
                : a.source_order_detail_id ? ordRecv.has(a.source_order_detail_id) : false;
        exps.forEach(e => {
            const amt = round2(allocs.filter(a => a.expense_id === e.id && reached(a)).reduce((s, a) => s + Number(a.allocated_amount || 0), 0));
            if (Math.abs(amt) >= 0.01) addBook(`purchase_additional_expense:${e.id}`, amt, 'Landed cost', e.doc_date);
        });
    }

    // numbers / parties of stock rows with nothing in the register (GRN not billed yet, a bill / return outside the register)
    const grnNos = {};
    for (const [type, table] of [['purchase_grn', 'purchase_grns'], ['purchase_bill', 'purchase_bills'], ['purchase_return', 'purchase_returns']]) {
        const ids = [...new Set([...rows.values()].filter(r => !r.in_register && r.book_type === type).map(r => r.book_id))];
        (await inChunks(ids, 200, async ch => safe(c.from(table).select('id, doc_no, vendor_name_snapshot').in('id', ch)))).forEach(g => { grnNos[g.id] = g; });
    }
    rows.forEach(r => {
        if (r.key.startsWith('purchase_grn:') && r.in_register) r.label = 'Purchase Bill (with GRN)';
        if (!r.in_register) {
            const g = grnNos[r.book_id];
            r.label = r.book_type === 'purchase_grn' ? 'GRN (not billed yet)' : r.book_type === 'purchase_bill' ? 'Purchase Bill' : r.book_type === 'purchase_return' ? 'Purchase Return' : 'Purchase Additional';
            if (g) { r.docs = [g.doc_no]; r.party_name = g.vendor_name_snapshot || ''; }
        }
    });
    return finish('stock', rows, [], from, to);
}

module.exports = { reconcile, sectionLedgers, SECTIONS };
