-- =============================================
-- 130: BROILER LOTS FROM PURCHASED CHICKS
-- Most broiler farms buy their day-old chicks from outside hatcheries. A
-- lot can now keep the Purchase Bill its chicks came on and the supplier,
-- so one purchase can be spread over several sheds and chick cost,
-- mortality, FCR and profit can be compared supplier by supplier.
-- Nothing existing is removed.
-- =============================================
ALTER TABLE tenant_master.poultry_batches
    ADD COLUMN IF NOT EXISTS source_purchase_bill_id UUID REFERENCES tenant_master.purchase_bills(id),
    ADD COLUMN IF NOT EXISTS source_vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
CREATE INDEX IF NOT EXISTS idx_poultry_batches_purchase ON tenant_master.poultry_batches(source_purchase_bill_id);
CREATE INDEX IF NOT EXISTS idx_poultry_batches_vendor ON tenant_master.poultry_batches(tenant_id, source_vendor_ledger_id);
