// =============================================
// utils/grnAccounting.js
// "Challan Effect On Stock and Account ma Outstanding Purchase Challan
// Dr Cr Outstanding Purchase Challan Creditor Dekhaune" - the GR/IR
// clearing pattern, wired into the existing ledger_transaction_batches/
// lines infrastructure (built earlier, never connected to a document
// until now).
// =============================================

async function getGrnClearingLedgerId(tenantClient, tenantId) {
    const { data } = await tenantClient.from('system_control_settings').select('grn_clearing_ledger_id').eq('tenant_id', tenantId).maybeSingle();
    return data?.grn_clearing_ledger_id || null;
}

async function postBatch(tenantClient, tenantId, { documentType, documentId, batchDate, narration, lines, userId, productCompanyId = null }) {
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, batch_date: batchDate, narration, created_by: userId })
        .select().single();
    if (error) throw error;
    const rows = lines.map(l => ({ tenant_id: tenantId, batch_id: batch.id, ledger_account_id: l.ledgerId, sub_ledger_id: l.subLedgerId || null, product_company_id: l.productCompanyId || productCompanyId || null, debit_amount: l.debit || 0, credit_amount: l.credit || 0, narration: l.narration || narration }));
    const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
    if (lineErr) throw lineErr;
    return batch;
}

