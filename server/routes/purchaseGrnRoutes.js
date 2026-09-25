// =============================================
// routes/purchaseGrnRoutes.js
// Full CRUD for Purchase GRN (Goods Receipt Note) - universally pulls forward
// and/or a Quotation (either, both, or neither - a standalone PO is
// valid too), or be raised standalone. Mirrors every piece of
// infrastructure built for Purchase Requisition: historical name
// snapshots, configurable Document Numbering, document-level AND
// per-line ("Product Term") Billing Terms with Summary redistribution,
// dedicated audit trail, and Entry Field Control defaults.
// =============================================

const express = require('express');
const { checkAccountPurposes } = require('../utils/ledgerPurpose');
const { bumpAltCounter, moveSourceProgress, rollHeaderStatus } = require('../utils/progressCounters');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const { checkProductCompany } = require('../utils/productCompanyRules');
const { applyTermSubLedgers } = require('../utils/termSubLedgers');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { evaluateAllTerms } = require('../utils/formulaEvaluator');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { postGrnReceiptEntry, reverseBatch } = require('../utils/grnAccounting');
const { toBaseUnitQty } = require('../utils/unitConversion');
const { toBaseQtyFromDual, computeDualAmount, getDualUomMode } = require('../utils/dualUomCalculation');

// FEATURE: "Save as Draft" - a draft only needs a Date; a "final" save
// still needs the full, real validation.
function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!b.vendor_ledger_id && !b.cash_vendor_name) return 'A Vendor (or, for Cash, a Party Name) is required';
    if (!Array.isArray(b.details) || b.details.length === 0) return 'At least one line item is required';
    for (const d of b.details) {
        if (!d.product_id) return 'Every line needs a Product';
        // Dual-unit lines may be secondary-only (0 Carton + 7 Pcs); neither may be negative.
        if (Number(d.qty) < 0 || Number(d.alt_qty) < 0) return 'Qty cannot be negative';
        if (!(Number(d.qty) > 0) && !(Number(d.alt_qty) > 0)) return 'Every line needs a Qty greater than zero';
    }
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.vendor_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.vendor_ledger_id).maybeSingle(),
        b.agent_id && tenantClient.from('salesman_agents').select('agent_name').eq('id', b.agent_id).maybeSingle(),
        b.warehouse_id && tenantClient.from('warehouses').select('warehouse_name').eq('id', b.warehouse_id).maybeSingle(),
        b.goods_account_ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', b.goods_account_ledger_id).maybeSingle(),
        b.goods_sub_ledger_id && tenantClient.from('sub_ledgers').select('sub_ledger_name').eq('id', b.goods_sub_ledger_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle(),
        b.area_id && tenantClient.from('areas').select('area_name').eq('id', b.area_id).maybeSingle(),
        b.route_id && tenantClient.from('routes').select('route_name').eq('id', b.route_id).maybeSingle()
    ];
    const [vendor, agent, warehouse, goodsAccount, goodsSubLedger, costCenter, businessUnit, area, route] = await Promise.all(
        lookups.map(l => l || Promise.resolve({ data: null }))
    );
    return {
        vendor_name_snapshot: vendor.data?.account_name || null,
        agent_name_snapshot: agent.data?.agent_name || null,
        warehouse_name_snapshot: warehouse.data?.warehouse_name || null,
        goods_account_name_snapshot: goodsAccount.data?.account_name || null,
        goods_sub_ledger_name_snapshot: goodsSubLedger.data?.sub_ledger_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null,
        area_name_snapshot: area.data?.area_name || null,
        route_name_snapshot: route.data?.route_name || null
    };
}

async function captureDetailSnapshots(tenantClient, detail) {
    const lookups = [
        detail.product_id && tenantClient.from('products').select('product_name').eq('id', detail.product_id).maybeSingle(),
        detail.uom_id && tenantClient.from('product_units').select('unit_name').eq('id', detail.uom_id).maybeSingle(),
        detail.alt_unit_id && tenantClient.from('product_units').select('unit_name').eq('id', detail.alt_unit_id).maybeSingle(),
        detail.alt1_unit_id && tenantClient.from('product_units').select('unit_name').eq('id', detail.alt1_unit_id).maybeSingle(),
        detail.free_uom_id && tenantClient.from('product_units').select('unit_name').eq('id', detail.free_uom_id).maybeSingle(),
        detail.warehouse_id && tenantClient.from('warehouses').select('warehouse_name').eq('id', detail.warehouse_id).maybeSingle()
    ];
    const [product, uom, altUnit, alt1Unit, freeUom, warehouse] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        product_name_snapshot: product.data?.product_name || null,
        uom_name_snapshot: uom.data?.unit_name || null,
        alt_unit_name_snapshot: altUnit.data?.unit_name || null,
        alt1_unit_name_snapshot: alt1Unit.data?.unit_name || null,
        free_uom_name_snapshot: freeUom.data?.unit_name || null,
        warehouse_name_snapshot: warehouse.data?.warehouse_name || null
    };
}

