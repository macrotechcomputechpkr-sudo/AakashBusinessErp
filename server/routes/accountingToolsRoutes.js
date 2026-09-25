// =============================================
// routes/accountingToolsRoutes.js
//   /api/document-templates           letter / barcode label designs
//   /api/confirmation-letters         balance confirmation data
//   /api/interest/...                 interest on overdue: calculate, post, cancel, register
//   /api/lc-bg/...                    LC / BG / PDC dashboard, reports, actions, BG register
//   /api/fixed-assets/...             asset register, depreciation, disposal, reports
//   /api/dimension-reports/...        ledger / sub-ledger / cost center / unit / branch / doc class
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { confirmationData } = require('../utils/confirmation');
const I = require('../utils/interest');
const L = require('../utils/lcBg');
const FA = require('../utils/fixedAssets');
const D = require('../utils/dimensionReports');

const view = [requireAuth, loadUserPermissions, requirePermission('ledger', 'view')];
const edit = [requireAuth, loadUserPermissions, requirePermission('ledger', 'edit')];
const reports = [requireAuth, loadUserPermissions, requirePermission('reports', 'view')];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};
const audit = (req, action, type, id, details) => logAudit(req.auth.tenantId, req.auth.userId, action, type, id, details || {});

// ---------- templates ----------
router.get('/document-templates', requireAuth, send(async (c, t, req) => {
    let q = c.from('document_templates').select('*').eq('tenant_id', t);
    if (req.query.type) q = q.eq('template_type', req.query.type);
    const { data, error } = await q.order('template_name');
    if (error) throw error; return data || [];
}));
router.post('/document-templates', ...edit, send(async (c, t, req) => {
    const b = req.body || {};
    if (!b.template_type || !String(b.template_name || '').trim()) throw Object.assign(new Error('Type and name are required'), { status: 400 });
    if (b.is_default) await c.from('document_templates').update({ is_default: false }).eq('tenant_id', t).eq('template_type', b.template_type);
    const { data, error } = await c.from('document_templates').insert({ tenant_id: t, template_type: b.template_type, template_name: b.template_name.trim(), is_default: !!b.is_default, config: b.config || {}, created_by: req.auth.userId }).select().single();
    if (error) throw error; return data;
}));
router.put('/document-templates/:id', ...edit, send(async (c, t, req) => {
    const b = req.body || {};
    const { data: cur } = await c.from('document_templates').select('*').eq('tenant_id', t).eq('id', req.params.id).maybeSingle();
    if (!cur) throw Object.assign(new Error('Template not found'), { status: 404 });
    if (b.is_default) await c.from('document_templates').update({ is_default: false }).eq('tenant_id', t).eq('template_type', cur.template_type).neq('id', cur.id);
    const up = { updated_by: req.auth.userId, updated_at: new Date().toISOString() };
    ['template_name', 'is_default', 'config'].forEach(k => { if (b[k] !== undefined) up[k] = b[k]; });
    const { data, error } = await c.from('document_templates').update(up).eq('id', cur.id).select().single();
    if (error) throw error; return data;
}));
router.delete('/document-templates/:id', ...edit, send(async (c, t, req) => {
    const { error } = await c.from('document_templates').delete().eq('tenant_id', t).eq('id', req.params.id);
    if (error) throw error; return { ok: true };
}));

// ---------- confirmation letters ----------
router.get('/confirmation-letters', ...reports, send((c, t, req) => confirmationData(c, t, req.query)));

// ---------- interest ----------
router.get('/interest/calculate', ...reports, send((c, t, req) => I.computeInterest(c, t, req.query)));
router.post('/interest/post', ...edit, send(async (c, t, req) => { const out = await I.postInterest(c, t, req.auth.userId, req.body || {}); await audit(req, 'POST_INTEREST', 'interest_run', out.run_id, out); return out; }));
router.post('/interest/runs/:id/cancel', ...edit, send(async (c, t, req) => { const out = await I.cancelInterest(c, t, req.auth.userId, req.params.id, (req.body || {}).reason); await audit(req, 'CANCEL_INTEREST', 'interest_run', req.params.id, { reason: req.body.reason }); return out; }));
router.get('/interest/register', ...reports, send((c, t, req) => I.interestRegister(c, t, req.query)));

// ---------- LC / BG / PDC ----------
router.get('/lc-bg/dashboard', ...view, send((c, t, req) => L.dashboard(c, t, req.query)));
router.get('/lc-bg/lc-report', ...view, send((c, t, req) => L.lcReport(c, t, req.query)));
router.get('/lc-bg/bg-report', ...view, send((c, t, req) => L.bgReport(c, t, req.query)));
router.get('/lc-bg/party/:ledgerId', ...view, send((c, t, req) => L.partyInstruments(c, t, req.params.ledgerId)));
router.post('/lc-bg/lc/:id/action', ...edit, send(async (c, t, req) => { const out = await L.lcAction(c, t, req.auth.userId, req.params.id, req.body || {}); await audit(req, `LC_${String(req.body.action).toUpperCase()}`, 'letter_of_credit', req.params.id, out.updated); return out; }));
router.post('/lc-bg/bg/:id/action', ...edit, send(async (c, t, req) => { const out = await L.bgAction(c, t, req.auth.userId, req.params.id, req.body || {}); await audit(req, `BG_${String(req.body.action).toUpperCase()}`, 'bank_guarantee', req.params.id, out.updated); return out; }));
router.post('/lc-bg/bg', ...edit, send((c, t, req) => L.saveBg(c, t, req.auth.userId, null, req.body || {})));
router.put('/lc-bg/bg/:id', ...edit, send((c, t, req) => L.saveBg(c, t, req.auth.userId, req.params.id, req.body || {})));

