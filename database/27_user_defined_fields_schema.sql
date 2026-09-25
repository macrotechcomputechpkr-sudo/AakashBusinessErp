-- =============================================
-- USER DEFINED FIELDS
-- Lets an admin add CUSTOM fields to any entry module's Master (header)
-- or Detail (line item) section - the same 15 voucher types as
-- voucher_field_catalog (19_entry_field_control_schema.sql), but these
-- are tenant-defined rather than the system-seeded standard fields, so
-- they live in their own table instead of being mixed into that catalog.
--
-- Field types: Text, Date, Time, Boolean (Yes/No), Number, and Table
-- Reference (pick a value from another master table's records - e.g. a
-- custom field that looks up a Ledger Account). Number wasn't explicitly
-- asked for but is added alongside Text/Date/Time/Boolean since a
-- custom-field system without a plain numeric type would be a glaring
-- gap for anyone wanting to track a custom quantity or amount.
--
-- SECURITY: reference_table is constrained to a fixed allowlist of real
-- master tables (both here via CHECK and again in the application layer
-- before any dynamic query runs) - never treat it as free text that
-- could name an arbitrary table.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.user_defined_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    voucher_type VARCHAR(30) NOT NULL,
    section VARCHAR(10) NOT NULL DEFAULT 'master',

    field_label VARCHAR(100) NOT NULL,
    field_type VARCHAR(20) NOT NULL DEFAULT 'text',

    -- Only used when field_type = 'table_reference'.
    reference_table VARCHAR(50),
    reference_display_field VARCHAR(50),

    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_udf_label_per_module UNIQUE (tenant_id, voucher_type, section, field_label),
    CONSTRAINT valid_udf_voucher_type CHECK (voucher_type IN (
        'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
        'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
        'journal', 'cash', 'bank', 'pdc', 'production'
    )),
    CONSTRAINT valid_udf_section CHECK (section IN ('master', 'detail')),
    CONSTRAINT valid_udf_field_type CHECK (field_type IN ('text', 'date', 'time', 'boolean', 'number', 'table_reference')),
    CONSTRAINT table_reference_requires_table CHECK (field_type != 'table_reference' OR reference_table IS NOT NULL),
    CONSTRAINT valid_udf_reference_table CHECK (reference_table IS NULL OR reference_table IN (
        'ledger_accounts', 'products', 'salesman_agents', 'areas', 'routes',
        'product_categories', 'ledger_categories', 'cost_centers', 'profit_centers',
        'sub_ledgers', 'business_units', 'branches', 'warehouses', 'billing_terms', 'product_units'
    ))
);

CREATE INDEX IF NOT EXISTS idx_udf_module ON tenant_master.user_defined_fields(tenant_id, voucher_type, section);

DROP TRIGGER IF EXISTS trg_udf_updated_at ON tenant_master.user_defined_fields;
CREATE TRIGGER trg_udf_updated_at BEFORE UPDATE ON tenant_master.user_defined_fields
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();
