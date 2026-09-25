-- =============================================
-- LEDGER CATEGORY -> MULTI-SELECT (many-to-many)
-- FEATURE: a ledger account can now belong to MULTIPLE custom ledger
-- categories at once, not just one. Replaces the earlier single FK
-- column with a junction table. No production data exists yet on this
-- column, so this is a clean replace.
-- =============================================

ALTER TABLE tenant_master.ledger_accounts
    DROP COLUMN IF EXISTS ledger_category_id;

CREATE TABLE IF NOT EXISTS tenant_master.ledger_account_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    ledger_account_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id) ON DELETE CASCADE,
    ledger_category_id UUID NOT NULL REFERENCES tenant_master.ledger_categories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_ledger_account_category UNIQUE (ledger_account_id, ledger_category_id)
);

CREATE INDEX IF NOT EXISTS idx_lac_ledger_account ON tenant_master.ledger_account_categories(ledger_account_id);
CREATE INDEX IF NOT EXISTS idx_lac_ledger_category ON tenant_master.ledger_account_categories(ledger_category_id);
CREATE INDEX IF NOT EXISTS idx_lac_tenant ON tenant_master.ledger_account_categories(tenant_id);
