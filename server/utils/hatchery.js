// =============================================
// utils/hatchery.js
// Hatchery: egg setting -> candling -> transfer -> hatch.
//   set      hatching eggs issued from stock (Stock Adjustment decrease,
//            Dr the production-transfer ledger - it is work in progress)
//   candle   infertile (clears), early dead, cracked
//   hatch    saleable chicks (A), culls / second grade (B), dead in shell;
//            chicks are taken into stock (Stock Adjustment increase,
//            Cr the same transfer ledger) at cost:
//              cost per chick = (egg cost + hatchery expenses of the hatch
//                                 - value of infertile eggs kept for sale
//                                 - value of B-grade chicks) / A chicks
//            B chicks and infertile eggs are by-products at the rate given
//            (net realisable value), as in Tally / Busy by-product costing.
// KPIs: fertility % = fertile / set; hatchability % = (A + B) / set;
//       saleable hatch % = A / set; hatch of fertile (HOF) % = (A + B) / fertile.
// =============================================
const P = require('./poultry');

const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const UUID = /^[0-9a-f-]{36}$/i;
const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const pct = (a, b) => (b ? round2(a * 100 / b) : 0);

function kpis(h) {
    const fertile = h.eggs_set - h.infertile;
    const hatched = h.chicks_a + h.chicks_b;
    return {
        fertile, hatched, fertility_pct: pct(fertile, h.eggs_set), hatchability_pct: pct(hatched, h.eggs_set), saleable_pct: pct(h.chicks_a, h.eggs_set),
        hof_pct: pct(hatched, fertile), early_dead_pct: pct(h.early_dead, h.eggs_set), dead_in_shell_pct: pct(h.dead_in_shell, h.eggs_set),
        unaccounted: h.status === 'hatched' ? h.eggs_set - h.infertile - h.early_dead - h.cracked - hatched - h.dead_in_shell : null
    };
}

async function loadHatch(c, t, id) {
    if (!UUID.test(String(id))) throw httpError('Hatch not found', 404);
    const { data } = await c.from('poultry_hatches').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!data) throw httpError('Hatch not found', 404);
    return data;
}

/** Egg cost + hatchery expenses (hatch cost center, and the hatchery's own during the incubation). */
async function hatchCost(c, t, h, S) {
    let eggs = Number(h.egg_cost_manual) || 0;
    if (h.set_adjustment_id) {
        const { data } = await c.from('stock_adjustments').select('status, total_out_amount').eq('id', h.set_adjustment_id).maybeSingle();
        if (data && data.status === 'posted') eggs += Number(data.total_out_amount) || 0;
    }
    const { data: shed } = h.hatchery_id ? await c.from('poultry_sheds').select('cost_center_id').eq('id', h.hatchery_id).maybeSingle() : { data: null };
    const ccs = [h.cost_center_id, shed?.cost_center_id].filter(Boolean);
    let direct = 0, share = 0;
    if (ccs.length) {
        const gl = await P.glByCostCenter(c, t, ccs, today());
        const end = h.hatch_date ? String(h.hatch_date).slice(0, 10) : addDays(h.set_date, S.incubation_days);
        gl.filter(l => l.kind === 'expense').forEach(l => {
            if (l.cost_center === h.cost_center_id) direct += l.dr - l.cr;
            else if (l.date >= String(h.set_date).slice(0, 10) && l.date <= end) share += l.dr - l.cr;
        });
        if (share && shed) {
            // the hatchery's expenses are shared by every setting incubating that day, by eggs set
            const { data: others } = await c.from('poultry_hatches').select('id, eggs_set, set_date, hatch_date').eq('tenant_id', t).eq('hatchery_id', h.hatchery_id).neq('status', 'cancelled');
            const overlap = (others || []).filter(o => String(o.set_date) <= end && (o.hatch_date ? String(o.hatch_date) : addDays(o.set_date, S.incubation_days)) >= String(h.set_date).slice(0, 10));
            const eggsAll = overlap.reduce((s, o) => s + Number(o.eggs_set), 0) || h.eggs_set;
            share = share * h.eggs_set / eggsAll;
        }
    }
    const byProducts = round2((h.infertile_product_id ? h.infertile * Number(h.infertile_rate || 0) : 0) + (h.chick_b_product_id ? h.chicks_b * Number(h.chick_b_rate || 0) : 0));
    const total = round2(eggs + direct + share);
    return { eggs: round2(eggs), direct_expenses: round2(direct), hatchery_share: round2(share), total, by_products: byProducts,
        chick_cost: h.chicks_a ? round2((total - byProducts) / h.chicks_a) : null };
}

