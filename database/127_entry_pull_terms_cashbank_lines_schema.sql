-- =============================================
-- 127: TRANSACTION ENTRY IMPROVEMENTS
--  1. Reference documents in the entry header (Quotation / Order / Challan
--     ...): one Entry Field Control field per earlier document type
--     (ref_<type>) - disable it to hide that pull option on the screen.
--     Sales Bill can now pull straight from a Sales Quotation too.
--  2. Product accounts for returns: Sales / Purchase Return and Sales /
--     Purchase Non-saleable Return accounts (used before the defaults).
--  3. Party details on the document (billing / shipping address, PAN,
--     phone) - editable on the entry, optionally written back to the ledger.
--  4. System Control: multi-warehouse switch (warehouse fields show only
--     when on), product search by name or code, and which billing term is
--     VAT / Excise / Product Discount 1-5 / Bill Discount for sales and
--     purchase (term_mapping replaces the "type" on the billing term).
--  5. Billing term "calculated on": several terms can be picked.
--  6. Free qty in any unit of the product.
--  7. Cash / Bank voucher lines: one voucher, many ledgers (party or not),
--     each line with its own receipt or payment amount and dimensions.
-- Nothing existing is removed.
-- =============================================

-- 1 ------------------------------------------------------------------------
ALTER TABLE tenant_master.sales_bill_details ADD COLUMN IF NOT EXISTS source_quotation_detail_id UUID;
ALTER TABLE tenant_master.sales_bills ADD COLUMN IF NOT EXISTS source_quotation_id UUID;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order)
SELECT v, 'master', f, l, 'picker', FALSE, 900 + n
FROM (VALUES
    ('sales_order', 'ref_sales_quotation', 'Pull from Sales Quotation', 1),
    ('sales_delivery', 'ref_sales_order', 'Pull from Sales Order', 1),
    ('sales_bill', 'ref_sales_quotation', 'Pull from Sales Quotation', 1),
    ('sales_bill', 'ref_sales_order', 'Pull from Sales Order', 2),
    ('sales_bill', 'ref_sales_delivery', 'Pull from Sales Challan / Delivery', 3),
    ('sales_return', 'ref_sales_bill', 'Pull from Sales Bill', 1),
    ('purchase_quotation', 'ref_purchase_requisition', 'Pull from Purchase Requisition', 1),
    ('purchase_order', 'ref_purchase_requisition', 'Pull from Purchase Requisition', 1),
    ('purchase_order', 'ref_purchase_quotation', 'Pull from Purchase Quotation', 2),
    ('purchase_grn', 'ref_purchase_order', 'Pull from Purchase Order', 1),
    ('purchase_bill', 'ref_purchase_order', 'Pull from Purchase Order', 1),
    ('purchase_bill', 'ref_purchase_grn', 'Pull from GRN', 2),
    ('purchase_return', 'ref_purchase_bill', 'Pull from Purchase Bill', 1)
) AS x(v, f, l, n)
WHERE NOT EXISTS (SELECT 1 FROM tenant_master.voucher_field_catalog c WHERE c.voucher_type = x.v AND c.section = 'master' AND c.field_key = x.f);

-- 2 ------------------------------------------------------------------------
ALTER TABLE tenant_master.products
    ADD COLUMN IF NOT EXISTS sales_return_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS purchase_return_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS sales_nonsaleable_return_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS purchase_nonsaleable_return_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);

-- 3 ------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_quotations', 'sales_orders', 'sales_deliveries', 'sales_bills', 'sales_returns', 'sales_nonsaleable_returns',
                           'purchase_requisitions', 'purchase_quotations', 'purchase_orders', 'purchase_grns', 'purchase_bills', 'purchase_returns', 'purchase_nonsaleable_returns']
  LOOP
    EXECUTE format('ALTER TABLE tenant_master.%I ADD COLUMN IF NOT EXISTS party_billing_address TEXT, ADD COLUMN IF NOT EXISTS party_shipping_address TEXT, '
                || 'ADD COLUMN IF NOT EXISTS party_pan VARCHAR(30), ADD COLUMN IF NOT EXISTS party_phone VARCHAR(40), ADD COLUMN IF NOT EXISTS party_email VARCHAR(150)', t);
  END LOOP;
END $$;

