-- =============================================
-- FISCAL PERIODS (Nepali VAT months)
-- Nepal files VAT per Bikram Sambat month (Shrawan ... Ashadh). BS
-- month lengths vary irregularly year to year and cannot be computed
-- by formula - the built-in nepaliDateUtils converter is an admitted
-- approximation that drifts by weeks. So VAT month boundaries are
-- stored here, entered once per fiscal year from the official
-- calendar (12 start dates), and every month-wise VAT report uses
-- these exact AD ranges. When a year has no periods yet, reports fall
-- back to English calendar months and say so on screen.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.fiscal_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    fiscal_year_id UUID NOT NULL REFERENCES tenant_master.fiscal_years(id) ON DELETE CASCADE,
    period_no SMALLINT NOT NULL,              -- 1 = Shrawan ... 12 = Ashadh
    period_name VARCHAR(30) NOT NULL,         -- e.g. 'Shrawan'
    period_name_np VARCHAR(30),               -- e.g. 'साउन'
    start_date DATE NOT NULL,                 -- AD
    end_date DATE NOT NULL,                   -- AD, inclusive
    is_locked BOOLEAN DEFAULT FALSE,          -- VAT return filed for this month
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID,
    CONSTRAINT unique_fiscal_period UNIQUE (fiscal_year_id, period_no),
    CONSTRAINT valid_period_no CHECK (period_no BETWEEN 1 AND 12),
    CONSTRAINT valid_period_range CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_lookup ON tenant_master.fiscal_periods(tenant_id, start_date, end_date);
