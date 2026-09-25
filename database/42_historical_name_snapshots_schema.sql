-- =============================================
-- HISTORICAL NAME SNAPSHOTS
-- "if the Ledger name changes later, THAT TIME's document should still
-- show the name as it was then" - a document must never silently
-- reflect a LATER rename of something it referenced. The fix is
-- denormalization: store the display name of every referenced master
-- directly on the document AT SAVE TIME, and READ FROM THE SNAPSHOT for
-- display/print - never re-join to the live master for historical
-- documents. The foreign key itself is kept too (still needed for
-- "find every document that used this vendor" lookups); only DISPLAY
-- switches to the snapshot.
-- =============================================

ALTER TABLE tenant_master.purchase_requisitions
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

ALTER TABLE tenant_master.purchase_requisition_details
    ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(200),
    ADD COLUMN IF NOT EXISTS uom_name_snapshot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS alt_unit_name_snapshot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS alt1_unit_name_snapshot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS free_uom_name_snapshot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS warehouse_name_snapshot VARCHAR(200);