-- 4 ------------------------------------------------------------------------
ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS multi_warehouse BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS product_search_by VARCHAR(10) NOT NULL DEFAULT 'name',
    ADD COLUMN IF NOT EXISTS term_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_product_search_by CHECK (product_search_by IN ('name', 'code'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- companies already using more than one warehouse keep seeing warehouse fields
UPDATE tenant_master.system_control_settings s SET multi_warehouse = TRUE
WHERE multi_warehouse = FALSE AND (SELECT COUNT(*) FROM tenant_master.warehouses w WHERE w.tenant_id = s.tenant_id) > 1;

-- 5 ------------------------------------------------------------------------
ALTER TABLE tenant_master.billing_terms ADD COLUMN IF NOT EXISTS base_term_ids UUID[] NOT NULL DEFAULT '{}';

-- 6 ------------------------------------------------------------------------
ALTER TABLE tenant_master.sales_bill_details ADD COLUMN IF NOT EXISTS free_uom_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.sales_quotation_details
    ADD COLUMN IF NOT EXISTS free_qty DECIMAL(15, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS free_uom_id UUID REFERENCES tenant_master.product_units(id);
ALTER TABLE tenant_master.sales_delivery_details
    ADD COLUMN IF NOT EXISTS free_qty DECIMAL(15, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS free_uom_id UUID REFERENCES tenant_master.product_units(id);

-- 7 ------------------------------------------------------------------------
ALTER TABLE tenant_master.cash_bank_entries ALTER COLUMN party_ledger_id DROP NOT NULL;
ALTER TABLE tenant_master.cash_bank_entries
    ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES tenant_master.areas(id),
    ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES tenant_master.routes(id),
    ADD COLUMN IF NOT EXISTS total_receipt DECIMAL(15, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_payment DECIMAL(15, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS line_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS tenant_master.cash_bank_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entry_id UUID NOT NULL REFERENCES tenant_master.cash_bank_entries(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL DEFAULT 1,
    ledger_id UUID NOT NULL REFERENCES tenant_master.ledger_accounts(id),
    sub_ledger_id UUID REFERENCES tenant_master.sub_ledgers(id),
    product_company_id UUID REFERENCES tenant_master.product_companies(id),
    area_id UUID REFERENCES tenant_master.areas(id),
    agent_id UUID REFERENCES tenant_master.salesman_agents(id),
    route_id UUID REFERENCES tenant_master.routes(id),
    business_unit_id UUID REFERENCES tenant_master.business_units(id),
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),
    manual_receipt_no VARCHAR(50),
    remarks TEXT,
    receipt_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    payment_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    bill_wise_settlements JSONB,
    ledger_name_snapshot VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT cash_bank_line_one_side CHECK (receipt_amount >= 0 AND payment_amount >= 0 AND (receipt_amount > 0) <> (payment_amount > 0))
);
CREATE INDEX IF NOT EXISTS idx_cash_bank_entry_lines_entry ON tenant_master.cash_bank_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_cash_bank_entry_lines_ledger ON tenant_master.cash_bank_entry_lines(tenant_id, ledger_id);

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order)
SELECT 'cash_bank_entry', s, f, l, d, FALSE, n
FROM (VALUES
    ('detail', 'ledger_id', 'Ledger', 'picker', 1), ('detail', 'product_company_id', 'Product Company', 'picker', 2), ('detail', 'area_id', 'Area', 'picker', 3),
    ('detail', 'agent_id', 'Agent', 'picker', 4), ('detail', 'route_id', 'Route', 'picker', 5), ('detail', 'business_unit_id', 'Unit', 'picker', 6),
    ('detail', 'manual_receipt_no', 'Manual Rec No', 'text', 7), ('detail', 'remarks', 'Details Remarks', 'text', 8),
    ('master', 'ref_doc_no', 'Document No', 'text', 20), ('master', 'ref_doc_date', 'Document Date', 'date', 21),
    ('master', 'cost_center_id', 'Cost Center', 'picker', 22), ('master', 'business_unit_id', 'Unit', 'picker', 23)
) AS x(s, f, l, d, n)
WHERE NOT EXISTS (SELECT 1 FROM tenant_master.voucher_field_catalog c WHERE c.voucher_type = 'cash_bank_entry' AND c.section = x.s AND c.field_key = x.f);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
