-- =============================================
-- 123: Darta / Chalani register, Task management, Notifications
--
-- darta_chalani  - incoming (darta) and outgoing (chalani) letters /
--                  documents, numbered per fiscal year and type
--                  (D-2082/83-0001, C-2082/83-0001), with BS dates,
--                  sender / receiver, subject, department, assignee,
--                  channel (hand / post / courier / email ...), due date,
--                  status and the link between a letter and its reply.
-- tasks          - to-dos assigned to users, with priority, status,
--                  due date, progress, watchers and an optional link to
--                  a darta / chalani or any ERP record; task_comments
--                  keeps the discussion and the change history.
-- notifications  - per-user in-app notifications (bell + popup);
--                  user_notification_settings says which extra channels
--                  (email / SMS / WhatsApp / Viber) a user wants.
-- Security group modules: darta_chalani, tasks (see the Security Groups
-- screen). Re-run safe.
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.darta_chalani (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entry_type VARCHAR(10) NOT NULL,                 -- darta (incoming) | chalani (outgoing)
    fiscal_year_id UUID,
    fiscal_year_label VARCHAR(20) NOT NULL,
    serial_no INTEGER NOT NULL,
    reg_no VARCHAR(40) NOT NULL,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    entry_date_bs VARCHAR(10),
    letter_no VARCHAR(100),                          -- the letter's own reference / patra sankhya
    letter_date DATE,
    letter_date_bs VARCHAR(10),
    party_name VARCHAR(200) NOT NULL,                -- from (darta) / to (chalani)
    party_address TEXT,
    party_phone VARCHAR(40),
    party_email VARCHAR(150),
    ledger_id UUID,                                  -- optional link to a customer / supplier
    subject VARCHAR(300) NOT NULL,
    description TEXT,
    department_id UUID,
    assigned_to UUID,
    channel VARCHAR(20) NOT NULL DEFAULT 'hand',
    tracking_no VARCHAR(100),
    pages INTEGER,
    priority VARCHAR(10) NOT NULL DEFAULT 'normal',
    status VARCHAR(15) NOT NULL DEFAULT 'open',
    due_date DATE,
    closed_at TIMESTAMPTZ,
    reply_to_id UUID REFERENCES tenant_master.darta_chalani(id) ON DELETE SET NULL,
    attachment_url TEXT,
    attachment_name VARCHAR(255),
    is_confidential BOOLEAN NOT NULL DEFAULT FALSE,
    remarks TEXT,
    reminder_sent_at TIMESTAMPTZ,
    overdue_sent_at TIMESTAMPTZ,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_dc_type CHECK (entry_type IN ('darta', 'chalani')),
    CONSTRAINT valid_dc_channel CHECK (channel IN ('hand', 'post', 'courier', 'email', 'fax', 'online', 'other')),
    CONSTRAINT valid_dc_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    CONSTRAINT valid_dc_status CHECK (status IN ('open', 'in_progress', 'replied', 'closed', 'cancelled')),
    CONSTRAINT unique_dc_number UNIQUE (tenant_id, entry_type, fiscal_year_label, serial_no)
);
CREATE INDEX IF NOT EXISTS idx_dc_date ON tenant_master.darta_chalani(tenant_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_dc_assignee ON tenant_master.darta_chalani(tenant_id, assigned_to, status);

CREATE TABLE IF NOT EXISTS tenant_master.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    serial_no INTEGER NOT NULL,
    task_no VARCHAR(30) NOT NULL,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    priority VARCHAR(10) NOT NULL DEFAULT 'normal',
    status VARCHAR(15) NOT NULL DEFAULT 'todo',
    start_date DATE,
    due_at TIMESTAMPTZ,
    progress INTEGER NOT NULL DEFAULT 0,
    assigned_to UUID,
    assigned_by UUID,
    watchers UUID[] NOT NULL DEFAULT '{}',
    darta_chalani_id UUID REFERENCES tenant_master.darta_chalani(id) ON DELETE SET NULL,
    related_type VARCHAR(40),                        -- e.g. sales_bill, ledger_account
    related_id TEXT,
    related_label VARCHAR(200),
    tags TEXT[] NOT NULL DEFAULT '{}',
    recurrence VARCHAR(10) NOT NULL DEFAULT 'none',
    completed_at TIMESTAMPTZ,
    reminder_sent_at TIMESTAMPTZ,
    overdue_sent_at TIMESTAMPTZ,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_task_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    CONSTRAINT valid_task_status CHECK (status IN ('todo', 'in_progress', 'on_hold', 'done', 'cancelled')),
    CONSTRAINT valid_task_recurrence CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
    CONSTRAINT valid_task_progress CHECK (progress BETWEEN 0 AND 100),
    CONSTRAINT unique_task_serial UNIQUE (tenant_id, serial_no)
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tenant_master.tasks(tenant_id, assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tenant_master.tasks(tenant_id, due_at) WHERE status NOT IN ('done', 'cancelled');

CREATE TABLE IF NOT EXISTS tenant_master.task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    task_id UUID NOT NULL REFERENCES tenant_master.tasks(id) ON DELETE CASCADE,
    user_id UUID,
    kind VARCHAR(10) NOT NULL DEFAULT 'comment',     -- comment | change
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_task_comment_kind CHECK (kind IN ('comment', 'change'))
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON tenant_master.task_comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS tenant_master.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    kind VARCHAR(40) NOT NULL,
    title VARCHAR(300) NOT NULL,
    body TEXT,
    link TEXT,
    ref_type VARCHAR(40),
    ref_id TEXT,
    priority VARCHAR(10) NOT NULL DEFAULT 'normal',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    channels JSONB,                                   -- what was sent where (email / sms / whatsapp / viber)
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON tenant_master.notifications(tenant_id, user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_master.user_notification_settings (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    popup BOOLEAN NOT NULL DEFAULT TRUE,
    email BOOLEAN NOT NULL DEFAULT FALSE,
    sms BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
    viber BOOLEAN NOT NULL DEFAULT FALSE,
    email_address VARCHAR(150),                      -- blank = the user's login email
    mobile VARCHAR(30),                              -- blank = the user's phone
    muted_kinds TEXT[] NOT NULL DEFAULT '{}',
    reminder_hours INTEGER NOT NULL DEFAULT 24,      -- remind this long before a due time
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id)
);

-- Rights for the new modules: admin groups (group code ADMIN... or used by a
-- company admin) get everything; every other group may create its own tasks.
DO $$
DECLARE all_rights JSONB := '{"view": true, "create": true, "edit": true, "delete": true, "print": true, "export": true}';
BEGIN
    UPDATE tenant_master.security_rights_groups g
    SET permissions = COALESCE(permissions, '{}'::jsonb)
        || jsonb_build_object('data_access', all_rights, 'darta_chalani', all_rights, 'tasks', all_rights)
    WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'tasks')
      AND (group_code ILIKE 'ADMIN%' OR EXISTS (SELECT 1 FROM tenant_master.users u WHERE u.security_group_id = g.id AND u.is_company_admin));
    UPDATE tenant_master.security_rights_groups
    SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object('tasks', '{"view": false, "create": true, "edit": false, "delete": false, "print": false, "export": false}'::jsonb)
    WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'tasks');
END $$;

-- the audit log (file 121) covers the new tables too
DO $$ BEGIN
    IF to_regproc('tenant_master.audit_attach_all') IS NOT NULL THEN PERFORM tenant_master.audit_attach_all(); END IF;
END $$;
