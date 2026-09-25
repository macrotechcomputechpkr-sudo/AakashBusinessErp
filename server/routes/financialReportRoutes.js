// =============================================
// routes/financialReportRoutes.js
// Trial Balance, Profit & Loss, Balance Sheet (each with an optional
// comparative period), Ratios + Cash Flow + Funds Flow, Stock valuation by
// every method side by side, and the group-to-statement mapping. All figures
// come from utils/financialEngine.js.
// =============================================
const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const fe = require('../utils/financialEngine');
const stockEngine = require('../utils/stockEngine');
const { cleanLines } = require('../utils/budgetReports');

const guard = [requireAuth, loadUserPermissions, requirePermission('reports', 'view')];
const wrap = fn => async (req, res) => {
    try { res.json({ success: true, data: await fn(req, await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.query) }); }
    catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
};
const need = (q, ...keys) => { const miss = keys.filter(k => !q[k]); if (miss.length) { const e = new Error(`Missing: ${miss.join(', ')}`); e.status = 400; throw e; } };
const method = q => (fe.STOCK_METHODS[q.stock_method] ? q.stock_method : 'weighted_average');
const num = v => (v === undefined || v === '' ? null : Number(v));

// Start of the fiscal year that contains `date` (else the earliest FY, else 1 Jan).
async function fyStartFor(c, t, date) {
    const { data: years } = await c.from('fiscal_years').select('start_date_eng, end_date_eng').eq('tenant_id', t);
    const ys = (years || []).map(y => ({ s: String(y.start_date_eng).slice(0, 10), e: String(y.end_date_eng).slice(0, 10) })).sort((a, b) => a.s.localeCompare(b.s));
    const hit = ys.find(y => y.s <= date && date <= y.e);
    return hit ? hit.s : (ys[0] && ys[0].s <= date ? ys[0].s : `${date.slice(0, 4)}-01-01`);
}
// Month buckets inside [from, to]: the configured Nepali VAT months when they
// cover the range, otherwise English calendar months.
async function monthBuckets(c, t, from, to) {
    const { data: periods } = await c.from('fiscal_periods').select('period_name, start_date, end_date').eq('tenant_id', t);
    const ps = (periods || []).map(p => ({ label: p.period_name, s: String(p.start_date).slice(0, 10), e: String(p.end_date).slice(0, 10) }))
        .filter(p => p.e >= from && p.s <= to).sort((a, b) => a.s.localeCompare(b.s));
    const covered = ps.length && ps[0].s <= from && ps[ps.length - 1].e >= to;
    if (covered) return ps.map(p => ({ label: p.label, from: p.s < from ? from : p.s, to: p.e > to ? to : p.e }));
    const out = []; let cur = from;
    while (cur <= to) {
        const d = new Date(cur + 'T00:00:00Z');
        const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
        out.push({ label: cur.slice(0, 7), from: cur, to: end > to ? to : end });
        cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    }
    return out;
}

router.get('/financial/meta', requireAuth, (req, res) => res.json({ success: true, data: { stock_methods: fe.STOCK_METHODS } }));

router.get('/financial/trial-balance', ...guard, wrap(async (req, c, t, q) => {
    need(q, 'date_from', 'date_to');
    return fe.trialBalance(c, t, { from: q.date_from, to: q.date_to, productCompanyId: q.product_company_id || null });
}));

router.get('/financial/profit-loss', ...guard, wrap(async (req, c, t, q) => {
    need(q, 'date_from', 'date_to');
    const opts = { stockMethod: method(q), manualOpening: num(q.manual_opening_stock), manualClosing: num(q.manual_closing_stock), productCompanyId: q.product_company_id || null };
    const current = await fe.profitAndLoss(c, t, { ...opts, from: q.date_from, to: q.date_to });
    const compare = q.compare_from && q.compare_to ? await fe.profitAndLoss(c, t, { ...opts, manualOpening: null, manualClosing: null, from: q.compare_from, to: q.compare_to }) : null;
    // Opening | Period | Closing: FY start -> day before From | From -> To | FY start -> To (YTD)
    let columns = null;
    if (q.columns === 'opening_period_closing') {
        const fyStart = await fyStartFor(c, t, q.date_from);
        const base = { ...opts, manualOpening: null, manualClosing: null };
        columns = {
            fy_start: fyStart,
            opening: fyStart < q.date_from ? await fe.profitAndLoss(c, t, { ...base, from: fyStart, to: fe.dayBefore(q.date_from) }) : null,
            period: current,
            closing: fyStart < q.date_from ? await fe.profitAndLoss(c, t, { ...base, from: fyStart, to: q.date_to }) : current
        };
    }
    // One column per month of the range
    let monthly = null;
    if (q.monthly === 'true') {
        const buckets = await monthBuckets(c, t, q.date_from, q.date_to);
        if (buckets.length > 24) { const e = new Error('Monthly view is limited to 24 months'); e.status = 400; throw e; }
        monthly = [];
        for (const b of buckets) monthly.push({ label: b.label, from: b.from, to: b.to, pl: await fe.profitAndLoss(c, t, { ...opts, manualOpening: null, manualClosing: null, from: b.from, to: b.to }) });
    }
    return { current, compare, columns, monthly };
}));

router.get('/financial/balance-sheet', ...guard, wrap(async (req, c, t, q) => {
    need(q, 'as_of');
    const opts = { stockMethod: method(q), productCompanyId: q.product_company_id || null };
    const current = await fe.balanceSheet(c, t, { ...opts, asOf: q.as_of, manualStock: num(q.manual_stock) });
    const compare = q.compare_as_of ? await fe.balanceSheet(c, t, { ...opts, asOf: q.compare_as_of, manualStock: null }) : null;
    // Opening | Movement | Closing: position at the day before From vs at As-of
    const opening = q.columns === 'opening_period_closing' && q.date_from ? await fe.balanceSheet(c, t, { ...opts, asOf: fe.dayBefore(q.date_from), manualStock: null }) : null;
    return { current, compare, opening };
}));

