-- =============================================
-- 160: Purchase Bill header - Quotation No / Order Ref No; closed year status lock
--   The Purchase Bill screen (and routes/purchaseBillRoutes.js) saves the
--   supplier's quotation no and order reference no, but purchase_bills never
--   had these columns - saving a purchase bill failed with
--   "Could not find the 'quotation_no' column of 'purchase_bills'".
-- =============================================
ALTER TABLE tenant_master.purchase_bills ADD COLUMN IF NOT EXISTS quotation_no VARCHAR(50);
ALTER TABLE tenant_master.purchase_bills ADD COLUMN IF NOT EXISTS order_ref_no VARCHAR(100);

-- =============================================
-- Closed fiscal year: refuse the status change itself
--   146 refuses the GL batch / stock movement of a document dated in a closed
--   (or locked) year, but the document's status was changed first - a Sales
--   Bill could end up "posted" with nothing in the books. Now posting or
--   cancelling (status -> posted / cancelled from another status) a document
--   dated in a closed year is refused before anything happens, on every
--   document table with doc_date + status.
-- =============================================
CREATE OR REPLACE FUNCTION tenant_master.reject_closed_fy_status() RETURNS TRIGGER AS $$
DECLARE
    v_fy TEXT;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('posted', 'cancelled') OR NEW.doc_date IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'posted' THEN
        RETURN NEW;                                   -- cancelling a draft touches no books
    END IF;
    SELECT fiscal_year_name INTO v_fy FROM tenant_master.fiscal_years
     WHERE tenant_id = NEW.tenant_id AND NEW.doc_date BETWEEN start_date_eng AND end_date_eng
       AND (is_closed OR is_locked OR status = 'closed')
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Fiscal year % is closed - nothing dated % can be posted, cancelled or changed', v_fy, NEW.doc_date
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT c.table_name FROM information_schema.columns c
         WHERE c.table_schema = 'tenant_master' AND c.column_name = 'doc_date'
           AND EXISTS (SELECT 1 FROM information_schema.columns s WHERE s.table_schema = 'tenant_master' AND s.table_name = c.table_name AND s.column_name = 'status')
           AND EXISTS (SELECT 1 FROM information_schema.columns s WHERE s.table_schema = 'tenant_master' AND s.table_name = c.table_name AND s.column_name = 'tenant_id')
           AND EXISTS (SELECT 1 FROM information_schema.tables x WHERE x.table_schema = 'tenant_master' AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_closed_fy_status ON tenant_master.%I', r.table_name);
        EXECUTE format('CREATE TRIGGER trg_closed_fy_status BEFORE UPDATE OF status ON tenant_master.%I FOR EACH ROW EXECUTE FUNCTION tenant_master.reject_closed_fy_status()', r.table_name);
    END LOOP;
END $$;
