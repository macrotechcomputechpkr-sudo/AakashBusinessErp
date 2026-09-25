-- =============================================
-- ACCOUNTING DIMENSIONS: Sub-Ledger + Product Company
-- Audit found:
--   * Sales Bill/Return: no sub-ledger for the Sales Account
--     (Purchase already has goods_sub_ledger_id).
--   * Purchase Bill/Return: no sub-ledger for the Vendor
--     (Sales already has customer_sub_ledger_id).
--   * Journal / Credit Note / Debit Note lines and Cash-Bank entries:
--     no Product Company; note lines also had no sub-ledger.
--   * GL lines had no Product Company, so nothing could be reported by it.
-- All columns are nullable - existing behaviour is unchanged until used.
-- =============================================

ALTER TABLE tenant_master.sales_bills    ADD COLUMN IF NOT EXISTS sales_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.sales_returns  ADD COLUMN IF NOT EXISTS sales_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.purchase_bills   ADD COLUMN IF NOT EXISTS vendor_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.purchase_returns ADD COLUMN IF NOT EXISTS vendor_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);

ALTER TABLE tenant_master.journal_voucher_details ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.credit_note_details ADD COLUMN IF NOT EXISTS sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.credit_note_details ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.debit_note_details  ADD COLUMN IF NOT EXISTS sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.debit_note_details  ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.cash_bank_entries   ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);

ALTER TABLE tenant_master.ledger_transaction_lines ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_product_company ON tenant_master.ledger_transaction_lines(product_company_id) WHERE product_company_id IS NOT NULL;
