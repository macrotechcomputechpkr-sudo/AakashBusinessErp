// =============================================
// routes/businessUnitRoutes.js
// Brings back Business Units (brands/divisions) - same fix pattern as the
// other master-data routes: atomic codes, permission checks, soft delete.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/business-units', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('business_units')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('unit_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/business-units', requireAuth, loadUserPermissions, requirePermission('company_settings', 'create'), async (req, res) => {
    try {
        const { unit_name, unit_short_name, unit_type, brand_name, brand_owner,
                product_category, product_sub_category, description, tax_rate,
                requires_separate_inventory, requires_separate_accounting, parent_unit_id } = req.body;

        if (!unit_name) return res.status(400).json({ success: false, error: 'unit_name is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        // FEATURE: multi-level hierarchy is opt-in via System Control -
        // same gating pattern as every other System-Control-conditional
        // feature here (Batch/Vehicle/Serial/Barcode-Print/Branch-wise).
        let hierarchyLevel = 1;
        if (parent_unit_id) {
            const { data: sysControl } = await tenantClient.from('system_control_settings').select('enable_business_unit_hierarchy, business_unit_max_levels').eq('tenant_id', tenantId).maybeSingle();
            if (!sysControl?.enable_business_unit_hierarchy) {
                return res.status(400).json({ success: false, error: 'Business Unit hierarchy is not enabled in System Control' });
            }
            const { data: parent } = await tenantClient.from('business_units').select('id, hierarchy_level').eq('id', parent_unit_id).eq('tenant_id', tenantId).single();
            if (!parent) return res.status(404).json({ success: false, error: 'Parent business unit not found' });
            hierarchyLevel = (parent.hierarchy_level || 1) + 1;
            const maxLevels = sysControl.business_unit_max_levels || 3;
            if (hierarchyLevel > maxLevels) {
                return res.status(400).json({ success: false, error: `This would exceed the maximum of ${maxLevels} levels configured in System Control` });
            }
        }

        const prefix = unit_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_business_unit_code', { prefix });
        if (codeErr) throw codeErr;

        // FEATURE: Short Name auto-generates from Name's initials + a
        // true sequential number when not supplied - same pattern as
        // Ledger Accounts (Code stays read-only/server-generated, Short
        // Name stays fully changeable).
        let shortName = unit_short_name;
        if (!shortName) {
            const { data: shortNameRow, error: shortNameErr } = await tenantClient.rpc('next_short_name', { seq_name: 'tenant_master.seq_business_unit_short_name', initials: prefix });
            if (shortNameErr) throw shortNameErr;
            shortName = shortNameRow;
        }

        const { data, error } = await tenantClient
            .from('business_units')
            .insert({
                tenant_id: tenantId,
                unit_code: codeRow,
                unit_name: unit_name.trim(),
                unit_short_name: shortName, unit_type: unit_type || 'brand',
                brand_name, brand_owner, product_category, product_sub_category, description,
                tax_rate: tax_rate !== undefined ? tax_rate : 13.00,
                requires_separate_inventory: !!requires_separate_inventory,
                requires_separate_accounting: !!requires_separate_accounting,
                parent_unit_id: parent_unit_id || null,
                hierarchy_level: hierarchyLevel,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_business_unit', 'business_unit', data.id, { new_data: data });
        res.json({ success: true, message: 'Business unit created successfully', data });
    } catch (error) {
        console.error('Create business unit error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/business-units/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('business_units').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Business unit not found' });

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };

        // FIX: recompute hierarchy_level whenever parent_unit_id changes,
        // same validation as create - otherwise editing a unit onto a
        // different parent would silently leave its level stale.
        if (req.body.parent_unit_id !== undefined && req.body.parent_unit_id !== existing.parent_unit_id) {
            if (req.body.parent_unit_id === req.params.id) {
                return res.status(400).json({ success: false, error: 'A business unit cannot be its own parent' });
            }
            if (!req.body.parent_unit_id) {
                update.hierarchy_level = 1;
            } else {
                const { data: sysControl } = await tenantClient.from('system_control_settings').select('enable_business_unit_hierarchy, business_unit_max_levels').eq('tenant_id', tenantId).maybeSingle();
                if (!sysControl?.enable_business_unit_hierarchy) {
                    return res.status(400).json({ success: false, error: 'Business Unit hierarchy is not enabled in System Control' });
                }
                const { data: parent } = await tenantClient.from('business_units').select('id, hierarchy_level, parent_unit_id').eq('id', req.body.parent_unit_id).eq('tenant_id', tenantId).single();
                if (!parent) return res.status(404).json({ success: false, error: 'Parent business unit not found' });
                // FIX: block a circular chain (setting a unit's parent to
                // one of its own descendants) by walking up from the
                // chosen parent and checking we never hit this unit.
                let cursor = parent;
                const visited = new Set([req.params.id]);
                while (cursor?.parent_unit_id) {
                    if (visited.has(cursor.parent_unit_id)) break;
                    if (cursor.parent_unit_id === req.params.id) {
                        return res.status(400).json({ success: false, error: 'This would create a circular parent chain' });
                    }
                    visited.add(cursor.parent_unit_id);
                    const { data: next } = await tenantClient.from('business_units').select('id, parent_unit_id').eq('id', cursor.parent_unit_id).single();
                    cursor = next;
                }
                update.hierarchy_level = (parent.hierarchy_level || 1) + 1;
                const maxLevels = sysControl.business_unit_max_levels || 3;
                if (update.hierarchy_level > maxLevels) {
                    return res.status(400).json({ success: false, error: `This would exceed the maximum of ${maxLevels} levels configured in System Control` });
                }
            }
        }

        const { data, error } = await tenantClient
            .from('business_units')
            .update(update)
            .eq('id', req.params.id)
            .eq('tenant_id', tenantId)
            .select()
            .single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_business_unit', 'business_unit', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/business-units/:id', requireAuth, loadUserPermissions, requirePermission('company_settings', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('business_units').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { error } = await tenantClient
            .from('business_units')
            .update({ is_active: false, updated_by: req.auth.userId })
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'delete_business_unit', 'business_unit', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Business unit deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- BRANCH <-> BUSINESS UNIT MAPPING ----------

router.get('/branch-business-unit-mapping', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let q = tenantClient
            .from('branch_business_unit_mapping')
            .select('*, branches(branch_name), business_units(unit_name)')
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

router.post('/branch-business-unit-mapping', requireAuth, loadUserPermissions, requirePermission('company_settings', 'create'), async (req, res) => {
    try {
        const { branch_id, business_unit_id, is_primary, local_tax_rate } = req.body;
        if (!branch_id || !business_unit_id) {
            return res.status(400).json({ success: false, error: 'branch_id and business_unit_id are required' });
        }
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data, error } = await tenantClient
            .from('branch_business_unit_mapping')
            .insert({
                tenant_id: tenantId, branch_id, business_unit_id,
                is_primary: !!is_primary, local_tax_rate: local_tax_rate || null,
                created_by: req.auth.userId
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'This branch/business-unit pair is already mapped' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_branch_business_unit_mapping', 'branch_business_unit_mapping', data.id, { new_data: data });
        res.json({ success: true, message: 'Mapping created', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
