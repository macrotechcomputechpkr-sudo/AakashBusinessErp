-- =============================================
-- TRANSPORT MASTER
-- Completes the "Transporter" picker field already referenced in
-- voucher_field_catalog for Sales Delivery and Purchase GRN
-- (19_entry_field_control_schema.sql) - that catalog only DEFINED the
-- field existed, this is the actual master it should pick from.
--
-- Each transport entry can link to a Vendor Ledger AND/OR a Sub-Ledger -
-- both may be set at once (not an either/or choice), since a
-- transporter might have its own direct Vendor account while ALSO being
-- tracked as a Sub-Ledger under a shared control account. At least one
-- of the two must be set.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.transport_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    transport_code VARCHAR(50) NOT NULL,
    transport_name VARCHAR(200) NOT NULL,
    short_name VARCHAR(50),

    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),

    contact_person VARCHAR(150),
    phone VARCHAR(20),
    email VARCHAR(150),
    address TEXT,

    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_transport_code_per_tenant UNIQUE (tenant_id, transport_code),
    CONSTRAINT unique_transport_name_per_tenant UNIQUE (tenant_id, transport_name),
    -- FEATURE: Ledger and Sub-Ledger can BOTH be chosen at once - only
    -- rule is at least one of the two must be set.
    CONSTRAINT at_least_one_link CHECK (vendor_ledger_id IS NOT NULL OR sub_ledger_id IS NOT NULL)
);

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_transport_code;
CREATE OR REPLACE FUNCTION tenant_master.next_transport_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_transport_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'TRN')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_transport_vendor ON tenant_master.transport_master(vendor_ledger_id) WHERE vendor_ledger_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transport_sub_ledger ON tenant_master.transport_master(sub_ledger_id) WHERE sub_ledger_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_transport_master_updated_at ON tenant_master.transport_master;
CREATE TRIGGER trg_transport_master_updated_at BEFORE UPDATE ON tenant_master.transport_master
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
