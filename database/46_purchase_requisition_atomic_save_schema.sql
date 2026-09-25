-- =============================================
-- ATOMIC SAVE - PURCHASE REQUISITION (CREATE)
-- =============================================
-- "kunai part save hune kunai nahune vayera data mismatch huna sakne" -
-- a real concern: the previous approach called .insert() separately for
-- Master, then Details, then Billing Terms, then Line Terms, as 4
-- SEPARATE HTTP round-trips (Supabase-JS has no native multi-table
-- transaction across calls). If the SERVER PROCESS ITSELF crashed
-- between any two of those calls, no JS try/catch could ever run to
-- clean up - a "mirror table" wouldn't prevent that either, it would
-- only give you something to reconcile against AFTER the fact.
--
-- The actual fix: do ALL FOUR inserts INSIDE one PL/pgSQL function.
-- Every statement in a function body runs in Postgres's own implicit
-- transaction - if ANY of them fails for ANY reason (including the
-- Dr=Cr trigger above, for whichever future feature posts through
-- ledger_transaction_batches), Postgres rolls back the ENTIRE function
-- call automatically. No compensating deletes, no partial state,
-- ever - by construction, not by application-code discipline.
--
-- Uses jsonb_populate_record (maps JSON keys to matching column names
-- automatically) rather than manually listing every column, since
-- purchase_requisition_details alone has 25+ columns now (including
-- the historical name snapshots) - far lower risk of a typo silently
-- dropping a field. The caller (JS) generates a real UUID for every
-- child row up front and includes it in the JSON, since
-- jsonb_populate_record leaves an omitted column NULL rather than
-- applying its table DEFAULT.
-- =============================================

