-- =============================================
-- LOOSE-PIECE (SECONDARY-ONLY) LINES FOR DUAL-UOM PRODUCTS
-- Every line table demanded qty > 0, so a Fixed dual-unit line of
-- 0 Carton + 7 Pcs (loose pieces - routine in Fixed Alt System) could not
-- be saved. New rule on tables that have alt_qty: at least one of
-- qty / alt_qty is above zero, and neither is negative.
-- (BOM template tables have no alt_qty and keep qty > 0.)
-- =============================================
ALTER TABLE tenant_master.purchase_requisition_details DROP CONSTRAINT IF EXISTS positive_requisition_qty;
ALTER TABLE tenant_master.purchase_requisition_details ADD CONSTRAINT positive_requisition_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.purchase_quotation_details DROP CONSTRAINT IF EXISTS positive_quotation_qty;
ALTER TABLE tenant_master.purchase_quotation_details ADD CONSTRAINT positive_quotation_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.purchase_order_details DROP CONSTRAINT IF EXISTS positive_order_qty;
ALTER TABLE tenant_master.purchase_order_details ADD CONSTRAINT positive_order_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.purchase_grn_details DROP CONSTRAINT IF EXISTS positive_grn_qty;
ALTER TABLE tenant_master.purchase_grn_details ADD CONSTRAINT positive_grn_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.purchase_bill_details DROP CONSTRAINT IF EXISTS positive_bill_qty;
ALTER TABLE tenant_master.purchase_bill_details ADD CONSTRAINT positive_bill_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.purchase_return_details DROP CONSTRAINT IF EXISTS positive_return_qty;
ALTER TABLE tenant_master.purchase_return_details ADD CONSTRAINT positive_return_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.purchase_nonsaleable_return_details DROP CONSTRAINT IF EXISTS positive_nsreturn_qty;
ALTER TABLE tenant_master.purchase_nonsaleable_return_details ADD CONSTRAINT positive_nsreturn_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.stock_transfer_details DROP CONSTRAINT IF EXISTS positive_transfer_qty;
ALTER TABLE tenant_master.stock_transfer_details ADD CONSTRAINT positive_transfer_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.production_raw_materials DROP CONSTRAINT IF EXISTS positive_raw_material_qty;
ALTER TABLE tenant_master.production_raw_materials ADD CONSTRAINT positive_raw_material_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.production_byproducts DROP CONSTRAINT IF EXISTS positive_byproduct_qty;
ALTER TABLE tenant_master.production_byproducts ADD CONSTRAINT positive_byproduct_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.sales_order_details DROP CONSTRAINT IF EXISTS positive_sales_order_qty;
ALTER TABLE tenant_master.sales_order_details ADD CONSTRAINT positive_sales_order_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.sales_quotation_details DROP CONSTRAINT IF EXISTS positive_sales_quotation_qty;
ALTER TABLE tenant_master.sales_quotation_details ADD CONSTRAINT positive_sales_quotation_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.sales_delivery_details DROP CONSTRAINT IF EXISTS positive_sales_delivery_qty;
ALTER TABLE tenant_master.sales_delivery_details ADD CONSTRAINT positive_sales_delivery_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.sales_bill_details DROP CONSTRAINT IF EXISTS positive_sales_bill_qty;
ALTER TABLE tenant_master.sales_bill_details ADD CONSTRAINT positive_sales_bill_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.sales_return_details DROP CONSTRAINT IF EXISTS positive_sales_return_qty;
ALTER TABLE tenant_master.sales_return_details ADD CONSTRAINT positive_sales_return_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
ALTER TABLE tenant_master.sales_nonsaleable_return_details DROP CONSTRAINT IF EXISTS positive_sales_nonsaleable_return_qty;
ALTER TABLE tenant_master.sales_nonsaleable_return_details ADD CONSTRAINT positive_sales_nonsaleable_return_qty CHECK ((qty > 0 OR COALESCE(alt_qty, 0) > 0) AND qty >= 0 AND COALESCE(alt_qty, 0) >= 0);
