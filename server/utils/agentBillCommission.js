// =============================================
// utils/agentBillCommission.js
// Bill-wise agent commission (next to the target commission of
// utils/agentTargets.js):
//   bills     posted sales bills of the agent(s) in a period - value net of
//             VAT, less posted sales returns made against the bill - with
//             the agent's commission % (salesman_agents.commission_percentage)
//             and whether commission was already given (agent_commission_bills)
//   post      the ticked bills (rate / amount changeable per bill): one
//             posting per agent, Dr commission expense / Cr commission
//             payable; each bill is kept in agent_commission_bills
//   no twice  a bill already in a live posting is skipped (and the unique
//             index ux_commission_bill_live refuses it); cancelling the
//             posting (agentTargets.cancelPosting) frees its bills again
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

// Bills with their commission state. q: agent_id (csv), date_from, date_to, show = pending | paid | all
async function commissionBills(c, t, q) {
    const from = q.date_from, to = q.date_to;
    if (!from || !to) throw httpError('Choose From and To dates');
    const agentIds = csv(q.agent_id);
    const bills = await fetchAll(() => {
        let x = c.from('sales_bills').select('id, doc_no, doc_date, agent_id, customer_name_snapshot, total_amount, total_tax_amount, invoice_type')
            .eq('tenant_id', t).eq('status', 'posted').gte('doc_date', from).lte('doc_date', to).not('agent_id', 'is', null);
        if (agentIds.length) x = x.in('agent_id', agentIds);
        return x.order('doc_date').order('doc_no');
    });
    const ids = bills.map(b => b.id);
    const [rets, paid, agents] = await Promise.all([
        inChunks(ids, async ch => (await c.from('sales_returns').select('source_bill_id, total_amount, total_tax_amount').eq('tenant_id', t).eq('status', 'posted').in('source_bill_id', ch)).data || []),
        inChunks(ids, async ch => (await c.from('agent_commission_bills').select('sales_bill_id, posting_id, commission_amount, commission_rate').eq('tenant_id', t).eq('is_active', true).in('sales_bill_id', ch)).data || []),
        fetchAll(() => c.from('salesman_agents').select('id, agent_name, commission_percentage, commission_expense_ledger_id, commission_payable_ledger_id').eq('tenant_id', t).order('id'))
    ]);
    const postingIds = [...new Set(paid.map(p => p.posting_id))];
    const postings = await inChunks(postingIds, async ch => (await c.from('agent_commission_postings').select('id, doc_no, posting_date').in('id', ch)).data || []);
    const P = Object.fromEntries(postings.map(p => [p.id, p]));
    const A = Object.fromEntries(agents.map(a => [a.id, a]));
    const retOf = {};
    rets.forEach(r => { retOf[r.source_bill_id] = (retOf[r.source_bill_id] || 0) + (Number(r.total_amount) || 0) - (Number(r.total_tax_amount) || 0); });
    const paidOf = Object.fromEntries(paid.map(p => [p.sales_bill_id, p]));
    const show = q.show || 'pending';
    const rows = bills.map(b => {
        const billValue = round2((Number(b.total_amount) || 0) - (Number(b.total_tax_amount) || 0));
        const returnValue = round2(retOf[b.id] || 0);
        const base = round2(billValue - returnValue);
        const rate = Number(A[b.agent_id]?.commission_percentage) || 0;
        const p = paidOf[b.id];
        return { id: b.id, doc_no: b.doc_no, doc_date: String(b.doc_date).slice(0, 10), agent_id: b.agent_id, agent_name: A[b.agent_id]?.agent_name || '',
            customer: b.customer_name_snapshot, invoice_type: b.invoice_type, bill_value: billValue, return_value: returnValue, commission_base: base,
            commission_rate: p ? Number(p.commission_rate) : rate, commission: p ? round2(p.commission_amount) : round2(base * rate / 100),
            paid: !!p, posting_no: p ? P[p.posting_id]?.doc_no || '' : null, posting_date: p ? String(P[p.posting_id]?.posting_date || '').slice(0, 10) : null };
    }).filter(r => (show === 'all' ? true : show === 'paid' ? r.paid : !r.paid));
    const sum = k => round2(rows.reduce((s, r) => s + r[k], 0));
    return { from, to, show, rows, totals: { bills: rows.length, bill_value: sum('bill_value'), return_value: sum('return_value'), commission_base: sum('commission_base'), commission: sum('commission') } };
}

// one number series with the target commission (COM-0001 ...)
const nextNo = (c, t) => require('./agentTargets').nextNo(c, t);

