-- =============================================
-- PRODUCT COMPANY - COMPULSORY PER SIDE
-- System Control decides whether Sales-side and/or Purchase-side
-- (customer / vendor related) transactions must carry a Product Company.
-- When compulsory: the document header holds ONE company, only that
-- company's products may be used on it, and everything it creates -
-- GL lines, its bill-wise reference (for bill-to-bill settlement and
-- ageing) - carries that company.
-- =============================================
ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS product_company_compulsory_sales BOOLEAN DEFAULT FALSE;
ALTER TABLE tenant_master.system_control_settings ADD COLUMN IF NOT EXISTS product_company_compulsory_purchase BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_master.sales_quotations ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.sales_orders ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.sales_deliveries ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.sales_bills ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.sales_returns ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.sales_nonsaleable_returns ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.sales_additional_entries ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.purchase_requisitions ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.purchase_quotations ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.purchase_orders ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.purchase_grns ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.purchase_bills ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.purchase_returns ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.purchase_nonsaleable_returns ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
ALTER TABLE tenant_master.purchase_additional_expenses ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);

-- Bill-to-bill settlement / ageing filter by company.
ALTER TABLE tenant_master.bill_wise_references ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);
CREATE INDEX IF NOT EXISTS idx_bwr_product_company ON tenant_master.bill_wise_references(product_company_id) WHERE product_company_id IS NOT NULL;
ALTER TABLE tenant_master.pdc_vouchers ADD COLUMN IF NOT EXISTS product_company_id UUID REFERENCES tenant_master.product_companies(id);

-- Ageing view gains the reference's product company (company-wise ageing).
-- New column appended at the END so CREATE OR REPLACE VIEW accepts it.
CREATE OR REPLACE VIEW tenant_master.v_bill_wise_ageing AS
SELECT
    r.id AS reference_id, r.tenant_id, r.ledger_id,
    l.account_name AS vendor_name,
    r.source_type, r.source_doc_no, r.source_date, r.nature,
    r.total_amount, r.allocated_amount, r.remaining_amount,
    (CURRENT_DATE - r.source_date) AS age_days,
    CASE
        WHEN (CURRENT_DATE - r.source_date) <= 30 THEN '0-30'
        WHEN (CURRENT_DATE - r.source_date) <= 60 THEN '31-60'
        WHEN (CURRENT_DATE - r.source_date) <= 90 THEN '61-90'
        ELSE '90+'
    END AS age_bucket,
    r.product_company_id,
    pc.company_name AS product_company_name
FROM tenant_master.bill_wise_references r
JOIN tenant_master.ledger_accounts l ON l.id = r.ledger_id
LEFT JOIN tenant_master.product_companies pc ON pc.id = r.product_company_id
WHERE r.remaining_amount > 0
ORDER BY r.source_date;
