// =============================================
// routes/ledgerOpeningRoutes.js
// Opening Balance entry for Ledger Accounts:
//   - Bulk, Excel-style grid entry (only Balance Sheet ledgers - NFRS
//     Income/Expenses are excluded, since P&L accounts don't carry an
//     opening balance forward).
//   - Restricted to whichever Fiscal Year has fiscal_years.has_opening_
//     balance = TRUE (the existing column, reused rather than duplicated).
//   - Document-wise (Tally "Bill-wise Details") breakdown for Customer/
//     Vendor ledgers - the sum of the bill lines IS the ledger's opening
//     balance, computed automatically rather than entered twice.
//   - Re-baseline: moving has_opening_balance to a LATER fiscal year
//     mid-life, capturing the previous figure, the new one, and the
//     computed Opening Difference in ledger_opening_history.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

// Signed-amount helpers: internally we always work with a single signed
// number (Dr positive, Cr negative) to add/subtract balances correctly,
// then convert back to (amount, type) for storage - the same convention
// as every other Dr/Cr pair in this system.
function toSigned(amount, type) { return type === 'cr' ? -Math.abs(amount) : Math.abs(amount); }
function fromSigned(signed) { return { amount: Math.abs(signed), type: signed < 0 ? 'cr' : 'dr' }; }

