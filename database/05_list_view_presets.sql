-- =============================================
-- LIST VIEW COLUMN PRESETS
-- Backs the "column settings" gear menu inside the searchable popup picker
-- (SearchablePopupSelect on the frontend): which columns show, in what
-- order, saved under a name, and shared according to `scope`.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.list_view_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Identifies which picker this preset belongs to, e.g.
    -- 'department_picker', 'designation_picker', 'security_group_picker'.
    -- A future product/item picker would just use its own list_key value -
    -- the whole preset system (this table + the routes + the frontend
    -- component) works unchanged for any new picker.
    list_key VARCHAR(100) NOT NULL,

    preset_name VARCHAR(100) NOT NULL,

    -- [{ "key": "buy_rate", "visible": true, "order": 3 }, ...]
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- 'all'      -> every user in the tenant sees/can use this preset
    -- 'me'       -> only the creator sees it (owner_user_id set)
    -- 'selected' -> only users listed in allowed_user_ids see it
    scope VARCHAR(20) NOT NULL DEFAULT 'me',
    owner_user_id UUID,
    allowed_user_ids UUID[] DEFAULT '{}',

    is_default BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT valid_preset_scope CHECK (scope IN ('all', 'me', 'selected')),
    CONSTRAINT unique_preset_name_per_list UNIQUE (tenant_id, list_key, preset_name)
);

CREATE INDEX IF NOT EXISTS idx_list_view_presets_tenant_list ON tenant_master.list_view_presets(tenant_id, list_key);
CREATE INDEX IF NOT EXISTS idx_list_view_presets_owner ON tenant_master.list_view_presets(owner_user_id);

DROP TRIGGER IF EXISTS trg_list_view_presets_updated_at ON tenant_master.list_view_presets;
CREATE TRIGGER trg_list_view_presets_updated_at BEFORE UPDATE ON tenant_master.list_view_presets
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
