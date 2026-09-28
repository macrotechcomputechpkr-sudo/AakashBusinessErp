-- =============================================
-- 137: temporary drafts, approval system, dual-UOM rate basis per product
--   entry_drafts                              - Save as Draft keeps the typed
--       entry here (per screen, company-wide): no number, no ledger / stock
--       effect, never in the module's own table. Finishing it saves the real
--       entry and deletes the draft.
--   system_control_settings.approval_modules  - documents that wait for an
--       approver after Save (only approving posts them); every other module
--       posts on Save
--   security_rights_groups.permissions.approvals = { <doc type>: true } - who
--       may approve (JSON, no column needed)
--   products.dual_rate_basis                  - Fixed Dual items: the rate is
--       per 'primary' or 'secondary' unit always, or 'any' (chosen per line)
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.entry_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_type VARCHAR(50) NOT NULL,
    label VARCHAR(200),
    party_name VARCHAR(200),
    amount NUMERIC(18, 2) DEFAULT 0,
    payload JSONB NOT NULL,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entry_drafts_type ON tenant_master.entry_drafts(tenant_id, voucher_type, updated_at DESC);
COMMENT ON TABLE tenant_master.entry_drafts IS 'Temporary drafts of transaction entries (Save as Draft) - kept out of the document tables';

-- held entries (the old Hold / Recall) become drafts
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'tenant_master' AND table_name = 'held_entries') THEN
    INSERT INTO tenant_master.entry_drafts (id, tenant_id, voucher_type, label, payload, created_by, updated_by, created_at, updated_at)
    SELECT h.id, h.tenant_id, h.voucher_type, h.label, h.payload, h.user_id, h.user_id, h.created_at, h.created_at
    FROM tenant_master.held_entries h
    WHERE NOT EXISTS (SELECT 1 FROM tenant_master.entry_drafts d WHERE d.id = h.id);
  END IF;
END $$;

ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS approval_modules TEXT[] DEFAULT ARRAY[]::TEXT[];
COMMENT ON COLUMN tenant_master.system_control_settings.approval_modules IS 'Document types that need approval before posting (others post on Save)';

ALTER TABLE tenant_master.products ADD COLUMN IF NOT EXISTS dual_rate_basis TEXT NOT NULL DEFAULT 'any';
DO $$ BEGIN
    ALTER TABLE tenant_master.products ADD CONSTRAINT products_dual_rate_basis_check CHECK (dual_rate_basis IN ('any', 'primary', 'secondary'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN tenant_master.products.dual_rate_basis IS 'Fixed Dual items: rate per primary / secondary unit always, or any (chosen per line)';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
