// =============================================
// utils/salesman.js
// Salesman mobile ordering + route plan + order -> bill conversion + the
// order / visit reports.
//
//   route plan     route_plans: which route(s) a salesman walks on a date
//                  (a date plan overrides the weekday plan for that date)
//   day sheet      the planned routes' customers in visiting order, with
//                  balance, credit limit and today's visit / order status
//   mobile order   only for a customer on the route planned for the order
//                  date (unless the salesman may order off-route); the rate
//                  is the customer's price tier, editable only when the
//                  salesman / product group / company allows it
//   conversion     pending order lines -> sales bills (one bill per order or
//                  one per customer), qty / rate / discount editable, post
//                  optional; reuses the Sales Bill create / post handlers
// =============================================

const { stockReport } = require('./stockReport');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const today = () => new Date().toISOString().slice(0, 10);
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
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
// ledger contact fields -> the short names the mobile screens use
const contact = l => ({ ...l, address: [l.billing_address, l.city].filter(Boolean).join(', '), phone: l.phone_office || '', mobile: l.contact_person_mobile || '' });
const weekdayOf = date => new Date(`${date}T00:00:00Z`).getUTCDay();
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

// ---------------------------------------------------------------- who
// The salesman record linked to a login. Admin / office users may act for
// any salesman by passing agent_id.
async function resolveAgent(c, t, userId, agentId) {
    const { data: own } = await c.from('salesman_agents').select('*').eq('tenant_id', t).eq('linked_user_id', userId).eq('is_active', true).maybeSingle();
    if (own) return { agent: own, isSalesman: true };
    if (!agentId) return { agent: null, isSalesman: false };
    const { data: agent } = await c.from('salesman_agents').select('*').eq('tenant_id', t).eq('id', agentId).maybeSingle();
    if (!agent) throw httpError('Salesman not found', 404);
    return { agent, isSalesman: false };
}

// ---------------------------------------------------------------- route plan
async function plansBetween(c, t, { agentId, from, to }) {
    let q = c.from('route_plans').select('*').eq('tenant_id', t).eq('is_active', true);
    if (agentId) q = q.eq('agent_id', agentId);
    const rows = await fetchAll(() => q.order('id'));
    return rows.filter(p => p.plan_type === 'weekday' || (String(p.plan_date).slice(0, 10) >= from && String(p.plan_date).slice(0, 10) <= to));
}
// Route ids planned for one agent on one date.
function routesOn(plans, agentId, date) {
    const mine = plans.filter(p => p.agent_id === agentId);
    const dated = mine.filter(p => p.plan_type === 'date' && String(p.plan_date).slice(0, 10) === date);
    const list = dated.length ? dated : mine.filter(p => p.plan_type === 'weekday' && Number(p.weekday) === weekdayOf(date));
    return [...new Set(list.map(p => p.route_id))];
}
async function routeIdsFor(c, t, agentId, date) {
    return routesOn(await plansBetween(c, t, { agentId, from: date, to: date }), agentId, date);
}

// Calendar: every day of [from, to] with its planned routes.
async function planCalendar(c, t, q) {
    const from = q.date_from || today(), to = q.date_to || from;
    if (daysBetween(from, to) > 400) throw httpError('Choose at most about a year');
    const plans = await plansBetween(c, t, { agentId: q.agent_id || null, from, to });
    const [agents, routes] = await Promise.all([
        fetchAll(() => c.from('salesman_agents').select('id, agent_name, agent_code').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('routes').select('id, route_name, route_code, area_id').eq('tenant_id', t).order('id'))
    ]);
    const rName = Object.fromEntries(routes.map(r => [r.id, r.route_name]));
    const agentIds = q.agent_id ? [q.agent_id] : [...new Set(plans.map(p => p.agent_id))];
    const days = [];
    for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
        agentIds.forEach(a => {
            const ids = routesOn(plans, a, d);
            if (ids.length) days.push({ date: d, weekday: weekdayOf(d), agent_id: a, agent_name: agents.find(x => x.id === a)?.agent_name || '', routes: ids.map(id => ({ id, name: rName[id] || '?' })) });
        });
    }
    return { from, to, plans: plans.map(p => ({ ...p, route_name: rName[p.route_id] || '', agent_name: agents.find(x => x.id === p.agent_id)?.agent_name || '' })), days };
}

async function savePlans(c, t, userId, b) {
    if (!b.agent_id || !b.route_id) throw httpError('Salesman and route are required');
    const rows = [];
    if (b.plan_type === 'weekday') {
        const days = (b.weekdays || []).map(Number).filter(n => n >= 0 && n <= 6);
        if (!days.length) throw httpError('Choose at least one weekday');
        days.forEach(w => rows.push({ tenant_id: t, agent_id: b.agent_id, route_id: b.route_id, plan_type: 'weekday', weekday: w, notes: b.notes || null, is_active: true, created_by: userId }));
    } else {
        let dates = (b.dates || []).filter(Boolean);
        if (!dates.length && b.date_from && b.date_to) {             // a range, optionally only some weekdays
            const only = (b.only_weekdays || []).map(Number);
            if (daysBetween(b.date_from, b.date_to) > 370) throw httpError('Range is too long');
            for (let d = b.date_from; d <= b.date_to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
                if (!only.length || only.includes(weekdayOf(d))) dates.push(d);
            }
        }
        if (!dates.length) throw httpError('Choose at least one date');
        [...new Set(dates)].forEach(d => rows.push({ tenant_id: t, agent_id: b.agent_id, route_id: b.route_id, plan_type: 'date', plan_date: d, notes: b.notes || null, is_active: true, created_by: userId }));
    }
    // skip what already exists (same agent + route + day)
    const existing = await plansBetween(c, t, { agentId: b.agent_id, from: '0000-01-01', to: '9999-12-31' });
    const has = new Set(existing.filter(p => p.route_id === b.route_id).map(p => (p.plan_type === 'date' ? `d${String(p.plan_date).slice(0, 10)}` : `w${p.weekday}`)));
    const fresh = rows.filter(r => !has.has(r.plan_type === 'date' ? `d${r.plan_date}` : `w${r.weekday}`));
    if (fresh.length) { const { error } = await c.from('route_plans').insert(fresh); if (error) throw error; }
    return { added: fresh.length, skipped: rows.length - fresh.length };
}

