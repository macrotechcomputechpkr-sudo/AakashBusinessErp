// =============================================
// utils/stockReport.js
// Stock Report - three views over the same stock ledger, all valued by
// stockEngine.itemMovement() so the figures agree with Stock Movement and
// the financial statements:
//   summary - per item (or item + batch / item + warehouse): Opening | In by
//             module | Out by module | Closing qty / rate / value
//   detail  - every stock line in the period per item: date, document, party,
//             warehouse, batch (+ expiry), serial no, in / out qty, rate,
//             amount and running balance
//   party   - per party + item: purchase / purchase return / sales / sales
//             return qty and amount at the document rate
//   opening - opening stock only: as entered in Product Opening Entry (with
//             its batches and serial numbers), or on hand at the start of From
// Filters: item class (Inventory / Assets / Service), item type, product group
// (with its sub-groups), product company, product category, base unit, item,
// search, batch / serial tracking, warehouse, batch no, serial no, party,
// module, stock status; quantities can be shown in any unit of the item.
// =============================================
const { itemMovement: rawMovement, METHODS, MODULE_LABEL, TRANSFER_KEYS, costingSettings, methodFor, keyEvents } = require('./stockEngine');
const { reportScope } = require('./dataAccess');
// Batch / serial products are costed per System Control (FIFO / LIFO / average or batch-wise / serial-wise).
const moveOf = (f, p, events, from, to) => { const e = methodFor(p, f.method, f.cs); return rawMovement(keyEvents(events, e.keyBy), e.method, from, to); };

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const dayBefore = d => new Date(new Date(d + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
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
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);

const ITEM_TYPE_LABEL = { raw_material: 'Raw Material', semi_finished: 'Semi-Finished', finished_good: 'Finished Good', trading_item: 'Trading Item',
    fixed_asset: 'Fixed Asset', service: 'Service', non_inventory: 'Non-Inventory' };
// Item class - the Inventory / Assets / Service split of item_type.
const CLASS_OF = { raw_material: 'inventory', semi_finished: 'inventory', finished_good: 'inventory', trading_item: 'inventory',
    fixed_asset: 'assets', service: 'service', non_inventory: 'service' };
const CLASS_LABEL = { inventory: 'Inventory', assets: 'Assets', service: 'Service' };

// Summary columns: GRN + direct bill = Purchase, delivery + direct bill = Sales,
// non-saleable returns join their return column.
const SUMMARY_OF = { opening: 'opening', purchase_grn: 'purchase', purchase_bill: 'purchase', purchase_return: 'purchase_return', purchase_nonsalable_return: 'purchase_return',
    sales_delivery: 'sales', sales_bill: 'sales', sales_return: 'sales_return', sales_nonsalable_return: 'sales_return', production: 'production',
    stock_transfer: 'stock_transfer', transfer_wh: 'stock_transfer', stock_adjustment: 'stock_adjustment' };
const SUMMARY_LABEL = { opening: 'Opening Stock', purchase: 'Purchase', purchase_return: 'Purchase Return', sales: 'Sales', sales_return: 'Sales Return',
    production: 'Production', stock_adjustment: 'Stock Adjustment', stock_transfer: 'Stock Transfer' };
const ORDER_IN = ['opening', 'purchase', 'sales_return', 'production', 'stock_adjustment', 'stock_transfer', 'goods_in_transit'];
const ORDER_OUT = ['sales', 'purchase_return', 'production', 'stock_adjustment', 'stock_transfer', 'goods_in_transit'];

// Source document of each stock_movements.source_type: header table, party side
// and (sales side only) the detail table carrying serial_no.
const SOURCES = {
    purchase_grn: { header: 'purchase_grns', party: 'vendor' },
    purchase_bill: { header: 'purchase_bills', party: 'vendor' },
    purchase_return: { header: 'purchase_returns', party: 'vendor' },
    purchase_nonsalable_return: { header: 'purchase_nonsaleable_returns', party: 'vendor' },
    sales_delivery: { header: 'sales_deliveries', party: 'customer', serialFrom: 'sales_delivery_details' },
    sales_bill: { header: 'sales_bills', party: 'customer', serialFrom: 'sales_bill_details' },
    sales_return: { header: 'sales_returns', party: 'customer', serialFrom: 'sales_return_details' },
    sales_nonsalable_return: { header: 'sales_nonsaleable_returns', party: 'customer' },
    production: { header: 'production_orders' },
    stock_transfer: { header: 'stock_transfers' },
    stock_adjustment: { header: 'stock_adjustments' }
};
const PARTY_COLS = {
    vendor: 'vendor_ledger_id, vendor_name_snapshot, cash_vendor_name',
    customer: 'customer_ledger_id, customer_name_snapshot, customer_sub_ledger_name_snapshot'
};
function partyOf(h, side) {
    if (side === 'vendor') {
        if (h.vendor_ledger_id) return { key: `L:${h.vendor_ledger_id}`, ledgerId: h.vendor_ledger_id, name: h.vendor_name_snapshot || null };
        if (h.cash_vendor_name) return { key: `C:${h.cash_vendor_name.trim().toLowerCase()}`, name: `${h.cash_vendor_name} (cash)` };
        return null;
    }
    if (!h.customer_ledger_id) return null;
    const sub = h.customer_sub_ledger_name_snapshot ? ` / ${h.customer_sub_ledger_name_snapshot}` : '';
    return { key: `L:${h.customer_ledger_id}`, ledgerId: h.customer_ledger_id, name: h.customer_name_snapshot ? h.customer_name_snapshot + sub : null, sub };
}
async function fillLedgerNames(c, t, parties) {
    const missing = [...new Set(parties.filter(p => p && !p.name && p.ledgerId).map(p => p.ledgerId))];
    if (!missing.length) return;
    const rows = await inChunks(missing, async ids => { const { data, error } = await c.from('ledger_accounts').select('id, account_name').eq('tenant_id', t).in('id', ids); if (error) throw error; return data || []; });
    const byId = Object.fromEntries(rows.map(r => [r.id, r.account_name]));
    parties.forEach(p => { if (p && !p.name) p.name = (byId[p.ledgerId] || 'Unknown party') + (p.sub || ''); });
}

// ---------------- parameters ----------------
function parseQuery(q) {
    const mode = ['summary', 'detail', 'party', 'opening'].includes(q.mode) ? q.mode : 'summary';
    return {
        mode, from: q.date_from, to: q.date_to, openingBasis: q.opening_basis === 'as_on' ? 'as_on' : 'entry',
        method: METHODS[q.stock_method] ? q.stock_method : 'weighted_average',
        groupBy: ['item', 'item_batch', 'item_warehouse'].includes(q.group_by) ? q.group_by : 'item',
        itemClasses: csv(q.item_class).filter(k => CLASS_LABEL[k]),
        itemTypes: csv(q.item_type).filter(k => ITEM_TYPE_LABEL[k]),
        productGroupId: q.product_group_id || null, productCompanyId: q.product_company_id || null,
        productCategoryId: q.product_category_id || null, unitId: q.unit_id || null, productId: q.product_id || null,
        search: (q.search || '').trim().toLowerCase(), tracking: ['batch', 'serial'].includes(q.tracking) ? q.tracking : '',
        includeInactive: q.include_inactive === 'true',
        warehouseId: q.warehouse_id || null, batchNo: (q.batch_no || '').trim().toLowerCase(), serialNo: (q.serial_no || '').trim().toLowerCase(),
        partyKey: q.party_key || '', modules: csv(q.modules).filter(k => SUMMARY_LABEL[k]),
        stockStatus: q.stock_status || '', hideZero: q.hide_zero !== 'false', displayUnitId: q.display_unit_id || null
    };
}

// ---------------- products + masters ----------------
async function loadProducts(c, t, f) {
    let groupIds = null;
    if (f.productGroupId) {                             // the group and every sub-group under it
        const groups = await fetchAll(() => c.from('product_groups').select('id, parent_group_id').eq('tenant_id', t).order('id'));
        groupIds = new Set([f.productGroupId]);
        for (let grew = true; grew;) { grew = false; groups.forEach(g => { if (g.parent_group_id && groupIds.has(g.parent_group_id) && !groupIds.has(g.id)) { groupIds.add(g.id); grew = true; } }); }
    }
    let types = f.itemTypes.length ? f.itemTypes : null;
    if (f.itemClasses.length) {
        const byClass = Object.keys(CLASS_OF).filter(k => f.itemClasses.includes(CLASS_OF[k]));
        types = types ? types.filter(k => byClass.includes(k)) : byClass;
    }
    let products = await fetchAll(() => {
        let q = c.from('products').select('id, product_code, product_name, item_type, hs_code, product_group_id, product_company_id, base_unit_id, opening_qty, opening_rate, opening_value, minimum_stock, maximum_stock, reorder_qty, maintain_batch, track_serial_number, is_active')
            .eq('tenant_id', t).order('id');
        if (f.productId) q = q.eq('id', f.productId);
        if (f.productCompanyId) q = q.eq('product_company_id', f.productCompanyId);
        if (f.unitId) q = q.eq('base_unit_id', f.unitId);
        if (types) q = q.in('item_type', types.length ? types : ['__none__']);
        if (f.tracking === 'batch') q = q.eq('maintain_batch', true);
        if (f.tracking === 'serial') q = q.eq('track_serial_number', true);
        if (!f.includeInactive && !f.productId) q = q.eq('is_active', true);
        return q;
    });
    if (groupIds) products = products.filter(p => groupIds.has(p.product_group_id));
    const scope = await reportScope();                  // data access rules (utils/dataAccess.js)
    if (scope) products = products.filter(p => scope.allow.product(p.id));
    if (f.search) products = products.filter(p => [p.product_name, p.product_code, p.hs_code].some(v => v && String(v).toLowerCase().includes(f.search)));

    const [groups, companies, units, categories, links] = await Promise.all([
        fetchAll(() => c.from('product_groups').select('id, group_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_companies').select('id, company_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_units').select('id, unit_name, unit_symbol').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_categories').select('id, category_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_category_links').select('product_id, product_category_id').eq('tenant_id', t).order('id'))
    ]);
    const catsOf = {};
    links.forEach(l => (catsOf[l.product_id] = catsOf[l.product_id] || []).push(l.product_category_id));
    if (f.productCategoryId) products = products.filter(p => (catsOf[p.id] || []).includes(f.productCategoryId));

    const name = (rows, k) => Object.fromEntries(rows.map(r => [r.id, r[k]]));
    const groupName = name(groups, 'group_name'), companyName = name(companies, 'company_name'), catName = name(categories, 'category_name');
    const unitName = Object.fromEntries(units.map(u => [u.id, u.unit_symbol || u.unit_name]));

    // Display unit: quantities divided by that unit's conversion factor (base units per unit).
    const factorOf = {};
    if (f.displayUnitId && products.length) {
        const rates = await inChunks(products.map(p => p.id), async ids => {
            const { data, error } = await c.from('product_unit_rates').select('product_id, conversion_factor, is_base_unit').eq('tenant_id', t).eq('unit_id', f.displayUnitId).in('product_id', ids);
            if (error) throw error; return data || [];
        });
        rates.forEach(r => { factorOf[r.product_id] = r.is_base_unit ? 1 : Number(r.conversion_factor) || 1; });
    }
    const info = {};
    products.forEach(p => {
        const f2 = factorOf[p.id];
        info[p.id] = {
            product_id: p.id, product_code: p.product_code, product_name: p.product_name, hs_code: p.hs_code || null,
            item_type: p.item_type, item_type_label: ITEM_TYPE_LABEL[p.item_type] || p.item_type,
            item_class: CLASS_OF[p.item_type] || 'inventory', item_class_label: CLASS_LABEL[CLASS_OF[p.item_type] || 'inventory'],
            product_group_id: p.product_group_id, group_name: groupName[p.product_group_id] || '',
            product_company_id: p.product_company_id, company_name: companyName[p.product_company_id] || '',
            categories: (catsOf[p.id] || []).map(id => catName[id]).filter(Boolean).join(', '),
            base_unit: unitName[p.base_unit_id] || '',
            unit: f2 ? unitName[f.displayUnitId] || '' : unitName[p.base_unit_id] || '',
            factor: f2 || 1,
            minimum_stock: Number(p.minimum_stock) || 0, reorder_qty: Number(p.reorder_qty) || 0,
            maintain_batch: !!p.maintain_batch, track_serial_number: !!p.track_serial_number
        };
    });
    return { products, info };
}

// ---------------- stock events per report row ----------------
async function loadEvents(c, t, f, products) {
    const ids = new Set(products.map(p => p.id));
    const { data: fy } = await c.from('fiscal_years').select('start_date_eng').eq('tenant_id', t).eq('has_opening_balance', true).maybeSingle();
    const openingDay = fy?.start_date_eng ? dayBefore(String(fy.start_date_eng).slice(0, 10)) : '0000-01-01';
    const [moves, batches, warehouses] = await Promise.all([
        ids.size ? fetchAll(() => {
            let q = c.from('stock_movements').select('*')
                .eq('tenant_id', t).lte('movement_date', f.to).order('id');
            if (f.productId) q = q.eq('product_id', f.productId);
            if (f.warehouseId) q = q.eq('warehouse_id', f.warehouseId);
            return q;
        }) : [],
        ids.size ? fetchAll(() => c.from('product_batches').select('product_id, batch_no, mfg_date, exp_date, qty, rate, is_active').eq('tenant_id', t).order('id')) : [],
        fetchAll(() => c.from('warehouses').select('id, warehouse_name').eq('tenant_id', t).order('id'))
    ]);
    const whName = Object.fromEntries(warehouses.map(w => [w.id, w.warehouse_name]));
    const batchMeta = {}, openingBatches = {};
    batches.filter(b => ids.has(b.product_id)).forEach(b => {
        batchMeta[`${b.product_id}|${b.batch_no}`] = b;
        if (b.is_active !== false && Number(b.qty) > 0) (openingBatches[b.product_id] = openingBatches[b.product_id] || []).push(b);
    });

    // Warehouse view: a transfer really moves stock in / out of a warehouse.
    // Company view: it nets to zero and the engine carries it at no effect.
    const byWh = f.groupBy === 'item_warehouse' || !!f.warehouseId;
    const byBatch = f.groupBy === 'item_batch' || !!f.batchNo;
    const batchOk = b => !f.batchNo || String(b || '').toLowerCase() === f.batchNo;
    const rows = new Map();
    const rowFor = (p, batch, wh) => {
        const key = f.groupBy === 'item_batch' ? `${p.id}|${batch || ''}` : f.groupBy === 'item_warehouse' ? `${p.id}|${wh || ''}` : p.id;
        if (!rows.has(key)) rows.set(key, { key, product_id: p.id, batch_no: f.groupBy === 'item_batch' ? batch || '' : null,
            warehouse_id: f.groupBy === 'item_warehouse' ? wh || null : null, events: [] });
        return rows.get(key);
    };
    const warnings = [];
    if (f.groupBy === 'item') products.forEach(p => rowFor(p, null, null));
    const byId = Object.fromEntries(products.map(p => [p.id, p]));

    // Product opening stock carries no warehouse; with a batch view it comes from the opening batches.
    if (!f.warehouseId) {
        products.forEach(p => {
            const total = Number(p.opening_qty) || 0;
            const pb = byBatch ? (openingBatches[p.id] || []) : [];
            let used = 0;
            pb.forEach(b => {
                used += Number(b.qty);
                if (batchOk(b.batch_no)) rowFor(p, b.batch_no, null).events.push({ date: openingDay, seq: '', qin: Number(b.qty), qout: 0, cost: Number(b.rate) || 0, src: 'opening', src_type: 'opening', batch_no: b.batch_no, warehouse_id: null });
            });
            const rest = round4(total - used);
            if (rest > 0 && batchOk('')) rowFor(p, '', null).events.push({ date: openingDay, seq: '', qin: rest, qout: 0, cost: Number(p.opening_rate) || 0, src: 'opening', src_type: 'opening', batch_no: null, warehouse_id: null });
        });
    } else if (products.some(p => Number(p.opening_qty) > 0)) {
        warnings.push('Product opening stock is not linked to a warehouse, so it is left out when filtering by warehouse.');
    }
    moves.forEach(m => {
        const p = byId[m.product_id];
        if (!p || !batchOk(m.batch_no)) return;
        rowFor(p, m.batch_no, m.warehouse_id).events.push({
            date: String(m.movement_date).slice(0, 10), seq: m.created_at || '', qin: Number(m.qty_in) || 0, qout: Number(m.qty_out) || 0, cost: Number(m.unit_cost) || 0,
            src: m.source_type === 'stock_transfer' && byWh ? 'transfer_wh' : m.source_type || 'other', src_type: m.source_type,
            id: m.id, source_id: m.source_id, source_detail_id: m.source_detail_id, batch_no: m.batch_no, serial_no: m.serial_no || null, warehouse_id: m.warehouse_id, narration: m.narration
        });
    });
    rows.forEach(r => r.events.sort((a, b) => a.date.localeCompare(b.date) || String(a.seq).localeCompare(String(b.seq))));
    return { rows: [...rows.values()], whName, batchMeta, openingBatches, openingDay, warnings, byWh };
}

// Document no, party and serial no for the stock lines that need them.
async function loadDocs(c, t, events) {
    const want = {}, detailWant = {};
    events.forEach(e => {
        const s = SOURCES[e.src_type]; if (!s || !e.source_id) return;
        (want[e.src_type] = want[e.src_type] || new Set()).add(e.source_id);
        if (s.serialFrom && e.source_detail_id) (detailWant[e.src_type] = detailWant[e.src_type] || new Set()).add(e.source_detail_id);
    });
    const docs = {}, serials = {}, parties = [];
    for (const [type, set] of Object.entries(want)) {
        const s = SOURCES[type];
        const cols = ['id, doc_no', s.party && PARTY_COLS[s.party]].filter(Boolean).join(', ');
        const rows = await inChunks([...set], async ids => { const { data, error } = await c.from(s.header).select(cols).eq('tenant_id', t).in('id', ids); if (error) throw error; return data || []; });
        rows.forEach(h => { const party = s.party ? partyOf(h, s.party) : null; if (party) parties.push(party); docs[`${type}:${h.id}`] = { doc_no: h.doc_no, party }; });
    }
    for (const [type, set] of Object.entries(detailWant)) {
        const rows = await inChunks([...set], async ids => { const { data, error } = await c.from(SOURCES[type].serialFrom).select('id, serial_no').eq('tenant_id', t).in('id', ids); if (error) throw error; return data || []; });
        rows.forEach(d => { if (d.serial_no) serials[d.id] = d.serial_no; });
    }
    await fillLedgerNames(c, t, parties);
    return { docOf: e => docs[`${e.src_type}:${e.source_id}`] || null, serialOf: e => (e.source_detail_id && serials[e.source_detail_id]) || null };
}

const statusOk = (f, qty, minimum) => {
    if (f.stockStatus === 'in_stock') return qty > 1e-9;
    if (f.stockStatus === 'zero') return Math.abs(qty) <= 1e-9;
    if (f.stockStatus === 'negative') return qty < -1e-9;
    if (f.stockStatus === 'below_minimum') return minimum > 0 && qty < minimum;
    return true;
};
const lineFilter = f => e => {
    if (f.modules.length && !f.modules.includes(SUMMARY_OF[e.src] || e.src)) return false;
    if (f.partyKey && e.party?.key !== f.partyKey) return false;
    if (f.serialNo && !String(e.serial_no || '').toLowerCase().includes(f.serialNo)) return false;
    return true;
};

// ---------------- summary ----------------
function buildSummary(f, info, ev) {
    const modulesIn = new Set(), modulesOut = new Set(), warnings = [...ev.warnings];
    let rows = ev.rows.map(r => {
        const p = info[r.product_id], k = p.factor;
        const m = moveOf(f, p, r.events, f.from, f.to);
        const label = [p.product_name, r.batch_no, r.warehouse_id && ev.whName[r.warehouse_id]].filter(Boolean).join(' · ');
        if (m.negative) warnings.push(`${label}: negative stock ${round4(m.closing.qty)} - valued at zero`);
        const fold = obj => {
            const out = {};
            Object.entries(obj).forEach(([src, b]) => { const g = SUMMARY_OF[src] || src; out[g] = out[g] || { qty: 0, value: 0 }; out[g].qty += b.qty; out[g].value += b.value; });
            return Object.fromEntries(Object.entries(out).map(([g, b]) => [g, { qty: round4(b.qty / k), value: round2(b.value) }]));
        };
        const inBy = fold(m.inBy), outBy = fold(m.outBy);
        Object.keys(inBy).forEach(x => modulesIn.add(x)); Object.keys(outBy).forEach(x => modulesOut.add(x));
        const tot = (o, key) => Object.values(o).reduce((s, b) => s + b[key], 0);
        const meta = r.batch_no ? ev.batchMeta[`${r.product_id}|${r.batch_no}`] : null;
        return {
            ...p, key: r.key, batch_no: r.batch_no, mfg_date: meta?.mfg_date || null, exp_date: meta?.exp_date || null,
            warehouse_id: r.warehouse_id, warehouse_name: r.warehouse_id ? ev.whName[r.warehouse_id] || '' : (f.groupBy === 'item_warehouse' ? '(Opening - no warehouse)' : null),
            opening_qty: round4(m.opening.qty / k), opening_value: round2(m.opening.value),
            in: inBy, out: outBy, in_qty: round4(tot(inBy, 'qty')), in_value: round2(tot(inBy, 'value')), out_qty: round4(tot(outBy, 'qty')), out_value: round2(tot(outBy, 'value')),
            closing_qty: round4(m.closing.qty / k), closing_value: round2(m.closing.value),
            closing_rate: m.closing.qty > 1e-9 ? round2(m.closing.value / (m.closing.qty / k)) : 0,
            below_minimum: p.minimum_stock > 0 && m.closing.qty < p.minimum_stock,
            _closing_base: m.closing.qty
        };
    });
    if (f.hideZero) rows = rows.filter(r => r.opening_qty || r.in_qty || r.out_qty || r.closing_qty);
    rows = rows.filter(r => statusOk(f, r._closing_base, r.minimum_stock));
    rows.forEach(r => {                                  // exact value identity at 2 decimals
        delete r._closing_base;
        const gap = round2(r.opening_value + r.in_value - r.out_value - r.closing_value);
        if (gap && Object.keys(r.out).length) { const x = Object.keys(r.out).find(y => !TRANSFER_KEYS.has(y)) || Object.keys(r.out)[0]; r.out[x].value = round2(r.out[x].value + gap); r.out_value = round2(r.out_value + gap); }
    });
    rows.sort((a, b) => a.product_name.localeCompare(b.product_name) || String(a.batch_no || a.warehouse_name || '').localeCompare(String(b.batch_no || b.warehouse_name || '')));
    const sortMods = (set, order) => [...set].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)).map(key => ({ key, label: SUMMARY_LABEL[key] || MODULE_LABEL[key] || key }));
    const sum = key => round2(rows.reduce((s, r) => s + r[key], 0));
    const totals = { opening_value: sum('opening_value'), in_value: sum('in_value'), out_value: sum('out_value'), closing_value: sum('closing_value'), in: {}, out: {} };
    rows.forEach(r => ['in', 'out'].forEach(side => Object.entries(r[side]).forEach(([x, b]) => { totals[side][x] = round2((totals[side][x] || 0) + b.value); })));
    const byClass = {};
    rows.forEach(r => { const b = (byClass[r.item_class] = byClass[r.item_class] || { item_class: r.item_class, label: r.item_class_label, rows: 0, opening_value: 0, in_value: 0, out_value: 0, closing_value: 0 });
        b.rows++; ['opening_value', 'in_value', 'out_value', 'closing_value'].forEach(x => { b[x] = round2(b[x] + r[x]); }); });
    return { modules_in: sortMods(modulesIn, ORDER_IN), modules_out: sortMods(modulesOut, ORDER_OUT), rows, totals, class_totals: Object.values(byClass), warnings,
        reconciles: rows.every(r => Math.abs(round2(r.opening_value + r.in_value - r.out_value) - r.closing_value) < 0.01) };
}

