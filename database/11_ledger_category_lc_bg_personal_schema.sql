-- =============================================
-- LEDGER CATEGORY (custom, tenant-defined) + LC/BG + PERSONAL DETAILS
-- =============================================

-- ---------- FEATURE TOGGLE ----------
-- FIX/FEATURE: "ledger category" here is a SEPARATE, freely-renameable
-- custom classification a tenant can define for their own grouping/area
-- needs - distinct from the fixed category_type enum (sales/purchase/
-- both/cash/bank/others) which drives account-group filtering and
-- party-field visibility and must stay a closed set. This custom layer
-- is OFF by default per requirement - a tenant opts in and can rename
-- categories to fit how THEY think about their ledgers.
ALTER TABLE tenant_master.company_profile
    ADD COLUMN IF NOT EXISTS enable_custom_ledger_categories BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS custom_ledger_category_label VARCHAR(100) DEFAULT 'Ledger Category';

-- ---------- CUSTOM LEDGER CATEGORY MASTER ----------
CREATE TABLE IF NOT EXISTS tenant_master.ledger_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    category_code VARCHAR(50) NOT NULL,
    category_name VARCHAR(150) NOT NULL,
    description TEXT,

    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_ledger_category_code_per_tenant UNIQUE (tenant_id, category_code),
    CONSTRAINT unique_ledger_category_name_per_tenant UNIQUE (tenant_id, category_name)
);

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_ledger_category_code;
CREATE OR REPLACE FUNCTION tenant_master.next_ledger_category_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_ledger_category_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'LC')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_ledger_categories_tenant ON tenant_master.ledger_categories(tenant_id);

DROP TRIGGER IF EXISTS trg_ledger_categories_updated_at ON tenant_master.ledger_categories;
CREATE TRIGGER trg_ledger_categories_updated_at BEFORE UPDATE ON tenant_master.ledger_categories
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- ---------- ledger_accounts: link to the custom category ----------
-- Available on ANY ledger (not party-restricted) - this is a general
-- tenant-defined grouping tool, not specifically about the party.
ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS ledger_category_id UUID REFERENCES tenant_master.ledger_categories(id);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_ledger_category ON tenant_master.ledger_accounts(ledger_category_id);

-- =============================================
-- LC (Letter of Credit) / BG (Bank Guarantee) - party-ledger trade
-- finance details, settable at ledger creation and editable later from
-- the master (same field, just exposed in two places in the UI).
-- =============================================
ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS lc_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS lc_bank_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS lc_amount DECIMAL(15, 2),
    ADD COLUMN IF NOT EXISTS lc_issue_date DATE,
    ADD COLUMN IF NOT EXISTS lc_expiry_date DATE,
    ADD COLUMN IF NOT EXISTS bg_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS bg_bank_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS bg_amount DECIMAL(15, 2),
    ADD COLUMN IF NOT EXISTS bg_issue_date DATE,
    ADD COLUMN IF NOT EXISTS bg_expiry_date DATE;

-- =============================================
-- CUSTOMER PERSONAL DETAILS (birthday/anniversary/religion) - relevant
-- for individual customers, used for relationship/CRM purposes (birthday
-- greetings etc.). Party-ledger only, same as LC/BG above.
-- =============================================
ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS customer_date_of_birth DATE,
    ADD COLUMN IF NOT EXISTS customer_anniversary_date DATE,
    ADD COLUMN IF NOT EXISTS customer_religion VARCHAR(50);

-- =============================================
-- ADDITIONAL EXCISE DUTY DETAILS (excise_registration_no already added
-- in 10_ledger_extended_fields_schema.sql)
-- =============================================
ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS excise_duty_rate DECIMAL(5, 2),
    ADD COLUMN IF NOT EXISTS excise_exemption_certificate VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_lc_expiry ON tenant_master.ledger_accounts(lc_expiry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_bg_expiry ON tenant_master.ledger_accounts(bg_expiry_date);
