// =============================================
// utils/tradeLines.js
// One loader for every sales / purchase report line (Analysis, Monthly,
// Profitability, Rate History). Reads POSTED documents only:
//   sales:    Sales Bill (+), Sales Return (-), Sales Non-saleable Return (-)
//   purchase: Purchase Bill (+), Purchase Return (-), Purchase Non-saleable Return (-)
// and returns one normalized line per document line:
//   qty      - as entered, in the line's unit (uom)
//   alt_qty  - as entered, in the line's alt unit (fixed-dual: the loose
//              secondary count; other items: an alternate count)
//   base_qty - the real quantity in the item's base unit (dual lines
//              combined via toBaseQtyFromDual, others qty x unit factor)
//   free_base_qty, gross (qty x rate), discount, net (taxable = gross -
//   discount), tax, amount (net + tax), rate, net_rate_base (net / base qty)
// Sales Delivery (GDN, kind 'delivery') is read only when asked for by
// name (Loading Sheet) - it is never part of the default kinds, since a
// bill made from a delivery would count the same goods twice.
// Quantities and values keep their sign as documents: a return line is
// positive here and carries kind 'return' / 'nonsalable' - callers decide
// how to add them up.
// Bill-level billing terms (freight, bill discount ...) are not spread
// over lines; all figures are the lines' own.
// =============================================
const { toBaseQtyFromDual, getDualUomMode } = require('./dualUomCalculation');
const { reportScope } = require('./dataAccess');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
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
const csv = v => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map(s => String(s).trim()).filter(Boolean);

const SOURCES = {
    sales_bill: { side: 'sales', kind: 'main', label: 'Sales Bill', header: 'sales_bills', detail: 'sales_bill_details', fk: 'bill_id' },
    sales_return: { side: 'sales', kind: 'return', label: 'Sales Return', header: 'sales_returns', detail: 'sales_return_details', fk: 'return_id' },
    sales_nonsalable_return: { side: 'sales', kind: 'nonsalable', label: 'Sales Non-saleable Return', header: 'sales_nonsaleable_returns', detail: 'sales_nonsaleable_return_details', fk: 'return_id' },
    sales_delivery: { side: 'sales', kind: 'delivery', label: 'Sales Delivery', header: 'sales_deliveries', detail: 'sales_delivery_details', fk: 'delivery_id' },
    purchase_bill: { side: 'purchase', kind: 'main', label: 'Purchase Bill', header: 'purchase_bills', detail: 'purchase_bill_details', fk: 'bill_id' },
    purchase_return: { side: 'purchase', kind: 'return', label: 'Purchase Return', header: 'purchase_returns', detail: 'purchase_return_details', fk: 'return_id' },
    purchase_nonsalable_return: { side: 'purchase', kind: 'nonsalable', label: 'Purchase Non-saleable Return', header: 'purchase_nonsaleable_returns', detail: 'purchase_nonsaleable_return_details', fk: 'return_id' }
};
const KINDS = ['main', 'return', 'nonsalable'];

// Filters common to every report. Multi-value filters are comma lists.
function parseTradeQuery(q) {
    const side = q.side === 'purchase' ? 'purchase' : 'sales';
    const kinds = csv(q.kinds).filter(k => KINDS.includes(k) || k === 'delivery');
    return {
        side, from: q.date_from, to: q.date_to,
        kinds: kinds.length ? kinds : KINDS,
        partyIds: csv(q.party_ids), productIds: csv(q.product_ids), productGroupIds: csv(q.product_group_ids),
        productCompanyIds: csv(q.product_company_ids), productCategoryIds: csv(q.product_category_ids), itemTypes: csv(q.item_types),
        areaIds: csv(q.area_ids), routeIds: csv(q.route_ids), agentIds: csv(q.agent_ids), branchIds: csv(q.branch_ids),
        warehouseIds: csv(q.warehouse_ids), costCenterIds: csv(q.cost_center_ids), businessUnitIds: csv(q.business_unit_ids),
        search: (q.search || '').trim().toLowerCase(), docNo: (q.doc_no || '').trim().toLowerCase(), docIds: csv(q.doc_ids),
        statuses: q.include_draft === 'true' ? ['posted', 'draft'] : ['posted'], vehicleNo: (q.vehicle_no || '').trim().toLowerCase()
    };
}

