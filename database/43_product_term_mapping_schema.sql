-- =============================================
-- PRODUCT TERM MAPPING
-- Own concept (not copied from any reference) - lets a specific
-- Product declare which Billing Terms apply to it BY DEFAULT for Sales
-- and for Purchase, optionally overriding that term's usual rate for
-- just this product (e.g. a product with a special VAT treatment).
-- When this product is added to a transaction line, its mapped terms
-- pre-select automatically in that line's own "Product Term" popup.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.product_term_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    category_type VARCHAR(10) NOT NULL,
    billing_term_id UUID NOT NULL REFERENCES tenant_master.billing_terms(id),

    is_enabled_by_default BOOLEAN DEFAULT TRUE,
    override_percentage DECIMAL(8, 4),

    CONSTRAINT unique_product_term_mapping UNIQUE (product_id, category_type, billing_term_id),
    CONSTRAINT valid_mapping_category_type CHECK (category_type IN ('sales', 'purchase'))
);

CREATE INDEX IF NOT EXISTS idx_product_term_mappings_product ON tenant_master.product_term_mappings(product_id, category_type);
