-- =============================================
-- SALES ORDER DETAIL - Batch/Serial picker support
-- The new Batch/Serial Stock Picker selects mfg_date/exp_date (for a
-- batch) or a serial_no (for a serial-tracked item) - these columns
-- need to actually exist to save what gets picked.
-- =============================================

ALTER TABLE tenant_master.sales_order_details
    ADD COLUMN IF NOT EXISTS serial_no VARCHAR(80);
ALTER TABLE tenant_master.sales_order_details
    ADD COLUMN IF NOT EXISTS mfg_date DATE;
ALTER TABLE tenant_master.sales_order_details
    ADD COLUMN IF NOT EXISTS exp_date DATE;
