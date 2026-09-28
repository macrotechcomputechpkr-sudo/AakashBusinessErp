// =============================================
// routes/documentActionRoutes.js
// Actions every transaction screen offers from its list:
//   Modify  - a draft opens for edit; a posted / confirmed one is first
//             cancelled by its own status route (which reverses its ledger,
//             stock and progress), then reopened here as a draft with the
//             same number, edited and posted again
//   Remove  - a draft is deleted; anything else is cancelled, reopened and
//             then deleted
//   Reverse - its own status route's cancel (reverses every effect)
//   Copy    - the screen loads it as a new entry
//   Hold    - an unfinished entry parked by the user and recalled later
// With System Control "IRD Billing" on, a Sales Bill / Sales Return can
// only be cancelled: it is never reopened (so never modified or removed).
//   GET    /document-actions/policy?type=           what the list may offer
//   POST   /document-actions/:type/:id/reopen       cancelled -> draft
//   GET    /held-entries?voucher_type=              this user's held entries
//   POST   /held-entries  { voucher_type, label, payload }
//   DELETE /held-entries/:id
//   GET    /entry-templates?voucher_type=           company templates + this user's own
//   POST   /entry-templates { voucher_type, template_name, payload, is_personal }
//   DELETE /entry-templates/:id
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const DOC_TABLES = {
    sales_quotation: 'sales_quotations', sales_order: 'sales_orders', sales_delivery: 'sales_deliveries', sales_bill: 'sales_bills',
    sales_return: 'sales_returns', sales_nonsalable_return: 'sales_nonsaleable_returns', sales_additional: 'sales_additional_entries',
    purchase_requisition: 'purchase_requisitions', purchase_quotation: 'purchase_quotations', purchase_order: 'purchase_orders',
    purchase_grn: 'purchase_grns', purchase_bill: 'purchase_bills', purchase_return: 'purchase_returns',
    purchase_nonsalable_return: 'purchase_nonsaleable_returns', purchase_additional: 'purchase_additional_expenses',
    cash_bank_entry: 'cash_bank_entries', journal: 'journal_vouchers', pdc: 'pdc_vouchers', stock_transfer: 'stock_transfers', production: 'production_orders'
};
// documents an IRD billing company may only cancel
const IRD_LOCKED = ['sales_bill', 'sales_return'];
const REOPENABLE = ['cancelled', 'rejected'];
const CLEAR_ON_REOPEN = ['cancellation_reason', 'cancelled_at', 'cancelled_by', 'posted_at', 'posted_by', 'approved_at', 'approved_by'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message });

async function irdBilling(c, t) {
    const { data } = await c.from('system_control_settings').select('ird_billing').eq('tenant_id', t).maybeSingle();
    return !!(data && data.ird_billing);
}
/** true when this document type may only be cancelled (IRD billing on) */
async function isIrdLocked(c, t, type) {
    return IRD_LOCKED.includes(type) && irdBilling(c, t);
}

router.get('/document-actions/policy', requireAuth, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const ird = await irdBilling(c, req.auth.tenantId);
        const type = req.query.type;
        const locked = ird && IRD_LOCKED.includes(type);
        res.json({ success: true, data: { ird_billing: ird, locked, locked_types: ird ? IRD_LOCKED : [],
            // IRD (computerized) billing: a posted Sales Bill / Return is only reversed; otherwise the full set
            actions: locked ? ['create', 'copy', 'template', 'print', 'reverse', 'modify_draft', 'remove_draft'] : ['create', 'copy', 'template', 'print', 'cancel', 'modify', 'remove', 'draft'] } });
    } catch (e) { fail(res, e); }
});

router.post('/document-actions/:type/:id/reopen', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { type, id } = req.params;
        const table = DOC_TABLES[type];
        if (!table) return res.status(400).json({ success: false, error: 'Unknown document type' });
        if (!UUID.test(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const t = req.auth.tenantId, c = await getTenantClient(t);
        if (await isIrdLocked(c, t, type)) return res.status(400).json({ success: false, error: 'IRD Billing is on - a Sales Bill / Sales Return can only be cancelled, not modified or removed' });
        const { data: doc, error } = await c.from(table).select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
        if (error) throw error;
        if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
        if (doc.audit_locked) return res.status(400).json({ success: false, error: 'This voucher is audit-locked - unlock it first' });
        if (doc.status === 'draft') return res.json({ success: true, data: doc });
        if (!REOPENABLE.includes(doc.status)) return res.status(400).json({ success: false, error: `A ${doc.status} document must be cancelled (reversed) before it can be reopened` });
        const update = { status: 'draft', updated_by: req.auth.userId };
        CLEAR_ON_REOPEN.forEach(k => { if (k in doc) update[k] = null; });
        const { data, error: e2 } = await c.from(table).update(update).eq('tenant_id', t).eq('id', id).select().single();
        if (e2) throw e2;
        await logAudit(t, req.auth.userId, 'reopen_document', type, id, { from_status: doc.status, cancellation_reason: doc.cancellation_reason || null });
        res.json({ success: true, data });
    } catch (e) { fail(res, e); }
});

// Hold / recall ---------------------------------------------------------------
const MAX_HELD = 50, MAX_PAYLOAD = 500000;

