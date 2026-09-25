-- =============================================
-- NEPAL VAT COMPLIANCE FIX - Fixed Asset VAT Separation
-- Comparing against another ERP's VAT-tracking tables surfaced a real
-- gap: Nepal's VAT return reports "Purchase of Capital Goods/Fixed
-- Assets" VAT separately from regular "Purchase of Goods/Services" VAT
-- - they go in different boxes of the return. product_master already
-- has a 'fixed_asset' product_type; this view just needed to actually
-- USE it to split the two out, and to carry the vendor's own PAN
-- number (also required on the return, and already tracked on
-- ledger_accounts, just never surfaced here).
-- =============================================

-- columns change order vs. 51, which CREATE OR REPLACE cannot do
DROP VIEW IF EXISTS tenant_master.v_purchase_vat_register;
CREATE VIEW tenant_master.v_purchase_vat_register AS
SELECT
    b.id AS bill_id, b.tenant_id, b.doc_no, b.doc_date,
    COALESCE(b.vendor_name_snapshot, b.cash_vendor_name) AS vendor_name,
    l.pan_number AS vendor_pan_number,
    b.party_bill_no, b.party_bill_date,
    b.import_detail_mode, b.customs_office_name_snapshot, b.customs_declaration_no, b.customs_declaration_date,
    d.id AS detail_id, COALESCE(d.product_name_snapshot, p.product_name) AS product_name,
    (pg.product_type = 'asset') AS is_fixed_asset_purchase,
    d.qty, d.rate, d.amount AS invoiced_amount, d.tax_percent, d.tax_amount AS local_tax_amount,
    d.item_import_taxable_amount,
    d.item_import_tax_free_amount,
    b.bill_wise_import_taxable_amount, b.bill_wise_import_tax_free_amount,
    COALESCE(
        d.item_import_taxable_amount,
        CASE WHEN b.import_detail_mode = 'bill_wise' THEN b.bill_wise_import_taxable_amount / NULLIF((SELECT COUNT(*) FROM tenant_master.purchase_bill_details WHERE bill_id = b.id), 0) END
    ) AS effective_import_taxable_amount,
    COALESCE(
        d.item_import_tax_free_amount,
        CASE WHEN b.import_detail_mode = 'bill_wise' THEN b.bill_wise_import_tax_free_amount / NULLIF((SELECT COUNT(*) FROM tenant_master.purchase_bill_details WHERE bill_id = b.id), 0) END
    ) AS effective_import_tax_free_amount,
    CASE WHEN pg.product_type = 'asset' THEN d.amount - d.tax_amount ELSE NULL END AS asset_taxable_amount,
    CASE WHEN pg.product_type = 'asset' THEN d.tax_amount ELSE NULL END AS asset_tax_amount,
    CASE WHEN pg.product_type IS DISTINCT FROM 'asset' THEN d.amount - d.tax_amount ELSE NULL END AS regular_taxable_amount,
    CASE WHEN pg.product_type IS DISTINCT FROM 'asset' THEN d.tax_amount ELSE NULL END AS regular_tax_amount
FROM tenant_master.purchase_bill_details d
JOIN tenant_master.purchase_bills b ON b.id = d.bill_id
LEFT JOIN tenant_master.products p ON p.id = d.product_id
-- the asset / service / inventory type lives on the product's group (products has no product_type)
LEFT JOIN tenant_master.product_groups pg ON pg.id = p.product_group_id
LEFT JOIN tenant_master.ledger_accounts l ON l.id = b.vendor_ledger_id;
