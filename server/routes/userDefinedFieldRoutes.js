// =============================================
// routes/userDefinedFieldRoutes.js
// Custom fields attachable to any entry module's Master or Detail
// section. field_type: text/date/time/boolean/number/table_reference.
//
// SECURITY: reference_table is NEVER trusted as free text for a dynamic
// query - REFERENCE_TABLE_MAP below is the single source of truth for
// which tables are queryable this way and which column is their default
// display field. Anything not in this map is rejected before any query
// touches the database, regardless of what the DB-level CHECK
// constraint also allows (defense in depth, not a substitute for it).
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const VOUCHER_TYPES = [
    'sales_order', 'sales_delivery', 'sales_bill', 'sales_return', 'sales_additional',
    'purchase_order', 'purchase_grn', 'purchase_bill', 'purchase_return', 'purchase_additional',
    'journal', 'cash', 'bank', 'pdc', 'production',
    'purchase_requisition', 'purchase_quotation',
    'sales_quotation', 'sales_nonsalable_return', 'purchase_nonsalable_return',
    'stock_transfer', 'debit_note', 'credit_note'
];

// FEATURE/SECURITY: the only tables a Table Reference UDF may point at,
// and the column used both as the human-readable label and as the
// allowed "display field" choices offered when defining the UDF.
const REFERENCE_TABLE_MAP = {
    ledger_accounts: { labelField: 'account_name', codeField: 'account_code', allowedDisplayFields: ['account_name', 'account_code'] },
    products: { labelField: 'product_name', codeField: 'product_code', allowedDisplayFields: ['product_name', 'product_code'] },
    salesman_agents: { labelField: 'agent_name', codeField: 'agent_code', allowedDisplayFields: ['agent_name', 'agent_code'] },
    areas: { labelField: 'area_name', codeField: 'area_code', allowedDisplayFields: ['area_name', 'area_code'] },
    routes: { labelField: 'route_name', codeField: 'route_code', allowedDisplayFields: ['route_name', 'route_code'] },
    product_categories: { labelField: 'category_name', codeField: 'category_code', allowedDisplayFields: ['category_name', 'category_code'] },
    ledger_categories: { labelField: 'category_name', codeField: 'category_code', allowedDisplayFields: ['category_name', 'category_code'] },
    cost_centers: { labelField: 'center_name', codeField: 'center_code', allowedDisplayFields: ['center_name', 'center_code'] },
    profit_centers: { labelField: 'center_name', codeField: 'center_code', allowedDisplayFields: ['center_name', 'center_code'] },
    sub_ledgers: { labelField: 'sub_ledger_name', codeField: 'sub_ledger_code', allowedDisplayFields: ['sub_ledger_name', 'sub_ledger_code'] },
    business_units: { labelField: 'unit_name', codeField: 'unit_code', allowedDisplayFields: ['unit_name', 'unit_code'] },
    branches: { labelField: 'branch_name', codeField: 'branch_code', allowedDisplayFields: ['branch_name', 'branch_code'] },
    warehouses: { labelField: 'warehouse_name', codeField: 'warehouse_code', allowedDisplayFields: ['warehouse_name', 'warehouse_code'] },
    billing_terms: { labelField: 'term_name', codeField: 'term_code', allowedDisplayFields: ['term_name', 'term_code'] },
    product_units: { labelField: 'unit_name', codeField: 'unit_code', allowedDisplayFields: ['unit_name', 'unit_code'] }
};

function validateUdfBody(body) {
    if (!VOUCHER_TYPES.includes(body.voucher_type)) return 'Invalid voucher_type';
    if (!['master', 'detail'].includes(body.section)) return 'Invalid section';
    if (!body.field_label || !body.field_label.trim()) return 'Field Label is required';
    if (!['text', 'date', 'time', 'boolean', 'number', 'table_reference'].includes(body.field_type)) return 'Invalid field_type';
    if (body.field_type === 'table_reference') {
        if (!body.reference_table) return 'A reference table is required for a Table Reference field';
        const mapping = REFERENCE_TABLE_MAP[body.reference_table];
        if (!mapping) return 'That reference table is not allowed';
        if (body.reference_display_field && !mapping.allowedDisplayFields.includes(body.reference_display_field)) {
            return 'That display field is not allowed for the chosen table';
        }
    }
    return null;
}

