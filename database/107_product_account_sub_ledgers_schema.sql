-- =============================================
-- PRODUCT-LEVEL ACCOUNT SUB-LEDGERS
-- A product's Sales Account / Purchase Account can now carry a sub-ledger
-- of that account. Posting priority for each line of a Sales/Purchase
-- document: Product account (+ its sub-ledger) -> the document's account
-- (+ its sub-ledger) -> System Control default.
-- =============================================
ALTER TABLE tenant_master.products ADD COLUMN IF NOT EXISTS sales_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.products ADD COLUMN IF NOT EXISTS purchase_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
