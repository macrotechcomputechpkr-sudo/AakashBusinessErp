-- =============================================
-- 142: return sub-ledgers, TDS on bills, cash / bank receipt on a sales bill
--   products.*_return_sub_ledger_id           - a sub-ledger for each return
--       account (sales / purchase return, non-saleable return), next to the
--       existing sales_sub_ledger_id / purchase_sub_ledger_id
--   billing_terms.expiry_return_sub_ledger_id - sub-ledger of the expiry
--       (non-saleable) return ledger
--   sales_bills / purchase_bills: tds_ledger_id, tds_percent,
--       tds_base_amount, tds_amount           - TDS booked with the bill
--       sales:    Dr TDS (receivable)  Cr Customer
--       purchase: Dr Vendor            Cr TDS (payable)
--   purchase_additional_expense_lines.is_tds  - a deduct line that is TDS
--   sales_bills.receipts (JSONB) / received_amount - money received with
--       the bill: [{ ledger_id, sub_ledger_id, amount, ref_no }], each a cash
--       or bank ledger. Dr each cash / bank, Cr Customer. A cash bill must be
--       received in full (cash + banks + TDS = bill total); a credit bill may
--       be partly received, the rest stays outstanding.
--   system_control_settings.sales_tds_ledger_id - default TDS receivable
--       (tds_ledger_id stays the TDS payable default for purchase)
-- =============================================
ALTER TABLE tenant_master.products ADD COLUMN IF NOT EXISTS sales_return_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.products ADD COLUMN IF NOT EXISTS sales_nonsaleable_return_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.products ADD COLUMN IF NOT EXISTS purchase_return_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.products ADD COLUMN IF NOT EXISTS purchase_nonsaleable_return_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);

ALTER TABLE tenant_master.billing_terms ADD COLUMN IF NOT EXISTS expiry_return_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);

ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS sales_tds_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_bills', 'purchase_bills'] LOOP
    EXECUTE format('ALTER TABLE tenant_master.%I ADD COLUMN IF NOT EXISTS tds_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id)', t);
    EXECUTE format('ALTER TABLE tenant_master.%I ADD COLUMN IF NOT EXISTS tds_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id)', t);
    EXECUTE format('ALTER TABLE tenant_master.%I ADD COLUMN IF NOT EXISTS tds_percent NUMERIC(6,3) NOT NULL DEFAULT 0', t);
    EXECUTE format('ALTER TABLE tenant_master.%I ADD COLUMN IF NOT EXISTS tds_base_amount NUMERIC(18,2) NOT NULL DEFAULT 0', t);
    EXECUTE format('ALTER TABLE tenant_master.%I ADD COLUMN IF NOT EXISTS tds_amount NUMERIC(18,2) NOT NULL DEFAULT 0', t);
  END LOOP;
END $$;

ALTER TABLE tenant_master.sales_bills ADD COLUMN IF NOT EXISTS receipts JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant_master.sales_bills ADD COLUMN IF NOT EXISTS received_amount NUMERIC(18,2) NOT NULL DEFAULT 0;

ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS is_tds BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenant_master.sales_bills.receipts IS 'Money received with the bill: [{ledger_id, sub_ledger_id, amount, ref_no}] - Dr cash / bank, Cr customer';
COMMENT ON COLUMN tenant_master.sales_bills.tds_amount IS 'TDS deducted by the customer: Dr TDS receivable, Cr customer';
COMMENT ON COLUMN tenant_master.purchase_bills.tds_amount IS 'TDS withheld from the supplier: Dr supplier, Cr TDS payable';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
