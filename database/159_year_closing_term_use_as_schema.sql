-- =============================================
-- 159: Year closing / re-closing, billing term "Use As"
--
-- 1. fiscal_year_closings - one row per closed fiscal year
--    The closing voucher (ledger_transaction_batches.document_type =
--    'year_closing', dated the year's last day) brings every Profit & Loss
--    ledger (Income / Expenses) to nil against the Profit & Loss A/c ledger
--    and moves the closing stock into the stock ledger, so the Profit & Loss
--    A/c holds the year's net profit and the next year starts with nil P&L
--    heads and the closing stock as its opening stock. The row keeps the
--    figures it was closed with (net profit, opening / closing stock, the
--    item-wise closing stock carried forward).
--    needs_reclosing: something dated in or before that year changed after it
--    was closed (a re-opened year, a back-dated entry, product opening stock)
--    - re-closing posts the voucher again with the new figures.
-- 2. system_control_settings
--      year_reclosing_mode       'auto'   re-close by itself when a closed year's figures change
--                                'manual' only mark the year "Re-closing required"
--      year_closing_pl_ledger_id    Profit & Loss A/c (Equity) - found / made at the first closing
--      year_closing_stock_ledger_id Closing Stock A/c (Inventory group)
-- 3. billing_terms.use_as: 'vat' | 'excise' | 'discount' | 'other_addition'
--    (Sales and Purchase terms). tax_type stays the internal VAT / Excise flag
--    the postings and VAT reports read: vat -> 'vat', excise -> 'excise',
--    discount / other addition -> 'none'.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.fiscal_year_closings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    fiscal_year_id UUID NOT NULL REFERENCES tenant_master.fiscal_years(id) ON DELETE CASCADE,
    doc_no VARCHAR(40),
    doc_date DATE NOT NULL,
    narration TEXT,
    batch_id UUID,
    pl_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    stock_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    stock_method VARCHAR(30) NOT NULL DEFAULT 'weighted_average',
    gl_result NUMERIC(18, 2) NOT NULL DEFAULT 0,         -- income - expenses in the GL (Cr +)
    opening_stock NUMERIC(18, 2) NOT NULL DEFAULT 0,
    closing_stock NUMERIC(18, 2) NOT NULL DEFAULT 0,
    stock_adjustment NUMERIC(18, 2) NOT NULL DEFAULT 0,  -- posted to the stock ledger (Dr +)
    net_profit NUMERIC(18, 2) NOT NULL DEFAULT 0,        -- to the Profit & Loss A/c (Cr + = profit)
    ledgers_closed INTEGER NOT NULL DEFAULT 0,
    stock_carried JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{product_id, product_code, product_name, qty, rate, value}]
    needs_reclosing BOOLEAN NOT NULL DEFAULT FALSE,
    reclosing_reason TEXT,
    reclosed_count INTEGER NOT NULL DEFAULT 0,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_by UUID,
    last_reclosed_at TIMESTAMPTZ,
    CONSTRAINT uq_fiscal_year_closing UNIQUE (fiscal_year_id)
);
CREATE INDEX IF NOT EXISTS idx_fy_closings_tenant ON tenant_master.fiscal_year_closings(tenant_id, doc_date);

ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS year_reclosing_mode VARCHAR(10) NOT NULL DEFAULT 'auto';
ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS year_closing_pl_ledger_id UUID;
ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS year_closing_stock_ledger_id UUID;
DO $$ BEGIN
    ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_year_reclosing_mode CHECK (year_reclosing_mode IN ('auto', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Anything posted / removed with a date on or before a closed year's end (other
-- than the closing voucher itself) makes that year's closing - and every later
-- one - out of date. A closed year is locked (146), so this happens only after
-- a year was re-opened, or for an entry before the first closed year's start.
CREATE OR REPLACE FUNCTION tenant_master.mark_year_reclosing() RETURNS TRIGGER AS $$
DECLARE
    v_row RECORD;
    v_date DATE;
    v_what TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
    IF TG_TABLE_NAME = 'ledger_transaction_batches' THEN
        IF v_row.document_type = 'year_closing' THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END IF;
        v_date := v_row.batch_date;
        v_what := 'GL entry ' || v_row.document_type;
    ELSE
        v_date := v_row.movement_date;
        v_what := 'stock movement ' || COALESCE(v_row.source_type, '');
    END IF;
    IF v_date IS NOT NULL THEN
        UPDATE tenant_master.fiscal_year_closings
           SET needs_reclosing = TRUE,
               reclosing_reason = COALESCE(reclosing_reason, TG_OP || ' ' || v_what || ' dated ' || v_date)
         WHERE tenant_id = v_row.tenant_id AND doc_date >= v_date AND NOT needs_reclosing;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_batches_year_reclosing ON tenant_master.ledger_transaction_batches;
CREATE TRIGGER trg_batches_year_reclosing AFTER INSERT OR DELETE ON tenant_master.ledger_transaction_batches
    FOR EACH ROW EXECUTE FUNCTION tenant_master.mark_year_reclosing();
DROP TRIGGER IF EXISTS trg_stock_year_reclosing ON tenant_master.stock_movements;
CREATE TRIGGER trg_stock_year_reclosing AFTER INSERT OR DELETE ON tenant_master.stock_movements
    FOR EACH ROW EXECUTE FUNCTION tenant_master.mark_year_reclosing();

-- product opening stock is valued into every year's stock
CREATE OR REPLACE FUNCTION tenant_master.mark_year_reclosing_opening() RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(NEW.opening_qty, 0) IS DISTINCT FROM COALESCE(OLD.opening_qty, 0)
       OR COALESCE(NEW.opening_rate, 0) IS DISTINCT FROM COALESCE(OLD.opening_rate, 0) THEN
        UPDATE tenant_master.fiscal_year_closings
           SET needs_reclosing = TRUE, reclosing_reason = COALESCE(reclosing_reason, 'opening stock of ' || COALESCE(NEW.product_name, 'a product') || ' changed')
         WHERE tenant_id = NEW.tenant_id AND NOT needs_reclosing;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_products_year_reclosing ON tenant_master.products;
CREATE TRIGGER trg_products_year_reclosing AFTER UPDATE ON tenant_master.products
    FOR EACH ROW EXECUTE FUNCTION tenant_master.mark_year_reclosing_opening();

-- billing term "Use As"
ALTER TABLE tenant_master.billing_terms ADD COLUMN IF NOT EXISTS use_as VARCHAR(20);
UPDATE tenant_master.billing_terms
   SET use_as = CASE WHEN tax_type = 'vat' THEN 'vat'
                     WHEN tax_type = 'excise' THEN 'excise'
                     WHEN tax_type IN ('discount', 'cash_discount') OR sign = '-' THEN 'discount'
                     ELSE 'other_addition' END
 WHERE use_as IS NULL;
ALTER TABLE tenant_master.billing_terms ALTER COLUMN use_as SET DEFAULT 'other_addition';
DO $$ BEGIN
    ALTER TABLE tenant_master.billing_terms ADD CONSTRAINT valid_term_use_as CHECK (use_as IS NULL OR use_as IN ('vat', 'excise', 'discount', 'other_addition'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
