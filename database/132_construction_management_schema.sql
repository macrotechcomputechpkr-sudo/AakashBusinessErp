-- =============================================
-- 132: CONSTRUCTION MANAGEMENT (Business Nature = Construction)
-- Contract sites (thekka): the company's own contracts with a client, and
-- sub-contracts (petti thekka) it takes from a main contractor. Per site:
--   BOQ / contract items, running (RA) bills to the client, material issued
--   (from store or straight from a purchase bill), labour wage sheets,
--   sub-contracts it gives out (petti thekka diyeko) and their bills, and
--   any other cost booked with the site's cost center.
-- Each site gets its own Cost Center, so every voucher with that cost center
-- counts in the site's profit / loss.
-- Posting (ledger_transaction_batches):
--   RA bill        Dr client (gross + VAT - retention - TDS), Dr retention receivable,
--                  Dr TDS receivable, Cr contract revenue, Cr VAT
--   sub-con bill   Dr sub-contract cost, Dr VAT, Cr sub-contractor (gross + VAT -
--                  retention - TDS), Cr retention payable, Cr TDS payable
--   wage sheet     Dr wages, Cr the pay / wages-payable ledger chosen on the sheet
--   material issue Stock Adjustment (consumption) with the site cost center
-- Re-run safe. Nothing existing is removed.
-- =============================================

ALTER TABLE tenant_master.system_control_settings DROP CONSTRAINT IF EXISTS valid_business_nature;
ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_business_nature
    CHECK (business_nature IN ('trading', 'manufacturing', 'distribution', 'retail', 'service', 'poultry', 'construction'));

CREATE TABLE IF NOT EXISTS tenant_master.construction_settings (
    tenant_id UUID PRIMARY KEY,
    revenue_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    retention_receivable_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    tds_receivable_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    subcontract_cost_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    retention_payable_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    tds_payable_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    wages_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    wages_payable_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    material_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    default_warehouse_id UUID,
    default_vat_percent DECIMAL(5, 2) NOT NULL DEFAULT 13,
    default_retention_percent DECIMAL(5, 2) NOT NULL DEFAULT 5,
    default_tds_percent DECIMAL(5, 2) NOT NULL DEFAULT 1.5,
    updated_by UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_master.construction_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_code VARCHAR(30) NOT NULL,
    site_name VARCHAR(200) NOT NULL,
    contract_type VARCHAR(12) NOT NULL DEFAULT 'main',          -- main: own contract with the client; sub: petti thekka taken from a main contractor
    client_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),   -- client (or the main contractor for a sub-contract)
    employer_name VARCHAR(200),                                 -- project owner when the site is a sub-contract
    contract_no VARCHAR(80),
    contract_date DATE,
    start_date DATE,
    end_date DATE,
    contract_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,          -- without VAT
    vat_percent DECIMAL(5, 2) NOT NULL DEFAULT 13,
    retention_percent DECIMAL(5, 2) NOT NULL DEFAULT 5,
    tds_percent DECIMAL(5, 2) NOT NULL DEFAULT 1.5,
    advance_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,          -- mobilisation advance received
    advance_recovery_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
    budget_material DECIMAL(15, 2) NOT NULL DEFAULT 0,
    budget_labour DECIMAL(15, 2) NOT NULL DEFAULT 0,
    budget_subcontract DECIMAL(15, 2) NOT NULL DEFAULT 0,
    budget_other DECIMAL(15, 2) NOT NULL DEFAULT 0,
    location VARCHAR(200),
    site_engineer VARCHAR(120),
    warehouse_id UUID,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    status VARCHAR(12) NOT NULL DEFAULT 'active',
    remarks TEXT,
    created_by UUID, updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT construction_site_type CHECK (contract_type IN ('main', 'sub')),
    CONSTRAINT construction_site_status CHECK (status IN ('active', 'on_hold', 'completed', 'closed')),
    CONSTRAINT unique_construction_site_code UNIQUE (tenant_id, site_code)
);

CREATE TABLE IF NOT EXISTS tenant_master.construction_boq_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES tenant_master.construction_sites(id) ON DELETE CASCADE,
    item_no VARCHAR(30),
    description TEXT NOT NULL,
    unit VARCHAR(20),
    qty DECIMAL(15, 3) NOT NULL DEFAULT 0,
    rate DECIMAL(15, 2) NOT NULL DEFAULT 0,
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_construction_boq_site ON tenant_master.construction_boq_items(site_id);