async function list(c, t, q = {}) {
    await P.requireFeature(c, t, 'hatchery');
    let b = c.from('poultry_hatches').select('*').eq('tenant_id', t);
    if (q.status && ['set', 'candled', 'hatched', 'cancelled'].includes(q.status)) b = b.eq('status', q.status);
    if (q.hatchery_id && UUID.test(q.hatchery_id)) b = b.eq('hatchery_id', q.hatchery_id);
    if (q.date_from) b = b.gte('set_date', q.date_from);
    if (q.date_to) b = b.lte('set_date', q.date_to);
    const { data, error } = await b.order('set_date', { ascending: false });
    if (error) throw error;
    const S = await P.getSettings(c, t);
    const { data: sheds } = await c.from('poultry_sheds').select('id, shed_name').eq('tenant_id', t).eq('shed_type', 'hatchery');
    const SH = Object.fromEntries((sheds || []).map(s => [s.id, s.shed_name]));
    return (data || []).map(h => ({ ...h, hatchery_name: SH[h.hatchery_id] || '', ...kpis(h),
        expected_candling: addDays(h.set_date, S.candling_day), expected_transfer: addDays(h.set_date, S.transfer_day), expected_hatch: addDays(h.set_date, S.incubation_days) }));
}
async function detail(c, t, id) {
    const h = await loadHatch(c, t, id);
    const S = await P.getSettings(c, t);
    const ids = [h.set_adjustment_id, h.output_adjustment_id].filter(Boolean);
    const { data: adjs } = ids.length ? await c.from('stock_adjustments').select('id, doc_no, status').in('id', ids) : { data: [] };
    const A = Object.fromEntries((adjs || []).map(a => [a.id, a]));
    const { data: shed } = await c.from('poultry_sheds').select('shed_name').eq('tenant_id', t).eq('id', h.hatchery_id).maybeSingle();
    let lots = [];
    if (h.status === 'hatched') {
        const { data: bs } = await c.from('poultry_batches').select('*').eq('tenant_id', t).eq('source_hatch_id', h.id).order('placement_date');
        const { data: sh } = await c.from('poultry_sheds').select('id, shed_name').eq('tenant_id', t);
        const SN = Object.fromEntries((sh || []).map(x => [x.id, x.shed_name]));
        for (const b of bs || []) {
            const sm = await P.batchSummary(c, t, b);
            lots.push({ id: b.id, batch_no: b.batch_no, shed_name: SN[b.shed_id] || '', placement_date: b.placement_date, status: b.status, placed: sm.birds.placed,
                dead: sm.birds.dead + sm.birds.culls, mortality_pct: sm.kpi.mortality_pct, lifted: sm.birds.lifted, alive: sm.birds.alive, age_days: sm.kpi.age_days,
                lift_due_date: sm.cycle.lift_due_date, sales: sm.revenue.total, cost: sm.costs.total, profit: sm.profit });
        }
    }
    const placedInLots = lots.reduce((x, l) => x + l.placed, 0);
    return { ...h, broiler_lots: lots, placed_in_lots: placedInLots, chicks_available: h.status === 'hatched' ? Math.max(0, h.chicks_a - placedInLots) : 0,
        hatchery_name: shed?.shed_name || '', ...kpis(h), cost: await hatchCost(c, t, h, S), set_adjustment_no: A[h.set_adjustment_id]?.doc_no || null, output_adjustment_no: A[h.output_adjustment_id]?.doc_no || null,
        expected_candling: addDays(h.set_date, S.candling_day), expected_transfer: addDays(h.set_date, S.transfer_day), expected_hatch: addDays(h.set_date, S.incubation_days) };
}

