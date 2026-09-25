-- =============================================
-- PURCHASE ORDER
-- Pulls forward from Requisition and/or Quotation (both, either, or
-- neither - a PO can also be raised standalone). This is the confirmed
-- commitment to a vendor; everything downstream (GRN, Bill, Return)
-- references back to it.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    source_requisition_id UUID REFERENCES tenant_master.purchase_requisitions(id),
    source_quotation_id UUID REFERENCES tenant_master.purchase_quotations(id),

    vendor_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    invoice_type VARCHAR(10) DEFAULT 'credit',
    currency VARCHAR(10) DEFAULT 'NPR',
    due_date DATE,
    due_days INTEGER,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    goods_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    goods_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    quotation_no VARCHAR(50),
    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    rate_type VARCHAR(20) DEFAULT 'exclusive',
    order_ref_no VARCHAR(50),
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    area_id UUID REFERENCES tenant_master.areas(id),
    route_id UUID REFERENCES tenant_master.routes(id),
    terms_conditions_id UUID REFERENCES tenant_master.terms_conditions_master(id),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_order_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_order_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_order_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    -- FEATURE: "Purchase Order Cancellation" is a STATUS on the order
    -- itself (matching Tally/Busy/NAV) rather than a separate document
    -- type - the reason/timestamp/who columns above capture everything
    -- a standalone cancellation document would have.
    CONSTRAINT valid_order_status CHECK (status IN ('draft', 'confirmed', 'partially_received', 'fully_received', 'closed', 'cancelled')),
    CONSTRAINT cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.purchase_order_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES tenant_master.purchase_orders(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    source_requisition_detail_id UUID REFERENCES tenant_master.purchase_requisition_details(id),
    source_quotation_detail_id UUID REFERENCES tenant_master.purchase_quotation_details(id),

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

    -- Progress tracking for the GRN stage.
    qty_received DECIMAL(15, 4) DEFAULT 0,

    CONSTRAINT positive_order_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_ord_details_order ON tenant_master.purchase_order_details(order_id);
CREATE INDEX IF NOT EXISTS idx_ord_details_product ON tenant_master.purchase_order_details(product_id);

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON tenant_master.purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON tenant_master.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