CREATE OR REPLACE FUNCTION tenant_master.save_purchase_requisition_atomic(
    p_master JSONB,
    p_details JSONB,
    p_document_billing_terms JSONB,
    p_line_billing_terms JSONB
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_detail JSONB;
    v_term JSONB;
BEGIN
    INSERT INTO tenant_master.purchase_requisitions
    SELECT (jsonb_populate_record(NULL::tenant_master.purchase_requisitions, p_master)).*
    RETURNING id INTO v_id;

    FOR v_detail IN SELECT * FROM jsonb_array_elements(p_details)
    LOOP
        INSERT INTO tenant_master.purchase_requisition_details
        SELECT (jsonb_populate_record(NULL::tenant_master.purchase_requisition_details, v_detail || jsonb_build_object('requisition_id', v_id))).*;
    END LOOP;

    IF p_document_billing_terms IS NOT NULL THEN
        FOR v_term IN SELECT * FROM jsonb_array_elements(p_document_billing_terms)
        LOOP
            INSERT INTO tenant_master.document_billing_terms
            SELECT (jsonb_populate_record(NULL::tenant_master.document_billing_terms, v_term || jsonb_build_object('document_id', v_id))).*;
        END LOOP;
    END IF;

    IF p_line_billing_terms IS NOT NULL THEN
        FOR v_term IN SELECT * FROM jsonb_array_elements(p_line_billing_terms)
        LOOP
            INSERT INTO tenant_master.document_line_billing_terms
            SELECT (jsonb_populate_record(NULL::tenant_master.document_line_billing_terms, v_term || jsonb_build_object('document_id', v_id))).*;
        END LOOP;
    END IF;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ATOMIC SAVE - PURCHASE REQUISITION (UPDATE)
-- Same guarantee for edits. Deliberately AVOIDS a clever single
-- tuple-assignment UPDATE (SET (cols) = (correlated subquery)) - that
-- pattern is easy to get subtly wrong and hard to verify without a live
-- database to test against. Instead: pull the CURRENT row into a
-- variable of the table's own row type, let jsonb_populate_record
-- overlay only the keys the caller actually sent on top of it (any key
-- NOT present keeps its current value - a real partial update, not a
-- full overwrite), then a plain column-by-column UPDATE. More verbose,
-- far lower risk.
-- =============================================
CREATE OR REPLACE FUNCTION tenant_master.update_purchase_requisition_atomic(
    p_requisition_id UUID,
    p_master JSONB,
    p_details JSONB,
    p_document_billing_terms JSONB,
    p_line_billing_terms JSONB
) RETURNS UUID AS $$
DECLARE
    v_current tenant_master.purchase_requisitions;
    v_merged tenant_master.purchase_requisitions;
    v_detail JSONB;
    v_term JSONB;
BEGIN
    SELECT * INTO v_current FROM tenant_master.purchase_requisitions WHERE id = p_requisition_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase Requisition % not found', p_requisition_id;
    END IF;

    v_merged := jsonb_populate_record(v_current, p_master);

    UPDATE tenant_master.purchase_requisitions SET
        branch_id = v_merged.branch_id, branch_name_snapshot = v_merged.branch_name_snapshot,
        doc_date = v_merged.doc_date, vendor_ledger_id = v_merged.vendor_ledger_id,
        vendor_name_snapshot = v_merged.vendor_name_snapshot, agent_id = v_merged.agent_id,
        agent_name_snapshot = v_merged.agent_name_snapshot, invoice_type = v_merged.invoice_type,
        currency = v_merged.currency, due_date = v_merged.due_date, due_days = v_merged.due_days,
        warehouse_id = v_merged.warehouse_id, warehouse_name_snapshot = v_merged.warehouse_name_snapshot,
        goods_account_ledger_id = v_merged.goods_account_ledger_id, goods_account_name_snapshot = v_merged.goods_account_name_snapshot,
        goods_sub_ledger_id = v_merged.goods_sub_ledger_id, goods_sub_ledger_name_snapshot = v_merged.goods_sub_ledger_name_snapshot,
        remarks_id = v_merged.remarks_id, remarks_text = v_merged.remarks_text, rate_type = v_merged.rate_type,
        cost_center_id = v_merged.cost_center_id, cost_center_name_snapshot = v_merged.cost_center_name_snapshot,
        business_unit_id = v_merged.business_unit_id, business_unit_name_snapshot = v_merged.business_unit_name_snapshot,
        area_id = v_merged.area_id, area_name_snapshot = v_merged.area_name_snapshot,
        route_id = v_merged.route_id, route_name_snapshot = v_merged.route_name_snapshot,
        priority = v_merged.priority, expected_delivery_date = v_merged.expected_delivery_date,
        terms_conditions_id = v_merged.terms_conditions_id, narration = v_merged.narration,
        status = v_merged.status, cash_vendor_name = v_merged.cash_vendor_name,
        cash_billing_details = v_merged.cash_billing_details, updated_at = NOW()
    WHERE id = p_requisition_id;

    IF p_details IS NOT NULL THEN
        DELETE FROM tenant_master.purchase_requisition_details WHERE requisition_id = p_requisition_id;
        FOR v_detail IN SELECT * FROM jsonb_array_elements(p_details)
        LOOP
            INSERT INTO tenant_master.purchase_requisition_details
            SELECT (jsonb_populate_record(NULL::tenant_master.purchase_requisition_details, v_detail || jsonb_build_object('requisition_id', p_requisition_id))).*;
        END LOOP;
    END IF;

    DELETE FROM tenant_master.document_billing_terms WHERE document_type = 'purchase_requisition' AND document_id = p_requisition_id;
    IF p_document_billing_terms IS NOT NULL THEN
        FOR v_term IN SELECT * FROM jsonb_array_elements(p_document_billing_terms)
        LOOP
            INSERT INTO tenant_master.document_billing_terms
            SELECT (jsonb_populate_record(NULL::tenant_master.document_billing_terms, v_term || jsonb_build_object('document_id', p_requisition_id))).*;
        END LOOP;
    END IF;

    DELETE FROM tenant_master.document_line_billing_terms WHERE document_type = 'purchase_requisition' AND document_id = p_requisition_id;
    IF p_line_billing_terms IS NOT NULL THEN
        FOR v_term IN SELECT * FROM jsonb_array_elements(p_line_billing_terms)
        LOOP
            INSERT INTO tenant_master.document_line_billing_terms
            SELECT (jsonb_populate_record(NULL::tenant_master.document_line_billing_terms, v_term || jsonb_build_object('document_id', p_requisition_id))).*;
        END LOOP;
    END IF;

    RETURN p_requisition_id;
END;
$$ LANGUAGE plpgsql;
