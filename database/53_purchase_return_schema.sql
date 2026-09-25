-- =============================================
-- PURCHASE RETURN
-- Goods returned to the vendor - linked to the Bill they were billed
-- against (not GRN - a return is a Credit Note against what was
-- actually billed, not the physical receipt event), with the specific
-- qty being returned per line and a reason. Reduces what's owed to the
-- vendor (or creates a receivable), and rolls back into the source
-- Bill's own "returned so far" tracking so re-pulling never double-returns.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.purchase_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    -- Return links to the Bill only - a return is a Credit Note against
    -- what was actually billed, not the physical receipt event (GRN).
    source_bill_id UUID REFERENCES tenant_master.purchase_bills(id),

    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    cash_vendor_name VARCHAR(200),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    invoice_type VARCHAR(10) DEFAULT 'credit',
    currency VARCHAR(10) DEFAULT 'NPR',
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    goods_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    goods_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),

    party_bill_no VARCHAR(50),
    party_bill_date DATE,
    return_reason VARCHAR(30) NOT NULL DEFAULT 'other',

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    rate_type VARCHAR(20) DEFAULT 'exclusive',
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    priority VARCHAR(10) DEFAULT 'normal',
    narration TEXT,

    vendor_name_snapshot VARCHAR(200),
    agent_name_snapshot VARCHAR(150),
    warehouse_name_snapshot VARCHAR(200),
    goods_account_name_snapshot VARCHAR(200),
    goods_sub_ledger_name_snapshot VARCHAR(200),
    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    pending_bill_wise_settlements JSONB,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_return_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_return_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_return_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_return_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_return_reason CHECK (return_reason IN ('defective', 'excess_quantity', 'wrong_item', 'quality_issue', 'price_dispute', 'other')),
    CONSTRAINT valid_return_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT return_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL),
    CONSTRAINT return_needs_a_source CHECK (source_bill_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.purchase_return_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    return_id UUID NOT NULL REFERENCES tenant_master.purchase_returns(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    source_bill_detail_id UUID REFERENCES tenant_master.purchase_bill_details(id),
    source_doc_no VARCHAR(50),
    batch_no VARCHAR(50),

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    tax_percent DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    line_reason VARCHAR(200),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_return_qty CHECK (qty > 0)
);

-- FEATURE: "returned so far" progress on the Bill's own lines, so
-- pulling from the same Bill twice never returns more than was billed
-- in the first place. (Return links to Bill only, not GRN.)
ALTER TABLE tenant_master.purchase_bill_details
    ADD COLUMN IF NOT EXISTS qty_returned DECIMAL(15, 4) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_return_details_return ON tenant_master.purchase_return_details(return_id);
CREATE INDEX IF NOT EXISTS idx_return_details_product ON tenant_master.purchase_return_details(product_id);
CREATE INDEX IF NOT EXISTS idx_return_doc_date ON tenant_master.purchase_returns(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_return_fiscal_year ON tenant_master.purchase_returns(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_return_vendor ON tenant_master.purchase_returns(vendor_ledger_id);
CREATE INDEX IF NOT EXISTS idx_return_status ON tenant_master.purchase_returns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_return_source_bill ON tenant_master.purchase_returns(source_bill_id) WHERE source_bill_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_purchase_returns_updated_at ON tenant_master.purchase_returns;
CREATE TRIGGER trg_purchase_returns_updated_at BEFORE UPDATE ON tenant_master.purchase_returns
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_return_code;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_return', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('purchase_return', 'master', 'vendor_ledger_id', 'Vendor', 'picker', FALSE, 2),
('purchase_return', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('purchase_return', 'master', 'invoice_type', 'Invoice Type', 'select', FALSE, 4),
('purchase_return', 'master', 'currency', 'Currency', 'text', FALSE, 5),
('purchase_return', 'master', 'warehouse_id', 'Warehouse', 'picker', FALSE, 6),
('purchase_return', 'master', 'goods_account_ledger_id', 'Goods Account', 'picker', FALSE, 7),
('purchase_return', 'master', 'goods_sub_ledger_id', 'Goods Sub-Ledger', 'picker', FALSE, 8),
('purchase_return', 'master', 'party_bill_no', 'Party Bill No', 'text', FALSE, 9),
('purchase_return', 'master', 'party_bill_date', 'Party Bill Date', 'date', FALSE, 10),
('purchase_return', 'master', 'return_reason', 'Return Reason', 'select', TRUE, 11),
('purchase_return', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 12),
('purchase_return', 'master', 'rate_type', 'Rate Type', 'select', FALSE, 13),
('purchase_return', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 14),
('purchase_return', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 15),
('purchase_return', 'master', 'priority', 'Priority', 'select', FALSE, 16),
('purchase_return', 'master', 'narration', 'Narration', 'text', FALSE, 17),
('purchase_return', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('purchase_return', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('purchase_return', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('purchase_return', 'detail', 'rate', 'Rate', 'number', FALSE, 4),
('purchase_return', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 5),
('purchase_return', 'detail', 'warehouse_id', 'Details Warehouse', 'select', FALSE, 6),
('purchase_return', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 7),
('purchase_return', 'detail', 'line_reason', 'Line Reason', 'text', FALSE, 8)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;

-- FEATURE: same shape as every other module's Outstanding/Register view
-- - one row per Return line, using the historical snapshots.
CREATE OR REPLACE VIEW tenant_master.v_purchase_return_summary AS
SELECT
    r.id AS return_id, r.tenant_id, r.doc_no, r.doc_date, r.return_reason, r.status,
    COALESCE(r.vendor_name_snapshot, r.cash_vendor_name) AS vendor_name,
    d.id AS detail_id, COALESCE(d.product_name_snapshot, p.product_name) AS product_name,
    d.batch_no, d.source_doc_no, d.qty, d.rate, d.amount, d.line_reason
FROM tenant_master.purchase_return_details d
JOIN tenant_master.purchase_returns r ON r.id = d.return_id
LEFT JOIN tenant_master.products p ON p.id = d.product_id
WHERE r.status != 'cancelled'
ORDER BY r.doc_date, r.doc_no;
