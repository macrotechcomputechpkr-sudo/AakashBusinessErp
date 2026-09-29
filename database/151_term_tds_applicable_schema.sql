-- =============================================
-- 151: billing_terms.tds_applicable - the term's amount is subject to TDS
--   (e.g. freight / transport). On a Purchase Additional bill, "Add TDS"
--   works out one TDS line per party paid, on the amounts of its
--   TDS-applicable terms (all taxable service lines of that party when no
--   term is marked).
-- =============================================
ALTER TABLE tenant_master.billing_terms ADD COLUMN IF NOT EXISTS tds_applicable boolean NOT NULL DEFAULT false;