// ---------------------------------------------------------------- parties
// GL balance (Dr positive) of the given ledgers as on `to`.
async function partyBalances(c, t, ids, to = today()) {
    if (!ids.length) return {};
    const leds = await inChunks(ids, async ch => { const { data } = await c.from('ledger_accounts').select('id, opening_balance, opening_balance_type').in('id', ch); return data || []; });
    const bal = Object.fromEntries(leds.map(l => [l.id, (l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0)]));
    const lines = await inChunks(ids, ch => fetchAll(() => c.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)')
        .eq('tenant_id', t).in('ledger_account_id', ch).lte('batch.batch_date', to).order('id')), 100);
    lines.forEach(l => { bal[l.ledger_account_id] = (bal[l.ledger_account_id] || 0) + (Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0); });
    Object.keys(bal).forEach(k => { bal[k] = round2(bal[k]); });
    return bal;
}

async function customersOfRoutes(c, t, routeIds) {
    if (!routeIds.length) return [];
    const links = await inChunks(routeIds, async ch => {
        const { data } = await c.from('route_customers').select('route_id, ledger_account_id, sequence_order, is_active').in('route_id', ch).eq('is_active', true);
        return data || [];
    });
    const ids = [...new Set(links.map(l => l.ledger_account_id))];
    const leds = await inChunks(ids, async ch => {
        const { data } = await c.from('ledger_accounts').select('id, account_name, account_code, billing_name, pan_number, billing_address, city, phone_office, contact_person_mobile, credit_limit, credit_days, rate_category_id, area_id, is_active').in('id', ch);
        return data || [];
    });
    const byId = Object.fromEntries(leds.map(l => [l.id, contact(l)]));
    return links.filter(l => byId[l.ledger_account_id] && byId[l.ledger_account_id].is_active !== false)
        .sort((a, b) => routeIds.indexOf(a.route_id) - routeIds.indexOf(b.route_id) || a.sequence_order - b.sequence_order)
        .map(l => ({ ...byId[l.ledger_account_id], route_id: l.route_id, sequence_order: l.sequence_order }));
}

// The mobile day sheet.
async function daySheet(c, t, agent, date) {
    const routeIds = await routeIdsFor(c, t, agent.id, date);
    const { data: routes } = routeIds.length ? await c.from('routes').select('id, route_name, route_code, area_id').in('id', routeIds) : { data: [] };
    const customers = await customersOfRoutes(c, t, routeIds);
    const ids = customers.map(x => x.id);
    const [bal, visits, orders] = await Promise.all([
        partyBalances(c, t, ids, date),
        fetchAll(() => c.from('mobile_visits').select('*').eq('tenant_id', t).eq('agent_id', agent.id).eq('visit_date', date).order('id')),
        fetchAll(() => c.from('sales_orders').select('id, doc_no, customer_ledger_id, total_amount, status').eq('tenant_id', t).eq('agent_id', agent.id).eq('doc_date', date).neq('status', 'cancelled').order('id'))
    ]);
    const rows = customers.map(x => {
        const v = visits.filter(y => y.ledger_account_id === x.id), o = orders.filter(y => y.customer_ledger_id === x.id);
        return { ...x, balance: bal[x.id] || 0, orders: o.map(y => ({ id: y.id, doc_no: y.doc_no, amount: round2(y.total_amount), status: y.status })),
            order_value: round2(o.reduce((s, y) => s + Number(y.total_amount || 0), 0)),
            visit: v.length ? v[v.length - 1].outcome : null, no_order_reason: v.find(y => y.outcome !== 'ordered')?.no_order_reason || null };
    });
    return {
        date, weekday: weekdayOf(date), agent: { id: agent.id, agent_name: agent.agent_name, allow_rate_change: !!agent.allow_rate_change_on_mobile_order, allow_off_route: !!agent.allow_off_route_orders },
        routes: (routes || []).map(r => ({ id: r.id, route_name: r.route_name, customers: rows.filter(x => x.route_id === r.id).length })),
        customers: rows,
        summary: { planned: rows.length, visited: rows.filter(x => x.visit || x.orders.length).length, productive: rows.filter(x => x.orders.length).length,
            order_value: round2(rows.reduce((s, x) => s + x.order_value, 0)) }
    };
}

