-- =============================================
-- CREDIT DAYS CONTROL (ledger-level) + CUSTOMER/VENDOR SPLIT (system-level)
--
-- Ledger Accounts already had "Credit Limit Control" (system_default/
-- warn/block/no_action) but NO equivalent "Credit Days Control" at all,
-- even though Credit Days itself existed as a plain number - there was
-- no way to say what happens when a party goes past its credit days.
-- Adding it as a mirror of the existing Credit Limit Control pattern.
--
-- System Control had no Credit Days/Limit policy at all (Customer or
-- Vendor) - when a ledger's own control says "System Default", there
-- was nothing for it to defer to. Adding four settings so Customer and
-- Vendor can have genuinely different default policies, since a
-- business is usually far stricter about a Customer going overdue than
-- about its own bill to a Vendor.
-- =============================================

ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS credit_days_control VARCHAR(20) DEFAULT 'system_default';

ALTER TABLE tenant_master.ledger_accounts
    ADD CONSTRAINT valid_credit_days_control CHECK (credit_days_control IN ('system_default', 'warn', 'block', 'no_action'));

ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS customer_credit_days_control VARCHAR(20) DEFAULT 'warn',
    ADD COLUMN IF NOT EXISTS customer_credit_limit_control VARCHAR(20) DEFAULT 'warn',
    ADD COLUMN IF NOT EXISTS vendor_credit_days_control VARCHAR(20) DEFAULT 'no_action',
    ADD COLUMN IF NOT EXISTS vendor_credit_limit_control VARCHAR(20) DEFAULT 'no_action';

ALTER TABLE tenant_master.system_control_settings
    ADD CONSTRAINT valid_customer_credit_days_control CHECK (customer_credit_days_control IN ('warn', 'block', 'no_action')),
    ADD CONSTRAINT valid_customer_credit_limit_control CHECK (customer_credit_limit_control IN ('warn', 'block', 'no_action')),
    ADD CONSTRAINT valid_vendor_credit_days_control CHECK (vendor_credit_days_control IN ('warn', 'block', 'no_action')),
    ADD CONSTRAINT valid_vendor_credit_limit_control CHECK (vendor_credit_limit_control IN ('warn', 'block', 'no_action'));
