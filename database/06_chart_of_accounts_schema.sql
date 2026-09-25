-- =============================================
-- CHART OF ACCOUNTS - NFRS COMPLIANT (FIXED)
-- Fixes applied vs. the version supplied by the user:
--  1. ledger_accounts referenced discount_categories/areas/routes/
--     salesman_agents tables that were never defined anywhere -> CREATE
--     TABLE would fail immediately. Those FK columns are removed here;
--     add the real tables back (and the FKs) only once those modules
--     actually exist in this system.
--  2. account_groups.group_type was queried by the tree endpoint but
--     never existed as a column -> added it.
--  3. 'Owner\'s Equity' used backslash-escaping, which Postgres does NOT
--     support inside a plain '...' string with the (default) modern
--     standard_conforming_strings=on setting - this is a SQL syntax
--     error, not a working escape. Fixed to the standard '' (doubled
--     single-quote) form in the seed data below.
--  4. CASH_BANK was given category_type='bank' and then immediately
--     overwritten to category_type='cash' by two sequential UPDATEs -
--     the 'bank' tag was silently lost, breaking "filter by bank
--     category" for the most common bank ledger. Fixed by giving it
--     category_type='both' and having the category filter (in the
--     backend route) treat 'both' as matching either 'cash' or 'bank'
--     (and either 'sales' or 'purchase') requests - this is also what
--     makes "choose ledger category -> group auto-filters/auto-selects"
--     work correctly for cash and bank ledgers.
--  5. tax_exemption_certificate was read/written by the account
--     create/update logic but the column never existed -> added it.
--  6. account_code generation used to be "read the last row for this
--     group, add 1" in application code (race condition under
--     concurrent creates) - replaced with an atomic sequence, same
--     pattern used everywhere else in this system.
-- =============================================

-- ---------- ACCOUNT GROUPS (NFRS Classification) ----------
CREATE TABLE IF NOT EXISTS tenant_master.account_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID REFERENCES tenant_master.company_profile(id) ON DELETE CASCADE,

    group_code VARCHAR(50) NOT NULL,
    group_name VARCHAR(200) NOT NULL,
    group_short_name VARCHAR(50),

    -- FIX: added - 'primary' groups are the top-level NFRS buckets seeded
    -- below; 'sub' groups are anything a user nests under them.
    group_type VARCHAR(20) NOT NULL DEFAULT 'primary',

    -- NFRS Classification (नेपाल वित्तीय प्रतिवेदन मानक)
    nfrs_category VARCHAR(50) NOT NULL,        -- Assets, Liabilities, Equity, Income, Expenses
    nfrs_classification VARCHAR(100),          -- Current/Non-Current, Operating/Non-Operating, etc.
    nfrs_code VARCHAR(50),

    -- Cash Flow Statement classification
    cash_flow_category VARCHAR(50),            -- Operating, Investing, Financing

    -- Funds Flow / Ratio Analysis classification
    funds_flow_type VARCHAR(50),               -- Source, Application, Both
    ratio_analysis_category VARCHAR(50),       -- Liquidity, Solvency, Profitability, Efficiency

    -- Financial statement placement
    balance_sheet_side VARCHAR(20),            -- Assets, Liabilities, Equity (NULL for Income/Expense groups)
    profit_loss_type VARCHAR(20),              -- Income, Expense (NULL for Balance Sheet groups)
    is_balance_sheet BOOLEAN DEFAULT FALSE,
    is_profit_loss BOOLEAN DEFAULT FALSE,

    -- Hierarchy
    parent_group_id UUID REFERENCES tenant_master.account_groups(id),
    parent_group_code VARCHAR(50),
    hierarchy_level INTEGER DEFAULT 1,
    hierarchy_path TEXT,

    -- Defaults inherited by new ledgers created under this group
    default_tax_rate DECIMAL(5, 2),
    default_credit_days INTEGER DEFAULT 0,
    default_credit_limit DECIMAL(15, 2) DEFAULT 0,

    -- Drives the "pick ledger category -> group list auto-filters/
    -- auto-selects" behaviour. 'both' matches BOTH of a related pair
    -- (sales/purchase, or cash/bank) - see the /account-groups route.
    category_type VARCHAR(20) NOT NULL DEFAULT 'others',

    is_active BOOLEAN DEFAULT TRUE,
    is_system BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE, -- the "preferred" group for its category_type, used for auto-select

    display_order INTEGER DEFAULT 1,
    description TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_account_group_code_per_tenant UNIQUE (tenant_id, group_code),
    CONSTRAINT unique_account_group_name_per_tenant UNIQUE (tenant_id, group_name),
    CONSTRAINT valid_group_type CHECK (group_type IN ('primary', 'sub')),
    CONSTRAINT valid_nfrs_category CHECK (nfrs_category IN ('Assets', 'Liabilities', 'Equity', 'Income', 'Expenses')),
    CONSTRAINT valid_cash_flow_category CHECK (cash_flow_category IS NULL OR cash_flow_category IN ('Operating', 'Investing', 'Financing')),
    CONSTRAINT valid_funds_flow_type CHECK (funds_flow_type IS NULL OR funds_flow_type IN ('Source', 'Application', 'Both')),
    CONSTRAINT valid_ratio_category CHECK (ratio_analysis_category IS NULL OR ratio_analysis_category IN ('Liquidity', 'Solvency', 'Profitability', 'Efficiency')),
    CONSTRAINT valid_balance_sheet_side CHECK (balance_sheet_side IS NULL OR balance_sheet_side IN ('Assets', 'Liabilities', 'Equity')),
    CONSTRAINT valid_profit_loss_type CHECK (profit_loss_type IS NULL OR profit_loss_type IN ('Income', 'Expense')),
    -- FIX: 'both' is a real, meaningful value here (see note above), not
    -- just a leftover - kept from the original design intentionally.
    CONSTRAINT valid_category_type CHECK (category_type IN ('sales', 'purchase', 'both', 'cash', 'bank', 'others')),
    CONSTRAINT no_self_parent CHECK (parent_group_id IS NULL OR parent_group_id <> id)
);

