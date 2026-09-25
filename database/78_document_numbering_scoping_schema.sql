-- =============================================
-- DOCUMENT NUMBERING - USER/BRANCH SCOPING
-- "login User, Branch maa jun jun DocumentNumbering set gareko xa tyo
-- list show garne" - today every active category for a voucher_type is
-- available to everyone with no restriction. This adds an explicit
-- assignment: a category with NO rows here stays globally available
-- (fully backward compatible with every category already configured);
-- a category WITH rows here is restricted to only those branches/users,
-- and a transaction entry screen lists exactly the ones that apply to
-- the CURRENT logged-in user (their own user_id, OR their branch_id,
-- OR a category with no restriction at all).
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.document_numbering_category_scopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    category_id UUID NOT NULL REFERENCES tenant_master.document_numbering_categories(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES tenant_master.branches(id),
    user_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT numbering_scope_branch_or_user CHECK (
        (branch_id IS NOT NULL AND user_id IS NULL) OR (branch_id IS NULL AND user_id IS NOT NULL)
    ),
    CONSTRAINT unique_numbering_scope_branch UNIQUE (category_id, branch_id),
    CONSTRAINT unique_numbering_scope_user UNIQUE (category_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_numbering_scopes_category ON tenant_master.document_numbering_category_scopes(category_id);
CREATE INDEX IF NOT EXISTS idx_numbering_scopes_branch ON tenant_master.document_numbering_category_scopes(branch_id);
CREATE INDEX IF NOT EXISTS idx_numbering_scopes_user ON tenant_master.document_numbering_category_scopes(user_id);
