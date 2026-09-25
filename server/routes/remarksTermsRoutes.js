// =============================================
// routes/remarksTermsRoutes.js
// Simple CRUD for the Remarks and Terms & Conditions masters - reusable
// pick-from-list text, filterable by applicable_to (sales/purchase/both)
// so a future Sales Bill only offers sales-relevant options, etc.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

function buildCrud(tableName, requiredField, uniqueErrorMessage) {
    const r = express.Router();
    const kebab = tableName === 'remarks_master' ? 'remarks' : 'terms-conditions';

    r.get(`/${kebab}`, requireAuth, async (req, res) => {
        try {
            const tenantClient = await getTenantClient(req.auth.tenantId);
            let query = tenantClient.from(tableName).select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('display_order');
            // FIX: only terms_conditions_master has applicable_to -
            // remarks_master applies to every module unconditionally.
            if (req.query.applicable_to && tableName === 'terms_conditions_master') {
                query = query.in('applicable_to', [req.query.applicable_to, 'both']);
            }
            const { data, error } = await query;
            if (error) throw error;
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    r.post(`/${kebab}`, requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
        try {
            if (!req.body[requiredField] || !req.body[requiredField].trim()) {
                return res.status(400).json({ success: false, error: `${requiredField} is required` });
            }
            const tenantId = req.auth.tenantId;
            const tenantClient = await getTenantClient(tenantId);
            const { data, error } = await tenantClient
                .from(tableName)
                .insert({ ...req.body, tenant_id: tenantId, created_by: req.auth.userId, updated_by: req.auth.userId })
                .select().single();
            if (error) {
                if (error.code === '23505') return res.status(409).json({ success: false, error: uniqueErrorMessage });
                if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the fields' });
                throw error;
            }
            await logAudit(tenantId, req.auth.userId, `create_${tableName}`, tableName, data.id, { new_data: data });
            res.json({ success: true, message: 'Created successfully', data });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    r.put(`/${kebab}/:id`, requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
        try {
            const tenantId = req.auth.tenantId;
            const tenantClient = await getTenantClient(tenantId);
            const { data: existing } = await tenantClient.from(tableName).select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
            if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

            const { data, error } = await tenantClient
                .from(tableName).update({ ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
                .eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
            if (error) {
                if (error.code === '23505') return res.status(409).json({ success: false, error: uniqueErrorMessage });
                throw error;
            }
            await logAudit(tenantId, req.auth.userId, `update_${tableName}`, tableName, req.params.id, { old_data: existing, new_data: data });
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    r.delete(`/${kebab}/:id`, requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
        try {
            const tenantId = req.auth.tenantId;
            const tenantClient = await getTenantClient(tenantId);
            const { data: existing } = await tenantClient.from(tableName).select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
            const { error } = await tenantClient.from(tableName).update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
            if (error) throw error;
            await logAudit(tenantId, req.auth.userId, `delete_${tableName}`, tableName, req.params.id, { old_data: existing });
            res.json({ success: true, message: 'Removed' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return r;
}

router.use(buildCrud('remarks_master', 'remark_text', 'This remark already exists'));
router.use(buildCrud('terms_conditions_master', 'title', 'A term with this title already exists'));

module.exports = router;
