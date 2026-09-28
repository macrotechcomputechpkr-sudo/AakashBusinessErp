-- =============================================
-- 140: more master details
--   product_groups   - short name, breakup quantity, decimal places of qty totals
--   product_companies- short name, address, phones, e-mail, contact person,
--                      currency, discount %
--   salesman_agents  - short name, main (parent) agent, product company,
--                      sub-ledger, credit limit + credit control, address, phones
-- =============================================
ALTER TABLE tenant_master.product_groups ADD COLUMN IF NOT EXISTS short_name VARCHAR(30);
ALTER TABLE tenant_master.product_groups ADD COLUMN IF NOT EXISTS breakup_quantity BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant_master.product_groups ADD COLUMN IF NOT EXISTS qty_decimal_places INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
    ALTER TABLE tenant_master.product_groups ADD CONSTRAINT product_groups_qty_decimals_check CHECK (qty_decimal_places BETWEEN 0 AND 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS short_name VARCHAR(30);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS street VARCHAR(200);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS phone_office VARCHAR(40);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS phone_residence VARCHAR(40);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS mobile VARCHAR(40);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS fax VARCHAR(40);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS contact_person VARCHAR(150);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS currency VARCHAR(10);
ALTER TABLE tenant_master.product_companies ADD COLUMN IF NOT EXISTS discount_percentage NUMERIC(7, 3) DEFAULT 0;

ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS short_name VARCHAR(30);
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS parent_agent_id UUID REFERENCES tenant_master.salesman_agents(id);
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS sub_ledger_id UUID;
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(18, 2) DEFAULT 0;
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS credit_control VARCHAR(20) NOT NULL DEFAULT 'system';
DO $$ BEGIN
    ALTER TABLE tenant_master.salesman_agents ADD CONSTRAINT salesman_agents_credit_control_check CHECK (credit_control IN ('system', 'none', 'warn', 'block'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS street VARCHAR(200);
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS phone_office VARCHAR(40);
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS phone_residence VARCHAR(40);
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS mobile VARCHAR(40);
ALTER TABLE tenant_master.salesman_agents ADD COLUMN IF NOT EXISTS fax VARCHAR(40);

-- purchase additional bill: "Account Posting" - No keeps it out of the ledger (landed cost still moves)
ALTER TABLE tenant_master.purchase_additional_expenses ADD COLUMN IF NOT EXISTS account_posting BOOLEAN NOT NULL DEFAULT TRUE;
