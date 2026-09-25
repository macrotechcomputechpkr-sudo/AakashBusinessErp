-- =============================================
-- SALES NON-SALEABLE RETURN - Dual UOM + Discount propagation
-- Never had either concept. Adding alt_qty/alt_unit_id/rate_basis for
-- Fixed Dual UOM mixed-radix entry, and discount_percent/discount_
-- amount so the same ProductTermBar tool other Sales documents
-- already have works here too.
-- =============================================

ALTER TABLE tenant_master.sales_nonsaleable_return_details
    ADD COLUMN IF NOT EXISTS alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.sales_nonsaleable_return_details
    ADD COLUMN IF NOT EXISTS alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.sales_nonsaleable_return_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.sales_nonsaleable_return_details
    DROP CONSTRAINT IF EXISTS valid_sales_nonsaleable_return_rate_basis;
ALTER TABLE tenant_master.sales_nonsaleable_return_details
    ADD CONSTRAINT valid_sales_nonsaleable_return_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));

ALTER TABLE tenant_master.sales_nonsaleable_return_details
    ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0;
ALTER TABLE tenant_master.sales_nonsaleable_return_details
    ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15, 2) DEFAULT 0;
