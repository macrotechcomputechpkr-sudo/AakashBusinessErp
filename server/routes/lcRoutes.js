// =============================================
// routes/lcRoutes.js
// LC Register and LC <-> Purchase Bill mapping. Remaining balances are
// always computed from lc_bill_mappings, never stored, so they can't
// drift out of sync.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function withUtilization(tenantClient, lcs) {
    if (!lcs || lcs.length === 0) return [];
    const { data: maps } = await tenantClient.from('lc_bill_mappings').select('lc_id, mapped_amount').in('lc_id', lcs.map(l => l.id));
    const used = {};
    (maps || []).forEach(m => { used[m.lc_id] = (used[m.lc_id] || 0) + Number(m.mapped_amount); });
    const today = new Date().toISOString().slice(0, 10);
    return lcs.map(l => ({
        ...l,
        vendor_name: l.vendor?.account_name || null,
        utilized_amount: round2(used[l.id] || 0),
        remaining_amount: round2(Number(l.lc_amount) - (used[l.id] || 0)),
        is_expired: !!(l.expiry_date && l.expiry_date < today)
    }));
}

// How much of a bill is already covered by LCs (across ALL LCs), so the
// same bill can't be mapped for more than its own value.
async function billMappedTotal(tenantClient, billId, excludeLcId) {
    let q = tenantClient.from('lc_bill_mappings').select('lc_id, mapped_amount').eq('purchase_bill_id', billId);
    const { data } = await q;
    return (data || []).filter(m => m.lc_id !== excludeLcId).reduce((s, m) => s + Number(m.mapped_amount), 0);
}

