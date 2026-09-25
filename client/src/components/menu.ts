// =============================================
// menu.js
// The navigation, grouped. SECTIONS drive the sidebar (Layout.jsx);
// REPORT_GROUPS drive the Report Center (/reports) and the sidebar's
// Reports section - every report screen, with deep links (?tab= / ?view= /
// ?preset=) straight to one view of a multi-view report page.
// =============================================

export interface MenuItem { to: string; label: string; group?: string }
export interface MenuSection { key: string; title: string; items: MenuItem[] }
export type ReportGroup = { title: string; items: [string, string][] };

export const SECTIONS: MenuSection[] = [
    { key: 'home', title: 'Home', items: [
        { to: '/dashboard', label: '🏠 Dashboard' },
        { to: '/reports', label: '📚 Report Center (all reports)' },
        { to: '/mobile', label: '📱 Salesman Mobile App' }
    ] },
    { key: 'masters', title: 'Masters', items: [
        { to: '/chart-of-accounts', label: '📒 Chart of Accounts' },
        { to: '/sub-ledgers', label: '📑 Sub Ledgers' },
        { to: '/ledger-opening', label: '📖 Ledger Opening Balance' },
        { to: '/products', label: '🛒 Products' },
        { to: '/product-units', label: '📏 Product Units' },
        { to: '/product-groups', label: '📦 Product Groups' },
        { to: '/categories', label: '🏷️ Category Management' },
        { to: '/product-opening', label: '📦 Product Opening Stock' },
        { to: '/product-rate-change', label: '💲 Product Rate Change' },
        { to: '/product-offer-rate', label: '🏷️ Offer Rate' },
        { to: '/pricing-masters', label: '💲 Rate Category & Discount Group' },
        { to: '/salesman-agents', label: '🧑‍💼 Salesman / Agent' },
        { to: '/route-sequencing', label: '🚚 Route Sequencing' },
        { to: '/route-plan', label: '🗓 Route Plan & Mobile Login' },
        { to: '/transport-master', label: '🚚 Transport Master' },
        { to: '/cost-profit-centers', label: '🎯 Cost & Profit Centers' },
        { to: '/billing-terms', label: '🧾 Billing Terms' },
        { to: '/remarks-terms', label: '📝 Remarks & Terms' },
        { to: '/fixed-assets', label: '🏗 Fixed Assets & Depreciation' }
    ] },
    { key: 'sales', title: 'Sales', items: [
        { to: '/sales-quotation', label: '📝 Sales Quotation' },
        { to: '/sales-order', label: '🧾 Sales Order' },
        { to: '/order-billing', label: '⚡ Order → Bill (single / multiple)' },
        { to: '/sales-delivery', label: '🚚 Sales Delivery/Challan' },
        { to: '/sales-bill', label: '💵 Sales Bill/Invoice' },
        { to: '/sales-return', label: '↩️ Sales Return' },
        { to: '/sales-nonsaleable-return', label: '🗑️ Sales Non-saleable Return' },
        { to: '/sales-additional-entry', label: '➕ Sales Additional Entry' },
        { to: '/agent-targets?tab=targets', label: '🎯 Salesman Targets & Commission' }
    ] },
    { key: 'purchase', title: 'Purchase', items: [
        { to: '/purchase-order', label: '🛒 Purchase Order' },
        { to: '/purchase-quotation', label: '📨 Purchase Quotation' },
        { to: '/purchase-grn', label: '📦 Purchase GRN' },
        { to: '/purchase-bill', label: '🧾 Purchase Bill' },
        { to: '/purchase-bill-import', label: '📷 Purchase Bill from Image / PDF' },
        { to: '/purchase-additional-expense', label: '🧮 Additional Expenses' },
        { to: '/purchase-return', label: '↩️ Purchase Return' },
        { to: '/purchase-nonsaleable-return', label: '🚫 Non-saleable Return' },
        { to: '/lc-register', label: '🏦 LC Register & Mapping' }
    ] },
    { key: 'accounts', title: 'Accounts', items: [
        { to: '/journal-voucher', label: '📗 Journal Voucher' },
        { to: '/cash-bank-entry', label: '💵 Cash/Bank Entry' },
        { to: '/debit-note', label: '📤 Debit Note' },
        { to: '/credit-note', label: '📥 Credit Note' },
        { to: '/pdc-voucher', label: '🏦 PDC' },
        { to: '/bulk-cash-settlement', label: '💰 Bulk Cash Settlement' },
        { to: '/bank-reconciliation', label: '🏦 Bank Reconciliation' },
        { to: '/interest-posting', label: '% Interest on Overdue' },
        { to: '/budgets', label: '💼 Budgets & Variance' },
        { to: '/confirmation-letters', label: '✉ Account Confirmation Letters' },
        { to: '/lc-bg-dashboard', label: '📑 LC / BG / PDC Dashboard' },
        { to: '/ird', label: '🏛 IRD Compliance / CBMS' },
        { to: '/messaging', label: '📨 Messaging (Email / SMS / WhatsApp / Viber)' }
    ] },
    { key: 'inventory', title: 'Inventory & Production', items: [
        { to: '/stock-transfer', label: '🔄 Stock Transfer' },
        { to: '/bom-template', label: '📋 BOM Template' },
        { to: '/production-order', label: '🏭 Production Order' },
        { to: '/barcode-print', label: '🏷 Barcode / Label Printing' }
    ] },
    { key: 'print', title: 'Printing', items: [
        { to: '/document-printing', label: '🖨 Manual Document Printing' },
        { to: '/document-designer', label: '🎨 Document Designer' }
    ] },
    { key: 'setup', title: 'Setup', items: [
        { to: '/fiscal-years', label: '📅 Fiscal Years' },
        { to: '/ledger-mapping', label: '🔗 Ledger Mapping' },
        { to: '/system-control', label: '⚙️ System Control' },
        { to: '/entry-field-control', label: '🔒 Entry Field Control' },
        { to: '/audit-log', label: '🕘 Audit Log (who changed what)' },
        { to: '/user-defined-fields', label: '🧩 User Defined Fields' },
        { to: '/document-numbering', label: '🔢 Document Numbering' },
        { to: '/branches-warehouses', label: '🏢 Branches & Warehouses' },
        { to: '/business-units', label: '🏷️ Business Units' },
        { to: '/security-groups', label: '🔐 Security Groups' },
        { to: '/users', label: '👤 Users' }
    ] }
];