// FEATURE: "Ref No should live in the Details table" - a human-readable
// doc_no (not just an opaque source_*_detail_id) captured directly on
// each GRN line, so it's obvious at a glance which document a line came
// from without following a join every time.
// FEATURE: "GRN never wrote to the stock ledger at all" - the primary
// inbound point for Purchase stock now actually feeds the shared
// stock_movements ledger, converted to each product's base unit first
// like every other document that touches it.
async function postGrnStockMovements(tenantClient, tenantId, grn, details) {
    const rows = [];
    for (const d of details) {
        const wh = d.warehouse_id || grn.warehouse_id;
        const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
        let baseQty, unitCost;
        if (product?.uom_mode === 'fixed_dual' && d.alt_qty) {
            const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
            const conversionFactor = Number(unitRate?.conversion_factor) || 1;
            baseQty = toBaseQtyFromDual(d.qty, d.alt_qty, conversionFactor, await getDualUomMode(tenantClient));
            unitCost = d.rate_basis === 'primary' ? Number(d.rate) / conversionFactor : Number(d.rate);
        } else {
            baseQty = await toBaseUnitQty(tenantClient, d.product_id, d.qty, d.uom_id);
            unitCost = d.rate || 0;
        }
        rows.push({ tenant_id: tenantId, product_id: d.product_id, warehouse_id: wh, batch_no: d.batch_no, serial_no: d.serial_no || null, movement_date: grn.doc_date, qty_in: baseQty, qty_out: 0, unit_cost: unitCost, source_type: 'purchase_grn', source_id: grn.id, source_detail_id: d.id, narration: `GRN ${grn.doc_no} received` });
    }
    if (rows.length > 0) {
        const { error } = await tenantClient.from('stock_movements').insert(rows);
        if (error) throw error;
    }
}

async function reverseGrnStockMovements(tenantClient, grnId) {
    await tenantClient.from('stock_movements').delete().eq('source_type', 'purchase_grn').eq('source_id', grnId);
}

async function captureSourceDocNo(tenantClient, d) {    if (d.source_order_detail_id) {
        const { data } = await tenantClient.from('purchase_order_details').select('order_id').eq('id', d.source_order_detail_id).maybeSingle();
        if (data) {
            const { data: ord } = await tenantClient.from('purchase_orders').select('doc_no').eq('id', data.order_id).maybeSingle();
            if (ord) return ord.doc_no;
        }
    }
    if (d.source_quotation_detail_id) {
        const { data } = await tenantClient.from('purchase_quotation_details').select('quotation_id').eq('id', d.source_quotation_detail_id).maybeSingle();
        if (data) {
            const { data: quo } = await tenantClient.from('purchase_quotations').select('doc_no').eq('id', data.quotation_id).maybeSingle();
            if (quo) return quo.doc_no;
        }
    }
    if (d.source_requisition_detail_id) {
        const { data } = await tenantClient.from('purchase_requisition_details').select('requisition_id').eq('id', d.source_requisition_detail_id).maybeSingle();
        if (data) {
            const { data: req_ } = await tenantClient.from('purchase_requisitions').select('doc_no').eq('id', data.requisition_id).maybeSingle();
            if (req_) return req_.doc_no;
        }
    }
    return null;
}

