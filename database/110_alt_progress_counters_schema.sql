-- =============================================
-- ALTERNATE-UNIT PROGRESS COUNTERS
-- The "how much of this line has moved on" counters (qty_ordered,
-- qty_delivered, qty_received, qty_billed, qty_returned) count only the
-- PRIMARY unit. A dual-unit line of 0 Carton + 7 Pcs (loose pieces) or
-- the Pcs part of 5 Carton + 7 Pcs was therefore never counted: it never
-- showed as delivered/billed, nor as outstanding. Each counter gets an
-- alt_* twin, moved together with it, so remaining work is measured in
-- base units: (qty * factor + alt_qty) - (done * factor + alt_done).
-- =============================================
ALTER TABLE tenant_master.sales_quotation_details      ADD COLUMN IF NOT EXISTS alt_qty_ordered   DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.sales_order_details          ADD COLUMN IF NOT EXISTS alt_qty_delivered DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.sales_delivery_details       ADD COLUMN IF NOT EXISTS alt_qty_billed    DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.sales_bill_details           ADD COLUMN IF NOT EXISTS alt_qty_returned  DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.purchase_requisition_details ADD COLUMN IF NOT EXISTS alt_qty_ordered   DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.purchase_quotation_details   ADD COLUMN IF NOT EXISTS alt_qty_ordered   DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.purchase_order_details       ADD COLUMN IF NOT EXISTS alt_qty_received  DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.purchase_grn_details         ADD COLUMN IF NOT EXISTS alt_qty_billed    DECIMAL(15, 4) DEFAULT 0;
ALTER TABLE tenant_master.purchase_bill_details        ADD COLUMN IF NOT EXISTS alt_qty_returned  DECIMAL(15, 4) DEFAULT 0;
