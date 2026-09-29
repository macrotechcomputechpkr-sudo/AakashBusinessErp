-- =============================================
-- 143: Journal Voucher types and TDS
--   journal_vouchers.jv_type - what the voucher is:
--     normal                                  - free Dr / Cr lines
--     purchase, sales                         - taxable / non-taxable goods
--     asset_purchase, asset_sales             - taxable / non-taxable fixed assets
--     service_purchase, service_sales         - taxable / non-taxable services
--     tds                                     - TDS on a payment / expense
--   tax_entry_type stays 'purchase' / 'sales' for the six tax types (VAT
--   register, VAT return); asset purchase is also is_capital.
--   tds_* - TDS of the voucher: the purchase side and TDS type credit the
--   TDS payable ledger (party gets less), the sales side debits TDS
--   receivable (the customer paid less); with its own sub-ledger.
-- =============================================
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS jv_type VARCHAR(20) NOT NULL DEFAULT 'normal';
DO $$ BEGIN
    ALTER TABLE tenant_master.journal_vouchers ADD CONSTRAINT valid_jv_type
        CHECK (jv_type IN ('normal', 'purchase', 'sales', 'asset_purchase', 'asset_sales', 'service_purchase', 'service_sales', 'tds'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- existing tax vouchers keep their meaning
UPDATE tenant_master.journal_vouchers SET jv_type = CASE WHEN tax_entry_type = 'purchase' AND is_capital THEN 'asset_purchase' ELSE tax_entry_type END
WHERE jv_type = 'normal' AND tax_entry_type IN ('purchase', 'sales');

ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS tds_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS tds_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS tds_percent NUMERIC(6,3) NOT NULL DEFAULT 0;
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS tds_base_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS tds_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_jv_type ON tenant_master.journal_vouchers(tenant_id, jv_type, doc_date) WHERE jv_type <> 'normal';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
