// =============================================
// utils/pricing.js
// Multiple Rate Type, Rate Category and Discount Category.
//   * rate types  - Sr1..Sr5 are fixed; each has a caption and on / off
//                   (system_control_settings.rate_types)
//   * rate        - the customer's Rate Category row for the product + unit
//                   (rate_category_items) wins; else the category's Sr tier
//                   rate of that unit (product_unit_rates), else Sr1
//   * discount    - the customer's Discount Category: the best-matching
//                   rule (product + unit, Qty or Value slab From..To) giving
//                   %, rate off per qty or a fixed amount; else the old
//                   company matrix %. "Effect on rate" nets it into the rate.
// resolve() answers what Sales Quotation / Order / Delivery / Bill fill in.
// =============================================

const DEFAULT_RATE_TYPES = [
    { sr: 1, caption: 'Whole Sell Rate', enabled: true }, { sr: 2, caption: 'Distributor Rate', enabled: true }, { sr: 3, caption: 'Retail Rate', enabled: true },
    { sr: 4, caption: 'Special Rate', enabled: false }, { sr: 5, caption: 'Custom Rate', enabled: false }
];
const PAYMENT_TERMS = ['any', 'cash', 'credit', 'credit_15', 'credit_30', 'credit_60', 'advance'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
const r4 = v => Math.round(Number(v || 0) * 10000) / 10000;
const bad = msg => Object.assign(new Error(msg), { status: 400 });

function cleanRateTypes(list) {
    const src = Array.isArray(list) ? list : [];
    return DEFAULT_RATE_TYPES.map(d => {
        const x = src.find(y => Number(y && y.sr) === d.sr) || {};
        const caption = String(x.caption === undefined ? d.caption : x.caption).trim().slice(0, 40) || `Sr${d.sr}`;
        return { sr: d.sr, caption, enabled: x.enabled === undefined ? d.enabled : !!x.enabled };
    });
}
async function rateTypes(c, t) {
    const { data } = await c.from('system_control_settings').select('rate_types').eq('tenant_id', t).maybeSingle();
    return cleanRateTypes(data && data.rate_types);
}
async function saveRateTypes(c, t, userId, list) {
    const clean = cleanRateTypes(list);
    if (!clean.some(x => x.enabled)) throw bad('Keep at least one rate type enabled');
    const caps = clean.map(x => x.caption.toLowerCase());
    if (new Set(caps).size !== caps.length) throw bad('Two rate types have the same caption');
    await c.rpc('ensure_system_control_settings', { p_tenant_id: t });
    const { error } = await c.from('system_control_settings').update({ rate_types: clean, updated_by: userId, updated_at: new Date().toISOString() }).eq('tenant_id', t);
    if (error) throw error;
    return clean;
}

// ---------------------------------------------------------------- rate categories
async function rateCategory(c, t, id) {
    const { data: cat, error } = await c.from('rate_categories').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!cat) throw Object.assign(new Error('Rate category not found'), { status: 404 });
    const { data: items } = await c.from('rate_category_items').select('*').eq('tenant_id', t).eq('rate_category_id', id).order('serial_no');
    return { ...cat, items: items || [] };
}
async function saveRateCategoryItems(c, t, id, items) {
    const rows = [];
    const seen = new Set();
    (Array.isArray(items) ? items : []).forEach((x, i) => {
        if (!x || !UUID.test(x.product_id || '')) return;
        const unit = UUID.test(x.unit_id || '') ? x.unit_id : null;
        const key = `${x.product_id}|${unit}`;
        if (seen.has(key)) throw bad(`Row ${i + 1}: the same product and unit is listed twice`);
        seen.add(key);
        const rate = Number(x.rate);
        if (!(rate >= 0)) throw bad(`Row ${i + 1}: rate must be zero or more`);
        rows.push({ tenant_id: t, rate_category_id: id, serial_no: rows.length + 1, product_id: x.product_id, unit_id: unit, rate: r4(rate) });
    });
    const del = await c.from('rate_category_items').delete().eq('tenant_id', t).eq('rate_category_id', id);
    if (del.error) throw del.error;
    if (rows.length) { const { error } = await c.from('rate_category_items').insert(rows); if (error) throw error; }
    return rows.length;
}

