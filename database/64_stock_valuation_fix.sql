-- =============================================
-- STOCK VALUATION FIX
-- "Hamro maa Stock Valuation Perfect xa ki xina" - it was not: the
-- stock_movements ledger (file 59) tracked quantity only, with no cost
-- value at all. Without a cost on every line, there is no way to
-- compute a Balance Sheet closing stock figure or a COGS number - the
-- two things "stock valuation" actually means.
--
-- Adds a per-movement unit_cost, giving:
--   - the value of every movement (qty * unit_cost)
--   - a WEIGHTED-AVERAGE running cost per product+warehouse+batch,
--     computed from every qty_in movement's own cost
--   - closing stock value = on-hand qty * that weighted-average cost
-- True FIFO-layer costing (matching consumption against specific
-- inbound batches in arrival order, not just an averaged rate) is a
-- larger, separate undertaking - this is the foundational fix that
-- makes ANY valuation possible at all, which is the more urgent gap.
-- =============================================

ALTER TABLE tenant_master.stock_movements
    ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(15, 4) DEFAULT 0;

CREATE OR REPLACE VIEW tenant_master.v_current_stock AS
SELECT
    tenant_id, product_id, warehouse_id, batch_no,
    SUM(qty_in) - SUM(qty_out) AS on_hand_qty,
    CASE WHEN SUM(qty_in) > 0 THEN SUM(qty_in * unit_cost) / SUM(qty_in) ELSE 0 END AS weighted_avg_cost
FROM tenant_master.stock_movements
GROUP BY tenant_id, product_id, warehouse_id, batch_no
HAVING SUM(qty_in) - SUM(qty_out) != 0;

CREATE OR REPLACE VIEW tenant_master.v_stock_valuation AS
SELECT
    v.tenant_id, v.product_id, p.product_name, v.warehouse_id, w.warehouse_name, v.batch_no,
    v.on_hand_qty, v.weighted_avg_cost,
    (v.on_hand_qty * v.weighted_avg_cost) AS stock_value
FROM tenant_master.v_current_stock v
JOIN tenant_master.products p ON p.id = v.product_id
JOIN tenant_master.warehouses w ON w.id = v.warehouse_id;
