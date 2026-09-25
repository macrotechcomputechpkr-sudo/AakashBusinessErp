// =============================================
// routes/bankRecoRoutes.js
//   /api/bank-reco/...          Bank Reconciliation (utils/bankReco.js)
//   /api/reports/funds-position Net Position of Funds (utils/fundsPosition.js)
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const R = require('../utils/bankReco');
const { fundsPosition } = require('../utils/fundsPosition');

const view = [requireAuth, loadUserPermissions, requirePermission('ledger', 'view')];
const edit = [requireAuth, loadUserPermissions, requirePermission('ledger', 'edit')];
const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};
const audit = (req, action, id, details) => logAudit(req.auth.tenantId, req.auth.userId, action, 'bank_reconciliation', id, details);

router.get('/bank-reco/ledgers', ...view, send((c, t) => R.cashBankLedgers(c, t)));
router.get('/bank-reco/book', ...view, send((c, t, req) => {
    const q = req.query;
    if (!q.bank_ledger_id) throw Object.assign(new Error('Choose the bank ledger'), { status: 400 });
    return R.bookLines(c, t, q.bank_ledger_id, { from: q.from || null, to: q.to || null, uncleared: q.uncleared !== 'false' });
}));
router.get('/bank-reco/statement-lines', ...view, send((c, t, req) => R.statementLines(c, t, req.query.bank_ledger_id, { from: req.query.from || null, to: req.query.to || null, status: req.query.status || null })));
router.get('/bank-reco/statements', ...view, send((c, t, req) => R.statements(c, t, req.query.bank_ledger_id)));
router.post('/bank-reco/statements', ...edit, send(async (c, t, req) => {
    const out = await R.importStatement(c, t, req.auth.userId, req.body || {});
    await audit(req, 'IMPORT_BANK_STATEMENT', out.statement_id, { bank_ledger_id: req.body.bank_ledger_id, imported: out.imported, skipped: out.skipped_duplicates });
    return out;
}));
router.delete('/bank-reco/statements/:id', ...edit, send(async (c, t, req) => {
    const out = await R.deleteStatement(c, t, req.query.bank_ledger_id, req.params.id);
    await audit(req, 'DELETE_BANK_STATEMENT', req.params.id, out);
    return out;
}));
router.post('/bank-reco/auto-match', ...edit, send((c, t, req) => R.autoMatch(c, t, req.auth.userId, req.body || {})));
router.post('/bank-reco/match', ...edit, send((c, t, req) => R.linkLines(c, t, req.auth.userId, req.body.bank_ledger_id, req.body.statement_line_id, req.body.book_line_ids, 'manual', null)));
router.post('/bank-reco/unmatch', ...edit, send((c, t, req) => R.unlinkStatementLine(c, t, req.body.bank_ledger_id, req.body.statement_line_id)));
router.post('/bank-reco/ignore', ...edit, send((c, t, req) => R.setIgnored(c, t, req.body.bank_ledger_id, req.body.statement_line_ids || [], req.body.ignored !== false, req.body.remarks)));
router.post('/bank-reco/clear', ...edit, send(async (c, t, req) => {
    const out = await R.clearManual(c, t, req.auth.userId, req.body.bank_ledger_id, req.body.items);
    await audit(req, 'BANK_RECO_CLEAR', req.body.bank_ledger_id, out);
    return out;
}));
router.post('/bank-reco/unclear', ...edit, send((c, t, req) => R.unclear(c, t, req.body.bank_ledger_id, req.body.line_ids || [])));
router.get('/bank-reco/brs', ...view, send((c, t, req) => R.brs(c, t, req.query.bank_ledger_id, req.query.as_on)));

router.get('/reports/funds-position', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), send((c, t, req) => fundsPosition(c, t, req.query)));

module.exports = router;
