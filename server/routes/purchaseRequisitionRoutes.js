// =============================================
// routes/purchaseRequisitionRoutes.js
// Purchase Requisition - the origin document of the purchase chain.
// No source document to pull from (nothing precedes it); its own
// details are what Quotation and/or Order later pull forward from.
// =============================================

const express = require('express');
const { checkAccountPurposes } = require('../utils/ledgerPurpose');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const { checkProductCompany } = require('../utils/productCompanyRules');
const { applyTermSubLedgers } = require('../utils/termSubLedgers');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { evaluateAllTerms } = require('../utils/formulaEvaluator');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { computeDualAmount, getDualUomMode } = require('../utils/dualUomCalculation');

function validateBody(b) {
    if (!b.doc_date) return 'Date is required';
    if (!Array.isArray(b.details) || b.details.length === 0) return 'At least one line item is required';
    for (const d of b.details) {
        if (!d.product_id) return 'Every line needs a Product';
        // Dual-unit lines may be secondary-only (0 Carton + 7 Pcs); neither may be negative.
        if (Number(d.qty) < 0 || Number(d.alt_qty) < 0) return 'Qty cannot be negative';
        if (!(Number(d.qty) > 0) && !(Number(d.alt_qty) > 0)) return 'Every line needs a Qty greater than zero';
    }
    return null;
}

// FEATURE: "if a Ledger/Product/etc name changes LATER, this document
// should still show the name as it was when saved" - fetches the
// CURRENT display name of every referenced master in parallel, once,
// right before insert. Display/print always reads from these snapshot
// columns afterward, never re-joining to the live master for a saved
// document - only the FK stays live (for "find every document that
// used this vendor" style lookups).
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

// Same idea, per Detail line - Product/UOM names as they were when this
// specific line was saved.
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

// FEATURE: dedicated, queryable audit trail (document_audit_trail) -
// distinct from the generic logAudit() call, which still fires
// alongside this for the cross-tenant admin log.
async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId, changes) {
    const rows = (changes || []).map(c => ({
        tenant_id: tenantId, document_type: documentType, document_id: documentId,
        action, field_key: c.field_key || null, old_value: c.old_value ?? null, new_value: c.new_value ?? null,
        performed_by: userId
    }));
    if (rows.length === 0) {
        rows.push({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    }
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

// FEATURE: "compulsory fields should auto-enable by default" - on first
// access for this tenant, seed entry_field_controls (scope: global,
// mode: compulsory) for the fields that genuinely need to be filled in
// to make a sensible document, matching voucher_field_catalog's
// is_system_required flag for this voucher type. Idempotent - a tenant
// that already has ANY control row for this voucher type is left alone
// (an admin may have already customized things).
async function ensureDefaultFieldControls(tenantClient, tenantId, voucherType) {
    const { data: existing } = await tenantClient.from('entry_field_controls').select('id').eq('tenant_id', tenantId).eq('voucher_type', voucherType).limit(1);
    if (existing && existing.length > 0) return;

    const { data: requiredFields } = await tenantClient
        .from('voucher_field_catalog').select('field_key').eq('voucher_type', voucherType).eq('is_system_required', true);
    if (!requiredFields || requiredFields.length === 0) return;

    const rows = requiredFields.map(f => ({ tenant_id: tenantId, voucher_type: voucherType, field_key: f.field_key, scope: 'global', mode: 'compulsory' }));
    await tenantClient.from('entry_field_controls').insert(rows);
}


async function syncDetails(tenantClient, tenantId, requisitionId, details) {
    await tenantClient.from('purchase_requisition_details').delete().eq('requisition_id', requisitionId);
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
        return {
            tenant_id: tenantId, requisition_id: requisitionId, display_order: i + 1,
            product_id: d.product_id, qty, uom_id: d.uom_id || null,
            alt_qty: d.alt_qty || null, alt_unit_id: d.alt_unit_id || null,
            alt1_qty: d.alt1_qty || null, alt1_unit_id: d.alt1_unit_id || null,
            rate_basis: d.rate_basis || 'primary',
            rate, amount: taxableAmount + taxAmount,
            discount_percent: d.discount_percent || 0, discount_amount: discountAmount,
            tax_percent: d.tax_percent || 0, tax_amount: taxAmount, narration: d.narration || null,
            free_qty: d.free_qty || 0, free_uom_id: d.free_uom_id || null,
            warehouse_id: d.warehouse_id || null, barcode: d.barcode || null, batch_no: d.batch_no || null,
            ...snapshots
        };
    }));
    // FIX: .select() + ordering by display_order so the returned rows can
    // be safely zipped back to the ORIGINAL `details` array by index,
    // regardless of how the underlying insert happens to order its
    // response - needed to map each line to its real detail_id for
    // per-line ("Product Term") billing term storage.
    const { data: insertedRows, error } = await tenantClient.from('purchase_requisition_details').insert(rows).select('id, display_order').order('display_order');
    if (error) throw error;
    const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const detailIdByIndex = (insertedRows || []).map(r => r.id);
    return { total, detailIdByIndex };
}

