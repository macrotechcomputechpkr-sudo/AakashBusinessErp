// =============================================
// routes/documentDesignerRoutes.js
// "Sabai entry module ko documents design garne option" - Print
// Format Designer. CRUD for saved templates, a per-document-type
// available-fields catalog for the drag-and-drop palette, and a
// render endpoint that fills a saved layout with a real document's
// data.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { evaluateFormula } = require('../utils/formulaEvaluator');
const { generateTemplateLayout } = require('../utils/printLayoutGenerator');

// FEATURE: each document type's header table, detail table, the
// detail table's foreign key back to the header (this differs per
// module - sales_delivery_details uses delivery_id, purchase_grn_
// details uses grn_id, etc.), and its party ledger snapshot field.
const DOCUMENT_TYPE_CONFIG = {
    sales_bill: { headerTable: 'sales_bills', detailTable: 'sales_bill_details', fkColumn: 'bill_id', partyNameField: 'customer_name_snapshot' },
    purchase_bill: { headerTable: 'purchase_bills', detailTable: 'purchase_bill_details', fkColumn: 'bill_id', partyNameField: 'vendor_name_snapshot' },
    sales_delivery: { headerTable: 'sales_deliveries', detailTable: 'sales_delivery_details', fkColumn: 'delivery_id', partyNameField: 'customer_name_snapshot' },
    sales_return: { headerTable: 'sales_returns', detailTable: 'sales_return_details', fkColumn: 'return_id', partyNameField: 'customer_name_snapshot' },
    purchase_grn: { headerTable: 'purchase_grns', detailTable: 'purchase_grn_details', fkColumn: 'grn_id', partyNameField: 'vendor_name_snapshot' },
    purchase_return: { headerTable: 'purchase_returns', detailTable: 'purchase_return_details', fkColumn: 'return_id', partyNameField: 'vendor_name_snapshot' },
    sales_order: { headerTable: 'sales_orders', detailTable: 'sales_order_details', fkColumn: 'order_id', partyNameField: 'customer_name_snapshot' },
    sales_quotation: { headerTable: 'sales_quotations', detailTable: 'sales_quotation_details', fkColumn: 'quotation_id', partyNameField: 'customer_name_snapshot' },
    // These three DO have vendor_name_snapshot (added by migration 47),
    // but rows created before that migration have it NULL - the join is
    // kept purely as a fallback for those old rows (see render below).
    purchase_order: { headerTable: 'purchase_orders', detailTable: 'purchase_order_details', fkColumn: 'order_id', partyNameField: 'vendor_name_snapshot', headerSelect: '*, vendor:vendor_ledger_id(account_name)', partyNamePath: 'vendor.account_name' },
    purchase_quotation: { headerTable: 'purchase_quotations', detailTable: 'purchase_quotation_details', fkColumn: 'quotation_id', partyNameField: 'vendor_name_snapshot', headerSelect: '*, vendor:vendor_ledger_id(account_name)', partyNamePath: 'vendor.account_name' },
    purchase_requisition: { headerTable: 'purchase_requisitions', detailTable: 'purchase_requisition_details', fkColumn: 'requisition_id', partyNameField: 'vendor_name_snapshot', headerSelect: '*, vendor:vendor_ledger_id(account_name)', partyNamePath: 'vendor.account_name' },
    sales_nonsaleable_return: { headerTable: 'sales_nonsaleable_returns', detailTable: 'sales_nonsaleable_return_details', fkColumn: 'return_id', partyNameField: 'customer_name_snapshot' },
    purchase_nonsaleable_return: { headerTable: 'purchase_nonsaleable_returns', detailTable: 'purchase_nonsaleable_return_details', fkColumn: 'return_id', partyNameField: 'vendor_name_snapshot' },
    // No customer/vendor at all - this moves stock between the
    // tenant's OWN warehouses/branches, so there is no partyNameField.
    stock_transfer: { headerTable: 'stock_transfers', detailTable: 'stock_transfer_details', fkColumn: 'transfer_id' },
    // Also no party. The "detail" band here is Raw Materials (what
    // gets CONSUMED, one repeating line per material) - the single
    // Output is a header-level field (only one per order), and
    // Byproducts is a SEPARATE table, surfaced as its own special
    // footer block the same way Product Term Summary is.
    production_order: { headerTable: 'production_orders', detailTable: 'production_raw_materials', fkColumn: 'production_id' },
    journal_voucher: { headerTable: 'journal_vouchers', detailTable: 'journal_voucher_details', fkColumn: 'jv_id' },
    credit_note: { headerTable: 'credit_notes', detailTable: 'credit_note_details', fkColumn: 'credit_note_id', partyNameField: 'party_name_snapshot' },
    debit_note: { headerTable: 'debit_notes', detailTable: 'debit_note_details', fkColumn: 'debit_note_id', partyNameField: 'party_name_snapshot' },
    // Flat, single-row vouchers - no line items at all, so no
    // detailTable/fkColumn. The render endpoint below treats a
    // missing detailTable as "zero detail rows" rather than querying.
    cash_bank_entry: { headerTable: 'cash_bank_entries', partyNameField: 'party_name_snapshot' },
    pdc_voucher: { headerTable: 'pdc_vouchers', partyNameField: 'party_name_snapshot' },
    // Neither line table stores a ledger_name_snapshot (the existing
    // routes resolve it client-side instead) - detailSelect joins it
    // live, and detailJoinField/detailJoinPath flatten that nested
    // result into the same key the field catalog uses, on EVERY
    // detail row (the header-side partyNamePath equivalent, applied
    // per-line instead of once).
    sales_additional_entry: { headerTable: 'sales_additional_entries', detailTable: 'sales_additional_entry_lines', fkColumn: 'entry_id', partyNameField: 'customer_name_snapshot', detailSelect: '*, ledger:income_ledger_id(account_name)', detailJoinField: 'ledger_name_snapshot', detailJoinPath: 'ledger.account_name' },
    purchase_additional_expense: { headerTable: 'purchase_additional_expenses', detailTable: 'purchase_additional_expense_lines', fkColumn: 'expense_id', partyNameField: 'vendor_name_snapshot', detailSelect: '*, ledger:expense_ledger_id(account_name)', detailJoinField: 'ledger_name_snapshot', detailJoinPath: 'ledger.account_name' }
};