-- ---------- LEDGER ACCOUNTS ----------
CREATE TABLE IF NOT EXISTS tenant_master.ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID REFERENCES tenant_master.company_profile(id) ON DELETE CASCADE,

    account_group_id UUID NOT NULL REFERENCES tenant_master.account_groups(id),
    -- Denormalized for fast listing without a join, kept in sync by the backend.
    group_code VARCHAR(50),
    group_name VARCHAR(200),

    account_code VARCHAR(50) NOT NULL,
    account_name VARCHAR(200) NOT NULL,
    account_short_name VARCHAR(50),
    alias VARCHAR(50),
    printing_name VARCHAR(200),

    account_type VARCHAR(50) DEFAULT 'general', -- general, sales, purchase, both, cash, bank
    category_type VARCHAR(20) NOT NULL DEFAULT 'others', -- sales, purchase, both, cash, bank, others

    nfrs_classification VARCHAR(100),
    nfrs_code VARCHAR(50),
    cash_flow_category VARCHAR(50),
    ratio_analysis_category VARCHAR(50),

    opening_balance DECIMAL(15, 2) DEFAULT 0,
    opening_balance_type VARCHAR(10) DEFAULT 'dr',
    opening_balance_date DATE,
    opening_balance_fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),
    current_balance DECIMAL(15, 2) DEFAULT 0,

    pan_number VARCHAR(50),
    vat_pan_type VARCHAR(20) DEFAULT 'Non Registered',
    vat_pan_number VARCHAR(50),
    tin_number VARCHAR(50),
    tan_number VARCHAR(50),
    tds_rate DECIMAL(5, 2) DEFAULT 0,
    tds_applicable BOOLEAN DEFAULT FALSE,
    tax_exempted BOOLEAN DEFAULT FALSE,
    tax_exemption_certificate VARCHAR(100), -- FIX: was used by the app but the column never existed

    contact_person VARCHAR(200),
    contact_person_phone VARCHAR(20),
    contact_person_mobile VARCHAR(20),
    phone_office VARCHAR(20),
    email VARCHAR(150),
    website VARCHAR(200),

    street VARCHAR(200),
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(50) DEFAULT 'Nepal',
    zip_code VARCHAR(20),
    billing_address TEXT,
    shipping_address TEXT,

    currency VARCHAR(10) DEFAULT 'NPR',
    interest_rate DECIMAL(5, 2) DEFAULT 0,
    credit_limit DECIMAL(15, 2) DEFAULT 0,
    credit_days INTEGER DEFAULT 0,

    bank_name VARCHAR(200),
    bank_account_number VARCHAR(50),
    bank_code VARCHAR(50),
    swift_code VARCHAR(20),
    iban_number VARCHAR(50),

    default_discount_percentage DECIMAL(5, 2) DEFAULT 0,

    tags TEXT[] DEFAULT '{}',

    is_active BOOLEAN DEFAULT TRUE,
    is_enabled BOOLEAN DEFAULT TRUE,
    is_system BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    is_tax_applicable BOOLEAN DEFAULT TRUE,

    attachment_url TEXT,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_ledger_account_code_per_tenant UNIQUE (tenant_id, account_code),
    CONSTRAINT unique_ledger_account_name_per_tenant UNIQUE (tenant_id, account_name),
    CONSTRAINT valid_ledger_account_type CHECK (account_type IN ('general', 'sales', 'purchase', 'both', 'cash', 'bank')),
    CONSTRAINT valid_ledger_category_type CHECK (category_type IN ('sales', 'purchase', 'both', 'cash', 'bank', 'others')),
    CONSTRAINT valid_vat_pan_type CHECK (vat_pan_type IN ('VAT', 'PAN', 'Both', 'Non Registered')),
    CONSTRAINT valid_opening_balance_type CHECK (opening_balance_type IN ('dr', 'cr'))
    -- NOTE: discount_category_id / area_id / route_id / agent_id from the
    -- original design are intentionally omitted - those master tables
    -- (discount_categories, areas, routes, salesman_agents) don't exist
    -- anywhere in this system yet. Add them back as real FKs once those
    -- modules are actually built, rather than pointing at nothing.
);

