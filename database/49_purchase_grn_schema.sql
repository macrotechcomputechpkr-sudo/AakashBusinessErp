-- =============================================
-- PURCHASE GRN (Goods Receipt Note / Challan)
-- "Whichever module comes after should be able to fill from ANY earlier
-- module" - GRN can pull forward from Requisition, Quotation, and/or
-- Order, in any combination (not just the immediately preceding
-- stage), matching the universal-fill requirement. Each detail line
-- also tracks qty_billed so an Outstanding Report can show exactly how
-- much of what was received has (or hasn't) been converted to a Bill.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.purchase_grns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    -- Universal source tracking at the DOCUMENT level (a GRN can be
    -- raised against any one, or several, source documents at once -
    -- the actual per-line lineage lives on purchase_grn_details).
    source_requisition_id UUID REFERENCES tenant_master.purchase_requisitions(id),
    source_quotation_id UUID REFERENCES tenant_master.purchase_quotations(id),
    source_order_id UUID REFERENCES tenant_master.purchase_orders(id),

    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    invoice_type VARCHAR(10) DEFAULT 'credit',
    currency VARCHAR(10) DEFAULT 'NPR',
    due_date DATE,
    due_days INTEGER,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    goods_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    goods_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    vendor_challan_no VARCHAR(50),
    vendor_challan_date DATE,
    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    rate_type VARCHAR(20) DEFAULT 'exclusive',
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    area_id UUID REFERENCES tenant_master.areas(id),
    route_id UUID REFERENCES tenant_master.routes(id),
    terms_conditions_id UUID REFERENCES tenant_master.terms_conditions_master(id),
    priority VARCHAR(10) DEFAULT 'normal',
    narration TEXT,

    cash_vendor_name VARCHAR(200),
    cash_billing_details JSONB,

    vendor_name_snapshot VARCHAR(200),
    agent_name_snapshot VARCHAR(150),
    warehouse_name_snapshot VARCHAR(200),
    goods_account_name_snapshot VARCHAR(200),
    goods_sub_ledger_name_snapshot VARCHAR(200),
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

    CONSTRAINT unique_grn_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_grn_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_grn_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_grn_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    -- FEATURE: "some billed, some outstanding" - a GRN stays 'received'
    -- (its natural resting state) through partial billing; 'billed'
    -- means every line's qty_billed has caught up to qty.
    CONSTRAINT valid_grn_status CHECK (status IN ('draft', 'received', 'partially_billed', 'billed', 'cancelled')),
    CONSTRAINT grn_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.purchase_grn_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    grn_id UUID NOT NULL REFERENCES tenant_master.purchase_grns(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    -- Universal per-LINE lineage - a single received line can trace back
    -- to any combination of the three earlier stages (most commonly just
    -- one, but nothing stops a merged GRN line).
    source_requisition_detail_id UUID REFERENCES tenant_master.purchase_requisition_details(id),
    source_quotation_detail_id UUID REFERENCES tenant_master.purchase_quotation_details(id),
    source_order_detail_id UUID REFERENCES tenant_master.purchase_order_details(id),

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
    narration TEXT,
    free_qty DECIMAL(15, 4) DEFAULT 0,
    free_uom_id UUID REFERENCES tenant_master.product_units(id),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    barcode VARCHAR(100),

    -- FEATURE: Outstanding Report basis - "5 items, some billed, some
    -- not" is answered directly by qty - qty_billed per line.
    qty_billed DECIMAL(15, 4) DEFAULT 0,

    -- FEATURE: "Ref No and Batch should live in the Details table" - a
    -- readable reference (which source document this specific line came
    -- from) and Batch tracking, both at the LINE level, so it's obvious
    -- at a glance how much of THIS item on THIS document is outstanding,
    -- without following a UUID back to another table.
    source_doc_no VARCHAR(50),
    batch_no VARCHAR(50),

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    alt_unit_name_snapshot VARCHAR(50),
    alt1_unit_name_snapshot VARCHAR(50),
    free_uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_grn_qty CHECK (qty > 0),
    CONSTRAINT valid_grn_qty_billed CHECK (qty_billed >= 0 AND qty_billed <= qty)
);

