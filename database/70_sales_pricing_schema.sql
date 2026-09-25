-- =============================================
-- SALES PRICING - Rate Category + Discount Group/Company Matrix
-- "Customer ko rate category choose gare anusar rate aunu paryo,
-- discount category anusar discount aunu paryo, company wise discount
-- group wise dis set gareko xa vane tyo pani auto aunu paryo."
--
-- Closes the gap an earlier session's chart-of-accounts note explicitly
-- flagged: "discount_category_id ... omitted ... add them back once
-- those modules are actually built." Areas/Routes/Agents already exist
-- now (file 07); this is the last piece.
--
-- Two SEPARATE, independent axes:
--   - Rate Category: which of the product's own 5 sales-rate tiers
--     (SR1-5) a given customer sees - a simple lookup, no matrix
--     needed since the tiers already live on the product.
--   - Discount Group x Company matrix: a customer's Discount Group
--     combined with a product's own Company/Brand resolves to a
--     discount % - genuinely a 2-axis lookup, since the same customer
--     might get 5% off one brand and 2% off another.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.rate_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    sr_tier SMALLINT NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_rate_category_name UNIQUE (tenant_id, category_name),
    CONSTRAINT valid_sr_tier CHECK (sr_tier BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS tenant_master.discount_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_discount_group_name UNIQUE (tenant_id, group_name)
);

CREATE TABLE IF NOT EXISTS tenant_master.discount_matrix (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    discount_group_id UUID NOT NULL REFERENCES tenant_master.discount_groups(id) ON DELETE CASCADE,
    product_company_id UUID NOT NULL REFERENCES tenant_master.product_companies(id) ON DELETE CASCADE,
    discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_discount_matrix_cell UNIQUE (tenant_id, discount_group_id, product_company_id),
    CONSTRAINT valid_discount_matrix_percent CHECK (discount_percent >= 0 AND discount_percent <= 100)
);

ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS rate_category_id UUID REFERENCES tenant_master.rate_categories(id);
ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS discount_group_id UUID REFERENCES tenant_master.discount_groups(id);

CREATE INDEX IF NOT EXISTS idx_discount_matrix_lookup ON tenant_master.discount_matrix(discount_group_id, product_company_id);

DROP TRIGGER IF EXISTS trg_discount_matrix_updated_at ON tenant_master.discount_matrix;
CREATE TRIGGER trg_discount_matrix_updated_at BEFORE UPDATE ON tenant_master.discount_matrix
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
