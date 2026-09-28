-- =============================================
-- 146: a closed / locked fiscal year cannot be posted into
--   Closing a fiscal year (Fiscal Years > Close) sets is_closed / is_locked,
--   but nothing stopped a document dated in that year from being posted,
--   cancelled or re-posted afterwards - the closed year's ledger and stock
--   (and so its audited Trial Balance) could still change.
--   Like "Allow Posting From / To" (Microsoft NAV / Business Central) and the
--   year lock of Tally / Busy, the database now refuses, for a date inside a
--   closed or locked fiscal year of the same company:
--     * a new GL batch (ledger_transaction_batches INSERT) or removing one
--       (DELETE - cancelling / re-posting a document)
--     * a new stock movement or removing one (stock_movements INSERT / DELETE)
--   Every module posts through these two tables, so one rule covers all of
--   them. Opening balances of the next year are separate (ledger_openings).
-- =============================================
CREATE OR REPLACE FUNCTION tenant_master.reject_closed_fiscal_year() RETURNS TRIGGER AS $$
DECLARE
    v_row RECORD;
    v_date DATE;
    v_fy RECORD;
BEGIN
    IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
    IF TG_TABLE_NAME = 'ledger_transaction_batches' THEN
        v_date := v_row.batch_date;
    ELSE
        v_date := v_row.movement_date;
    END IF;
    IF v_date IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    SELECT fiscal_year_name INTO v_fy FROM tenant_master.fiscal_years
     WHERE tenant_id = v_row.tenant_id AND v_date BETWEEN start_date_eng AND end_date_eng
       AND (is_closed OR is_locked OR status = 'closed')
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Fiscal year % is closed - nothing dated % can be posted, cancelled or changed', v_fy.fiscal_year_name, v_date
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_batches_closed_fy ON tenant_master.ledger_transaction_batches;
CREATE TRIGGER trg_batches_closed_fy BEFORE INSERT OR DELETE ON tenant_master.ledger_transaction_batches
    FOR EACH ROW EXECUTE FUNCTION tenant_master.reject_closed_fiscal_year();

DROP TRIGGER IF EXISTS trg_stock_closed_fy ON tenant_master.stock_movements;
CREATE TRIGGER trg_stock_closed_fy BEFORE INSERT OR DELETE ON tenant_master.stock_movements
    FOR EACH ROW EXECUTE FUNCTION tenant_master.reject_closed_fiscal_year();
