-- =============================================
-- 121: Full audit log for every master and entry table
--
-- Before this, auditing was partial:
--   * document_audit_trail (file 38) only records WHO did WHAT action on
--     23 entry types - no old / new values;
--   * masters only reach public.global_audit_log through logAudit() in the
--     global database, as a free-form JSON note (no before / after values),
--     and several routes never call it;
--   * nothing records changes made outside the API (SQL console, imports).
--
-- This file adds ONE trigger-based audit table in the tenant database:
--   * every INSERT / UPDATE / DELETE on every business table (masters,
--     entries and their line tables) is written by a database trigger, so
--     no route can forget it and direct SQL changes are caught too;
--   * UPDATE keeps only the changed fields (old value -> new value);
--     INSERT keeps the new row, DELETE keeps the whole deleted row;
--   * line tables (e.g. sales_bill_details) also store their parent
--     document (found from the ON DELETE CASCADE foreign key), so one
--     document's history includes its line changes;
--   * the user, IP and API route come from request headers the ERP server
--     adds to every database call (x-erp-user / x-erp-ip / x-erp-route);
--     without them (SQL console) the row's own updated_by / created_by is
--     used and source = 'db';
--   * password / token / secret columns are masked;
--   * the log is append-only: UPDATE / DELETE on it are refused (only
--     tenant_master.audit_purge() may remove old rows).
-- Re-run safe. Tables added later: SELECT tenant_master.audit_attach_all();
-- =============================================

