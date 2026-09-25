// =============================================
// routes/productOpeningRoutes.js
// Mirrors ledgerOpeningRoutes.js for Products: bulk Excel-style Opening
// Stock entry, restricted to the SAME fiscal_years.has_opening_balance
// flag (one shared "opening entry allowed" concept across Ledgers and
// Products, not two separate switches). Batch/Serial/Vehicle detail
// sub-tables ARE the live records (see 24_product_batch_serial_vehicle_
// schema.sql) - entering them at Opening time just means "day-one, no
// prior transaction history", same philosophy as Ledger's bill-wise
// opening. Also: a Rate Change utility (Base + every Alt Unit at once)
// and a Batch Rate Update utility.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { recalculateAssembledProductRate } = require('./productRoutes');

router.get('/product-opening/products', requireAuth, async (req, res) => {
    try {
        const { fiscal_year_id } = req.query;
        if (!fiscal_year_id) return res.status(400).json({ success: false, error: 'fiscal_year_id is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);

        const { data: fy } = await tenantClient.from('fiscal_years').select('*').eq('id', fiscal_year_id).eq('tenant_id', req.auth.tenantId).single();
        if (!fy) return res.status(404).json({ success: false, error: 'Fiscal year not found' });
        if (!fy.has_opening_balance) return res.status(400).json({ success: false, error: 'Opening balance entry is not allowed in this fiscal year' });

        const { data, error } = await tenantClient
            .from('products')
            .select('id, product_code, product_name, item_type, opening_qty, opening_rate, opening_value, product_groups(group_name)')
            .eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('product_name');
        if (error) throw error;

        const { data: sysControl } = await tenantClient.from('system_control_settings').select('batch_system, enable_serial_number, enable_vehicle_options').eq('tenant_id', req.auth.tenantId).maybeSingle();

        res.json({ success: true, data, fiscal_year: fy, tracking: sysControl || {} });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-opening/bulk-update', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { fiscal_year_id, rows } = req.body;
        if (!fiscal_year_id) return res.status(400).json({ success: false, error: 'fiscal_year_id is required' });
        if (!Array.isArray(rows)) return res.status(400).json({ success: false, error: 'rows must be an array' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: fy } = await tenantClient.from('fiscal_years').select('has_opening_balance').eq('id', fiscal_year_id).eq('tenant_id', tenantId).single();
        if (!fy?.has_opening_balance) return res.status(400).json({ success: false, error: 'Opening balance entry is not allowed in this fiscal year' });

        for (const row of rows) {
            const qty = Number(row.opening_qty) || 0, rate = Number(row.opening_rate) || 0;
            const { error } = await tenantClient
                .from('products').update({ opening_qty: qty, opening_rate: rate, opening_value: qty * rate, updated_by: req.auth.userId })
                .eq('id', row.product_id).eq('tenant_id', tenantId);
            if (error) throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'bulk_update_product_opening', 'product', null, { fiscal_year_id, updated_count: rows.length });
        res.json({ success: true, message: `Updated ${rows.length} product(s)` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Batch / Serial / Vehicle opening detail (replace-all sync,
// same pattern as every other sub-table, rolling up into the product's
// own opening_qty/opening_rate automatically) ----------

function rollUpToProduct(tenantClient, tenantId, productId, rows, userId) {
    const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
    const totalValue = rows.reduce((s, r) => s + Number(r.qty) * Number(r.rate), 0);
    const avgRate = totalQty > 0 ? totalValue / totalQty : 0;
    return tenantClient.from('products')
        .update({ opening_qty: totalQty, opening_rate: avgRate, opening_value: totalValue, updated_by: userId })
        .eq('id', productId).eq('tenant_id', tenantId);
}

router.get('/product-opening/batches', requireAuth, async (req, res) => {
    try {
        const { product_id } = req.query;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('product_batches').select('*').eq('product_id', product_id).eq('is_active', true).order('batch_no');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-opening/batches', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { product_id, fiscal_year_id, batches } = req.body;
        if (!product_id || !Array.isArray(batches) || batches.length === 0) return res.status(400).json({ success: false, error: 'product_id and at least one batch line are required' });
        for (const b of batches) if (!b.batch_no || b.qty === undefined) return res.status(400).json({ success: false, error: 'Each batch needs a Batch No and Qty' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        await tenantClient.from('product_batches').delete().eq('product_id', product_id).eq('tenant_id', tenantId);
        const rows = batches.map(b => ({
            tenant_id: tenantId, product_id, fiscal_year_id: fiscal_year_id || null,
            batch_no: b.batch_no, mfg_date: b.mfg_date || null, exp_date: b.exp_date || null,
            qty: b.qty, rate: b.rate || 0, created_by: req.auth.userId
        }));
        const { error: insErr } = await tenantClient.from('product_batches').insert(rows);
        if (insErr) throw insErr;

        const { error: rollErr } = await rollUpToProduct(tenantClient, tenantId, product_id, rows, req.auth.userId);
        if (rollErr) throw rollErr;

        await logAudit(tenantId, req.auth.userId, 'update_batch_opening', 'product', product_id, { batch_count: rows.length });
        res.json({ success: true, message: 'Batch-wise opening saved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/product-opening/serials', requireAuth, async (req, res) => {
    try {
        const { product_id } = req.query;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('product_serial_records').select('*').eq('product_id', product_id).eq('is_active', true).order('serial_no');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-opening/serials', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { product_id, fiscal_year_id, serials, rate } = req.body;
        if (!product_id || !Array.isArray(serials) || serials.length === 0) return res.status(400).json({ success: false, error: 'product_id and at least one serial number are required' });
        for (const s of serials) if (!s.serial_no) return res.status(400).json({ success: false, error: 'Every line needs a Serial Number' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        await tenantClient.from('product_serial_records').delete().eq('product_id', product_id).eq('tenant_id', tenantId);
        const unitRate = Number(rate) || 0;
        const rows = serials.map(s => ({
            tenant_id: tenantId, product_id, fiscal_year_id: fiscal_year_id || null,
            serial_no: s.serial_no, status: 'in_stock', warranty_expiry_date: s.warranty_expiry_date || null,
            created_by: req.auth.userId
        }));
        const { error: insErr } = await tenantClient.from('product_serial_records').insert(rows);
        if (insErr) throw insErr;

        // Every serial = 1 unit, all at the same opening rate.
        const { error: rollErr } = await rollUpToProduct(tenantClient, tenantId, product_id, rows.map(() => ({ qty: 1, rate: unitRate })), req.auth.userId);
        if (rollErr) throw rollErr;

        await logAudit(tenantId, req.auth.userId, 'update_serial_opening', 'product', product_id, { serial_count: rows.length });
        res.json({ success: true, message: 'Serial-wise opening saved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/product-opening/vehicles', requireAuth, async (req, res) => {
    try {
        const { product_id } = req.query;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('product_vehicle_records').select('*').eq('product_id', product_id).eq('is_active', true).order('vehicle_no');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-opening/vehicles', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { product_id, fiscal_year_id, vehicles } = req.body;
        if (!product_id || !Array.isArray(vehicles) || vehicles.length === 0) return res.status(400).json({ success: false, error: 'product_id and at least one vehicle are required' });
        for (const v of vehicles) if (!v.vehicle_no) return res.status(400).json({ success: false, error: 'Every line needs a Vehicle No' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        await tenantClient.from('product_vehicle_records').delete().eq('product_id', product_id).eq('tenant_id', tenantId);
        const rows = vehicles.map(v => ({
            tenant_id: tenantId, product_id, fiscal_year_id: fiscal_year_id || null,
            vehicle_no: v.vehicle_no, vehicle_type: v.vehicle_type || null, chassis_no: v.chassis_no || null,
            engine_no: v.engine_no || null, model_name: v.model_name || null, color: v.color || null,
            qty: v.qty || 1, rate: v.rate || 0, created_by: req.auth.userId
        }));
        const { error: insErr } = await tenantClient.from('product_vehicle_records').insert(rows);
        if (insErr) throw insErr;

        const { error: rollErr } = await rollUpToProduct(tenantClient, tenantId, product_id, rows, req.auth.userId);
        if (rollErr) throw rollErr;

        await logAudit(tenantId, req.auth.userId, 'update_vehicle_opening', 'product', product_id, { vehicle_count: rows.length });
        res.json({ success: true, message: 'Vehicle-wise opening saved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Rate Change utility: Base + every Alt Unit at once ----------

router.put('/product-opening/rate-change', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { product_id, unit_rates } = req.body;
        if (!product_id || !Array.isArray(unit_rates) || unit_rates.length === 0) {
            return res.status(400).json({ success: false, error: 'product_id and at least one unit rate update are required' });
        }
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        for (const ur of unit_rates) {
            const update = {};
            ['purchase_rate', 'mrp', 'sales_rate_sr1', 'sales_rate_sr2', 'sales_rate_sr3', 'sales_rate_sr4', 'sales_rate_sr5'].forEach(f => {
                if (ur[f] !== undefined) update[f] = ur[f];
            });
            const { error } = await tenantClient.from('product_unit_rates').update(update).eq('id', ur.unit_rate_id).eq('tenant_id', tenantId);
            if (error) throw error;
        }

        // FEATURE: if this product is used as a BOM component with Auto
        // Recalculate turned on, propagate the new purchase_rate up into
        // every assembled product that consumes it.
        const { data: parents } = await tenantClient
            .from('product_bom_lines').select('parent_product_id').eq('component_product_id', product_id).eq('auto_recalculate_on_component_rate_change', true);
        const recalculated = [];
        for (const p of parents || []) {
            const newRate = await recalculateAssembledProductRate(tenantClient, tenantId, p.parent_product_id);
            if (newRate !== null) recalculated.push({ product_id: p.parent_product_id, new_rate: newRate });
        }

        await logAudit(tenantId, req.auth.userId, 'product_rate_change', 'product', product_id, { unit_count: unit_rates.length, recalculated_assemblies: recalculated.length });
        res.json({ success: true, message: `Rate updated for ${unit_rates.length} unit(s)`, recalculated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Batch Rate Update utility ----------

router.put('/product-opening/batch-rate-update', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { batch_id, rate } = req.body;
        if (!batch_id || rate === undefined) return res.status(400).json({ success: false, error: 'batch_id and rate are required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: batch, error } = await tenantClient
            .from('product_batches').update({ rate, updated_by: req.auth.userId }).eq('id', batch_id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        // Recompute the product's average opening rate across all its batches.
        const { data: allBatches } = await tenantClient.from('product_batches').select('qty, rate').eq('product_id', batch.product_id).eq('is_active', true);
        await rollUpToProduct(tenantClient, tenantId, batch.product_id, allBatches || [], req.auth.userId);

        await logAudit(tenantId, req.auth.userId, 'batch_rate_update', 'product_batch', batch_id, { new_rate: rate });
        res.json({ success: true, message: 'Batch rate updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Batch / Serial Number correction (mistake fix) ----------

// FEATURE: "if there's a mistake in Batch or Serial Number entry, give
// an Update menu" - renames the identifying number itself (not the
// qty/rate, which the existing PUT batches/serials already covers).
// HONEST LIMITATION: once a Sales/Purchase/Production transaction
// module exists and references batch_id/serial_id (not the raw
// batch_no/serial_no string), a rename here will already be correct
// everywhere automatically, since those tables would point at this row
// by ID. Recorded in the audit log now so the trail exists either way.
router.put('/product-opening/batches/:id/correct-number', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { new_batch_no } = req.body;
        if (!new_batch_no || !new_batch_no.trim()) return res.status(400).json({ success: false, error: 'New Batch No is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: existing } = await tenantClient.from('product_batches').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Batch not found' });

        const { data, error } = await tenantClient
            .from('product_batches').update({ batch_no: new_batch_no.trim(), updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'This product already has a batch with that number' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'correct_batch_number', 'product_batch', req.params.id, { old_batch_no: existing.batch_no, new_batch_no: data.batch_no });
        res.json({ success: true, message: 'Batch number corrected', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/product-opening/serials/:id/correct-number', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { new_serial_no } = req.body;
        if (!new_serial_no || !new_serial_no.trim()) return res.status(400).json({ success: false, error: 'New Serial Number is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: existing } = await tenantClient.from('product_serial_records').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Serial record not found' });

        const { data, error } = await tenantClient
            .from('product_serial_records').update({ serial_no: new_serial_no.trim(), updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'This product already has that serial number' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'correct_serial_number', 'product_serial_record', req.params.id, { old_serial_no: existing.serial_no, new_serial_no: data.serial_no });
        res.json({ success: true, message: 'Serial number corrected', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// One combined lookup so the correction UI can search across both
// Batch and Serial records for one product without two round-trips.
router.get('/product-opening/tracking-records', requireAuth, async (req, res) => {
    try {
        const { product_id } = req.query;
        if (!product_id) return res.status(400).json({ success: false, error: 'product_id is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const [{ data: batches }, { data: serials }] = await Promise.all([
            tenantClient.from('product_batches').select('*').eq('product_id', product_id).eq('is_active', true).order('batch_no'),
            tenantClient.from('product_serial_records').select('*').eq('product_id', product_id).eq('is_active', true).order('serial_no')
        ]);
        res.json({ success: true, data: { batches: batches || [], serials: serials || [] } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
