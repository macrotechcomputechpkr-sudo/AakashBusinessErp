-- =============================================
-- STOCK TRANSFER - Fixed Dual UOM propagation
-- =============================================

ALTER TABLE tenant_master.stock_transfer_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.stock_transfer_details
    DROP CONSTRAINT IF EXISTS valid_stock_transfer_rate_basis;
ALTER TABLE tenant_master.stock_transfer_details
    ADD CONSTRAINT valid_stock_transfer_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
