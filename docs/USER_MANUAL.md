# Aakash Business ERP - User Manual

This manual explains every menu: what it is for, how to use it, and what it does to your **accounts** (ledgers, Trial Balance, P&L, Balance Sheet) and your **inventory** (stock quantity and value).

The effect of each transaction is shown in a box like this:

> **Accounts:** what is debited and credited. **Stock:** what goes in or out.


> **Help inside the system**
> - Every screen: **❓ Help** on the title bar (or Shift+F1) - what the screen is for, how to use it, its effect on accounts, stock and VAT, and every field on it.
> - Every field caption with a dotted underline shows its help when you point at it.
> - **Tools > Help Center**: this manual, a manual for each Business Nature, the IRD Billing architecture and user manual (everyone); the Developer Guide and the PDF of every menu screen (super admin).

## 1. Getting started

### 1.1 Logging in and the screen

- Log in with your company code, user name and password.
- The top menu bar has **Master Data, Data Entry, Accounts Report, Sales/Purchase, Analysis, Setup, Office, Tools**. **Poultry, Construction** and **Automobile** appear only when that Business Nature is turned on in System Control.
- Menus open to the side (fly-out). A thin line separates groups of options.
- Press **Enter** to move to the next field. In a grid, Enter moves to the next cell and then to a new line.
- Every report table has an Excel-style filter on each column heading.

### 1.2 First-time setup order

1. **Setup > System Control**: Business Nature, default ledgers, VAT, stock method, dual unit, approvals.
2. **Setup > Fiscal Years**, **Branches & Warehouses**, **Document Numbering**, **Currencies**.
3. **Master Data > Chart of Accounts**: groups and ledgers (customers, suppliers, banks, expenses).
4. **Master Data > Billing Terms** (VAT, discount, freight ...).
5. **Master Data > Product Units, Product Groups, Categories, Product Master**.
6. **Ledger Opening Balance** and **Product Opening Stock**.
7. **Setup > Users, Security Groups, Data Access**.

### 1.3 Buttons on every transaction screen

| Button | What it does | Effect |
|---|---|---|
| **Create / Save** | Saves the entry. If the module does not need approval, it is posted at once. | Accounts and stock are updated immediately |
| **Save as Draft** | Keeps what you typed as a temporary draft (no number). | None |
| **Modify** | A draft opens for editing. A posted entry is first reversed and reopened as a draft with the same number; change it and save again. | Old effect removed, new effect posted on save |
| **Remove** | Deletes a draft. | None |
| **Cancel** | Cancels a posted entry (a reason is required). The entry stays in the list as Cancelled. | All its effects are reversed |
| **Reverse** | Shown instead of Cancel on Sales Bill and Sales Return when Computerized Billing (IRD) is on. The bill is reversed by a return, as IRD requires. | Reversed through the return |
| **Print** | Prints with the design from Document Designer. | None |

**Fill bar** (one line at the top of every entry: the actions above, then **📄 Template ▾**):

- **Fill from Template**: fill from a saved template.
- **Fill from Previous Entry**: copy an earlier entry with a new number and today's date.
- **Open a Draft**: open a saved draft. When you save it as a real entry, the draft is deleted automatically.
- **Save as Template**: store the current entry as a template, for yourself only or for everyone.

**Window title bar**: Back, Refresh, Print, Dashboard, Report Center, **🔗 Related ▾** (other screens of the same menu group), **📊 Reports ▾** and **❓ Help** sit on the screen's title bar, so the form starts right below it. On a phone the title bar keeps Back, Refresh, Related, Reports and Help as icons; forms become one column and the fill bar scrolls sideways.

**Approval**: when a module is ticked under System Control > Approval Needed For, Save keeps the entry as **Awaiting approval** with no effect. Only a user whose Security Group has the approval right for that document can approve it. Approving posts it, and only then do accounts and stock move.

### 1.4 Common parts of a sales or purchase entry

