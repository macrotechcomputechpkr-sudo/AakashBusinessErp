-- =============================================
-- 133: AUTOMOBILE DEALERSHIP (Business Nature = Automobile)
-- Showroom
--   enquiries      customer enquiry / lead with follow-ups, test drive, status
--   vehicles       every vehicle by chassis: new stock and customers' vehicles
--   PDI            pre-delivery inspection checklist of a new vehicle
--   deliveries     vehicle handed to the customer (documents, keys, accessories),
--                  optionally tied to the Sales Bill; sets the free-service reminders
-- After sales (workshop)
--   job cards      vehicle in with complaints -> labour, parts issued from stock,
--                  outside work -> ready for delivery -> delivered (job invoice posted)
--   reminders      service due by date / km, with call status
-- Posting (ledger_transaction_batches):
--   parts issue    consumption Stock Adjustment (cost of parts)
--   outside work   Dr outside work cost, Cr the outside workshop
--   job invoice    Dr customer (or cash), Cr parts sales / labour income /
--                  outside work income / VAT
-- Re-run safe. Nothing existing is removed.
-- =============================================

ALTER TABLE tenant_master.system_control_settings DROP CONSTRAINT IF EXISTS valid_business_nature;
ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_business_nature
    CHECK (business_nature IN ('trading', 'manufacturing', 'distribution', 'retail', 'service', 'poultry', 'construction', 'automobile'));

CREATE TABLE IF NOT EXISTS tenant_master.auto_settings (
    tenant_id UUID PRIMARY KEY,
    parts_sales_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    labour_income_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    outside_work_income_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    outside_work_cost_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    parts_consumption_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    cash_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    parts_warehouse_id UUID,
    vat_percent DECIMAL(5, 2) NOT NULL DEFAULT 13,
    service_interval_days INTEGER NOT NULL DEFAULT 120,
    service_interval_km INTEGER NOT NULL DEFAULT 5000,
    free_services JSONB NOT NULL DEFAULT '[{"name": "1st free service", "days": 30, "km": 1000}, {"name": "2nd free service", "days": 120, "km": 5000}, {"name": "3rd free service", "days": 240, "km": 10000}]',
    pdi_checklist JSONB NOT NULL DEFAULT '["Exterior body / paint", "Glass & mirrors", "Tyres & pressure (incl. spare)", "Engine oil level", "Coolant / brake fluid", "Battery & terminals", "Lights & indicators", "Horn & wipers", "AC / heater", "Infotainment / audio", "Brakes & handbrake", "Tool kit & jack", "Owner manual & service book", "Road test"]',
    updated_by UUID, updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_master.auto_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    chassis_no VARCHAR(60) NOT NULL,
    engine_no VARCHAR(60),
    product_id UUID REFERENCES tenant_master.products(id),       -- model as a stock item (new vehicles)
    model_name VARCHAR(150),
    variant VARCHAR(100),
    color VARCHAR(60),
    model_year INTEGER,
    reg_no VARCHAR(40),
    ownership VARCHAR(12) NOT NULL DEFAULT 'stock',              -- stock: our new vehicle; customer: a customer's vehicle
    customer_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    customer_name VARCHAR(150),
    customer_phone VARCHAR(40),
    purchase_bill_id UUID,
    sale_date DATE,
    odometer INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'in_stock',              -- in_stock / booked / pdi_done / delivered / customer
    remarks TEXT,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT auto_vehicle_ownership CHECK (ownership IN ('stock', 'customer')),
    CONSTRAINT auto_vehicle_status CHECK (status IN ('in_stock', 'booked', 'pdi_done', 'delivered', 'customer')),
    CONSTRAINT unique_auto_vehicle_chassis UNIQUE (tenant_id, chassis_no)
);
CREATE INDEX IF NOT EXISTS idx_auto_vehicles_reg ON tenant_master.auto_vehicles(tenant_id, reg_no);

