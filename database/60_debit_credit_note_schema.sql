-- =============================================
-- DEBIT NOTE / CREDIT NOTE
-- Pure financial adjustments - a Debit Note reduces what we owe a
-- vendor (or increases what a customer owes us), a Credit Note is the
-- mirror. Deliberately NO product lines: both reference schemas
-- compared here converge independently on the same lean shape (a
-- party + a reference bill + straight ledger-allocation lines), unlike
-- Purchase/Non-saleable Return which carry real qty/product movement.
-- The distinction that matters: Return is for GOODS coming back
-- (inventory-affecting), DN/CN is for a purely FINANCIAL correction -
-- a rate dispute, an early-payment rebate, a TDS adjustment - that
-- never touches stock.
--
-- Both share the SAME bill-wise settlement machinery already built for
-- Bill/Return (a DN is 'dr' nature settling outstanding 'cr' vendor
-- bills, a CN is 'cr' nature settling outstanding 'dr' customer
-- references), so no new settlement engine is needed here.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.debit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    party_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    party_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),

    ref_doc_no VARCHAR(50),
    ref_doc_date DATE,
    reason VARCHAR(30) NOT NULL DEFAULT 'other',

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    priority VARCHAR(10) DEFAULT 'normal',

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
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_debit_note_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_dn_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_dn_reason CHECK (reason IN ('rate_correction', 'early_payment_rebate', 'quality_claim', 'tds_adjustment', 'other')),
    CONSTRAINT valid_dn_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT dn_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.debit_note_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    debit_note_id UUID NOT NULL REFERENCES tenant_master.debit_notes(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    amount DECIMAL(15, 2) NOT NULL,
    narration TEXT,
    ledger_name_snapshot VARCHAR(200),
    CONSTRAINT positive_dn_line_amount CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS tenant_master.credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    party_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    party_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),

    ref_doc_no VARCHAR(50),
    ref_doc_date DATE,
    reason VARCHAR(30) NOT NULL DEFAULT 'other',

    remarks_id UUID REFERENCES tenant_master.remarks_master(id),
    remarks_text TEXT,
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    priority VARCHAR(10) DEFAULT 'normal',

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
    total_amount DECIMAL(15, 2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_credit_note_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_cn_priority CHECK (priority IN ('low', 'normal', 'urgent')),
    CONSTRAINT valid_cn_reason CHECK (reason IN ('rate_correction', 'discount_given', 'quality_claim', 'goodwill', 'other')),
    CONSTRAINT valid_cn_status CHECK (status IN ('draft', 'posted', 'cancelled')),
    CONSTRAINT cn_cancellation_requires_reason CHECK (status != 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.credit_note_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    credit_note_id UUID NOT NULL REFERENCES tenant_master.credit_notes(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,
    ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    amount DECIMAL(15, 2) NOT NULL,
    narration TEXT,
    ledger_name_snapshot VARCHAR(200),
    CONSTRAINT positive_cn_line_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_dn_details_dn ON tenant_master.debit_note_details(debit_note_id);
CREATE INDEX IF NOT EXISTS idx_dn_doc_date ON tenant_master.debit_notes(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_dn_party ON tenant_master.debit_notes(party_ledger_id);
CREATE INDEX IF NOT EXISTS idx_dn_status ON tenant_master.debit_notes(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_cn_details_cn ON tenant_master.credit_note_details(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_cn_doc_date ON tenant_master.credit_notes(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_cn_party ON tenant_master.credit_notes(party_ledger_id);
CREATE INDEX IF NOT EXISTS idx_cn_status ON tenant_master.credit_notes(tenant_id, status);

DROP TRIGGER IF EXISTS trg_debit_notes_updated_at ON tenant_master.debit_notes;
CREATE TRIGGER trg_debit_notes_updated_at BEFORE UPDATE ON tenant_master.debit_notes
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
DROP TRIGGER IF EXISTS trg_credit_notes_updated_at ON tenant_master.credit_notes;
CREATE TRIGGER trg_credit_notes_updated_at BEFORE UPDATE ON tenant_master.credit_notes
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_debit_note_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_credit_note_code;

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
('debit_note', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('debit_note', 'master', 'party_ledger_id', 'Party (Vendor)', 'picker', TRUE, 2),
('debit_note', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('debit_note', 'master', 'ref_doc_no', 'Ref Bill No', 'text', FALSE, 4),
('debit_note', 'master', 'ref_doc_date', 'Ref Bill Date', 'date', FALSE, 5),
('debit_note', 'master', 'reason', 'Reason', 'select', TRUE, 6),
('debit_note', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 7),
('debit_note', 'master', 'narration', 'Narration', 'text', FALSE, 8),
('debit_note', 'detail', 'ledger_id', 'Ledger', 'picker', TRUE, 1),
('debit_note', 'detail', 'amount', 'Amount', 'number', TRUE, 2),
('debit_note', 'detail', 'narration', 'Narration', 'text', FALSE, 3),
('credit_note', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('credit_note', 'master', 'party_ledger_id', 'Party (Customer)', 'picker', TRUE, 2),
('credit_note', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('credit_note', 'master', 'ref_doc_no', 'Ref Bill No', 'text', FALSE, 4),
('credit_note', 'master', 'ref_doc_date', 'Ref Bill Date', 'date', FALSE, 5),
('credit_note', 'master', 'reason', 'Reason', 'select', TRUE, 6),
('credit_note', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 7),
('credit_note', 'master', 'narration', 'Narration', 'text', FALSE, 8),
('credit_note', 'detail', 'ledger_id', 'Ledger', 'picker', TRUE, 1),
('credit_note', 'detail', 'amount', 'Amount', 'number', TRUE, 2),
('credit_note', 'detail', 'narration', 'Narration', 'text', FALSE, 3)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
