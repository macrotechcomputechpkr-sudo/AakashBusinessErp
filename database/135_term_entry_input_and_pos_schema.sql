-- =============================================
-- 135: how billing terms are typed in entries, and amount-based lines
--   billing_terms.entry_input_mode       - what may be typed for the term in
--                                          a transaction line: percent, rate
--                                          (x qty), amount, all, rate_percent,
--                                          rate_percent_amount, rate_amount
--   billing_terms.show_in_term_summary   - the term shows in the entry's
--                                          Charges Summary (overall terms)
--   (billing_terms.manual_override off   - the term cannot be changed in
--                                          entries; it keeps its own value or
--                                          the product's Term Mapping value)
--   product_term_mappings.override_basis - the product's value is a percent,
--                                          a rate per quantity or an amount
--   document_line_billing_terms.input_kind / input_value - what was typed
--                                          for a charge on a purchase line
--   system_control_settings.product_term_transactions - the entries that
--                                          show item charges; the others show
--                                          only the Charges Summary (product
--                                          values are still worked out)
--   products.qty_from_amount_sales / _purchase - typing a line amount works
--                                          the quantity out from the rate
--                                          (else the rate from the quantity)
-- =============================================
ALTER TABLE billing_terms ADD COLUMN IF NOT EXISTS entry_input_mode TEXT NOT NULL DEFAULT 'all';
DO $$ BEGIN
    ALTER TABLE billing_terms ADD CONSTRAINT billing_terms_entry_input_mode_check
        CHECK (entry_input_mode IN ('percent', 'rate', 'amount', 'all', 'rate_percent', 'rate_percent_amount', 'rate_amount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE billing_terms ADD COLUMN IF NOT EXISTS show_in_term_summary BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN billing_terms.entry_input_mode IS 'Typed in entry as: percent / rate (x qty) / amount / all / rate_percent / rate_percent_amount / rate_amount';
COMMENT ON COLUMN billing_terms.show_in_term_summary IS 'Shown in the entry Charges Summary (overall terms)';

ALTER TABLE product_term_mappings ADD COLUMN IF NOT EXISTS override_basis TEXT NOT NULL DEFAULT 'percent';
DO $$ BEGIN
    ALTER TABLE product_term_mappings ADD CONSTRAINT product_term_mappings_override_basis_check
        CHECK (override_basis IN ('percent', 'rate', 'amount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE document_line_billing_terms ADD COLUMN IF NOT EXISTS input_kind TEXT;
ALTER TABLE document_line_billing_terms ADD COLUMN IF NOT EXISTS input_value NUMERIC(18, 4);
DO $$ BEGIN
    ALTER TABLE document_line_billing_terms ADD CONSTRAINT document_line_billing_terms_input_kind_check
        CHECK (input_kind IS NULL OR input_kind IN ('pct', 'rate', 'amt'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE system_control_settings ADD COLUMN IF NOT EXISTS product_term_transactions TEXT[] DEFAULT ARRAY[
    'sales_quotation', 'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_nonsaleable_return',
    'purchase_requisition', 'purchase_quotation', 'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_nonsaleable_return'
]::TEXT[];
COMMENT ON COLUMN system_control_settings.product_term_transactions IS 'Entries that show item charges (product-wise terms); others show only the Charges Summary';

ALTER TABLE products ADD COLUMN IF NOT EXISTS qty_from_amount_sales BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS qty_from_amount_purchase BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN products.qty_from_amount_sales IS 'Sales: an amount typed on the line works out the quantity (amount / rate)';
COMMENT ON COLUMN products.qty_from_amount_purchase IS 'Purchase: an amount typed on the line works out the quantity (amount / rate)';
