-- =============================================
-- 153_customs_offices_item_customs_schema.sql
-- Customs Offices master (Nepal's customs offices are created with a code
-- for every company the first time the list is opened - utils/customsOffices.js),
-- and the Customs (Bhansar) rows of Purchase Additional become VAT-report
-- only (no ledger posting - the account effect comes from the bill-wise /
-- product-wise terms): office chosen from the master, bill-wise or
-- item-wise (per product of the Ref. Bill) taxable / tax-free values.
-- =============================================
-- customs_offices exists since migration 51 (office_code, office_name, location)
ALTER TABLE tenant_master.customs_offices ADD COLUMN IF NOT EXISTS office_name_np VARCHAR(150);
ALTER TABLE tenant_master.customs_offices ADD COLUMN IF NOT EXISTS district VARCHAR(60);
ALTER TABLE tenant_master.customs_offices ADD COLUMN IF NOT EXISTS border_point VARCHAR(80);

ALTER TABLE tenant_master.purchase_additional_customs ADD COLUMN IF NOT EXISTS customs_office_id UUID REFERENCES tenant_master.customs_offices(id);
ALTER TABLE tenant_master.purchase_additional_customs ADD COLUMN IF NOT EXISTS detail_mode VARCHAR(12) NOT NULL DEFAULT 'bill_wise';
ALTER TABLE tenant_master.purchase_additional_customs ADD COLUMN IF NOT EXISTS item_details JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant_master.purchase_additional_customs DROP CONSTRAINT IF EXISTS additional_customs_detail_mode;
ALTER TABLE tenant_master.purchase_additional_customs ADD CONSTRAINT additional_customs_detail_mode CHECK (detail_mode IN ('bill_wise', 'item_wise'));
