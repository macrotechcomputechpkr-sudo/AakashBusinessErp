-- =============================================
-- SALES QUOTATION - Fixed Dual UOM propagation
-- Reuses the existing alt_qty/alt_unit_id columns - only rate_basis is
-- genuinely new.
-- =============================================

ALTER TABLE tenant_master.sales_quotation_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.sales_quotation_details
    DROP CONSTRAINT IF EXISTS valid_sales_quotation_rate_basis;
ALTER TABLE tenant_master.sales_quotation_details
    ADD CONSTRAINT valid_sales_quotation_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