router.get('/financial/ratios-flows', ...guard, wrap(async (req, c, t, q) => {
    need(q, 'date_from', 'date_to');
    return fe.ratiosAndFlows(c, t, { from: q.date_from, to: q.date_to, stockMethod: method(q), productCompanyId: q.product_company_id || null });
}));

router.get('/financial/stock-valuation', ...guard, wrap(async (req, c, t, q) => {
    need(q, 'as_of');
    const methods = Object.keys(fe.STOCK_METHODS).filter(m => m !== 'manual');
    const all = {};
    for (const m of methods) all[m] = await fe.stockValuation(c, t, q.as_of, m);
    const detail = all[method(q)] || all.weighted_average;
    return { as_of: q.as_of, summary: methods.map(m => ({ method: m, label: fe.STOCK_METHODS[m], value: all[m].value })), detail };
}));

router.get('/financial/schedules', ...guard, wrap(async (req, c, t, q) => {
    need(q, 'date_from', 'date_to');
    return fe.schedules(c, t, { from: q.date_from, to: q.date_to, productCompanyId: q.product_company_id || null });
}));

// Stock Movement: per item Opening | module-wise In / Out | Closing, qty and value,
// from the same engine as the financial statements' stock.
router.get('/stock/movement', ...guard, wrap(async (req, c, t, q) => {
    need(q, 'date_from', 'date_to');
    const m = stockEngine.METHODS[q.stock_method] ? q.stock_method : 'weighted_average';
    return stockEngine.stockMovement(c, t, { from: q.date_from, to: q.date_to, method: m, productId: q.product_id || null,
        productGroupId: q.product_group_id || null, productCompanyId: q.product_company_id || null, hideZero: q.hide_zero !== 'false',
        columns: q.columns === 'detail' ? 'detail' : 'summary' });
}));

router.get('/financial/mapping', ...guard, wrap(async (req, c, t) => fe.groupMapping(c, t)));

router.get('/financial/fy-start', ...guard, wrap(async (req, c, t, q) => { need(q, 'date'); return { fy_start: await fyStartFor(c, t, q.date) }; }));

// ---------------- Budgets ----------------
router.get('/budgets', ...guard, wrap(async (req, c, t) => {
    const { data, error } = await c.from('budgets').select('*').eq('tenant_id', t).order('date_from', { ascending: false });
    if (error) throw error; return data;
}));
router.post('/budgets', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), wrap(async (req, c, t, q) => {
    const b = req.body || {};
    if (!b.budget_name || !b.date_from || !b.date_to) { const e = new Error('Budget name, From and To are required'); e.status = 400; throw e; }
    if (b.date_to < b.date_from) { const e = new Error('To date must be on or after From date'); e.status = 400; throw e; }
    const row = { tenant_id: t, budget_name: String(b.budget_name).trim(), date_from: b.date_from, date_to: b.date_to, notes: b.notes || null, split_type: b.split_type === 'monthly' ? 'monthly' : 'total', created_by: req.auth.userId };
    const { data, error } = b.id
        ? await c.from('budgets').update({ ...row, updated_at: new Date().toISOString() }).eq('id', b.id).eq('tenant_id', t).select().single()
        : await c.from('budgets').insert(row).select().single();
    if (error) { if (/unique_budget_name|duplicate/i.test(error.message)) { const e = new Error('A budget with this name already exists'); e.status = 400; throw e; } throw error; }
    return data;
}));
router.delete('/budgets/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), wrap(async (req, c, t) => {
    const { error } = await c.from('budgets').delete().eq('id', req.params.id).eq('tenant_id', t);
    if (error) throw error; return { deleted: true };
}));
router.get('/budgets/:id/lines', ...guard, wrap(async (req, c, t) => {
    const { data, error } = await c.from('budget_lines').select('*').eq('budget_id', req.params.id).eq('tenant_id', t);
    if (error) throw error; return data;
}));
// Replace all lines of a budget in one save (the grid sends its full state).
router.put('/budgets/:id/lines', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), wrap(async (req, c, t) => {
    const { data: budget } = await c.from('budgets').select('id, date_from, date_to').eq('id', req.params.id).eq('tenant_id', t).maybeSingle();
    if (!budget) { const e = new Error('Budget not found'); e.status = 404; throw e; }
    // ledger / group + optional sub-ledger, cost center, unit, branch, doc class, month split
    const lines = cleanLines(Array.isArray(req.body?.lines) ? req.body.lines : [], budget);
    const { error: delErr } = await c.from('budget_lines').delete().eq('budget_id', req.params.id).eq('tenant_id', t);
    if (delErr) throw delErr;
    if (lines.length) {
        const { error } = await c.from('budget_lines').insert(lines.map(l => ({ tenant_id: t, budget_id: req.params.id, ...l })));
        if (error) throw error;
    }
    return { saved: lines.length };
}));
router.get('/financial/budget-vs-actual', ...guard, wrap(async (req, c, t, q) => {
    need(q, 'budget_id');
    const { data: budget } = await c.from('budgets').select('*').eq('id', q.budget_id).eq('tenant_id', t).maybeSingle();
    if (!budget) { const e = new Error('Budget not found'); e.status = 404; throw e; }
    const { data: lines } = await c.from('budget_lines').select('*').eq('budget_id', q.budget_id).eq('tenant_id', t);
    return fe.budgetVsActual(c, t, { ...budget, date_from: String(budget.date_from).slice(0, 10), date_to: String(budget.date_to).slice(0, 10) }, lines || []);
}));

module.exports = router;
