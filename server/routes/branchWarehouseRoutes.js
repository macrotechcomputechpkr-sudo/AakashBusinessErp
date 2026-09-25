// =============================================
// routes/branchWarehouseRoutes.js
// Brings back the Branch/Warehouse module (was in the original design,
// missing from the earlier fixed pass) with the same fixes applied
// throughout this project: atomic code generation, permission checks,
// soft deletes, tenant scoping on every query.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit, checkTransactionUsage } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

// ---------- BRANCHES ----------

router.get('/branches', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('branches')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('branch_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/branches', requireAuth, loadUserPermissions, requirePermission('company_settings', 'create'), async (req, res) => {
    try {
        const { branch_name, branch_short_name, branch_type, province, district, municipality,
                ward_number, address_line1, address_line2, phone, mobile, email,
                contact_person, contact_person_phone, is_head_office } = req.body;

        if (!branch_name || !province || !district) {
            return res.status(400).json({ success: false, error: 'branch_name, province and district are required' });
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const prefix = branch_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_branch_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('branches')
            .insert({
                tenant_id: tenantId,
                branch_code: codeRow,
                branch_name: branch_name.trim(),
                branch_short_name, branch_type: branch_type || 'retail',
                province, district, municipality, ward_number, address_line1, address_line2,
                phone, mobile, email, contact_person, contact_person_phone,
                is_head_office: !!is_head_office,
                opening_date: new Date().toISOString().split('T')[0],
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_branch', 'branch', data.id, { new_data: data });
        res.json({ success: true, message: 'Branch created successfully', data });
    } catch (error) {
        console.error('Create branch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/branches/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('branches').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { data, error } = await tenantClient
            .from('branches')
            .update({ ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId)
            .select()
            .single();
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_branch', 'branch', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/branches/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('branches').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { error } = await tenantClient
            .from('branches')
            .update({ is_active: false, closing_date: new Date().toISOString().split('T')[0], updated_by: req.auth.userId })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'delete_branch', 'branch', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Branch deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- WAREHOUSES ----------

router.get('/warehouses', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('warehouses')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('warehouse_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/warehouses', requireAuth, loadUserPermissions, requirePermission('company_settings', 'create'), async (req, res) => {
    try {
        const { warehouse_name, warehouse_short_name, warehouse_type, province, district, municipality,
                ward_number, address_line1, address_line2, phone, mobile, email,
                contact_person, contact_person_phone, total_area_sqft, capacity_cubic_meters } = req.body;

        if (!warehouse_name || !province || !district) {
            return res.status(400).json({ success: false, error: 'warehouse_name, province and district are required' });
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const prefix = warehouse_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_warehouse_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('warehouses')
            .insert({
                tenant_id: tenantId,
                warehouse_code: codeRow,
                warehouse_name: warehouse_name.trim(),
                warehouse_short_name, warehouse_type: warehouse_type || 'main',
                province, district, municipality, ward_number, address_line1, address_line2,
                phone, mobile, email, contact_person, contact_person_phone,
                total_area_sqft, capacity_cubic_meters,
                opening_date: new Date().toISOString().split('T')[0],
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_warehouse', 'warehouse', data.id, { new_data: data });
        res.json({ success: true, message: 'Warehouse created successfully', data });
    } catch (error) {
        console.error('Create warehouse error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/warehouses/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('warehouses').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { data, error } = await tenantClient
            .from('warehouses')
            .update({ ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId)
            .select()
            .single();
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_warehouse', 'warehouse', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/warehouses/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('warehouses').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { error } = await tenantClient
            .from('warehouses')
            .update({ is_active: false, closing_date: new Date().toISOString().split('T')[0], updated_by: req.auth.userId })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'delete_warehouse', 'warehouse', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Warehouse deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "Remove option - if used somewhere, say which document,
// don't delete" - permanent delete, only allowed when nothing
// references this warehouse anywhere in the purchase transaction chain.
router.delete('/warehouses/:id/permanent', requireAuth, loadUserPermissions, requirePermission('company_settings', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('warehouses').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Warehouse not found' });

        const usage = await checkTransactionUsage(tenantClient, tenantId, req.params.id, [
            { table: 'purchase_requisitions', column: 'warehouse_id', label: 'Purchase Requisition (Master Warehouse)' },
            { detailTable: 'purchase_requisition_details', parentTable: 'purchase_requisitions', column: 'warehouse_id', label: 'Purchase Requisition (Line Warehouse)' }
        ]);
        if (usage.used) {
            return res.status(409).json({ success: false, error: `Cannot delete - used in ${usage.label}: ${usage.docNos.join(', ')}${usage.docNos.length === 5 ? ' (and possibly more)' : ''}` });
        }

        const { error } = await tenantClient.from('warehouses').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) {
            if (error.code === '23503') return res.status(409).json({ success: false, error: 'Cannot delete - this warehouse is still referenced elsewhere' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'permanent_delete_warehouse', 'warehouse', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Warehouse permanently deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- BRANCH <-> WAREHOUSE MAPPING ----------

router.get('/branch-warehouse-mapping', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let q = tenantClient
            .from('branch_warehouse_mapping')
            .select('*, branches(branch_name, branch_code), warehouses(warehouse_name, warehouse_code)')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true);
        if (req.query.branch_id) q = q.eq('branch_id', req.query.branch_id);
        const { data, error } = await q;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/branch-warehouse-mapping', requireAuth, loadUserPermissions, requirePermission('company_settings', 'create'), async (req, res) => {
    try {
        const { branch_id, warehouse_id, is_primary, distance_km, priority_order } = req.body;
        if (!branch_id || !warehouse_id) {
            return res.status(400).json({ success: false, error: 'branch_id and warehouse_id are required' });
        }
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data, error } = await tenantClient
            .from('branch_warehouse_mapping')
            .insert({
                tenant_id: tenantId, branch_id, warehouse_id,
                is_primary: !!is_primary, distance_km: distance_km || null,
                priority_order: priority_order || 1,
                created_by: req.auth.userId
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'This branch/warehouse pair is already mapped' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_branch_warehouse_mapping', 'branch_warehouse_mapping', data.id, { new_data: data });
        res.json({ success: true, message: 'Mapping created', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
