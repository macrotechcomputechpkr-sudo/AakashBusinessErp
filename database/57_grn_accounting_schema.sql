-- =============================================
-- GRN ACCOUNTING - STOCK + GR/IR CLEARING ENTRIES
-- "Challan Effect On Stock and Account ma Outstanding Purchase Challan
-- Dr Cr Outstanding Purchase Challan Creditor Dekhaune."
--
-- Wires GRN and Bill into the ALREADY-BUILT Dr/Cr ledger transaction
-- infrastructure (ledger_transaction_batches/lines, file 45) for the
-- first time. Standard "GR/IR clearing" pattern used across ERP
-- systems (SAP calls this exact account "GR/IR Clearing"):
--   1. GRN received  -> Dr Stock/Goods Account, Cr GRN Clearing
--      (a provisional liability: goods are in, no formal Bill yet)
--   2. Bill posted (sourced from that GRN) -> Dr GRN Clearing (clears
--      the provision), Cr Vendor (the REAL amount now payable)
--   3. A Bill NOT sourced from any GRN posts the traditional way
--      directly: Dr Goods Account, Cr Vendor
-- Cancelling either document reverses its own batch.
-- =============================================

-- A tenant-wide default; if left NULL, GRN/Bill simply don't create
-- these GL entries (many tenants may not want formal GR/IR clearing).
ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS grn_clearing_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