-- Link opening_balances (declared in 02_tenant_master_schema.sql) to a
-- real chart-of-accounts row now that ledger_accounts exists.
ALTER TABLE tenant_master.opening_balances
    ADD COLUMN IF NOT EXISTS ledger_account_id UUID REFERENCES tenant_master.ledger_accounts(id);

-- ---------- COST CENTERS ----------
CREATE TABLE IF NOT EXISTS tenant_master.cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID REFERENCES tenant_master.company_profile(id) ON DELETE CASCADE,

    cost_center_code VARCHAR(50) NOT NULL,
    cost_center_name VARCHAR(200) NOT NULL,
    cost_center_short_name VARCHAR(50),
    cost_center_type VARCHAR(50) DEFAULT 'department',

    nfrs_allocation_basis VARCHAR(50), -- Direct, Indirect, Activity Based
    allocation_percentage DECIMAL(5, 2) DEFAULT 100,

    annual_budget DECIMAL(15, 2) DEFAULT 0,
    monthly_budget DECIMAL(15, 2) DEFAULT 0,
    budget_currency VARCHAR(10) DEFAULT 'NPR',

    responsible_person VARCHAR(200),
    responsible_person_phone VARCHAR(20),
    responsible_person_email VARCHAR(150),

    is_active BOOLEAN DEFAULT TRUE,
    is_system BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 1,
    description TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_cost_center_code_per_tenant UNIQUE (tenant_id, cost_center_code)
);

-- ---------- PROFIT CENTERS ----------
CREATE TABLE IF NOT EXISTS tenant_master.profit_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID REFERENCES tenant_master.company_profile(id) ON DELETE CASCADE,

    profit_center_code VARCHAR(50) NOT NULL,
    profit_center_name VARCHAR(200) NOT NULL,
    profit_center_short_name VARCHAR(50),
    profit_center_type VARCHAR(50) DEFAULT 'division',

    annual_target DECIMAL(15, 2) DEFAULT 0,
    quarterly_target DECIMAL(15, 2) DEFAULT 0,
    monthly_target DECIMAL(15, 2) DEFAULT 0,

    responsible_person VARCHAR(200),
    responsible_person_phone VARCHAR(20),
    responsible_person_email VARCHAR(150),

    is_active BOOLEAN DEFAULT TRUE,
    is_system BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 1,
    description TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_profit_center_code_per_tenant UNIQUE (tenant_id, profit_center_code)
);

