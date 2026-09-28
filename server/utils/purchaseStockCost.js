// =============================================
// utils/purchaseStockCost.js
// What a purchase puts into stock, so the stock value and the purchase
// account always agree (Purchase vs Stock reconciliation):
//
//   lineUnitCosts   the cost of one base unit of each GRN / direct Bill line
//                   = the line's share of the document's goods value without
//                   VAT (total - VAT, the same figure the purchase / goods
//                   account is debited with: after discount, with product-wise
//                   and document-level non-VAT terms) / its qty in base units.
//                   Before, the entry rate was used as the base-unit cost, so a
//                   line in boxes (1 box = 12 pcs) was valued 12 times over and
//                   discounts / terms never reached the stock value.
//
//   refreshLandedCost  Additional expense (freight, duty, insurance ...)
//                   allocated to purchase lines (purchase_expense_allocations)
//                   is added to the cost of the stock receipt of that line:
//                     unit_cost = base_unit_cost + posted landed cost / qty in
//                   Allocations to an Order line reach the GRN / Bill lines made
//                   from it (split by qty); to a Bill line made from a GRN, the
//                   GRN receipt. Only POSTED expenses count, so posting or
//                   cancelling an expense (or re-posting the GRN / Bill) moves the
//                   stock value with it. base_unit_cost keeps the cost without
//                   landed cost (migration 145).
// =============================================

const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/**
 * details: the document's lines; baseQtyOf(detail) -> qty in base units (already worked out by the caller)
 * vatTotal: VAT on the document (line tax + VAT terms)
 * -> { [detailId]: unitCost } (null for a line with no qty)
 */
function lineUnitCosts(doc, details, baseQtyOf, vatTotal) {
    const total = Number(doc.total_amount) || 0;
    const vat = Number(vatTotal) || 0;
    const goods = vat > 0 && vat < total ? total - vat : total - details.reduce((s, d) => s + (Number(d.tax_amount) || 0), 0);
    const weight = d => {
        const base = (Number(d.amount) || 0) - (Number(d.tax_amount) || 0);
        return base > 0 ? base : (Number(d.rate) || 0) * (Number(d.qty) || 0);
    };
    const sumW = details.reduce((s, d) => s + weight(d), 0);
    const out = {};
    details.forEach(d => {
        const q = Number(baseQtyOf(d)) || 0;
        if (!(q > 0)) { out[d.id] = null; return; }
        out[d.id] = sumW > 0 && goods > 0 ? round4((goods * weight(d) / sumW) / q) : null;
    });
    return out;
}

async function rowsIn(c, table, col, ids, select = '*') {
    const out = [];
    for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await c.from(table).select(select).in(col, ids.slice(i, i + 200));
        if (error) throw error;
        out.push(...(data || []));
    }
    return out;
}

/**
 * Recompute the landed cost of the stock receipts touched by these expenses
 * and / or these purchase lines.
 *   expenseIds   additional expense entries just posted / cancelled
 *   grnDetailIds / billDetailIds   lines whose stock receipt was just (re)written
 * Never throws: a failure is returned as { error } so a posting is not lost
 * (e.g. migration 145 not run yet).
 */
