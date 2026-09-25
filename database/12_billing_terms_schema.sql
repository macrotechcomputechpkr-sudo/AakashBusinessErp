-- =============================================
-- BILLING TERMS
-- Completes the placeholder referenced by product_groups.billing_term_id
-- (added in 09_product_group_company_schema.sql as a plain UUID column
-- with no FK, since this table didn't exist yet). Wires the real FK now.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.billing_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    term_code VARCHAR(50) NOT NULL,
    term_name VARCHAR(150) NOT NULL,

    -- What this term actually governs.
    term_type VARCHAR(20) NOT NULL DEFAULT 'discount',

    discount_percentage DECIMAL(5, 2) DEFAULT 0,
    credit_days INTEGER DEFAULT 0,

    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_billing_term_code_per_tenant UNIQUE (tenant_id, term_code),
    CONSTRAINT unique_billing_term_name_per_tenant UNIQUE (tenant_id, term_name),
    CONSTRAINT valid_billing_term_type CHECK (term_type IN ('discount', 'credit', 'payment'))
);

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_billing_term_code;
CREATE OR REPLACE FUNCTION tenant_master.next_billing_term_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_billing_term_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'BT')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_billing_terms_tenant ON tenant_master.billing_terms(tenant_id);

DROP TRIGGER IF EXISTS trg_billing_terms_updated_at ON tenant_master.billing_terms;
CREATE TRIGGER trg_billing_terms_updated_at BEFORE UPDATE ON tenant_master.billing_terms
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- FIX: wire the real FK now that billing_terms exists (product_groups
-- previously stored this as a bare UUID with no FK, since the table
-- didn't exist yet when that column was added).
ALTER TABLE tenant_master.product_groups
    ADD CONSTRAINT fk_product_groups_billing_term
    FOREIGN KEY (billing_term_id) REFERENCES tenant_master.billing_terms(id);
