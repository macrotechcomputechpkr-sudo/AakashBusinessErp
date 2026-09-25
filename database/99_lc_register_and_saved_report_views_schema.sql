-- =============================================
-- LC REGISTER + LC <-> PURCHASE BILL MAPPING
-- "Purchase Bill Save Garda if Tyo Vendor Ko Lc pending Xa Vane Tyo
-- Map Garne...Lc Mapping Garne Xuttai Option Pani Dine"
--
-- Until now an LC was just ONE set of lc_* columns on the vendor's
-- ledger - a vendor could only ever have a single LC and there was no
-- way to know how much of it had been used. This adds a proper
-- register (many LCs per vendor) and a mapping table recording which
-- purchase bills consumed how much of which LC. Remaining balance is
-- always lc_amount - SUM(mapped_amount), computed, never stored.
-- The legacy ledger columns are left untouched (still shown in the
-- Ledger master and Ledger Report) and are copied in once below.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.letters_of_credit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    lc_number VARCHAR(100) NOT NULL,
    vendor_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    bank_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    lc_bank_name VARCHAR(200),
    lc_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    margin_amount DECIMAL(15, 2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'NPR',
    issue_date DATE,
    expiry_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    narration TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT unique_lc_number_per_tenant UNIQUE (tenant_id, lc_number),
    CONSTRAINT valid_lc_status CHECK (status IN ('open', 'closed', 'cancelled')),
    CONSTRAINT non_negative_lc_amount CHECK (lc_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_lc_vendor ON tenant_master.letters_of_credit(tenant_id, vendor_ledger_id, status);

CREATE TABLE IF NOT EXISTS tenant_master.lc_bill_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    lc_id UUID NOT NULL REFERENCES tenant_master.letters_of_credit(id) ON DELETE CASCADE,
    purchase_bill_id UUID NOT NULL REFERENCES tenant_master.purchase_bills(id) ON DELETE CASCADE,
    mapped_amount DECIMAL(15, 2) NOT NULL,
    narration TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT unique_lc_bill_mapping UNIQUE (lc_id, purchase_bill_id),
    CONSTRAINT positive_lc_mapped_amount CHECK (mapped_amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_lc_mapping_bill ON tenant_master.lc_bill_mappings(purchase_bill_id);

-- One-time carry-over of the legacy single LC stored on each ledger.
INSERT INTO tenant_master.letters_of_credit (tenant_id, lc_number, vendor_ledger_id, lc_bank_name, lc_amount, issue_date, expiry_date, narration)
SELECT tenant_id, lc_number, id, lc_bank_name, COALESCE(lc_amount, 0), lc_issue_date, lc_expiry_date, 'Migrated from ledger master'
FROM tenant_master.ledger_accounts
WHERE lc_number IS NOT NULL AND TRIM(lc_number) <> ''
ON CONFLICT (tenant_id, lc_number) DO NOTHING;

-- =============================================
-- SAVED REPORT VIEWS
-- "Report Default Ra User Le Option Ra Filter Change Garera Save As
-- Garne Option Dine. Tyo Multiple Rakhna Pawos" - any report page
-- (identified by report_key) can store as many named configurations
-- (filters + options + grouping) as the person wants. The built-in
-- default of each report lives in the frontend and is never stored,
-- so it can never be lost or broken by a bad save.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.saved_report_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    report_key VARCHAR(60) NOT NULL,
    view_name VARCHAR(150) NOT NULL,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_shared BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_saved_view_name UNIQUE (tenant_id, user_id, report_key, view_name)
);
CREATE INDEX IF NOT EXISTS idx_saved_views_lookup ON tenant_master.saved_report_views(tenant_id, report_key);
