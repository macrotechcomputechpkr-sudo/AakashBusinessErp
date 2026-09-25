-- =============================================
-- SUB LEDGER RESTRUCTURE
-- FEATURE: replaces the earlier is_sub_ledger_enabled + sub_ledger_mandatory
-- boolean pair (and the 3-way sub_ledger_selection_type) with what was
-- actually asked for: a single tri-state Sub Ledger Mode (Disable / Enable
-- / Compulsory) plus a separate, simple Allow All Sub Ledger yes/no toggle.
-- No production data exists yet on these columns, so this is a clean
-- replace rather than a data migration.
-- =============================================

ALTER TABLE tenant_master.ledger_accounts
    DROP COLUMN IF EXISTS is_sub_ledger_enabled,
    DROP COLUMN IF EXISTS sub_ledger_mandatory,
    DROP COLUMN IF EXISTS sub_ledger_selection_type;

ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS sub_ledger_mode VARCHAR(20) DEFAULT 'disable',
    ADD COLUMN IF NOT EXISTS allow_all_sub_ledger BOOLEAN DEFAULT TRUE;

ALTER TABLE tenant_master.ledger_accounts
    DROP CONSTRAINT IF EXISTS valid_sub_ledger_mode;
ALTER TABLE tenant_master.ledger_accounts
    ADD CONSTRAINT valid_sub_ledger_mode CHECK (sub_ledger_mode IN ('disable', 'enable', 'compulsory'));
