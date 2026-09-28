# IRD Billing - User Manual

## 1. What IRD billing means in this software

When **IRD Billing** is turned on (Setup > System Control), sales bills and sales returns follow the Inland Revenue Department rules:

- a posted bill cannot be changed or deleted - only **cancelled** (with a reason);
- every bill and return is kept in the **IRD register** (Materialized View);
- the first print is the original; every later print says **COPY OF ORIGINAL (n)**;
- bills and returns can be sent to IRD's **CBMS** automatically;
- every posting, cancellation and print is written to the **IRD Audit Log**.

## 2. One-time setup

1. **Setup > System Control**
   - turn on *IRD Billing*;
   - set the *VAT Ledger* (VAT payable).
2. **Setup > Document Numbering**
   - give Sales Bill and Sales Return their number series (per fiscal year).
3. **Tools > IRD Compliance / CBMS > Settings**
   - *Enable CBMS sync*;
   - *CBMS API base URL* (leave the default unless IRD gives another);
   - *Username*, *Password* and *Seller PAN*, as registered with IRD;
   - *Realtime* on;
   - *Push automatically when a bill / return is posted* on;
   - *Max attempts* (e.g. 5): how many times a failed document is retried automatically.
4. Post one test bill and check that it appears in **Materialized View** and shows *success* in **CBMS Sync**.

## 3. Daily work

### Making a bill

1. Data Entry > Sales Transaction > **Sales Bill / Invoice**.
2. Choose Cash / Credit, Customer (PAN is taken from the customer), items, qty, rate, discount, VAT.
3. **Save**. The bill is posted: accounts, stock, the IRD register and (if on) CBMS all update.
4. **Print**. The first print is the original.

### When a bill is wrong

- You cannot modify or remove a posted bill.
- Open it from the list and use **Cancel** (Document Actions), and write the reason.
  - The bill stays in the register as *inactive*.
  - Its accounts and stock are reversed.
  - CBMS gets the cancellation status.
- Make a new, correct bill.

### Goods coming back

- Use **Sales Return** (credit note) against the original bill.
- Give the *Return Reason*.
- It is sent to CBMS as a bill return, with the original bill number.

### Printing again

- Print the bill again from the list. It shows **COPY OF ORIGINAL (n)** automatically.
- The number of prints is in the Materialized View.

## 4. IRD Compliance screen (Tools > IRD Compliance / CBMS)

| Tab | What you see / do |
|---|---|
| Materialized View | Every bill and return with IRD's columns (fiscal year, bill no, customer, PAN, date BS, amount, discount, taxable, non-taxable, VAT, total, synced, printed, print count, active, entered by, printed by / time). Filter by date, document type, sync status, active. Export to Excel. |
| Sales Book | Annex 13 style: date, bill no, buyer, PAN, total, non-taxable, export, taxable, VAT - for the VAT return. |
| CBMS Sync | The queue: pending / success / failed / skipped, attempts, IRD's response. **Sync pending** sends all waiting documents; **Retry** sends one again. |
| Audit Log | Who posted, cancelled or printed which bill and when; blocked attempts to edit or delete. |
| Settings | CBMS credentials and options (see Setup). |

### CBMS responses

| Code | Meaning | What to do |
|---|---|---|
| 200 | Saved at IRD | Nothing |
| 101 | Bill already exists at IRD | Nothing - counted as synced |
| 100 | Username / password / PAN do not match | Correct Settings, then Retry |
| 102 / 103 | Error at IRD | Retry later |
| 104 | Data invalid (e.g. missing PAN format) | Correct the customer PAN / bill, then Retry |
| 105 | Return of a bill IRD does not know | Sync the original bill first, then Retry the return |
| NET | No connection | Retry when online |

## 5. Month end

1. **CBMS Sync**: no failed documents (fix and Retry).
2. **Accounts Report > VAT, TDS & IRD > VAT Return**: output VAT, input VAT, payable / credit carried forward.
3. **Reconciliation (VAT)**: *Tallied* - the VAT register agrees with the VAT ledger.
4. **IRD Sales Book** and **Annex 13**: export for filing.
5. When the year is closed (Setup > Fiscal Years > Close), nothing dated in that year can be posted or cancelled any more.

## 6. Questions

- **Why can I not edit a posted bill?** IRD rules - cancel it and issue a new one.
- **Why is my bill not in the Materialized View?** Only posted bills and returns are in it; a draft is not.
- **The internet was down when I posted.** The bill is posted normally and waits in CBMS Sync; it is sent on the next automatic attempt or when you press *Sync pending*.
- **Who can cancel?** Users whose Security Group allows cancelling sales documents; every cancellation is in the Audit Log.
