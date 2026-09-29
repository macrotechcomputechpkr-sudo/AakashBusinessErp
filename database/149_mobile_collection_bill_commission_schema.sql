-- =============================================
-- 149: salesman mobile collection / returns and bill-wise agent commission
--   salesman_agents
--     mobile_cash_ledger_id  - cash ledger a mobile Cash Receipt goes to
--                              (empty = System Control / first cash ledger)
--     allow_mobile_receipt, allow_mobile_return - what the salesman may enter
--   sales_returns.entry_source, cash_bank_entries.entry_source
--     'mobile' = entered on the salesman's phone; kept as draft (pending)
--     until the office posts it (Mobile Approvals, utils/mobileEntries.js)
--   agent_commission_postings
--     basis 'target' (per target, utils/agentTargets.js) or 'bill' (chosen
--     bills, utils/agentBillCommission.js); target_id only for 'target'
--   agent_commission_bills - the bills a 'bill' posting paid commission on.
--     A bill can be in only one live posting (unique while is_active);
--     cancelling the posting frees its bills.
-- =============================================
ALTER TABLE tenant_master.salesman_agents
    ADD COLUMN IF NOT EXISTS mobile_cash_ledger_id uuid REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS allow_mobile_receipt boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS allow_mobile_return boolean NOT NULL DEFAULT true;

ALTER TABLE tenant_master.sales_returns ADD COLUMN IF NOT EXISTS entry_source text;
ALTER TABLE tenant_master.cash_bank_entries ADD COLUMN IF NOT EXISTS entry_source text;
CREATE INDEX IF NOT EXISTS idx_sales_returns_source ON tenant_master.sales_returns(tenant_id, entry_source, status);
CREATE INDEX IF NOT EXISTS idx_cash_bank_source ON tenant_master.cash_bank_entries(tenant_id, entry_source, status);

ALTER TABLE tenant_master.agent_commission_postings
    ADD COLUMN IF NOT EXISTS basis text NOT NULL DEFAULT 'target',
    ALTER COLUMN target_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_master.agent_commission_bills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    posting_id uuid NOT NULL REFERENCES tenant_master.agent_commission_postings(id) ON DELETE CASCADE,
    sales_bill_id uuid NOT NULL REFERENCES tenant_master.sales_bills(id),
    agent_id uuid REFERENCES tenant_master.salesman_agents(id),
    bill_value numeric(18,2) NOT NULL DEFAULT 0,
    return_value numeric(18,2) NOT NULL DEFAULT 0,
    commission_rate numeric(9,4) NOT NULL DEFAULT 0,
    commission_amount numeric(18,2) NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_bill_live ON tenant_master.agent_commission_bills(sales_bill_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_commission_bills_posting ON tenant_master.agent_commission_bills(posting_id);
