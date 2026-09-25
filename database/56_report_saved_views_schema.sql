-- =============================================
-- REPORT SAVED VIEWS
-- "Every Report Type ma Default option rakha. User le option haru
-- change garera Save As garera rakhna milne option banau. Jun format
-- choose garxa tei format ma report khulne banau."
--
-- One row per named, saved report configuration - which report_type it
-- belongs to, its full config (visible columns, custom formula columns,
-- filters, sort) as JSONB, and whether it's the DEFAULT view that
-- report_type opens with when no other view is explicitly chosen.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.report_saved_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    report_type VARCHAR(50) NOT NULL,
    view_name VARCHAR(100) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    -- { visible_columns: [...], formula_columns: [{key,label,formula}],
    --   filters: {...}, sort: {...} } - whatever shape a given report
    -- type actually uses; each report's own frontend interprets it.
    config JSONB NOT NULL DEFAULT '{}',
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_saved_view_name UNIQUE (tenant_id, report_type, view_name)
);

CREATE INDEX IF NOT EXISTS idx_report_saved_views_type ON tenant_master.report_saved_views(tenant_id, report_type);

DROP TRIGGER IF EXISTS trg_report_saved_views_updated_at ON tenant_master.report_saved_views;
CREATE TRIGGER trg_report_saved_views_updated_at BEFORE UPDATE ON tenant_master.report_saved_views
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- FEATURE: "keeps exactly one Default per report_type" - setting a new
-- default automatically un-defaults any previous one, rather than
-- requiring the application to remember to do this itself.
CREATE OR REPLACE FUNCTION tenant_master.enforce_single_default_view()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default THEN
        UPDATE tenant_master.report_saved_views
        SET is_default = FALSE
        WHERE tenant_id = NEW.tenant_id AND report_type = NEW.report_type AND id != NEW.id AND is_default = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_single_default_view ON tenant_master.report_saved_views;
CREATE TRIGGER trg_enforce_single_default_view
    AFTER INSERT OR UPDATE OF is_default ON tenant_master.report_saved_views
    FOR EACH ROW WHEN (NEW.is_default) EXECUTE FUNCTION tenant_master.enforce_single_default_view();
