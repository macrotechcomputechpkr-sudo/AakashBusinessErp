-- =============================================
-- BUDGETS (Budget vs Actual)
-- A budget covers a date range; each line targets ONE ledger or ONE
-- account group (group = all its sub-groups and ledgers) with an amount in
-- the account's natural direction (income / liability as a positive figure).
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    budget_name VARCHAR(120) NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT budget_dates CHECK (date_to >= date_from),
    CONSTRAINT unique_budget_name UNIQUE (tenant_id, budget_name)
);
CREATE TABLE IF NOT EXISTS tenant_master.budget_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    budget_id UUID NOT NULL REFERENCES tenant_master.budgets(id) ON DELETE CASCADE,
    ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    account_group_id UUID REFERENCES tenant_master.account_groups(id),
    amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
    remarks VARCHAR(250),
    CONSTRAINT budget_line_one_target CHECK ((ledger_id IS NOT NULL) <> (account_group_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_line_ledger ON tenant_master.budget_lines(budget_id, ledger_id) WHERE ledger_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_line_group  ON tenant_master.budget_lines(budget_id, account_group_id) WHERE account_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON tenant_master.budget_lines(budget_id);
