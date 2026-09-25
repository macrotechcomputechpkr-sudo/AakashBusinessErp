-- =============================================
-- 118: Salesman mobile ordering (route plan by date, visits), IRD
-- materialized sales register + CBMS sync, agent targets + commission
-- register, and budget dimensions.
--
-- 1. ROUTE PLAN (beat plan)
--    route_plans says which route a salesman walks on which day: either a
--    fixed DATE, or a WEEKDAY that repeats (0 = Sunday .. 6 = Saturday).
--    A date plan overrides the weekday plan for that date. The mobile
--    order screen only offers the customers of the route(s) planned for
--    the order date, so a salesman cannot book orders off-route.
--    mobile_visits records every call (ordered / no order + reason) so
--    planned vs visited vs productive calls can be reported.
--
-- 2. IRD (Inland Revenue Department, Nepal)
--    ird_sales_materialized is the "materialized view" the e-billing
--    directive asks for: one row per sales bill / sales return, kept by
--    triggers (never by application code), with printed / active / synced
--    flags. Triggers also stop a posted bill or return from being deleted
--    or having its figures changed (cancel only) and write every posting,
--    cancellation and print to ird_bill_audit_log. ird_settings + ird_sync_log drive the CBMS push
--    (api/bill, api/billreturn) with a queue and retries.
--
-- 3. AGENT TARGETS
--    Target per salesman per period (month / quarter / year or a custom
--    range) for all products or one product / product group / product
--    company / product category, in qty and/or value, with a commission
--    rule. agent_commission_postings is the posted register: a target that
--    is already posted is skipped next time (unique while posted).
--
-- 4. BUDGET DIMENSIONS
--    A budget line can now also be narrowed to a sub-ledger, cost center,
--    unit, branch and document class, and split month-wise.
-- =============================================

-- ---------- 1. route plan + visits ----------
CREATE TABLE IF NOT EXISTS tenant_master.route_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    agent_id UUID NOT NULL REFERENCES tenant_master.salesman_agents(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES tenant_master.routes(id) ON DELETE CASCADE,
    plan_type VARCHAR(10) NOT NULL DEFAULT 'date',
    plan_date DATE,
    weekday SMALLINT,
    notes VARCHAR(250),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT valid_route_plan_type CHECK (plan_type IN ('date', 'weekday')),
    CONSTRAINT route_plan_has_day CHECK ((plan_type = 'date' AND plan_date IS NOT NULL AND weekday IS NULL) OR (plan_type = 'weekday' AND weekday BETWEEN 0 AND 6 AND plan_date IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_route_plan_date ON tenant_master.route_plans(agent_id, route_id, plan_date) WHERE plan_type = 'date';
CREATE UNIQUE INDEX IF NOT EXISTS ux_route_plan_weekday ON tenant_master.route_plans(agent_id, route_id, weekday) WHERE plan_type = 'weekday';
CREATE INDEX IF NOT EXISTS idx_route_plans_agent ON tenant_master.route_plans(tenant_id, agent_id);

CREATE TABLE IF NOT EXISTS tenant_master.mobile_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    agent_id UUID NOT NULL REFERENCES tenant_master.salesman_agents(id),
    route_id UUID REFERENCES tenant_master.routes(id),
    ledger_account_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    visit_date DATE NOT NULL,
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    outcome VARCHAR(12) NOT NULL DEFAULT 'ordered',
    no_order_reason VARCHAR(40),
    remarks VARCHAR(250),
    order_id UUID REFERENCES tenant_master.sales_orders(id) ON DELETE SET NULL,
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    created_by UUID,
    CONSTRAINT valid_visit_outcome CHECK (outcome IN ('ordered', 'no_order', 'closed'))
);
CREATE INDEX IF NOT EXISTS idx_mobile_visits_day ON tenant_master.mobile_visits(tenant_id, visit_date, agent_id);

ALTER TABLE tenant_master.sales_orders
    ADD COLUMN IF NOT EXISTS order_source VARCHAR(10) DEFAULT 'desk',
    ADD COLUMN IF NOT EXISTS mobile_visit_id UUID,
    ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7),
    ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7);
