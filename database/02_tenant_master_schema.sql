-- =============================================
-- TENANT MASTER DATABASE (FIXED)
-- =============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist; -- needed for the fiscal-year overlap exclusion constraint

CREATE SCHEMA IF NOT EXISTS tenant_master;
CREATE SCHEMA IF NOT EXISTS tenant_trans;

-- =============================================
-- COMPANY PROFILE
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.company_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    company_name VARCHAR(200) NOT NULL,
    company_short_name VARCHAR(50),
    company_code VARCHAR(50) UNIQUE,
    registration_number VARCHAR(100),
    pan_number VARCHAR(50) UNIQUE NOT NULL,
    vat_number VARCHAR(50),
    cin_number VARCHAR(50),
    registration_date DATE,

    company_type VARCHAR(50) NOT NULL,
    industry_type VARCHAR(100),
    business_category VARCHAR(100),
    business_sub_category VARCHAR(100),

    province VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    municipality VARCHAR(100),
    ward_number VARCHAR(10),
    address_line1 TEXT,
    address_line2 TEXT,

    phone VARCHAR(20),
    mobile VARCHAR(20),
    email VARCHAR(150),
    website VARCHAR(200),

    contact_person VARCHAR(150),
    contact_designation VARCHAR(100),
    contact_person_phone VARCHAR(20),
    contact_person_email VARCHAR(150),

    tax_office VARCHAR(100),
    tax_office_code VARCHAR(50),
    tax_payer_type VARCHAR(50) DEFAULT 'entity',
    tax_filing_frequency VARCHAR(20) DEFAULT 'monthly',
    tax_clearance_certificate_no VARCHAR(100),
    tax_clearance_date DATE,

    fiscal_year_start_month INTEGER DEFAULT 7,
    fiscal_year_start_day INTEGER DEFAULT 16,
    fiscal_year_end_month INTEGER DEFAULT 6,
    fiscal_year_end_day INTEGER DEFAULT 15,
    current_fiscal_year VARCHAR(20),

    accounting_standard VARCHAR(50) DEFAULT 'NFRS',
    currency VARCHAR(10) DEFAULT 'NPR',
    language VARCHAR(20) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'Asia/Kathmandu',
    date_format VARCHAR(20) DEFAULT 'YYYY-MM-DD',

    logo_url TEXT,
    favicon_url TEXT,
    theme_color VARCHAR(7) DEFAULT '#1e3a5f',
    primary_color VARCHAR(7) DEFAULT '#1e40af',
    secondary_color VARCHAR(7) DEFAULT '#3b82f6',

    is_profile_complete BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

-- =============================================
-- DEPARTMENTS (advanced fields added: parent/hierarchy + cost center + status)
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID REFERENCES tenant_master.company_profile(id) ON DELETE CASCADE,

    department_code VARCHAR(50) NOT NULL,
    department_name VARCHAR(100) NOT NULL,
    department_short_name VARCHAR(50),
    department_head VARCHAR(150),
    department_head_phone VARCHAR(20),
    department_head_email VARCHAR(150),
    description TEXT,

    -- ADVANCED FIELDS (new, optional, non-breaking)
    parent_department_id UUID REFERENCES tenant_master.departments(id), -- department hierarchy
    cost_center_code VARCHAR(50),          -- links to accounting cost centers
    branch_id UUID,                        -- FK added later once branches table exists (see below)
    display_order INTEGER DEFAULT 1,       -- controls ordering in dropdowns / listing

    is_active BOOLEAN DEFAULT TRUE,
    is_system BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_department_code_per_tenant UNIQUE(tenant_id, department_code),
    CONSTRAINT unique_department_name_per_tenant UNIQUE(tenant_id, department_name)
);

-- =============================================
-- DESIGNATIONS (advanced fields added: department link + grade)
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.designations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID REFERENCES tenant_master.company_profile(id) ON DELETE CASCADE,

    designation_code VARCHAR(50) NOT NULL,
    designation_name VARCHAR(100) NOT NULL,
    designation_short_name VARCHAR(50),
    description TEXT,
    hierarchy_level INTEGER DEFAULT 1,

    -- ADVANCED FIELDS (new, optional, non-breaking)
    default_department_id UUID REFERENCES tenant_master.departments(id), -- typical dept for this title
    grade VARCHAR(20),                     -- e.g. 'A1', 'A2' salary grade band
    display_order INTEGER DEFAULT 1,

    is_active BOOLEAN DEFAULT TRUE,
    is_system BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_designation_code_per_tenant UNIQUE(tenant_id, designation_code),
    CONSTRAINT unique_designation_name_per_tenant UNIQUE(tenant_id, designation_name)
);

