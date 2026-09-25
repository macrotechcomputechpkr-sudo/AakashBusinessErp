-- =============================================
-- PURCHASE BILL IMPORT (from a JPG / PNG / PDF of the supplier's bill)
-- The bill is read in the browser (Tesseract.js OCR / PDF.js - free, bundled)
-- and parsed by server/utils/billTextParser.js; the
-- vendor is found by PAN / ledger tags / name, each line by product tags /
-- name. What the user confirms is remembered here, per vendor, so the same
-- item text on that vendor's next bill maps straight to the product (and
-- unit) chosen last time.
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.purchase_import_item_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    vendor_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id) ON DELETE CASCADE,
    item_text VARCHAR(300) NOT NULL,            -- normalized line text as printed on the bill
    product_id UUID NOT NULL REFERENCES tenant_master.products(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES tenant_master.product_units(id),
    use_count INTEGER NOT NULL DEFAULT 1,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT unique_import_item_map UNIQUE (tenant_id, vendor_ledger_id, item_text)
);
CREATE INDEX IF NOT EXISTS idx_import_item_map_vendor ON tenant_master.purchase_import_item_map(tenant_id, vendor_ledger_id);