// All customers on any of the salesman's routes (party list), with balance.
async function agentParties(c, t, agent, q) {
    const plans = await plansBetween(c, t, { agentId: agent.id, from: '0000-01-01', to: '9999-12-31' });
    const { data: defRoutes } = await c.from('routes').select('id').eq('tenant_id', t).eq('default_agent_id', agent.id);
    const routeIds = [...new Set([...plans.map(p => p.route_id), ...(defRoutes || []).map(r => r.id)])];
    let rows = await customersOfRoutes(c, t, routeIds);
    const { data: own } = await c.from('ledger_accounts').select('id, account_name, account_code, billing_name, pan_number, billing_address, city, phone_office, contact_person_mobile, credit_limit, credit_days, rate_category_id, area_id, is_active').eq('tenant_id', t).eq('agent_id', agent.id);
    (own || []).map(contact).forEach(l => { if (!rows.some(r => r.id === l.id) && l.is_active !== false) rows.push({ ...l, route_id: null, sequence_order: 9999 }); });
    const seen = new Set(); rows = rows.filter(r => (seen.has(r.id) ? false : seen.add(r.id)));
    const s = String(q.search || '').trim().toLowerCase();
    if (s) rows = rows.filter(r => [r.account_name, r.account_code, r.billing_name, r.pan_number, r.phone, r.mobile, r.address].some(v => String(v || '').toLowerCase().includes(s)));
    const bal = await partyBalances(c, t, rows.map(r => r.id));
    const { data: rts } = routeIds.length ? await c.from('routes').select('id, route_name').in('id', routeIds) : { data: [] };
    const rn = Object.fromEntries((rts || []).map(r => [r.id, r.route_name]));
    return rows.map(r => ({ ...r, route_name: rn[r.route_id] || '', balance: bal[r.id] || 0 })).sort((a, b) => a.account_name.localeCompare(b.account_name));
}

// One party: balance, open bills, last orders / bills.
async function partyDetail(c, t, ledgerId) {
    const [{ data: led }, bal, { data: refs }, { data: orders }, { data: bills }] = await Promise.all([
        c.from('ledger_accounts').select('id, account_name, account_code, billing_name, pan_number, billing_address, city, phone_office, contact_person_mobile, credit_limit, credit_days').eq('id', ledgerId).eq('tenant_id', t).maybeSingle(),
        partyBalances(c, t, [ledgerId]),
        c.from('bill_wise_references').select('source_doc_no, source_date, total_amount, remaining_amount').eq('ledger_id', ledgerId).eq('nature', 'dr').gt('remaining_amount', 0).order('source_date'),
        c.from('sales_orders').select('id, doc_no, doc_date, total_amount, status').eq('tenant_id', t).eq('customer_ledger_id', ledgerId).order('doc_date', { ascending: false }).limit(10),
        c.from('sales_bills').select('id, doc_no, doc_date, total_amount, status').eq('tenant_id', t).eq('customer_ledger_id', ledgerId).eq('status', 'posted').order('doc_date', { ascending: false }).limit(10)
    ]);
    if (!led) throw httpError('Party not found', 404);
    const d = today();
    return { ...contact(led), balance: bal[ledgerId] || 0,
        // due = bill date + the party's credit days (bill_wise_references keeps no due date)
        open_bills: (refs || []).map(r => {
            const date = String(r.source_date).slice(0, 10), due = new Date(Date.parse(`${date}T00:00:00Z`) + (Number(led.credit_days) || 0) * 86400000).toISOString().slice(0, 10);
            return { doc_no: r.source_doc_no, doc_date: date, due_date: due, total_amount: r.total_amount, remaining_amount: r.remaining_amount, overdue_days: due < d ? daysBetween(due, d) : 0 };
        }),
        recent_orders: orders || [], recent_bills: bills || [] };
}

// ---------------------------------------------------------------- products + stock
async function customerTier(c, customerId) {
    if (!customerId) return { tier: 1, discountGroupId: null };
    const { data: cust } = await c.from('ledger_accounts').select('rate_category_id, discount_group_id').eq('id', customerId).maybeSingle();
    let tier = 1;
    if (cust?.rate_category_id) { const { data: rc } = await c.from('rate_categories').select('sr_tier').eq('id', cust.rate_category_id).maybeSingle(); tier = rc?.sr_tier || 1; }
    return { tier, discountGroupId: cust?.discount_group_id || null };
}

// Closing stock (base units) per product, today, optionally one warehouse.
async function stockMap(c, t, { warehouseId, search } = {}) {
    const d = today();
    const r = await stockReport(c, t, { mode: 'summary', date_from: d, date_to: d, group_by: 'item', hide_zero: 'false', warehouse_id: warehouseId || undefined, search: search || undefined });
    return Object.fromEntries((r.rows || []).map(x => [x.product_id, round4(x.closing_qty)]));
}

