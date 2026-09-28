# IRD Billing - System Architecture

## 1. Purpose and scope

Aakash Business ERP issues tax invoices (Sales Bill) and credit notes for returns (Sales Return) that must follow the Inland Revenue Department (IRD) of Nepal rules for computerised / electronic billing software:

- every issued bill is kept unchanged - it can be **cancelled**, never edited or deleted;
- a **materialized register** of every bill and return with the columns IRD asks for;
- every print is counted and a re-print is marked **Copy of Original**;
- an **audit log** of posting, cancellation, printing and blocked attempts;
- bills and returns are sent to IRD's **Central Billing Monitoring System (CBMS)** through its API, with a queue and retries;
- the Sales Book (Annex 13 style), VAT registers and the monthly VAT return are produced from the same data.

This document describes how the software does that. The user steps are in the *IRD User Manual*.

## 2. Components

| Layer | Component | Job |
|---|---|---|
| Browser | Sales Bill / Sales Return entry (`SalesBill.jsx`, `SalesReturn.jsx`) | Enter and post bills and returns. With IRD Billing on, a posted document only offers **Cancel** (Document Actions policy). |
| Browser | Print Preview (`PrintPreview.jsx`) | Prints the bill; asks the server how many times it was printed; a re-print carries "COPY OF ORIGINAL (n)". |
| Browser | IRD Compliance (`IrdCompliance.jsx`, menu Tools > IRD Compliance / CBMS) | Materialized View, Sales Book, CBMS Sync (queue, retry), Audit Log, Settings. |
| Server | `routes/salesBillRoutes.js`, `routes/salesReturnRoutes.js` | Posting, cancelling; after posting calls `ird.autoSync` (never blocks the posting). |
| Server | `routes/documentActionRoutes.js` | `IRD_LOCKED` = sales_bill, sales_return: when System Control > IRD Billing is on, modify / remove / back-to-draft of a posted one is refused. |
| Server | `utils/ird.js` | Reads the register, BS date and IRD fiscal year text, Sales Book, CBMS payload, push, queue, retries, print info. |
| Server | `routes/performanceRoutes.js` (IRD section) | `/api/ird/...` endpoints used by the screens. |
| Database | `ird_sales_materialized` | The IRD register (one row per bill / return). Written **only by triggers**. |
| Database | `ird_bill_audit_log` | Every insert / post / cancel / print / blocked edit or delete. |
| Database | `ird_settings`, `ird_sync_log` | CBMS credentials and options; the push queue with attempts and responses. |
| Database | triggers of migration 118 | Keep the register, block changes to posted documents, count prints. |

## 3. Data flow

1. **Draft** - a Sales Bill is saved as draft: nothing goes to the register; it may still be changed or removed.
2. **Post** - status becomes `posted`:
   - the accounting batch (customer Dr, sales Cr, VAT Cr) and the stock movement are written (see the Developer Guide);
   - trigger `trg_ird_sales_bills_mat` (`ird_sync_materialized`) inserts / updates the row in `ird_sales_materialized` - bill no, date, customer and PAN, amount, discount, taxable, non-taxable, VAT, total, payment method, entered by, active = true - and writes `post` to the audit log;
   - the server fills the BS date (`YYYY.MM.DD`) and IRD fiscal year (`2082.083`) text when missing;
   - `ird.autoSync` pushes it to CBMS in the background when *Push automatically* is on.
3. **Print** - every print writes `document_print_log`; trigger `trg_ird_print_log` sets `is_bill_printed`, raises `print_count`, stamps `printed_time` / `printed_by`, and logs `print`. The next print shows "COPY OF ORIGINAL (n)".
4. **Cancel** - status becomes `cancelled` (reason required): accounts and stock are reversed, the register row gets `is_bill_active = false`, `cancelled_at`, `cancel_reason`, and the audit log `cancel`. A cancelled bill cannot be re-opened.
5. **Return** - a Sales Return (credit note) goes through the same steps with doc type `sales_return`, `ref_bill_no` = the original bill and `return_reason`; CBMS receives it on `api/billreturn`.

## 4. Protection of issued documents (database level)

