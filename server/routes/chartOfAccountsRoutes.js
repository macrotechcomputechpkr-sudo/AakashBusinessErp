// =============================================
// routes/chartOfAccountsRoutes.js
// Converted from the Flask design the user supplied, with these fixes:
//  - Flask/Python -> Express (this project's actual stack; a second
//    backend framework cannot run inside the same Node server).
//  - Account/group code generation now uses the atomic Postgres sequences
//    from 06_chart_of_accounts_schema.sql instead of "read the last row,
//    add 1" in application code (race condition under concurrent creates).
//  - Free-text `.or_()` search built by directly interpolating user input
//    is replaced with the same safer `applyListQuery` helper used
//    elsewhere (escapes characters that are special in PostgREST filters).
//  - "category_type" filtering now treats a group's category_type='both'
//    as matching EITHER half of its pair (cash<->bank, sales<->purchase),
//    which is what makes "pick a ledger's category, the group list
//    filters/auto-selects" behave correctly for Cash/Bank ledgers - the
//    original data (two conflicting sequential UPDATEs) silently broke this.
//  - Permission-gated with the existing 'ledger' key already present in
//    every security group's permissions JSON (view/create/edit/delete).
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, applyListQuery, logAudit, checkTransactionUsage } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

// A group's category_type is treated as compatible with a requested
// category filter if it matches exactly, OR the group is tagged 'both'
// and the request is one half of a recognised pair, OR the request itself
// is 'both' (meaning: show everything relevant to sales+purchase or
// cash+bank, depending on which the caller means - callers should pass
// the specific side they want; 'both' as a *request* returns groups
// tagged 'both' only).
function categoryMatches(groupCategory, requested) {
    if (!requested) return true;
    if (groupCategory === requested) return true;
    if (groupCategory === 'both' && ['sales', 'purchase', 'cash', 'bank'].includes(requested)) return true;
    return false;
}

// =========================================================
// ACCOUNT GROUPS
// =========================================================

