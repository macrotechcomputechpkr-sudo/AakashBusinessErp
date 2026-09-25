// =============================================
// utils/purchaseBillImport.js
// Purchase Bill from a JPG / PNG / WEBP / PDF of the supplier's bill.
//
// 1. Read - Claude (vision / PDF input, structured JSON output) returns the
//    vendor (name, PAN), bill no, date, lines (text, qty, unit, rate,
//    discount, amount) and totals. Needs ANTHROPIC_API_KEY on the server.
// 2. Vendor - PAN printed on the bill = ledger's VAT/PAN number; else a
//    ledger tag equal to the PAN or the vendor name; else name similarity.
// 3. Lines - per line, in order:
//      remembered  - this vendor's same item text was mapped before
//                    (purchase_import_item_map, saved when the user confirms)
//      suggested   - product code in the text, or product name / short name /
//                    tags at least 60% similar (best candidate pre-selected)
//      new         - nothing reaches 60%: the closest products are offered
//                    to map to, or a new product with the bill's name / unit
// 4. Unit - the printed unit matched to Product Units by name / symbol /
//    common aliases (pcs, nos, ctn ...), preferring the product's own units.
// The screen then creates any new products (normal Product API), a DRAFT
// Purchase Bill (normal Purchase Bill API) and saves the confirmed mappings.
// =============================================
const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default || AnthropicModule;
const bsCalendar = require('./bsCalendar');
const { nepaliDateConverter } = require('./nepaliDateUtils');

const MATCH_AT = 0.6;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

// ---------------- reading the bill ----------------
const MEDIA = { 'image/jpeg': 'image', 'image/jpg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image', 'application/pdf': 'document' };
const str = { type: 'string' }, num = { type: 'number' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const BILL_SCHEMA = obj({
    vendor_name: str, vendor_pan: str, vendor_address: str, vendor_phone: str,
    buyer_name: str, buyer_pan: str,
    bill_no: str, bill_date_ad: str, bill_date_bs: str, currency: str,
    items: { type: 'array', items: obj({ description: str, product_code: str, hs_code: str, batch_no: str, qty: num, free_qty: num, unit: str, rate: num, discount_amount: num, amount: num }) },
    subtotal: num, discount_total: num, taxable_amount: num, non_taxable_amount: num, vat_amount: num,
    other_charges: { type: 'array', items: obj({ name: str, amount: num }) },
    grand_total: num, notes: str
});
const PROMPT = `This is a supplier's purchase bill / tax invoice (usually from Nepal). Read it and fill the JSON exactly as printed.
- vendor_* = the SELLER who issued the bill; buyer_* = who it is billed to. PAN / VAT numbers: digits only.
- bill_date_ad: the date as YYYY-MM-DD only if it is an AD (Gregorian) date; bill_date_bs: the Bikram Sambat date as YYYY-MM-DD if a BS date is printed. Leave a field "" when not printed.
- items: one entry per product line, in order. description = the product text as printed (keep brand, size, pack). qty and rate as numbers; unit as printed (Pcs, Box, Ctn, Kg, Ltr ...); amount = the line amount as printed before VAT. Use 0 for numbers that are not printed.
- other_charges: freight, insurance, round-off etc. printed below the lines (negative for deductions).
- Never invent values that are not on the bill.`;

async function readBill({ media_type, data }) {
    const kind = MEDIA[String(media_type || '').toLowerCase()];
    if (!kind) throw httpError('Upload a JPG, PNG, WEBP or PDF file');
    if (!data || typeof data !== 'string') throw httpError('The file is empty');
    const b64 = data.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    if (b64.length * 0.75 > 25 * 1024 * 1024) throw httpError('File too large - keep it under 25 MB');
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw httpError('Bill reading is not set up: add ANTHROPIC_API_KEY to the server .env', 503);

    const client = new Anthropic();
    const source = kind === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: media_type === 'image/jpg' ? 'image/jpeg' : media_type, data: b64 } }
        : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
    let response;
    try {
        response = await client.beta.messages.create({
            model: 'claude-opus-5',
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { format: { type: 'json_schema', schema: BILL_SCHEMA } },
            messages: [{ role: 'user', content: [source, { type: 'text', text: PROMPT }] }]
        });
    } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw httpError('Bill reading: the ANTHROPIC_API_KEY is not valid', 503);
        if (err instanceof Anthropic.RateLimitError) throw httpError('Bill reading is busy - try again in a minute', 429);
        if (err instanceof Anthropic.BadRequestError) throw httpError(`Bill reading could not use this file: ${err.message}`);
        if (err instanceof Anthropic.APIError) throw httpError(`Bill reading failed (${err.status}): ${err.message}`, 502);
        throw err;
    }
    if (response.stop_reason === 'refusal') throw httpError('The bill could not be read (declined)', 422);
    if (response.stop_reason === 'max_tokens') throw httpError('The bill has too many lines to read at once - split the PDF', 422);
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try { return JSON.parse(text); } catch { throw httpError('The bill could not be read - try a clearer image', 422); }
}

