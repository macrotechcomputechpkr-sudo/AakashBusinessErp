-- =============================================
-- PURCHASE ADDITIONAL EXPENSE
-- Extra costs beyond the vendor's own bill - freight, customs duty,
-- insurance, loading/unloading, etc. - linked to an Order, GRN, and/or
-- Bill (whichever is the right stage to attach the cost to), with each
-- expense line ALLOCATED across the source document's product lines
-- for an accurate landed cost per item.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.purchase_additional_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    source_order_id UUID REFERENCES tenant_master.purchase_orders(id),
    source_grn_id UUID REFERENCES tenant_master.purchase_grns(id),
    source_bill_id UUID REFERENCES tenant_master.purchase_bills(id),

    -- The expense PROVIDER (e.g. a transporter or insurer) - often a
    -- different party than the goods vendor, so this is its own field,
    -- not reused from the source document.
    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    cash_vendor_name VARCHAR(200),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    invoice_type VARCHAR(10) DEFAULT 'credit',
    currency VARCHAR(10) DEFAULT 'NPR',
    party_bill_no VARCHAR(50),
    party_bill_date DATE,

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    priority VARCHAR(10) DEFAULT 'normal',
    narration TEXT,

    vendor_name_snapshot VARCHAR(200),
    agent_name_snapshot VARCHAR(150),
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

    CONSTRAINT unique_additional_expense_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_expense_invoice_type CHECK (invoice_type IN ('cash', 'credit')),
    CONSTRAINT valid_expense_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_expense_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT expense_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL),
    CONSTRAINT expense_needs_a_source CHECK (source_order_id IS NOT NULL OR source_grn_id IS NOT NULL OR source_bill_id IS NOT NULL)
);

-- The expense LINES themselves - e.g. "Freight: 5000", "Insurance: 2000".
-- FEATURE (informed by comparing several accounting packages' approach
-- to this same problem - Tally's "Apportion for Additional Cost" ledger
-- classification, Business Central's Item Charge Assignment, Zoho's
-- Landed Cost distribution basis - none copied verbatim, converged
-- independently on the same well-established pattern):
--   - allocation_basis: per-LINE, not per-document, so one Additional
--     Expense entry can have some lines split by Value, others by Qty,
--     and some not distributed to items at all ('none' - e.g. a
--     withholding-tax line, which is real money moved but never part of
--     inventory cost).
--   - entry_sign: '+' lines increase what's owed to the expense
--     provider, '-' lines reduce it (a TDS/withholding deduction is the
--     standard case) - magnitude stays a plain positive `amount`, sign
--     only controls net effect, keeping validation simple.
--   - rate_percent: optional convenience - when set, this line's amount
--     can be computed as rate_percent% of the OTHER lines' net total
--     (e.g. a 13% VAT line, a 1.5% TDS line on the freight charge),
--     rather than always hand-typed.
CREATE TABLE IF NOT EXISTS tenant_master.purchase_additional_expense_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    expense_id UUID NOT NULL REFERENCES tenant_master.purchase_additional_expenses(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    expense_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    description VARCHAR(200),
    allocation_basis VARCHAR(15) NOT NULL DEFAULT 'value_wise',
    entry_sign VARCHAR(6) NOT NULL DEFAULT 'add',
    rate_percent DECIMAL(6, 3),
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    CONSTRAINT positive_expense_line_amount CHECK (amount > 0),
    CONSTRAINT valid_expense_line_basis CHECK (allocation_basis IN ('value_wise', 'qty_wise', 'equal', 'none')),
    CONSTRAINT valid_expense_line_sign CHECK (entry_sign IN ('add', 'deduct'))
);

-- FEATURE: "allocated for landed cost" - one row per (expense, source
-- product line), storing this line's OWN share of the total expense.
-- Computed and stored at save time (given allocation_method), rather
-- than only ever derived on the fly, so the number that fed a Bill's or
-- inventory's landed cost stays fixed even if the source Order/GRN/Bill
-- gets edited afterward.
CREATE TABLE IF NOT EXISTS tenant_master.purchase_expense_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    expense_id UUID NOT NULL REFERENCES tenant_master.purchase_additional_expenses(id) ON DELETE CASCADE,
    source_order_detail_id UUID REFERENCES tenant_master.purchase_order_details(id),
    source_grn_detail_id UUID REFERENCES tenant_master.purchase_grn_details(id),
    source_bill_detail_id UUID REFERENCES tenant_master.purchase_bill_details(id),
    product_id UUID REFERENCES tenant_master.products(id),
    product_name_snapshot VARCHAR(200),
    line_qty DECIMAL(15, 4),
    line_value DECIMAL(15, 2),
    allocated_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    landed_cost_per_unit DECIMAL(15, 4)
);

CREATE INDEX IF NOT EXISTS idx_expense_lines_expense ON tenant_master.purchase_additional_expense_lines(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_allocations_expense ON tenant_master.purchase_expense_allocations(expense_id);
CREATE INDEX IF NOT EXISTS idx_additional_expense_doc_date ON tenant_master.purchase_additional_expenses(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_additional_expense_fiscal_year ON tenant_master.purchase_additional_expenses(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_additional_expense_status ON tenant_master.purchase_additional_expenses(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_additional_expense_source_ord ON tenant_master.purchase_additional_expenses(source_order_id) WHERE source_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_additional_expense_source_grn ON tenant_master.purchase_additional_expenses(source_grn_id) WHERE source_grn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_additional_expense_source_bill ON tenant_master.purchase_additional_expenses(source_bill_id) WHERE source_bill_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_additional_expenses_updated_at ON tenant_master.purchase_additional_expenses;
CREATE TRIGGER trg_additional_expenses_updated_at BEFORE UPDATE ON tenant_master.purchase_additional_expenses
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_additional_expense_code;

-- Field catalog seed, same pattern as every other document.
INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_additional', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('purchase_additional', 'master', 'vendor_ledger_id', 'Vendor (Expense Provider)', 'picker', FALSE, 2),
('purchase_additional', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('purchase_additional', 'master', 'invoice_type', 'Invoice Type', 'select', FALSE, 4),
('purchase_additional', 'master', 'currency', 'Currency', 'text', FALSE, 5),
('purchase_additional', 'master', 'party_bill_no', 'Party Bill No', 'text', FALSE, 6),
('purchase_additional', 'master', 'party_bill_date', 'Party Bill Date', 'date', FALSE, 7),
('purchase_additional', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 8),
('purchase_additional', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 9),
('purchase_additional', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 10),
('purchase_additional', 'master', 'priority', 'Priority', 'select', FALSE, 11),
('purchase_additional', 'master', 'narration', 'Narration', 'text', FALSE, 12),
('purchase_additional', 'detail', 'expense_ledger_id', 'Ledger', 'picker', TRUE, 1),
('purchase_additional', 'detail', 'description', 'Term', 'text', FALSE, 2),
('purchase_additional', 'detail', 'allocation_basis', 'Basis', 'select', TRUE, 3),
('purchase_additional', 'detail', 'entry_sign', 'Sign', 'select', TRUE, 4),
('purchase_additional', 'detail', 'rate_percent', 'Rate %', 'number', FALSE, 5),
('purchase_additional', 'detail', 'amount', 'Amount', 'number', TRUE, 6)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
