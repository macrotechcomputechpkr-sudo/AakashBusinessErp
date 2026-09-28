-- =============================================
-- 144: TDS journal against bills
--   journal_vouchers.tds_side - TDS type only: 'purchase' (TDS on purchase:
--       the supplier's bills, Dr supplier / Cr TDS payable) or 'sales' (TDS
--       on sales: the customer's bills, Dr TDS receivable / Cr customer)
--   jv_tds_bills - which bills a TDS journal took TDS on (purchase bill,
--       purchase additional expense, sales bill), with base / % / TDS per
--       bill. A bill on a journal that is not cancelled is not offered again.
-- =============================================
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS tds_side VARCHAR(10);
DO $$ BEGIN
    ALTER TABLE tenant_master.journal_vouchers ADD CONSTRAINT valid_jv_tds_side CHECK (tds_side IS NULL OR tds_side IN ('purchase', 'sales'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE tenant_master.journal_vouchers SET tds_side = 'purchase' WHERE jv_type = 'tds' AND tds_side IS NULL;

CREATE TABLE IF NOT EXISTS tenant_master.jv_tds_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    jv_id UUID NOT NULL REFERENCES tenant_master.journal_vouchers(id) ON DELETE CASCADE,
    source_type VARCHAR(30) NOT NULL,
    source_id UUID NOT NULL,
    source_doc_no VARCHAR(60),
    source_date DATE,
    party_ledger_id UUID,
    bill_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    base_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    tds_percent NUMERIC(6,3) NOT NULL DEFAULT 0,
    tds_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_jv_tds_bill_source CHECK (source_type IN ('purchase_bill', 'purchase_additional', 'sales_bill'))
);
CREATE INDEX IF NOT EXISTS idx_jv_tds_bills_source ON tenant_master.jv_tds_bills(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_jv_tds_bills_jv ON tenant_master.jv_tds_bills(jv_id);
COMMENT ON TABLE tenant_master.jv_tds_bills IS 'Bills a TDS journal voucher took TDS on (one TDS per bill)';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
