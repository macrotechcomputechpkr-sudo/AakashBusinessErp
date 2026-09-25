-- =============================================
-- SALES CHALLAN / DELIVERY
-- Goods physically leaving for the customer - mirrors GRN's role but
-- OUTWARD. Pulls forward from Sales Order (qty_delivered progress
-- tracked back there, same pattern Purchase Bill uses against GRN),
-- and on posting writes OUT movements to the SAME shared stock_
-- movements ledger everything else uses - base-unit converted,
-- negative-stock checked, exactly like Stock Transfer.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.sales_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),
    source_order_id UUID REFERENCES tenant_master.sales_orders(id),

    customer_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    customer_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),

    vehicle_no VARCHAR(50),
    driver_name VARCHAR(150),
    transport_master_id UUID REFERENCES tenant_master.transport_master(id),
    delivery_address TEXT,

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

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_sales_delivery_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_sales_delivery_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT sales_delivery_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.sales_delivery_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    delivery_id UUID NOT NULL REFERENCES tenant_master.sales_deliveries(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    source_order_detail_id UUID REFERENCES tenant_master.sales_order_details(id),

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),
    serial_no VARCHAR(80),
    mfg_date DATE,
    exp_date DATE,

    qty_billed DECIMAL(15, 4) DEFAULT 0,

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_sales_delivery_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_delivery_details_delivery ON tenant_master.sales_delivery_details(delivery_id);
CREATE INDEX IF NOT EXISTS idx_sales_delivery_details_product ON tenant_master.sales_delivery_details(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_customer ON tenant_master.sales_deliveries(customer_ledger_id);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_doc_date ON tenant_master.sales_deliveries(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_status ON tenant_master.sales_deliveries(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_source_order ON tenant_master.sales_deliveries(source_order_id);

DROP TRIGGER IF EXISTS trg_sales_deliveries_updated_at ON tenant_master.sales_deliveries;
CREATE TRIGGER trg_sales_deliveries_updated_at BEFORE UPDATE ON tenant_master.sales_deliveries
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sales_delivery_code;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('sales_delivery', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('sales_delivery', 'master', 'customer_ledger_id', 'Customer', 'picker', TRUE, 2),
('sales_delivery', 'master', 'warehouse_id', 'Warehouse', 'picker', TRUE, 3),
('sales_delivery', 'master', 'vehicle_no', 'Vehicle No', 'text', FALSE, 4),
('sales_delivery', 'master', 'driver_name', 'Driver Name', 'text', FALSE, 5),
('sales_delivery', 'master', 'delivery_address', 'Delivery Address', 'text', FALSE, 6),
('sales_delivery', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 7),
('sales_delivery', 'master', 'narration', 'Narration', 'text', FALSE, 8),
('sales_delivery', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('sales_delivery', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('sales_delivery', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 3)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
