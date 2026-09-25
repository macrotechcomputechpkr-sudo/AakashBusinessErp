// =============================================
// routes/stockAdjustmentRoutes.js
// Stock Adjustment - shortage / damage / expiry / excess / physical count
// corrections. Draft -> Approved -> Posted -> Cancelled, like Stock
// Transfer. Posting writes stock_movements (source 'stock_adjustment': a
// decrease is an issue, an increase a receipt at the line's cost) and,
// when System Control turns it on, one GL entry:
//   decrease  Dr Stock Shortage / Damage (expense)  Cr Stock Adjustment
//   increase  Dr Stock Adjustment                   Cr Stock Excess (income)
// (why: utils/stockAccounting.js). Also serves the current cost / on-hand
// lookup the stock entry screens use.
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { toBaseUnitQty } = require('../utils/unitConversion');
const stockAcc = require('../utils/stockAccounting');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const REASONS = ['physical_count', 'shortage', 'damage', 'expiry', 'excess', 'other'];
const PROTECTED = ['gl_posted', 'posted_by', 'posted_at', 'approved_by', 'approved_at', 'cancelled_by', 'cancelled_at', 'status', 'doc_no', 'tenant_id', 'id',
    'created_by', 'created_at', 'total_in_amount', 'total_out_amount', 'branch_id', 'details', 'save_as_draft', 'numbering_category_id'];
const fail = (res, msg, status = 400) => res.status(status).json({ success: false, error: msg });

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (b.reason && !REASONS.includes(b.reason)) return 'Invalid reason';
    if (isDraft) return null;
    if (!Array.isArray(b.details) || b.details.length === 0) return 'At least one line is required';
    for (const [i, d] of b.details.entries()) {
        if (!d.product_id) return `Line ${i + 1}: choose a Product`;
        if (!['in', 'out'].includes(d.direction)) return `Line ${i + 1}: choose Increase or Decrease`;
        if (!(Number(d.qty) > 0)) return `Line ${i + 1}: Qty must be greater than zero`;
        if (Number(d.rate) < 0) return `Line ${i + 1}: Rate cannot be negative`;
        if (!(d.warehouse_id || b.warehouse_id)) return `Line ${i + 1}: choose a Warehouse`;
    }
    return null;
}

async function snapshotsFor(c, b) {
    const [wh] = await Promise.all([b.warehouse_id ? c.from('warehouses').select('warehouse_name').eq('id', b.warehouse_id).maybeSingle() : { data: null }]);
    return { warehouse_name_snapshot: wh.data?.warehouse_name || null };
}

async function syncDetails(c, t, adjustmentId, doc, details) {
    await c.from('stock_adjustment_details').delete().eq('adjustment_id', adjustmentId);
    if (!Array.isArray(details) || !details.length) return { in: 0, out: 0 };
    const ids = arr => [...new Set(arr.filter(Boolean))];
    const [prods, units, whs] = await Promise.all([
        c.from('products').select('id, product_name').in('id', ids(details.map(d => d.product_id))),
        c.from('product_units').select('id, unit_name').in('id', ids(details.map(d => d.uom_id)).concat(['00000000-0000-0000-0000-000000000000'])),
        c.from('warehouses').select('id, warehouse_name').in('id', ids(details.map(d => d.warehouse_id || doc.warehouse_id)).concat(['00000000-0000-0000-0000-000000000000']))
    ]);
    const nm = (r, k) => Object.fromEntries((r.data || []).map(x => [x.id, x[k]]));
    const pn = nm(prods, 'product_name'), un = nm(units, 'unit_name'), wn = nm(whs, 'warehouse_name');
    const rows = details.map((d, i) => {
        const qty = Number(d.qty) || 0, rate = Number(d.rate) || 0, wh = d.warehouse_id || doc.warehouse_id || null;
        return {
            tenant_id: t, adjustment_id: adjustmentId, display_order: i + 1,
            product_id: d.product_id, warehouse_id: wh, batch_no: d.batch_no || null, mfg_date: d.mfg_date || null, exp_date: d.exp_date || null,
            direction: d.direction === 'in' ? 'in' : 'out', uom_id: d.uom_id || null,
            system_qty: d.system_qty === '' || d.system_qty == null ? null : Number(d.system_qty),
            physical_qty: d.physical_qty === '' || d.physical_qty == null ? null : Number(d.physical_qty),
            qty, rate, amount: round2(qty * rate), line_reason: REASONS.includes(d.line_reason) ? d.line_reason : null, narration: d.narration || null,
            product_name_snapshot: pn[d.product_id] || null, uom_name_snapshot: un[d.uom_id] || null, warehouse_name_snapshot: wn[wh] || null
        };
    });
    const { error } = await c.from('stock_adjustment_details').insert(rows);
    if (error) throw error;
    return { in: round2(rows.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount, 0)), out: round2(rows.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount, 0)) };
}

