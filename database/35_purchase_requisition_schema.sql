-- =============================================
-- PURCHASE REQUISITION
-- The origin document - an internal request to buy something, before
-- any vendor is necessarily fixed. Vendor is OPTIONAL here (a
-- requisition can just say "we need 50 units of X", to be quoted out
-- to several vendors later) but present so a requisition raised
-- against a KNOWN preferred vendor can skip the Quotation stage
-- entirely and go straight to Order.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.purchase_requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    -- ---- Master Part (per the field list given, Vendor added since
    -- every purchase document needs one to be meaningful even if only
    -- as a preference at this early stage) ----
    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
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

    -- FEATURE: fields beyond the given list, matching Tally/Busy/NAV/
    -- Zoho/Odoo requisition forms - Priority (how urgently this needs
    -- action), Expected Delivery Date (when it's needed by, distinct
    -- from Due Date which is a payment term), Terms & Conditions
    -- (already built as its own master), and a free-text Narration.
    priority VARCHAR(10) DEFAULT 'normal',
    expected_delivery_date DATE,
    terms_conditions_id UUID REFERENCES tenant_master.terms_conditions_master(id),
    narration TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_requisition_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_requisition_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_requisition_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_requisition_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_requisition_status CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'closed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS tenant_master.purchase_requisition_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    requisition_id UUID NOT NULL REFERENCES tenant_master.purchase_requisitions(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    -- ---- Details Part (per the field list given) ----
    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    alt_qty DECIMAL(15, 4),
    alt_unit_id UUID REFERENCES tenant_master.product_units(id),
    alt1_qty DECIMAL(15, 4),
    alt1_unit_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    -- FEATURE: fields beyond the given list - every ERP's purchase line
    -- needs a Discount and Tax breakdown; Narration lets a line carry
    -- its own note (e.g. "customer-specified brand only").
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    discount_amount DECIMAL(15, 2) DEFAULT 0,
    tax_percent DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    narration TEXT,
    free_qty DECIMAL(15, 4) DEFAULT 0,
    free_uom_id UUID REFERENCES tenant_master.product_units(id),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    barcode VARCHAR(100),

    -- Progress tracking: how much of this requisitioned quantity has
    -- already been carried into a Quotation or Order, so the UI can
    -- show "3 of 10 units already actioned" and stop over-fulfillment.
    qty_quoted DECIMAL(15, 4) DEFAULT 0,
    qty_ordered DECIMAL(15, 4) DEFAULT 0,

    CONSTRAINT positive_requisition_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_req_details_requisition ON tenant_master.purchase_requisition_details(requisition_id);
CREATE INDEX IF NOT EXISTS idx_req_details_product ON tenant_master.purchase_requisition_details(product_id);

DROP TRIGGER IF EXISTS trg_purchase_requisitions_updated_at ON tenant_master.purchase_requisitions;
CREATE TRIGGER trg_purchase_requisitions_updated_at BEFORE UPDATE ON tenant_master.purchase_requisitions
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
