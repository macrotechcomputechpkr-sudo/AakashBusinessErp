// =============================================
// routes/partySummaryRoutes.js
// Party Summary: per customer / supplier ledger -
//   Opening | Purchase | Sales | Purchase Return | Sales Return |
//   Debit Note | Credit Note | Receipt | Payment | Closing
// straight from the GL (ledger_transaction_lines on the party ledger),
// classified by the posting document:
//   sales_bill, sales_additional ............. Sales            (Dr - Cr)
//   purchase_bill, purchase_additional_expense,
//   purchase_grn ............................. Purchase         (Cr - Dr)
//   sales_return, sales_nonsalable_return .... Sales Return     (Cr - Dr)
//   purchase_return, purchase_nonsalable_return Purchase Return (Dr - Cr)
//   debit_note ............................... Debit Note       (Dr - Cr)
//   credit_note .............................. Credit Note      (Cr - Dr)
//   journal_voucher .......................... party Dr -> Debit Note, party Cr -> Credit Note
//   cash_bank_entry, pdc ..................... party Cr -> Receipt, party Dr -> Payment
//   anything else ............................ Others Dr / Others Cr
// Opening = ledger master opening + all movement before date_from (same as
// the Ledger Report). Closing = Opening + all Dr - all Cr, and every row is
// checked to equal the sum of its columns (reconciles = true).
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
async function fetchAll(build) {
    const out = []; const page = 1000;
    for (let from = 0; ; from += page) {
        const { data, error } = await build().range(from, from + page - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < page) return out;
    }
}

const NET_COLUMN = {
    sales_bill: ['sales', 1], sales_additional: ['sales', 1],
    purchase_bill: ['purchase', -1], purchase_additional_expense: ['purchase', -1], purchase_grn: ['purchase', -1],
    sales_return: ['sales_return', -1], sales_nonsalable_return: ['sales_return', -1],
    purchase_return: ['purchase_return', 1], purchase_nonsalable_return: ['purchase_return', 1],
    debit_note: ['debit_note', 1], credit_note: ['credit_note', -1]
};
// sign 1: column = Dr - Cr ; sign -1: column = Cr - Dr
const SIDE_COLUMN = {
    journal_voucher: { dr: 'debit_note', cr: 'credit_note' },
    cash_bank_entry: { dr: 'payment', cr: 'receipt' },
    pdc: { dr: 'payment', cr: 'receipt' }
};
const COLUMNS = ['purchase', 'sales', 'purchase_return', 'sales_return', 'debit_note', 'credit_note', 'receipt', 'payment', 'others_dr', 'others_cr'];
// How each column moves the balance (Dr positive) - used to prove the row reconciles.
const EFFECT = { sales: 1, purchase: -1, sales_return: -1, purchase_return: 1, debit_note: 1, credit_note: -1, receipt: -1, payment: 1, others_dr: 1, others_cr: -1 };

function classify(line, acc) {
    const type = line.batch.document_type;
    const dr = Number(line.debit_amount) || 0, cr = Number(line.credit_amount) || 0;
    if (NET_COLUMN[type]) {
        const [col, sign] = NET_COLUMN[type];
        acc[col] += sign * (dr - cr);
    } else if (SIDE_COLUMN[type]) {
        acc[SIDE_COLUMN[type].dr] += dr;
        acc[SIDE_COLUMN[type].cr] += cr;
    } else {
        acc.others_dr += dr; acc.others_cr += cr;
    }
}

async function descendantGroupIds(tenantClient, tenantId, rootId) {
    const { data: groups } = await tenantClient.from('account_groups').select('id, parent_group_id').eq('tenant_id', tenantId);
    const out = new Set([rootId]); let grew = true;
    while (grew) { grew = false; (groups || []).forEach(g => { if (g.parent_group_id && out.has(g.parent_group_id) && !out.has(g.id)) { out.add(g.id); grew = true; } }); }
    return [...out];
}

// Ledgers that have acted as customer / supplier on any document.
async function partyLedgerIds(tenantClient, tenantId, scope) {
    const sources = {
        customers: [['sales_quotations', 'customer_ledger_id'], ['sales_orders', 'customer_ledger_id'], ['sales_deliveries', 'customer_ledger_id'], ['sales_bills', 'customer_ledger_id'],
                    ['sales_returns', 'customer_ledger_id'], ['sales_nonsaleable_returns', 'customer_ledger_id'], ['sales_additional_entries', 'customer_ledger_id'], ['credit_notes', 'party_ledger_id']],
        suppliers: [['purchase_orders', 'vendor_ledger_id'], ['purchase_grns', 'vendor_ledger_id'], ['purchase_bills', 'vendor_ledger_id'], ['purchase_returns', 'vendor_ledger_id'],
                    ['purchase_nonsaleable_returns', 'vendor_ledger_id'], ['purchase_additional_expenses', 'vendor_ledger_id'], ['debit_notes', 'party_ledger_id']]
    };
    const lists = scope === 'customers' ? sources.customers : scope === 'suppliers' ? sources.suppliers : [...sources.customers, ...sources.suppliers];
    const ids = new Set();
    for (const [table, col] of lists) {
        const rows = await fetchAll(() => tenantClient.from(table).select(col).eq('tenant_id', tenantId).not(col, 'is', null));
        rows.forEach(r => ids.add(r[col]));
    }
    return [...ids];
}

