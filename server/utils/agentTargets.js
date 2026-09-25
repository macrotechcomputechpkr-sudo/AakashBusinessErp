// =============================================
// utils/agentTargets.js
// Salesman / agent targets and commission.
//   target       per agent per period (month / quarter / year / custom range)
//                for all products or one product / product group (with its
//                sub-groups) / product company / product category, in qty
//                (base units) and / or value (net of VAT)
//   achievement  posted sales bills of that agent minus posted sales returns
//   commission   % of achieved value, rate per achieved qty, or a fixed amount;
//                nothing below the minimum achievement %
//   posting      Dr commission expense / Cr commission payable, one posting
//                per target; a target already posted is skipped next time
// =============================================
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const csv = v => (Array.isArray(v) ? v : v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}
const DIM_LABEL = { all: 'All products', product: 'Product', product_group: 'Product Group', product_company: 'Product Company', category: 'Product Category' };
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- periods
// Month buckets over [from, to]: configured (Nepali) fiscal periods when they
// cover the range, else English calendar months.
async function monthBuckets(c, t, from, to) {
    const { data: periods } = await c.from('fiscal_periods').select('period_name, start_date, end_date').eq('tenant_id', t);
    const ps = (periods || []).map(p => ({ label: p.period_name, from: String(p.start_date).slice(0, 10), to: String(p.end_date).slice(0, 10) }))
        .filter(p => p.to >= from && p.from <= to).sort((a, b) => a.from.localeCompare(b.from));
    if (ps.length && ps[0].from <= from && ps[ps.length - 1].to >= to) return ps.map(p => ({ ...p, from: p.from < from ? from : p.from, to: p.to > to ? to : p.to }));
    const out = [];
    for (let cur = from; cur <= to;) {
        const d = new Date(`${cur}T00:00:00Z`);
        const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
        out.push({ label: cur.slice(0, 7), from: cur, to: end > to ? to : end });
        cur = addDays(end, 1);
    }
    return out;
}
async function periodsFor(c, t, type, from, to) {
    if (type === 'year' || type === 'custom') return [{ label: type === 'year' ? `Year ${from.slice(0, 4)}` : `${from} - ${to}`, from, to }];
    const months = await monthBuckets(c, t, from, to);
    if (type === 'month') return months;
    const out = [];
    for (let i = 0; i < months.length; i += 3) {
        const q = months.slice(i, i + 3);
        out.push({ label: `Q${out.length + 1} (${q[0].label} - ${q[q.length - 1].label})`, from: q[0].from, to: q[q.length - 1].to });
    }
    return out;
}