-- running (RA) bills to the client / main contractor
CREATE TABLE IF NOT EXISTS tenant_master.construction_ra_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES tenant_master.construction_sites(id),
    doc_no VARCHAR(40) NOT NULL,
    ra_no INTEGER NOT NULL,
    doc_date DATE NOT NULL,
    period_from DATE, period_to DATE,
    gross_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,             -- work done this bill (without VAT)
    vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    retention_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tds_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    advance_recovery DECIMAL(15, 2) NOT NULL DEFAULT 0,         -- shown on the bill; the advance already sits in the client ledger
    other_deduction DECIMAL(15, 2) NOT NULL DEFAULT 0,
    net_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,               -- cash the client pays for this bill
    cost_center_id UUID,
    narration TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'draft',
    posted_at TIMESTAMPTZ, posted_by UUID, cancelled_at TIMESTAMPTZ, cancelled_by UUID, cancellation_reason TEXT,
    created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT construction_ra_status CHECK (status IN ('draft', 'posted', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_construction_ra_site ON tenant_master.construction_ra_bills(site_id);
CREATE TABLE IF NOT EXISTS tenant_master.construction_ra_bill_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    bill_id UUID NOT NULL REFERENCES tenant_master.construction_ra_bills(id) ON DELETE CASCADE,
    boq_item_id UUID REFERENCES tenant_master.construction_boq_items(id),
    description TEXT,
    unit VARCHAR(20),
    qty DECIMAL(15, 3) NOT NULL DEFAULT 0,                      -- this bill's measured qty
    rate DECIMAL(15, 2) NOT NULL DEFAULT 0,
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_construction_ra_lines_bill ON tenant_master.construction_ra_bill_lines(bill_id);

-- material issued to the site (from store, or straight from a purchase bill)
CREATE TABLE IF NOT EXISTS tenant_master.construction_material_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES tenant_master.construction_sites(id),
    issue_date DATE NOT NULL,
    direction VARCHAR(6) NOT NULL DEFAULT 'out',                -- out: to the site; in: returned from the site
    purchase_bill_id UUID REFERENCES tenant_master.purchase_bills(id),
    adjustment_id UUID,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    remarks TEXT,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT construction_issue_direction CHECK (direction IN ('out', 'in'))
);
CREATE INDEX IF NOT EXISTS idx_construction_issues_site ON tenant_master.construction_material_issues(site_id);
CREATE TABLE IF NOT EXISTS tenant_master.construction_material_issue_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    issue_id UUID NOT NULL REFERENCES tenant_master.construction_material_issues(id) ON DELETE CASCADE,
    bill_detail_id UUID,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID,
    rate DECIMAL(15, 4) NOT NULL DEFAULT 0,
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_construction_issue_lines_issue ON tenant_master.construction_material_issue_lines(issue_id);
CREATE INDEX IF NOT EXISTS idx_construction_issue_lines_bill ON tenant_master.construction_material_issue_lines(bill_detail_id);

-- labour wage sheets
CREATE TABLE IF NOT EXISTS tenant_master.construction_wage_sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES tenant_master.construction_sites(id),
    doc_no VARCHAR(40) NOT NULL,
    doc_date DATE NOT NULL,
    period_from DATE, period_to DATE,
    pay_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),   -- cash / bank paid now, or wages payable / a labour contractor
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    cost_center_id UUID,
    narration TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'draft',
    posted_at TIMESTAMPTZ, posted_by UUID, cancelled_at TIMESTAMPTZ, cancelled_by UUID, cancellation_reason TEXT,
    created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT construction_wage_status CHECK (status IN ('draft', 'posted', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_construction_wages_site ON tenant_master.construction_wage_sheets(site_id);
CREATE TABLE IF NOT EXISTS tenant_master.construction_wage_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    sheet_id UUID NOT NULL REFERENCES tenant_master.construction_wage_sheets(id) ON DELETE CASCADE,
    worker_name VARCHAR(120) NOT NULL,
    trade VARCHAR(60),                                          -- mason, helper, carpenter ...
    days DECIMAL(8, 2) NOT NULL DEFAULT 0,
    rate DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ot_hours DECIMAL(8, 2) NOT NULL DEFAULT 0,
    ot_rate DECIMAL(12, 2) NOT NULL DEFAULT 0,
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_construction_wage_lines_sheet ON tenant_master.construction_wage_lines(sheet_id);

-- sub-contracts given out (petti thekka diyeko) and their bills
CREATE TABLE IF NOT EXISTS tenant_master.construction_subcontracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES tenant_master.construction_sites(id),
    subcontractor_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    work_description TEXT NOT NULL,
    contract_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    vat_percent DECIMAL(5, 2) NOT NULL DEFAULT 13,
    retention_percent DECIMAL(5, 2) NOT NULL DEFAULT 5,
    tds_percent DECIMAL(5, 2) NOT NULL DEFAULT 1.5,
    start_date DATE, end_date DATE,
    status VARCHAR(12) NOT NULL DEFAULT 'active',
    remarks TEXT,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT construction_subcontract_status CHECK (status IN ('active', 'completed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_construction_subcontracts_site ON tenant_master.construction_subcontracts(site_id);
CREATE TABLE IF NOT EXISTS tenant_master.construction_subcontract_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    subcontract_id UUID NOT NULL REFERENCES tenant_master.construction_subcontracts(id),
    site_id UUID NOT NULL REFERENCES tenant_master.construction_sites(id),
    doc_no VARCHAR(40) NOT NULL,
    party_bill_no VARCHAR(60),
    doc_date DATE NOT NULL,
    gross_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    retention_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tds_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    advance_recovery DECIMAL(15, 2) NOT NULL DEFAULT 0,
    other_deduction DECIMAL(15, 2) NOT NULL DEFAULT 0,
    net_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    cost_center_id UUID,
    narration TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'draft',
    posted_at TIMESTAMPTZ, posted_by UUID, cancelled_at TIMESTAMPTZ, cancelled_by UUID, cancellation_reason TEXT,
    created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT construction_sub_bill_status CHECK (status IN ('draft', 'posted', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_construction_sub_bills_sub ON tenant_master.construction_subcontract_bills(subcontract_id);
CREATE INDEX IF NOT EXISTS idx_construction_sub_bills_site ON tenant_master.construction_subcontract_bills(site_id);

-- security group module "construction" for admin groups
DO $$
DECLARE all_rights JSONB := '{"view": true, "create": true, "edit": true, "delete": true, "print": true, "export": true}';
BEGIN
    UPDATE tenant_master.security_rights_groups g
    SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object('construction', all_rights)
    WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'construction')
      AND (group_code ILIKE 'ADMIN%' OR EXISTS (SELECT 1 FROM tenant_master.users u WHERE u.security_group_id = g.id AND u.is_company_admin));
END $$;

DO $$ BEGIN
    IF to_regproc('tenant_master.audit_attach_all') IS NOT NULL THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