async function mobileProducts(c, t, agent, q) {
    let pq = c.from('products').select('id, product_code, product_name, short_name, base_unit_id, product_group_id, product_company_id, vat_applicable, sales_rate_sr1, sales_rate_sr2, sales_rate_sr3, sales_rate_sr4, sales_rate_sr5, mrp, default_discount_percent, is_blocked')
        .eq('tenant_id', t).eq('is_active', true);
    const s = String(q.search || '').trim().replace(/[(),%]/g, ' ').trim();
    if (s) pq = pq.or(`product_name.ilike.%${s}%,product_code.ilike.%${s}%,short_name.ilike.%${s}%`);
    if (q.product_group_id) pq = pq.eq('product_group_id', q.product_group_id);
    if (q.product_company_id) pq = pq.eq('product_company_id', q.product_company_id);
    const products = (await fetchAll(() => pq.order('product_name').order('id'))).filter(p => !p.is_blocked).slice(0, Number(q.limit) || 300);
    const gIds = [...new Set(products.map(p => p.product_group_id).filter(Boolean))], cIds = [...new Set(products.map(p => p.product_company_id).filter(Boolean))];
    const uIds = [...new Set(products.map(p => p.base_unit_id).filter(Boolean))];
    const [groups, comps, units, stock, { tier, discountGroupId }] = await Promise.all([
        inChunks(gIds, async ch => (await c.from('product_groups').select('id, group_name, allow_rate_change_on_mobile_order').in('id', ch)).data || []),
        inChunks(cIds, async ch => (await c.from('product_companies').select('id, company_name, allow_rate_change_on_mobile_order').in('id', ch)).data || []),
        inChunks(uIds, async ch => (await c.from('product_units').select('id, unit_name').in('id', ch)).data || []),
        stockMap(c, t, { warehouseId: q.warehouse_id || agent?.default_warehouse_id }),
        customerTier(c, q.customer_id)
    ]);
    const G = Object.fromEntries(groups.map(x => [x.id, x])), C = Object.fromEntries(comps.map(x => [x.id, x])), U = Object.fromEntries(units.map(x => [x.id, x.unit_name]));
    let disc = {};
    if (discountGroupId && cIds.length) {
        const { data: cells } = await c.from('discount_matrix').select('product_company_id, discount_percent').eq('discount_group_id', discountGroupId);
        disc = Object.fromEntries((cells || []).map(x => [x.product_company_id, Number(x.discount_percent) || 0]));
    }
    const { data: sys } = await c.from('system_control_settings').select('*').eq('tenant_id', t).maybeSingle();
    const vatRate = Number(sys?.default_vat_percent ?? 13) || 13;
    return products.map(p => {
        const g = G[p.product_group_id], co = C[p.product_company_id];
        const masters = [g, co].filter(Boolean);
        return {
            id: p.id, product_code: p.product_code, product_name: p.product_name, unit_id: p.base_unit_id, unit_name: U[p.base_unit_id] || '',
            group_name: g?.group_name || '', company_name: co?.company_name || '', product_company_id: p.product_company_id,
            rate: Number(p[`sales_rate_sr${tier}`]) || Number(p.sales_rate_sr1) || 0, mrp: Number(p.mrp) || 0,
            discount_percent: disc[p.product_company_id] ?? (Number(p.default_discount_percent) || 0),
            tax_percent: p.vat_applicable === false ? 0 : vatRate, stock: stock[p.id] ?? 0,
            rate_editable: !!agent?.allow_rate_change_on_mobile_order || (masters.length > 0 && masters.every(m => m.allow_rate_change_on_mobile_order))
        };
    });
}

async function mobileStock(c, t, agent, q) {
    const d = today();
    const r = await stockReport(c, t, { mode: 'summary', date_from: d, date_to: d, group_by: q.by_warehouse === 'true' ? 'item_warehouse' : 'item', hide_zero: q.hide_zero === 'false' ? 'false' : 'true',
        warehouse_id: q.warehouse_id || undefined, search: q.search || undefined, product_group_id: q.product_group_id || undefined, product_company_id: q.product_company_id || undefined });
    // pending (ordered, not yet delivered) qty in the line's own unit
    const open = await fetchAll(() => c.from('sales_order_details').select('product_id, qty, qty_delivered, order:order_id!inner(status, tenant_id)')
        .eq('order.tenant_id', t).in('order.status', ['draft', 'confirmed', 'partially_delivered']).order('id'));
    const pend = {};
    open.forEach(l => { pend[l.product_id] = (pend[l.product_id] || 0) + Math.max(0, Number(l.qty) - Number(l.qty_delivered || 0)); });
    return (r.rows || []).map(x => ({ product_id: x.product_id, product_code: x.product_code, product_name: x.product_name, unit_name: x.unit || '', group_name: x.group_name, company_name: x.company_name,
        warehouse_name: x.warehouse_name || null, stock: round4(x.closing_qty), pending_orders: round4(pend[x.product_id] || 0),
        available: round4(x.closing_qty - (pend[x.product_id] || 0)), below_minimum: !!x.below_minimum }));
}

