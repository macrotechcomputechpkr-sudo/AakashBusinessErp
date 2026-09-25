-- =============================================
-- 1. Billing name on a ledger (the name printed on bills / letters; used to
--    group Account Confirmation letters by billing name).
-- 2. document_templates - user-designed layouts: balance confirmation
--    letters and barcode labels (config JSON; one default per type).
-- 3. Interest on overdue customer bills: each posting run and its lines
--    (party, bill, from - to, days, principal, rate, interest). A bill's
--    interest is never charged twice for the same days - the next run
--    starts after the last to_date of non-cancelled runs.
-- 4. Bank guarantees register (issued by our bank for us, or received from
--    parties) with the LC / BG action history (extend, amend, close,
--    release, invoke, cancel).
-- 5. Fixed asset register and depreciation runs / entries: SLM or WDV per
--    asset, posted Dr depreciation expense / Cr accumulated depreciation (or
--    the asset ledger itself); disposal posts depreciation up to the sale
--    date and moves the book value to the disposal ledger.
-- =============================================
ALTER TABLE tenant_master.ledger_accounts ADD COLUMN IF NOT EXISTS billing_name VARCHAR(200);

CREATE TABLE IF NOT EXISTS tenant_master.document_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    template_type VARCHAR(30) NOT NULL,
    template_name VARCHAR(150) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT unique_document_template_name UNIQUE (tenant_id, template_type, template_name),
    CONSTRAINT valid_document_template_type CHECK (template_type IN ('confirmation_letter', 'barcode_label'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_document_template ON tenant_master.document_templates(tenant_id, template_type) WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS tenant_master.interest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    doc_no VARCHAR(30) NOT NULL,
    posting_date DATE NOT NULL,
    period_to DATE NOT NULL,
    interest_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    day_basis INTEGER NOT NULL DEFAULT 365,
    grace_days INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'posted',
    total_interest DECIMAL(15, 2) DEFAULT 0,
    party_count INTEGER DEFAULT 0,
    narration TEXT,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT unique_interest_run_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_interest_run_status CHECK (status IN ('posted', 'cancelled'))
);
CREATE TABLE IF NOT EXISTS tenant_master.interest_run_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES tenant_master.interest_runs(id) ON DELETE CASCADE,
    ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    source_type VARCHAR(30),
    source_id UUID,
    source_key VARCHAR(80) NOT NULL,          -- source_type:source_id, or opening:<ledger>
    doc_no VARCHAR(50),
    doc_date DATE,
    due_date DATE,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    days INTEGER NOT NULL,
    principal DECIMAL(15, 2) NOT NULL,
    rate DECIMAL(7, 3) NOT NULL,
    interest DECIMAL(15, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interest_lines_bill ON tenant_master.interest_run_lines(tenant_id, ledger_id, source_key);
CREATE INDEX IF NOT EXISTS idx_interest_lines_run ON tenant_master.interest_run_lines(run_id);

CREATE TABLE IF NOT EXISTS tenant_master.bank_guarantees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    bg_number VARCHAR(100) NOT NULL,
    direction VARCHAR(10) NOT NULL DEFAULT 'received',   -- received from a party / issued for us
    bg_type VARCHAR(20) NOT NULL DEFAULT 'performance',
    party_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    bank_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    bank_name VARCHAR(200),
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    margin_amount DECIMAL(15, 2) DEFAULT 0,
    commission_amount DECIMAL(15, 2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'NPR',
    issue_date DATE,
    expiry_date DATE,
    claim_expiry_date DATE,
    status VARCHAR(12) NOT NULL DEFAULT 'open',
    narration TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT unique_bg_number UNIQUE (tenant_id, bg_number),
    CONSTRAINT valid_bg_direction CHECK (direction IN ('received', 'issued')),
    CONSTRAINT valid_bg_type CHECK (bg_type IN ('performance', 'advance_payment', 'bid_bond', 'financial', 'customs', 'other')),
    CONSTRAINT valid_bg_status CHECK (status IN ('open', 'released', 'invoked', 'expired', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_bg_party ON tenant_master.bank_guarantees(tenant_id, party_ledger_id);
CREATE INDEX IF NOT EXISTS idx_bg_expiry ON tenant_master.bank_guarantees(tenant_id, status, expiry_date);
INSERT INTO tenant_master.bank_guarantees (tenant_id, bg_number, direction, party_ledger_id, bank_name, amount, issue_date, expiry_date, narration)
SELECT tenant_id, bg_number, 'received', id, bg_bank_name, COALESCE(bg_amount, 0), bg_issue_date, bg_expiry_date, 'Migrated from ledger master'
FROM tenant_master.ledger_accounts WHERE bg_number IS NOT NULL AND TRIM(bg_number) <> ''
ON CONFLICT (tenant_id, bg_number) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_lc_expiry ON tenant_master.letters_of_credit(tenant_id, status, expiry_date);

CREATE TABLE IF NOT EXISTS tenant_master.lc_bg_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    instrument VARCHAR(4) NOT NULL,
    instrument_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    action_date DATE NOT NULL DEFAULT CURRENT_DATE,
    old_values JSONB,
    new_values JSONB,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT valid_lc_bg_instrument CHECK (instrument IN ('lc', 'bg'))
);
CREATE INDEX IF NOT EXISTS idx_lc_bg_events ON tenant_master.lc_bg_events(tenant_id, instrument, instrument_id);

CREATE TABLE IF NOT EXISTS tenant_master.fixed_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    asset_code VARCHAR(50) NOT NULL,
    asset_name VARCHAR(200) NOT NULL,
    product_id UUID REFERENCES tenant_master.products(id),
    sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    asset_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    accumulated_dep_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    dep_expense_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    disposal_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    branch_id UUID REFERENCES tenant_master.branches(id),
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    location VARCHAR(150),
    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    purchase_bill_id UUID REFERENCES tenant_master.purchase_bills(id),
    purchase_date DATE,
    put_to_use_date DATE NOT NULL,
    cost DECIMAL(15, 2) NOT NULL,
    opening_accumulated_dep DECIMAL(15, 2) NOT NULL DEFAULT 0,  -- depreciation already charged before this system
    method VARCHAR(4) NOT NULL DEFAULT 'wdv',
    rate DECIMAL(7, 3) NOT NULL DEFAULT 0,                       -- % per year
    salvage_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tax_block VARCHAR(2),                                        -- Income Tax Act pool A-E
    depreciated_upto DATE,
    dep_charged_upto_at_start DATE,                              -- depreciated_upto when the asset was entered
    status VARCHAR(10) NOT NULL DEFAULT 'active',
    disposal_date DATE,
    disposal_amount DECIMAL(15, 2),
    disposal_sales_bill_id UUID REFERENCES tenant_master.sales_bills(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT unique_fixed_asset_code UNIQUE (tenant_id, asset_code),
    CONSTRAINT valid_fixed_asset_method CHECK (method IN ('slm', 'wdv')),
    CONSTRAINT valid_fixed_asset_status CHECK (status IN ('active', 'disposed', 'scrapped')),
    CONSTRAINT positive_fixed_asset_cost CHECK (cost > 0),
    CONSTRAINT valid_fixed_asset_tax_block CHECK (tax_block IS NULL OR tax_block IN ('A', 'B', 'C', 'D', 'E'))
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_product ON tenant_master.fixed_assets(tenant_id, product_id, status);

CREATE TABLE IF NOT EXISTS tenant_master.depreciation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    doc_no VARCHAR(30) NOT NULL,
    run_type VARCHAR(10) NOT NULL DEFAULT 'periodic',
    period_to DATE NOT NULL,
    posting_date DATE NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'posted',
    total_amount DECIMAL(15, 2) DEFAULT 0,
    asset_count INTEGER DEFAULT 0,
    narration TEXT,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT unique_depreciation_run_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_depreciation_run_type CHECK (run_type IN ('periodic', 'disposal')),
    CONSTRAINT valid_depreciation_run_status CHECK (status IN ('posted', 'cancelled'))
);
CREATE TABLE IF NOT EXISTS tenant_master.depreciation_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES tenant_master.depreciation_runs(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES tenant_master.fixed_assets(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    days INTEGER NOT NULL,
    opening_value DECIMAL(15, 2) NOT NULL,
    depreciation DECIMAL(15, 2) NOT NULL,
    closing_value DECIMAL(15, 2) NOT NULL,
    method VARCHAR(4) NOT NULL,
    rate DECIMAL(7, 3) NOT NULL,
    disposal_amount DECIMAL(15, 2),
    gain_loss DECIMAL(15, 2)
);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_asset ON tenant_master.depreciation_entries(tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_run ON tenant_master.depreciation_entries(run_id);