CREATE TABLE IF NOT EXISTS tenant_master.audit_log (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID,
    table_name TEXT NOT NULL,
    record_id TEXT,
    record_label TEXT,                    -- doc no / name, for searching
    parent_table TEXT,                    -- header table of a line row
    parent_id TEXT,
    action CHAR(1) NOT NULL,              -- I = created, U = changed, D = deleted
    changed_fields TEXT[],
    old_data JSONB,
    new_data JSONB,
    user_id UUID,
    ip_address TEXT,
    api_route TEXT,
    source VARCHAR(10) NOT NULL DEFAULT 'api',   -- api | db
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_audit_log_action CHECK (action IN ('I', 'U', 'D'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON tenant_master.audit_log(tenant_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON tenant_master.audit_log(table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_parent ON tenant_master.audit_log(parent_table, parent_id, changed_at DESC) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON tenant_master.audit_log(tenant_id, user_id, changed_at DESC);

-- Which tables are audited, and how a line table finds its document.
CREATE TABLE IF NOT EXISTS tenant_master.audit_table_config (
    table_name TEXT PRIMARY KEY,
    parent_table TEXT,
    parent_column TEXT,
    is_audited BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Derived / log / cache tables - rebuilt by posting or written in bulk,
-- auditing them would only duplicate the source document's history.
CREATE OR REPLACE FUNCTION tenant_master.audit_excluded(t TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT t = ANY (ARRAY[
        'audit_log', 'audit_table_config', 'document_audit_trail', 'user_activity_log',
        'user_password_history', 'ird_sales_materialized', 'ird_sync_log', 'ird_bill_audit_log',
        'message_log', 'document_print_log', 'document_numbering_counters',
        'stock_movements', 'nonsaleable_stock_movements', 'ledger_transaction_batches',
        'ledger_transaction_lines', 'bill_wise_references', 'bank_reco_learning',
        'dashboard_layouts', 'list_view_presets', 'report_saved_views', 'saved_report_views'
    ])
$$;

CREATE OR REPLACE FUNCTION tenant_master.audit_mask(j JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_object_agg(k, CASE WHEN k ~* '(password|secret|token|api_key|apikey|private_key)' AND v IS NOT NULL AND v <> 'null'::jsonb
                                               THEN to_jsonb('***'::text) ELSE v END), '{}'::jsonb)
    FROM jsonb_each(j) AS e(k, v)
$$;

CREATE OR REPLACE FUNCTION tenant_master.audit_row() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_master, public AS $$
DECLARE
    o JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    n JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    r JSONB := COALESCE(n, o);
    h JSONB;
    keys TEXT[];
    cfg RECORD;
    uid TEXT;
    lbl TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(k ORDER BY k) INTO keys
        FROM jsonb_each(n) AS e(k, v)
        WHERE k NOT IN ('updated_at', 'last_modified_at') AND (o -> k) IS DISTINCT FROM v;
        IF keys IS NULL THEN RETURN NULL; END IF;          -- nothing but a timestamp changed
        SELECT jsonb_object_agg(k, o -> k), jsonb_object_agg(k, n -> k) INTO o, n FROM unnest(keys) AS k;
    END IF;

    BEGIN h := NULLIF(current_setting('request.headers', true), '')::jsonb;
    EXCEPTION WHEN others THEN h := NULL; END;
    uid := COALESCE(h ->> 'x-erp-user', r ->> 'updated_by', r ->> 'modified_by', r ->> 'posted_by', r ->> 'created_by');
    IF uid !~ '^[0-9a-fA-F-]{36}$' THEN uid := NULL; END IF;

    lbl := COALESCE(r ->> 'doc_no', r ->> 'voucher_no', r ->> 'entry_no', r ->> 'bill_no', r ->> 'account_name', r ->> 'product_name',
                      r ->> 'group_name', r ->> 'company_name', r ->> 'unit_name', r ->> 'agent_name', r ->> 'full_name',
                      r ->> 'sub_ledger_name', r ->> 'warehouse_name', r ->> 'branch_name', r ->> 'category_name',
                      r ->> 'name', r ->> 'title', r ->> 'code', r ->> 'lc_no', r ->> 'bg_no', r ->> 'asset_name',
                      r ->> 'product_name_snapshot', r ->> 'ledger_name_snapshot', r ->> 'account_name_snapshot', r ->> 'description');
    IF lbl IS NULL THEN          -- any other *_no / *_code / *_name column (e.g. budget_name, lc_number)
        SELECT v INTO lbl FROM jsonb_each_text(r) AS e(k, v)
        WHERE v IS NOT NULL AND v <> '' AND k !~ '(_id|_by|_at)$' AND k ~ '(_no|_number|_code|_name)$'
        ORDER BY (k ~ '_name$') DESC, (k ~ 'snapshot') , k LIMIT 1;
    END IF;

    SELECT parent_table, parent_column INTO cfg FROM tenant_master.audit_table_config WHERE table_name = TG_TABLE_NAME;

    INSERT INTO tenant_master.audit_log (tenant_id, table_name, record_id, record_label, parent_table, parent_id, action,
                                         changed_fields, old_data, new_data, user_id, ip_address, api_route, source)
    VALUES (
        CASE WHEN (r ->> 'tenant_id') ~ '^[0-9a-fA-F-]{36}$' THEN (r ->> 'tenant_id')::uuid END,
        TG_TABLE_NAME,
        COALESCE(r ->> 'id', r ->> 'tenant_id'),
        left(lbl, 200),
        cfg.parent_table,
        CASE WHEN cfg.parent_column IS NOT NULL THEN r ->> cfg.parent_column END,
        left(TG_OP, 1),
        keys,
        CASE WHEN o IS NOT NULL THEN tenant_master.audit_mask(o) END,
        CASE WHEN n IS NOT NULL THEN tenant_master.audit_mask(n) END,
        uid::uuid,
        left(h ->> 'x-erp-ip', 60),
        left(h ->> 'x-erp-route', 200),
        CASE WHEN h ? 'x-erp-user' THEN 'api' ELSE 'db' END
    );
    RETURN NULL;
END $$;

-- The log is append-only.
CREATE OR REPLACE FUNCTION tenant_master.audit_log_readonly() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('erp.audit_purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'The audit log cannot be changed or deleted';
END $$;
DROP TRIGGER IF EXISTS trg_audit_log_readonly ON tenant_master.audit_log;
CREATE TRIGGER trg_audit_log_readonly BEFORE UPDATE OR DELETE ON tenant_master.audit_log
    FOR EACH ROW EXECUTE FUNCTION tenant_master.audit_log_readonly();

-- Remove entries older than a date (e.g. after the statutory retention period).
CREATE OR REPLACE FUNCTION tenant_master.audit_purge(p_tenant UUID, p_before DATE) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = tenant_master, public AS $$
DECLARE k BIGINT;
BEGIN
    IF p_before > CURRENT_DATE - 365 THEN RAISE EXCEPTION 'Entries of the last 12 months cannot be purged'; END IF;
    PERFORM set_config('erp.audit_purge', 'on', true);
    DELETE FROM tenant_master.audit_log WHERE tenant_id = p_tenant AND changed_at < p_before;
    GET DIAGNOSTICS k = ROW_COUNT;
    PERFORM set_config('erp.audit_purge', 'off', true);
    RETURN k;
END $$;

-- Attach the trigger to every business table (and find line -> document links).
CREATE OR REPLACE FUNCTION tenant_master.audit_attach_all() RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE t RECORD; k INTEGER := 0;
BEGIN
    FOR t IN
        SELECT c.relname AS tbl
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'tenant_master' AND c.relkind IN ('r', 'p') AND NOT tenant_master.audit_excluded(c.relname)
    LOOP
        INSERT INTO tenant_master.audit_table_config (table_name, parent_table, parent_column)
        SELECT t.tbl, p.relname, a.attname
        FROM pg_constraint fk
        JOIN pg_class ch ON ch.oid = fk.conrelid AND ch.relname = t.tbl
        JOIN pg_namespace nn ON nn.oid = ch.relnamespace AND nn.nspname = 'tenant_master'
        JOIN pg_class p ON p.oid = fk.confrelid
        JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = fk.conkey[1]
        WHERE fk.contype = 'f' AND fk.confdeltype = 'c' AND array_length(fk.conkey, 1) = 1 AND p.relname <> t.tbl
          AND p.relname NOT IN ('company_profile', 'tenants') AND NOT tenant_master.audit_excluded(p.relname)
        ORDER BY (t.tbl NOT LIKE regexp_replace(p.relname, '(e?s)$', '') || '\_%'),
                 (a.attname NOT LIKE '%bill_id' AND a.attname NOT LIKE '%order_id' AND a.attname NOT LIKE '%voucher_id'
                  AND a.attname NOT LIKE '%entry_id' AND a.attname NOT LIKE '%header_id' AND a.attname <> 'parent_id'), a.attname
        LIMIT 1
        ON CONFLICT (table_name) DO NOTHING;
        INSERT INTO tenant_master.audit_table_config (table_name) VALUES (t.tbl) ON CONFLICT (table_name) DO NOTHING;

        EXECUTE format('DROP TRIGGER IF EXISTS trg_zz_audit ON tenant_master.%I', t.tbl);
        IF (SELECT is_audited FROM tenant_master.audit_table_config WHERE table_name = t.tbl) THEN
            EXECUTE format('CREATE TRIGGER trg_zz_audit AFTER INSERT OR UPDATE OR DELETE ON tenant_master.%I
                            FOR EACH ROW EXECUTE FUNCTION tenant_master.audit_row()', t.tbl);
            k := k + 1;
        END IF;
    END LOOP;
    RETURN k;
END $$;

-- Coverage report for the Audit Log screen: every table and whether it is audited.
CREATE OR REPLACE FUNCTION tenant_master.audit_coverage() RETURNS TABLE (table_name TEXT, audited BOOLEAN, excluded BOOLEAN, parent_table TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = tenant_master, public AS $$
    SELECT c.relname::text,
           EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND tg.tgname = 'trg_zz_audit' AND tg.tgenabled <> 'D'),
           tenant_master.audit_excluded(c.relname),
           cfg.parent_table
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    LEFT JOIN tenant_master.audit_table_config cfg ON cfg.table_name = c.relname
    WHERE ns.nspname = 'tenant_master' AND c.relkind IN ('r', 'p')
    ORDER BY 1
$$;

SELECT tenant_master.audit_attach_all();
