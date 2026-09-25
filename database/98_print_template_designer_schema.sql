-- =============================================
-- DOCUMENT DESIGNER (Print Format Designer)
-- "Sabai entry module ko documents design garne option banaune...
-- Crystal Report vanda advance" - a WYSIWYG print-layout designer,
-- usable across every entry module (Sales Bill, Purchase Bill, etc.),
-- supporting:
--   - drag-and-drop placement of any available field
--   - three bands per layout: header (document-level / "master"),
--     detail (repeats once per line item), footer (totals, signatures,
--     summaries)
--   - formula-bound fields (evaluated with the SAME formula engine
--     already used for Billing Terms - see formulaEvaluator.js)
--   - multiple named templates per document type (the person can save
--     as many variations as they like - "with Alt Unit", "Product
--     Term Summary only", etc.) with one marked default
--   - A4 / A5 paper size (and custom)
--   - optional chart blocks bound to aggregate document data
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.print_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    document_type VARCHAR(50) NOT NULL,
    template_name VARCHAR(150) NOT NULL,
    description TEXT,

    paper_size VARCHAR(10) NOT NULL DEFAULT 'A4',
    orientation VARCHAR(10) NOT NULL DEFAULT 'portrait',
    -- Custom paper size in mm, only read when paper_size = 'custom'.
    custom_width_mm DECIMAL(6, 2),
    custom_height_mm DECIMAL(6, 2),

    -- The full designed layout: { header: [...blocks], detail: [...blocks], footer: [...blocks] }
    -- Each block: { id, field_key | formula, type ('text'|'field'|'formula'|'image'|'line'|'chart'),
    --               x, y, width, height, font_size, bold, italic, align, chart_config }
    -- All in mm, relative to the page's printable area, so the same
    -- layout_json renders identically regardless of paper_size once
    -- the page's own frame is drawn.
    layout_json JSONB NOT NULL DEFAULT '{"header": [], "detail": [], "footer": []}'::jsonb,

    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_print_template_name_per_doc_type UNIQUE (tenant_id, document_type, template_name),
    CONSTRAINT valid_print_paper_size CHECK (paper_size IN ('A4', 'A5', 'custom')),
    CONSTRAINT valid_print_orientation CHECK (orientation IN ('portrait', 'landscape'))
);

CREATE INDEX IF NOT EXISTS idx_print_templates_doc_type ON tenant_master.print_templates(tenant_id, document_type);

-- Only one default template per (tenant, document_type) - enforced at
-- the application layer (see documentDesignerRoutes.js) the same way
-- other "single default" masters in this system already do, since a
-- partial unique index would need is_default = true baked into the
-- index itself and this keeps the migration simple to extend later.