// ---------------------------------------------------------------- CRUD
function cleanTarget(b) {
    if (!b.agent_id) throw httpError('Choose the salesman / agent');
    if (!b.period_from || !b.period_to || b.period_to < b.period_from) throw httpError('A valid period is required');
    const dimension = DIM_LABEL[b.dimension] ? b.dimension : 'all';
    if (dimension !== 'all' && !b.dimension_id) throw httpError(`Choose the ${DIM_LABEL[dimension]}`);
    const qty = Number(b.target_qty) || 0, value = Number(b.target_value) || 0;
    if (qty < 0 || value < 0) throw httpError('Targets cannot be negative');
    if (!qty && !value) throw httpError('Give a target quantity or value');
    const basis = ['value_percent', 'qty_rate', 'fixed'].includes(b.commission_basis) ? b.commission_basis : 'value_percent';
    return {
        agent_id: b.agent_id, period_type: ['month', 'quarter', 'year', 'custom'].includes(b.period_type) ? b.period_type : 'custom', period_label: b.period_label || null,
        period_from: b.period_from, period_to: b.period_to, dimension, dimension_id: dimension === 'all' ? null : b.dimension_id,
        target_qty: qty, target_value: value, commission_basis: basis, commission_rate: Number(b.commission_rate) || 0, fixed_commission: Number(b.fixed_commission) || 0,
        min_achievement_pct: Number(b.min_achievement_pct) || 0, remarks: b.remarks || null, is_active: b.is_active !== false
    };
}
async function saveTarget(c, t, userId, b) {
    const row = cleanTarget(b);
    if (b.id) {
        const { data: posted } = await c.from('agent_commission_postings').select('id').eq('target_id', b.id).eq('status', 'posted').maybeSingle();
        if (posted) throw httpError('Commission for this target is already posted - cancel that posting first');
        const { data, error } = await c.from('agent_targets').update(row).eq('id', b.id).eq('tenant_id', t).select().single();
        if (error) throw error; return data;
    }
    const { data, error } = await c.from('agent_targets').insert({ ...row, tenant_id: t, created_by: userId }).select().single();
    if (error) throw error; return data;
}
// Many targets at once: every period of [from, to] for every chosen agent.
// split 'each' = the given qty / value per period; 'divide' = spread evenly.
async function generateTargets(c, t, userId, b) {
    const agents = csv(b.agent_ids);
    if (!agents.length) throw httpError('Choose at least one salesman');
    if (!b.date_from || !b.date_to) throw httpError('Choose the period range');
    const periods = await periodsFor(c, t, b.period_type || 'month', b.date_from, b.date_to);
    const n = periods.length;
    const qty = Number(b.target_qty) || 0, value = Number(b.target_value) || 0;
    const existing = await fetchAll(() => c.from('agent_targets').select('agent_id, period_from, period_to, dimension, dimension_id').eq('tenant_id', t).in('agent_id', agents).order('id'));
    const key = r => [r.agent_id, r.period_from, r.period_to, r.dimension, r.dimension_id || ''].join('|');
    const has = new Set(existing.map(r => key({ ...r, period_from: String(r.period_from).slice(0, 10), period_to: String(r.period_to).slice(0, 10) })));
    const rows = [];
    agents.forEach(a => periods.forEach(p => {
        const row = cleanTarget({ ...b, agent_id: a, period_type: b.period_type || 'month', period_label: p.label, period_from: p.from, period_to: p.to,
            target_qty: b.split === 'divide' ? round4(qty / n) : qty, target_value: b.split === 'divide' ? round2(value / n) : value });
        if (!has.has(key(row))) rows.push({ ...row, tenant_id: t, created_by: userId });
    }));
    for (let i = 0; i < rows.length; i += 500) { const { error } = await c.from('agent_targets').insert(rows.slice(i, i + 500)); if (error) throw error; }
    return { created: rows.length, skipped: agents.length * n - rows.length, periods: n };
}

