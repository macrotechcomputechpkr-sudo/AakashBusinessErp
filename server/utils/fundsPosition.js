// =============================================
// utils/fundsPosition.js
// Net Position of Funds as on a date:
//   Cash in hand                           (cash ledgers)
//   Bank balances as per books             (each bank; overdraft as minus)
//     with cheques issued / deposits not yet cleared (Bank Reconciliation)
//     and the bank's own statement balance where a statement is uploaded
//   = Net funds available
//   + PDC received (pending) - PDC issued (pending)
//   = Net funds after PDC
//   + Receivables - Payables              (party ledgers, net)
//   = Net working funds
//   Unused overdraft limits (credit limit on overdraft / bank ledgers)
// and a forecast for the next N days: funds available today, plus PDC
// cheques received and minus PDC cheques issued by their cheque date
// (matured but unposted ones on day one).
// =============================================

const { loadGroups, ledgerBalances } = require('./financialEngine');
const { cashBankLedgers, bookLines, statementLines } = require('./bankReco');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

async function fundsPosition(c, t, q) {
    const asOn = q.as_on || new Date().toISOString().slice(0, 10);
    const horizon = Math.min(180, Math.max(7, parseInt(q.horizon_days, 10) || 30));
    const step = ['day', 'week'].includes(q.forecast_step) ? q.forecast_step : (horizon > 45 ? 'week' : 'day');
    const withReco = q.with_reco !== 'false';

    const [groups, bal, cb] = await Promise.all([loadGroups(c, t), ledgerBalances(c, t, { from: null, to: asOn }), cashBankLedgers(c, t)]);
    const closing = id => (bal[id] ? bal[id].closing : 0);

    const cash = cb.filter(l => l.kind === 'cash').map(l => ({ id: l.id, name: l.name, code: l.code, balance: closing(l.id) }));
    const banks = [];
    for (const l of cb.filter(x => x.kind !== 'cash')) {
        const row = { id: l.id, name: l.name, code: l.code, kind: l.kind, bank_name: l.bank_name, account_number: l.account_number, book_balance: closing(l.id), limit: l.limit,
            uncleared_issued: 0, uncleared_deposits: 0, statement_balance: null, statement_date: null };
        if (withReco) {
            const lines = await bookLines(c, t, l.id, { to: asOn });
            const open = lines.filter(x => !x.cleared_date || x.cleared_date > asOn);
            row.uncleared_issued = round2(open.reduce((s, x) => s + x.withdrawal, 0));
            row.uncleared_deposits = round2(open.reduce((s, x) => s + x.deposit, 0));
            const st = (await statementLines(c, t, l.id, { to: asOn })).filter(s => s.balance !== null);
            if (st.length) { row.statement_balance = st[st.length - 1].balance; row.statement_date = st[st.length - 1].txn_date; }
        }
        row.cleared_balance = round2(row.book_balance + row.uncleared_issued - row.uncleared_deposits);
        // unused limit: overdraft / bank with a limit - how much more can be drawn
        row.unused_limit = row.limit > 0 ? round2(Math.max(0, row.limit + Math.min(0, row.book_balance))) : 0;
        banks.push(row);
    }

    // parties
    let receivable = 0, advanceFromCustomers = 0, payable = 0, advanceToSuppliers = 0;
    Object.values(bal).forEach(b => {
        const g = groups[b.account_group_id];
        if (!g) return;
        if (g.anchor === 'RECEIVABLES') { if (b.closing >= 0) receivable += b.closing; else advanceFromCustomers += -b.closing; }
        if (g.anchor === 'PAYABLES') { if (b.closing <= 0) payable += -b.closing; else advanceToSuppliers += b.closing; }
    });

    // PDC pending (not yet posted), as on the date
    const pdcs = await fetchAll(() => c.from('pdc_vouchers').select('id, doc_no, voucher_type, cheque_no, cheque_date, amount, party_name_snapshot, bank_name, status, doc_date')
        .eq('tenant_id', t).eq('status', 'pending').lte('doc_date', asOn).order('cheque_date'));
    const pdc = type => {
        const list = pdcs.filter(p => p.voucher_type === type).map(p => ({ ...p, cheque_date: String(p.cheque_date).slice(0, 10), amount: Number(p.amount) || 0 }));
        return { total: round2(list.reduce((s, p) => s + p.amount, 0)), matured: round2(list.filter(p => p.cheque_date <= asOn).reduce((s, p) => s + p.amount, 0)),
            within_horizon: round2(list.filter(p => p.cheque_date > asOn && p.cheque_date <= addDays(asOn, horizon)).reduce((s, p) => s + p.amount, 0)), count: list.length, list };
    };
    const pdcIn = pdc('received'), pdcOut = pdc('issued');

    const cashTotal = round2(cash.reduce((s, x) => s + x.balance, 0));
    const bankTotal = round2(banks.reduce((s, x) => s + x.book_balance, 0));
    const netFunds = round2(cashTotal + bankTotal);
    const afterPdc = round2(netFunds + pdcIn.total - pdcOut.total);
    const netReceivable = round2(receivable - advanceFromCustomers), netPayable = round2(payable - advanceToSuppliers);
    const working = round2(afterPdc + netReceivable - netPayable);
    const unusedLimits = round2(banks.reduce((s, x) => s + x.unused_limit, 0));

    // forecast
    const buckets = [];
    for (let d = 0; d < horizon;) {
        const len = step === 'week' ? 7 : 1;
        const start = addDays(asOn, d + 1), end = addDays(asOn, Math.min(horizon, d + len));
        buckets.push({ start, end });
        d += len;
    }
    let running = netFunds;
    const first = { label: `Up to ${asOn} (matured, unposted)`, start: null, end: asOn, inflow: pdcIn.matured, outflow: pdcOut.matured };
    const rows = [first, ...buckets.map(b => ({ label: b.start === b.end ? b.start : `${b.start} to ${b.end}`, ...b,
        inflow: round2(pdcIn.list.filter(p => p.cheque_date >= b.start && p.cheque_date <= b.end).reduce((s, p) => s + p.amount, 0)),
        outflow: round2(pdcOut.list.filter(p => p.cheque_date >= b.start && p.cheque_date <= b.end).reduce((s, p) => s + p.amount, 0)) }))];
    const forecast = rows.map(r => { const opening = running; running = round2(running + r.inflow - r.outflow); return { ...r, opening: round2(opening), closing: running, with_limits: round2(running + unusedLimits), negative: running < 0, shortfall: running + unusedLimits < 0 }; });

    return {
        as_on: asOn, horizon_days: horizon, forecast_step: step,
        cash, banks, pdc_received: pdcIn, pdc_issued: pdcOut,
        summary: {
            cash_in_hand: cashTotal, bank_balance: bankTotal, net_funds: netFunds,
            pdc_received: pdcIn.total, pdc_issued: pdcOut.total, net_after_pdc: afterPdc,
            receivables: round2(receivable), advance_from_customers: round2(advanceFromCustomers), payables: round2(payable), advance_to_suppliers: round2(advanceToSuppliers),
            net_receivable: netReceivable, net_payable: netPayable, net_working_funds: working,
            unused_limits: unusedLimits, funds_with_limits: round2(netFunds + unusedLimits),
            uncleared_issued: round2(banks.reduce((s, x) => s + x.uncleared_issued, 0)), uncleared_deposits: round2(banks.reduce((s, x) => s + x.uncleared_deposits, 0))
        },
        forecast, lowest_point: forecast.reduce((m, r) => (m === null || r.closing < m.closing ? r : m), null)
    };
}

module.exports = { fundsPosition };
