-- =============================================
-- REPORTING PERFORMANCE - INDEXES + VIEWS
-- "database stays continuous, doesn't break year-wise" - as years of
-- transactions accumulate in the SAME tables, both (a) indexes on the
-- columns every report filters/sorts by, and (b) views that encapsulate
-- the common report JOIN pattern once, are what keep queries fast -
-- neither exists yet for Purchase Requisition.
-- =============================================

-- (a) Indexes - every report filters by date range and/or fiscal year,
-- and tenant_id is already implicitly filtered on every query; without
-- these, each report query degrades to a full table scan as years of
-- data accumulate.
CREATE INDEX IF NOT EXISTS idx_purchase_req_doc_date ON tenant_master.purchase_requisitions(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_purchase_req_fiscal_year ON tenant_master.purchase_requisitions(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_purchase_req_vendor ON tenant_master.purchase_requisitions(vendor_ledger_id) WHERE vendor_ledger_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_req_status ON tenant_master.purchase_requisitions(tenant_id, status);

-- (b) Views - pre-joined, using the historical NAME SNAPSHOTS (not a
-- live join to the master) so a report always matches what the printed
-- document said, and reads are a single indexed scan instead of a
-- multi-table join repeated on every report run.
CREATE OR REPLACE VIEW tenant_master.v_purchase_requisition_summary AS
SELECT
    pr.id, pr.tenant_id, pr.doc_no, pr.doc_date, pr.fiscal_year_id, pr.status, pr.priority,
    pr.vendor_ledger_id, COALESCE(pr.vendor_name_snapshot, pr.cash_vendor_name) AS vendor_name,
    pr.warehouse_id, pr.warehouse_name_snapshot AS warehouse_name,
    pr.branch_id, pr.branch_name_snapshot AS branch_name,
    pr.invoice_type, pr.total_amount, pr.created_at
FROM tenant_master.purchase_requisitions pr;

-- FEATURE: taxation report base - one row per Detail line with its
-- share of every applied Billing Term (VAT, Excise, etc. - whatever's
-- been mapped), so a VAT/tax annexure-style report can sum straight
-- from this view instead of re-deriving the join and the per-line term
-- calculation every time it runs.
CREATE OR REPLACE VIEW tenant_master.v_purchase_line_tax_summary AS
SELECT
    prd.id AS detail_id, pr.id AS document_id, pr.tenant_id, pr.doc_no, pr.doc_date, pr.fiscal_year_id,
    COALESCE(pr.vendor_name_snapshot, pr.cash_vendor_name) AS vendor_name,
    COALESCE(prd.product_name_snapshot, p.product_name) AS product_name,
    prd.qty, prd.rate, prd.amount AS line_amount,
    prd.discount_percent, prd.discount_amount, prd.tax_percent, prd.tax_amount,
    dlbt.billing_term_id, bt.term_name, bt.term_code, dlbt.computed_amount AS term_amount
FROM tenant_master.purchase_requisition_details prd
JOIN tenant_master.purchase_requisitions pr ON pr.id = prd.requisition_id
LEFT JOIN tenant_master.products p ON p.id = prd.product_id
LEFT JOIN tenant_master.document_line_billing_terms dlbt ON dlbt.detail_id = prd.id AND dlbt.document_type = 'purchase_requisition'
LEFT JOIN tenant_master.billing_terms bt ON bt.id = dlbt.billing_term_id;
