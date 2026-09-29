// =============================================
// routes/purchaseAdditionalExpenseRoutes.js
// Extra costs (freight, customs duty, insurance, etc.) linked to the
// purchase bill (Ref. Bill No.; older entries may carry an Order / GRN), automatically allocated across that
// document's product lines for landed cost - by Value share, Qty
// share, or an Equal split. Once posted, the allocation is written into the
// cost of those receipts' stock movements (purchaseStockCost.refreshLandedCost),
// so stock valuation, batch / serial costing and profitability carry it.
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const { checkProductCompany } = require('../utils/productCompanyRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { postAdditionalExpenseEntry, buildAdditionalExpenseGl, reverseBatch } = require('../utils/grnAccounting');
const { refreshLandedCost } = require('../utils/purchaseStockCost');
const { classifyLedgers, describe: describeLedger } = require('../utils/stockAccounting');

// The bill type follows what was typed - no need to pick it: VAT on the line = taxable bill,
// a supplier bill no without VAT = non-taxable (tax-free) bill, neither = no bill (wages, loading ...).
// A TDS / "−" line never has a bill of its own. Lines of one party + bill no form one bill.
function billTypeOf(l) {
    if (l.is_tds || l.entry_sign === 'deduct') return 'no_bill';
    if (Number(l.vat_amount) > 0) return 'taxable';
    return String(l.party_bill_no || '').trim() ? 'non_taxable' : 'no_bill';
}
const withBillType = l => (l.bill_type ? l : { ...l, bill_type: billTypeOf(l) });

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!b.source_order_id && !b.source_grn_id && !b.source_bill_id) return 'Link this to at least one Order, GRN, or Bill';
    if (!Array.isArray(b.expense_lines) || b.expense_lines.length === 0) return 'At least one expense line is required';
    for (const l of b.expense_lines) {
        if (!l.expense_ledger_id && !l.billing_term_id) return 'Every expense line needs a Term or a Ledger';
        if (!l.amount || Number(l.amount) <= 0) return 'Every expense line needs an amount greater than zero';
        if (l.allocation_basis && !['value_wise', 'qty_wise', 'equal', 'none'].includes(l.allocation_basis)) return 'Invalid allocation basis on an expense line';
        if (l.entry_sign && !['add', 'deduct'].includes(l.entry_sign)) return 'Invalid sign on an expense line';
        const n = b.expense_lines.indexOf(l) + 1;
        if (l.is_tds && (l.bill_type || billTypeOf(l)) !== 'no_bill') return `Line ${n}: a TDS line has no bill of its own (bill type: No Bill)`;
        const bt = l.bill_type || billTypeOf(l);
        if (!['taxable', 'non_taxable', 'no_bill'].includes(bt)) return `Line ${n}: invalid bill type`;
        if (bt !== 'taxable' && Number(l.vat_amount) > 0) return `Line ${n}: VAT is only for a taxable bill`;
        if (Number(l.vat_amount) < 0) return `Line ${n}: VAT cannot be negative`;
        if (bt !== 'no_bill' && !l.party_ledger_id && !b.vendor_ledger_id) return `Line ${n}: a ${bt === 'taxable' ? 'taxable' : 'non-taxable'} bill needs its supplier (line party or the entry's vendor)`;
        if (bt !== 'no_bill' && !String(l.party_bill_no || '').trim()) return `Line ${n}: enter the supplier's bill no`;
        if (bt === 'taxable' && !(Number(l.vat_amount) > 0)) return `Line ${n}: a taxable bill needs its VAT amount`;
    }
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.vendor_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.vendor_ledger_id).maybeSingle(),
        b.agent_id && tenantClient.from('salesman_agents').select('agent_name').eq('id', b.agent_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle()
    ];
    const [vendor, agent, costCenter, businessUnit] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        vendor_name_snapshot: vendor.data?.account_name || null,
        agent_name_snapshot: agent.data?.agent_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

