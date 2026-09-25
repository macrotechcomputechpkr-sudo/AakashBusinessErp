-- =============================================
-- SALES DELIVERY - Fixed Dual UOM propagation
-- (Rebuilding after this was found missing - the physical stock-out
-- point needs the same alt_qty/alt_unit_id/rate_basis columns every
-- other Sales document already has.)
-- =============================================

ALTER TABLE tenant_master.sales_delivery_details
    ADD COLUMN IF NOT EXISTS alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.sales_delivery_details
    ADD COLUMN IF NOT EXISTS alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.sales_delivery_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.sales_delivery_details
    DROP CONSTRAINT IF EXISTS valid_sales_delivery_rate_basis;
ALTER TABLE tenant_master.sales_delivery_details
    ADD CONSTRAINT valid_sales_delivery_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
