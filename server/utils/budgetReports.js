// =============================================
// utils/budgetReports.js
// Budget vs actual with accounting dimensions. A budget line targets a
// ledger or an account group (with its sub-groups) and may be narrowed to a
// sub-ledger, cost center, unit, branch and / or document class; its amount
// can be split month-wise (budget_lines.month_amounts {"YYYY-MM": amount}),
// otherwise it is spread evenly over the budget's months.
// Actuals are the GL movement inside the budget period in the account's
// natural direction (income / liabilities credit-positive, expenses /
// assets debit-positive), taken from utils/dimensionReports (same dimension
// resolution as the Cost Center / Doc Class reports).
// Views
//   variance       one row per budget line
//   monthly        line x month, budget / actual / variance
//   by_dimension   totals by ledger / group / sub-ledger / cost center / unit /
//                  branch / doc class
//   transactions   the GL lines behind one budget line
//   unbudgeted     P&L actuals no budget line covers
// =============================================
const D = require('./dimensionReports');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const DIM_KEYS = { sub_ledger_id: 'sub_ledger', cost_center_id: 'cost_center', business_unit_id: 'business_unit', branch_id: 'branch', doc_class_id: 'doc_class' };
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function monthsOf(from, to) {
    const out = [];
    for (let cur = from; cur <= to;) {
        const d = new Date(`${cur}T00:00:00Z`);
        const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
        out.push({ key: cur.slice(0, 7), from: cur, to: end > to ? to : end });
        cur = addDays(end, 1);
    }
    return out;
}
const natural = (section, dr, cr) => (section === 'trading_income' || section === 'indirect_income' || section === 'liabilities' || section === 'equity' ? cr - dr : dr - cr);
const isCost = s => s === 'trading_expense' || s === 'indirect_expense';

async function load(c, t, budgetId) {
    const { data: budget } = await c.from('budgets').select('*').eq('id', budgetId).eq('tenant_id', t).maybeSingle();
    if (!budget) throw httpError('Budget not found', 404);
    const { data: lines } = await c.from('budget_lines').select('*').eq('budget_id', budgetId).eq('tenant_id', t);
    const from = String(budget.date_from).slice(0, 10), to = String(budget.date_to).slice(0, 10);
    const M = await D.masters(c, t);
    const gl = (await D.dimLines(c, t, M, { from, to })).filter(l => l.date >= from && l.date <= to);
    const groups = M.groups;
    const descendants = gid => { const out = new Set([gid]); let grew = true; while (grew) { grew = false; Object.values(groups).forEach(g => { if (g.parent_group_id && out.has(g.parent_group_id) && !out.has(g.id)) { out.add(g.id); grew = true; } }); } return out; };
    const months = monthsOf(from, to);
    const catName = id => { const x = M.cats.find(k => k.id === id); return x ? `${x.category_name} (${x.voucher_type})` : ''; };
    const rows = (lines || []).map(l => {
        const set = l.account_group_id ? descendants(l.account_group_id) : null;
        const hit = gl.filter(g => (l.ledger_id ? g.ledger === l.ledger_id : set.has(g.group))
            && Object.entries(DIM_KEYS).every(([col, dim]) => !l[col] || g[dim] === l[col]));
        const section = l.ledger_id ? sectionOfLedger(M, l.ledger_id) : sectionOfGroup(M, l.account_group_id);
        const actual = round2(hit.reduce((s, g) => s + natural(g.section, g.dr, g.cr), 0));
        const amount = round2(l.amount);
        const mAmounts = l.month_amounts && typeof l.month_amounts === 'object' ? l.month_amounts : null;
        const budgetBy = months.map(m => (mAmounts ? Number(mAmounts[m.key]) || 0 : amount / months.length));
        const actualBy = months.map(m => round2(hit.filter(g => g.date >= m.from && g.date <= m.to).reduce((s, g) => s + natural(g.section, g.dr, g.cr), 0)));
        const variance = round2(actual - amount);
        const dims = {
            sub_ledger: l.sub_ledger_id ? M.subs[l.sub_ledger_id]?.sub_ledger_name || '?' : '', cost_center: l.cost_center_id ? M.ccs[l.cost_center_id]?.cost_center_name || '?' : '',
            business_unit: l.business_unit_id ? M.bus[l.business_unit_id]?.unit_name || '?' : '', branch: l.branch_id ? M.branches[l.branch_id]?.branch_name || '?' : '',
            doc_class: l.doc_class_id ? catName(l.doc_class_id) || '?' : ''
        };
        return {
            id: l.id, target_type: l.ledger_id ? 'ledger' : 'group', target_id: l.ledger_id || l.account_group_id,
            name: l.ledger_id ? M.ledgers[l.ledger_id]?.account_name || '(ledger)' : groups[l.account_group_id]?.group_name || '(group)',
            section, ...dims, dims_label: Object.values(dims).filter(Boolean).join(' · '),
            ledger_id: l.ledger_id, account_group_id: l.account_group_id, sub_ledger_id: l.sub_ledger_id, cost_center_id: l.cost_center_id, business_unit_id: l.business_unit_id, branch_id: l.branch_id, doc_class_id: l.doc_class_id,
            budget: amount, actual, variance, variance_pct: amount ? round2(variance * 100 / Math.abs(amount)) : null, achievement_pct: amount ? round2(actual * 100 / amount) : null,
            favourable: isCost(section) ? variance <= 0 : variance >= 0, remarks: l.remarks || null,
            months: months.map((m, i) => ({ key: m.key, budget: round2(budgetBy[i]), actual: actualBy[i], variance: round2(actualBy[i] - budgetBy[i]) })),
            _hit: hit
        };
    });
    return { budget: { ...budget, date_from: from, date_to: to }, months, rows, gl, M };
}
function sectionOfLedger(M, id) { const led = M.ledgers[id]; return led ? require('./financialEngine').sectionOf(M.groups[led.account_group_id]) : null; }
function sectionOfGroup(M, id) { return require('./financialEngine').sectionOf(M.groups[id]); }
const strip = r => { const { _hit, ...rest } = r; return rest; };