// FEATURE: fetches the source document's own product lines (whichever
// of Order/GRN/Bill was linked - GRN wins if more than one is given,
// since it's the most physically-grounded "what actually arrived"
// stage) so the frontend can preview the allocation before saving.
// Value share is on the goods' own cost (net of VAT): a line with VAT would
// otherwise take more of the expense than a VAT-exempt line of the same value.
const netValue = d => (Number(d.amount) || 0) - (Number(d.tax_amount) || 0);
async function getSourceLines(tenantClient, { source_order_id, source_grn_id, source_bill_id }) {
    if (source_grn_id) {
        const { data } = await tenantClient.from('purchase_grn_details').select('id, product_id, product_name_snapshot, qty, alt_qty, amount, tax_amount').eq('grn_id', source_grn_id);
        return (data || []).map(d => ({ source_grn_detail_id: d.id, product_id: d.product_id, product_name_snapshot: d.product_name_snapshot, qty: Number(d.qty), alt_qty: Number(d.alt_qty) || 0, value: netValue(d) }));
    }
    if (source_bill_id) {
        const { data } = await tenantClient.from('purchase_bill_details').select('id, product_id, product_name_snapshot, qty, alt_qty, amount, tax_amount').eq('bill_id', source_bill_id);
        return (data || []).map(d => ({ source_bill_detail_id: d.id, product_id: d.product_id, product_name_snapshot: d.product_name_snapshot, qty: Number(d.qty), alt_qty: Number(d.alt_qty) || 0, value: netValue(d) }));
    }
    if (source_order_id) {
        const { data } = await tenantClient.from('purchase_order_details').select('id, product_id, product_name_snapshot, qty, amount, tax_amount').eq('order_id', source_order_id);
        return (data || []).map(d => ({ source_order_detail_id: d.id, product_id: d.product_id, product_name_snapshot: d.product_name_snapshot, qty: Number(d.qty), value: netValue(d) }));
    }
    return [];
}

// FEATURE: the actual allocation math, run PER LINE (each expense line
// carries its own basis and sign - converged independently with what
// several accounting packages do, though each calls it something
// different: Value/Qty/Equal split, only ever touching lines whose
// basis isn't 'none' since a withholding-tax line is real money moved
// but never part of inventory cost). Every line's signed amount is
// distributed across the source products by THAT line's own basis,
// then every product's shares across all lines are summed for its
// final landed-cost addition.
function computeLineShare(sourceLines, signedAmount, basis) {
    const totalValue = sourceLines.reduce((s, l) => s + l.value, 0);
    const totalQty = sourceLines.reduce((s, l) => s + l.qty, 0);
    const n = sourceLines.length || 1;
    return sourceLines.map(l => {
        let share;
        if (basis === 'value_wise') share = totalValue === 0 ? 0 : signedAmount * (l.value / totalValue);
        else if (basis === 'qty_wise') share = totalQty === 0 ? 0 : signedAmount * (l.qty / totalQty);
        else share = signedAmount / n;
        return Math.round(share * 100) / 100;
    });
}

// the source line a product-wise term belongs to (its Order / GRN / Bill detail id)
const detailIdOf = l => l.source_grn_detail_id || l.source_bill_detail_id || l.source_order_detail_id || null;

function computeAllocations(sourceLines, expenseLines) {
    const totals = sourceLines.map(() => 0);
    for (const line of expenseLines) {
        if (line.allocation_basis === 'none' || line.is_tds) continue;   // TDS is withheld tax, never part of the goods cost
        // costing: the line's amount, plus its VAT when that VAT cannot be claimed (vat_in_cost)
        const signedAmount = (line.entry_sign === 'deduct' ? -1 : 1) * (Number(line.amount) + (line.vat_in_cost ? Number(line.vat_amount) || 0 : 0));
        // product-wise term: the whole amount goes to that product's line only
        const target = line.target_detail_id ? sourceLines.findIndex(l => detailIdOf(l) === line.target_detail_id) : -1;
        if (target >= 0) { totals[target] += Math.round(signedAmount * 100) / 100; continue; }
        // bill-wise term: split over the bill's products by the line's basis (value / qty / equal)
        const shares = computeLineShare(sourceLines, signedAmount, line.allocation_basis);
        shares.forEach((share, i) => { totals[i] += share; });
    }
    return sourceLines.map((l, i) => ({
        ...l,
        allocated_amount: Math.round(totals[i] * 100) / 100,
        landed_cost_per_unit: l.qty === 0 ? 0 : Math.round((totals[i] / l.qty) * 10000) / 10000
    }));
}