// ---------------------------------------------------------------- mobile order
// Validates the salesman rules and returns the body for the Sales Order create handler.
async function buildMobileOrder(c, t, agent, isSalesman, b) {
    const date = b.doc_date || today();
    if (!b.customer_ledger_id) throw httpError('Choose a customer');
    const lines = (b.details || []).filter(d => d.product_id && Number(d.qty) > 0);
    if (!lines.length) throw httpError('Add at least one item with a quantity');
    const routeIds = await routeIdsFor(c, t, agent.id, date);
    const { data: links } = routeIds.length ? await c.from('route_customers').select('route_id').in('route_id', routeIds).eq('ledger_account_id', b.customer_ledger_id).eq('is_active', true) : { data: [] };
    const routeId = (links || [])[0]?.route_id || null;
    if (!routeId && !agent.allow_off_route_orders) {
        throw httpError(routeIds.length ? 'This customer is not on the route planned for this date' : 'No route is planned for this salesman on this date');
    }
    // salesmen may not back-date / post-date
    if (isSalesman && date !== today()) throw httpError('A salesman can book orders only for today');
    const products = await mobileProducts(c, t, agent, { customer_id: b.customer_ledger_id, limit: 100000 });
    const P = Object.fromEntries(products.map(p => [p.id, p]));
    const details = lines.map(d => {
        const p = P[d.product_id];
        if (!p) throw httpError('A product on this order is not available');
        const rate = p.rate_editable && d.rate !== undefined && d.rate !== '' ? Number(d.rate) : p.rate;
        if (!(rate >= 0)) throw httpError(`Invalid rate for ${p.product_name}`);
        return { product_id: p.id, qty: Number(d.qty), uom_id: p.unit_id, rate, discount_percent: d.discount_percent !== undefined && p.rate_editable ? Number(d.discount_percent) || 0 : p.discount_percent,
            tax_percent: p.tax_percent, free_qty: Number(d.free_qty) || 0, warehouse_id: agent.default_warehouse_id || null };
    });
    const { data: route } = routeId ? await c.from('routes').select('id, area_id').eq('id', routeId).maybeSingle() : { data: null };
    // Product Company compulsory (System Control): one order per company; otherwise one order,
    // tagged with the company only when every item belongs to it.
    const { companyRules } = require('./productCompanyRules');
    const compulsory = (await companyRules(c, t)).sales;
    const companyOf = d => P[d.product_id].product_company_id || null;
    let groups;
    if (compulsory) {
        const missing = details.filter(d => !companyOf(d));
        if (missing.length) throw httpError(`Product Company is compulsory - these items have none: ${missing.map(d => P[d.product_id].product_name).join(', ')}`);
        groups = Object.values(details.reduce((acc, d) => { (acc[companyOf(d)] = acc[companyOf(d)] || []).push(d); return acc; }, {}));
    } else groups = [details];
    const head = {
        doc_date: date, customer_ledger_id: b.customer_ledger_id, agent_id: agent.id, route_id: routeId, area_id: route?.area_id || null,
        warehouse_id: agent.default_warehouse_id || null, invoice_type: b.invoice_type === 'cash' ? 'cash' : 'credit', narration: b.remarks || 'Mobile order',
        remarks_text: b.remarks || null, override_credit_block: false, ...(agent.mobile_order_status === 'confirmed' ? {} : { status: 'draft', save_as_draft: false })
    };
    return {
        route_id: routeId,
        bodies: groups.map(ds => {
            const cos = [...new Set(ds.map(companyOf))];
            return { ...head, product_company_id: cos.length === 1 && cos[0] ? cos[0] : null, details: ds };
        })
    };
}

async function recordVisit(c, t, userId, agent, b) {
    if (!b.ledger_account_id) throw httpError('Choose a customer');
    const outcome = ['ordered', 'no_order', 'closed'].includes(b.outcome) ? b.outcome : 'no_order';
    if (outcome !== 'ordered' && !b.no_order_reason) throw httpError('Give a reason');
    const { data, error } = await c.from('mobile_visits').insert({
        tenant_id: t, agent_id: agent.id, route_id: b.route_id || null, ledger_account_id: b.ledger_account_id, visit_date: b.visit_date || today(),
        outcome, no_order_reason: outcome === 'ordered' ? null : b.no_order_reason, remarks: b.remarks || null, order_id: b.order_id || null,
        latitude: b.latitude ?? null, longitude: b.longitude ?? null, created_by: userId
    }).select().single();
    if (error) throw error;
    return data;
}

// ---------------------------------------------------------------- order -> bill
async function pendingOrderLines(c, t, q) {
    let oq = c.from('sales_orders').select('*').eq('tenant_id', t).in('status', csv(q.statuses).length ? csv(q.statuses) : ['draft', 'confirmed', 'partially_delivered']);
    if (q.customer_id) oq = oq.eq('customer_ledger_id', q.customer_id);
    if (q.agent_id) oq = oq.eq('agent_id', q.agent_id);
    if (q.route_id) oq = oq.eq('route_id', q.route_id);
    if (q.source) oq = oq.eq('order_source', q.source);
    if (q.date_from) oq = oq.gte('doc_date', q.date_from);
    if (q.date_to) oq = oq.lte('doc_date', q.date_to);
    const orders = await fetchAll(() => oq.order('doc_date').order('id'));
    const ids = orders.map(o => o.id);
    const lines = await inChunks(ids, async ch => (await c.from('sales_order_details').select('*').in('order_id', ch).order('display_order')).data || []);
    const out = orders.map(o => {
        const ls = lines.filter(l => l.order_id === o.id).map(l => {
            const pending = round4(Number(l.qty) - Number(l.qty_delivered || 0));
            const gross = pending * Number(l.rate || 0);
            const disc = Number(l.discount_percent) ? gross * Number(l.discount_percent) / 100 : Number(l.qty) ? Number(l.discount_amount || 0) * pending / Number(l.qty) : 0;
            return { ...l, pending_qty: pending, pending_alt_qty: l.alt_qty ? round4(Number(l.alt_qty) - Number(l.alt_qty_delivered || 0)) : null,
                pending_value: round2((gross - disc) * (1 + Number(l.tax_percent || 0) / 100)) };
        }).filter(l => l.pending_qty > 0.00005 || (l.pending_alt_qty || 0) > 0.00005);
        return { id: o.id, doc_no: o.doc_no, doc_date: o.doc_date, status: o.status, order_source: o.order_source || 'desk', customer_ledger_id: o.customer_ledger_id,
            customer_name: o.customer_name_snapshot, agent_id: o.agent_id, agent_name: o.agent_name_snapshot, route_name: o.route_name_snapshot, total_amount: round2(o.total_amount),
            age_days: daysBetween(String(o.doc_date).slice(0, 10), today()), lines: ls, pending_value: round2(ls.reduce((s, l) => s + l.pending_value, 0)) };
    }).filter(o => o.lines.length);
    return { orders: out, summary: { orders: out.length, lines: out.reduce((s, o) => s + o.lines.length, 0), pending_value: round2(out.reduce((s, o) => s + o.pending_value, 0)) } };
}

