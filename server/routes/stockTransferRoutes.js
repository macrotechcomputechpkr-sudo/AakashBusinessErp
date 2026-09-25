// =============================================
// routes/stockTransferRoutes.js
// Warehouse-to-warehouse and branch-to-branch movement with a 3-stage
// workflow (draft -> approved -> posted -> cancelled). Only POSTING
// actually writes to the stock_movements ledger - a draft or even an
// approved transfer hasn't really moved anything yet.
// Branch transfer: each side is one of that branch's warehouses
// (branch_warehouse_mapping). With System Control "Branch transfer
// receipt = In Transit", Post only dispatches (stock leaves the source
// warehouse) and Receive brings it into the destination on the receiving
// date. Optional GL posting: utils/stockAccounting.js.
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { toBaseUnitQty } = require('../utils/unitConversion');
const { toBaseQtyFromDual, computeDualAmount, getDualUomMode } = require('../utils/dualUomCalculation');
const stockAcc = require('../utils/stockAccounting');

async function resolveBaseQtyAndCost(tenantClient, d) {
    const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
    if (product?.uom_mode === 'fixed_dual' && d.alt_qty) {
        const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
        const conversionFactor = Number(unitRate?.conversion_factor) || 1;
        const baseQty = toBaseQtyFromDual(d.qty, d.alt_qty, conversionFactor, await getDualUomMode(tenantClient));
        const unitCost = d.rate_basis === 'primary' ? Number(d.cost_rate || 0) / conversionFactor : Number(d.cost_rate || 0);
        return { baseQty, unitCost };
    }
    const baseQty = await toBaseUnitQty(tenantClient, d.product_id, d.qty, d.uom_id);
    return { baseQty, unitCost: d.cost_rate || 0 };
}

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!b.from_warehouse_id) return 'From Warehouse is required';
    if (!b.to_warehouse_id) return 'To Warehouse is required';
    if (b.from_warehouse_id === b.to_warehouse_id) return 'From and To Warehouse must be different';
    if (b.transfer_type === 'branch') {
        if (!b.from_branch_id || !b.to_branch_id) return 'From Branch and To Branch are required for a branch transfer';
        if (b.from_branch_id === b.to_branch_id) return 'From and To Branch must be different - use a warehouse transfer within one branch';
    }
    if (!Array.isArray(b.details) || b.details.length === 0) return 'At least one line item is required';
    for (const d of b.details) {
        if (!d.product_id) return 'Every line needs a Product';
        // Dual-unit lines may be secondary-only (0 Carton + 7 Pcs); neither may be negative.
        if (Number(d.qty) < 0 || Number(d.alt_qty) < 0) return 'Qty cannot be negative';
        if (!(Number(d.qty) > 0) && !(Number(d.alt_qty) > 0)) return 'Every line needs a Qty greater than zero';
    }
    return null;
}

// Branch transfer: every From warehouse (header and line overrides) must be one
// of the From branch's warehouses, every To warehouse one of the To branch's.
// A branch with no warehouse mapping at all is not restricted.
async function checkBranchWarehouses(tenantClient, tenantId, doc, details) {
    if (doc.transfer_type !== 'branch') return null;
    const { data: maps } = await tenantClient.from('branch_warehouse_mapping').select('branch_id, warehouse_id')
        .eq('tenant_id', tenantId).eq('is_active', true).in('branch_id', [doc.from_branch_id, doc.to_branch_id]);
    const of = branchId => (maps || []).filter(m => m.branch_id === branchId).map(m => m.warehouse_id);
    const fromWhs = of(doc.from_branch_id), toWhs = of(doc.to_branch_id);
    const { data: whs } = await tenantClient.from('warehouses').select('id, warehouse_name').eq('tenant_id', tenantId);
    const name = id => (whs || []).find(w => w.id === id)?.warehouse_name || id;
    const froms = [doc.from_warehouse_id, ...details.map(d => d.from_warehouse_id)].filter(Boolean);
    const tos = [doc.to_warehouse_id, ...details.map(d => d.to_warehouse_id)].filter(Boolean);
    const badFrom = fromWhs.length ? froms.filter(w => !fromWhs.includes(w)) : [];
    const badTo = toWhs.length ? tos.filter(w => !toWhs.includes(w)) : [];
    if (badFrom.length) return `Warehouse ${[...new Set(badFrom)].map(name).join(', ')} does not belong to the From Branch`;
    if (badTo.length) return `Warehouse ${[...new Set(badTo)].map(name).join(', ')} does not belong to the To Branch`;
    const cross = froms.filter(w => tos.includes(w));
    if (cross.length) return `Warehouse ${name(cross[0])} is on both sides of the transfer`;
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.from_warehouse_id && tenantClient.from('warehouses').select('warehouse_name').eq('id', b.from_warehouse_id).maybeSingle(),
        b.to_warehouse_id && tenantClient.from('warehouses').select('warehouse_name').eq('id', b.to_warehouse_id).maybeSingle(),
        b.to_branch_id && tenantClient.from('branches').select('branch_name').eq('id', b.to_branch_id).maybeSingle(),
        b.transport_id && tenantClient.from('transport_master').select('transport_name').eq('id', b.transport_id).maybeSingle(),
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle(),
        b.from_branch_id && tenantClient.from('branches').select('branch_name').eq('id', b.from_branch_id).maybeSingle()
    ];
    const [fromWh, toWh, toBranch, transport, costCenter, businessUnit, fromBranch] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        from_branch_name_snapshot: fromBranch.data?.branch_name || null,
        from_warehouse_name_snapshot: fromWh.data?.warehouse_name || null,
        to_warehouse_name_snapshot: toWh.data?.warehouse_name || null,
        to_branch_name_snapshot: toBranch.data?.branch_name || null,
        transport_name_snapshot: transport.data?.transport_name || null,
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

