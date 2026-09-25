-- =============================================
-- LEDGER SHORT NAME (alias)
-- FEATURE: a short, changeable alias distinct from both the formal
-- account_name and the auto-generated, immutable account_code - shown
-- right after the Name field on the ledger form.
-- =============================================

ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS short_name VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_short_name ON tenant_master.ledger_accounts(tenant_id, short_name);
