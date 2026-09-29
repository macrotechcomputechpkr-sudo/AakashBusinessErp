// =============================================
// routes/firmImportRoutes.js
// Tools > Import from another Firm (pages/FirmImport.jsx, utils/firmImport.js)
//   GET  /firm-import/sources   the other firms (companies) this user can open
//   GET  /firm-import/preview   what the chosen firm has and what exists here
//   POST /firm-import/run       masters (matched by code) + transactions (as drafts)
// Only firms the user may open (own company or company access) can be a source.
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, getUserTenants, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const F = require('../utils/firmImport');

const guard = [requireAuth, loadUserPermissions, requirePermission('ledger', 'create')];
const fail = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message });

async function sourceFirm(req, id) {
    if (!id) throw Object.assign(new Error('Choose the firm to import from'), { status: 400 });
    if (id === req.auth.tenantId) throw Object.assign(new Error('Choose another firm - this is the firm you are in'), { status: 400 });
    const list = await getUserTenants(req.auth.userId, false);
    const firm = (list || []).find(t => t.id === id);
    if (!firm) throw Object.assign(new Error('You do not have access to that firm'), { status: 403 });
    return firm;
}

router.get('/firm-import/sources', ...guard, async (req, res) => {
    try {
        const list = await getUserTenants(req.auth.userId, false);
        res.json({ success: true, data: { firms: (list || []).filter(t => t.id !== req.auth.tenantId).map(t => ({ id: t.id, tenant_code: t.tenant_code, company_name: t.company_name })),
            masters: F.MASTERS.map(m => ({ key: m.key, label: m.label, needs: m.needs, has_opening: !!m.opening })), transactions: F.TXNS.map(x => ({ key: x.key, label: x.label, api: x.api })), txn_needs: F.TXN_NEEDS } });
    } catch (e) { fail(res, e); }
});

router.get('/firm-import/preview', ...guard, async (req, res) => {
    try {
        const firm = await sourceFirm(req, req.query.source_tenant_id);
        const [src, tgt] = await Promise.all([getTenantClient(firm.id), getTenantClient(req.auth.tenantId)]);
        res.json({ success: true, data: { firm, ...(await F.preview(src, tgt, firm.id, req.auth.tenantId, req.query)) } });
    } catch (e) { fail(res, e); }
});

router.post('/firm-import/run', ...guard, async (req, res) => {
    try {
        const b = req.body || {};
        const firm = await sourceFirm(req, b.source_tenant_id);
        if (!(b.masters || []).length && !(b.transactions || []).length) return res.status(400).json({ success: false, error: 'Tick the masters and / or transactions to import' });
        const [src, tgt] = await Promise.all([getTenantClient(firm.id), getTenantClient(req.auth.tenantId)]);
        const report = await F.run(src, tgt, firm.id, req.auth.tenantId, b, req.auth.userId, firm.tenant_code || firm.company_name);
        await logAudit(req.auth.tenantId, req.auth.userId, 'firm_import', 'tenant', firm.id, { masters: b.masters, transactions: b.transactions, totals: report.totals });
        res.json({ success: true, data: report, message: `Imported from ${firm.company_name}: ${report.totals.masters_inserted} new masters, ${report.totals.documents} documents as drafts${report.totals.failed ? `, ${report.totals.failed} failed` : ''}` });
    } catch (e) { fail(res, e); }
});

module.exports = router;
