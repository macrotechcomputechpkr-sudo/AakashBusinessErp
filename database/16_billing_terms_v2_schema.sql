-- =============================================
-- BILLING TERMS v2 - full calculation engine
-- Builds on the basic stub in 12_billing_terms_schema.sql (kept: id,
-- term_code, term_name, description, is_active, display_order, the
-- FK already wired to product_groups.billing_term_id). Replaces the
-- overly-narrow term_type ('discount'/'credit'/'payment') with a richer
-- model informed by how established ERPs handle this:
--   - SAP SD Pricing Procedure: ordered condition types, each able to
--     calculate "from" a previous step's result, not just the raw base
--     price (our base_reference / base_reference_term_id).
--   - Odoo Pricelist rules: three clean computation modes - Fixed Price /
--     Discount(%) / Formula - plus rounding and an extra fixed fee
--     layered on top (our calculation_mode, rounding_method).
--   - The reference screenshots' own fields: Category (General/
--     Additional/RoundedOff), taxation Term Type (VAT/Excise/Service
--     Tax/TSC/Cash Discount), Billing/Return/Expiry Return/Sub Ledger,
--     Basis (Value/Quantity), Sign, Manual Override, Suppress If Zero,
--     Include In Profitability, Enabled.
-- The genuinely new piece beyond all of the above: calculation_mode =
-- 'formula' lets a user type their own safe arithmetic expression
-- (see server/utils/formulaEvaluator.js) referencing {basic_amount},
-- {quantity}, {rate}, and {term:OTHER_CODE} - not just a flat % or
-- fixed amount, and not routine/code-based like SAP's ABAP formulas.
-- =============================================

ALTER TABLE tenant_master.billing_terms
    DROP CONSTRAINT IF EXISTS valid_billing_term_type;
ALTER TABLE tenant_master.billing_terms
    DROP COLUMN IF EXISTS term_type;

ALTER TABLE tenant_master.billing_terms
    ADD COLUMN IF NOT EXISTS term_category VARCHAR(20) DEFAULT 'general',
    ADD COLUMN IF NOT EXISTS tax_type VARCHAR(20) DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS calculation_mode VARCHAR(20) DEFAULT 'percentage',
    ADD COLUMN IF NOT EXISTS basis VARCHAR(20) DEFAULT 'value',
    ADD COLUMN IF NOT EXISTS base_reference VARCHAR(20) DEFAULT 'basic_amount',
    ADD COLUMN IF NOT EXISTS base_reference_term_id UUID REFERENCES tenant_master.billing_terms(id),
    ADD COLUMN IF NOT EXISTS fixed_amount DECIMAL(15, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rate_percentage DECIMAL(10, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS maximum_amount DECIMAL(15, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS formula_expression TEXT,
    ADD COLUMN IF NOT EXISTS sign VARCHAR(1) DEFAULT '+',
    ADD COLUMN IF NOT EXISTS rounding_method VARCHAR(20) DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS rounding_precision DECIMAL(10, 4) DEFAULT 1,
    ADD COLUMN IF NOT EXISTS billing_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS return_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS expiry_return_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS sub_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS manual_override BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS suppress_if_zero BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS include_in_profitability BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS product_wise BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS allow_summary BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS applicable_sales_entry BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS applicable_purchase_entry BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS applicable_additional_expense BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS show_product_term_summary BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(20) DEFAULT 'primary',
    ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS grace_days INTEGER DEFAULT 0;

ALTER TABLE tenant_master.billing_terms
    ADD CONSTRAINT valid_term_category CHECK (term_category IN ('general', 'additional', 'rounded_off')),
    ADD CONSTRAINT valid_tax_type CHECK (tax_type IN ('none', 'vat', 'discount', 'excise', 'service_tax', 'tsc', 'cash_discount', 'custom')),
    ADD CONSTRAINT valid_calculation_mode CHECK (calculation_mode IN ('fixed_amount', 'percentage', 'both', 'formula', 'free_quantity')),
    ADD CONSTRAINT valid_basis CHECK (basis IN ('value', 'quantity')),
    ADD CONSTRAINT valid_base_reference CHECK (base_reference IN ('basic_amount', 'running_total', 'specific_term')),
    ADD CONSTRAINT valid_sign CHECK (sign IN ('+', '-')),
    ADD CONSTRAINT valid_rounding_method CHECK (rounding_method IN ('none', 'nearest', 'up', 'down')),
    ADD CONSTRAINT valid_quantity_unit CHECK (quantity_unit IN ('primary', 'secondary')),
    -- A formula-mode term must actually have a formula; a
    -- specific-term base reference must actually name which term.
    ADD CONSTRAINT formula_requires_expression CHECK (calculation_mode != 'formula' OR formula_expression IS NOT NULL),
    ADD CONSTRAINT specific_term_requires_reference CHECK (base_reference != 'specific_term' OR base_reference_term_id IS NOT NULL),
    -- A term that applies nowhere doesn't make sense - at least one
    -- context (Sales Entry / Purchase Entry / Additional Expense) must
    -- be selected.
    ADD CONSTRAINT at_least_one_applicability CHECK (applicable_sales_entry OR applicable_purchase_entry OR applicable_additional_expense);

CREATE INDEX IF NOT EXISTS idx_billing_terms_category ON tenant_master.billing_terms(tenant_id, term_category);
CREATE INDEX IF NOT EXISTS idx_billing_terms_display_order ON tenant_master.billing_terms(tenant_id, display_order);
