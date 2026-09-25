-- =============================================
-- PRODUCT MASTER
-- Combines: our own System Control (Batch/UOM/Barcode/Vehicle/Serial/
-- Exp-Mfg/Free-Qty toggles), Tally (UOM+Alt Unit, buy-in-one-sell-in-
-- another, batch/godown), Zoho Inventory (SKU, item_type, can_be_sold/
-- purchased, account mapping, reorder_level, unit_conversion per
-- sales/purchase), Microsoft Dynamics NAV/Business Central (Costing
-- Method, Posting Groups, Replenishment System Purchase/Production/
-- Assembly, Vendor Item No., Blocked status, Item Tracking), Odoo
-- (multi-unit Packaging each with its OWN rate+barcode), and
-- manufacturing-ERP costing practice (Standard vs Actual costing,
-- overhead absorption, BOM cost rollup).
--
-- Four tables:
--   1. products              - the main item master
--   2. product_unit_rates    - the multi-unit table (Section 3/4 of the
--                              requirements doc): one row per unit this
--                              item can be bought/sold/stocked in, each
--                              with its OWN rates and OWN barcode.
--   3. product_categories + product_category_links - the tenant-custom,
--      multi-select, renameable classification (exact Ledger Category
--      pattern, applied to Products).
--   4. product_bom_lines     - simple Bill of Materials for Finished
--      Good / Semi-Finished items (raw materials + qty required).
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- ---------- 1. IDENTITY & CLASSIFICATION ----------
    product_code VARCHAR(50) NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    short_name VARCHAR(50),
    item_type VARCHAR(20) NOT NULL DEFAULT 'trading_item',
    product_group_id UUID REFERENCES tenant_master.product_groups(id),
    product_company_id UUID REFERENCES tenant_master.product_companies(id),
    hs_code VARCHAR(30),
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_blocked BOOLEAN DEFAULT FALSE,

    -- ---------- 2. ACCOUNT MAPPING (overrides - NULL = fall back to
    -- System Control's tenant-wide default) ----------
    sales_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    purchase_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    inventory_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    cogs_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    discount_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),

    -- ---------- Base Unit (every product needs exactly one - the unit
    -- stock quantity is actually held/reported in) ----------
    base_unit_id UUID NOT NULL REFERENCES tenant_master.product_units(id),

    -- ---------- 5. DISCOUNT ----------
    default_discount_percent DECIMAL(5, 2) DEFAULT 0,

    -- ---------- 6. VENDOR ----------
    default_vendor_id UUID REFERENCES tenant_master.ledger_accounts(id),
    vendor_item_code VARCHAR(50),
    lead_time_days INTEGER DEFAULT 0,

    -- ---------- 7. STOCK CONTROL ----------
    opening_qty DECIMAL(15, 4) DEFAULT 0,
    opening_rate DECIMAL(15, 4) DEFAULT 0,
    opening_value DECIMAL(15, 2) DEFAULT 0,
    minimum_stock DECIMAL(15, 4) DEFAULT 0,
    maximum_stock DECIMAL(15, 4) DEFAULT 0,
    reorder_qty DECIMAL(15, 4) DEFAULT 0,
    allow_negative_stock BOOLEAN,

    -- ---------- Costing (NAV's exact 5 methods) ----------
    costing_method VARCHAR(20) DEFAULT 'average',

    -- ---------- 8. TRACKING OPTIONS (each only meaningful if the
    -- matching System Control toggle is globally on - enforced at the
    -- application layer, not the DB, since that's tenant-wide state) ----------
    maintain_batch BOOLEAN DEFAULT FALSE,
    track_expiry BOOLEAN DEFAULT FALSE,
    track_mfg_date BOOLEAN DEFAULT FALSE,
    track_serial_number BOOLEAN DEFAULT FALSE,
    is_vehicle_linked BOOLEAN DEFAULT FALSE,
    free_qty_eligible BOOLEAN DEFAULT FALSE,

    -- ---------- 9. PRODUCTION / BOM (Finished Good / Semi-Finished only) ----------
    replenishment_method VARCHAR(20) DEFAULT 'purchase',
    routing_reference TEXT,
    scrap_percent DECIMAL(5, 2) DEFAULT 0,

    -- ---------- 10. PRODUCTION COSTING ----------
    costing_approach VARCHAR(20) DEFAULT 'standard',
    overhead_absorption_basis VARCHAR(20),
    overhead_absorption_rate DECIMAL(15, 4) DEFAULT 0,
    standard_labour_rate DECIMAL(15, 4) DEFAULT 0,

    -- ---------- 11. PHYSICAL & STATUTORY ----------
    weight DECIMAL(10, 4),
    weight_unit VARCHAR(20),
    dimensions VARCHAR(100),
    vat_applicable BOOLEAN DEFAULT TRUE,
    excise_applicable BOOLEAN DEFAULT FALSE,

    display_order INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_product_code_per_tenant UNIQUE (tenant_id, product_code),
    CONSTRAINT unique_product_name_per_tenant UNIQUE (tenant_id, product_name),
    CONSTRAINT valid_item_type CHECK (item_type IN (
        'raw_material', 'semi_finished', 'finished_good', 'trading_item', 'fixed_asset', 'service', 'non_inventory'
    )),
    CONSTRAINT valid_costing_method CHECK (costing_method IN ('fifo', 'lifo', 'average', 'standard', 'specific')),
    CONSTRAINT valid_replenishment_method CHECK (replenishment_method IN ('purchase', 'production', 'assembly')),
    CONSTRAINT valid_costing_approach CHECK (costing_approach IN ('standard', 'actual', 'job')),
    CONSTRAINT valid_overhead_basis CHECK (overhead_absorption_basis IS NULL OR overhead_absorption_basis IN ('machine_hour', 'labour_hour', 'per_unit')),
    -- BOM/routing/scrap only make sense for items actually produced.
    CONSTRAINT production_fields_need_production_type CHECK (
        replenishment_method = 'purchase' OR item_type IN ('semi_finished', 'finished_good')
    )
);

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_product_code;
CREATE OR REPLACE FUNCTION tenant_master.next_product_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'PRD')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