// ---------------- matching ----------------
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/\D/g, '');
const bigrams = s => { const x = s.replace(/ /g, ''); const out = []; for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2)); return out; };
function dice(a, b) {
    const A = bigrams(a), B = bigrams(b);
    if (!A.length || !B.length) return a && a === b ? 1 : 0;
    const counts = {};
    A.forEach(g => { counts[g] = (counts[g] || 0) + 1; });
    let hit = 0;
    B.forEach(g => { if (counts[g]) { counts[g]--; hit++; } });
    return (2 * hit) / (A.length + B.length);
}
// Similarity 0..1 of two texts: character bigrams and whole words, whichever is higher.
function similarity(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const tx = x.split(' '), ty = y.split(' ');
    const common = tx.filter(w => ty.includes(w)).length;
    const words = common / Math.max(tx.length, ty.length);
    const contained = (x.includes(y) || y.includes(x)) ? Math.min(x.length, y.length) / Math.max(x.length, y.length) * 0.5 + 0.5 : 0;
    return Math.max(dice(x, y), words, contained);
}

const UNIT_ALIASES = { pcs: ['pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'nos.', 'unit', 'units', 'ea', 'each'], box: ['box', 'boxes', 'bx'], carton: ['ctn', 'ctns', 'carton', 'cartons', 'cs', 'case'],
    kg: ['kg', 'kgs', 'kilogram'], gm: ['g', 'gm', 'gms', 'gram', 'grams'], ltr: ['l', 'lt', 'ltr', 'ltrs', 'litre', 'liter'], ml: ['ml'], dozen: ['dz', 'doz', 'dozen'],
    packet: ['pkt', 'pkts', 'packet', 'pack', 'pk'], bottle: ['btl', 'bottle'], bag: ['bag', 'bags'], set: ['set', 'sets'], meter: ['m', 'mtr', 'meter', 'metre'], roll: ['roll', 'rolls'] };
const unitKey = s => { const n = norm(s).replace(/ /g, ''); if (!n) return ''; for (const [k, list] of Object.entries(UNIT_ALIASES)) if (list.includes(n)) return k; return n; };

async function loadMatchData(c, t) {
    const [products, rates, units, ledgers, groups] = await Promise.all([
        fetchAll(() => c.from('products').select('id, product_code, product_name, short_name, tags, base_unit_id, is_active').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('product_unit_rates').select('product_id, unit_id, conversion_factor, is_base_unit, purchase_rate, last_purchase_rate').eq('tenant_id', t).order('product_id')),
        fetchAll(() => c.from('product_units').select('id, unit_name, unit_symbol').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('ledger_accounts').select('id, account_code, account_name, vat_pan_number, tags, account_group_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('account_groups').select('id, group_code, parent_group_id').eq('tenant_id', t).order('id'))
    ]);
    return { products, rates, units, ledgers, groups };
}

function matchUnit(text, units, productUnitIds) {
    const k = unitKey(text);
    if (!k) return null;
    const hits = units.filter(u => unitKey(u.unit_name) === k || unitKey(u.unit_symbol) === k);
    return hits.find(u => productUnitIds?.includes(u.id)) || hits[0] || null;
}

function matchVendor(bill, data) {
    const payables = new Set();
    const byId = Object.fromEntries(data.groups.map(g => [g.id, g]));
    data.groups.forEach(g => { let x = g, guard = 0; while (x && guard++ < 20) { if (x.group_code === 'PAYABLES') { payables.add(g.id); break; } x = byId[x.parent_group_id]; } });
    const pan = digits(bill.vendor_pan);
    const name = bill.vendor_name || '';
    if (pan.length >= 6) {
        const byPan = data.ledgers.find(l => digits(l.vat_pan_number) === pan);
        if (byPan) return { ledger_id: byPan.id, ledger_name: byPan.account_name, by: 'pan', score: 1, candidates: [] };
        const byTag = data.ledgers.find(l => (l.tags || []).some(tg => digits(tg) === pan));
        if (byTag) return { ledger_id: byTag.id, ledger_name: byTag.account_name, by: 'tag (PAN)', score: 1, candidates: [] };
    }
    const scored = data.ledgers.map(l => ({ l, s: Math.max(similarity(name, l.account_name), ...(l.tags || []).map(tg => similarity(name, tg))) + (payables.has(l.account_group_id) ? 0.05 : 0) }))
        .filter(x => x.s >= 0.3).sort((a, b) => b.s - a.s).slice(0, 6);
    const tagHit = data.ledgers.find(l => (l.tags || []).some(tg => norm(tg) && norm(tg) === norm(name)));
    if (tagHit) return { ledger_id: tagHit.id, ledger_name: tagHit.account_name, by: 'tag (name)', score: 1, candidates: scored.map(x => ({ id: x.l.id, name: x.l.account_name, score: round2(Math.min(1, x.s)) })) };
    const best = scored[0];
    return { ledger_id: best && best.s >= MATCH_AT ? best.l.id : null, ledger_name: best && best.s >= MATCH_AT ? best.l.account_name : null,
        by: best && best.s >= MATCH_AT ? 'name' : null, score: best ? round2(Math.min(1, best.s)) : 0,
        candidates: scored.map(x => ({ id: x.l.id, name: x.l.account_name, score: round2(Math.min(1, x.s)) })),
        pan_not_found: pan.length >= 6 ? pan : null };
}

function matchLines(bill, data, learned) {
    const unitsOf = {};
    data.rates.forEach(r => (unitsOf[r.product_id] = unitsOf[r.product_id] || []).push(r));
    const active = data.products.filter(p => p.is_active !== false);
    const unitName = id => { const u = data.units.find(x => x.id === id); return u ? u.unit_name : ''; };
    return (bill.items || []).map((it, index) => {
        const text = it.description || '';
        const key = norm(text);
        const candidates = [];
        const mem = learned[key];
        if (mem && data.products.some(p => p.id === mem.product_id)) candidates.push({ product_id: mem.product_id, score: 1, by: 'remembered', unit_id: mem.unit_id || null });
        const code = norm(it.product_code);
        active.forEach(p => {
            if (candidates.some(x => x.product_id === p.id)) return;
            let score = 0, by = 'name';
            if (code && norm(p.product_code) === code) { score = 0.97; by = 'code'; }
            else if (p.product_code && key.split(' ').includes(norm(p.product_code)) && norm(p.product_code).length >= 3) { score = 0.95; by = 'code'; }
            else {
                const s1 = similarity(text, p.product_name), s2 = p.short_name ? similarity(text, p.short_name) : 0;
                const s3 = Math.max(0, ...(p.tags || []).map(tg => similarity(text, tg)));
                score = Math.max(s1, s2, s3); by = s3 > Math.max(s1, s2) ? 'tag' : 'name';
            }
            if (score >= 0.3) candidates.push({ product_id: p.id, score: round2(score), by });
        });
        candidates.sort((a, b) => b.score - a.score);
        const top = candidates.slice(0, 5).map(x => {
            const p = data.products.find(pp => pp.id === x.product_id);
            return { ...x, product_code: p.product_code, product_name: p.product_name, base_unit_id: p.base_unit_id, base_unit: unitName(p.base_unit_id) };
        });
        const best = top[0] && top[0].score >= MATCH_AT ? top[0] : null;
        const productUnits = best ? (unitsOf[best.product_id] || []).map(r => r.unit_id) : null;
        const unit = (best?.unit_id && data.units.find(u => u.id === best.unit_id)) || matchUnit(it.unit, data.units, productUnits);
        const unitOk = !best || !unit || productUnits.includes(unit.id);
        return {
            index, description: text, product_code: it.product_code || '', hs_code: it.hs_code || '', batch_no: it.batch_no || '',
            qty: Number(it.qty) || 0, free_qty: Number(it.free_qty) || 0, unit_text: it.unit || '', rate: Number(it.rate) || 0,
            discount_amount: Number(it.discount_amount) || 0, amount: Number(it.amount) || 0,
            status: best ? (best.by === 'remembered' ? 'remembered' : 'suggested') : 'new',
            product_id: best ? best.product_id : null, suggestions: top,
            unit_id: unit && unitOk ? unit.id : (best ? best.base_unit_id : unit?.id || null), unit_matched: unit ? unit.unit_name : null,
            unit_warning: best && unit && !unitOk ? `${unit.unit_name} is not a unit of ${best.product_name} - base unit used` : null,
            new_product: { product_name: text.trim(), unit_id: unit?.id || null, unit_text: it.unit || '', rate: Number(it.rate) || 0, hs_code: it.hs_code || '' }
        };
    });
}

function billDate(bill) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(bill.bill_date_ad || '') && Number(bill.bill_date_ad.slice(0, 4)) < 2060) return { ad: bill.bill_date_ad, from: 'bill (AD)' };
    const bs = bill.bill_date_bs || (Number(String(bill.bill_date_ad).slice(0, 4)) >= 2060 ? bill.bill_date_ad : '');
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(bs || '');
    // Only an exact conversion (nepali-date-converter) is used - the built-in
    // approximation can be weeks off, so the user enters the date instead.
    if (m && bsCalendar.available()) {
        const ad = nepaliDateConverter.toEnglish(m[1], m[2], m[3])?.formatted;
        if (ad) return { ad, from: `bill (BS ${bs})` };
    }
    return { ad: null, from: null, bs: bs || null };
}

async function extractPurchaseBill(c, t, body) {
    const bill = await readBill(body);
    const data = await loadMatchData(c, t);
    const vendor = matchVendor(bill, data);
    let learned = {};
    if (vendor.ledger_id) {
        const rows = await fetchAll(() => c.from('purchase_import_item_map').select('item_text, product_id, unit_id').eq('tenant_id', t).eq('vendor_ledger_id', vendor.ledger_id).order('id'));
        learned = Object.fromEntries(rows.map(r => [r.item_text, r]));
    }
    const lines = matchLines(bill, data, learned);
    const date = billDate(bill);
    const lineTotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const warnings = [];
    if (vendor.pan_not_found) warnings.push(`No ledger has PAN ${vendor.pan_not_found} - choose the vendor (and add the PAN to its ledger so the next bill matches).`);
    if (bill.subtotal && Math.abs(lineTotal - bill.subtotal) > 1) warnings.push(`Line amounts add up to ${lineTotal}, the bill's sub-total is ${bill.subtotal} - check the lines.`);
    if (!date.ad) warnings.push(date.bs ? `Bill date is BS ${date.bs} - enter it (exact BS conversion needs the nepali-date-converter package).` : 'Bill date not read - enter it.');
    return { bill, vendor, lines, bill_date: date.ad, bill_date_from: date.from, bill_date_bs: bill.bill_date_bs || date.bs || null, line_total: lineTotal, match_at: MATCH_AT, warnings,
        counts: { remembered: lines.filter(l => l.status === 'remembered').length, suggested: lines.filter(l => l.status === 'suggested').length, new: lines.filter(l => l.status === 'new').length } };
}

// Re-run the line matching for another vendor (the user picked a different one).
async function rematchLines(c, t, body) {
    const data = await loadMatchData(c, t);
    let learned = {};
    if (body.vendor_ledger_id) {
        const rows = await fetchAll(() => c.from('purchase_import_item_map').select('item_text, product_id, unit_id').eq('tenant_id', t).eq('vendor_ledger_id', body.vendor_ledger_id).order('id'));
        learned = Object.fromEntries(rows.map(r => [r.item_text, r]));
    }
    return { lines: matchLines({ items: body.items || [] }, data, learned) };
}

// Remember the confirmed product (and unit) of each line for this vendor.
async function learnMappings(c, t, userId, body) {
    const vendor = body.vendor_ledger_id || null;
    const maps = (body.mappings || []).filter(m => m.product_id && norm(m.item_text));
    for (const m of maps) {
        const item = norm(m.item_text).slice(0, 300);
        const { data: existing } = await c.from('purchase_import_item_map').select('id, use_count').eq('tenant_id', t).eq('item_text', item)
            [vendor ? 'eq' : 'is']('vendor_ledger_id', vendor).maybeSingle();
        if (existing) await c.from('purchase_import_item_map').update({ product_id: m.product_id, unit_id: m.unit_id || null, use_count: (existing.use_count || 0) + 1, last_used_at: new Date().toISOString() }).eq('id', existing.id);
        else await c.from('purchase_import_item_map').insert({ tenant_id: t, vendor_ledger_id: vendor, item_text: item, product_id: m.product_id, unit_id: m.unit_id || null, created_by: userId });
    }
    return { saved: maps.length };
}

module.exports = { extractPurchaseBill, rematchLines, learnMappings, similarity, matchVendor, matchLines, readBill, BILL_SCHEMA };
