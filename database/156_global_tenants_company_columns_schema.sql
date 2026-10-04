-- =============================================
-- 156: tenants.company_type / vat_number
-- Run on the GLOBAL master database (public.tenants). Company creation
-- writes these two columns; without them it failed with
-- "Could not find the 'company_type' column of 'tenants'".
-- Harmless on a tenant database (does nothing there). Re-run safe.
-- =============================================
DO $$
BEGIN
    IF to_regclass('public.tenants') IS NULL THEN
        RAISE NOTICE 'public.tenants not found - run this file on the global master database';
        RETURN;
    END IF;
    ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS company_type VARCHAR(50);
    ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS vat_number VARCHAR(50);
END $$;
