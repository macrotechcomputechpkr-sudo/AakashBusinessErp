-- =============================================
-- 129: HATCHERY -> OWN BROILER SHEDS
--  1. A hatch's A-grade chicks can be placed straight into the company's own
--     broiler sheds - one lot (batch) per shed; the lot keeps the hatch it
--     came from, so chick cost, mortality, sales and profit follow the hatch.
--  2. Broiler cycle length (days from placement to lifting, normally 45):
--     a new lot's expected lifting date = placement + cycle days.
-- Nothing existing is removed.
-- =============================================
ALTER TABLE tenant_master.poultry_batches ADD COLUMN IF NOT EXISTS source_hatch_id UUID REFERENCES tenant_master.poultry_hatches(id);
CREATE INDEX IF NOT EXISTS idx_poultry_batches_hatch ON tenant_master.poultry_batches(source_hatch_id);
ALTER TABLE tenant_master.poultry_settings ADD COLUMN IF NOT EXISTS cycle_days INTEGER NOT NULL DEFAULT 45;
