-- =============================================
-- SALES ADDITIONAL ENTRY
-- Extra charges billed TO the customer beyond the product bill itself
-- (delivery, packing, handling, rush-order fee) - mirrors Purchase
-- Additional Expense's per-line structure (entry_sign, rate_percent)
-- but posts the OTHER direction: Dr Customer (increases what they
-- owe), Cr Income/Recovery ledger per line, and creates a 'dr' bill-
-- wise reference, exactly like a Sales Bill. Unlike Purchase Additional
-- Expense, a source document is NOT mandatory - a standalone service
-- charge unrelated to any specific order/delivery/bill is a normal use
-- case here.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.sales_additional_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    source_order_id UUID REFERENCES tenant_master.sales_orders(id),
    source_delivery_id UUID REFERENCES tenant_master.sales_deliveries(id),
    source_bill_id UUID REFERENCES tenant_master.sales_bills(id),

    customer_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    customer_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    narration TEXT,

    customer_name_snapshot VARCHAR(200),
    customer_sub_ledger_name_snapshot VARCHAR(200),
    agent_name_snapshot VARCHAR(150),
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

    CONSTRAINT unique_sales_additional_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_sales_additional_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT sales_additional_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.sales_additional_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entry_id UUID NOT NULL REFERENCES tenant_master.sales_additional_entries(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    income_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    description VARCHAR(200),
    entry_sign VARCHAR(6) NOT NULL DEFAULT 'add',
    rate_percent DECIMAL(6, 3),
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    CONSTRAINT positive_sales_additional_line_amount CHECK (amount > 0),
    CONSTRAINT valid_sales_additional_line_sign CHECK (entry_sign IN ('add', 'deduct'))
);

CREATE INDEX IF NOT EXISTS idx_sales_additional_lines_entry ON tenant_master.sales_additional_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_sales_additional_doc_date ON tenant_master.sales_additional_entries(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_sales_additional_status ON tenant_master.sales_additional_entries(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_additional_customer ON tenant_master.sales_additional_entries(customer_ledger_id);

DROP TRIGGER IF EXISTS trg_sales_additional_updated_at ON tenant_master.sales_additional_entries;
CREATE TRIGGER trg_sales_additional_updated_at BEFORE UPDATE ON tenant_master.sales_additional_entries
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sales_additional_code;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('sales_additional', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('sales_additional', 'master', 'customer_ledger_id', 'Customer', 'picker', TRUE, 2),
('sales_additional', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('sales_additional', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 4),
('sales_additional', 'master', 'narration', 'Narration', 'text', FALSE, 5),
('sales_additional', 'detail', 'income_ledger_id', 'Ledger', 'picker', TRUE, 1),
('sales_additional', 'detail', 'description', 'Description', 'text', FALSE, 2),
('sales_additional', 'detail', 'entry_sign', 'Sign', 'select', TRUE, 3),
('sales_additional', 'detail', 'amount', 'Amount', 'number', TRUE, 4)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
