-- =============================================
-- PURCHASE NON-SALEABLE RETURN - Fixed Dual UOM propagation
-- This detail table never had alt_qty/alt_unit_id at all (unlike every
-- other Purchase document), so adding both those plus rate_basis
-- together here.
-- =============================================

ALTER TABLE tenant_master.purchase_nonsaleable_return_details
    ADD COLUMN IF NOT EXISTS alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.purchase_nonsaleable_return_details
    ADD COLUMN IF NOT EXISTS alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.purchase_nonsaleable_return_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.purchase_nonsaleable_return_details
    DROP CONSTRAINT IF EXISTS valid_purchase_nonsaleable_return_rate_basis;
ALTER TABLE tenant_master.purchase_nonsaleable_return_details
    ADD CONSTRAINT valid_purchase_nonsaleable_return_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