// Masters every report needs to name things.
async function loadMasters(c, t) {
    const all = (table, cols) => fetchAll(() => c.from(table).select(cols).eq('tenant_id', t).order('id'));
    const [products, rates, units, groups, companies, categories, links, areas, routes, agents, subLedgers] = await Promise.all([
        all('products', 'id, product_code, product_name, item_type, product_group_id, product_company_id, base_unit_id, uom_mode, dual_uom_primary_unit_id, is_active'),
        all('product_unit_rates', 'product_id, unit_id, conversion_factor, is_base_unit, purchase_rate, last_purchase_rate'),
        all('product_units', 'id, unit_name, unit_symbol'),
        all('product_groups', 'id, group_name, parent_group_id'),
        all('product_companies', 'id, company_name'),
        all('product_categories', 'id, category_name'),
        all('product_category_links', 'product_id, product_category_id'),
        all('areas', 'id, area_name, parent_area_id'),
        all('routes', 'id, route_name, area_id'),
        all('salesman_agents', 'id, agent_name'),
        all('sub_ledgers', 'id, sub_ledger_name')
    ]);
    const byId = rows => Object.fromEntries(rows.map(r => [r.id, r]));
    const unitsById = byId(units);
    const factor = {};                                   // `${product}|${unit}` -> base units in one unit
    const unitsOf = {};                                  // product -> [{ unit_id, factor }] (base unit included)
    rates.forEach(r => {
        const fct = r.is_base_unit ? 1 : Number(r.conversion_factor) || 1;
        factor[`${r.product_id}|${r.unit_id}`] = fct;
        (unitsOf[r.product_id] = unitsOf[r.product_id] || []).push({ unit_id: r.unit_id, factor: fct });
    });
    const catsOf = {};
    links.forEach(l => (catsOf[l.product_id] = catsOf[l.product_id] || []).push(l.product_category_id));
    const purchaseRate = {};
    rates.filter(r => r.is_base_unit).forEach(r => { purchaseRate[r.product_id] = Number(r.last_purchase_rate) || Number(r.purchase_rate) || 0; });
    return {
        products: byId(products), units: unitsById, groups: byId(groups), companies: byId(companies), categories: byId(categories),
        areas: byId(areas), routes: byId(routes), agents: byId(agents), subLedgers: byId(subLedgers), factor, unitsOf, catsOf, purchaseRate,
        unitName: id => (id && (unitsById[id]?.unit_symbol || unitsById[id]?.unit_name)) || ''
    };
}

// A group / area and every group / area under it.
function withChildren(ids, rows, parentKey) {
    if (!ids.length) return null;
    const set = new Set(ids);
    for (let grew = true; grew;) {
        grew = false;
        Object.values(rows).forEach(r => { if (r[parentKey] && set.has(r[parentKey]) && !set.has(r.id)) { set.add(r.id); grew = true; } });
    }
    return set;
}
const topOf = (id, rows, parentKey) => { let r = rows[id], guard = 0; while (r && r[parentKey] && rows[r[parentKey]] && guard++ < 20) r = rows[r[parentKey]]; return r || null; };

