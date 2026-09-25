-- =============================================
-- ENTRY FIELD CONTROL
-- Two tables:
--   1. voucher_field_catalog - a SEEDED, read-mostly reference of every
--      field that exists on each voucher type's Master (header) and
--      Detail (line) sections. Informed by Tally (bill-wise details,
--      salesman/credit-type fields), Microsoft Dynamics NAV/Business
--      Central (Sales Header tabs: General/Lines/Invoice Details/
--      Shipping and Billing; Sales Line fields like Qty to Ship,
--      discount %, UOM), and FACT/Busy's own field naming already seen
--      throughout this project's reference screenshots. This is what
--      the actual Sales/Purchase/Journal/Cash/Bank/PDC/Production ENTRY
--      SCREENS will eventually read from once built - they don't exist
--      yet, so this catalog is the field DEFINITION, not live data.
--   2. entry_field_controls - the actual per-tenant configuration: for
--      each (voucher_type, field_key), a mode (Enabled/Disabled/
--      Compulsory/ReadOnly) that can be set at three scopes - Global
--      (applies to everyone), User Group (overrides Global for that
--      group), or User (overrides both, for one specific person).
--      Resolution priority when an entry screen asks "what mode should
--      this field be in for this user": User > User Group > Global.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.voucher_field_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_type VARCHAR(30) NOT NULL,
    section VARCHAR(10) NOT NULL DEFAULT 'master',
    field_key VARCHAR(60) NOT NULL,
    field_label VARCHAR(150) NOT NULL,
    field_data_type VARCHAR(20) NOT NULL DEFAULT 'text',
    -- A handful of fields (Party, Date, Voucher No...) can never be
    -- fully switched off without breaking the voucher entirely - the
    -- app enforces this when validating entry_field_controls.
    is_system_required BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 1,

    CONSTRAINT unique_catalog_field UNIQUE (voucher_type, section, field_key),
    CONSTRAINT valid_catalog_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production'
    )),
    CONSTRAINT valid_catalog_section CHECK (section IN ('master', 'detail')),
    CONSTRAINT valid_catalog_data_type CHECK (field_data_type IN ('text', 'number', 'date', 'select', 'boolean', 'picker'))
);

CREATE TABLE IF NOT EXISTS tenant_master.entry_field_controls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_type VARCHAR(30) NOT NULL,
    field_key VARCHAR(60) NOT NULL,
    scope VARCHAR(15) NOT NULL DEFAULT 'global',
    -- FIX: was REFERENCES security_groups(id), a table that does not exist
    -- (groups live in security_rights_groups) - this made the whole
    -- CREATE TABLE fail on a fresh database.
    user_group_id UUID REFERENCES tenant_master.security_rights_groups(id),
    user_id UUID,
    mode VARCHAR(15) NOT NULL DEFAULT 'enabled',

    -- FEATURE: genuine gaps found comparing against another ERP's own
    -- per-field entry control - clearing a repetitive field after every
    -- save (e.g. Remarks, so it doesn't carry over to the next entry),
    -- a tenant-configurable default value for a field, and a custom
    -- caption overriding the catalog's own seeded label (e.g. renaming
    -- "Remarks" to "Special Instructions" for one tenant's workflow).
    is_clear_on_save BOOLEAN DEFAULT FALSE,
    default_value VARCHAR(200),
    custom_caption VARCHAR(150),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID,

    CONSTRAINT valid_control_scope CHECK (scope IN ('global', 'user_group', 'user')),
    CONSTRAINT valid_control_mode CHECK (mode IN ('enabled', 'disabled', 'compulsory', 'readonly')),
    CONSTRAINT scope_matches_reference CHECK (
        (scope = 'global' AND user_group_id IS NULL AND user_id IS NULL) OR
        (scope = 'user_group' AND user_group_id IS NOT NULL AND user_id IS NULL) OR
        (scope = 'user' AND user_id IS NOT NULL AND user_group_id IS NULL)
    )
);
-- FIX: one rule per (voucher, field) per scope. A plain UNIQUE over the
-- nullable group/user columns never fired for Global rules (NULL <> NULL
-- in Postgres), so saving a Global rule again inserted a duplicate and an
-- arbitrary one won. One partial unique index per scope closes that.
CREATE UNIQUE INDEX IF NOT EXISTS ux_efc_global ON tenant_master.entry_field_controls(tenant_id, voucher_type, field_key) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS ux_efc_group  ON tenant_master.entry_field_controls(tenant_id, voucher_type, field_key, user_group_id) WHERE scope = 'user_group';
CREATE UNIQUE INDEX IF NOT EXISTS ux_efc_user   ON tenant_master.entry_field_controls(tenant_id, voucher_type, field_key, user_id) WHERE scope = 'user';

CREATE INDEX IF NOT EXISTS idx_field_controls_lookup ON tenant_master.entry_field_controls(tenant_id, voucher_type, field_key);
CREATE INDEX IF NOT EXISTS idx_field_controls_user ON tenant_master.entry_field_controls(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_field_controls_group ON tenant_master.entry_field_controls(user_group_id) WHERE user_group_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_entry_field_controls_updated_at ON tenant_master.entry_field_controls;
CREATE TRIGGER trg_entry_field_controls_updated_at BEFORE UPDATE ON tenant_master.entry_field_controls
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- =============================================
-- SEED: the full field catalog. Same 33-row-style seed pattern already
-- used for seed_default_account_groups().
-- =============================================
CREATE OR REPLACE FUNCTION tenant_master.seed_voucher_field_catalog()
RETURNS VOID AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM tenant_master.voucher_field_catalog LIMIT 1) THEN
        RETURN; -- already seeded (this catalog is shared/global reference data, not per-tenant)
    END IF;

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
    ('production','detail','batch_lot','Batch/Lot','picker',FALSE,4);
END; $$ LANGUAGE plpgsql;

SELECT tenant_master.seed_voucher_field_catalog();
