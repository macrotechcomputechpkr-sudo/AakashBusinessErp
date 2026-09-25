-- =============================================
-- DOCUMENT AUDIT TRAIL
-- A dedicated, queryable audit table for the purchase chain - distinct
-- from the generic public.global_audit_log (which already receives
-- every logAudit() call as a JSON blob for cross-tenant admin viewing).
-- This one is tenant-scoped, polymorphic across every purchase document
-- type (same pattern as document_attachments/document_billing_terms),
-- and stores field-level before/after values so "what changed on this
-- requisition, by whom, when" can be queried directly without parsing
-- JSON.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.document_audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    document_type VARCHAR(30) NOT NULL,
    document_id UUID NOT NULL,

    action VARCHAR(20) NOT NULL,
    field_key VARCHAR(60),
    old_value TEXT,
    new_value TEXT,

    performed_at TIMESTAMPTZ DEFAULT NOW(),
    performed_by UUID,

    CONSTRAINT valid_audit_document_type CHECK (document_type IN (
        'purchase_requisition', 'purchase_quotation', 'purchase_order', 'purchase_grn',
        'purchase_bill', 'purchase_additional_expense', 'purchase_return', 'purchase_nonsalable_return'
    )),
    CONSTRAINT valid_audit_action CHECK (action IN ('create', 'update', 'status_change', 'delete'))
);

CREATE INDEX IF NOT EXISTS idx_doc_audit_document ON tenant_master.document_audit_trail(document_type, document_id, performed_at DESC);

-- =============================================
-- ENTRY FIELD CONTROL - EXTEND TO COVER PURCHASE REQUISITION/QUOTATION
-- =============================================
ALTER TABLE tenant_master.voucher_field_catalog
    DROP CONSTRAINT IF EXISTS valid_catalog_voucher_type;
ALTER TABLE tenant_master.voucher_field_catalog
    ADD CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation'
    ));

ALTER TABLE tenant_master.user_defined_fields
    DROP CONSTRAINT IF EXISTS valid_udf_voucher_type;
ALTER TABLE tenant_master.user_defined_fields
    ADD CONSTRAINT valid_udf_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation'
    ));

-- Seed the Purchase Requisition catalog - matching the actual fields
-- built in PurchaseRequisition.jsx, Master + Details. is_system_required
-- marks the handful that can never be switched fully off (Date, Product,
-- Qty) - the app enforces this when validating entry_field_controls.
INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('purchase_requisition', 'master', 'doc_date', 'Date', 'date', TRUE, 1),
('purchase_requisition', 'master', 'vendor_ledger_id', 'Vendor', 'picker', FALSE, 2),
('purchase_requisition', 'master', 'agent_id', 'Agent', 'picker', FALSE, 3),
('purchase_requisition', 'master', 'invoice_type', 'Invoice Type', 'select', FALSE, 4),
('purchase_requisition', 'master', 'currency', 'Currency', 'text', FALSE, 5),
('purchase_requisition', 'master', 'due_date', 'Due Date', 'date', FALSE, 6),
('purchase_requisition', 'master', 'due_days', 'Due Days', 'number', FALSE, 7),
('purchase_requisition', 'master', 'warehouse_id', 'Master Warehouse', 'picker', FALSE, 8),
('purchase_requisition', 'master', 'goods_account_ledger_id', 'Goods Account', 'picker', FALSE, 9),
('purchase_requisition', 'master', 'goods_sub_ledger_id', 'Goods Sub-Ledger', 'picker', FALSE, 10),
('purchase_requisition', 'master', 'remarks_id', 'Remarks', 'picker', FALSE, 11),
('purchase_requisition', 'master', 'rate_type', 'Rate Type', 'select', FALSE, 12),
('purchase_requisition', 'master', 'cost_center_id', 'Cost Center', 'picker', FALSE, 13),
('purchase_requisition', 'master', 'business_unit_id', 'Unit', 'picker', FALSE, 14),
('purchase_requisition', 'master', 'area_id', 'Area', 'picker', FALSE, 15),
('purchase_requisition', 'master', 'route_id', 'Route', 'picker', FALSE, 16),
('purchase_requisition', 'master', 'priority', 'Priority', 'select', FALSE, 17),
('purchase_requisition', 'master', 'expected_delivery_date', 'Expected Delivery Date', 'date', FALSE, 18),
('purchase_requisition', 'master', 'terms_conditions_id', 'Terms & Conditions', 'picker', FALSE, 19),
('purchase_requisition', 'master', 'narration', 'Narration', 'text', FALSE, 20),
('purchase_requisition', 'detail', 'product_id', 'Product', 'picker', TRUE, 1),
('purchase_requisition', 'detail', 'qty', 'Qty', 'number', TRUE, 2),
('purchase_requisition', 'detail', 'uom_id', 'UOM', 'select', FALSE, 3),
('purchase_requisition', 'detail', 'alt_qty', 'Alt Qty', 'number', FALSE, 4),
('purchase_requisition', 'detail', 'alt_unit_id', 'Alt Unit', 'select', FALSE, 5),
('purchase_requisition', 'detail', 'alt1_qty', 'Alt1 Qty', 'number', FALSE, 6),
('purchase_requisition', 'detail', 'alt1_unit_id', 'Alt1 Unit', 'select', FALSE, 7),
('purchase_requisition', 'detail', 'rate', 'Rate', 'number', FALSE, 8),
('purchase_requisition', 'detail', 'discount_percent', 'Discount %', 'number', FALSE, 9),
('purchase_requisition', 'detail', 'tax_percent', 'Tax %', 'number', FALSE, 10),
('purchase_requisition', 'detail', 'free_qty', 'Free Qty', 'number', FALSE, 11),
('purchase_requisition', 'detail', 'free_uom_id', 'Free UOM', 'select', FALSE, 12),
('purchase_requisition', 'detail', 'warehouse_id', 'Details Warehouse', 'select', FALSE, 13),
('purchase_requisition', 'detail', 'barcode', 'Barcode', 'text', FALSE, 14),
('purchase_requisition', 'detail', 'narration', 'Narration', 'text', FALSE, 15)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
