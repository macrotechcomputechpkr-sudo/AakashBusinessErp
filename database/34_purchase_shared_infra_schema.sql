-- =============================================
-- PURCHASE TRANSACTION CHAIN - SHARED INFRASTRUCTURE
-- Requisition -> Quotation -> Order -> GRN -> Bill, plus Additional
-- Expense, Return, Non-Salable Return, and Order Cancellation.
--
-- Design decisions:
--  - Each document type gets its OWN Master + Details table pair (not
--    one polymorphic mega-table) - matches how Tally/Busy/NAV/Zoho all
--    actually model this, since each stage has different lifecycle
--    rules and a different set of "pulled from" source documents.
--  - "Pull forward" (Requisition -> Quotation both feed Order; Req+Quo+
--    Order all feed GRN) is modeled as explicit source_*_detail_id
--    columns directly on the consuming detail row, not a generic link
--    table - simplest to query "how much of this PO line has been
--    received" or "which requisition line is this quotation line for".
--  - document_attachments is genuinely polymorphic (one shared table for
--    every document type) since attachments have identical shape
--    everywhere and no other table needs to know about them.
--  - document_billing_terms records which Billing Term(s)
--    (16_billing_terms_v2_schema.sql) were actually applied to a
--    document and the computed amount - the "bill term table" - shared
--    across every document type the same way attachments are.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.document_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    document_type VARCHAR(30) NOT NULL,
    document_id UUID NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by UUID,

    CONSTRAINT valid_attachment_document_type CHECK (document_type IN (
        'purchase_requisition', 'purchase_quotation', 'purchase_order', 'purchase_grn',
        'purchase_bill', 'purchase_additional_expense', 'purchase_return', 'purchase_nonsalable_return'
    ))
);
CREATE INDEX IF NOT EXISTS idx_attachments_document ON tenant_master.document_attachments(document_type, document_id);

CREATE TABLE IF NOT EXISTS tenant_master.document_billing_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    document_type VARCHAR(30) NOT NULL,
    document_id UUID NOT NULL,
    billing_term_id UUID NOT NULL REFERENCES tenant_master.billing_terms(id),
    computed_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    display_order INTEGER DEFAULT 1,

    CONSTRAINT valid_billing_term_document_type CHECK (document_type IN (
        'purchase_requisition', 'purchase_quotation', 'purchase_order', 'purchase_grn',
        'purchase_bill', 'purchase_additional_expense', 'purchase_return', 'purchase_nonsalable_return'
    ))
);
CREATE INDEX IF NOT EXISTS idx_doc_billing_terms_document ON tenant_master.document_billing_terms(document_type, document_id);

-- One numbering sequence per document type, all through the same
-- generic next_master_code(seq_name, type_prefix) built for masters
-- (32_code_12char_format_schema.sql) - reused here so every purchase
-- document also gets a consistent 12-character code.
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_requisition_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_quotation_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_order_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_grn_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_bill_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_additional_expense_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_return_code;
CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_purchase_nonsalable_return_code;
