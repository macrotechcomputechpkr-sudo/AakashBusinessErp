// =============================================
// routes/entryHelperRoutes.js
// Shared helpers of every sales / purchase entry screen:
//   GET  /pending-documents?target=sales_bill&party_id=&types=   earlier documents of the party with qty left
//   GET  /pending-documents/:type/:id?target=                    one of them, to view before pulling
//   POST /pending-documents/pull  { target, docs:[{type,id}] }   their pending lines, ready for the entry
//   GET  /document-numbering/next?voucher_type=&category_id=     the number a new entry will get
//   GET  /party-info/:ledgerId                                   billing / shipping address, PAN, phone
//   PUT  /documents/:type/:id/party-info                         party details of a saved entry
//        { billing_address, shipping_address, pan, phone, email, update_master }
// Logic: utils/pendingDocs.js, utils/documentNumbering.js
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const pending = require('../utils/pendingDocs');
const { previewDocumentNumber } = require('../utils/documentNumbering');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message });
const view = [requireAuth, loadUserPermissions, requirePermission('ledger', 'view')];

router.get('/pending-documents', ...view, async (req, res) => {
    try { res.json({ success: true, data: await pending.list(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.query) }); } catch (e) { fail(res, e); }
});
router.get('/pending-documents/:type/:id', ...view, async (req, res) => {
    try { res.json({ success: true, data: await pending.detail(await getTenantClient(req.auth.tenantId), req.auth.tenantId, { target: req.query.target, type: req.params.type, id: req.params.id }) }); } catch (e) { fail(res, e); }
});
router.post('/pending-documents/pull', ...view, async (req, res) => {
    try { res.json({ success: true, data: await pending.pull(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.body || {}) }); } catch (e) { fail(res, e); }
});

router.get('/document-numbering/next', requireAuth, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId;
        if (!req.query.voucher_type) return res.status(400).json({ success: false, error: 'voucher_type is required' });
        const [{ data: user }, { data: fy }] = await Promise.all([
            c.from('users').select('default_branch_id').eq('id', req.auth.userId).maybeSingle(),
            c.from('fiscal_years').select('id, fiscal_year_name').eq('tenant_id', t).eq('is_current', true).maybeSingle()
        ]);
        res.json({ success: true, data: await previewDocumentNumber(c, {
            tenantId: t, voucherType: req.query.voucher_type, userId: req.auth.userId, categoryId: UUID.test(req.query.category_id || '') ? req.query.category_id : null,
            currentFiscalYearId: fy?.id, currentFiscalYearName: fy?.fiscal_year_name, userDefaultBranchId: user?.default_branch_id, docDate: req.query.doc_date
        }) });
    } catch (e) { fail(res, e); }
});

// party details ------------------------------------------------------------
const PARTY_DOCS = {
    sales_quotation: ['sales_quotations', 'customer_ledger_id'], sales_order: ['sales_orders', 'customer_ledger_id'], sales_delivery: ['sales_deliveries', 'customer_ledger_id'],
    sales_bill: ['sales_bills', 'customer_ledger_id'], sales_return: ['sales_returns', 'customer_ledger_id'], sales_nonsalable_return: ['sales_nonsaleable_returns', 'customer_ledger_id'],
    purchase_requisition: ['purchase_requisitions', 'vendor_ledger_id'], purchase_quotation: ['purchase_quotations', 'vendor_ledger_id'], purchase_order: ['purchase_orders', 'vendor_ledger_id'],
    purchase_grn: ['purchase_grns', 'vendor_ledger_id'], purchase_bill: ['purchase_bills', 'vendor_ledger_id'], purchase_return: ['purchase_returns', 'vendor_ledger_id'],
    purchase_nonsalable_return: ['purchase_nonsaleable_returns', 'vendor_ledger_id']
};
const clean = (v, n) => (v === undefined ? undefined : (String(v || '').trim().slice(0, n) || null));
const addressOf = l => l.billing_address || [l.street, l.city, l.state, l.country].filter(Boolean).join(', ') || null;

router.get('/party-info/:ledgerId', ...view, async (req, res) => {
    try {
        const c = await getTenantClient(req.auth.tenantId);
        const { data: l } = await c.from('ledger_accounts').select('*').eq('tenant_id', req.auth.tenantId).eq('id', req.params.ledgerId).maybeSingle();
        if (!l) return res.status(404).json({ success: false, error: 'Ledger not found' });
        res.json({ success: true, data: { billing_address: addressOf(l), shipping_address: l.shipping_address || addressOf(l), pan: l.pan_number || l.vat_pan_number || null,
            phone: l.contact_person_mobile || l.phone_office || l.contact_person_phone || null, email: l.email || null, billing_name: l.billing_name || l.account_name, credit_days: l.credit_days || 0 } });
    } catch (e) { fail(res, e); }
});

