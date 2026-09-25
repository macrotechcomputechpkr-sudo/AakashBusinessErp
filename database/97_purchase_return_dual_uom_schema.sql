-- =============================================
-- PURCHASE RETURN - Fixed Dual UOM propagation
-- Never had alt_qty/alt_unit_id/rate_basis at all - adding all three.
-- =============================================

ALTER TABLE tenant_master.purchase_return_details
    ADD COLUMN IF NOT EXISTS alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.purchase_return_details
    ADD COLUMN IF NOT EXISTS alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.purchase_return_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.purchase_return_details
    DROP CONSTRAINT IF EXISTS valid_purchase_return_rate_basis;
ALTER TABLE tenant_master.purchase_return_details
    ADD CONSTRAINT valid_purchase_return_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