// Group the chosen order lines into bills. Returns [{ key, orders, body }].
async function planBills(c, t, b) {
    const picks = (b.orders || []).filter(o => o.order_id && (o.lines || []).some(l => Number(l.qty) > 0 || Number(l.alt_qty) > 0));
    if (!picks.length) throw httpError('Choose at least one order line with a quantity');
    const orderIds = picks.map(p => p.order_id);
    const orders = await inChunks(orderIds, async ch => (await c.from('sales_orders').select('*').eq('tenant_id', t).in('id', ch)).data || []);
    const lines = await inChunks(orderIds, async ch => (await c.from('sales_order_details').select('*').in('order_id', ch)).data || []);
    const O = Object.fromEntries(orders.map(o => [o.id, o])), L = Object.fromEntries(lines.map(l => [l.id, l]));
    const mode = b.mode === 'per_customer' ? 'per_customer' : 'per_order';
    const groups = {};
    for (const p of picks) {
        const o = O[p.order_id];
        if (!o) throw httpError('Order not found', 404);
        if (!['draft', 'confirmed', 'partially_delivered'].includes(o.status)) throw httpError(`Order ${o.doc_no} is ${o.status}`);
        const key = mode === 'per_customer' ? `${o.customer_ledger_id}|${o.customer_sub_ledger_id || ''}|${o.invoice_type}|${o.product_company_id || ''}` : o.id;
        const g = (groups[key] = groups[key] || { key, orders: [], details: [] });
        g.orders.push(o);
        for (const pl of p.lines || []) {
            const l = L[pl.order_detail_id];
            if (!l || l.order_id !== o.id) throw httpError(`Line not found on order ${o.doc_no}`);
            const qty = Number(pl.qty) || 0, alt = pl.alt_qty !== undefined && pl.alt_qty !== null && pl.alt_qty !== '' ? Number(pl.alt_qty) : null;
            if (qty <= 0 && !(alt > 0)) continue;
            const pending = Number(l.qty) - Number(l.qty_delivered || 0);
            if (qty > pending + 0.00005 && !b.allow_excess) throw httpError(`${l.product_name_snapshot || 'Item'} on ${o.doc_no}: qty ${qty} is more than the pending ${round4(pending)}`);
            const rate = pl.rate !== undefined && pl.rate !== '' ? Number(pl.rate) : Number(l.rate);
            if (!(rate >= 0)) throw httpError('Invalid rate');
            const discPct = pl.discount_percent !== undefined && pl.discount_percent !== '' ? Number(pl.discount_percent) : Number(l.discount_percent || 0);
            const detail = {
                product_id: l.product_id, qty, uom_id: l.uom_id, alt_qty: alt, alt_unit_id: l.alt_unit_id || null, rate_basis: l.rate_basis || 'primary', rate,
                discount_percent: discPct, tax_percent: Number(l.tax_percent || 0), free_qty: Number(l.free_qty || 0) && qty >= pending - 0.00005 ? Number(l.free_qty) : 0,
                warehouse_id: l.warehouse_id || o.warehouse_id || null, batch_no: l.batch_no || null, source_order_detail_id: l.id
            };
            if (!discPct && Number(l.discount_amount) && Number(l.qty)) detail.discount_amount = round2(Number(l.discount_amount) * qty / Number(l.qty));
            g.details.push(detail);
        }
    }
    return Object.values(groups).filter(g => g.details.length).map(g => {
        const o = g.orders[0];
        const same = k => (g.orders.every(x => x[k] === o[k]) ? o[k] : null);
        return { key: g.key, orders: g.orders.map(x => ({ id: x.id, doc_no: x.doc_no, status: x.status })), body: {
            doc_date: b.bill_date || today(), customer_ledger_id: o.customer_ledger_id, customer_sub_ledger_id: o.customer_sub_ledger_id || null,
            source_order_id: g.orders.length === 1 ? o.id : null, agent_id: same('agent_id'), route_id: same('route_id'), area_id: same('area_id'),
            warehouse_id: same('warehouse_id'), sales_account_ledger_id: same('sales_account_ledger_id'), cost_center_id: same('cost_center_id'),
            business_unit_id: same('business_unit_id'), product_company_id: same('product_company_id'), invoice_type: b.invoice_type || o.invoice_type || 'credit',
            rate_type: o.rate_type || 'exclusive', currency: o.currency || 'NPR', due_days: o.due_days || null,
            narration: b.narration || `Against Sales Order ${g.orders.map(x => x.doc_no).join(', ')}`,
            override_credit_block: !!b.override_credit_block, details: g.details
        } };
    });
}

