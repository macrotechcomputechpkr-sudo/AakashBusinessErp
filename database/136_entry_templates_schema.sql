-- =============================================
-- 136: entry templates
-- A transaction screen can save what is typed as a named template (party,
-- lines, charges, narration ...) and fill a new entry from it later.
-- A template is for the whole company unless it is marked personal.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.entry_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_type VARCHAR(50) NOT NULL,
    template_name VARCHAR(150) NOT NULL,
    payload JSONB NOT NULL,
    is_personal BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entry_templates_type ON tenant_master.entry_templates(tenant_id, voucher_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_templates_name ON tenant_master.entry_templates(tenant_id, voucher_type, lower(template_name));
COMMENT ON TABLE tenant_master.entry_templates IS 'Saved entry templates per transaction screen (fill a new entry from a template)';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