router.get('/party-summary', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const q = req.query, tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        if (!q.date_from || !q.date_to) return res.status(400).json({ success: false, error: 'Choose From and To dates' });

        // ---------- which ledgers ----------
        let ledgerQ = () => tenantClient.from('ledger_accounts')
            .select('id, account_code, account_name, account_group_id, opening_balance, opening_balance_type, area_id, agent_id, route_id, pan_number, vat_pan_number')
            .eq('tenant_id', tenantId);
        let ledgers;
        if (q.account_group_id) {
            const groupIds = await descendantGroupIds(tenantClient, tenantId, q.account_group_id);
            ledgers = await fetchAll(() => ledgerQ().in('account_group_id', groupIds));
        } else {
            const ids = await partyLedgerIds(tenantClient, tenantId, q.party_scope || 'all');
            ledgers = [];
            for (const part of chunk(ids, 150)) ledgers.push(...await fetchAll(() => ledgerQ().in('id', part)));
        }
        if (q.party_ledger_id) ledgers = ledgers.filter(l => l.id === q.party_ledger_id);
        if (q.area_id) ledgers = ledgers.filter(l => l.area_id === q.area_id);
        if (q.agent_id) ledgers = ledgers.filter(l => l.agent_id === q.agent_id);
        if (q.route_id) ledgers = ledgers.filter(l => l.route_id === q.route_id);
        if (q.ledger_category_id) {
            const links = await fetchAll(() => tenantClient.from('ledger_account_categories').select('ledger_account_id').eq('ledger_category_id', q.ledger_category_id));
            const allowed = new Set(links.map(l => l.ledger_account_id));
            ledgers = ledgers.filter(l => allowed.has(l.id));
        }
        if (!ledgers.length) return res.json({ success: true, data: { rows: [], totals: null } });
        const ids = ledgers.map(l => l.id);

        // ---------- movement before the period (opening) and in the period ----------
        const openingMove = {}, acc = {}, drcr = {};
        ids.forEach(id => { openingMove[id] = 0; acc[id] = Object.fromEntries(COLUMNS.map(c => [c, 0])); drcr[id] = { dr: 0, cr: 0 }; });
        for (const part of chunk(ids, 150)) {
            const before = await fetchAll(() => {
                let x = tenantClient.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)')
                    .eq('tenant_id', tenantId).in('ledger_account_id', part).lt('batch.batch_date', q.date_from);
                if (q.product_company_id) x = x.eq('product_company_id', q.product_company_id);
                return x;
            });
            before.forEach(l => { openingMove[l.ledger_account_id] += Number(l.debit_amount || 0) - Number(l.credit_amount || 0); });
            const period = await fetchAll(() => {
                let x = tenantClient.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date, document_type)')
                    .eq('tenant_id', tenantId).in('ledger_account_id', part).gte('batch.batch_date', q.date_from).lte('batch.batch_date', q.date_to);
                if (q.product_company_id) x = x.eq('product_company_id', q.product_company_id);
                return x;
            });
            period.forEach(l => {
                classify(l, acc[l.ledger_account_id]);
                drcr[l.ledger_account_id].dr += Number(l.debit_amount || 0);
                drcr[l.ledger_account_id].cr += Number(l.credit_amount || 0);
            });
        }

        const { data: groups } = await tenantClient.from('account_groups').select('id, group_name').eq('tenant_id', tenantId);
        const groupName = Object.fromEntries((groups || []).map(g => [g.id, g.group_name]));
        // A company-wise view shows only that company's movement; the master
        // opening belongs to no company, so it is left out there.
        const masterOpening = l => q.product_company_id ? 0 : (l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0);

        let rows = ledgers.map(l => {
            const a = acc[l.id];
            const opening = round2(masterOpening(l) + openingMove[l.id]);
            const closing = round2(opening + drcr[l.id].dr - drcr[l.id].cr);
            const cols = Object.fromEntries(COLUMNS.map(c => [c, round2(a[c])]));
            const fromColumns = round2(opening + COLUMNS.reduce((s, c) => s + EFFECT[c] * a[c], 0));
            return {
                ledger_id: l.id, account_code: l.account_code, party_name: l.account_name, group_name: groupName[l.account_group_id] || '',
                pan: l.vat_pan_number || l.pan_number || null,
                opening, ...cols, closing, reconciles: Math.abs(fromColumns - closing) < 0.01,
                has_movement: COLUMNS.some(c => Math.abs(a[c]) > 0.005)
            };
        });
        if (q.hide_zero === 'true') rows = rows.filter(r => r.has_movement || Math.abs(r.opening) > 0.005 || Math.abs(r.closing) > 0.005);
        if (q.balance_side === 'dr') rows = rows.filter(r => r.closing > 0.005);
        if (q.balance_side === 'cr') rows = rows.filter(r => r.closing < -0.005);
        rows.sort((a, b) => String(a.party_name).localeCompare(String(b.party_name)));

        const totals = { opening: 0, closing: 0, ...Object.fromEntries(COLUMNS.map(c => [c, 0])) };
        rows.forEach(r => { totals.opening += r.opening; totals.closing += r.closing; COLUMNS.forEach(c => { totals[c] += r[c]; }); });
        Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });
        res.json({ success: true, data: { rows, totals, all_reconcile: rows.every(r => r.reconciles) } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
module.exports._internals = { classify, COLUMNS, EFFECT };