router.get('/held-entries', requireAuth, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        let q = c.from('held_entries').select('*').eq('tenant_id', req.auth.tenantId).eq('user_id', req.auth.userId).order('created_at', { ascending: false });
        if (req.query.voucher_type) q = q.eq('voucher_type', req.query.voucher_type);
        const { data, error } = await q;
        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (e) { fail(res, e); }
});

router.post('/held-entries', requireAuth, async (req, res) => {
    try {
        const { voucher_type: vt, label, payload } = req.body || {};
        if (!DOC_TABLES[vt] && !/^[a-z_]{3,50}$/.test(vt || '')) return res.status(400).json({ success: false, error: 'Invalid voucher_type' });
        if (!payload || typeof payload !== 'object') return res.status(400).json({ success: false, error: 'Nothing to hold' });
        if (JSON.stringify(payload).length > MAX_PAYLOAD) return res.status(400).json({ success: false, error: 'This entry is too large to hold' });
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const { count } = await c.from('held_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', t).eq('user_id', req.auth.userId).eq('voucher_type', vt);
        if ((count || 0) >= MAX_HELD) return res.status(400).json({ success: false, error: `You already have ${MAX_HELD} held entries here - recall or discard some first` });
        const { data, error } = await c.from('held_entries').insert({ tenant_id: t, user_id: req.auth.userId, voucher_type: vt, label: String(label || '').slice(0, 200) || null, payload }).select().single();
        if (error) throw error;
        res.json({ success: true, data });
    } catch (e) { fail(res, e); }
});

router.delete('/held-entries/:id', requireAuth, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const { error } = await c.from('held_entries').delete().eq('tenant_id', req.auth.tenantId).eq('user_id', req.auth.userId).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e) { fail(res, e); }
});

// Templates -------------------------------------------------------------------
const MAX_TEMPLATES = 100;
const validType = vt => !!DOC_TABLES[vt] || /^[a-z_]{3,50}$/.test(vt || '');

router.get('/entry-templates', requireAuth, async (req, res) => {
    try {
        const vt = req.query.voucher_type;
        if (!validType(vt)) return res.status(400).json({ success: false, error: 'Invalid voucher_type' });
        const c = await getTenantClient(req.auth.tenantId);
        const { data, error } = await c.from('entry_templates').select('*').eq('tenant_id', req.auth.tenantId).eq('voucher_type', vt).order('template_name');
        if (error) throw error;
        // personal templates only for the user who made them
        res.json({ success: true, data: (data || []).filter(x => !x.is_personal || x.created_by === req.auth.userId) });
    } catch (e) { fail(res, e); }
});

router.post('/entry-templates', requireAuth, async (req, res) => {
    try {
        const { voucher_type: vt, template_name: name, payload, is_personal: personal } = req.body || {};
        if (!validType(vt)) return res.status(400).json({ success: false, error: 'Invalid voucher_type' });
        const nm = String(name || '').trim().slice(0, 150);
        if (!nm) return res.status(400).json({ success: false, error: 'Template name is required' });
        if (!payload || typeof payload !== 'object') return res.status(400).json({ success: false, error: 'Nothing to save' });
        if (JSON.stringify(payload).length > MAX_PAYLOAD) return res.status(400).json({ success: false, error: 'This entry is too large for a template' });
        const t = req.auth.tenantId, c = await getTenantClient(t);
        // the same name again replaces that template
        const { data: same } = await c.from('entry_templates').select('id, created_by, is_personal').eq('tenant_id', t).eq('voucher_type', vt).ilike('template_name', nm);
        const mine = (same || [])[0];
        if (mine) {
            if (mine.is_personal && mine.created_by !== req.auth.userId) return res.status(409).json({ success: false, error: 'Another user has a template with this name' });
            const { data, error } = await c.from('entry_templates').update({ payload, is_personal: !!personal, updated_at: new Date().toISOString() }).eq('tenant_id', t).eq('id', mine.id).select().single();
            if (error) throw error;
            return res.json({ success: true, data, replaced: true });
        }
        const { count } = await c.from('entry_templates').select('id', { count: 'exact', head: true }).eq('tenant_id', t).eq('voucher_type', vt);
        if ((count || 0) >= MAX_TEMPLATES) return res.status(400).json({ success: false, error: `There are already ${MAX_TEMPLATES} templates for this screen` });
        const { data, error } = await c.from('entry_templates').insert({ tenant_id: t, voucher_type: vt, template_name: nm, payload, is_personal: !!personal, created_by: req.auth.userId }).select().single();
        if (error) throw error;
        res.json({ success: true, data });
    } catch (e) { fail(res, e); }
});

router.delete('/entry-templates/:id', requireAuth, async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const { data: row } = await c.from('entry_templates').select('id, is_personal, created_by').eq('tenant_id', t).eq('id', req.params.id).maybeSingle();
        if (!row) return res.status(404).json({ success: false, error: 'Template not found' });
        if (row.is_personal && row.created_by !== req.auth.userId) return res.status(403).json({ success: false, error: 'Not your template' });
        const { error } = await c.from('entry_templates').delete().eq('tenant_id', t).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e) { fail(res, e); }
});

module.exports = router;
module.exports.isIrdLocked = isIrdLocked;
module.exports.DOC_TABLES = DOC_TABLES;
