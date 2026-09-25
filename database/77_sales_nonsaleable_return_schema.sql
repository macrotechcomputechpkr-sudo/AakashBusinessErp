-- =============================================
-- SALES NON-SALEABLE RETURN
-- "nonsale main stock maa effect garne hoena xuttai rakhne ho" - the
-- SAME principle already built for Purchase (file 65), reused here for
-- the selling side: a customer returns damaged/expired goods that must
-- NEVER rejoin sellable stock. Physically tracked in the SAME separate
-- nonsaleable_stock_movements ledger (source_type distinguishes which
-- side), never the main stock_movements one.
--
-- Two settlement paths:
--   'credit_note' - we still credit the customer (a 'cr' bill-wise
--   reference, exactly like a regular Sales Return) even though the
--   goods themselves are unsellable - common when the damage is our
--   fault (bad batch, wrong item shipped).
--   'no_credit' - goods are physically received back (so the loss is
--   tracked) but the customer is NOT credited - no GL/bill-wise impact
--   at all, purely a stock-and-record-keeping entry.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.sales_nonsaleable_returns (
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
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    sales_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),

    return_reason VARCHAR(30) DEFAULT 'damaged',
    settlement_type VARCHAR(20) DEFAULT 'credit_note',

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),

    customer_name_snapshot VARCHAR(200),
    customer_sub_ledger_name_snapshot VARCHAR(200),
    warehouse_name_snapshot VARCHAR(200),
    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    posted_by UUID,
    posted_at TIMESTAMPTZ,
    total_amount DECIMAL(15, 2) DEFAULT 0,

    pending_bill_wise_settlements JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_sales_nonsaleable_return_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_sales_nonsaleable_return_reason CHECK (return_reason IN ('damaged', 'expired', 'quality_issue', 'wrong_item', 'other')),
    CONSTRAINT valid_sales_nonsaleable_settlement_type CHECK (settlement_type IN ('credit_note', 'no_credit')),
    CONSTRAINT valid_sales_nonsaleable_return_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT sales_nonsaleable_return_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.sales_nonsaleable_return_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    return_id UUID NOT NULL REFERENCES tenant_master.sales_nonsaleable_returns(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    source_bill_detail_id UUID REFERENCES tenant_master.sales_bill_details(id),

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID REFERENCES tenant_master.product_units(id),
    rate DECIMAL(15, 4) DEFAULT 0,
    amount DECIMAL(15, 2) DEFAULT 0,
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT positive_sales_nonsaleable_return_qty CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_nsreturn_details_return ON tenant_master.sales_nonsaleable_return_details(return_id);
CREATE INDEX IF NOT EXISTS idx_sales_nsreturns_customer ON tenant_master.sales_nonsaleable_returns(customer_ledger_id);
CREATE INDEX IF NOT EXISTS idx_sales_nsreturns_status ON tenant_master.sales_nonsaleable_returns(tenant_id, status);

DROP TRIGGER IF EXISTS trg_sales_nsreturns_updated_at ON tenant_master.sales_nonsaleable_returns;
CREATE TRIGGER trg_sales_nsreturns_updated_at BEFORE UPDATE ON tenant_master.sales_nonsaleable_returns
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sales_nsreturn_code;

ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return', 'stock_transfer',
        'debit_note', 'credit_note', 'cash_bank_entry', 'sales_quotation', 'sales_nonsalable_return'
    ));

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('sales_nonsalable_return', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('sales_nonsalable_return', 'master', 'customer_ledger_id', 'Customer', 'picker', TRUE, 2),
('sales_nonsalable_return', 'master', 'warehouse_id', 'Warehouse', 'picker', TRUE, 3),
('sales_nonsalable_return', 'master', 'return_reason', 'Return Reason', 'select', FALSE, 4),
('sales_nonsalable_return', 'master', 'settlement_type', 'Settlement Type', 'select', FALSE, 5),
('sales_nonsalable_return', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('sales_nonsalable_return', 'detail', 'qty', 'Qty', 'number', TRUE, 2)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
