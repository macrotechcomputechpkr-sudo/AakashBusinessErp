-- =============================================
-- SALES RETURN - discount_percent
-- "Return haru maa pani term...hunu parxa" - Sales Return never had a
-- discount concept at all (unlike Sales Bill/Order/Quotation). Adding
-- it so the same ProductTermBar bulk/selected-rows discount tool
-- those documents already have works here too - e.g. a partial credit
-- for partially-damaged returned goods.
-- =============================================

ALTER TABLE tenant_master.sales_return_details
    ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0;
ALTER TABLE tenant_master.sales_return_details
    ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15, 2) DEFAULT 0;
