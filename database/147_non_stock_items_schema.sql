-- =============================================
-- 147: services, non-inventory and fixed-asset items are not stock
--   (utils/stockItems.js) - documents no longer write stock movements for
--   them. Movements already written for such items by purchase / sales
--   documents are removed, except in a closed fiscal year (migration 146
--   keeps closed years unchanged - those rows are left as they are).
--   Stock adjustments, transfers and production are left alone (a user
--   may have chosen to count such an item deliberately there).
-- =============================================
DELETE FROM tenant_master.stock_movements m
 USING tenant_master.products p
 WHERE p.id = m.product_id
   AND p.item_type IN ('service', 'non_inventory', 'fixed_asset')
   AND m.source_type IN ('purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_nonsalable_return',
                         'sales_delivery', 'sales_bill', 'sales_return', 'sales_nonsalable_return')
   AND NOT EXISTS (
       SELECT 1 FROM tenant_master.fiscal_years fy
        WHERE fy.tenant_id = m.tenant_id AND m.movement_date BETWEEN fy.start_date_eng AND fy.end_date_eng
          AND (fy.is_closed OR fy.is_locked OR fy.status = 'closed'));
