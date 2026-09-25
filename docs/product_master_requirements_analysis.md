# Product / Item Master — Requirements Analysis

Synthesized from four systems:
- **Tally** — Stock Item master (Units/Alternate Units with conversion factor, Batch & Expiry, Statutory Info, GST applicability)
- **Microsoft Dynamics NAV / Business Central** — Item Card tabs (General, Inventory, **Cost & Posting**, Price & Sales, Replenishment, Planning, Item Tracking, Warehouse); **Posting Groups** drive account mapping; **Reordering Policy** drives Min/Max stock
- **Busy** — Indian trading-software conventions (multi-rate price levels, item-wise discount, batch)
- **FACT** — Nepal-specific conventions already seen in this project's reference screenshots (VAT applicability, Nepali-context fields)
- **Our own System Control** module — toggles already built (Dual UOM, Free Qty, Batch System, Vehicle Options, Barcode, Exp/Mfg Date, Serial Number, FIFO, Reorder Level) that this master must actually *use*, not duplicate

Fields are grouped into sections that map directly to tabs on the eventual Product Master form (same pattern as the Ledger Account form's Basic/Party/Financial tabs).

---

## 1. Basic Identity

| Field | Notes |
|---|---|
| Item Code | Auto-generated (same atomic-sequence pattern as Ledger Account codes) |
| Item Name | Required |
| Short Name / Alias | Editable, same pattern as Ledger's Short Name |
| Barcode | Only shown if System Control → `enable_barcode_system` is Yes |
| **Role** | **Raw Material / Semi-Finished (WIP) / Finished Good / Trading Good / Service / Fixed Asset / Consumable** — NAV calls this "Replenishment System" (Purchase/Production/Assembly) combined with a stock-vs-non-stock flag; Tally has no direct equivalent (relies on Stock Group naming convention only) |
| Is Stock Item | Yes/No — NAV distinguishes stock items from services; a Service or non-stock item skips inventory valuation entirely |
| Is Active | Active/Inactive/Discontinued |
| HS Code | Customs classification — relevant for import-heavy Nepali businesses |

## 2. Classification

| Field | Notes |
|---|---|
| Category (Product Group) | Already exists as its own master — this just links to it |
| Company / Brand (Product Company) | Already exists as its own master |
| Sub-Category | Optional second-level grouping if Category alone isn't granular enough |

## 3. Account Mapping — *the NAV "Posting Groups" concept*

NAV treats this as **mandatory**: "the mandatory basic fields are the item number, the base unit of measure, the costing method, and the posting groups." Tally achieves the same by mapping Stock *Groups* to ledgers rather than individual items, which is why our System Control module already has group-level Sales/Purchase/Stock ledger mapping — but NAV additionally allows **item-level override** for exceptions. Recommended:

| Field | Falls back to (if blank) |
|---|---|
| Sales Account | System Control → Sales Account Mapping |
| Purchase Account | System Control → Purchase Account Mapping (or Sales, if "Same as Sales Part") |
| Inventory/Stock Account | A new "default inventory ledger" (not yet in System Control — flagged below) |
| Sales Return Account | System Control → Sales Return Account Mapping |
| Purchase Return Account | System Control → Purchase Return Account Mapping |

This item-level override pattern means most items need **zero** account-mapping input (inherits from Category/System Control), only exceptions need it set explicitly — matching NAV's actual behavior where posting groups are usually set at a *group* level and items just reference a group code.

## 4. UOM / Unit Configuration

| Field | Notes |
|---|---|
| Primary (Base) UOM | Required — Tally: "Units (basic units of measurement)" |
| Alt UOM | Only shown if System Control → `dual_uom_enabled` is Yes |
| Alt UOM Conversion Factor | e.g. "1 Box = 12 Pcs" — Tally: "conversion rate for the alternate unit and basic unit" |
| Purchase UOM | Can differ from Sales UOM (Tally explicitly supports buying in one unit, selling in another) |
| Sales UOM | — |
| Decimal Places for Qty | Ties to System Control's Number Format In Qty/Alt Qty |

## 5. Rate / Pricing Information

| Field | Notes |
|---|---|
| Standard Cost / Last Purchase Rate | NAV: "Costing Method" (FIFO/Average/Standard) determines how this is derived — ties to System Control's FIFO Adjustment toggle |
| MRP | Maximum Retail Price, common in Nepali/Indian retail |
| **Sales Rate Sr1 – Sr5** | **Multiple price tiers** (e.g. Retail/Wholesale/Distributor/Export/Special) — a Busy/FACT convention; ties directly to System Control's "Auto Billing Rate Type: Sr1/Sr2/MRP" |
| Default Discount % | Item-level default, overridable per Billing Term at transaction time |
| Rate Inclusive/Exclusive of Tax | Whether Sales Rate already includes VAT |

## 6. Vendor & Sourcing

| Field | Notes |
|---|---|
| Default Vendor | NAV: "Vendor No." on the Replenishment tab |
| Vendor Item Code | Cross-reference to the vendor's own SKU/code for this item |
| Lead Time (days) | NAV: "Lead Time Calculation" — informs when to place a reorder |

## 7. Stock Control — *the NAV "Planning" tab*

| Field | Notes |
|---|---|
| **Minimum Stock Level** (Reorder Point) | NAV: "the inventory level at which a new order should be placed" |
| **Maximum Stock Level** | NAV: "Maximum Quantity" reordering policy |
| Reorder Quantity | How much to order when triggered |
| **Stock Minimum Check** | Enable/Disable — whether the system actually warns/blocks when stock falls below Minimum (this is the toggle behavior; Min/Max above are just the numbers) — ties to System Control's `reorder_level_tracking` |
| Opening Stock Qty / Rate / Value | Standard opening-balance triplet |
| Default Godown/Warehouse | Already have a Warehouse master — this just sets the item's default |
| Allow Negative Stock | Yes/No override, independent of the System Control global default |

## 8. Tracking Options — *each one a toggle already defined in System Control, applied per-item*

| Field | Only relevant if... |
|---|---|
| Track by Batch/Lot | System Control → `batch_system` ≠ None |
| Track Expiry Date | System Control → `enable_exp_date` |
| Track Manufacturing Date | System Control → `enable_mfg_date` |
| Track Serial Number | System Control → `enable_serial_number` — NAV calls this the "Item Tracking" tab |
| Track Vehicle Number | System Control → `enable_vehicle_options` (relevant for fuel/vehicle-parts dealers) |
| Track Free Qty | System Control → `free_qty_system` — whether this item participates in free-goods schemes at all |

Design point: these are **per-item override checkboxes**, defaulting to whatever System Control set globally — mirroring exactly how the Billing Term's "Applicable To" and Ledger's category-conditional fields already work in this system.

## 9. Tax & Statutory

| Field | Notes |
|---|---|
| VAT Applicable | Applicable / Exempt / Zero-Rated — Tally: "GST Applicable" |
| VAT Rate Override | If different from the tenant's standard VAT % |
| Excise Applicable | Yes/No |

## 10. Physical Attributes *(optional, lower priority)*

| Field | Notes |
|---|---|
| Weight | Relevant for freight/transport costing |
| Dimensions (L×W×H) | Relevant for packaging/shipping |
| Color / Size / Variant | Only relevant for apparel/variant-heavy businesses — likely a v2 concern, not essential now |

## 11. Manufacturing *(only if Role = Finished Good or Semi-Finished)*

| Field | Notes |
|---|---|
| BOM / Recipe Reference | Ties into the Production Entry voucher type already catalogued in Entry Field Control |
| Standard Production Time | Optional |

---

## Gaps this analysis surfaces in what's *already* built

1. **System Control has no "Default Inventory/Stock Ledger" mapping** (it has Opening Stock, Closing Stock, WIP — but not a general-purpose default Inventory Asset account for ongoing stock valuation postings). Worth adding alongside the existing Ledger Mapping tab.
2. **No "Costing Method" (FIFO / Weighted Average / Standard) setting exists yet** — System Control has `fifo_adjustment_unit_wise` as a boolean, but not an explicit costing-method choice. NAV treats this as one of the four truly mandatory item fields.
3. **No Unit of Measure *master* exists yet** — Alt UOM conversion needs a proper UOM table (Pcs, Box, Kg, etc. with conversion factors between them), not just free-text unit names.

---

## Recommended next step

Build the actual **Product Master** page + `inventory_items` schema using this structure, tabbed the same way Ledger Accounts and Users are (likely: **Basic / Classification & Account Mapping / UOM & Pricing / Stock Control & Tracking**), with a **UOM Master** built first since Alt UOM conversion depends on it.
