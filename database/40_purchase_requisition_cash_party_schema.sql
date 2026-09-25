-- =============================================
-- PURCHASE REQUISITION - CASH PARTY SUPPORT
-- "Cash garyo vane manual type garne" - a Cash-mode document doesn't
-- need a full Vendor Ledger; it can carry a free-text party name and
-- its own Billing/Shipping + Taxation details captured inline, the
-- same information a Vendor Ledger would normally hold.
-- =============================================

ALTER TABLE tenant_master.purchase_requisitions
    ADD COLUMN IF NOT EXISTS cash_vendor_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS cash_billing_details JSONB;

-- Either a real Vendor Ledger OR a Cash party name should be present in
-- credit mode's meaningful case, but never enforce this too strictly at
-- the DB layer since a Requisition can genuinely have neither yet
-- (vendor not yet decided yet at the requisition stage) - left as a
-- soft, application-layer expectation rather than a CHECK constraint.
