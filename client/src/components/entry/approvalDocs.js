// =============================================
// components/entry/approvalDocs.js
// Documents the approval system covers (System Control > Approval Needed For,
// Security Rights Group > Approvals); keys match server utils/approval.js.
// =============================================
export const APPROVAL_DOCS = [
    ['sales_quotation', 'Sales Quotation'], ['sales_order', 'Sales Order'], ['sales_delivery', 'Sales Challan'], ['sales_bill', 'Sales Bill'], ['sales_return', 'Sales Return'],
    ['sales_nonsalable_return', 'Sales Non-saleable Return'], ['sales_additional', 'Sales Additional Entry'],
    ['purchase_requisition', 'Purchase Requisition'], ['purchase_quotation', 'Purchase Quotation'], ['purchase_order', 'Purchase Order'], ['purchase_grn', 'Goods Receipt (GRN)'],
    ['purchase_bill', 'Purchase Bill'], ['purchase_return', 'Purchase Return'], ['purchase_nonsalable_return', 'Purchase Non-saleable Return'], ['purchase_additional', 'Purchase Additional Expense'],
    ['cash_bank_entry', 'Cash / Bank Entry'], ['journal', 'Journal Voucher'], ['stock_transfer', 'Stock Transfer'], ['production', 'Production']
];
