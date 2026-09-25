-- =============================================
-- BANK RECONCILIATION
--   bank_statements / bank_statement_lines - bank statements uploaded
--     (Excel / CSV, read in the browser); fingerprint stops the same
--     statement line being imported twice when statements overlap.
--   bank_reconciliation_marks - a bank ledger's book line (ledger_
--     transaction_lines) cleared by the bank on cleared_date: ticked by hand
--     (method 'manual') or matched to a statement line by the matching
--     engine (method 'auto', with its score). Several book lines may point
--     at one statement line (one deposit slip, many cheques).
-- The Bank Reconciliation Statement as on a date is built from these:
-- book balance, +/- items not yet cleared, +/- bank items not in the books,
-- = balance per bank, compared with the statement's own running balance.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.bank_statements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    bank_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    file_name VARCHAR(255),
    statement_from DATE,
    statement_to DATE,
    opening_balance DECIMAL(15, 2),
    closing_balance DECIMAL(15, 2),
    line_count INTEGER DEFAULT 0,
    skipped_duplicates INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);
CREATE INDEX IF NOT EXISTS idx_bank_statements_ledger ON tenant_master.bank_statements(tenant_id, bank_ledger_id);

CREATE TABLE IF NOT EXISTS tenant_master.bank_statement_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    statement_id UUID NOT NULL REFERENCES tenant_master.bank_statements(id) ON DELETE CASCADE,
    bank_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    line_no INTEGER NOT NULL,
    txn_date DATE NOT NULL,
    value_date DATE,
    description TEXT,
    ref_no VARCHAR(100),
    withdrawal DECIMAL(15, 2) NOT NULL DEFAULT 0,       -- money out of the bank (book: credit)
    deposit DECIMAL(15, 2) NOT NULL DEFAULT 0,          -- money into the bank (book: debit)
    balance DECIMAL(15, 2),
    fingerprint VARCHAR(300) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'unmatched',
    match_score INTEGER,
    matched_at TIMESTAMPTZ,
    matched_by UUID,
    remarks TEXT,
    CONSTRAINT valid_statement_line_status CHECK (status IN ('unmatched', 'matched', 'ignored')),
    CONSTRAINT statement_line_one_side CHECK (withdrawal >= 0 AND deposit >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_bank_statement_line ON tenant_master.bank_statement_lines(tenant_id, bank_ledger_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_date ON tenant_master.bank_statement_lines(tenant_id, bank_ledger_id, txn_date);

CREATE TABLE IF NOT EXISTS tenant_master.bank_reconciliation_marks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    bank_ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    ledger_line_id UUID NOT NULL REFERENCES tenant_master.ledger_transaction_lines(id) ON DELETE CASCADE,
    cleared_date DATE NOT NULL,
    statement_line_id UUID REFERENCES tenant_master.bank_statement_lines(id) ON DELETE SET NULL,
    method VARCHAR(10) NOT NULL DEFAULT 'manual',
    score INTEGER,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT valid_reco_method CHECK (method IN ('manual', 'auto'))
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_reco_mark_line ON tenant_master.bank_reconciliation_marks(tenant_id, ledger_line_id);
CREATE INDEX IF NOT EXISTS idx_reco_marks_ledger ON tenant_master.bank_reconciliation_marks(tenant_id, bank_ledger_id, cleared_date);
CREATE INDEX IF NOT EXISTS idx_reco_marks_statement_line ON tenant_master.bank_reconciliation_marks(statement_line_id);