// ---------------------------------------------------------------- reports
async function mastersFor(c, t) {
    const [agents, routes, areas] = await Promise.all([
        fetchAll(() => c.from('salesman_agents').select('id, agent_name, agent_code, linked_user_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('routes').select('id, route_name, area_id, default_agent_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('areas').select('id, area_name').eq('tenant_id', t).order('id'))
    ]);
    return { agents, routes, areas, A: Object.fromEntries(agents.map(a => [a.id, a.agent_name])), R: Object.fromEntries(routes.map(r => [r.id, r.route_name])) };
}

async function salesmanReport(c, t, view, q) {
    const from = q.date_from || today(), to = q.date_to || from;
    const M = await mastersFor(c, t);
    if (view === 'plan_vs_visit' || view === 'not_visited') {
        const plans = await plansBetween(c, t, { agentId: q.agent_id || null, from, to });
        const visits = await fetchAll(() => { let x = c.from('mobile_visits').select('*').eq('tenant_id', t).gte('visit_date', from).lte('visit_date', to); if (q.agent_id) x = x.eq('agent_id', q.agent_id); return x.order('id'); });
        const orders = await fetchAll(() => { let x = c.from('sales_orders').select('id, doc_date, agent_id, customer_ledger_id, total_amount, order_source').eq('tenant_id', t).neq('status', 'cancelled').gte('doc_date', from).lte('doc_date', to); if (q.agent_id) x = x.eq('agent_id', q.agent_id); return x.order('id'); });
        const agentIds = q.agent_id ? [q.agent_id] : [...new Set(plans.map(p => p.agent_id))];
        const custCache = {};
        const rows = [], missed = [];
        for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
            for (const a of agentIds) {
                const rIds = routesOn(plans, a, d);
                if (!rIds.length) continue;
                const key = rIds.join(',');
                const custs = custCache[key] = custCache[key] || await customersOfRoutes(c, t, rIds);
                const v = visits.filter(x => x.agent_id === a && String(x.visit_date).slice(0, 10) === d), o = orders.filter(x => x.agent_id === a && String(x.doc_date).slice(0, 10) === d);
                const visited = new Set([...v.map(x => x.ledger_account_id), ...o.map(x => x.customer_ledger_id)]);
                const productive = new Set(o.map(x => x.customer_ledger_id));
                const plannedIds = new Set(custs.map(x => x.id));
                rows.push({ date: d, agent_id: a, agent_name: M.A[a] || '', routes: rIds.map(r => M.R[r] || '?').join(', '), planned: plannedIds.size,
                    visited: [...visited].filter(x => plannedIds.has(x)).length, off_route: [...visited].filter(x => !plannedIds.has(x)).length,
                    productive: productive.size, no_order: v.filter(x => x.outcome !== 'ordered').length, orders: o.length, order_value: round2(o.reduce((s, x) => s + Number(x.total_amount || 0), 0)),
                    coverage_pct: plannedIds.size ? round2([...visited].filter(x => plannedIds.has(x)).length * 100 / plannedIds.size) : 0,
                    strike_rate_pct: visited.size ? round2(productive.size * 100 / visited.size) : 0 });
                custs.filter(x => !visited.has(x.id)).forEach(x => missed.push({ date: d, agent_name: M.A[a] || '', route_name: M.R[x.route_id] || '', customer: x.account_name, phone: x.phone || x.mobile || '', address: x.address || '' }));
            }
        }
        if (view === 'not_visited') return { from, to, rows: missed };
        const tot = k => rows.reduce((s, r) => s + r[k], 0);
        return { from, to, rows, totals: { planned: tot('planned'), visited: tot('visited'), productive: tot('productive'), orders: tot('orders'), order_value: round2(tot('order_value')) } };
    }
    if (view === 'visits') {
        const visits = await fetchAll(() => { let x = c.from('mobile_visits').select('*').eq('tenant_id', t).gte('visit_date', from).lte('visit_date', to); if (q.agent_id) x = x.eq('agent_id', q.agent_id); return x.order('visit_date').order('id'); });
        const ids = [...new Set(visits.map(v => v.ledger_account_id))];
        const leds = await inChunks(ids, async ch => (await c.from('ledger_accounts').select('id, account_name').in('id', ch)).data || []);
        const N = Object.fromEntries(leds.map(l => [l.id, l.account_name]));
        const reasons = {};
        visits.filter(v => v.outcome !== 'ordered').forEach(v => { reasons[v.no_order_reason || '-'] = (reasons[v.no_order_reason || '-'] || 0) + 1; });
        return { from, to, rows: visits.map(v => ({ ...v, agent_name: M.A[v.agent_id] || '', route_name: M.R[v.route_id] || '', customer: N[v.ledger_account_id] || '' })),
            reasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) };
    }
    if (view === 'order_register' || view === 'order_products' || view === 'fill_rate') {
        let oq = c.from('sales_orders').select('*').eq('tenant_id', t).gte('doc_date', from).lte('doc_date', to);
        if (q.agent_id) oq = oq.eq('agent_id', q.agent_id);
        if (q.route_id) oq = oq.eq('route_id', q.route_id);
        if (q.source) oq = oq.eq('order_source', q.source);
        if (q.status) oq = oq.eq('status', q.status);
        const orders = await fetchAll(() => oq.order('doc_date').order('id'));
        const lines = await inChunks(orders.map(o => o.id), async ch => (await c.from('sales_order_details').select('*').in('order_id', ch)).data || []);
        if (view === 'order_register') {
            return { from, to, rows: orders.map(o => {
                const ls = lines.filter(l => l.order_id === o.id);
                const oq2 = ls.reduce((s, l) => s + Number(l.qty), 0), dq = ls.reduce((s, l) => s + Math.min(Number(l.qty), Number(l.qty_delivered || 0)), 0);
                return { id: o.id, doc_no: o.doc_no, doc_date: o.doc_date, customer: o.customer_name_snapshot, agent: o.agent_name_snapshot, route: o.route_name_snapshot, source: o.order_source || 'desk',
                    status: o.status, lines: ls.length, amount: round2(o.total_amount), ordered_qty: round4(oq2), billed_qty: round4(dq), fill_pct: oq2 ? round2(dq * 100 / oq2) : 0 };
            }) };
        }
        const by = view === 'order_products' ? 'product' : (['agent', 'customer', 'product', 'route'].includes(q.group_by) ? q.group_by : 'agent');
        const acc = {};
        lines.forEach(l => {
            const o = orders.find(x => x.id === l.order_id); if (!o || o.status === 'cancelled') return;
            const k = by === 'product' ? l.product_id : by === 'customer' ? o.customer_ledger_id : by === 'route' ? o.route_id : o.agent_id;
            const name = by === 'product' ? l.product_name_snapshot : by === 'customer' ? o.customer_name_snapshot : by === 'route' ? o.route_name_snapshot : o.agent_name_snapshot;
            const a = (acc[k || '-'] = acc[k || '-'] || { key: k, name: name || '(none)', orders: new Set(), ordered_qty: 0, billed_qty: 0, ordered_value: 0, billed_value: 0 });
            const unit = Number(l.qty) ? Number(l.amount || 0) / Number(l.qty) : 0;
            a.orders.add(o.id); a.ordered_qty += Number(l.qty); a.billed_qty += Math.min(Number(l.qty), Number(l.qty_delivered || 0));
            a.ordered_value += Number(l.amount || 0); a.billed_value += unit * Math.min(Number(l.qty), Number(l.qty_delivered || 0));
        });
        return { from, to, group_by: by, rows: Object.values(acc).map(a => ({ ...a, orders: a.orders.size, ordered_qty: round4(a.ordered_qty), billed_qty: round4(a.billed_qty),
            pending_qty: round4(a.ordered_qty - a.billed_qty), ordered_value: round2(a.ordered_value), billed_value: round2(a.billed_value),
            pending_value: round2(a.ordered_value - a.billed_value), fill_pct: a.ordered_qty ? round2(a.billed_qty * 100 / a.ordered_qty) : 0 })).sort((x, y) => y.ordered_value - x.ordered_value) };
    }
    if (view === 'pending_orders') {
        const r = await pendingOrderLines(c, t, { ...q, date_from: q.date_from || null, date_to: q.date_to || null });
        const rows = [];
        r.orders.forEach(o => o.lines.forEach(l => rows.push({ doc_no: o.doc_no, doc_date: o.doc_date, age_days: o.age_days, status: o.status, source: o.order_source, customer: o.customer_name,
            agent: o.agent_name, route: o.route_name, product: l.product_name_snapshot, ordered_qty: round4(l.qty), billed_qty: round4(l.qty_delivered || 0), pending_qty: l.pending_qty, rate: Number(l.rate), pending_value: l.pending_value })));
        const ageing = { '0-7': 0, '8-15': 0, '16-30': 0, '30+': 0 };
        r.orders.forEach(o => { const k = o.age_days <= 7 ? '0-7' : o.age_days <= 15 ? '8-15' : o.age_days <= 30 ? '16-30' : '30+'; ageing[k] = round2(ageing[k] + o.pending_value); });
        return { rows, ageing, summary: r.summary };
    }
    if (view === 'agent_sales' || view === 'route_sales' || view === 'area_sales') {
        const key = view === 'agent_sales' ? 'agent_id' : view === 'route_sales' ? 'route_id' : 'area_id';
        const [bills, rets] = await Promise.all([
            fetchAll(() => c.from('sales_bills').select(`id, ${key}, customer_ledger_id, total_amount, total_tax_amount`).eq('tenant_id', t).eq('status', 'posted').gte('doc_date', from).lte('doc_date', to).order('id')),
            fetchAll(() => c.from('sales_returns').select(`id, ${key}, total_amount, total_tax_amount`).eq('tenant_id', t).eq('status', 'posted').gte('doc_date', from).lte('doc_date', to).order('id'))
        ]);
        const AR = Object.fromEntries(M.areas.map(a => [a.id, a.area_name]));
        const nameOf = id => (key === 'agent_id' ? M.A[id] : key === 'route_id' ? M.R[id] : AR[id]) || '(none)';
        const acc = {};
        const add = (r, sign) => { const k = r[key] || '-'; const a = (acc[k] = acc[k] || { key: r[key], name: nameOf(r[key]), bills: 0, customers: new Set(), sales: 0, returns: 0, vat: 0 });
            if (sign > 0) { a.bills++; a.customers.add(r.customer_ledger_id); a.sales += Number(r.total_amount) - Number(r.total_tax_amount || 0); } else a.returns += Number(r.total_amount) - Number(r.total_tax_amount || 0);
            a.vat += sign * Number(r.total_tax_amount || 0); };
        bills.forEach(r => add(r, 1)); rets.forEach(r => add(r, -1));
        const rows = Object.values(acc).map(a => ({ ...a, customers: a.customers.size, sales: round2(a.sales), returns: round2(a.returns), net: round2(a.sales - a.returns), vat: round2(a.vat) })).sort((x, y) => y.net - x.net);
        return { from, to, rows, totals: { sales: round2(rows.reduce((s, r) => s + r.sales, 0)), returns: round2(rows.reduce((s, r) => s + r.returns, 0)), net: round2(rows.reduce((s, r) => s + r.net, 0)) } };
    }
    throw httpError('Unknown report');
}

module.exports = {
    resolveAgent, planCalendar, savePlans, routeIdsFor, daySheet, agentParties, partyDetail, mobileProducts, mobileStock,
    buildMobileOrder, recordVisit, pendingOrderLines, planBills, salesmanReport, partyBalances, routesOn
};
