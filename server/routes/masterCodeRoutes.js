// =============================================
// routes/masterCodeRoutes.js
// GET /master-codes/next?master=ledger&name=...  -> code the new record will get
//      (shown read-only on the create form) + a suggested short name
// GET /master-codes/formats                     -> TYPE / separator / digits per master
// PUT /master-codes/formats                     -> change them (System Control)
// Logic: utils/masterCodes.js
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const MC = require('../utils/masterCodes');

router.get('/master-codes/next', requireAuth, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId;
        const master = String(req.query.master || '');
        res.json({ success: true, data: { code: await MC.preview(c, t, master), short_name: req.query.name ? await MC.shortNamePreview(c, t, master, req.query.name) : '' } });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});

router.get('/master-codes/formats', requireAuth, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId;
        const f = await MC.formats(c, t), fy = await MC.currentFy(c, t);
        res.json({ success: true, data: { fy, use_fy: Object.values(f)[0].use_fy, masters: Object.values(f).map(x => ({ ...x, example: MC.build(x, fy || '8182', 1) })) } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.put('/master-codes/formats', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId;
        const b = req.body || {};
        const out = { use_fy: b.use_fy !== false };
        const prefixes = new Set();
        for (const m of Array.isArray(b.masters) ? b.masters : []) {
            if (!MC.MASTERS[m.key]) continue;
            const prefix = String(m.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
            if (!prefix) return res.status(400).json({ success: false, error: `${MC.MASTERS[m.key].label}: type letters are required` });
            if (/^\d/.test(prefix)) return res.status(400).json({ success: false, error: `${MC.MASTERS[m.key].label}: type must start with a letter` });
            if (prefixes.has(prefix)) return res.status(400).json({ success: false, error: `Type "${prefix}" is used for two masters` });
            prefixes.add(prefix);
            out[m.key] = { prefix, sep: ['', '-', '/'].includes(m.sep) ? m.sep : '', digits: Math.min(9, Math.max(3, parseInt(m.digits, 10) || 6)) };
        }
        await c.rpc('ensure_system_control_settings', { p_tenant_id: t });
        const { error } = await c.from('system_control_settings').update({ master_code_format: out, updated_by: req.auth.userId, updated_at: new Date().toISOString() }).eq('tenant_id', t);
        if (error) throw error;
        res.json({ success: true, data: out });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