async function budgetReport(c, t, view, q) {
    if (!q.budget_id) throw httpError('Choose a budget');
    const X = await load(c, t, q.budget_id);
    const tot = (rows, k) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    if (view === 'variance') {
        let rows = X.rows;
        if (q.only === 'adverse') rows = rows.filter(r => !r.favourable);
        if (q.only === 'over_80') rows = rows.filter(r => r.achievement_pct !== null && r.achievement_pct >= 80);
        return { budget: X.budget, rows: rows.map(({ months, ...r }) => strip(r)), totals: { budget: tot(rows, 'budget'), actual: tot(rows, 'actual'), variance: tot(rows, 'variance') } };
    }
    if (view === 'monthly') {
        const totals = X.months.map((m, i) => ({ key: m.key, budget: round2(X.rows.reduce((s, r) => s + r.months[i].budget, 0)), actual: round2(X.rows.reduce((s, r) => s + r.months[i].actual, 0)) }));
        totals.forEach(x => { x.variance = round2(x.actual - x.budget); });
        let cum = { budget: 0, actual: 0 };
        const cumulative = totals.map(x => { cum = { budget: round2(cum.budget + x.budget), actual: round2(cum.actual + x.actual) }; return { key: x.key, ...cum, variance: round2(cum.actual - cum.budget) }; });
        return { budget: X.budget, months: X.months.map(m => m.key), rows: X.rows.map(strip), totals, cumulative };
    }
    if (view === 'by_dimension') {
        const dim = ['ledger', 'group', 'sub_ledger', 'cost_center', 'business_unit', 'branch', 'doc_class', 'section'].includes(q.dimension) ? q.dimension : 'cost_center';
        const acc = {};
        X.rows.forEach(r => {
            let key, name;
            if (dim === 'ledger') { key = r.ledger_id || `g:${r.account_group_id}`; name = r.name; }
            else if (dim === 'group') { const gid = r.account_group_id || X.M.ledgers[r.ledger_id]?.account_group_id; key = gid; name = X.M.groups[gid]?.group_name || '(none)'; }
            else if (dim === 'section') { key = r.section; name = r.section || '(unmapped)'; }
            else { key = r[`${dim}_id`] || '-'; name = r[dim] || `(no ${dim.replace('_', ' ')})`; }
            const a = (acc[key] = acc[key] || { key, name, lines: 0, budget: 0, actual: 0, cost: isCost(r.section) });
            a.lines++; a.budget += r.budget; a.actual += r.actual;
        });
        const rows = Object.values(acc).map(a => ({ ...a, budget: round2(a.budget), actual: round2(a.actual), variance: round2(a.actual - a.budget), achievement_pct: a.budget ? round2(a.actual * 100 / a.budget) : null,
            favourable: a.cost ? a.actual <= a.budget : a.actual >= a.budget })).sort((x, y) => String(x.name).localeCompare(String(y.name)));
        return { budget: X.budget, dimension: dim, rows, totals: { budget: tot(rows, 'budget'), actual: tot(rows, 'actual'), variance: tot(rows, 'variance') } };
    }
    if (view === 'transactions') {
        const r = X.rows.find(x => x.id === q.line_id);
        if (!r) throw httpError('Budget line not found', 404);
        let run = 0;
        const lines = r._hit.sort((a, b) => a.date.localeCompare(b.date)).map(g => { const amt = round2(natural(g.section, g.dr, g.cr)); run = round2(run + amt); return { date: g.date, doc_label: g.doc_label, doc_no: g.doc_no, ledger_name: g.ledger_name, narration: g.narration, debit: g.dr, credit: g.cr, amount: amt, running: run }; });
        return { budget: X.budget, line: strip({ ...r, months: undefined }), rows: lines };
    }
    if (view === 'unbudgeted') {
        const covered = new Set(X.rows.flatMap(r => r._hit.map(g => g.id)));
        const acc = {};
        X.gl.filter(g => g.statement === 'pl' && !covered.has(g.id)).forEach(g => {
            const k = `${g.ledger}|${g.cost_center || ''}|${g.business_unit || ''}`;
            const a = (acc[k] = acc[k] || { ledger_id: g.ledger, ledger_name: g.ledger_name, group_name: g.group_name, section: g.section,
                cost_center: g.cost_center ? X.M.ccs[g.cost_center]?.cost_center_name || '?' : '', business_unit: g.business_unit ? X.M.bus[g.business_unit]?.unit_name || '?' : '', actual: 0, entries: 0 });
            a.actual += natural(g.section, g.dr, g.cr); a.entries++;
        });
        const rows = Object.values(acc).map(a => ({ ...a, actual: round2(a.actual) })).filter(a => a.actual).sort((a, b) => Math.abs(b.actual) - Math.abs(a.actual));
        return { budget: X.budget, rows, totals: { actual: tot(rows, 'actual') } };
    }
    throw httpError('Unknown budget report');
}

