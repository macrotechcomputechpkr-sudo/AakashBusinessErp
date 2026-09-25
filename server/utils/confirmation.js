// =============================================
// utils/confirmation.js
// Account (balance) confirmation letters for customers and suppliers.
//   party_type  customer (Sundry Debtors group) | supplier (Sundry Creditors)
//               | all
//   group_by    ledger        one letter per ledger
//               billing_name  ledgers with the same billing name (the ledger's
//                             Billing Name, else its name) share one letter
//               pan           ledgers with the same PAN / VAT no share one
//                             letter (a ledger with no PAN stays on its own)
//   as_on       balance date; with `from` also the statement of account for
//               the period, and optionally the open (unsettled) bills
// Balances come from the general ledger (financialEngine.ledgerBalances), so
// they agree with the Trial Balance and Ledger report.
// =============================================

const { loadGroups, ledgerBalances } = require('./financialEngine');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const norm = s => String(s || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|p\.?\s*ltd|co|company|the)\b/g, ' ').replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();
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

async function companyInfo(c, t) {
    const { data } = await c.from('company_profile').select('*').eq('tenant_id', t).limit(1);
    const p = (data || [])[0] || {};
    return { name: p.company_name || '', short_name: p.company_short_name || '', pan: p.pan_number || '', address: [p.address_line1, p.address_line2, p.city, p.district].filter(Boolean).join(', '),
        phone: p.phone || '', email: p.email || '', website: p.website || '' };
}

