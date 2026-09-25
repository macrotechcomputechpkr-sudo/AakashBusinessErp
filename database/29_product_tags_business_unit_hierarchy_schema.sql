-- =============================================
-- PRODUCT TAGS (parity with ledger_accounts.tags, which turned out to
-- be a genuine gap - the column existed but was never wired into the
-- Ledger form's UI either, fixed alongside this in ChartOfAccounts.jsx)
-- =============================================
ALTER TABLE tenant_master.products
    ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_products_tags ON tenant_master.products USING GIN (tags);

-- =============================================
-- PRODUCT COMPANY - SUB LEDGER
-- default_vendor_id and default_agent_id already existed and were
-- already wired end-to-end; only Sub Ledger was missing.
-- =============================================
ALTER TABLE tenant_master.product_companies
    ADD COLUMN IF NOT EXISTS default_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);

-- =============================================
-- BUSINESS UNIT - MULTI-LEVEL HIERARCHY
-- product_groups-style parent_unit_id/hierarchy_level already existed
-- on business_units at the DB level, but were never wired into
-- BusinessUnitManagement.jsx's form at all - a real gap, not a
-- cosmetic one. Adding a System Control master switch (same "gates
-- the rest of the system" pattern as every other toggle there) plus a
-- configurable max depth, since "multiple level ENABLE" implies this
-- should be an opt-in, not always-on.
-- =============================================
ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS enable_business_unit_hierarchy BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS business_unit_max_levels INTEGER DEFAULT 3;

ALTER TABLE tenant_master.system_control_settings
    ADD CONSTRAINT positive_business_unit_max_levels CHECK (business_unit_max_levels >= 1);

-- =============================================
-- SALESMAN/AGENT - ALLOW RATE CHANGE ON MOBILE ORDER
-- FIX: real bug found - the create-agent modal (ChartOfAccounts.jsx) and
-- its backend route (partyMasterRoutes.js) already had a working
-- checkbox and insert field for this, but the actual DB COLUMN was
-- missing on salesman_agents entirely - checking that box and
-- submitting would have failed. Product Company already had this same
-- flag correctly in place; this brings Agent to parity with it.
-- =============================================
ALTER TABLE tenant_master.salesman_agents
    ADD COLUMN IF NOT EXISTS allow_rate_change_on_mobile_order BOOLEAN DEFAULT FALSE;


-- =============================================
-- AGENT - ALLOW RATE CHANGE ON MOBILE ORDER
-- Product Company and Product Group already had this flag; Agent
-- (salesman_agents) did not - a real gap now that the flag exists at
-- both the "what's being sold" (Company/Group) and "who's selling it"
-- (Agent) levels.
-- =============================================
ALTER TABLE tenant_master.salesman_agents
    ADD COLUMN IF NOT EXISTS allow_rate_change_on_mobile_order BOOLEAN DEFAULT FALSE;


-- =============================================
-- USER'S DEFAULT BRANCH
-- FEATURE: "Branch ID should auto-insert based on whichever branch the
-- LOGGED-IN USER works in - no manual Branch selection on the
-- transaction Master." Each user gets ONE default branch; every
-- transaction document (Purchase Requisition, Order, etc.) reads this
-- server-side rather than trusting/asking for a branch_id from the
-- client at all.
-- =============================================
ALTER TABLE tenant_master.users
    ADD COLUMN IF NOT EXISTS default_branch_id UUID REFERENCES tenant_master.branches(id);
