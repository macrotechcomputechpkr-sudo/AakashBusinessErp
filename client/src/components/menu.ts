// =============================================
// menu.ts
// The navigation. TOP_MENUS drive the classic top menu bar (Layout.jsx):
// Master Data, Data Entry (Sales / Purchase / Production / Inventory /
// Accounts ... each its own sub-menu), Accounts Report, Sales/Purchase,
// Analysis, Setup, then Office, Tools and Poultry (only when the Business
// Nature in System Control is Poultry). REPORT_GROUPS drive the Report
// Center (/reports) and the report menus - every report screen, with deep
// links (?tab= / ?view= / ?preset=) straight to one view of a report page.
// =============================================

/** feature: shown only when System Control turns that feature on */
export type Feature = 'poultry' | 'broiler' | 'hatchery' | 'construction' | 'automobile';
/** sep: a separator line above this entry in the drop-down */
export interface MenuItem { to: string; label: string; group?: string; feature?: Feature; sep?: boolean }
export interface MenuGroup { title: string; items: MenuItem[]; feature?: Feature; sep?: boolean }
export interface TopMenu { key: string; title: string; groups: MenuGroup[]; feature?: Feature }
export type ReportGroup = { title: string; items: [string, string][]; feature?: Feature };

const i = (to: string, label: string, feature?: Feature): MenuItem => (feature ? { to, label, feature } : { to, label });
/** the same, with a separator line above it */
const si = (to: string, label: string, feature?: Feature): MenuItem => ({ ...i(to, label, feature), sep: true });

