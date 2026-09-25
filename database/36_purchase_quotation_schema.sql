-- =============================================
-- PURCHASE QUOTATION (RFQ response / vendor quote)
-- Vendor-specific pricing for something requisitioned - can pull
-- forward from a Requisition's details, or stand alone if a quote
-- arrived without a prior requisition (e.g. a proactive vendor offer).
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.purchase_quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    source_requisition_id UUID REFERENCES tenant_master.purchase_requisitions(id),

    vendor_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    invoice_type VARCHAR(10) DEFAULT 'credit',
    currency VARCHAR(10) DEFAULT 'NPR',
    due_date DATE,
    due_days INTEGER,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    goods_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    goods_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    rate_type VARCHAR(20) DEFAULT 'exclusive',
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    area_id UUID REFERENCES tenant_master.areas(id),
    route_id UUID REFERENCES tenant_master.routes(id),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_quotation_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_quotation_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_quotation_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_quotation_status CHECK (status IN ('draft', 'sent', 'received', 'accepted', 'rejected', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS tenant_master.purchase_quotation_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    quotation_id UUID NOT NULL REFERENCES tenant_master.purchase_quotations(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    source_requisition_detail_id UUID REFERENCES tenant_master.purchase_requisition_details(id),

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    alt_qty DECIMAL(15, 4),
    alt_unit_id UUID REFERENCES tenant_master.product_units(id),
    alt1_qty DECIMAL(15, 4),
    alt1_unit_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    free_qty DECIMAL(15, 4) DEFAULT 0,
    free_uom_id UUID REFERENCES tenant_master.product_units(id),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    barcode VARCHAR(100),

    qty_ordered DECIMAL(15, 4) DEFAULT 0,

    CONSTRAINT positive_quotation_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_quo_details_quotation ON tenant_master.purchase_quotation_details(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quo_details_product ON tenant_master.purchase_quotation_details(product_id);

DROP TRIGGER IF EXISTS trg_purchase_quotations_updated_at ON tenant_master.purchase_quotations;
CREATE TRIGGER trg_purchase_quotations_updated_at BEFORE UPDATE ON tenant_master.purchase_quotations
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
