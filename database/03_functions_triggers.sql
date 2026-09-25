-- =============================================
-- ATOMIC CODE GENERATORS
-- FIX: previous code generated employee_code / department_code /
-- designation_code by reading the "last" row and adding 1 in application
-- code. Two simultaneous requests can read the same "last" value and
-- generate the SAME code -> duplicate key error or silent duplicate.
-- These functions use sequences (atomic in Postgres) instead.
-- Call from backend via: SELECT tenant_master.next_employee_code();
-- =============================================

CREATE OR REPLACE FUNCTION tenant_master.next_employee_code()
RETURNS TEXT AS $$
DECLARE
  n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_employee_code');
  RETURN 'EMP' || LPAD(n::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_department_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE
  n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_department_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'DEPT')) || n::TEXT;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_designation_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE
  n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_designation_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'DESIG')) || n::TEXT;
END;
$$ LANGUAGE plpgsql;
