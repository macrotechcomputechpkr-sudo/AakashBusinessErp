-- =============================================
-- SALES RETURN
-- Customer returns goods - mirrors Purchase Return's structure for the
-- selling side. Pulls forward from a POSTED Sales Bill. Reverses
-- revenue AND output VAT, credits the customer (a 'cr' bill-wise
-- reference - like a Credit Note, reduces what they owe). Goods
-- physically come back IN to stock.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.sales_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),
    source_bill_id UUID REFERENCES tenant_master.sales_bills(id),

    customer_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    customer_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    sales_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),

    return_reason VARCHAR(30) DEFAULT 'other',
    settlement_type VARCHAR(20) DEFAULT 'credit_note',

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    area_id UUID REFERENCES tenant_master.areas(id),
    route_id UUID REFERENCES tenant_master.routes(id),

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

    CONSTRAINT unique_sales_return_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_sales_return_reason CHECK (return_reason IN ('damaged', 'wrong_item', 'quality_issue', 'excess_supply', 'expired', 'other')),
    CONSTRAINT valid_sales_return_settlement_type CHECK (settlement_type IN ('credit_note', 'replacement', 'cash_refund')),
    CONSTRAINT valid_sales_return_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT sales_return_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.sales_return_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    return_id UUID NOT NULL REFERENCES tenant_master.sales_returns(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    source_bill_detail_id UUID REFERENCES tenant_master.sales_bill_details(id),

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    tax_percent DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),
    serial_no VARCHAR(80),

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_sales_return_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_return_details_return ON tenant_master.sales_return_details(return_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_details_product ON tenant_master.sales_return_details(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer ON tenant_master.sales_returns(customer_ledger_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_doc_date ON tenant_master.sales_returns(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON tenant_master.sales_returns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_returns_source_bill ON tenant_master.sales_returns(source_bill_id);

DROP TRIGGER IF EXISTS trg_sales_returns_updated_at ON tenant_master.sales_returns;
CREATE TRIGGER trg_sales_returns_updated_at BEFORE UPDATE ON tenant_master.sales_returns
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sales_return_code;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('sales_return', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('sales_return', 'master', 'customer_ledger_id', 'Customer', 'picker', TRUE, 2),
('sales_return', 'master', 'warehouse_id', 'Warehouse', 'picker', TRUE, 3),
('sales_return', 'master', 'return_reason', 'Return Reason', 'select', FALSE, 4),
('sales_return', 'master', 'settlement_type', 'Settlement Type', 'select', FALSE, 5),
('sales_return', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 6),
('sales_return', 'master', 'narration', 'Narration', 'text', FALSE, 7),
('sales_return', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('sales_return', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('sales_return', 'detail', 'rate', 'Rate', 'number', TRUE, 3)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
