// =============================================
// routes/partyMasterRoutes.js
// FIX (this pass): deep-analysis of the Area/Route/Salesman module found
// it was missing:
//  1. Area hierarchy - an Area can optionally sit under a bigger "main
//     area" (e.g. "Pokhara" as the main area). Optional, not compulsory.
//  2. Route creation did not require an Area, even though a Route (e.g.
//     "Bagar", "Mahendrapool") only makes sense under one (e.g. Pokhara).
//     Now enforced both in the DB (NOT NULL) and here (400 if missing).
//  3. There was no way to attach customers (ledger accounts) to a Route
//     with a visiting sequence for the salesman's mobile order-taking
//     app. Added the route_customers endpoints below.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

// ---------- AREAS ----------

router.get('/areas', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('areas')
            .select('*, parent:parent_area_id(area_name)')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('area_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Flat list -> nested tree (main area -> sub-areas), for a hierarchy view.
router.get('/areas/tree', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('areas')
            .select('id, area_code, area_name, parent_area_id')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('area_name');
        if (error) throw error;

        const buildTree = (items, parentId = null) =>
            items.filter(a => (a.parent_area_id || null) === parentId).map(a => ({ ...a, children: buildTree(items, a.id) }));

        res.json({ success: true, data: buildTree(data, null) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/areas', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { area_name, parent_area_id, description } = req.body;
        if (!area_name || !area_name.trim()) return res.status(400).json({ success: false, error: 'Area name is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = area_name.trim().slice(0, 3).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_area_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('areas')
            .insert({
                tenant_id: tenantId,
                area_code: codeRow,
                area_name: area_name.trim(),
                // FIX: optional, not compulsory - a top-level area just omits this.
                parent_area_id: parent_area_id || null,
                description,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_area', 'area', data.id, { new_data: data });
        res.json({ success: true, message: 'Area created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/areas/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        if (req.body.parent_area_id === req.params.id) {
            return res.status(400).json({ success: false, error: 'An area cannot be its own main area' });
        }
        const { data: existing } = await tenantClient.from('areas').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        const { data, error } = await tenantClient
            .from('areas').update({ ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).select().single();
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_area', 'area', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- ROUTES ----------

router.get('/routes', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let q = tenantClient
            .from('routes')
            .select('*, areas(area_name), salesman_agents(agent_name)')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('route_name');
        if (req.query.area_id) q = q.eq('area_id', req.query.area_id);
        const { data, error } = await q;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/routes', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { route_name, area_id, default_agent_id, description } = req.body;
        if (!route_name || !route_name.trim()) return res.status(400).json({ success: false, error: 'Route name is required' });
        // FIX: Area is now mandatory when creating a Route.
        if (!area_id) return res.status(400).json({ success: false, error: 'Area is required to create a route' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: area } = await tenantClient.from('areas').select('id').eq('id', area_id).eq('tenant_id', tenantId).single();
        if (!area) return res.status(404).json({ success: false, error: 'Selected area not found' });

        const prefix = route_name.trim().slice(0, 3).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_route_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('routes')
            .insert({
                tenant_id: tenantId, route_code: codeRow, route_name: route_name.trim(),
                area_id, default_agent_id: default_agent_id || null, description,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select()
            .single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_route', 'route', data.id, { new_data: data });
        res.json({ success: true, message: 'Route created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- SALESMAN / AGENTS ----------

router.get('/salesman-agents', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('salesman_agents').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('agent_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/salesman-agents', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { agent_name, phone, email, commission_percentage, allow_rate_change_on_mobile_order } = req.body;
        if (!agent_name || !agent_name.trim()) return res.status(400).json({ success: false, error: 'Agent name is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = agent_name.trim().slice(0, 3).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_agent_code', { prefix });
        if (codeErr) throw codeErr;
        const { data, error } = await tenantClient
            .from('salesman_agents')
            .insert({ tenant_id: tenantId, agent_code: codeRow, agent_name: agent_name.trim(), phone, email, commission_percentage: commission_percentage || 0, allow_rate_change_on_mobile_order: !!allow_rate_change_on_mobile_order, created_by: req.auth.userId, updated_by: req.auth.userId })
            .select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_salesman_agent', 'salesman_agent', data.id, { new_data: data });
        res.json({ success: true, message: 'Salesman/Agent created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/salesman-agents/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { agent_name, phone, email, commission_percentage, allow_rate_change_on_mobile_order } = req.body;
        if (!agent_name || !agent_name.trim()) return res.status(400).json({ success: false, error: 'Agent name is required' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('salesman_agents').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Salesman/Agent not found' });
        const { data, error } = await tenantClient
            .from('salesman_agents')
            .update({ agent_name: agent_name.trim(), phone, email, commission_percentage: commission_percentage || 0, allow_rate_change_on_mobile_order: !!allow_rate_change_on_mobile_order, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id).eq('tenant_id', tenantId)
            .select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_salesman_agent', 'salesman_agent', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, message: 'Salesman/Agent updated successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: soft delete (is_active = false) rather than a hard DELETE,
// since existing sales/purchase documents reference this agent by id
// and must keep displaying its name; the GET list already filters to
// is_active = true so a soft-deleted agent simply stops appearing in
// new-entry pickers.
router.delete('/salesman-agents/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('salesman_agents').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Salesman/Agent not found' });
        const { error } = await tenantClient
            .from('salesman_agents')
            .update({ is_active: false, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'deactivate_salesman_agent', 'salesman_agent', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Salesman/Agent removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================
// ROUTE <-> CUSTOMER SEQUENCING
// FIX (new): powers "within a route, set the visiting sequence of
// customers" for the salesman's mobile order-taking app. A "customer" is
// any ledger account whose category_type is a party type; enforced here
// since the DB can't easily check that in a constraint.
// =========================================================

router.get('/routes/:routeId/customers', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('route_customers')
            .select('id, sequence_order, ledger_accounts(id, account_code, account_name, category_type)')
            .eq('route_id', req.params.routeId)
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('sequence_order', { ascending: true });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/routes/:routeId/customers', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { ledger_account_id } = req.body;
        if (!ledger_account_id) return res.status(400).json({ success: false, error: 'ledger_account_id is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: customer } = await tenantClient
            .from('ledger_accounts').select('id, category_type').eq('id', ledger_account_id).eq('tenant_id', tenantId).single();
        if (!customer) return res.status(404).json({ success: false, error: 'Ledger account not found' });
        if (!['sales', 'both'].includes(customer.category_type)) {
            return res.status(400).json({ success: false, error: 'Only customer ledgers (category sales/both) can be added to a route' });
        }

        // FIX: atomic append-at-end via the DB function, so two concurrent
        // "add customer" calls on the same route never compute the same
        // sequence number.
        const { data: nextSeq, error: seqErr } = await tenantClient.rpc('next_route_sequence', { p_route_id: req.params.routeId });
        if (seqErr) throw seqErr;

        const { data, error } = await tenantClient
            .from('route_customers')
            .insert({
                tenant_id: tenantId, route_id: req.params.routeId, ledger_account_id,
                sequence_order: nextSeq, created_by: req.auth.userId
            })
            .select()
            .single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'This customer is already on this route' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'add_customer_to_route', 'route_customer', data.id, { route_id: req.params.routeId, ledger_account_id });
        res.json({ success: true, message: 'Customer added to route', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Body: { order: [routeCustomerId1, routeCustomerId2, ...] } in the new
// desired visiting order - rewrites sequence_order 1..N accordingly.
router.put('/routes/:routeId/customers/reorder', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ success: false, error: 'order[] is required' });
        }
        const tenantClient = await getTenantClient(req.auth.tenantId);

        // Sequential updates (small lists - a route's daily customer count
        // is realistically dozens, not thousands) - simpler and safer than
        // a single bulk upsert with the risk of touching rows outside this route.
        for (let i = 0; i < order.length; i++) {
            const { error } = await tenantClient
                .from('route_customers')
                .update({ sequence_order: i + 1, updated_at: new Date().toISOString() })
                .eq('id', order[i])
                .eq('route_id', req.params.routeId)
                .eq('tenant_id', req.auth.tenantId);
            if (error) throw error;
        }
        await logAudit(req.auth.tenantId, req.auth.userId, 'reorder_route_customers', 'route', req.params.routeId, { new_order: order });
        res.json({ success: true, message: 'Route sequence updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/routes/:routeId/customers/:routeCustomerId', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { error } = await tenantClient
            .from('route_customers')
            .delete()
            .eq('id', req.params.routeCustomerId)
            .eq('route_id', req.params.routeId)
            .eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'remove_customer_from_route', 'route_customer', req.params.routeCustomerId, { route_id: req.params.routeId });
        res.json({ success: true, message: 'Customer removed from route' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
