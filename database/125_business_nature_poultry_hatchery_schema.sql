-- =============================================
-- 125: Business Nature + Poultry (broiler) & Hatchery management
--
-- System Control > Business Nature: trading (default), manufacturing,
-- distribution, retail, service, poultry. With "poultry" the Poultry
-- menus appear; poultry_features says which parts are on
-- ({"broiler": true, "hatchery": true}).
--
-- How poultry stays inside normal accounting / inventory (nothing new is
-- posted outside the existing documents):
--   * every stock effect is a normal Stock Adjustment, posted through the
--     same code as the Stock Adjustment screen (stock_movements, costing,
--     negative-stock control, optional GL entry, cancel = reverse):
--       chick placement, feed / medicine / vaccine use  -> decrease
--         (reason 'consumption', cost center = the batch)
--       birds lifted for sale, chicks hatched          -> increase
--         (reason 'production', at cost)
--   * each shed and each batch has its own Cost Center, so sales bills,
--     expenses (JV, cash / bank, purchase expenses) tagged with it and the
--     cost-center reports all line up with the poultry reports;
--   * bird sales are ordinary Sales Bills (a draft can be made from a
--     lifting).
-- Batch profit = sales (bills of the batch cost center) - stock issued to
-- the batch (chicks, feed, medicine, vaccine...) - direct expenses of the
-- batch cost center - its share of the shed's expenses (by bird-days).
-- KPIs as used by broiler integrators / breed companies: livability,
-- mortality %, FCR (feed kg / live kg), average weight, EPEF
-- (livability % x avg kg / (age days x FCR) x 100), cost per kg / bird.
-- Hatchery: fertility %, hatchability on eggs set, hatch of fertile %,
-- cost per saleable chick.
-- Re-run safe.
-- =============================================

-- ---------- business nature ----------
ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS business_nature VARCHAR(20) NOT NULL DEFAULT 'trading';
ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS poultry_features JSONB NOT NULL DEFAULT '{"broiler": true, "hatchery": false}';
ALTER TABLE tenant_master.system_control_settings DROP CONSTRAINT IF EXISTS valid_business_nature;
ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_business_nature
    CHECK (business_nature IN ('trading', 'manufacturing', 'distribution', 'retail', 'service', 'poultry'));

-- ---------- stock adjustment reasons used by poultry ----------
ALTER TABLE tenant_master.stock_adjustments DROP CONSTRAINT IF EXISTS valid_adjustment_reason;
ALTER TABLE tenant_master.stock_adjustments ADD CONSTRAINT valid_adjustment_reason
    CHECK (reason IN ('physical_count', 'shortage', 'damage', 'expiry', 'excess', 'other', 'consumption', 'production'));
ALTER TABLE tenant_master.stock_adjustment_details DROP CONSTRAINT IF EXISTS valid_adjustment_line_reason;
ALTER TABLE tenant_master.stock_adjustment_details ADD CONSTRAINT valid_adjustment_line_reason
    CHECK (line_reason IS NULL OR line_reason IN ('physical_count', 'shortage', 'damage', 'expiry', 'excess', 'other', 'consumption', 'production'));
ALTER TABLE tenant_master.stock_adjustments ADD COLUMN IF NOT EXISTS source_module VARCHAR(30);      -- 'poultry' when made by the poultry screens

-- ---------- settings ----------
CREATE TABLE IF NOT EXISTS tenant_master.poultry_settings (
    tenant_id UUID PRIMARY KEY,
    consumption_ledger_id UUID,        -- Dr when chicks / feed / medicine are used by a batch (expense)
    transfer_ledger_id UUID,           -- Cr when birds / chicks are taken into stock at cost (production transfer)
    default_warehouse_id UUID,         -- feed / medicine store
    live_bird_product_id UUID,         -- the item sold (live broiler, usually in kg)
    live_bird_unit VARCHAR(10) NOT NULL DEFAULT 'kg',      -- kg | bird
    brooding_days INTEGER NOT NULL DEFAULT 14,
    grower_days INTEGER NOT NULL DEFAULT 28,
    incubation_days INTEGER NOT NULL DEFAULT 21,
    candling_day INTEGER NOT NULL DEFAULT 10,
    transfer_day INTEGER NOT NULL DEFAULT 18,
    updated_by UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- which products are chicks / feed / medicine ... (drives FCR and cost split)
CREATE TABLE IF NOT EXISTS tenant_master.poultry_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    kg_per_unit NUMERIC(12,4) NOT NULL DEFAULT 1,   -- feed: kg in one base unit (a 50 kg bag = 50)
    CONSTRAINT valid_poultry_item_role CHECK (role IN ('chick', 'feed', 'medicine', 'vaccine', 'litter', 'other', 'live_bird', 'hatching_egg', 'table_egg', 'cull_bird')),
    CONSTRAINT unique_poultry_item UNIQUE (tenant_id, product_id)
);

