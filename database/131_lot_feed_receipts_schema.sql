-- =============================================
-- 131: FEED / MEDICINE BOUGHT FOR A BROILER LOT
-- Feed, medicine, vaccine and litter are bought from outside. A Purchase
-- Bill's items can now be issued straight to a lot (shed batch) at the bill
-- price (value without VAT), posted as a consumption Stock Adjustment with
-- the lot's cost center - so the lot's cost carries exactly what was paid.
-- The bill line remembers how much went to lots, so it cannot be issued twice.
-- Nothing existing is removed.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.poultry_feed_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    batch_id UUID NOT NULL REFERENCES tenant_master.poultry_batches(id) ON DELETE CASCADE,
    purchase_bill_id UUID REFERENCES tenant_master.purchase_bills(id),
    receipt_date DATE NOT NULL,
    adjustment_id UUID,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    remarks TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_poultry_feed_receipts_batch ON tenant_master.poultry_feed_receipts(batch_id);
CREATE INDEX IF NOT EXISTS idx_poultry_feed_receipts_bill ON tenant_master.poultry_feed_receipts(purchase_bill_id);
CREATE TABLE IF NOT EXISTS tenant_master.poultry_feed_receipt_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    receipt_id UUID NOT NULL REFERENCES tenant_master.poultry_feed_receipts(id) ON DELETE CASCADE,
    bill_detail_id UUID,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    role VARCHAR(20),
    qty DECIMAL(15, 4) NOT NULL,
    uom_id UUID,
    rate DECIMAL(15, 4) NOT NULL DEFAULT 0,
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    feed_kg DECIMAL(15, 3) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_poultry_feed_receipt_lines_receipt ON tenant_master.poultry_feed_receipt_lines(receipt_id);
CREATE INDEX IF NOT EXISTS idx_poultry_feed_receipt_lines_bill_detail ON tenant_master.poultry_feed_receipt_lines(bill_detail_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
