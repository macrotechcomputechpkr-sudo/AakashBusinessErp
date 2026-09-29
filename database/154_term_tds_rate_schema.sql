-- =============================================
-- 154_term_tds_rate_schema.sql
-- TDS rate per billing term (empty = System Control default TDS %) and the
-- TDS % / TDS base kept on Purchase Additional lines, so the TDS lines are
-- worked out by themselves (per party and rate) while the entry is typed.
-- =============================================
ALTER TABLE tenant_master.billing_terms ADD COLUMN IF NOT EXISTS tds_percent NUMERIC(6,3);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS tds_percent NUMERIC(6,3);
ALTER TABLE tenant_master.purchase_additional_expense_lines ADD COLUMN IF NOT EXISTS tds_base NUMERIC(18,2);
ALTER TABLE tenant_master.purchase_additional_expenses ADD COLUMN IF NOT EXISTS auto_tds BOOLEAN NOT NULL DEFAULT TRUE;