// ---------------------------------------------------------------- achievement
async function productInfo(c, t) {
    const [products, groups, links] = await Promise.all([
        fetchAll(() => c.from('products').select('id, product_name, product_group_id, product_company_id, base_unit_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_groups').select('id, parent_group_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_category_links').select('product_id, product_category_id').eq('tenant_id', t).order('id')).catch(() => [])
    ]);
    const parent = Object.fromEntries(groups.map(g => [g.id, g.parent_group_id]));
    const chain = gid => { const out = []; for (let g = gid, i = 0; g && i < 50; g = parent[g], i++) out.push(g); return out; };
    const cats = {};
    links.forEach(l => { (cats[l.product_id] = cats[l.product_id] || []).push(l.product_category_id); });
    return Object.fromEntries(products.map(p => [p.id, { ...p, groups: chain(p.product_group_id), categories: cats[p.id] || [] }]));
}
async function factors(c, lines) {
    const ids = [...new Set(lines.map(l => l.product_id))];
    const rates = await inChunks(ids, async ch => (await c.from('product_unit_rates').select('product_id, unit_id, conversion_factor').in('product_id', ch)).data || []);
    return Object.fromEntries(rates.map(r => [`${r.product_id}|${r.unit_id}`, Number(r.conversion_factor) || 1]));
}
function matches(target, info) {
    if (!info) return target.dimension === 'all';
    switch (target.dimension) {
        case 'product': return info.id === target.dimension_id;
        case 'product_group': return info.groups.includes(target.dimension_id);
        case 'product_company': return info.product_company_id === target.dimension_id;
        case 'category': return info.categories.includes(target.dimension_id);
        default: return true;
    }
}
// Signed sales lines (returns negative) for the agents in [from, to].
async function salesLines(c, t, agentIds, from, to) {
    const [bills, rets] = await Promise.all([
        fetchAll(() => c.from('sales_bills').select('id, doc_no, doc_date, agent_id').eq('tenant_id', t).eq('status', 'posted').in('agent_id', agentIds).gte('doc_date', from).lte('doc_date', to).order('id')),
        fetchAll(() => c.from('sales_returns').select('id, doc_no, doc_date, agent_id').eq('tenant_id', t).eq('status', 'posted').in('agent_id', agentIds).gte('doc_date', from).lte('doc_date', to).order('id'))
    ]);
    const bl = await inChunks(bills.map(b => b.id), async ch => (await c.from('sales_bill_details').select('bill_id, product_id, qty, uom_id, amount, tax_amount').in('bill_id', ch)).data || []);
    const rl = await inChunks(rets.map(b => b.id), async ch => (await c.from('sales_return_details').select('return_id, product_id, qty, uom_id, amount, tax_amount').in('return_id', ch)).data || []);
    const B = Object.fromEntries(bills.map(b => [b.id, b])), R = Object.fromEntries(rets.map(r => [r.id, r]));
    const all = [
        ...bl.map(l => ({ ...l, head: B[l.bill_id], sign: 1 })),
        ...rl.map(l => ({ ...l, head: R[l.return_id], sign: -1 }))
    ].filter(l => l.head);
    const F = await factors(c, all);
    return all.map(l => ({ agent_id: l.head.agent_id, date: String(l.head.doc_date).slice(0, 10), doc_no: l.head.doc_no, product_id: l.product_id,
        qty: l.sign * Number(l.qty || 0) * (l.uom_id ? F[`${l.product_id}|${l.uom_id}`] || 1 : 1), value: l.sign * (Number(l.amount || 0) - Number(l.tax_amount || 0)), is_return: l.sign < 0 }));
}
function commissionOf(tg, qty, value) {
    const pctValue = Number(tg.target_value) ? value * 100 / Number(tg.target_value) : null;
    const pctQty = Number(tg.target_qty) ? qty * 100 / Number(tg.target_qty) : null;
    const pct = pctValue ?? pctQty ?? 0;
    const eligible = pct >= Number(tg.min_achievement_pct || 0) - 1e-9;
    let amt = 0;
    if (eligible) {
        if (tg.commission_basis === 'qty_rate') amt = Math.max(0, qty) * Number(tg.commission_rate || 0);
        else if (tg.commission_basis === 'fixed') amt = Number(tg.fixed_commission || 0);
        else amt = Math.max(0, value) * Number(tg.commission_rate || 0) / 100;
    }
    return { achievement_pct: round2(pct), qty_pct: pctQty === null ? null : round2(pctQty), value_pct: pctValue === null ? null : round2(pctValue), eligible, commission: round2(amt) };
}

