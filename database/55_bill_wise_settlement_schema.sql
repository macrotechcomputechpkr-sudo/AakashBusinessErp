-- =============================================
-- BILL-WISE (VOUCHER-TO-VOUCHER) SETTLEMENT TRACKING
-- "Vendor Master ma Bill to Bill enable xa ra balance Dr xa vane,
-- Purchase Bill entry garda FIFO method ma kun doc ma kati balance xa
-- kati adjust garne milaune, tesko reflection Ageing Report ma garaune.
-- Cr balance xa vane Purchase Return ma testai garne."
--
-- A vendor's normal outstanding is Credit (we owe them, one Cr
-- reference per Bill). An abnormal Debit balance (from an overpayment,
-- an over-return, or an advance) means a NEW Bill should first be used
-- to clear that Dr balance (FIFO, oldest first) before any of it
-- becomes a fresh outstanding. Symmetrically, a normal Cr balance means
-- a NEW Return should clear outstanding Bills (FIFO) rather than
-- floating as its own unlinked Dr entry.
-- =============================================

-- Per-vendor override of the system-wide default (System Control's own
-- bill_wise_tracking already exists as the fallback when this is
-- 'system_default').
ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS bill_wise_tracking_control VARCHAR(20) DEFAULT 'system_default';
ALTER TABLE tenant_master.ledger_accounts
    DROP CONSTRAINT IF EXISTS valid_bill_wise_tracking_control;
ALTER TABLE tenant_master.ledger_accounts
    ADD CONSTRAINT valid_bill_wise_tracking_control CHECK (bill_wise_tracking_control IN ('system_default', 'enabled', 'disabled'));

-- One row per transaction that participates in bill-wise tracking -
-- whether it ends up fully/partially outstanding (remaining_amount > 0)
-- or fully settled (remaining_amount = 0). remaining_amount is kept as
-- a plain stored column (not a generated one) updated alongside
-- allocated_amount, for maximum Postgres-version compatibility.
CREATE TABLE IF NOT EXISTS tenant_master.bill_wise_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),

    source_type VARCHAR(30) NOT NULL,
    source_id UUID NOT NULL,
    source_doc_no VARCHAR(50) NOT NULL,
    source_date DATE NOT NULL,

    -- 'cr' = this transaction credited the vendor (a Bill - increases
    -- what we owe). 'dr' = this transaction debited the vendor (a
    -- Return/Payment - decreases what we owe, or creates an advance).
    nature VARCHAR(5) NOT NULL,

    total_amount DECIMAL(15, 2) NOT NULL,
    allocated_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    remaining_amount DECIMAL(15, 2) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_bwr_nature CHECK (nature IN ('dr', 'cr')),
    CONSTRAINT valid_bwr_amounts CHECK (total_amount > 0 AND allocated_amount >= 0 AND allocated_amount <= total_amount),
    CONSTRAINT valid_bwr_remaining CHECK (remaining_amount = total_amount - allocated_amount),
    CONSTRAINT unique_bwr_source UNIQUE (source_type, source_id)
);

-- Records each match: this NEW reference settled that much of an OLDER
-- opposite-nature reference. Both sides' allocated_amount move together
-- by the same settled_amount whenever a row here is inserted.
CREATE TABLE IF NOT EXISTS tenant_master.bill_wise_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    new_reference_id UUID NOT NULL REFERENCES tenant_master.bill_wise_references(id) ON DELETE CASCADE,
    against_reference_id UUID NOT NULL REFERENCES tenant_master.bill_wise_references(id),
    settled_amount DECIMAL(15, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT positive_settled_amount CHECK (settled_amount > 0),
    CONSTRAINT no_self_settlement CHECK (new_reference_id != against_reference_id)
);

CREATE INDEX IF NOT EXISTS idx_bwr_ledger_outstanding ON tenant_master.bill_wise_references(ledger_id, nature) WHERE remaining_amount > 0;
CREATE INDEX IF NOT EXISTS idx_bwr_source ON tenant_master.bill_wise_references(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_bws_new_ref ON tenant_master.bill_wise_settlements(new_reference_id);
CREATE INDEX IF NOT EXISTS idx_bws_against_ref ON tenant_master.bill_wise_settlements(against_reference_id);

-- FEATURE: "Ageing Report" - every reference still carrying a balance,
-- bucketed by how many days old it is.
CREATE OR REPLACE VIEW tenant_master.v_bill_wise_ageing AS
SELECT
    r.id AS reference_id, r.tenant_id, r.ledger_id,
    l.account_name AS vendor_name,
    r.source_type, r.source_doc_no, r.source_date, r.nature,
    r.total_amount, r.allocated_amount, r.remaining_amount,
    (CURRENT_DATE - r.source_date) AS age_days,
    CASE
        WHEN (CURRENT_DATE - r.source_date) <= 30 THEN '0-30'
        WHEN (CURRENT_DATE - r.source_date) <= 60 THEN '31-60'
        WHEN (CURRENT_DATE - r.source_date) <= 90 THEN '61-90'
        ELSE '90+'
    END AS age_bucket
FROM tenant_master.bill_wise_references r
JOIN tenant_master.ledger_accounts l ON l.id = r.ledger_id
WHERE r.remaining_amount > 0
ORDER BY r.source_date;