// Validates and normalises budget lines coming from the grid.
function cleanLines(lines, budget) {
    const months = monthsOf(String(budget.date_from).slice(0, 10), String(budget.date_to).slice(0, 10)).map(m => m.key);
    const seen = new Set();
    return lines.map((l, i) => {
        if (!!l.ledger_id === !!l.account_group_id) throw httpError(`Line ${i + 1}: choose either a ledger or a group`);
        const key = [l.ledger_id || `G:${l.account_group_id}`, ...Object.keys(DIM_KEYS).map(k => l[k] || '')].join('|');
        if (seen.has(key)) throw httpError(`Line ${i + 1}: the same ledger / group with the same dimensions appears twice`);
        seen.add(key);
        let monthAmounts = null, amount = Number(l.amount) || 0;
        if (l.month_amounts && typeof l.month_amounts === 'object' && Object.keys(l.month_amounts).length) {
            monthAmounts = {};
            months.forEach(m => { const v = Number(l.month_amounts[m]) || 0; if (v) monthAmounts[m] = round2(v); });
            amount = round2(Object.values(monthAmounts).reduce((s, v) => s + v, 0));
        }
        return { ledger_id: l.ledger_id || null, account_group_id: l.account_group_id || null, sub_ledger_id: l.sub_ledger_id || null, cost_center_id: l.cost_center_id || null,
            business_unit_id: l.business_unit_id || null, branch_id: l.branch_id || null, doc_class_id: l.doc_class_id || null, amount, month_amounts: monthAmounts, remarks: l.remarks || null };
    });
}

module.exports = { budgetReport, cleanLines, monthsOf };
