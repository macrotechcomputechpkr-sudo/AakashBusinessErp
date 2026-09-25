-- =============================================
-- PRODUCTION ORDER (Bill of Materials execution)
-- Converts raw materials into a finished product - and, informed by
-- comparing ERP schemas, optionally BY-PRODUCTS too (a genuinely
-- useful concept found in one of them: manufacturing often yields a
-- secondary output alongside the main one - offcuts, bran, sawdust -
-- that still has resale value and needs its own stock entry). Own
-- naming and structure, not copied verbatim.
--
-- Feeds the SAME stock_movements ledger Stock Transfer already writes
-- to: raw materials move OUT, the finished product (and any by-
-- products) move IN - both converted to each product's own BASE unit
-- first, using the same toBaseUnitQty logic already fixed for Stock
-- Transfer, so a production run's stock effect is exactly as
-- unit-agnostic as everything else touching that ledger.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.production_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    output_product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    output_qty DECIMAL(15, 4) NOT NULL,
    output_uom_id UUID REFERENCES tenant_master.product_units(id),
    output_batch_no VARCHAR(50),
    output_mfg_date DATE,
    output_exp_date DATE,
    output_warehouse_id UUID REFERENCES tenant_master.warehouses(id),

    source_warehouse_id UUID REFERENCES tenant_master.warehouses(id),

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),

    output_product_name_snapshot VARCHAR(200),
    output_uom_name_snapshot VARCHAR(50),
    output_warehouse_name_snapshot VARCHAR(200),
    source_warehouse_name_snapshot VARCHAR(200),
    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    posted_by UUID,
    posted_at TIMESTAMPTZ,

    total_raw_material_cost DECIMAL(15, 2) DEFAULT 0,
    total_byproduct_value DECIMAL(15, 2) DEFAULT 0,
    output_unit_cost DECIMAL(15, 4) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_production_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT positive_output_qty CHECK (output_qty > 0),
    CONSTRAINT valid_production_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT production_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.production_raw_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    production_id UUID NOT NULL REFERENCES tenant_master.production_orders(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    batch_no VARCHAR(50),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    process_name VARCHAR(100),
    cost_rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_raw_material_qty CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS tenant_master.production_byproducts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    production_id UUID NOT NULL REFERENCES tenant_master.production_orders(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    batch_no VARCHAR(50),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    recovery_rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_byproduct_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_production_rm_production ON tenant_master.production_raw_materials(production_id);
CREATE INDEX IF NOT EXISTS idx_production_bp_production ON tenant_master.production_byproducts(production_id);
CREATE INDEX IF NOT EXISTS idx_production_doc_date ON tenant_master.production_orders(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_production_status ON tenant_master.production_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_production_output_product ON tenant_master.production_orders(output_product_id);

DROP TRIGGER IF EXISTS trg_production_orders_updated_at ON tenant_master.production_orders;
CREATE TRIGGER trg_production_orders_updated_at BEFORE UPDATE ON tenant_master.production_orders
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_production_code;

ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return', 'stock_transfer',
        'debit_note', 'credit_note'
    ));

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('production', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('production', 'master', 'output_product_id', 'Output Product', 'picker', TRUE, 2),
('production', 'master', 'output_qty', 'Output Qty', 'number', TRUE, 3),
('production', 'master', 'output_warehouse_id', 'Output Warehouse', 'picker', TRUE, 4),
('production', 'master', 'source_warehouse_id', 'Source Warehouse (Raw Material)', 'picker', TRUE, 5),
('production', 'master', 'output_batch_no', 'Output Batch No', 'text', FALSE, 6),
('production', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 7),
('production', 'master', 'narration', 'Narration', 'text', FALSE, 8),
('production', 'detail', 'product_id', 'Raw Material', 'picker', TRUE, 1),
('production', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('production', 'detail', 'process_name', 'Process', 'text', FALSE, 3),
('production', 'detail', 'cost_rate', 'Cost Rate', 'number', FALSE, 4)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
