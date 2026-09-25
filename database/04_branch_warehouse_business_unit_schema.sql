-- =============================================
-- BRANCHES / WAREHOUSES / BUSINESS UNITS
-- (carried over from the original design, was missing from the earlier
-- fixed schema which only covered users/departments/designations/fiscal
-- years - added back here so the full system is in one place)
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    branch_code VARCHAR(50) NOT NULL,
    branch_name VARCHAR(200) NOT NULL,
    branch_short_name VARCHAR(50),
    branch_type VARCHAR(50) DEFAULT 'retail',

    province VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    municipality VARCHAR(100),
    ward_number VARCHAR(10),
    address_line1 TEXT,
    address_line2 TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    phone VARCHAR(20),
    mobile VARCHAR(20),
    email VARCHAR(150),
    contact_person VARCHAR(150),
    contact_person_phone VARCHAR(20),

    is_head_office BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    opening_date DATE,
    closing_date DATE,

    business_hours JSONB DEFAULT '{"monday":"9:00-17:00","tuesday":"9:00-17:00","wednesday":"9:00-17:00","thursday":"9:00-17:00","friday":"9:00-17:00","saturday":"9:00-17:00","sunday":"closed"}'::jsonb,
    timezone VARCHAR(50) DEFAULT 'Asia/Kathmandu',
    currency VARCHAR(10) DEFAULT 'NPR',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    -- FIX: original had branch_code globally UNIQUE (across ALL tenants),
    -- which would block two different companies from both using "HO" as a
    -- code. Scoped to per-tenant instead.
    CONSTRAINT unique_branch_code_per_tenant UNIQUE (tenant_id, branch_code)
);

CREATE TABLE IF NOT EXISTS tenant_master.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    warehouse_code VARCHAR(50) NOT NULL,
    warehouse_name VARCHAR(200) NOT NULL,
    warehouse_short_name VARCHAR(50),
    warehouse_type VARCHAR(50) DEFAULT 'main',

    province VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    municipality VARCHAR(100),
    ward_number VARCHAR(10),
    address_line1 TEXT,
    address_line2 TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    phone VARCHAR(20),
    mobile VARCHAR(20),
    email VARCHAR(150),
    contact_person VARCHAR(150),
    contact_person_phone VARCHAR(20),

    total_area_sqft DECIMAL(10, 2),
    usable_area_sqft DECIMAL(10, 2),
    capacity_cubic_meters DECIMAL(10, 2),
    rack_capacity INTEGER,
    temperature_controlled BOOLEAN DEFAULT FALSE,
    temperature_range VARCHAR(50),
    humidity_controlled BOOLEAN DEFAULT FALSE,

    is_active BOOLEAN DEFAULT TRUE,
    opening_date DATE,
    closing_date DATE,

    operating_hours JSONB DEFAULT '{"monday":"9:00-17:00","tuesday":"9:00-17:00","wednesday":"9:00-17:00","thursday":"9:00-17:00","friday":"9:00-17:00","saturday":"9:00-17:00","sunday":"closed"}'::jsonb,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_warehouse_code_per_tenant UNIQUE (tenant_id, warehouse_code)
);

