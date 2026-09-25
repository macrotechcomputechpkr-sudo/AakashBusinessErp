-- =============================================
-- PRODUCT BATCH / SERIAL NUMBER / VEHICLE DETAIL TABLES
-- The actual field structures behind the three System-Control-gated
-- tracking features (batch_system, enable_serial_number, enable_vehicle_
-- options) - same "feature flag + own field structure" relationship as
-- Ledger Category (enable_custom_ledger_categories -> ledger_categories
-- table). Each is tagged with the fiscal_year_id it was first recorded
-- in, so Product Opening Entry can treat "day-one batches/serials/
-- vehicles" the same way Ledger Opening treats bill-wise details -
-- these ARE the live records, just entered with no prior transaction
-- history rather than a separate throwaway "opening" copy.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.product_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    batch_no VARCHAR(50) NOT NULL,
    mfg_date DATE,
    exp_date DATE,
    qty DECIMAL(15, 4) NOT NULL DEFAULT 0,
    rate DECIMAL(15, 4) NOT NULL DEFAULT 0,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_batch_no_per_product UNIQUE (product_id, batch_no),
    CONSTRAINT non_negative_batch_qty CHECK (qty >= 0)
);

CREATE TABLE IF NOT EXISTS tenant_master.product_serial_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    serial_no VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_stock',
    warranty_expiry_date DATE,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_serial_no_per_product UNIQUE (product_id, serial_no),
    CONSTRAINT valid_serial_status CHECK (status IN ('in_stock', 'sold', 'returned', 'damaged'))
);

CREATE TABLE IF NOT EXISTS tenant_master.product_vehicle_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    vehicle_no VARCHAR(30) NOT NULL,
    vehicle_type VARCHAR(50),
    chassis_no VARCHAR(50),
    engine_no VARCHAR(50),
    model_name VARCHAR(100),
    color VARCHAR(30),
    qty DECIMAL(15, 4) NOT NULL DEFAULT 1,
    rate DECIMAL(15, 4) NOT NULL DEFAULT 0,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_vehicle_no_per_product UNIQUE (product_id, vehicle_no),
    CONSTRAINT non_negative_vehicle_qty CHECK (qty >= 0)
);

CREATE INDEX IF NOT EXISTS idx_product_batches_product ON tenant_master.product_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_product ON tenant_master.product_serial_records(product_id);
CREATE INDEX IF NOT EXISTS idx_product_vehicles_product ON tenant_master.product_vehicle_records(product_id);

DROP TRIGGER IF EXISTS trg_product_batches_updated_at ON tenant_master.product_batches;
CREATE TRIGGER trg_product_batches_updated_at BEFORE UPDATE ON tenant_master.product_batches
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
DROP TRIGGER IF EXISTS trg_product_serials_updated_at ON tenant_master.product_serial_records;
CREATE TRIGGER trg_product_serials_updated_at BEFORE UPDATE ON tenant_master.product_serial_records
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
DROP TRIGGER IF EXISTS trg_product_vehicles_updated_at ON tenant_master.product_vehicle_records;
CREATE TRIGGER trg_product_vehicles_updated_at BEFORE UPDATE ON tenant_master.product_vehicle_records
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- =============================================
-- BOM AUTO-RATE-RECALCULATION
-- FEATURE: "Allow Buy/Sales Rate Auto Change while a used [component]
-- Product's Rate changes" - a per-BOM-line-item flag on the assembly.
-- =============================================
ALTER TABLE tenant_master.product_bom_lines
    ADD COLUMN IF NOT EXISTS auto_recalculate_on_component_rate_change BOOLEAN DEFAULT FALSE;

-- =============================================
-- OFFER RATE (promotional pricing)
-- Time-bound pricing override or discount, per product, either a flat
-- override Rate for the period or a Discount tied to a Billing Term.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.product_offer_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,

    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    offer_kind VARCHAR(10) NOT NULL DEFAULT 'discount',

    -- Only used when offer_kind = 'discount'.
    billing_term_id UUID REFERENCES tenant_master.billing_terms(id),

    -- Only used when offer_kind = 'rate' - the flat rate this product
    -- sells at for the period, overriding its normal Sales Rate.
    offer_rate DECIMAL(15, 4),

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT valid_offer_dates CHECK (from_date <= to_date),
    CONSTRAINT valid_offer_kind CHECK (offer_kind IN ('discount', 'rate')),
    CONSTRAINT discount_requires_billing_term CHECK (offer_kind != 'discount' OR billing_term_id IS NOT NULL),
    CONSTRAINT rate_requires_offer_rate CHECK (offer_kind != 'rate' OR offer_rate IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_offer_rates_product ON tenant_master.product_offer_rates(product_id);
CREATE INDEX IF NOT EXISTS idx_offer_rates_dates ON tenant_master.product_offer_rates(from_date, to_date);
