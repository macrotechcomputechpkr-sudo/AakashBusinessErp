// =============================================
// utils/billExtras.js
// What is settled on a bill itself, on top of the bill's own posting:
//   TDS (sales bill, purchase bill)
//     sales:    the customer withholds TDS from what it pays us
//               Dr TDS receivable (advance tax)  Cr Customer
//     purchase: we withhold TDS from the supplier
//               Dr Supplier                      Cr TDS payable
//     Ledger: the one chosen on the bill, else System Control
//     (sales_tds_ledger_id / tds_ledger_id). Base: VAT-exclusive bill value
//     unless typed; amount = base x % unless typed.
//   Receipts (sales bill) - money received with the bill, each from a cash
//     or bank ledger: Dr each cash / bank, Cr Customer.
//     Cash bill:   received + TDS must equal the bill total. With no
//                  receipt lines, the whole bill goes to System Control's
//                  default cash ledger.
//     Credit bill: received + TDS may be part of the total (or nothing);
//                  the rest stays outstanding on the customer.
// Bill-wise: TDS + receipts are one extra reference ('sales_bill_settle' /
// 'purchase_bill_settle') settled against the bill's own reference, so the
// bill shows only the balance as outstanding. Cancelling the bill removes it.
// =============================================
const { createReferenceAndSettle, reverseReferenceAndSettlements, isBillWiseTrackingEnabled } = require('./billWiseSettlement');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = msg => { const e = new Error(msg); e.status = 400; return e; };
const SIDES = {
    sales: { table: 'sales_bills', party: 'customer_ledger_id', partySub: 'customer_sub_ledger_id', sysTds: 'sales_tds_ledger_id', ref: 'sales_bill', settle: 'sales_bill_settle', nature: 'cr' },
    purchase: { table: 'purchase_bills', party: 'vendor_ledger_id', partySub: 'vendor_sub_ledger_id', sysTds: 'tds_ledger_id', ref: 'purchase_bill', settle: 'purchase_bill_settle', nature: 'dr' }
};

/** receipt lines from the request, cleaned ([] when none) */
function cleanReceipts(list) {
    return (Array.isArray(list) ? list : [])
        .map(r => ({ ledger_id: r && r.ledger_id || null, sub_ledger_id: r && r.sub_ledger_id || null, amount: round2(r && r.amount), ref_no: r && r.ref_no ? String(r.ref_no).slice(0, 50) : null }))
        .filter(r => r.ledger_id && r.amount > 0);
}

/** header fields to store from a request body (only the ones sent) */
function extraFields(b, side) {
    const out = {};
    if ('tds_percent' in b) out.tds_percent = Math.max(0, Number(b.tds_percent) || 0);
    if ('tds_base_amount' in b) out.tds_base_amount = round2(Math.max(0, Number(b.tds_base_amount) || 0));
    if ('tds_amount' in b) out.tds_amount = round2(Math.max(0, Number(b.tds_amount) || 0));
    if ('tds_ledger_id' in b) out.tds_ledger_id = b.tds_ledger_id || null;
    if ('tds_sub_ledger_id' in b) out.tds_sub_ledger_id = b.tds_sub_ledger_id || null;
    if (side === 'sales' && 'receipts' in b) {
        out.receipts = cleanReceipts(b.receipts);
        out.received_amount = round2(out.receipts.reduce((s, r) => s + r.amount, 0));
    }
    return out;
}

/** TDS of a saved bill: { base, percent, amount } (base / amount worked out when not typed) */
function tdsOf(doc, vat = doc.total_tax_amount) {
    const percent = Number(doc.tds_percent) || 0;
    const base = Number(doc.tds_base_amount) > 0 ? round2(doc.tds_base_amount) : round2(Number(doc.total_amount || 0) - Number(vat || 0));
    const amount = Number(doc.tds_amount) > 0 ? round2(doc.tds_amount) : round2(base * percent / 100);
    return { base: percent > 0 || amount > 0 ? base : 0, percent, amount };
}