ALTER TABLE tenant_master.salesman_agents
    ADD COLUMN IF NOT EXISTS allow_rate_change_on_mobile_order BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mobile_order_status VARCHAR(10) DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS allow_off_route_orders BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS default_warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    ADD COLUMN IF NOT EXISTS commission_expense_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS commission_payable_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);

-- ---------- 2. IRD ----------
CREATE TABLE IF NOT EXISTS tenant_master.ird_sales_materialized (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    doc_type VARCHAR(12) NOT NULL,                 -- sales_bill | sales_return
    source_id UUID NOT NULL,
    fiscal_year VARCHAR(12),
    bill_no VARCHAR(40) NOT NULL,
    ref_bill_no VARCHAR(40),                        -- returns: the original bill
    customer_name VARCHAR(200),
    customer_pan VARCHAR(20),
    bill_date DATE NOT NULL,
    bill_date_bs VARCHAR(12),
    amount DECIMAL(15, 2) DEFAULT 0,                -- gross before discount
    discount DECIMAL(15, 2) DEFAULT 0,
    taxable_amount DECIMAL(15, 2) DEFAULT 0,
    non_taxable_amount DECIMAL(15, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    total_amount DECIMAL(15, 2) DEFAULT 0,
    payment_method VARCHAR(20),
    return_reason VARCHAR(250),
    sync_with_ird BOOLEAN DEFAULT FALSE,
    is_bill_printed BOOLEAN DEFAULT FALSE,
    print_count INTEGER DEFAULT 0,
    is_bill_active BOOLEAN DEFAULT TRUE,
    printed_time TIMESTAMPTZ,
    printed_by UUID,
    entered_by UUID,
    is_realtime BOOLEAN DEFAULT FALSE,
    vat_refund_amount DECIMAL(15, 2) DEFAULT 0,
    transaction_id VARCHAR(60),
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_ird_doc_type CHECK (doc_type IN ('sales_bill', 'sales_return')),
    CONSTRAINT unique_ird_source UNIQUE (doc_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_ird_mat_date ON tenant_master.ird_sales_materialized(tenant_id, bill_date);

CREATE TABLE IF NOT EXISTS tenant_master.ird_bill_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    doc_type VARCHAR(12) NOT NULL,
    source_id UUID NOT NULL,
    bill_no VARCHAR(40),
    action VARCHAR(20) NOT NULL,                   -- insert | update | post | cancel | print | delete_blocked | edit_blocked
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    changed_fields TEXT,
    performed_by UUID,
    performed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ird_audit_source ON tenant_master.ird_bill_audit_log(doc_type, source_id);

CREATE TABLE IF NOT EXISTS tenant_master.ird_settings (
    tenant_id UUID PRIMARY KEY,
    enabled BOOLEAN DEFAULT FALSE,
    api_base_url VARCHAR(200) DEFAULT 'https://cbapi.ird.gov.np',
    username VARCHAR(100),
    password VARCHAR(200),
    seller_pan VARCHAR(20),
    is_realtime BOOLEAN DEFAULT TRUE,
    auto_sync_on_post BOOLEAN DEFAULT TRUE,
    max_attempts INTEGER DEFAULT 5,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

CREATE TABLE IF NOT EXISTS tenant_master.ird_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    doc_type VARCHAR(12) NOT NULL,
    source_id UUID NOT NULL,
    bill_no VARCHAR(40),
    status VARCHAR(10) NOT NULL DEFAULT 'pending', -- pending | success | failed | skipped
    attempts INTEGER DEFAULT 0,
    response_code VARCHAR(10),
    response_message TEXT,
    request_payload JSONB,
    last_attempt_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_ird_sync_source UNIQUE (doc_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_ird_sync_status ON tenant_master.ird_sync_log(tenant_id, status);

-- BS date text (YYYY.MM.DD) is filled by the application (the BS table
-- lives in the app); the trigger keeps everything else.
CREATE OR REPLACE FUNCTION tenant_master.ird_sync_materialized() RETURNS TRIGGER AS $$
DECLARE
    v_type TEXT := CASE WHEN TG_TABLE_NAME = 'sales_bills' THEN 'sales_bill' ELSE 'sales_return' END;
    v_pan TEXT; v_name TEXT; v_gross NUMERIC; v_disc NUMERIC; v_taxable NUMERIC; v_nontax NUMERIC; v_ref TEXT; v_reason TEXT; v_pay TEXT;
BEGIN
    IF NEW.status NOT IN ('posted', 'cancelled') THEN RETURN NEW; END IF;
    -- a draft that is cancelled was never issued: it does not enter the register
    IF NEW.status = 'cancelled' AND (TG_OP = 'INSERT' OR OLD.status <> 'posted') THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN RETURN NEW; END IF;
    SELECT pan_number, COALESCE(NULLIF(billing_name, ''), account_name) INTO v_pan, v_name FROM tenant_master.ledger_accounts WHERE id = NEW.customer_ledger_id;
    IF v_type = 'sales_bill' THEN
        SELECT COALESCE(SUM(qty * rate), 0), COALESCE(SUM(discount_amount), 0),
               COALESCE(SUM(CASE WHEN tax_amount <> 0 THEN amount - tax_amount ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN tax_amount = 0 THEN amount ELSE 0 END), 0)
          INTO v_gross, v_disc, v_taxable, v_nontax FROM tenant_master.sales_bill_details WHERE bill_id = NEW.id;
        v_pay := NEW.invoice_type;
    ELSE
        SELECT COALESCE(SUM(qty * rate), 0), COALESCE(SUM(discount_amount), 0),
               COALESCE(SUM(CASE WHEN tax_amount <> 0 THEN amount - tax_amount ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN tax_amount = 0 THEN amount ELSE 0 END), 0)
          INTO v_gross, v_disc, v_taxable, v_nontax FROM tenant_master.sales_return_details WHERE return_id = NEW.id;
        SELECT doc_no INTO v_ref FROM tenant_master.sales_bills WHERE id = NEW.source_bill_id;
        v_reason := NEW.return_reason;
    END IF;
    INSERT INTO tenant_master.ird_sales_materialized AS m
        (tenant_id, doc_type, source_id, bill_no, ref_bill_no, customer_name, customer_pan, bill_date, amount, discount, taxable_amount, non_taxable_amount,
         tax_amount, total_amount, payment_method, return_reason, is_bill_active, entered_by, cancelled_at, cancel_reason)
    VALUES (NEW.tenant_id, v_type, NEW.id, NEW.doc_no, v_ref, v_name, v_pan, NEW.doc_date, v_gross, v_disc, v_taxable, v_nontax,
         COALESCE(NEW.total_tax_amount, 0), COALESCE(NEW.total_amount, 0), v_pay, v_reason, NEW.status = 'posted', NEW.created_by,
         CASE WHEN NEW.status = 'cancelled' THEN COALESCE(NEW.cancelled_at, NOW()) END, CASE WHEN NEW.status = 'cancelled' THEN NEW.cancellation_reason END)
    ON CONFLICT (doc_type, source_id) DO UPDATE SET
        is_bill_active = EXCLUDED.is_bill_active, cancelled_at = EXCLUDED.cancelled_at, cancel_reason = EXCLUDED.cancel_reason,
        -- figures are frozen once posted: only the first posting writes them
        customer_name = COALESCE(m.customer_name, EXCLUDED.customer_name), customer_pan = COALESCE(m.customer_pan, EXCLUDED.customer_pan),
        updated_at = NOW();
    INSERT INTO tenant_master.ird_bill_audit_log (tenant_id, doc_type, source_id, bill_no, action, old_status, new_status, performed_by)
    VALUES (NEW.tenant_id, v_type, NEW.id, NEW.doc_no, CASE WHEN NEW.status = 'cancelled' THEN 'cancel' ELSE 'post' END,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, NEW.updated_by);
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Posted / cancelled documents are locked: no delete, and the only change
-- allowed is posted -> cancelled (plus housekeeping columns).
CREATE OR REPLACE FUNCTION tenant_master.ird_guard_bill() RETURNS TRIGGER AS $$
DECLARE v_type TEXT := CASE WHEN TG_TABLE_NAME = 'sales_bills' THEN 'sales_bill' ELSE 'sales_return' END;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'IRD: % % % cannot be deleted - cancel it instead', initcap(OLD.status), replace(v_type, '_', ' '), OLD.doc_no;
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status IN ('posted', 'cancelled') THEN
        IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
            RAISE EXCEPTION 'IRD: a cancelled % cannot be re-opened', replace(v_type, '_', ' ');
        END IF;
        IF NEW.doc_no IS DISTINCT FROM OLD.doc_no OR NEW.doc_date IS DISTINCT FROM OLD.doc_date
           OR NEW.customer_ledger_id IS DISTINCT FROM OLD.customer_ledger_id
           OR NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.total_tax_amount IS DISTINCT FROM OLD.total_tax_amount THEN
            RAISE EXCEPTION 'IRD: posted % % cannot be modified - cancel and re-issue', replace(v_type, '_', ' '), OLD.doc_no;
        END IF;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- detail lines of a posted document are locked too
CREATE OR REPLACE FUNCTION tenant_master.ird_guard_lines() RETURNS TRIGGER AS $$
DECLARE v_status TEXT; v_row RECORD;
BEGIN
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    IF TG_TABLE_NAME = 'sales_bill_details' THEN
        SELECT status INTO v_status FROM tenant_master.sales_bills WHERE id = v_row.bill_id;
    ELSE
        SELECT status INTO v_status FROM tenant_master.sales_returns WHERE id = v_row.return_id;
    END IF;
    IF v_status IN ('posted', 'cancelled') AND TG_OP IN ('DELETE', 'INSERT') THEN
        RAISE EXCEPTION 'IRD: lines of a % document cannot be changed', v_status;
    END IF;
    IF TG_OP = 'UPDATE' AND v_status IN ('posted', 'cancelled')
       AND (NEW.qty IS DISTINCT FROM OLD.qty OR NEW.rate IS DISTINCT FROM OLD.rate OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
        RAISE EXCEPTION 'IRD: lines of a % document cannot be changed', v_status;
    END IF;
    RETURN v_row;
END; $$ LANGUAGE plpgsql;

-- every print of a sales bill / return marks the materialized row
CREATE OR REPLACE FUNCTION tenant_master.ird_mark_printed() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.document_type IN ('sales_bill', 'sales_return') THEN
        UPDATE tenant_master.ird_sales_materialized
           SET is_bill_printed = TRUE, print_count = print_count + 1,
               printed_time = COALESCE(printed_time, NEW.printed_at), printed_by = COALESCE(printed_by, NEW.printed_by), updated_at = NOW()
         WHERE doc_type = NEW.document_type AND source_id = NEW.document_id;
        INSERT INTO tenant_master.ird_bill_audit_log (tenant_id, doc_type, source_id, action, performed_by)
        VALUES (NEW.tenant_id, NEW.document_type, NEW.document_id, 'print', NEW.printed_by);
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ird_sales_bills_mat ON tenant_master.sales_bills;
CREATE TRIGGER trg_ird_sales_bills_mat AFTER INSERT OR UPDATE OF status ON tenant_master.sales_bills
    FOR EACH ROW EXECUTE FUNCTION tenant_master.ird_sync_materialized();
DROP TRIGGER IF EXISTS trg_ird_sales_returns_mat ON tenant_master.sales_returns;
CREATE TRIGGER trg_ird_sales_returns_mat AFTER INSERT OR UPDATE OF status ON tenant_master.sales_returns
    FOR EACH ROW EXECUTE FUNCTION tenant_master.ird_sync_materialized();
DROP TRIGGER IF EXISTS trg_ird_sales_bills_guard ON tenant_master.sales_bills;
CREATE TRIGGER trg_ird_sales_bills_guard BEFORE UPDATE OR DELETE ON tenant_master.sales_bills
    FOR EACH ROW EXECUTE FUNCTION tenant_master.ird_guard_bill();
DROP TRIGGER IF EXISTS trg_ird_sales_returns_guard ON tenant_master.sales_returns;
CREATE TRIGGER trg_ird_sales_returns_guard BEFORE UPDATE OR DELETE ON tenant_master.sales_returns
    FOR EACH ROW EXECUTE FUNCTION tenant_master.ird_guard_bill();
DROP TRIGGER IF EXISTS trg_ird_sales_bill_lines_guard ON tenant_master.sales_bill_details;
CREATE TRIGGER trg_ird_sales_bill_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant_master.sales_bill_details
    FOR EACH ROW EXECUTE FUNCTION tenant_master.ird_guard_lines();
DROP TRIGGER IF EXISTS trg_ird_sales_return_lines_guard ON tenant_master.sales_return_details;
CREATE TRIGGER trg_ird_sales_return_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant_master.sales_return_details
    FOR EACH ROW EXECUTE FUNCTION tenant_master.ird_guard_lines();
DROP TRIGGER IF EXISTS trg_ird_print_log ON tenant_master.document_print_log;
CREATE TRIGGER trg_ird_print_log AFTER INSERT ON tenant_master.document_print_log
    FOR EACH ROW EXECUTE FUNCTION tenant_master.ird_mark_printed();

-- back-fill documents posted before this migration
INSERT INTO tenant_master.ird_sales_materialized (tenant_id, doc_type, source_id, bill_no, customer_name, customer_pan, bill_date, taxable_amount, tax_amount, total_amount, payment_method, is_bill_active, entered_by)
SELECT b.tenant_id, 'sales_bill', b.id, b.doc_no, COALESCE(NULLIF(l.billing_name, ''), l.account_name), l.pan_number, b.doc_date,
       COALESCE(b.total_amount, 0) - COALESCE(b.total_tax_amount, 0), COALESCE(b.total_tax_amount, 0), COALESCE(b.total_amount, 0), b.invoice_type, b.status = 'posted', b.created_by
  FROM tenant_master.sales_bills b LEFT JOIN tenant_master.ledger_accounts l ON l.id = b.customer_ledger_id
 WHERE b.status IN ('posted', 'cancelled')
ON CONFLICT (doc_type, source_id) DO NOTHING;
INSERT INTO tenant_master.ird_sales_materialized (tenant_id, doc_type, source_id, bill_no, customer_name, customer_pan, bill_date, taxable_amount, tax_amount, total_amount, return_reason, is_bill_active, entered_by)
SELECT r.tenant_id, 'sales_return', r.id, r.doc_no, COALESCE(NULLIF(l.billing_name, ''), l.account_name), l.pan_number, r.doc_date,
       COALESCE(r.total_amount, 0) - COALESCE(r.total_tax_amount, 0), COALESCE(r.total_tax_amount, 0), COALESCE(r.total_amount, 0), r.return_reason, r.status = 'posted', r.created_by
  FROM tenant_master.sales_returns r LEFT JOIN tenant_master.ledger_accounts l ON l.id = r.customer_ledger_id
 WHERE r.status IN ('posted', 'cancelled')
ON CONFLICT (doc_type, source_id) DO NOTHING;

-- ---------- 3. agent targets + commission ----------
CREATE TABLE IF NOT EXISTS tenant_master.agent_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    agent_id UUID NOT NULL REFERENCES tenant_master.salesman_agents(id) ON DELETE CASCADE,
    period_type VARCHAR(10) NOT NULL DEFAULT 'month',  -- month | quarter | year | custom
    period_label VARCHAR(40),
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    dimension VARCHAR(20) NOT NULL DEFAULT 'all',      -- all | product | product_group | product_company | category
    dimension_id UUID,
    target_qty DECIMAL(18, 4) DEFAULT 0,
    target_value DECIMAL(18, 2) DEFAULT 0,
    commission_basis VARCHAR(20) DEFAULT 'value_percent', -- value_percent | qty_rate | fixed
    commission_rate DECIMAL(12, 4) DEFAULT 0,          -- % of value, or amount per qty
    fixed_commission DECIMAL(15, 2) DEFAULT 0,
    min_achievement_pct DECIMAL(6, 2) DEFAULT 0,       -- commission only when achieved at least this % of target
    remarks VARCHAR(250),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT valid_target_period CHECK (period_type IN ('month', 'quarter', 'year', 'custom')),
    CONSTRAINT valid_target_dimension CHECK (dimension IN ('all', 'product', 'product_group', 'product_company', 'category')),
    CONSTRAINT valid_target_basis CHECK (commission_basis IN ('value_percent', 'qty_rate', 'fixed')),
    CONSTRAINT target_dates CHECK (period_to >= period_from),
    CONSTRAINT target_dimension_id CHECK (dimension = 'all' OR dimension_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_agent_targets_agent ON tenant_master.agent_targets(tenant_id, agent_id, period_from);

CREATE TABLE IF NOT EXISTS tenant_master.agent_commission_postings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    doc_no VARCHAR(30) NOT NULL,
    posting_date DATE NOT NULL,
    agent_id UUID NOT NULL REFERENCES tenant_master.salesman_agents(id),
    target_id UUID NOT NULL REFERENCES tenant_master.agent_targets(id),
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    target_qty DECIMAL(18, 4) DEFAULT 0,
    target_value DECIMAL(18, 2) DEFAULT 0,
    achieved_qty DECIMAL(18, 4) DEFAULT 0,
    achieved_value DECIMAL(18, 2) DEFAULT 0,
    achievement_pct DECIMAL(8, 2),
    commission_amount DECIMAL(15, 2) NOT NULL,
    expense_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    payable_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    narration TEXT,
    status VARCHAR(10) NOT NULL DEFAULT 'posted',
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT valid_commission_status CHECK (status IN ('posted', 'cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_commission_target_posted ON tenant_master.agent_commission_postings(target_id) WHERE status = 'posted';
CREATE INDEX IF NOT EXISTS idx_commission_agent ON tenant_master.agent_commission_postings(tenant_id, agent_id);

-- ---------- 4. budget dimensions ----------
ALTER TABLE tenant_master.budgets
    ADD COLUMN IF NOT EXISTS split_type VARCHAR(10) DEFAULT 'total';   -- total | monthly
ALTER TABLE tenant_master.budget_lines
    ADD COLUMN IF NOT EXISTS sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES tenant_master.business_units(id),
    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES tenant_master.branches(id),
    ADD COLUMN IF NOT EXISTS doc_class_id UUID REFERENCES tenant_master.document_numbering_categories(id),
    ADD COLUMN IF NOT EXISTS month_amounts JSONB;                      -- {"2025-07": 1000, ...}
-- the same ledger can now appear once per dimension combination
DROP INDEX IF EXISTS tenant_master.ux_budget_line_ledger;
DROP INDEX IF EXISTS tenant_master.ux_budget_line_group;
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_line_target_dims ON tenant_master.budget_lines(
    budget_id, COALESCE(ledger_id, account_group_id),
    COALESCE(sub_ledger_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(doc_class_id, '00000000-0000-0000-0000-000000000000'::uuid));
