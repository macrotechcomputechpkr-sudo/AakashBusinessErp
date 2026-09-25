-- =============================================
-- ENTRY FIELD CONTROLS - REPAIR for databases where migration 19 was run
-- BEFORE its fix: there the CREATE TABLE failed (it referenced a
-- non-existent security_groups table), or - if it was created some other
-- way - it has the old UNIQUE that lets Global rules duplicate.
-- Safe to run on any state: creates the table if missing, removes
-- duplicate rules (keeping the most recently updated), and adds the
-- per-scope unique indexes.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.entry_field_controls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_type VARCHAR(30) NOT NULL,
    field_key VARCHAR(60) NOT NULL,
    scope VARCHAR(15) NOT NULL DEFAULT 'global',
    user_group_id UUID REFERENCES tenant_master.security_rights_groups(id),
    user_id UUID,
    mode VARCHAR(15) NOT NULL DEFAULT 'enabled',
    is_clear_on_save BOOLEAN DEFAULT FALSE,
    default_value VARCHAR(200),
    custom_caption VARCHAR(150),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID,
    CONSTRAINT valid_control_scope CHECK (scope IN ('global', 'user_group', 'user')),
    CONSTRAINT valid_control_mode CHECK (mode IN ('enabled', 'disabled', 'compulsory', 'readonly')),
    CONSTRAINT scope_matches_reference CHECK (
        (scope = 'global' AND user_group_id IS NULL AND user_id IS NULL) OR
        (scope = 'user_group' AND user_group_id IS NOT NULL AND user_id IS NULL) OR
        (scope = 'user' AND user_id IS NOT NULL AND user_group_id IS NULL)
    )
);

ALTER TABLE tenant_master.entry_field_controls DROP CONSTRAINT IF EXISTS unique_field_control;

DELETE FROM tenant_master.entry_field_controls a
USING tenant_master.entry_field_controls b
WHERE a.tenant_id = b.tenant_id AND a.voucher_type = b.voucher_type AND a.field_key = b.field_key
  AND a.scope = b.scope
  AND a.user_group_id IS NOT DISTINCT FROM b.user_group_id
  AND a.user_id IS NOT DISTINCT FROM b.user_id
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_efc_global ON tenant_master.entry_field_controls(tenant_id, voucher_type, field_key) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS ux_efc_group  ON tenant_master.entry_field_controls(tenant_id, voucher_type, field_key, user_group_id) WHERE scope = 'user_group';
CREATE UNIQUE INDEX IF NOT EXISTS ux_efc_user   ON tenant_master.entry_field_controls(tenant_id, voucher_type, field_key, user_id) WHERE scope = 'user';
