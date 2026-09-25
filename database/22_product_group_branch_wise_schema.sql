-- =============================================
-- PRODUCT GROUP - BRANCH WISE MASTER
-- Adds the per-group side of "Branch Wise Master": whether this group
-- (and by extension the products under it) is scoped to one specific
-- Branch rather than shared across the whole tenant. Only meaningful,
-- and only shown in the UI, when System Control's
-- enable_branch_wise_master is on - same gating pattern as every other
-- System-Control-conditional field in this project (Batch/Vehicle/
-- Serial/Barcode-Print).
-- =============================================

ALTER TABLE tenant_master.product_groups
    ADD COLUMN IF NOT EXISTS is_branch_wise BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES tenant_master.branches(id);

ALTER TABLE tenant_master.product_groups
    ADD CONSTRAINT branch_wise_requires_branch CHECK (NOT is_branch_wise OR branch_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_product_groups_branch ON tenant_master.product_groups(branch_id) WHERE branch_id IS NOT NULL;