CREATE TABLE IF NOT EXISTS tenant_master.poultry_sheds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    shed_code VARCHAR(30) NOT NULL,
    shed_name VARCHAR(150) NOT NULL,
    shed_type VARCHAR(15) NOT NULL DEFAULT 'broiler',      -- broiler | hatchery
    farm_name VARCHAR(150),
    location TEXT,
    capacity INTEGER,                                   -- birds (broiler) or eggs per setting (hatchery)
    area_sqft NUMERIC(12,2),
    warehouse_id UUID,                                  -- store the shed draws from (default: settings)
    cost_center_id UUID,                                -- made automatically
    supervisor VARCHAR(150),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    remarks TEXT,
    created_by UUID, updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_shed_type CHECK (shed_type IN ('broiler', 'hatchery')),
    CONSTRAINT unique_shed_code UNIQUE (tenant_id, shed_code)
);

CREATE TABLE IF NOT EXISTS tenant_master.poultry_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    serial_no INTEGER NOT NULL,
    batch_no VARCHAR(30) NOT NULL,
    shed_id UUID NOT NULL REFERENCES tenant_master.poultry_sheds(id),
    breed VARCHAR(60),                                  -- Cobb 500, Ross 308 ...
    chick_source VARCHAR(150),                          -- hatchery / supplier
    placement_date DATE NOT NULL,
    chicks_placed INTEGER NOT NULL,
    free_chicks INTEGER NOT NULL DEFAULT 0,             -- extra chicks given free (count, no cost)
    chick_product_id UUID,
    chick_cost_manual NUMERIC(14,2) NOT NULL DEFAULT 0, -- when chicks are not issued from stock
    placement_adjustment_id UUID,                       -- the stock adjustment that issued the chicks
    cost_center_id UUID,
    target_weight_kg NUMERIC(8,3),
    expected_close_date DATE,
    status VARCHAR(10) NOT NULL DEFAULT 'active',       -- active | closed
    closed_on DATE,
    close_notes TEXT,
    remarks TEXT,
    created_by UUID, updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_batch_status CHECK (status IN ('active', 'closed')),
    CONSTRAINT valid_chicks_placed CHECK (chicks_placed > 0),
    CONSTRAINT unique_poultry_batch UNIQUE (tenant_id, serial_no)
);
CREATE INDEX IF NOT EXISTS idx_poultry_batches_shed ON tenant_master.poultry_batches(tenant_id, shed_id, placement_date);

-- one row per batch per day: mortality, culls, weight, environment + what was used
CREATE TABLE IF NOT EXISTS tenant_master.poultry_daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    batch_id UUID NOT NULL REFERENCES tenant_master.poultry_batches(id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    mortality INTEGER NOT NULL DEFAULT 0,
    culls INTEGER NOT NULL DEFAULT 0,
    mortality_reason VARCHAR(60),
    avg_weight_g NUMERIC(10,2),                         -- sample average body weight
    water_l NUMERIC(12,2),
    temp_min NUMERIC(5,2), temp_max NUMERIC(5,2), humidity NUMERIC(5,2),
    remarks TEXT,
    consumption_adjustment_id UUID,                     -- stock adjustment for the items used that day
    created_by UUID, updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_log_counts CHECK (mortality >= 0 AND culls >= 0),
    CONSTRAINT unique_batch_day UNIQUE (batch_id, log_date)
);
CREATE TABLE IF NOT EXISTS tenant_master.poultry_log_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    log_id UUID NOT NULL REFERENCES tenant_master.poultry_daily_logs(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    role VARCHAR(20),
    qty NUMERIC(14,4) NOT NULL,
    uom_id UUID,
    warehouse_id UUID,
    rate NUMERIC(14,4) NOT NULL DEFAULT 0,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    feed_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
    CONSTRAINT valid_log_item_qty CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_poultry_log_items_log ON tenant_master.poultry_log_items(log_id);

-- birds taken out of the shed (sold / transferred)
CREATE TABLE IF NOT EXISTS tenant_master.poultry_liftings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    batch_id UUID NOT NULL REFERENCES tenant_master.poultry_batches(id) ON DELETE CASCADE,
    lift_date DATE NOT NULL,
    birds INTEGER NOT NULL,
    weight_kg NUMERIC(12,3) NOT NULL,
    rate NUMERIC(12,2) NOT NULL DEFAULT 0,              -- per kg (or per bird)
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    customer_ledger_id UUID,
    vehicle_no VARCHAR(40),
    remarks TEXT,
    stock_adjustment_id UUID,                           -- birds taken into stock at cost
    sales_bill_id UUID,                                 -- draft sales bill made from it
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_lifting CHECK (birds > 0 AND weight_kg > 0)
);
CREATE INDEX IF NOT EXISTS idx_poultry_liftings_batch ON tenant_master.poultry_liftings(batch_id, lift_date);

