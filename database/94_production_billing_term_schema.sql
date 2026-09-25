-- =============================================
-- PRODUCTION BILLING TERM
-- "Production Term Ko Accounting Effect Hunu Pardaina, Production
-- Costing Ra Production Report Ma Matrai" - a term marked for
-- Production must NEVER post to the ledger; it only adjusts the
-- costing math (raw material cost -> totalRmCost -> joint allocation
-- -> output_unit_cost) and is visible on Production Report exports.
-- Reuses the SAME shared billing_terms master Purchase already uses
-- (so an admin creating one term can tick Production alongside Sales/
-- Purchase), rather than building a separate master.
-- =============================================

ALTER TABLE tenant_master.billing_terms
    ADD COLUMN IF NOT EXISTS applicable_production_entry BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_master.billing_terms
    DROP CONSTRAINT IF EXISTS at_least_one_applicability;
ALTER TABLE tenant_master.billing_terms
    ADD CONSTRAINT at_least_one_applicability CHECK (applicable_sales_entry OR applicable_purchase_entry OR applicable_additional_expense OR applicable_production_entry);

-- Storage for per-line term selections is the SAME shared junction
-- table every other document already uses (document_line_billing_
-- terms) - "production" just needs to be added to its allowed
-- document_type values. No column is added to production_raw_
-- materials: billing_term_ids is a form-state-only array on each line,
-- exactly like every other document, synced into the junction table
-- on save and never stored on the line row itself.
ALTER TABLE tenant_master.document_line_billing_terms
    DROP CONSTRAINT IF EXISTS valid_line_billing_document_type;
ALTER TABLE tenant_master.document_line_billing_terms
    ADD CONSTRAINT valid_line_billing_document_type CHECK (document_type IN (
        'purchase_requisition', 'purchase_quotation', 'purchase_order', 'purchase_grn',
        'purchase_bill', 'purchase_additional_expense', 'purchase_return', 'purchase_nonsalable_return',
        'production'
    ));

CREATE INDEX IF NOT EXISTS idx_billing_terms_applicable_production ON tenant_master.billing_terms(tenant_id, applicable_production_entry) WHERE applicable_production_entry = TRUE;
