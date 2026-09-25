-- =============================================
-- JOINT PRODUCTS - Relative Sales Value Cost Allocation
-- "1 kukhura katyo vane breast/thigh/wings/khutta jasto kehi part
-- niskinxa - each part is genuinely SELLABLE, not a minor scrap
-- by-product." Standard cost-accounting distinction:
--   - Joint Products: multiple outputs of comparable economic
--     significance from ONE process - cost allocated PROPORTIONALLY
--     by relative value (or qty), the "Relative Sales Value Method".
--   - By-Product: a minor output, netted off at a fixed recovery value
--     BEFORE the remaining cost is allocated to the joint products -
--     the pattern already built (file 62).
-- Both now coexist: fixed-recovery lines net off first, then whatever
-- remains splits proportionally across the main output AND every
-- joint-basis line together.
-- =============================================

ALTER TABLE tenant_master.production_orders
    ADD COLUMN IF NOT EXISTS output_relative_value DECIMAL(15, 4) DEFAULT 0;

ALTER TABLE tenant_master.production_byproducts
    ADD COLUMN IF NOT EXISTS allocation_basis VARCHAR(15) NOT NULL DEFAULT 'fixed_recovery';
ALTER TABLE tenant_master.production_byproducts
    ADD COLUMN IF NOT EXISTS relative_value DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.production_byproducts
    DROP CONSTRAINT IF EXISTS valid_byproduct_allocation_basis;
ALTER TABLE tenant_master.production_byproducts
    ADD CONSTRAINT valid_byproduct_allocation_basis CHECK (allocation_basis IN ('fixed_recovery', 'value_wise', 'qty_wise'));

ALTER TABLE tenant_master.bom_template_byproducts
    ADD COLUMN IF NOT EXISTS allocation_basis VARCHAR(15) NOT NULL DEFAULT 'fixed_recovery';
ALTER TABLE tenant_master.bom_template_byproducts
    ADD COLUMN IF NOT EXISTS relative_value DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.bom_template_byproducts
    DROP CONSTRAINT IF EXISTS valid_template_bp_allocation_basis;
ALTER TABLE tenant_master.bom_template_byproducts
    ADD CONSTRAINT valid_template_bp_allocation_basis CHECK (allocation_basis IN ('fixed_recovery', 'value_wise', 'qty_wise'));
ALTER TABLE tenant_master.bom_templates
    ADD COLUMN IF NOT EXISTS output_relative_value DECIMAL(15, 4) DEFAULT 0;
