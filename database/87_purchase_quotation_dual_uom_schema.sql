-- =============================================
-- PURCHASE QUOTATION - Fixed Dual UOM propagation
-- =============================================

ALTER TABLE tenant_master.purchase_quotation_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.purchase_quotation_details
    DROP CONSTRAINT IF EXISTS valid_purchase_quotation_rate_basis;
ALTER TABLE tenant_master.purchase_quotation_details
    ADD CONSTRAINT valid_purchase_quotation_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
