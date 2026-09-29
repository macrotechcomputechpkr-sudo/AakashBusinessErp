// =============================================
// utils/dailyRegister.js
// Daily Register (/api/daily-register, pages/DailyRegister.jsx) - the
// one-page day sheet of the counter, filled from the posted vouchers
// (utils/dayBook.js):
//   Sales                 bill no, customer, Cash (A) / Credit (B)
//   Purchase              bill no, supplier, Cash (C) / Credit (D)
//   Received / Withdraw   receipts from parties and cash drawn from bank:
//                         Cash (E) / Bank-cheque (F)
//   Expenses / Deposit    payments and cash deposited in bank: Cash (G) / Bank-cheque (H)
//   Return / Exchange     customer returns (I) / supplier returns (J)
//   Cash summary          opening cash + A + E - C - G - refunds = expected
//                         closing; the cash ledgers' real closing and the
//                         difference ("other cash entries": JV etc.)
//   Sales / purchase      opening (fiscal year to the day before), today,
//                         less return, net; opening / closing stock, gross
//                         and net profit (Profit & Loss of the day)
// With a user / agent filter only their vouchers are listed and the
// ledger-based figures (opening cash, stock, profit) are left out.
// Cash denomination count and the day's note are kept in the page.
// =============================================
const { dayBook } = require('./dayBook');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const dayBefore = d => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

async function dailyRegister(c, t, q) {
    const from = q.date_from || q.date, to = q.date_to || from;
    if (!from) throw httpError('Choose the date');
    const filt = { user_ids: q.user_ids, agent_ids: q.agent_ids };
    const narrowed = !!(q.user_ids || q.agent_ids);
    const book = await dayBook(c, t, { date_from: from, date_to: to, ...filt });
    const { data: leds } = await c.from('ledger_accounts').select('id, category_type').eq('tenant_id', t);
    const isBank = id => (leds || []).some(l => l.id === id && l.category_type === 'bank');
    const row = r => ({ doc_no: r.doc_no, date: r.date, particulars: r.party || r.mode || '', cash: round2(r.cash), bank: round2(r.bank), credit: round2(r.credit), amount: round2(r.amount), status: r.status });
    const of = types => book.rows.filter(r => types.includes(r.type));
    const sum = (list, k) => round2(list.reduce((s, r) => s + (Number(r[k]) || 0), 0));

    const sales = of(['sales_bill', 'sales_additional']).map(row);
    const purchase = of(['purchase_bill', 'purchase_additional']).map(row);
    const received = of(['receipt']).map(r => ({ ...row(r), kind: isBank(r.party_id) ? 'Bank withdraw' : 'Received' }));
    const expenses = of(['payment']).map(r => ({ ...row(r), kind: isBank(r.party_id) ? 'Bank deposit' : 'Paid' }));
    const returns = [...of(['sales_return', 'sales_nonsaleable_return']).map(r => ({ ...row(r), side: 'customer' })), ...of(['purchase_return']).map(r => ({ ...row(r), side: 'supplier' }))];

    const A = sum(sales, 'cash'), B = sum(sales, 'credit'), C = sum(purchase, 'cash'), D = sum(purchase, 'credit');
    const E = sum(received, 'cash'), F = sum(received, 'bank'), G = sum(expenses, 'cash'), H = sum(expenses, 'bank');
    const I = sum(returns.filter(r => r.side === 'customer'), 'amount'), J = sum(returns.filter(r => r.side === 'supplier'), 'amount');
    const refunds = sum(returns.filter(r => r.side === 'customer'), 'cash'), supplierCashBack = sum(returns.filter(r => r.side === 'supplier'), 'cash');

    // cash: the cash ledgers of the book (opening / closing only for the whole business)
    const cashRows = book.cash_bank.filter(x => x.kind !== 'bank');
    const openingCash = narrowed ? null : round2(cashRows.reduce((s, x) => s + (x.opening || 0), 0));
    const closingCash = narrowed ? null : round2(cashRows.reduce((s, x) => s + (x.closing || 0), 0));
    const expected = round2((openingCash || 0) + A + E + supplierCashBack - C - G - refunds);
    const cash = { opening: openingCash, cash_sales: A, received_cash: E, supplier_return_cash: supplierCashBack, cash_purchase: C, paid_cash: G, refunds,
        expected_closing: expected, closing: closingCash, other: narrowed ? null : round2(closingCash - expected) };

    // sales / purchase to date and profit
    let toDate = null, profit = null;
    if (!narrowed) {
        const { data: fy } = await c.from('fiscal_years').select('start_date_eng').eq('tenant_id', t).eq('is_current', true).maybeSingle();
        const fyStart = fy?.start_date_eng ? String(fy.start_date_eng).slice(0, 10) : `${from.slice(0, 4)}-01-01`;
        if (fyStart < from) {
            const before = await dayBook(c, t, { date_from: fyStart, date_to: dayBefore(from), voucher_types: 'sales_bill,sales_return,sales_nonsaleable_return,purchase_bill,purchase_return' });
            const h = before.headline;
            toDate = { from: fyStart, opening_sales: round2(h.sales - h.sales_return), opening_purchase: round2(h.purchase - h.purchase_return) };
        } else toDate = { from: fyStart, opening_sales: 0, opening_purchase: 0 };
        try {
            const { profitAndLoss } = require('./financialEngine');
            const pl = await profitAndLoss(c, t, { from, to, stockMethod: ['weighted_average', 'moving_average', 'fifo', 'last_purchase'].includes(q.stock_method) ? q.stock_method : 'weighted_average' });
            profit = { opening_stock: pl.opening_stock, closing_stock: pl.closing_stock, gross_profit: pl.gross_profit, net_profit: pl.net_profit, overheads: pl.overheads, other_income: pl.other_income };
        } catch (e) { profit = { error: e.message }; }
    }
    const h = book.headline;
    return {
        from, to, filtered: narrowed, filter_names: book.filter_names,
        sales, purchase, received, expenses, returns,
        totals: { A, B, C, D, E, F, G, H, I, J },
        cash,
        trading: { today_sales: h.sales, today_sales_return: h.sales_return, net_sales: round2(h.sales - h.sales_return),
            today_purchase: h.purchase, today_purchase_return: h.purchase_return, net_purchase: round2(h.purchase - h.purchase_return),
            ...(toDate ? { from: toDate.from, opening_sales: toDate.opening_sales, opening_purchase: toDate.opening_purchase,
                sales_to_date: round2(toDate.opening_sales + h.sales - h.sales_return), purchase_to_date: round2(toDate.opening_purchase + h.purchase - h.purchase_return) } : {}) },
        profit
    };
}

module.exports = { dailyRegister };