async function checkNegativeStock(c, t, doc, details) {
    const { data: sc } = await c.from('system_control_settings').select('negative_stock_control').eq('tenant_id', t).maybeSingle();
    const control = sc?.negative_stock_control || 'warn';
    if (control === 'none') return { blocked: false, warnings: [] };
    const warnings = [];
    for (const d of details.filter(x => x.direction === 'out')) {
        const wh = d.warehouse_id || doc.warehouse_id;
        let q = c.from('v_current_stock').select('on_hand_qty').eq('tenant_id', t).eq('product_id', d.product_id).eq('warehouse_id', wh);
        q = d.batch_no ? q.eq('batch_no', d.batch_no) : q.is('batch_no', null);
        const { data: row } = await q.maybeSingle();
        const available = Number(row?.on_hand_qty) || 0;
        const baseQty = await toBaseUnitQty(c, d.product_id, d.qty, d.uom_id);
        if (available - baseQty < -1e-9) warnings.push(`${d.product_name_snapshot || d.product_id}: available ${available} (base unit) in ${d.warehouse_name_snapshot || wh}, reducing ${baseQty} - would go negative`);
    }
    return { blocked: warnings.length > 0 && control === 'block', warnings };
}

async function postStock(c, t, doc, details) {
    const rows = [];
    for (const d of details) {
        const baseQty = await toBaseUnitQty(c, d.product_id, d.qty, d.uom_id);
        const unitCost = baseQty > 0 ? Number(d.amount) / baseQty : 0;     // cost per BASE unit
        rows.push({ tenant_id: t, product_id: d.product_id, warehouse_id: d.warehouse_id || doc.warehouse_id, batch_no: d.batch_no || null, movement_date: doc.doc_date,
            qty_in: d.direction === 'in' ? baseQty : 0, qty_out: d.direction === 'out' ? baseQty : 0, unit_cost: unitCost,
            source_type: 'stock_adjustment', source_id: doc.id, source_detail_id: d.id, narration: `Adjustment ${doc.doc_no} (${d.line_reason || doc.reason})` });
    }
    if (rows.length) { const { error } = await c.from('stock_movements').insert(rows); if (error) throw error; }
}
const reverseStock = (c, id) => c.from('stock_movements').delete().eq('source_type', 'stock_adjustment').eq('source_id', id);

async function postGl(c, t, doc, details, acc, userId) {
    if (!acc.posts) return false;
    const lines = [];
    details.forEach(d => {
        const amt = Number(d.amount) || 0; if (!amt) return;
        const what = `${d.product_name_snapshot || ''} ${d.line_reason || doc.reason}`.trim();
        if (d.direction === 'out') lines.push({ ledgerId: acc.lossFor(d), dr: amt, narration: what }, { ledgerId: acc.contra_ledger_id, cr: amt, narration: what });
        else lines.push({ ledgerId: acc.contra_ledger_id, dr: amt, narration: what }, { ledgerId: acc.gain_ledger_id, cr: amt, narration: what });
    });
    const id = await stockAcc.postGlBatch(c, t, { documentType: 'stock_adjustment', documentId: doc.id, date: doc.doc_date,
        narration: doc.narration || `Stock Adjustment ${doc.doc_no}`, lines, userId });
    return !!id;
}