- **Master part** (top): date (BS/AD), document number (automatic or manual, following Document Numbering), Cash/Credit, party, currency and exchange rate, sales rate type (Sr1-Sr5), agent, warehouse, and the source documents to pull from.
- **Item Code cell**: type a code, short name or barcode. In POS mode, scanning a barcode adds the item straight away.
- **Grid**: qty (and alternate unit for dual-unit items), free qty, rate, **Gross**, **Add / Less**, **Net Amount**. When System Control shows item charges for the entry, Add / Less is a button: it opens the line's Item Charges pop-up (discount, tax, excise ...) and shows the pop-up's total. When item charges are off, Add / Less only shows the amount (the product's term values still count). You may type the gross or net amount; the rate (or the qty, when the product allows it) is worked out for you.
- **Product-wise term popup**: discount, excise and similar terms for one line. You may type %, rate x qty or amount, depending on the term; the other values are worked out.
- **Overall term popup**: bill-level terms (VAT, freight, bill discount, rounding off). Amounts are split over the lines by value or quantity. The Local Amount shows the value in NPR when a foreign currency is used.
- **Footer tabs**: accounts, party address/PAN (with an option to update the master), remarks, and the total in words.

## 2. Master Data menu

### 2.1 Accounts Masters

**Chart of Accounts (Ledger)**

- Create account groups and ledgers. The group decides where a ledger appears in the Balance Sheet or P&L.
- The ledger code is automatic (customer, supplier or both).
- Options on a ledger: credit limit and credit days, bill-wise tracking, interest %, PAN, address, area, route, agent, default sub-ledger.

> **Accounts:** only the structure; no entry.

**Sub Ledgers**

- A second level under a ledger, e.g. employees under Salary, or vehicles under Fuel. Reports can show balances per sub-ledger.

**Cost & Profit Centers**

- Departments, projects or units to which income and expense lines can be tagged. They are used in P&L by Cost Center, Cost Center Statement and Budget reports.

**Billing Terms**

- Define terms used in bills:
  - **Type**: Normal, VAT or Excise.
  - **Sign**: add or deduct.
  - **Basis**: value or quantity.
  - **Calculation**: percentage, fixed rate, or formula, with an optional cap.
  - **Order** of calculation.
  - **Ledger** and sub-ledgers: Billing Ledger + Billing Sub-Ledger, Return Ledger + Return Sub-Ledger, Expiry Return Ledger + Expiry Return Sub-Ledger.
  - **Category**: e.g. Rounded Off, which rounds the bill and posts the difference.
  - **Entry input**: which of %, rate and amount the user may type.
  - **Manual override**: whether the value can be changed in the entry.
  - **Show in summary**.
  - **Term Used For**: *Transaction term* (Sales / Purchase / Production Entry - charged on the bill itself) or *Additional term* (Purchase Additional / Sales Additional - a later bill such as freight, customs, insurance).
  - **Effect**: **Include In Costing** (the amount goes into the cost of the goods / landed cost; off = an expense only) and **Include In Profitability** (counted in the profitability reports).
  - **Product Wise**: entered per product in a pop-up; otherwise bill-wise, divided over the products by the Basis.

> **Accounts:** each term amount posts to the term's ledger when a bill is posted (VAT to the VAT ledger).

**Remarks & Terms**

- Standard remark texts and terms and conditions printed on documents.

**Fixed Assets**

- The asset register: cost, date put to use, method (straight line or written down value), rate, asset / accumulated depreciation / expense ledgers.

> **Accounts:** none until depreciation is posted (see 3.1).

**Ledger Opening Balance**

- Enter each ledger's opening Dr/Cr for the first fiscal year. For bill-wise parties, enter the open bills.

> **Accounts:** sets the opening balance used by every report.

### 2.2 Product Masters

**Product Master**

- Code, short name, barcode, group, category, company, units (base, alternate, and dual unit with conversion factor).
- **Rate basis** for fixed dual items: any, primary or secondary unit.
- Sales rates Sr1-Sr5, purchase rate, MRP.
- VAT or non-VAT, excise.
- Sales / purchase / return / non-saleable return accounts, each with its own sub-ledger (e.g. Sales Return Account + Sales Return Sub-Ledger).
- Product-wise term values.
- Flags "qty from amount" for sales and for purchase.
- Batch/serial, expiry, re-order level, fixed-asset item.

> **Accounts:** decides which sales/purchase ledger a line posts to. **Stock:** decides the unit conversion.

**Product Units**

- Units such as PCS, CRT or KG, used in the unit conversions of each product.

**Product Groups**

- Group products for reports and data access (with extra details such as parent group and short name).

**Categories**

- Another way to classify products (brand, type) for reports and pricing.

**Product Opening Stock**

- Qty, rate and warehouse (batch/serial) on hand at the start.

> **Stock:** stock in, on the day before the first fiscal year. **Accounts:** none; the value appears as opening stock in the statements.

**BOM Template**

- Bill of materials: the raw materials and quantities that make one unit of a finished product, with by-products. Used by Production Order.

### 2.3 Rate & Discount

| Menu | Use |
|---|---|
| **Multiple Rate Types (Sr1-Sr5)** | Name the five sales rate columns (e.g. Wholesale, Retail, Dealer). |
| **Rate Category** | Give a customer category its own rate type or rate list. |
| **Discount Category** | Default discount % by customer category and product group. |
| **Product Rate Change** | Change the rates of many products at once, from a date. |
| **Offer Rate** | Scheme or offer rate for a period (date range), picked automatically in sales. |

> **Accounts / Stock:** none. They only fill rates in entries.

### 2.4 Sales Force & Routes

| Menu | Use |
|---|---|
| **Salesman / Agent** | Salesmen and agents with commission %, area, targets and mobile login. |
| **Route Sequencing** | The order in which customers are visited on each route. |
| **Route Plan & Mobile Login** | Which route a salesman visits on which date; login for the Salesman Mobile App. |
| **Transport Master** | Transporters and vehicles printed on challans and bills. |

### 2.5 Poultry Masters (Poultry only)

- Sheds and hatchers, poultry items (chick, feed, medicine, vaccine), breed standards, and poultry settings (ledgers and warehouse used by poultry postings).

## 3. Data Entry menu

### 3.1 Accounts

**Journal Voucher**

- Top: Voucher No. (from Document Numbering), Date, **JV Type**, Ref Doc No / Date, Memo Only, Cost Center, Unit.
- **Dates** can be English (AD) or Nepali (BS): the **AD / BS** button switches. In BS you type the date (2083-06-01 or 2083.6.1) or pick it from the Nepali calendar (📅); the other calendar's date shows beside it. The choice is remembered on your computer.
- **JV Type** decides which options show:

| JV Type | Options | Voucher lines made for you |
|---|---|---|
| Normal Journal | none | you type the lines |
| Taxable / Non-taxable Purchase | supplier, PAN, bill no / date, taxable, non-taxable, VAT, purchase / expense A/c, TDS | Dr purchase, Dr VAT, Cr supplier (less TDS), Cr TDS payable |
| Taxable / Non-taxable Sales | customer, invoice no, amounts, VAT, sales A/c, TDS | Dr customer (less TDS), Dr TDS receivable, Cr sales, Cr VAT |
| Asset Purchase / Asset Sales | as above, with a Fixed Asset A/c (sales may use a disposal income A/c) | same pattern; an asset purchase is a capital purchase in the VAT return |
| Service Purchase / Service Sales | as above, with a service expense / service income A/c | same pattern |
| TDS - on Purchase | supplier (supplier / both ledgers), the supplier's Purchase Bills and Purchase Additional Expenses without TDS (newest first, tick one or many), TDS % (per bill or for all), TDS ledger + sub-ledger | Dr supplier (TDS), Cr TDS payable (TDS). With no bill: Dr expense (amount), Cr TDS payable, Cr supplier (amount less TDS) |
| TDS - on Sales | customer (customer / both ledgers), the customer's Sales Bills without TDS, TDS %, TDS receivable ledger + sub-ledger | Dr TDS receivable (TDS), Cr customer (TDS) |

- TDS is only on the types that have it (not on a normal journal). The TDS ledger defaults from System Control and has its own **TDS Sub-Ledger**.
- TDS on bills: the base is each bill's value without VAT. A bill that has taken TDS (on a TDS journal, or on the bill itself) is not shown again; the journal keeps the list of its bills. Cancelling the journal frees them.
- The party list follows the side: suppliers + "both" ledgers for purchase, customers + "both" for sales. The voucher-line ledger list shows only that party side, the type's accounts (expense / income / asset), VAT and TDS ledgers.
- Example: taxable 1000, VAT 13% (130 worked out), non-taxable 1000 -> Purchase A/c 2000 Dr, VAT 130 Dr, supplier 2130 Cr.
- **Auto balance** (every JV): type 100 Debit on line 1, choose the ledger on the next line and press Enter - 100 Credit is filled in (and the other way round). You can change it.
- The lines are filled automatically and can still be edited; **Refill** puts them back.
- The type's options are in folding sections (**Vendor/Customer Details, Bill Details, Bills without TDS, TDS**): click the arrow to hide one after filling it - its summary stays on the right. TDS on Purchase and TDS on Sales are separate choices in the JV Type drop-down.
- **Narration** is one field in the footer (saved remarks are offered as you type).

> **Accounts:** exactly the voucher lines. Tax types appear in the VAT register and VAT return; any TDS appears in the TDS report. Party lines create bill-wise references. **Stock:** none.

**Cash / Bank Entry**

- A receipt or payment voucher. The master has the Cash/Bank ledger; each line is a ledger (party, expense, income) with a Receipt or Payment amount, plus line remarks.

> **Accounts:** Receipt: Dr Cash/Bank, Cr each line ledger. Payment: Dr each line ledger, Cr Cash/Bank. Bill-wise parties settle their oldest bills first (FIFO); you can adjust the suggestion.

**Debit Note**

- Increases what a party owes you, or reduces what you owe a supplier (rate difference, claim).

> **Accounts:** Dr party, Cr the chosen ledger(s).

**Credit Note**

- Reduces what a customer owes you, or increases what you owe (discount after the bill, claim).

> **Accounts:** Dr the chosen ledger(s), Cr party.

**PDC (post-dated cheque)**

- Record cheques received or issued with a future date. Deposit and then Realize (or Bounce).

> **Accounts:** nothing until **Realized**. A received cheque then posts like a receipt, an issued cheque like a payment.

**Bulk Cash Settlement**

- Receive cash from many customers in one screen (e.g. after a route).

> **Accounts:** one receipt per party (Dr Cash, Cr customer).

**Bank Reconciliation**

- Match bank statement lines (typed or imported) with book entries. Auto-match learns from your matches.
- Shows the Bank Reconciliation Statement and matched/unmatched lists.

> **Accounts:** none (it only records clearing dates).

**Interest on Overdue**

- Works out interest on unpaid customer bills after their due date (+ grace days) at the ledger's interest %.

> **Accounts:** posting the run debits each customer and credits Interest Income. A bill is never charged twice for the same days; cancelling the run reverses it.

**Depreciation Posting**

- Choose the period; review the preview; post.

> **Accounts:** Dr Depreciation expense, Cr Accumulated depreciation (or the asset ledger). Selling an asset on a Sales Bill disposes it automatically: its book value leaves the asset and the gain/loss shows in the disposal ledger.

**Budgets**

- Budget amounts by ledger, sub-ledger, cost center, unit or document class, per month. Compared in Budget vs Actual.

**Account Confirmation Letters**

- Balance confirmation letters for parties, printed or sent by message.

### 3.2 Sales Transaction

The normal flow is Quotation → Order → Delivery (Challan) → Bill → Return. Each later document can pull from the earlier ones (**Pending** button in the master part), as allowed by Entry Field Control. The **Quotation No. / Order No. / Challan No.** boxes are right after the Customer / Vendor. After choosing the party, Enter moves into these boxes: the first Enter on a box opens that party's pending list (tick, then Pull), the next Enter moves on to the next box and then the rest of the form. Type a number in a box to find a document of any party. The same boxes are on every sales and purchase entry (Quotation, Order, Challan / GRN, Bill, Return, Non-saleable Return). Pulling also brings the source's master part - sub-ledger, product company, agent, area, route, cost center, remarks, narration, rate type, currency - and its billing terms (document and product-wise) into the new entry:

| Document | Can pull from |
|---|---|
| Order | Quotation |
| Delivery / Challan | Quotation, Order |
| Bill | Quotation, Order, Delivery |
| Return | Bill |

Only quantities still pending are offered. The source document shows as partially or fully used.

**Sales Quotation**

- A price offer to a customer.

> **Accounts / Stock:** none.

**Sales Order**

- The customer's confirmed order. The credit limit is checked.

> **Accounts / Stock:** none. Pending orders show in reports and on the mobile app.

**Order → Bill (single / multiple)**

- Turn one or many orders into bills in one step, with rate and qty editable.

> **Effect:** as Sales Bill.

**Sales Delivery / Challan**

- Goods leave the warehouse before (or without) the bill.

> **Stock:** OUT. **Accounts:** none (the bill books the sale).

**Sales Bill / Invoice**

- The tax invoice. Cash or credit. Includes product-wise and bill-wise terms, currency, and bill-wise settlement of advances.

> **Accounts:** Dr Customer with the bill total; Cr Sales account per product line; Cr VAT Payable; each term to its ledger. **Stock:** OUT only for lines **not** already delivered by a challan. **IRD:** the bill goes to the IRD sales register and is sent to CBMS when enabled.

**Receipt / TDS button** (footer of the Sales Bill):

- **Received with this bill**: one line per cash or bank ledger, e.g. a 500 bill with 100 in cash and 400 in NIC Asia Bank. Use **+ Cash** / **+ Bank**, choose the ledger, type the amount (and cheque no.).
- **Cash bill**: cash + bank + TDS must equal the bill total. If you enter nothing, the whole bill is taken as received in the default Cash ledger (System Control).
- **Credit bill**: enter what was paid now, e.g. 300 of a 500 bill; the remaining 200 stays outstanding on the customer.
- **TDS** deducted by the customer: TDS % (or amount) on the VAT-exclusive value, TDS Receivable ledger (default from System Control).

> **Accounts:** Dr each cash / bank with its amount, Dr TDS Receivable, Cr Customer. The bill shows only the balance as outstanding. Cancelling the bill reverses all of it.

**Sales Return**

- Goods returned by a customer, against the bill.

> **Accounts:** Dr Sales Return (or sales) account, Dr VAT, Cr Customer. It settles the customer's open bills first. **Stock:** IN.

**Sales Non-saleable Return**

- Damaged or expired goods returned.

> **Stock:** IN to the separate non-saleable stock, not to saleable stock. **Accounts:** with credit, like a Sales Return; with no credit, none.

**Sales Additional Entry**

- Extra charges billed to a customer later (freight, packing, interest), or deductions.

> **Accounts:** Dr Customer, Cr income ledger for each add line (Dr for each deduct line). **Stock:** none.

**Salesman Targets & Commission**

- Set targets per salesman or period, see achievement (the target report), and post commission once per target.
- **Bill-wise Commission**: the salesman's posted bills (value without VAT, less returns against the bill) with the salesman's commission %. Change the % or amount per bill, tick one or all, and post. A bill that got commission is never offered again; cancelling the posting in the Commission Register frees its bills.

> **Accounts:** Dr commission expense / Cr commission payable (salesman's ledgers, or chosen on posting).

**Small Balance Write-off (Journal Voucher)**

- Journal Voucher > JV Type "Small Balance Write-off (bulk)" (or Accounts > Small Balance Write-off).
- Choose customers / suppliers / both, Dr / Cr balances, the "up to" amount (e.g. 50) and the date; list; tick all or some; choose the discount ledgers; post.
- One JV nils all ticked parties; their open bills are settled. Cancelling the JV undoes it.

> **Accounts:** Dr balances - Dr Discount Allowed / Cr party; Cr balances - Dr party / Cr Discount Received.

**Mobile Approvals**

- Cash receipts and sales returns entered on the salesman's phone wait here as pending (no effect).
- Tick one, several or all and **Post ticked**. The salesman is already the agent on each entry.

> **Accounts:** receipt - Dr mobile cash ledger, Cr customer; return - as Sales Return. **Stock:** returns come in on posting.

### 3.3 Purchase Transaction

The flow is Quotation → Order → GRN → Bill → Return, with the same pull rules: Order ← Quotation; GRN ← Quotation + Order; Bill ← Quotation + Order + GRN.

**Purchase Quotation**

- A supplier's price offer.

> **Accounts / Stock:** none.

**Purchase Order**

- The order sent to a supplier.

> **Accounts / Stock:** none.

**Purchase GRN (Goods Receipt Note)**

- Goods received before the bill arrives.

> **Stock:** IN. **Accounts:** if a GRN Clearing ledger is set in System Control: Dr Goods (purchase) account, Cr GRN Clearing (a temporary liability until the bill comes). Otherwise none.

**Purchase Bill**

- The supplier's invoice.

> **Accounts:**
> - Bill without GRN: Dr Purchase account per product line (without VAT), Dr VAT (input), Cr Supplier; terms to their ledgers.
> - Bill from a GRN: Dr GRN Clearing, Cr Supplier, and the VAT moves from the goods account to the VAT ledger.
>
> Any advance paid to the supplier is settled first (FIFO).
>
> **TDS** (TDS button in the footer): TDS % or amount on the VAT-exclusive value. Dr Supplier, Cr TDS Payable - the supplier is owed the bill less TDS. Shown in the TDS Report.
>
> **Stock:** IN only for lines **not** already received by a GRN.

**Purchase Bill from Image / PDF**

- Upload a photo or PDF of a supplier bill. The system reads it and fills a Purchase Bill for you to check and save.

> **Effect:** as Purchase Bill.

**Additional Expenses (Purchase Additional Bill)**

- Freight, customs, insurance or labour linked to an Order, GRN or Bill. The vendor of the linked document comes in as the vendor; change it when someone else is paid.
- Choose the reference bill(s) and see their product lines and totals.
- **Product-wise Terms** tab (first): the products of the linked document; **Terms…** opens that product's terms (Billing Terms with Purchase Additional + Product Wise). Rate % is of that product's value. The whole amount goes to that product's cost.
- **Bill-wise Terms** tab: a fixed form with one row per bill-level Purchase Additional term. Fill the amounts that apply. Each row is divided over the bill's products by the term's basis (value or qty; changeable per row). Empty rows are left out.
- A term's **ledger is fixed** by the term; only its **sub-ledger** can be changed. **Paid to** (the other ledger) and its sub-ledger are chosen freely - empty means the entry's vendor.
- Each row also has its bill type (taxable, non-taxable, no bill), bill no, VAT, add or deduct. A term not "Include In Costing" stays out of the cost.
- **Add TDS Line** adds a TDS line: TDS Payable ledger (System Control), default TDS % of the other lines, never added to cost. It appears in the TDS Report.
- Account Posting shows the resulting entry before saving.

> **Accounts:** Dr term / expense ledger with its sub-ledger (+ VAT when VAT is part of cost), Dr VAT (claimable), Cr supplier/party with its sub-ledger; a deduct line credits the ledger and reduces the party. **Stock value:** the allocated amount is added to the cost of the linked purchase lines (landed cost).

**Purchase Return**

- Goods returned to a supplier.

> **Accounts:** Dr Supplier; Cr Purchase Return (or purchase) account per line; Cr VAT. It settles the supplier's open bills. **Stock:** OUT.

**Non-saleable Return (Purchase)**

- Damaged stock sent back or written off.

> **Stock:** OUT of non-saleable stock. **Accounts:** a write-off debits Write-off Expense and credits Non-saleable Stock Asset; a credit note works like a Purchase Return.

**LC Register & Mapping**

- Letters of credit: opening, amendments, expiry, linking to purchase documents, and LC cost.

### 3.4 Production

**Production Order**

- Pick the finished product (and BOM). Raw materials are filled from the BOM and can be changed; enter output qty and by-products. Billing terms (%, rate or amount) can add extra costs.

> **Stock:** raw materials OUT, finished goods and by-products IN, valued at the raw-material cost plus costs (split over joint products). **Accounts:** none directly; the value shows through stock.

**BOM Template**

- See 2.2.

### 3.5 Inventory

**Stock Transfer**

- Move stock between warehouses or branches. A two-step branch transfer is dispatched first and received later.

> **Stock:** OUT from the sending warehouse, IN to the receiving one; company total unchanged. **Accounts:** only if Stock Transfer GL Posting is on: Dr receiving stock account, Cr sending stock account. In two-step mode the entries go through Goods in Transit.

**Stock Adjustment** (shortage, damage, excess; also used by poultry consumption)

> **Stock:** IN or OUT. **Accounts:** a shortage or damage debits Stock Loss/Damage expense and credits Stock Adjustment; an excess debits Stock Adjustment and credits Stock Gain.

**Barcode / Label Printing**

- Print barcode labels for products, with ready formats or your own design.

### 3.6 Automobile, Construction, Poultry, Office

- **Automobile:**
  - Customer Enquiry; PDI / Vehicle Delivery (vehicle stock to customer); Job Card (workshop service, parts issued, labour, outside work); Service Reminders.
  - Vehicle and parts sales post like Sales Bills; parts issued move stock OUT.
- **Construction:**
  - Sites / Contracts (thekka); Running Bills to the client; sub-contracts (petti thekka); material issue to site (stock OUT); wages per site.
  - Site profit = billed - material - wages - sub-contract.
- **Poultry & Hatchery:**
  - Broiler batch placement (chicks in); daily log of feed, medicine, vaccine and mortality (stock OUT to the batch); lifting (sale of birds, posts like a sales bill).
  - Hatchery: egg set, candling, hatch (chicks IN).
- **Office:**
  - Tasks (assign, follow up, due dates).
  - Darta / Chalani register (incoming/outgoing letters with number and date).
  - No accounting or stock effect.

## 4. Accounts Report menu

### 4.1 Accounts & Finance

| Report | What it shows |
|---|---|
| Ledger Report (detail / summary / monthly) | Every entry of a ledger with running balance; summary per ledger; month-wise totals. PDC can be shown separately. |
| Party Summary | Per party: opening, sales, returns, receipts, payments, notes, closing. |
| Day Book | All entries of a day or period. |
| Cash & Bank Book | Cash and bank ledgers with daily balances. |
| Trial Balance | Every ledger's Dr/Cr balance. |
| Profit & Loss | Income and expenses; stock valued by the chosen method. |
| Balance Sheet | Assets, liabilities, equity, with closing stock. |
| Schedules / Notes | Group-wise break-up with opening, Dr, Cr, closing. |
| Ratio Analysis, Cash Flow, Funds Flow | Standard financial analysis from the same figures. |
| Group Mapping | Where each account group lands in the P&L / Balance Sheet. |
| Net Position of Funds | Cash, bank, receivables and payables position. |
| Bank Reconciliation Statement, Matched/Unmatched | From Bank Reconciliation. |
| Outstanding, Ageing, Bill-wise Ageing | Unpaid bills by party and by age bucket. |
| Interest on Overdue (register) | Posted interest runs. |
| Balance Confirmation Letters | Letters to parties. |

### 4.2 Budget & Dimensions

- Budget vs Actual and variance (by ledger, sub-ledger, cost center, unit, document class).
- Sub-ledger summary and statement.
- P&L by cost center, unit, branch or document class.
- Cost center x ledger and monthly trend.
- Document class register (number gaps).
- Missing dimensions.

### 4.3 VAT, TDS & IRD

- Sales/purchase VAT register, VAT monthly summary, Annex 13 (above threshold), VAT return, VAT ledger, TDS report.
- IRD materialized view, IRD sales book, CBMS sync status (resend failed bills), IRD bill audit log.
- **Reconciliation (VAT / Sales / Purchase / TDS)** - checks that the registers and the books agree for the chosen dates, document by document, including taxable Journal Vouchers (JV purchase / sales / TDS):
  - **Overview**: the four checks side by side, each marked *Tallied* or *Not tallied*.
  - **VAT**: VAT register vs all VAT ledgers. **Sales Account**: sales register vs sales accounts. **Purchase Account**: purchase register (with expense bills and JV purchases) vs purchase / goods accounts; a bill made from a GRN is checked together with that GRN. **TDS**: TDS on bills, JVs and expense bills vs TDS ledgers.
  - Each document shows Register, Books and Difference with a status: *Matched*, *Difference*, *Only in register* (not posted to these accounts) or *Only in books* (for example a normal JV posted to the VAT ledger, or a GRN not billed yet). Click a summary box to see only those.
  - The accounts compared are found automatically (System Control, products, documents, VAT terms); add or remove an account with the chips, *Automatic* goes back.
  - Signs: VAT, sales and TDS are Cr - Dr (input VAT and TDS receivable show as minus); purchase is Dr - Cr.

### 4.4 Control & Registers

- Universal Register (every document of every module).
- Cancelled documents, draft (unposted) documents, master data exceptions.
- LC / BG / PDC dashboard, PDC report.
- Document print status.
- Audit Log (every change with old and new value) and audit coverage.

## 5. Sales/Purchase menu (reports)

- **Sales, Salesman & Routes:**
  - Sales/purchase analysis (by party, product, group, area, and so on), monthly analysis, profitability, rate history, rate & discount history.
  - Salesman-wise, route-wise and area-wise sales; route plan vs visit; not visited; visit log.
  - Order register, pending orders, order fill rate, product-wise orders.
  - Target vs achievement, salesman performance, commission register.
  - Customer lists, credit exceeded, inactive customers, loading sheet.
- **Purchase:** purchase register, GRN outstanding (received but not billed), supplier list, LC register, consignment cost.
- **Inventory & Production:**
  - Stock report, stock movement (opening + in - out = closing, qty and value), stock in/out, stock valuation, stock ageing & expiry, re-order & over-stock, non-moving items, price list.
  - Production register, raw material consumption, BOM vs actual, production cost trend.
  - Fixed asset schedule and depreciation detail.
- **Poultry, Construction, Automobile:** the industry reports listed in the menu (batch profitability, mortality, site profit, job card register, and so on).

## 6. Analysis menu

- **Dashboards:** the main dashboard (widgets and graphs you can arrange), work dashboard, LC/BG/PDC dashboard, PDC dashboard, poultry dashboard.
- **Sales & Profit Analysis:** as in section 5.
- **Forecasting & Inventory Analytics:**
  - FSN (fast/slow/non-moving), ABC, XYZ and the ABC-XYZ matrix.
  - Stock cover and stock-out forecast, inventory turnover, dead stock.
  - Sales/purchase forecast, purchase plan, weekly cash-flow forecast.
  - Period comparison, customer RFM (new and lost customers), income & expense comparison, DSO/DPO.

All reports are read-only: they never change accounts or stock.

## 7. Setup menu

### 7.1 Company & Control

**System Control**

The main switchboard:

- **Business Nature and features**: trading, poultry, construction, automobile.
- **Default ledgers**: sales, purchase, returns, VAT, GRN clearing, rounding, stock transfer/adjustment, non-saleable.
- **Stock**: valuation method (FIFO, moving average, weighted average, last purchase), batch/serial costing, negative stock control, multiple warehouses.
- **Dual unit**: fixed or flexible.
- **Grid columns**: free qty, batch, alternate unit, mfg/expiry.
- **Party defaults**: bill-wise tracking and credit control.
- **Approval Needed For**: modules that must be approved before posting.
- **Transactions that show product-wise terms**.
- **Computerized Billing (IRD)** and CBMS settings.

> **Effect:** changes how every later entry posts. Change ledgers or methods with care after posting has started.

**Fiscal Years**

- Create and close fiscal years (BS). Numbering and reports follow the fiscal year.

**Branches & Warehouses**

- Branches and their warehouses, each with an optional stock ledger (used by stock transfer posting).

**Business Units**

- Units/divisions to tag entries with; P&L by Unit.

**Ledger Mapping**

- Map special purposes (cash, bank, VAT, round-off, and so on) to ledgers.

**Document Numbering**

For each document type (and branch/user if needed), create numbering categories:

- **Mode**:
  - **Automatic**: running number.
  - **Manual numeric** or **manual alpha-numeric**: typed.
  - **Automatic date-wise**: the number restarts every day, with a date part.
  - **Automatic month-wise**: restarts every month.
- Prefix, suffix, starting number, fill character, length, maximum length (or flexible length).
- Date format and Nepali/English date.
- Valid from/to dates.

The entry shows the next number before you save.

**Currencies**

- Currency code, name, symbol and exchange rate (NPR is the base). Choose a currency on an entry to see the Local Amount in NPR.
- Note: posting to accounts currently uses the entered amount, so keep posted entries in NPR until local-currency posting is added.

**Entry Field Control**

For each transaction (and user, if needed):

- Which fields show, which are compulsory, their default values, and which cannot be changed.
- Which source documents may be pulled (Quotation, Order, Challan/GRN).

**User Defined Fields**

- Add your own fields to masters and documents; they can be printed.

### 7.2 Users & Security

- **Users**: create users, link them to a security group and branch, reset passwords.
- **Security Groups**: rights per menu (view, create, edit, delete, print), plus the **Approvals** section (which documents this group may approve).
- **Data Access**: limit what a user or group can see: ledgers, sub-ledgers, products, companies, groups, categories and areas. Hidden items are removed from lists and reports.
- **Audit Log**: every change with who, when, old value and new value.
- **Change My Password**.

### 7.3 Printing & Messaging

- **Document Designer**: design bill/voucher print layouts (fields, logo, columns, user-defined fields).
- **Messaging Templates & Auto-send**: email, SMS, WhatsApp and Viber templates; send automatically when a document is posted (e.g. bill to customer); outstanding reminders in bulk.
- **My Notification Settings**: which alerts you receive, and how.

## 8. Tools and Office menus

- **Report Center**: every report in one place with search.
- **Manual Document Printing**: print or reprint documents in bulk.
- **Messaging**: send documents or statements; see the message log.
- **IRD Compliance / CBMS**: the IRD register, sync status and resend.
- **Salesman Mobile App**: the salesman sees only the route(s) planned for them on the day (a date-range plan shows on each date of the range). Opening a route lists its customers in visiting sequence, with search. Per customer: **Order** (becomes a Sales Order), **Receipt** (cash / cheque / online) and **No order**. The **Return** tab takes a sales return from a customer of any area / route. Receipts and returns are tagged with the salesman and wait for the office in **Small Balance Write-off (Journal Voucher)**

- Journal Voucher > JV Type "Small Balance Write-off (bulk)" (or Accounts > Small Balance Write-off).
- Choose customers / suppliers / both, Dr / Cr balances, the "up to" amount (e.g. 50) and the date; list; tick all or some; choose the discount ledgers; post.
- One JV nils all ticked parties; their open bills are settled. Cancelling the JV undoes it.

> **Accounts:** Dr balances - Dr Discount Allowed / Cr party; Cr balances - Dr party / Cr Discount Received.

**Mobile Approvals**. Settings per salesman (Route Plan > Mobile): allow receipts / returns, the mobile cash ledger, off-route customers.
- **Day Book (all-in-one)**: one day or a period, with filters for user, salesman / agent, voucher type (sales, returns, purchase, receipts, payments, PDC, journal, notes ...), party and drafts. It shows sales / purchase split into cash and credit, returns, receipts and payments split into cash and bank, PDC, the cash & bank book (opening and closing for the whole business), a party-wise credit summary with closing balances, totals per agent and per user, and every voucher. Without user / agent it is the overall day book.
- **Ledger + Sub-ledger Balance**: every sub-ledger's opening / debit / credit / closing with the ledger balance after them, and a Module filter (sales, purchase, cash / bank, journal, inventory, other).
- **Stock Valuation**: batch / serial items follow System Control's batch / serial costing; batch-wise costing values each batch at its own cost, including the landed cost of Purchase Additional. Profitability costs a sale of a batch / serial the same way.
- **Loading Sheet**: items to load with qty by UOM mode (fixed dual "5 Crt 2 Pcs · Total 62 Pcs", flexible "5 Crt = 10 Pcs"), and a Total row with the qty as entered per unit and the total in base unit. Print it together with the **Bill Summary** (and Bill x Item) on one sheet.
- **Office**: work dashboard, tasks, Darta/Chalani, notification settings, and their reports.

## 9. How the numbers fit together

- **Stock value in the Balance Sheet** comes from the stock movements valued by your chosen method, not from a ledger. That is why a sales bill does not post a "cost of goods sold" entry: profit is worked out as Sales - (Opening Stock + Purchases - Closing Stock) - Expenses.
- **Challan then Bill** (or **GRN then Bill**): stock moves once, on the challan/GRN. The bill books the accounts only.
- **Cancel** always undoes everything the document did: ledgers, stock, bill-wise settlements, and the "used" quantity on the source documents.
- **Drafts and entries awaiting approval** never appear in accounts or stock reports; see Control Reports > Draft Documents.
- **Bill-wise parties**: every bill, return, receipt and note is matched oldest-first (FIFO). The Outstanding and Ageing reports show what is still open.
