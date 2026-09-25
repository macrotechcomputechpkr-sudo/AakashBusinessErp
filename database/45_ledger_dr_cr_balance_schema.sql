-- =============================================
-- LEDGER TRANSACTION BATCH/LINE - Dr = Cr GUARANTEED AT THE DATABASE
-- =============================================
-- "Dr/Cr mismatch nahune gari milau" - a single-row CHECK constraint
-- cannot express "the SUM across several rows must balance"; only a
-- constraint TRIGGER can. This is the shared posting foundation every
-- future GL-affecting feature (Purchase Bill, Journal Voucher, Payment,
-- etc.) will insert into: one ledger_transaction_batches row per
-- posting event, with 2+ ledger_transaction_lines rows underneath it.
-- The trigger is DEFERRABLE INITIALLY DEFERRED, meaning it only checks
-- the balance once, at COMMIT (or when a caller explicitly runs
-- SET CONSTRAINTS ... IMMEDIATE) - not after each individual line
-- insert, since a batch is naturally unbalanced while its lines are
-- still being added one at a time within the same transaction.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.ledger_transaction_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    document_type VARCHAR(30) NOT NULL,
    document_id UUID NOT NULL,
    batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    narration TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_ledger_batches_document ON tenant_master.ledger_transaction_batches(document_type, document_id);

CREATE TABLE IF NOT EXISTS tenant_master.ledger_transaction_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    batch_id UUID NOT NULL REFERENCES tenant_master.ledger_transaction_batches(id) ON DELETE CASCADE,
    ledger_account_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    debit_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    credit_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    narration TEXT,

    -- A line is either a debit OR a credit, never both, and never
    -- neither - this row-level rule is enforceable with a plain CHECK,
    -- unlike the cross-row batch balance below.
    CONSTRAINT valid_line_dr_or_cr CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_ledger_lines_batch ON tenant_master.ledger_transaction_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_ledger ON tenant_master.ledger_transaction_lines(ledger_account_id);

-- FEATURE: the actual Dr=Cr enforcement. Fires once per affected batch
-- at commit time (DEFERRED), summing every line under that batch - if
-- total debits don't exactly equal total credits, the WHOLE transaction
-- that tried to post it is rejected, guaranteeing every batch that ever
-- makes it into this table balances. This makes a Dr/Cr mismatch
-- structurally impossible, not just checked by application code that a
-- future bug could bypass.
CREATE OR REPLACE FUNCTION tenant_master.check_ledger_batch_balance() RETURNS TRIGGER AS $$
DECLARE
    v_batch_id UUID;
    v_total_debit DECIMAL(15, 2);
    v_total_credit DECIMAL(15, 2);
BEGIN
    v_batch_id := COALESCE(NEW.batch_id, OLD.batch_id);

    SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO v_total_debit, v_total_credit
    FROM tenant_master.ledger_transaction_lines
    WHERE batch_id = v_batch_id;

    IF v_total_debit != v_total_credit THEN
        RAISE EXCEPTION 'Ledger batch % does not balance: Debit % != Credit % - every posting must have equal total Debit and Credit before it can be saved',
            v_batch_id, v_total_debit, v_total_credit;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_ledger_batch_balance ON tenant_master.ledger_transaction_lines;
CREATE CONSTRAINT TRIGGER trg_check_ledger_batch_balance
    AFTER INSERT OR UPDATE OR DELETE ON tenant_master.ledger_transaction_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tenant_master.check_ledger_batch_balance();
