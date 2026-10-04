-- =============================================
-- 158: several companies under one tenant
-- Run on the GLOBAL master database (public.tenants). A company created by a
-- user inside a tenant becomes a child tenant: code <tenant code>_<abc>, its
-- own database erp_<tenant code>_<abc> (own PostgreSQL mode), and
-- parent_tenant_id pointing to the tenant. The creator gets access to it
-- (user_tenant_access) and switches companies with the company switcher.
-- Harmless on a tenant database. Re-run safe.
-- =============================================
DO $$
BEGIN
    IF to_regclass('public.tenants') IS NULL THEN
        RAISE NOTICE 'public.tenants not found - run this file on the global master database';
        RETURN;
    END IF;
    ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS parent_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;
    ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS company_suffix VARCHAR(20);
    CREATE INDEX IF NOT EXISTS idx_tenants_parent ON public.tenants(parent_tenant_id);
END $$;