async function syncDetails(tenantClient, tenantId, grnId, details) {
    await tenantClient.from('purchase_grn_details').delete().eq('grn_id', grnId);
    if (!Array.isArray(details) || details.length === 0) return { total: 0, detailIdByIndex: [] };
    const rows = await Promise.all(details.map(async (d, i) => {
        const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
        let qty = Number(d.qty) || 0, rate = Number(d.rate) || 0, baseAmount;
        if (product?.uom_mode === 'fixed_dual' && d.alt_qty) {
            const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
            const conversionFactor = Number(unitRate?.conversion_factor) || 1;
            baseAmount = computeDualAmount(d.qty, d.alt_qty, d.rate, d.rate_basis || 'primary', conversionFactor, await getDualUomMode(tenantClient));
        } else {
            baseAmount = qty * rate;
        }
        const discountAmount = d.discount_percent ? baseAmount * (Number(d.discount_percent) / 100) : (Number(d.discount_amount) || 0);
        const taxableAmount = baseAmount - discountAmount;
        const taxAmount = d.tax_percent ? taxableAmount * (Number(d.tax_percent) / 100) : (Number(d.tax_amount) || 0);
        const snapshots = await captureDetailSnapshots(tenantClient, d);
        const sourceDocNo = d.source_doc_no || await captureSourceDocNo(tenantClient, d);
        return {
            tenant_id: tenantId, grn_id: grnId, display_order: i + 1,
            source_requisition_detail_id: d.source_requisition_detail_id || null,
            source_quotation_detail_id: d.source_quotation_detail_id || null,
            source_order_detail_id: d.source_order_detail_id || null,
            source_doc_no: sourceDocNo, batch_no: d.batch_no || null, serial_no: d.serial_no || null,
            product_id: d.product_id, qty, uom_id: d.uom_id || null,
            alt_qty: d.alt_qty || null, alt_unit_id: d.alt_unit_id || null,
            alt1_qty: d.alt1_qty || null, alt1_unit_id: d.alt1_unit_id || null,
            rate_basis: d.rate_basis || 'primary',
            rate, amount: taxableAmount + taxAmount,
            discount_percent: d.discount_percent || 0, discount_amount: discountAmount,
            tax_percent: d.tax_percent || 0, tax_amount: taxAmount, narration: d.narration || null,
            free_qty: d.free_qty || 0, free_uom_id: d.free_uom_id || null,
            warehouse_id: d.warehouse_id || null, barcode: d.barcode || null,
            ...snapshots
        };
    }));
    const { data: insertedRows, error } = await tenantClient.from('purchase_grn_details').insert(rows).select('id, display_order').order('display_order');
    if (error) throw error;
    const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const detailIdByIndex = (insertedRows || []).map(r => r.id);
    return { total, detailIdByIndex };
}

async function syncBillingTerms(tenantClient, tenantId, documentType, documentId, billingTermIds, baseAmount, totalQty) {
    await tenantClient.from('document_billing_terms').delete().eq('tenant_id', tenantId).eq('document_type', documentType).eq('document_id', documentId);
    if (!Array.isArray(billingTermIds) || billingTermIds.length === 0) return 0;
    const { data: terms } = await tenantClient
        .from('billing_terms').select('*').in('id', billingTermIds).eq('is_enabled', true).eq('applicable_purchase_entry', true).order('display_order');
    if (!terms || terms.length === 0) return 0;
    const { lines } = evaluateAllTerms(terms, { basic_amount: baseAmount, quantity: totalQty });
    const rows = terms.map((term, i) => ({
        tenant_id: tenantId, document_type: documentType, document_id: documentId,
        billing_term_id: term.id, computed_amount: lines[i]?.amount ?? 0, display_order: i + 1
    }));
    const { error } = await tenantClient.from('document_billing_terms').insert(rows);
    if (error) throw error;
    return rows.reduce((sum, r) => sum + Number(r.computed_amount), 0);
}

