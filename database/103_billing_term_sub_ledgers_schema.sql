-- =============================================
-- BILLING TERM SUB-LEDGERS
-- 1. billing_terms.sub_ledger_id pointed at ledger_accounts, so the
--    master's "Sub-Ledger" was really a second ledger. Re-point it to
--    the real sub_ledgers table (sub-ledger of the Billing Ledger) and
--    add return_sub_ledger_id (sub-ledger of the Return Ledger).
-- 2. Each transaction may override the sub-ledger per term:
--    document_billing_terms / document_line_billing_terms.sub_ledger_id.
-- 3. GL lines carry the sub-ledger, so term/VAT postings reach it.
-- Safe to run: no live data yet; any value that is not a real
-- sub-ledger id is cleared before the new FK is added.
-- =============================================

ALTER TABLE tenant_master.billing_terms DROP CONSTRAINT IF EXISTS billing_terms_sub_ledger_id_fkey;
UPDATE tenant_master.billing_terms SET sub_ledger_id = NULL
WHERE sub_ledger_id IS NOT NULL AND sub_ledger_id NOT IN (SELECT id FROM tenant_master.sub_ledgers);
ALTER TABLE tenant_master.billing_terms
    ADD CONSTRAINT billing_terms_sub_ledger_id_fkey FOREIGN KEY (sub_ledger_id) REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.billing_terms
    ADD COLUMN IF NOT EXISTS return_sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);

ALTER TABLE tenant_master.document_billing_terms
    ADD COLUMN IF NOT EXISTS sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
ALTER TABLE tenant_master.document_line_billing_terms
    ADD COLUMN IF NOT EXISTS sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);

ALTER TABLE tenant_master.ledger_transaction_lines
    ADD COLUMN IF NOT EXISTS sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_sub_ledger ON tenant_master.ledger_transaction_lines(sub_ledger_id) WHERE sub_ledger_id IS NOT NULL;