// FEATURE: the field palette shown in the designer, per document
// type. Each entry names a field the person can drag onto the canvas.
// "header" fields come from the document's own row (once per print);
// "detail" fields come from each line item (repeat once per row);
// "footer" fields are computed summaries.
const FIELD_CATALOGS = {
    sales_bill: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'company_pan', label: 'Company PAN' }, { key: 'doc_no', label: 'Bill No' },
            { key: 'doc_date', label: 'Bill Date' }, { key: 'customer_name_snapshot', label: 'Customer Name' },
            { key: 'customer_address_snapshot', label: 'Customer Address' }, { key: 'customer_pan_snapshot', label: 'Customer PAN' },
            { key: 'agent_name_snapshot', label: 'Agent' }, { key: 'area_name_snapshot', label: 'Area' },
            { key: 'route_name_snapshot', label: 'Route' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'product_code_snapshot', label: 'Product Code' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'discount_percent', label: 'Discount %' }, { key: 'discount_amount', label: 'Discount Amt' },
            { key: 'free_qty', label: 'Free Qty' }, { key: 'free_alt_qty', label: 'Free Alt Qty' },
            { key: 'tax_percent', label: 'Tax %' }, { key: 'amount', label: 'Amount' }, { key: 'batch_no', label: 'Batch No' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'total_discount', label: 'Total Discount' },
            { key: 'total_tax', label: 'Total Tax' }, { key: 'grand_total', label: 'Grand Total' },
            { key: 'amount_in_words', label: 'Amount In Words' }, { key: 'terms_conditions', label: 'Terms & Conditions' }
            // Note: "Product Term Summary" is Purchase-only - Sales
            // uses ProductTermBar's plain discount_percent, which has
            // no named-term breakdown to summarize.
        ]
    },
    purchase_bill: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Bill No' }, { key: 'doc_date', label: 'Bill Date' },
            { key: 'vendor_name_snapshot', label: 'Vendor Name' }, { key: 'vendor_address_snapshot', label: 'Vendor Address' },
            { key: 'agent_name_snapshot', label: 'Agent' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'product_code_snapshot', label: 'Product Code' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'discount_percent', label: 'Discount %' }, { key: 'discount_amount', label: 'Discount Amt' },
            { key: 'free_qty', label: 'Free Qty' }, { key: 'free_alt_qty', label: 'Free Alt Qty' },
            { key: 'amount', label: 'Amount' }, { key: 'batch_no', label: 'Batch No' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'total_discount', label: 'Total Discount' },
            { key: 'grand_total', label: 'Grand Total' }, { key: 'amount_in_words', label: 'Amount In Words' },
            { key: 'product_term_summary', label: 'Product Term Summary (table)' }
        ]
    },
    sales_delivery: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Challan No' }, { key: 'doc_date', label: 'Challan Date' },
            { key: 'customer_name_snapshot', label: 'Customer Name' }, { key: 'customer_address_snapshot', label: 'Customer Address' },
            { key: 'vehicle_no', label: 'Vehicle No' }, { key: 'driver_name', label: 'Driver Name' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'batch_no', label: 'Batch No' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'warehouse_name_snapshot', label: 'Warehouse' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'grand_total', label: 'Grand Total' }, { key: 'terms_conditions', label: 'Terms & Conditions' }
        ]
    },
    sales_return: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Return No' }, { key: 'doc_date', label: 'Return Date' },
            { key: 'customer_name_snapshot', label: 'Customer Name' }, { key: 'customer_address_snapshot', label: 'Customer Address' },
            { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'batch_no', label: 'Batch No' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'discount_percent', label: 'Discount %' }, { key: 'discount_amount', label: 'Discount Amt' },
            { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'total_discount', label: 'Total Discount' },
            { key: 'grand_total', label: 'Grand Total' }, { key: 'amount_in_words', label: 'Amount In Words' }
        ]
    },
    purchase_grn: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'GRN No' }, { key: 'doc_date', label: 'GRN Date' },
            { key: 'vendor_name_snapshot', label: 'Vendor Name' }, { key: 'vendor_address_snapshot', label: 'Vendor Address' },
            { key: 'agent_name_snapshot', label: 'Agent' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'batch_no', label: 'Batch No' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'discount_percent', label: 'Discount %' }, { key: 'discount_amount', label: 'Discount Amt' },
            { key: 'free_qty', label: 'Free Qty' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'total_discount', label: 'Total Discount' },
            { key: 'grand_total', label: 'Grand Total' }, { key: 'product_term_summary', label: 'Product Term Summary (table)' }
        ]
    },
    purchase_return: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Return No' }, { key: 'doc_date', label: 'Return Date' },
            { key: 'vendor_name_snapshot', label: 'Vendor Name' }, { key: 'vendor_address_snapshot', label: 'Vendor Address' },
            { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'batch_no', label: 'Batch No' },
            { key: 'source_doc_no', label: 'Against Bill No' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'tax_percent', label: 'Tax %' }, { key: 'line_reason', label: 'Reason' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'grand_total', label: 'Grand Total' }, { key: 'amount_in_words', label: 'Amount In Words' }
        ]
    },
    sales_order: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Order No' }, { key: 'doc_date', label: 'Order Date' },
            { key: 'customer_name_snapshot', label: 'Customer Name' }, { key: 'customer_address_snapshot', label: 'Customer Address' },
            { key: 'agent_name_snapshot', label: 'Agent' }, { key: 'due_date', label: 'Delivery Date' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'batch_no', label: 'Batch No' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'discount_percent', label: 'Discount %' }, { key: 'discount_amount', label: 'Discount Amt' },
            { key: 'free_qty', label: 'Free Qty' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'total_discount', label: 'Total Discount' },
            { key: 'grand_total', label: 'Grand Total' }, { key: 'amount_in_words', label: 'Amount In Words' }, { key: 'terms_conditions', label: 'Terms & Conditions' }
        ]
    },
    sales_quotation: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Quotation No' }, { key: 'doc_date', label: 'Quotation Date' },
            { key: 'customer_name_snapshot', label: 'Customer Name' }, { key: 'customer_address_snapshot', label: 'Customer Address' },
            { key: 'valid_until', label: 'Valid Until' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'discount_percent', label: 'Discount %' }, { key: 'discount_amount', label: 'Discount Amt' },
            { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'total_discount', label: 'Total Discount' },
            { key: 'grand_total', label: 'Grand Total' }, { key: 'terms_conditions', label: 'Terms & Conditions' }
        ]
    },
    purchase_order: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Order No' }, { key: 'doc_date', label: 'Order Date' },
            { key: 'vendor_name_snapshot', label: 'Vendor Name' }, { key: 'due_date', label: 'Expected Delivery' }, { key: 'remarks_text', label: 'Remarks' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'free_qty', label: 'Free Qty' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'grand_total', label: 'Grand Total' },
            { key: 'product_term_summary', label: 'Product Term Summary (table)' }, { key: 'terms_conditions', label: 'Terms & Conditions' }
        ]
    },
    purchase_quotation: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'RFQ No' }, { key: 'doc_date', label: 'RFQ Date' },
            { key: 'vendor_name_snapshot', label: 'Vendor Name' }, { key: 'remarks_text', label: 'Remarks' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'free_qty', label: 'Free Qty' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'grand_total', label: 'Grand Total' },
            { key: 'product_term_summary', label: 'Product Term Summary (table)' }
        ]
    },
    purchase_requisition: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Requisition No' }, { key: 'doc_date', label: 'Requisition Date' },
            { key: 'vendor_name_snapshot', label: 'Preferred Vendor' }, { key: 'priority', label: 'Priority' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'discount_percent', label: 'Discount %' },
            { key: 'free_qty', label: 'Free Qty' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'total_discount', label: 'Total Discount' }, { key: 'grand_total', label: 'Grand Total' }
        ]
    },
    sales_nonsaleable_return: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Return No' }, { key: 'doc_date', label: 'Return Date' },
            { key: 'customer_name_snapshot', label: 'Customer Name' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'batch_no', label: 'Batch No' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'discount_percent', label: 'Discount %' }, { key: 'discount_amount', label: 'Discount Amt' },
            { key: 'warehouse_name_snapshot', label: 'Warehouse' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'sub_total', label: 'Sub Total' }, { key: 'total_discount', label: 'Total Discount' }, { key: 'grand_total', label: 'Grand Total' }
        ]
    },
    purchase_nonsaleable_return: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'company_address', label: 'Company Address' },
            { key: 'doc_no', label: 'Return No' }, { key: 'doc_date', label: 'Return Date' },
            { key: 'vendor_name_snapshot', label: 'Vendor Name' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'batch_no', label: 'Batch No' }, { key: 'source_doc_no', label: 'Against Bill No' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'rate', label: 'Rate' }, { key: 'rate_basis', label: 'Rate Basis' },
            { key: 'tax_percent', label: 'Tax %' }, { key: 'line_reason', label: 'Reason' },
            { key: 'warehouse_name_snapshot', label: 'Warehouse' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'grand_total', label: 'Grand Total' }
        ]
    },
    stock_transfer: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Transfer No' }, { key: 'doc_date', label: 'Transfer Date' },
            { key: 'branch_name_snapshot', label: 'From Branch' }, { key: 'to_branch_name_snapshot', label: 'To Branch' },
            { key: 'transport_name_snapshot', label: 'Transport' }, { key: 'vehicle_no', label: 'Vehicle No' }, { key: 'driver_name', label: 'Driver Name' },
            { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Product Name' }, { key: 'batch_no', label: 'Batch No' },
            { key: 'from_warehouse_name_snapshot', label: 'From Warehouse' }, { key: 'to_warehouse_name_snapshot', label: 'To Warehouse' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name_snapshot', label: 'Alt Unit' },
            { key: 'free_qty', label: 'Free Qty' }, { key: 'cost_rate', label: 'Cost Rate' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'grand_total', label: 'Grand Total' }
        ]
    },
    production_order: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Production Order No' }, { key: 'doc_date', label: 'Production Date' },
            { key: 'output_product_name_snapshot', label: 'Output Product' }, { key: 'output_qty', label: 'Output Qty' },
            { key: 'output_uom_name_snapshot', label: 'Output UOM' }, { key: 'output_alt_qty', label: 'Output Alt Qty' },
            { key: 'output_batch_no', label: 'Output Batch No' }, { key: 'output_warehouse_name_snapshot', label: 'Output Warehouse' },
            { key: 'source_warehouse_name_snapshot', label: 'Source Warehouse' }, { key: 'output_unit_cost', label: 'Output Unit Cost' },
            { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'product_name_snapshot', label: 'Raw Material' }, { key: 'batch_no', label: 'Batch No' }, { key: 'process_name', label: 'Process' },
            { key: 'qty', label: 'Qty' }, { key: 'uom_name_snapshot', label: 'UOM' },
            { key: 'alt_qty', label: 'Alt Qty' }, { key: 'alt_unit_name', label: 'Alt Unit' },
            { key: 'warehouse_name_snapshot', label: 'Warehouse' }, { key: 'cost_rate', label: 'Cost Rate' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'total_raw_material_cost', label: 'Total Raw Material Cost' }, { key: 'total_byproduct_value', label: 'Total Byproduct Value' },
            { key: 'byproducts_summary', label: 'Byproducts (table)' }, { key: 'product_term_summary', label: 'Product Term Summary (table)' }
        ]
    },
    journal_voucher: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Voucher No' }, { key: 'doc_date', label: 'Voucher Date' },
            { key: 'ref_doc_no', label: 'Reference Doc No' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'ledger_name_snapshot', label: 'Ledger' }, { key: 'sub_ledger_name_snapshot', label: 'Sub-Ledger' }, { key: 'agent_name_snapshot', label: 'Agent' },
            { key: 'debit_amount', label: 'Debit' }, { key: 'credit_amount', label: 'Credit' }, { key: 'narration', label: 'Line Narration' }
        ],
        footer: [
            { key: 'total_debit', label: 'Total Debit' }, { key: 'total_credit', label: 'Total Credit' }
        ]
    },
    credit_note: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Credit Note No' }, { key: 'doc_date', label: 'Credit Note Date' },
            { key: 'party_name_snapshot', label: 'Party Name' }, { key: 'ref_doc_no', label: 'Reference Doc No' }, { key: 'reason', label: 'Reason' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'ledger_name_snapshot', label: 'Ledger' }, { key: 'amount', label: 'Amount' }, { key: 'narration', label: 'Line Narration' }
        ],
        footer: [
            { key: 'total_amount', label: 'Total Amount' }, { key: 'amount_in_words', label: 'Amount In Words' }
        ]
    },
    debit_note: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Debit Note No' }, { key: 'doc_date', label: 'Debit Note Date' },
            { key: 'party_name_snapshot', label: 'Party Name' }, { key: 'ref_doc_no', label: 'Reference Doc No' }, { key: 'reason', label: 'Reason' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'ledger_name_snapshot', label: 'Ledger' }, { key: 'amount', label: 'Amount' }, { key: 'narration', label: 'Line Narration' }
        ],
        footer: [
            { key: 'total_amount', label: 'Total Amount' }, { key: 'amount_in_words', label: 'Amount In Words' }
        ]
    },
    cash_bank_entry: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Voucher No' }, { key: 'doc_date', label: 'Voucher Date' },
            { key: 'entry_type', label: 'Entry Type (Receipt/Payment)' }, { key: 'cash_bank_name_snapshot', label: 'Cash/Bank Ledger' },
            { key: 'party_name_snapshot', label: 'Party Name' }, { key: 'party_sub_ledger_name_snapshot', label: 'Party Sub-Ledger' },
            { key: 'amount', label: 'Amount' }, { key: 'payment_mode', label: 'Payment Mode' }, { key: 'ref_no', label: 'Reference No' },
            { key: 'ref_doc_no', label: 'Reference Doc No' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [],
        footer: [
            { key: 'amount_in_words', label: 'Amount In Words' }
        ]
    },
    pdc_voucher: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Voucher No' }, { key: 'doc_date', label: 'Voucher Date' },
            { key: 'voucher_type', label: 'Type (Receive/Issue)' }, { key: 'party_name_snapshot', label: 'Party Name' },
            { key: 'cheque_no', label: 'Cheque No' }, { key: 'cheque_date', label: 'Cheque Date' },
            { key: 'bank_name', label: 'Bank Name' }, { key: 'bank_branch', label: 'Bank Branch' },
            { key: 'bank_account_name', label: 'Account Name' }, { key: 'bank_account_no', label: 'Account No' },
            { key: 'beneficiary_name', label: 'Beneficiary Name' }, { key: 'amount', label: 'Amount' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [],
        footer: [
            { key: 'amount_in_words', label: 'Amount In Words' }
        ]
    },
    sales_additional_entry: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Entry No' }, { key: 'doc_date', label: 'Entry Date' },
            { key: 'customer_name_snapshot', label: 'Customer Name' }, { key: 'agent_name_snapshot', label: 'Agent' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'ledger_name_snapshot', label: 'Income Ledger' }, { key: 'description', label: 'Description' },
            { key: 'entry_sign', label: 'Add/Deduct' }, { key: 'rate_percent', label: 'Rate %' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'total_amount', label: 'Total Amount' }
        ]
    },
    purchase_additional_expense: {
        header: [
            { key: 'company_name', label: 'Company Name' }, { key: 'doc_no', label: 'Expense No' }, { key: 'doc_date', label: 'Expense Date' },
            { key: 'vendor_name_snapshot', label: 'Expense Provider' }, { key: 'cash_vendor_name', label: 'Cash Vendor Name' },
            { key: 'party_bill_no', label: 'Party Bill No' }, { key: 'party_bill_date', label: 'Party Bill Date' }, { key: 'narration', label: 'Narration' }
        ],
        detail: [
            { key: 'ledger_name_snapshot', label: 'Expense Ledger' }, { key: 'description', label: 'Description' },
            { key: 'allocation_basis', label: 'Allocation Basis' }, { key: 'entry_sign', label: 'Add/Deduct' }, { key: 'rate_percent', label: 'Rate %' }, { key: 'amount', label: 'Amount' }
        ],
        footer: [
            { key: 'total_amount', label: 'Total Amount' }
        ]
    }
};