| Trigger | Table | Rule |
|---|---|---|
| `trg_ird_sales_bills_guard`, `trg_ird_sales_returns_guard` | `sales_bills`, `sales_returns` | DELETE of a non-draft document is refused ("cancel it instead"). A posted / cancelled document cannot change bill no, date, customer, total or VAT. A cancelled document cannot go back. |
| `trg_ird_sales_bill_lines_guard`, `trg_ird_sales_return_lines_guard` | detail lines | Lines of a posted / cancelled document cannot be added, removed or have qty, rate, amount, VAT or product changed. |
| `trg_batches_closed_fy`, `trg_stock_closed_fy` (migration 146) | GL batches, stock movements | Nothing can be posted into, or removed from, a closed fiscal year. |
| `check_ledger_batch_balance` (migration 45) | GL lines | Every accounting batch balances (Dr = Cr). |

Because these rules live in the database, no screen, API call or import can bypass them.

## 5. The materialized register (`ird_sales_materialized`)

| Column | Meaning |
|---|---|
| `fiscal_year` | IRD fiscal year text, e.g. `2082.083` |
| `bill_no`, `ref_bill_no` | Bill (or credit note) number; for a return the original bill |
| `customer_name`, `customer_pan` | Buyer and PAN / VAT no |
| `bill_date`, `bill_date_bs` | AD date and BS date `YYYY.MM.DD` |
| `amount`, `discount` | Gross before discount, discount |
| `taxable_amount`, `non_taxable_amount`, `tax_amount`, `total_amount` | Taxable value, exempt value, VAT 13%, total |
| `payment_method` | Cash / credit |
| `sync_with_ird`, `is_realtime` | Sent to CBMS; real-time or not |
| `is_bill_printed`, `print_count`, `printed_time`, `printed_by` | Print status |
| `is_bill_active` | False once cancelled |
| `entered_by`, `transaction_id`, `vat_refund_amount` | As the directive's layout |

The screen *Materialized View* shows these columns (`IS_Bill_Printed`, `Print_Count`, `Is_Bill_Active` ...) and can be exported.

## 6. CBMS integration

- **Settings** (`ird_settings`): enabled, API base URL (default `https://cbapi.ird.gov.np`), username, password (stored, never shown back), seller PAN, real-time flag, push automatically on posting, maximum attempts.
- **Payload** (`buildPayload`): username, password, seller_pan, buyer_pan, buyer_name, fiscal_year, invoice_number / invoice_date (BS) - or for a return ref_invoice_number, credit_note_number, credit_note_date, reason_for_return - total_sales, taxable_sales_vat, vat, excisable_amount, excise, taxable_sales_hst, hst, amount_for_esf, esf, export_sales, tax_exempted_sales, isrealtime, datetimeClient.
- **Endpoints**: `POST {base}/api/bill` for bills, `POST {base}/api/billreturn` for returns.
- **Responses**: 200 saved; 100 credentials do not match; 101 bill already exists (treated as synced); 102 exception while saving; 103 unknown exception; 104 model invalid; 105 bill does not exist (a return of an unknown bill); `NET` network error.
- **Queue** (`ird_sync_log`): one row per document - pending / success / failed / skipped, attempts, last response, the request sent (password masked). *Sync pending* sends bills before returns, oldest first; a document stops after *max attempts* until *Retry*. A bill cancelled before it was ever sent is marked *skipped*.
- A CBMS failure never blocks or undoes a posting; it stays in the queue.

## 7. Reports built on the same data

- **IRD Sales Book** (Annex 13 style): date, bill no, buyer, PAN, total, non-taxable, export, taxable, VAT.
- **Sales / Purchase VAT Register, VAT Monthly Summary, VAT Return, Annex 13 (above threshold)** - `routes/vatReportRoutes.js`, one loader for all.
- **Reconciliation** - VAT register against the VAT ledgers, document by document.

## 8. Security and control

- Users need the rights of their Security Group for sales entry, cancel and IRD settings; the audit log records the user of every action.
- Document numbers come from Document Numbering (per fiscal year, no gaps: *Doc Class Register (number gaps)* report).
- The system date / BS date conversion uses the official BS calendar table; the fiscal year text follows the IRD format.
- Backups are those of the database; the register and logs are ordinary tables included in them.

## 9. Operating checklist

1. System Control: turn **IRD Billing** on; set the VAT ledger and Document Numbering for Sales Bill / Sales Return.
2. IRD Compliance > Settings: CBMS username, password, seller PAN, *Enable CBMS sync*, *Push automatically*.
3. Post a test bill: check it in Materialized View, then CBMS Sync (status success / 200).
4. Daily: CBMS Sync - no *failed* rows (Retry after fixing the cause).
5. Monthly: VAT Return and Reconciliation tallied before filing.