// ---------------------------------------------------------------- discount categories
async function discountGroup(c, t, id) {
    const { data: g, error } = await c.from('discount_groups').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!g) throw Object.assign(new Error('Discount category not found'), { status: 404 });
    const { data: rules } = await c.from('discount_group_rules').select('*').eq('tenant_id', t).eq('discount_group_id', id).order('serial_no');
    return { ...g, rules: rules || [] };
}
function cleanRule(x, i) {
    const pct = num(x.discount_percent), per = num(x.rate_per_qty), fix = num(x.fixed_amount);
    const benefits = [pct, per, fix].filter(v => v !== null && v > 0).length;
    if (benefits !== 1) throw bad(`Rule ${i + 1}: enter exactly one of %, Rate/Qty or Fixed amount`);
    if (pct !== null && pct > 100) throw bad(`Rule ${i + 1}: % cannot be more than 100`);
    if ([pct, per, fix].some(v => v !== null && v < 0)) throw bad(`Rule ${i + 1}: amounts cannot be negative`);
    const from = num(x.from_value) || 0, to = num(x.to_value);
    if (from < 0 || (to !== null && to < from)) throw bad(`Rule ${i + 1}: "To" must be blank or not less than "From"`);
    return {
        product_id: UUID.test(x.product_id || '') ? x.product_id : null, unit_id: UUID.test(x.unit_id || '') ? x.unit_id : null,
        basis: x.basis === 'value' ? 'value' : 'qty', from_value: r4(from), to_value: to === null ? null : r4(to),
        discount_percent: pct && pct > 0 ? r4(pct) : null, rate_per_qty: per && per > 0 ? r4(per) : null, fixed_amount: fix && fix > 0 ? Math.round(fix * 100) / 100 : null
    };
}
async function saveDiscountRules(c, t, id, rules) {
    const rows = (Array.isArray(rules) ? rules : []).filter(x => x && (x.product_id || num(x.discount_percent) || num(x.rate_per_qty) || num(x.fixed_amount)))
        .map((x, i) => ({ tenant_id: t, discount_group_id: id, serial_no: i + 1, ...cleanRule(x, i) }));
    const del = await c.from('discount_group_rules').delete().eq('tenant_id', t).eq('discount_group_id', id);
    if (del.error) throw del.error;
    if (rows.length) { const { error } = await c.from('discount_group_rules').insert(rows); if (error) throw error; }
    return rows.length;
}
const groupFields = b => {
    const row = {};
    if ('description' in b) row.description = b.description ? String(b.description).trim() : null;
    if ('payment_term' in b) {
        if (!PAYMENT_TERMS.includes(b.payment_term || 'any')) throw bad('Unknown billing / payment term');
        row.payment_term = b.payment_term || 'any';
    }
    if ('effect_on_rate' in b) row.effect_on_rate = !!b.effect_on_rate;
    return row;
};

// ---------------------------------------------------------------- resolve
/** base units in one of `unitId` for this product (1 when unknown) */
const factorOf = (unitRows, unitId) => Number((unitRows.find(u => u.unit_id === unitId) || {}).conversion_factor) || 1;

