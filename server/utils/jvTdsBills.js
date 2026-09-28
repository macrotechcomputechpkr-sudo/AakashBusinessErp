// =============================================
// utils/jvTdsBills.js
// TDS journal against bills (JV Type "TDS", migration 144):
//   TDS on Purchase - the supplier's posted Purchase Bills and Purchase
//                     Additional Expenses (the lines of that party)
//   TDS on Sales    - the customer's posted Sales Bills
// A bill is offered only while no TDS has been taken on it: not on the bill
// itself (tds_amount / a TDS line on the additional expense) and not on
// another journal that is not cancelled (jv_tds_bills). The TDS base of a
// bill is its value without VAT.
// listBills()  - the party's open bills, newest first
// checkBills() - the chosen bills re-read from the database (never trusts
//                the amounts sent), each still open and of this party
// syncBills()  - the record of which bills this journal took TDS on
// =============================================
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const SOURCES = { purchase: ['purchase_bill', 'purchase_additional'], sales: ['sales_bill'] };
const LABEL = { purchase_bill: 'Purchase Bill', purchase_additional: 'Purchase Additional', sales_bill: 'Sales Bill' };

/** source ids already on a TDS journal that is not cancelled (other than excludeJvId) */
async function usedIds(c, t, excludeJvId) {
    const { data: rows, error } = await c.from('jv_tds_bills').select('jv_id, source_type, source_id').eq('tenant_id', t);
    if (error || !rows || !rows.length) return new Set();
    const jvIds = [...new Set(rows.map(r => r.jv_id))].filter(id => id !== excludeJvId);
    if (!jvIds.length) return new Set();
    const { data: jvs } = await c.from('journal_vouchers').select('id, status').in('id', jvIds);
    const live = new Set((jvs || []).filter(j => j.status !== 'cancelled').map(j => j.id));
    return new Set(rows.filter(r => live.has(r.jv_id)).map(r => `${r.source_type}|${r.source_id}`));
}

async function purchaseBills(c, t, partyId) {
    const { data } = await c.from('purchase_bills').select('id, doc_no, doc_date, party_bill_no, total_amount, tds_amount, status').eq('tenant_id', t).eq('vendor_ledger_id', partyId).eq('status', 'posted');
    const { purchaseVatByLedger } = require('./vatLedger');
    const out = [];
    for (const b of (data || []).filter(x => !(Number(x.tds_amount) > 0))) {
        const vat = r2((await purchaseVatByLedger(c, t, 'purchase_bill', b.id)).reduce((s, p) => s + Number(p.amount || 0), 0));
        out.push({ source_type: 'purchase_bill', source_id: b.id, doc_no: b.doc_no, party_bill_no: b.party_bill_no || null, doc_date: b.doc_date, bill_amount: r2(b.total_amount), base_amount: r2(Number(b.total_amount || 0) - vat) });
    }
    return out;
}

async function purchaseAdditional(c, t, partyId) {
    const { data: heads } = await c.from('purchase_additional_expenses').select('id, doc_no, doc_date, vendor_ledger_id, status').eq('tenant_id', t).eq('status', 'posted');
    const ids = (heads || []).map(h => h.id);
    if (!ids.length) return [];
    const { data: lines } = await c.from('purchase_additional_expense_lines').select('expense_id, party_ledger_id, entry_sign, is_tds, rate_percent, amount, vat_amount, party_bill_no').in('expense_id', ids);
    const out = [];
    for (const h of heads) {
        const mine = (lines || []).filter(l => l.expense_id === h.id && (l.party_ledger_id || h.vendor_ledger_id) === partyId);
        if (!mine.length || mine.some(l => l.entry_sign === 'deduct' && (l.is_tds || Number(l.rate_percent) > 0))) continue;   // TDS already on the entry
        const adds = mine.filter(l => l.entry_sign !== 'deduct');
        const base = r2(adds.reduce((s, l) => s + Number(l.amount || 0), 0));
        if (!(base > 0)) continue;
        out.push({ source_type: 'purchase_additional', source_id: h.id, doc_no: h.doc_no, party_bill_no: adds.map(l => l.party_bill_no).filter(Boolean).join(', ') || null, doc_date: h.doc_date,
            bill_amount: r2(base + adds.reduce((s, l) => s + Number(l.vat_amount || 0), 0)), base_amount: base });
    }
    return out;
}

