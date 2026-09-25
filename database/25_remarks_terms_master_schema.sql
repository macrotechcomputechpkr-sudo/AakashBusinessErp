-- =============================================
-- REMARKS MASTER + TERMS & CONDITIONS MASTER
-- Reusable text snippets, defined once here and picked from a list
-- (rather than typed fresh every time) on the Remarks/Terms fields
-- already present in voucher_field_catalog for Sales/Purchase Order,
-- Bill, etc. (19_entry_field_control_schema.sql).
--
-- Remarks apply to EVERY entry module (Sales, Purchase, Journal, Cash,
-- Bank, PDC, Production) - no scoping needed, so no applicable_to
-- column. Terms & Conditions are Sales/Purchase-specific only, so that
-- one keeps its applicable_to scoping.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.remarks_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    remark_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_remark_text_per_tenant UNIQUE (tenant_id, remark_text)
);

CREATE TABLE IF NOT EXISTS tenant_master.terms_conditions_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    title VARCHAR(150) NOT NULL,
    terms_text TEXT NOT NULL,
    -- Terms & Conditions are Sales/Purchase-specific, unlike Remarks.
    applicable_to VARCHAR(10) NOT NULL DEFAULT 'both',
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_terms_title_per_tenant UNIQUE (tenant_id, title),
    CONSTRAINT valid_terms_applicable_to CHECK (applicable_to IN ('sales', 'purchase', 'both'))
);

CREATE INDEX IF NOT EXISTS idx_terms_applicable ON tenant_master.terms_conditions_master(tenant_id, applicable_to);

DROP TRIGGER IF EXISTS trg_remarks_updated_at ON tenant_master.remarks_master;
CREATE TRIGGER trg_remarks_updated_at BEFORE UPDATE ON tenant_master.remarks_master
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
DROP TRIGGER IF EXISTS trg_terms_updated_at ON tenant_master.terms_conditions_master;
CREATE TRIGGER trg_terms_updated_at BEFORE UPDATE ON tenant_master.terms_conditions_master
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