router.get('/ledger-opening/eligible-fiscal-year', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('fiscal_years').select('*').eq('tenant_id', req.auth.tenantId).eq('has_opening_balance', true).maybeSingle();
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: the bulk-editable ledger list - Balance Sheet ledgers only
// (NFRS category NOT IN Income/Expenses), since a P&L account's balance
// doesn't carry forward as an "opening" figure.
router.get('/ledger-opening/ledgers', requireAuth, async (req, res) => {
    try {
        const { fiscal_year_id } = req.query;
        if (!fiscal_year_id) return res.status(400).json({ success: false, error: 'fiscal_year_id is required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);

        const { data: fy } = await tenantClient.from('fiscal_years').select('*').eq('id', fiscal_year_id).eq('tenant_id', req.auth.tenantId).single();
        if (!fy) return res.status(404).json({ success: false, error: 'Fiscal year not found' });
        if (!fy.has_opening_balance) {
            return res.status(400).json({ success: false, error: 'Opening balance entry is not allowed in this fiscal year' });
        }

        const { data, error } = await tenantClient
            .from('ledger_accounts')
            .select('id, account_code, account_name, category_type, opening_balance, opening_balance_type, account_groups(group_name, nfrs_category)')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('account_name');
        if (error) throw error;

        // FIX: filter out P&L ledgers here rather than trusting a
        // Postgrest embedded-filter (which can't easily express "NOT IN
        // on a joined table" cleanly) - explicit and easy to verify.
        const balanceSheetOnly = (data || []).filter(l => !['Income', 'Expenses'].includes(l.account_groups?.nfrs_category));

        res.json({ success: true, data: balanceSheetOnly, fiscal_year: fy });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/ledger-opening/bulk-update', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { fiscal_year_id, rows } = req.body;
        if (!fiscal_year_id) return res.status(400).json({ success: false, error: 'fiscal_year_id is required' });
        if (!Array.isArray(rows)) return res.status(400).json({ success: false, error: 'rows must be an array' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: fy } = await tenantClient.from('fiscal_years').select('has_opening_balance').eq('id', fiscal_year_id).eq('tenant_id', tenantId).single();
        if (!fy?.has_opening_balance) {
            return res.status(400).json({ success: false, error: 'Opening balance entry is not allowed in this fiscal year' });
        }

        for (const row of rows) {
            if (!['dr', 'cr'].includes(row.opening_balance_type)) {
                return res.status(400).json({ success: false, error: `Invalid Dr/Cr type for ledger ${row.ledger_account_id}` });
            }
        }

        const results = [];
        for (const row of rows) {
            const { error } = await tenantClient
                .from('ledger_accounts')
                .update({ opening_balance: row.opening_balance || 0, opening_balance_type: row.opening_balance_type, updated_by: req.auth.userId })
                .eq('id', row.ledger_account_id).eq('tenant_id', tenantId);
            if (error) throw error;
            results.push(row.ledger_account_id);
        }

        await logAudit(tenantId, req.auth.userId, 'bulk_update_opening_balance', 'ledger_account', null, { fiscal_year_id, updated_count: results.length });
        res.json({ success: true, message: `Updated ${results.length} ledger(s)` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Document-wise (bill-wise) opening for Customer/Vendor ----------

router.get('/ledger-opening/bill-details', requireAuth, async (req, res) => {
    try {
        const { ledger_account_id, fiscal_year_id } = req.query;
        if (!ledger_account_id || !fiscal_year_id) return res.status(400).json({ success: false, error: 'ledger_account_id and fiscal_year_id are required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('ledger_opening_bill_details')
            .select('*, agent:agent_id(agent_name)')
            .eq('ledger_account_id', ledger_account_id).eq('fiscal_year_id', fiscal_year_id)
            .order('display_order');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: replace-all sync (same pattern as every other sub-table in
// this project) - and the sum of balance_amount BECOMES the ledger's
// single opening_balance automatically, so the two numbers can never
// disagree with each other.
router.put('/ledger-opening/bill-details', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { ledger_account_id, fiscal_year_id, bills } = req.body;
        if (!ledger_account_id || !fiscal_year_id) return res.status(400).json({ success: false, error: 'ledger_account_id and fiscal_year_id are required' });
        if (!Array.isArray(bills) || bills.length === 0) return res.status(400).json({ success: false, error: 'At least one bill line is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: ledger } = await tenantClient.from('ledger_accounts').select('category_type').eq('id', ledger_account_id).eq('tenant_id', tenantId).single();
        if (!ledger) return res.status(404).json({ success: false, error: 'Ledger not found' });
        if (!['sales', 'purchase', 'both'].includes(ledger.category_type)) {
            return res.status(400).json({ success: false, error: 'Document-wise opening is only applicable to Customer/Supplier ledgers' });
        }

        for (const b of bills) {
            if (!b.bill_date || !b.bill_no || !b.bill_amount) return res.status(400).json({ success: false, error: 'Each bill line needs a Date, Bill No, and Amount' });
        }

        await tenantClient.from('ledger_opening_bill_details').delete().eq('ledger_account_id', ledger_account_id).eq('fiscal_year_id', fiscal_year_id);
        const rows = bills.map((b, i) => ({
            tenant_id: tenantId, ledger_account_id, fiscal_year_id,
            bill_date: b.bill_date, bill_no: b.bill_no, bill_amount: b.bill_amount,
            agent_id: b.agent_id || null, balance_amount: b.balance_amount ?? b.bill_amount,
            display_order: i + 1, created_by: req.auth.userId
        }));
        const { error: insertErr } = await tenantClient.from('ledger_opening_bill_details').insert(rows);
        if (insertErr) throw insertErr;

        // Roll the bill-wise total up into the ledger's own opening_balance
        // - Customer ledgers (sales) are Dr by convention, Vendor (purchase) Cr.
        const total = rows.reduce((sum, r) => sum + Number(r.balance_amount), 0);
        const impliedType = ledger.category_type === 'purchase' ? 'cr' : 'dr';
        const { error: updateErr } = await tenantClient
            .from('ledger_accounts').update({ opening_balance: total, opening_balance_type: impliedType, updated_by: req.auth.userId })
            .eq('id', ledger_account_id).eq('tenant_id', tenantId);
        if (updateErr) throw updateErr;

        await logAudit(tenantId, req.auth.userId, 'set_opening_bill_details', 'ledger_account', ledger_account_id, { fiscal_year_id, bill_count: rows.length, total });
        res.json({ success: true, message: 'Bill-wise opening saved', data: { total, opening_balance_type: impliedType } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Re-baseline: move opening entry to a LATER fiscal year ----------

// FEATURE: honestly scoped - "previous closing" is read directly from
// ledger_accounts.opening_balance/type because no transaction module
// exists yet to have moved it since the original opening was entered.
// The moment Sales/Purchase/Journal posting exists, this same endpoint
// should instead read the ledger's actual closing balance as of the end
// of the previous fiscal year - the difference formula and the
// ledger_opening_history record stay correct either way.
router.post('/ledger-opening/rebaseline', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { new_fiscal_year_id, rows } = req.body;
        if (!new_fiscal_year_id) return res.status(400).json({ success: false, error: 'new_fiscal_year_id is required' });
        if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ success: false, error: 'rows must be a non-empty array' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: newFy } = await tenantClient.from('fiscal_years').select('*').eq('id', new_fiscal_year_id).eq('tenant_id', tenantId).single();
        if (!newFy) return res.status(404).json({ success: false, error: 'New fiscal year not found' });

        const { data: currentOpeningFy } = await tenantClient.from('fiscal_years').select('*').eq('tenant_id', tenantId).eq('has_opening_balance', true).maybeSingle();
        if (currentOpeningFy && new Date(newFy.start_date_eng) <= new Date(currentOpeningFy.start_date_eng)) {
            return res.status(400).json({ success: false, error: 'Re-baseline must move opening entry to a LATER fiscal year than the current one' });
        }

        const historyRows = [];
        for (const row of rows) {
            if (!['dr', 'cr'].includes(row.new_opening_balance_type)) {
                return res.status(400).json({ success: false, error: `Invalid Dr/Cr type for ledger ${row.ledger_account_id}` });
            }
            const { data: ledger } = await tenantClient.from('ledger_accounts').select('opening_balance, opening_balance_type').eq('id', row.ledger_account_id).eq('tenant_id', tenantId).single();
            if (!ledger) continue;

            const previousSigned = toSigned(ledger.opening_balance || 0, ledger.opening_balance_type || 'dr');
            const newSigned = toSigned(row.new_opening_balance || 0, row.new_opening_balance_type);
            const diff = fromSigned(newSigned - previousSigned);

            historyRows.push({
                tenant_id: tenantId, ledger_account_id: row.ledger_account_id,
                previous_fiscal_year_id: currentOpeningFy?.id || null,
                previous_opening_balance: ledger.opening_balance || 0, previous_opening_balance_type: ledger.opening_balance_type || 'dr',
                new_fiscal_year_id, new_opening_balance: row.new_opening_balance || 0, new_opening_balance_type: row.new_opening_balance_type,
                opening_difference_amount: diff.amount, opening_difference_type: diff.type,
                created_by: req.auth.userId
            });

            await tenantClient.from('ledger_accounts')
                .update({ opening_balance: row.new_opening_balance || 0, opening_balance_type: row.new_opening_balance_type, updated_by: req.auth.userId })
                .eq('id', row.ledger_account_id).eq('tenant_id', tenantId);
        }

        if (historyRows.length > 0) {
            const { error: histErr } = await tenantClient.from('ledger_opening_history').insert(historyRows);
            if (histErr) throw histErr;
        }

        // Move the has_opening_balance flag: off the old FY, onto the new one.
        if (currentOpeningFy) {
            await tenantClient.from('fiscal_years').update({ has_opening_balance: false }).eq('id', currentOpeningFy.id).eq('tenant_id', tenantId);
        }
        await tenantClient.from('fiscal_years').update({ has_opening_balance: true, opening_balance_date: newFy.start_date_eng }).eq('id', new_fiscal_year_id).eq('tenant_id', tenantId);

        await logAudit(tenantId, req.auth.userId, 'rebaseline_opening_balance', 'fiscal_year', new_fiscal_year_id, { from_fiscal_year: currentOpeningFy?.id, ledger_count: historyRows.length });
        res.json({ success: true, message: `Re-baselined ${historyRows.length} ledger(s) to the new fiscal year`, data: historyRows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/ledger-opening/history', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        let query = tenantClient
            .from('ledger_opening_history')
            .select('*, ledger:ledger_account_id(account_name, account_code), previous_fy:previous_fiscal_year_id(fiscal_year_name), new_fy:new_fiscal_year_id(fiscal_year_name)')
            .eq('tenant_id', req.auth.tenantId)
            .order('created_at', { ascending: false });
        if (req.query.ledger_account_id) query = query.eq('ledger_account_id', req.query.ledger_account_id);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