export const REPORT_GROUPS: ReportGroup[] = [
    { title: 'Accounts & Finance', items: [
        ['/ledger-report', 'Ledger Report (detail)'], ['/ledger-report?mode=summary', 'Ledger Summary (PDC separate option)'], ['/ledger-report?mode=monthly', 'Ledger Monthly Summary'],
        ['/party-summary', 'Party Summary (PDC separate option)'], ['/day-book', 'Day Book (all-in-one: user / agent / voucher type)'], ['/daily-register', 'Daily Register (one-page day sheet)'], ['/control-reports?view=day_book', 'Day Book (ledger lines)'], ['/control-reports?view=cash_bank_book', 'Cash & Bank Book'],
        ['/financial-reports?tab=tb', 'Trial Balance'], ['/financial-reports?tab=pl', 'Profit & Loss'], ['/financial-reports?tab=bs', 'Balance Sheet'],
        ['/financial-reports?tab=notes', 'Schedules / Notes'], ['/financial-reports?tab=ratios', 'Ratio Analysis'], ['/financial-reports?tab=cash', 'Cash Flow'], ['/financial-reports?tab=funds', 'Funds Flow'],
        ['/financial-reports?tab=map', 'Group Mapping (P&L / BS)'], ['/funds-position', 'Net Position of Funds'], ['/bank-reconciliation?tab=brs', 'Bank Reconciliation Statement'],
        ['/bank-reconciliation?tab=report', 'Bank Matched / Unmatched'], ['/outstanding-report', 'Outstanding Report'], ['/ageing', 'Ageing Report'], ['/bill-wise-ageing-report', 'Bill-wise Ageing'],
        ['/interest-posting', 'Interest on Overdue (register)'], ['/confirmation-letters', 'Balance Confirmation Letters']
    ] },
    { title: 'Budget & Dimensions', items: [
        ['/budgets', 'Budget vs Actual / Variance (ledger, sub-ledger, cost center, unit, doc class)'], ['/financial-reports?tab=budget', 'Budget vs Actual (quick)'],
        ['/dimension-reports?preset=sub_summary', 'Ledger + Sub-ledger Balance (module filter)'], ['/dimension-reports?preset=statement', 'Sub-ledger / Cost Center Statement'],
        ['/dimension-reports?preset=pl_cc', 'P&L by Cost Center'], ['/dimension-reports?preset=pl_unit', 'P&L by Unit'], ['/dimension-reports?preset=pl_branch', 'P&L by Branch'],
        ['/dimension-reports?preset=pl_class', 'P&L by Doc Class'], ['/dimension-reports?preset=cc_summary', 'Cost Center x Ledger'], ['/dimension-reports?preset=monthly', 'Cost Center Monthly Trend'],
        ['/dimension-reports?preset=doc_class', 'Doc Class Register (number gaps)'], ['/dimension-reports?preset=exceptions', 'Missing Dimensions']
    ] },
    { title: 'VAT, TDS & IRD', items: [
        ['/vat-reports?tab=register', 'Sales / Purchase VAT Register'], ['/vat-reports?tab=monthly', 'VAT Monthly Summary'], ['/vat-reports?tab=threshold', 'Annex 13 / Above Threshold'],
        ['/vat-reports?tab=vat_return', 'VAT Return'], ['/vat-reports?tab=vat_ledger', 'VAT Ledger'], ['/vat-reports?tab=tds', 'TDS Report'],
        ['/tax-reconciliation', 'Reconciliation (VAT / Sales / Purchase / TDS)'], ['/tax-reconciliation?tab=vat', 'VAT Reconciliation'], ['/tax-reconciliation?tab=sales', 'Sales Account Reconciliation'], ['/tax-reconciliation?tab=purchase', 'Purchase Account Reconciliation'], ['/tax-reconciliation?tab=stock', 'Purchase vs Stock Reconciliation'], ['/tax-reconciliation?tab=tds', 'TDS Reconciliation'],
        ['/ird?tab=mat', 'IRD Materialized View'], ['/ird?tab=book', 'IRD Sales Book'], ['/ird?tab=sync', 'CBMS Sync Status'], ['/ird?tab=audit', 'IRD Bill Audit Log']
    ] },
    { title: 'Sales, Salesman & Routes', items: [
        ['/sales-purchase-analysis', 'Sales / Purchase Analysis'], ['/monthly-analysis', 'Monthly Analysis'], ['/profitability', 'Profitability'], ['/rate-history', 'Rate History'], ['/product-rate-history', 'Rate & Discount History'],
        ['/salesman-reports?view=agent_sales', 'Salesman-wise Net Sales'], ['/salesman-reports?view=route_sales', 'Route-wise Net Sales'], ['/salesman-reports?view=area_sales', 'Area-wise Net Sales'],
        ['/salesman-reports?view=plan_vs_visit', 'Route Plan vs Visit (productive calls)'], ['/salesman-reports?view=not_visited', 'Planned but Not Visited'], ['/salesman-reports?view=visits', 'Visit Log / No-order Reasons'],
        ['/salesman-reports?view=order_register', 'Order Register (desk + mobile)'], ['/salesman-reports?view=pending_orders', 'Pending Orders (ageing)'], ['/salesman-reports?view=fill_rate', 'Order Fill Rate'],
        ['/salesman-reports?view=order_products', 'Product-wise Orders'], ['/agent-targets?tab=ach', 'Target vs Achievement'], ['/agent-targets?tab=perf', 'Salesman Performance (month / qtr / year)'],
        ['/agent-targets?tab=bills', 'Bill-wise Agent Commission'], ['/agent-targets?tab=reg', 'Commission Register'], ['/control-reports?view=customer_master', 'Customer Master List'], ['/control-reports?view=route_customers', 'Route-wise Customer List'],
        ['/control-reports?view=credit_exceed', 'Credit Limit Exceeded / Overdue'], ['/control-reports?view=inactive_customers', 'Inactive Customers'], ['/loading-sheet', 'Loading Sheet']
    ] },
    { title: 'Purchase', items: [
        ['/purchase-register-report', 'Purchase Register (all)'], ['/grn-outstanding-report', 'GRN Outstanding'], ['/control-reports?view=supplier_master', 'Supplier Master List'],
        ['/lc-register', 'LC Register'], ['/consignment-cost', 'Consignment Cost / Sales'], ['/consignment-cost?view=costing', 'Consignment Costing (date-wise, additional terms)']
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
    { title: 'Office: Tasks & Darta / Chalani', items: [
        ['/darta-chalani?type=darta', 'Darta Register (incoming)'], ['/darta-chalani?type=chalani', 'Chalani Register (outgoing)'], ['/darta-chalani?status=pending', 'Pending Darta / Chalani'],
        ['/tasks?view=overdue', 'Overdue Tasks'], ['/tasks?view=all', 'All Tasks (status / assignee)'], ['/work-dashboard', 'Work Dashboard']
    ] },
    { title: 'Poultry & Hatchery', feature: 'poultry', items: [
        ['/poultry/reports?view=profitability', 'Shed / Batch Profitability'], ['/poultry/reports?view=lifecycle', 'Broiler Lifecycle (shed-wise)'],
        ['/poultry/reports?view=mortality', 'Shed-wise Mortality'], ['/poultry/reports?view=consumption', 'Shed-wise Consumption (feed / medicine / vaccine)'],
        ['/poultry/hatchery?tab=report', 'Hatchery Performance (fertility / hatchability / chick cost)']
    ] },
    { title: 'Construction', feature: 'construction', items: [
        ['/construction/reports?view=profitability', 'Site-wise Profit / Loss (contract, billed, cost)'], ['/construction/reports?view=ra_register', 'Running Bill Register'],
        ['/construction/reports?view=subcontractors', 'Petti Thekka (Sub-contract) Register'], ['/construction/reports?view=material', 'Site-wise Material Consumed'],
        ['/construction/reports?view=wages', 'Site-wise Labour / Wages']
    ] },
    { title: 'Automobile', feature: 'automobile', items: [
        ['/auto/reports?view=enquiries', 'Enquiry Analysis (source / model / salesperson / lost)'], ['/auto/reports?view=vehicle_sales', 'Vehicle Delivery Register'],
        ['/auto/reports?view=job_cards', 'Job Card Register & Workshop Revenue'], ['/auto/reports?view=parts', 'Parts Issued for Job Cards'],
        ['/auto/reports?view=outside_work', 'Outside Work Register'], ['/auto/reports?view=technicians', 'Technician Performance'], ['/auto/reminders?view=overdue', 'Overdue Service Reminders']
    ] },
    { title: 'Control & Registers', items: [
        ['/register', 'Universal Register (all documents)'], ['/control-reports?view=cancelled_docs', 'Cancelled Documents'], ['/control-reports?view=draft_docs', 'Draft (Unposted) Documents'],
        ['/control-reports?view=master_exceptions', 'Master Data Exceptions'], ['/lc-bg-dashboard', 'LC / BG / PDC Dashboard'], ['/pdc-dashboard', 'PDC Dashboard & Report'],
        ['/document-printing', 'Document Print Status'], ['/audit-log', 'Audit Log - all changes (old / new values)'], ['/audit-log?tab=coverage', 'Audit Coverage (tables audited)']
    ] }
];


const rg = (title: string): MenuGroup => {
    const g = REPORT_GROUPS.find(x => x.title === title);
    return { title, feature: g?.feature, items: (g?.items || []).map(([to, label]) => ({ to, label })) };
};

export const TOP_MENUS: TopMenu[] = [
    { key: 'master', title: 'Master Data', groups: [
        { title: 'Accounts Masters', items: [
            i('/chart-of-accounts', '📒 Chart of Accounts (Ledger)'), i('/sub-ledgers', '📑 Sub Ledgers'), i('/cost-profit-centers', '🎯 Cost & Profit Centers'),
            i('/billing-terms', '🧾 Billing Terms'), i('/remarks-terms', '📝 Remarks & Terms'), i('/fixed-assets', '🏗 Fixed Assets'), i('/ledger-opening', '📖 Ledger Opening Balance')
        ] },
        { title: 'Product Masters', items: [
            i('/products', '🛒 Product Master'), i('/product-units', '📏 Product Units'), i('/product-groups', '📦 Product Groups'), i('/categories', '🏷️ Categories'),
            i('/product-opening', '📦 Product Opening Stock'), i('/bom-template', '📋 BOM Template')
        ] },
        { title: 'Rate & Discount', items: [
            i('/pricing-masters?tab=rate_types', '💲 Multiple Rate Types (Sr1 - Sr5)'), i('/pricing-masters?tab=rate', '💲 Rate Category'), i('/pricing-masters?tab=discount', '🏷️ Discount Category'),
            i('/product-rate-change', '💲 Product Rate Change'), i('/product-offer-rate', '🏷️ Offer Rate')
        ] },
        { title: 'Sales Force & Routes', items: [
            i('/salesman-agents', '🧑‍💼 Salesman / Agent'), i('/route-sequencing', '🚚 Route Sequencing'), i('/route-plan', '🗓 Route Plan & Mobile Login'), i('/transport-master', '🚚 Transport Master')
        ] },
        { title: 'Poultry Masters', feature: 'poultry', items: [
            i('/poultry/setup?tab=sheds', '🏠 Sheds / Hatchers'), i('/poultry/setup?tab=items', '🐣 Poultry Items (chick / feed / medicine…)'),
            i('/poultry/setup?tab=standards', '📈 Breed Standards'), i('/poultry/setup?tab=settings', '⚙️ Poultry Settings (ledgers / warehouse)')
        ] }
    ] },
    { key: 'entry', title: 'Data Entry', groups: [
        { title: 'Accounts', items: [
            i('/journal-voucher', '📗 Journal Voucher'), i('/balance-writeoff', '🧹 Small Balance Write-off (JV)'), i('/cash-bank-entry', '💵 Cash / Bank Entry'), si('/debit-note', '📤 Debit Note'), i('/credit-note', '📥 Credit Note'),
            si('/pdc-voucher', '🏦 PDC'), i('/bulk-cash-settlement', '💰 Bulk Cash Settlement'), i('/bank-reconciliation', '🏦 Bank Reconciliation'),
            si('/interest-posting', '% Interest on Overdue'), i('/fixed-assets?tab=depreciation', '🏗 Depreciation Posting'), si('/budgets', '💼 Budgets'),
            i('/confirmation-letters', '✉ Account Confirmation Letters')
        ] },
        { title: 'Sales Transaction', sep: true, items: [
            i('/sales-quotation', '📝 Sales Quotation'), i('/sales-order', '🧾 Sales Order'), i('/order-billing', '⚡ Order → Bill (single / multiple)'), i('/mobile-approvals', '📲 Mobile Approvals (receipts / returns)'),
            si('/sales-delivery', '🚚 Sales Delivery / Challan'), i('/sales-bill', '💵 Sales Bill / Invoice'), si('/sales-return', '↩️ Sales Return'),
            i('/sales-nonsaleable-return', '🗑️ Sales Non-saleable Return'), si('/sales-additional-entry', '➕ Sales Additional Entry'), i('/agent-targets?tab=targets', '🎯 Salesman Targets & Commission')
        ] },
        { title: 'Purchase Transaction', items: [
            i('/purchase-quotation', '📨 Purchase Quotation'), i('/purchase-order', '🛒 Purchase Order'),
            si('/purchase-grn', '📦 Purchase GRN'), i('/purchase-bill', '🧾 Purchase Bill'), i('/purchase-bill-import', '📷 Purchase Bill from Image / PDF'),
            si('/purchase-additional-expense', '🧮 Additional Expenses'), si('/purchase-return', '↩️ Purchase Return'), i('/purchase-nonsaleable-return', '🚫 Non-saleable Return'),
            si('/lc-register', '🏦 LC Register & Mapping')
        ] },
        { title: 'Production', items: [
            i('/production-order', '🏭 Production Order'), i('/bom-template', '📋 BOM Template')
        ] },
        { title: 'Inventory', items: [
            i('/stock-transfer', '🔄 Stock Transfer'), i('/barcode-print', '🏷 Barcode / Label Printing')
        ] },
        { title: 'Automobile', feature: 'automobile', sep: true, items: [
            i('/auto/enquiries?new=1', '📋 Customer Enquiry', 'automobile'), i('/auto/vehicles?ownership=stock', '🚗 PDI / Vehicle Delivery', 'automobile'),
            i('/auto/job-cards?new=1', '🔧 Job Card', 'automobile'), i('/auto/reminders', '⏰ Service Reminders', 'automobile')
        ] },
        { title: 'Construction', feature: 'construction', sep: true, items: [
            i('/construction/sites', '🏗️ Sites / Running Bills / Material / Wages', 'construction'), i('/construction/sites?new=1', '➕ New Site / Contract', 'construction')
        ] },
        { title: 'Poultry & Hatchery', feature: 'poultry', sep: true, items: [
            i('/poultry/batches', '🐔 Broiler Batches (placement / daily log / lifting)', 'broiler'), i('/poultry/batches?new=1', '➕ New Batch Placement', 'broiler'),
            i('/poultry/hatchery', '🥚 Hatchery (egg set / candling / hatch)', 'hatchery')
        ] },
        { title: 'Office', sep: true, items: [
            i('/tasks', '📝 Tasks'), i('/darta-chalani', '📨 Darta / Chalani Register')
        ] }
    ] },
    { key: 'acc_report', title: 'Accounts Report', groups: [rg('Accounts & Finance'), rg('Budget & Dimensions'), rg('VAT, TDS & IRD'), rg('Control & Registers')] },
    { key: 'sp_report', title: 'Sales/Purchase', groups: [rg('Sales, Salesman & Routes'), rg('Purchase'), rg('Inventory & Production'), rg('Poultry & Hatchery'), rg('Construction'), rg('Automobile')] },
    { key: 'analysis', title: 'Analysis', groups: [
        { title: 'Dashboards', items: [
            i('/dashboard', '🏠 Dashboard'), i('/work-dashboard', '📊 Work Dashboard'), i('/lc-bg-dashboard', '📑 LC / BG / PDC Dashboard'), i('/pdc-dashboard', '🏦 PDC Dashboard'),
            i('/poultry', '🐔 Poultry Dashboard', 'poultry')
        ] },
        { title: 'Sales & Profit Analysis', items: [
            i('/sales-purchase-analysis', '📈 Sales / Purchase Analysis'), i('/monthly-analysis', '📅 Monthly Analysis'), i('/profitability', '💹 Profitability'),
            i('/rate-history', '💲 Rate History'), i('/product-rate-history', '💲 Rate & Discount History')
        ] },
        rg('Forecasting & Inventory Analytics')
    ] },
    { key: 'setup', title: 'Setup', groups: [
        { title: 'Company & Control', items: [
            i('/system-control', '⚙️ System Control (Business Nature, rates, posting)'), i('/fiscal-years', '📅 Fiscal Years'), i('/branches-warehouses', '🏢 Branches & Warehouses'),
            i('/business-units', '🏷️ Business Units'), i('/ledger-mapping', '🔗 Ledger Mapping'), i('/document-numbering', '🔢 Document Numbering'), i('/currencies', '💱 Currencies'),
            i('/entry-field-control', '🔒 Entry Field Control'), i('/user-defined-fields', '🧩 User Defined Fields')
        ] },
        { title: 'Users & Security', items: [
            i('/users', '👤 Users'), i('/security-groups', '🔐 Security Groups'), i('/data-access', '🔐 Data Access (ledger / product / area)'),
            i('/audit-log', '🕘 Audit Log'), i('/change-password', '🔑 Change My Password')
        ] },
        { title: 'Printing & Messaging', items: [
            i('/document-designer', '🎨 Document Designer'), i('/messaging', '📨 Messaging Templates & Auto-send'), i('/notification-settings', '🔔 My Notification Settings')
        ] },
        { title: 'Poultry Setup', feature: 'poultry', items: [i('/poultry/setup', '🐔 Poultry & Hatchery Setup')] }
    ] },
    { key: 'office', title: 'Office', groups: [
        { title: 'Office Work', items: [
            i('/work-dashboard', '📊 Work Dashboard'), i('/tasks', '📝 Tasks'), i('/darta-chalani', '📨 Darta / Chalani'), i('/notification-settings', '🔔 My Notification Settings')
        ] },
        rg('Office: Tasks & Darta / Chalani')
    ] },
    { key: 'tools', title: 'Tools', groups: [
        { title: 'Tools', items: [
            i('/help-center', '❓ Help Center (manuals, IRD, menu PDFs)'), i('/reports', '📚 Report Center (all reports)'), i('/document-printing', '🖨 Manual Document Printing'), i('/messaging', '📨 Messaging (Email / SMS / WhatsApp / Viber)'),
            i('/ird', '🏛 IRD Compliance / CBMS'), i('/mobile', '📱 Salesman Mobile App')
        ] },
        rg('Messaging')
    ] },
    { key: 'poultry', title: 'Poultry', feature: 'poultry', groups: [
        { title: 'Poultry & Hatchery', items: [
            i('/poultry', '📊 Poultry Dashboard'), i('/poultry/batches', '🐔 Broiler Batches', 'broiler'), i('/poultry/hatchery', '🥚 Hatchery', 'hatchery'),
            i('/poultry/setup', '⚙️ Poultry Setup')
        ] },
        rg('Poultry & Hatchery')
    ] },
    { key: 'construction', title: 'Construction', feature: 'construction', groups: [
        { title: 'Sites & Contracts', items: [
            i('/construction', '📊 Construction Dashboard'), i('/construction/sites', '🏗️ Sites / Contracts (thekka)'), i('/construction/sites?new=1', '➕ New Site'),
            i('/construction/setup', '⚙️ Construction Setup')
        ] },
        rg('Construction')
    ] },
    { key: 'automobile', title: 'Automobile', feature: 'automobile', groups: [
        { title: 'Showroom', items: [
            i('/auto', '📊 Automobile Dashboard'), i('/auto/enquiries', '📋 Customer Enquiries'), i('/auto/enquiries?new=1', '➕ New Enquiry'),
            i('/auto/vehicles?ownership=stock', '🚗 Vehicle Stock / PDI / Delivery'), i('/auto/vehicles?ownership=customer', '🔑 Delivered & Customer Vehicles')
        ] },
        { title: 'After Sales / Workshop', items: [
            i('/auto/job-cards', '🔧 Job Cards'), i('/auto/job-cards?new=1', '➕ New Job Card'), i('/auto/job-cards?status=ready', '✅ Vehicles Ready for Delivery'),
            i('/auto/reminders', '⏰ Service Reminders'), i('/auto/setup', '⚙️ Automobile Setup')
        ] },
        rg('Automobile')
    ] }
];

export interface AppFeatures { business_nature: string; poultry: { enabled: boolean; broiler: boolean; hatchery: boolean }; construction?: { enabled: boolean }; automobile?: { enabled: boolean } }
/** is a feature-gated menu entry / report group on for this company? */
export const featureOn = (f: Feature | undefined, a: AppFeatures | null): boolean => {
    if (!f) return true;
    if (f === 'construction') return !!a?.construction?.enabled;
    if (f === 'automobile') return !!a?.automobile?.enabled;
    if (!a?.poultry?.enabled) return false;
    return f === 'poultry' || !!a.poultry[f];
};
export const visibleReportGroups = (a: AppFeatures | null): ReportGroup[] => REPORT_GROUPS.filter(g => featureOn(g.feature, a));
export const REPORT_COUNT = REPORT_GROUPS.filter(g => !g.feature).reduce((s, g) => s + g.items.length, 0);
