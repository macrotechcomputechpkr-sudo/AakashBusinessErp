// =============================================
// routes/subLedgerRoutes.js
// Sub Ledger Master - individual detail accounts rolling up into ONE
// Main Ledger (a control account). Enforces that the chosen Main Ledger
// actually allows sub-ledgers (sub_ledger_mode 'enable' or 'compulsory' -
// not 'disable') since that's a cross-table rule the DB's CHECK
// constraints can't express directly.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const TYPE_ONLY_FIELDS = {
    agent: ['agent_id', 'commission_rate'],
    shareholder: ['number_of_shares', 'share_class', 'face_value_per_share', 'shareholding_percentage', 'folio_number', 'share_certificate_no'],
    employee: ['employee_user_id', 'employee_code_ref'],
    director_partner: ['designation', 'partner_shareholding_percentage', 'din_pan_number'],
    fixed_asset: ['asset_code', 'asset_purchase_date', 'asset_depreciation_rate'],
    bank_sub_account: ['bank_name', 'bank_branch', 'bank_account_number', 'bank_ifsc_swift'],
    loan_account: ['loan_type', 'loan_interest_rate', 'loan_tenure_months'],
    other: []
};
const ALL_TYPE_FIELDS = Object.values(TYPE_ONLY_FIELDS).flat();

// FIX: whichever sub_ledger_type is NOT selected has its fields cleared,
// the same defense-in-depth pattern used for ledger_accounts' party-only
// fields - stops a leftover Agent commission_rate from lingering on a
// row that was switched to Shareholder, for example.
function stripFieldsForOtherTypes(payload, type) {
    const keep = new Set(TYPE_ONLY_FIELDS[type] || []);
    const cleaned = { ...payload };
    ALL_TYPE_FIELDS.forEach(f => { if (!keep.has(f)) cleaned[f] = null; });
    return cleaned;
}

function validateTypeRequiredFields(body) {
    const t = body.sub_ledger_type;
    if (t === 'agent' && !body.agent_id) return 'Agent is required when Type is Agent';
    if (t === 'shareholder' && !body.number_of_shares) return 'Number of Shares is required when Type is Shareholder';
    if (t === 'employee' && !body.employee_user_id) return 'Employee is required when Type is Employee';
    if (t === 'bank_sub_account' && !body.bank_account_number) return 'Bank Account Number is required when Type is Bank Sub-Account';
    return null;
}

router.get('/sub-ledgers', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient
            .from('sub_ledgers')
            .select('*, main_ledger:main_ledger_id(account_code, account_name, sub_ledger_mode), agent:agent_id(agent_name, agent_code)')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('display_order');
        if (req.query.main_ledger_id) query = query.eq('main_ledger_id', req.query.main_ledger_id);
        if (req.query.sub_ledger_type) query = query.eq('sub_ledger_type', req.query.sub_ledger_type);

        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: only ledgers with Sub Ledger Mode != 'disable' should be
// pickable as a Main Ledger - a dedicated endpoint keeps that filter
// logic in one place instead of every caller re-deriving it.
router.get('/sub-ledgers/eligible-main-ledgers', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('ledger_accounts')
            .select('id, account_code, account_name, sub_ledger_mode, category_type')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .in('sub_ledger_mode', ['enable', 'compulsory'])
            .order('account_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sub-ledgers', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { sub_ledger_name, main_ledger_id, sub_ledger_type } = req.body;
        if (!sub_ledger_name || !sub_ledger_name.trim()) return res.status(400).json({ success: false, error: 'Sub Ledger Name is required' });
        if (!main_ledger_id) return res.status(400).json({ success: false, error: 'Main Ledger is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        // FIX: the real cross-table check - the chosen Main Ledger must
        // actually have Sub Ledger Mode set to Enable or Compulsory.
        const { data: mainLedger } = await tenantClient
            .from('ledger_accounts').select('id, sub_ledger_mode').eq('id', main_ledger_id).eq('tenant_id', tenantId).single();
        if (!mainLedger) return res.status(404).json({ success: false, error: 'Main Ledger not found' });
        if (mainLedger.sub_ledger_mode === 'disable') {
            return res.status(400).json({ success: false, error: 'This ledger does not allow sub-ledgers (its Sub Ledger Mode is Disable) - enable it on the ledger first' });
        }

        const typeError = validateTypeRequiredFields(req.body);
        if (typeError) return res.status(400).json({ success: false, error: typeError });

        const prefix = sub_ledger_name.trim().slice(0, 4).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_sub_ledger_code', { prefix });
        if (codeErr) throw codeErr;

        // FEATURE: Short Name auto-generates from Name's initials + a
        // true sequential number when not supplied - same pattern as
        // Ledger Accounts.
        let shortName = req.body.short_name;
        if (!shortName) {
            const initials = sub_ledger_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'GEN';
            const { data: shortNameRow, error: shortNameErr } = await tenantClient.rpc('next_short_name', { seq_name: 'tenant_master.seq_sub_ledger_short_name', initials });
            if (shortNameErr) throw shortNameErr;
            shortName = shortNameRow;
        }

        const cleaned = stripFieldsForOtherTypes(req.body, sub_ledger_type || 'other');
        const { data, error } = await tenantClient
            .from('sub_ledgers')
            .insert({
                ...cleaned,
                tenant_id: tenantId,
                sub_ledger_code: codeRow,
                sub_ledger_name: sub_ledger_name.trim(),
                short_name: shortName,
                main_ledger_id,
                sub_ledger_type: sub_ledger_type || 'other',
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A sub-ledger with this name already exists' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the sub-ledger fields' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_sub_ledger', 'sub_ledger', data.id, { new_data: data });
        res.json({ success: true, message: 'Sub-ledger created successfully', data });
    } catch (error) {
        console.error('Create sub-ledger error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sub-ledgers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sub_ledgers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Sub-ledger not found' });

        const mainLedgerId = req.body.main_ledger_id || existing.main_ledger_id;
        if (req.body.main_ledger_id && req.body.main_ledger_id !== existing.main_ledger_id) {
            const { data: mainLedger } = await tenantClient
                .from('ledger_accounts').select('id, sub_ledger_mode').eq('id', mainLedgerId).eq('tenant_id', tenantId).single();
            if (!mainLedger) return res.status(404).json({ success: false, error: 'Main Ledger not found' });
            if (mainLedger.sub_ledger_mode === 'disable') {
                return res.status(400).json({ success: false, error: 'This ledger does not allow sub-ledgers (its Sub Ledger Mode is Disable)' });
            }
        }

        const merged = { ...existing, ...req.body };
        const typeError = validateTypeRequiredFields(merged);
        if (typeError) return res.status(400).json({ success: false, error: typeError });

        const cleaned = stripFieldsForOtherTypes(req.body, merged.sub_ledger_type);
        const update = { ...cleaned, updated_by: req.auth.userId, updated_at: new Date().toISOString() };

        const { data, error } = await tenantClient
            .from('sub_ledgers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A sub-ledger with this name already exists' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the sub-ledger fields' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_sub_ledger', 'sub_ledger', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sub-ledgers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('sub_ledgers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient.from('sub_ledgers').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_sub_ledger', 'sub_ledger', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Sub-ledger deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