// A line with a billing term: the term's ledger is the line ledger (fixed -
// only its sub-ledger may change), a term kept out of costing is never
// allocated, and the term's profitability flag is kept on the line.
async function applyTermRules(tenantClient, tenantId, expenseLines) {
    const ids = [...new Set((expenseLines || []).map(l => l.billing_term_id).filter(Boolean))];
    if (!ids.length) return expenseLines || [];
    const { data } = await tenantClient.from('billing_terms').select('id, term_name, billing_ledger_id, sub_ledger_id, include_in_costing, include_in_profitability, applicable_additional_expense')
        .eq('tenant_id', tenantId).in('id', ids);
    const byId = Object.fromEntries((data || []).map(t => [t.id, t]));
    return expenseLines.map((l, i) => {
        const t = byId[l.billing_term_id];
        if (!l.billing_term_id) return l;
        if (!t) throw new Error(`Line ${i + 1}: the billing term was not found`);
        const n = { ...l, include_in_profitability: !!t.include_in_profitability };
        if (t.billing_ledger_id) {
            // a sub-ledger of another ledger does not belong here: back to the term's default
            if (n.expense_ledger_id && n.expense_ledger_id !== t.billing_ledger_id) n.expense_sub_ledger_id = undefined;
            n.expense_ledger_id = t.billing_ledger_id;
        }
        if (!n.expense_ledger_id) throw new Error(`Line ${i + 1}: the term "${t.term_name}" has no ledger - set its Billing Ledger in Billing Terms`);
        // not sent = the term's default sub-ledger; '' = none chosen
        n.expense_sub_ledger_id = n.expense_sub_ledger_id === undefined ? (t.sub_ledger_id || null) : (n.expense_sub_ledger_id || null);
        if (t.include_in_costing === false) n.allocation_basis = 'none';
        if (!n.description) n.description = t.term_name;
        return n;
    });
}

// FEATURE: what's actually owed to the expense provider - every '+'
// line adds, every '-' line (a TDS/withholding deduction is the
// standard case) subtracts. This is the number that becomes the
// document's own total_amount / payable, independent of how much of it
// ends up allocated to landed cost.
function computeNetPayable(expenseLines) {
    return Math.round(expenseLines.reduce((s, l) => s + (l.entry_sign === 'deduct' ? -Number(l.amount) : Number(l.amount) + (Number(l.vat_amount) || 0)), 0) * 100) / 100;
}

