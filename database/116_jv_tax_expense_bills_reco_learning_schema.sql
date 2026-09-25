-- =============================================
-- 1. JOURNAL VOUCHER as a taxable / non-taxable PURCHASE or SALES entry
--    tax_entry_type 'purchase' / 'sales' makes the JV a tax document: the
--    supplier / customer, their bill no / date and the taxable, non-taxable
--    and VAT amounts are kept here and the JV appears in the VAT purchase /
--    sales registers, VAT return and annex reports (is_capital marks a
--    capital-goods purchase).
-- 2. PURCHASE ADDITIONAL EXPENSE - one entry can carry several bills: each
--    line has its own party (supplier, or cash / labour ledger), bill type
--    (taxable bill, non-taxable bill, no bill - e.g. wages, loading /
--    unloading), bill no / date, VAT % and amount. allocation_basis 'none'
--    already keeps a line out of landed cost; vat_in_cost adds the VAT to
--    cost when it cannot be claimed. Taxable / non-taxable bills reach the
--    VAT purchase register; "no bill" lines never do.
-- 3. BANK RECONCILIATION LEARNING - words of bank descriptions confirmed
--    against a party / ledger, used by the matching engine next time.
-- =============================================
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS tax_entry_type VARCHAR(10) NOT NULL DEFAULT 'none';
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS party_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS party_name_snapshot VARCHAR(200);
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS party_pan VARCHAR(20);
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS party_bill_no VARCHAR(50);
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS party_bill_date DATE;
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS taxable_amount DECIMAL(15, 2) DEFAULT 0;
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS non_taxable_amount DECIMAL(15, 2) DEFAULT 0;
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS vat_percent DECIMAL(6, 3);
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(15, 2) DEFAULT 0;
ALTER TABLE tenant_master.journal_vouchers ADD COLUMN IF NOT EXISTS is_capital BOOLEAN DEFAULT FALSE;
ALTER TABLE tenant_master.journal_vouchers DROP CONSTRAINT IF EXISTS valid_jv_tax_entry_type;
ALTER TABLE tenant_master.journal_vouchers ADD CONSTRAINT valid_jv_tax_entry_type CHECK (tax_entry_type IN ('none', 'purchase', 'sales'));
ALTER TABLE tenant_master.journal_vouchers DROP CONSTRAINT IF EXISTS jv_tax_entry_needs_party;
ALTER TABLE tenant_master.journal_vouchers ADD CONSTRAINT jv_tax_entry_needs_party CHECK (tax_entry_type = 'none' OR status = 'draft' OR party_ledger_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_jv_tax_entry ON tenant_master.journal_vouchers(tenant_id, tax_entry_type, doc_date) WHERE tax_entry_type <> 'none';

ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS party_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS party_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS party_name_snapshot VARCHAR(200);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS party_pan VARCHAR(20);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS bill_type VARCHAR(12) NOT NULL DEFAULT 'no_bill';
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS party_bill_no VARCHAR(50);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS party_bill_date DATE;
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS vat_percent DECIMAL(6, 3);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS vat_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS vat_in_cost BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant_master.purchase_additional_expense_lines DROP CONSTRAINT IF EXISTS valid_expense_line_bill_type;
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD CONSTRAINT valid_expense_line_bill_type CHECK (bill_type IN ('taxable', 'non_taxable', 'no_bill'));
ALTER TABLE tenant_master.purchase_additional_expense_lines DROP CONSTRAINT IF EXISTS expense_line_vat_only_on_taxable;
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD CONSTRAINT expense_line_vat_only_on_taxable CHECK (bill_type = 'taxable' OR vat_amount = 0);
CREATE INDEX IF NOT EXISTS idx_expense_lines_party ON tenant_master.purchase_additional_expense_lines(party_ledger_id) WHERE party_ledger_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_master.bank_reco_learning (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    bank_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id) ON DELETE CASCADE,
    token VARCHAR(60) NOT NULL,
    ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id) ON DELETE CASCADE,
    hits INTEGER NOT NULL DEFAULT 1,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_bank_reco_learning UNIQUE (tenant_id, bank_ledger_id, token, ledger_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_reco_learning ON tenant_master.bank_reco_learning(tenant_id, bank_ledger_id);
