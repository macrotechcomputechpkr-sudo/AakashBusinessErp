-- =============================================
-- PRODUCT UNIT MASTER
-- The unit definitions themselves (Piece, Box, Kg, Case...) - referenced
-- by product_item_units (21_product_master_schema.sql) which is where a
-- specific product's own conversion factor, rate, and barcode per unit
-- live. Kept as its own small master since the same unit (e.g. "Kg") is
-- reused across many products.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.product_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    unit_code VARCHAR(20) NOT NULL,
    unit_name VARCHAR(50) NOT NULL,
    unit_symbol VARCHAR(10) NOT NULL,
    unit_type VARCHAR(20) NOT NULL DEFAULT 'simple',
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_product_unit_code_per_tenant UNIQUE (tenant_id, unit_code),
    CONSTRAINT unique_unit_name_per_tenant UNIQUE (tenant_id, unit_name),
    -- FEATURE (Tally-inspired): a "compound" unit is built by chaining two
    -- simple units (e.g. "1 Dozen-Box = 12 Box", where Box is itself
    -- already a unit) - flagged here so the product-level conversion
    -- factor knows which kind of relationship it's recording.
    CONSTRAINT valid_unit_type CHECK (unit_type IN ('simple', 'compound'))
);

DROP TRIGGER IF EXISTS trg_product_units_updated_at ON tenant_master.product_units;
CREATE TRIGGER trg_product_units_updated_at BEFORE UPDATE ON tenant_master.product_units
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_product_unit_code;
CREATE OR REPLACE FUNCTION tenant_master.next_product_unit_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_unit_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'UOM')) || n::TEXT;
END; $$ LANGUAGE plpgsql;
