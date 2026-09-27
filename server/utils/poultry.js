// =============================================
// utils/poultry.js
// Poultry (broiler) management - sheds, batches (flocks), daily log
// (mortality, culls, weight, feed / medicine / vaccine used), lifting
// (birds out for sale), batch close, KPIs and profitability; plus the
// shared settings, item roles and cost-center / stock helpers used by the
// hatchery (utils/hatchery.js).
//
// Nothing is posted outside the normal documents (see database/125):
//   stock   -> Stock Adjustments made and posted by the same functions as
//              the Stock Adjustment screen (routes/stockAdjustmentRoutes)
//   sales   -> ordinary Sales Bills (a draft can be made from a lifting)
//   costs   -> expenses booked with the batch / shed Cost Center
// KPIs follow the usual broiler-integrator formulas:
//   livability % = (placed - dead - culled) / placed x 100
//   FCR          = feed kg / live kg produced (lifted + still in shed)
//   EPEF         = livability % x avg weight kg / (age days x FCR) x 100
// =============================================
const stockAcc = require('./stockAccounting');
const { toBaseUnitQty } = require('./unitConversion');

const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const round3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
const UUID = /^[0-9a-f-]{36}$/i;
const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const d2n = s => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((d2n(b) - d2n(a)) / DAY);
const iso = n => new Date(n).toISOString().slice(0, 10);
const ROLES = ['chick', 'feed', 'medicine', 'vaccine', 'litter', 'other', 'live_bird', 'hatching_egg', 'table_egg', 'cull_bird'];
const CONSUMABLE = ['chick', 'feed', 'medicine', 'vaccine', 'litter', 'other'];

async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

// ---------------------------------------------------------------- features
async function features(c, t) {
    const { data } = await c.from('system_control_settings').select('business_nature, poultry_features').eq('tenant_id', t).maybeSingle();
    const nature = data?.business_nature || 'trading';
    const pf = data?.poultry_features || {};
    const on = nature === 'poultry';
    return { business_nature: nature, poultry: { enabled: on, broiler: on && pf.broiler !== false, hatchery: on && !!pf.hatchery } };
}
async function requireFeature(c, t, part) {
    const f = await features(c, t);
    if (!f.poultry.enabled) throw httpError('Poultry is off - choose Business Nature "Poultry & Hatchery" in System Control', 403);
    if (part && !f.poultry[part]) throw httpError(`${part === 'hatchery' ? 'Hatchery' : 'Broiler'} management is off in System Control > Business Nature`, 403);
    return f;
}

// ---------------------------------------------------------------- settings & items
async function getSettings(c, t) {
    const { data } = await c.from('poultry_settings').select('*').eq('tenant_id', t).maybeSingle();
    const D = { tenant_id: t, consumption_ledger_id: null, transfer_ledger_id: null, default_warehouse_id: null, live_bird_product_id: null,
        live_bird_unit: 'kg', brooding_days: 14, grower_days: 28, cycle_days: 45, incubation_days: 21, candling_day: 10, transfer_day: 18 };
    if (!data) return D;
    Object.keys(D).forEach(k => { if (data[k] === null || data[k] === undefined) data[k] = D[k]; });
    return data;
}
async function saveSettings(c, t, userId, b) {
    const row = { tenant_id: t, updated_by: userId, updated_at: new Date().toISOString() };
    ['consumption_ledger_id', 'transfer_ledger_id', 'default_warehouse_id', 'live_bird_product_id'].forEach(k => { if (k in b) row[k] = b[k] && UUID.test(b[k]) ? b[k] : null; });
    if ('live_bird_unit' in b) row.live_bird_unit = b.live_bird_unit === 'bird' ? 'bird' : 'kg';
    [['brooding_days', 1, 60], ['grower_days', 1, 90], ['cycle_days', 20, 90], ['incubation_days', 15, 35], ['candling_day', 3, 20], ['transfer_day', 10, 30]].forEach(([k, lo, hi]) => {
        if (k in b) row[k] = Math.min(hi, Math.max(lo, parseInt(b[k], 10) || lo));
    });
    if (row.consumption_ledger_id || row.transfer_ledger_id) {
        const cls = await stockAcc.classifyLedgers(c, t, [row.consumption_ledger_id, row.transfer_ledger_id]);
        for (const [k, label] of [['consumption_ledger_id', 'Consumption'], ['transfer_ledger_id', 'Production transfer']]) {
            const l = cls[row[k]];
            if (l && (l.inventory || ['assets', 'liabilities', 'equity'].includes(l.section))) throw httpError(`${label} ledger "${l.name}" must be an income / expense ledger, not a ${stockAcc.describe(l)} ledger`);
        }
    }
    const { data: ex } = await c.from('poultry_settings').select('tenant_id').eq('tenant_id', t).maybeSingle();
    const { error } = ex ? await c.from('poultry_settings').update(row).eq('tenant_id', t) : await c.from('poultry_settings').insert(row);
    if (error) throw error;
    return getSettings(c, t);
}
async function listItems(c, t) {
    const rows = await fetchAll(() => c.from('poultry_items').select('*').eq('tenant_id', t).order('id'));
    const ids = rows.map(r => r.product_id);
    const { data: ps } = ids.length ? await c.from('products').select('id, product_name, product_code, base_unit_id').in('id', ids) : { data: [] };
    const P = Object.fromEntries((ps || []).map(p => [p.id, p]));
    return rows.map(r => ({ ...r, product_name: P[r.product_id]?.product_name || '?', product_code: P[r.product_id]?.product_code || '' }));
}
async function saveItems(c, t, items) {
    if (!Array.isArray(items)) throw httpError('items must be a list');
    for (const it of items) {
        if (!UUID.test(it.product_id || '')) throw httpError('Choose a product');
        if (!ROLES.includes(it.role)) throw httpError(`Unknown role ${it.role}`);
    }
    const { error: e1 } = await c.from('poultry_items').delete().eq('tenant_id', t);
    if (e1) throw e1;
    const seen = new Set();
    const rows = items.filter(it => !seen.has(it.product_id) && seen.add(it.product_id))
        .map(it => ({ tenant_id: t, product_id: it.product_id, role: it.role, kg_per_unit: Math.max(0, Number(it.kg_per_unit) || (it.role === 'feed' ? 1 : 0)) }));
    if (rows.length) { const { error } = await c.from('poultry_items').insert(rows); if (error) throw error; }
    return listItems(c, t);
}
async function itemMap(c, t) {
    const rows = await fetchAll(() => c.from('poultry_items').select('product_id, role, kg_per_unit').eq('tenant_id', t).order('id'));
    return Object.fromEntries(rows.map(r => [r.product_id, r]));
}

// ---------------------------------------------------------------- cost centers
async function makeCostCenter(c, t, code, name, userId) {
    const cc = String(code).slice(0, 50);
    const { data: ex } = await c.from('cost_centers').select('id').eq('tenant_id', t).eq('cost_center_code', cc).maybeSingle();
    if (ex) return ex.id;
    const { data: co } = await c.from('company_profile').select('id').eq('tenant_id', t).maybeSingle();
    const { data, error } = await c.from('cost_centers').insert({ tenant_id: t, company_id: co?.id || null, cost_center_code: cc, cost_center_name: String(name).slice(0, 200),
        cost_center_short_name: cc.slice(0, 50), cost_center_type: 'poultry', is_active: true, created_by: userId || null }).select('id').single();
    if (error) throw error;
    return data.id;
}

// ---------------------------------------------------------------- stock (through Stock Adjustments)
const SA = () => require('../routes/stockAdjustmentRoutes');
/** Rate per the line's unit from the current stock cost. */
async function costRate(c, t, productId, uomId, date) {
    const cost = await stockAcc.currentCost(c, t, productId, date);
    const factor = uomId ? await toBaseUnitQty(c, productId, 1, uomId) : 1;
    return Number(cost.rate || 0) * (Number(factor) || 1);
}
/**
 * Make and post one Stock Adjustment. direction 'out' (consumption, Dr the
 * consumption / transfer ledger) or 'in' (production, Cr the transfer ledger).
 * lines: [{ product_id, qty, uom_id?, warehouse_id?, rate? }] - rate defaults to current cost.
 */