-- =============================================
-- SECURITY RIGHTS GROUPS
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.security_rights_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID REFERENCES tenant_master.company_profile(id) ON DELETE CASCADE,

    group_code VARCHAR(50) NOT NULL,
    group_name VARCHAR(100) NOT NULL,
    group_description TEXT,
    group_type VARCHAR(20) DEFAULT 'custom',

    permissions JSONB NOT NULL DEFAULT '{
        "dashboard": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "ledger": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "product": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "sales": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "purchase": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "inventory": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "invoice": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "reports": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "user_management": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "security_groups": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "company_settings": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "tax_settings": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "ocr_bill": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "backup": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false},
        "audit_log": {"view": false, "create": false, "edit": false, "delete": false, "print": false, "export": false}
    }'::jsonb,

    is_active BOOLEAN DEFAULT TRUE,
    is_system BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_group_code_per_tenant UNIQUE(tenant_id, group_code),
    CONSTRAINT valid_group_type CHECK (group_type IN ('system', 'custom'))
);

-- =============================================
-- USERS
-- FIX: employee_code is now unique per tenant (was not enforced before,
-- which allowed duplicate codes on concurrent inserts).
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_id UUID REFERENCES tenant_master.company_profile(id) ON DELETE CASCADE,

    email VARCHAR(150) NOT NULL,
    username VARCHAR(50),
    password_hash TEXT NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    address TEXT,

    department_id UUID REFERENCES tenant_master.departments(id),
    department_code VARCHAR(50),
    department_name VARCHAR(100),
    designation_id UUID REFERENCES tenant_master.designations(id),
    designation_code VARCHAR(50),
    designation_name VARCHAR(100),

    employee_code VARCHAR(50),
    citizenship_number VARCHAR(50),
    pan_number VARCHAR(50),
    date_of_birth DATE,
    gender VARCHAR(10),

    security_group_id UUID NOT NULL REFERENCES tenant_master.security_rights_groups(id),
    security_group_code VARCHAR(50),
    security_group_name VARCHAR(100),

    permissions JSONB DEFAULT '{"modules": []}',
    is_company_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,

    email_2fa_enabled BOOLEAN DEFAULT FALSE,
    sms_2fa_enabled BOOLEAN DEFAULT FALSE,
    authenticator_2fa_enabled BOOLEAN DEFAULT FALSE,
    preferred_2fa_method VARCHAR(20) DEFAULT 'email',

    allow_sales_rate_change BOOLEAN DEFAULT FALSE,
    rate_increase_percentage DECIMAL(5,2) DEFAULT 0,
    rate_decrease_percentage DECIMAL(5,2) DEFAULT 0,
    allow_sell_below_cost BOOLEAN DEFAULT FALSE,

    backdated_entry_days INTEGER DEFAULT 0,
    post_date_entry_days INTEGER DEFAULT 0,

    joining_date DATE,
    confirmation_date DATE,
    employment_type VARCHAR(20),
    salary DECIMAL(15, 2),
    bank_name VARCHAR(100),
    bank_account_number VARCHAR(50),
    emergency_contact VARCHAR(20),
    emergency_contact_name VARCHAR(150),

    profile_image_url TEXT,

    last_password_change TIMESTAMPTZ,
    password_expiry_days INTEGER DEFAULT 90,
    force_password_change BOOLEAN DEFAULT TRUE,

    last_login TIMESTAMPTZ,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_tenant_user_email UNIQUE(tenant_id, email),
    CONSTRAINT unique_tenant_username UNIQUE(tenant_id, username),
    CONSTRAINT unique_tenant_employee_code UNIQUE(tenant_id, employee_code), -- FIX
    CONSTRAINT valid_employment_type CHECK (employment_type IS NULL OR employment_type IN ('permanent', 'contract', 'probation', 'intern', 'temporary')),
    CONSTRAINT valid_gender CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
    CONSTRAINT valid_rate_limits CHECK (rate_increase_percentage BETWEEN 0 AND 100 AND rate_decrease_percentage BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS tenant_master.user_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID REFERENCES tenant_master.users(id) ON DELETE SET NULL,

    activity_type VARCHAR(50) NOT NULL,
    activity_description TEXT,
    module VARCHAR(50),
    action VARCHAR(50),
    entity_type VARCHAR(50),
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_master.user_password_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID REFERENCES tenant_master.users(id) ON DELETE CASCADE,

    password_hash TEXT NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    changed_by UUID,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- FISCAL YEARS
-- FIX: added an exclusion constraint so two fiscal years for the SAME
-- tenant can never have overlapping date ranges.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.fiscal_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    fiscal_year_code VARCHAR(20) NOT NULL,
    fiscal_year_name VARCHAR(50) NOT NULL,
    fiscal_year_nepali VARCHAR(20) NOT NULL,

    start_date_eng DATE NOT NULL,
    end_date_eng DATE NOT NULL,
    start_date_nep VARCHAR(20) NOT NULL,
    end_date_nep VARCHAR(20) NOT NULL,

    is_current BOOLEAN DEFAULT FALSE,
    is_closed BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    closing_date DATE,
    closing_date_nep VARCHAR(20),

    has_opening_balance BOOLEAN DEFAULT FALSE,
    opening_balance_date DATE,
    opening_balance_date_nep VARCHAR(20),

    previous_fy_id UUID REFERENCES tenant_master.fiscal_years(id),
    next_fy_id UUID REFERENCES tenant_master.fiscal_years(id),

    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    closed_by UUID,

    CONSTRAINT unique_fiscal_year_per_tenant UNIQUE(tenant_id, fiscal_year_code),
    CONSTRAINT valid_fy_dates CHECK (start_date_eng < end_date_eng),
    -- FIX: prevents overlapping fiscal year ranges per tenant
    EXCLUDE USING gist (
        tenant_id WITH =,
        daterange(start_date_eng, end_date_eng, '[]') WITH &&
    )
);

