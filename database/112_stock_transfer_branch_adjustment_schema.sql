-- =============================================
-- STOCK TRANSFER (warehouse + branch) / STOCK ADJUSTMENT / STOCK POSTING
--
-- 1. Stock Transfer gets a type:
--      'warehouse' - between warehouses (of one branch or none)
--      'branch'    - from one branch to another; each side picks one of
--                    that branch's warehouses (branch_warehouse_mapping),
--                    so a branch with several warehouses is supported.
--    A branch transfer can be two-step (System Control): Post = dispatch
--    (stock leaves the source warehouse, goods are In Transit), Receive =
--    stock arrives in the destination warehouse on the receiving date.
--
-- 2. Stock Adjustment - shortage / damage / expiry / excess / physical
--    count corrections, per warehouse and batch.
--
-- 3. Optional GL posting for both, with ledgers mapped in System Control
--    (defaults), on each branch / warehouse (its own stock account), and
--    shown on the entry where the user may change them.
--
-- ACCOUNTING (why these entries are right for this ERP):
--   Stock is valued PERIODICALLY by utils/stockEngine.js from
--   stock_movements, and the statements (utils/financialEngine.js) show
--   that valued stock, replacing the GL balance of Inventory-group
--   ledgers:  COGS = Opening + Purchases + Inventory-GL movement - Closing.
--   So a ledger in the INVENTORY group or a PURCHASE (trading expense)
--   group is "stock-neutral": posting to it changes COGS by exactly the
--   amount the stock movement already changed it.
--   * Transfer: company stock is unchanged, so both sides must be
--     stock-neutral ledgers - Dr receiving (branch/warehouse stock or
--     Transfer In), Cr sending (Transfer Out); via Goods-in-Transit when
--     two-step. Net effect on profit and Balance Sheet: nil, as it must be.
--   * Shortage / damage: the stock movement already lowered closing stock
--     (so COGS rose); Dr Stock Loss/Damage (expense) Cr Stock Adjustment
--     (stock-neutral) moves that cost out of COGS into its own line.
--     Excess: Dr Stock Adjustment Cr Stock Gain (income) - the reverse.
--     Net profit is the same with or without the entry; only presentation
--     (abnormal loss shown separately, NFRS / IAS 2.16) changes.
-- =============================================

-- ---------- per branch / warehouse stock account ----------
ALTER TABLE tenant_master.branches   ADD COLUMN IF NOT EXISTS stock_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);
ALTER TABLE tenant_master.warehouses ADD COLUMN IF NOT EXISTS stock_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id);

-- ---------- System Control ----------
ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS stock_transfer_gl_posting VARCHAR(20) DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS branch_transfer_receipt VARCHAR(20) DEFAULT 'direct',
    ADD COLUMN IF NOT EXISTS stock_transfer_in_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS stock_transfer_out_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS stock_adjustment_gl_posting BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS stock_adjustment_contra_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS stock_shortage_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS stock_damage_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS stock_excess_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS stock_posting_allow_ledger_change BOOLEAN DEFAULT TRUE;
ALTER TABLE tenant_master.system_control_settings DROP CONSTRAINT IF EXISTS valid_stock_transfer_gl_posting;
ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_stock_transfer_gl_posting CHECK (stock_transfer_gl_posting IN ('none', 'branch_only', 'all'));
ALTER TABLE tenant_master.system_control_settings DROP CONSTRAINT IF EXISTS valid_branch_transfer_receipt;
ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_branch_transfer_receipt CHECK (branch_transfer_receipt IN ('direct', 'in_transit'));

-- ---------- Stock Transfer ----------
ALTER TABLE tenant_master.stock_transfers
    ADD COLUMN IF NOT EXISTS transfer_type VARCHAR(20) NOT NULL DEFAULT 'warehouse',
    ADD COLUMN IF NOT EXISTS from_branch_id UUID REFERENCES tenant_master.branches(id),
    ADD COLUMN IF NOT EXISTS from_branch_name_snapshot VARCHAR(150),
    ADD COLUMN IF NOT EXISTS requires_receipt BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS received_date DATE,
    ADD COLUMN IF NOT EXISTS received_by UUID,
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS receive_remarks TEXT,
    ADD COLUMN IF NOT EXISTS dr_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS cr_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS transit_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    ADD COLUMN IF NOT EXISTS gl_posted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant_master.stock_transfers DROP CONSTRAINT IF EXISTS valid_transfer_type;
ALTER TABLE tenant_master.stock_transfers ADD CONSTRAINT valid_transfer_type CHECK (transfer_type IN ('warehouse', 'branch'));
ALTER TABLE tenant_master.stock_transfers DROP CONSTRAINT IF EXISTS branch_transfer_needs_branches;
ALTER TABLE tenant_master.stock_transfers ADD CONSTRAINT branch_transfer_needs_branches CHECK (
    transfer_type <> 'branch' OR status = 'draft' OR (from_branch_id IS NOT NULL AND to_branch_id IS NOT NULL AND from_branch_id <> to_branch_id));
