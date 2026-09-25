-- =============================================
-- ALL REMAINING next_X_code() FUNCTIONS -> 12 CHARACTERS
-- Same names and signatures as before (so no backend route needs to
-- change what it calls) - only the internal formula changes, to the
-- same Type(4)+Sequence(8)=12 pattern as next_master_code.
-- =============================================

CREATE OR REPLACE FUNCTION tenant_master.next_business_unit_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_business_unit_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_sub_ledger_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_sub_ledger_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_transport_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_transport_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_cost_center_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_cost_center_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_profit_center_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_profit_center_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_area_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_area_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_route_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_route_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_agent_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_agent_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_product_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_product_group_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_group_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_product_company_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_company_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_product_unit_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_unit_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_product_category_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_product_category_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_ledger_category_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_ledger_category_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_billing_term_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_billing_term_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_account_group_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_account_group_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_branch_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_branch_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_warehouse_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_warehouse_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_department_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_department_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_designation_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_designation_code');
  RETURN RPAD(UPPER(LEFT(COALESCE(NULLIF(prefix, ''), 'GEN'), 4)), 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_employee_code()
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_employee_code');
  RETURN RPAD('EMP', 4, 'X') || LPAD(n::TEXT, 8, '0');
END; $$ LANGUAGE plpgsql;
