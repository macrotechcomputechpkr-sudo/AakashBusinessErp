// =============================================
// utils/landedCost.js
// Purchase Additional Expense (freight, customs, insurance ...) -> stock value.
//
// The expense entry allocates its costing lines over the source document's
// product lines (purchase_expense_allocations) and posts Dr expense / Cr
// party. Stock is PERIODIC (see utils/stockAccounting.js): the statements
// value closing stock from stock_movements, so unless the allocated amount
// also reaches the stock valuation, the whole expense is charged to cost of
// goods sold even while the goods are still on hand.
//
// This helper turns POSTED allocations into an extra cost per BASE unit on
// the receipt that brought the goods in (the GRN line, or the direct Bill
// line). The stock loaders add it to that receipt's unit cost, so every
// valuation method, the Stock Movement / Stock Report, the financial
// statements' closing stock and cost-of-sales rates all carry the landed
// cost:
//   closing stock  += share of the allocation still on hand
//   COGS            = opening + purchases (incl. the expense) - closing
// Only allocations of entries dated on or before `to` count, so the
// Balance Sheet / P&L on an earlier date is unchanged.
//
// Mapping an allocation to the receipt:
//   GRN line                     -> that GRN line
//   Bill line from a GRN line    -> that GRN line (the GRN moved the stock)
//   direct Bill line             -> that Bill line
//   Order line                   -> the GRN lines / direct Bill lines made
//                                   from it, split by received qty (none
//                                   yet received -> nothing moves yet)
// =============================================

const CHUNK = 200;
const RECEIPT_SOURCES = ['purchase_grn', 'purchase_bill'];

async function inChunks(ids, run) {
    const out = [];
    for (let i = 0; i < ids.length; i += CHUNK) out.push(...await run(ids.slice(i, i + CHUNK)));
    return out;
}

// { receiptDetailId: extra cost per base unit }  (receiptDetailId = stock_movements.source_detail_id
// of a purchase_grn / purchase_bill movement)
async function landedCostPerUnit(c, t, to) {
    let q = c.from('purchase_additional_expenses').select('id').eq('tenant_id', t).eq('status', 'posted');
    if (to) q = q.lte('doc_date', to);
    const { data: exps, error } = await q;
    if (error) throw error;
    if (!exps || !exps.length) return {};

    const allocs = await inChunks(exps.map(e => e.id), async ids => {
        const { data, error: e } = await c.from('purchase_expense_allocations')
            .select('source_order_detail_id, source_grn_detail_id, source_bill_detail_id, allocated_amount').in('expense_id', ids);
        if (e) throw e;
        return data || [];
    });
    const live = allocs.filter(a => Math.abs(Number(a.allocated_amount) || 0) > 0.0001);
    if (!live.length) return {};

    // Bill lines: from a GRN line, or a direct purchase.
    const billIds = [...new Set(live.map(a => a.source_bill_detail_id).filter(Boolean))];
    const billGrn = {};
    (await inChunks(billIds, async ids => {
        const { data, error: e } = await c.from('purchase_bill_details').select('id, source_grn_detail_id').in('id', ids);
        if (e) throw e;
        return data || [];
    })).forEach(d => { billGrn[d.id] = d.source_grn_detail_id || null; });

    // Order lines: the GRN lines and direct Bill lines received against them.
    const orderIds = [...new Set(live.filter(a => a.source_order_detail_id && !a.source_grn_detail_id && !a.source_bill_detail_id).map(a => a.source_order_detail_id))];
    const fromOrder = {};
    if (orderIds.length) {
        const [grnLines, billLines] = await Promise.all([
            inChunks(orderIds, async ids => {
                const { data, error: e } = await c.from('purchase_grn_details').select('id, source_order_detail_id').in('source_order_detail_id', ids);
                if (e) throw e;
                return data || [];
            }),
            inChunks(orderIds, async ids => {
                const { data, error: e } = await c.from('purchase_bill_details').select('id, source_order_detail_id, source_grn_detail_id').in('source_order_detail_id', ids);
                if (e) throw e;
                return data || [];
            })
        ]);
        grnLines.forEach(d => (fromOrder[d.source_order_detail_id] = fromOrder[d.source_order_detail_id] || []).push(d.id));
        billLines.filter(d => !d.source_grn_detail_id).forEach(d => (fromOrder[d.source_order_detail_id] = fromOrder[d.source_order_detail_id] || []).push(d.id));
    }

    // amount per allocation -> receipt line(s)
    const targets = live.map(a => {
        const amount = Number(a.allocated_amount) || 0;
        if (a.source_grn_detail_id) return { amount, receipts: [a.source_grn_detail_id] };
        if (a.source_bill_detail_id) return { amount, receipts: [billGrn[a.source_bill_detail_id] || a.source_bill_detail_id] };
        if (a.source_order_detail_id) return { amount, receipts: fromOrder[a.source_order_detail_id] || [] };
        return { amount, receipts: [] };
    }).filter(x => x.receipts.length);
    if (!targets.length) return {};

    // Received base qty of every receipt line (only receipts dated on or before `to`).
    const receiptIds = [...new Set(targets.flatMap(x => x.receipts))];
    const qtyOf = {};
    (await inChunks(receiptIds, async ids => {
        let mq = c.from('stock_movements').select('source_detail_id, qty_in').eq('tenant_id', t).in('source_type', RECEIPT_SOURCES).in('source_detail_id', ids);
        if (to) mq = mq.lte('movement_date', to);
        const { data, error: e } = await mq;
        if (e) throw e;
        return data || [];
    })).forEach(m => { qtyOf[m.source_detail_id] = (qtyOf[m.source_detail_id] || 0) + (Number(m.qty_in) || 0); });

    const extra = {};
    targets.forEach(({ amount, receipts }) => {
        const got = receipts.filter(r => qtyOf[r] > 1e-9);
        const total = got.reduce((s, r) => s + qtyOf[r], 0);
        if (!(total > 1e-9)) return;                            // nothing received yet: stays in expense
        got.forEach(r => { extra[r] = (extra[r] || 0) + amount / total; });   // same cost per unit on every receipt of it
    });
    return extra;
}

// Unit cost of a stock movement with its landed cost added.
function withLanded(extra, m) {
    const base = Number(m.unit_cost) || 0;
    if (!extra || !m.source_detail_id || !RECEIPT_SOURCES.includes(m.source_type) || !(Number(m.qty_in) > 0)) return base;
    return base + (extra[m.source_detail_id] || 0);
}

module.exports = { landedCostPerUnit, withLanded };