async function syncExpenseLines(tenantClient, tenantId, expenseId, expenseLines) {
    await tenantClient.from('purchase_additional_expense_lines').delete().eq('expense_id', expenseId);
    if (!Array.isArray(expenseLines) || expenseLines.length === 0) return { netPayable: 0, lines: [] };
    expenseLines = await applyTermRules(tenantClient, tenantId, expenseLines.map(withBillType));
    const partyIds = [...new Set(expenseLines.map(l => l.party_ledger_id).filter(Boolean))];
    const { data: parties } = partyIds.length ? await tenantClient.from('ledger_accounts').select('id, account_name, pan_number, vat_pan_number').in('id', partyIds) : { data: [] };
    const partyById = Object.fromEntries((parties || []).map(x => [x.id, x]));
    const rows = expenseLines.map((l, i) => {
        const bt = l.bill_type || 'no_bill', party = partyById[l.party_ledger_id];
        return {
            tenant_id: tenantId, expense_id: expenseId, display_order: i + 1,
            expense_ledger_id: l.expense_ledger_id, description: l.description || null,
            billing_term_id: l.billing_term_id || null, expense_sub_ledger_id: l.expense_sub_ledger_id || null,
            target_detail_id: l.target_detail_id || null, include_in_profitability: !!l.include_in_profitability,
            // a TDS line is a deduction from the party, credited to the TDS payable ledger, never costed
            allocation_basis: l.is_tds ? 'none' : l.allocation_basis || 'value_wise', entry_sign: l.is_tds ? 'deduct' : l.entry_sign || 'add', is_tds: !!l.is_tds,
            rate_percent: l.rate_percent || null, amount: Number(l.amount) || 0,
            party_ledger_id: l.party_ledger_id || null, party_sub_ledger_id: l.party_sub_ledger_id || null,
            party_name_snapshot: party?.account_name || l.party_name_snapshot || null, party_pan: l.party_pan || party?.vat_pan_number || party?.pan_number || null,
            bill_type: bt, party_bill_no: bt === 'no_bill' ? (l.party_bill_no || null) : String(l.party_bill_no).trim(), party_bill_date: l.party_bill_date || null,
            vat_percent: bt === 'taxable' ? (l.vat_percent === '' || l.vat_percent === undefined ? null : Number(l.vat_percent)) : null,
            vat_amount: bt === 'taxable' ? Math.round((Number(l.vat_amount) || 0) * 100) / 100 : 0,
            vat_ledger_id: bt === 'taxable' ? l.vat_ledger_id || null : null, vat_in_cost: bt === 'taxable' && !!l.vat_in_cost
        };
    });
    const { error } = await tenantClient.from('purchase_additional_expense_lines').insert(rows);
    if (error) throw error;
    return { netPayable: computeNetPayable(rows), lines: rows };
}

// Customs (Bhansar) rows of an import: pragyapan patra, values, VAT paid at customs
const cleanCustoms = rows => (Array.isArray(rows) ? rows : []).filter(r => Number(r.vat_amount) > 0 || Number(r.taxable_amount) > 0 || Number(r.assessable_value) > 0 || Number(r.non_taxable_amount) > 0);
const customsVat = rows => Math.round(cleanCustoms(rows).reduce((s, r) => s + (Number(r.vat_amount) || 0), 0) * 100) / 100;
function validateCustoms(rows) {
    for (const [i, r] of cleanCustoms(rows).entries()) {
        if (!String(r.pragyapan_no || '').trim()) return `Customs row ${i + 1}: enter the Pragyapan Patra No`;
        if (Number(r.vat_amount) < 0) return `Customs row ${i + 1}: VAT cannot be negative`;
        if (Number(r.vat_amount) > 0 && !(Number(r.taxable_amount) > 0)) return `Customs row ${i + 1}: enter the taxable (VAT-able) value`;
    }
    return null;
}
async function syncCustoms(tenantClient, tenantId, expenseId, rows) {
    await tenantClient.from('purchase_additional_customs').delete().eq('expense_id', expenseId);
    const list = cleanCustoms(rows);
    if (!list.length) return [];
    const n = v => Math.round((Number(v) || 0) * 100) / 100;
    const out = list.map((r, i) => ({ tenant_id: tenantId, expense_id: expenseId, display_order: i + 1, pragyapan_no: String(r.pragyapan_no || '').trim() || null, pragyapan_date: r.pragyapan_date || null,
        customs_office: r.customs_office || null, paid_ledger_id: r.paid_ledger_id || null, paid_sub_ledger_id: r.paid_sub_ledger_id || null,
        assessable_value: n(r.assessable_value), taxable_amount: n(r.taxable_amount), non_taxable_amount: n(r.non_taxable_amount),
        vat_percent: r.vat_percent === '' || r.vat_percent == null ? null : Number(r.vat_percent), vat_amount: n(r.vat_amount), vat_ledger_id: r.vat_ledger_id || null }));
    const { error } = await tenantClient.from('purchase_additional_customs').insert(out);
    if (error) throw error;
    return out;
}

