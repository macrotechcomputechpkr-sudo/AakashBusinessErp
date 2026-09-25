-- =============================================
-- GLOBAL MASTER DATABASE (FIXED)
-- Fixes: proper triggers, no placeholder password hashes committed,
--        extra index for lookups used by login.
-- =============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_code VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(150) NOT NULL,
    company_registration VARCHAR(100),
    pan_number VARCHAR(50),
    fiscal_year_start DATE DEFAULT '2024-07-16',
    fiscal_year_end DATE DEFAULT '2025-07-15',
    country VARCHAR(50) DEFAULT 'Nepal',
    address TEXT,
    contact_email VARCHAR(150),
    contact_phone VARCHAR(20),
    contact_person VARCHAR(150),

    -- Tenant DB connection. NOTE: master_db_service_key must NEVER be sent to
    -- the frontend/browser. It is only read server-side (see dbHelpers.js).
    master_db_host TEXT NOT NULL,
    master_db_name TEXT NOT NULL,
    master_db_anon_key TEXT NOT NULL,
    master_db_service_key TEXT,
    master_db_schema VARCHAR(50) DEFAULT 'public',

    subscription_status VARCHAR(20) DEFAULT 'active',
    subscription_plan VARCHAR(50) DEFAULT 'standard',
    subscription_start DATE DEFAULT CURRENT_DATE,
    subscription_end DATE,
    max_users INTEGER DEFAULT 50,

    is_company_created BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT valid_subscription_status CHECK (subscription_status IN ('active', 'suspended', 'expired', 'pending'))
);

CREATE TABLE IF NOT EXISTS public.global_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,

    email VARCHAR(150) NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(150),
    phone VARCHAR(20),
    designation VARCHAR(100),

    is_global_admin BOOLEAN DEFAULT FALSE,
    role VARCHAR(50) DEFAULT 'user',
    permissions JSONB DEFAULT '{"modules": [], "tenants": []}'::jsonb,

    status VARCHAR(20) DEFAULT 'active',
    last_login TIMESTAMPTZ,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- FIX: super-admin rows have tenant_id = NULL, so uniqueness needs a
    -- partial index rather than a plain table constraint (Postgres treats
    -- NULLs as distinct anyway, this documents the intent explicitly).
    CONSTRAINT valid_status CHECK (status IN ('active', 'inactive', 'locked', 'pending'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenant_email
    ON public.global_users(tenant_id, email) WHERE tenant_id IS NOT NULL;

-- FIX: super admins (tenant_id IS NULL) must still have a unique email
CREATE UNIQUE INDEX IF NOT EXISTS uniq_super_admin_email
    ON public.global_users(email) WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS public.user_tenant_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.global_users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,

    access_level VARCHAR(20) DEFAULT 'read',
    permissions JSONB DEFAULT '{"modules": []}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT unique_user_tenant UNIQUE(user_id, tenant_id),
    CONSTRAINT valid_access_level CHECK (access_level IN ('read', 'write', 'admin'))
);

CREATE TABLE IF NOT EXISTS public.global_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.global_users(id) ON DELETE SET NULL,

    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    details JSONB,
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_code ON public.tenants(tenant_code);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants(subscription_status);
CREATE INDEX IF NOT EXISTS idx_global_users_tenant ON public.global_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_global_users_email ON public.global_users(email);
CREATE INDEX IF NOT EXISTS idx_global_users_admin ON public.global_users(is_global_admin);
CREATE INDEX IF NOT EXISTS idx_user_tenant_access_user ON public.user_tenant_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_access_tenant ON public.user_tenant_access(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON public.global_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.global_audit_log(created_at);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON public.tenants;
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_global_users_updated_at ON public.global_users;
CREATE TRIGGER trg_global_users_updated_at BEFORE UPDATE ON public.global_users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================
-- SAMPLE DATA
-- IMPORTANT: password_hash values below are PLACEHOLDERS.
-- Do NOT insert these as-is. Generate real bcrypt hashes first, e.g.:
--   node -e "console.log(require('bcrypt').hashSync('Super@2024', 10))"
-- and paste the actual hash string in place of the placeholder.
-- =============================================

-- INSERT INTO public.global_users (tenant_id, email, password_hash, full_name, is_global_admin, role, permissions)
-- VALUES (NULL, 'superadmin@system.com', '<REAL_BCRYPT_HASH_HERE>', 'Super Administrator', TRUE, 'super_admin', '{"modules": ["all"], "tenants": ["all"]}');
