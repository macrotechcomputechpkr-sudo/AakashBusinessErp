-- =============================================
-- 157: stock movements without a warehouse use the company's main warehouse
-- A company that is not multi-warehouse never shows the Warehouse box in
-- entries, so bills reached posting with warehouse_id NULL and the stock
-- movement failed ("null value in column warehouse_id"). Before insert, an
-- empty warehouse now becomes the company's main warehouse (code MAIN, else
-- its first active warehouse). Company creation makes MAIN when missing.
-- Re-run safe.
-- =============================================
CREATE OR REPLACE FUNCTION tenant_master.fill_stock_movement_warehouse()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.warehouse_id IS NULL THEN
        SELECT w.id INTO NEW.warehouse_id FROM tenant_master.warehouses w
        WHERE w.tenant_id = NEW.tenant_id
        ORDER BY (w.warehouse_code = 'MAIN') DESC, w.created_at
        LIMIT 1;
    END IF;
    RETURN NEW;
END $$;

DO $$
BEGIN
    IF to_regclass('tenant_master.stock_movements') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_fill_stock_movement_warehouse ON tenant_master.stock_movements;
        CREATE TRIGGER trg_fill_stock_movement_warehouse BEFORE INSERT ON tenant_master.stock_movements
            FOR EACH ROW EXECUTE FUNCTION tenant_master.fill_stock_movement_warehouse();
    END IF;
END $$;