async function postAdjustment(c, t, userId, { date, direction, lines, warehouse_id, cost_center_id, narration, ledger_id, override_negative }) {
    const S = await getSettings(c, t);
    const wh = warehouse_id || S.default_warehouse_id || null;
    const details = [];
    for (const l of lines) {
        const rate = l.rate !== undefined && l.rate !== null ? Number(l.rate) : await costRate(c, t, l.product_id, l.uom_id, date);
        details.push({ product_id: l.product_id, qty: Number(l.qty), uom_id: l.uom_id || null, warehouse_id: l.warehouse_id || wh, direction,
            rate: Math.round(rate * 10000) / 10000, line_reason: direction === 'out' ? 'consumption' : 'production', narration: l.narration || null });
    }
    if (details.some(d => !d.warehouse_id)) throw httpError('Choose a warehouse (store) - set a default one in Poultry Settings or on the shed');
    const ledger = ledger_id || (direction === 'out' ? S.consumption_ledger_id : S.transfer_ledger_id) || null;
    if (!ledger && (await stockAcc.adjustmentAccounts(c, t)).posts) {
        throw httpError(`Stock Adjustment GL posting is on - set the ${direction === 'out' ? 'Consumption' : 'Production transfer'} ledger in Poultry Settings first, so poultry use is not booked as stock shortage`);
    }
    const body = { doc_date: date, reason: direction === 'out' ? 'consumption' : 'production', warehouse_id: wh, cost_center_id: cost_center_id || null,
        narration, source_module: 'poultry', details, ...(direction === 'out' ? { loss_ledger_id: ledger } : { gain_ledger_id: ledger }) };
    const doc = await SA().createAdjustment(c, t, userId, body);
    try {
        const out = await SA().setAdjustmentStatus(c, t, userId, doc.id, { status: 'posted', override_negative_stock_warning: !!override_negative }, { forceOwnLedgers: !!ledger });
        const { data: det } = await c.from('stock_adjustment_details').select('product_id, qty, uom_id, rate, amount').eq('adjustment_id', doc.id).order('display_order');
        return { id: doc.id, doc_no: doc.doc_no, amount: round2(direction === 'out' ? doc.total_out_amount : doc.total_in_amount), lines: det || [], warnings: out.warnings };
    } catch (e) {
        await c.from('stock_adjustments').delete().eq('id', doc.id).eq('status', 'draft');   // nothing half-made stays behind
        throw e;
    }
}
async function cancelAdjustment(c, t, userId, id, reason) {
    if (!id) return;
    const { data } = await c.from('stock_adjustments').select('id, status').eq('id', id).eq('tenant_id', t).maybeSingle();
    if (!data || data.status === 'cancelled') return;
    if (data.status === 'draft') { await c.from('stock_adjustments').delete().eq('id', id); return; }
    await SA().setAdjustmentStatus(c, t, userId, id, { status: 'cancelled', cancellation_reason: reason || 'Changed in Poultry' });
}

