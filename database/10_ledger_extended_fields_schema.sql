-- =============================================
-- LEDGER ACCOUNTS - EXTENDED FIELDS
-- Adds the "Other Information" and "Sub Ledger" fields from the
-- reference screenshots: TIN/Excise/CST/DL registration numbers,
-- Ledger Type (drives TDS/VAT treatment for non-party ledgers), Business
-- Category, Voucher Adjustment Basis, Schedule reference, Lock, and the
-- Sub Ledger enable/mandatory/selection-type + credit limit control
-- settings. All original naming/columns - no third-party schema copied,
-- only the general field CONCEPTS from the reference screenshots.
-- =============================================

ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS excise_registration_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS cst_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS dl_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS business_category VARCHAR(100),
    ADD COLUMN IF NOT EXISTS voucher_adjustment_basis VARCHAR(50),
    ADD COLUMN IF NOT EXISTS schedule_reference VARCHAR(100),
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,

    -- FEATURE: only meaningful for non-party ledgers (category_type NOT
    -- IN ('sales','purchase','both','cash','bank')) i.e. category='others'
    -- - drives which TDS/VAT withholding rule applies. Enforced at the
    -- application layer in chartOfAccountsRoutes.js, since a CHECK
    -- constraint referencing category_type on the same row is fine, but
    -- the *meaning* (which withholding table to use) is business logic,
    -- not something to hard-code into the database.
    ADD COLUMN IF NOT EXISTS ledger_type VARCHAR(40) DEFAULT 'general',

    -- FEATURE: Sub Ledger settings (party ledgers can optionally track
    -- finer sub-accounts, e.g. per-project or per-branch breakdown of a
    -- single customer).
    ADD COLUMN IF NOT EXISTS is_sub_ledger_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sub_ledger_mandatory BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sub_ledger_selection_type VARCHAR(20) DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS credit_limit_control VARCHAR(20) DEFAULT 'system_default';

ALTER TABLE tenant_master.ledger_accounts
    DROP CONSTRAINT IF EXISTS valid_ledger_type;
ALTER TABLE tenant_master.ledger_accounts
    ADD CONSTRAINT valid_ledger_type CHECK (ledger_type IN (
        'general', 'vat', 'tds', 'commission',
        'service_purchase_capital', 'service_purchase_other',
        'goods_purchase_capital', 'goods_purchase_other',
        'service_sales', 'goods_sales'
    ));

ALTER TABLE tenant_master.ledger_accounts
    DROP CONSTRAINT IF EXISTS valid_sub_ledger_selection_type;
ALTER TABLE tenant_master.ledger_accounts
    ADD CONSTRAINT valid_sub_ledger_selection_type CHECK (sub_ledger_selection_type IN ('all', 'open_only', 'selected_only'));

ALTER TABLE tenant_master.ledger_accounts
    DROP CONSTRAINT IF EXISTS valid_credit_limit_control;
ALTER TABLE tenant_master.ledger_accounts
    ADD CONSTRAINT valid_credit_limit_control CHECK (credit_limit_control IN ('system_default', 'warn', 'block', 'no_action'));

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_ledger_type ON tenant_master.ledger_accounts(tenant_id, ledger_type);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_locked ON tenant_master.ledger_accounts(is_locked);
