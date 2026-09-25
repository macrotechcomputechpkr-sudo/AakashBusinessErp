-- =============================================
-- 124: Default logins
-- Run on the GLOBAL master database (the one with public.global_users;
-- harmless on a tenant-only database - it does nothing there).
--
--  * public.global_users.must_change_password - the ERP asks the user to
--    set their own password right after signing in (used for the default
--    logins below and for the default company admin that is created with
--    every new tenant: admin@businesserp.com.np, see
--    server/utils/tenantSetup.js).
--  * a default Super Admin, only when none exists yet:
--        email     superadmin@businesserp.com.np
--        password  Super@12345        (must be changed at first sign-in)
--        company code: leave blank
--    The password is hashed here with pgcrypto's bcrypt (crypt/gen_salt 'bf'),
--    which the server's bcrypt.compare accepts.
-- Re-run safe.
-- =============================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF to_regclass('public.global_users') IS NULL THEN
        RAISE NOTICE 'public.global_users not found - run this file on the global master database';
        RETURN;
    END IF;

    ALTER TABLE public.global_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE public.global_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

    IF NOT EXISTS (SELECT 1 FROM public.global_users WHERE tenant_id IS NULL AND is_global_admin) THEN
        INSERT INTO public.global_users (tenant_id, email, password_hash, full_name, is_global_admin, role, permissions, status, must_change_password)
        VALUES (NULL, 'superadmin@businesserp.com.np', crypt('Super@12345', gen_salt('bf', 10)), 'Super Administrator', TRUE, 'super_admin',
                '{"modules": ["all"], "tenants": ["all"]}', 'active', TRUE);
    END IF;
END $$;