// FEATURE: "match how Billing Term's calculation engine works" - the
// SAME evaluateAllTerms() used by Billing Term Management's own Test
// Formula feature, applied here at document level. billingTermIds is a
// list the user picked from billing_terms_v2 (filtered client-side to
// applicable_purchase_entry = true); this replaces the document's
// document_billing_terms rows and returns the total adjustment so the
// caller can fold it into the requisition's final total_amount.
async function syncBillingTerms(tenantClient, tenantId, documentType, documentId, billingTermIds, baseAmount, totalQty) {
    await tenantClient.from('document_billing_terms').delete().eq('tenant_id', tenantId).eq('document_type', documentType).eq('document_id', documentId);
    if (!Array.isArray(billingTermIds) || billingTermIds.length === 0) return 0;

    const { data: terms } = await tenantClient
        .from('billing_terms').select('*').in('id', billingTermIds).eq('is_enabled', true).eq('applicable_purchase_entry', true)
        .order('display_order');
    if (!terms || terms.length === 0) return 0;

    // FIX: evaluateAllTerms returns { lines, total } (not a plain array),
    // and each line's `amount` is ALREADY sign-adjusted internally
    // (term.sign === '-' flips it there) - re-applying the sign here a
    // second time would have silently cancelled every negative term
    // back to positive. Sum the lines exactly as returned.
    const { lines } = evaluateAllTerms(terms, { basic_amount: baseAmount, quantity: totalQty });
    const rows = terms.map((term, i) => ({
        tenant_id: tenantId, document_type: documentType, document_id: documentId,
        billing_term_id: term.id, computed_amount: lines[i]?.amount ?? 0, display_order: i + 1
    }));
    const { error: btError } = await tenantClient.from('document_billing_terms').insert(rows);
    if (btError) throw btError;

    return rows.reduce((sum, r) => sum + Number(r.computed_amount), 0);
}