// ---------------------------------------------------------------- sheds
async function listSheds(c, t, q = {}) {
    let b = c.from('poultry_sheds').select('*').eq('tenant_id', t);
    if (q.shed_type) b = b.eq('shed_type', q.shed_type);
    const { data, error } = await b.order('shed_code');
    if (error) throw error;
    const { data: active } = await c.from('poultry_batches').select('id, shed_id, batch_no, placement_date, chicks_placed, free_chicks').eq('tenant_id', t).eq('status', 'active');
    const A = Object.fromEntries((active || []).map(b2 => [b2.shed_id, b2]));
    return (data || []).map(s => ({ ...s, active_batch: A[s.id] || null }));
}
async function saveShed(c, t, userId, b, id) {
    const row = {};
    ['shed_code', 'shed_name', 'farm_name', 'location', 'supervisor', 'remarks'].forEach(k => { if (k in b) row[k] = b[k] ? String(b[k]).trim() : null; });
    if ('shed_type' in b) row.shed_type = b.shed_type === 'hatchery' ? 'hatchery' : 'broiler';
    ['capacity'].forEach(k => { if (k in b) row[k] = b[k] === '' || b[k] === null ? null : Math.max(0, parseInt(b[k], 10) || 0); });
    if ('area_sqft' in b) row.area_sqft = b.area_sqft === '' || b.area_sqft === null ? null : Number(b.area_sqft) || 0;
    if ('warehouse_id' in b) row.warehouse_id = b.warehouse_id && UUID.test(b.warehouse_id) ? b.warehouse_id : null;
    if ('is_active' in b) row.is_active = !!b.is_active;
    if (!id) {
        if (!row.shed_code || !row.shed_name) throw httpError('Shed code and name are required');
        row.shed_type = row.shed_type || 'broiler';
        if (row.is_active === undefined) row.is_active = true;
        row.cost_center_id = await makeCostCenter(c, t, `SHD-${row.shed_code}`, `Shed ${row.shed_name}`, userId);
        const { data, error } = await c.from('poultry_sheds').insert({ tenant_id: t, ...row, created_by: userId, updated_by: userId }).select().single();
        if (error) throw /unique|duplicate/i.test(error.message) ? httpError('This shed code is already used') : error;
        return data;
    }
    if ('shed_code' in row) delete row.shed_code;              // the code names the cost center
    const { data, error } = await c.from('poultry_sheds').update({ ...row, updated_by: userId, updated_at: new Date().toISOString() }).eq('tenant_id', t).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

// ---------------------------------------------------------------- batches
async function nextSerial(c, t, table) {
    const { data } = await c.from(table).select('serial_no').eq('tenant_id', t).order('serial_no', { ascending: false }).limit(1);
    return ((data && data[0] && data[0].serial_no) || 0) + 1;
}
async function loadBatch(c, t, id) {
    if (!UUID.test(String(id))) throw httpError('Batch not found', 404);
    const { data, error } = await c.from('poultry_batches').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw httpError('Batch not found', 404);
    return data;
}
async function counts(c, t, batchId) {
    const [{ data: logs }, { data: lifts }] = await Promise.all([
        c.from('poultry_daily_logs').select('log_date, mortality, culls').eq('batch_id', batchId),
        c.from('poultry_liftings').select('lift_date, birds, weight_kg').eq('batch_id', batchId)
    ]);
    const dead = (logs || []).reduce((s, l) => s + Number(l.mortality || 0), 0), culls = (logs || []).reduce((s, l) => s + Number(l.culls || 0), 0);
    const lifted = (lifts || []).reduce((s, l) => s + Number(l.birds || 0), 0);
    return { dead, culls, lifted, logs: logs || [], lifts: lifts || [] };
}

/** a hatched hatch and how many of its A-grade chicks are not yet placed in a broiler lot */
async function hatchAvailability(c, t, hatchId) {
    if (!UUID.test(String(hatchId))) throw httpError('Hatch not found', 404);
    const { data: h } = await c.from('poultry_hatches').select('*').eq('tenant_id', t).eq('id', hatchId).maybeSingle();
    if (!h) throw httpError('Hatch not found', 404);
    if (h.status !== 'hatched') throw httpError(`Hatch ${h.hatch_no} is not hatched yet`);
    const { data: lots } = await c.from('poultry_batches').select('chicks_placed, free_chicks').eq('tenant_id', t).eq('source_hatch_id', h.id);
    const placed = (lots || []).reduce((s, l) => s + Number(l.chicks_placed || 0) + Number(l.free_chicks || 0), 0);
    let chickCost = null;
    if (h.output_adjustment_id) {
        const { data: adj } = await c.from('stock_adjustments').select('status, total_in_amount').eq('id', h.output_adjustment_id).maybeSingle();
        const { data: lines } = await c.from('stock_adjustment_details').select('product_id, qty, rate, amount').eq('adjustment_id', h.output_adjustment_id);
        const l = (lines || []).find(x => x.product_id === h.chick_product_id);
        if (adj && adj.status === 'posted' && l) chickCost = Number(l.rate) || (Number(l.qty) ? round2(Number(l.amount) / Number(l.qty)) : null);
    }
    if (chickCost === null) chickCost = (await require('./hatchery').detail(c, t, h.id)).cost?.chick_cost ?? null; // no stock entry: the computed cost
    return { ...h, placed_in_lots: placed, chicks_available: Math.max(0, Number(h.chicks_a || 0) - placed), chick_cost: chickCost };
}

/** a posted Purchase Bill's day-old chicks (products with the Chick role) and how many are not yet in a lot */
async function purchaseAvailability(c, t, billId) {
    if (!UUID.test(String(billId))) throw httpError('Purchase bill not found', 404);
    const { data: bill } = await c.from('purchase_bills').select('id, doc_no, doc_date, status, vendor_ledger_id, vendor_name_snapshot, cash_vendor_name, warehouse_id').eq('tenant_id', t).eq('id', billId).maybeSingle();
    if (!bill) throw httpError('Purchase bill not found', 404);
    if (bill.status !== 'posted') throw httpError(`Purchase bill ${bill.doc_no} is not posted`);
    const roles = await itemMap(c, t);
    const { data: det } = await c.from('purchase_bill_details').select('product_id, product_name_snapshot, qty, uom_id, free_qty, free_uom_id, amount, tax_amount').eq('bill_id', bill.id);
    const lines = [];
    for (const d of (det || []).filter(x => roles[x.product_id]?.role === 'chick')) {
        const q = await toBaseUnitQty(c, d.product_id, Number(d.qty) || 0, d.uom_id);
        const f = Number(d.free_qty) ? await toBaseUnitQty(c, d.product_id, Number(d.free_qty), d.free_uom_id || d.uom_id) : 0;
        const chicks = Math.round(q + f), value = round2(Number(d.amount || 0) - Number(d.tax_amount || 0));
        lines.push({ product_id: d.product_id, product_name: d.product_name_snapshot || '', chicks, paid: Math.round(q), free: Math.round(f), value, cost_per_chick: chicks ? round2(value / chicks) : 0 });
    }
    if (!lines.length) throw httpError(`Purchase bill ${bill.doc_no} has no chick item (set the Chick role in Poultry Setup)`);
    const unnamed = lines.filter(l => !l.product_name).map(l => l.product_id);
    if (unnamed.length) {
        const { data: ps } = await c.from('products').select('id, product_name').in('id', unnamed);
        lines.forEach(l => { if (!l.product_name) l.product_name = (ps || []).find(p => p.id === l.product_id)?.product_name || ''; });
    }
    const total = lines.reduce((x, l) => x + l.chicks, 0), value = round2(lines.reduce((x, l) => x + l.value, 0));
    const { data: lots } = await c.from('poultry_batches').select('chicks_placed, free_chicks').eq('tenant_id', t).eq('source_purchase_bill_id', bill.id);
    const placed = (lots || []).reduce((x, l) => x + Number(l.chicks_placed || 0) + Number(l.free_chicks || 0), 0);
    let vendorName = bill.vendor_name_snapshot || bill.cash_vendor_name || '';
    if (!vendorName && bill.vendor_ledger_id) vendorName = (await c.from('ledger_accounts').select('account_name').eq('id', bill.vendor_ledger_id).maybeSingle()).data?.account_name || '';
    return { ...bill, vendor_name: vendorName, lines, chicks_total: total, placed_in_lots: placed, chicks_available: Math.max(0, total - placed), cost_per_chick: total ? round2(value / total) : 0 };
}

/** where chicks for a new lot can come from: own hatches and chick purchases that still have chicks left */
async function chickSources(c, t, q = {}) {
    const since = q.since || iso(Date.now() - 120 * DAY);
    const out = { purchases: [], hatches: [] };
    const roles = await itemMap(c, t);
    const chickIds = Object.values(roles).filter(r => r.role === 'chick').map(r => r.product_id);
    if (chickIds.length) {
        const { data: det } = await c.from('purchase_bill_details').select('bill_id').in('product_id', chickIds);
        const ids = [...new Set((det || []).map(d => d.bill_id))];
        const { data: bills } = ids.length ? await c.from('purchase_bills').select('id, doc_date, status').eq('tenant_id', t).in('id', ids).gte('doc_date', since) : { data: [] };
        for (const b of (bills || []).filter(x => x.status === 'posted')) {
            const a = await purchaseAvailability(c, t, b.id).catch(() => null);
            if (a && a.chicks_available > 0) out.purchases.push({ id: a.id, doc_no: a.doc_no, doc_date: a.doc_date, vendor_name: a.vendor_name, vendor_ledger_id: a.vendor_ledger_id,
                chicks_total: a.chicks_total, chicks_available: a.chicks_available, cost_per_chick: a.cost_per_chick, product_id: a.lines[0].product_id, product_name: a.lines[0].product_name });
        }
        out.purchases.sort((x, y) => String(y.doc_date).localeCompare(String(x.doc_date)));
    }
    const f = await features(c, t);
    if (f.poultry.hatchery) {
        const { data: hs } = await c.from('poultry_hatches').select('id').eq('tenant_id', t).eq('status', 'hatched').gte('hatch_date', since);
        for (const h of hs || []) {
            const a = await hatchAvailability(c, t, h.id);
            if (a.chicks_available > 0) out.hatches.push({ id: a.id, hatch_no: a.hatch_no, hatch_date: a.hatch_date, chicks_a: a.chicks_a, chicks_available: a.chicks_available, cost_per_chick: a.chick_cost, product_id: a.chick_product_id });
        }
    }
    return out;
}

/**
 * Place chicks in several sheds at once - one lot per shed - from one source:
 *   source 'purchase' (a Purchase Bill), 'hatch' (own hatch), or 'stock' (chick item from stock / cost by hand)
 * rows: [{ shed_id, chicks_placed, free_chicks, breed, target_weight_kg, remarks }]; all lots or none are made.
 */
async function placeLots(c, t, userId, b) {
    await requireFeature(c, t, 'broiler');
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter(r => r && r.shed_id && parseInt(r.chicks_placed, 10) > 0);
    if (!rows.length) throw httpError('Enter the chicks for at least one shed');
    if (new Set(rows.map(r => r.shed_id)).size !== rows.length) throw httpError('A shed is chosen twice - one lot per shed');
    const want = rows.reduce((x, r) => x + parseInt(r.chicks_placed, 10) + (parseInt(r.free_chicks, 10) || 0), 0);
    const common = { placement_date: b.placement_date, breed: b.breed || null, target_weight_kg: b.target_weight_kg || null, override_negative_stock: !!b.override_negative_stock };
    if (b.source === 'purchase') {
        const a = await purchaseAvailability(c, t, b.source_id);
        if (want > a.chicks_available) throw httpError(`Only ${a.chicks_available} chicks of purchase ${a.doc_no} are left to place (asked ${want})`);
        Object.assign(common, { source_purchase_bill_id: a.id, warehouse_id: b.warehouse_id || a.warehouse_id || undefined });
    } else if (b.source === 'hatch') {
        const a = await hatchAvailability(c, t, b.source_id);
        if (want > a.chicks_available) throw httpError(`Only ${a.chicks_available} chicks of hatch ${a.hatch_no} are left to place (asked ${want})`);
        Object.assign(common, { source_hatch_id: a.id, warehouse_id: b.warehouse_id || a.output_warehouse_id || undefined });
    } else {
        Object.assign(common, { chick_product_id: b.chick_product_id || null, chick_rate: b.chick_rate, warehouse_id: b.warehouse_id || undefined,
            chick_source: b.chick_source || null, source_vendor_ledger_id: b.vendor_ledger_id || null });
    }
    const made = [];
    try {
        for (const r of rows) {
            const perChickManual = b.source !== 'purchase' && b.source !== 'hatch' && !b.chick_product_id && b.chick_cost_per_bird ? round2(Number(b.chick_cost_per_bird) * parseInt(r.chicks_placed, 10)) : undefined;
            made.push(await createBatch(c, t, userId, { ...common, shed_id: r.shed_id, chicks_placed: r.chicks_placed, free_chicks: r.free_chicks, breed: r.breed || common.breed,
                target_weight_kg: r.target_weight_kg || common.target_weight_kg, remarks: r.remarks || null, ...(perChickManual !== undefined ? { chick_cost_manual: perChickManual } : {}) }));
        }
    } catch (e) {
        for (const lot of made) { try { await deleteBatch(c, t, userId, lot.id); } catch { /* keep going */ } }
        throw e;
    }
    return { lots: made.map(l => ({ id: l.id, batch_no: l.batch_no, shed_name: l.shed_name, placed: l.chicks_placed + l.free_chicks })), warnings: made.flatMap(l => l.warnings || []) };
}

async function createBatch(c, t, userId, b) {
    await requireFeature(c, t, 'broiler');
    if (!UUID.test(b.shed_id || '')) throw httpError('Choose the shed');
    const { data: shed } = await c.from('poultry_sheds').select('*').eq('tenant_id', t).eq('id', b.shed_id).maybeSingle();
    if (!shed || shed.shed_type !== 'broiler') throw httpError('Choose a broiler shed');
    if (!shed.is_active) throw httpError('This shed is inactive');
    const placed = parseInt(b.chicks_placed, 10), free = Math.max(0, parseInt(b.free_chicks, 10) || 0);
    if (!(placed > 0)) throw httpError('Chicks placed must be more than zero');
    const date = String(b.placement_date || today()).slice(0, 10);
    if (date > today()) throw httpError('Placement date cannot be in the future');
    const { data: busy } = await c.from('poultry_batches').select('batch_no').eq('tenant_id', t).eq('shed_id', shed.id).eq('status', 'active');
    if ((busy || []).length) throw httpError(`Shed ${shed.shed_name} still has batch ${busy[0].batch_no} running - close it first (all-in all-out)`);
    if (shed.capacity && placed + free > shed.capacity * 1.1) throw httpError(`${placed + free} chicks is more than the shed capacity (${shed.capacity})`);
    // chicks from the company's own hatch: that hatch's chick product, at its cost per chick
    let hatch = null;
    if (b.source_hatch_id) {
        hatch = await hatchAvailability(c, t, b.source_hatch_id);
        if (placed + free > hatch.chicks_available) throw httpError(`Hatch ${hatch.hatch_no} has only ${hatch.chicks_available} chicks left to place`);
        if (date < String(hatch.hatch_date).slice(0, 10)) throw httpError(`Placement date cannot be before the hatch date (${String(hatch.hatch_date).slice(0, 10)})`);
        if (!b.chick_product_id && hatch.chick_product_id) b.chick_product_id = hatch.chick_product_id;
        if ((b.chick_rate === undefined || b.chick_rate === '') && hatch.chick_cost !== null) b.chick_rate = hatch.chick_cost;
        if (!b.chick_source) b.chick_source = `Own hatch ${hatch.hatch_no}`;
        if (!b.chick_product_id && !b.chick_cost_manual && hatch.chick_cost !== null) b.chick_cost_manual = round2(hatch.chick_cost * placed);
    }
    // chicks bought on a Purchase Bill: that bill's chick item at its cost per chick (bill value without VAT / all chicks incl. free)
    let purchase = null;
    if (b.source_purchase_bill_id) {
        purchase = await purchaseAvailability(c, t, b.source_purchase_bill_id);
        if (placed + free > purchase.chicks_available) throw httpError(`Purchase ${purchase.doc_no} has only ${purchase.chicks_available} chicks left to place`);
        if (date < String(purchase.doc_date).slice(0, 10)) throw httpError(`Placement date cannot be before the purchase date (${String(purchase.doc_date).slice(0, 10)})`);
        const line = purchase.lines.find(l => l.product_id === b.chick_product_id) || purchase.lines[0];
        b.chick_product_id = line.product_id;
        if (b.chick_rate === undefined || b.chick_rate === '' || b.chick_rate === null) b.chick_rate = line.cost_per_chick;
        if (!b.chick_source) b.chick_source = `Purchase ${purchase.doc_no}${purchase.vendor_name ? ` - ${purchase.vendor_name}` : ''}`;
        b.source_vendor_ledger_id = purchase.vendor_ledger_id || b.source_vendor_ledger_id || null;
    }
    const S = await getSettings(c, t);
    const serial = await nextSerial(c, t, 'poultry_batches');
    const batchNo = `B-${String(serial).padStart(4, '0')}`;
    const ccId = await makeCostCenter(c, t, `BAT-${batchNo}`, `Batch ${batchNo} (${shed.shed_name})`, userId);
    let adj = null;
    if (b.chick_product_id) {
        adj = await postAdjustment(c, t, userId, { date, direction: 'out', warehouse_id: b.warehouse_id || shed.warehouse_id, cost_center_id: ccId,
            lines: [{ product_id: b.chick_product_id, qty: placed + free, uom_id: b.chick_uom_id || null, rate: b.chick_rate !== undefined && b.chick_rate !== '' && b.chick_rate !== null ? (b.source_purchase_bill_id ? Number(b.chick_rate) : Number(b.chick_rate) * placed / (placed + free)) : undefined }],
            narration: `Chicks placed - batch ${batchNo}, ${shed.shed_name}`, override_negative: !!b.override_negative_stock });
    }
    const row = { tenant_id: t, serial_no: serial, batch_no: batchNo, shed_id: shed.id, breed: b.breed || null, chick_source: b.chick_source || null, placement_date: date,
        chicks_placed: placed, free_chicks: free, chick_product_id: b.chick_product_id || null, chick_cost_manual: b.chick_product_id ? 0 : round2(b.chick_cost_manual),
        placement_adjustment_id: adj?.id || null, cost_center_id: ccId, target_weight_kg: b.target_weight_kg ? Number(b.target_weight_kg) : null,
        expected_close_date: b.expected_close_date || iso(d2n(date) + (Number(S.cycle_days) || 45) * DAY), source_hatch_id: hatch?.id || null,
        source_purchase_bill_id: purchase?.id || null, source_vendor_ledger_id: b.source_vendor_ledger_id && UUID.test(b.source_vendor_ledger_id) ? b.source_vendor_ledger_id : null,
        remarks: b.remarks || null, status: 'active', created_by: userId, updated_by: userId };
    const { data, error } = await c.from('poultry_batches').insert(row).select().single();
    if (error) { if (adj) await cancelAdjustment(c, t, userId, adj.id, 'Batch not saved'); throw error; }
    return { ...(await batchDetail(c, t, data.id)), warnings: adj?.warnings || [] };
}

async function updateBatch(c, t, userId, id, b) {
    const x = await loadBatch(c, t, id);
    const row = {};
    ['breed', 'chick_source', 'remarks', 'close_notes'].forEach(k => { if (k in b) row[k] = b[k] || null; });
    if ('target_weight_kg' in b) row.target_weight_kg = b.target_weight_kg ? Number(b.target_weight_kg) : null;
    if ('expected_close_date' in b) row.expected_close_date = b.expected_close_date || null;
    if ('chick_cost_manual' in b && !x.placement_adjustment_id) row.chick_cost_manual = round2(b.chick_cost_manual);
    if ('chicks_placed' in b || 'free_chicks' in b) {
        const k = await counts(c, t, id);
        if (k.logs.length || k.lifts.length) throw httpError('Chick numbers cannot change after daily entries or liftings are made');
        const placed = parseInt(b.chicks_placed ?? x.chicks_placed, 10), free = Math.max(0, parseInt(b.free_chicks ?? x.free_chicks, 10) || 0);
        if (!(placed > 0)) throw httpError('Chicks placed must be more than zero');
        if (x.placement_adjustment_id && (placed !== x.chicks_placed || free !== x.free_chicks)) {
            await cancelAdjustment(c, t, userId, x.placement_adjustment_id, 'Chick numbers changed');
            const adj = await postAdjustment(c, t, userId, { date: x.placement_date, direction: 'out', cost_center_id: x.cost_center_id,
                lines: [{ product_id: x.chick_product_id, qty: placed + free }], narration: `Chicks placed - batch ${x.batch_no} (changed)` });
            row.placement_adjustment_id = adj.id;
        }
        Object.assign(row, { chicks_placed: placed, free_chicks: free });
    }
    const { error } = await c.from('poultry_batches').update({ ...row, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    return batchDetail(c, t, id);
}

async function closeBatch(c, t, userId, id, b = {}) {
    const x = await loadBatch(c, t, id);
    if (x.status === 'closed') throw httpError('Batch is already closed');
    const k = await counts(c, t, id);
    const alive = x.chicks_placed + x.free_chicks - k.dead - k.culls - k.lifted;
    const date = String(b.closed_on || today()).slice(0, 10);
    if (alive > 0) {
        if (!b.write_off_remaining) throw httpError(`${alive} birds are still in the shed - lift them, or close with "write off the rest as mortality"`);
        await saveLog(c, t, userId, id, { log_date: date, mortality: alive, mortality_reason: 'Written off at batch close', _append: true });
    }
    const { error } = await c.from('poultry_batches').update({ status: 'closed', closed_on: date, close_notes: b.close_notes || x.close_notes || null, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    return batchDetail(c, t, id);
}
async function reopenBatch(c, t, userId, id) {
    const x = await loadBatch(c, t, id);
    if (x.status !== 'closed') throw httpError('Batch is not closed');
    const { data: busy } = await c.from('poultry_batches').select('batch_no').eq('tenant_id', t).eq('shed_id', x.shed_id).eq('status', 'active');
    if ((busy || []).length) throw httpError(`The shed now runs batch ${busy[0].batch_no}`);
    await c.from('poultry_batches').update({ status: 'active', closed_on: null, updated_by: userId }).eq('id', id);
    return batchDetail(c, t, id);
}
async function deleteBatch(c, t, userId, id) {
    const x = await loadBatch(c, t, id);
    const k = await counts(c, t, id);
    if (k.logs.length || k.lifts.length) throw httpError('Delete its daily entries and liftings first, or close the batch');
    await cancelAdjustment(c, t, userId, x.placement_adjustment_id, `Batch ${x.batch_no} deleted`);
    const { error } = await c.from('poultry_batches').delete().eq('id', id);
    if (error) throw error;
    return { deleted: true };
}

// ---------------------------------------------------------------- daily log
async function saveLog(c, t, userId, batchId, b) {
    const x = await loadBatch(c, t, batchId);
    const date = String(b.log_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError('Choose the date');
    if (date < String(x.placement_date).slice(0, 10)) throw httpError('The date is before the batch was placed');
    if (date > today()) throw httpError('The date cannot be in the future');
    if (x.status === 'closed' && !b._append) throw httpError('The batch is closed - reopen it to change entries');
    const mortality = Math.max(0, parseInt(b.mortality, 10) || 0), culls = Math.max(0, parseInt(b.culls, 10) || 0);
    const { data: old } = await c.from('poultry_daily_logs').select('*').eq('batch_id', batchId).eq('log_date', date).maybeSingle();
    const k = await counts(c, t, batchId);
    const others = k.dead + k.culls - (old ? Number(old.mortality) + Number(old.culls) : 0);
    const addDead = b._append && old ? Number(old.mortality) + mortality : mortality;
    if (others + addDead + culls + k.lifted > x.chicks_placed + x.free_chicks) throw httpError(`Dead + culled + lifted would be more than the ${x.chicks_placed + x.free_chicks} birds placed`);

    const items = b._append ? null : (Array.isArray(b.items) ? b.items : []).filter(i => i && i.product_id && Number(i.qty) > 0);
    const IM = await itemMap(c, t);
    let adjId = old?.consumption_adjustment_id || null, lines = null, warnings = [];
    if (items) {
        const { data: oldItems } = old ? await c.from('poultry_log_items').select('product_id, qty, uom_id, warehouse_id').eq('log_id', old.id) : { data: [] };
        const sig = arr => JSON.stringify((arr || []).map(i => [i.product_id, Number(i.qty), i.uom_id || null, i.warehouse_id || null]).sort());
        if (sig(oldItems) !== sig(items)) {
            if (adjId) { await cancelAdjustment(c, t, userId, adjId, `Daily entry ${x.batch_no} ${date} changed`); adjId = null; }
            if (items.length) {
                const { data: shed } = await c.from('poultry_sheds').select('warehouse_id, shed_name').eq('id', x.shed_id).maybeSingle();
                const adj = await postAdjustment(c, t, userId, { date, direction: 'out', cost_center_id: x.cost_center_id, warehouse_id: shed?.warehouse_id,
                    lines: items.map(i => ({ product_id: i.product_id, qty: Number(i.qty), uom_id: i.uom_id || null, warehouse_id: i.warehouse_id || null })),
                    narration: `Batch ${x.batch_no} day ${daysBetween(x.placement_date, date)} - feed / medicine used (${shed?.shed_name || ''})`, override_negative: !!b.override_negative_stock });
                adjId = adj.id; lines = adj.lines; warnings = adj.warnings;
            } else lines = [];
        }
    }
    const row = { tenant_id: t, batch_id: batchId, log_date: date, mortality: addDead, culls: b._append && old ? Number(old.culls) : culls,
        mortality_reason: b.mortality_reason ?? old?.mortality_reason ?? null, consumption_adjustment_id: adjId, updated_by: userId, updated_at: new Date().toISOString() };
    if (!b._append) {
        ['avg_weight_g', 'water_l', 'temp_min', 'temp_max', 'humidity'].forEach(k2 => { row[k2] = b[k2] === '' || b[k2] === null || b[k2] === undefined ? null : Number(b[k2]); });
        row.remarks = b.remarks || null;
    }
    const saved = old ? await c.from('poultry_daily_logs').update(row).eq('id', old.id).select().single()
        : await c.from('poultry_daily_logs').insert({ ...row, created_by: userId }).select().single();
    if (saved.error) { if (adjId && adjId !== old?.consumption_adjustment_id) await cancelAdjustment(c, t, userId, adjId, 'Daily entry not saved'); throw saved.error; }
    if (lines) {
        await c.from('poultry_log_items').delete().eq('log_id', saved.data.id);
        if (lines.length) {
            const rows = [];
            for (const [i, l] of lines.entries()) {
                const src = items[i] || {};
                const base = await toBaseUnitQty(c, l.product_id, Number(l.qty), l.uom_id);
                const it = IM[l.product_id] || {};
                rows.push({ tenant_id: t, log_id: saved.data.id, product_id: l.product_id, role: it.role || 'other', qty: Number(l.qty), uom_id: l.uom_id || null, warehouse_id: src.warehouse_id || null,
                    rate: Number(l.rate) || 0, amount: round2(l.amount), feed_kg: it.role === 'feed' ? round3(Number(base) * (Number(it.kg_per_unit) || 1)) : 0 });
            }
            const { error } = await c.from('poultry_log_items').insert(rows);
            if (error) throw error;
        }
    }
    return { ...saved.data, warnings };
}
async function deleteLog(c, t, userId, logId) {
    const { data: log } = await c.from('poultry_daily_logs').select('*').eq('tenant_id', t).eq('id', logId).maybeSingle();
    if (!log) throw httpError('Entry not found', 404);
    const x = await loadBatch(c, t, log.batch_id);
    if (x.status === 'closed') throw httpError('The batch is closed - reopen it to change entries');
    await cancelAdjustment(c, t, userId, log.consumption_adjustment_id, `Daily entry ${x.batch_no} ${log.log_date} deleted`);
    const { error } = await c.from('poultry_daily_logs').delete().eq('id', logId);
    if (error) throw error;
    return { deleted: true };
}

// ---------------------------------------------------------------- lifting (birds out)
const invoke = async (handler, req, body) => {
    let code = 200, payload = null;
    const res = { status(x) { code = x; return this; }, json(x) { payload = x; return this; } };
    await handler({ ...req, body, params: {}, query: {} }, res);
    return { code, ...(payload || {}) };
};
async function addLifting(c, t, userId, batchId, b, req) {
    const x = await loadBatch(c, t, batchId);
    if (x.status === 'closed') throw httpError('The batch is closed');
    const date = String(b.lift_date || today()).slice(0, 10);
    if (date < String(x.placement_date).slice(0, 10) || date > today()) throw httpError('Lifting date must be between placement and today');
    const birds = parseInt(b.birds, 10), kg = Number(b.weight_kg);
    if (!(birds > 0) || !(kg > 0)) throw httpError('Birds and weight (kg) are required');
    const k = await counts(c, t, batchId);
    const alive = x.chicks_placed + x.free_chicks - k.dead - k.culls - k.lifted;
    if (birds > alive) throw httpError(`Only ${alive} birds are in the shed`);
    const S = await getSettings(c, t);
    const rate = Number(b.rate) || 0;
    const qty = S.live_bird_unit === 'bird' ? birds : kg;
    const amount = round2(rate * qty);
    let adj = null, bill = null;
    if (S.live_bird_product_id) {
        // take the birds into stock at the batch's cost to date per kg (estimated; the sale then moves them out)
        const sum = await batchSummary(c, t, x, { quick: true });
        const expectedKg = k.lifts.reduce((s, l) => s + Number(l.weight_kg), 0) + kg + Math.max(0, alive - birds) * (kg / birds);
        const costPerKg = expectedKg > 0 ? sum.costs.total / expectedKg : 0;
        const unitRate = S.live_bird_unit === 'bird' ? costPerKg * kg / birds : costPerKg;
        const { data: shed } = await c.from('poultry_sheds').select('warehouse_id').eq('id', x.shed_id).maybeSingle();
        adj = await postAdjustment(c, t, userId, { date, direction: 'in', cost_center_id: x.cost_center_id, warehouse_id: b.warehouse_id || shed?.warehouse_id,
            lines: [{ product_id: S.live_bird_product_id, qty, rate: round2(unitRate) }], narration: `Birds lifted - batch ${x.batch_no}: ${birds} birds, ${kg} kg` });
        if (b.make_sales_bill) {
            if (!UUID.test(b.customer_ledger_id || '')) throw httpError('Choose the customer for the sales bill');
            const { data: adjRow } = await c.from('stock_adjustments').select('warehouse_id').eq('id', adj.id).maybeSingle();
            const { data: prod } = await c.from('products').select('base_unit_id').eq('id', S.live_bird_product_id).maybeSingle();
            const made = await invoke(require('../routes/salesBillRoutes').createSalesBill, req, {
                doc_date: date, customer_ledger_id: b.customer_ledger_id, warehouse_id: adjRow?.warehouse_id || null, cost_center_id: x.cost_center_id, status: 'draft', save_as_draft: true,
                narration: `Birds lifted - batch ${x.batch_no}${b.vehicle_no ? `, vehicle ${b.vehicle_no}` : ''}`,
                details: [{ product_id: S.live_bird_product_id, qty, uom_id: prod?.base_unit_id || null, rate, warehouse_id: adjRow?.warehouse_id || null }]
            });
            if (!made.success) { await cancelAdjustment(c, t, userId, adj.id, 'Lifting not saved'); throw httpError(`Sales bill not made: ${made.error}`, made.code || 400); }
            bill = made.data || made.bill || null;
        }
    }
    const { data, error } = await c.from('poultry_liftings').insert({ tenant_id: t, batch_id: batchId, lift_date: date, birds, weight_kg: kg, rate, amount,
        customer_ledger_id: b.customer_ledger_id && UUID.test(b.customer_ledger_id) ? b.customer_ledger_id : null, vehicle_no: b.vehicle_no || null, remarks: b.remarks || null,
        stock_adjustment_id: adj?.id || null, sales_bill_id: bill?.id || null, created_by: userId }).select().single();
    if (error) { if (adj) await cancelAdjustment(c, t, userId, adj.id, 'Lifting not saved'); throw error; }
    return { ...data, sales_bill_doc_no: bill?.doc_no || null, warnings: adj?.warnings || [] };
}
async function deleteLifting(c, t, userId, id) {
    const { data: l } = await c.from('poultry_liftings').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!l) throw httpError('Lifting not found', 404);
    const x = await loadBatch(c, t, l.batch_id);
    if (x.status === 'closed') throw httpError('The batch is closed - reopen it to change liftings');
    if (l.sales_bill_id) {
        const { data: bill } = await c.from('sales_bills').select('status, doc_no').eq('id', l.sales_bill_id).maybeSingle();
        if (bill && bill.status !== 'draft' && bill.status !== 'cancelled') throw httpError(`Sales bill ${bill.doc_no} is ${bill.status} - cancel it first`);
        if (bill && bill.status === 'draft') await c.from('sales_bills').delete().eq('id', l.sales_bill_id);
    }
    await cancelAdjustment(c, t, userId, l.stock_adjustment_id, `Lifting of batch ${x.batch_no} deleted`);
    await c.from('poultry_liftings').delete().eq('id', id);
    return { deleted: true };
}

// ---------------------------------------------------------------- money: costs & revenue per cost center
async function glByCostCenter(c, t, ccIds, to) {
    if (!ccIds.length) return [];
    const D = require('./dimensionReports');
    const M = await D.masters(c, t);
    const want = new Set(ccIds);
    const lines = (await D.dimLines(c, t, M, { from: null, to })).filter(l => l.cost_center && want.has(l.cost_center) && l.statement === 'pl' && l.doc_type !== 'stock_adjustment');
    return lines.map(l => {
        const led = M.ledgers[l.ledger] || {}, g = M.groups[led.account_group_id] || {};
        const purchase = g.category_type === 'purchase' || g.anchor === 'INVENTORY';          // stock purchases: counted when used, not when bought
        return { ...l, kind: /income/.test(l.section) ? 'income' : purchase ? 'skip' : 'expense' };
    }).filter(l => l.kind !== 'skip');
}

/** Everything about one batch: counts, KPIs, costs, revenue, profit. */
async function batchSummary(c, t, x, { quick = false, gl = null, shedAlloc = null } = {}) {
    const k = await counts(c, t, x.id);
    const placed = x.chicks_placed + x.free_chicks;
    const alive = placed - k.dead - k.culls - k.lifted;
    const end = x.status === 'closed' && x.closed_on ? String(x.closed_on).slice(0, 10) : today();
    const age = Math.max(0, daysBetween(x.placement_date, end));
    const logIds = (await c.from('poultry_daily_logs').select('id, log_date, avg_weight_g, consumption_adjustment_id').eq('batch_id', x.id)).data || [];
    const items = logIds.length ? (await c.from('poultry_log_items').select('log_id, role, amount, feed_kg').in('log_id', logIds.map(l => l.id))).data || [] : [];
    const byRole = {};
    items.forEach(i => { byRole[i.role || 'other'] = round2((byRole[i.role || 'other'] || 0) + Number(i.amount || 0)); });
    const feedKg = round3(items.reduce((s, i) => s + Number(i.feed_kg || 0), 0));
    const weighed = logIds.filter(l => Number(l.avg_weight_g) > 0).sort((a, b) => String(a.log_date).localeCompare(String(b.log_date)));
    const lastWeightKg = weighed.length ? Number(weighed[weighed.length - 1].avg_weight_g) / 1000 : 0;
    const liftedKg = round3(k.lifts.reduce((s, l) => s + Number(l.weight_kg || 0), 0));
    const liveKgNow = round3(Math.max(0, alive) * lastWeightKg);
    const producedKg = round3(liftedKg + (x.status === 'active' ? liveKgNow : 0));
    const avgWeightKg = k.lifted ? round3(liftedKg / k.lifted) : lastWeightKg;
    const livability = placed ? round2((placed - k.dead - k.culls) * 100 / placed) : 0;
    const fcr = producedKg > 0 ? round3(feedKg / producedKg) : null;
    const epef = fcr && age ? Math.round(livability * avgWeightKg / (age * fcr) * 100) : null;

    let chickCost = Number(x.chick_cost_manual) || 0;
    if (x.placement_adjustment_id) {
        const { data: pa } = await c.from('stock_adjustments').select('status, total_out_amount').eq('id', x.placement_adjustment_id).maybeSingle();
        if (pa && pa.status === 'posted') chickCost += Number(pa.total_out_amount) || 0;
    }
    const costs = { chicks: round2(chickCost + (byRole.chick || 0)), feed: byRole.feed || 0, medicine: byRole.medicine || 0, vaccine: byRole.vaccine || 0,
        litter: byRole.litter || 0, other_items: round2((byRole.other || 0)), direct_expenses: 0, shed_share: 0 };
    let revenueBilled = 0, otherIncome = 0;
    if (!quick) {
        const lines = gl || await glByCostCenter(c, t, [x.cost_center_id].filter(Boolean), today());
        lines.filter(l => l.cost_center === x.cost_center_id).forEach(l => {
            if (l.kind === 'expense') costs.direct_expenses += l.dr - l.cr;
            else if (/sales_bill|sales_return|sales_additional/.test(l.doc_type)) revenueBilled += l.cr - l.dr;
            else otherIncome += l.cr - l.dr;
        });
        costs.direct_expenses = round2(costs.direct_expenses);
        costs.shed_share = round2(shedAlloc || 0);
    }
    costs.total = round2(Object.values(costs).reduce((s, v) => s + v, 0));
    // liftings not yet on a posted sales bill count at their lifting value
    let unbilled = 0;
    if (!quick) {
        const { data: lifts } = await c.from('poultry_liftings').select('amount, sales_bill_id').eq('batch_id', x.id);
        const billIds = (lifts || []).map(l => l.sales_bill_id).filter(Boolean);
        const { data: bills } = billIds.length ? await c.from('sales_bills').select('id, status').in('id', billIds) : { data: [] };
        const posted = new Set((bills || []).filter(b2 => b2.status === 'posted').map(b2 => b2.id));
        unbilled = round2((lifts || []).filter(l => !l.sales_bill_id || !posted.has(l.sales_bill_id)).reduce((s, l) => s + Number(l.amount || 0), 0));
    }
    const revenue = { sales: round2(revenueBilled), unbilled_liftings: unbilled, other_income: round2(otherIncome) };
    revenue.total = round2(revenue.sales + revenue.unbilled_liftings + revenue.other_income);
    const profit = round2(revenue.total - costs.total);
    return {
        birds: { placed, dead: k.dead, culls: k.culls, lifted: k.lifted, alive },
        kpi: { age_days: age, livability_pct: livability, mortality_pct: placed ? round2((k.dead + k.culls) * 100 / placed) : 0, feed_kg: feedKg,
            feed_per_bird_kg: placed ? round3(feedKg / placed) : 0, lifted_kg: liftedKg, live_kg_in_shed: liveKgNow, produced_kg: producedKg,
            avg_weight_kg: avgWeightKg, last_sample_weight_kg: lastWeightKg, fcr, epef,
            cost_per_kg: producedKg ? round2(costs.total / producedKg) : null, cost_per_bird: (k.lifted || alive) ? round2(costs.total / Math.max(1, k.lifted + Math.max(0, alive))) : null },
        costs, revenue, profit,
        profit_per_kg: producedKg ? round2(profit / producedKg) : null, profit_per_bird: k.lifted ? round2(profit / k.lifted) : null,
        stage: stageOf(age, await getSettings(c, t), x.status),
        cycle: cycleOf(x, age, await getSettings(c, t))
    };
}
/** 45-day (setting) cycle: when the lot should be lifted and how many days are left */
function cycleOf(x, age, S) {
    const cycle = Number(S.cycle_days) || 45;
    const due = x.expected_close_date ? String(x.expected_close_date).slice(0, 10) : iso(d2n(x.placement_date) + cycle * DAY);
    const left = x.status === 'closed' ? null : daysBetween(today(), due);
    return { cycle_days: cycle, lift_due_date: due, days_to_lift: left, lift_due: left !== null && left <= 3 };
}
function stageOf(age, S, status) {
    if (status === 'closed') return 'Closed';
    return age <= S.brooding_days ? 'Brooding' : age <= S.grower_days ? 'Grower' : 'Finisher';
}

/** Shed expenses (tagged with the shed cost center): to the batch running on that day, or the next one placed after (cleaning / downtime). */
function allocateShed(batches, shedLines) {
    const share = {}, unallocated = [];
    shedLines.filter(l => l.kind === 'expense').forEach(l => {
        const amt = l.dr - l.cr;
        const inShed = batches.filter(b => b.shed_cost_center === l.cost_center);
        const running = inShed.find(b => String(b.placement_date) <= l.date && (!b.closed_on || l.date <= String(b.closed_on)));
        const next = running || inShed.filter(b => String(b.placement_date) > l.date).sort((a, b) => String(a.placement_date).localeCompare(String(b.placement_date)))[0];
        if (next) share[next.id] = (share[next.id] || 0) + amt; else unallocated.push({ shed_cost_center: l.cost_center, amount: amt, date: l.date });
    });
    return { share, unallocated };
}

async function batchDetail(c, t, id) {
    const x = await loadBatch(c, t, id);
    const { data: shed } = await c.from('poultry_sheds').select('*').eq('id', x.shed_id).maybeSingle();
    const { data: all } = await c.from('poultry_batches').select('id, shed_id, placement_date, closed_on').eq('tenant_id', t).eq('shed_id', x.shed_id);
    const gl = await glByCostCenter(c, t, [x.cost_center_id, shed?.cost_center_id].filter(Boolean), today());
    const alloc = allocateShed((all || []).map(b => ({ ...b, shed_cost_center: shed?.cost_center_id })), gl.filter(l => l.cost_center === shed?.cost_center_id));
    const summary = await batchSummary(c, t, x, { gl, shedAlloc: alloc.share[x.id] || 0 });
    const [{ data: logs }, { data: lifts }] = await Promise.all([
        c.from('poultry_daily_logs').select('*').eq('batch_id', id).order('log_date'),
        c.from('poultry_liftings').select('*').eq('batch_id', id).order('lift_date')
    ]);
    const logIds = (logs || []).map(l => l.id);
    const { data: items } = logIds.length ? await c.from('poultry_log_items').select('*').in('log_id', logIds) : { data: [] };
    const pids = [...new Set((items || []).map(i => i.product_id))];
    const { data: ps } = pids.length ? await c.from('products').select('id, product_name').in('id', pids) : { data: [] };
    const P = Object.fromEntries((ps || []).map(p => [p.id, p.product_name]));
    const adjIds = [...(logs || []).map(l => l.consumption_adjustment_id), ...(lifts || []).map(l => l.stock_adjustment_id), x.placement_adjustment_id].filter(Boolean);
    const { data: adjs } = adjIds.length ? await c.from('stock_adjustments').select('id, doc_no, status').in('id', adjIds) : { data: [] };
    const A = Object.fromEntries((adjs || []).map(a => [a.id, a]));
    const standards = x.breed ? (await c.from('poultry_breed_standards').select('age_day, body_weight_g, cum_feed_g, livability_pct').eq('tenant_id', t).eq('breed', x.breed)).data || [] : [];
    const STD = Object.fromEntries(standards.map(s => [s.age_day, s]));
    // day-by-day lifecycle
    const placed = x.chicks_placed + x.free_chicks;
    let birds = placed, cumFeed = 0, cumDead = 0;
    const L = Object.fromEntries((logs || []).map(l => [String(l.log_date).slice(0, 10), l]));
    const F = {}; (items || []).forEach(i => { F[i.log_id] = (F[i.log_id] || 0) + Number(i.feed_kg || 0); });
    const liftsByDay = {}; (lifts || []).forEach(l => { const d = String(l.lift_date).slice(0, 10); liftsByDay[d] = (liftsByDay[d] || 0) + Number(l.birds); });
    const lastDay = x.status === 'closed' && x.closed_on ? String(x.closed_on).slice(0, 10) : today();
    const days = [];
    for (let d = d2n(x.placement_date); d <= d2n(lastDay) && days.length < 120; d += DAY) {
        const day = iso(d), l = L[day], age = daysBetween(x.placement_date, day);
        const opening = birds, dead = l ? Number(l.mortality) : 0, cull = l ? Number(l.culls) : 0, lifted = liftsByDay[day] || 0;
        birds = opening - dead - cull - lifted; cumDead += dead + cull;
        const feed = l ? round3(F[l.id] || 0) : 0; cumFeed += feed;
        days.push({ date: day, age, opening, mortality: dead, culls: cull, lifted, closing: birds, cum_mortality_pct: round2(cumDead * 100 / placed),
            feed_kg: feed, cum_feed_kg: round3(cumFeed), feed_per_bird_g: opening ? Math.round(feed * 1e6 / opening) / 1000 : 0,
            avg_weight_g: l?.avg_weight_g ? Number(l.avg_weight_g) : null, std_weight_g: STD[age]?.body_weight_g ? Number(STD[age].body_weight_g) : null,
            water_l: l?.water_l ? Number(l.water_l) : null, has_entry: !!l });
    }
    return {
        ...x, shed_name: shed?.shed_name || '', shed_code: shed?.shed_code || '', summary, days,
        logs: (logs || []).map(l => ({ ...l, age: daysBetween(x.placement_date, l.log_date), adjustment_no: A[l.consumption_adjustment_id]?.doc_no || null,
            items: (items || []).filter(i => i.log_id === l.id).map(i => ({ ...i, product_name: P[i.product_id] || '' })) })),
        liftings: (lifts || []).map(l => ({ ...l, adjustment_no: A[l.stock_adjustment_id]?.doc_no || null, avg_weight_kg: round3(Number(l.weight_kg) / Number(l.birds)) })),
        placement_adjustment_no: A[x.placement_adjustment_id]?.doc_no || null
    };
}

async function listBatches(c, t, q = {}) {
    let b = c.from('poultry_batches').select('*').eq('tenant_id', t);
    if (q.status === 'active' || q.status === 'closed') b = b.eq('status', q.status);
    if (q.shed_id && UUID.test(q.shed_id)) b = b.eq('shed_id', q.shed_id);
    if (q.date_from) b = b.gte('placement_date', q.date_from);
    if (q.date_to) b = b.lte('placement_date', q.date_to);
    const { data, error } = await b.order('placement_date', { ascending: false });
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) return [];
    const { data: sheds } = await c.from('poultry_sheds').select('id, shed_name, shed_code, cost_center_id').eq('tenant_id', t);
    const SH = Object.fromEntries((sheds || []).map(s => [s.id, s]));
    const withMoney = q.money !== 'false';
    let gl = [], alloc = { share: {}, unallocated: [] };
    if (withMoney) {
        gl = await glByCostCenter(c, t, [...rows.map(r => r.cost_center_id), ...(sheds || []).map(s => s.cost_center_id)].filter(Boolean), today());
        const { data: all } = await c.from('poultry_batches').select('id, shed_id, placement_date, closed_on').eq('tenant_id', t);
        alloc = allocateShed((all || []).map(r => ({ ...r, shed_cost_center: SH[r.shed_id]?.cost_center_id })), gl.filter(l => (sheds || []).some(s => s.cost_center_id === l.cost_center)));
    }
    const out = [];
    for (const r of rows) {
        const s = await batchSummary(c, t, r, { quick: !withMoney, gl, shedAlloc: alloc.share[r.id] || 0 });
        out.push({ ...r, shed_name: SH[r.shed_id]?.shed_name || '', shed_code: SH[r.shed_id]?.shed_code || '', ...s });
    }
    out.unallocated_shed_costs = alloc.unallocated;
    return out;
}

// ---------------------------------------------------------------- reports
async function report(c, t, view, q = {}) {
    await requireFeature(c, t);
    const batches = await listBatches(c, t, { ...q, money: view === 'profitability' ? 'true' : 'false' });
    const from = q.date_from || '0000-01-01', to = q.date_to || today();
    if (view === 'profitability') {
        const bySh = {};
        batches.forEach(b => {
            const s = bySh[b.shed_id] = bySh[b.shed_id] || { shed_name: b.shed_name, batches: 0, placed: 0, lifted: 0, lifted_kg: 0, feed_kg: 0, revenue: 0, cost: 0, profit: 0 };
            s.batches++; s.placed += b.birds.placed; s.lifted += b.birds.lifted; s.lifted_kg += b.kpi.lifted_kg; s.feed_kg += b.kpi.feed_kg;
            s.revenue += b.revenue.total; s.cost += b.costs.total; s.profit += b.profit;
        });
        const sheds = Object.values(bySh).map(s => ({ ...s, revenue: round2(s.revenue), cost: round2(s.cost), profit: round2(s.profit), lifted_kg: round3(s.lifted_kg),
            fcr: s.lifted_kg ? round3(s.feed_kg / s.lifted_kg) : null, profit_per_kg: s.lifted_kg ? round2(s.profit / s.lifted_kg) : null }));
        return { batches: batches.map(slimBatch), sheds, unallocated_shed_costs: batches.unallocated_shed_costs || [] };
    }
    if (view === 'mortality') {
        const ids = batches.map(b => b.id);
        const logs = ids.length ? await fetchAll(() => c.from('poultry_daily_logs').select('batch_id, log_date, mortality, culls, mortality_reason').in('batch_id', ids).gte('log_date', from).lte('log_date', to).order('id')) : [];
        const B = Object.fromEntries(batches.map(b => [b.id, b]));
        const reasons = {}, weeks = {};
        logs.forEach(l => {
            const n = Number(l.mortality) + Number(l.culls);
            if (!n) return;
            const r = l.mortality_reason || '(not given)'; reasons[r] = (reasons[r] || 0) + n;
            const w = `Week ${Math.floor(daysBetween(B[l.batch_id].placement_date, l.log_date) / 7) + 1}`; weeks[w] = (weeks[w] || 0) + n;
        });
        return {
            batches: batches.map(b => ({ batch_no: b.batch_no, shed_name: b.shed_name, placement_date: b.placement_date, status: b.status, placed: b.birds.placed, mortality: b.birds.dead, culls: b.birds.culls,
                mortality_pct: b.kpi.mortality_pct, livability_pct: b.kpi.livability_pct, age_days: b.kpi.age_days })),
            by_reason: Object.entries(reasons).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
            by_week: Object.entries(weeks).map(([label, value]) => ({ label, value })).sort((a, b) => Number(a.label.slice(5)) - Number(b.label.slice(5)))
        };
    }
    if (view === 'consumption') {
        const ids = batches.map(b => b.id);
        const logs = ids.length ? await fetchAll(() => c.from('poultry_daily_logs').select('id, batch_id, log_date').in('batch_id', ids).gte('log_date', from).lte('log_date', to).order('id')) : [];
        const items = logs.length ? await fetchAll(() => c.from('poultry_log_items').select('log_id, product_id, role, qty, amount, feed_kg').in('log_id', logs.map(l => l.id)).order('id')) : [];
        const LB = Object.fromEntries(logs.map(l => [l.id, l.batch_id]));
        const B = Object.fromEntries(batches.map(b => [b.id, b]));
        const pids = [...new Set(items.map(i => i.product_id))];
        const { data: ps } = pids.length ? await c.from('products').select('id, product_name').in('id', pids) : { data: [] };
        const P = Object.fromEntries((ps || []).map(p => [p.id, p.product_name]));
        const m = {};
        items.forEach(i => {
            const b = B[LB[i.log_id]]; const key = `${b.id}|${i.product_id}`;
            const r = m[key] = m[key] || { batch_no: b.batch_no, shed_name: b.shed_name, product_name: P[i.product_id] || '', role: i.role, qty: 0, feed_kg: 0, amount: 0, placed: b.birds.placed };
            r.qty += Number(i.qty); r.feed_kg += Number(i.feed_kg); r.amount += Number(i.amount);
        });
        const rows = Object.values(m).map(r => ({ ...r, qty: round3(r.qty), feed_kg: round3(r.feed_kg), amount: round2(r.amount), per_bird: r.placed ? round2(r.amount / r.placed) : 0 }))
            .sort((a, b) => a.shed_name.localeCompare(b.shed_name) || a.batch_no.localeCompare(b.batch_no) || a.role.localeCompare(b.role));
        const roles = {}; rows.forEach(r => { roles[r.role] = round2((roles[r.role] || 0) + r.amount); });
        return { rows, by_role: Object.entries(roles).map(([label, value]) => ({ label, value })) };
    }
    if (view === 'shed_lot') {
        // every shed with its lots: birds in / mortality / sold / profit, and the shed totals
        const hatchIds = [...new Set(batches.map(b => b.source_hatch_id).filter(Boolean))];
        const { data: hs } = hatchIds.length ? await c.from('poultry_hatches').select('id, hatch_no').in('id', hatchIds) : { data: [] };
        const HN = Object.fromEntries((hs || []).map(h => [h.id, h.hatch_no]));
        const bySh = {};
        batches.forEach(b => {
            const s = bySh[b.shed_id] = bySh[b.shed_id] || { shed_id: b.shed_id, shed_name: b.shed_name, lots: [], placed: 0, dead: 0, culls: 0, lifted: 0, alive: 0, lifted_kg: 0, feed_kg: 0, sales: 0, cost: 0, profit: 0 };
            s.lots.push({ id: b.id, batch_no: b.batch_no, placement_date: b.placement_date, status: b.status, source: b.source_hatch_id ? `Hatch ${HN[b.source_hatch_id] || ''}` : (b.chick_source || 'Purchased'),
                age_days: b.kpi.age_days, lift_due_date: b.cycle?.lift_due_date, days_to_lift: b.cycle?.days_to_lift,
                placed: b.birds.placed, dead: b.birds.dead, culls: b.birds.culls, mortality_pct: b.kpi.mortality_pct, lifted: b.birds.lifted, alive: b.birds.alive,
                lifted_kg: b.kpi.lifted_kg, avg_weight_kg: b.kpi.avg_weight_kg, fcr: b.kpi.fcr, sales: b.revenue.total, cost: b.costs.total, profit: b.profit, profit_per_bird: b.profit_per_bird, profit_per_kg: b.profit_per_kg });
            s.placed += b.birds.placed; s.dead += b.birds.dead; s.culls += b.birds.culls; s.lifted += b.birds.lifted; s.alive += b.birds.alive;
            s.lifted_kg += b.kpi.lifted_kg; s.feed_kg += b.kpi.feed_kg; s.sales += b.revenue.total; s.cost += b.costs.total; s.profit += b.profit;
        });
        const sheds = Object.values(bySh).map(s => ({ ...s, lifted_kg: round3(s.lifted_kg), feed_kg: round3(s.feed_kg), sales: round2(s.sales), cost: round2(s.cost), profit: round2(s.profit),
            mortality_pct: s.placed ? round2((s.dead + s.culls) * 100 / s.placed) : 0, fcr: s.lifted_kg ? round3(s.feed_kg / s.lifted_kg) : null,
            profit_per_bird: s.lifted ? round2(s.profit / s.lifted) : null })).sort((a, b) => a.shed_name.localeCompare(b.shed_name));
        const tot = k => round2(sheds.reduce((x, s) => x + s[k], 0));
        return { sheds, totals: { placed: tot('placed'), dead: tot('dead'), culls: tot('culls'), lifted: tot('lifted'), alive: tot('alive'), lifted_kg: tot('lifted_kg'), sales: tot('sales'), cost: tot('cost'), profit: tot('profit') },
            unallocated_shed_costs: batches.unallocated_shed_costs || [] };
    }
    if (view === 'chick_source') {
        // chick supplier performance: lots grouped by where the chicks came from (supplier / own hatchery / other)
        const vIds = [...new Set(batches.map(b => b.source_vendor_ledger_id).filter(Boolean))];
        const { data: vs } = vIds.length ? await c.from('ledger_accounts').select('id, account_name').in('id', vIds) : { data: [] };
        const VN = Object.fromEntries((vs || []).map(v => [v.id, v.account_name]));
        const g = {};
        batches.forEach(b => {
            const key = b.source_vendor_ledger_id ? `v:${b.source_vendor_ledger_id}` : b.source_hatch_id ? 'own' : `o:${b.chick_source || ''}`;
            const name = b.source_vendor_ledger_id ? VN[b.source_vendor_ledger_id] || 'Supplier' : b.source_hatch_id ? 'Own hatchery' : (b.chick_source || 'Not given');
            const r = g[key] = g[key] || { source: name, kind: b.source_vendor_ledger_id ? 'supplier' : b.source_hatch_id ? 'own_hatch' : 'other', lots: [], placed: 0, dead: 0, lifted: 0, lifted_kg: 0, feed_kg: 0, chick_cost: 0, cost: 0, sales: 0, profit: 0, first_week_dead: 0 };
            r.lots.push({ id: b.id, batch_no: b.batch_no, shed_name: b.shed_name, placement_date: b.placement_date, status: b.status, placed: b.birds.placed, mortality_pct: b.kpi.mortality_pct, fcr: b.kpi.fcr, profit: b.profit });
            r.placed += b.birds.placed; r.dead += b.birds.dead + b.birds.culls; r.lifted += b.birds.lifted; r.lifted_kg += b.kpi.lifted_kg; r.feed_kg += b.kpi.feed_kg;
            r.chick_cost += b.costs.chicks; r.cost += b.costs.total; r.sales += b.revenue.total; r.profit += b.profit;
        });
        // first-week mortality tells chick quality best
        const ids = batches.map(b => b.id);
        const logs = ids.length ? await fetchAll(() => c.from('poultry_daily_logs').select('batch_id, log_date, mortality, culls').in('batch_id', ids).order('id')) : [];
        const B = Object.fromEntries(batches.map(b => [b.id, b]));
        logs.forEach(l => {
            const b = B[l.batch_id]; if (!b || daysBetween(b.placement_date, l.log_date) > 7) return;
            const key = b.source_vendor_ledger_id ? `v:${b.source_vendor_ledger_id}` : b.source_hatch_id ? 'own' : `o:${b.chick_source || ''}`;
            g[key].first_week_dead += Number(l.mortality) + Number(l.culls);
        });
        return Object.values(g).map(r => ({ ...r, lifted_kg: round3(r.lifted_kg), chick_cost: round2(r.chick_cost), cost: round2(r.cost), sales: round2(r.sales), profit: round2(r.profit),
            cost_per_chick: r.placed ? round2(r.chick_cost / r.placed) : null, mortality_pct: r.placed ? round2(r.dead * 100 / r.placed) : 0,
            first_week_mortality_pct: r.placed ? round2(r.first_week_dead * 100 / r.placed) : 0, fcr: r.lifted_kg ? round3(r.feed_kg / r.lifted_kg) : null,
            avg_weight_kg: r.lifted ? round3(r.lifted_kg / r.lifted) : null, profit_per_bird: r.lifted ? round2(r.profit / r.lifted) : null }))
            .sort((a, b) => b.placed - a.placed);
    }
    if (view === 'hatch_broiler') {
        // own hatches followed into own sheds: chicks hatched -> placed -> dead -> sold -> profit
        const { data: hs } = await c.from('poultry_hatches').select('*').eq('tenant_id', t).eq('status', 'hatched').gte('hatch_date', from).lte('hatch_date', to).order('hatch_date', { ascending: false });
        const all = await listBatches(c, t, { money: 'true' });
        const H = require('./hatchery');
        return (hs || []).map(h => {
            const lots = all.filter(b => b.source_hatch_id === h.id);
            const sum = f => round2(lots.reduce((x, b) => x + f(b), 0));
            const placed = sum(b => b.birds.placed), dead = sum(b => b.birds.dead + b.birds.culls);
            return { id: h.id, hatch_no: h.hatch_no, hatch_date: h.hatch_date, eggs_set: h.eggs_set, chicks_a: h.chicks_a, ...H.kpis(h),
                placed_in_own_sheds: placed, not_placed: Math.max(0, h.chicks_a - placed), lots: lots.map(b => ({ id: b.id, batch_no: b.batch_no, shed_name: b.shed_name, status: b.status, placed: b.birds.placed,
                    dead: b.birds.dead + b.birds.culls, mortality_pct: b.kpi.mortality_pct, lifted: b.birds.lifted, lifted_kg: b.kpi.lifted_kg, sales: b.revenue.total, cost: b.costs.total, profit: b.profit })),
                dead, mortality_pct: placed ? round2(dead * 100 / placed) : 0, lifted: sum(b => b.birds.lifted), lifted_kg: sum(b => b.kpi.lifted_kg),
                sales: sum(b => b.revenue.total), cost: sum(b => b.costs.total), profit: sum(b => b.profit) };
        });
    }
    if (view === 'lifecycle') {
        if (!q.batch_id) return { batches: batches.map(slimBatch) };
        return batchDetail(c, t, q.batch_id);
    }
    throw httpError('Unknown poultry report', 404);
}
function slimBatch(b) {
    return { id: b.id, batch_no: b.batch_no, shed_id: b.shed_id, shed_name: b.shed_name, breed: b.breed, placement_date: b.placement_date, status: b.status, closed_on: b.closed_on,
        stage: b.stage, cycle: b.cycle, source_hatch_id: b.source_hatch_id || null, source_purchase_bill_id: b.source_purchase_bill_id || null, source_vendor_ledger_id: b.source_vendor_ledger_id || null, chick_source: b.chick_source || null, ...b.birds, ...b.kpi, costs: b.costs, revenue: b.revenue, profit: b.profit, profit_per_kg: b.profit_per_kg, profit_per_bird: b.profit_per_bird };
}

async function dashboard(c, t) {
    const f = await requireFeature(c, t);
    const active = await listBatches(c, t, { status: 'active', money: 'false' });
    const t0 = today(), monthStart = `${t0.slice(0, 7)}-01`;
    const ids = active.map(b => b.id);
    const logs = ids.length ? await fetchAll(() => c.from('poultry_daily_logs').select('id, batch_id, log_date, mortality, culls').in('batch_id', ids).gte('log_date', monthStart).order('id')) : [];
    const todayLogs = logs.filter(l => String(l.log_date).slice(0, 10) === t0);
    const missing = active.filter(b => !todayLogs.some(l => l.batch_id === b.id)).map(b => ({ id: b.id, batch_no: b.batch_no, shed_name: b.shed_name }));
    const closed = await listBatches(c, t, { status: 'closed', money: 'true', date_from: iso(Date.now() - 365 * DAY) });
    const avg = arr => (arr.length ? round3(arr.reduce((s, v) => s + v, 0) / arr.length) : null);
    let hatch = null;
    if (f.poultry.hatchery) hatch = await require('./hatchery').summary(c, t);
    return {
        features: f.poultry,
        kpis: { active_batches: active.length, live_birds: active.reduce((s, b) => s + b.birds.alive, 0), avg_age: avg(active.map(b => b.kpi.age_days)),
            mortality_today: todayLogs.reduce((s, l) => s + Number(l.mortality) + Number(l.culls), 0), mortality_mtd: logs.reduce((s, l) => s + Number(l.mortality) + Number(l.culls), 0),
            closed_12m: closed.length, avg_fcr_12m: avg(closed.map(b => b.kpi.fcr).filter(Boolean)), avg_livability_12m: avg(closed.map(b => b.kpi.livability_pct)),
            avg_epef_12m: avg(closed.map(b => b.kpi.epef).filter(Boolean)), profit_12m: round2(closed.reduce((s, b) => s + b.profit, 0)) },
        active: active.map(slimBatch), missing_today: missing,
        due_lifting: active.filter(b => b.cycle?.lift_due).map(b => ({ id: b.id, batch_no: b.batch_no, shed_name: b.shed_name, age_days: b.kpi.age_days, alive: b.birds.alive, lift_due_date: b.cycle.lift_due_date, days_to_lift: b.cycle.days_to_lift }))
            .sort((a, b) => a.days_to_lift - b.days_to_lift),
        closed: closed.slice(0, 12).map(slimBatch), hatchery: hatch
    };
}

module.exports = {
    ROLES, CONSUMABLE, features, requireFeature, getSettings, saveSettings, listItems, saveItems, itemMap, makeCostCenter, postAdjustment, cancelAdjustment, costRate,
    listSheds, saveShed, createBatch, updateBatch, closeBatch, reopenBatch, deleteBatch, saveLog, deleteLog, addLifting, deleteLifting,
    batchDetail, batchSummary, listBatches, report, dashboard, hatchAvailability, purchaseAvailability, chickSources, placeLots, glByCostCenter, allocateShed, nextSerial, stageOf
};