-- optional breed standard curve (body weight / cumulative feed by age)
CREATE TABLE IF NOT EXISTS tenant_master.poultry_breed_standards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    breed VARCHAR(60) NOT NULL,
    age_day INTEGER NOT NULL,
    body_weight_g NUMERIC(10,2),
    cum_feed_g NUMERIC(10,2),
    livability_pct NUMERIC(6,2),
    CONSTRAINT unique_breed_day UNIQUE (tenant_id, breed, age_day)
);

-- ---------- hatchery ----------
CREATE TABLE IF NOT EXISTS tenant_master.poultry_hatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    serial_no INTEGER NOT NULL,
    hatch_no VARCHAR(30) NOT NULL,
    hatchery_id UUID REFERENCES tenant_master.poultry_sheds(id),   -- a shed of type 'hatchery'
    setter_no VARCHAR(30),
    egg_source VARCHAR(150),                             -- own breeder flock / supplier
    set_date DATE NOT NULL,
    egg_product_id UUID,
    eggs_set INTEGER NOT NULL,
    egg_cost_manual NUMERIC(14,2) NOT NULL DEFAULT 0,    -- when eggs are not issued from stock
    set_adjustment_id UUID,
    candling_date DATE,
    infertile INTEGER NOT NULL DEFAULT 0,                -- clears at candling
    early_dead INTEGER NOT NULL DEFAULT 0,
    cracked INTEGER NOT NULL DEFAULT 0,
    transfer_date DATE,                                  -- setter -> hatcher
    hatch_date DATE,
    chicks_a INTEGER NOT NULL DEFAULT 0,                 -- saleable chicks
    chicks_b INTEGER NOT NULL DEFAULT 0,                 -- culls / second grade
    dead_in_shell INTEGER NOT NULL DEFAULT 0,
    chick_product_id UUID,
    chick_b_product_id UUID,
    infertile_product_id UUID,                           -- infertile eggs kept for sale (e.g. table eggs)
    infertile_rate NUMERIC(12,4) NOT NULL DEFAULT 0,
    chick_b_rate NUMERIC(12,4) NOT NULL DEFAULT 0,
    output_warehouse_id UUID,
    output_adjustment_id UUID,
    cost_center_id UUID,
    status VARCHAR(10) NOT NULL DEFAULT 'set',           -- set | candled | hatched | cancelled
    remarks TEXT,
    created_by UUID, updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_hatch_status CHECK (status IN ('set', 'candled', 'hatched', 'cancelled')),
    CONSTRAINT valid_eggs_set CHECK (eggs_set > 0),
    CONSTRAINT valid_hatch_counts CHECK (infertile >= 0 AND early_dead >= 0 AND cracked >= 0 AND chicks_a >= 0 AND chicks_b >= 0 AND dead_in_shell >= 0
        AND infertile + early_dead + cracked + chicks_a + chicks_b + dead_in_shell <= eggs_set),
    CONSTRAINT unique_poultry_hatch UNIQUE (tenant_id, serial_no)
);

-- security group module "poultry" for admin groups
DO $$
DECLARE all_rights JSONB := '{"view": true, "create": true, "edit": true, "delete": true, "print": true, "export": true}';
BEGIN
    UPDATE tenant_master.security_rights_groups g
    SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object('poultry', all_rights)
    WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'poultry')
      AND (group_code ILIKE 'ADMIN%' OR EXISTS (SELECT 1 FROM tenant_master.users u WHERE u.security_group_id = g.id AND u.is_company_admin));
END $$;

-- the audit log (file 121) covers the new tables
DO $$ BEGIN
    IF to_regproc('tenant_master.audit_attach_all') IS NOT NULL THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
