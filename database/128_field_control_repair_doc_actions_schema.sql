-- =============================================
-- 128: ENTRY FIELD CONTROL REPAIR + TRANSACTION ACTIONS
--  1. The field catalog seed returned early when ANY catalog row already
--     existed, so a database where a later migration added its rows first
--     never got the base fields (Entry Field Control showed an empty list).
--     The seed now adds only the missing rows and is run again.
--  2. Every entry screen reports the fields it shows; the server adds the
--     ones not yet in the catalog (voucher_field_catalog.auto_added), so the
--     Entry Field Control list always matches the screen.
--  3. System Control "IRD Billing": when on, a posted Sales Bill / Sales
--     Return can only be cancelled - never modified, reopened or removed.
--  4. Hold: an unfinished entry parked by a user and recalled later.
-- Nothing existing is removed.
-- =============================================

-- 1 ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_master.seed_voucher_field_catalog()
RETURNS VOID AS $$
BEGIN

    INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
    -- ---------- SALES ORDER ----------
    ('sales_order','master','order_no','Order No','text',TRUE,1),
    ('sales_order','master','order_date','Order Date','date',TRUE,2),
    ('sales_order','master','customer','Customer','picker',TRUE,3),
    ('sales_order','master','bill_type','Bill Type (Cash/Credit)','select',FALSE,4),
    ('sales_order','master','agent','Agent / Salesman','picker',FALSE,5),
    ('sales_order','master','due_date','Due Date','date',FALSE,6),
    ('sales_order','master','credit_days','Credit Days','number',FALSE,7),
    ('sales_order','master','area','Area','picker',FALSE,8),
    ('sales_order','master','route','Route','picker',FALSE,9),
    ('sales_order','master','delivery_date','Promised Delivery Date','date',FALSE,10),
    ('sales_order','master','reference_no','Reference No','text',FALSE,11),
    ('sales_order','master','terms','Terms & Conditions','text',FALSE,12),
    ('sales_order','master','remarks','Remarks','text',FALSE,13),
    ('sales_order','detail','product','Product','picker',TRUE,1),
    ('sales_order','detail','qty','Qty','number',TRUE,2),
    ('sales_order','detail','free_qty','Free Qty','number',FALSE,3),
    ('sales_order','detail','unit','Unit','select',FALSE,4),
    ('sales_order','detail','rate','Rate','number',TRUE,5),
    ('sales_order','detail','discount_percent','Discount %','number',FALSE,6),
    ('sales_order','detail','amount','Amount','number',TRUE,7),
    ('sales_order','detail','line_delivery_date','Line Delivery Date','date',FALSE,8),

    -- ---------- SALES DELIVERY (GDN) ----------
    ('sales_delivery','master','gdn_no','GDN No','text',TRUE,1),
    ('sales_delivery','master','gdn_date','GDN Date','date',TRUE,2),
    ('sales_delivery','master','customer','Customer','picker',TRUE,3),
    ('sales_delivery','master','against_order_ref','Against Sales Order Ref','picker',FALSE,4),
    ('sales_delivery','master','vehicle_no','Vehicle No','text',FALSE,5),
    ('sales_delivery','master','driver_name','Driver Name','text',FALSE,6),
    ('sales_delivery','master','transporter','Transporter','picker',FALSE,7),
    ('sales_delivery','master','delivery_address','Delivery Address','text',FALSE,8),
    ('sales_delivery','master','dispatch_through','Dispatch Through','text',FALSE,9),
    ('sales_delivery','master','agent','Agent','picker',FALSE,10),
    ('sales_delivery','detail','product','Product','picker',TRUE,1),
    ('sales_delivery','detail','qty','Qty','number',TRUE,2),
    ('sales_delivery','detail','batch_lot','Batch/Lot','picker',FALSE,3),
    ('sales_delivery','detail','unit','Unit','select',FALSE,4),
    ('sales_delivery','detail','godown','Godown/Warehouse','picker',FALSE,5),

    -- ---------- SALES BILL ----------
    ('sales_bill','master','bill_no','Bill No','text',TRUE,1),
    ('sales_bill','master','bill_date','Bill Date','date',TRUE,2),
    ('sales_bill','master','customer','Customer','picker',TRUE,3),
    ('sales_bill','master','bill_type','Bill Type (Cash/Credit)','select',FALSE,4),
    ('sales_bill','master','agent','Agent','picker',FALSE,5),
    ('sales_bill','master','due_date','Due Date','date',FALSE,6),
    ('sales_bill','master','credit_days','Credit Days','number',FALSE,7),
    ('sales_bill','master','area','Area','picker',FALSE,8),
    ('sales_bill','master','route','Route','picker',FALSE,9),
    ('sales_bill','master','against_ref','Against SO/GDN Ref','picker',FALSE,10),
    ('sales_bill','master','terms','Terms','text',FALSE,11),
    ('sales_bill','detail','product','Product','picker',TRUE,1),
    ('sales_bill','detail','qty','Qty','number',TRUE,2),
    ('sales_bill','detail','free_qty','Free Qty','number',FALSE,3),
    ('sales_bill','detail','unit','Unit','select',FALSE,4),
    ('sales_bill','detail','rate','Rate','number',TRUE,5),
    ('sales_bill','detail','discount_percent','Discount %','number',FALSE,6),
    ('sales_bill','detail','amount','Amount','number',TRUE,7),
    ('sales_bill','detail','batch_lot','Batch/Lot','picker',FALSE,8),
    ('sales_bill','detail','exp_date','Exp Date','date',FALSE,9),
    ('sales_bill','detail','billing_term','Billing Term','picker',FALSE,10),

    -- ---------- SALES RETURN ----------
    ('sales_return','master','return_no','Return No','text',TRUE,1),
    ('sales_return','master','return_date','Return Date','date',TRUE,2),
    ('sales_return','master','customer','Customer','picker',TRUE,3),
    ('sales_return','master','against_bill_ref','Against Bill Ref','picker',FALSE,4),
    ('sales_return','master','reason','Reason for Return','text',FALSE,5),
    ('sales_return','master','agent','Agent','picker',FALSE,6),
    ('sales_return','detail','product','Product','picker',TRUE,1),
    ('sales_return','detail','qty','Qty','number',TRUE,2),
    ('sales_return','detail','rate','Rate','number',TRUE,3),
    ('sales_return','detail','amount','Amount','number',TRUE,4),
    ('sales_return','detail','batch_lot','Batch/Lot','picker',FALSE,5),

    -- ---------- SALES ADDITIONAL (expenses/charges on a sales doc) ----------
    ('sales_additional','master','doc_no','Document No','text',TRUE,1),
    ('sales_additional','master','doc_date','Date','date',TRUE,2),
    ('sales_additional','master','customer','Customer','picker',TRUE,3),
    ('sales_additional','master','against_bill_ref','Against Bill Ref','picker',FALSE,4),
    ('sales_additional','detail','billing_term','Billing Term / Charge','picker',TRUE,1),
    ('sales_additional','detail','amount','Amount','number',TRUE,2),

    -- ---------- PURCHASE ORDER ----------
    ('purchase_order','master','order_no','Order No','text',TRUE,1),
    ('purchase_order','master','order_date','Order Date','date',TRUE,2),
    ('purchase_order','master','vendor','Vendor','picker',TRUE,3),
    ('purchase_order','master','bill_type','Bill Type (Cash/Credit)','select',FALSE,4),
    ('purchase_order','master','due_date','Due Date','date',FALSE,5),
    ('purchase_order','master','credit_days','Credit Days','number',FALSE,6),
    ('purchase_order','master','expected_delivery_date','Expected Delivery Date','date',FALSE,7),
    ('purchase_order','master','reference_no','Reference No','text',FALSE,8),
    ('purchase_order','master','terms','Terms & Conditions','text',FALSE,9),
    ('purchase_order','master','remarks','Remarks','text',FALSE,10),
    ('purchase_order','detail','product','Product','picker',TRUE,1),
    ('purchase_order','detail','qty','Qty','number',TRUE,2),
    ('purchase_order','detail','free_qty','Free Qty','number',FALSE,3),
    ('purchase_order','detail','unit','Unit','select',FALSE,4),
    ('purchase_order','detail','rate','Rate','number',TRUE,5),
    ('purchase_order','detail','discount_percent','Discount %','number',FALSE,6),
    ('purchase_order','detail','amount','Amount','number',TRUE,7),

    -- ---------- PURCHASE GRN ----------
    ('purchase_grn','master','grn_no','GRN No','text',TRUE,1),
    ('purchase_grn','master','grn_date','GRN Date','date',TRUE,2),
    ('purchase_grn','master','vendor','Vendor','picker',TRUE,3),
    ('purchase_grn','master','against_order_ref','Against Purchase Order Ref','picker',FALSE,4),
    ('purchase_grn','master','vehicle_no','Vehicle No','text',FALSE,5),
    ('purchase_grn','master','transporter','Transporter','picker',FALSE,6),
    ('purchase_grn','detail','product','Product','picker',TRUE,1),
    ('purchase_grn','detail','qty','Qty','number',TRUE,2),
    ('purchase_grn','detail','batch_lot','Batch/Lot','picker',FALSE,3),
    ('purchase_grn','detail','unit','Unit','select',FALSE,4),
    ('purchase_grn','detail','godown','Godown/Warehouse','picker',FALSE,5),

    -- ---------- PURCHASE BILL ----------
    ('purchase_bill','master','bill_no','Bill No','text',TRUE,1),
    ('purchase_bill','master','bill_date','Bill Date','date',TRUE,2),
    ('purchase_bill','master','vendor','Vendor','picker',TRUE,3),
    ('purchase_bill','master','vendor_invoice_no','Vendor Invoice No','text',FALSE,4),
    ('purchase_bill','master','bill_type','Bill Type (Cash/Credit)','select',FALSE,5),
    ('purchase_bill','master','due_date','Due Date','date',FALSE,6),
    ('purchase_bill','master','credit_days','Credit Days','number',FALSE,7),
    ('purchase_bill','master','against_ref','Against PO/GRN Ref','picker',FALSE,8),
    ('purchase_bill','detail','product','Product','picker',TRUE,1),
    ('purchase_bill','detail','qty','Qty','number',TRUE,2),
    ('purchase_bill','detail','free_qty','Free Qty','number',FALSE,3),
    ('purchase_bill','detail','unit','Unit','select',FALSE,4),
    ('purchase_bill','detail','rate','Rate','number',TRUE,5),
    ('purchase_bill','detail','discount_percent','Discount %','number',FALSE,6),
    ('purchase_bill','detail','amount','Amount','number',TRUE,7),
    ('purchase_bill','detail','batch_lot','Batch/Lot','picker',FALSE,8),
    ('purchase_bill','detail','exp_date','Exp Date','date',FALSE,9),
    ('purchase_bill','detail','billing_term','Billing Term','picker',FALSE,10),

    -- ---------- PURCHASE RETURN ----------
    ('purchase_return','master','return_no','Return No','text',TRUE,1),
    ('purchase_return','master','return_date','Return Date','date',TRUE,2),
    ('purchase_return','master','vendor','Vendor','picker',TRUE,3),
    ('purchase_return','master','against_bill_ref','Against Bill Ref','picker',FALSE,4),
    ('purchase_return','master','reason','Reason for Return','text',FALSE,5),
    ('purchase_return','detail','product','Product','picker',TRUE,1),
    ('purchase_return','detail','qty','Qty','number',TRUE,2),
    ('purchase_return','detail','rate','Rate','number',TRUE,3),
    ('purchase_return','detail','amount','Amount','number',TRUE,4),
    ('purchase_return','detail','batch_lot','Batch/Lot','picker',FALSE,5),

    -- ---------- PURCHASE ADDITIONAL ----------
    ('purchase_additional','master','doc_no','Document No','text',TRUE,1),
    ('purchase_additional','master','doc_date','Date','date',TRUE,2),
    ('purchase_additional','master','vendor','Vendor','picker',TRUE,3),
    ('purchase_additional','master','against_bill_ref','Against Bill Ref','picker',FALSE,4),
    ('purchase_additional','detail','billing_term','Billing Term / Charge','picker',TRUE,1),
    ('purchase_additional','detail','amount','Amount','number',TRUE,2),

    -- ---------- JOURNAL ----------
    ('journal','master','jv_no','Voucher No','text',TRUE,1),
    ('journal','master','jv_date','Date','date',TRUE,2),
    ('journal','master','narration','Narration','text',FALSE,3),
    ('journal','detail','ledger','Ledger','picker',TRUE,1),
    ('journal','detail','dr_cr','Debit/Credit','select',TRUE,2),
    ('journal','detail','amount','Amount','number',TRUE,3),
    ('journal','detail','cost_center','Cost Center','picker',FALSE,4),
    ('journal','detail','line_narration','Line Narration','text',FALSE,5),

    -- ---------- CASH ----------
    ('cash','master','voucher_no','Voucher No','text',TRUE,1),
    ('cash','master','voucher_date','Date','date',TRUE,2),
    ('cash','master','voucher_mode','Type (Receipt/Payment)','select',TRUE,3),
    ('cash','master','cash_ledger','Cash Ledger','picker',TRUE,4),
    ('cash','master','party','Party','picker',FALSE,5),
    ('cash','master','narration','Narration','text',FALSE,6),
    ('cash','detail','ledger','Ledger','picker',TRUE,1),
    ('cash','detail','amount','Amount','number',TRUE,2),
    ('cash','detail','bill_reference','Against Bill Reference','picker',FALSE,3),

    -- ---------- BANK ----------
    ('bank','master','voucher_no','Voucher No','text',TRUE,1),
    ('bank','master','voucher_date','Date','date',TRUE,2),
    ('bank','master','voucher_mode','Type (Receipt/Payment)','select',TRUE,3),
    ('bank','master','bank_ledger','Bank Ledger','picker',TRUE,4),
    ('bank','master','cheque_no','Cheque No','text',FALSE,5),
    ('bank','master','cheque_date','Cheque Date','date',FALSE,6),
    ('bank','master','party','Party','picker',FALSE,7),
    ('bank','master','narration','Narration','text',FALSE,8),
    ('bank','detail','ledger','Ledger','picker',TRUE,1),
    ('bank','detail','amount','Amount','number',TRUE,2),
    ('bank','detail','bill_reference','Against Bill Reference','picker',FALSE,3),

    -- ---------- PDC (Post-Dated Cheque) ----------
    ('pdc','master','pdc_no','PDC No','text',TRUE,1),
    ('pdc','master','cheque_no','Cheque No','text',TRUE,2),
    ('pdc','master','cheque_date','Cheque Date','date',TRUE,3),
    ('pdc','master','bank','Bank','picker',TRUE,4),
    ('pdc','master','party','Party','picker',TRUE,5),
    ('pdc','master','pdc_type','Type (Received/Issued)','select',TRUE,6),
    ('pdc','master','amount','Amount','number',TRUE,7),
    ('pdc','master','status','Status (Pending/Cleared/Bounced/Cancelled)','select',TRUE,8),
    ('pdc','master','clearance_date','Clearance Date','date',FALSE,9),
    ('pdc','detail','bill_reference','Against Bill Reference','picker',FALSE,1),

    -- ---------- PRODUCTION ----------
    ('production','master','production_no','Production No','text',TRUE,1),
    ('production','master','production_date','Date','date',TRUE,2),
    ('production','master','bom_reference','BOM/Recipe Reference','picker',FALSE,3),
    ('production','master','finished_product','Finished Product','picker',TRUE,4),
    ('production','master','godown','Godown','picker',FALSE,5),
    ('production','detail','item','Raw Material / Output Item','picker',TRUE,1),
    ('production','detail','item_role','Role (Consumed/Produced/By-Product/Scrap)','select',TRUE,2),
    ('production','detail','qty','Qty','number',TRUE,3),
    ('production','detail','batch_lot','Batch/Lot','picker',FALSE,4)
    ON CONFLICT (voucher_type, section, field_key) DO NOTHING;
END; $$ LANGUAGE plpgsql;

SELECT tenant_master.seed_voucher_field_catalog();

-- 2 ------------------------------------------------------------------------
ALTER TABLE tenant_master.voucher_field_catalog ADD COLUMN IF NOT EXISTS auto_added BOOLEAN NOT NULL DEFAULT FALSE;

-- 3 ------------------------------------------------------------------------
ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS ird_billing BOOLEAN NOT NULL DEFAULT FALSE;
-- companies that already push bills to IRD (CBMS) are IRD billing companies
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'tenant_master' AND table_name = 'ird_settings') THEN
    UPDATE tenant_master.system_control_settings s SET ird_billing = TRUE
    WHERE ird_billing = FALSE AND EXISTS (SELECT 1 FROM tenant_master.ird_settings i WHERE i.tenant_id = s.tenant_id AND i.enabled);
  END IF;
END $$;

-- 4 ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_master.held_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    voucher_type VARCHAR(50) NOT NULL,
    label VARCHAR(200),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_held_entries_user ON tenant_master.held_entries(tenant_id, user_id, voucher_type);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_attach_all') THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