router.get('/print-templates/available-fields', requireAuth, async (req, res) => {
    const { document_type } = req.query;
    const catalog = FIELD_CATALOGS[document_type];
    if (!catalog) return res.status(400).json({ success: false, error: `No field catalog defined yet for "${document_type}"` });
    res.json({ success: true, data: catalog });
});

// FEATURE: "every module ko 5-6 ota templates timle nai banaideu" -
// six ready-made variations per document type, generated with
// printLayoutGenerator so every field is positioned sensibly without
// hand-placing each one. Existing templates with the same name are
// left alone (re-running this is safe).
const SALES_BILL_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'agent_name_snapshot', 'route_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'total_tax', 'grand_total', 'amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Same layout, compact A5 for smaller printers.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials - no discount/tax columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Detailed with Batch & Free', description: 'Adds batch number and free-quantity columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'agent_name_snapshot', 'area_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'free_qty', 'rate', 'discount_percent', 'discount_amount', 'tax_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'total_tax', 'grand_total', 'amount_in_words', 'terms_conditions'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'company_pan', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'customer_pan_snapshot'],
        detail: ['product_name_snapshot', 'product_code_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'discount_percent', 'discount_amount', 'tax_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'total_tax', 'grand_total', 'amount_in_words', 'terms_conditions'] }
];
const PURCHASE_BILL_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot', 'agent_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Same layout, compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words'] },
    { template_name: 'With Product Term Summary', description: 'Adds the per-line Billing Term breakdown table.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total', 'amount_in_words', 'product_term_summary'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot', 'agent_name_snapshot'],
        detail: ['product_name_snapshot', 'product_code_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words', 'product_term_summary'] }
];
const SALES_DELIVERY_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail challan, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'vehicle_no', 'driver_name'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'warehouse_name_snapshot', 'amount'],
        footer: ['grand_total'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5 challan.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot'],
        footer: [] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'vehicle_no'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Simple (No Amount)', description: 'Just quantities for a delivery-only challan, no pricing shown.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot', 'vehicle_no', 'driver_name'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot'],
        footer: [] },
    { template_name: 'With Warehouse & Batch', description: 'Adds warehouse and batch tracking columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'vehicle_no', 'driver_name'],
        detail: ['product_name_snapshot', 'batch_no', 'warehouse_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total', 'terms_conditions'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'vehicle_no', 'driver_name'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'warehouse_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total', 'terms_conditions'] }
];
const SALES_RETURN_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Detailed with Batch', description: 'Adds batch number tracking.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words'] }
];
const PURCHASE_GRN_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot', 'agent_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'With Product Term Summary', description: 'Adds the per-line Billing Term breakdown table.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total', 'product_term_summary'] },
    { template_name: 'With Free Qty', description: 'Highlights free-quantity received per line.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'agent_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'free_qty', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot', 'agent_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'free_qty', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'product_term_summary'] }
];
const PURCHASE_RETURN_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot'],
        detail: ['product_name_snapshot', 'source_doc_no', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total', 'amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Reason & Batch', description: 'Adds the return reason and batch number per line.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'source_doc_no', 'line_reason', 'qty', 'uom_name_snapshot', 'rate', 'tax_percent', 'amount'],
        footer: ['grand_total', 'amount_in_words'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'vendor_address_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'source_doc_no', 'line_reason', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'tax_percent', 'amount'],
        footer: ['grand_total', 'amount_in_words'] }
];
const SALES_ORDER_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'agent_name_snapshot', 'due_date'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Detailed with Batch & Free', description: 'Adds batch and free-quantity columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'agent_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'free_qty', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words', 'terms_conditions'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'agent_name_snapshot', 'due_date'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'free_qty', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'amount_in_words', 'terms_conditions'] }
];
const SALES_QUOTATION_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'valid_until'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'terms_conditions'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'valid_until'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Validity & Terms', description: 'Emphasises quotation validity and terms.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'valid_until'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'terms_conditions'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'customer_address_snapshot', 'valid_until'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total', 'terms_conditions'] }
];
const PURCHASE_ORDER_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'due_date'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total', 'terms_conditions'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'With Product Term Summary', description: 'Adds the per-line Billing Term breakdown table.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total', 'product_term_summary'] },
    { template_name: 'With Free Qty', description: 'Highlights free-quantity ordered per line.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'due_date'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'free_qty', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'due_date'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'free_qty', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total', 'product_term_summary', 'terms_conditions'] }
];
const PURCHASE_QUOTATION_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'With Product Term Summary', description: 'Adds the per-line Billing Term breakdown table.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total', 'product_term_summary'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'free_qty', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total', 'product_term_summary'] }
];
const PURCHASE_REQUISITION_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'priority'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot'],
        footer: [] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'Simple (No Rate)', description: 'Internal request without pricing - qty only.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'priority'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot'],
        footer: [] },
    { template_name: 'With Discount & Free', description: 'Adds discount and free-quantity columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'priority'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'free_qty', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'priority'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'free_qty', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total'] }
];
const SALES_NONSALEABLE_RETURN_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['sub_total', 'grand_total'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Warehouse & Batch', description: 'Adds warehouse and batch tracking.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'narration'],
        detail: ['product_name_snapshot', 'batch_no', 'warehouse_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'customer_name_snapshot', 'narration'],
        detail: ['product_name_snapshot', 'batch_no', 'warehouse_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'discount_percent', 'discount_amount', 'amount'],
        footer: ['sub_total', 'total_discount', 'grand_total'] }
];
const PURCHASE_NONSALEABLE_RETURN_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'source_doc_no', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'rate_basis', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'With Reason & Batch', description: 'Adds return reason and batch tracking.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'source_doc_no', 'line_reason', 'warehouse_name_snapshot', 'qty', 'uom_name_snapshot', 'rate', 'tax_percent', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'company_address', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'source_doc_no', 'line_reason', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'rate', 'tax_percent', 'amount'],
        footer: ['grand_total'] }
];
const STOCK_TRANSFER_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'branch_name_snapshot', 'to_branch_name_snapshot', 'vehicle_no'],
        detail: ['product_name_snapshot', 'batch_no', 'from_warehouse_name_snapshot', 'to_warehouse_name_snapshot', 'qty', 'uom_name_snapshot', 'amount'],
        footer: ['grand_total'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'to_branch_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot'],
        footer: [] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'branch_name_snapshot', 'to_branch_name_snapshot'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name_snapshot', 'cost_rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Simple (No Amount)', description: 'Just quantities for an internal transfer challan, no pricing shown.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'branch_name_snapshot', 'to_branch_name_snapshot', 'vehicle_no', 'driver_name'],
        detail: ['product_name_snapshot', 'batch_no', 'from_warehouse_name_snapshot', 'to_warehouse_name_snapshot', 'qty', 'uom_name_snapshot'],
        footer: [] },
    { template_name: 'With Transport Details', description: 'Emphasises vehicle/driver/transport info.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'branch_name_snapshot', 'to_branch_name_snapshot', 'transport_name_snapshot', 'vehicle_no', 'driver_name'],
        detail: ['product_name_snapshot', 'batch_no', 'qty', 'uom_name_snapshot', 'free_qty', 'cost_rate', 'amount'],
        footer: ['grand_total'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'branch_name_snapshot', 'to_branch_name_snapshot', 'transport_name_snapshot', 'vehicle_no', 'driver_name'],
        detail: ['product_name_snapshot', 'batch_no', 'from_warehouse_name_snapshot', 'to_warehouse_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name_snapshot', 'free_qty', 'cost_rate', 'amount'],
        footer: ['grand_total'] }
];
const PRODUCTION_ORDER_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail production slip, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'output_product_name_snapshot', 'output_qty', 'output_uom_name_snapshot', 'output_warehouse_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'process_name', 'qty', 'uom_name_snapshot', 'cost_rate', 'amount'],
        footer: ['total_raw_material_cost', 'byproducts_summary'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5 shop-floor docket.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'output_product_name_snapshot', 'output_qty'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot'],
        footer: [] },
    { template_name: 'With Alt Unit', description: 'Adds the dual-UOM secondary quantity/unit columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'output_product_name_snapshot', 'output_qty', 'output_uom_name_snapshot', 'output_alt_qty'],
        detail: ['product_name_snapshot', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'cost_rate', 'amount'],
        footer: ['total_raw_material_cost'] },
    { template_name: 'Simple (Shop Floor)', description: 'Qty-only, no costing shown, for the production floor.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'output_product_name_snapshot', 'output_qty', 'output_uom_name_snapshot', 'output_warehouse_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'process_name', 'qty', 'uom_name_snapshot', 'warehouse_name_snapshot'],
        footer: [] },
    { template_name: 'With Byproducts & Terms', description: 'Adds byproducts and any Billing Term breakdown.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'output_product_name_snapshot', 'output_qty', 'output_uom_name_snapshot', 'output_batch_no', 'output_warehouse_name_snapshot', 'source_warehouse_name_snapshot'],
        detail: ['product_name_snapshot', 'batch_no', 'process_name', 'qty', 'uom_name_snapshot', 'warehouse_name_snapshot', 'cost_rate', 'amount'],
        footer: ['total_raw_material_cost', 'total_byproduct_value', 'byproducts_summary', 'product_term_summary'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'output_product_name_snapshot', 'output_qty', 'output_uom_name_snapshot', 'output_alt_qty', 'output_batch_no', 'output_warehouse_name_snapshot', 'source_warehouse_name_snapshot', 'output_unit_cost'],
        detail: ['product_name_snapshot', 'batch_no', 'process_name', 'qty', 'uom_name_snapshot', 'alt_qty', 'alt_unit_name', 'warehouse_name_snapshot', 'cost_rate', 'amount'],
        footer: ['total_raw_material_cost', 'total_byproduct_value', 'byproducts_summary', 'product_term_summary'] }
];
const JOURNAL_VOUCHER_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'narration'],
        detail: ['ledger_name_snapshot', 'debit_amount', 'credit_amount', 'narration'],
        footer: ['total_debit', 'total_credit'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date'],
        detail: ['ledger_name_snapshot', 'debit_amount', 'credit_amount'],
        footer: ['total_debit', 'total_credit'] },
    { template_name: 'With Sub-Ledger & Agent', description: 'Adds sub-ledger and agent columns.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'ref_doc_no', 'narration'],
        detail: ['ledger_name_snapshot', 'sub_ledger_name_snapshot', 'agent_name_snapshot', 'debit_amount', 'credit_amount'],
        footer: ['total_debit', 'total_credit'] },
    { template_name: 'Simple (Minimal)', description: 'Just ledger and amounts.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date'],
        detail: ['ledger_name_snapshot', 'debit_amount', 'credit_amount'],
        footer: ['total_debit', 'total_credit'] },
    { template_name: 'With Line Narration', description: 'Shows each line\u2019s own narration.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'ref_doc_no', 'narration'],
        detail: ['ledger_name_snapshot', 'debit_amount', 'credit_amount', 'narration'],
        footer: ['total_debit', 'total_credit'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every column.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'ref_doc_no', 'narration'],
        detail: ['ledger_name_snapshot', 'sub_ledger_name_snapshot', 'agent_name_snapshot', 'debit_amount', 'credit_amount', 'narration'],
        footer: ['total_debit', 'total_credit'] }
];
const CREDIT_NOTE_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'reason'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount', 'amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'With Reference', description: 'Adds the reference document.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'ref_doc_no', 'reason'],
        detail: ['ledger_name_snapshot', 'amount', 'narration'],
        footer: ['total_amount', 'amount_in_words'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'With Line Narration', description: 'Shows each line\u2019s own narration.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'reason', 'narration'],
        detail: ['ledger_name_snapshot', 'amount', 'narration'],
        footer: ['total_amount', 'amount_in_words'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'ref_doc_no', 'reason', 'narration'],
        detail: ['ledger_name_snapshot', 'amount', 'narration'],
        footer: ['total_amount', 'amount_in_words'] }
];
const DEBIT_NOTE_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'reason'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount', 'amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'With Reference', description: 'Adds the reference document.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'ref_doc_no', 'reason'],
        detail: ['ledger_name_snapshot', 'amount', 'narration'],
        footer: ['total_amount', 'amount_in_words'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'With Line Narration', description: 'Shows each line\u2019s own narration.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'reason', 'narration'],
        detail: ['ledger_name_snapshot', 'amount', 'narration'],
        footer: ['total_amount', 'amount_in_words'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'ref_doc_no', 'reason', 'narration'],
        detail: ['ledger_name_snapshot', 'amount', 'narration'],
        footer: ['total_amount', 'amount_in_words'] }
];
const CASH_BANK_ENTRY_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail receipt/payment voucher, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'entry_type', 'cash_bank_name_snapshot', 'party_name_snapshot', 'amount', 'payment_mode', 'narration'],
        detail: [], footer: ['amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5 receipt slip.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'amount'],
        detail: [], footer: [] },
    { template_name: 'With Reference', description: 'Adds reference number and document.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'entry_type', 'cash_bank_name_snapshot', 'party_name_snapshot', 'amount', 'payment_mode', 'ref_no', 'ref_doc_no'],
        detail: [], footer: ['amount_in_words'] },
    { template_name: 'Simple (Minimal)', description: 'Just party and amount.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'amount'],
        detail: [], footer: [] },
    { template_name: 'With Sub-Ledger', description: 'Adds the party sub-ledger.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'entry_type', 'cash_bank_name_snapshot', 'party_name_snapshot', 'party_sub_ledger_name_snapshot', 'amount', 'payment_mode', 'narration'],
        detail: [], footer: ['amount_in_words'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every field.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'entry_type', 'cash_bank_name_snapshot', 'party_name_snapshot', 'party_sub_ledger_name_snapshot', 'amount', 'payment_mode', 'ref_no', 'ref_doc_no', 'narration'],
        detail: [], footer: ['amount_in_words'] }
];
const PDC_VOUCHER_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail PDC voucher, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'voucher_type', 'party_name_snapshot', 'cheque_no', 'cheque_date', 'bank_name', 'amount', 'narration'],
        detail: [], footer: ['amount_in_words'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'cheque_no', 'amount'],
        detail: [], footer: [] },
    { template_name: 'With Full Bank Details', description: 'Adds branch, account name/no and beneficiary.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'voucher_type', 'party_name_snapshot', 'cheque_no', 'cheque_date', 'bank_name', 'bank_branch', 'bank_account_name', 'bank_account_no', 'beneficiary_name', 'amount'],
        detail: [], footer: ['amount_in_words'] },
    { template_name: 'Simple (Minimal)', description: 'Just party, cheque and amount.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'cheque_no', 'cheque_date', 'amount'],
        detail: [], footer: [] },
    { template_name: 'Receive Register Style', description: 'Emphasises cheque and bank tracking for received PDCs.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'party_name_snapshot', 'cheque_no', 'cheque_date', 'bank_name', 'bank_branch', 'amount', 'narration'],
        detail: [], footer: ['amount_in_words'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4 - room for every field.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'voucher_type', 'party_name_snapshot', 'cheque_no', 'cheque_date', 'bank_name', 'bank_branch', 'bank_account_name', 'bank_account_no', 'beneficiary_name', 'amount', 'narration'],
        detail: [], footer: ['amount_in_words'] }
];
const SALES_ADDITIONAL_ENTRY_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['ledger_name_snapshot', 'description', 'entry_sign', 'amount'],
        footer: ['total_amount'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'With Agent & Rate %', description: 'Adds agent and the rate-percent basis for the line.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot', 'agent_name_snapshot'],
        detail: ['ledger_name_snapshot', 'description', 'entry_sign', 'rate_percent', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'With Narration', description: 'Shows the document-level narration.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot', 'agent_name_snapshot', 'narration'],
        detail: ['ledger_name_snapshot', 'description', 'entry_sign', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'customer_name_snapshot', 'agent_name_snapshot', 'narration'],
        detail: ['ledger_name_snapshot', 'description', 'entry_sign', 'rate_percent', 'amount'],
        footer: ['total_amount'] }
];
const PURCHASE_ADDITIONAL_EXPENSE_RECIPES = [
    { template_name: 'Standard A4', description: 'Full detail, A4 portrait.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'party_bill_no'],
        detail: ['ledger_name_snapshot', 'description', 'allocation_basis', 'entry_sign', 'amount'],
        footer: ['total_amount'], is_default: true },
    { template_name: 'Standard A5', description: 'Compact A5.', paper_size: 'A5', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'With Party Bill Reference', description: 'Emphasises the source party bill.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'party_bill_no', 'party_bill_date'],
        detail: ['ledger_name_snapshot', 'description', 'entry_sign', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'Simple (Minimal)', description: 'Just the essentials.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot'],
        detail: ['ledger_name_snapshot', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'With Allocation Basis & Rate %', description: 'Shows how each line is distributed for landed cost.', paper_size: 'A4', orientation: 'portrait',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'cash_vendor_name', 'party_bill_no'],
        detail: ['ledger_name_snapshot', 'description', 'allocation_basis', 'entry_sign', 'rate_percent', 'amount'],
        footer: ['total_amount'] },
    { template_name: 'Landscape Wide', description: 'Landscape A4.', paper_size: 'A4', orientation: 'landscape',
        header: ['company_name', 'doc_no', 'doc_date', 'vendor_name_snapshot', 'cash_vendor_name', 'party_bill_no', 'party_bill_date', 'narration'],
        detail: ['ledger_name_snapshot', 'description', 'allocation_basis', 'entry_sign', 'rate_percent', 'amount'],
        footer: ['total_amount'] }
];
const RECIPES_BY_DOC_TYPE = {
    sales_bill: SALES_BILL_RECIPES, purchase_bill: PURCHASE_BILL_RECIPES,
    sales_delivery: SALES_DELIVERY_RECIPES, sales_return: SALES_RETURN_RECIPES,
    purchase_grn: PURCHASE_GRN_RECIPES, purchase_return: PURCHASE_RETURN_RECIPES,
    sales_order: SALES_ORDER_RECIPES, sales_quotation: SALES_QUOTATION_RECIPES,
    purchase_order: PURCHASE_ORDER_RECIPES, purchase_quotation: PURCHASE_QUOTATION_RECIPES, purchase_requisition: PURCHASE_REQUISITION_RECIPES,
    sales_nonsaleable_return: SALES_NONSALEABLE_RETURN_RECIPES, purchase_nonsaleable_return: PURCHASE_NONSALEABLE_RETURN_RECIPES, stock_transfer: STOCK_TRANSFER_RECIPES,
    production_order: PRODUCTION_ORDER_RECIPES,
    journal_voucher: JOURNAL_VOUCHER_RECIPES, credit_note: CREDIT_NOTE_RECIPES, debit_note: DEBIT_NOTE_RECIPES,
    cash_bank_entry: CASH_BANK_ENTRY_RECIPES, pdc_voucher: PDC_VOUCHER_RECIPES,
    sales_additional_entry: SALES_ADDITIONAL_ENTRY_RECIPES, purchase_additional_expense: PURCHASE_ADDITIONAL_EXPENSE_RECIPES
};

