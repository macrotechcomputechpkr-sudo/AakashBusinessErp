-- =============================================
-- SALES RETURN - Fixed Dual UOM propagation
-- The customer returns goods measured the same mixed-radix way they
-- were originally billed (5 CRT AND 5 PCS) - same columns Sales Bill
-- already has.
-- =============================================

ALTER TABLE tenant_master.sales_return_details
    ADD COLUMN IF NOT EXISTS alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.sales_return_details
    ADD COLUMN IF NOT EXISTS alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.sales_return_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.sales_return_details
    DROP CONSTRAINT IF EXISTS valid_sales_return_rate_basis;
ALTER TABLE tenant_master.sales_return_details
    ADD CONSTRAINT valid_sales_return_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
