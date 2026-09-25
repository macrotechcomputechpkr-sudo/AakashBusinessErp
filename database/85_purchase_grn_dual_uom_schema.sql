-- =============================================
-- PURCHASE GRN - Fixed Dual UOM propagation
-- Goods receipt is the physical stock-IN point - mixed-radix entry
-- here needs to convert correctly to the base-unit stock movement,
-- same pattern already used by Purchase Bill.
-- =============================================

ALTER TABLE tenant_master.purchase_grn_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.purchase_grn_details
    DROP CONSTRAINT IF EXISTS valid_purchase_grn_rate_basis;
ALTER TABLE tenant_master.purchase_grn_details
    ADD CONSTRAINT valid_purchase_grn_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
