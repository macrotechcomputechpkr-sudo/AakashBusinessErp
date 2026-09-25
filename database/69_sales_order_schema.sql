-- =============================================
-- SALES ORDER
-- The confirmed commitment from a customer - everything downstream
-- (Sales Delivery/Challan, Sales Bill, Sales Return) references back to
-- it. Mirrors Purchase Order's structure for the selling side (same
-- proven pattern - own naming, own table), with the customer's own
-- credit-limit/credit-days control (already built for Chart of
-- Accounts) actually checked here for the first time.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    customer_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    customer_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    invoice_type VARCHAR(10) DEFAULT 'credit',
    currency VARCHAR(10) DEFAULT 'NPR',
    due_date DATE,
    due_days INTEGER,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    sales_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),

    customer_po_no VARCHAR(50),
    customer_po_date DATE,
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
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_sales_order_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_sales_order_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_sales_order_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_sales_order_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_sales_credit_check_result CHECK (credit_check_result IN ('passed', 'warned', 'overridden') OR credit_check_result IS NULL),
    CONSTRAINT valid_sales_order_status CHECK (status IN ('draft', 'confirmed', 'partially_delivered', 'fully_delivered', 'closed', 'cancelled')),
    CONSTRAINT sales_order_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.sales_order_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES tenant_master.sales_orders(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    alt_qty DECIMAL(15, 4),
    alt_unit_id UUID REFERENCES tenant_master.product_units(id),
    alt1_qty DECIMAL(15, 4),
    alt1_unit_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    discount_amount DECIMAL(15, 2) DEFAULT 0,
    tax_percent DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    free_qty DECIMAL(15, 4) DEFAULT 0,
    free_uom_id UUID REFERENCES tenant_master.product_units(id),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),
    barcode VARCHAR(100),

    qty_delivered DECIMAL(15, 4) DEFAULT 0,

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_sales_order_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_details_order ON tenant_master.sales_order_details(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_details_product ON tenant_master.sales_order_details(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON tenant_master.sales_orders(customer_ledger_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_doc_date ON tenant_master.sales_orders(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON tenant_master.sales_orders(tenant_id, status);

DROP TRIGGER IF EXISTS trg_sales_orders_updated_at ON tenant_master.sales_orders;
CREATE TRIGGER trg_sales_orders_updated_at BEFORE UPDATE ON tenant_master.sales_orders
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sales_order_code;

ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return', 'stock_transfer',
        'debit_note', 'credit_note', 'cash_bank_entry'
    ));

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('sales_order', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('sales_order', 'master', 'customer_ledger_id', 'Customer', 'picker', TRUE, 2),
('sales_order', 'master', 'agent_id', 'Salesman/Agent', 'picker', FALSE, 3),
('sales_order', 'master', 'invoice_type', 'Cash/Credit', 'select', FALSE, 4),
('sales_order', 'master', 'warehouse_id', 'Warehouse', 'picker', FALSE, 5),
('sales_order', 'master', 'customer_po_no', 'Customer PO No', 'text', FALSE, 6),
('sales_order', 'master', 'customer_po_date', 'Customer PO Date', 'date', FALSE, 7),
('sales_order', 'master', 'due_date', 'Due Date', 'date', FALSE, 8),
('sales_order', 'master', 'area_id', 'Area', 'picker', FALSE, 9),
('sales_order', 'master', 'route_id', 'Route', 'picker', FALSE, 10),
('sales_order', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 11),
('sales_order', 'master', 'narration', 'Narration', 'text', FALSE, 12),
('sales_order', 'master', 'priority', 'Priority', 'select', FALSE, 13),
('sales_order', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('sales_order', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('sales_order', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('sales_order', 'detail', 'rate', 'Rate', 'number', TRUE, 4),
('sales_order', 'detail', 'discount_percent', 'Discount %', 'number', FALSE, 5),
('sales_order', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 6),
('sales_order', 'detail', 'free_qty', 'Free Qty', 'number', FALSE, 7),
('sales_order', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 8),
('sales_order', 'detail', 'warehouse_id', 'Details Warehouse', 'select', FALSE, 9)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
