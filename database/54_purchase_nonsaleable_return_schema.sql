-- =============================================
-- PURCHASE NON-SALEABLE RETURN
-- Goods that can't be sold (damaged, expired, defective beyond use)
-- being returned to the vendor - structurally like Purchase Return
-- (links to Bill only), but tracked as its own document type since the
-- REASON a return happens (still-good-condition excess/wrong-item vs.
-- genuinely-unsaleable stock) matters for reporting and often for
-- accounting treatment (a straight Credit Note vs. a write-off/damage
-- claim). Shares the SAME qty_returned column on purchase_bill_details
-- as regular Purchase Return, so whichever combination of the two types
-- gets used, the total returned against a Bill line can never exceed
-- what was actually billed.
-- =============================================

-- FEATURE: extend the catalog's allowed voucher_type list to include
-- Non-saleable Return - without this, the seed INSERT below would fail
-- the existing CHECK constraint outright.
ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return'
    ));

CREATE TABLE IF NOT EXISTS tenant_master.purchase_nonsaleable_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

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
    -- FEATURE: unlike regular Return's free-choice reason list, a
    -- Non-saleable Return's reason is always about the STOCK's own
    -- condition - it exists specifically for this class of reason.
    return_reason VARCHAR(30) NOT NULL DEFAULT 'damaged',

    -- FEATURE: whether the vendor is expected to compensate for this
    -- (a real credit) or the goods are simply being disposed of/written
    -- off with no compensation - changes the accounting treatment.
    settlement_type VARCHAR(20) NOT NULL DEFAULT 'credit_note',

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
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_nonsaleable_return_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_nsreturn_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_nsreturn_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_nsreturn_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_nsreturn_reason CHECK (return_reason IN ('damaged', 'expired', 'defective', 'contaminated', 'recalled', 'other')),
    CONSTRAINT valid_nsreturn_settlement CHECK (settlement_type IN ('credit_note', 'write_off')),
    CONSTRAINT valid_nsreturn_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT nsreturn_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL),
    CONSTRAINT nsreturn_needs_a_source CHECK (source_bill_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.purchase_nonsaleable_return_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    return_id UUID NOT NULL REFERENCES tenant_master.purchase_nonsaleable_returns(id) ON DELETE CASCADE,
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

    CONSTRAINT positive_nsreturn_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_nsreturn_details_return ON tenant_master.purchase_nonsaleable_return_details(return_id);
CREATE INDEX IF NOT EXISTS idx_nsreturn_details_product ON tenant_master.purchase_nonsaleable_return_details(product_id);
CREATE INDEX IF NOT EXISTS idx_nsreturn_doc_date ON tenant_master.purchase_nonsaleable_returns(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_nsreturn_fiscal_year ON tenant_master.purchase_nonsaleable_returns(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_nsreturn_vendor ON tenant_master.purchase_nonsaleable_returns(vendor_ledger_id);
CREATE INDEX IF NOT EXISTS idx_nsreturn_status ON tenant_master.purchase_nonsaleable_returns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_nsreturn_source_bill ON tenant_master.purchase_nonsaleable_returns(source_bill_id) WHERE source_bill_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_nonsaleable_returns_updated_at ON tenant_master.purchase_nonsaleable_returns;
CREATE TRIGGER trg_nonsaleable_returns_updated_at BEFORE UPDATE ON tenant_master.purchase_nonsaleable_returns
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_nonsaleable_return_code;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_nonsalable_return', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('purchase_nonsalable_return', 'master', 'vendor_ledger_id', 'Vendor', 'picker', FALSE, 2),
('purchase_nonsalable_return', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('purchase_nonsalable_return', 'master', 'invoice_type', 'Invoice Type', 'select', FALSE, 4),
('purchase_nonsalable_return', 'master', 'currency', 'Currency', 'text', FALSE, 5),
('purchase_nonsalable_return', 'master', 'warehouse_id', 'Warehouse', 'picker', FALSE, 6),
('purchase_nonsalable_return', 'master', 'goods_account_ledger_id', 'Goods Account', 'picker', FALSE, 7),
('purchase_nonsalable_return', 'master', 'goods_sub_ledger_id', 'Goods Sub-Ledger', 'picker', FALSE, 8),
('purchase_nonsalable_return', 'master', 'party_bill_no', 'Party Bill No', 'text', FALSE, 9),
('purchase_nonsalable_return', 'master', 'party_bill_date', 'Party Bill Date', 'date', FALSE, 10),
('purchase_nonsalable_return', 'master', 'return_reason', 'Return Reason', 'select', TRUE, 11),
('purchase_nonsalable_return', 'master', 'settlement_type', 'Settlement Type', 'select', TRUE, 12),
('purchase_nonsalable_return', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 13),
('purchase_nonsalable_return', 'master', 'rate_type', 'Rate Type', 'select', FALSE, 14),
('purchase_nonsalable_return', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 15),
('purchase_nonsalable_return', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 16),
('purchase_nonsalable_return', 'master', 'priority', 'Priority', 'select', FALSE, 17),
('purchase_nonsalable_return', 'master', 'narration', 'Narration', 'text', FALSE, 18),
('purchase_nonsalable_return', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('purchase_nonsalable_return', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('purchase_nonsalable_return', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('purchase_nonsalable_return', 'detail', 'rate', 'Rate', 'number', FALSE, 4),
('purchase_nonsalable_return', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 5),
('purchase_nonsalable_return', 'detail', 'warehouse_id', 'Details Warehouse', 'select', FALSE, 6),
('purchase_nonsalable_return', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 7),
('purchase_nonsalable_return', 'detail', 'line_reason', 'Line Reason', 'text', FALSE, 8)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