async function resolve(c, t, q) {
    const { customer_ledger_id: customerId, product_id: productId } = q;
    const qty = num(q.qty);
    const [{ data: customer }, { data: product }, { data: unitRowsRaw }] = await Promise.all([
        c.from('ledger_accounts').select('rate_category_id, discount_group_id, credit_days').eq('tenant_id', t).eq('id', customerId).maybeSingle(),
        c.from('products').select('*').eq('tenant_id', t).eq('id', productId).maybeSingle(),
        c.from('product_unit_rates').select('*').eq('product_id', productId)
    ]);
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    const unitRows = unitRowsRaw || [];
    // payment term of the entry; else the customer's: credit days -> credit_<days>, none -> cash
    const days = Number(customer && customer.credit_days) || 0;
    const payTerm = q.payment_term || (customer ? (days > 0 ? `credit_${days}` : 'cash') : null);
    const unitId = UUID.test(q.unit_id || '') || unitRows.some(u => u.unit_id === q.unit_id) ? q.unit_id : product.base_unit_id;
    const lineFactor = factorOf(unitRows, unitId);

    // rate; sr_tier on the query: the entry's chosen rate type (Sr1-Sr5), which beats the customer's rate category
    const forcedTier = Math.floor(num(q.sr_tier) || 0);
    let srTier = 1, rate = null, rateSource = 'sr';
    if (forcedTier >= 1 && forcedTier <= 5) {
        srTier = forcedTier;
        rateSource = 'entry_rate_type';
    } else if (customer && customer.rate_category_id) {
        const { data: cat } = await c.from('rate_categories').select('sr_tier, is_active').eq('id', customer.rate_category_id).maybeSingle();
        if (cat && cat.is_active !== false) {
            srTier = cat.sr_tier || 1;
            const { data: items } = await c.from('rate_category_items').select('unit_id, rate').eq('tenant_id', t).eq('rate_category_id', customer.rate_category_id).eq('product_id', productId);
            const exact = (items || []).find(x => x.unit_id === unitId) || (items || []).find(x => !x.unit_id && unitId === product.base_unit_id);
            const other = exact || (items || [])[0];
            if (other) {
                rate = exact ? Number(exact.rate) : Number(other.rate) * lineFactor / factorOf(unitRows, other.unit_id || product.base_unit_id);
                rateSource = 'rate_category';
            }
        }
    }
    if (rate === null) {
        const types = await rateTypes(c, t);
        if (!types.find(x => x.sr === srTier && x.enabled)) srTier = (types.find(x => x.enabled) || { sr: 1 }).sr;
        const col = `sales_rate_sr${srTier}`;
        const row = unitRows.find(u => u.unit_id === unitId);
        const base = unitRows.find(u => u.is_base_unit) || unitRows.find(u => u.unit_id === product.base_unit_id);
        if (row && Number(row[col])) rate = Number(row[col]);
        else if (base && Number(base[col])) rate = Number(base[col]) * lineFactor / (Number(base.conversion_factor) || 1);
        else rate = (Number(product[col]) || Number(product.sales_rate_sr1) || 0) * lineFactor;
    }
    rate = r4(rate);
    if (forcedTier >= 1 && forcedTier <= 5 && rateSource !== 'entry_rate_type') rateSource = 'sr';

    // discount
    let discountPercent = 0, discountSource = null, hasSlabs = false, effectOnRate = false, rule = null, termOk = false;
    if (customer && customer.discount_group_id) {
        const { data: grp } = await c.from('discount_groups').select('*').eq('id', customer.discount_group_id).maybeSingle();
        termOk = !!grp && grp.is_active !== false && (!grp.payment_term || grp.payment_term === 'any' || !payTerm || grp.payment_term === payTerm
            || (grp.payment_term === 'credit' && String(payTerm).startsWith('credit'))
            || (/^credit_\d+$/.test(grp.payment_term) && /^credit_\d+$/.test(payTerm) && Number(payTerm.slice(7)) <= Number(grp.payment_term.slice(7))));
        if (termOk) {
            effectOnRate = !!grp.effect_on_rate;
            const { data: rules } = await c.from('discount_group_rules').select('*').eq('tenant_id', t).eq('discount_group_id', grp.id);
            const mine = (rules || []).filter(x => !x.product_id || x.product_id === productId);
            hasSlabs = mine.some(x => Number(x.from_value) > 0 || x.to_value !== null);
            const lineQty = qty === null ? 1 : qty;
            const measure = x => {
                const q2 = x.unit_id ? lineQty * lineFactor / factorOf(unitRows, x.unit_id) : lineQty;
                return x.basis === 'value' ? lineQty * rate : q2;
            };
            const fits = mine.filter(x => { const m = measure(x); return m >= Number(x.from_value || 0) && (x.to_value === null || m <= Number(x.to_value)); });
            const gross = lineQty * rate;
            const pctOf = x => {
                if (x.discount_percent) return Number(x.discount_percent);
                if (x.rate_per_qty) return rate ? ((x.unit_id ? Number(x.rate_per_qty) * lineFactor / factorOf(unitRows, x.unit_id) : Number(x.rate_per_qty)) / rate) * 100 : 0;
                return gross ? (Number(x.fixed_amount || 0) / gross) * 100 : 0;
            };
            // a rule for this product beats a rule for every product; then the bigger discount
            fits.sort((a, b) => (b.product_id ? 1 : 0) - (a.product_id ? 1 : 0) || pctOf(b) - pctOf(a) || a.serial_no - b.serial_no);
            rule = fits[0] || null;
            if (rule) { discountPercent = pctOf(rule); discountSource = 'discount_category'; }
        }
        if (termOk && !rule && product.product_company_id) {
            const { data: cell } = await c.from('discount_matrix').select('discount_percent').eq('discount_group_id', customer.discount_group_id).eq('product_company_id', product.product_company_id).maybeSingle();
            if (cell && Number(cell.discount_percent)) { discountPercent = Number(cell.discount_percent); discountSource = 'company_matrix'; }
        }
    }
    discountPercent = Math.min(100, Math.max(0, r4(discountPercent)));
    const out = { rate, list_rate: rate, sr_tier: srTier, unit_id: unitId, rate_source: rateSource, discount_percent: discountPercent, discount_source: discountSource, has_slabs: hasSlabs, effect_on_rate: false, rule_id: rule ? rule.id : null };
    if (effectOnRate && discountPercent && discountSource === 'discount_category') {
        out.rate = r4(rate * (1 - discountPercent / 100));
        out.discount_percent = 0;
        out.effect_on_rate = true;
    }
    return out;
}

/** the rate type (Sr tier) a customer bills at: its rate category's tier, else the first enabled type */
async function customerRateType(c, t, customerId) {
    const types = await rateTypes(c, t);
    let tier = 1, category = null;
    if (customerId) {
        const { data: customer } = await c.from('ledger_accounts').select('rate_category_id').eq('tenant_id', t).eq('id', customerId).maybeSingle();
        if (customer && customer.rate_category_id) {
            const { data: cat } = await c.from('rate_categories').select('category_name, sr_tier, is_active').eq('id', customer.rate_category_id).maybeSingle();
            if (cat && cat.is_active !== false) { tier = cat.sr_tier || 1; category = cat.category_name; }
        }
    }
    if (!types.find(x => x.sr === tier && x.enabled)) tier = (types.find(x => x.enabled) || { sr: 1 }).sr;
    return { sr_tier: tier, rate_category: category, rate_types: types };
}

module.exports = { customerRateType, DEFAULT_RATE_TYPES, PAYMENT_TERMS, cleanRateTypes, rateTypes, saveRateTypes, rateCategory, saveRateCategoryItems, discountGroup, saveDiscountRules, groupFields, resolve };