async function syncAllocations(tenantClient, tenantId, expenseId, b, expenseLines) {
    await tenantClient.from('purchase_expense_allocations').delete().eq('expense_id', expenseId);
    const sourceLines = await getSourceLines(tenantClient, b);
    if (sourceLines.length === 0) return;
    const allocated = computeAllocations(sourceLines, expenseLines);
    const rows = allocated.map(a => ({
        tenant_id: tenantId, expense_id: expenseId,
        source_order_detail_id: a.source_order_detail_id || null, source_grn_detail_id: a.source_grn_detail_id || null, source_bill_detail_id: a.source_bill_detail_id || null,
        product_id: a.product_id, product_name_snapshot: a.product_name_snapshot,
        line_qty: a.qty, line_value: a.value, allocated_amount: a.allocated_amount, landed_cost_per_unit: a.landed_cost_per_unit
    }));
    const { error } = await tenantClient.from('purchase_expense_allocations').insert(rows);
    if (error) throw error;
}

// The allocated (costing) part of the entry becomes stock value on the
// receipt (utils/landedCost.js), while the GL debit stays on the line's
// ledger. Stock is periodic, so that ledger should be a Purchase / direct
// expense (or Inventory) ledger: then COGS = purchases incl. the expense -
// closing stock incl. its unsold share. An indirect-expense ledger keeps
// net profit right but overstates gross profit by the part left in stock.
async function costingWarnings(tenantClient, tenantId, head, lines) {
    const costing = lines.filter(l => l.allocation_basis !== 'none' && Number(l.amount) > 0);
    if (!costing.length) return [];
    const warnings = [];
    const cls = await classifyLedgers(tenantClient, tenantId, costing.map(l => l.expense_ledger_id));
    costing.forEach(l => {
        const c = cls[l.expense_ledger_id];
        if (c && !c.neutral) warnings.push(`${l.description || c.name}: "${c.name}" is a ${describeLedger(c)} ledger, but this line is added to stock cost - use a Purchase / direct expense ledger so gross profit is not overstated.`);
    });
    if (head && !head.source_grn_id && !head.source_bill_id) {
        warnings.push('Linked to an Order only: the cost is added to stock when the goods are received (GRN / Bill made from this Order). Until then it stays in the expense.');
    }
    return warnings;
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function ensureDefaultFieldControls(tenantClient, tenantId, voucherType) {
    const { data: existing } = await tenantClient.from('entry_field_controls').select('id').eq('tenant_id', tenantId).eq('voucher_type', voucherType).limit(1);
    if (existing && existing.length > 0) return;
    const { data: requiredFields } = await tenantClient.from('voucher_field_catalog').select('field_key').eq('voucher_type', voucherType).eq('is_system_required', true);
    if (!requiredFields || requiredFields.length === 0) return;
    const rows = requiredFields.map(f => ({ tenant_id: tenantId, voucher_type: voucherType, field_key: f.field_key, scope: 'global', mode: 'compulsory' }));
    await tenantClient.from('entry_field_controls').insert(rows);
}

// FEATURE: live allocation PREVIEW before saving - same math the save
// path uses, so what the user sees while filling the form is exactly
// what gets stored. POST (not GET) since each line now carries its own
// basis/sign/amount - too much to encode cleanly as query params.
router.post('/purchase-additional-expenses/allocation-preview', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { source_order_id, source_grn_id, source_bill_id, expense_lines } = req.body;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const sourceLines = await getSourceLines(tenantClient, { source_order_id, source_grn_id, source_bill_id });
        const lines = await applyTermRules(tenantClient, req.auth.tenantId, (Array.isArray(expense_lines) ? expense_lines : []).filter(l => Number(l.amount) > 0).map(withBillType));
        const allocated = computeAllocations(sourceLines, lines);
        const netPayable = computeNetPayable(lines);
        // the reference document (party, number, date, amount) shown above the product lines
        const ref = source_bill_id ? ['purchase_bills', source_bill_id] : source_grn_id ? ['purchase_grns', source_grn_id] : source_order_id ? ['purchase_orders', source_order_id] : null;
        let reference = null;
        if (ref) {
            const { data: h } = await tenantClient.from(ref[0]).select('doc_no, doc_date, vendor_name_snapshot, total_amount, party_bill_no, party_bill_date').eq('id', ref[1]).maybeSingle();
            reference = h || null;
        }
        // additional (goes to the cost of the goods) vs non-additional (VAT that can be claimed, lines kept out of costing)
        const additional = allocated.reduce((s, a) => s + a.allocated_amount, 0);
        const r2 = n => Math.round(n * 100) / 100;
        // the ledger entry this will post (same builder as posting), with names, for the Account Posting tab
        let gl = null, glError = null;
        const customsRows = cleanCustoms(req.body.customs_entries);
        if (req.body.account_posting !== false && (lines.length || customsRows.length)) {
            try {
                const glLines = await buildAdditionalExpenseGl(tenantClient, req.auth.tenantId, { vendor_ledger_id: req.body.vendor_ledger_id || null, vendor_sub_ledger_id: req.body.vendor_sub_ledger_id || null, customs_entries: customsRows }, lines);
                const ids = [...new Set(glLines.map(x => x.ledgerId))], subIds = [...new Set(glLines.map(x => x.subLedgerId).filter(Boolean))];
                const { data: leds } = ids.length ? await tenantClient.from('ledger_accounts').select('id, account_name, account_code').in('id', ids) : { data: [] };
                const { data: subs } = subIds.length ? await tenantClient.from('sub_ledgers').select('id, sub_ledger_name').in('id', subIds) : { data: [] };
                const ln = Object.fromEntries((leds || []).map(x => [x.id, x.account_name])), sn = Object.fromEntries((subs || []).map(x => [x.id, x.sub_ledger_name]));
                gl = glLines.map(x => ({ ledger_id: x.ledgerId, ledger_name: ln[x.ledgerId] || '', sub_ledger_name: x.subLedgerId ? sn[x.subLedgerId] || '' : '', debit: r2(x.debit || 0), credit: r2(x.credit || 0), narration: x.narration || '' }));
            } catch (e) { glError = e.message; }
        }
        res.json({ success: true, data: { allocations: allocated, net_payable: netPayable, reference, gl, gl_error: glError,
            totals: { net_basic: r2(sourceLines.reduce((s, l) => s + l.value, 0)), additional: r2(additional), non_additional: r2(netPayable - additional),
                qty: r2(sourceLines.reduce((s, l) => s + l.qty, 0)), alt_qty: r2(sourceLines.reduce((s, l) => s + (l.alt_qty || 0), 0)) } } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/purchase-additional-expenses', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        await ensureDefaultFieldControls(tenantClient, req.auth.tenantId, 'purchase_additional');
        const { data, error } = await tenantClient.from('purchase_additional_expenses').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        const withDisplayNames = (data || []).map(r => ({ ...r, vendor_display_name: r.vendor_name_snapshot || r.cash_vendor_name || null }));
        res.json({ success: true, data: withDisplayNames });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/purchase-additional-expenses/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('purchase_additional_expenses').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Additional Expense not found' });
        const { data: lines } = await tenantClient.from('purchase_additional_expense_lines').select('*').eq('expense_id', req.params.id).order('display_order');
        const { data: allocations } = await tenantClient.from('purchase_expense_allocations').select('*').eq('expense_id', req.params.id);
        data.expense_lines = lines || [];
        const { data: customs } = await tenantClient.from('purchase_additional_customs').select('*').eq('expense_id', req.params.id).order('display_order');
        data.customs_entries = customs || [];
        data.allocations = allocations || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/purchase-additional-expenses', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        // a new additional bill refers to the purchase bill (Ref. Bill No.) - Order / GRN links stay only on older entries
        if (!isDraft && !req.body.source_bill_id) return res.status(400).json({ success: false, error: 'Choose the Ref. Bill No. - the purchase bill this additional cost belongs to' });
        const validationError = validateBody(req.body, isDraft) || (isDraft ? null : validateCustoms(req.body.customs_entries));
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_additional', req.body, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'purchase', { ...req.body, details: [] }, isDraft);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;

        const { data: currentUser } = await tenantClient.from('users').select('default_branch_id').eq('id', req.auth.userId).single();
        let branchNameSnapshot = null;
        if (currentUser?.default_branch_id) {
            const { data: branch } = await tenantClient.from('branches').select('branch_name').eq('id', currentUser.default_branch_id).maybeSingle();
            branchNameSnapshot = branch?.branch_name || null;
        }
        const { data: currentFy } = await tenantClient.from('fiscal_years').select('id, fiscal_year_name').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();

        let docNo;
        try {
            docNo = await resolveDocumentNumber(tenantClient, {
                tenantId, voucherType: 'purchase_additional', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, docDate: b.doc_date || b.voucher_date || b.entry_date, tableName: 'purchase_additional_expenses',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_purchase_additional_expense_code', type_prefix: 'PADX' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('purchase_additional_expenses')
            .insert({
                vendor_sub_ledger_id: b.vendor_sub_ledger_id || null,
                product_company_id: b.product_company_id || null,
                account_posting: b.account_posting !== false, // No: no ledger entry (landed cost still moves)
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                source_order_id: b.source_order_id || null, source_grn_id: b.source_grn_id || null, source_bill_id: b.source_bill_id || null,
                vendor_ledger_id: b.vendor_ledger_id || null, cash_vendor_name: b.invoice_type === 'cash' ? (b.cash_vendor_name || null) : null,
                agent_id: b.agent_id || null, invoice_type: b.invoice_type || 'credit', currency: b.currency || 'NPR', exchange_rate: Number(b.exchange_rate) > 0 ? Number(b.exchange_rate) : 1,
                party_bill_no: b.party_bill_no || null, party_bill_date: b.party_bill_date || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                priority: b.priority || 'normal', narration: b.narration || null,
                ...snapshots,
                status: 'draft', created_by: req.auth.userId, updated_by: req.auth.userId // posting only via /status
            })
            .select().single();
        if (error) throw error;

        try {
            const linesToSave = Array.isArray(b.expense_lines) ? b.expense_lines : [];
            const { netPayable, lines } = await syncExpenseLines(tenantClient, tenantId, doc.id, linesToSave);
            await syncAllocations(tenantClient, tenantId, doc.id, b, lines);
            await syncCustoms(tenantClient, tenantId, doc.id, b.customs_entries);
            await tenantClient.from('purchase_additional_expenses').update({ total_amount: Math.round((netPayable + customsVat(b.customs_entries)) * 100) / 100 }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('purchase_additional_customs').delete().eq('expense_id', doc.id);
            await tenantClient.from('purchase_expense_allocations').delete().eq('expense_id', doc.id);
            await tenantClient.from('purchase_additional_expense_lines').delete().eq('expense_id', doc.id);
            await tenantClient.from('purchase_additional_expenses').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save expense lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_additional_expense', 'purchase_additional_expense', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'purchase_additional_expense', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Additional Expense ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/purchase-additional-expenses/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('purchase_additional_expenses').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Additional Expense not found' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} expense entry` });
        }
        // Readonly / disabled header fields keep their stored value (before snapshots + update).
        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_additional', b, existing);

        const snapshots = (b.vendor_ledger_id || b.agent_id || b.cost_center_id || b.business_unit_id) ? await captureMasterSnapshots(tenantClient, b) : {};
        const companyError = await checkProductCompany(tenantClient, tenantId, 'purchase', { ...existing, ...b, details: [] }, false);
        if (companyError) return res.status(400).json({ success: false, error: companyError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_additional', b, !!(b.save_as_draft || b.status === 'draft'));
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.expense_lines;
        delete update.customs_entries;
        delete update.save_as_draft;
        const customsError = (b.save_as_draft || b.status === 'draft') ? null : validateCustoms(b.customs_entries);
        if (customsError) return res.status(400).json({ success: false, error: customsError });

        const { data, error } = await tenantClient.from('purchase_additional_expenses').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.expense_lines) {
            const { netPayable, lines } = await syncExpenseLines(tenantClient, tenantId, req.params.id, b.expense_lines);
            await syncAllocations(tenantClient, tenantId, req.params.id, { ...existing, ...b }, lines);
            await syncCustoms(tenantClient, tenantId, req.params.id, b.customs_entries);
            await tenantClient.from('purchase_additional_expenses').update({ total_amount: Math.round((netPayable + customsVat(b.customs_entries)) * 100) / 100 }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_additional_expense', 'purchase_additional_expense', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'purchase_additional_expense', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/purchase-additional-expenses/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        // Read the CURRENT status first so GL posting runs exactly once
        // on draft->posted, and reversal only on posted->cancelled.
        const { data: existing } = await tenantClient.from('purchase_additional_expenses').select('status').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
        if (!existing) return res.status(404).json({ success: false, error: 'Additional Expense not found' });
        if (existing.status === 'cancelled') return res.status(400).json({ success: false, error: 'This document is already cancelled' });
        if (status === 'draft' && existing.status === 'posted') return res.status(400).json({ success: false, error: 'A posted document cannot go back to draft - cancel it instead' });
        let glPlan = null, warnings = [];
        if (status === 'posted' && existing.status !== 'posted') {
            const { data: head } = await tenantClient.from('purchase_additional_expenses').select('*').eq('id', req.params.id).maybeSingle();
            const { data: lines } = await tenantClient.from('purchase_additional_expense_lines').select('*').eq('expense_id', req.params.id).order('display_order');
            const { data: customs } = await tenantClient.from('purchase_additional_customs').select('*').eq('expense_id', req.params.id).order('display_order');
            try { glPlan = head && head.account_posting === false ? null : await buildAdditionalExpenseGl(tenantClient, tenantId, { ...head, customs_entries: customs || [] }, lines || []); }
            catch (planErr) { return res.status(400).json({ success: false, error: planErr.message }); }
            warnings = await costingWarnings(tenantClient, tenantId, head, lines || []);
        }
        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') { update.cancellation_reason = cancellation_reason; update.cancelled_at = new Date().toISOString(); update.cancelled_by = req.auth.userId; }
        const { data, error } = await tenantClient.from('purchase_additional_expenses').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        // FEATURE: GL - Dr each expense ledger (Cr for deduct lines),
        // net to the vendor. Previously this document never reached
        // the ledger at all.
        if (status === 'posted' && existing.status !== 'posted') {
            if (glPlan) await postAdditionalExpenseEntry(tenantClient, tenantId, data, glPlan, req.auth.userId);
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseBatch(tenantClient, 'purchase_additional_expense', req.params.id);
        }
        // landed cost: the allocated amounts go into (or come out of) the stock value of the purchase lines
        if ((status === 'posted' && existing.status !== 'posted') || (status === 'cancelled' && existing.status === 'posted')) {
            const landed = await refreshLandedCost(tenantClient, tenantId, { expenseIds: [req.params.id] });
            if (landed.error) console.warn('landed cost not applied:', landed.error);
        }
        await logAudit(tenantId, req.auth.userId, 'change_additional_expense_status', 'purchase_additional_expense', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'purchase_additional_expense', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data, warnings: warnings.length ? warnings : undefined });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/purchase-additional-expenses/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('purchase_additional_expenses').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Additional Expense not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted expense entry' });
        const { error } = await tenantClient.from('purchase_additional_expenses').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_additional_expense', 'purchase_additional_expense', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/purchase-additional-expenses/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'purchase_additional_expense').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
module.exports._internals = { billTypeOf, computeAllocations, applyTermRules, computeNetPayable, costingWarnings, getSourceLines };