// Load, normalize and filter the lines. Returns { lines, masters, warnings }.
async function loadTradeLines(c, t, f, opts = {}) {
    const M = opts.masters || await loadMasters(c, t);
    const dualMode = await getDualUomMode(c);
    const sources = Object.entries(SOURCES).filter(([, s]) => s.side === f.side && f.kinds.includes(s.kind));
    const partyKey = f.side === 'sales' ? 'customer_ledger_id' : 'vendor_ledger_id';

    const groupSet = withChildren(f.productGroupIds, M.groups, 'parent_group_id');
    const areaSet = withChildren(f.areaIds, M.areas, 'parent_area_id');
    const productOk = p => p
        && (!f.productIds.length || f.productIds.includes(p.id))
        && (!groupSet || groupSet.has(p.product_group_id))
        && (!f.productCompanyIds.length || f.productCompanyIds.includes(p.product_company_id))
        && (!f.productCategoryIds.length || (M.catsOf[p.id] || []).some(x => f.productCategoryIds.includes(x)))
        && (!f.itemTypes.length || f.itemTypes.includes(p.item_type))
        && (!f.search || [p.product_name, p.product_code].some(v => v && String(v).toLowerCase().includes(f.search)));

    const headersBySource = await Promise.all(sources.map(([, s]) => fetchAll(() => {
        let q = c.from(s.header).select('*').eq('tenant_id', t).in('status', f.statuses).order('id');
        if (f.from) q = q.gte('doc_date', f.from);
        if (f.to) q = q.lte('doc_date', f.to);
        if (f.partyIds.length) q = q.in(partyKey, f.partyIds);
        return q;
    })));

    // Party master: name, and area / route / agent when the document has none.
    const partyIds = [...new Set(headersBySource.flat().map(h => h[partyKey]).filter(Boolean))];
    const parties = Object.fromEntries((await inChunks(partyIds, async ids => {
        const { data, error } = await c.from('ledger_accounts').select('id, account_code, account_name, area_id, route_id, agent_id, billing_address, street, city, phone_office, contact_person_mobile, contact_person_phone').eq('tenant_id', t).in('id', ids);
        if (error) throw error; return data || [];
    })).map(p => [p.id, p]));

    const lines = [];
    for (let i = 0; i < sources.length; i++) {
        const [docType, s] = sources[i];
        const headers = headersBySource[i].filter(h => (!f.docNo || String(h.doc_no || '').toLowerCase().includes(f.docNo))
            && (!f.docIds.length || f.docIds.includes(h.id)) && (!f.vehicleNo || String(h.vehicle_no || '').toLowerCase().includes(f.vehicleNo)));
        if (!headers.length) continue;
        const byHeader = Object.fromEntries(headers.map(h => [h.id, h]));
        const details = await inChunks(headers.map(h => h.id), async ids => {
            const { data, error } = await c.from(s.detail).select('*').eq('tenant_id', t).in(s.fk, ids);
            if (error) throw error; return data || [];
        });
        for (const d of details) {
            const h = byHeader[d[s.fk]], p = M.products[d.product_id];
            if (!h || !productOk(p)) continue;
            const party = parties[h[partyKey]] || null;
            const areaId = h.area_id || party?.area_id || null, routeId = h.route_id || party?.route_id || null, agentId = h.agent_id || party?.agent_id || null;
            const warehouseId = d.warehouse_id || h.warehouse_id || null;
            if (areaSet && !areaSet.has(areaId)) continue;
            if (f.routeIds.length && !f.routeIds.includes(routeId)) continue;
            if (f.agentIds.length && !f.agentIds.includes(agentId)) continue;
            if (f.branchIds.length && !f.branchIds.includes(h.branch_id)) continue;
            if (f.warehouseIds.length && !f.warehouseIds.includes(warehouseId)) continue;
            if (f.costCenterIds.length && !f.costCenterIds.includes(h.cost_center_id)) continue;
            if (f.businessUnitIds.length && !f.businessUnitIds.includes(h.business_unit_id)) continue;

            const qty = Number(d.qty) || 0, altQty = Number(d.alt_qty) || 0;
            const dual = p.uom_mode === 'fixed_dual';
            const dualFactor = dual ? M.factor[`${p.id}|${p.dual_uom_primary_unit_id}`] || 1 : 1;
            const unitFactor = d.uom_id ? M.factor[`${p.id}|${d.uom_id}`] || 1 : 1;
            const baseQty = dual && altQty ? toBaseQtyFromDual(qty, altQty, dualFactor, dualMode) : qty * unitFactor;
            const freeUnitFactor = d.free_uom_id ? M.factor[`${p.id}|${d.free_uom_id}`] || 1 : unitFactor;
            const freeBase = (Number(d.free_qty) || 0) * freeUnitFactor + (dual ? Number(d.free_alt_qty) || 0 : 0);
            const tax = Number(d.tax_amount) || 0, amount = Number(d.amount) || 0, discount = Number(d.discount_amount) || 0;
            const net = amount - tax;
            const area = M.areas[areaId], mainArea = areaId ? topOf(areaId, M.areas, 'parent_area_id') : null;
            const group = M.groups[p.product_group_id], mainGroup = p.product_group_id ? topOf(p.product_group_id, M.groups, 'parent_group_id') : null;
            const subId = h.customer_sub_ledger_id || h.vendor_sub_ledger_id || null;
            const date = String(h.doc_date).slice(0, 10);
            lines.push({
                doc_type: docType, doc_label: s.label, kind: s.kind, doc_id: h.id, doc_no: h.doc_no, doc_date: date, month: date.slice(0, 7),
                party_bill_no: h.party_bill_no || null, line_id: d.id, source_bill_id: h.source_bill_id || null, status: h.status,
                source_delivery_id: h.source_delivery_id || null, source_delivery_detail_id: d.source_delivery_detail_id || null,
                uom_id: d.uom_id || null, alt_unit_id: d.alt_unit_id || null,
                vehicle_no: h.vehicle_no || null, driver_name: h.driver_name || null, delivery_address: h.delivery_address || null,
                doc_total: Number(h.total_amount) || 0, doc_tax: Number(h.total_tax_amount) || 0,
                party_address: party ? party.billing_address || [party.street, party.city].filter(Boolean).join(', ') : '',
                party_phone: party ? [party.phone_office, party.contact_person_mobile || party.contact_person_phone].filter(Boolean).join(', ') : '',
                uom_mode: p.uom_mode || 'single',
                party_id: h[partyKey] || (h.cash_vendor_name ? `cash:${h.cash_vendor_name.trim().toLowerCase()}` : null),
                party_name: h.customer_name_snapshot || h.vendor_name_snapshot || party?.account_name || (h.cash_vendor_name ? `${h.cash_vendor_name} (cash)` : '(no party)'),
                party_code: party?.account_code || '',
                sub_ledger_id: subId, sub_ledger_name: h.customer_sub_ledger_name_snapshot || M.subLedgers[subId]?.sub_ledger_name || '',
                area_id: areaId, area_name: h.area_name_snapshot || area?.area_name || '', main_area_id: mainArea?.id || null, main_area_name: mainArea?.area_name || '',
                route_id: routeId, route_name: h.route_name_snapshot || M.routes[routeId]?.route_name || '',
                agent_id: agentId, agent_name: h.agent_name_snapshot || M.agents[agentId]?.agent_name || '',
                branch_id: h.branch_id || null, branch_name: h.branch_name_snapshot || '',
                warehouse_id: warehouseId, warehouse_name: d.warehouse_name_snapshot || h.warehouse_name_snapshot || '',
                cost_center_id: h.cost_center_id || null, cost_center_name: h.cost_center_name_snapshot || '',
                business_unit_id: h.business_unit_id || null, business_unit_name: h.business_unit_name_snapshot || '',
                product_id: p.id, product_code: p.product_code || '', product_name: p.product_name,
                product_group_id: p.product_group_id || null, group_name: group?.group_name || '', main_group_id: mainGroup?.id || null, main_group_name: mainGroup?.group_name || '',
                product_company_id: p.product_company_id || null, company_name: M.companies[p.product_company_id]?.company_name || '',
                category_ids: M.catsOf[p.id] || [], category_name: (M.catsOf[p.id] || []).map(x => M.categories[x]?.category_name).filter(Boolean).join(', '),
                item_type: p.item_type, base_unit: M.unitName(p.base_unit_id),
                dual, dual_factor: dualFactor, primary_unit: dual ? M.unitName(p.dual_uom_primary_unit_id) : '',
                qty: round4(qty), unit: d.uom_name_snapshot || M.unitName(d.uom_id), unit_factor: unitFactor,
                alt_qty: round4(altQty), alt_unit: d.alt_unit_name_snapshot || M.unitName(d.alt_unit_id),
                alt1_qty: round4(Number(d.alt1_qty) || 0), alt1_unit: d.alt1_unit_name_snapshot || M.unitName(d.alt1_unit_id),
                base_qty: round4(baseQty), free_base_qty: round4(freeBase),
                rate: round4(Number(d.rate) || 0), rate_basis: d.rate_basis || 'primary',
                gross: round2(net + discount), discount: round2(discount), net: round2(net), tax: round2(tax), amount: round2(amount),
                net_rate_base: baseQty ? round4(net / baseQty) : 0,
                discount_percent: Number(d.discount_percent) || (net + discount ? round2(discount * 100 / (net + discount)) : 0),
                batch_no: d.batch_no || null, serial_no: d.serial_no || null
            });
        }
    }
    lines.sort((a, b) => a.doc_date.localeCompare(b.doc_date) || String(a.doc_no).localeCompare(String(b.doc_no)));
    // data access rules: reports see (and total) only the user's parties / products
    const scope = await reportScope();
    if (scope) {
        const a = scope.allow;
        return { lines: lines.filter(l => a.product(l.product_id) && a.ledger(l.party_id) && a.area(l.area_id)), masters: M };
    }
    return { lines, masters: M };
}

