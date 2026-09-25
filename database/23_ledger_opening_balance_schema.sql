-- =============================================
-- LEDGER OPENING BALANCE - DOCUMENT-WISE + RE-BASELINE HISTORY
--
-- Builds on the EXISTING fiscal_years.has_opening_balance flag (already
-- in 02_tenant_master_schema.sql) as "which fiscal year is currently
-- allowed for opening balance entry" - reused rather than duplicated.
--
-- Two new tables:
--   1. ledger_opening_bill_details - for Customer/Vendor (category_type
--      sales/purchase/both) ledgers, an OPTIONAL document-wise (Tally's
--      "Bill-wise Details") breakdown of the opening balance: instead of
--      one lump sum, list the individual outstanding bills that make it
--      up (Bill Date, Bill No, Bill Amount, Agent, Balance Amount).
--   2. ledger_opening_history - the re-baseline audit trail. When a
--      business re-opens balances in a LATER fiscal year than the one
--      originally used (e.g. started in FY75/76, decides to re-baseline
--      from FY80/81), this captures the previous opening figure, the new
--      one, and the computed Opening Difference - honestly scoped to
--      what this system can compute today: since the Sales/Purchase/
--      Journal transaction module doesn't exist yet, "closing balance as
--      of now" and "the original opening balance" are the same number
--      (nothing has posted to change it) - the formula and storage here
--      are exactly correct and will keep working once transactions
--      exist and genuinely move a ledger's balance between FYs.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.ledger_opening_bill_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    ledger_account_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id) ON DELETE CASCADE,
    fiscal_year_id UUID NOT NULL REFERENCES tenant_master.fiscal_years(id),

    bill_date DATE NOT NULL,
    bill_no VARCHAR(50) NOT NULL,
    bill_amount DECIMAL(15, 2) NOT NULL,
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    balance_amount DECIMAL(15, 2) NOT NULL,

    display_order INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT positive_bill_amount CHECK (bill_amount > 0),
    CONSTRAINT non_negative_balance_amount CHECK (balance_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_opening_bill_details_ledger ON tenant_master.ledger_opening_bill_details(ledger_account_id, fiscal_year_id);

CREATE TABLE IF NOT EXISTS tenant_master.ledger_opening_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    ledger_account_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id) ON DELETE CASCADE,

    previous_fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),
    previous_opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    previous_opening_balance_type VARCHAR(2) NOT NULL DEFAULT 'dr',

    new_fiscal_year_id UUID NOT NULL REFERENCES tenant_master.fiscal_years(id),
    new_opening_balance DECIMAL(15, 2) NOT NULL,
    new_opening_balance_type VARCHAR(2) NOT NULL,

    -- Signed difference expressed as (amount, type) the same way every
    -- other balance in this system is - computed server-side, never
    -- entered directly, so it can never drift from the two figures above.
    opening_difference_amount DECIMAL(15, 2) NOT NULL,
    opening_difference_type VARCHAR(2) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT valid_prev_balance_type CHECK (previous_opening_balance_type IN ('dr', 'cr')),
    CONSTRAINT valid_new_balance_type CHECK (new_opening_balance_type IN ('dr', 'cr')),
    CONSTRAINT valid_diff_type CHECK (opening_difference_type IN ('dr', 'cr'))
);

CREATE INDEX IF NOT EXISTS idx_opening_history_ledger ON tenant_master.ledger_opening_history(ledger_account_id);
