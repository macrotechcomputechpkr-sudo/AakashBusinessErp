-- =============================================
-- 120: Customizable dashboard
-- dashboard_layouts keeps each user's dashboard (which widgets, chart type,
-- size, period, order) as JSON; the row with user_id NULL is the company
-- default that users start from until they save their own.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.dashboard_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID,
    layout JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dashboard_layout_user ON tenant_master.dashboard_layouts(tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dashboard_layout_company ON tenant_master.dashboard_layouts(tenant_id) WHERE user_id IS NULL;
