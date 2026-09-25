-- =============================================
-- SUB LEDGER MASTER
-- A sub-ledger is a detailed, individually-tracked account that rolls up
-- into ONE "Main Ledger" (a general ledger control account) - the same
-- accounting pattern as an Accounts Receivable control account with one
-- sub-ledger row per customer, just generalized to any control account
-- that has Sub Ledger Mode = Enable/Compulsory (see
-- 13_sub_ledger_mode_schema.sql).
--
-- sub_ledger_type drives which detail fields are relevant - covers the
-- two the user named (Agent, Shareholder) plus the other common
-- real-world subsidiary-ledger categories: Employee, Director/Partner,
-- Fixed Asset, Bank Sub-Account, Loan Account, and a generic Other.
-- All type-specific columns are nullable on one table (same pattern as
-- ledger_accounts' party-only fields) rather than per-type tables, since
-- only one type applies per row and the app strips whatever doesn't
-- match the chosen type.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.sub_ledgers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    sub_ledger_code VARCHAR(50) NOT NULL,
    short_name VARCHAR(50),
    sub_ledger_name VARCHAR(200) NOT NULL,

    -- FIX/FEATURE: the Main Ledger must be a ledger account that actually
    -- allows sub-ledgers (sub_ledger_mode IN ('enable','compulsory')) -
    -- enforced at the application layer (server/routes/subLedgerRoutes.js)
    -- since a cross-table "the referenced row must satisfy X" rule isn't
    -- expressible as a plain CHECK constraint without a trigger.
    main_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),

    sub_ledger_type VARCHAR(20) NOT NULL DEFAULT 'other',

    -- ---------- Agent ----------
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    commission_rate DECIMAL(5, 2),

    -- ---------- Shareholder ----------
    number_of_shares INTEGER,
    share_class VARCHAR(20),
    face_value_per_share DECIMAL(15, 2),
    shareholding_percentage DECIMAL(5, 2),
    folio_number VARCHAR(50),
    share_certificate_no VARCHAR(50),

    -- ---------- Employee ----------
    employee_user_id UUID,
    employee_code_ref VARCHAR(50),

    -- ---------- Director / Partner ----------
    designation VARCHAR(100),
    partner_shareholding_percentage DECIMAL(5, 2),
    din_pan_number VARCHAR(50),

    -- ---------- Fixed Asset ----------
    asset_code VARCHAR(50),
    asset_purchase_date DATE,
    asset_depreciation_rate DECIMAL(5, 2),

    -- ---------- Bank Sub-Account ----------
    bank_name VARCHAR(200),
    bank_branch VARCHAR(150),
    bank_account_number VARCHAR(50),
    bank_ifsc_swift VARCHAR(30),

    -- ---------- Loan Account ----------
    loan_type VARCHAR(20),
    loan_interest_rate DECIMAL(5, 2),
    loan_tenure_months INTEGER,

    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_sub_ledger_code_per_tenant UNIQUE (tenant_id, sub_ledger_code),
    CONSTRAINT unique_sub_ledger_name_per_tenant UNIQUE (tenant_id, sub_ledger_name),
    CONSTRAINT valid_sub_ledger_type CHECK (sub_ledger_type IN (
        'agent', 'shareholder', 'employee', 'director_partner',
        'fixed_asset', 'bank_sub_account', 'loan_account', 'other'
    )),
    CONSTRAINT valid_share_class CHECK (share_class IS NULL OR share_class IN ('ordinary', 'preference')),
    CONSTRAINT valid_loan_type CHECK (loan_type IS NULL OR loan_type IN ('secured', 'unsecured'))
);

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sub_ledger_code;
CREATE OR REPLACE FUNCTION tenant_master.next_sub_ledger_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_sub_ledger_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'SL')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_sub_ledgers_main_ledger ON tenant_master.sub_ledgers(main_ledger_id);
CREATE INDEX IF NOT EXISTS idx_sub_ledgers_type ON tenant_master.sub_ledgers(tenant_id, sub_ledger_type);
CREATE INDEX IF NOT EXISTS idx_sub_ledgers_tenant ON tenant_master.sub_ledgers(tenant_id);

DROP TRIGGER IF EXISTS trg_sub_ledgers_updated_at ON tenant_master.sub_ledgers;
CREATE TRIGGER trg_sub_ledgers_updated_at BEFORE UPDATE ON tenant_master.sub_ledgers
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