async function audit(c, t, id, action, userId) {
    const { error } = await c.from('document_audit_trail').insert({ tenant_id: t, document_type: 'stock_adjustment', document_id: id, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

// ---------------- lookups ----------------
router.get('/stock-adjustment-accounts', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        res.json({ success: true, data: await stockAcc.adjustmentAccounts(c, req.auth.tenantId) });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});

// Current cost (per base unit and per the chosen unit) and on-hand qty, for
// filling Rate / System Qty on stock entries.
router.get('/stock/current-cost', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { product_id, date, uom_id, warehouse_id, batch_no } = req.query;
        if (!product_id) return fail(res, 'product_id is required');
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const cost = await stockAcc.currentCost(c, t, product_id, date || new Date().toISOString().slice(0, 10));
        const factor = uom_id ? await toBaseUnitQty(c, product_id, 1, uom_id) : 1;       // base units in one uom
        let warehouseQty = null;
        if (warehouse_id) {
            let q = c.from('v_current_stock').select('on_hand_qty').eq('tenant_id', t).eq('product_id', product_id).eq('warehouse_id', warehouse_id);
            q = batch_no ? q.eq('batch_no', batch_no) : q.is('batch_no', null);
            const { data } = await q.maybeSingle();
            warehouseQty = Number(data?.on_hand_qty) || 0;
        }
        res.json({ success: true, data: {
            rate_base: round2(cost.rate), rate: round2(cost.rate * factor), factor, source: cost.source,
            on_hand_base: cost.on_hand, warehouse_on_hand_base: warehouseQty, warehouse_on_hand: warehouseQty === null ? null : Math.round(warehouseQty / factor * 10000) / 10000
        } });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});

// ---------------- CRUD ----------------
router.get('/stock-adjustments', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const { data, error } = await c.from('stock_adjustments').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/stock-adjustments/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const { data, error } = await c.from('stock_adjustments').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return fail(res, 'Stock Adjustment not found', 404);
        const { data: details } = await c.from('stock_adjustment_details').select('*').eq('adjustment_id', req.params.id).order('display_order');
        data.details = details || [];
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/stock-adjustments', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const t = req.auth.tenantId, c = await getTenantClient(t), b = req.body;
        const isDraft = b.save_as_draft === true;
        const err = validateBody(b, isDraft);
        if (err) return fail(res, err);

        const { data: user } = await c.from('users').select('default_branch_id').eq('id', req.auth.userId).single();
        const { data: branch } = user?.default_branch_id ? await c.from('branches').select('branch_name').eq('id', user.default_branch_id).maybeSingle() : { data: null };
        const { data: fy } = await c.from('fiscal_years').select('id, fiscal_year_name').eq('tenant_id', t).eq('is_current', true).maybeSingle();
        let docNo;
        try {
            docNo = await resolveDocumentNumber(c, { tenantId: t, voucherType: 'stock_adjustment', userId: req.auth.userId, categoryId: b.numbering_category_id, manualNumber: b.doc_no,
                tableName: 'stock_adjustments', currentFiscalYearId: fy?.id, currentFiscalYearName: fy?.fiscal_year_name, userDefaultBranchId: user?.default_branch_id });
        } catch (numErr) { return fail(res, numErr.message); }
        if (!docNo) {
            const { data: code, error: codeErr } = await c.rpc('next_master_code', { seq_name: 'tenant_master.seq_stock_adjustment_code', type_prefix: 'STAD' });
            if (codeErr) throw codeErr;
            docNo = code;
        }
        const { data: doc, error } = await c.from('stock_adjustments').insert({
            tenant_id: t, branch_id: user?.default_branch_id || null, branch_name_snapshot: branch?.branch_name || null,
            doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: fy?.id || null, warehouse_id: b.warehouse_id || null, reason: b.reason || 'physical_count',
            narration: b.narration || null, cost_center_id: b.cost_center_id || null,
            loss_ledger_id: b.loss_ledger_id || null, gain_ledger_id: b.gain_ledger_id || null, contra_ledger_id: b.contra_ledger_id || null,
            ...(await snapshotsFor(c, b)), status: 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
        }).select().single();
        if (error) throw error;
        try {
            const tot = await syncDetails(c, t, doc.id, doc, b.details || []);
            await c.from('stock_adjustments').update({ total_in_amount: tot.in, total_out_amount: tot.out }).eq('id', doc.id);
        } catch (syncErr) {
            await c.from('stock_adjustments').delete().eq('id', doc.id);
            return fail(res, syncErr.message || 'Could not save adjustment lines');
        }
        await logAudit(t, req.auth.userId, 'create_stock_adjustment', 'stock_adjustment', doc.id, { doc_no: doc.doc_no });
        await audit(c, t, doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Stock Adjustment ${doc.doc_no} saved`, data: doc });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.put('/stock-adjustments/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const t = req.auth.tenantId, c = await getTenantClient(t), b = req.body;
        const { data: existing } = await c.from('stock_adjustments').select('*').eq('id', req.params.id).eq('tenant_id', t).single();
        if (!existing) return fail(res, 'Stock Adjustment not found', 404);
        if (['posted', 'cancelled'].includes(existing.status)) return fail(res, `Cannot edit a ${existing.status} adjustment`);
        const merged = { ...existing, ...b };
        const err = validateBody({ ...merged, details: b.details }, b.save_as_draft === true || !b.details);
        if (err) return fail(res, err);
        const update = { ...b, ...(await snapshotsFor(c, merged)), updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        PROTECTED.forEach(k => delete update[k]);
        const { data, error } = await c.from('stock_adjustments').update(update).eq('id', req.params.id).eq('tenant_id', t).select().single();
        if (error) throw error;
        if (b.details) {
            const tot = await syncDetails(c, t, req.params.id, data, b.details);
            await c.from('stock_adjustments').update({ total_in_amount: tot.in, total_out_amount: tot.out }).eq('id', req.params.id);
        }
        await logAudit(t, req.auth.userId, 'update_stock_adjustment', 'stock_adjustment', req.params.id, { old_data: existing, new_data: data });
        await audit(c, t, req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.put('/stock-adjustments/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'approved', 'posted', 'cancelled'].includes(status)) return fail(res, 'Invalid status');
        if (status === 'cancelled' && !cancellation_reason) return fail(res, 'A cancellation reason is required');
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const { data: existing } = await c.from('stock_adjustments').select('*').eq('id', req.params.id).eq('tenant_id', t).single();
        if (!existing) return fail(res, 'Stock Adjustment not found', 404);
        if (existing.status === 'cancelled') return fail(res, 'This adjustment is already cancelled');
        if (existing.status === 'posted' && status !== 'cancelled') return fail(res, 'A posted adjustment can only be cancelled');
        const { data: details } = await c.from('stock_adjustment_details').select('*').eq('adjustment_id', existing.id).order('display_order');

        let warnings = [], acc = null;
        if (['approved', 'posted'].includes(status)) {
            const err = validateBody({ ...existing, details: details || [] }, false);
            if (err) return fail(res, err);
        }
        if (status === 'posted') {
            acc = await stockAcc.finalAdjustmentAccounts(c, t, existing);
            warnings = await stockAcc.checkAdjustmentAccounts(c, t, acc, details || []);
            const neg = await checkNegativeStock(c, t, existing, details || []);
            if (neg.blocked && !req.body.override_negative_stock_warning) return res.status(400).json({ success: false, error: 'Insufficient stock to post this adjustment', warnings: neg.warnings });
            warnings = [...warnings, ...neg.warnings];
            if (acc.posts && (details || []).some(d => !(Number(d.amount) > 0))) warnings.push('Lines without a rate have no value, so they are not in the GL entry');
        }

        const update = { status, updated_by: req.auth.userId };
        const now = new Date().toISOString();
        if (status === 'approved') Object.assign(update, { approved_by: req.auth.userId, approved_at: now });
        if (status === 'posted') Object.assign(update, { posted_by: req.auth.userId, posted_at: now, contra_ledger_id: acc.contra_ledger_id, gain_ledger_id: acc.gain_ledger_id });
        if (status === 'cancelled') Object.assign(update, { cancellation_reason, cancelled_by: req.auth.userId, cancelled_at: now });
        const { data, error } = await c.from('stock_adjustments').update(update).eq('id', existing.id).eq('tenant_id', t).select().single();
        if (error) throw error;

        if (status === 'posted') {
            try {
                await postStock(c, t, data, details || []);
                const gl = await postGl(c, t, data, details || [], acc, req.auth.userId);
                if (gl) await c.from('stock_adjustments').update({ gl_posted: true }).eq('id', data.id);
                data.gl_posted = gl;
            } catch (postErr) {
                await reverseStock(c, existing.id);
                await stockAcc.reverseGlBatches(c, ['stock_adjustment'], existing.id);
                await c.from('stock_adjustments').update({ status: existing.status, posted_by: null, posted_at: null }).eq('id', existing.id);
                throw postErr;
            }
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseStock(c, existing.id);
            await stockAcc.reverseGlBatches(c, ['stock_adjustment'], existing.id);
            await c.from('stock_adjustments').update({ gl_posted: false }).eq('id', existing.id);
        }
        await logAudit(t, req.auth.userId, 'change_stock_adjustment_status', 'stock_adjustment', existing.id, { new_status: status, cancellation_reason });
        await audit(c, t, existing.id, 'status_change', req.auth.userId);
        res.json({ success: true, data, warnings: warnings.length ? warnings : undefined });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});

router.delete('/stock-adjustments/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const { data: existing } = await c.from('stock_adjustments').select('*').eq('id', req.params.id).eq('tenant_id', t).single();
        if (!existing) return fail(res, 'Stock Adjustment not found', 404);
        if (existing.status !== 'draft') return fail(res, 'Only a Draft can be deleted - use Cancel for an approved/posted adjustment');
        const { error } = await c.from('stock_adjustments').delete().eq('id', existing.id).eq('tenant_id', t);
        if (error) throw error;
        await logAudit(t, req.auth.userId, 'delete_draft_stock_adjustment', 'stock_adjustment', existing.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/stock-adjustments/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const { data, error } = await c.from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'stock_adjustment').eq('document_id', req.params.id).order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
