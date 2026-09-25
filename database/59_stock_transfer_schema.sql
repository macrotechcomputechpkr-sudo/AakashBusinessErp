-- =============================================
-- STOCK TRANSFER
-- Warehouse-to-warehouse inventory movement. Informed by comparing two
-- ERP schemas' approach - one splits this into separate IN/OUT master
-- tables per direction (more tables, more sync work), the other uses a
-- SINGLE table with both From and To warehouse on it - the simpler,
-- more maintainable of the two, adopted here (own naming, own
-- structure - not copied verbatim).
--
-- Every LINE carries its own From/To (defaulting to the document's
-- own), since a real transfer occasionally needs to source different
-- items from different sub-locations even within one document. Rate/
-- cost/MRP snapshots are captured per line at transfer time - not
-- because a transfer changes valuation itself, but because "what was
-- this batch actually worth when it moved" needs to survive later
-- price-master changes for accurate reporting.
-- =============================================

-- FEATURE: "Stock Transfer's whole purpose is moving inventory, but
-- there's no live stock ledger yet" - a minimal, append-only movement
-- log every inventory-affecting document can write to. Current stock
-- for a product+warehouse+batch is SUM(qty_in) - SUM(qty_out) over this
-- table, computed via the view below rather than a separately-
-- maintained running-balance column (avoids concurrency/drift issues a
-- summary table would need careful locking to avoid). Stock Transfer is
-- the FIRST document wired to this; GRN/Bill/Return should eventually
-- write here too for a complete on-hand picture, but that is a larger,
-- separate retrofit.
CREATE TABLE IF NOT EXISTS tenant_master.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    warehouse_id UUID NOT NULL REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),
    movement_date DATE NOT NULL,
    qty_in DECIMAL(15, 4) NOT NULL DEFAULT 0,
    qty_out DECIMAL(15, 4) NOT NULL DEFAULT 0,
    source_type VARCHAR(30) NOT NULL,
    source_id UUID NOT NULL,
    source_detail_id UUID,
    narration TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_movement_qty CHECK (qty_in >= 0 AND qty_out >= 0 AND (qty_in > 0 OR qty_out > 0))
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_wh ON tenant_master.stock_movements(product_id, warehouse_id, batch_no);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON tenant_master.stock_movements(source_type, source_id);

CREATE OR REPLACE VIEW tenant_master.v_current_stock AS
SELECT
    tenant_id, product_id, warehouse_id, batch_no,
    SUM(qty_in) - SUM(qty_out) AS on_hand_qty
FROM tenant_master.stock_movements
GROUP BY tenant_id, product_id, warehouse_id, batch_no
HAVING SUM(qty_in) - SUM(qty_out) != 0;

CREATE TABLE IF NOT EXISTS tenant_master.stock_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    from_warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    to_warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    to_branch_id UUID REFERENCES tenant_master.branches(id),
    transport_id UUID REFERENCES tenant_master.transport_master(id),
    vehicle_no VARCHAR(50),
    driver_name VARCHAR(150),
    driver_license_no VARCHAR(50),
    driver_contact_no VARCHAR(30),

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    priority VARCHAR(10) DEFAULT 'normal',

    from_warehouse_name_snapshot VARCHAR(200),
    to_warehouse_name_snapshot VARCHAR(200),
    to_branch_name_snapshot VARCHAR(150),
    transport_name_snapshot VARCHAR(150),
    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    posted_by UUID,
    posted_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,

    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_stock_transfer_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_transfer_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_transfer_status CHECK (status IN ('draft', 'approved', 'posted', 'cancelled')),
    CONSTRAINT transfer_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL),
    CONSTRAINT transfer_different_warehouses CHECK (from_warehouse_id IS DISTINCT FROM to_warehouse_id)
);

CREATE TABLE IF NOT EXISTS tenant_master.stock_transfer_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    transfer_id UUID NOT NULL REFERENCES tenant_master.stock_transfers(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    batch_no VARCHAR(50),
    mfg_date DATE,
    exp_date DATE,

    from_warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    to_warehouse_id UUID REFERENCES tenant_master.warehouses(id),

    qty DECIMAL(15, 4) NOT NULL,
    free_qty DECIMAL(15, 4) DEFAULT 0,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    alt_qty DECIMAL(15, 4),
    alt_unit_id UUID REFERENCES tenant_master.product_units(id),
    conv_factor DECIMAL(15, 6),

    cost_rate DECIMAL(15, 4) DEFAULT 0,
    mrp DECIMAL(15, 4),
    sell_rate DECIMAL(15, 4),
    amount DECIMAL(15, 2) DEFAULT 0,

    narration TEXT,

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    alt_unit_name_snapshot VARCHAR(50),
    from_warehouse_name_snapshot VARCHAR(200),
    to_warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_transfer_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_details_transfer ON tenant_master.stock_transfer_details(transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_details_product ON tenant_master.stock_transfer_details(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_doc_date ON tenant_master.stock_transfers(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_fiscal_year ON tenant_master.stock_transfers(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_status ON tenant_master.stock_transfers(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_from_wh ON tenant_master.stock_transfers(from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_to_wh ON tenant_master.stock_transfers(to_warehouse_id);

DROP TRIGGER IF EXISTS trg_stock_transfers_updated_at ON tenant_master.stock_transfers;
CREATE TRIGGER trg_stock_transfers_updated_at BEFORE UPDATE ON tenant_master.stock_transfers
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_stock_transfer_code;

ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return', 'stock_transfer'
    ));

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('stock_transfer', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('stock_transfer', 'master', 'from_warehouse_id', 'From Warehouse', 'picker', TRUE, 2),
('stock_transfer', 'master', 'to_warehouse_id', 'To Warehouse', 'picker', TRUE, 3),
('stock_transfer', 'master', 'to_branch_id', 'To Branch', 'picker', FALSE, 4),
('stock_transfer', 'master', 'transport_id', 'Transport', 'picker', FALSE, 5),
('stock_transfer', 'master', 'vehicle_no', 'Vehicle No', 'text', FALSE, 6),
('stock_transfer', 'master', 'driver_name', 'Driver Name', 'text', FALSE, 7),
('stock_transfer', 'master', 'driver_license_no', 'Driver License No', 'text', FALSE, 8),
('stock_transfer', 'master', 'driver_contact_no', 'Driver Contact No', 'text', FALSE, 9),
('stock_transfer', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 10),
('stock_transfer', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 11),
('stock_transfer', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 12),
('stock_transfer', 'master', 'priority', 'Priority', 'select', FALSE, 13),
('stock_transfer', 'master', 'narration', 'Narration', 'text', FALSE, 14),
('stock_transfer', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('stock_transfer', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('stock_transfer', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('stock_transfer', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 4),
('stock_transfer', 'detail', 'free_qty', 'Free Qty', 'number', FALSE, 5),
('stock_transfer', 'detail', 'cost_rate', 'Cost Rate', 'number', FALSE, 6),
('stock_transfer', 'detail', 'narration', 'Narration', 'text', FALSE, 7)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
