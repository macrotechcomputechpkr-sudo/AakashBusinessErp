-- =============================================
-- INPUT VAT GL BACKFILL (Purchase Bill / Purchase Return)
-- Applies, once, to documents posted earlier the SAME rule new postings
-- use (utils/vatLedger.js + utils/grnAccounting.js):
--   * VAT from a VAT billing term -> that term's Billing Ledger
--     (returns: its Return Ledger, else Billing Ledger)
--   * VAT typed on the line       -> default VAT ledger = System Control
--     VAT ledger, else the first enabled purchase VAT term's Billing Ledger
--   * anything that resolves to no ledger stays where it was
-- Balanced pairs are added to each document's EXISTING GL batch so a
-- later Cancel still reverses everything:
--   Purchase Bill   : Dr each VAT ledger        / Cr Goods Account (sum)
--   Purchase Return : Dr its credit ledger (sum) / Cr each VAT ledger
-- Idempotent: a batch that already has a line on ANY VAT ledger is skipped.
-- =============================================

CREATE TEMP TABLE _vat_default AS
SELECT s.tenant_id,
       COALESCE(s.vat_ledger_id, (
           SELECT t.billing_ledger_id FROM tenant_master.billing_terms t
           WHERE t.tenant_id = s.tenant_id AND t.tax_type = 'vat' AND t.billing_ledger_id IS NOT NULL
             AND COALESCE(t.is_enabled, TRUE) AND COALESCE(t.is_active, TRUE) AND t.applicable_purchase_entry
           ORDER BY t.display_order LIMIT 1)) AS ledger_id
FROM tenant_master.system_control_settings s;

CREATE TEMP TABLE _vat_ledgers AS
SELECT tenant_id, vat_ledger_id AS ledger_id FROM tenant_master.system_control_settings WHERE vat_ledger_id IS NOT NULL
UNION SELECT tenant_id, billing_ledger_id FROM tenant_master.billing_terms WHERE tax_type = 'vat' AND billing_ledger_id IS NOT NULL
UNION SELECT tenant_id, return_ledger_id  FROM tenant_master.billing_terms WHERE tax_type = 'vat' AND return_ledger_id IS NOT NULL;

-- ---------- Purchase Bills ----------
CREATE TEMP TABLE _bill_parts AS
SELECT src.bill_id, src.ledger_id, ROUND(SUM(src.amt), 2) AS amt FROM (
    SELECT b.id AS bill_id, dv.ledger_id, d.tax_amount AS amt
    FROM tenant_master.purchase_bills b
    JOIN tenant_master.purchase_bill_details d ON d.bill_id = b.id
    LEFT JOIN _vat_default dv ON dv.tenant_id = b.tenant_id
    WHERE b.status = 'posted'
    UNION ALL
    SELECT b.id, COALESCE(t.billing_ledger_id, dv.ledger_id), x.computed_amount
    FROM tenant_master.purchase_bills b
    JOIN tenant_master.document_billing_terms x ON x.document_type = 'purchase_bill' AND x.document_id = b.id
    JOIN tenant_master.billing_terms t ON t.id = x.billing_term_id AND t.tax_type = 'vat'
    LEFT JOIN _vat_default dv ON dv.tenant_id = b.tenant_id
    WHERE b.status = 'posted'
    UNION ALL
    SELECT b.id, COALESCE(t.billing_ledger_id, dv.ledger_id), x.computed_amount
    FROM tenant_master.purchase_bills b
    JOIN tenant_master.document_line_billing_terms x ON x.document_type = 'purchase_bill' AND x.document_id = b.id
    JOIN tenant_master.billing_terms t ON t.id = x.billing_term_id AND t.tax_type = 'vat'
    LEFT JOIN _vat_default dv ON dv.tenant_id = b.tenant_id
    WHERE b.status = 'posted'
) src
WHERE src.ledger_id IS NOT NULL
GROUP BY src.bill_id, src.ledger_id
HAVING ROUND(SUM(src.amt), 2) > 0;

CREATE TEMP TABLE _bill_targets AS
SELECT bt.id AS batch_id, b.id AS bill_id, b.tenant_id,
       COALESCE(b.goods_account_ledger_id, g.goods_account_ledger_id) AS goods_ledger_id,
       (SELECT SUM(p.amt) FROM _bill_parts p WHERE p.bill_id = b.id) AS vat_total, b.total_amount
FROM tenant_master.purchase_bills b
LEFT JOIN tenant_master.purchase_grns g ON g.id = b.source_grn_id
JOIN tenant_master.ledger_transaction_batches bt ON bt.document_type = 'purchase_bill' AND bt.document_id = b.id
WHERE b.status = 'posted'
  AND NOT EXISTS (SELECT 1 FROM tenant_master.ledger_transaction_lines x
                  JOIN _vat_ledgers v ON v.tenant_id = b.tenant_id AND v.ledger_id = x.ledger_account_id
                  WHERE x.batch_id = bt.id);

