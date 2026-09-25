-- =============================================
-- PRODUCT RACK LOCATION
-- Branch-wise AND Warehouse-wise: a warehouse can serve more than one
-- branch (branch_warehouse_mapping is many-to-many, not a simple
-- warehouses.branch_id), so which rack a product sits in genuinely
-- needs both dimensions, not just the warehouse alone. One product can
-- have a DIFFERENT rack location per Branch+Warehouse combination - a
-- simple "designated storage location" list, not a full bin-quantity
-- tracking system (that belongs to the future Sales/Purchase/Production
-- transaction module, alongside the same honest scoping used for Batch/
-- Serial/Vehicle tracking).
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.product_rack_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES tenant_master.branches(id),
    warehouse_id UUID NOT NULL REFERENCES tenant_master.warehouses(id),

    rack_location VARCHAR(100) NOT NULL,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_product_branch_warehouse_rack UNIQUE (product_id, branch_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_rack_locations_product ON tenant_master.product_rack_locations(product_id);
CREATE INDEX IF NOT EXISTS idx_rack_locations_warehouse ON tenant_master.product_rack_locations(warehouse_id);

DROP TRIGGER IF EXISTS trg_rack_locations_updated_at ON tenant_master.product_rack_locations;
CREATE TRIGGER trg_rack_locations_updated_at BEFORE UPDATE ON tenant_master.product_rack_locations
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
