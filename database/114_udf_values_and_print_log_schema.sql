-- =============================================
-- USER DEFINED FIELD VALUES
-- user_defined_fields (27) holds only the DEFINITIONS; this is where the
-- value typed against a document (section 'master') or against one line of
-- it (section 'detail', line_id = that detail row's id) is kept, so every
-- report can show / group by it. display_value is what reports print: the
-- text itself, Yes / No, or - for a Table Reference - the referenced
-- record's name at the time it was picked.
--
-- Also: the UDF voucher list gains the document types added since 38, and
-- document_print_log records each print from Manual Document Printing
-- (so the list can show whether / how often a document was printed).
-- =============================================
CREATE TABLE IF NOT EXISTS tenant_master.document_udf_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    document_type VARCHAR(40) NOT NULL,          -- sales_bill, purchase_bill, production_order ...
    document_id UUID NOT NULL,
    line_id UUID,                                -- NULL = master (header) value
    field_id UUID NOT NULL REFERENCES tenant_master.user_defined_fields(id) ON DELETE CASCADE,
    value_text TEXT,
    value_number DECIMAL(18, 4),
    value_date DATE,
    value_bool BOOLEAN,
    value_ref_id UUID,
    display_value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_document_udf_value ON tenant_master.document_udf_values
    (tenant_id, field_id, document_id, COALESCE(line_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_document_udf_values_doc ON tenant_master.document_udf_values(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_document_udf_values_field ON tenant_master.document_udf_values(tenant_id, field_id);

ALTER TABLE tenant_master.user_defined_fields
    DROP CONSTRAINT IF EXISTS valid_udf_voucher_type;
ALTER TABLE tenant_master.user_defined_fields
    ADD CONSTRAINT valid_udf_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production',
        'purchase_requisition', 'purchase_quotation',
        'sales_quotation', 'sales_nonsalable_return', 'purchase_nonsalable_return',
        'stock_transfer', 'debit_note', 'credit_note'
    ));

CREATE TABLE IF NOT EXISTS tenant_master.document_print_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    document_type VARCHAR(40) NOT NULL,
    document_id UUID NOT NULL,
    template_id UUID,
    printed_at TIMESTAMPTZ DEFAULT NOW(),
    printed_by UUID
);
CREATE INDEX IF NOT EXISTS idx_document_print_log_doc ON tenant_master.document_print_log(tenant_id, document_id);