CREATE TABLE IF NOT EXISTS tenant_master.auto_enquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    doc_no VARCHAR(30) NOT NULL,
    enquiry_date DATE NOT NULL,
    customer_name VARCHAR(150) NOT NULL,
    phone VARCHAR(40),
    email VARCHAR(150),
    address TEXT,
    customer_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    source VARCHAR(20) NOT NULL DEFAULT 'walk_in',               -- walk_in / phone / referral / social / event / web / other
    product_id UUID REFERENCES tenant_master.products(id),
    model_name VARCHAR(150),
    variant VARCHAR(100),
    color VARCHAR(60),
    budget DECIMAL(15, 2),
    finance_required BOOLEAN NOT NULL DEFAULT FALSE,
    exchange_vehicle VARCHAR(150),
    test_drive_date DATE,
    follow_up_date DATE,
    salesperson_id UUID,
    temperature VARCHAR(8) NOT NULL DEFAULT 'warm',              -- hot / warm / cold
    status VARCHAR(12) NOT NULL DEFAULT 'open',                  -- open / booked / delivered / lost
    booking_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    booking_date DATE,
    vehicle_id UUID REFERENCES tenant_master.auto_vehicles(id),
    lost_reason TEXT,
    remarks TEXT,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT auto_enquiry_status CHECK (status IN ('open', 'booked', 'delivered', 'lost')),
    CONSTRAINT auto_enquiry_temp CHECK (temperature IN ('hot', 'warm', 'cold'))
);
CREATE INDEX IF NOT EXISTS idx_auto_enquiries_status ON tenant_master.auto_enquiries(tenant_id, status);
CREATE TABLE IF NOT EXISTS tenant_master.auto_enquiry_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    enquiry_id UUID NOT NULL REFERENCES tenant_master.auto_enquiries(id) ON DELETE CASCADE,
    followup_date DATE NOT NULL,
    mode VARCHAR(12),                                            -- call / visit / sms / whatsapp / email
    note TEXT NOT NULL,
    next_date DATE,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_followups_enquiry ON tenant_master.auto_enquiry_followups(enquiry_id);

CREATE TABLE IF NOT EXISTS tenant_master.auto_pdis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    vehicle_id UUID NOT NULL REFERENCES tenant_master.auto_vehicles(id),
    doc_no VARCHAR(30) NOT NULL,
    pdi_date DATE NOT NULL,
    inspector VARCHAR(120),
    odometer INTEGER NOT NULL DEFAULT 0,
    fuel_level VARCHAR(20),
    checklist JSONB NOT NULL DEFAULT '[]',                       -- [{ item, ok, remark }]
    result VARCHAR(8) NOT NULL DEFAULT 'pass',                   -- pass / fail
    remarks TEXT,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT auto_pdi_result CHECK (result IN ('pass', 'fail'))
);
CREATE INDEX IF NOT EXISTS idx_auto_pdis_vehicle ON tenant_master.auto_pdis(vehicle_id);

