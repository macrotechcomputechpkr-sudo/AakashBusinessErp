-- =============================================
-- PRODUCT GROUP + PRODUCT COMPANY MASTERS
-- Preparatory master data for a future Products/Items module (which does
-- not exist in this system yet - these are the classification masters a
-- product would later be tagged with).
-- =============================================

-- ---------- PRODUCT GROUPS (hierarchical, like Areas) ----------
CREATE TABLE IF NOT EXISTS tenant_master.product_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    group_code VARCHAR(50) NOT NULL,
    group_name VARCHAR(150) NOT NULL,
    -- FIX/FEATURE: group-under-group hierarchy, same pattern as
    -- tenant_master.areas.parent_area_id - optional, arbitrary depth.
    parent_group_id UUID REFERENCES tenant_master.product_groups(id),

    -- Drives which fields below are relevant.
    product_type VARCHAR(20) NOT NULL,

    -- Only meaningful when product_type = 'asset'. Left NULL for
    -- service/inventory groups.
    depreciation_method VARCHAR(30),
    depreciation_rate DECIMAL(5, 2),

    default_discount_percentage DECIMAL(5, 2) DEFAULT 0,
    default_profit_margin_percentage DECIMAL(5, 2) DEFAULT 0,

    -- If a non-zero default discount is set, it must cite which billing
    -- term that discount rate comes from. The Billing Term module does
    -- not exist yet in this system, so this is a plain UUID column for
    -- now (no FK) - wire `REFERENCES tenant_master.billing_terms(id)`
    -- once that module is built, the same way departments.branch_id
    -- waited for tenant_master.branches to exist.
    billing_term_id UUID,

    print_barcode BOOLEAN DEFAULT TRUE,
    -- Whether a salesman can override this group's rate while taking an
    -- order in the mobile app (see also product_companies.allow_rate_change_on_mobile_order -
    -- when a product's group AND its company both set this, the more
    -- restrictive (false) should win; that precedence is an application
    -- decision, not enforced here).
    allow_rate_change_on_mobile_order BOOLEAN DEFAULT FALSE,

    is_active BOOLEAN DEFAULT TRUE,
    is_system BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 1,
    description TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_product_group_code_per_tenant UNIQUE (tenant_id, group_code),
    CONSTRAINT unique_product_group_name_per_tenant UNIQUE (tenant_id, group_name),
    CONSTRAINT valid_product_type CHECK (product_type IN ('asset', 'service', 'inventory')),
    CONSTRAINT valid_depreciation_method CHECK (depreciation_method IS NULL OR depreciation_method IN ('straight_line', 'written_down_value')),
    CONSTRAINT no_self_parent_product_group CHECK (parent_group_id IS NULL OR parent_group_id <> id),
    -- FIX: enforces "default discount% other than 0 must cite a billing term"
    -- at the database level too, not just in the API.
    CONSTRAINT discount_requires_billing_term CHECK (default_discount_percentage = 0 OR billing_term_id IS NOT NULL)
);

-- ---------- PRODUCT COMPANIES (manufacturer/brand - distinct from the
-- tenant's own tenant_master.company_profile) ----------
CREATE TABLE IF NOT EXISTS tenant_master.product_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    company_code VARCHAR(50) NOT NULL,
    company_name VARCHAR(200) NOT NULL,

    -- The supplier ledger to default to when purchasing this
    -- manufacturer's products - must be a purchase/both ledger account.
    -- Enforced at the application layer (see productCompanyRoutes.js),
    -- since a CHECK constraint cannot cheaply look up another table's
    -- column here.
    default_vendor_id UUID REFERENCES tenant_master.ledger_accounts(id),

    -- FEATURE: "company maa pani under as area and product group" -
    -- default Area and default Product Group this company's products
    -- normally fall under, used to pre-fill a new product's fields.
    default_area_id UUID REFERENCES tenant_master.areas(id),
    default_product_group_id UUID REFERENCES tenant_master.product_groups(id),
    default_agent_id UUID REFERENCES tenant_master.salesman_agents(id),

    print_barcode BOOLEAN DEFAULT TRUE,
    allow_rate_change_on_mobile_order BOOLEAN DEFAULT FALSE,

    is_active BOOLEAN DEFAULT TRUE,
    description TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_product_company_code_per_tenant UNIQUE (tenant_id, company_code),
    CONSTRAINT unique_product_company_name_per_tenant UNIQUE (tenant_id, company_name)
);

-- Atomic code generators (same pattern as every other master in this system)
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_product_group_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_product_company_code;

CREATE OR REPLACE FUNCTION tenant_master.next_product_group_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_group_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'PG')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_product_company_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_company_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'PC')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_product_groups_tenant ON tenant_master.product_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_groups_parent ON tenant_master.product_groups(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_product_groups_type ON tenant_master.product_groups(product_type);
CREATE INDEX IF NOT EXISTS idx_product_companies_tenant ON tenant_master.product_companies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_companies_vendor ON tenant_master.product_companies(default_vendor_id);
CREATE INDEX IF NOT EXISTS idx_product_companies_area ON tenant_master.product_companies(default_area_id);
CREATE INDEX IF NOT EXISTS idx_product_companies_group ON tenant_master.product_companies(default_product_group_id);
CREATE INDEX IF NOT EXISTS idx_product_companies_agent ON tenant_master.product_companies(default_agent_id);

DROP TRIGGER IF EXISTS trg_product_groups_updated_at ON tenant_master.product_groups;
CREATE TRIGGER trg_product_groups_updated_at BEFORE UPDATE ON tenant_master.product_groups
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_product_companies_updated_at ON tenant_master.product_companies;
CREATE TRIGGER trg_product_companies_updated_at BEFORE UPDATE ON tenant_master.product_companies
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
