-- =============================================
-- SALES QUOTATION
-- A quote given to a customer, before they confirm as a Sales Order.
-- Mirrors Purchase Quotation's structure for the selling side.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.sales_quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),
    valid_until DATE,

    customer_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    customer_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    currency VARCHAR(10) DEFAULT 'NPR',
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    rate_type VARCHAR(20) DEFAULT 'exclusive',
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    area_id UUID REFERENCES tenant_master.areas(id),
    route_id UUID REFERENCES tenant_master.routes(id),
    terms_conditions_id UUID REFERENCES tenant_master.terms_conditions_master(id),
    priority VARCHAR(10) DEFAULT 'normal',

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
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_sales_quotation_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_sales_quotation_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_sales_quotation_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_sales_quotation_status CHECK (status IN ('draft', 'sent', 'accepted', 'expired', 'cancelled')),
    CONSTRAINT sales_quotation_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.sales_quotation_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    quotation_id UUID NOT NULL REFERENCES tenant_master.sales_quotations(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    alt_qty DECIMAL(15, 4),
    alt_unit_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    discount_amount DECIMAL(15, 2) DEFAULT 0,
    tax_percent DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),

    qty_ordered DECIMAL(15, 4) DEFAULT 0,

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_sales_quotation_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_quotation_details_quotation ON tenant_master.sales_quotation_details(quotation_id);
CREATE INDEX IF NOT EXISTS idx_sales_quotation_details_product ON tenant_master.sales_quotation_details(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_quotations_customer ON tenant_master.sales_quotations(customer_ledger_id);
CREATE INDEX IF NOT EXISTS idx_sales_quotations_doc_date ON tenant_master.sales_quotations(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_sales_quotations_status ON tenant_master.sales_quotations(tenant_id, status);

DROP TRIGGER IF EXISTS trg_sales_quotations_updated_at ON tenant_master.sales_quotations;
CREATE TRIGGER trg_sales_quotations_updated_at BEFORE UPDATE ON tenant_master.sales_quotations
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sales_quotation_code;

ALTER TABLE tenant_master.sales_orders
    ADD COLUMN IF NOT EXISTS source_quotation_id UUID REFERENCES tenant_master.sales_quotations(id);
ALTER TABLE tenant_master.sales_order_details
    ADD COLUMN IF NOT EXISTS source_quotation_detail_id UUID REFERENCES tenant_master.sales_quotation_details(id);

ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return', 'stock_transfer',
        'debit_note', 'credit_note', 'cash_bank_entry', 'sales_quotation'
    ));

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('sales_quotation', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('sales_quotation', 'master', 'customer_ledger_id', 'Customer', 'picker', TRUE, 2),
('sales_quotation', 'master', 'valid_until', 'Valid Until', 'date', FALSE, 3),
('sales_quotation', 'master', 'agent_id', 'Salesman/Agent', 'picker', FALSE, 4),
('sales_quotation', 'master', 'warehouse_id', 'Warehouse', 'picker', FALSE, 5),
('sales_quotation', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 6),
('sales_quotation', 'master', 'narration', 'Narration', 'text', FALSE, 7),
('sales_quotation', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('sales_quotation', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('sales_quotation', 'detail', 'rate', 'Rate', 'number', TRUE, 3),
('sales_quotation', 'detail', 'discount_percent', 'Discount %', 'number', FALSE, 4)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