-- =============================================
-- MULTI-UNIT TABLE (Odoo Packaging pattern) - one row per unit this
-- product can be bought/sold/stocked in. Exactly one row per product
-- has is_base_unit = TRUE (enforced at the application layer, since a
-- partial unique index would need is_base_unit = TRUE as its predicate,
-- which Postgres supports but the app-layer check is still needed for
-- the friendlier error message on violation).
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.product_unit_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES tenant_master.product_units(id),

    is_base_unit BOOLEAN DEFAULT FALSE,
    conversion_factor DECIMAL(15, 6) DEFAULT 1,

    purchase_rate DECIMAL(15, 4) DEFAULT 0,
    mrp DECIMAL(15, 4) DEFAULT 0,
    sales_rate_sr1 DECIMAL(15, 4) DEFAULT 0,
    sales_rate_sr2 DECIMAL(15, 4) DEFAULT 0,
    sales_rate_sr3 DECIMAL(15, 4) DEFAULT 0,
    sales_rate_sr4 DECIMAL(15, 4) DEFAULT 0,
    sales_rate_sr5 DECIMAL(15, 4) DEFAULT 0,
    rate_inclusive_of_tax BOOLEAN DEFAULT FALSE,
    last_purchase_rate DECIMAL(15, 4) DEFAULT 0,

    barcode VARCHAR(50),
    purchase_eligible BOOLEAN DEFAULT TRUE,
    sales_eligible BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_product_unit UNIQUE (product_id, unit_id),
    CONSTRAINT unique_barcode_per_tenant UNIQUE (tenant_id, barcode),
    CONSTRAINT positive_conversion_factor CHECK (conversion_factor > 0)
);

CREATE INDEX IF NOT EXISTS idx_product_unit_rates_product ON tenant_master.product_unit_rates(product_id);
CREATE INDEX IF NOT EXISTS idx_product_unit_rates_barcode ON tenant_master.product_unit_rates(tenant_id, barcode) WHERE barcode IS NOT NULL;

-- =============================================
-- PRODUCT CATEGORY (exact Ledger Category pattern - separate,
-- optional, multi-select, tenant-renameable, both individual values
-- AND the feature's own label)
-- =============================================
ALTER TABLE tenant_master.company_profile
    ADD COLUMN IF NOT EXISTS enable_custom_product_categories BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS custom_product_category_label VARCHAR(100) DEFAULT 'Product Category';

CREATE TABLE IF NOT EXISTS tenant_master.product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    category_code VARCHAR(20) NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_product_category_code UNIQUE (tenant_id, category_code),
    CONSTRAINT unique_product_category_name UNIQUE (tenant_id, category_name)
);

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_product_category_code;
CREATE OR REPLACE FUNCTION tenant_master.next_product_category_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_category_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'PC')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS tenant_master.product_category_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    product_category_id UUID NOT NULL REFERENCES tenant_master.product_categories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_product_category_link UNIQUE (product_id, product_category_id)
);

-- Same "seed 5 defaults on first enable" behaviour as Ledger Category.
CREATE OR REPLACE FUNCTION tenant_master.seed_default_product_categories(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM tenant_master.product_categories WHERE tenant_id = p_tenant_id LIMIT 1) THEN
        RETURN;
    END IF;
    INSERT INTO tenant_master.product_categories (tenant_id, category_code, category_name, display_order) VALUES
    (p_tenant_id, 'FAST', 'Fast Moving', 1),
    (p_tenant_id, 'SLOW', 'Slow Moving', 2),
    (p_tenant_id, 'SEAS', 'Seasonal', 3),
    (p_tenant_id, 'PROM', 'Promotional', 4),
    (p_tenant_id, 'NEW', 'New Arrival', 5);
END; $$ LANGUAGE plpgsql;

-- =============================================
-- SIMPLE BOM (Bill of Materials) - raw materials + quantity required
-- per unit of a Finished Good / Semi-Finished item.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.product_bom_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    parent_product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    component_product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    quantity_required DECIMAL(15, 4) NOT NULL,
    unit_id UUID REFERENCES tenant_master.product_units(id),
    display_order INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_bom_line UNIQUE (parent_product_id, component_product_id),
    CONSTRAINT bom_not_self_referencing CHECK (parent_product_id != component_product_id),
    CONSTRAINT positive_quantity_required CHECK (quantity_required > 0)
);

CREATE INDEX IF NOT EXISTS idx_bom_lines_parent ON tenant_master.product_bom_lines(parent_product_id);

DROP TRIGGER IF EXISTS trg_products_updated_at ON tenant_master.products;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON tenant_master.products
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