CREATE INDEX IF NOT EXISTS idx_grn_details_grn ON tenant_master.purchase_grn_details(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_details_product ON tenant_master.purchase_grn_details(product_id);
CREATE INDEX IF NOT EXISTS idx_grn_doc_date ON tenant_master.purchase_grns(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_grn_fiscal_year ON tenant_master.purchase_grns(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_grn_vendor ON tenant_master.purchase_grns(vendor_ledger_id);
CREATE INDEX IF NOT EXISTS idx_grn_status ON tenant_master.purchase_grns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_grn_source_req ON tenant_master.purchase_grns(source_requisition_id) WHERE source_requisition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grn_source_quo ON tenant_master.purchase_grns(source_quotation_id) WHERE source_quotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grn_source_ord ON tenant_master.purchase_grns(source_order_id) WHERE source_order_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_purchase_grns_updated_at ON tenant_master.purchase_grns;
CREATE TRIGGER trg_purchase_grns_updated_at BEFORE UPDATE ON tenant_master.purchase_grns
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_grn_code;

-- FEATURE: Outstanding Report - "GRN1 has 5 items, some converted to
-- Bill, some not". One row per GRN LINE with its own outstanding qty/
-- amount, using the historical name snapshots (not a live join) so the
-- report always reads exactly what the GRN itself said.
CREATE OR REPLACE VIEW tenant_master.v_grn_outstanding AS
SELECT
    g.id AS grn_id, g.tenant_id, g.doc_no AS grn_doc_no, g.doc_date AS grn_date,
    COALESCE(g.vendor_name_snapshot, g.cash_vendor_name) AS vendor_name,
    g.status AS grn_status,
    d.id AS detail_id, COALESCE(d.product_name_snapshot, p.product_name) AS product_name,
    d.source_doc_no, d.batch_no,
    d.qty, d.qty_billed, (d.qty - d.qty_billed) AS qty_outstanding,
    d.rate, d.amount,
    CASE WHEN d.qty = 0 THEN 0 ELSE ROUND(d.amount * (d.qty - d.qty_billed) / d.qty, 2) END AS amount_outstanding
FROM tenant_master.purchase_grn_details d
JOIN tenant_master.purchase_grns g ON g.id = d.grn_id
LEFT JOIN tenant_master.products p ON p.id = d.product_id
WHERE g.status NOT IN ('cancelled')
ORDER BY g.doc_date, g.doc_no;

-- Seed the field catalog + compulsory defaults, same pattern as every
-- other document in the chain.
INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_grn', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('purchase_grn', 'master', 'vendor_ledger_id', 'Vendor', 'picker', FALSE, 2),
('purchase_grn', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('purchase_grn', 'master', 'invoice_type', 'Invoice Type', 'select', FALSE, 4),
('purchase_grn', 'master', 'currency', 'Currency', 'text', FALSE, 5),
('purchase_grn', 'master', 'due_date', 'Due Date', 'date', FALSE, 6),
('purchase_grn', 'master', 'due_days', 'Due Days', 'number', FALSE, 7),
('purchase_grn', 'master', 'warehouse_id', 'Warehouse', 'picker', FALSE, 8),
('purchase_grn', 'master', 'goods_account_ledger_id', 'Goods Account', 'picker', FALSE, 9),
('purchase_grn', 'master', 'goods_sub_ledger_id', 'Goods Sub-Ledger', 'picker', FALSE, 10),
('purchase_grn', 'master', 'vendor_challan_no', 'Vendor Challan No', 'text', FALSE, 11),
('purchase_grn', 'master', 'vendor_challan_date', 'Vendor Challan Date', 'date', FALSE, 12),
('purchase_grn', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 13),
('purchase_grn', 'master', 'rate_type', 'Rate Type', 'select', FALSE, 14),
('purchase_grn', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 15),
('purchase_grn', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 16),
('purchase_grn', 'master', 'area_id', 'Area', 'picker', FALSE, 17),
('purchase_grn', 'master', 'route_id', 'Route', 'picker', FALSE, 18),
('purchase_grn', 'master', 'priority', 'Priority', 'select', FALSE, 19),
('purchase_grn', 'master', 'terms_conditions_id', 'Terms & Conditions', 'picker', FALSE, 20),
('purchase_grn', 'master', 'narration', 'Narration', 'text', FALSE, 21),
('purchase_grn', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('purchase_grn', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('purchase_grn', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('purchase_grn', 'detail', 'alt_qty', 'Alt Qty', 'number', FALSE, 4),
('purchase_grn', 'detail', 'alt_unit_id', 'Alt Unit', 'select', FALSE, 5),
('purchase_grn', 'detail', 'alt1_qty', 'Alt1 Qty', 'number', FALSE, 6),
('purchase_grn', 'detail', 'alt1_unit_id', 'Alt1 Unit', 'select', FALSE, 7),
('purchase_grn', 'detail', 'rate', 'Rate', 'number', FALSE, 8),
('purchase_grn', 'detail', 'discount_percent', 'Discount %', 'number', FALSE, 9),
('purchase_grn', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 10),
('purchase_grn', 'detail', 'free_qty', 'Free Qty', 'number', FALSE, 11),
('purchase_grn', 'detail', 'free_uom_id', 'Free UOM', 'select', FALSE, 12),
('purchase_grn', 'detail', 'warehouse_id', 'Details Warehouse', 'select', FALSE, 13),
('purchase_grn', 'detail', 'barcode', 'Barcode', 'text', FALSE, 14),
('purchase_grn', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 15),
('purchase_grn', 'detail', 'narration', 'Narration', 'text', FALSE, 16)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
