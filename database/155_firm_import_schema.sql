-- =============================================
-- 155_firm_import_schema.sql
-- Firm-to-firm import (Tools > Import from another Firm, utils/firmImport.js):
-- which record of the source firm became which record here, so a master
-- is matched again next time and a transaction is never imported twice.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.firm_import_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    source_tenant_id UUID NOT NULL,
    entity VARCHAR(60) NOT NULL,
    source_id UUID NOT NULL,
    target_id UUID NOT NULL,
    source_ref VARCHAR(120),
    imported_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, source_tenant_id, entity, source_id)
);
CREATE INDEX IF NOT EXISTS idx_firm_import_log_tenant ON tenant_master.firm_import_log(tenant_id, source_tenant_id);
