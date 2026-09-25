-- =============================================
-- SYSTEM CONTROL SETTINGS
-- One row per tenant - a comprehensive company configuration screen,
-- modeled on Tally's F11 (Company Features) / F12 (Configure) and
-- FACT's Nepal-specific VAT/Annexure-10 features, per the user's own
-- 70+ item list plus a handful of well-established additions researched
-- from Tally and FACT (each commented below with why it was added).
--
-- Columns are grouped to match the frontend's tabs exactly:
--   1. Regional & Number Format
--   2. Ledger Mapping
--   3. Inventory & UOM
--   4. Billing Behavior
--   5. Warnings & Confirmations
--   6. Multi-Currency & Misc
--   7. Captions (renameable labels)
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.system_control_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE,

    -- ========== 1. REGIONAL & NUMBER FORMAT ==========
    date_format_entry VARCHAR(20) DEFAULT 'nepali',
    date_format_reports VARCHAR(20) DEFAULT 'nepali',
    -- FEATURE (Tally-inspired): the overall calendar system, distinct
    -- from the per-screen entry/report display choices above.
    date_type VARCHAR(20) DEFAULT 'dual',
    number_format_qty VARCHAR(10) DEFAULT '0.00',
    number_format_rate VARCHAR(10) DEFAULT '0.00',
    number_format_alt_qty VARCHAR(10) DEFAULT '0.00',
    number_format_alt1_qty VARCHAR(10) DEFAULT '0.00',
    -- FEATURE: the user's later "Digit Types" line named Rate/Qty again
    -- plus Amount, which wasn't covered above - added for completeness.
    number_format_amount VARCHAR(10) DEFAULT '0.00',
    word_case_master VARCHAR(20) DEFAULT 'proper',
    number_in_words_format VARCHAR(10) DEFAULT 'lakhs',

    -- ========== 2. LEDGER MAPPING ==========
    sales_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    sales_return_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    sales_brokerage_exp_return_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    purchase_same_as_sales BOOLEAN DEFAULT TRUE,
    purchase_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    purchase_return_account_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    opening_stock_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    closing_stock_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    wip_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    goods_transit_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    inter_branch_transaction_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    vat_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    tds_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    excise_duty_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    default_cash_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    default_bank_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),

    -- ========== 3. INVENTORY & UOM ==========
    dual_uom_enabled BOOLEAN DEFAULT FALSE,
    dual_uom_mode VARCHAR(20) DEFAULT 'auto_convert',
    free_qty_system BOOLEAN DEFAULT FALSE,
    batch_system VARCHAR(20) DEFAULT 'none',
    batch_label VARCHAR(50) DEFAULT 'Batch',
    multiple_batch_auto_generate BOOLEAN DEFAULT FALSE,
    enable_vehicle_options BOOLEAN DEFAULT FALSE,
    vehicle_label VARCHAR(50) DEFAULT 'Vehicle',
    enable_barcode_system BOOLEAN DEFAULT FALSE,
    enable_barcode_print BOOLEAN DEFAULT FALSE,
    fifo_adjustment_unit_wise BOOLEAN DEFAULT FALSE,
    enable_exp_date BOOLEAN DEFAULT FALSE,
    enable_mfg_date BOOLEAN DEFAULT FALSE,
    enable_serial_number BOOLEAN DEFAULT FALSE,
    serial_number_label VARCHAR(50) DEFAULT 'Serial Number',
    update_last_sales_rate_from_bill BOOLEAN DEFAULT FALSE,
    -- FEATURE: Tally-inspired - "Reorder Levels and Reorder Quantity" and
    -- "Actual and Billed Quantities" are both standard F11 Inventory
    -- Features not in the original list.
    reorder_level_tracking BOOLEAN DEFAULT FALSE,
    actual_vs_billed_qty BOOLEAN DEFAULT FALSE,

    -- ========== 4. BILLING BEHAVIOR ==========
    sales_bill_type VARCHAR(10) DEFAULT 'credit',
    purchase_bill_type VARCHAR(10) DEFAULT 'credit',
    goods_delivery_note_required BOOLEAN DEFAULT FALSE,
    cash_down_on_credit_bill BOOLEAN DEFAULT FALSE,
    multiple_payment_method_billing BOOLEAN DEFAULT FALSE,
    auto_billing_rate_type VARCHAR(10) DEFAULT 'sr1',
    amount_wise_qty_change VARCHAR(20) DEFAULT 'both',
    -- Multi-select stored as a text array - Postgres native array, no
    -- junction table needed for a small fixed option-set like this.
    popup_product_wise_term_applicability TEXT[] DEFAULT ARRAY['sales', 'purchase']::TEXT[],
    sub_ledger_popup_mode VARCHAR(10) DEFAULT 'single',
    popup_listing_enabled BOOLEAN DEFAULT TRUE,
    show_cash_transactions_in_party_ledger BOOLEAN DEFAULT TRUE,
    -- FEATURE: Tally-inspired - "Maintain balances bill-by-bill" is the
    -- foundational feature behind invoice-wise AR/AP tracking, not
    -- present in the original list but essential once the Sales/
    -- Purchase transaction module gets built.
    bill_wise_tracking BOOLEAN DEFAULT TRUE,

    -- ========== 5. WARNINGS & CONFIRMATIONS ==========
    msg_confirm_new_entry BOOLEAN DEFAULT TRUE,
    msg_confirm_modify BOOLEAN DEFAULT TRUE,
    msg_confirm_remove BOOLEAN DEFAULT TRUE,
    cash_negative_balance VARCHAR(10) DEFAULT 'warn',
    bank_negative_balance VARCHAR(10) DEFAULT 'warn',
    rate_fluctuation_warning VARCHAR(10) DEFAULT 'none',
    rate_fluctuation_warning_percentage DECIMAL(5, 2) DEFAULT 0,
    lc_bg_amount_warning_sales BOOLEAN DEFAULT FALSE,
    lc_bg_amount_warning_purchase BOOLEAN DEFAULT FALSE,
    update_rate_from_purchase VARCHAR(10) DEFAULT 'popup',

    -- ========== 6. MULTI-CURRENCY & MISC ==========
    multi_currency_system BOOLEAN DEFAULT FALSE,
    default_currency_symbol VARCHAR(10) DEFAULT 'Rs.',
    default_currency_code VARCHAR(10) DEFAULT 'NPR',
    default_currency_desc VARCHAR(50) DEFAULT 'Nepalese Rupee',
    default_currency_low_unit VARCHAR(20) DEFAULT 'Paisa',
    allow_duplicate_master_name BOOLEAN DEFAULT FALSE,
    user_defined_field_enabled BOOLEAN DEFAULT FALSE,
    company_wise_entry_purchase VARCHAR(20) DEFAULT 'enable_only',
    -- FEATURE: whether master data (starting with Product Group) can be
    -- tagged/scoped to a specific Branch at all - the master switch that
    -- gates the Product Group's own Branch-wise fields below, same
    -- pattern as Batch/Vehicle/Serial/Barcode-Print gating.
    enable_branch_wise_master BOOLEAN DEFAULT FALSE,
    -- FEATURE: FACT-inspired - Nepal VAT Annexure-10 is FACT's flagship
    -- Nepal-specific compliance report, not in the original list.
    nepal_vat_annexure10_enabled BOOLEAN DEFAULT TRUE,

    -- ========== 7. CAPTIONS (renameable labels, same pattern as the
    -- Ledger Category feature label) ==========
    caption_agent VARCHAR(50) DEFAULT 'Agent',
    caption_sub_ledger VARCHAR(50) DEFAULT 'Sub Ledger',
    caption_area VARCHAR(50) DEFAULT 'Area',
    caption_batch_lot VARCHAR(50) DEFAULT 'Batch/Lot',

    -- FEATURE: genuine gaps found comparing against two other ERPs'
    -- system-control tables - near-expiry alerting (had an expiry DATE
    -- toggle but no THRESHOLD), preventing a bill-wise-settled document
    -- from being silently cancelled, negative-stock control on outward
    -- movement, and back/post-date entry warnings.
    near_expiry_alert_days INTEGER DEFAULT 30,
    block_cancel_if_settled BOOLEAN DEFAULT TRUE,
    negative_stock_control VARCHAR(10) DEFAULT 'warn',
    backdate_entry_control VARCHAR(10) DEFAULT 'none',
    postdate_entry_control VARCHAR(10) DEFAULT 'none',
    default_vat_percent DECIMAL(5, 2) DEFAULT 13,
    default_tds_percent DECIMAL(5, 2) DEFAULT 1.5,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID,

    CONSTRAINT valid_date_format_entry CHECK (date_format_entry IN ('english', 'nepali', 'dual')),
    CONSTRAINT valid_date_format_reports CHECK (date_format_reports IN ('english', 'nepali', 'dual')),
    CONSTRAINT valid_date_type CHECK (date_type IN ('dual', 'nepali')),
    CONSTRAINT valid_number_format_qty CHECK (number_format_qty IN ('0', '0.00', '0.000', '0.0000')),
    CONSTRAINT valid_number_format_rate CHECK (number_format_rate IN ('0', '0.00', '0.000', '0.0000')),
    CONSTRAINT valid_number_format_alt_qty CHECK (number_format_alt_qty IN ('0', '0.00', '0.000', '0.0000')),
    CONSTRAINT valid_number_format_alt1_qty CHECK (number_format_alt1_qty IN ('0', '0.00', '0.000', '0.0000')),
    CONSTRAINT valid_number_format_amount CHECK (number_format_amount IN ('0', '0.00', '0.000', '0.0000')),
    CONSTRAINT valid_word_case_master CHECK (word_case_master IN ('upper', 'lower', 'proper', 'user_entered')),
    CONSTRAINT valid_number_in_words CHECK (number_in_words_format IN ('lakhs', 'million')),
    CONSTRAINT valid_dual_uom_mode CHECK (dual_uom_mode IN ('auto_convert', 'fixed')),
    CONSTRAINT valid_batch_system CHECK (batch_system IN ('none', 'retail', 'medicine', 'other')),
    CONSTRAINT valid_sales_bill_type CHECK (sales_bill_type IN ('cash', 'credit')),
    CONSTRAINT valid_purchase_bill_type CHECK (purchase_bill_type IN ('cash', 'credit')),
    CONSTRAINT valid_auto_billing_rate_type CHECK (auto_billing_rate_type IN ('sr1', 'sr2', 'mrp')),
    CONSTRAINT valid_amount_wise_qty_change CHECK (amount_wise_qty_change IN ('sales_only', 'purchase_only', 'both')),
    CONSTRAINT valid_sub_ledger_popup_mode CHECK (sub_ledger_popup_mode IN ('single', 'multiple')),
    CONSTRAINT valid_cash_negative CHECK (cash_negative_balance IN ('warn', 'none', 'block')),
    CONSTRAINT valid_bank_negative CHECK (bank_negative_balance IN ('warn', 'none', 'block')),
    CONSTRAINT valid_rate_fluctuation_warning CHECK (rate_fluctuation_warning IN ('none', 'sales', 'purchase', 'both')),
    CONSTRAINT valid_update_rate_from_purchase CHECK (update_rate_from_purchase IN ('buy_only', 'popup')),
    CONSTRAINT valid_company_wise_entry_purchase CHECK (company_wise_entry_purchase IN ('compulsory', 'enable_only')),
    CONSTRAINT valid_popup_term_applicability CHECK (
        popup_product_wise_term_applicability <@ ARRAY['sales', 'purchase', 'sales_return', 'purchase_return']::TEXT[]
    ),
    CONSTRAINT valid_negative_stock_control CHECK (negative_stock_control IN ('none', 'warn', 'block')),
    CONSTRAINT valid_backdate_entry_control CHECK (backdate_entry_control IN ('none', 'warn', 'block')),
    CONSTRAINT valid_postdate_entry_control CHECK (postdate_entry_control IN ('none', 'warn', 'block'))
);

DROP TRIGGER IF EXISTS trg_system_control_updated_at ON tenant_master.system_control_settings;
CREATE TRIGGER trg_system_control_updated_at BEFORE UPDATE ON tenant_master.system_control_settings
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

-- One row per tenant, created automatically the first time a company is
-- set up - mirrors how company_profile itself gets seeded on signup.
CREATE OR REPLACE FUNCTION tenant_master.ensure_system_control_settings(p_tenant_id UUID)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
    SELECT id INTO v_id FROM tenant_master.system_control_settings WHERE tenant_id = p_tenant_id;
    IF v_id IS NULL THEN
        INSERT INTO tenant_master.system_control_settings (tenant_id) VALUES (p_tenant_id) RETURNING id INTO v_id;
    END IF;
    RETURN v_id;
END; $$ LANGUAGE plpgsql;