INSERT INTO tenant_master.ledger_transaction_lines (tenant_id, batch_id, ledger_account_id, debit_amount, credit_amount, narration)
SELECT t.tenant_id, t.batch_id, p.ledger_id, p.amt, 0, 'Input VAT (GL backfill)'
FROM _bill_targets t JOIN _bill_parts p ON p.bill_id = t.bill_id
WHERE t.goods_ledger_id IS NOT NULL AND t.vat_total > 0 AND t.vat_total < t.total_amount
UNION ALL
SELECT t.tenant_id, t.batch_id, t.goods_ledger_id, 0, t.vat_total, 'Input VAT (GL backfill)'
FROM _bill_targets t
WHERE t.goods_ledger_id IS NOT NULL AND t.vat_total > 0 AND t.vat_total < t.total_amount;

-- ---------- Purchase Returns ----------
CREATE TEMP TABLE _ret_parts AS
SELECT src.return_id, src.ledger_id, ROUND(SUM(src.amt), 2) AS amt FROM (
    SELECT r.id AS return_id, dv.ledger_id, d.tax_amount AS amt
    FROM tenant_master.purchase_returns r
    JOIN tenant_master.purchase_return_details d ON d.return_id = r.id
    LEFT JOIN _vat_default dv ON dv.tenant_id = r.tenant_id
    WHERE r.status = 'posted'
    UNION ALL
    SELECT r.id, COALESCE(t.return_ledger_id, t.billing_ledger_id, dv.ledger_id), x.computed_amount
    FROM tenant_master.purchase_returns r
    JOIN tenant_master.document_billing_terms x ON x.document_type = 'purchase_return' AND x.document_id = r.id
    JOIN tenant_master.billing_terms t ON t.id = x.billing_term_id AND t.tax_type = 'vat'
    LEFT JOIN _vat_default dv ON dv.tenant_id = r.tenant_id
    WHERE r.status = 'posted'
    UNION ALL
    SELECT r.id, COALESCE(t.return_ledger_id, t.billing_ledger_id, dv.ledger_id), x.computed_amount
    FROM tenant_master.purchase_returns r
    JOIN tenant_master.document_line_billing_terms x ON x.document_type = 'purchase_return' AND x.document_id = r.id
    JOIN tenant_master.billing_terms t ON t.id = x.billing_term_id AND t.tax_type = 'vat'
    LEFT JOIN _vat_default dv ON dv.tenant_id = r.tenant_id
    WHERE r.status = 'posted'
) src
WHERE src.ledger_id IS NOT NULL
GROUP BY src.return_id, src.ledger_id
HAVING ROUND(SUM(src.amt), 2) > 0;

CREATE TEMP TABLE _ret_targets AS
SELECT bt.id AS batch_id, r.id AS return_id, r.tenant_id, r.total_amount,
       (SELECT SUM(p.amt) FROM _ret_parts p WHERE p.return_id = r.id) AS vat_total,
       -- the return's credit ledger = the one credit line that is not the vendor
       (SELECT l.ledger_account_id FROM tenant_master.ledger_transaction_lines l
        WHERE l.batch_id = bt.id AND l.credit_amount > 0 AND l.ledger_account_id <> r.vendor_ledger_id
        ORDER BY l.credit_amount DESC LIMIT 1) AS credit_ledger_id
FROM tenant_master.purchase_returns r
JOIN tenant_master.ledger_transaction_batches bt ON bt.document_type = 'purchase_return' AND bt.document_id = r.id
WHERE r.status = 'posted'
  AND NOT EXISTS (SELECT 1 FROM tenant_master.ledger_transaction_lines x
                  JOIN _vat_ledgers v ON v.tenant_id = r.tenant_id AND v.ledger_id = x.ledger_account_id
                  WHERE x.batch_id = bt.id);

INSERT INTO tenant_master.ledger_transaction_lines (tenant_id, batch_id, ledger_account_id, debit_amount, credit_amount, narration)
SELECT t.tenant_id, t.batch_id, t.credit_ledger_id, t.vat_total, 0, 'Input VAT reversal (GL backfill)'
FROM _ret_targets t
WHERE t.credit_ledger_id IS NOT NULL AND t.vat_total > 0 AND t.vat_total < t.total_amount
UNION ALL
SELECT t.tenant_id, t.batch_id, p.ledger_id, 0, p.amt, 'Input VAT reversal (GL backfill)'
FROM _ret_targets t JOIN _ret_parts p ON p.return_id = t.return_id
WHERE t.credit_ledger_id IS NOT NULL AND t.vat_total > 0 AND t.vat_total < t.total_amount;

DROP TABLE _vat_default; DROP TABLE _vat_ledgers;
DROP TABLE _bill_parts; DROP TABLE _bill_targets;
DROP TABLE _ret_parts; DROP TABLE _ret_targets;
