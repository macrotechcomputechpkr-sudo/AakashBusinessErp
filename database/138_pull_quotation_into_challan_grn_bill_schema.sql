-- =============================================
-- 138: pull from earlier documents - full chain
--   Order   <- Quotation
--   Challan <- Quotation + Order        (sales)   GRN  <- Quotation + Order (purchase)
--   Bill    <- Quotation + Order + Challan (sales) Bill <- Quotation + Order + GRN (purchase)
-- Each source is an Entry Field Control option (ref_<type>): disabled = not offered.
-- A line pulled straight from a Quotation uses up the quotation's qty_ordered.
-- =============================================
ALTER TABLE tenant_master.sales_delivery_details ADD COLUMN IF NOT EXISTS source_quotation_detail_id UUID;
ALTER TABLE tenant_master.sales_deliveries ADD COLUMN IF NOT EXISTS source_quotation_id UUID;
ALTER TABLE tenant_master.purchase_grn_details ADD COLUMN IF NOT EXISTS source_quotation_detail_id UUID;
ALTER TABLE tenant_master.purchase_grns ADD COLUMN IF NOT EXISTS source_quotation_id UUID;
ALTER TABLE tenant_master.purchase_bill_details ADD COLUMN IF NOT EXISTS source_quotation_detail_id UUID;
ALTER TABLE tenant_master.purchase_bills ADD COLUMN IF NOT EXISTS source_quotation_id UUID;
ALTER TABLE tenant_master.purchase_quotation_details ADD COLUMN IF NOT EXISTS qty_ordered NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE tenant_master.purchase_quotation_details ADD COLUMN IF NOT EXISTS alt_qty_ordered NUMERIC(18, 4) DEFAULT 0;
ALTER TABLE tenant_master.sales_quotation_details ADD COLUMN IF NOT EXISTS alt_qty_ordered NUMERIC(18, 4) DEFAULT 0;

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order)
SELECT v, 'master', f, l, 'picker', FALSE, 900 + n
FROM (VALUES
    ('sales_delivery', 'ref_sales_quotation', 'Pull from Sales Quotation', 0),
    ('purchase_grn', 'ref_purchase_quotation', 'Pull from Purchase Quotation', 0),
    ('purchase_bill', 'ref_purchase_quotation', 'Pull from Purchase Quotation', 0)
) AS x(v, f, l, n)
WHERE NOT EXISTS (SELECT 1 FROM tenant_master.voucher_field_catalog c WHERE c.voucher_type = x.v AND c.section = 'master' AND c.field_key = x.f);
