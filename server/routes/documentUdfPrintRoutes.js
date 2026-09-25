// =============================================
// routes/documentUdfPrintRoutes.js
//   /api/udf-values/...        User Defined Field values of a document
//                              (entry) and in bulk (every report)
//   /api/document-print/...    Manual Document Printing - filtered list,
//                              print log
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { REFERENCE_TABLE_MAP } = require('./userDefinedFieldRoutes');
const { udfFields, udfTypesOf, readDocUdf, udfHistory, saveDocUdf, lookupUdf, printList, logPrints, docTypeList } = require('../utils/documentCatalog');
const { csv } = require('../utils/tradeLines');

const send = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};

router.get('/document-types', requireAuth, (req, res) => res.json({ success: true, data: docTypeList() }));

// UDF definitions for reports: ?voucher_types=sales_bill,... or ?doc_types=sales_bill,production_order,...
router.get('/udf-values/fields', requireAuth, send((c, t, req) => {
    const types = [...new Set([...csv(req.query.voucher_types), ...csv(req.query.doc_types).flatMap(udfTypesOf)])];
    return udfFields(c, t, types);
}));

// Bulk lookup for reports. POST so thousands of ids fit.
router.post('/udf-values/lookup', requireAuth, send((c, t, req) => {
    const b = req.body || {};
    return lookupUdf(c, t, { documentIds: b.document_ids || [], lineIds: b.line_ids || [], fieldIds: b.field_ids || [] });
}));

// Values saved on earlier documents of this type (same party first): ?party_id=&exclude_id=&limit=
router.get('/udf-values/history/:docType', requireAuth, send((c, t, req) => udfHistory(c, t, {
    docType: req.params.docType, partyId: req.query.party_id || null, excludeId: req.query.exclude_id || null, limit: req.query.limit
})));

router.get('/udf-values/:docType/:docId', requireAuth, send((c, t, req) => readDocUdf(c, t, req.params.docType, req.params.docId)));

router.put('/udf-values/:docType/:docId', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), send(async (c, t, req) => {
    const out = await saveDocUdf(c, t, req.auth.userId, req.params.docType, req.params.docId, req.body || {}, REFERENCE_TABLE_MAP);
    await logAudit(t, req.auth.userId, 'UPDATE_UDF_VALUES', req.params.docType, req.params.docId, { saved: out.saved });
    return out;
}));

router.get('/document-print/list', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), send((c, t, req) => printList(c, t, req.query, req.auth.userId)));

router.post('/document-print/log', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), send((c, t, req) => {
    const b = req.body || {};
    return logPrints(c, t, req.auth.userId, b.document_type, (b.document_ids || []).slice(0, 500), b.template_id);
}));

module.exports = router;
