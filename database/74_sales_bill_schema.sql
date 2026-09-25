-- =============================================
-- SALES BILL / INVOICE
-- Mirrors Purchase Bill's structure for the selling side. Can pull
-- forward from a POSTED Sales Delivery (the normal path - goods
-- already left, now invoice for them), or directly from a Sales Order
-- for a cash/counter sale with no separate delivery step - same dual-
-- path pattern Purchase Bill already supports against GRN vs direct.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.sales_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),
    source_delivery_id UUID REFERENCES tenant_master.sales_deliveries(id),
    source_order_id UUID REFERENCES tenant_master.sales_orders(id),

    customer_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    customer_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    invoice_type VARCHAR(10) DEFAULT 'credit',
    currency VARCHAR(10) DEFAULT 'NPR',
    due_date DATE,
    due_days INTEGER,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    sales_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    rate_type VARCHAR(20) DEFAULT 'exclusive',
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    area_id UUID REFERENCES tenant_master.areas(id),
    route_id UUID REFERENCES tenant_master.routes(id),

    credit_check_result VARCHAR(10),
    credit_check_message TEXT,

    customer_name_snapshot VARCHAR(200),
    customer_sub_ledger_name_snapshot VARCHAR(200),
    agent_name_snapshot VARCHAR(150),
    warehouse_name_snapshot VARCHAR(200),
    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),
    area_name_snapshot VARCHAR(150),
    route_name_snapshot VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    posted_by UUID,
    posted_at TIMESTAMPTZ,
    total_amount DECIMAL(15, 2) DEFAULT 0,
    total_tax_amount DECIMAL(15, 2) DEFAULT 0,

    pending_bill_wise_settlements JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_sales_bill_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_sales_bill_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_sales_bill_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_sales_bill_credit_check_result CHECK (credit_check_result IN ('passed', 'warned', 'overridden') OR credit_check_result IS NULL),
    CONSTRAINT valid_sales_bill_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT sales_bill_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.sales_bill_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    bill_id UUID NOT NULL REFERENCES tenant_master.sales_bills(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    source_delivery_detail_id UUID REFERENCES tenant_master.sales_delivery_details(id),
    source_order_detail_id UUID REFERENCES tenant_master.sales_order_details(id),

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    discount_amount DECIMAL(15, 2) DEFAULT 0,
    tax_percent DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),
    serial_no VARCHAR(80),

    qty_returned DECIMAL(15, 4) DEFAULT 0,

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_sales_bill_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_bill_details_bill ON tenant_master.sales_bill_details(bill_id);
CREATE INDEX IF NOT EXISTS idx_sales_bill_details_product ON tenant_master.sales_bill_details(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_bills_customer ON tenant_master.sales_bills(customer_ledger_id);
CREATE INDEX IF NOT EXISTS idx_sales_bills_doc_date ON tenant_master.sales_bills(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_sales_bills_status ON tenant_master.sales_bills(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_bills_source_delivery ON tenant_master.sales_bills(source_delivery_id);

DROP TRIGGER IF EXISTS trg_sales_bills_updated_at ON tenant_master.sales_bills;
CREATE TRIGGER trg_sales_bills_updated_at BEFORE UPDATE ON tenant_master.sales_bills
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sales_bill_code;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('sales_bill', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('sales_bill', 'master', 'customer_ledger_id', 'Customer', 'picker', TRUE, 2),
('sales_bill', 'master', 'invoice_type', 'Cash/Credit', 'select', FALSE, 3),
('sales_bill', 'master', 'due_date', 'Due Date', 'date', FALSE, 4),
('sales_bill', 'master', 'warehouse_id', 'Warehouse', 'picker', FALSE, 5),
('sales_bill', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 6),
('sales_bill', 'master', 'narration', 'Narration', 'text', FALSE, 7),
('sales_bill', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('sales_bill', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('sales_bill', 'detail', 'rate', 'Rate', 'number', TRUE, 3),
('sales_bill', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 4)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
