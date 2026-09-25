-- =============================================
-- VENDOR SUB-LEDGER ON EVERY PURCHASE-SIDE DOCUMENT
-- Sales already carries customer_sub_ledger_id on all its documents and
-- Purchase Bill / Return got vendor_sub_ledger_id in migration 105; the
-- rest of the purchase chain had none, so the sub-ledger chosen on an
-- Order could not flow to its GRN / Bill. This closes that gap.
-- =============================================
ALTER TABLE tenant_master.purchase_requisitions        ADD COLUMN IF NOT EXISTS vendor_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.purchase_quotations          ADD COLUMN IF NOT EXISTS vendor_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.purchase_orders              ADD COLUMN IF NOT EXISTS vendor_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.purchase_grns                ADD COLUMN IF NOT EXISTS vendor_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.purchase_nonsaleable_returns ADD COLUMN IF NOT EXISTS vendor_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.purchase_additional_expenses ADD COLUMN IF NOT EXISTS vendor_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
