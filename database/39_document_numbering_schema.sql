-- =============================================
-- DOCUMENT NUMBERING CONFIGURATION
-- "requisition number nai xina ta base ta tei ho" - the document number
-- itself was never configurable; this is that missing base layer,
-- reusable by every document type in the purchase (and later sales)
-- chain, not just Purchase Requisition.
--
-- A tenant can define MULTIPLE named categories per voucher_type (e.g.
-- "Standard" vs "Branch-B Special Series"), each with its own Manual/
-- Auto mode, Branch-wise/User-wise/Global scope, and format (Prefix,
-- Suffix, Digit count, Start/End number, whether to fold in the
-- Fiscal Year). One category is marked the default for its voucher
-- type; the document entry screen can still let a user pick a
-- different one if more than one exists.
--
-- Scoping needs its own counter TABLE (not a single Postgres SEQUENCE)
-- since "branch-wise" or "user-wise" means genuinely SEPARATE running
-- counters per branch/user, decided at runtime - a plain sequence can't
-- be parameterized that way. Atomicity comes from SELECT ... FOR UPDATE
-- inside a transaction in the generating function, the same
-- correctness guarantee the fixed Postgres sequences give elsewhere.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.document_numbering_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    voucher_type VARCHAR(30) NOT NULL,
    category_name VARCHAR(100) NOT NULL,

    numbering_mode VARCHAR(10) NOT NULL DEFAULT 'auto',
    scope VARCHAR(15) NOT NULL DEFAULT 'global',

    prefix VARCHAR(20) DEFAULT '',
    suffix VARCHAR(20) DEFAULT '',
    digit_count INTEGER NOT NULL DEFAULT 6,
    start_number INTEGER NOT NULL DEFAULT 1,
    end_number INTEGER,

    include_fiscal_year BOOLEAN DEFAULT TRUE,
    fy_digit_format VARCHAR(10) NOT NULL DEFAULT 'short',

    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_numbering_category_name UNIQUE (tenant_id, voucher_type, category_name),
    CONSTRAINT valid_numbering_mode CHECK (numbering_mode IN ('manual', 'auto')),
    CONSTRAINT valid_numbering_scope CHECK (scope IN ('global', 'branch_wise', 'user_wise')),
    CONSTRAINT valid_fy_digit_format CHECK (fy_digit_format IN ('short', 'full')),
    CONSTRAINT positive_digit_count CHECK (digit_count BETWEEN 1 AND 12),
    CONSTRAINT valid_number_range CHECK (end_number IS NULL OR end_number >= start_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_numbering_per_voucher
    ON tenant_master.document_numbering_categories(tenant_id, voucher_type)
    WHERE is_default = TRUE;

-- The running counter itself - one row per (category, branch/user
-- combination the scope actually uses). branch_id/user_id stay NULL
-- for a 'global'-scope category, since there's only ever one counter.
CREATE TABLE IF NOT EXISTS tenant_master.document_numbering_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    category_id UUID NOT NULL REFERENCES tenant_master.document_numbering_categories(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES tenant_master.branches(id),
    user_id UUID,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),
    current_number INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT unique_counter_scope UNIQUE (category_id, branch_id, user_id, fiscal_year_id)
);

-- FEATURE: atomic "get me the next number" - locks the specific counter
-- row (creating it at start_number - 1 if it doesn't exist yet) so two
-- concurrent document creations can never receive the same number, the
-- same correctness guarantee as every nextval()-based code elsewhere in
-- this system, just table-based since the scope is dynamic.
CREATE OR REPLACE FUNCTION tenant_master.next_document_number(
    p_tenant_id UUID, p_category_id UUID, p_branch_id UUID, p_user_id UUID, p_fiscal_year_id UUID
) RETURNS INTEGER AS $$
DECLARE
    v_current INTEGER;
    v_start INTEGER;
    v_end INTEGER;
BEGIN
    SELECT start_number, end_number INTO v_start, v_end
    FROM tenant_master.document_numbering_categories WHERE id = p_category_id;

    INSERT INTO tenant_master.document_numbering_counters (tenant_id, category_id, branch_id, user_id, fiscal_year_id, current_number)
    VALUES (p_tenant_id, p_category_id, p_branch_id, p_user_id, p_fiscal_year_id, v_start - 1)
    ON CONFLICT (category_id, branch_id, user_id, fiscal_year_id) DO NOTHING;

    UPDATE tenant_master.document_numbering_counters
    SET current_number = current_number + 1
    WHERE category_id = p_category_id
        AND branch_id IS NOT DISTINCT FROM p_branch_id
        AND user_id IS NOT DISTINCT FROM p_user_id
        AND fiscal_year_id IS NOT DISTINCT FROM p_fiscal_year_id
    RETURNING current_number INTO v_current;

    IF v_end IS NOT NULL AND v_current > v_end THEN
        RAISE EXCEPTION 'Document numbering range exhausted for this category (max %)', v_end;
    END IF;

    RETURN v_current;
END; $$ LANGUAGE plpgsql;