ALTER TABLE tenant_master.stock_transfers DROP CONSTRAINT IF EXISTS receipt_only_when_required;
ALTER TABLE tenant_master.stock_transfers ADD CONSTRAINT receipt_only_when_required CHECK (received_date IS NULL OR requires_receipt);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_type ON tenant_master.stock_transfers(tenant_id, transfer_type);

INSERT INTO tenant_master.voucher_field_catalog (voucher_type, section, field_key, field_label, field_data_type, is_system_required, display_order) VALUES
('stock_transfer', 'master', 'from_branch_id', 'From Branch', 'picker', FALSE, 15)
ON CONFLICT (voucher_type, section, field_key) DO NOTHING;

-- ---------- Stock Adjustment ----------
CREATE TABLE IF NOT EXISTS tenant_master.stock_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID REFERENCES tenant_master.branches(id),
    branch_name_snapshot VARCHAR(150),

    doc_no VARCHAR(20) NOT NULL,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fiscal_year_id UUID REFERENCES tenant_master.fiscal_years(id),

    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    warehouse_name_snapshot VARCHAR(200),
    reason VARCHAR(20) NOT NULL DEFAULT 'physical_count',
    narration TEXT,
    cost_center_id UUID REFERENCES tenant_master.cost_centers(id),

    -- accounts used when GL posting is on (defaults from System Control)
    loss_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    gain_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    contra_ledger_id UUID REFERENCES tenant_master.ledger_accounts(id),
    gl_posted BOOLEAN NOT NULL DEFAULT FALSE,

    total_in_amount DECIMAL(15, 2) DEFAULT 0,
    total_out_amount DECIMAL(15, 2) DEFAULT 0,

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    approved_by UUID, approved_at TIMESTAMPTZ,
    posted_by UUID, posted_at TIMESTAMPTZ,
    cancellation_reason TEXT, cancelled_at TIMESTAMPTZ, cancelled_by UUID,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    CONSTRAINT unique_stock_adjustment_doc_no UNIQUE (tenant_id, doc_no),
    CONSTRAINT valid_adjustment_reason CHECK (reason IN ('physical_count', 'shortage', 'damage', 'expiry', 'excess', 'other')),
    CONSTRAINT valid_adjustment_status CHECK (status IN ('draft', 'approved', 'posted', 'cancelled')),
    CONSTRAINT adjustment_cancellation_requires_reason CHECK (status <> 'cancelled' OR cancellation_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tenant_master.stock_adjustment_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    adjustment_id UUID NOT NULL REFERENCES tenant_master.stock_adjustments(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 1,

    product_id UUID NOT NULL REFERENCES tenant_master.products(id),
    warehouse_id UUID REFERENCES tenant_master.warehouses(id),
    batch_no VARCHAR(50),
    mfg_date DATE,
    exp_date DATE,

    direction VARCHAR(3) NOT NULL,            -- 'in' (excess) / 'out' (shortage, damage ...)
    uom_id UUID REFERENCES tenant_master.product_units(id),
    system_qty DECIMAL(15, 4),                -- book qty when counted (information)
    physical_qty DECIMAL(15, 4),              -- counted qty (physical count lines)
    qty DECIMAL(15, 4) NOT NULL,              -- adjusted qty in uom_id
    rate DECIMAL(15, 4) NOT NULL DEFAULT 0,   -- cost per uom_id
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    line_reason VARCHAR(20),
    narration TEXT,

    product_name_snapshot VARCHAR(200),
    uom_name_snapshot VARCHAR(50),
    warehouse_name_snapshot VARCHAR(200),

    CONSTRAINT valid_adjustment_direction CHECK (direction IN ('in', 'out')),
    CONSTRAINT positive_adjustment_qty CHECK (qty > 0),
    CONSTRAINT valid_adjustment_line_reason CHECK (line_reason IS NULL OR line_reason IN ('physical_count', 'shortage', 'damage', 'expiry', 'excess', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustment_details_adj ON tenant_master.stock_adjustment_details(adjustment_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_details_product ON tenant_master.stock_adjustment_details(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_date ON tenant_master.stock_adjustments(tenant_id, doc_date);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_status ON tenant_master.stock_adjustments(tenant_id, status);

DROP TRIGGER IF EXISTS trg_stock_adjustments_updated_at ON tenant_master.stock_adjustments;
CREATE TRIGGER trg_stock_adjustments_updated_at BEFORE UPDATE ON tenant_master.stock_adjustments
    FOR EACH ROW EXECUTE FUNCTION tenant_master.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS tenant_master.seq_stock_adjustment_code;

-- ---------- Document history ----------
-- FIX: valid_audit_document_type (file 38) only listed the purchase
-- documents, so every Stock Transfer (and sales, JV ...) history insert was
-- rejected and only logged to the server console - the History button
-- always showed nothing. Any document type may now record history, and
-- actions beyond the first four (e.g. 'received') are allowed.
ALTER TABLE tenant_master.document_audit_trail DROP CONSTRAINT IF EXISTS valid_audit_document_type;
ALTER TABLE tenant_master.document_audit_trail DROP CONSTRAINT IF EXISTS valid_audit_action;