// b: bill_ids, rates { billId: % }, amounts { billId: amount }, posting_date, expense_ledger_id, payable_ledger_id, narration
async function postBillCommission(c, t, userId, b) {
    const ids = csv(b.bill_ids);
    if (!ids.length) throw httpError('Tick the bills to give commission on');
    const date = b.posting_date || new Date().toISOString().slice(0, 10);
    const { data: heads } = await c.from('sales_bills').select('doc_date').in('id', ids);
    const dates = (heads || []).map(h => String(h.doc_date).slice(0, 10)).sort();
    const all = await commissionBills(c, t, { date_from: dates[0] || date, date_to: dates[dates.length - 1] || date, show: 'all' });
    const byId = Object.fromEntries(all.rows.map(r => [r.id, r]));
    const { data: agents } = await c.from('salesman_agents').select('id, agent_name, commission_expense_ledger_id, commission_payable_ledger_id').eq('tenant_id', t);
    const A = Object.fromEntries((agents || []).map(a => [a.id, a]));
    const results = [], groups = {};
    ids.forEach(id => {
        const r = byId[id];
        if (!r) return results.push({ bill_id: id, skipped: true, reason: 'Not a posted bill with an agent' });
        if (r.paid) return results.push({ bill_id: id, doc_no: r.doc_no, skipped: true, reason: `Commission already given (${r.posting_no})` });
        const rate = b.rates && b.rates[id] !== undefined && b.rates[id] !== '' ? Number(b.rates[id]) : r.commission_rate;
        const amount = round2(b.amounts && b.amounts[id] !== undefined && b.amounts[id] !== '' ? Number(b.amounts[id]) : r.commission_base * rate / 100);
        if (!(amount > 0)) return results.push({ bill_id: id, doc_no: r.doc_no, skipped: true, reason: 'Commission is zero' });
        (groups[r.agent_id] = groups[r.agent_id] || []).push({ ...r, rate, amount });
        return null;
    });
    for (const [agentId, list] of Object.entries(groups)) {
        const agent = A[agentId] || {};
        const exp = b.expense_ledger_id || agent.commission_expense_ledger_id, pay = b.payable_ledger_id || agent.commission_payable_ledger_id;
        if (!exp || !pay) { list.forEach(r => results.push({ bill_id: r.id, doc_no: r.doc_no, skipped: true, reason: 'Choose the commission expense and payable ledgers' })); continue; }
        if (exp === pay) throw httpError('Expense and payable ledgers must be different');
        const total = round2(list.reduce((s, r) => s + r.amount, 0));
        const docNo = await nextNo(c, t);
        const bills = list.map(r => r.doc_no).join(', ');
        const narration = b.narration || `Commission ${agent.agent_name || ''} on bills ${bills.length > 180 ? `${list.length} bills` : bills}`;
        const periodFrom = list.map(r => r.doc_date).sort()[0], periodTo = list.map(r => r.doc_date).sort().slice(-1)[0];
        const { data: post, error } = await c.from('agent_commission_postings').insert({
            tenant_id: t, doc_no: docNo, posting_date: date, agent_id: agentId, target_id: null, basis: 'bill', period_from: periodFrom, period_to: periodTo,
            achieved_value: round2(list.reduce((s, r) => s + r.commission_base, 0)), commission_amount: total,
            expense_ledger_id: exp, payable_ledger_id: pay, narration, status: 'posted', created_by: userId || null
        }).select().single();
        if (error) throw error;
        const undo = async () => { await c.from('agent_commission_bills').delete().eq('posting_id', post.id); await c.from('agent_commission_postings').delete().eq('id', post.id); };
        const { error: eb } = await c.from('agent_commission_bills').insert(list.map(r => ({ tenant_id: t, posting_id: post.id, sales_bill_id: r.id, agent_id: agentId,
            bill_value: r.bill_value, return_value: r.return_value, commission_rate: r.rate, commission_amount: r.amount, is_active: true })));
        if (eb) {
            await undo();
            if (/ux_commission_bill_live|duplicate/i.test(eb.message)) { list.forEach(r => results.push({ bill_id: r.id, doc_no: r.doc_no, skipped: true, reason: 'Commission already given' })); continue; }
            throw eb;
        }
        const { data: batch, error: e2 } = await c.from('ledger_transaction_batches').insert({ tenant_id: t, document_type: 'agent_commission', document_id: post.id, batch_date: date, narration: `${docNo} ${narration}`, created_by: userId || null }).select().single();
        if (e2) { await undo(); throw e2; }
        const { error: e3 } = await c.from('ledger_transaction_lines').insert([
            { tenant_id: t, batch_id: batch.id, ledger_account_id: exp, debit_amount: total, credit_amount: 0, narration },
            { tenant_id: t, batch_id: batch.id, ledger_account_id: pay, debit_amount: 0, credit_amount: total, narration }
        ]);
        if (e3) { await c.from('ledger_transaction_batches').delete().eq('id', batch.id); await undo(); throw e3; }
        list.forEach(r => results.push({ bill_id: r.id, doc_no: r.doc_no, posted: true, posting_no: docNo, amount: r.amount }));
    }
    const done = results.filter(r => r.posted);
    return { posted: done.length, skipped: results.length - done.length, postings: [...new Set(done.map(r => r.posting_no))], total: round2(done.reduce((s, r) => s + r.amount, 0)), results };
}

module.exports = { commissionBills, postBillCommission };
