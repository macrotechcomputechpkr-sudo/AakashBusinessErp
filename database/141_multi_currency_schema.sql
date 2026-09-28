-- =============================================
-- 141: multi-currency entries
--   currencies     - currency master per company: code, name, symbol, the
--                    current exchange rate (1 unit = rate in local currency)
--                    and which one is the local (base) currency
--   exchange_rate  - on every sales / purchase document: the rate used for
--                    that entry (local amount = amount x rate); 1 in local
--                    currency. Challan / returns get their currency too.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.currencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    currency_code VARCHAR(10) NOT NULL,
    currency_name VARCHAR(80) NOT NULL,
    symbol VARCHAR(10),
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1,
    is_base BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID, updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT currencies_rate_positive CHECK (exchange_rate > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_currencies_code ON tenant_master.currencies(tenant_id, upper(currency_code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_currencies_one_base ON tenant_master.currencies(tenant_id) WHERE is_base;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_quotations', 'sales_orders', 'sales_deliveries', 'sales_bills', 'sales_returns', 'sales_nonsaleable_returns',
                           'purchase_requisitions', 'purchase_quotations', 'purchase_orders', 'purchase_grns', 'purchase_bills', 'purchase_returns',
                           'purchase_nonsaleable_returns', 'purchase_additional_expenses'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'tenant_master' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE tenant_master.%I ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT %L', t, 'NPR');
      EXECUTE format('ALTER TABLE tenant_master.%I ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1', t);
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
