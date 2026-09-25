-- =============================================
-- CUSTOMS OFFICE MASTER (Bhansar Office)
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.customs_offices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    office_code VARCHAR(20),
    office_name VARCHAR(150) NOT NULL,
    location VARCHAR(150),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT unique_customs_office_name UNIQUE (tenant_id, office_name)
);

-- =============================================
-- PURCHASE BILL
-- Universal pull-forward from Quotation, Order, and/or GRN (any
-- combination). Import handling: "if the Vendor's Country is not
-- Nepal, offer Item-wise OR Bill-wise Import Details (pick one),
-- capture which Customs Office and the Import Declaration (Pragyapan
-- Patra) Number, and how much of the amount is Import-Taxable vs
-- Tax-Free - because Customs' own valuation can differ from what the
-- vendor actually invoiced, and this needs to reach the Purchase VAT
-- Register accurately either way."
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.purchase_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    source_quotation_id UUID REFERENCES tenant_master.purchase_quotations(id),
    source_order_id UUID REFERENCES tenant_master.purchase_orders(id),
    source_grn_id UUID REFERENCES tenant_master.purchase_grns(id),

    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    invoice_type VARCHAR(10) DEFAULT 'credit',
    currency VARCHAR(10) DEFAULT 'NPR',
    due_date DATE,
    due_days INTEGER,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    goods_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    goods_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),

    party_bill_no VARCHAR(50),
    party_bill_date DATE,

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

    import_detail_mode VARCHAR(10),
    customs_office_id UUID REFERENCES tenant_master.customs_offices(id),
    customs_declaration_no VARCHAR(50),
    customs_declaration_date DATE,
    bill_wise_import_taxable_amount DECIMAL(15, 2),
    bill_wise_import_tax_free_amount DECIMAL(15, 2),

    vendor_name_snapshot VARCHAR(200),
    agent_name_snapshot VARCHAR(150),
    warehouse_name_snapshot VARCHAR(200),
    goods_account_name_snapshot VARCHAR(200),
    goods_sub_ledger_name_snapshot VARCHAR(200),
    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),
    area_name_snapshot VARCHAR(150),
    route_name_snapshot VARCHAR(150),
    customs_office_name_snapshot VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- FEATURE: settlements chosen (FIFO-suggested or hand-edited) while
    -- FILLING the form get stored here, then consumed automatically at
    -- the separate later moment this document is actually POSTED (a
    -- one-click action from the list view, with no form open to re-ask
    -- for them).
    pending_bill_wise_settlements JSONB,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_bill_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_bill_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_bill_rate_type CHECK (rate_type IN ('inclusive', 'exclusive')),
    CONSTRAINT valid_bill_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_bill_import_mode CHECK (import_detail_mode IS NULL OR import_detail_mode IN ('item_wise', 'bill_wise')),
    CONSTRAINT valid_bill_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT bill_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.purchase_bill_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    bill_id UUID NOT NULL REFERENCES tenant_master.purchase_bills(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    source_quotation_detail_id UUID REFERENCES tenant_master.purchase_quotation_details(id),
    source_order_detail_id UUID REFERENCES tenant_master.purchase_order_details(id),
    source_grn_detail_id UUID REFERENCES tenant_master.purchase_grn_details(id),
    source_doc_no VARCHAR(50),
    batch_no VARCHAR(50),

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

    item_import_taxable_amount DECIMAL(15, 2),
    item_import_tax_free_amount DECIMAL(15, 2),

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    alt_unit_name_snapshot VARCHAR(50),
    alt1_unit_name_snapshot VARCHAR(50),
    free_uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_bill_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_details_bill ON tenant_master.purchase_bill_details(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_details_product ON tenant_master.purchase_bill_details(product_id);
CREATE INDEX IF NOT EXISTS idx_bill_doc_date ON tenant_master.purchase_bills(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_bill_fiscal_year ON tenant_master.purchase_bills(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_bill_vendor ON tenant_master.purchase_bills(vendor_ledger_id);
CREATE INDEX IF NOT EXISTS idx_bill_status ON tenant_master.purchase_bills(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bill_source_quo ON tenant_master.purchase_bills(source_quotation_id) WHERE source_quotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bill_source_ord ON tenant_master.purchase_bills(source_order_id) WHERE source_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bill_source_grn ON tenant_master.purchase_bills(source_grn_id) WHERE source_grn_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_purchase_bills_updated_at ON tenant_master.purchase_bills;
CREATE TRIGGER trg_purchase_bills_updated_at BEFORE UPDATE ON tenant_master.purchase_bills
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_bill_code;

-- FEATURE: "Purchase VAT Register should reflect this" - one row per
-- Bill line, with BOTH the vendor's own invoiced amount AND whatever
-- Customs-assessed Import Taxable/Tax-Free split applies (item-wise
-- value if set, else an even share of the bill-wise split, else NULL
-- for a purely local purchase with no separate customs valuation).
CREATE OR REPLACE VIEW tenant_master.v_purchase_vat_register AS
SELECT
    b.id AS bill_id, b.tenant_id, b.doc_no, b.doc_date,
    COALESCE(b.vendor_name_snapshot, b.cash_vendor_name) AS vendor_name,
    b.party_bill_no, b.party_bill_date,
    b.import_detail_mode, b.customs_office_name_snapshot, b.customs_declaration_no, b.customs_declaration_date,
    d.id AS detail_id, COALESCE(d.product_name_snapshot, p.product_name) AS product_name,
    d.qty, d.rate, d.amount AS invoiced_amount, d.tax_percent, d.tax_amount AS local_tax_amount,
    d.item_import_taxable_amount,
    d.item_import_tax_free_amount,
    b.bill_wise_import_taxable_amount, b.bill_wise_import_tax_free_amount,
    COALESCE(
        d.item_import_taxable_amount,
        CASE WHEN b.import_detail_mode = 'bill_wise' THEN b.bill_wise_import_taxable_amount / NULLIF((SELECT COUNT(*) FROM tenant_master.purchase_bill_details WHERE bill_id = b.id), 0) END
    ) AS effective_import_taxable_amount,
    COALESCE(
        d.item_import_tax_free_amount,
        CASE WHEN b.import_detail_mode = 'bill_wise' THEN b.bill_wise_import_tax_free_amount / NULLIF((SELECT COUNT(*) FROM tenant_master.purchase_bill_details WHERE bill_id = b.id), 0) END
    ) AS effective_import_tax_free_amount
FROM tenant_master.purchase_bill_details d
JOIN tenant_master.purchase_bills b ON b.id = d.bill_id
LEFT JOIN tenant_master.products p ON p.id = d.product_id
WHERE b.status != 'cancelled'
ORDER BY b.doc_date, b.doc_no;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_bill', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('purchase_bill', 'master', 'vendor_ledger_id', 'Vendor', 'picker', FALSE, 2),
('purchase_bill', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('purchase_bill', 'master', 'invoice_type', 'Invoice Type', 'select', FALSE, 4),
('purchase_bill', 'master', 'currency', 'Currency', 'text', FALSE, 5),
('purchase_bill', 'master', 'due_date', 'Due Date', 'date', FALSE, 6),
('purchase_bill', 'master', 'due_days', 'Due Days', 'number', FALSE, 7),
('purchase_bill', 'master', 'warehouse_id', 'Warehouse', 'picker', FALSE, 8),
('purchase_bill', 'master', 'goods_account_ledger_id', 'Goods Account', 'picker', FALSE, 9),
('purchase_bill', 'master', 'goods_sub_ledger_id', 'Goods Sub-Ledger', 'picker', FALSE, 10),
('purchase_bill', 'master', 'party_bill_no', 'Party Bill No', 'text', FALSE, 11),
('purchase_bill', 'master', 'party_bill_date', 'Party Bill Date', 'date', FALSE, 12),
('purchase_bill', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 13),
('purchase_bill', 'master', 'rate_type', 'Rate Type', 'select', FALSE, 14),
('purchase_bill', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 15),
('purchase_bill', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 16),
('purchase_bill', 'master', 'area_id', 'Area', 'picker', FALSE, 17),
('purchase_bill', 'master', 'route_id', 'Route', 'picker', FALSE, 18),
('purchase_bill', 'master', 'priority', 'Priority', 'select', FALSE, 19),
('purchase_bill', 'master', 'terms_conditions_id', 'Terms & Conditions', 'picker', FALSE, 20),
('purchase_bill', 'master', 'narration', 'Narration', 'text', FALSE, 21),
('purchase_bill', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('purchase_bill', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('purchase_bill', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('purchase_bill', 'detail', 'alt_qty', 'Alt Qty', 'number', FALSE, 4),
('purchase_bill', 'detail', 'alt_unit_id', 'Alt Unit', 'select', FALSE, 5),
('purchase_bill', 'detail', 'alt1_qty', 'Alt1 Qty', 'number', FALSE, 6),
('purchase_bill', 'detail', 'alt1_unit_id', 'Alt1 Unit', 'select', FALSE, 7),
('purchase_bill', 'detail', 'rate', 'Rate', 'number', FALSE, 8),
('purchase_bill', 'detail', 'discount_percent', 'Discount %', 'number', FALSE, 9),
('purchase_bill', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 10),
('purchase_bill', 'detail', 'free_qty', 'Free Qty', 'number', FALSE, 11),
('purchase_bill', 'detail', 'free_uom_id', 'Free UOM', 'select', FALSE, 12),
('purchase_bill', 'detail', 'warehouse_id', 'Details Warehouse', 'select', FALSE, 13),
('purchase_bill', 'detail', 'barcode', 'Barcode', 'text', FALSE, 14),
('purchase_bill', 'detail', 'batch_no', 'Batch No', 'text', FALSE, 15),
('purchase_bill', 'detail', 'narration', 'Narration', 'text', FALSE, 16)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