async function names(c, t) {
    const [agents, products, groups, companies, cats] = await Promise.all([
        fetchAll(() => c.from('salesman_agents').select('id, agent_name, agent_code, commission_expense_ledger_id, commission_payable_ledger_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('products').select('id, product_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_groups').select('id, group_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_companies').select('id, company_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_categories').select('id, category_name').eq('tenant_id', t).order('id')).catch(() => [])
    ]);
    const m = (rows, k) => Object.fromEntries(rows.map(r => [r.id, r[k]]));
    return { agents: Object.fromEntries(agents.map(a => [a.id, a])), product: m(products, 'product_name'), product_group: m(groups, 'group_name'), product_company: m(companies, 'company_name'), category: m(cats, 'category_name') };
}

// Every target matching the filters with its achievement, commission and posting.
async function achievement(c, t, q = {}) {
    let tq = c.from('agent_targets').select('*').eq('tenant_id', t);
    if (q.agent_id) tq = tq.in('agent_id', csv(q.agent_id));
    if (q.date_from) tq = tq.gte('period_to', q.date_from);
    if (q.date_to) tq = tq.lte('period_from', q.date_to);
    if (q.period_type) tq = tq.eq('period_type', q.period_type);
    if (q.dimension) tq = tq.eq('dimension', q.dimension);
    let targets = await fetchAll(() => tq.order('period_from').order('id'));
    if (q.target_ids) { const ids = csv(q.target_ids); targets = targets.filter(x => ids.includes(x.id)); }
    if (q.include_inactive !== 'true') targets = targets.filter(x => x.is_active !== false);
    const N = await names(c, t);
    if (!targets.length) return { rows: [], by_agent: [], totals: {} };
    const from = targets.reduce((m, x) => (String(x.period_from).slice(0, 10) < m ? String(x.period_from).slice(0, 10) : m), '9999-12-31');
    const to = targets.reduce((m, x) => (String(x.period_to).slice(0, 10) > m ? String(x.period_to).slice(0, 10) : m), '0000-01-01');
    const [lines, info, postings] = await Promise.all([
        salesLines(c, t, [...new Set(targets.map(x => x.agent_id))], from, to),
        productInfo(c, t),
        inChunks(targets.map(x => x.id), async ch => (await c.from('agent_commission_postings').select('id, doc_no, target_id, status, commission_amount, posting_date').in('target_id', ch)).data || [])
    ]);
    const rows = targets.map(tg => {
        const pf = String(tg.period_from).slice(0, 10), pt = String(tg.period_to).slice(0, 10);
        const mine = lines.filter(l => l.agent_id === tg.agent_id && l.date >= pf && l.date <= pt && matches(tg, info[l.product_id]));
        const qty = round4(mine.reduce((s, l) => s + l.qty, 0)), value = round2(mine.reduce((s, l) => s + l.value, 0));
        const ret = round2(-mine.filter(l => l.is_return).reduce((s, l) => s + l.value, 0));
        const post = postings.find(p => p.target_id === tg.id && p.status === 'posted');
        const cm = commissionOf(tg, qty, value);
        return {
            ...tg, period_from: pf, period_to: pt, agent_name: N.agents[tg.agent_id]?.agent_name || '', dimension_label: DIM_LABEL[tg.dimension],
            dimension_name: tg.dimension === 'all' ? 'All products' : N[tg.dimension]?.[tg.dimension_id] || '?',
            target_qty: round4(tg.target_qty), target_value: round2(tg.target_value), achieved_qty: qty, achieved_value: value, returns_value: ret,
            balance_qty: round4(Number(tg.target_qty) - qty), balance_value: round2(Number(tg.target_value) - value), ...cm,
            posted: !!post, posting_id: post?.id || null, posting_no: post?.doc_no || null, posted_commission: post ? round2(post.commission_amount) : null,
            period_over: pt < new Date().toISOString().slice(0, 10)
        };
    });
    const byAgent = {};
    rows.forEach(r => {
        const a = (byAgent[r.agent_id] = byAgent[r.agent_id] || { agent_id: r.agent_id, agent_name: r.agent_name, targets: 0, target_value: 0, achieved_value: 0, target_qty: 0, achieved_qty: 0, commission: 0, posted: 0, unposted: 0 });
        a.targets++; a.target_value += r.target_value; a.achieved_value += r.achieved_value; a.target_qty += r.target_qty; a.achieved_qty += r.achieved_qty; a.commission += r.commission;
        if (r.posted) a.posted += r.posted_commission; else a.unposted += r.commission;
    });
    const by_agent = Object.values(byAgent).map(a => ({ ...a, target_value: round2(a.target_value), achieved_value: round2(a.achieved_value), target_qty: round4(a.target_qty), achieved_qty: round4(a.achieved_qty),
        commission: round2(a.commission), posted: round2(a.posted), unposted: round2(a.unposted), achievement_pct: a.target_value ? round2(a.achieved_value * 100 / a.target_value) : a.target_qty ? round2(a.achieved_qty * 100 / a.target_qty) : 0 }));
    const sum = k => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    return { rows, by_agent, totals: { target_value: sum('target_value'), achieved_value: sum('achieved_value'), commission: sum('commission'), posted: sum('posted_commission') } };
}

// Achievement of one agent month by month (or product-wise) inside a range, whether or not targets exist.
async function agentPerformance(c, t, q) {
    if (!q.date_from || !q.date_to) throw httpError('Choose the period');
    const N = await names(c, t);
    const agentIds = q.agent_id ? csv(q.agent_id) : Object.keys(N.agents);
    if (!agentIds.length) return { columns: [], rows: [] };
    const [lines, info] = await Promise.all([salesLines(c, t, agentIds, q.date_from, q.date_to), productInfo(c, t)]);
    const by = ['product', 'product_group', 'product_company', 'agent'].includes(q.group_by) ? q.group_by : 'agent';
    const periods = await periodsFor(c, t, ['month', 'quarter', 'year'].includes(q.period_type) ? q.period_type : 'month', q.date_from, q.date_to);
    const col = d => periods.findIndex(p => d >= p.from && d <= p.to);
    const acc = {};
    lines.forEach(l => {
        const p = info[l.product_id] || {};
        const k = by === 'agent' ? l.agent_id : by === 'product' ? l.product_id : by === 'product_group' ? p.product_group_id : p.product_company_id;
        const name = by === 'agent' ? N.agents[l.agent_id]?.agent_name : N[by]?.[k];
        const a = (acc[`${l.agent_id}|${k}`] = acc[`${l.agent_id}|${k}`] || { agent_name: N.agents[l.agent_id]?.agent_name || '', key: k, name: name || '(none)', qty: periods.map(() => 0), value: periods.map(() => 0), total_qty: 0, total_value: 0 });
        const i = col(l.date); if (i < 0) return;
        a.qty[i] += l.qty; a.value[i] += l.value; a.total_qty += l.qty; a.total_value += l.value;
    });
    const rows = Object.values(acc).map(a => ({ ...a, qty: a.qty.map(round4), value: a.value.map(round2), total_qty: round4(a.total_qty), total_value: round2(a.total_value) }))
        .sort((x, y) => x.agent_name.localeCompare(y.agent_name) || y.total_value - x.total_value);
    return { columns: periods, group_by: by, rows };
}

// ---------------------------------------------------------------- posting
async function nextNo(c, t) {
    const { data } = await c.from('agent_commission_postings').select('doc_no').eq('tenant_id', t);
    const n = (data || []).map(r => Number(String(r.doc_no).replace(/\D/g, '')) || 0).reduce((a, b) => Math.max(a, b), 0) + 1;
    return `COM-${String(n).padStart(4, '0')}`;
}
async function postCommission(c, t, userId, b) {
    const ids = csv(b.target_ids);
    if (!ids.length) throw httpError('Choose the targets to post');
    const data = await achievement(c, t, { target_ids: ids.join(','), include_inactive: 'true' });
    const date = b.posting_date || new Date().toISOString().slice(0, 10);
    const N = await names(c, t);
    const results = [];
    for (const r of data.rows) {
        if (r.posted) { results.push({ target_id: r.id, agent_name: r.agent_name, skipped: true, reason: `Already posted (${r.posting_no})` }); continue; }
        if (!(r.commission > 0)) { results.push({ target_id: r.id, agent_name: r.agent_name, skipped: true, reason: r.eligible ? 'No commission' : `Below minimum achievement (${r.achievement_pct}% < ${r.min_achievement_pct}%)` }); continue; }
        const agent = N.agents[r.agent_id] || {};
        const exp = b.expense_ledger_id || agent.commission_expense_ledger_id, pay = b.payable_ledger_id || agent.commission_payable_ledger_id;
        if (!exp || !pay) { results.push({ target_id: r.id, agent_name: r.agent_name, skipped: true, reason: 'Choose the commission expense and payable ledgers' }); continue; }
        if (exp === pay) throw httpError('Expense and payable ledgers must be different');
        const amount = round2(b.amounts && b.amounts[r.id] !== undefined ? Number(b.amounts[r.id]) : r.commission);
        if (!(amount > 0)) { results.push({ target_id: r.id, agent_name: r.agent_name, skipped: true, reason: 'Amount is zero' }); continue; }
        const docNo = await nextNo(c, t);
        const narration = b.narration || `Commission ${r.agent_name} - ${r.period_label || `${r.period_from} to ${r.period_to}`} (${r.dimension_name})`;
        const { data: post, error } = await c.from('agent_commission_postings').insert({
            tenant_id: t, doc_no: docNo, posting_date: date, agent_id: r.agent_id, target_id: r.id, period_from: r.period_from, period_to: r.period_to,
            target_qty: r.target_qty, target_value: r.target_value, achieved_qty: r.achieved_qty, achieved_value: r.achieved_value, achievement_pct: r.achievement_pct,
            commission_amount: amount, expense_ledger_id: exp, payable_ledger_id: pay, narration, status: 'posted', created_by: userId || null
        }).select().single();
        if (error) {
            if (/ux_commission_target_posted|duplicate/i.test(error.message)) { results.push({ target_id: r.id, agent_name: r.agent_name, skipped: true, reason: 'Already posted' }); continue; }
            throw error;
        }
        const { data: batch, error: e2 } = await c.from('ledger_transaction_batches').insert({ tenant_id: t, document_type: 'agent_commission', document_id: post.id, batch_date: date, narration: `${docNo} ${narration}`, created_by: userId || null }).select().single();
        if (e2) { await c.from('agent_commission_postings').delete().eq('id', post.id); throw e2; }
        const { error: e3 } = await c.from('ledger_transaction_lines').insert([
            { tenant_id: t, batch_id: batch.id, ledger_account_id: exp, debit_amount: amount, credit_amount: 0, narration },
            { tenant_id: t, batch_id: batch.id, ledger_account_id: pay, debit_amount: 0, credit_amount: amount, narration }
        ]);
        if (e3) { await c.from('ledger_transaction_batches').delete().eq('id', batch.id); await c.from('agent_commission_postings').delete().eq('id', post.id); throw e3; }
        results.push({ target_id: r.id, agent_name: r.agent_name, posted: true, doc_no: docNo, amount });
    }
    return { posted: results.filter(r => r.posted).length, skipped: results.filter(r => r.skipped).length, total: round2(results.filter(r => r.posted).reduce((s, r) => s + r.amount, 0)), results };
}
async function cancelPosting(c, t, userId, id, reason) {
    if (!reason) throw httpError('Give a reason for cancelling');
    const { data: p } = await c.from('agent_commission_postings').select('*').eq('id', id).eq('tenant_id', t).maybeSingle();
    if (!p) throw httpError('Posting not found', 404);
    if (p.status === 'cancelled') throw httpError('Already cancelled');
    const { data: batches } = await c.from('ledger_transaction_batches').select('id').eq('document_type', 'agent_commission').eq('document_id', id);
    for (const b of batches || []) { await c.from('ledger_transaction_lines').delete().eq('batch_id', b.id); await c.from('ledger_transaction_batches').delete().eq('id', b.id); }
    const { error } = await c.from('agent_commission_postings').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: reason }).eq('id', id);
    if (error) throw error;
    return { ok: true };
}
async function commissionRegister(c, t, q) {
    const rows = await fetchAll(() => {
        let x = c.from('agent_commission_postings').select('*').eq('tenant_id', t);
        if (q.agent_id) x = x.in('agent_id', csv(q.agent_id));
        if (q.date_from) x = x.gte('posting_date', q.date_from);
        if (q.date_to) x = x.lte('posting_date', q.date_to);
        if (q.status) x = x.eq('status', q.status);
        return x.order('posting_date', { ascending: false }).order('doc_no', { ascending: false });
    });
    const N = await names(c, t);
    const led = [...new Set(rows.flatMap(r => [r.expense_ledger_id, r.payable_ledger_id]).filter(Boolean))];
    const L = Object.fromEntries((await inChunks(led, async ch => (await c.from('ledger_accounts').select('id, account_name').in('id', ch)).data || [])).map(l => [l.id, l.account_name]));
    const tg = await inChunks([...new Set(rows.map(r => r.target_id))], async ch => (await c.from('agent_targets').select('id, period_label, dimension, dimension_id').in('id', ch)).data || []);
    const T = Object.fromEntries(tg.map(x => [x.id, x]));
    return rows.map(r => ({ ...r, agent_name: N.agents[r.agent_id]?.agent_name || '', expense_ledger: L[r.expense_ledger_id] || '', payable_ledger: L[r.payable_ledger_id] || '',
        period_label: T[r.target_id]?.period_label || `${String(r.period_from).slice(0, 10)} - ${String(r.period_to).slice(0, 10)}`,
        dimension_name: T[r.target_id] ? (T[r.target_id].dimension === 'all' ? 'All products' : N[T[r.target_id].dimension]?.[T[r.target_id].dimension_id] || '?') : '' }));
}

module.exports = { saveTarget, generateTargets, achievement, agentPerformance, postCommission, cancelPosting, commissionRegister, periodsFor, commissionOf, DIM_LABEL };
