-- =============================================
-- PURCHASE ORDER - PARITY WITH REQUISITION ENHANCEMENTS
-- Same set of fields Requisition picked up over time (Priority,
-- Expected Delivery, Narration, per-line Discount/Tax, historical name
-- snapshots, Cash-party support) - keeping every document in the chain
-- consistent rather than each one drifting its own way.
-- =============================================

ALTER TABLE tenant_master.purchase_orders
    ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
    ADD COLUMN IF NOT EXISTS narration TEXT,
    ADD COLUMN IF NOT EXISTS cash_vendor_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS cash_billing_details JSONB,
    ADD COLUMN IF NOT EXISTS vendor_name_snapshot VARCHAR(200),
    ADD COLUMN IF NOT EXISTS agent_name_snapshot VARCHAR(150),
    ADD COLUMN IF NOT EXISTS warehouse_name_snapshot VARCHAR(200),
    ADD COLUMN IF NOT EXISTS goods_account_name_snapshot VARCHAR(200),
    ADD COLUMN IF NOT EXISTS goods_sub_ledger_name_snapshot VARCHAR(200),
    ADD COLUMN IF NOT EXISTS cost_center_name_snapshot VARCHAR(150),
    ADD COLUMN IF NOT EXISTS business_unit_name_snapshot VARCHAR(150),
    ADD COLUMN IF NOT EXISTS area_name_snapshot VARCHAR(150),
    ADD COLUMN IF NOT EXISTS route_name_snapshot VARCHAR(150),
    ADD COLUMN IF NOT EXISTS branch_name_snapshot VARCHAR(150);

ALTER TABLE tenant_master.purchase_orders
    DROP CONSTRAINT IF EXISTS valid_order_priority;
ALTER TABLE tenant_master.purchase_orders
    ADD CONSTRAINT valid_order_priority CHECK (priority IN ('low', 'normal', 'urgent'));

-- FEATURE: Vendor is required on the Order (unlike Requisition, where
-- it's optional) - by the Order stage a real commitment to a specific
-- vendor exists, so make it NOT NULL if it somehow slipped through as
-- nullable, matching the CREATE TABLE's own vendor_ledger_id NOT NULL.

ALTER TABLE tenant_master.purchase_order_details
    ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_percent DECIMAL(5, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS narration TEXT,
    ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(200),
    ADD COLUMN IF NOT EXISTS uom_name_snapshot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS alt_unit_name_snapshot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS alt1_unit_name_snapshot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS free_uom_name_snapshot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS warehouse_name_snapshot VARCHAR(200);

-- Seed the voucher_field_catalog + compulsory defaults for Purchase
-- Order, matching the same pattern used for Purchase Requisition.
INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_order', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('purchase_order', 'master', 'vendor_ledger_id', 'Vendor', 'picker', TRUE, 2),
('purchase_order', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('purchase_order', 'master', 'invoice_type', 'Invoice Type', 'select', FALSE, 4),
('purchase_order', 'master', 'currency', 'Currency', 'text', FALSE, 5),
('purchase_order', 'master', 'due_date', 'Due Date', 'date', FALSE, 6),
('purchase_order', 'master', 'due_days', 'Due Days', 'number', FALSE, 7),
('purchase_order', 'master', 'warehouse_id', 'Master Warehouse', 'picker', FALSE, 8),
('purchase_order', 'master', 'goods_account_ledger_id', 'Goods Account', 'picker', FALSE, 9),
('purchase_order', 'master', 'goods_sub_ledger_id', 'Goods Sub-Ledger', 'picker', FALSE, 10),
('purchase_order', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 11),
('purchase_order', 'master', 'rate_type', 'Rate Type', 'select', FALSE, 12),
('purchase_order', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 13),
('purchase_order', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 14),
('purchase_order', 'master', 'area_id', 'Area', 'picker', FALSE, 15),
('purchase_order', 'master', 'route_id', 'Route', 'picker', FALSE, 16),
('purchase_order', 'master', 'priority', 'Priority', 'select', FALSE, 17),
('purchase_order', 'master', 'expected_delivery_date', 'Expected Delivery Date', 'date', FALSE, 18),
('purchase_order', 'master', 'terms_conditions_id', 'Terms & Conditions', 'picker', FALSE, 19),
('purchase_order', 'master', 'narration', 'Narration', 'text', FALSE, 20),
('purchase_order', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('purchase_order', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('purchase_order', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('purchase_order', 'detail', 'alt_qty', 'Alt Qty', 'number', FALSE, 4),
('purchase_order', 'detail', 'alt_unit_id', 'Alt Unit', 'select', FALSE, 5),
('purchase_order', 'detail', 'alt1_qty', 'Alt1 Qty', 'number', FALSE, 6),
('purchase_order', 'detail', 'alt1_unit_id', 'Alt1 Unit', 'select', FALSE, 7),
('purchase_order', 'detail', 'rate', 'Rate', 'number', FALSE, 8),
('purchase_order', 'detail', 'discount_percent', 'Discount %', 'number', FALSE, 9),
('purchase_order', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 10),
('purchase_order', 'detail', 'free_qty', 'Free Qty', 'number', FALSE, 11),
('purchase_order', 'detail', 'free_uom_id', 'Free UOM', 'select', FALSE, 12),
('purchase_order', 'detail', 'warehouse_id', 'Details Warehouse', 'select', FALSE, 13),
('purchase_order', 'detail', 'barcode', 'Barcode', 'text', FALSE, 14),
('purchase_order', 'detail', 'narration', 'Narration', 'text', FALSE, 15)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;

-- Reporting performance - same rationale as Requisition (continuous DB,
-- never partitioned per fiscal year).
CREATE INDEX IF NOT EXISTS idx_purchase_order_doc_date ON tenant_master.purchase_orders(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_purchase_order_fiscal_year ON tenant_master.purchase_orders(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_vendor ON tenant_master.purchase_orders(vendor_ledger_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_status ON tenant_master.purchase_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_source_req ON tenant_master.purchase_orders(source_requisition_id) WHERE source_requisition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_order_source_quo ON tenant_master.purchase_orders(source_quotation_id) WHERE source_quotation_id IS NOT NULL;