// Master lists for the filter pickers.
async function tradeMeta(c, t) {
    const M = await loadMasters(c, t);
    const list = (rows, name) => Object.values(rows).map(r => ({ id: r.id, name: r[name] })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const all = (table, cols) => fetchAll(() => c.from(table).select(cols).eq('tenant_id', t).order('id'));
    const [branches, warehouses, costCenters, businessUnits, customers, vendors] = await Promise.all([
        all('branches', 'id, branch_name'), all('warehouses', 'id, warehouse_name'), all('cost_centers', 'id, cost_center_name'), all('business_units', 'id, unit_name'),
        fetchAll(() => c.from('sales_bills').select('customer_ledger_id, customer_name_snapshot').eq('tenant_id', t).eq('status', 'posted').order('id')),
        fetchAll(() => c.from('purchase_bills').select('vendor_ledger_id, vendor_name_snapshot').eq('tenant_id', t).eq('status', 'posted').order('id'))
    ]);
    const parties = (rows, idKey, nameKey) => [...new Map(rows.filter(r => r[idKey]).map(r => [r[idKey], { id: r[idKey], name: r[nameKey] || r[idKey] }])).values()]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return {
        customers: parties(customers, 'customer_ledger_id', 'customer_name_snapshot'), vendors: parties(vendors, 'vendor_ledger_id', 'vendor_name_snapshot'),
        products: Object.values(M.products).map(p => ({ id: p.id, name: p.product_code ? `${p.product_name} · ${p.product_code}` : p.product_name, product_company_id: p.product_company_id, product_group_id: p.product_group_id }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        product_groups: list(M.groups, 'group_name'), product_companies: list(M.companies, 'company_name'), product_categories: list(M.categories, 'category_name'),
        areas: list(M.areas, 'area_name'), routes: list(M.routes, 'route_name'), agents: list(M.agents, 'agent_name'),
        branches: branches.map(b => ({ id: b.id, name: b.branch_name })), warehouses: warehouses.map(w => ({ id: w.id, name: w.warehouse_name })),
        cost_centers: costCenters.map(x => ({ id: x.id, name: x.cost_center_name })), business_units: businessUnits.map(x => ({ id: x.id, name: x.unit_name })),
        units: Object.values(M.units).map(u => ({ id: u.id, name: u.unit_name }))
    };
}

module.exports = { SOURCES, KINDS, parseTradeQuery, loadMasters, loadTradeLines, tradeMeta, fetchAll, inChunks, csv, round2, round4 };