async function syncLineBillingTerms(tenantClient, tenantId, documentType, documentId, detailRows, detailIdByIndex, summaryOverrides) {
    await tenantClient.from('document_line_billing_terms').delete().eq('tenant_id', tenantId).eq('document_type', documentType).eq('document_id', documentId);
    const allTermIds = new Set();
    detailRows.forEach(d => (d.billing_term_ids || []).forEach(id => allTermIds.add(id)));
    if (allTermIds.size === 0) return { rows: [], total: 0, summary: [] };

    const { data: terms } = await tenantClient
        .from('billing_terms').select('*').in('id', Array.from(allTermIds)).eq('is_enabled', true).eq('applicable_purchase_entry', true).order('display_order');
    const termsById = Object.fromEntries((terms || []).map(t => [t.id, t]));

    const lineComputations = {};
    detailRows.forEach((d, idx) => {
        const lineTerms = (d.billing_term_ids || []).map(id => termsById[id]).filter(Boolean);
        if (lineTerms.length === 0) return;
        const lineAmount = (Number(d.qty) || 0) * (Number(d.rate) || 0);
        const { lines } = evaluateAllTerms(lineTerms, { basic_amount: lineAmount, quantity: Number(d.qty) || 0 });
        lineTerms.forEach((term, i) => {
            if (!lineComputations[term.id]) lineComputations[term.id] = [];
            lineComputations[term.id].push({ detailIndex: idx, amount: lines[i]?.amount ?? 0 });
        });
    });

    const rows = [];
    const summary = [];
    for (const [termId, entries] of Object.entries(lineComputations)) {
        const originalTotal = entries.reduce((s, e) => s + e.amount, 0);
        const override = summaryOverrides && summaryOverrides[termId] !== undefined ? Number(summaryOverrides[termId]) : null;
        const isOverridden = override !== null && override !== originalTotal;
        let finalEntries = entries;
        if (isOverridden) {
            finalEntries = originalTotal !== 0
                ? entries.map(e => ({ ...e, amount: override * (e.amount / originalTotal) }))
                : entries.map(e => ({ ...e, amount: override / entries.length }));
        }
        finalEntries.forEach(e => {
            rows.push({
                tenant_id: tenantId, document_type: documentType, document_id: documentId,
                detail_id: detailIdByIndex[e.detailIndex], billing_term_id: termId,
                computed_amount: e.amount, is_summary_overridden: isOverridden
            });
        });
        summary.push({ billing_term_id: termId, term_code: termsById[termId]?.term_code, original_total: originalTotal, final_total: finalEntries.reduce((s, e) => s + e.amount, 0), is_overridden: isOverridden });
    }
    if (rows.length > 0) {
        const { error } = await tenantClient.from('document_line_billing_terms').insert(rows);
        if (error) throw error;
    }
    return { rows, total: summary.reduce((s, t) => s + t.final_total, 0), summary };
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId, changes) {
    const rows = (changes || []).map(c => ({
        tenant_id: tenantId, document_type: documentType, document_id: documentId,
        action, field_key: c.field_key || null, old_value: c.old_value ?? null, new_value: c.new_value ?? null,
        performed_by: userId
    }));
    if (rows.length === 0) rows.push({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    const { error } = await tenantClient.from('document_audit_trail').insert(rows);
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

function diffFields(existing, updated, fields) {
    const changes = [];
    for (const f of fields) {
        const oldVal = existing[f], newVal = updated[f];
        if (newVal !== undefined && String(oldVal ?? '') !== String(newVal ?? '')) {
            changes.push({ field_key: f, old_value: oldVal ?? null, new_value: newVal ?? null });
        }
    }
    return changes;
}

async function ensureDefaultFieldControls(tenantClient, tenantId, voucherType) {
    const { data: existing } = await tenantClient.from('entry_field_controls').select('id').eq('tenant_id', tenantId).eq('voucher_type', voucherType).limit(1);
    if (existing && existing.length > 0) return;
    const { data: requiredFields } = await tenantClient
        .from('voucher_field_catalog').select('field_key').eq('voucher_type', voucherType).eq('is_system_required', true);
    if (!requiredFields || requiredFields.length === 0) return;
    const rows = requiredFields.map(f => ({ tenant_id: tenantId, voucher_type: voucherType, field_key: f.field_key, scope: 'global', mode: 'compulsory' }));
    await tenantClient.from('entry_field_controls').insert(rows);
}

// FEATURE: "pulls forward from Requisition and/or Quotation" - copies
// every line into ready-to-use GRN detail rows, carrying the source
// ids forward so GRN can later track received-vs-ordered progress.
// FEATURE: "whichever module comes after should be able to fill from
// ANY earlier module" - truly universal: any combination of
// Requisition, Quotation, and/or Order can be pulled from AT ONCE, and
// their lines are MERGED (not one silently replacing the other).
router.get('/purchase-grns/pull-forward', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { requisition_id, quotation_id, order_id } = req.query;
        if (!requisition_id && !quotation_id && !order_id) {
            return res.status(400).json({ success: false, error: 'Provide a requisition_id, quotation_id, and/or order_id to pull from' });
        }
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let details = [];
        let master = {};

        if (requisition_id) {
            const { data: req_ } = await tenantClient.from('purchase_requisitions').select('*, details:purchase_requisition_details(*)').eq('id', requisition_id).single();
            if (req_) {
                master = { ...master, vendor_ledger_id: master.vendor_ledger_id || req_.vendor_ledger_id, vendor_sub_ledger_id: master.vendor_sub_ledger_id || ((master.vendor_ledger_id || req_.vendor_ledger_id) === req_.vendor_ledger_id ? req_.vendor_sub_ledger_id : null) || null, product_company_id: master.product_company_id || req_.product_company_id || null, agent_id: master.agent_id || req_.agent_id, warehouse_id: master.warehouse_id || req_.warehouse_id, cost_center_id: master.cost_center_id || req_.cost_center_id, business_unit_id: master.business_unit_id || req_.business_unit_id, area_id: master.area_id || req_.area_id, route_id: master.route_id || req_.route_id };
                details = details.concat((req_.details || []).map(d => ({
                    source_requisition_detail_id: d.id, source_doc_no: req_.doc_no, product_id: d.product_id, qty: d.qty, uom_id: d.uom_id,
                    rate: d.rate, warehouse_id: d.warehouse_id, barcode: d.barcode
                })));
            }
        }
        if (quotation_id) {
            const { data: quo } = await tenantClient.from('purchase_quotations').select('*, details:purchase_quotation_details(*)').eq('id', quotation_id).single();
            if (quo) {
                master = { ...master, vendor_ledger_id: master.vendor_ledger_id || quo.vendor_ledger_id, vendor_sub_ledger_id: master.vendor_sub_ledger_id || ((master.vendor_ledger_id || quo.vendor_ledger_id) === quo.vendor_ledger_id ? quo.vendor_sub_ledger_id : null) || null, product_company_id: master.product_company_id || quo.product_company_id || null, agent_id: master.agent_id || quo.agent_id, currency: master.currency || quo.currency };
                details = details.concat((quo.details || []).map(d => ({
                    source_quotation_detail_id: d.id, source_doc_no: quo.doc_no, product_id: d.product_id, qty: d.qty, uom_id: d.uom_id,
                    rate: d.rate, warehouse_id: d.warehouse_id, barcode: d.barcode
                })));
            }
        }
        if (order_id) {
            const { data: ord } = await tenantClient.from('purchase_orders').select('*, details:purchase_order_details(*)').eq('id', order_id).single();
            if (ord) {
                master = { ...master, vendor_ledger_id: master.vendor_ledger_id || ord.vendor_ledger_id, vendor_sub_ledger_id: master.vendor_sub_ledger_id || ((master.vendor_ledger_id || ord.vendor_ledger_id) === ord.vendor_ledger_id ? ord.vendor_sub_ledger_id : null) || null, product_company_id: master.product_company_id || ord.product_company_id || null, agent_id: master.agent_id || ord.agent_id, warehouse_id: master.warehouse_id || ord.warehouse_id, cost_center_id: master.cost_center_id || ord.cost_center_id, business_unit_id: master.business_unit_id || ord.business_unit_id, area_id: master.area_id || ord.area_id, route_id: master.route_id || ord.route_id, currency: master.currency || ord.currency };
                // FEATURE: outstanding-aware - only pull the part of each
                // Order line that hasn't already been received (qty minus
                // whatever earlier GRNs already took), so re-pulling the
                // same Order twice never double-receives it.
                details = details.concat((ord.details || [])
                    .map(d => ({ ...d, outstanding: Math.max(0, Number(d.qty) - Number(d.qty_received || 0)), alt_outstanding: Math.max(0, Number(d.alt_qty || 0) - Number(d.alt_qty_received || 0)) }))
                    .filter(d => d.outstanding > 0 || d.alt_outstanding > 0)
                    .map(d => ({
                        source_order_detail_id: d.id, source_doc_no: ord.doc_no, product_id: d.product_id, qty: d.outstanding, alt_qty: d.alt_outstanding || null, alt_unit_id: d.alt_unit_id || null, rate_basis: d.rate_basis || 'primary', uom_id: d.uom_id,
                        rate: d.rate, warehouse_id: d.warehouse_id, barcode: d.barcode
                    })));
            }
        }
        res.json({ success: true, data: { master, details } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---- GRN -> Purchase Order progress (qty_received / alt_qty_received) ----
// A GRN counts against its Order only while it is received (not in draft,
// not cancelled): +1 when it becomes received, -1 when a received GRN is
// cancelled, and old lines -1 / new lines +1 when a received GRN is edited.
// (Previously the counter moved at CREATE - even for drafts - and never
// moved back on edit, delete or cancel.)
const GRN_COUNTING = ['received', 'partially_billed', 'billed'];
const PO_PROGRESS = { sourceIdField: 'source_order_detail_id', table: 'purchase_order_details', counter: 'qty_received', altCounter: 'alt_qty_received' };
async function moveOrderProgress(tenantClient, lines, dir) {
    await moveSourceProgress(tenantClient, lines, PO_PROGRESS, dir);
    const ids = [...new Set((lines || []).map(l => l.source_order_detail_id).filter(Boolean))];
    if (!ids.length) return;
    const { data: src } = await tenantClient.from('purchase_order_details').select('order_id').in('id', ids);
    for (const orderId of [...new Set((src || []).map(r => r.order_id))]) {
        await rollHeaderStatus(tenantClient, { headerTable: 'purchase_orders', detailTable: 'purchase_order_details', fk: 'order_id', headerId: orderId,
            counter: 'qty_received', altCounter: 'alt_qty_received',
            statuses: { none: 'confirmed', partial: 'partially_received', full: 'fully_received' }, rollable: ['confirmed', 'partially_received', 'fully_received'] });
    }
}

router.get('/purchase-grns', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        await ensureDefaultFieldControls(tenantClient, req.auth.tenantId, 'purchase_grn');
        const { data, error } = await tenantClient
            .from('purchase_grns')
            .select('*, vendor:vendor_ledger_id(account_name), warehouse:warehouse_id(warehouse_name)')
            .eq('tenant_id', req.auth.tenantId)
            .order('doc_date', { ascending: false });
        if (error) throw error;
        const withDisplayNames = (data || []).map(r => ({
            ...r,
            vendor_display_name: r.vendor_name_snapshot || r.vendor?.account_name || null,
            warehouse_display_name: r.warehouse_name_snapshot || r.warehouse?.warehouse_name || null
        }));
        res.json({ success: true, data: withDisplayNames });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/purchase-grns/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('purchase_grns')
            .select('*, details:purchase_order_details(*)')
            .eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Purchase GRN not found' });

        const { data: appliedTerms } = await tenantClient
            .from('document_billing_terms').select('billing_term_id').eq('document_type', 'purchase_grn').eq('document_id', req.params.id);
        data.billing_term_ids = (appliedTerms || []).map(t => t.billing_term_id);

        const { data: lineTerms } = await tenantClient
            .from('document_line_billing_terms').select('detail_id, billing_term_id').eq('document_type', 'purchase_grn').eq('document_id', req.params.id);
        if (data.details) {
            data.details = data.details.map(d => ({ ...d, billing_term_ids: (lineTerms || []).filter(lt => lt.detail_id === d.id).map(lt => lt.billing_term_id) }));
        }
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/purchase-grns', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_grn', req.body, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const acctError = await checkAccountPurposes(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.body, { goods_account_ledger_id: 'purchase_goods' });
        if (acctError) return res.status(400).json({ success: false, error: acctError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'purchase', req.body, isDraft);
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
                tenantId, voucherType: 'purchase_grn', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'purchase_orders',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_purchase_grn_code', type_prefix: 'PGRN' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('purchase_grns')
            .insert({
                vendor_sub_ledger_id: b.vendor_sub_ledger_id || null,
                product_company_id: b.product_company_id || null,
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null,
                branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                source_requisition_id: b.source_requisition_id || null, source_quotation_id: b.source_quotation_id || null,
                source_order_id: b.source_order_id || null,
                vendor_ledger_id: b.vendor_ledger_id || null, agent_id: b.agent_id || null,
                ...snapshots,
                invoice_type: b.invoice_type || 'credit', currency: b.currency || 'NPR',
                due_date: b.due_date || null, due_days: b.due_days || null,
                warehouse_id: b.warehouse_id || null,
                goods_account_ledger_id: b.goods_account_ledger_id || null, goods_sub_ledger_id: b.goods_sub_ledger_id || null,
                quotation_no: b.quotation_no || null, remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null,
                rate_type: b.rate_type || 'exclusive', order_ref_no: b.order_ref_no || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                area_id: b.area_id || null, route_id: b.route_id || null,
                priority: b.priority || 'normal',
                terms_conditions_id: b.terms_conditions_id || null, narration: b.narration || null,
                cash_vendor_name: b.invoice_type === 'cash' ? (b.cash_vendor_name || null) : null,
                cash_billing_details: b.cash_billing_details || null,
                status: b.status || 'draft',
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const { total, detailIdByIndex } = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave);
            const totalQty = detailsToSave.reduce((sum, d) => sum + (Number(d.qty) || 0), 0);
            const documentAdjustment = await syncBillingTerms(tenantClient, tenantId, 'purchase_grn', doc.id, b.billing_term_ids, total, totalQty);
            const lineTermResult = await syncLineBillingTerms(tenantClient, tenantId, 'purchase_grn', doc.id, detailsToSave, detailIdByIndex, b.summary_overrides);
            await applyTermSubLedgers(tenantClient, tenantId, 'purchase_grn', doc.id, b.term_sub_ledgers);
            await tenantClient.from('purchase_grns').update({ total_amount: total + documentAdjustment + lineTermResult.total }).eq('id', doc.id);

            // Counts against its Order only when created already received (not as a draft).
            if (GRN_COUNTING.includes(doc.status)) await moveOrderProgress(tenantClient, detailsToSave, 1);
        } catch (syncErr) {
            await tenantClient.from('document_line_billing_terms').delete().eq('document_type', 'purchase_grn').eq('document_id', doc.id);
            await tenantClient.from('document_billing_terms').delete().eq('document_type', 'purchase_grn').eq('document_id', doc.id);
            await tenantClient.from('purchase_grns').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save line items' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_purchase_grn', 'purchase_grn', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'purchase_grn', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `GRN ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/purchase-grns/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('purchase_grns').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Purchase GRN not found' });
        if (['billed', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} GRN` });
        }

        // Edits are validated for Product Company too (this handler had no validation at all).

        const companyError = await checkProductCompany(tenantClient, tenantId, 'purchase', { ...existing, ...b, details: b.details }, false);

        if (companyError) return res.status(400).json({ success: false, error: companyError });

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_grn', b, existing);


        const snapshots = b.vendor_ledger_id || b.agent_id || b.warehouse_id || b.goods_account_ledger_id || b.goods_sub_ledger_id || b.cost_center_id || b.business_unit_id || b.area_id || b.route_id
            ? await captureMasterSnapshots(tenantClient, b) : {};

        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_grn', b, !!(b.save_as_draft || b.status === 'draft'));

        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const acctError = await checkAccountPurposes(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.body, { goods_account_ledger_id: 'purchase_goods' });
        if (acctError) return res.status(400).json({ success: false, error: acctError });
        const update = { ...b, ...snapshots, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.billing_term_ids;
        delete update.summary_overrides;
        delete update.details;

        const { data, error } = await tenantClient.from('purchase_grns').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            // Edit of a received GRN: take the old lines' qty back out of its Order first.
            const countsNow = GRN_COUNTING.includes(existing.status);
            if (countsNow) { const { data: oldLines } = await tenantClient.from('purchase_grn_details').select('source_order_detail_id, qty, alt_qty').eq('grn_id', req.params.id); await moveOrderProgress(tenantClient, oldLines, -1); }
            const { total, detailIdByIndex } = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            if (countsNow) await moveOrderProgress(tenantClient, b.details, 1);
            const totalQty = b.details.reduce((sum, d) => sum + (Number(d.qty) || 0), 0);
            const documentAdjustment = await syncBillingTerms(tenantClient, tenantId, 'purchase_grn', req.params.id, b.billing_term_ids, total, totalQty);
            const lineTermResult = await syncLineBillingTerms(tenantClient, tenantId, 'purchase_grn', req.params.id, b.details, detailIdByIndex, b.summary_overrides);
            await applyTermSubLedgers(tenantClient, tenantId, 'purchase_grn', req.params.id, b.term_sub_ledgers);
            await tenantClient.from('purchase_grns').update({ total_amount: total + documentAdjustment + lineTermResult.total }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_purchase_grn', 'purchase_grn', req.params.id, { old_data: existing, new_data: data });
        const changes = diffFields(existing, b, [
            'doc_date', 'vendor_ledger_id', 'agent_id', 'invoice_type', 'currency', 'due_date', 'due_days',
            'warehouse_id', 'goods_account_ledger_id', 'goods_sub_ledger_id', 'remarks_text', 'rate_type',
            'cost_center_id', 'business_unit_id', 'area_id', 'route_id', 'priority', 'narration'
        ]);
        await logDocumentAudit(tenantClient, tenantId, 'purchase_grn', req.params.id, 'update', req.auth.userId, changes);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/purchase-grns/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'received', 'partially_billed', 'billed', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }
        if (status === 'cancelled' && !cancellation_reason) {
            return res.status(400).json({ success: false, error: 'A cancellation reason is required' });
        }
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: existing } = await tenantClient.from('purchase_grns').select('status').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Purchase GRN not found' });

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') {
            update.cancellation_reason = cancellation_reason;
            update.cancelled_at = new Date().toISOString();
            update.cancelled_by = req.auth.userId;
        }
        const { data, error } = await tenantClient.from('purchase_grns').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        // FEATURE: "Challan Effect On Stock and Account" - the FIRST
        // time a GRN becomes 'received' it posts Dr Goods/Cr GRN
        // Clearing; cancelling a previously-received GRN reverses it.
        // Guarded by existing.status so re-saving an already-received
        // GRN never double-posts.
        const { data: progressLines } = await tenantClient.from('purchase_grn_details').select('source_order_detail_id, qty, alt_qty').eq('grn_id', req.params.id);
        if (GRN_COUNTING.includes(status) && !GRN_COUNTING.includes(existing.status)) await moveOrderProgress(tenantClient, progressLines, 1);
        if (status === 'cancelled' && GRN_COUNTING.includes(existing.status)) await moveOrderProgress(tenantClient, progressLines, -1);
        if (status === 'received' && existing.status !== 'received') {
            await postGrnReceiptEntry(tenantClient, tenantId, data, req.auth.userId);
            // FEATURE: "GRN never wrote to the stock ledger at all" -
            // the CRITICAL gap found while auditing stock valuation: the
            // whole v_current_stock/v_stock_valuation system was
            // meaningless for the main Purchase inflow without this.
            const { data: grnDetails } = await tenantClient.from('purchase_grn_details').select('*').eq('grn_id', req.params.id);
            await postGrnStockMovements(tenantClient, tenantId, data, grnDetails || []);
        } else if (status === 'cancelled' && existing.status !== 'draft' && existing.status !== 'cancelled') {
            await reverseBatch(tenantClient, 'purchase_grn', req.params.id);
            await reverseGrnStockMovements(tenantClient, req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'change_grn_status', 'purchase_grn', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'purchase_grn', req.params.id, 'status_change', req.auth.userId, [{ field_key: 'status', new_value: status }]);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/purchase-grns/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail')
            .select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'purchase_grn').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "drafts list should be delete-able" - only ever allowed on a
// document still sitting in 'draft' status; once it's a real
// confirmed/sent document, Cancel (a status, keeping the record) is the
// right tool, not a hard delete.
router.delete('/purchase-grns/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('purchase_grns').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Purchase GRN not found' });
        if (existing.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a received GRN' });
        }
        await tenantClient.from('document_line_billing_terms').delete().eq('document_type', 'purchase_grn').eq('document_id', req.params.id);
        await tenantClient.from('document_billing_terms').delete().eq('document_type', 'purchase_grn').eq('document_id', req.params.id);
        const { error } = await tenantClient.from('purchase_grns').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_purchase_grn', 'purchase_grn', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "GRN1 has 5 items, some billed, some not - outstanding
// report" - reads the v_grn_outstanding view (historical-snapshot-
// based, so it always matches what the GRN itself said).
router.get('/grn-outstanding-report', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient.from('v_grn_outstanding').select('*').eq('tenant_id', req.auth.tenantId).gt('qty_outstanding', 0);
        if (req.query.vendor_name) query = query.ilike('vendor_name', `%${req.query.vendor_name}%`);
        if (req.query.from_date) query = query.gte('grn_date', req.query.from_date);
        if (req.query.to_date) query = query.lte('grn_date', req.query.to_date);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
