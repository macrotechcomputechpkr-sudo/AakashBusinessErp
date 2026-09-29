-- =============================================
-- 150: small balance write-off (utils/balanceWriteoff.js)
--   journal_vouchers.jv_type 'balance_writeoff' - one JV that nils many
--   customer / supplier balances below an amount: Dr discount (allowed) /
--   Cr customer for Dr balances, Dr supplier (or customer in advance) /
--   Cr discount (received) for Cr balances
--   balance_writeoff_lines - the parties of such a JV (the bill-wise
--   settlement of each party hangs on its line: source_type
--   'balance_writeoff', source_id = line id; cancelling the JV reverses them)
-- =============================================
ALTER TABLE tenant_master.journal_vouchers DROP CONSTRAINT IF EXISTS journal_vouchers_jv_type_check;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'tenant_master.journal_vouchers'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%jv_type%' LOOP
    EXECUTE format('ALTER TABLE tenant_master.journal_vouchers DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE tenant_master.journal_vouchers ADD CONSTRAINT journal_vouchers_jv_type_check
  CHECK (jv_type IN ('normal', 'purchase', 'sales', 'asset_purchase', 'asset_sales', 'service_purchase', 'service_sales', 'tds', 'balance_writeoff'));

CREATE TABLE IF NOT EXISTS tenant_master.balance_writeoff_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    jv_id uuid NOT NULL REFERENCES tenant_master.journal_vouchers(id) ON DELETE CASCADE,
    party_ledger_id uuid NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    balance_before numeric(18,2) NOT NULL,
    amount numeric(18,2) NOT NULL,
    nature text NOT NULL,              -- 'dr' balance written off (party credited) / 'cr' (party debited)
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_writeoff_lines_jv ON tenant_master.balance_writeoff_lines(jv_id);
