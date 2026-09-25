-- =============================================
-- PRODUCTION ORDER - Fixed Dual UOM propagation
-- Three places carry a quantity here: the main finished-goods
-- output_qty on the header, each raw material consumption line, and
-- each byproduct output line. All three get the same alt_qty/
-- alt_unit_id/rate_basis columns.
-- =============================================

ALTER TABLE tenant_master.production_orders
    ADD COLUMN IF NOT EXISTS output_alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.production_orders
    ADD COLUMN IF NOT EXISTS output_alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.production_orders
    ADD COLUMN IF NOT EXISTS output_rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.production_orders
    DROP CONSTRAINT IF EXISTS valid_production_output_rate_basis;
ALTER TABLE tenant_master.production_orders
    ADD CONSTRAINT valid_production_output_rate_basis CHECK (output_rate_basis IN ('primary', 'secondary'));

ALTER TABLE tenant_master.production_raw_materials
    ADD COLUMN IF NOT EXISTS alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.production_raw_materials
    ADD COLUMN IF NOT EXISTS alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.production_raw_materials
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.production_raw_materials
    DROP CONSTRAINT IF EXISTS valid_production_raw_material_rate_basis;
ALTER TABLE tenant_master.production_raw_materials
    ADD CONSTRAINT valid_production_raw_material_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));

ALTER TABLE tenant_master.production_byproducts
    ADD COLUMN IF NOT EXISTS alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.production_byproducts
    ADD COLUMN IF NOT EXISTS alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.production_byproducts
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.production_byproducts
    DROP CONSTRAINT IF EXISTS valid_production_byproduct_rate_basis;
ALTER TABLE tenant_master.production_byproducts
    ADD CONSTRAINT valid_production_byproduct_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));