router.post('/print-templates/seed-defaults', requireAuth, loadUserPermissions, requirePermission('company_settings', 'create'), async (req, res) => {
    try {
        const { document_type } = req.body;
        const recipes = RECIPES_BY_DOC_TYPE[document_type];
        const catalog = FIELD_CATALOGS[document_type];
        if (!recipes || !catalog) return res.status(400).json({ success: false, error: `No default recipes defined yet for "${document_type}"` });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: existing } = await tenantClient.from('print_templates').select('template_name').eq('tenant_id', tenantId).eq('document_type', document_type);
        const existingNames = new Set((existing || []).map(t => t.template_name));

        const created = [];
        for (const recipe of recipes) {
            if (existingNames.has(recipe.template_name)) continue; // safe to re-run
            const layout_json = generateTemplateLayout(recipe, catalog);
            if (recipe.is_default) {
                await tenantClient.from('print_templates').update({ is_default: false }).eq('tenant_id', tenantId).eq('document_type', document_type);
            }
            const { data, error } = await tenantClient
                .from('print_templates')
                .insert({
                    tenant_id: tenantId, document_type, template_name: recipe.template_name, description: recipe.description,
                    paper_size: recipe.paper_size, orientation: recipe.orientation, layout_json,
                    is_default: !!recipe.is_default, created_by: req.auth.userId, updated_by: req.auth.userId
                })
                .select().single();
            if (error) throw error;
            created.push(data);
        }
        res.json({ success: true, message: `${created.length} template(s) created (${recipes.length - created.length} already existed)`, data: created });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/print-templates', requireAuth, loadUserPermissions, requirePermission('company_settings', 'view'), async (req, res) => {
    try {
        const { document_type } = req.query;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient.from('print_templates').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true);
        if (document_type) query = query.eq('document_type', document_type);
        const { data, error } = await query.order('template_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/print-templates/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('print_templates').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(404).json({ success: false, error: 'Template not found' });
    }
});