// ---------------- detail ----------------
async function buildDetail(c, t, f, info, ev) {
    const inPeriod = e => e.date >= f.from && e.date <= f.to && !(e.src === 'stock_transfer');   // company-level transfers net to zero
    const { docOf, serialOf } = await loadDocs(c, t, ev.rows.flatMap(r => r.events.filter(inPeriod)));
    const keep = lineFilter(f);
    const filtered = !!(f.modules.length || f.partyKey || f.serialNo);
    const warnings = [...ev.warnings];
    let items = ev.rows.map(r => {
        const p = info[r.product_id], k = p.factor;
        const m = moveOf(f, p, r.events, f.from, f.to);
        let bal = m.opening.qty;
        const lines = [];
        r.events.forEach(e => {
            if (e.date > f.to) return;
            if (e.date < f.from || e.src === 'stock_transfer') return;
            bal += e.qin - e.qout;
            const doc = docOf(e);
            const line = { ...e, party: doc?.party || null, serial_no: serialOf(e) };
            if (!keep(line)) return;
            const qty = e.qin || e.qout;
            const meta = e.batch_no ? ev.batchMeta[`${r.product_id}|${e.batch_no}`] : null;
            lines.push({
                id: e.id || `${r.key}-opening`, date: e.date, module: SUMMARY_OF[e.src] || e.src,
                module_label: e.src === 'transfer_wh' ? 'Stock Transfer' : MODULE_LABEL[e.src_type] || e.src_type,
                doc_no: doc?.doc_no || '', party_key: doc?.party?.key || null, party_name: doc?.party?.name || '',
                warehouse_name: e.warehouse_id ? ev.whName[e.warehouse_id] || '' : '', batch_no: e.batch_no || '', exp_date: meta?.exp_date || null,
                serial_no: line.serial_no || '', in_qty: round4(e.qin / k), out_qty: round4(e.qout / k),
                rate: round2(e.cost * k), amount: round2(qty * e.cost), balance_qty: filtered ? null : round4(bal / k), narration: e.narration || ''
            });
        });
        const label = [p.product_name, r.batch_no, r.warehouse_id && ev.whName[r.warehouse_id]].filter(Boolean).join(' · ');
        if (m.negative) warnings.push(`${label}: negative stock ${round4(m.closing.qty)} - valued at zero`);
        return {
            ...p, key: r.key, batch_no: r.batch_no, warehouse_name: r.warehouse_id ? ev.whName[r.warehouse_id] || '' : (f.groupBy === 'item_warehouse' ? '(Opening - no warehouse)' : null),
            opening_qty: round4(m.opening.qty / k), opening_value: round2(m.opening.value),
            closing_qty: round4(m.closing.qty / k), closing_value: round2(m.closing.value),
            closing_rate: m.closing.qty > 1e-9 ? round2(m.closing.value / (m.closing.qty / k)) : 0,
            in_qty: round4(lines.reduce((s, l) => s + l.in_qty, 0)), out_qty: round4(lines.reduce((s, l) => s + l.out_qty, 0)),
            in_amount: round2(lines.reduce((s, l) => s + (l.in_qty ? l.amount : 0), 0)), out_amount: round2(lines.reduce((s, l) => s + (l.out_qty ? l.amount : 0), 0)),
            _closing_base: m.closing.qty, lines
        };
    });
    items = items.filter(i => filtered ? i.lines.length : (!f.hideZero || i.opening_qty || i.lines.length || i.closing_qty));
    items = items.filter(i => statusOk(f, i._closing_base, i.minimum_stock));
    items.forEach(i => delete i._closing_base);
    items.sort((a, b) => a.product_name.localeCompare(b.product_name) || String(a.batch_no || a.warehouse_name || '').localeCompare(String(b.batch_no || b.warehouse_name || '')));
    const sum = key => round2(items.reduce((s, i) => s + i[key], 0));
    return { items, filtered, totals: { opening_value: sum('opening_value'), closing_value: sum('closing_value'), in_amount: sum('in_amount'), out_amount: sum('out_amount'),
        lines: items.reduce((s, i) => s + i.lines.length, 0) }, warnings };
}

