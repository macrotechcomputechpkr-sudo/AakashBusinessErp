-- =============================================
-- PARTY-LEDGER SUPPORTING MASTERS: Areas, Routes, Salesman/Agents
-- FIX: 06_chart_of_accounts_schema.sql intentionally OMITTED area_id/
-- route_id/agent_id on ledger_accounts because these tables did not
-- exist anywhere (the original design pointed FKs at nothing, which
-- would have failed table creation). Now that the frontend needs real
-- Area/Route/Sales Person pickers for customer & supplier ledgers, these
-- tables are added for real and the FKs are wired onto ledger_accounts.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    area_code VARCHAR(50) NOT NULL,
    area_name VARCHAR(150) NOT NULL,
    -- FIX: an Area can optionally sit under a bigger "main area" (e.g.
    -- "Pokhara" as the main area, with sub-areas within it). Optional /
    -- not compulsory, as requested - a top-level area just leaves this NULL.
    parent_area_id UUID REFERENCES tenant_master.areas(id),
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT unique_area_code_per_tenant UNIQUE (tenant_id, area_code),
    CONSTRAINT unique_area_name_per_tenant UNIQUE (tenant_id, area_name),
    CONSTRAINT no_self_parent_area CHECK (parent_area_id IS NULL OR parent_area_id <> id)
);

CREATE TABLE IF NOT EXISTS tenant_master.routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    route_code VARCHAR(50) NOT NULL,
    route_name VARCHAR(150) NOT NULL,
    -- FIX: a Route (e.g. "Bagar", "Mahendrapool") always belongs to an
    -- Area (e.g. "Pokhara") - this is now mandatory (NOT NULL), matching
    -- "route banauda area choose garnu parne".
    area_id UUID NOT NULL REFERENCES tenant_master.areas(id),
    -- FIX: a route is normally walked/covered by one salesman for their
    -- mobile order-taking round; optional so a route can exist unassigned.
    default_agent_id UUID,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT unique_route_code_per_tenant UNIQUE (tenant_id, route_code),
    CONSTRAINT unique_route_name_per_tenant UNIQUE (tenant_id, route_name)
);

CREATE TABLE IF NOT EXISTS tenant_master.salesman_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    agent_code VARCHAR(50) NOT NULL,
    agent_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(150),
    -- Optional link if this salesperson is also a system user (for
    -- commission/performance reporting); NULL for external/field agents
    -- who never log into the system.
    linked_user_id UUID REFERENCES tenant_master.users(id),
    commission_percentage DECIMAL(5, 2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT unique_agent_code_per_tenant UNIQUE (tenant_id, agent_code),
    CONSTRAINT unique_agent_name_per_tenant UNIQUE (tenant_id, agent_name)
);

-- FIX: wire the real FKs onto ledger_accounts now that these tables exist.
ALTER TABLE tenant_master.ledger_accounts
    ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES tenant_master.areas(id),
    ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES tenant_master.routes(id),
    ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES tenant_master.salesman_agents(id);

-- Atomic code generators (same pattern as every other master in this system)
-- Now that salesman_agents exists, wire the FK routes.default_agent_id
-- referenced before this table existed in file order.
ALTER TABLE tenant_master.routes
    ADD CONSTRAINT fk_routes_default_agent FOREIGN KEY (default_agent_id) REFERENCES tenant_master.salesman_agents(id);

-- =============================================
-- ROUTE <-> CUSTOMER SEQUENCING
-- FIX: this concept did not exist anywhere. A Route (e.g. "Bagar" under
-- "Pokhara") is used by a salesman's mobile order-taking app to list the
-- customers on that route IN THE ORDER the salesman actually visits them
-- - not alphabetically. `sequence_order` is what the mobile app sorts by;
-- reordering (see PUT /api/routes/:id/customers/reorder) just rewrites
-- these numbers.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.route_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    route_id UUID NOT NULL REFERENCES tenant_master.routes(id) ON DELETE CASCADE,
    -- "Customer" = a ledger account whose category_type is a party type
    -- (sales/both) - enforced at the application layer (see
    -- partyMasterRoutes.js), not by a DB CHECK, since that would require
    -- a cross-table lookup inside a constraint.
    ledger_account_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id) ON DELETE CASCADE,
    sequence_order INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT unique_customer_per_route UNIQUE (route_id, ledger_account_id)
);

CREATE INDEX IF NOT EXISTS idx_route_customers_route ON tenant_master.route_customers(route_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_route_customers_ledger ON tenant_master.route_customers(ledger_account_id);

DROP TRIGGER IF EXISTS trg_route_customers_updated_at ON tenant_master.route_customers;
CREATE TRIGGER trg_route_customers_updated_at BEFORE UPDATE ON tenant_master.route_customers
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- Atomic "append at end of route" helper - avoids a race where two
-- concurrent "add customer to route" calls both compute the same
-- max(sequence_order)+1 and collide. Uses a transaction-scoped advisory
-- lock keyed by route_id (works correctly even when the route currently
-- has zero customers, unlike a `SELECT ... FOR UPDATE` over an
-- empty/nonexistent row set).
CREATE OR REPLACE FUNCTION tenant_master.next_route_sequence(p_route_id UUID)
RETURNS INTEGER AS $$
DECLARE next_seq INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_route_id::text));
  SELECT COALESCE(MAX(sequence_order), 0) + 1 INTO next_seq
    FROM tenant_master.route_customers WHERE route_id = p_route_id;
  RETURN next_seq;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_area_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_route_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_agent_code;

CREATE OR REPLACE FUNCTION tenant_master.next_area_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_area_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'AR')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_route_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_route_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'RT')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tenant_master.next_agent_code(prefix TEXT)
RETURNS TEXT AS $$
DECLARE n BIGINT;
BEGIN
  n := nextval('tenant_master.seq_agent_code');
  RETURN UPPER(COALESCE(NULLIF(prefix, ''), 'SA')) || n::TEXT;
END; $$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_areas_tenant ON tenant_master.areas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_areas_parent ON tenant_master.areas(parent_area_id);
CREATE INDEX IF NOT EXISTS idx_routes_tenant ON tenant_master.routes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_routes_area ON tenant_master.routes(area_id);
CREATE INDEX IF NOT EXISTS idx_salesman_agents_tenant ON tenant_master.salesman_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_area ON tenant_master.ledger_accounts(area_id);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_route ON tenant_master.ledger_accounts(route_id);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_agent ON tenant_master.ledger_accounts(agent_id);

DROP TRIGGER IF EXISTS trg_areas_updated_at ON tenant_master.areas;
CREATE TRIGGER trg_areas_updated_at BEFORE UPDATE ON tenant_master.areas
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_routes_updated_at ON tenant_master.routes;
CREATE TRIGGER trg_routes_updated_at BEFORE UPDATE ON tenant_master.routes
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

DROP TRIGGER IF EXISTS trg_salesman_agents_updated_at ON tenant_master.salesman_agents;
CREATE TRIGGER trg_salesman_agents_updated_at BEFORE UPDATE ON tenant_master.salesman_agents
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
