// =============================================
// routes/batchSerialStockRoutes.js
// "Batch/Serial number on xa vane stock ma tyo jun saman xa tesko
// popup with qty aunu paryo" - the live stock ledger (v_current_stock,
// already transaction-driven and the correct source of truth for "how
// much is actually here right now") joined with the batch master (for
// mfg/exp date, which the stock ledger itself doesn't carry).
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/product-batch-stock', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { product_id, warehouse_id } = req.query;
        if (!product_id) return res.status(400).json({ success: false, error: 'product_id is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);

        let stockQuery = tenantClient.from('v_current_stock').select('batch_no, warehouse_id, on_hand_qty, weighted_avg_cost').eq('tenant_id', req.auth.tenantId).eq('product_id', product_id).not('batch_no', 'is', null);
        if (warehouse_id) stockQuery = stockQuery.eq('warehouse_id', warehouse_id);
        const { data: stockRows, error } = await stockQuery;
        if (error) throw error;

        const { data: batchMeta } = await tenantClient.from('product_batches').select('batch_no, mfg_date, exp_date').eq('product_id', product_id).eq('tenant_id', req.auth.tenantId);
        const metaMap = Object.fromEntries((batchMeta || []).map(b => [b.batch_no, b]));

        let warehouseNames = {};
        if (!warehouse_id) {
            const whIds = [...new Set((stockRows || []).map(r => r.warehouse_id))];
            if (whIds.length > 0) {
                const { data: whs } = await tenantClient.from('warehouses').select('id, warehouse_name').in('id', whIds);
                warehouseNames = Object.fromEntries((whs || []).map(w => [w.id, w.warehouse_name]));
            }
        }

        // FEATURE: "Batch Info popup - In Stock and In Stock2 xuttai-
        // xuttai dekhaunu paryo" - a Fixed Dual UOM product's stock
        // decomposes into whole Primary units + a Secondary remainder
        // (e.g. "7 Carton, 70 loose PCS" reading the SAME 70-piece
        // total two ways), via the v_dual_uom_stock view.
        const { data: product } = await tenantClient.from('products').select('uom_mode, dual_uom_primary_unit_id, base_unit_id').eq('id', product_id).maybeSingle();
        let dualMeta = null;
        if (product?.uom_mode === 'fixed_dual') {
            let dualQuery = tenantClient.from('v_dual_uom_stock').select('batch_no, warehouse_id, on_hand_primary, on_hand_secondary, primary_unit_name, secondary_unit_name').eq('tenant_id', req.auth.tenantId).eq('product_id', product_id);
            if (warehouse_id) dualQuery = dualQuery.eq('warehouse_id', warehouse_id);
            const { data: dualRows } = await dualQuery;
            dualMeta = Object.fromEntries((dualRows || []).map(r => [`${r.batch_no}|${r.warehouse_id}`, r]));
        }

        const data = (stockRows || []).map(r => {
            const dual = dualMeta?.[`${r.batch_no}|${r.warehouse_id}`];
            return {
                batch_no: r.batch_no, warehouse_id: r.warehouse_id, warehouse_name: warehouseNames[r.warehouse_id] || null,
                on_hand_qty: Number(r.on_hand_qty), weighted_avg_cost: Number(r.weighted_avg_cost),
                mfg_date: metaMap[r.batch_no]?.mfg_date || null, exp_date: metaMap[r.batch_no]?.exp_date || null,
                on_hand_primary: dual ? Number(dual.on_hand_primary) : null,
                on_hand_secondary: dual ? Number(dual.on_hand_secondary) : null,
                primary_unit_name: dual?.primary_unit_name || null,
                secondary_unit_name: dual?.secondary_unit_name || null
            };
        }).sort((a, b) => (a.exp_date || '9999') < (b.exp_date || '9999') ? -1 : 1);

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/product-serial-stock', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { product_id } = req.query;
        if (!product_id) return res.status(400).json({ success: false, error: 'product_id is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('product_serial_records').select('serial_no, warranty_expiry_date')
            .eq('tenant_id', req.auth.tenantId).eq('product_id', product_id).eq('status', 'in_stock').eq('is_active', true)
            .order('serial_no');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
