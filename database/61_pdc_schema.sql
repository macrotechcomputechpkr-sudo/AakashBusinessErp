-- =============================================
-- POST-DATED CHEQUE (PDC)
-- Informed by comparing two ERP schemas: one splits PDC into separate
-- Deposit/Return/AgainstCash tables per lifecycle stage (more tables,
-- more sync work), the other uses a SINGLE table with a status column
-- carrying the cheque through its whole lifecycle - the simpler,
-- adopted approach here (own naming, own structure).
--
-- Lifecycle: pending (cheque in hand, nothing posted yet - it's
-- POST-dated, the money hasn't moved) -> posted (cash received / cheque
-- cleared - THIS is when the real GL entry posts, settling the party's
-- outstanding bill-wise reference) OR returned (dishonoured/bounced -
-- reverses back to outstanding if it had already been posted) ->
-- cancelled (voided before either of the above).
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.pdc_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    voucher_type VARCHAR(10) NOT NULL,

    party_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    party_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    bank_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),

    cheque_no VARCHAR(50) NOT NULL,
    cheque_date DATE NOT NULL,
    bank_name VARCHAR(150),
    bank_branch VARCHAR(150),
    bank_account_name VARCHAR(150),
    bank_account_no VARCHAR(50),
    beneficiary_name VARCHAR(150),
    amount DECIMAL(15, 2) NOT NULL,

    is_online_pdc BOOLEAN DEFAULT FALSE,
    is_opening_balance BOOLEAN DEFAULT FALSE,

    ref_doc_no VARCHAR(50),
    ref_doc_date DATE,
    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),

    party_name_snapshot VARCHAR(200),
    party_sub_ledger_name_snapshot VARCHAR(200),
    bank_ledger_name_snapshot VARCHAR(200),
    cost_center_name_snapshot VARCHAR(150),
    business_unit_name_snapshot VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    posting_date DATE,
    posting_no VARCHAR(50),
    posted_by UUID,
    return_reason TEXT,
    returned_at TIMESTAMPTZ,
    returned_by UUID,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,

    pending_bill_wise_settlements JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_pdc_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT positive_pdc_amount CHECK (amount > 0),
    CONSTRAINT valid_pdc_voucher_type CHECK (voucher_type IN ('received', 'issued')),
    CONSTRAINT valid_pdc_status CHECK (status IN ('pending', 'posted', 'returned', 'cancelled')),
    CONSTRAINT pdc_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL),
    CONSTRAINT pdc_return_requires_reason CHECK (status != 'returned' OR return_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pdc_doc_date ON tenant_master.pdc_vouchers(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_pdc_cheque_date ON tenant_master.pdc_vouchers(tenant_id, cheque_date);
CREATE INDEX IF NOT EXISTS idx_pdc_party ON tenant_master.pdc_vouchers(party_ledger_id);
CREATE INDEX IF NOT EXISTS idx_pdc_status ON tenant_master.pdc_vouchers(tenant_id, status);

DROP TRIGGER IF EXISTS trg_pdc_vouchers_updated_at ON tenant_master.pdc_vouchers;
CREATE TRIGGER trg_pdc_vouchers_updated_at BEFORE UPDATE ON tenant_master.pdc_vouchers
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_pdc_code;

-- FEATURE: "PDC Register" - every still-outstanding (not yet posted/
-- returned/cancelled) cheque, how many days until/since its due date -
-- the report a cashier actually needs: what's coming due.
CREATE OR REPLACE VIEW tenant_master.v_pdc_register AS
SELECT
    p.id, p.tenant_id, p.doc_no, p.voucher_type, p.cheque_no, p.cheque_date,
    p.bank_name, p.amount, p.status, p.party_name_snapshot,
    (CURRENT_DATE - p.cheque_date) AS days_since_cheque_date,
    CASE WHEN p.cheque_date >= CURRENT_DATE THEN 'Not Yet Due' ELSE 'Due' END AS due_status
FROM tenant_master.pdc_vouchers p
WHERE p.status = 'pending'
ORDER BY p.cheque_date;

ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation', 'purchase_nonsalable_return', 'stock_transfer',
        'debit_note', 'credit_note'
    ));

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('pdc', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('pdc', 'master', 'voucher_type', 'Received / Issued', 'select', TRUE, 2),
('pdc', 'master', 'party_ledger_id', 'Party', 'picker', TRUE, 3),
('pdc', 'master', 'cheque_no', 'Cheque No', 'text', TRUE, 4),
('pdc', 'master', 'cheque_date', 'Cheque Date', 'date', TRUE, 5),
('pdc', 'master', 'bank_name', 'Bank Name', 'text', FALSE, 6),
('pdc', 'master', 'bank_branch', 'Bank Branch', 'text', FALSE, 7),
('pdc', 'master', 'bank_account_no', 'Account No', 'text', FALSE, 8),
('pdc', 'master', 'beneficiary_name', 'Beneficiary Name', 'text', FALSE, 9),
('pdc', 'master', 'amount', 'Amount', 'number', TRUE, 10),
('pdc', 'master', 'is_online_pdc', 'Online PDC', 'boolean', FALSE, 11),
('pdc', 'master', 'ref_doc_no', 'Ref Doc No', 'text', FALSE, 12),
('pdc', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 13),
('pdc', 'master', 'narration', 'Narration', 'text', FALSE, 14)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
