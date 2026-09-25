-- =============================================
-- GL BACKFILL - Purchase Return & Purchase Additional Expense
-- Until now neither document ever posted to the ledger. The runtime
-- code (utils/grnAccounting.js) now posts them going forward; this
-- migration applies the SAME rules once to documents that were
-- already posted, so vendor ledgers and the Ledger Report reconcile
-- with bill-wise balances.
--
-- Idempotent: only documents with NO existing GL batch are touched,
-- so re-running this is harmless. Cash-vendor documents (no vendor
-- ledger) are skipped, exactly as the Purchase Bill skips them.
-- =============================================

-- Purchase Return: Dr Vendor / Cr the tenant's Purchase Return Account
-- Mapping (System Control) when set, else the return's Goods Account,
-- for total_amount - the SAME rule as the runtime posting code.
WITH src AS (
    SELECT r.id, r.tenant_id, r.doc_date, r.doc_no, r.vendor_ledger_id,
           COALESCE(s.purchase_return_account_ledger_id, r.goods_account_ledger_id) AS credit_ledger_id,
           ROUND(r.total_amount, 2) AS amt
    FROM tenant_master.purchase_returns r
    LEFT JOIN tenant_master.system_control_settings s ON s.tenant_id = r.tenant_id
    WHERE r.status = 'posted'
      AND r.vendor_ledger_id IS NOT NULL
      AND COALESCE(s.purchase_return_account_ledger_id, r.goods_account_ledger_id) IS NOT NULL
      AND r.total_amount > 0
      AND NOT EXISTS (
          SELECT 1 FROM tenant_master.ledger_transaction_batches b
          WHERE b.document_type = 'purchase_return' AND b.document_id = r.id
      )
),
ins AS (
    INSERT INTO tenant_master.ledger_transaction_batches (tenant_id, document_type, document_id, batch_date, narration)
    SELECT tenant_id, 'purchase_return', id, doc_date, 'Purchase Return ' || doc_no || ' (GL backfill)'
    FROM src
    RETURNING id, document_id, tenant_id
)
INSERT INTO tenant_master.ledger_transaction_lines (tenant_id, batch_id, ledger_account_id, debit_amount, credit_amount, narration)
SELECT ins.tenant_id, ins.id, src.vendor_ledger_id, src.amt, 0, 'Purchase Return (GL backfill)'
FROM ins JOIN src ON src.id = ins.document_id
UNION ALL
SELECT ins.tenant_id, ins.id, src.credit_ledger_id, 0, src.amt, 'Purchase Return (GL backfill)'
FROM ins JOIN src ON src.id = ins.document_id;

-- Purchase Additional Expense: Dr each expense ledger ('add' lines),
-- Cr it for 'deduct' lines, net to the vendor (Cr if positive, Dr if
-- negative). Net is the sum of the ROUNDED line amounts so the batch
-- always balances, matching the runtime code.
WITH src AS (
    SELECT e.id, e.tenant_id, e.doc_date, e.doc_no, e.vendor_ledger_id,
           SUM(CASE WHEN l.entry_sign = 'deduct' THEN -ROUND(l.amount, 2) ELSE ROUND(l.amount, 2) END) AS net
    FROM tenant_master.purchase_additional_expenses e
    JOIN tenant_master.purchase_additional_expense_lines l
      ON l.expense_id = e.id AND l.expense_ledger_id IS NOT NULL AND l.amount > 0
    WHERE e.status = 'posted'
      AND e.vendor_ledger_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM tenant_master.ledger_transaction_batches b
          WHERE b.document_type = 'purchase_additional_expense' AND b.document_id = e.id
      )
    GROUP BY e.id, e.tenant_id, e.doc_date, e.doc_no, e.vendor_ledger_id
    HAVING SUM(CASE WHEN l.entry_sign = 'deduct' THEN -ROUND(l.amount, 2) ELSE ROUND(l.amount, 2) END) <> 0
),
ins AS (
    INSERT INTO tenant_master.ledger_transaction_batches (tenant_id, document_type, document_id, batch_date, narration)
    SELECT tenant_id, 'purchase_additional_expense', id, doc_date, 'Additional Expense ' || doc_no || ' (GL backfill)'
    FROM src
    RETURNING id, document_id, tenant_id
)
INSERT INTO tenant_master.ledger_transaction_lines (tenant_id, batch_id, ledger_account_id, debit_amount, credit_amount, narration)
SELECT ins.tenant_id, ins.id, l.expense_ledger_id,
       CASE WHEN l.entry_sign = 'deduct' THEN 0 ELSE ROUND(l.amount, 2) END,
       CASE WHEN l.entry_sign = 'deduct' THEN ROUND(l.amount, 2) ELSE 0 END,
       COALESCE(l.description, 'Additional Expense (GL backfill)')
FROM ins
JOIN tenant_master.purchase_additional_expense_lines l
  ON l.expense_id = ins.document_id AND l.expense_ledger_id IS NOT NULL AND l.amount > 0
UNION ALL
SELECT ins.tenant_id, ins.id, src.vendor_ledger_id,
       CASE WHEN src.net < 0 THEN -src.net ELSE 0 END,
       CASE WHEN src.net > 0 THEN src.net ELSE 0 END,
       'Additional Expense (GL backfill)'
FROM ins JOIN src ON src.id = ins.document_id;
