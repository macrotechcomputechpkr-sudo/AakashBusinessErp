-- =============================================
-- 119: Batch / serial costing method, serial numbers on stock movements,
-- and messaging (Email / SMS / WhatsApp / Viber).
--
-- 1. COSTING OF BATCH / SERIAL PRODUCTS (System Control)
--    batch_costing_method / serial_costing_method:
--      same             use the valuation method chosen on the report /
--                       statement (as before)
--      fifo, lifo, moving_average, weighted_average
--      batch_wise       specific identification - each batch keeps its own
--                       purchase cost and a sale of that batch takes it
--      serial_wise      the same per serial number
--    stock_movements.serial_no (and the purchase detail tables) carry the
--    serial numbers so serial-wise costing can match a sale to its purchase.
--
-- 2. MESSAGING
--    message_settings    SMTP, SMS gateway (Sparrow / Aakash / custom HTTP),
--                        WhatsApp (click-to-chat link or Cloud API), Viber link
--    message_templates   text per channel + event with {{placeholders}}
--    message_auto_rules  send automatically when an event happens
--    message_log         every message: sent / failed / link waiting to open
-- =============================================

-- ---------- 1. costing ----------
ALTER TABLE tenant_master.system_control_settings
    ADD COLUMN IF NOT EXISTS batch_costing_method VARCHAR(20) DEFAULT 'same',
    ADD COLUMN IF NOT EXISTS serial_costing_method VARCHAR(20) DEFAULT 'same';
ALTER TABLE tenant_master.system_control_settings DROP CONSTRAINT IF EXISTS valid_batch_costing_method;
ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_batch_costing_method
    CHECK (batch_costing_method IN ('same', 'fifo', 'lifo', 'moving_average', 'weighted_average', 'batch_wise'));
ALTER TABLE tenant_master.system_control_settings DROP CONSTRAINT IF EXISTS valid_serial_costing_method;
ALTER TABLE tenant_master.system_control_settings ADD CONSTRAINT valid_serial_costing_method
    CHECK (serial_costing_method IN ('same', 'fifo', 'lifo', 'moving_average', 'weighted_average', 'serial_wise'));

ALTER TABLE tenant_master.stock_movements ADD COLUMN IF NOT EXISTS serial_no TEXT;
ALTER TABLE tenant_master.purchase_grn_details ADD COLUMN IF NOT EXISTS serial_no TEXT;
ALTER TABLE tenant_master.purchase_bill_details ADD COLUMN IF NOT EXISTS serial_no TEXT;
ALTER TABLE tenant_master.purchase_return_details ADD COLUMN IF NOT EXISTS serial_no TEXT;
CREATE INDEX IF NOT EXISTS idx_stock_movements_serial ON tenant_master.stock_movements(product_id, serial_no) WHERE serial_no IS NOT NULL;

-- back-fill serials of earlier sales-side movements from their document lines
UPDATE tenant_master.stock_movements m SET serial_no = d.serial_no
  FROM tenant_master.sales_bill_details d
 WHERE m.source_type = 'sales_bill' AND m.source_detail_id = d.id AND m.serial_no IS NULL AND d.serial_no IS NOT NULL;
UPDATE tenant_master.stock_movements m SET serial_no = d.serial_no
  FROM tenant_master.sales_delivery_details d
 WHERE m.source_type = 'sales_delivery' AND m.source_detail_id = d.id AND m.serial_no IS NULL AND d.serial_no IS NOT NULL;
UPDATE tenant_master.stock_movements m SET serial_no = d.serial_no
  FROM tenant_master.sales_return_details d
 WHERE m.source_type = 'sales_return' AND m.source_detail_id = d.id AND m.serial_no IS NULL AND d.serial_no IS NOT NULL;

-- ---------- 2. messaging ----------
CREATE TABLE IF NOT EXISTS tenant_master.message_settings (
    tenant_id UUID PRIMARY KEY,
    smtp_host VARCHAR(150),
    smtp_port INTEGER DEFAULT 587,
    smtp_secure BOOLEAN DEFAULT FALSE,
    smtp_user VARCHAR(150),
    smtp_password VARCHAR(200),
    from_email VARCHAR(150),
    from_name VARCHAR(150),
    sms_gateway VARCHAR(20) DEFAULT 'none',
    sms_token VARCHAR(300),
    sms_sender VARCHAR(50),
    sms_custom_url TEXT,
    whatsapp_mode VARCHAR(20) DEFAULT 'link',
    whatsapp_token TEXT,
    whatsapp_phone_id VARCHAR(60),
    viber_mode VARCHAR(20) DEFAULT 'link',
    default_country_code VARCHAR(5) DEFAULT '977',
    reminder_min_balance DECIMAL(15, 2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID,
    CONSTRAINT valid_sms_gateway CHECK (sms_gateway IN ('none', 'sparrow', 'aakash', 'custom')),
    CONSTRAINT valid_whatsapp_mode CHECK (whatsapp_mode IN ('link', 'cloud_api'))
);

CREATE TABLE IF NOT EXISTS tenant_master.message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    channel VARCHAR(10) NOT NULL,
    event VARCHAR(40) NOT NULL,
    name VARCHAR(120) NOT NULL,
    subject VARCHAR(250),
    body TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT valid_message_channel CHECK (channel IN ('email', 'sms', 'whatsapp', 'viber'))
);
CREATE INDEX IF NOT EXISTS idx_message_templates_event ON tenant_master.message_templates(tenant_id, event, channel);

CREATE TABLE IF NOT EXISTS tenant_master.message_auto_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    event VARCHAR(40) NOT NULL,
    channel VARCHAR(10) NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    template_id UUID REFERENCES tenant_master.message_templates(id) ON DELETE SET NULL,
    CONSTRAINT unique_message_rule UNIQUE (tenant_id, event, channel)
);

CREATE TABLE IF NOT EXISTS tenant_master.message_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    channel VARCHAR(10) NOT NULL,
    event VARCHAR(40),
    document_type VARCHAR(30),
    document_id UUID,
    party_ledger_id UUID,
    recipient VARCHAR(200),
    subject VARCHAR(250),
    body TEXT,
    template_id UUID,
    status VARCHAR(10) NOT NULL,              -- sent | failed | link (WhatsApp / Viber link waiting to be opened)
    error TEXT,
    provider_response TEXT,
    link TEXT,
    is_auto BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT valid_message_status CHECK (status IN ('sent', 'failed', 'link'))
);
CREATE INDEX IF NOT EXISTS idx_message_log_doc ON tenant_master.message_log(tenant_id, document_id, event, channel);
CREATE INDEX IF NOT EXISTS idx_message_log_created ON tenant_master.message_log(tenant_id, created_at);