async function confirmationData(c, t, q) {
    const asOn = q.as_on || new Date().toISOString().slice(0, 10);
    const from = q.from || null;
    const type = ['customer', 'supplier', 'all'].includes(q.party_type) ? q.party_type : 'customer';
    const groupBy = ['ledger', 'billing_name', 'pan'].includes(q.group_by) ? q.group_by : 'ledger';
    const partyIds = csv(q.party_ids), areaIds = csv(q.area_ids), agentIds = csv(q.agent_ids);
    const minBal = Number(q.min_balance) || 0;
    const skipZero = q.include_zero !== 'true';
    const withStatement = q.with_statement === 'true' && !!from;
    const withBills = q.with_open_bills === 'true';

    const [groups, bal] = await Promise.all([loadGroups(c, t), ledgerBalances(c, t, { from, to: asOn })]);
    const ledgers = await fetchAll(() => c.from('ledger_accounts').select('*').eq('tenant_id', t).order('id'));
    const sideOf = l => { const a = groups[l.account_group_id]?.anchor; return a === 'RECEIVABLES' ? 'customer' : a === 'PAYABLES' ? 'supplier' : null; };
    let list = ledgers.filter(l => {
        const side = sideOf(l);
        if (!side || (type !== 'all' && side !== type)) return false;
        if (partyIds.length && !partyIds.includes(l.id)) return false;
        if (areaIds.length && !areaIds.includes(l.area_id)) return false;
        if (agentIds.length && !agentIds.includes(l.agent_id)) return false;
        return l.is_active !== false;
    });
    const keyOf = l => {
        if (groupBy === 'pan') { const p = String(l.vat_pan_number || l.pan_number || '').replace(/\s/g, ''); return p ? `pan:${p}` : `ledger:${l.id}`; }
        if (groupBy === 'billing_name') return `name:${norm(l.billing_name || l.account_name)}`;
        return `ledger:${l.id}`;
    };
    const map = new Map();
    list.forEach(l => {
        const b = bal[l.id] || { closing: 0, opening: 0, dr: 0, cr: 0 };
        const k = keyOf(l);
        if (!map.has(k)) map.set(k, { key: k, ledgers: [], balance: 0, opening: 0, period_dr: 0, period_cr: 0 });
        const g = map.get(k);
        g.ledgers.push({ id: l.id, code: l.account_code || '', name: l.account_name, billing_name: l.billing_name || '', side: sideOf(l), balance: round2(b.closing),
            pan: l.vat_pan_number || l.pan_number || '', address: l.billing_address || [l.street, l.city].filter(Boolean).join(', '), phone: l.phone_office || l.contact_person_mobile || '',
            email: l.email || l.contact_person_email || '', contact_person: l.contact_person_name || l.contact_person || '' });
        g.balance += b.closing; g.opening += b.opening; g.period_dr += b.dr; g.period_cr += b.cr;
    });
    let rows = [...map.values()].map(g => {
        const main = [...g.ledgers].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))[0];
        const bal2 = round2(g.balance);
        return { key: g.key, name: main.billing_name || main.name, pan: g.ledgers.map(l => l.pan).find(Boolean) || '', address: main.address || g.ledgers.map(l => l.address).find(Boolean) || '',
            phone: main.phone, email: main.email || g.ledgers.map(l => l.email).find(Boolean) || '', contact_person: main.contact_person, side: main.side,
            ledgers: g.ledgers, ledger_count: g.ledgers.length, balance: bal2, balance_abs: Math.abs(bal2), dr_cr: bal2 >= 0 ? 'Dr' : 'Cr',
            // from our books: a Dr balance = they owe us; Cr = we owe them
            position: bal2 > 0 ? 'receivable' : bal2 < 0 ? 'payable' : 'nil',
            opening: round2(g.opening), period_dr: round2(g.period_dr), period_cr: round2(g.period_cr) };
    });
    if (skipZero) rows = rows.filter(r => Math.abs(r.balance) >= 0.005);
    if (minBal > 0) rows = rows.filter(r => r.balance_abs >= minBal);
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const ids = rows.flatMap(r => r.ledgers.map(l => l.id));
    if (withBills && ids.length) {
        const refs = await inChunks(ids, async ch => {
            const { data, error } = await c.from('bill_wise_references').select('ledger_id, source_type, source_doc_no, source_date, total_amount, remaining_amount, nature').eq('tenant_id', t).in('ledger_id', ch).gt('remaining_amount', 0);
            if (error) return [];
            return data || [];
        });
        rows.forEach(r => {
            const own = new Set(r.ledgers.map(l => l.id));
            r.open_bills = refs.filter(x => own.has(x.ledger_id) && String(x.source_date).slice(0, 10) <= asOn)
                .map(x => ({ doc_no: x.source_doc_no, date: String(x.source_date).slice(0, 10), total: round2(x.total_amount), remaining: round2(x.remaining_amount), nature: x.nature }))
                .sort((a, b) => a.date.localeCompare(b.date));
        });
    }
    if (withStatement && ids.length) {
        const lines = await inChunks(ids, ch => fetchAll(() => c.from('ledger_transaction_lines')
            .select('ledger_account_id, debit_amount, credit_amount, narration, batch:batch_id!inner(batch_date, document_type, narration)')
            .eq('tenant_id', t).in('ledger_account_id', ch).gte('batch.batch_date', from).lte('batch.batch_date', asOn).order('id')), 60);
        rows.forEach(r => {
            const own = new Set(r.ledgers.map(l => l.id));
            let run = r.opening;
            r.statement = lines.filter(l => own.has(l.ledger_account_id)).sort((a, b) => String(a.batch.batch_date).localeCompare(String(b.batch.batch_date)))
                .map(l => { const dr = Number(l.debit_amount) || 0, cr = Number(l.credit_amount) || 0; run += dr - cr;
                    return { date: String(l.batch.batch_date).slice(0, 10), type: l.batch.document_type, narration: l.narration || l.batch.narration || '', debit: round2(dr), credit: round2(cr), balance: round2(run) }; });
        });
    }
    return { as_on: asOn, from, party_type: type, group_by: groupBy, company: await companyInfo(c, t), rows,
        totals: { parties: rows.length, receivable: round2(rows.filter(r => r.balance > 0).reduce((s, r) => s + r.balance, 0)), payable: round2(rows.filter(r => r.balance < 0).reduce((s, r) => s - r.balance, 0)) },
        merged: rows.filter(r => r.ledger_count > 1).length };
}

module.exports = { confirmationData, companyInfo, norm };
