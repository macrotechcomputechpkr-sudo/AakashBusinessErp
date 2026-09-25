-- =============================================
-- JOURNAL VOUCHER (JV)
-- The first general-accounting document - direct multi-line Debit/
-- Credit entries. Informed by comparing several mature ERP schemas'
-- approach to this same concept (none copied verbatim - own naming,
-- own structure, several genuine improvements folded in):
--   - Every detail LINE is itself either a Debit or a Credit (not a
--     qty/product line), and the whole voucher must balance (SUM debit
--     = SUM credit) - exactly the Dr=Cr rule ledger_transaction_lines
--     (file 45) already enforces, so a posted JV's lines feed straight
--     into that SAME shared table rather than a second parallel one.
--   - is_memo: a memo entry is recorded for reference but deliberately
--     never meant to post (distinct from "not yet posted").
--   - posted_by/posted_at separate from created_by: who actually
--     committed this to the ledger can differ from who drafted it.
--   - audit_locked: once an auditor locks a voucher, no one touches it
--     - deliberately separate from status, since a correction to a
--     POSTED voucher is still conceivable, but a LOCKED one never is.
--   - tds_percent on a line: auto-computes a withholding deduction the
--     same way Purchase Bill/Additional Expense already do.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.journal_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    ref_doc_no VARCHAR(50),
    ref_doc_date DATE,

    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,

    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),

    is_memo BOOLEAN DEFAULT FALSE,

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,

    posted_by UUID,
    posted_at TIMESTAMPTZ,

    audit_locked BOOLEAN DEFAULT FALSE,
    audit_locked_by UUID,
    audit_locked_at TIMESTAMPTZ,

    total_debit DECIMAL(15, 2) DEFAULT 0,
    total_credit DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_jv_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_jv_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT jv_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.journal_voucher_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    jv_id UUID NOT NULL REFERENCES tenant_master.journal_vouchers(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),

    debit_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    credit_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tds_percent DECIMAL(6, 3),
    narration TEXT,

    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),

    ledger_name_snapshot VARCHAR(200),
    sub_ledger_name_snapshot VARCHAR(200),
    agent_name_snapshot VARCHAR(150),

    CONSTRAINT valid_jvd_dr_or_cr CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_jv_details_jv ON tenant_master.journal_voucher_details(jv_id);
CREATE INDEX IF NOT EXISTS idx_jv_details_ledger ON tenant_master.journal_voucher_details(ledger_id);
CREATE INDEX IF NOT EXISTS idx_jv_doc_date ON tenant_master.journal_vouchers(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_jv_fiscal_year ON tenant_master.journal_vouchers(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_jv_status ON tenant_master.journal_vouchers(tenant_id, status);

DROP TRIGGER IF EXISTS trg_journal_vouchers_updated_at ON tenant_master.journal_vouchers;
CREATE TRIGGER trg_journal_vouchers_updated_at BEFORE UPDATE ON tenant_master.journal_vouchers
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_journal_voucher_code;

ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return'
    ));

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('journal', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('journal', 'master', 'ref_doc_no', 'Ref Doc No', 'text', FALSE, 2),
('journal', 'master', 'ref_doc_date', 'Ref Doc Date', 'date', FALSE, 3),
('journal', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 4),
('journal', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 5),
('journal', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 6),
('journal', 'master', 'narration', 'Narration', 'text', FALSE, 7),
('journal', 'master', 'is_memo', 'Memo Only (not posted)', 'boolean', FALSE, 8),
('journal', 'detail', 'ledger_id', 'Ledger', 'picker', TRUE, 1),
('journal', 'detail', 'sub_ledger_id', 'Sub Ledger', 'picker', FALSE, 2),
('journal', 'detail', 'debit_amount', 'Debit', 'number', FALSE, 3),
('journal', 'detail', 'credit_amount', 'Credit', 'number', FALSE, 4),
('journal', 'detail', 'tds_percent', 'TDS %', 'number', FALSE, 5),
('journal', 'detail', 'narration', 'Narration', 'text', FALSE, 6)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