-- ---------- atomic code generators (fixes the race-condition-prone "read last row, +1" pattern) ----------
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_account_group_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_ledger_account_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_cost_center_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_profit_center_code;

CREATE OR REPLACE FUNCTION tenant_master.next_account_group_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_account_group_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'GRP')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

-- Keeps the readable "{GROUP_CODE}-{0001}" style from the original design,
-- but the numeric part now comes from one global atomic sequence instead
-- of "max(existing) + 1" in application code, so it can never collide
-- under concurrent inserts. The trade-off is the numbers are not
-- contiguous per group (e.g. RECEIVABLES-0001, then next ledger anywhere
-- might be SALES-0002) - correctness over cosmetic sequencing.
CREATE OR REPLACE FUNCTION tenant_master.next_ledger_account_code(group_code TEXT, fy_prefix TEXT DEFAULT '')
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_ledger_account_code');
  RETURN (CASE WHEN fy_prefix IS NOT NULL AND fy_prefix != '' THEN UPPER(fy_prefix) || '-' ELSE '' END)
      || UPPER(COALESCE(NULLIF(group_code, ''), 'LDG')) || '-' || LPAD(n::TEXT, 4, '0');
END; $$ LANGUAGE plpgsql;

-- FEATURE: Short Name (Alias) auto-generation - initials of each word in
-- the Name (e.g. "Tanka Prasad Adhikari" -> "TPA") + a truly sequential
-- 5-digit number from its own atomic sequence, e.g. "TPA00001". Server-
-- side and atomic for the same reason account codes are - two people
-- creating ledgers at the same moment must never collide, which a
-- client-side random suffix could never guarantee.
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_ledger_short_name;
CREATE OR REPLACE FUNCTION tenant_master.next_ledger_short_name(initials TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_ledger_short_name');
  RETURN UPPER(COALESCE(NULLIF(initials, ''), 'LDG')) || LPAD(n::TEXT, 5, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_cost_center_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_cost_center_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'CC')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_profit_center_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_profit_center_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'PC')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