// ---------------- party-wise ----------------
async function buildParty(c, t, f, info, ev) {
    const events = ev.rows.flatMap(r => r.events.filter(e => e.date >= f.from && e.date <= f.to && SOURCES[e.src_type]?.party).map(e => ({ ...e, product_id: r.product_id })));
    const { docOf, serialOf } = await loadDocs(c, t, events);
    const keep = lineFilter(f);
    const cols = ['purchase', 'purchase_return', 'sales', 'sales_return'];
    const map = new Map();
    events.forEach(e => {
        const doc = docOf(e);
        const line = { ...e, party: doc?.party || null, serial_no: serialOf(e) };
        if (!keep(line)) return;
        const p = info[e.product_id], k = p.factor, col = SUMMARY_OF[e.src];
        const partyKey = line.party?.key || '-';
        const key = `${partyKey}|${e.product_id}`;
        if (!map.has(key)) map.set(key, { ...p, key, party_key: partyKey, party_name: line.party?.name || '(No party)', docs: new Set(),
            ...Object.fromEntries(cols.flatMap(x => [[`${x}_qty`, 0], [`${x}_amount`, 0]])) });
        const row = map.get(key);
        row[`${col}_qty`] += (e.qin || e.qout) / k;
        row[`${col}_amount`] += (e.qin || e.qout) * e.cost;
        if (doc?.doc_no) row.docs.add(doc.doc_no);
    });
    const rows = [...map.values()].map(r => {
        cols.forEach(x => { r[`${x}_qty`] = round4(r[`${x}_qty`]); r[`${x}_amount`] = round2(r[`${x}_amount`]); });
        r.net_qty = round4(r.purchase_qty - r.purchase_return_qty - r.sales_qty + r.sales_return_qty);
        r.purchase_rate = r.purchase_qty ? round2(r.purchase_amount / r.purchase_qty) : 0;
        r.sales_rate = r.sales_qty ? round2(r.sales_amount / r.sales_qty) : 0;
        r.doc_count = r.docs.size; delete r.docs;
        return r;
    }).sort((a, b) => a.party_name.localeCompare(b.party_name) || a.product_name.localeCompare(b.product_name));
    const totals = Object.fromEntries(cols.map(x => [`${x}_amount`, round2(rows.reduce((s, r) => s + r[`${x}_amount`], 0))]));
    return { rows, totals, warnings: ev.warnings };
}

