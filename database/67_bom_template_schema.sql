-- =============================================
-- BOM TEMPLATE (reusable production recipe)
-- "Production Order maa herda hamro design le hareka pataka raw
-- material feri type garnu parxa" - a genuine gap found comparing
-- against two ERP schemas: BOM there is a reusable FORMULA (this
-- output, at this standard batch size, always needs these raw
-- materials in these proportions) that a transactional Production
-- Order pulls forward and SCALES to whatever quantity is actually
-- being run today - not something re-typed from scratch every time.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.bom_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    template_code VARCHAR(20) NOT NULL,
    template_name VARCHAR(200) NOT NULL,
    description TEXT,

    output_product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    standard_output_qty DECIMAL(15, 4) NOT NULL,
    output_uom_id UUID REFERENCES tenant_master.product_units(id),

    is_active BOOLEAN DEFAULT TRUE,
    output_product_name_snapshot VARCHAR(200),
    output_uom_name_snapshot VARCHAR(50),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_bom_template_code UNIQUE (tenant_id, template_code),
    CONSTRAINT positive_standard_output_qty CHECK (standard_output_qty > 0)
);

CREATE TABLE IF NOT EXISTS tenant_master.bom_template_raw_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES tenant_master.bom_templates(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    process_name VARCHAR(100),
    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),

    CONSTRAINT positive_template_rm_qty CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS tenant_master.bom_template_byproducts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES tenant_master.bom_templates(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    recovery_rate DECIMAL(15, 4) DEFAULT 0,
    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),

    CONSTRAINT positive_template_bp_qty CHECK (qty > 0)
);

ALTER TABLE tenant_master.production_orders
    ADD COLUMN IF NOT EXISTS bom_template_id UUID REFERENCES tenant_master.bom_templates(id);

CREATE INDEX IF NOT EXISTS idx_bom_template_rm ON tenant_master.bom_template_raw_materials(template_id);
CREATE INDEX IF NOT EXISTS idx_bom_template_bp ON tenant_master.bom_template_byproducts(template_id);
CREATE INDEX IF NOT EXISTS idx_bom_template_output_product ON tenant_master.bom_templates(output_product_id);

DROP TRIGGER IF EXISTS trg_bom_templates_updated_at ON tenant_master.bom_templates;
CREATE TRIGGER trg_bom_templates_updated_at BEFORE UPDATE ON tenant_master.bom_templates
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_bom_template_code;