async function create(c, t, userId, b) {
    await P.requireFeature(c, t, 'hatchery');
    const eggs = parseInt(b.eggs_set, 10);
    if (!(eggs > 0)) throw httpError('Eggs set must be more than zero');
    const date = String(b.set_date || today()).slice(0, 10);
    if (date > today()) throw httpError('Setting date cannot be in the future');
    let shed = null;
    if (b.hatchery_id) {
        ({ data: shed } = await c.from('poultry_sheds').select('*').eq('tenant_id', t).eq('id', b.hatchery_id).maybeSingle());
        if (!shed || shed.shed_type !== 'hatchery') throw httpError('Choose a hatchery (a shed of type Hatchery)');
        if (shed.capacity && eggs > shed.capacity) throw httpError(`${eggs} eggs is more than the setter capacity (${shed.capacity})`);
    }
    const serial = await P.nextSerial(c, t, 'poultry_hatches');
    const hatchNo = `H-${String(serial).padStart(4, '0')}`;
    const ccId = await P.makeCostCenter(c, t, `HAT-${hatchNo}`, `Hatch ${hatchNo}${shed ? ` (${shed.shed_name})` : ''}`, userId);
    const S = await P.getSettings(c, t);
    let adj = null;
    if (b.egg_product_id) {
        adj = await P.postAdjustment(c, t, userId, { date, direction: 'out', cost_center_id: ccId, warehouse_id: b.warehouse_id || shed?.warehouse_id,
            ledger_id: S.transfer_ledger_id, lines: [{ product_id: b.egg_product_id, qty: eggs, uom_id: b.egg_uom_id || null }],
            narration: `Eggs set - hatch ${hatchNo}`, override_negative: !!b.override_negative_stock });
    }
    const row = { tenant_id: t, serial_no: serial, hatch_no: hatchNo, hatchery_id: shed?.id || null, setter_no: b.setter_no || null, egg_source: b.egg_source || null,
        set_date: date, egg_product_id: b.egg_product_id || null, eggs_set: eggs, egg_cost_manual: b.egg_product_id ? 0 : round2(b.egg_cost_manual),
        set_adjustment_id: adj?.id || null, chick_product_id: b.chick_product_id || null, chick_b_product_id: b.chick_b_product_id || null,
        infertile_product_id: b.infertile_product_id || null, infertile_rate: Number(b.infertile_rate) || 0, chick_b_rate: Number(b.chick_b_rate) || 0,
        output_warehouse_id: b.output_warehouse_id || null, cost_center_id: ccId, remarks: b.remarks || null, status: 'set', created_by: userId, updated_by: userId };
    const { data, error } = await c.from('poultry_hatches').insert(row).select().single();
    if (error) { if (adj) await P.cancelAdjustment(c, t, userId, adj.id, 'Hatch not saved'); throw error; }
    return { ...(await detail(c, t, data.id)), warnings: adj?.warnings || [] };
}

async function candle(c, t, userId, id, b) {
    const h = await loadHatch(c, t, id);
    if (!['set', 'candled'].includes(h.status)) throw httpError(`This hatch is ${h.status}`);
    const row = { infertile: Math.max(0, parseInt(b.infertile, 10) || 0), early_dead: Math.max(0, parseInt(b.early_dead, 10) || 0), cracked: Math.max(0, parseInt(b.cracked, 10) || 0),
        candling_date: String(b.candling_date || today()).slice(0, 10), transfer_date: b.transfer_date || null, status: 'candled', updated_by: userId, updated_at: new Date().toISOString() };
    if (row.infertile + row.early_dead + row.cracked > h.eggs_set) throw httpError('More eggs removed than were set');
    const { error } = await c.from('poultry_hatches').update(row).eq('id', id);
    if (error) throw error;
    return detail(c, t, id);
}