router.get('/account-groups', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('account_groups')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('display_order');
        if (error) throw error;

        const categoryFilter = req.query.category_type;
        const filtered = categoryFilter ? data.filter(g => categoryMatches(g.category_type, categoryFilter)) : data;

        res.json({ success: true, data: filtered });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Flat list -> nested tree, for a hierarchy view (grouped by parent_group_id).
router.get('/account-groups/tree', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('account_groups')
            .select('id, group_code, group_name, group_type, nfrs_category, category_type, parent_group_id, hierarchy_level')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('display_order');
        if (error) throw error;

        const buildTree = (groups, parentId = null) =>
            groups
                .filter(g => (g.parent_group_id || null) === parentId)
                .map(g => ({ ...g, children: buildTree(groups, g.id) }));

        res.json({ success: true, data: buildTree(data, null) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FIX: account-group creation previously accepted cash_flow_category /
// funds_flow_type / ratio_analysis_category / balance_sheet_side /
// profit_loss_type as free-standing fields with no relationship to the
// chosen NFRS Category+Classification, and the seed data for the 33
// standard groups never populated funds_flow_type/ratio_analysis_category
// at all. This supplies a sensible default for any of those fields the
// caller leaves blank, based on standard NFRS/cash-flow/funds-flow
// conventions - the caller (or the frontend's live auto-fill) can still
// override every value explicitly.
function suggestClassification(nfrsCategory, nfrsClassification) {
    const isCurrent = nfrsClassification === 'Current';
    switch (nfrsCategory) {
        case 'Assets':
            return isCurrent
                ? { cash_flow_category: 'Operating', funds_flow_type: 'Application', ratio_analysis_category: 'Liquidity', balance_sheet_side: 'Assets', is_balance_sheet: true }
                : { cash_flow_category: 'Investing', funds_flow_type: 'Application', ratio_analysis_category: 'Solvency', balance_sheet_side: 'Assets', is_balance_sheet: true };
        case 'Liabilities':
            return isCurrent
                ? { cash_flow_category: 'Operating', funds_flow_type: 'Source', ratio_analysis_category: 'Liquidity', balance_sheet_side: 'Liabilities', is_balance_sheet: true }
                : { cash_flow_category: 'Financing', funds_flow_type: 'Source', ratio_analysis_category: 'Solvency', balance_sheet_side: 'Liabilities', is_balance_sheet: true };
        case 'Equity':
            return { cash_flow_category: 'Financing', funds_flow_type: 'Source', ratio_analysis_category: 'Solvency', balance_sheet_side: 'Equity', is_balance_sheet: true };
        case 'Income':
            return { cash_flow_category: 'Operating', funds_flow_type: 'Source', ratio_analysis_category: 'Profitability', profit_loss_type: 'Income', is_profit_loss: true };
        case 'Expenses':
            return { cash_flow_category: 'Operating', funds_flow_type: 'Application', ratio_analysis_category: 'Profitability', profit_loss_type: 'Expense', is_profit_loss: true };
        default:
            return {};
    }
}

router.get('/account-groups/suggest-classification', requireAuth, (req, res) => {
    const { nfrs_category, nfrs_classification } = req.query;
    if (!nfrs_category) return res.status(400).json({ success: false, error: 'nfrs_category is required' });
    res.json({ success: true, data: suggestClassification(nfrs_category, nfrs_classification) });
});

router.post('/account-groups', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { group_name, nfrs_category, nfrs_classification, cash_flow_category, funds_flow_type,
                ratio_analysis_category, balance_sheet_side, profit_loss_type, is_balance_sheet, is_profit_loss,
                parent_group_id, category_type, default_tax_rate, default_credit_days, default_credit_limit,
                display_order, description } = req.body;

        if (!group_name || !group_name.trim()) return res.status(400).json({ success: false, error: 'Group name is required' });
        if (!nfrs_category) return res.status(400).json({ success: false, error: 'NFRS category is required' });

        // FIX: fill in anything the caller left blank using the standard
        // NFRS-driven suggestion, instead of silently storing NULLs.
        const suggested = suggestClassification(nfrs_category, nfrs_classification);
        const finalCashFlow = cash_flow_category || suggested.cash_flow_category || null;
        const finalFundsFlow = funds_flow_type || suggested.funds_flow_type || null;
        const finalRatio = ratio_analysis_category || suggested.ratio_analysis_category || null;
        const finalBSSide = balance_sheet_side || suggested.balance_sheet_side || null;
        const finalPLType = profit_loss_type || suggested.profit_loss_type || null;
        const finalIsBS = is_balance_sheet !== undefined ? !!is_balance_sheet : !!suggested.is_balance_sheet;
        const finalIsPL = is_profit_loss !== undefined ? !!is_profit_loss : !!suggested.is_profit_loss;

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        let hierarchy_level = 1, hierarchy_path = '', parent_group_code = null;
        if (parent_group_id) {
            const { data: parent } = await tenantClient
                .from('account_groups').select('group_code, hierarchy_level, hierarchy_path').eq('id', parent_group_id).single();
            if (parent) {
                parent_group_code = parent.group_code;
                hierarchy_level = (parent.hierarchy_level || 1) + 1;
                hierarchy_path = parent.hierarchy_path ? `${parent.hierarchy_path}/${parent_group_id}` : String(parent_group_id);
            }
        }

        const prefix = group_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_account_group_code', { prefix });
        if (codeErr) throw codeErr;

        const { data, error } = await tenantClient
            .from('account_groups')
            .insert({
                tenant_id: tenantId,
                group_code: codeRow,
                group_name: group_name.trim(),
                group_type: parent_group_id ? 'sub' : 'primary',
                nfrs_category, nfrs_classification,
                cash_flow_category: finalCashFlow, funds_flow_type: finalFundsFlow, ratio_analysis_category: finalRatio,
                balance_sheet_side: finalBSSide, profit_loss_type: finalPLType,
                is_balance_sheet: finalIsBS, is_profit_loss: finalIsPL,
                parent_group_id: parent_group_id || null, parent_group_code, hierarchy_level, hierarchy_path,
                category_type: category_type || 'others',
                default_tax_rate, default_credit_days: default_credit_days || 0, default_credit_limit: default_credit_limit || 0,
                display_order: display_order || 1, description,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_account_group', 'account_group', data.id, { new_data: data });
        res.json({ success: true, message: 'Account group created successfully', data });
    } catch (error) {
        console.error('Create account group error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/account-groups/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: existing } = await tenantClient.from('account_groups').select('*').eq('id', req.params.id).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Group not found' });
        if (existing.is_system) return res.status(403).json({ success: false, error: 'Cannot modify a system group' });

        // FIX: block setting a group's parent to itself, mirroring the DB's
        // no_self_parent CHECK - fail with a clear message instead of a raw
        // constraint-violation error.
        if (req.body.parent_group_id === req.params.id) {
            return res.status(400).json({ success: false, error: 'A group cannot be its own parent' });
        }

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        // Never let a body overwrite identity/ownership columns.
        ['id', 'tenant_id', 'is_system', 'created_by', 'created_at', 'hierarchy_level', 'hierarchy_path', 'parent_group_code'].forEach(k => delete update[k]);

        // FIX: re-parenting. (1) Block cycles - making a group the child
        // of its own descendant used to succeed and silently drop both
        // groups out of every tree view. (2) Recompute hierarchy_level /
        // hierarchy_path / parent_group_code for this group AND every
        // descendant (POST computed them; PUT used to leave them stale).
        const parentChanged = req.body.parent_group_id !== undefined && (req.body.parent_group_id || null) !== (existing.parent_group_id || null);
        let allGroups = null;
        if (parentChanged) {
            const { data: rows } = await tenantClient.from('account_groups').select('id, group_code, parent_group_id').eq('tenant_id', req.auth.tenantId);
            allGroups = rows || [];
            const byId = Object.fromEntries(allGroups.map(g => [g.id, g]));
            let cursor = req.body.parent_group_id || null, guard = 0;
            while (cursor && guard++ < 1000) {
                if (cursor === req.params.id) return res.status(400).json({ success: false, error: 'A group cannot be moved under its own sub-group' });
                cursor = byId[cursor]?.parent_group_id || null;
            }
            update.parent_group_id = req.body.parent_group_id || null;
        }

        const { data, error } = await tenantClient
            .from('account_groups').update(update).eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).select().single();
        if (error) throw error;

        if (parentChanged) {
            // Walk the moved subtree top-down, deriving each node from its parent.
            const byId = Object.fromEntries(allGroups.map(g => [g.id, { ...g }]));
            byId[req.params.id].parent_group_id = update.parent_group_id;
            const childrenOf = {};
            Object.values(byId).forEach(g => { if (g.parent_group_id) (childrenOf[g.parent_group_id] = childrenOf[g.parent_group_id] || []).push(g.id); });
            const { data: parentRow } = update.parent_group_id
                ? await tenantClient.from('account_groups').select('group_code, hierarchy_level, hierarchy_path').eq('id', update.parent_group_id).maybeSingle()
                : { data: null };
            const queue = [{ id: req.params.id, level: parentRow ? (parentRow.hierarchy_level || 1) + 1 : 1,
                path: parentRow ? (parentRow.hierarchy_path ? `${parentRow.hierarchy_path}/${update.parent_group_id}` : String(update.parent_group_id)) : '',
                parentCode: parentRow?.group_code || null }];
            while (queue.length) {
                const n = queue.shift();
                await tenantClient.from('account_groups').update({ hierarchy_level: n.level, hierarchy_path: n.path, parent_group_code: n.parentCode }).eq('id', n.id).eq('tenant_id', req.auth.tenantId);
                (childrenOf[n.id] || []).forEach(cid => queue.push({ id: cid, level: n.level + 1, path: n.path ? `${n.path}/${n.id}` : String(n.id), parentCode: byId[n.id].group_code }));
            }
        }
        await logAudit(req.auth.tenantId, req.auth.userId, 'update_account_group', 'account_group', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/account-groups/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('account_groups').select('*').eq('id', req.params.id).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Group not found' });
        if (existing.is_system) return res.status(403).json({ success: false, error: 'Cannot delete a system group' });

        const { data: children } = await tenantClient.from('account_groups').select('id').eq('parent_group_id', req.params.id);
        if (children && children.length > 0) return res.status(400).json({ success: false, error: 'Cannot delete a group that has sub-groups' });

        const { data: accounts } = await tenantClient.from('ledger_accounts').select('id').eq('account_group_id', req.params.id);
        if (accounts && accounts.length > 0) return res.status(400).json({ success: false, error: 'Cannot delete a group that has ledger accounts' });

        const { error } = await tenantClient.from('account_groups').update({ is_active: false }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_account_group', 'account_group', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Account group deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================
// LEDGER ACCOUNTS
// =========================================================

router.get('/ledger-accounts', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let base = tenantClient
            .from('ledger_accounts')
            .select('*, account_groups(group_name, category_type, nfrs_category), ledger_account_categories(ledger_category_id)', { count: 'exact' })
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true);

        if (req.query.account_group_id) base = base.eq('account_group_id', req.query.account_group_id);
        if (req.query.account_type) base = base.eq('account_type', req.query.account_type);
        if (req.query.category_type) base = base.eq('category_type', req.query.category_type);

        const { q, page, pageSize } = applyListQuery(base, req, {
            searchColumns: ['account_name', 'account_code', 'pan_number'],
            defaultSort: 'account_name',
            allowedSort: ['account_name', 'account_code', 'created_at', 'opening_balance']
        });

        const { data, error, count } = await q;
        if (error) throw error;

        // FEATURE: flatten the junction-table join into a plain array of
        // category IDs per ledger, so the frontend doesn't need to know
        // about the join table shape.
        const withCategoryIds = (data || []).map(row => ({
            ...row,
            ledger_category_ids: (row.ledger_account_categories || []).map(r => r.ledger_category_id)
        }));

        res.json({ success: true, data: withCategoryIds, pagination: { page, pageSize, total: count, totalPages: Math.ceil((count || 0) / pageSize) } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fields that only make sense for a party ledger (customer/supplier).
// Server-side mirror of the frontend's conditional sections - defense in
// depth so a Cash/Bank/Others ledger can never end up with stray PAN/
// address/area data even if a client sends it anyway.
const PARTY_ONLY_FIELDS = [
    'pan_number', 'vat_pan_type', 'vat_pan_number', 'contact_person', 'contact_person_phone',
    'contact_person_mobile', 'street', 'city', 'state', 'zip_code', 'billing_address', 'billing_name',
    'shipping_address', 'area_id', 'route_id', 'agent_id', 'credit_limit', 'credit_days',
    // Registration/compliance details (Other Information tab)
    'tin_number', 'excise_registration_no', 'cst_no', 'dl_no', 'business_category', 'voucher_adjustment_basis',
    'schedule_reference', 'excise_duty_rate', 'excise_exemption_certificate',
    // Sub Ledger settings
    'sub_ledger_mode', 'allow_all_sub_ledger', 'credit_limit_control', 'credit_days_control',
    // LC / BG trade-finance details
    'lc_number', 'lc_bank_name', 'lc_amount', 'lc_issue_date', 'lc_expiry_date',
    'bg_number', 'bg_bank_name', 'bg_amount', 'bg_issue_date', 'bg_expiry_date',
    // Personal details (individual customers)
    'customer_date_of_birth', 'customer_anniversary_date', 'customer_religion'
];
function isPartyCategory(categoryType) {
    return ['sales', 'purchase', 'both'].includes(categoryType);
}
function stripPartyFieldsIfNotParty(payload, categoryType) {
    const cleaned = { ...payload };
    if (!isPartyCategory(categoryType)) {
        PARTY_ONLY_FIELDS.forEach(f => { cleaned[f] = null; });
    }
    // FIX: Ledger Type is the inverse restriction - "customer/vendor cash
    // bank bahek aru ledger maa yo choose garne option dine" (only offer
    // Ledger Type for ledgers that are NOT customer/vendor/cash/bank).
    // A party ledger (or a plain cash/bank ledger) always gets forced back
    // to the 'general' default here, regardless of what the client sent.
    if (isPartyCategory(categoryType) || categoryType === 'cash' || categoryType === 'bank') {
        cleaned.ledger_type = 'general';
    }
    return cleaned;
}

// FIX: the Ledger Account form lets a user pick a Route directly
// (ledger_accounts.route_id), but the salesman's mobile-app beat plan
// (RouteSequencing.jsx) reads from the separate tenant_master.route_customers
// join table. Without this sync, picking a route on the account form
// silently would NOT make the customer appear in that route's visiting
// order - a real (and confusing) inconsistency. This keeps route_id and
// route_customers in agreement automatically:
//   - route_id set on a party ledger with no existing route_customers row
//     for that route -> appended at the end of that route's sequence.
//   - route_id changed to a different route -> old route_customers row
//     removed, a new one appended at the end of the new route.
//   - route_id cleared, or category is no longer a party category -> any
//     route_customers row for this ledger account is removed.
// Manual fine-tuning of visit order still happens on the dedicated
// RouteSequencing page - this only handles membership, never overwrites
// an existing sequence_order.
async function syncRouteCustomer(tenantClient, tenantId, ledgerAccountId, newRouteId, categoryType) {
    const effectiveRouteId = isPartyCategory(categoryType) ? (newRouteId || null) : null;

    const { data: existingLinks } = await tenantClient
        .from('route_customers')
        .select('id, route_id')
        .eq('tenant_id', tenantId)
        .eq('ledger_account_id', ledgerAccountId);

    for (const link of existingLinks || []) {
        if (link.route_id !== effectiveRouteId) {
            await tenantClient.from('route_customers').delete().eq('id', link.id);
        }
    }

    if (!effectiveRouteId) return;
    const alreadyLinked = (existingLinks || []).some(l => l.route_id === effectiveRouteId);
    if (alreadyLinked) return;

    const { data: nextSeq, error: seqErr } = await tenantClient.rpc('next_route_sequence', { p_route_id: effectiveRouteId });
    if (seqErr) { console.error('syncRouteCustomer: next_route_sequence failed', seqErr); return; }

    await tenantClient.from('route_customers').insert({
        tenant_id: tenantId, route_id: effectiveRouteId, ledger_account_id: ledgerAccountId, sequence_order: nextSeq
    });
}

router.post('/ledger-accounts', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const data = req.body;
        if (!data.account_name || !data.account_name.trim()) return res.status(400).json({ success: false, error: 'Account name is required' });
        if (!data.account_group_id) return res.status(400).json({ success: false, error: 'Account group is required' });
        if (!data.category_type) return res.status(400).json({ success: false, error: 'Category type is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: group } = await tenantClient.from('account_groups').select('group_code, group_name').eq('id', data.account_group_id).single();
        if (!group) return res.status(404).json({ success: false, error: 'Account group not found' });

        const { data: dupName } = await tenantClient.from('ledger_accounts').select('id').eq('tenant_id', tenantId).ilike('account_name', data.account_name.trim()).maybeSingle();
        if (dupName) return res.status(409).json({ success: false, error: 'A ledger account with this name already exists' });

        // FEATURE: Code carries the CREATED fiscal year as its prefix -
        // look up whichever FY is currently marked is_current.
        const { data: currentFy } = await tenantClient.from('fiscal_years').select('fiscal_year_name').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();
        const fyPrefix = currentFy ? currentFy.fiscal_year_name.replace(/[^0-9]/g, '') : '';

        let account_code = data.account_code;
        if (!account_code) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_ledger_account_code', { group_code: group.group_code, fy_prefix: fyPrefix });
            if (codeErr) throw codeErr;
            account_code = codeRow;
        }

        // FEATURE: Short Name (Alias) auto-generates from the Name's
        // initials + a true sequential number (e.g. "Tanka Prasad
        // Adhikari" -> "TPA00001") whenever the client didn't supply one
        // itself - same "server generates the real value, client only
        // ever sees a preview" split as the Code above.
        let short_name = data.short_name;
        if (!short_name) {
            const initials = data.account_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'LDG';
            const { data: shortNameRow, error: shortNameErr } = await tenantClient.rpc('next_ledger_short_name', { initials });
            if (shortNameErr) throw shortNameErr;
            short_name = shortNameRow;
        }

        const insertPayload = stripPartyFieldsIfNotParty({
            tenant_id: tenantId,
            company_id: data.company_id || null,
            account_group_id: data.account_group_id,
            group_code: group.group_code,
            group_name: group.group_name,
            account_code,
            account_name: data.account_name.trim(),
            short_name: short_name || null,
            account_short_name: data.account_short_name,
            alias: data.alias,
            printing_name: data.printing_name,
            account_type: data.account_type || 'general',
            category_type: data.category_type,
            nfrs_classification: data.nfrs_classification,
            nfrs_code: data.nfrs_code,
            cash_flow_category: data.cash_flow_category,
            ratio_analysis_category: data.ratio_analysis_category,
            opening_balance: data.opening_balance || 0,
            opening_balance_type: data.opening_balance_type || 'dr',
            opening_balance_date: data.opening_balance_date || null,
            opening_balance_fiscal_year_id: data.opening_balance_fiscal_year_id || null,
            pan_number: data.pan_number,
            vat_pan_type: data.vat_pan_type || 'Non Registered',
            vat_pan_number: data.vat_pan_number,
            tin_number: data.tin_number,
            tan_number: data.tan_number,
            tds_rate: data.tds_rate || 0,
            tds_applicable: !!data.tds_applicable,
            tax_exempted: !!data.tax_exempted,
            tax_exemption_certificate: data.tax_exemption_certificate,
            contact_person: data.contact_person,
            contact_person_phone: data.contact_person_phone,
            contact_person_mobile: data.contact_person_mobile,
            phone_office: data.phone_office,
            email: data.email,
            website: data.website,
            street: data.street,
            city: data.city,
            state: data.state,
            country: data.country || 'Nepal',
            zip_code: data.zip_code,
            billing_address: data.billing_address,
            billing_name: data.billing_name || null,
            shipping_address: data.shipping_address,
            currency: data.currency || 'NPR',
            interest_rate: data.interest_rate || 0,
            credit_limit: data.credit_limit || 0,
            credit_days: data.credit_days || 0,
            bank_name: data.bank_name,
            bank_account_number: data.bank_account_number,
            bank_code: data.bank_code,
            swift_code: data.swift_code,
            iban_number: data.iban_number,
            default_discount_percentage: data.default_discount_percentage || 0,
            area_id: data.area_id || null,
            route_id: data.route_id || null,
            agent_id: data.agent_id || null,
            ledger_type: data.ledger_type || 'general',
            excise_registration_no: data.excise_registration_no,
            cst_no: data.cst_no,
            dl_no: data.dl_no,
            business_category: data.business_category,
            voucher_adjustment_basis: data.voucher_adjustment_basis,
            schedule_reference: data.schedule_reference,
            is_locked: !!data.is_locked,
            excise_duty_rate: data.excise_duty_rate || 0,
            excise_exemption_certificate: data.excise_exemption_certificate,
            sub_ledger_mode: data.sub_ledger_mode || 'disable',
            allow_all_sub_ledger: data.allow_all_sub_ledger !== undefined ? !!data.allow_all_sub_ledger : true,
            credit_limit_control: data.credit_limit_control || 'system_default',
            credit_days_control: data.credit_days_control || 'system_default',
            lc_number: data.lc_number,
            lc_bank_name: data.lc_bank_name,
            lc_amount: data.lc_amount || null,
            lc_issue_date: data.lc_issue_date || null,
            lc_expiry_date: data.lc_expiry_date || null,
            bg_number: data.bg_number,
            bg_bank_name: data.bg_bank_name,
            bg_amount: data.bg_amount || null,
            bg_issue_date: data.bg_issue_date || null,
            bg_expiry_date: data.bg_expiry_date || null,
            customer_date_of_birth: data.customer_date_of_birth || null,
            customer_anniversary_date: data.customer_anniversary_date || null,
            customer_religion: data.customer_religion,
            tags: data.tags || [],
            is_active: data.is_active !== undefined ? !!data.is_active : true,
            is_tax_applicable: data.is_tax_applicable !== undefined ? !!data.is_tax_applicable : true,
            notes: data.notes,
            created_by: req.auth.userId,
            updated_by: req.auth.userId
        }, data.category_type);

        const { data: account, error } = await tenantClient.from('ledger_accounts').insert(insertPayload).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'Duplicate account code/name, please retry' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the ledger fields (e.g. Ledger Type, Sub Ledger Selection Type, or Credit Days/Limit Control)' });
            throw error;
        }

        // FIX: keep the mobile-app beat plan (route_customers) in sync
        // with the route chosen right here on the account form.
        await syncRouteCustomer(tenantClient, tenantId, account.id, account.route_id, account.category_type);

        // FEATURE: Ledger Category is now multi-select - sync the
        // junction table from the array the client sent.
        let ledgerCategoryIds = [];
        if (Array.isArray(data.ledger_category_ids) && data.ledger_category_ids.length > 0) {
            const rows = data.ledger_category_ids.map(cid => ({ tenant_id: tenantId, ledger_account_id: account.id, ledger_category_id: cid }));
            const { error: catErr } = await tenantClient.from('ledger_account_categories').insert(rows);
            if (catErr) console.error('ledger_account_categories insert error:', catErr);
            else ledgerCategoryIds = data.ledger_category_ids;
        }

        await logAudit(tenantId, req.auth.userId, 'create_ledger_account', 'ledger_account', account.id, { new_data: account });
        res.json({ success: true, message: 'Ledger account created successfully', data: { ...account, ledger_category_ids: ledgerCategoryIds } });
    } catch (error) {
        console.error('Create ledger account error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/ledger-accounts/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('ledger_accounts').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Account not found' });
        if (existing.is_system) return res.status(403).json({ success: false, error: 'Cannot modify a system account' });

        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        // FEATURE: ledger_category_ids isn't a real column (many-to-many
        // via a junction table now) - pull it out before the generic
        // spread hits ledger_accounts.update(), and sync it separately.
        const ledgerCategoryIds = Array.isArray(update.ledger_category_ids) ? update.ledger_category_ids : null;
        delete update.ledger_category_ids;
        if (req.body.account_group_id && req.body.account_group_id !== existing.account_group_id) {
            const { data: group } = await tenantClient.from('account_groups').select('group_code, group_name').eq('id', req.body.account_group_id).single();
            if (group) { update.group_code = group.group_code; update.group_name = group.group_name; }
        }
        // FIX: same defense-in-depth as create - if the (possibly updated)
        // category_type is not a party category, strip party-only fields.
        const effectiveCategory = update.category_type || existing.category_type;
        const finalUpdate = stripPartyFieldsIfNotParty(update, effectiveCategory);

        const { data, error } = await tenantClient
            .from('ledger_accounts').update(finalUpdate).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the ledger fields (e.g. Ledger Type, Sub Ledger Selection Type, or Credit Days/Limit Control)' });
            throw error;
        }

        // FIX: keep route_customers in sync whenever route_id or
        // category_type changes on an update too, not just on create.
        await syncRouteCustomer(tenantClient, tenantId, data.id, data.route_id, data.category_type);

        // FEATURE: replace-all sync of the ledger's category set, if the
        // client sent one.
        if (ledgerCategoryIds !== null) {
            await tenantClient.from('ledger_account_categories').delete().eq('ledger_account_id', req.params.id);
            if (ledgerCategoryIds.length > 0) {
                const rows = ledgerCategoryIds.map(cid => ({ tenant_id: tenantId, ledger_account_id: req.params.id, ledger_category_id: cid }));
                const { error: catErr } = await tenantClient.from('ledger_account_categories').insert(rows);
                if (catErr) console.error('ledger_account_categories sync error:', catErr);
            }
        }

        await logAudit(tenantId, req.auth.userId, 'update_ledger_account', 'ledger_account', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data: { ...data, ledger_category_ids: ledgerCategoryIds !== null ? ledgerCategoryIds : undefined } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/ledger-accounts/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('ledger_accounts').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Account not found' });
        if (existing.is_system) return res.status(403).json({ success: false, error: 'Cannot delete a system account' });

        const { error } = await tenantClient.from('ledger_accounts').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_ledger_account', 'ledger_account', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Ledger account deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: "Remove option - if used somewhere, say which document,
// don't delete" - a genuinely PERMANENT delete, distinct from the
// deactivate above, only allowed when nothing references this ledger
// anywhere in the purchase (and later sales) transaction chain.
router.delete('/ledger-accounts/:id/permanent', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('ledger_accounts').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Account not found' });
        if (existing.is_system) return res.status(403).json({ success: false, error: 'Cannot delete a system account' });

        const usage = await checkTransactionUsage(tenantClient, tenantId, req.params.id, [
            { table: 'purchase_requisitions', column: 'vendor_ledger_id', label: 'Purchase Requisition (Vendor)' },
            { table: 'purchase_requisitions', column: 'goods_account_ledger_id', label: 'Purchase Requisition (Goods Account)' }
        ]);
        if (usage.used) {
            return res.status(409).json({ success: false, error: `Cannot delete - used in ${usage.label}: ${usage.docNos.join(', ')}${usage.docNos.length === 5 ? ' (and possibly more)' : ''}` });
        }

        const { error } = await tenantClient.from('ledger_accounts').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) {
            if (error.code === '23503') return res.status(409).json({ success: false, error: 'Cannot delete - this ledger is still referenced elsewhere' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'permanent_delete_ledger_account', 'ledger_account', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Ledger account permanently deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================
// COST CENTERS
// =========================================================

router.get('/cost-centers', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('cost_centers').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('cost_center_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/cost-centers', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { cost_center_name, cost_center_short_name, cost_center_type, nfrs_allocation_basis,
                allocation_percentage, annual_budget, monthly_budget, responsible_person,
                responsible_person_phone, responsible_person_email, description } = req.body;
        if (!cost_center_name || !cost_center_name.trim()) return res.status(400).json({ success: false, error: 'Cost center name is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = cost_center_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_cost_center_code', { prefix });
        if (codeErr) throw codeErr;

        // FEATURE: Short Name auto-generates from Name's initials + a
        // true sequential number when not supplied - same pattern as
        // Ledger Accounts.
        let shortName = cost_center_short_name;
        if (!shortName) {
            const { data: shortNameRow, error: shortNameErr } = await tenantClient.rpc('next_short_name', { seq_name: 'tenant_master.seq_cost_center_short_name', initials: prefix });
            if (shortNameErr) throw shortNameErr;
            shortName = shortNameRow;
        }

        const { data, error } = await tenantClient
            .from('cost_centers')
            .insert({
                tenant_id: tenantId, cost_center_code: codeRow, cost_center_name: cost_center_name.trim(),
                cost_center_short_name: shortName, cost_center_type: cost_center_type || 'department',
                nfrs_allocation_basis, allocation_percentage: allocation_percentage ?? 100,
                annual_budget: annual_budget || 0, monthly_budget: monthly_budget || 0,
                responsible_person, responsible_person_phone, responsible_person_email, description,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select()
            .single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_cost_center', 'cost_center', data.id, { new_data: data });
        res.json({ success: true, message: 'Cost center created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/cost-centers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('cost_centers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        const { data, error } = await tenantClient
            .from('cost_centers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_cost_center', 'cost_center', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/cost-centers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('cost_centers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient
            .from('cost_centers').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_cost_center', 'cost_center', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Cost center deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================
// PROFIT CENTERS
// =========================================================

router.get('/profit-centers', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('profit_centers').select('*').eq('tenant_id', req.auth.tenantId).eq('is_active', true).order('profit_center_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/profit-centers', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { profit_center_name, profit_center_short_name, profit_center_type,
                annual_target, quarterly_target, monthly_target,
                responsible_person, responsible_person_phone, responsible_person_email, description } = req.body;
        if (!profit_center_name || !profit_center_name.trim()) return res.status(400).json({ success: false, error: 'Profit center name is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const prefix = profit_center_name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_profit_center_code', { prefix });
        if (codeErr) throw codeErr;

        // FEATURE: Short Name auto-generates from Name's initials + a
        // true sequential number when not supplied - same pattern as
        // Ledger Accounts.
        let shortName = profit_center_short_name;
        if (!shortName) {
            const { data: shortNameRow, error: shortNameErr } = await tenantClient.rpc('next_short_name', { seq_name: 'tenant_master.seq_profit_center_short_name', initials: prefix });
            if (shortNameErr) throw shortNameErr;
            shortName = shortNameRow;
        }

        const { data, error } = await tenantClient
            .from('profit_centers')
            .insert({
                tenant_id: tenantId, profit_center_code: codeRow, profit_center_name: profit_center_name.trim(),
                profit_center_short_name: shortName, profit_center_type: profit_center_type || 'division',
                annual_target: annual_target || 0, quarterly_target: quarterly_target || 0, monthly_target: monthly_target || 0,
                responsible_person, responsible_person_phone, responsible_person_email, description,
                created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select()
            .single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'create_profit_center', 'profit_center', data.id, { new_data: data });
        res.json({ success: true, message: 'Profit center created successfully', data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/profit-centers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('profit_centers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const update = { ...req.body, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        const { data, error } = await tenantClient
            .from('profit_centers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'update_profit_center', 'profit_center', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/profit-centers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('profit_centers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient
            .from('profit_centers').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_profit_center', 'profit_center', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Profit center deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================
// LEDGER MAPPING (bulk reassignment)
// Powers a "pick a target, checkbox-select ledgers, apply" screen -
// same spirit as the reference screenshots' Group/Agent/Area mapping
// tabs, rebuilt with our own naming/API, not copied from any specific
// software's schema or UI.
// =========================================================
const MAPPING_FIELDS = {
    account_group_id: { table: 'account_groups', labelCol: 'group_name' },
    area_id: { table: 'areas', labelCol: 'area_name' },
    agent_id: { table: 'salesman_agents', labelCol: 'agent_name' }
};

router.get('/ledger-accounts/mapping-list', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const { field } = req.query;
        if (!MAPPING_FIELDS[field]) {
            return res.status(400).json({ success: false, error: `field must be one of: ${Object.keys(MAPPING_FIELDS).join(', ')}` });
        }
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('ledger_accounts')
            .select(`id, account_code, account_name, category_type, ${field}`)
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('account_name');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/ledger-accounts/bulk-map', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { field, target_id, ledger_account_ids } = req.body;
        if (!MAPPING_FIELDS[field]) {
            return res.status(400).json({ success: false, error: `field must be one of: ${Object.keys(MAPPING_FIELDS).join(', ')}` });
        }
        if (!Array.isArray(ledger_account_ids) || ledger_account_ids.length === 0) {
            return res.status(400).json({ success: false, error: 'ledger_account_ids must be a non-empty array' });
        }

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        // target_id may be null/'' to CLEAR the mapping for the selected ledgers.
        if (target_id) {
            const { data: target } = await tenantClient.from(MAPPING_FIELDS[field].table).select('id').eq('id', target_id).eq('tenant_id', tenantId).single();
            if (!target) return res.status(404).json({ success: false, error: 'Target not found' });
        }

        const update = { [field]: target_id || null, updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        const { error, count } = await tenantClient
            .from('ledger_accounts')
            .update(update)
            .in('id', ledger_account_ids)
            .eq('tenant_id', tenantId);
        if (error) throw error;

        // FIX: bulk mapping can silently rewrite the Group/Agent/Area for
        // many ledgers at once - one summary audit entry (not one per
        // record) captures what changed without flooding the log.
        await logAudit(tenantId, req.auth.userId, 'bulk_map_ledger_accounts', 'ledger_account', null, {
            field, target_id: target_id || null, ledger_account_ids, count: ledger_account_ids.length
        });

        res.json({ success: true, message: `Updated ${ledger_account_ids.length} ledger account(s)`, count });
    } catch (error) {
        console.error('Bulk ledger mapping error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