// ---------------- opening only ----------------
// basis 'entry' - what Product Opening Entry holds (qty / rate / value, its
//                 batches with mfg / expiry, its serial numbers)
// basis 'as_on' - stock on hand at the start of From, valued by the method
async function buildOpening(c, t, f, info, products, ev) {
    const warnings = [...ev.warnings];
    let rows = [];
    if (f.openingBasis === 'as_on') {
        rows = ev.rows.map(r => {
            const p = info[r.product_id], k = p.factor;
            const m = moveOf(f, p, r.events, f.from, f.from);
            const meta = r.batch_no ? ev.batchMeta[`${r.product_id}|${r.batch_no}`] : null;
            return { ...p, key: r.key, batch_no: r.batch_no, mfg_date: meta?.mfg_date || null, exp_date: meta?.exp_date || null,
                warehouse_name: r.warehouse_id ? ev.whName[r.warehouse_id] || '' : (f.groupBy === 'item_warehouse' ? '(Opening - no warehouse)' : null),
                qty: round4(m.opening.qty / k), rate: m.opening.qty > 1e-9 ? round2(m.opening.value / (m.opening.qty / k)) : 0, value: round2(m.opening.value),
                serial_nos: [], _base: m.opening.qty };
        });
    } else {
        if (f.warehouseId || f.groupBy === 'item_warehouse') warnings.push('Product Opening Entry is not kept by warehouse - shown by item.');
        const serials = products.length ? await inChunks(products.map(p => p.id), async ids => {
            const { data, error } = await c.from('product_serial_records').select('product_id, serial_no, status, warranty_expiry_date, is_active').eq('tenant_id', t).in('product_id', ids);
            if (error) throw error; return data || [];
        }) : [];
        const serialsOf = {};
        serials.filter(s => s.is_active !== false && (!f.serialNo || String(s.serial_no).toLowerCase().includes(f.serialNo)))
            .forEach(s => (serialsOf[s.product_id] = serialsOf[s.product_id] || []).push({ serial_no: s.serial_no, status: s.status, warranty_expiry_date: s.warranty_expiry_date }));
        Object.values(serialsOf).forEach(l => l.sort((a, b) => String(a.serial_no).localeCompare(String(b.serial_no))));
        const byBatch = f.groupBy === 'item_batch' || !!f.batchNo;
        const batchOk = b => !f.batchNo || String(b || '').toLowerCase() === f.batchNo;
        products.forEach(p => {
            const i = info[p.id], k = i.factor;
            const list = serialsOf[p.id] || [];
            if (f.serialNo && !list.length) return;
            let first = true;
            const push = (key, batch, qty, rate, value, meta) => {
                rows.push({ ...i, key, batch_no: batch, mfg_date: meta?.mfg_date || null, exp_date: meta?.exp_date || null, warehouse_name: null,
                    qty: round4(qty / k), rate: round2(rate * k), value: round2(value), serial_nos: first ? list : [], _base: qty });
                first = false;
            };
            const total = Number(p.opening_qty) || 0, rate = Number(p.opening_rate) || 0;
            if (!byBatch) { push(p.id, null, total, rate, Number(p.opening_value) || total * rate, null); return; }
            const pb = ev.openingBatches[p.id] || [];
            let used = 0;
            pb.forEach(b => { used += Number(b.qty); if (batchOk(b.batch_no)) push(`${p.id}|${b.batch_no}`, b.batch_no, Number(b.qty), Number(b.rate) || 0, Number(b.qty) * (Number(b.rate) || 0), b); });
            const rest = round4(total - used);
            if (!f.batchNo && (rest > 0 || !pb.length)) push(`${p.id}|`, '', Math.max(rest, 0), rate, Math.max(rest, 0) * rate, null);
        });
    }
    if (f.hideZero) rows = rows.filter(r => r.qty || r.serial_nos.length);
    rows = rows.filter(r => statusOk(f, r._base, r.minimum_stock));
    rows.forEach(r => { r.serial_count = r.serial_nos.length; delete r._base; });
    rows.sort((a, b) => a.product_name.localeCompare(b.product_name) || String(a.batch_no || a.warehouse_name || '').localeCompare(String(b.batch_no || b.warehouse_name || '')));
    const byClass = {};
    rows.forEach(r => { const b = (byClass[r.item_class] = byClass[r.item_class] || { item_class: r.item_class, label: r.item_class_label, rows: 0, value: 0 }); b.rows++; b.value = round2(b.value + r.value); });
    return { basis: f.openingBasis, opening_date: f.openingBasis === 'as_on' ? f.from : (ev.openingDay === '0000-01-01' ? null : ev.openingDay),
        rows, totals: { value: round2(rows.reduce((s, r) => s + r.value, 0)), serials: rows.reduce((s, r) => s + r.serial_count, 0) },
        class_totals: Object.values(byClass), warnings };
}