async function salesBills(c, t, partyId) {
    const { data } = await c.from('sales_bills').select('id, doc_no, doc_date, total_amount, total_tax_amount, tds_amount, status').eq('tenant_id', t).eq('customer_ledger_id', partyId).eq('status', 'posted');
    return (data || []).filter(x => !(Number(x.tds_amount) > 0)).map(b => ({ source_type: 'sales_bill', source_id: b.id, doc_no: b.doc_no, party_bill_no: null, doc_date: b.doc_date,
        bill_amount: r2(b.total_amount), base_amount: r2(Number(b.total_amount || 0) - Number(b.total_tax_amount || 0)) }));
}

/** the party's bills still open for TDS, newest first */
async function listBills(c, t, side, partyId, excludeJvId = null) {
    if (!partyId || !SOURCES[side]) return [];
    const [used, rows] = await Promise.all([
        usedIds(c, t, excludeJvId),
        side === 'sales' ? salesBills(c, t, partyId) : Promise.all([purchaseBills(c, t, partyId), purchaseAdditional(c, t, partyId)]).then(([a, b]) => [...a, ...b])
    ]);
    return rows.filter(r => !used.has(`${r.source_type}|${r.source_id}`))
        .map(r => ({ ...r, label: LABEL[r.source_type] }))
        .sort((a, b) => String(b.doc_date || '').localeCompare(String(a.doc_date || '')) || String(b.doc_no || '').localeCompare(String(a.doc_no || '')));
}

/** the chosen bills, checked and priced from the database: { error } or { bills, base, tds } */
async function checkBills(c, t, side, partyId, chosen, percent, excludeJvId = null) {
    const list = Array.isArray(chosen) ? chosen.filter(b => b && b.source_id) : [];
    if (!list.length) return { bills: [], base: 0, tds: 0 };
    const open = await listBills(c, t, side, partyId, excludeJvId);
    const byKey = Object.fromEntries(open.map(b => [`${b.source_type}|${b.source_id}`, b]));
    const bills = [];
    for (const b of list) {
        const row = byKey[`${b.source_type}|${b.source_id}`];
        if (!row) return { error: `Bill ${b.doc_no || ''} is not an open bill of this party (TDS already taken, cancelled, or another party's)` };
        const pct = b.tds_percent !== undefined && b.tds_percent !== '' && b.tds_percent !== null ? Number(b.tds_percent) : Number(percent) || 0;
        if (!(pct > 0)) return { error: `Enter the TDS % for bill ${row.doc_no}` };
        bills.push({ ...row, tds_percent: pct, tds_amount: r2(row.base_amount * pct / 100) });
    }
    return { bills, base: r2(bills.reduce((s, b) => s + b.base_amount, 0)), tds: r2(bills.reduce((s, b) => s + b.tds_amount, 0)) };
}

async function syncBills(c, t, jvId, partyId, bills) {
    await c.from('jv_tds_bills').delete().eq('jv_id', jvId);
    if (!bills || !bills.length) return;
    const { error } = await c.from('jv_tds_bills').insert(bills.map(b => ({ tenant_id: t, jv_id: jvId, source_type: b.source_type, source_id: b.source_id, source_doc_no: b.doc_no || null,
        source_date: b.doc_date || null, party_ledger_id: partyId, bill_amount: b.bill_amount, base_amount: b.base_amount, tds_percent: b.tds_percent, tds_amount: b.tds_amount })));
    if (error) throw error;
}

module.exports = { listBills, checkBills, syncBills, usedIds, LABEL };
