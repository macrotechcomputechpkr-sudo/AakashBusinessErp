-- =============================================
-- FIXED DUAL UOM
-- "Fixed Duel Uom enabled xa vane - purchase ra sales dubai maa rate
-- kun unit maa ho tyo choose garna dine, 5 CRT ra 5 PCS aparai
-- bill garna sakos, stock maa CRT-PCS xuttai-xuttai dekhinu paryo
-- (opening/in/out/closing sabai maa), free qty maa pani testai."
--
-- Reusing what already exists rather than duplicating: qty/uom_id
-- remains the PRIMARY unit's quantity (e.g. Carton), alt_qty/
-- alt_unit_id becomes the SECONDARY unit's quantity (e.g. Piece) -
-- previously just an informational alternate display of the same
-- total, now a genuinely independent additional quantity (5 Carton
-- AND 5 loose Pieces, not "5 Carton, which is also 50 Pieces"). A new
-- rate_basis says which of the two the entered rate is actually for.
--
-- Stock itself still lives in stock_movements/v_current_stock exactly
-- as before (a single base-unit number, the smaller/secondary unit) -
-- the dual CRT+PCS breakdown a warehouse actually wants to see is
-- computed at DISPLAY time via v_dual_uom_stock (FLOOR/MOD against the
-- product's own conversion factor), so nothing about the existing
-- stock ledger needs to change.
-- =============================================

ALTER TABLE tenant_master.products
    ADD COLUMN IF NOT EXISTS uom_mode VARCHAR(15) NOT NULL DEFAULT 'single';
ALTER TABLE tenant_master.products
    ADD COLUMN IF NOT EXISTS dual_uom_primary_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.products
    DROP CONSTRAINT IF EXISTS valid_product_uom_mode;
ALTER TABLE tenant_master.products
    ADD CONSTRAINT valid_product_uom_mode CHECK (uom_mode IN ('single', 'fixed_dual', 'flexible'));

ALTER TABLE tenant_master.purchase_bill_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.purchase_bill_details
    ADD COLUMN IF NOT EXISTS free_alt_qty DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.purchase_bill_details
    DROP CONSTRAINT IF EXISTS valid_purchase_bill_rate_basis;
ALTER TABLE tenant_master.purchase_bill_details
    ADD CONSTRAINT valid_purchase_bill_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));

ALTER TABLE tenant_master.sales_bill_details
    ADD COLUMN IF NOT EXISTS alt_qty DECIMAL(15, 4);
ALTER TABLE tenant_master.sales_bill_details
    ADD COLUMN IF NOT EXISTS alt_unit_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.sales_bill_details
    ADD COLUMN IF NOT EXISTS rate_basis VARCHAR(10) DEFAULT 'primary';
ALTER TABLE tenant_master.sales_bill_details
    ADD COLUMN IF NOT EXISTS free_qty DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.sales_bill_details
    ADD COLUMN IF NOT EXISTS free_alt_qty DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.sales_bill_details
    DROP CONSTRAINT IF EXISTS valid_sales_bill_rate_basis;
ALTER TABLE tenant_master.sales_bill_details
    ADD CONSTRAINT valid_sales_bill_rate_basis CHECK (rate_basis IN ('primary', 'secondary'));

CREATE OR REPLACE VIEW tenant_master.v_dual_uom_stock AS
SELECT
    v.tenant_id, v.product_id, p.product_name, v.warehouse_id, w.warehouse_name, v.batch_no,
    v.on_hand_qty AS on_hand_qty_base,
    pu.unit_name AS primary_unit_name, su.unit_name AS secondary_unit_name,
    pur.conversion_factor,
    FLOOR(v.on_hand_qty / NULLIF(pur.conversion_factor, 0)) AS on_hand_primary,
    MOD(v.on_hand_qty::numeric, NULLIF(pur.conversion_factor, 0)) AS on_hand_secondary
FROM tenant_master.v_current_stock v
JOIN tenant_master.products p ON p.id = v.product_id AND p.uom_mode = 'fixed_dual'
JOIN tenant_master.warehouses w ON w.id = v.warehouse_id
LEFT JOIN tenant_master.product_units pu ON pu.id = p.dual_uom_primary_unit_id
LEFT JOIN tenant_master.product_units su ON su.id = p.base_unit_id
LEFT JOIN tenant_master.product_unit_rates pur ON pur.product_id = p.id AND pur.unit_id = p.dual_uom_primary_unit_id;
