-- =============================================
-- LINE-LEVEL BILLING TERMS ("Product Term")
-- Own concept, informed by the general idea of per-line term
-- application seen in commercial ERP reference material (not copied
-- verbatim) - each Detail line can have its own selection of Billing
-- Terms, computed against THAT line's own Basic Value/Qty (not the
-- whole document total). The document-level Summary aggregates these
-- by term code; editing the Summary redistributes proportionally back
-- down to the lines it came from.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.document_line_billing_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    document_type VARCHAR(30) NOT NULL,
    document_id UUID NOT NULL,
    detail_id UUID NOT NULL,
    billing_term_id UUID NOT NULL REFERENCES tenant_master.billing_terms(id),

    computed_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    -- FEATURE: "if changed in Summary, redistribute proportionally to
    -- product level" - this line's SHARE of the document-level total for
    -- this term is preserved even after a Summary-level manual edit, by
    -- recording whether this row's amount came from the formula or from
    -- a proportional redistribution after a Summary override.
    is_summary_overridden BOOLEAN DEFAULT FALSE,

    CONSTRAINT valid_line_billing_document_type CHECK (document_type IN (
        'purchase_requisition', 'purchase_quotation', 'purchase_order', 'purchase_grn',
        'purchase_bill', 'purchase_additional_expense', 'purchase_return', 'purchase_nonsalable_return'
    ))
);

CREATE INDEX IF NOT EXISTS idx_line_billing_terms_document ON tenant_master.document_line_billing_terms(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_line_billing_terms_detail ON tenant_master.document_line_billing_terms(detail_id);
