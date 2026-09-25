-- =============================================
-- CASH/BANK ENTRY (Receipt / Payment)
-- The everyday counterpart to PDC - money that moves NOW, not on a
-- future date. 'receipt' = money coming in from a party (settles their
-- outstanding 'dr' balance, like a Credit Note/cleared PDC-received);
-- 'payment' = money going out to a party (settles our outstanding 'cr'
-- balance, like a Debit Note/cleared PDC-issued) - same ledger-
-- direction logic already established across DN/CN/PDC, reused here
-- rather than reinvented.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.cash_bank_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    entry_type VARCHAR(10) NOT NULL,
    cash_bank_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    party_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    party_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    amount DECIMAL(15, 2) NOT NULL,

    payment_mode VARCHAR(20) DEFAULT 'cash',
    ref_no VARCHAR(50),
    ref_doc_no VARCHAR(50),
    ref_doc_date DATE,

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),

    cash_bank_name_snapshot VARCHAR(200),
    party_name_snapshot VARCHAR(200),
    party_sub_ledger_name_snapshot VARCHAR(200),
    agent_name_snapshot VARCHAR(150),
    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    posted_by UUID,
    posted_at TIMESTAMPTZ,

    pending_bill_wise_settlements JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_cash_bank_entry_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT positive_cash_bank_amount CHECK (amount > 0),
    CONSTRAINT valid_cash_bank_entry_type CHECK (entry_type IN ('receipt', 'payment')),
    CONSTRAINT valid_payment_mode CHECK (payment_mode IN ('cash', 'bank_transfer', 'cheque', 'online', 'card', 'other')),
    CONSTRAINT valid_cash_bank_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT cash_bank_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cash_bank_entries_doc_date ON tenant_master.cash_bank_entries(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_cash_bank_entries_party ON tenant_master.cash_bank_entries(party_ledger_id);
CREATE INDEX IF NOT EXISTS idx_cash_bank_entries_status ON tenant_master.cash_bank_entries(tenant_id, status);

DROP TRIGGER IF EXISTS trg_cash_bank_entries_updated_at ON tenant_master.cash_bank_entries;
CREATE TRIGGER trg_cash_bank_entries_updated_at BEFORE UPDATE ON tenant_master.cash_bank_entries
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_cash_bank_entry_code;

-- FEATURE: "Bulk Cash Receipt/Payment" - one parent action that fans
-- out into many individual cash_bank_entries at once (collecting rent
-- from 30 tenants, disbursing salaries to 20 staff) - the batch itself
-- carries no accounting weight, it exists purely to group and re-open
-- the entries it created.
CREATE TABLE IF NOT EXISTS tenant_master.bulk_cash_bank_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    batch_no VARCHAR(20) NOT NULL,
    batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    entry_type VARCHAR(10) NOT NULL,
    cash_bank_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    narration TEXT,
    total_amount DECIMAL(15, 2) DEFAULT 0,
    entry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT unique_bulk_cash_bank_batch_no UNIQUE (tenant_id, batch_no),
    CONSTRAINT valid_bulk_entry_type CHECK (entry_type IN ('receipt', 'payment'))
);

ALTER TABLE tenant_master.cash_bank_entries
    ADD COLUMN IF NOT EXISTS bulk_batch_id UUID REFERENCES tenant_master.bulk_cash_bank_batches(id);

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_bulk_cash_bank_code;

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
('cash_bank_entry', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('cash_bank_entry', 'master', 'entry_type', 'Receipt / Payment', 'select', TRUE, 2),
('cash_bank_entry', 'master', 'cash_bank_ledger_id', 'Cash/Bank Ledger', 'picker', TRUE, 3),
('cash_bank_entry', 'master', 'party_ledger_id', 'Party', 'picker', TRUE, 4),
('cash_bank_entry', 'master', 'amount', 'Amount', 'number', TRUE, 5),
('cash_bank_entry', 'master', 'payment_mode', 'Payment Mode', 'select', FALSE, 6),
('cash_bank_entry', 'master', 'ref_no', 'Ref No', 'text', FALSE, 7),
('cash_bank_entry', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 8),
('cash_bank_entry', 'master', 'narration', 'Narration', 'text', FALSE, 9)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
