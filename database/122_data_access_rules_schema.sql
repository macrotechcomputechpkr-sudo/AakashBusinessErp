-- =============================================
-- 122: Data access control - which ledgers, sub-ledgers, products,
-- product companies, product groups, customer (ledger) categories and
-- areas a user may see.
--
-- One row per (user or security group) x dimension:
--   mode 'all'    - no restriction (a user row with 'all' overrides a
--                   restriction set on the user's security group)
--   mode 'only'   - only the listed ids
--   mode 'except' - everything except the listed ids
-- A user's own row wins over the security group's row for the same
-- dimension. Company admins and super admins are never restricted.
-- Product groups and areas include their sub-groups / sub-areas.
-- ledger rules with applies_to = 'parties' (the default) restrict only
-- customer / supplier ledgers, so cash, bank, sales and expense ledgers
-- stay usable in entries; 'all' restricts every ledger.
-- The server applies the rules to master lists, pickers, document lists,
-- reports and to every save (server/utils/dataAccess.js).
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.data_access_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID REFERENCES tenant_master.users(id) ON DELETE CASCADE,
    security_group_id UUID REFERENCES tenant_master.security_rights_groups(id) ON DELETE CASCADE,
    dimension VARCHAR(30) NOT NULL,
    mode VARCHAR(10) NOT NULL DEFAULT 'only',
    ids UUID[] NOT NULL DEFAULT '{}',
    applies_to VARCHAR(10) NOT NULL DEFAULT 'parties',
    updated_by UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT data_access_one_owner CHECK ((user_id IS NULL) <> (security_group_id IS NULL)),
    CONSTRAINT valid_data_access_dimension CHECK (dimension IN ('ledger', 'sub_ledger', 'product', 'product_company', 'product_group', 'ledger_category', 'area')),
    CONSTRAINT valid_data_access_mode CHECK (mode IN ('all', 'only', 'except')),
    CONSTRAINT valid_data_access_applies CHECK (applies_to IN ('parties', 'all'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_data_access_user ON tenant_master.data_access_rules(tenant_id, user_id, dimension) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_data_access_group ON tenant_master.data_access_rules(tenant_id, security_group_id, dimension) WHERE security_group_id IS NOT NULL;

-- audit the rules themselves (file 121)
DO $$ BEGIN
    IF to_regproc('tenant_master.audit_attach_all') IS NOT NULL THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
