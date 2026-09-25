-- =============================================
-- BATCH NO + SOURCE REF NO - EVERY MODULE
-- "Batch and Source Document should be in Details on every model" -
-- GRN got these first; retrofitting the same two columns onto
-- Requisition, Quotation, and Order's own detail tables so the pattern
-- is consistent everywhere in the chain, not just GRN.
-- =============================================

ALTER TABLE tenant_master.purchase_requisition_details
    ADD COLUMN IF NOT EXISTS batch_no VARCHAR(50);
    -- No source_doc_no here - Requisition is the FIRST stage, nothing
    -- earlier to reference.

ALTER TABLE tenant_master.purchase_quotation_details
    ADD COLUMN IF NOT EXISTS batch_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_doc_no VARCHAR(50);

ALTER TABLE tenant_master.purchase_order_details
    ADD COLUMN IF NOT EXISTS batch_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_doc_no VARCHAR(50);

-- Seed the new field-catalog entries so Entry Field Control can govern
-- them the same way as every other field.
INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_requisition', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 16),
('purchase_quotation', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 16),
('purchase_order', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 16)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