async function refreshLandedCost(c, t, { expenseIds = [], grnDetailIds = [], billDetailIds = [] } = {}) {
    try {
        // 1. the purchase lines in question
        const grnIds = new Set(grnDetailIds), billIds = new Set(billDetailIds), orderIds = new Set();
        if (expenseIds.length) {
            (await rowsIn(c, 'purchase_expense_allocations', 'expense_id', expenseIds, 'source_order_detail_id, source_grn_detail_id, source_bill_detail_id'))
                .forEach(a => { if (a.source_grn_detail_id) grnIds.add(a.source_grn_detail_id); else if (a.source_bill_detail_id) billIds.add(a.source_bill_detail_id); else if (a.source_order_detail_id) orderIds.add(a.source_order_detail_id); });
        }
        // order lines -> the GRN / Bill lines made from them
        if (orderIds.size) {
            (await rowsIn(c, 'purchase_grn_details', 'source_order_detail_id', [...orderIds], 'id')).forEach(d => grnIds.add(d.id));
            (await rowsIn(c, 'purchase_bill_details', 'source_order_detail_id', [...orderIds], 'id')).forEach(d => billIds.add(d.id));
        }
        const billLines = billIds.size ? await rowsIn(c, 'purchase_bill_details', 'id', [...billIds], 'id, source_grn_detail_id, source_order_detail_id') : [];
        billLines.forEach(b => { if (b.source_grn_detail_id) grnIds.add(b.source_grn_detail_id); });
        const grnLines = grnIds.size ? await rowsIn(c, 'purchase_grn_details', 'id', [...grnIds], 'id, source_order_detail_id') : [];
        // bill lines made from those GRN lines (their allocations land on the GRN receipt)
        if (grnIds.size) {
            const seen = new Set(billLines.map(b => b.id));
            (await rowsIn(c, 'purchase_bill_details', 'source_grn_detail_id', [...grnIds], 'id, source_grn_detail_id, source_order_detail_id'))
                .forEach(b => { if (!seen.has(b.id)) { seen.add(b.id); billLines.push(b); } });
        }

        // 2. their stock receipts
        const moves = [
            ...(grnIds.size ? (await rowsIn(c, 'stock_movements', 'source_detail_id', [...grnIds])).filter(m => m.source_type === 'purchase_grn') : []),
            ...(billIds.size ? (await rowsIn(c, 'stock_movements', 'source_detail_id', [...billIds])).filter(m => m.source_type === 'purchase_bill') : [])
        ].filter(m => m.tenant_id === t && Number(m.qty_in) > 0);
        if (!moves.length) return { updated: 0 };

        // 3. every posted allocation that lands on those receipts
        const orderOf = {};
        grnLines.forEach(g => { orderOf[`purchase_grn:${g.id}`] = g.source_order_detail_id || null; });
        billLines.forEach(b => { orderOf[`purchase_bill:${b.id}`] = b.source_order_detail_id || null; });
        const moveKey = m => `${m.source_type}:${m.source_detail_id}`;
        const grnOfBill = Object.fromEntries(billLines.filter(b => b.source_grn_detail_id).map(b => [b.id, b.source_grn_detail_id]));
        const billsOfGrn = {};
        billLines.filter(b => b.source_grn_detail_id).forEach(b => { (billsOfGrn[b.source_grn_detail_id] = billsOfGrn[b.source_grn_detail_id] || []).push(b.id); });
        const moveDetailIds = [...new Set(moves.map(m => m.source_detail_id))];
        const moveOrderIds = [...new Set(moves.map(m => orderOf[moveKey(m)]).filter(Boolean))];
        const extraBillIds = moves.filter(m => m.source_type === 'purchase_grn').flatMap(m => billsOfGrn[m.source_detail_id] || []);
        const allocs = [
            ...await rowsIn(c, 'purchase_expense_allocations', 'source_grn_detail_id', moveDetailIds),
            ...await rowsIn(c, 'purchase_expense_allocations', 'source_bill_detail_id', [...new Set([...moveDetailIds, ...extraBillIds])]),
            ...(moveOrderIds.length ? await rowsIn(c, 'purchase_expense_allocations', 'source_order_detail_id', moveOrderIds) : [])
        ];
        const uniq = new Map(allocs.map(a => [a.id, a]));
        const expIds = [...new Set([...uniq.values()].map(a => a.expense_id))];
        const posted = new Set((expIds.length ? await rowsIn(c, 'purchase_additional_expenses', 'id', expIds, 'id, status') : []).filter(e => e.status === 'posted').map(e => e.id));

        // 4. landed cost per receipt
        const landed = {};
        const put = (m, amt) => { landed[m.id] = (landed[m.id] || 0) + amt; };
        const byKey = {};
        moves.forEach(m => { byKey[moveKey(m)] = m; });
        const byOrder = {};
        moves.forEach(m => { const o = orderOf[moveKey(m)]; if (o) (byOrder[o] = byOrder[o] || []).push(m); });
        [...uniq.values()].filter(a => posted.has(a.expense_id)).forEach(a => {
            const amt = Number(a.allocated_amount) || 0;
            if (!amt) return;
            if (a.source_grn_detail_id) { const m = byKey[`purchase_grn:${a.source_grn_detail_id}`]; if (m) put(m, amt); return; }
            if (a.source_bill_detail_id) {
                const g = grnOfBill[a.source_bill_detail_id];
                const m = g ? byKey[`purchase_grn:${g}`] : byKey[`purchase_bill:${a.source_bill_detail_id}`];
                if (m) put(m, amt);
                return;
            }
            const list = byOrder[a.source_order_detail_id] || [];
            const q = list.reduce((s, m) => s + Number(m.qty_in), 0);
            list.forEach(m => put(m, q ? amt * Number(m.qty_in) / q : 0));
        });

        // 5. write back: unit_cost = base + landed / qty
        let updated = 0;
        for (const m of moves) {
            const base = m.base_unit_cost !== null && m.base_unit_cost !== undefined ? Number(m.base_unit_cost) : Number(m.unit_cost) || 0;
            const next = round4(base + (landed[m.id] || 0) / Number(m.qty_in));
            if (Math.abs(next - Number(m.unit_cost || 0)) < 0.00005 && m.base_unit_cost !== null && m.base_unit_cost !== undefined) continue;
            const { error } = await c.from('stock_movements').update({ unit_cost: next, base_unit_cost: base }).eq('id', m.id);
            if (error) throw error;
            updated++;
        }
        return { updated, landed: Object.fromEntries(Object.entries(landed).map(([k, v]) => [k, round2(v)])) };
    } catch (error) {
        return { error: error.message || String(error) };
    }
}

module.exports = { lineUnitCosts, refreshLandedCost };