CREATE TABLE IF NOT EXISTS tenant_master.branch_warehouse_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id) ON DELETE CASCADE,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id) ON DELETE CASCADE,

    is_primary BOOLEAN DEFAULT FALSE,
    distance_km DECIMAL(8, 2),
    delivery_time_minutes INTEGER,
    priority_order INTEGER DEFAULT 1,
    default_warehouse BOOLEAN DEFAULT FALSE,
    inventory_sync_enabled BOOLEAN DEFAULT TRUE,
    stock_transfer_enabled BOOLEAN DEFAULT TRUE,

    is_active BOOLEAN DEFAULT TRUE,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT unique_branch_warehouse UNIQUE (branch_id, warehouse_id),
    CONSTRAINT valid_mapping_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS tenant_master.business_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    unit_code VARCHAR(50) NOT NULL,
    unit_name VARCHAR(200) NOT NULL,
    unit_short_name VARCHAR(50),
    unit_type VARCHAR(50) DEFAULT 'brand',

    brand_name VARCHAR(200),
    brand_owner VARCHAR(200),
    product_category VARCHAR(100),
    product_sub_category VARCHAR(100),

    description TEXT,
    established_date DATE,
    website VARCHAR(200),
    email VARCHAR(150),
    phone VARCHAR(20),

    currency VARCHAR(10) DEFAULT 'NPR',
    tax_rate DECIMAL(5, 2) DEFAULT 13.00,
    discount_policy JSONB DEFAULT '{"default": 0}'::jsonb,

    is_active BOOLEAN DEFAULT TRUE,
    requires_separate_inventory BOOLEAN DEFAULT FALSE,
    requires_separate_accounting BOOLEAN DEFAULT FALSE,

    parent_unit_id UUID REFERENCES tenant_master.business_units(id),
    hierarchy_level INTEGER DEFAULT 1,

    primary_color VARCHAR(7) DEFAULT '#3b82f6',
    secondary_color VARCHAR(7) DEFAULT '#1e40af',
    logo_url TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_unit_code_per_tenant UNIQUE (tenant_id, unit_code)
);

CREATE TABLE IF NOT EXISTS tenant_master.branch_business_unit_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id) ON DELETE CASCADE,
    business_unit_id UUID REFERENCES tenant_master.business_units(id) ON DELETE CASCADE,

    is_active BOOLEAN DEFAULT TRUE,
    is_primary BOOLEAN DEFAULT FALSE,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    priority_order INTEGER DEFAULT 1,
    default_unit BOOLEAN DEFAULT FALSE,
    branch_unit_code VARCHAR(50),
    branch_unit_name VARCHAR(200),
    local_tax_rate DECIMAL(5, 2),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT unique_branch_business_unit UNIQUE (branch_id, business_unit_id)
);

CREATE TABLE IF NOT EXISTS tenant_master.warehouse_business_unit_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id) ON DELETE CASCADE,
    business_unit_id UUID REFERENCES tenant_master.business_units(id) ON DELETE CASCADE,

    is_active BOOLEAN DEFAULT TRUE,
    is_primary BOOLEAN DEFAULT FALSE,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    storage_priority INTEGER DEFAULT 1,
    allocated_area_sqft DECIMAL(10, 2),
    allocated_capacity_cbm DECIMAL(10, 2),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT unique_warehouse_business_unit UNIQUE (warehouse_id, business_unit_id)
);

-- Now that branches exists, wire the FK that departments.branch_id referenced
-- (declared without a foreign key in 02_tenant_master_schema.sql because
-- branches did not exist yet at that point in the run order).
ALTER TABLE tenant_master.departments
    DROP CONSTRAINT IF EXISTS fk_departments_branch;
ALTER TABLE tenant_master.departments
    ADD CONSTRAINT fk_departments_branch FOREIGN KEY (branch_id) REFERENCES tenant_master.branches(id);

-- Atomic code generators (same race-condition fix pattern as employee/department/designation codes)
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_branch_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_warehouse_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_business_unit_code;

CREATE OR REPLACE FUNCTION tenant_master.next_branch_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_branch_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'BR')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_warehouse_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_warehouse_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'WH')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_business_unit_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_business_unit_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'BU')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_branches_tenant ON tenant_master.branches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_tenant ON tenant_master.warehouses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bwmap_branch ON tenant_master.branch_warehouse_mapping(branch_id);
CREATE INDEX IF NOT EXISTS idx_bwmap_warehouse ON tenant_master.branch_warehouse_mapping(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_business_units_tenant ON tenant_master.business_units(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bbumap_branch ON tenant_master.branch_business_unit_mapping(branch_id);
CREATE INDEX IF NOT EXISTS idx_wbumap_warehouse ON tenant_master.warehouse_business_unit_mapping(warehouse_id);

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_branches_updated_at ON tenant_master.branches;
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON tenant_master.branches
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_warehouses_updated_at ON tenant_master.warehouses;
CREATE TRIGGER trg_warehouses_updated_at BEFORE UPDATE ON tenant_master.warehouses
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_business_units_updated_at ON tenant_master.business_units;
CREATE TRIGGER trg_business_units_updated_at BEFORE UPDATE ON tenant_master.business_units
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
