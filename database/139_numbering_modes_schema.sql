-- =============================================
-- 139: document numbering modes and format
--   numbering_mode: auto (automatic numeric) | manual_numeric | manual_alpha (= old 'manual')
--                   | auto_datewise (number restarts each day) | auto_monthwise (each month)
--   valid_from / valid_to  - the dates the series applies to (blank = always)
--   date_format / date_type - date part of datewise / monthwise numbers
--                             (e.g. YYMMDD in Nepali or English dates)
--   fill_char   - what pads the body (default 0)
--   max_length  - longest number allowed; flexible_length lets it grow past the body length
--   counters.period_key - the day / month a datewise / monthwise counter belongs to
-- =============================================
ALTER TABLE tenant_master.document_numbering_categories ALTER COLUMN numbering_mode TYPE VARCHAR(20);
ALTER TABLE tenant_master.document_numbering_categories DROP CONSTRAINT IF EXISTS valid_numbering_mode;
ALTER TABLE tenant_master.document_numbering_categories ADD CONSTRAINT valid_numbering_mode
    CHECK (numbering_mode IN ('auto', 'manual', 'manual_numeric', 'manual_alpha', 'auto_datewise', 'auto_monthwise'));
ALTER TABLE tenant_master.document_numbering_categories ADD COLUMN IF NOT EXISTS valid_from DATE;
ALTER TABLE tenant_master.document_numbering_categories ADD COLUMN IF NOT EXISTS valid_to DATE;
ALTER TABLE tenant_master.document_numbering_categories ADD COLUMN IF NOT EXISTS date_format VARCHAR(10) NOT NULL DEFAULT 'YYMMDD';
ALTER TABLE tenant_master.document_numbering_categories ADD COLUMN IF NOT EXISTS date_type VARCHAR(10) NOT NULL DEFAULT 'nepali';
ALTER TABLE tenant_master.document_numbering_categories ADD COLUMN IF NOT EXISTS fill_char VARCHAR(1) NOT NULL DEFAULT '0';
ALTER TABLE tenant_master.document_numbering_categories ADD COLUMN IF NOT EXISTS max_length INTEGER NOT NULL DEFAULT 15;
ALTER TABLE tenant_master.document_numbering_categories ADD COLUMN IF NOT EXISTS flexible_length BOOLEAN NOT NULL DEFAULT FALSE;
DO $$ BEGIN
    ALTER TABLE tenant_master.document_numbering_categories ADD CONSTRAINT valid_numbering_date_format
        CHECK (date_format IN ('YYMMDD', 'YYYYMMDD', 'DDMMYY', 'DDMMYYYY', 'MMDDYY', 'YYMM', 'YYYYMM', 'MMYY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE tenant_master.document_numbering_categories ADD CONSTRAINT valid_numbering_date_type CHECK (date_type IN ('nepali', 'english'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE tenant_master.document_numbering_categories ADD CONSTRAINT valid_numbering_valid_range CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE tenant_master.document_numbering_categories ADD CONSTRAINT valid_numbering_max_length CHECK (max_length BETWEEN 1 AND 40);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE tenant_master.document_numbering_counters ADD COLUMN IF NOT EXISTS period_key VARCHAR(10) NOT NULL DEFAULT '';
ALTER TABLE tenant_master.document_numbering_counters DROP CONSTRAINT IF EXISTS unique_counter_scope;
CREATE UNIQUE INDEX IF NOT EXISTS uq_numbering_counter_scope ON tenant_master.document_numbering_counters (
    category_id,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(fiscal_year_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_key
);

-- next number of a series (per branch / user / fiscal year / day or month), serialised per category
CREATE OR REPLACE FUNCTION tenant_master.next_document_number_p(p_tenant_id UUID, p_category_id UUID, p_branch_id UUID, p_user_id UUID, p_fiscal_year_id UUID, p_period_key TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    v_current INTEGER;
    v_start INTEGER;
    v_end INTEGER;
    v_id UUID;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_category_id::text));
    SELECT start_number, end_number INTO v_start, v_end FROM tenant_master.document_numbering_categories WHERE id = p_category_id;
    SELECT id, current_number INTO v_id, v_current FROM tenant_master.document_numbering_counters
    WHERE category_id = p_category_id AND branch_id IS NOT DISTINCT FROM p_branch_id AND user_id IS NOT DISTINCT FROM p_user_id
      AND fiscal_year_id IS NOT DISTINCT FROM p_fiscal_year_id AND period_key = COALESCE(p_period_key, '')
    FOR UPDATE;
    IF v_id IS NULL THEN
        v_current := v_start;
        INSERT INTO tenant_master.document_numbering_counters (tenant_id, category_id, branch_id, user_id, fiscal_year_id, period_key, current_number)
        VALUES (p_tenant_id, p_category_id, p_branch_id, p_user_id, p_fiscal_year_id, COALESCE(p_period_key, ''), v_current);
    ELSE
        v_current := v_current + 1;
        UPDATE tenant_master.document_numbering_counters SET current_number = v_current WHERE id = v_id;
    END IF;
    IF v_end IS NOT NULL AND v_current > v_end THEN
        RAISE EXCEPTION 'Document numbering range exhausted for this category (max %)', v_end;
    END IF;
    RETURN v_current;
END; $$;