router.get('/letters-of-credit', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { vendor_ledger_id, status } = req.query;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let q = tenantClient.from('letters_of_credit').select('*, vendor:vendor_ledger_id(account_name)').eq('tenant_id', req.auth.tenantId);
        if (vendor_ledger_id) q = q.eq('vendor_ledger_id', vendor_ledger_id);
        if (status) q = q.eq('status', status);
        const { data, error } = await q.order('issue_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: await withUtilization(tenantClient, data) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: used when a Purchase Bill is saved - every OPEN, unexpired
// LC of this vendor that still has balance left.
router.get('/letters-of-credit/pending', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { vendor_ledger_id } = req.query;
        if (!vendor_ledger_id) return res.json({ success: true, data: [] });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('letters_of_credit').select('*, vendor:vendor_ledger_id(account_name)')
            .eq('tenant_id', req.auth.tenantId).eq('vendor_ledger_id', vendor_ledger_id).eq('status', 'open');
        if (error) throw error;
        const rows = (await withUtilization(tenantClient, data)).filter(l => l.remaining_amount > 0 && !l.is_expired);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/letters-of-credit', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const b = req.body;
        if (!b.lc_number || !b.lc_number.trim()) return res.status(400).json({ success: false, error: 'LC Number is required' });
        if (!b.vendor_ledger_id) return res.status(400).json({ success: false, error: 'Supplier is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('letters_of_credit').insert({
            tenant_id: req.auth.tenantId, lc_number: b.lc_number.trim(), vendor_ledger_id: b.vendor_ledger_id,
            bank_ledger_id: b.bank_ledger_id || null, lc_bank_name: b.lc_bank_name || null,
            lc_amount: Number(b.lc_amount) || 0, margin_amount: Number(b.margin_amount) || 0, currency: b.currency || 'NPR',
            issue_date: b.issue_date || null, expiry_date: b.expiry_date || null, narration: b.narration || null,
            created_by: req.auth.userId, updated_by: req.auth.userId
        }).select().single();
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'create_lc', 'letter_of_credit', data.id, { new_data: data });
        res.json({ success: true, message: 'LC created', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/letters-of-credit/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const b = req.body;
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('letters_of_credit').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).maybeSingle();
        if (!existing) return res.status(404).json({ success: false, error: 'LC not found' });
        // An LC's amount can't be lowered below what bills already use.
        if (b.lc_amount !== undefined) {
            const [withUse] = await withUtilization(tenantClient, [existing]);
            if (Number(b.lc_amount) < withUse.utilized_amount) {
                return res.status(400).json({ success: false, error: `LC amount can't be below the ${withUse.utilized_amount.toFixed(2)} already mapped to bills` });
            }
        }
        const patch = {};
        ['lc_number', 'bank_ledger_id', 'lc_bank_name', 'lc_amount', 'margin_amount', 'currency', 'issue_date', 'expiry_date', 'status', 'narration'].forEach(k => {
            if (b[k] !== undefined) patch[k] = b[k] === '' ? null : b[k];
        });
        const { data, error } = await tenantClient.from('letters_of_credit')
            .update({ ...patch, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).select().single();
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_lc', 'letter_of_credit', data.id, { old_data: existing, new_data: data });
        res.json({ success: true, message: 'LC updated', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/letters-of-credit/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { count } = await tenantClient.from('lc_bill_mappings').select('id', { count: 'exact', head: true }).eq('lc_id', req.params.id);
        if (count > 0) return res.status(400).json({ success: false, error: `This LC is mapped to ${count} bill(s). Unmap them first, or mark the LC Closed instead.` });
        const { error } = await tenantClient.from('letters_of_credit')
            .update({ status: 'cancelled', updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id).eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'cancel_lc', 'letter_of_credit', req.params.id, {});
        res.json({ success: true, message: 'LC cancelled' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/letters-of-credit/:id/mappings', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('lc_bill_mappings')
            .select('*, bill:purchase_bill_id(doc_no, doc_date, total_amount, status)')
            .eq('lc_id', req.params.id).eq('tenant_id', req.auth.tenantId).order('created_at');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: the separate "LC Mapping" option - this vendor's posted
// bills that still have value not yet covered by any LC.
router.get('/letters-of-credit/:id/mappable-bills', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: lc } = await tenantClient.from('letters_of_credit').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).maybeSingle();
        if (!lc) return res.status(404).json({ success: false, error: 'LC not found' });
        const { data: bills } = await tenantClient.from('purchase_bills').select('id, doc_no, doc_date, total_amount')
            .eq('tenant_id', req.auth.tenantId).eq('vendor_ledger_id', lc.vendor_ledger_id).eq('status', 'posted').order('doc_date', { ascending: false }).limit(300);
        if (!bills || bills.length === 0) return res.json({ success: true, data: [] });
        const { data: maps } = await tenantClient.from('lc_bill_mappings').select('lc_id, purchase_bill_id, mapped_amount').in('purchase_bill_id', bills.map(b => b.id));
        const coveredByBill = {}, alreadyThisLc = new Set();
        (maps || []).forEach(m => {
            coveredByBill[m.purchase_bill_id] = (coveredByBill[m.purchase_bill_id] || 0) + Number(m.mapped_amount);
            if (m.lc_id === lc.id) alreadyThisLc.add(m.purchase_bill_id);
        });
        const rows = bills
            .filter(b => !alreadyThisLc.has(b.id))
            .map(b => ({ ...b, lc_covered_amount: round2(coveredByBill[b.id] || 0), unmapped_amount: round2(Number(b.total_amount) - (coveredByBill[b.id] || 0)) }))
            .filter(b => b.unmapped_amount > 0);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/letters-of-credit/:id/map', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { purchase_bill_id, mapped_amount, narration } = req.body;
        const amount = round2(mapped_amount);
        if (!purchase_bill_id) return res.status(400).json({ success: false, error: 'Purchase Bill is required' });
        if (!(amount > 0)) return res.status(400).json({ success: false, error: 'Mapped amount must be greater than zero' });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: lc } = await tenantClient.from('letters_of_credit').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
        if (!lc) return res.status(404).json({ success: false, error: 'LC not found' });
        if (lc.status !== 'open') return res.status(400).json({ success: false, error: `LC is ${lc.status}` });
        const { data: bill } = await tenantClient.from('purchase_bills').select('id, vendor_ledger_id, total_amount, status, doc_no').eq('id', purchase_bill_id).eq('tenant_id', tenantId).maybeSingle();
        if (!bill) return res.status(404).json({ success: false, error: 'Purchase Bill not found' });
        if (bill.vendor_ledger_id !== lc.vendor_ledger_id) return res.status(400).json({ success: false, error: 'This bill belongs to a different supplier than the LC' });
        if (bill.status === 'cancelled') return res.status(400).json({ success: false, error: 'Cannot map a cancelled bill' });

        const [lcWithUse] = await withUtilization(tenantClient, [lc]);
        // FIX: re-mapping the SAME bill to the SAME LC (to correct the
        // amount) replaces the old row via upsert - so that old amount
        // must not count against the LC's remaining balance here, or a
        // valid correction gets wrongly rejected.
        const { data: existingPair } = await tenantClient.from('lc_bill_mappings').select('mapped_amount').eq('lc_id', lc.id).eq('purchase_bill_id', bill.id).maybeSingle();
        const lcAvailable = round2(lcWithUse.remaining_amount + Number(existingPair?.mapped_amount || 0));
        if (amount > lcAvailable + 0.005) return res.status(400).json({ success: false, error: `LC has only ${lcAvailable.toFixed(2)} available` });
        const billCovered = await billMappedTotal(tenantClient, bill.id, lc.id);
        const billRemaining = round2(Number(bill.total_amount) - billCovered);
        if (amount > billRemaining + 0.005) return res.status(400).json({ success: false, error: `Only ${billRemaining.toFixed(2)} of this bill is not yet covered by an LC` });

        const { data, error } = await tenantClient.from('lc_bill_mappings').upsert({
            tenant_id: tenantId, lc_id: lc.id, purchase_bill_id: bill.id, mapped_amount: amount, narration: narration || null, created_by: req.auth.userId
        }, { onConflict: 'lc_id,purchase_bill_id' }).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'map_lc_bill', 'letter_of_credit', lc.id, { new_data: { bill: bill.doc_no, amount } });
        res.json({ success: true, message: `${bill.doc_no} mapped to LC ${lc.lc_number}`, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/lc-mappings/:mappingId', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { error } = await tenantClient.from('lc_bill_mappings').delete().eq('id', req.params.mappingId).eq('tenant_id', req.auth.tenantId);
        if (error) throw error;
        await logAudit(req.auth.tenantId, req.auth.userId, 'unmap_lc_bill', 'lc_bill_mapping', req.params.mappingId, {});
        res.json({ success: true, message: 'Mapping removed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
