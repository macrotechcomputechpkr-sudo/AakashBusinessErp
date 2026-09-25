-- =============================================
-- PURCHASE QUOTATION - PARITY WITH REQUISITION/ORDER ENHANCEMENTS
-- =============================================

ALTER TABLE tenant_master.purchase_quotations
    ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
    ADD COLUMN IF NOT EXISTS terms_conditions_id UUID REFERENCES tenant_master.terms_conditions_master(id),
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

ALTER TABLE tenant_master.purchase_quotations
    DROP CONSTRAINT IF EXISTS valid_quotation_priority;
ALTER TABLE tenant_master.purchase_quotations
    ADD CONSTRAINT valid_quotation_priority CHECK (priority IN ('low', 'normal', 'urgent'));

ALTER TABLE tenant_master.purchase_quotation_details
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

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_quotation', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('purchase_quotation', 'master', 'vendor_ledger_id', 'Vendor', 'picker', TRUE, 2),
('purchase_quotation', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('purchase_quotation', 'master', 'invoice_type', 'Invoice Type', 'select', FALSE, 4),
('purchase_quotation', 'master', 'currency', 'Currency', 'text', FALSE, 5),
('purchase_quotation', 'master', 'due_date', 'Due Date', 'date', FALSE, 6),
('purchase_quotation', 'master', 'due_days', 'Due Days', 'number', FALSE, 7),
('purchase_quotation', 'master', 'warehouse_id', 'Master Warehouse', 'picker', FALSE, 8),
('purchase_quotation', 'master', 'goods_account_ledger_id', 'Goods Account', 'picker', FALSE, 9),
('purchase_quotation', 'master', 'goods_sub_ledger_id', 'Goods Sub-Ledger', 'picker', FALSE, 10),
('purchase_quotation', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 11),
('purchase_quotation', 'master', 'rate_type', 'Rate Type', 'select', FALSE, 12),
('purchase_quotation', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 13),
('purchase_quotation', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 14),
('purchase_quotation', 'master', 'area_id', 'Area', 'picker', FALSE, 15),
('purchase_quotation', 'master', 'route_id', 'Route', 'picker', FALSE, 16),
('purchase_quotation', 'master', 'priority', 'Priority', 'select', FALSE, 17),
('purchase_quotation', 'master', 'expected_delivery_date', 'Expected Delivery Date', 'date', FALSE, 18),
('purchase_quotation', 'master', 'terms_conditions_id', 'Terms & Conditions', 'picker', FALSE, 19),
('purchase_quotation', 'master', 'narration', 'Narration', 'text', FALSE, 20),
('purchase_quotation', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('purchase_quotation', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('purchase_quotation', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('purchase_quotation', 'detail', 'alt_qty', 'Alt Qty', 'number', FALSE, 4),
('purchase_quotation', 'detail', 'alt_unit_id', 'Alt Unit', 'select', FALSE, 5),
('purchase_quotation', 'detail', 'alt1_qty', 'Alt1 Qty', 'number', FALSE, 6),
('purchase_quotation', 'detail', 'alt1_unit_id', 'Alt1 Unit', 'select', FALSE, 7),
('purchase_quotation', 'detail', 'rate', 'Rate', 'number', FALSE, 8),
('purchase_quotation', 'detail', 'discount_percent', 'Discount %', 'number', FALSE, 9),
('purchase_quotation', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 10),
('purchase_quotation', 'detail', 'free_qty', 'Free Qty', 'number', FALSE, 11),
('purchase_quotation', 'detail', 'free_uom_id', 'Free UOM', 'select', FALSE, 12),
('purchase_quotation', 'detail', 'warehouse_id', 'Details Warehouse', 'select', FALSE, 13),
('purchase_quotation', 'detail', 'barcode', 'Barcode', 'text', FALSE, 14),
('purchase_quotation', 'detail', 'narration', 'Narration', 'text', FALSE, 15)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_purchase_quotation_doc_date ON tenant_master.purchase_quotations(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_purchase_quotation_fiscal_year ON tenant_master.purchase_quotations(tenant_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_purchase_quotation_vendor ON tenant_master.purchase_quotations(vendor_ledger_id);
CREATE INDEX IF NOT EXISTS idx_purchase_quotation_status ON tenant_master.purchase_quotations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_quotation_source_req ON tenant_master.purchase_quotations(source_requisition_id) WHERE source_requisition_id IS NOT NULL;