router.put('/documents/:type/:id/party-info', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const map = PARTY_DOCS[req.params.type];
        if (!map) return res.status(400).json({ success: false, error: 'Unknown document type' });
        const c = await getTenantClient(req.auth.tenantId), t = req.auth.tenantId, b = req.body || {};
        const [table, partyCol] = map;
        const { data: doc } = await c.from(table).select(`id, ${partyCol}`).eq('tenant_id', t).eq('id', req.params.id).maybeSingle();
        if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
        const row = { party_billing_address: clean(b.billing_address, 500), party_shipping_address: clean(b.shipping_address, 500), party_pan: clean(b.pan, 30), party_phone: clean(b.phone, 40), party_email: clean(b.email, 150) };
        Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);
        if (row.party_pan && !/^[0-9A-Za-z-]{3,30}$/.test(row.party_pan)) return res.status(400).json({ success: false, error: 'PAN can have only letters, digits and "-"' });
        const { error } = await c.from(table).update(row).eq('tenant_id', t).eq('id', req.params.id);
        if (error) throw error;
        let masterUpdated = false;
        if (b.update_master && doc[partyCol]) {
            const up = {};
            if (row.party_billing_address !== undefined) up.billing_address = row.party_billing_address;
            if (row.party_shipping_address !== undefined) up.shipping_address = row.party_shipping_address;
            if (row.party_pan) up.pan_number = row.party_pan;
            if (row.party_phone) up.contact_person_mobile = row.party_phone;
            if (row.party_email) up.email = row.party_email;
            if (Object.keys(up).length) {
                const { error: e2 } = await c.from('ledger_accounts').update({ ...up, updated_by: req.auth.userId, updated_at: new Date().toISOString() }).eq('tenant_id', t).eq('id', doc[partyCol]);
                if (e2) throw e2;
                masterUpdated = true;
                await logAudit(t, req.auth.userId, 'update_party_from_entry', 'ledger_account', doc[partyCol], { from: `${req.params.type}:${req.params.id}`, changes: up });
            }
        }
        res.json({ success: true, data: { ...row, master_updated: masterUpdated } });
    } catch (e) { fail(res, e); }
});

// ---- Account Posting (JV) view of any saved transaction (components/entry/PostingView.jsx) ----
// the ledger entry of a saved document: every batch posted for it (document ids are unique)
router.get('/document-posting/:id', ...view, async (req, res) => {
    try {
        const t = req.auth.tenantId, c = await getTenantClient(t);
        const { data: batches, error } = await c.from('ledger_transaction_batches').select('id, document_type, batch_date, narration, created_at').eq('tenant_id', t).eq('document_id', req.params.id).order('created_at');
        if (error) throw error;
        const ids = (batches || []).map(b => b.id);
        const { data: lines } = ids.length ? await c.from('ledger_transaction_lines').select('batch_id, ledger_account_id, sub_ledger_id, debit_amount, credit_amount, narration').in('batch_id', ids) : { data: [] };
        const ledIds = [...new Set((lines || []).map(l => l.ledger_account_id))], subIds = [...new Set((lines || []).map(l => l.sub_ledger_id).filter(Boolean))];
        const { data: leds } = ledIds.length ? await c.from('ledger_accounts').select('id, account_code, account_name').in('id', ledIds) : { data: [] };
        const { data: subs } = subIds.length ? await c.from('sub_ledgers').select('id, sub_ledger_name').in('id', subIds) : { data: [] };
        const ln = Object.fromEntries((leds || []).map(x => [x.id, x])), sn = Object.fromEntries((subs || []).map(x => [x.id, x.sub_ledger_name]));
        const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
        const out = (batches || []).map(b => {
            const ls = (lines || []).filter(l => l.batch_id === b.id).map(l => ({ ledger_id: l.ledger_account_id, ledger_code: ln[l.ledger_account_id]?.account_code || '', ledger_name: ln[l.ledger_account_id]?.account_name || '', sub_ledger_name: l.sub_ledger_id ? sn[l.sub_ledger_id] || '' : '',
                debit: r2(l.debit_amount), credit: r2(l.credit_amount), narration: l.narration || '' }))
                .sort((a, z) => (z.debit > 0) - (a.debit > 0));
            return { ...b, lines: ls, debit: r2(ls.reduce((s, x) => s + x.debit, 0)), credit: r2(ls.reduce((s, x) => s + x.credit, 0)) };
        });
        res.json({ success: true, data: { batches: out } });
    } catch (e) { fail(res, e); }
});

module.exports = router;
