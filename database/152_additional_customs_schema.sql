-- =============================================
-- 152_additional_customs_schema.sql
-- Purchase Additional: Customs (Bhansar) tab - one row per customs
-- declaration (pragyapan patra) of an import: assessable value, the
-- VAT-able (taxable) and non-taxable values and the VAT paid at customs.
-- Posting: Dr VAT (import) / Cr the ledger that paid it (customs agent,
-- bank, cash, supplier ...). The Purchase VAT register lists each row as
-- an import purchase (taxable = import taxable).
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.purchase_additional_customs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    expense_id UUID NOT NULL REFERENCES tenant_master.purchase_additional_expenses(id) ON DELETE CASCADE,
    display_order INT NOT NULL DEFAULT 1,
    pragyapan_no VARCHAR(60),
    pragyapan_date DATE,
    customs_office VARCHAR(120),
    paid_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    paid_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    assessable_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
    taxable_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    non_taxable_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    vat_percent DECIMAL(6, 3),
    vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
    vat_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_additional_customs_expense ON tenant_master.purchase_additional_customs(expense_id);
CREATE INDEX IF NOT EXISTS idx_additional_customs_tenant ON tenant_master.purchase_additional_customs(tenant_id);