CREATE TABLE IF NOT EXISTS tenant_master.opening_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id) ON DELETE CASCADE,

    account_code VARCHAR(20) NOT NULL,
    account_name VARCHAR(200) NOT NULL,
    account_type VARCHAR(50) NOT NULL,
    debit_amount DECIMAL(15, 2) DEFAULT 0,
    credit_amount DECIMAL(15, 2) DEFAULT 0,
    balance_type VARCHAR(20) NOT NULL,

    opening_date DATE,
    opening_date_nep VARCHAR(20),
    reference_number VARCHAR(100),
    notes TEXT,

    is_active BOOLEAN DEFAULT TRUE,
    is_posted BOOLEAN DEFAULT FALSE,
    posted_date TIMESTAMPTZ,
    posted_by UUID,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

-- =============================================
-- CODE-GENERATION SEQUENCES (FIX for race condition)
-- One sequence per tenant would be ideal; simplest safe approach here is a
-- single shared sequence per code type, since nextval() is atomic under
-- concurrent access (no two requests can ever get the same number).
-- =============================================
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_employee_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_department_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_designation_code;

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_users_tenant ON tenant_master.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON tenant_master.users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON tenant_master.users(username);
CREATE INDEX IF NOT EXISTS idx_users_department ON tenant_master.users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_designation ON tenant_master.users(designation_id);
CREATE INDEX IF NOT EXISTS idx_users_security_group ON tenant_master.users(security_group_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON tenant_master.users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_full_name ON tenant_master.users(full_name);

CREATE INDEX IF NOT EXISTS idx_departments_tenant ON tenant_master.departments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON tenant_master.departments(parent_department_id);
CREATE INDEX IF NOT EXISTS idx_designations_tenant ON tenant_master.designations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_security_groups_tenant ON tenant_master.security_rights_groups(tenant_id);

CREATE INDEX IF NOT EXISTS idx_fiscal_years_tenant ON tenant_master.fiscal_years(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_current ON tenant_master.fiscal_years(tenant_id, is_current);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON tenant_master.user_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_created ON tenant_master.user_activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_user_password_history_user ON tenant_master.user_password_history(user_id);

-- =============================================
-- TRIGGERS
-- =============================================
CREATE OR REPLACE FUNCTION tenant_master.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_departments_updated_at ON tenant_master.departments;
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON tenant_master.departments
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_designations_updated_at ON tenant_master.designations;
CREATE TRIGGER trg_designations_updated_at BEFORE UPDATE ON tenant_master.designations
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_security_groups_updated_at ON tenant_master.security_rights_groups;
CREATE TRIGGER trg_security_groups_updated_at BEFORE UPDATE ON tenant_master.security_rights_groups
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON tenant_master.users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON tenant_master.users
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_fiscal_years_updated_at ON tenant_master.fiscal_years;
CREATE TRIGGER trg_fiscal_years_updated_at BEFORE UPDATE ON tenant_master.fiscal_years
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- =============================================
-- SAMPLE MASTER DATA
-- =============================================
INSERT INTO tenant_master.security_rights_groups (tenant_id, group_code, group_name, group_type, is_system, is_default)
SELECT tenant_id, 'ADMIN', 'Administrators', 'system', true, true FROM tenant_master.company_profile
ON CONFLICT DO NOTHING;

INSERT INTO tenant_master.security_rights_groups (tenant_id, group_code, group_name, group_type, is_system)
SELECT tenant_id, 'MANAGER', 'Managers', 'system', true FROM tenant_master.company_profile
ON CONFLICT DO NOTHING;

INSERT INTO tenant_master.security_rights_groups (tenant_id, group_code, group_name, group_type, is_system)
SELECT tenant_id, 'USER', 'Users', 'system', true FROM tenant_master.company_profile
ON CONFLICT DO NOTHING;