/**
 * Before posting: resolves the TDS ledger and cash receipt, checks the amounts.
 * Returns the fields to store on the bill (may be {}), throws a 400 error on a problem.
 */
async function prepareExtras(c, tenantId, side, doc) {
    const S = SIDES[side];
    const total = round2(doc.total_amount);
    let vat = doc.total_tax_amount;
    if (side === 'purchase' && !(Number(doc.tds_base_amount) > 0) && Number(doc.tds_percent) > 0) {
        // a purchase bill keeps no VAT total: the VAT posting works it out
        const { purchaseVatByLedger } = require('./vatLedger');
        vat = round2((await purchaseVatByLedger(c, tenantId, 'purchase_bill', doc.id)).reduce((s, p) => s + Number(p.amount || 0), 0));
    }
    const tds = tdsOf(doc, vat);
    const fields = {};
    const { data: sc } = await c.from('system_control_settings').select(`${S.sysTds}, default_cash_ledger_id`).eq('tenant_id', tenantId).maybeSingle();
    if (tds.amount > 0) {
        if (!doc[S.party]) throw httpError(`TDS needs a ${side === 'sales' ? 'customer' : 'supplier'} ledger`);
        const ledger = doc.tds_ledger_id || (sc && sc[S.sysTds]) || null;
        if (!ledger) throw httpError(`Choose the TDS ledger on the bill, or set the ${side === 'sales' ? 'Sales TDS (receivable)' : 'TDS payable'} ledger in System Control`);
        if (tds.amount > total) throw httpError('TDS cannot be more than the bill total');
        Object.assign(fields, { tds_ledger_id: ledger, tds_base_amount: tds.base, tds_amount: tds.amount });
    } else if (Number(doc.tds_amount) || Number(doc.tds_base_amount)) {
        Object.assign(fields, { tds_amount: 0, tds_base_amount: 0 });
    }
    if (side !== 'sales') return fields;

    let receipts = cleanReceipts(doc.receipts);
    const cashBill = doc.invoice_type === 'cash';
    if (cashBill && !receipts.length) {
        const due = round2(total - tds.amount);
        if (due > 0) {
            if (!sc || !sc.default_cash_ledger_id) throw httpError('Cash bill: enter the cash / bank receipt, or set the default Cash ledger in System Control');
            receipts = [{ ledger_id: sc.default_cash_ledger_id, sub_ledger_id: null, amount: due, ref_no: null }];
        }
    }
    const received = round2(receipts.reduce((s, r) => s + r.amount, 0));
    if (receipts.length && !doc[S.party]) throw httpError('A receipt needs a customer ledger');
    if (received + tds.amount > total + 0.01) throw httpError(`Received ${received.toFixed(2)}${tds.amount ? ` + TDS ${tds.amount.toFixed(2)}` : ''} is more than the bill total ${total.toFixed(2)}`);
    if (cashBill && Math.abs(received + tds.amount - total) > 0.01) throw httpError(`Cash bill: cash / bank received ${received.toFixed(2)}${tds.amount ? ` + TDS ${tds.amount.toFixed(2)}` : ''} must equal the bill total ${total.toFixed(2)} - for part payment make it a Credit bill`);
    if (receipts.some(r => r.ledger_id === doc[S.party])) throw httpError('A receipt ledger cannot be the customer itself');
    if (receipts.length) {
        const { classifyLedgers, allowed } = require('./ledgerPurpose');
        const cls = await classifyLedgers(c, tenantId, [...new Set(receipts.map(r => r.ledger_id))]);
        const bad = receipts.find(r => !cls[r.ledger_id] || !allowed(cls[r.ledger_id], 'cash_bank'));
        if (bad) throw httpError(`Receipt ledger "${cls[bad.ledger_id]?.name || bad.ledger_id}" is not a Cash / Bank ledger`);
    }
    fields.receipts = receipts;
    fields.received_amount = received;
    return fields;
}

