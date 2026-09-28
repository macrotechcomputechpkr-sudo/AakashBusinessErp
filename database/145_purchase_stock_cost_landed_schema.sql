-- =============================================
-- 145: purchase stock cost + landed cost (utils/purchaseStockCost.js)
--   stock_movements.base_unit_cost - the cost of a purchase receipt
--       without landed cost; unit_cost = base_unit_cost + posted
--       additional expense allocated to that line / qty in.
--   Existing GRN / direct Bill receipts are re-costed:
--     1. base cost = the line's value without VAT, after discount
--        (amount - tax_amount) / qty in base units. Before, the entry rate
--        was stored, so a line entered in a bigger unit (box of 12) was
--        valued at the box rate per piece and discounts were ignored.
--     2. landed cost of every POSTED additional expense is added
--        (allocated to the GRN line, the Bill line - or the GRN line that
--        Bill line came from - or an Order line, split over the GRN /
--        Bill lines made from it by qty).
-- Re-running is safe: step 1 only fills base_unit_cost where it is empty,
-- step 2 always starts from base_unit_cost.
-- =============================================
ALTER TABLE tenant_master.stock_movements ADD COLUMN IF NOT EXISTS base_unit_cost DECIMAL(18, 4);

-- 1. base cost of purchase receipts from the line value
UPDATE tenant_master.stock_movements m
   SET base_unit_cost = ROUND((d.amount - COALESCE(d.tax_amount, 0)) / m.qty_in, 4)
  FROM tenant_master.purchase_grn_details d
 WHERE m.source_type = 'purchase_grn' AND m.source_detail_id = d.id
   AND m.base_unit_cost IS NULL AND m.qty_in > 0 AND COALESCE(d.amount, 0) - COALESCE(d.tax_amount, 0) > 0;
UPDATE tenant_master.stock_movements m
   SET base_unit_cost = ROUND((d.amount - COALESCE(d.tax_amount, 0)) / m.qty_in, 4)
  FROM tenant_master.purchase_bill_details d
 WHERE m.source_type = 'purchase_bill' AND m.source_detail_id = d.id
   AND m.base_unit_cost IS NULL AND m.qty_in > 0 AND COALESCE(d.amount, 0) - COALESCE(d.tax_amount, 0) > 0;
UPDATE tenant_master.stock_movements
   SET base_unit_cost = unit_cost
 WHERE source_type IN ('purchase_grn', 'purchase_bill') AND base_unit_cost IS NULL;

-- 2. landed cost of posted additional expenses
WITH posted AS (
    SELECT a.* FROM tenant_master.purchase_expense_allocations a
      JOIN tenant_master.purchase_additional_expenses e ON e.id = a.expense_id AND e.status = 'posted'
), recv AS (
    SELECT m.id, m.source_type, m.source_detail_id, m.qty_in,
           COALESCE(g.source_order_detail_id, b.source_order_detail_id) AS order_detail_id
      FROM tenant_master.stock_movements m
      LEFT JOIN tenant_master.purchase_grn_details g ON m.source_type = 'purchase_grn' AND g.id = m.source_detail_id
      LEFT JOIN tenant_master.purchase_bill_details b ON m.source_type = 'purchase_bill' AND b.id = m.source_detail_id
     WHERE m.source_type IN ('purchase_grn', 'purchase_bill') AND m.qty_in > 0
), order_qty AS (
    SELECT order_detail_id, SUM(qty_in) AS q FROM recv WHERE order_detail_id IS NOT NULL GROUP BY order_detail_id
), landed AS (
    -- straight to a GRN line
    SELECT r.id, SUM(p.allocated_amount) AS amt FROM recv r JOIN posted p ON r.source_type = 'purchase_grn' AND p.source_grn_detail_id = r.source_detail_id GROUP BY r.id
    UNION ALL
    -- to a Bill line: its own receipt (direct bill) or the GRN line it came from
    SELECT r.id, SUM(p.allocated_amount) FROM posted p
      JOIN tenant_master.purchase_bill_details b ON b.id = p.source_bill_detail_id AND p.source_grn_detail_id IS NULL
      JOIN recv r ON (b.source_grn_detail_id IS NOT NULL AND r.source_type = 'purchase_grn' AND r.source_detail_id = b.source_grn_detail_id)
                  OR (b.source_grn_detail_id IS NULL AND r.source_type = 'purchase_bill' AND r.source_detail_id = b.id)
     GROUP BY r.id
    UNION ALL
    -- to an Order line: over the receipts made from it, by qty
    SELECT r.id, SUM(p.allocated_amount * r.qty_in / NULLIF(oq.q, 0)) FROM posted p
      JOIN recv r ON r.order_detail_id = p.source_order_detail_id
      JOIN order_qty oq ON oq.order_detail_id = r.order_detail_id
     WHERE p.source_grn_detail_id IS NULL AND p.source_bill_detail_id IS NULL
     GROUP BY r.id
), per_move AS (
    SELECT id, SUM(amt) AS amt FROM landed GROUP BY id
)
UPDATE tenant_master.stock_movements m
   SET unit_cost = ROUND(m.base_unit_cost + COALESCE(pm.amt, 0) / m.qty_in, 4)
  FROM recv r LEFT JOIN per_move pm ON pm.id = r.id
 WHERE m.id = r.id AND m.base_unit_cost IS NOT NULL;
