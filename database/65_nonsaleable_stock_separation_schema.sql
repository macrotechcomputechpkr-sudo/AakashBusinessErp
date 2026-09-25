-- =============================================
-- NON-SALEABLE STOCK - KEPT SEPARATE FROM MAIN STOCK
-- "Non-saleable le main stock ma effect garne hoena, xuttai rakhne ho -
-- tesko Valuation le Account (main stock) ma Effect Garne Hoena,
-- Income Statement ra Balance Sheet ma matra effect garne ho."
--
-- Damaged/expired/recalled goods are physically different from sellable
-- inventory - they shouldn't dilute the main stock_movements ledger's
-- quantity or valuation numbers, but they still represent real value
-- that needs to disappear from the books correctly:
--   - settlement_type = 'write_off': a genuine business loss. Debits a
--     Write-off expense account (hits the Income Statement/P&L), credits
--     a Non-saleable Stock asset account (removes it from the Balance
--     Sheet) - the vendor isn't compensating anything.
--   - settlement_type = 'credit_note': the vendor accepts the return and
--     reduces what we owe them - functions exactly like Purchase Return
--     for accounting purposes (debits the vendor's payable, settling
--     bill-wise against outstanding bills), the difference is purely
--     that the GOODS never touch sellable stock.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.nonsaleable_stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),
    movement_date DATE NOT NULL,
    qty_in DECIMAL(15, 4) NOT NULL DEFAULT 0,
    qty_out DECIMAL(15, 4) NOT NULL DEFAULT 0,
    unit_cost DECIMAL(15, 4) DEFAULT 0,
    source_type VARCHAR(30) NOT NULL,
    source_id UUID NOT NULL,
    source_detail_id UUID,
    narration TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_nonsaleable_movement_qty CHECK (qty_in >= 0 AND qty_out >= 0 AND (qty_in > 0 OR qty_out > 0))
);

CREATE INDEX IF NOT EXISTS idx_nonsaleable_movements_product ON tenant_master.nonsaleable_stock_movements(product_id, warehouse_id, batch_no);
CREATE INDEX IF NOT EXISTS idx_nonsaleable_movements_source ON tenant_master.nonsaleable_stock_movements(source_type, source_id);

CREATE OR REPLACE VIEW tenant_master.v_nonsaleable_stock AS
SELECT
    tenant_id, product_id, warehouse_id, batch_no,
    SUM(qty_in) - SUM(qty_out) AS on_hand_qty,
    CASE WHEN SUM(qty_in) > 0 THEN SUM(qty_in * unit_cost) / SUM(qty_in) ELSE 0 END AS weighted_avg_cost
FROM tenant_master.nonsaleable_stock_movements
GROUP BY tenant_id, product_id, warehouse_id, batch_no
HAVING SUM(qty_in) - SUM(qty_out) != 0;

ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS nonsaleable_writeoff_expense_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS nonsaleable_stock_asset_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