async function hatch(c, t, userId, id, b, { reverse = false } = {}) {
    const h0 = await loadHatch(c, t, id);
    if (reverse) {
        if (h0.status !== 'hatched') throw httpError('Not hatched yet');
        const { data: lots } = await c.from('poultry_batches').select('batch_no').eq('tenant_id', t).eq('source_hatch_id', id);
        if ((lots || []).length) throw httpError(`Chicks of this hatch are placed in broiler lot(s) ${lots.map(l => l.batch_no).join(', ')} - delete those lots first`);
        await P.cancelAdjustment(c, t, userId, h0.output_adjustment_id, `Hatch ${h0.hatch_no} reopened`);
        await c.from('poultry_hatches').update({ status: 'candled', output_adjustment_id: null, updated_by: userId }).eq('id', id);
        return detail(c, t, id);
    }
    if (!['set', 'candled'].includes(h0.status)) throw httpError(`This hatch is ${h0.status}`);
    const h = { ...h0, chicks_a: Math.max(0, parseInt(b.chicks_a, 10) || 0), chicks_b: Math.max(0, parseInt(b.chicks_b, 10) || 0), dead_in_shell: Math.max(0, parseInt(b.dead_in_shell, 10) || 0),
        hatch_date: String(b.hatch_date || today()).slice(0, 10) };
    ['chick_product_id', 'chick_b_product_id', 'infertile_product_id', 'output_warehouse_id'].forEach(k => { if (k in b) h[k] = b[k] && UUID.test(b[k]) ? b[k] : null; });
    ['infertile_rate', 'chick_b_rate'].forEach(k => { if (k in b) h[k] = Number(b[k]) || 0; });
    if (h.infertile + h.early_dead + h.cracked + h.chicks_a + h.chicks_b + h.dead_in_shell > h.eggs_set) throw httpError('Chicks + dead + removed eggs are more than the eggs set');
    if (!(h.chicks_a > 0)) throw httpError('Enter the saleable chicks hatched');
    const S = await P.getSettings(c, t);
    const cost = await hatchCost(c, t, h, S);
    let adj = null;
    if (h.chick_product_id) {
        const lines = [{ product_id: h.chick_product_id, qty: h.chicks_a, rate: Math.max(0, cost.chick_cost || 0) }];
        if (h.chick_b_product_id && h.chicks_b) lines.push({ product_id: h.chick_b_product_id, qty: h.chicks_b, rate: h.chick_b_rate });
        if (h.infertile_product_id && h.infertile) lines.push({ product_id: h.infertile_product_id, qty: h.infertile, rate: h.infertile_rate });
        adj = await P.postAdjustment(c, t, userId, { date: h.hatch_date, direction: 'in', cost_center_id: h.cost_center_id, warehouse_id: h.output_warehouse_id,
            ledger_id: S.transfer_ledger_id, lines, narration: `Chicks hatched - hatch ${h.hatch_no}: ${h.chicks_a} A${h.chicks_b ? `, ${h.chicks_b} B` : ''}` });
    }
    const row = { chicks_a: h.chicks_a, chicks_b: h.chicks_b, dead_in_shell: h.dead_in_shell, hatch_date: h.hatch_date, chick_product_id: h.chick_product_id, chick_b_product_id: h.chick_b_product_id,
        infertile_product_id: h.infertile_product_id, infertile_rate: h.infertile_rate, chick_b_rate: h.chick_b_rate, output_warehouse_id: h.output_warehouse_id,
        output_adjustment_id: adj?.id || null, status: 'hatched', updated_by: userId, updated_at: new Date().toISOString() };
    const { error } = await c.from('poultry_hatches').update(row).eq('id', id);
    if (error) { if (adj) await P.cancelAdjustment(c, t, userId, adj.id, 'Hatch not saved'); throw error; }
    return { ...(await detail(c, t, id)), warnings: adj?.warnings || [] };
}

async function cancel(c, t, userId, id) {
    const h = await loadHatch(c, t, id);
    if (h.status === 'hatched') throw httpError('Reopen the hatch first (it has chicks in stock)');
    if (h.status === 'cancelled') return detail(c, t, id);
    await P.cancelAdjustment(c, t, userId, h.set_adjustment_id, `Hatch ${h.hatch_no} cancelled`);
    await c.from('poultry_hatches').update({ status: 'cancelled', updated_by: userId }).eq('id', id);
    return detail(c, t, id);
}

async function summary(c, t) {
    const since = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
    const { data } = await c.from('poultry_hatches').select('*').eq('tenant_id', t).gte('set_date', since).neq('status', 'cancelled');
    const rows = data || [];
    const done = rows.filter(h => h.status === 'hatched');
    const sum = k => done.reduce((s, h) => s + Number(h[k] || 0), 0);
    const set = sum('eggs_set'), fertile = set - sum('infertile'), hatched = sum('chicks_a') + sum('chicks_b');
    return { in_incubation: rows.filter(h => h.status !== 'hatched').length, eggs_in_incubation: rows.filter(h => h.status !== 'hatched').reduce((s, h) => s + h.eggs_set, 0),
        hatches_12m: done.length, eggs_set_12m: set, chicks_12m: sum('chicks_a'), fertility_pct: pct(fertile, set), hatchability_pct: pct(hatched, set), hof_pct: pct(hatched, fertile),
        due_soon: rows.filter(h => h.status !== 'hatched').map(h => ({ id: h.id, hatch_no: h.hatch_no, set_date: h.set_date, eggs_set: h.eggs_set, status: h.status })) };
}

/**
 * Place a hatch's A-grade chicks in the company's own broiler sheds: one lot
 * per shed, each taking the chicks out of stock at the hatch's cost per chick.
 * rows: [{ shed_id, chicks_placed, free_chicks, breed, target_weight_kg }]
 */
async function placeInSheds(c, t, userId, id, b) {
    const h = await P.hatchAvailability(c, t, id);
    const r = await P.placeLots(c, t, userId, { ...b, source: 'hatch', source_id: id, placement_date: b.placement_date || String(h.hatch_date || today()).slice(0, 10) });
    return { ...r, hatch: await detail(c, t, id) };
}

module.exports = { list, detail, create, candle, hatch, cancel, summary, kpis, placeInSheds };