-- ---------- indexes ----------
CREATE INDEX IF NOT EXISTS idx_account_groups_tenant ON tenant_master.account_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_account_groups_parent ON tenant_master.account_groups(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_account_groups_category ON tenant_master.account_groups(tenant_id, category_type);
CREATE INDEX IF NOT EXISTS idx_account_groups_nfrs ON tenant_master.account_groups(nfrs_category);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_tenant ON tenant_master.ledger_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_group ON tenant_master.ledger_accounts(account_group_id);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_category ON tenant_master.ledger_accounts(tenant_id, category_type);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_name ON tenant_master.ledger_accounts(account_name);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_pan ON tenant_master.ledger_accounts(pan_number);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_tags ON tenant_master.ledger_accounts USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_cost_centers_tenant ON tenant_master.cost_centers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profit_centers_tenant ON tenant_master.profit_centers(tenant_id);

-- ---------- updated_at triggers ----------
DROP TRIGGER IF EXISTS trg_account_groups_updated_at ON tenant_master.account_groups;
CREATE TRIGGER trg_account_groups_updated_at BEFORE UPDATE ON tenant_master.account_groups
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_ledger_accounts_updated_at ON tenant_master.ledger_accounts;
CREATE TRIGGER trg_ledger_accounts_updated_at BEFORE UPDATE ON tenant_master.ledger_accounts
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_cost_centers_updated_at ON tenant_master.cost_centers;
CREATE TRIGGER trg_cost_centers_updated_at BEFORE UPDATE ON tenant_master.cost_centers
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_profit_centers_updated_at ON tenant_master.profit_centers;
CREATE TRIGGER trg_profit_centers_updated_at BEFORE UPDATE ON tenant_master.profit_centers
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- =============================================
-- DEFAULT NFRS ACCOUNT GROUPS (seed function)
-- FIX: the original shipped these as raw INSERT statements with literal
-- 'tenant-id' / 'company-id' placeholder strings (not valid UUIDs - would
-- fail with "invalid input syntax for type uuid" if ever run as-is, and
-- required manual find/replace per tenant). Wrapped in a function instead,
-- called once per tenant right after company creation (see
-- companyRoutes.js), the same way a first fiscal year is auto-created.
-- Also fixes the 'Owner\'s Equity' invalid escaping (-> 'Owner''s Equity')
-- and the CASH_BANK category_type conflict (-> 'both', see notes above).
-- =============================================
CREATE OR REPLACE FUNCTION tenant_master.seed_default_account_groups(p_tenant_id UUID, p_company_id UUID, p_created_by UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO tenant_master.account_groups
        (tenant_id, company_id, group_code, group_name, nfrs_category, nfrs_classification,
         cash_flow_category, funds_flow_type, ratio_analysis_category,
         balance_sheet_side, is_balance_sheet, display_order, category_type,
         is_system, is_default, created_by, updated_by)
    VALUES
    -- Assets
    (p_tenant_id, p_company_id, 'CURRENT_ASSETS', 'Current Assets', 'Assets', 'Current', 'Operating', 'Application', 'Liquidity', 'Assets', true, 1, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'CASH_BANK', 'Cash & Bank', 'Assets', 'Current', 'Operating', 'Source', 'Liquidity', 'Assets', true, 2, 'both', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'RECEIVABLES', 'Accounts Receivable', 'Assets', 'Current', 'Operating', 'Source', 'Liquidity', 'Assets', true, 3, 'sales', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'INVENTORY', 'Inventory', 'Assets', 'Current', 'Operating', 'Application', 'Efficiency', 'Assets', true, 4, 'both', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'PREPAYMENTS', 'Prepayments', 'Assets', 'Current', 'Operating', 'Application', 'Liquidity', 'Assets', true, 5, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'FIXED_ASSETS', 'Fixed Assets', 'Assets', 'Non-Current', 'Investing', 'Application', 'Solvency', 'Assets', true, 10, 'others', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'INVESTMENTS', 'Long Term Investments', 'Assets', 'Non-Current', 'Investing', 'Application', 'Solvency', 'Assets', true, 13, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'DEPOSITS', 'Deposits & Advances', 'Assets', 'Current', 'Operating', 'Application', 'Liquidity', 'Assets', true, 15, 'others', true, false, p_created_by, p_created_by),
    -- Liabilities
    (p_tenant_id, p_company_id, 'CURRENT_LIABILITIES', 'Current Liabilities', 'Liabilities', 'Current', 'Operating', 'Source', 'Liquidity', 'Liabilities', true, 20, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'PAYABLES', 'Accounts Payable', 'Liabilities', 'Current', 'Operating', 'Source', 'Liquidity', 'Liabilities', true, 21, 'purchase', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'BANK_OVERDRAFT', 'Bank Overdraft', 'Liabilities', 'Current', 'Operating', 'Source', 'Liquidity', 'Liabilities', true, 22, 'bank', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'TAX_PAYABLE', 'Tax Payable', 'Liabilities', 'Current', 'Operating', 'Source', 'Liquidity', 'Liabilities', true, 23, 'others', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'ACCRUED_EXPENSES', 'Accrued Expenses', 'Liabilities', 'Current', 'Operating', 'Source', 'Liquidity', 'Liabilities', true, 24, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'LONG_TERM_LOANS', 'Long Term Loans', 'Liabilities', 'Non-Current', 'Financing', 'Source', 'Solvency', 'Liabilities', true, 30, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'BANK_LOANS', 'Bank Loans', 'Liabilities', 'Non-Current', 'Financing', 'Source', 'Solvency', 'Liabilities', true, 31, 'bank', true, false, p_created_by, p_created_by),
    -- Equity
    (p_tenant_id, p_company_id, 'SHARE_CAPITAL', 'Share Capital', 'Equity', 'Owner''s Equity', 'Financing', 'Source', 'Solvency', 'Equity', true, 40, 'others', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'RETAINED_EARNINGS', 'Retained Earnings', 'Equity', 'Owner''s Equity', 'Financing', 'Source', 'Profitability', 'Equity', true, 41, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'RESERVES', 'Reserves & Surplus', 'Equity', 'Owner''s Equity', 'Financing', 'Source', 'Solvency', 'Equity', true, 42, 'others', true, false, p_created_by, p_created_by),
    -- Income
    (p_tenant_id, p_company_id, 'SALES', 'Sales Revenue', 'Income', 'Operating', 'Operating', 'Source', 'Profitability', NULL, false, 51, 'sales', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'SALES_RETURN', 'Sales Return', 'Income', 'Operating', 'Operating', 'Application', 'Profitability', NULL, false, 52, 'sales', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'DISCOUNT_ALLOWED', 'Discount Allowed', 'Income', 'Operating', 'Operating', 'Application', 'Profitability', NULL, false, 53, 'sales', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'OTHER_INCOME', 'Other Income', 'Income', 'Non-Operating', 'Operating', 'Source', 'Profitability', NULL, false, 55, 'others', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'INTEREST_INCOME', 'Interest Income', 'Income', 'Non-Operating', 'Operating', 'Source', 'Profitability', NULL, false, 56, 'others', true, false, p_created_by, p_created_by),
    -- Expenses
    (p_tenant_id, p_company_id, 'PURCHASES', 'Purchases', 'Expenses', 'Operating', 'Operating', 'Application', 'Efficiency', NULL, false, 61, 'purchase', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'PURCHASE_RETURN', 'Purchase Return', 'Expenses', 'Operating', 'Operating', 'Source', 'Efficiency', NULL, false, 62, 'purchase', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'DISCOUNT_RECEIVED', 'Discount Received', 'Expenses', 'Operating', 'Operating', 'Source', 'Efficiency', NULL, false, 63, 'purchase', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'SALARY', 'Salary & Wages', 'Expenses', 'Operating', 'Operating', 'Application', 'Profitability', NULL, false, 71, 'others', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'RENT', 'Rent', 'Expenses', 'Operating', 'Operating', 'Application', 'Profitability', NULL, false, 72, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'UTILITIES', 'Utilities', 'Expenses', 'Operating', 'Operating', 'Application', 'Profitability', NULL, false, 73, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'ADMIN_EXPENSES', 'Administrative Expenses', 'Expenses', 'Operating', 'Operating', 'Application', 'Profitability', NULL, false, 80, 'others', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'BANK_CHARGES', 'Bank Charges', 'Expenses', 'Non-Operating', 'Financing', 'Application', 'Profitability', NULL, false, 91, 'bank', true, false, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'INTEREST_EXPENSE', 'Interest Expense', 'Expenses', 'Non-Operating', 'Financing', 'Application', 'Solvency', NULL, false, 92, 'others', true, true, p_created_by, p_created_by),
    (p_tenant_id, p_company_id, 'DEPRECIATION', 'Depreciation', 'Expenses', 'Non-Operating', 'Operating', 'Application', 'Profitability', NULL, false, 95, 'others', true, false, p_created_by, p_created_by)
    ON CONFLICT (tenant_id, group_code) DO NOTHING;

    -- Seed a starter ledger under the two most commonly-needed groups so a
    -- brand-new company isn't staring at an empty ledger list.
    INSERT INTO tenant_master.ledger_accounts
        (tenant_id, company_id, account_group_id, group_code, group_name, account_code, account_name,
         account_type, category_type, is_system, created_by, updated_by)
    SELECT p_tenant_id, p_company_id, id, group_code, group_name, 'CASH-0001', 'Cash in Hand', 'cash', 'cash', true, p_created_by, p_created_by
    FROM tenant_master.account_groups WHERE tenant_id = p_tenant_id AND group_code = 'CASH_BANK'
    ON CONFLICT (tenant_id, account_code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