async function stockReport(c, t, query) {
    const f = parseQuery(query);
    f.cs = await costingSettings(c, t);
    const { products, info } = await loadProducts(c, t, f);
    const ev = await loadEvents(c, t, f, products);
    const base = { mode: f.mode, from: f.from, to: f.to, method: f.method, method_label: METHODS[f.method], group_by: f.groupBy,
        display_unit: f.displayUnitId ? true : false, warehouse_view: ev.byWh };
    if (f.mode === 'detail') return { ...base, ...(await buildDetail(c, t, f, info, ev)) };
    if (f.mode === 'party') return { ...base, ...(await buildParty(c, t, f, info, ev)) };
    if (f.mode === 'opening') return { ...base, ...(await buildOpening(c, t, f, info, products, ev)) };
    return { ...base, ...buildSummary(f, info, ev) };
}

// Filter choices the report screen needs beyond the plain masters.
async function stockReportMeta(c, t) {
    const parties = new Map();
    for (const s of Object.values(SOURCES)) {
        if (!s.party) continue;
        const rows = await fetchAll(() => c.from(s.header).select(`id, ${PARTY_COLS[s.party]}`).eq('tenant_id', t).order('id'));
        rows.forEach(h => {
            const p = partyOf(h, s.party); if (!p) return;
            if (!parties.has(p.key)) parties.set(p.key, { ...p, side: s.party });
            else if (parties.get(p.key).side !== s.party) parties.get(p.key).side = 'both';
        });
    }
    const list = [...parties.values()];
    // One entry per party ledger, whatever sub-ledger a document used.
    list.forEach(p => { if (p.sub && p.name) p.name = p.name.slice(0, -p.sub.length); p.sub = ''; });
    await fillLedgerNames(c, t, list);
    return {
        item_types: Object.entries(ITEM_TYPE_LABEL).map(([key, label]) => ({ key, label, item_class: CLASS_OF[key] })),
        item_classes: Object.entries(CLASS_LABEL).map(([key, label]) => ({ key, label })),
        modules: Object.entries(SUMMARY_LABEL).filter(([k]) => k !== 'opening').map(([key, label]) => ({ key, label })),
        methods: Object.entries(METHODS).map(([key, label]) => ({ key, label })),
        parties: list.map(p => ({ key: p.key, name: p.name, side: p.side })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
    };
}

module.exports = { stockReport, stockReportMeta, parseQuery, loadProducts, loadEvents, statusOk };
