# Logic audit - round 16

What was checked, how it compares with Tally, Busy, Marg, Zoho Books and
Microsoft Dynamics NAV / Business Central, what was wrong and what was changed.
Each fix has a server test (`r22`-`r26`) and, where old data was affected, a
migration (145-147).

## 1. Stock value of purchases

| Area | Before | Other ERPs | Now |
|---|---|---|---|
| Purchase GRN / direct Bill stock cost | Entry **rate** stored as the cost of one **base** unit. A line in boxes (1 box = 12 pcs) at 1200/box valued each piece at 1200 - 12x over. Discount and non-VAT terms (freight on the bill) never reached the stock value. | Tally / Busy: item value = amount of the line after discount + additional cost apportioned. NAV: unit cost (LCY) per base unit incl. line discount and item charges. | Cost per base unit = the line's share of the document's goods value without VAT (the same figure the purchase account gets) / qty in base units (`utils/purchaseStockCost.js`). Purchase Return uses the same rule. |
| Additional expense (freight, customs, insurance ...) | Allocated to the purchase lines (`purchase_expense_allocations`) but **never** added to the stock value. | Tally "additional cost of purchase", Busy "landed cost", NAV item charges: go into the cost of the goods. | Posting an additional expense adds its allocated amount to the cost of the stock receipt of that line (GRN, direct Bill, or the GRN a Bill line came from; an Order line is split over the GRN / Bill lines made from it). Cancelling takes it out again. `stock_movements.base_unit_cost` keeps the cost without landed cost. |
| Production output / by-products | Cost stored per **entered** unit against a base-unit qty. | Per base unit. | Total cost / base qty. |
| Sales return into stock | Came back at the **selling rate** - margin went into stock value. | Tally / Busy: at cost; NAV: exact cost reversal of the original shipment. | Customer returns come back at the cost that batch / serial went out at, else the current average (stock engine ignores the selling rate on a return). |
| Services, non-inventory items, fixed assets on bills | Wrote stock movements: a service sold made "negative stock", a computer bought through a purchase bill became closing stock. | Not inventory in any of them. | No stock movement for Item Type service / non_inventory / fixed_asset; the negative-stock check skips them (`utils/stockItems.js`). Migration 147 removes such movements (open years only). |

## 2. Controls

| Area | Before | Other ERPs | Now |
|---|---|---|---|
| Closed fiscal year | Closing a year only set a flag; documents dated in it could still be posted, cancelled or re-posted - the closed Trial Balance could change. | NAV "Allow Posting From / To", Tally / Busy year lock. | Database trigger (migration 146): no GL batch or stock movement can be added to or removed from a closed / locked year, whatever module tries. |
| Negative stock | Checked only by Sales Delivery, Stock Transfer and Stock Adjustment, one line at a time. | Tally / Busy "negative stock: warn / block" on every outward voucher. | One rule (`utils/negativeStock.js`) also on direct Sales Bill and Purchase Return; lines of the same item / warehouse / batch are added up; base units. |
| "Post anyway?" and credit override | The server sent `warnings` / `credit_blocked`, but the client dropped every extra field of an error - the Sales Delivery "post anyway" prompt and the credit-limit override could never appear. | - | `authFetch` keeps the server's extra fields on the error; Sales Bill, Purchase Return and every entry saved through the fill bar ask "Post anyway?" when stock is short. |
| Supplier bill no | Could be entered twice for the same supplier - purchase and VAT credit booked twice. | NAV: Vendor Invoice No. must be unique per vendor; Tally / Busy warn. | Refused on save and on posting (another non-cancelled bill of the same supplier with the same number, ignoring case / spaces). |

## 3. Registers and reconciliation

* Sales / Purchase VAT Register: one-click books - Sales Book (bills + JV
  sales), Purchase Book (bills + additional bills + JV purchases), with
  returns and credit / debit notes. The default now includes JV sales.
* Reconciliation (Accounts Report > VAT, TDS & IRD): VAT, Sales Account,
  Purchase Account, **Purchase vs Stock** (new) and TDS - register against
  books document by document. Credit Notes / Debit Notes posted to a sales /
  purchase account are part of those registers. Additional bills show as
  "Purchase Additional".
* Account confirmation letter: purchases from / sales to the party in the
  period by nature (Inventory, Fixed Asset, Service), net of returns, without
  VAT, plus the VAT - in all built-in formats (designer option "Purchases /
  sales by nature").

## 4. Checked and found in order

* Every GL batch balances - enforced by the database (migration 45,
  deferred Dr = Cr trigger), for all modules.
* All 124 menu entries lead to a page; every API path used by the client
  exists on the server (the 13 that did not match a literal path are built
  at run time: remarks / terms CRUD, auth, LC / BG actions, dimension views).
* Stock transfer cost per base unit; stock adjustment cost = amount / base
  qty.
* Poultry, hatchery, construction and automobile post only through the
  normal documents (stock adjustments, sales / purchase bills, JVs) - their
  accounts and stock follow the same rules as above.

## 5. Observations left as they are

* Automobile vehicle delivery can be saved without a Sales Bill; the sale is
  then only in the accounts once the bill is made (the delivery screen links
  the bill). A dealership that wants "no delivery without invoice" can make
  the Sales Bill field compulsory in Entry Field Control.
* Additional expense posted after the goods were sold: the landed cost goes
  into the receipt's cost, so it reaches cost of sales through the stock
  valuation of the period (Tally-style), not as a separate "cost adjustment"
  entry dated on the expense (NAV-style).
* Migrations 138-147 have to be run on the live database; 145-147 also
  correct stock values already posted.