async function captureDetailSnapshots(tenantClient, d, masterFromWh, masterToWh) {
    const productLookup = d.product_id ? tenantClient.from('products').select('product_name').eq('id', d.product_id).maybeSingle() : Promise.resolve({ data: null });
    const uomLookup = d.uom_id ? tenantClient.from('product_units').select('unit_name').eq('id', d.uom_id).maybeSingle() : Promise.resolve({ data: null });
    const altUnitLookup = d.alt_unit_id ? tenantClient.from('product_units').select('unit_name').eq('id', d.alt_unit_id).maybeSingle() : Promise.resolve({ data: null });
    const fromWhId = d.from_warehouse_id || masterFromWh;
    const toWhId = d.to_warehouse_id || masterToWh;
    const fromWhLookup = fromWhId ? tenantClient.from('warehouses').select('warehouse_name').eq('id', fromWhId).maybeSingle() : Promise.resolve({ data: null });
    const toWhLookup = toWhId ? tenantClient.from('warehouses').select('warehouse_name').eq('id', toWhId).maybeSingle() : Promise.resolve({ data: null });
    const [product, uom, altUnit, fromWh, toWh] = await Promise.all([productLookup, uomLookup, altUnitLookup, fromWhLookup, toWhLookup]);
    return {
        product_name_snapshot: product.data?.product_name || null,
        uom_name_snapshot: uom.data?.unit_name || null,
        alt_unit_name_snapshot: altUnit.data?.unit_name || null,
        from_warehouse_name_snapshot: fromWh.data?.warehouse_name || null,
        to_warehouse_name_snapshot: toWh.data?.warehouse_name || null
    };
}

