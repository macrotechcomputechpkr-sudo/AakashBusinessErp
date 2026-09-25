-- =============================================
-- SHORT NAME PATTERN - APPLIED ACROSS ALL MASTERS
-- Same pattern just built for Ledger Accounts: Code stays a disabled,
-- server-generated preview; Short Name (Alias) auto-suggests from the
-- entity's Name via initials + a true sequential number (e.g.
-- "Tanka Prasad Adhikari" -> "TPA00001"), fully changeable, generated
-- server-side/atomically so concurrent creates never collide.
--
-- One GENERIC function reused by every master (nextval() accepts a
-- sequence name as text, so this avoids writing near-identical
-- functions per table) - each master gets its OWN sequence so their
-- numbering never interferes with each other.
-- =============================================

CREATE OR REPLACE FUNCTION tenant_master.next_short_name(seq_name TEXT, initials TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval(seq_name);
  RETURN UPPER(COALESCE(NULLIF(initials, ''), 'GEN')) || LPAD(n::TEXT, 5, '0');
END; $$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_business_unit_short_name;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_sub_ledger_short_name;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_transport_short_name;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_cost_center_short_name;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_profit_center_short_name;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_product_short_name;
