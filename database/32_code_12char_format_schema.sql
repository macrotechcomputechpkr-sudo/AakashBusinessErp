-- =============================================
-- CODE FORMAT - FIXED 12 CHARACTERS, ALL MASTERS
-- The earlier FY-prefixed Ledger format ("208182-RECEIVABLES-0001", 23
-- characters) was far too long. Redesigned to a fixed-width 12
-- characters everywhere:
--   Ledger:        FY(2) + Group Type(4) + Sequence(6)  = 12
--   Every other master: Type(4) + Sequence(8)           = 12
-- Fixed-width (never longer, padded if shorter) so every code in the
-- system is visually consistent and sortable.
-- =============================================

CREATE OR REPLACE FUNCTION tenant_master.next_ledger_account_code(group_code TEXT, fy_prefix TEXT DEFAULT '')
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_ledger_account_code');
  RETURN LPAD(COALESCE(NULLIF(RIGHT(REGEXP_REPLACE(fy_prefix, '[^0-9]', '', 'g'), 2), ''), '00'), 2, '0')
      || RPAD(UPPER(LEFT(COALESCE(NULLIF(group_code, ''), 'LDG'), 4)), 4, 'X')
      || LPAD(n::TEXT, 6, '0');
END; $$ LANGUAGE plpgsql;

-- FEATURE: one GENERIC 12-character code function reused by every OTHER
-- master (Business Unit, Sub Ledger, Transport, Cost/Profit Center,
-- Product, Product Unit, Product Category, Ledger Category, Billing
-- Term, etc.) - Type(4, padded/truncated) + Sequence(8, zero-padded),
-- same "nextval() accepts a sequence name as text" trick already used
-- for next_short_name.
CREATE OR REPLACE FUNCTION tenant_master.next_master_code(seq_name TEXT, type_prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval(seq_name);
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(type_prefix, ''), 'GEN'), 4)), 4, 'X')
      || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;