async function syncDetails(tenantClient, tenantId, transferId, details, masterFromWh, masterToWh) {
    await tenantClient.from('stock_transfer_details').delete().eq('transfer_id', transferId);
    if (!Array.isArray(details) || details.length === 0) return 0;
    const rows = await Promise.all(details.map(async (d, i) => {
        const qty = Number(d.qty) || 0, costRate = Number(d.cost_rate) || 0;
        const snapshots = await captureDetailSnapshots(tenantClient, d, masterFromWh, masterToWh);
        let amount;
        if (d.alt_qty) {
            const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id').eq('id', d.product_id).maybeSingle();
            if (product?.uom_mode === 'fixed_dual') {
                const { data: unitRate } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', d.product_id).eq('unit_id', product.dual_uom_primary_unit_id).maybeSingle();
                amount = computeDualAmount(d.qty, d.alt_qty, d.cost_rate, d.rate_basis || 'primary', Number(unitRate?.conversion_factor) || 1, await getDualUomMode(tenantClient));
            } else {
                amount = qty * costRate;
            }
        } else {
            amount = qty * costRate;
        }
        return {
            tenant_id: tenantId, transfer_id: transferId, display_order: i + 1,
            product_id: d.product_id, batch_no: d.batch_no || null, mfg_date: d.mfg_date || null, exp_date: d.exp_date || null,
            from_warehouse_id: d.from_warehouse_id || null, to_warehouse_id: d.to_warehouse_id || null,
            qty, free_qty: d.free_qty || 0, uom_id: d.uom_id || null,
            alt_qty: d.alt_qty || null, alt_unit_id: d.alt_unit_id || null, conv_factor: d.conv_factor || null, rate_basis: d.rate_basis || 'primary',
            cost_rate: costRate, mrp: d.mrp || null, sell_rate: d.sell_rate || null, amount,
            narration: d.narration || null,
            ...snapshots
        };
    }));
    const { error } = await tenantClient.from('stock_transfer_details').insert(rows);
    if (error) throw error;
    return rows.reduce((s, r) => s + Number(r.amount), 0);
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

// FEATURE: "Negative Stock Control" - before actually moving stock OUT
// of a warehouse, check whether it has enough on hand. 'none' skips the
// check, 'warn' returns warnings but still allows posting, 'block'
// prevents posting entirely until fixed.
async function checkNegativeStock(tenantClient, tenantId, transfer, details) {
    const { data: sysControl } = await tenantClient.from('system_control_settings').select('negative_stock_control').eq('tenant_id', tenantId).maybeSingle();
    const control = sysControl?.negative_stock_control || 'warn';
    if (control === 'none') return { blocked: false, warnings: [] };

    const warnings = [];
    for (const d of details) {
        const fromWh = d.from_warehouse_id || transfer.from_warehouse_id;
        let query = tenantClient.from('v_current_stock').select('on_hand_qty').eq('tenant_id', tenantId).eq('product_id', d.product_id).eq('warehouse_id', fromWh);
        query = d.batch_no ? query.eq('batch_no', d.batch_no) : query.is('batch_no', null);
        const { data: stockRow } = await query.maybeSingle();
        const available = Number(stockRow?.on_hand_qty) || 0;
        const { baseQty } = await resolveBaseQtyAndCost(tenantClient, d);
        if (available - baseQty < 0) {
            warnings.push(`${d.product_name_snapshot || d.product_id}: available ${available} (base unit), transferring ${baseQty} from ${d.from_warehouse_name_snapshot || fromWh} - would go negative`);
        }
    }
    return { blocked: warnings.length > 0 && control === 'block', warnings };
}

// FEATURE: "logic mistake found comparing against other ERPs' multi-
// unit handling" - a stock ledger MUST be unit-agnostic (a product's
// on-hand quantity is one number, regardless of which unit a given
// transaction happened to use), so every movement written here is
// converted to the product's own BASE unit first (toBaseUnitQty,
// shared with Production). Without this, "5 Cartons out" and "60
// Pieces in" would look like two unrelated quantities instead of the
// same physical stock.
// side: 'both' (direct), 'out' (dispatch of a two-step transfer), 'in' (its receipt on `date`).
async function postStockMovements(tenantClient, tenantId, transfer, details, side = 'both', date = transfer.doc_date) {
    const rows = [];
    for (const d of details) {
        const fromWh = d.from_warehouse_id || transfer.from_warehouse_id;
        const toWh = d.to_warehouse_id || transfer.to_warehouse_id;
        const { baseQty, unitCost } = await resolveBaseQtyAndCost(tenantClient, d);
        if (side !== 'in') rows.push({ tenant_id: tenantId, product_id: d.product_id, warehouse_id: fromWh, batch_no: d.batch_no, movement_date: date, qty_out: baseQty, qty_in: 0, unit_cost: unitCost, source_type: 'stock_transfer', source_id: transfer.id, source_detail_id: d.id, narration: `Transfer ${transfer.doc_no} - ${side === 'out' ? 'dispatched' : 'out'}` });
        if (side !== 'out') rows.push({ tenant_id: tenantId, product_id: d.product_id, warehouse_id: toWh, batch_no: d.batch_no, movement_date: date, qty_in: baseQty, qty_out: 0, unit_cost: unitCost, source_type: 'stock_transfer', source_id: transfer.id, source_detail_id: d.id, narration: `Transfer ${transfer.doc_no} - ${side === 'in' ? 'received' : 'in'}` });
    }
    if (rows.length > 0) {
        const { error } = await tenantClient.from('stock_movements').insert(rows);
        if (error) throw error;
    }
}

async function reverseStockMovements(tenantClient, transferId) {
    await tenantClient.from('stock_movements').delete().eq('source_type', 'stock_transfer').eq('source_id', transferId);
}

// GL at the transfer's value (sum of line amounts = qty x cost rate).
//   direct:   Dr receiving  Cr sending
//   dispatch: Dr transit    Cr sending      receipt: Dr receiving  Cr transit
async function postTransferGl(tenantClient, tenantId, transfer, acc, step, userId, date) {
    const value = Math.round((Number(transfer.total_amount) || 0) * 100) / 100;
    if (!acc.posts || value <= 0) return false;
    const dr = step === 'dispatch' ? acc.transit_ledger_id : acc.dr_ledger_id;
    const cr = step === 'receipt' ? acc.transit_ledger_id : acc.cr_ledger_id;
    const route = `${transfer.from_warehouse_name_snapshot || ''} -> ${transfer.to_warehouse_name_snapshot || ''}`;
    const label = step === 'dispatch' ? 'dispatched (in transit)' : step === 'receipt' ? 'received' : 'transfer';
    const id = await stockAcc.postGlBatch(tenantClient, tenantId, {
        documentType: step === 'receipt' ? 'stock_transfer_receipt' : 'stock_transfer', documentId: transfer.id, date,
        narration: transfer.narration || `Stock Transfer ${transfer.doc_no} ${label} ${route}`, userId,
        lines: [{ ledgerId: dr, dr: value, narration: `Stock ${label} ${route}` }, { ledgerId: cr, cr: value, narration: `Stock ${label} ${route}` }]
    });
    return !!id;
}

// Fields the client may never set directly.
const PROTECTED = ['gl_posted', 'requires_receipt', 'received_date', 'received_by', 'received_at', 'receive_remarks', 'posted_by', 'posted_at', 'approved_by', 'approved_at',
    'cancelled_by', 'cancelled_at', 'status', 'doc_no', 'tenant_id', 'id', 'created_by', 'created_at', 'total_amount'];

// Accounts a transfer would post to (for the entry screen).
router.get('/stock-transfer-accounts', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        res.json({ success: true, data: await stockAcc.transferAccounts(tenantClient, req.auth.tenantId, req.query) });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

router.get('/stock-transfers', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('stock_transfers').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/stock-transfers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('stock_transfers').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Stock Transfer not found' });
        const { data: details } = await tenantClient.from('stock_transfer_details').select('*').eq('transfer_id', req.params.id).order('display_order');
        data.details = details || [];
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/stock-transfers', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'stock_transfer', req.body, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });

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
                tenantId, voucherType: 'stock_transfer', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, tableName: 'stock_transfers',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_stock_transfer_code', type_prefix: 'STRF' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const transferType = b.transfer_type === 'branch' ? 'branch' : 'warehouse';
        const fromBranchId = transferType === 'branch' ? (b.from_branch_id || currentUser?.default_branch_id || null) : null;
        if (!isDraft) {
            const branchError = await checkBranchWarehouses(tenantClient, tenantId, { ...b, transfer_type: transferType, from_branch_id: fromBranchId }, Array.isArray(b.details) ? b.details : []);
            if (branchError) return res.status(400).json({ success: false, error: branchError });
        }
        const snapshots = await captureMasterSnapshots(tenantClient, { ...b, from_branch_id: fromBranchId });

        const { data: doc, error } = await tenantClient
            .from('stock_transfers')
            .insert({
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                transfer_type: transferType, from_branch_id: fromBranchId,
                dr_ledger_id: b.dr_ledger_id || null, cr_ledger_id: b.cr_ledger_id || null, transit_ledger_id: b.transit_ledger_id || null,
                from_warehouse_id: b.from_warehouse_id || null, to_warehouse_id: b.to_warehouse_id || null,
                to_branch_id: b.to_branch_id || null, transport_id: b.transport_id || null,
                vehicle_no: b.vehicle_no || null, driver_name: b.driver_name || null,
                driver_license_no: b.driver_license_no || null, driver_contact_no: b.driver_contact_no || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                priority: b.priority || 'normal',
                ...snapshots,
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const total = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave, b.from_warehouse_id, b.to_warehouse_id);
            await tenantClient.from('stock_transfers').update({ total_amount: total }).eq('id', doc.id);
        } catch (syncErr) {
            await tenantClient.from('stock_transfer_details').delete().eq('transfer_id', doc.id);
            await tenantClient.from('stock_transfers').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save transfer lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_stock_transfer', 'stock_transfer', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'stock_transfer', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Stock Transfer ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/stock-transfers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('stock_transfers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Stock Transfer not found' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} transfer` });
        }

        // Readonly / disabled header fields keep their stored value (before snapshots + update).

        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'stock_transfer', b, existing);

        const merged = { ...existing, ...b };
        if (merged.transfer_type !== 'branch') merged.transfer_type = 'warehouse';
        const isDraftSave = !!(b.save_as_draft || existing.status === 'draft' && b.status === 'draft');
        if (!isDraftSave) {
            const validationError = validateBody({ ...merged, details: b.details || [{ product_id: 'x', qty: 1 }] }, false);
            if (validationError) return res.status(400).json({ success: false, error: validationError });
            const branchError = await checkBranchWarehouses(tenantClient, tenantId, merged, Array.isArray(b.details) ? b.details : []);
            if (branchError) return res.status(400).json({ success: false, error: branchError });
        }
        const snapshots = await captureMasterSnapshots(tenantClient, merged);
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'stock_transfer', b, !!(b.save_as_draft || b.status === 'draft'));
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const update = { ...b, ...snapshots, transfer_type: merged.transfer_type, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        if (merged.transfer_type !== 'branch') update.from_branch_id = null;
        PROTECTED.forEach(k => delete update[k]);
        // A cleared picker arrives as '' - store NULL (UUID / date columns reject '').
        Object.keys(update).forEach(k => { if (update[k] === '') update[k] = null; });
        delete update.branch_id;
        delete update.details;
        delete update.save_as_draft;
        delete update.numbering_category_id;

        const { data, error } = await tenantClient.from('stock_transfers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const total = await syncDetails(tenantClient, tenantId, req.params.id, b.details, data.from_warehouse_id, data.to_warehouse_id);
            await tenantClient.from('stock_transfers').update({ total_amount: total }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'update_stock_transfer', 'stock_transfer', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'stock_transfer', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/stock-transfers/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'approved', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('stock_transfers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Stock Transfer not found' });

        if (existing.status === 'cancelled') return res.status(400).json({ success: false, error: 'This transfer is already cancelled' });
        if (existing.status === 'posted' && status !== 'cancelled') return res.status(400).json({ success: false, error: 'A posted transfer can only be cancelled' });

        let stockWarnings = [];
        let accounts = null;
        if (['approved', 'posted'].includes(status) && existing.status !== 'posted') {
            const { data: detailsForCheck } = await tenantClient.from('stock_transfer_details').select('*').eq('transfer_id', req.params.id);
            const validationError = validateBody({ ...existing, details: detailsForCheck || [] }, false)
                || await checkBranchWarehouses(tenantClient, tenantId, existing, detailsForCheck || []);
            if (validationError) return res.status(400).json({ success: false, error: validationError });
            if (status === 'posted') {
                // Accounts first: a missing / wrong ledger must stop posting before any stock moves.
                accounts = await stockAcc.finalTransferAccounts(tenantClient, tenantId, existing);
                await stockAcc.checkTransferAccounts(tenantClient, tenantId, accounts);
                const stockCheck = await checkNegativeStock(tenantClient, tenantId, existing, detailsForCheck || []);
                if (stockCheck.blocked && !req.body.override_negative_stock_warning) {
                    return res.status(400).json({ success: false, error: 'Insufficient stock to post this transfer', warnings: stockCheck.warnings });
                }
                stockWarnings = stockCheck.warnings;
                if (accounts.posts && !(Number(existing.total_amount) > 0)) stockWarnings.push('No cost rate on the lines, so no GL entry was made - stock moved only');
            }
        }

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') {
            update.cancellation_reason = cancellation_reason;
            update.cancelled_at = new Date().toISOString();
            update.cancelled_by = req.auth.userId;
        }
        if (status === 'approved') {
            update.approved_by = req.auth.userId;
            update.approved_at = new Date().toISOString();
        }
        if (status === 'posted') {
            update.posted_by = req.auth.userId;
            update.posted_at = new Date().toISOString();
            update.requires_receipt = accounts.two_step;
            update.dr_ledger_id = accounts.dr_ledger_id; update.cr_ledger_id = accounts.cr_ledger_id; update.transit_ledger_id = accounts.transit_ledger_id;
        }
        const { data, error } = await tenantClient.from('stock_transfers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (status === 'posted' && existing.status !== 'posted') {
            const { data: details } = await tenantClient.from('stock_transfer_details').select('*').eq('transfer_id', req.params.id);
            try {
                // Two-step: only the dispatch now - the goods are In Transit until Received.
                await postStockMovements(tenantClient, tenantId, data, details || [], accounts.two_step ? 'out' : 'both');
                const glPosted = await postTransferGl(tenantClient, tenantId, data, accounts, accounts.two_step ? 'dispatch' : 'direct', req.auth.userId, data.doc_date);
                if (glPosted) await tenantClient.from('stock_transfers').update({ gl_posted: true }).eq('id', data.id);
                data.gl_posted = glPosted;
            } catch (postErr) {
                // Undo so the document never stays "posted" with half its effects.
                await reverseStockMovements(tenantClient, req.params.id);
                await stockAcc.reverseGlBatches(tenantClient, ['stock_transfer', 'stock_transfer_receipt'], req.params.id);
                await tenantClient.from('stock_transfers').update({ status: existing.status, posted_by: null, posted_at: null, requires_receipt: false }).eq('id', req.params.id);
                throw postErr;
            }
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseStockMovements(tenantClient, req.params.id);
            await stockAcc.reverseGlBatches(tenantClient, ['stock_transfer', 'stock_transfer_receipt'], req.params.id);
            await tenantClient.from('stock_transfers').update({ gl_posted: false }).eq('id', req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'change_stock_transfer_status', 'stock_transfer', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'stock_transfer', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data, warnings: stockWarnings.length > 0 ? stockWarnings : undefined });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// Receive a two-step (In Transit) branch transfer: stock enters the To
// warehouse on the receiving date; GL Dr receiving / Cr Goods in Transit.
router.put('/stock-transfers/:id/receive', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: doc } = await tenantClient.from('stock_transfers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!doc) return res.status(404).json({ success: false, error: 'Stock Transfer not found' });
        if (doc.status !== 'posted' || !doc.requires_receipt) return res.status(400).json({ success: false, error: 'Only a dispatched (In Transit) transfer can be received' });
        if (doc.received_date) return res.status(400).json({ success: false, error: `Already received on ${String(doc.received_date).slice(0, 10)}` });
        const receivedDate = req.body.received_date || new Date().toISOString().slice(0, 10);
        if (receivedDate < String(doc.doc_date).slice(0, 10)) return res.status(400).json({ success: false, error: 'Receiving date cannot be before the dispatch date' });

        const { data: details } = await tenantClient.from('stock_transfer_details').select('*').eq('transfer_id', doc.id);
        const accounts = { posts: !!doc.transit_ledger_id && !!doc.dr_ledger_id, dr_ledger_id: doc.dr_ledger_id, transit_ledger_id: doc.transit_ledger_id };
        const { data: updated, error } = await tenantClient.from('stock_transfers')
            .update({ received_date: receivedDate, received_by: req.auth.userId, received_at: new Date().toISOString(), receive_remarks: req.body.receive_remarks || null, updated_by: req.auth.userId })
            .eq('id', doc.id).is('received_date', null).select().single();
        if (error || !updated) return res.status(409).json({ success: false, error: 'This transfer was just received by someone else' });
        try {
            await postStockMovements(tenantClient, tenantId, doc, details || [], 'in', receivedDate);
            if (doc.gl_posted) await postTransferGl(tenantClient, tenantId, doc, accounts, 'receipt', req.auth.userId, receivedDate);
        } catch (postErr) {
            await tenantClient.from('stock_movements').delete().eq('source_type', 'stock_transfer').eq('source_id', doc.id).gt('qty_in', 0);
            await stockAcc.reverseGlBatches(tenantClient, ['stock_transfer_receipt'], doc.id);
            await tenantClient.from('stock_transfers').update({ received_date: null, received_by: null, received_at: null }).eq('id', doc.id);
            throw postErr;
        }
        await logAudit(tenantId, req.auth.userId, 'receive_stock_transfer', 'stock_transfer', doc.id, { received_date: receivedDate });
        await logDocumentAudit(tenantClient, tenantId, 'stock_transfer', doc.id, 'received', req.auth.userId);
        res.json({ success: true, message: `Transfer ${doc.doc_no} received`, data: updated });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

router.delete('/stock-transfers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('stock_transfers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Stock Transfer not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for an approved/posted transfer' });
        const { error } = await tenantClient.from('stock_transfers').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_stock_transfer', 'stock_transfer', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/stock-transfers/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'stock_transfer').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/current-stock', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { product_id, warehouse_id } = req.query;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient.from('v_current_stock').select('*, products(product_name), warehouses(warehouse_name)').eq('tenant_id', req.auth.tenantId);
        if (product_id) query = query.eq('product_id', product_id);
        if (warehouse_id) query = query.eq('warehouse_id', warehouse_id);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