export const REPORT_GROUPS: ReportGroup[] = [
    { title: 'Accounts & Finance', items: [
        ['/ledger-report', 'Ledger Report (detail)'], ['/ledger-report?mode=summary', 'Ledger Summary (PDC separate option)'], ['/ledger-report?mode=monthly', 'Ledger Monthly Summary'],
        ['/party-summary', 'Party Summary (PDC separate option)'], ['/control-reports?view=day_book', 'Day Book'], ['/control-reports?view=cash_bank_book', 'Cash & Bank Book'],
        ['/financial-reports?tab=tb', 'Trial Balance'], ['/financial-reports?tab=pl', 'Profit & Loss'], ['/financial-reports?tab=bs', 'Balance Sheet'],
        ['/financial-reports?tab=notes', 'Schedules / Notes'], ['/financial-reports?tab=ratios', 'Ratio Analysis'], ['/financial-reports?tab=cash', 'Cash Flow'], ['/financial-reports?tab=funds', 'Funds Flow'],
        ['/financial-reports?tab=map', 'Group Mapping (P&L / BS)'], ['/funds-position', 'Net Position of Funds'], ['/bank-reconciliation?tab=brs', 'Bank Reconciliation Statement'],
        ['/bank-reconciliation?tab=report', 'Bank Matched / Unmatched'], ['/outstanding-report', 'Outstanding Report'], ['/ageing', 'Ageing Report'], ['/bill-wise-ageing-report', 'Bill-wise Ageing'],
        ['/interest-posting', 'Interest on Overdue (register)'], ['/confirmation-letters', 'Balance Confirmation Letters']
    ] },
    { title: 'Budget & Dimensions', items: [
        ['/budgets', 'Budget vs Actual / Variance (ledger, sub-ledger, cost center, unit, doc class)'], ['/financial-reports?tab=budget', 'Budget vs Actual (quick)'],
        ['/dimension-reports?preset=sub_summary', 'Sub-ledger Summary'], ['/dimension-reports?preset=statement', 'Sub-ledger / Cost Center Statement'],
        ['/dimension-reports?preset=pl_cc', 'P&L by Cost Center'], ['/dimension-reports?preset=pl_unit', 'P&L by Unit'], ['/dimension-reports?preset=pl_branch', 'P&L by Branch'],
        ['/dimension-reports?preset=pl_class', 'P&L by Doc Class'], ['/dimension-reports?preset=cc_summary', 'Cost Center x Ledger'], ['/dimension-reports?preset=monthly', 'Cost Center Monthly Trend'],
        ['/dimension-reports?preset=doc_class', 'Doc Class Register (number gaps)'], ['/dimension-reports?preset=exceptions', 'Missing Dimensions']
    ] },
    { title: 'VAT, TDS & IRD', items: [
        ['/vat-reports?tab=register', 'Sales / Purchase VAT Register'], ['/vat-reports?tab=monthly', 'VAT Monthly Summary'], ['/vat-reports?tab=threshold', 'Annex 13 / Above Threshold'],
        ['/vat-reports?tab=vat_return', 'VAT Return'], ['/vat-reports?tab=vat_ledger', 'VAT Ledger'], ['/vat-reports?tab=tds', 'TDS Report'],
        ['/ird?tab=mat', 'IRD Materialized View'], ['/ird?tab=book', 'IRD Sales Book'], ['/ird?tab=sync', 'CBMS Sync Status'], ['/ird?tab=audit', 'IRD Bill Audit Log']
    ] },
    { title: 'Sales, Salesman & Routes', items: [
        ['/sales-purchase-analysis', 'Sales / Purchase Analysis'], ['/monthly-analysis', 'Monthly Analysis'], ['/profitability', 'Profitability'], ['/rate-history', 'Rate History'], ['/product-rate-history', 'Rate & Discount History'],
        ['/salesman-reports?view=agent_sales', 'Salesman-wise Net Sales'], ['/salesman-reports?view=route_sales', 'Route-wise Net Sales'], ['/salesman-reports?view=area_sales', 'Area-wise Net Sales'],
        ['/salesman-reports?view=plan_vs_visit', 'Route Plan vs Visit (productive calls)'], ['/salesman-reports?view=not_visited', 'Planned but Not Visited'], ['/salesman-reports?view=visits', 'Visit Log / No-order Reasons'],
        ['/salesman-reports?view=order_register', 'Order Register (desk + mobile)'], ['/salesman-reports?view=pending_orders', 'Pending Orders (ageing)'], ['/salesman-reports?view=fill_rate', 'Order Fill Rate'],
        ['/salesman-reports?view=order_products', 'Product-wise Orders'], ['/agent-targets?tab=ach', 'Target vs Achievement'], ['/agent-targets?tab=perf', 'Salesman Performance (month / qtr / year)'],
        ['/agent-targets?tab=reg', 'Commission Register'], ['/control-reports?view=customer_master', 'Customer Master List'], ['/control-reports?view=route_customers', 'Route-wise Customer List'],
        ['/control-reports?view=credit_exceed', 'Credit Limit Exceeded / Overdue'], ['/control-reports?view=inactive_customers', 'Inactive Customers'], ['/loading-sheet', 'Loading Sheet']
    ] },
    { title: 'Purchase', items: [
        ['/purchase-register-report', 'Purchase Register (all)'], ['/grn-outstanding-report', 'GRN Outstanding'], ['/control-reports?view=supplier_master', 'Supplier Master List'],
        ['/lc-register', 'LC Register'], ['/consignment-cost', 'Consignment Cost / Sales']
    ] },
    { title: 'Inventory & Production', items: [
        ['/stock-report', 'Stock Report'], ['/stock-movement', 'Stock Movement'], ['/stock-in-out', 'Stock In / Out (Qty)'], ['/stock-valuation', 'Stock Valuation'],
        ['/stock-ageing', 'Stock Ageing & Expiry'], ['/reorder', 'Re-order & Over-stock'], ['/control-reports?view=non_moving_items', 'Non-moving Items'], ['/control-reports?view=price_list', 'Product Price List'],
        ['/production-report?view=register', 'Production Register'], ['/production-report?view=consumption', 'Raw Material Consumption'], ['/production-report?view=variance', 'BOM vs Actual'],
        ['/production-report?view=cost_trend', 'Production Cost Trend'], ['/fixed-assets?tab=schedule', 'Fixed Asset Schedule'], ['/fixed-assets?tab=detail', 'Depreciation Detail']
    ] },
    { title: 'Forecasting & Inventory Analytics', items: [
        ['/analytics?view=fsn', 'Fast / Slow / Non-moving (FSN)'], ['/analytics?view=abc', 'ABC Analysis'], ['/analytics?view=xyz', 'XYZ Analysis (demand variability)'],
        ['/analytics?view=abc_xyz', 'ABC-XYZ Matrix'], ['/analytics?view=stock_cover', 'Stock Cover / Stock-out Forecast'], ['/analytics?view=turnover', 'Inventory Turnover'],
        ['/analytics?view=dead_stock', 'Dead Stock (no movement)'], ['/analytics?view=sales_forecast', 'Sales / Purchase Forecast'], ['/analytics?view=purchase_plan', 'Purchase Plan (forecast based)'],
        ['/analytics?view=cash_forecast', 'Cash Flow Forecast (weekly)'], ['/analytics?view=period_compare', 'Period Comparison (vs last year / previous)'], ['/analytics?view=customer_rfm', 'Customer RFM, New & Lost Customers'],
        ['/analytics?view=expense_compare', 'Income & Expense Comparison'], ['/analytics?view=dso_dpo', 'Collection & Payment Days (DSO / DPO)']
    ] },
    { title: 'Messaging', items: [
        ['/messaging?tab=log', 'Message Log (sent / failed / pending)'], ['/messaging?tab=reminders', 'Outstanding Reminders (bulk)']
    ] },
    { title: 'Control & Registers', items: [
        ['/register', 'Universal Register (all documents)'], ['/control-reports?view=cancelled_docs', 'Cancelled Documents'], ['/control-reports?view=draft_docs', 'Draft (Unposted) Documents'],
        ['/control-reports?view=master_exceptions', 'Master Data Exceptions'], ['/lc-bg-dashboard', 'LC / BG / PDC Dashboard'], ['/pdc-dashboard', 'PDC Dashboard & Report'],
        ['/document-printing', 'Document Print Status'], ['/audit-log', 'Audit Log - all changes (old / new values)'], ['/audit-log?tab=coverage', 'Audit Coverage (tables audited)']
    ] }
];

export const REPORT_COUNT = REPORT_GROUPS.reduce((s, g) => s + g.items.length, 0);
