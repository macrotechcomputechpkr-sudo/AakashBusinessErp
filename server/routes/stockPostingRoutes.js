// =============================================
// routes/stockPostingRoutes.js
// System Control > Stock Posting support:
//   GET /stock-posting/mapping  - each branch's / warehouse's own stock ledger
//   PUT /stock-posting/mapping  - save them
//   GET /stock-posting/check    - every configured stock-posting ledger with
//                                 its group and whether it is allowed where
//                                 it is used (see utils/stockAccounting.js)
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const stockAcc = require('../utils/stockAccounting');

const wrap = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(req, await getTenantClient(req.auth.tenantId), req.auth.tenantId) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.get('/stock-posting/mapping', requireAuth, wrap(async (req, c, t) => {
    const [br, wh, map] = await Promise.all([
        c.from('branches').select('id, branch_code, branch_name, stock_ledger_id').eq('tenant_id', t).eq('is_active', true).order('branch_name'),
        c.from('warehouses').select('id, warehouse_code, warehouse_name, stock_ledger_id').eq('tenant_id', t).eq('is_active', true).order('warehouse_name'),
        c.from('branch_warehouse_mapping').select('branch_id, warehouse_id, is_primary, default_warehouse').eq('tenant_id', t).eq('is_active', true)
    ]);
    for (const r of [br, wh, map]) if (r.error) throw r.error;
    return { branches: br.data || [], warehouses: wh.data || [], branch_warehouses: map.data || [] };
}));

router.put('/stock-posting/mapping', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), wrap(async (req, c, t) => {
    const { branches = [], warehouses = [] } = req.body || {};
    for (const b of branches) {
        const { error } = await c.from('branches').update({ stock_ledger_id: b.stock_ledger_id || null }).eq('id', b.id).eq('tenant_id', t);
        if (error) throw error;
    }
    for (const w of warehouses) {
        const { error } = await c.from('warehouses').update({ stock_ledger_id: w.stock_ledger_id || null }).eq('id', w.id).eq('tenant_id', t);
        if (error) throw error;
    }
    await logAudit(t, req.auth.userId, 'update_stock_posting_mapping', 'system_control_settings', null, { branches, warehouses });
    return { saved: branches.length + warehouses.length };
}));

// role: 'neutral' ledgers must be Inventory / Purchase group; 'pl' ledgers
// (loss, gain) should NOT be, or the amount stays inside COGS.
router.get('/stock-posting/check', requireAuth, wrap(async (req, c, t) => {
    const s = await stockAcc.loadSettings(c, t);
    const [br, wh] = await Promise.all([
        c.from('branches').select('id, branch_name, stock_ledger_id').eq('tenant_id', t).not('stock_ledger_id', 'is', null),
        c.from('warehouses').select('id, warehouse_name, stock_ledger_id').eq('tenant_id', t).not('stock_ledger_id', 'is', null)
    ]);
    const uses = [
        { key: 'stock_transfer_in_ledger_id', label: 'Stock Transfer In (receiving, Dr)', role: 'neutral' },
        { key: 'stock_transfer_out_ledger_id', label: 'Stock Transfer Out (sending, Cr)', role: 'neutral' },
        { key: 'goods_transit_ledger_id', label: 'Goods in Transit', role: 'neutral' },
        { key: 'stock_adjustment_contra_ledger_id', label: 'Stock Adjustment (contra)', role: 'neutral' },
        { key: 'stock_shortage_ledger_id', label: 'Stock Shortage / Loss (Dr)', role: 'pl' },
        { key: 'stock_damage_ledger_id', label: 'Stock Damage / Expiry (Dr)', role: 'pl' },
        { key: 'stock_excess_ledger_id', label: 'Stock Excess / Gain (Cr)', role: 'pl' }
    ].map(u => ({ ...u, ledger_id: s[u.key] || null }));
    (br.data || []).forEach(b => uses.push({ key: `branch:${b.id}`, label: `Branch stock a/c - ${b.branch_name}`, role: 'neutral', ledger_id: b.stock_ledger_id }));
    (wh.data || []).forEach(w => uses.push({ key: `warehouse:${w.id}`, label: `Warehouse stock a/c - ${w.warehouse_name}`, role: 'neutral', ledger_id: w.stock_ledger_id }));
    const cls = await stockAcc.classifyLedgers(c, t, uses.map(u => u.ledger_id));
    return uses.map(u => {
        const l = cls[u.ledger_id];
        const ok = !l ? null : u.role === 'neutral' ? l.neutral : !l.neutral;
        return { ...u, ledger_name: l?.name || null, group: l?.group || null, kind: l ? stockAcc.describe(l) : null, ok,
            message: !l ? 'Not set' : ok ? 'OK' : u.role === 'neutral'
                ? 'Must be an Inventory-group (or Purchase-group) ledger - posting will be refused'
                : 'Stock / purchase ledger - the amount will stay inside COGS instead of showing separately' };
    });
}));

module.exports = router;