// FEATURE: "Product Term" - each Detail line can have its OWN Billing
// Terms, computed against THAT line's basic_amount/qty (not the whole
// document). Stores every line's per-term amount so the document-level
// Summary can aggregate them, and so a Summary-level manual edit can be
// redistributed proportionally back down to the exact lines it came
// from. detailIdByIndex maps each syncDetails() row (in insertion
// order) to its real database id, since details are inserted fresh
// every save.
async function syncLineBillingTerms(tenantClient, tenantId, documentType, documentId, detailRows, detailIdByIndex, summaryOverrides) {
    await tenantClient.from('document_line_billing_terms').delete().eq('tenant_id', tenantId).eq('document_type', documentType).eq('document_id', documentId);

    // Pass 1: compute each line's own terms against its own basic_amount/qty.
    const allTermIds = new Set();
    detailRows.forEach(d => (d.billing_term_ids || []).forEach(id => allTermIds.add(id)));
    if (allTermIds.size === 0) return { rows: [], total: 0, summary: [] };

    const { data: terms } = await tenantClient
        .from('billing_terms').select('*').in('id', Array.from(allTermIds)).eq('is_enabled', true).eq('applicable_purchase_entry', true).order('display_order');
    const termsById = Object.fromEntries((terms || []).map(t => [t.id, t]));

    // lineComputations[termId] = [{ detailIndex, amount }, ...]
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

    // Pass 2: apply any Summary-level override - redistribute
    // proportionally across the lines that carry this term, preserving
    // each line's ORIGINAL relative share. If the original total was
    // zero (e.g. a suppressed term), split evenly instead.
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

router.get('/purchase-requisitions', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        await ensureDefaultFieldControls(tenantClient, req.auth.tenantId, 'purchase_requisition');
        const { data, error } = await tenantClient
            .from('purchase_requisitions')
            .select('*, vendor:vendor_ledger_id(account_name), warehouse:warehouse_id(warehouse_name), branches(branch_name)')
            .eq('tenant_id', req.auth.tenantId)
            .order('doc_date', { ascending: false });
        if (error) throw error;
        // FEATURE: snapshot wins for display - only falls back to a live
        // join for records saved BEFORE this snapshot feature existed
        // (where the snapshot columns are still NULL).
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

router.get('/purchase-requisitions/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('purchase_requisitions')
            .select('*, details:purchase_requisition_details(*)')
            .eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Requisition not found' });

        // FIX: document_billing_terms lives in its own shared table, not
        // as a column here - without this, re-opening a saved
        // requisition would show no Billing Terms checked even if some
        // were applied when it was created.
        const { data: appliedTerms } = await tenantClient
            .from('document_billing_terms').select('billing_term_id').eq('document_type', 'purchase_requisition').eq('document_id', req.params.id);
        data.billing_term_ids = (appliedTerms || []).map(t => t.billing_term_id);

        // FEATURE: per-line ("Product Term") selections - fold each
        // detail's own applied billing_term_ids back onto its row so the
        // edit form's Product Term popup can pre-select them.
        const { data: lineTerms } = await tenantClient
            .from('document_line_billing_terms').select('detail_id, billing_term_id').eq('document_type', 'purchase_requisition').eq('document_id', req.params.id);
        if (data.details) {
            data.details = data.details.map(d => ({
                ...d, billing_term_ids: (lineTerms || []).filter(lt => lt.detail_id === d.id).map(lt => lt.billing_term_id)
            }));
        }

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/purchase-requisitions', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const validationError = validateBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_requisition', req.body, false);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const acctError = await checkAccountPurposes(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.body, { goods_account_ledger_id: 'purchase_goods' });
        if (acctError) return res.status(400).json({ success: false, error: acctError });
        const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'purchase', req.body, false);
        if (companyError) return res.status(400).json({ success: false, error: companyError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;

        // FEATURE: Branch is NEVER taken from the client - always the
        // logged-in user's own default_branch_id, so there is no Branch
        // picker on the transaction Master at all.
        const { data: currentUser } = await tenantClient.from('users').select('default_branch_id').eq('id', req.auth.userId).single();
        let branchNameSnapshot = null;
        if (currentUser?.default_branch_id) {
            const { data: branch } = await tenantClient.from('branches').select('branch_name').eq('id', currentUser.default_branch_id).maybeSingle();
            branchNameSnapshot = branch?.branch_name || null;
        }

        const { data: currentFy } = await tenantClient.from('fiscal_years').select('id, fiscal_year_name').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();

        // FEATURE: Document Numbering - Manual/Auto, Global/Branch-wise/
        // User-wise, Prefix/Suffix/Digits/Start-End/FY, per a configured
        // category (or the tenant's default one). Falls back to the
        // plain 12-char pattern if no category has been set up yet.
        let docNo;
        try {
            docNo = await resolveDocumentNumber(tenantClient, {
                tenantId, voucherType: 'purchase_requisition', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'purchase_requisitions',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_purchase_requisition_code', type_prefix: 'PREQ' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('purchase_requisitions')
            .insert({
                vendor_sub_ledger_id: b.vendor_sub_ledger_id || null,
                product_company_id: b.product_company_id || null,
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null,
                branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                vendor_ledger_id: b.vendor_ledger_id || null, agent_id: b.agent_id || null,
                ...snapshots,
                invoice_type: b.invoice_type || 'credit', currency: b.currency || 'NPR',
                due_date: b.due_date || null, due_days: b.due_days || null,
                warehouse_id: b.warehouse_id || null,
                goods_account_ledger_id: b.goods_account_ledger_id || null, goods_sub_ledger_id: b.goods_sub_ledger_id || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null,
                cash_vendor_name: b.invoice_type === 'cash' ? (b.cash_vendor_name || null) : null,
                cash_billing_details: b.cash_billing_details || null,
                rate_type: b.rate_type || 'exclusive',
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                area_id: b.area_id || null, route_id: b.route_id || null,
                priority: b.priority || 'normal', expected_delivery_date: b.expected_delivery_date || null,
                terms_conditions_id: b.terms_conditions_id || null, narration: b.narration || null,
                status: b.status || 'draft',
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) {
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the requisition fields' });
            throw error;
        }

        try {
            const { total, detailIdByIndex } = await syncDetails(tenantClient, tenantId, doc.id, b.details);
            const totalQty = b.details.reduce((sum, d) => sum + (Number(d.qty) || 0), 0);
            const documentAdjustment = await syncBillingTerms(tenantClient, tenantId, 'purchase_requisition', doc.id, b.billing_term_ids, total, totalQty);
            const lineTermResult = await syncLineBillingTerms(tenantClient, tenantId, 'purchase_requisition', doc.id, b.details, detailIdByIndex, b.summary_overrides);
            await applyTermSubLedgers(tenantClient, tenantId, 'purchase_requisition', doc.id, b.term_sub_ledgers);
            await tenantClient.from('purchase_requisitions').update({ total_amount: total + documentAdjustment + lineTermResult.total }).eq('id', doc.id);
        } catch (syncErr) {
            // FIX: deleting only the Master row was incomplete -
            // purchase_requisition_details cascades via its real FK, but
            // document_billing_terms/document_line_billing_terms are
            // POLYMORPHIC (document_type + document_id, no actual FK), so
            // CASCADE never touches them. A failure partway through this
            // try block (e.g. line-term sync fails after details already
            // saved) would have left those two orphaned. Clean up every
            // table this save could have touched, not just the parent.
            await tenantClient.from('document_line_billing_terms').delete().eq('document_type', 'purchase_requisition').eq('document_id', doc.id);
            await tenantClient.from('document_billing_terms').delete().eq('document_type', 'purchase_requisition').eq('document_id', doc.id);
            await tenantClient.from('purchase_requisitions').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save line items' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_purchase_requisition', 'purchase_requisition', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'purchase_requisition', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Requisition ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/purchase-requisitions/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('purchase_requisitions').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Requisition not found' });
        if (['closed', 'cancelled'].includes(existing.status)) return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} requisition` });

        const b = req.body;
        if (b.details) {
            const validationError = validateBody(b);
            if (validationError) return res.status(400).json({ success: false, error: validationError });
            const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_requisition', b, false);
            if (fieldError) return res.status(400).json({ success: false, error: fieldError });
            const acctError = await checkAccountPurposes(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.body, { goods_account_ledger_id: 'purchase_goods' });
            if (acctError) return res.status(400).json({ success: false, error: acctError });
            const companyError = await checkProductCompany(await getTenantClient(req.auth.tenantId), req.auth.tenantId, 'purchase', b, false);
            if (companyError) return res.status(400).json({ success: false, error: companyError });
        }

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'purchase_requisition', b, existing);

        const update = { ...b, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        // FIX: Branch is set once at creation from the user's own
        // default_branch_id and never client-editable afterward either.
        delete update.branch_id;
        delete update.billing_term_ids;
        delete update.details;
        const { data, error } = await tenantClient.from('purchase_requisitions').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const { total, detailIdByIndex } = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            const totalQty = b.details.reduce((sum, d) => sum + (Number(d.qty) || 0), 0);
            const documentAdjustment = await syncBillingTerms(tenantClient, tenantId, 'purchase_requisition', req.params.id, b.billing_term_ids, total, totalQty);
            const lineTermResult = await syncLineBillingTerms(tenantClient, tenantId, 'purchase_requisition', req.params.id, b.details, detailIdByIndex, b.summary_overrides);
            await applyTermSubLedgers(tenantClient, tenantId, 'purchase_requisition', req.params.id, b.term_sub_ledgers);
            await tenantClient.from('purchase_requisitions').update({ total_amount: total + documentAdjustment + lineTermResult.total }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_purchase_requisition', 'purchase_requisition', req.params.id, { old_data: existing, new_data: data });
        const changes = diffFields(existing, b, [
            'doc_date', 'vendor_ledger_id', 'agent_id', 'invoice_type', 'currency', 'due_date', 'due_days',
            'warehouse_id', 'goods_account_ledger_id', 'goods_sub_ledger_id', 'remarks_text', 'rate_type',
            'cost_center_id', 'business_unit_id', 'area_id', 'route_id', 'priority', 'expected_delivery_date', 'narration'
        ]);
        await logDocumentAudit(tenantClient, tenantId, 'purchase_requisition', req.params.id, 'update', req.auth.userId, changes);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/purchase-requisitions/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status } = req.body;
        if (!['draft', 'pending_approval', 'approved', 'rejected', 'closed', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data, error } = await tenantClient.from('purchase_requisitions').update({ status, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'change_requisition_status', 'purchase_requisition', req.params.id, { new_status: status });
        await logDocumentAudit(tenantClient, tenantId, 'purchase_requisition', req.params.id, 'status_change', req.auth.userId, [{ field_key: 'status', new_value: status }]);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/purchase-requisitions/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail')
            .select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'purchase_requisition').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
