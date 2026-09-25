-- =============================================
-- SALES ORDER - Fixed Dual UOM propagation
-- Reuses the existing alt_qty/alt_unit_id columns for the secondary
-- quantity - only rate_basis and free_alt_qty are genuinely new.
-- =============================================

ALTER TABLE tenant_master.sales_order_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.sales_order_details
    ADD COLUMN IF NOT EXISTS free_alt_qty DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.sales_order_details
    DROP CONSTRAINT IF EXISTS valid_sales_order_rate_basis;
ALTER TABLE tenant_master.sales_order_details
    ADD CONSTRAINT valid_sales_order_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