/** GL lines (in the bill's own batch shape) for TDS and receipts */
function glLines(side, doc) {
    const S = SIDES[side];
    const party = { ledgerId: doc[S.party], subLedgerId: doc[S.partySub] || null };
    const out = [];
    const tds = round2(doc.tds_amount);
    if (tds > 0 && doc.tds_ledger_id) {
        const tdsLine = { ledgerId: doc.tds_ledger_id, subLedgerId: doc.tds_sub_ledger_id || null };
        if (side === 'sales') out.push({ ...tdsLine, debit: tds, credit: 0 }, { ...party, debit: 0, credit: tds, narration: `TDS on bill ${doc.doc_no}` });
        else out.push({ ...party, debit: tds, credit: 0, narration: `TDS on bill ${doc.doc_no}` }, { ...tdsLine, debit: 0, credit: tds });
    }
    if (side === 'sales') {
        const receipts = cleanReceipts(doc.receipts);
        receipts.forEach(r => out.push({ ledgerId: r.ledger_id, subLedgerId: r.sub_ledger_id, debit: r.amount, credit: 0, narration: `Received on bill ${doc.doc_no}${r.ref_no ? ` (${r.ref_no})` : ''}` }));
        const received = round2(receipts.reduce((s, r) => s + r.amount, 0));
        if (received > 0) out.push({ ...party, debit: 0, credit: received, narration: `Received on bill ${doc.doc_no}` });
    }
    return out;
}

/** TDS / receipts as their own balanced batch of the bill (reversed with the bill's other batches) */
async function postExtrasBatch(c, tenantId, side, doc, userId) {
    const lines = glLines(side, doc);
    if (!lines.length) return null;
    const { data: batch, error } = await c.from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: SIDES[side].ref, document_id: doc.id, batch_date: doc.doc_date, narration: `Bill ${doc.doc_no} - TDS${side === 'sales' ? ' / receipt' : ''}`, created_by: userId })
        .select().single();
    if (error) throw error;
    const { error: lineErr } = await c.from('ledger_transaction_lines').insert(lines.map(l => ({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: l.ledgerId, sub_ledger_id: l.subLedgerId || null,
        product_company_id: doc.product_company_id || null, debit_amount: l.debit, credit_amount: l.credit, narration: l.narration || null })));
    if (lineErr) throw lineErr;
    return batch;
}

/** after the bill's reference exists: settle TDS + receipts against it (bill-wise parties only) */
async function settleOnBill(c, tenantId, side, doc) {
    const S = SIDES[side];
    const amount = round2(Number(doc.tds_amount || 0) + (side === 'sales' ? Number(doc.received_amount || 0) : 0));
    if (!(amount > 0) || !doc[S.party]) return;
    if (!(await isBillWiseTrackingEnabled(c, tenantId, doc[S.party]))) return;
    const { data: billRef } = await c.from('bill_wise_references').select('id, remaining_amount').eq('source_type', S.ref).eq('source_id', doc.id).maybeSingle();
    const settled = billRef ? Math.min(amount, Math.max(0, round2(billRef.remaining_amount))) : 0;
    await createReferenceAndSettle(c, tenantId, { productCompanyId: doc.product_company_id || null, ledgerId: doc[S.party], sourceType: S.settle, sourceId: doc.id,
        docNo: doc.doc_no, date: doc.doc_date, nature: S.nature, totalAmount: amount,
        settlements: settled > 0 ? [{ against_reference_id: billRef.id, settled_amount: settled }] : [] });
}

async function unsettleOnBill(c, side, docId) {
    await reverseReferenceAndSettlements(c, SIDES[side].settle, docId);
}

module.exports = { cleanReceipts, extraFields, tdsOf, prepareExtras, glLines, postExtrasBatch, settleOnBill, unsettleOnBill, SIDES };