async function reverseBatch(tenantClient, documentType, documentId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', documentType).eq('document_id', documentId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

// FEATURE: GRN posted (status -> 'received') - Dr the GRN's own Goods
// Account (stock value in), Cr the tenant's configured GRN Clearing
// account (a provisional liability until the real Bill shows up).
// Silently does nothing if either ledger isn't configured, so tenants
// who don't want formal GR/IR clearing simply see no GL entries.
const { purchaseVatByLedger } = require('./vatLedger');
const { splitByAccount } = require('./accountResolver');

// Goods side of every purchase posting is split PER LINE by account:
// Product's Purchase Account -> the document's Goods Account -> System
// Control default (utils/accountResolver). Returns null when some line
// resolves to no ledger (the posting is then skipped, as before when no
// Goods Account was set).
async function goodsSplit(tenantClient, tenantId, doc, detailTable, fk, netTotal, opts = {}) {
    const { data: lines } = await tenantClient.from(detailTable).select('product_id, amount, tax_amount').eq(fk, doc.id);
    const src = opts.includeLineTax ? (lines || []).map(l => ({ ...l, tax_amount: 0 })) : (lines || []);
    const parts = await splitByAccount(tenantClient, tenantId, 'purchase', doc, src, netTotal, opts);
    return parts.some(p => !p.ledgerId) ? null : parts;
}
// A split part as a GL line on the given side (a negative amount - e.g. a
// document-level discount - flips to the other side).
const asLine = (p, side) => (side === 'debit') === (p.amount > 0)
    ? { ledgerId: p.ledgerId, subLedgerId: p.subLedgerId, debit: Math.abs(p.amount) }
    : { ledgerId: p.ledgerId, subLedgerId: p.subLedgerId, credit: Math.abs(p.amount) };
const sum2 = parts => Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100;

async function postGrnReceiptEntry(tenantClient, tenantId, grn, userId) {
    const clearingLedgerId = await getGrnClearingLedgerId(tenantClient, tenantId);
    if (!clearingLedgerId || !grn.total_amount) return;
    // Goods come in VAT-inclusive at GRN time; the Bill later moves the VAT out.
    const parts = await goodsSplit(tenantClient, tenantId, grn, 'purchase_grn_details', 'grn_id', Number(grn.total_amount), { includeLineTax: true });
    if (!parts) return;
    await postBatch(tenantClient, tenantId, {
        productCompanyId: grn.product_company_id || null,
        documentType: 'purchase_grn', documentId: grn.id, batchDate: grn.doc_date,
        narration: `GRN ${grn.doc_no} received - goods in, pending Bill`, userId,
        lines: [...parts.map(p => asLine(p, 'debit')), { ledgerId: clearingLedgerId, credit: grn.total_amount }]
    });
}

// FEATURE: Bill posted - if it traces back to a GRN, clear that GRN's
// provisional liability (Dr GRN Clearing) and book the REAL payable to
// the vendor (Cr Vendor), moving the VAT out of the goods accounts the GRN
// debited. A Bill with no GRN lineage books goods (VAT-exclusive, per line
// account) + VAT directly against the vendor.
async function postBillPayableEntry(tenantClient, tenantId, bill, userId) {
    if (!bill.vendor_ledger_id || !bill.total_amount) return;
    const total = Math.round(Number(bill.total_amount) * 100) / 100;
    const vatParts = await purchaseVatByLedger(tenantClient, tenantId, 'purchase_bill', bill.id);
    let vatTotal = sum2(vatParts);
    const useVat = vatTotal > 0 && vatTotal < total;
    if (!useVat) vatTotal = 0;
    const vendorLine = { ledgerId: bill.vendor_ledger_id, subLedgerId: bill.vendor_sub_ledger_id || null, credit: total };

    if (bill.source_grn_id) {
        const clearingLedgerId = await getGrnClearingLedgerId(tenantClient, tenantId);
        if (!clearingLedgerId) return;
        let reclass = [];
        if (useVat) {
            // Take each line's VAT back out of the goods account that line was
            // debited to at GRN time; term VAT out of the document-level account.
            const { data: grn } = await tenantClient.from('purchase_grns').select('goods_account_ledger_id, goods_sub_ledger_id').eq('id', bill.source_grn_id).maybeSingle();
            const docForVat = bill.goods_account_ledger_id
                ? { id: bill.id, goods_account_ledger_id: bill.goods_account_ledger_id, goods_sub_ledger_id: bill.goods_sub_ledger_id }
                : { id: bill.id, goods_account_ledger_id: grn?.goods_account_ledger_id, goods_sub_ledger_id: grn?.goods_sub_ledger_id };
            const taxAsBase = await vatPerLine(tenantClient, tenantId, bill.id);
            const goodsOut = await splitByAccount(tenantClient, tenantId, 'purchase', docForVat, taxAsBase, vatTotal);
            if (!goodsOut.some(p => !p.ledgerId)) reclass = [...vatParts.map(p => ({ ledgerId: p.ledgerId, subLedgerId: p.subLedgerId, debit: p.amount })), ...goodsOut.map(p => asLine(p, 'credit'))];
        }
        await postBatch(tenantClient, tenantId, {
            productCompanyId: bill.product_company_id || null,
            documentType: 'purchase_bill', documentId: bill.id, batchDate: bill.doc_date,
            narration: `Bill ${bill.doc_no} posted - clears GRN provision, books real payable`, userId,
            lines: [{ ledgerId: clearingLedgerId, debit: total }, vendorLine, ...reclass]
        });
        return;
    }

    const goodsParts = await goodsSplit(tenantClient, tenantId, bill, 'purchase_bill_details', 'bill_id', total - vatTotal);
    if (!goodsParts) return;
    await postBatch(tenantClient, tenantId, {
        productCompanyId: bill.product_company_id || null,
        documentType: 'purchase_bill', documentId: bill.id, batchDate: bill.doc_date,
        narration: `Bill ${bill.doc_no} posted - direct purchase, no prior GRN`, userId,
        lines: [
            ...goodsParts.map(p => asLine(p, 'debit')),
            ...(useVat ? vatParts.map(p => ({ ledgerId: p.ledgerId, subLedgerId: p.subLedgerId, debit: p.amount })) : []),
            vendorLine
        ]
    });
}

// Each bill line's share of the VAT, so the GRN-sourced reclass takes VAT
// out of the SAME goods account the line was debited to: line tax +
// line-level VAT terms (by detail_id) + document-level VAT terms spread
// by line value. Shaped as split "lines" (amount = that VAT, tax 0).
async function vatPerLine(tenantClient, tenantId, billId) {
    const { data: lines } = await tenantClient.from('purchase_bill_details').select('id, product_id, amount, tax_amount').eq('bill_id', billId);
    const { data: vatTerms } = await tenantClient.from('billing_terms').select('id').eq('tenant_id', tenantId).eq('tax_type', 'vat');
    const ids = (vatTerms || []).map(t => t.id);
    const perLine = Object.fromEntries((lines || []).map(l => [l.id, Number(l.tax_amount || 0)]));
    if (ids.length) {
        const { data: lt } = await tenantClient.from('document_line_billing_terms').select('detail_id, computed_amount').eq('document_type', 'purchase_bill').eq('document_id', billId).in('billing_term_id', ids);
        (lt || []).forEach(r => { if (r.detail_id in perLine) perLine[r.detail_id] += Number(r.computed_amount || 0); });
        const { data: dt } = await tenantClient.from('document_billing_terms').select('computed_amount').eq('document_type', 'purchase_bill').eq('document_id', billId).in('billing_term_id', ids);
        const docVat = (dt || []).reduce((s, r) => s + Number(r.computed_amount || 0), 0);
        const base = (lines || []).reduce((s, l) => s + Math.abs(Number(l.amount || 0)), 0);
        if (docVat && base) (lines || []).forEach(l => { perLine[l.id] += docVat * Math.abs(Number(l.amount || 0)) / base; });
    }
    return (lines || []).map(l => ({ product_id: l.product_id, amount: Math.round(perLine[l.id] * 100) / 100, tax_amount: 0 }));
}

// FEATURE: Purchase Return posted - the mirror of a Purchase Bill:
// Dr Vendor, Cr goods per line (Product's Purchase Account -> the return's
// Goods Account -> System's Purchase Return Account -> Purchase Account)
// for the VAT-exclusive part, Cr each VAT ledger for the VAT. Skipped for a
// cash vendor (no vendor ledger) - same rule the Bill follows.
async function postPurchaseReturnEntry(tenantClient, tenantId, ret, userId) {
    if (!ret.vendor_ledger_id || !(Number(ret.total_amount) > 0)) return false;
    const amount = Math.round(Number(ret.total_amount) * 100) / 100;
    const vatParts = await purchaseVatByLedger(tenantClient, tenantId, 'purchase_return', ret.id);
    let vat = sum2(vatParts);
    const splitVat = vat > 0 && vat < amount;
    if (!splitVat) vat = 0;
    const goodsParts = await goodsSplit(tenantClient, tenantId, ret, 'purchase_return_details', 'return_id', amount - vat, { isReturn: true });
    if (!goodsParts) return false;
    await postBatch(tenantClient, tenantId, {
        productCompanyId: ret.product_company_id || null,
        documentType: 'purchase_return', documentId: ret.id, batchDate: ret.doc_date,
        narration: `Purchase Return ${ret.doc_no}`, userId,
        lines: [
            { ledgerId: ret.vendor_ledger_id, subLedgerId: ret.vendor_sub_ledger_id || null, debit: amount },
            ...goodsParts.map(p => asLine(p, 'credit')),
            ...(splitVat ? vatParts.map(p => ({ ledgerId: p.ledgerId, subLedgerId: p.subLedgerId, credit: p.amount })) : [])
        ]
    });
    return true;
}

// FEATURE: Purchase Additional Expense posted - Dr each expense line's
// own ledger ("add" lines), Cr it for "deduct" lines, and the NET goes
// to the vendor (Cr when we owe them, Dr in the unusual all-deduction
// case). Built from the lines themselves so the batch is always
// balanced, never from a header total that could drift. Skipped for a
// cash vendor (no vendor ledger), same as the Bill.
async function postAdditionalExpenseEntry(tenantClient, tenantId, exp, lines, userId) {
    if (!exp.vendor_ledger_id) return false;
    const round2 = n => Math.round(n * 100) / 100;
    const glLines = [];
    let net = 0;
    for (const l of (lines || [])) {
        const amt = round2(Number(l.amount) || 0);
        if (!l.expense_ledger_id || amt <= 0) continue;
        if (l.entry_sign === 'deduct') { glLines.push({ ledgerId: l.expense_ledger_id, credit: amt, narration: l.description || undefined }); net -= amt; }
        else { glLines.push({ ledgerId: l.expense_ledger_id, debit: amt, narration: l.description || undefined }); net += amt; }
    }
    net = round2(net);
    if (glLines.length === 0 || net === 0) return false;
    glLines.push(net > 0 ? { ledgerId: exp.vendor_ledger_id, subLedgerId: exp.vendor_sub_ledger_id || null, credit: net } : { ledgerId: exp.vendor_ledger_id, subLedgerId: exp.vendor_sub_ledger_id || null, debit: -net });
    await postBatch(tenantClient, tenantId, {
        productCompanyId: exp.product_company_id || null,
        documentType: 'purchase_additional_expense', documentId: exp.id, batchDate: exp.doc_date,
        narration: `Additional Expense ${exp.doc_no}`, userId, lines: glLines
    });
    return true;
}

module.exports = { postGrnReceiptEntry, postBillPayableEntry, postPurchaseReturnEntry, postAdditionalExpenseEntry, reverseBatch, getGrnClearingLedgerId };
