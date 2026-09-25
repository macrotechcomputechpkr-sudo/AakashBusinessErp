// =============================================
// routes/transportRoutes.js
// Transport Master - Vendor Ledger AND/OR Sub-Ledger, completing the
// "Transporter" field referenced in voucher_field_catalog for Sales
// Delivery / Purchase GRN. Both links can be set at once.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

function validateTransportBody(body) {
    if (!body.vendor_ledger_id && !body.sub_ledger_id) {
        return 'Select at least one: a Vendor Ledger or a Sub-Ledger';
    }
    return null;
}

router.get('/transport-master', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('transport_master')
            .select('*, vendor_ledger:vendor_ledger_id(account_name, account_code), sub_ledger:sub_ledger_id(sub_ledger_name, sub_ledger_code)')
            .eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('transport_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/transport-master', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { transport_name } = req.body;
        if (!transport_name || !transport_name.trim()) return res.status(400).json({ success: false, error: 'Transport Name is required' });

        const validationError = validateTransportBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = transport_name.trim().slice(0, 4).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_transport_code', { prefix });
        if (codeErr) throw codeErr;

        const b = req.body;
        // FEATURE: Short Name auto-generates from Name's initials + a
        // true sequential number when not supplied - same pattern as
        // Ledger Accounts.
        let shortName = b.short_name;
        if (!shortName) {
            const initials = transport_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'GEN';
            const { data: shortNameRow, error: shortNameErr } = await tenantClient.rpc('next_short_name', { seq_name: 'tenant_master.seq_transport_short_name', initials });
            if (shortNameErr) throw shortNameErr;
            shortName = shortNameRow;
        }

        const { data, error } = await tenantClient
            .from('transport_master')
            .insert({
                tenant_id: tenantId, transport_code: codeRow, transport_name: transport_name.trim(),
                short_name: shortName,
                vendor_ledger_id: b.vendor_ledger_id || null,
                sub_ledger_id: b.sub_ledger_id || null,
                contact_person: b.contact_person || null, phone: b.phone || null,
                email: b.email || null, address: b.address || null,
                display_order: b.display_order || 1,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A transport with this name already exists' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Select at least one: a Vendor Ledger or a Sub-Ledger' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_transport', 'transport_master', data.id, { new_data: data });
        res.json({ success: true, message: 'Transport created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/transport-master/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('transport_master').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Transport not found' });

        const merged = { ...existing, ...req.body };
        const validationError = validateTransportBody(merged);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        const { data, error } = await tenantClient
            .from('transport_master').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A transport with this name already exists' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Select at least one: a Vendor Ledger or a Sub-Ledger' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_transport', 'transport_master', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/transport-master/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('transport_master').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient.from('transport_master').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_transport', 'transport_master', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Transport deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