router.post('/print-templates', requireAuth, loadUserPermissions, requirePermission('company_settings', 'create'), async (req, res) => {
    try {
        const b = req.body;
        if (!b.document_type || !b.template_name) return res.status(400).json({ success: false, error: 'Document Type and Template Name are required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        if (b.is_default) {
            await tenantClient.from('print_templates').update({ is_default: false }).eq('tenant_id', tenantId).eq('document_type', b.document_type);
        }

        const { data, error } = await tenantClient
            .from('print_templates')
            .insert({
                tenant_id: tenantId, document_type: b.document_type, template_name: b.template_name, description: b.description || null,
                paper_size: b.paper_size || 'A4', orientation: b.orientation || 'portrait',
                custom_width_mm: b.custom_width_mm || null, custom_height_mm: b.custom_height_mm || null,
                layout_json: b.layout_json || { header: [], detail: [], footer: [] },
                is_default: !!b.is_default, created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_print_template', 'print_template', data.id, { new_data: data });
        res.json({ success: true, message: 'Template saved', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/print-templates/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const b = req.body;
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('print_templates').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Template not found' });

        if (b.is_default) {
            await tenantClient.from('print_templates').update({ is_default: false }).eq('tenant_id', tenantId).eq('document_type', existing.document_type).neq('id', req.params.id);
        }

        const { data, error } = await tenantClient
            .from('print_templates')
            .update({
                template_name: b.template_name ?? existing.template_name, description: b.description ?? existing.description,
                paper_size: b.paper_size ?? existing.paper_size, orientation: b.orientation ?? existing.orientation,
                custom_width_mm: b.custom_width_mm ?? existing.custom_width_mm, custom_height_mm: b.custom_height_mm ?? existing.custom_height_mm,
                layout_json: b.layout_json ?? existing.layout_json, is_default: b.is_default ?? existing.is_default,
                updated_by: req.auth.userId, updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id).eq('tenant_id', tenantId)
            .select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_print_template', 'print_template', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, message: 'Template updated', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/print-templates/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { error } = await tenantClient.from('print_templates').update({ is_active: false, updated_by: req.auth.userId, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_print_template', 'print_template', req.params.id, {});
        res.json({ success: true, message: 'Template removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: fills a saved layout with one real document's actual data
// - resolves plain field bindings directly, and evaluates "formula"
// blocks with evaluateFormula() against every header/detail field as
// its variables, exactly like a Billing Term formula does.
router.get('/print-templates/:id/render/:documentId', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: template } = await tenantClient.from('print_templates').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!template) return res.status(404).json({ success: false, error: 'Template not found' });

        const config = DOCUMENT_TYPE_CONFIG[template.document_type];
        if (!config) return res.status(400).json({ success: false, error: `Print output not wired yet for "${template.document_type}"` });
        const { data: rawHeader } = await tenantClient.from(config.headerTable).select(config.headerSelect || '*').eq('id', req.params.documentId).eq('tenant_id', tenantId).single();
        if (!rawHeader) return res.status(404).json({ success: false, error: 'Document not found' });
        // Flatten a nested join (e.g. vendor.account_name) into the
        // same flat key the field catalog uses, so callers never need
        // to know whether this document type stores a snapshot column
        // or needed a live join.
        const header = { ...rawHeader };
        // Name priority: the document's own snapshot (name AT the time
        // it was made) -> cash vendor name (cash documents have no
        // ledger, so no snapshot) -> live ledger join (only for rows
        // created before the snapshot column existed).
        if (config.partyNameField && !header[config.partyNameField]) {
            const joined = config.partyNamePath ? config.partyNamePath.split('.').reduce((obj, key) => obj?.[key], rawHeader) : null;
            header[config.partyNameField] = rawHeader.cash_vendor_name || joined || null;
        }
        // FEATURE: flat vouchers (Cash/Bank Entry, PDC) have no line
        // items at all - config.detailTable is simply absent for
        // those, and the detail band is treated as zero rows rather
        // than querying a table that doesn't apply here.
        const { data: rawDetails } = config.detailTable
            ? await tenantClient.from(config.detailTable).select(config.detailSelect || '*').eq(config.fkColumn, req.params.documentId).order('display_order')
            : { data: [] };
        // Flatten a per-line join (e.g. ledger.account_name) into the
        // same flat key the field catalog uses, on every row - the
        // per-line equivalent of the header's partyNamePath handling.
        const details = (rawDetails || []).map(d => {
            if (!config.detailJoinPath) return d;
            const value = config.detailJoinPath.split('.').reduce((obj, key) => obj?.[key], d);
            return { ...d, [config.detailJoinField]: value || null };
        });

        // FEATURE: "individual term ko %, rate, amount, calculation
        // amount sabai chahinxa" - one row per (line x term) actually
        // applied, not just aggregated by term name, so each row shows
        // the term's own %, that line's rate/base amount, and the
        // term's calculated effect on it. Billing Terms exist on
        // several Purchase document types (see document_line_billing_
        // terms' own CHECK constraint) - GRN is one of them, same as
        // Bill.
        const TERM_BASED_DOCUMENT_TYPES = ['purchase_bill', 'purchase_grn', 'purchase_order', 'purchase_quotation', 'purchase_requisition', 'purchase_return', 'production_order'];
        // Most of these detail tables call the per-unit price "rate";
        // production_raw_materials calls it "cost_rate" instead - the
        // select() below must ask for whichever one actually exists,
        // or PostgREST errors on the unknown column.
        const RATE_COLUMN_BY_DOC_TYPE = { production_order: 'cost_rate' };
        let productTermSummaryRows = [];
        if (TERM_BASED_DOCUMENT_TYPES.includes(template.document_type)) {
            const rateColumn = RATE_COLUMN_BY_DOC_TYPE[template.document_type] || 'rate';
            const { data: lineTerms } = await tenantClient
                .from('document_line_billing_terms').select('billing_term_id, computed_amount, detail_id')
                .eq('tenant_id', tenantId).eq('document_type', template.document_type).eq('document_id', req.params.documentId);
            if (lineTerms && lineTerms.length > 0) {
                const termIds = [...new Set(lineTerms.map(t => t.billing_term_id))];
                const detailIds = [...new Set(lineTerms.map(t => t.detail_id))];
                const [{ data: termDefs }, { data: lineRows }] = await Promise.all([
                    tenantClient.from('billing_terms').select('id, term_name, term_code, calculation_mode, rate_percentage').in('id', termIds),
                    tenantClient.from(config.detailTable).select(`id, product_name_snapshot, qty, ${rateColumn}`).in('id', detailIds)
                ]);
                const termById = Object.fromEntries((termDefs || []).map(t => [t.id, t]));
                const lineById = Object.fromEntries((lineRows || []).map(l => [l.id, l]));
                productTermSummaryRows = lineTerms.map(lt => {
                    const term = termById[lt.billing_term_id] || {};
                    const line = lineById[lt.detail_id] || {};
                    const lineRate = Number(line[rateColumn]) || 0;
                    const baseAmount = (Number(line.qty) || 0) * lineRate;
                    return {
                        product_name: line.product_name_snapshot || '—',
                        term_name: term.term_name ? `${term.term_name} (${term.term_code})` : lt.billing_term_id,
                        term_percent: term.calculation_mode === 'percentage' || term.calculation_mode === 'both' ? Number(term.rate_percentage || 0) : null,
                        rate: lineRate,
                        base_amount: baseAmount,
                        calculation_amount: Number(lt.computed_amount || 0)
                    };
                });
            }
        }

        // FEATURE: Byproducts table for Production Order - a SEPARATE
        // table from raw materials (the main "detail" band), surfaced
        // as its own special footer block, same pattern as Product
        // Term Summary.
        let byproductsSummaryRows = [];
        if (template.document_type === 'production_order') {
            const { data: byproducts } = await tenantClient
                .from('production_byproducts').select('product_name_snapshot, batch_no, qty, uom_name_snapshot, recovery_rate, amount')
                .eq('tenant_id', tenantId).eq('production_id', req.params.documentId).order('display_order');
            byproductsSummaryRows = byproducts || [];
        }

        const resolveBlock = (block, rowContext) => {
            if (block.type === 'formula' && block.formula) {
                try {
                    return evaluateFormula(block.formula, { ...header, ...rowContext });
                } catch {
                    return '#ERR';
                }
            }
            if (block.field_key === 'byproducts_summary') return { table: byproductsSummaryRows };
            if (block.field_key === 'product_term_summary') return { table: productTermSummaryRows };
            if (block.field_key) return (rowContext || header)[block.field_key];
            return block.text || '';
        };

        res.json({
            success: true,
            data: {
                template: { paper_size: template.paper_size, orientation: template.orientation, layout: template.layout_json },
                header, details: details || [],
                resolved: {
                    header: (template.layout_json.header || []).map(b => ({ ...b, value: resolveBlock(b, header) })),
                    detail_rows: (details || []).map(d => (template.layout_json.detail || []).map(b => ({ ...b, value: resolveBlock(b, d) }))),
                    footer: (template.layout_json.footer || []).map(b => ({ ...b, value: resolveBlock(b, header) }))
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
