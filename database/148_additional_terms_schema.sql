-- =============================================
-- 148: billing terms for additional bills
--   billing_terms
--     applicable_sales_additional  - the term is used on a Sales Additional
--                                    entry ("Term used for": transaction
--                                    terms = Sales / Purchase / Production
--                                    Entry; additional terms = Purchase /
--                                    Sales Additional)
--     include_in_costing           - the term's amount goes into the cost of
--                                    the goods (landed cost); off = expense
--                                    only (include_in_profitability already
--                                    decides the profitability reports)
--   purchase_additional_expense_lines (routes/purchaseAdditionalExpenseRoutes.js)
--     billing_term_id        - the term of the line; its ledger is the line
--                              ledger (fixed), its sub-ledger the default
--     expense_sub_ledger_id  - sub-ledger of the term ledger (changeable)
--     target_detail_id       - product-wise term: the Order / GRN / Bill
--                              line whose product carries the whole amount;
--                              empty = bill-wise, split over the products
--                              by the line's basis (value / qty / equal)
--     include_in_profitability - copied from the term
-- =============================================
ALTER TABLE tenant_master.billing_terms
    ADD COLUMN IF NOT EXISTS applicable_sales_additional boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS include_in_costing boolean NOT NULL DEFAULT true;

ALTER TABLE tenant_master.purchase_additional_expense_lines
    ADD COLUMN IF NOT EXISTS billing_term_id uuid REFERENCES tenant_master.billing_terms(id),
    ADD COLUMN IF NOT EXISTS expense_sub_ledger_id uuid REFERENCES tenant_master.sub_ledgers(id),
    ADD COLUMN IF NOT EXISTS target_detail_id uuid,
    ADD COLUMN IF NOT EXISTS include_in_profitability boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pael_billing_term ON tenant_master.purchase_additional_expense_lines(billing_term_id);