router.get('/user-defined-fields/reference-tables', requireAuth, (req, res) => {
    // FEATURE: lets the UI populate the "which table" dropdown from the
    // same allowlist the server actually enforces, instead of a
    // hand-maintained duplicate list on the frontend.
    res.json({ success: true, data: Object.entries(REFERENCE_TABLE_MAP).map(([table, m]) => ({ table, ...m })) });
});

router.get('/user-defined-fields', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient.from('user_defined_fields').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('display_order');
        if (req.query.voucher_type) query = query.eq('voucher_type', req.query.voucher_type);
        if (req.query.section) query = query.eq('section', req.query.section);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/user-defined-fields', requireAuth, loadUserPermissions, requirePermission('security', 'edit'), async (req, res) => {
    try {
        const validationError = validateUdfBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data, error } = await tenantClient
            .from('user_defined_fields')
            .insert({
                tenant_id: tenantId, voucher_type: b.voucher_type, section: b.section,
                field_label: b.field_label.trim(), field_type: b.field_type,
                reference_table: b.field_type === 'table_reference' ? b.reference_table : null,
                reference_display_field: b.field_type === 'table_reference' ? (b.reference_display_field || REFERENCE_TABLE_MAP[b.reference_table].labelField) : null,
                display_order: b.display_order || 1,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A field with this label already exists on this module/section' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the fields' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_user_defined_field', 'user_defined_field', data.id, { new_data: data });
        res.json({ success: true, message: 'Custom field created', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/user-defined-fields/:id', requireAuth, loadUserPermissions, requirePermission('security', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('user_defined_fields').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Custom field not found' });

        const merged = { ...existing, ...req.body };
        const validationError = validateUdfBody(merged);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const update = {
            ...req.body,
            reference_table: merged.field_type === 'table_reference' ? merged.reference_table : null,
            reference_display_field: merged.field_type === 'table_reference' ? merged.reference_display_field : null,
            updated_by: req.auth.userId, updated_at: new Date().toISOString()
        };
        const { data, error } = await tenantClient
            .from('user_defined_fields').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A field with this label already exists on this module/section' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_user_defined_field', 'user_defined_field', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/user-defined-fields/:id', requireAuth, loadUserPermissions, requirePermission('security', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('user_defined_fields').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient.from('user_defined_fields').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_user_defined_field', 'user_defined_field', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Custom field removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: for a table_reference UDF, returns the actual picker options
// (id + display label) from the referenced table - the reference_table
// value is read back from OUR OWN stored, already-validated row, never
// taken fresh from the request, so there's no path for a caller to name
// an arbitrary table here even indirectly.
router.get('/user-defined-fields/:id/options', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: udf } = await tenantClient.from('user_defined_fields').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (!udf) return res.status(404).json({ success: false, error: 'Custom field not found' });
        if (udf.field_type !== 'table_reference') return res.status(400).json({ success: false, error: 'This field is not a Table Reference type' });

        const mapping = REFERENCE_TABLE_MAP[udf.reference_table];
        if (!mapping) return res.status(400).json({ success: false, error: 'That reference table is not allowed' });

        const displayField = udf.reference_display_field || mapping.labelField;
        const { data, error } = await tenantClient
            .from(udf.reference_table).select(`id, ${displayField}`).eq('tenant_id', req.auth.tenantId).eq('is_active', true).order(displayField);
        if (error) throw error;
        res.json({ success: true, data: (data || []).map(r => ({ id: r.id, label: r[displayField] })) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
module.exports.REFERENCE_TABLE_MAP = REFERENCE_TABLE_MAP;
module.exports.VOUCHER_TYPES = VOUCHER_TYPES;