CREATE TABLE IF NOT EXISTS tenant_master.auto_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    doc_no VARCHAR(30) NOT NULL,
    vehicle_id UUID NOT NULL REFERENCES tenant_master.auto_vehicles(id),
    enquiry_id UUID REFERENCES tenant_master.auto_enquiries(id),
    customer_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    customer_name VARCHAR(150) NOT NULL,
    customer_phone VARCHAR(40),
    delivery_date DATE NOT NULL,
    sales_bill_id UUID,
    finance_company VARCHAR(150),
    reg_no VARCHAR(40),
    odometer INTEGER NOT NULL DEFAULT 0,
    keys_given INTEGER NOT NULL DEFAULT 2,
    accessories TEXT,
    documents JSONB NOT NULL DEFAULT '[]',                       -- [{ item, given }]
    delivered_by VARCHAR(120),
    status VARCHAR(12) NOT NULL DEFAULT 'delivered',             -- delivered / cancelled
    remarks TEXT,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT auto_delivery_status CHECK (status IN ('delivered', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_auto_deliveries_vehicle ON tenant_master.auto_deliveries(vehicle_id);

CREATE TABLE IF NOT EXISTS tenant_master.auto_job_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    doc_no VARCHAR(30) NOT NULL,
    vehicle_id UUID NOT NULL REFERENCES tenant_master.auto_vehicles(id),
    customer_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    customer_name VARCHAR(150),
    customer_phone VARCHAR(40),
    date_in DATE NOT NULL,
    odometer_in INTEGER NOT NULL DEFAULT 0,
    fuel_level VARCHAR(20),
    service_type VARCHAR(16) NOT NULL DEFAULT 'paid',            -- free / paid / warranty / accident / running
    complaints TEXT,
    advisor VARCHAR(120),
    technician VARCHAR(120),
    promised_date DATE,
    status VARCHAR(16) NOT NULL DEFAULT 'open',                  -- open / in_progress / outside_work / ready / delivered / cancelled
    ready_at TIMESTAMPTZ,
    delivered_on DATE,
    reminder_id UUID,
    labour JSONB NOT NULL DEFAULT '[]',                          -- [{ description, hours, rate, amount, chargeable }]
    parts_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,              -- parts at selling price (chargeable)
    labour_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    outside_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,            -- outside work charged to the customer
    discount_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    vat_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    bill_to_ledger_id UUID,                                      -- customer or cash, set at delivery
    work_done TEXT,
    next_service_date DATE,
    next_service_km INTEGER,
    cancellation_reason TEXT,
    created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT auto_job_status CHECK (status IN ('open', 'in_progress', 'outside_work', 'ready', 'delivered', 'cancelled')),
    CONSTRAINT auto_job_type CHECK (service_type IN ('free', 'paid', 'warranty', 'accident', 'running'))
);
CREATE INDEX IF NOT EXISTS idx_auto_jobs_status ON tenant_master.auto_job_cards(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_auto_jobs_vehicle ON tenant_master.auto_job_cards(vehicle_id);

-- parts issued to a job card (and returned)
CREATE TABLE IF NOT EXISTS tenant_master.auto_job_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    job_id UUID NOT NULL REFERENCES tenant_master.auto_job_cards(id) ON DELETE CASCADE,
    issue_date DATE NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    qty DECIMAL(15, 4) NOT NULL,                                 -- negative = returned
    uom_id UUID,
    cost_rate DECIMAL(15, 4) NOT NULL DEFAULT 0,
    cost_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    sale_rate DECIMAL(15, 2) NOT NULL DEFAULT 0,
    sale_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    chargeable BOOLEAN NOT NULL DEFAULT TRUE,                    -- false: warranty / free
    adjustment_id UUID,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_job_parts_job ON tenant_master.auto_job_parts(job_id);

-- outside work (sublet) on a job card
CREATE TABLE IF NOT EXISTS tenant_master.auto_outside_works (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    job_id UUID NOT NULL REFERENCES tenant_master.auto_job_cards(id) ON DELETE CASCADE,
    doc_no VARCHAR(30) NOT NULL,
    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    vendor_name VARCHAR(150),
    work_description TEXT NOT NULL,
    sent_date DATE NOT NULL,
    received_date DATE,
    cost_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    charge_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'sent',                  -- sent / received
    posted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT auto_outside_status CHECK (status IN ('sent', 'received'))
);
CREATE INDEX IF NOT EXISTS idx_auto_outside_job ON tenant_master.auto_outside_works(job_id);

CREATE TABLE IF NOT EXISTS tenant_master.auto_service_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    vehicle_id UUID NOT NULL REFERENCES tenant_master.auto_vehicles(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    service_type VARCHAR(16) NOT NULL DEFAULT 'paid',
    due_date DATE NOT NULL,
    due_km INTEGER,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',               -- pending / contacted / booked / done / not_interested
    last_contact_date DATE,
    contact_note TEXT,
    job_id UUID,
    source VARCHAR(16),                                          -- delivery / job / manual
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT auto_reminder_status CHECK (status IN ('pending', 'contacted', 'booked', 'done', 'not_interested'))
);
CREATE INDEX IF NOT EXISTS idx_auto_reminders_due ON tenant_master.auto_service_reminders(tenant_id, status, due_date);

DO $$
DECLARE all_rights JSONB := '{"view": true, "create": true, "edit": true, "delete": true, "print": true, "export": true}';
BEGIN
    UPDATE tenant_master.security_rights_groups g
    SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object('automobile', all_rights)
    WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'automobile')
      AND (group_code ILIKE 'ADMIN%' OR EXISTS (SELECT 1 FROM tenant_master.users u WHERE u.security_group_id = g.id AND u.is_company_admin));
END $$;

DO $$ BEGIN
    IF to_regproc('tenant_master.audit_attach_all') IS NOT NULL THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