// ---------- fixed assets ----------
router.get('/fixed-assets', ...view, send(async (c, t, req) => (await FA.loadAssets(c, t, req.query)).map(a => ({ ...a, accumulated: FA.accumulatedUpto(a, '9999-12-31'), book_value: Math.round((a.cost - FA.accumulatedUpto(a, '9999-12-31')) * 100) / 100, entries: undefined }))));
router.post('/fixed-assets', ...edit, send((c, t, req) => FA.saveAsset(c, t, req.auth.userId, null, req.body || {})));
router.put('/fixed-assets/:id', ...edit, send((c, t, req) => FA.saveAsset(c, t, req.auth.userId, req.params.id, req.body || {})));
router.get('/fixed-assets/depreciation/preview', ...view, send((c, t, req) => FA.previewDepreciation(c, t, req.query)));
router.post('/fixed-assets/depreciation/post', ...edit, send(async (c, t, req) => { const out = await FA.postDepreciation(c, t, req.auth.userId, req.body || {}); await audit(req, 'POST_DEPRECIATION', 'depreciation_run', out.run_id, out); return out; }));
router.post('/fixed-assets/:id/dispose', ...edit, send(async (c, t, req) => { const out = await FA.disposeAsset(c, t, req.auth.userId, req.params.id, req.body || {}); await audit(req, 'DISPOSE_ASSET', 'fixed_asset', req.params.id, out); return out; }));
router.post('/fixed-assets/runs/:id/cancel', ...edit, send(async (c, t, req) => { const out = await FA.cancelRun(c, t, req.auth.userId, req.params.id, (req.body || {}).reason); await audit(req, 'CANCEL_DEPRECIATION', 'depreciation_run', req.params.id, { reason: req.body.reason }); return out; }));
router.get('/fixed-assets/schedule', ...reports, send((c, t, req) => FA.assetSchedule(c, t, req.query)));
router.get('/fixed-assets/depreciation-detail', ...reports, send((c, t, req) => FA.depreciationDetail(c, t, req.query)));

// ---------- barcode label sources: a GRN / purchase bill's items ----------
const LABEL_SOURCES = { purchase_bill: ['purchase_bills', 'purchase_bill_details', 'bill_id'], purchase_grn: ['purchase_grns', 'purchase_grn_details', 'grn_id'] };
router.get('/barcode/sources', ...view, send(async (c, t, req) => {
    const src = LABEL_SOURCES[req.query.type]; if (!src) return [];
    let q = c.from(src[0]).select('id, doc_no, doc_date, vendor_name_snapshot, status').eq('tenant_id', t);
    if (req.query.search) q = q.ilike('doc_no', `%${req.query.search}%`);
    const { data, error } = await q.order('doc_date', { ascending: false }).limit(100);
    if (error) throw error; return data || [];
}));
router.get('/barcode/source-lines', ...view, send(async (c, t, req) => {
    const src = LABEL_SOURCES[req.query.type]; if (!src || !req.query.id) return [];
    const { data: head } = await c.from(src[0]).select('id').eq('tenant_id', t).eq('id', req.query.id).maybeSingle();
    if (!head) throw Object.assign(new Error('Document not found'), { status: 404 });
    const { data, error } = await c.from(src[1]).select('*').eq(src[2], req.query.id).order('display_order');
    if (error) throw error;
    return (data || []).map(d => ({ product_id: d.product_id, qty: Number(d.qty) || 0, free_qty: Number(d.free_qty) || 0, uom_id: d.uom_id || null, batch_no: d.batch_no || '',
        mfg_date: d.mfg_date || d.batch_mfg_date || '', exp_date: d.exp_date || d.batch_exp_date || '', rate: Number(d.rate) || 0, mrp: Number(d.mrp) || 0 }));
}));

// ---------- dimension reports ----------
router.get('/dimension-reports/meta', ...reports, send((c, t) => D.dimensionMeta(c, t)));
router.get('/dimension-reports/pivot', ...reports, send((c, t, req) => D.pivot(c, t, req.query)));
router.get('/dimension-reports/pl', ...reports, send((c, t, req) => D.plByDimension(c, t, req.query)));
router.get('/dimension-reports/statement', ...reports, send((c, t, req) => D.statement(c, t, req.query)));
router.get('/dimension-reports/exceptions', ...reports, send((c, t, req) => D.exceptions(c, t, req.query)));
router.get('/dimension-reports/doc-class', ...reports, send((c, t, req) => D.docClassRegister(c, t, req.query)));

module.exports = router;
