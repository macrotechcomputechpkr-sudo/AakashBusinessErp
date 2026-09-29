// =============================================
// utils/vatAnnex.js
// Advanced VAT reports (VatReports.jsx), all from the same documents as
// the VAT register (vatReportRoutes.loadTaxDocs), net of what is included:
//   annex13              Annexure 13 - per party: opening balance, capital /
//                        other / goods purchase, capital / other / goods sales,
//                        closing balance, Debtor / Creditor, PAN
//                        goods = inventory items, capital = fixed-asset items /
//                        capital JVs, other = services / non-inventory items,
//                        additional bills, JVs, debit / credit notes
//   monthlySalesPurchase month-wise Sales (invoices, total, non-taxable, export,
//                        taxable, tax) and Purchase (invoices, total, non-taxable,
//                        taxable, tax, import taxable, import tax) side by side
//   partySummary         party-wise taxable / exempted, sales and purchase combined
// Flags (query, 'false' leaves a kind out): include_purchase_return,
// include_sales_return, include_debit_note, include_credit_note,
// include_additional (purchase / sales additional bills), include_jv.
// Export = a sales document in a foreign currency; import = the import
// taxable of a purchase bill and the Customs (Bhansar) rows.
// =============================================
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const on = (q, k) => q[k] !== 'false';

async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...((await fn(ids.slice(i, i + size))) || []));
    return out;
}
const vat = () => require('../routes/vatReportRoutes')._internals;

// which document kinds a report takes, with their sign
function kinds(q) {
    const k = [['sales', 1], ['purchase', 1]];
    if (on(q, 'include_sales_return')) k.push(['sales_return', -1]);
    if (on(q, 'include_purchase_return')) k.push(['purchase_return', -1]);
    if (on(q, 'include_credit_note')) k.push(['credit_note', -1]);
    if (on(q, 'include_debit_note')) k.push(['debit_note', -1]);
    if (on(q, 'include_jv')) k.push(['jv_sales', 1], ['jv_purchase', 1]);
    if (on(q, 'include_additional')) k.push(['purchase_expense', 1]);
    return k;
}

// ---------- Annexure 13 ----------
const NATURE = t => (t === 'fixed_asset' ? 'capital' : t === 'service' || t === 'non_inventory' ? 'other' : 'goods');
async function annex13(c, t, q) {
    const { loadTaxDocs, VAT_DOCS } = vat();
    const from = q.date_from, to = q.date_to;
    const acc = {};
    const row = (id, name, pan) => (acc[id] = acc[id] || { party_ledger_id: id && !String(id).startsWith('cash:') ? id : null, party_name: name, party_pan: pan || '',
        capital_purchase: 0, other_purchase: 0, goods_purchase: 0, capital_sales: 0, other_sales: 0, goods_sales: 0, vat_purchase: 0, vat_sales: 0 });
    const add = (d, side, nature, amt) => {
        const r = row(d.party_ledger_id || `cash:${d.party_name}`, d.party_name, d.party_pan);
        if (!r.party_pan && d.party_pan) r.party_pan = d.party_pan;
        r[`${nature}_${side}`] = round2(r[`${nature}_${side}`] + amt);
    };
    const itemType = {};
    for (const [type, sign] of kinds(q)) {
        const cfg = VAT_DOCS[type], side = cfg.side === 'sales' ? 'sales' : 'purchase';
        const docs = await loadTaxDocs(c, t, type, { dateFrom: from, dateTo: to });
        if (!docs.length) continue;
        if (['sales', 'purchase', 'sales_return', 'purchase_return'].includes(type)) {
            // split each document's value (without VAT) over its lines' nature, by line value
            const lines = await inChunks(docs.map(d => d.id), async ch => (await c.from(cfg.detail).select(`${cfg.fk}, product_id, amount, tax_amount`).in(cfg.fk, ch)).data);
            const need = [...new Set(lines.map(l => l.product_id).filter(id => id && !(id in itemType)))];
            (await inChunks(need, async ch => (await c.from('products').select('id, item_type').in('id', ch)).data)).forEach(p => { itemType[p.id] = p.item_type; });
            docs.forEach(d => {
                const value = sign * (d.taxable + d.exempt), mine = lines.filter(l => l[cfg.fk] === d.id);
                const w = mine.reduce((s, l) => s + Math.max(0, Number(l.amount || 0) - Number(l.tax_amount || 0)), 0);
                const split = { goods: 0, capital: 0, other: 0 };
                if (w > 0) mine.forEach(l => { split[NATURE(itemType[l.product_id])] += value * Math.max(0, Number(l.amount || 0) - Number(l.tax_amount || 0)) / w; });
                else split.goods = value;
                Object.entries(split).forEach(([n, v]) => { if (v) add(d, side, n, v); });
                const r = row(d.party_ledger_id || `cash:${d.party_name}`, d.party_name, d.party_pan); r[`vat_${side}`] = round2(r[`vat_${side}`] + sign * d.vat);
            });
        } else {
            let jv = {};
            if (type.startsWith('jv_')) jv = Object.fromEntries((await inChunks(docs.map(d => d.id), async ch => (await c.from('journal_vouchers').select('id, jv_type, is_capital').in('id', ch)).data)).map(j => [j.id, j]));
            docs.forEach(d => {
                const j = jv[d.id] || {};
                const nature = type.startsWith('jv_') ? (String(j.jv_type || '').startsWith('asset') || j.is_capital ? 'capital' : String(j.jv_type || '').startsWith('inventory') ? 'goods' : 'other') : 'other';
                add(d, side, nature, sign * (d.taxable + d.exempt));
                const r = row(d.party_ledger_id || `cash:${d.party_name}`, d.party_name, d.party_pan); r[`vat_${side}`] = round2(r[`vat_${side}`] + sign * d.vat);
            });
        }
    }
    // sales additional bills (freight / service charged to the customer): other sales
    if (on(q, 'include_additional')) {
        let sq = c.from('sales_additional_entries').select('id, customer_ledger_id, customer_name_snapshot, total_amount, doc_date').eq('tenant_id', t).eq('status', 'posted');
        if (from) sq = sq.gte('doc_date', from);
        if (to) sq = sq.lte('doc_date', to);
        const { data } = await sq.limit(20000);
        (data || []).forEach(e => add({ party_ledger_id: e.customer_ledger_id, party_name: e.customer_name_snapshot || '' }, 'sales', 'other', Number(e.total_amount) || 0));
    }
    // ledger code / PAN / Debtor-Creditor and the balances from the general ledger
    const ids = Object.values(acc).map(r => r.party_ledger_id).filter(Boolean);
    const leds = await inChunks(ids, async ch => (await c.from('ledger_accounts').select('id, account_code, account_name, pan_number, vat_pan_number, account_group_id').in('id', ch)).data);
    const ledById = Object.fromEntries(leds.map(l => [l.id, l]));
    const { loadGroups, ledgerBalances } = require('./financialEngine');
    const [groups, bal] = q.hide_opening_closing === 'true' ? [{}, {}] : await Promise.all([loadGroups(c, t), ledgerBalances(c, t, { from, to })]);
    let rows = Object.values(acc).map(r => {
        const l = ledById[r.party_ledger_id] || {}, b = bal[r.party_ledger_id] || {};
        const anchor = groups[l.account_group_id]?.anchor;
        const closing = round2(b.closing || 0);
        const total_purchase = round2(r.capital_purchase + r.other_purchase + r.goods_purchase), total_sales = round2(r.capital_sales + r.other_sales + r.goods_sales);
        return { ...r, party_code: l.account_code || '', party_name: l.account_name || r.party_name, party_pan: l.vat_pan_number || l.pan_number || r.party_pan || '',
            debtor_creditor: anchor === 'RECEIVABLES' ? 'D' : anchor === 'PAYABLES' ? 'C' : (total_sales >= total_purchase ? 'D' : 'C'),
            opening_balance: round2(b.opening || 0), closing_balance: closing, total_purchase, total_sales };
    });
    const min = Number(q.min_amount) || 0;
    if (min > 0) rows = rows.filter(r => Math.max(Math.abs(r.total_purchase), Math.abs(r.total_sales), Math.abs(r.closing_balance)) >= min);
    rows = rows.filter(r => r.total_purchase || r.total_sales);
    if (q.pan === 'with') rows = rows.filter(r => r.party_pan);
    if (q.pan === 'without') rows = rows.filter(r => !r.party_pan);
    const sorters = { name: (a, b) => a.party_name.localeCompare(b.party_name), code: (a, b) => String(a.party_code).localeCompare(String(b.party_code), undefined, { numeric: true }),
        pan: (a, b) => String(a.party_pan).localeCompare(String(b.party_pan)), amount: (a, b) => (b.total_purchase + b.total_sales) - (a.total_purchase + a.total_sales) };
    rows.sort(sorters[q.sort_on] || sorters.name);
    const keys = ['opening_balance', 'capital_purchase', 'other_purchase', 'goods_purchase', 'capital_sales', 'other_sales', 'goods_sales', 'closing_balance', 'total_purchase', 'total_sales', 'vat_purchase', 'vat_sales'];
    const totals = Object.fromEntries(keys.map(k => [k, round2(rows.reduce((s, r) => s + (r[k] || 0), 0))]));
    return { from, to, rows, totals, count: rows.length, included: kinds(q).map(([k]) => k) };
}

// ---------- Month-wise sales / purchase ----------
async function monthlySalesPurchase(c, t, q) {
    const { loadTaxDocs, loadPeriods, periodKeyOf, VAT_DOCS } = vat();
    const periods = await loadPeriods(c, t);
    const from = q.date_from, to = q.date_to;
    const months = new Map();
    // every configured month of the range, empty ones too
    periods.filter(p => (!from || p.end_date >= from) && (!to || p.start_date <= to)).forEach(p => {
        const k = periodKeyOf(p.start_date, periods);
        months.set(k.key, { period_key: k.key, label: k.label, label_np: k.label_np });
    });
    const S = () => ({ count: 0, total: 0, non_taxable: 0, export: 0, taxable: 0, tax: 0 });
    const P = () => ({ count: 0, total: 0, non_taxable: 0, taxable: 0, tax: 0, import_taxable: 0, import_tax: 0 });
    const month = d => {
        const k = periodKeyOf(String(d.doc_date).slice(0, 10), periods);
        if (!months.has(k.key)) months.set(k.key, { period_key: k.key, label: k.label, label_np: k.label_np });
        const m = months.get(k.key);
        m.sales = m.sales || S(); m.purchase = m.purchase || P();
        return m;
    };
    for (const [type, sign] of kinds(q)) {
        const cfg = VAT_DOCS[type];
        (await loadTaxDocs(c, t, type, { dateFrom: from, dateTo: to })).forEach(d => {
            const m = month(d);
            if (cfg.side === 'sales') {
                const s = m.sales;
                if (sign > 0) s.count += 1;
                s.total = round2(s.total + sign * d.total);
                if (d.is_export) s.export = round2(s.export + sign * (d.taxable + d.exempt));
                else { s.taxable = round2(s.taxable + sign * d.taxable); s.non_taxable = round2(s.non_taxable + sign * d.exempt); }
                s.tax = round2(s.tax + sign * d.vat);
            } else {
                const p = m.purchase;
                if (sign > 0) p.count += 1;
                p.total = round2(p.total + sign * d.total);
                const impTax = round2(d.import_taxable || 0);
                const impVat = d.is_import ? d.vat : (d.taxable > 0 ? round2(d.vat * Math.min(1, impTax / d.taxable)) : 0);
                p.import_taxable = round2(p.import_taxable + sign * impTax); p.import_tax = round2(p.import_tax + sign * impVat);
                p.taxable = round2(p.taxable + sign * (d.taxable - impTax)); p.tax = round2(p.tax + sign * (d.vat - impVat));
                p.non_taxable = round2(p.non_taxable + sign * d.exempt);
            }
        });
    }
    const rows = [...months.values()].map(m => ({ ...m, sales: m.sales || S(), purchase: m.purchase || P() })).sort((a, b) => String(a.period_key).localeCompare(String(b.period_key)));
    const sum = (side, mk) => Object.fromEntries(Object.keys(mk()).map(k => [k, round2(rows.reduce((s, r) => s + r[side][k], 0))]));
    return { from, to, rows, totals: { sales: sum('sales', S), purchase: sum('purchase', P) }, periods_configured: periods.length > 0, included: kinds(q).map(([k]) => k) };
}

// ---------- Party-wise VAT summary (sales / purchase combined) ----------
async function partySummary(c, t, q) {
    const { loadTaxDocs, VAT_DOCS } = vat();
    const map = {};
    const sides = q.side === 'sales' ? ['sales'] : q.side === 'purchase' ? ['purchase'] : ['sales', 'purchase'];
    for (const [type, sign] of kinds(q)) {
        const cfg = VAT_DOCS[type];
        if (!sides.includes(cfg.side)) continue;
        (await loadTaxDocs(c, t, type, { dateFrom: q.date_from, dateTo: q.date_to })).forEach(d => {
            const k = `${cfg.side}|${d.party_ledger_id || 'cash:' + d.party_name}`;
            const r = map[k] = map[k] || { side: cfg.side, ps: cfg.side === 'sales' ? 'S' : 'P', party_ledger_id: d.party_ledger_id, party_name: d.party_name, party_pan: d.party_pan || '', bills: 0, taxable: 0, exempt: 0, vat: 0, total: 0, import_taxable: 0 };
            if (!r.party_pan && d.party_pan) r.party_pan = d.party_pan;
            if (sign > 0) r.bills += 1;
            r.taxable = round2(r.taxable + sign * d.taxable); r.exempt = round2(r.exempt + sign * d.exempt);
            r.vat = round2(r.vat + sign * d.vat); r.total = round2(r.total + sign * d.total); r.import_taxable = round2(r.import_taxable + sign * (d.import_taxable || 0));
        });
    }
    let rows = Object.values(map);
    const min = Number(q.min_amount) || 0;
    if (min > 0) rows = rows.filter(r => Math.abs(r.taxable + r.exempt) >= min);
    if (q.pan === 'with') rows = rows.filter(r => r.party_pan);
    if (q.pan === 'without') rows = rows.filter(r => !r.party_pan);
    const sorters = { name: (a, b) => a.party_name.localeCompare(b.party_name) || a.ps.localeCompare(b.ps), pan: (a, b) => String(a.party_pan).localeCompare(String(b.party_pan)), amount: (a, b) => (b.taxable + b.exempt) - (a.taxable + a.exempt) };
    rows.sort(sorters[q.sort_on] || sorters.name);
    const keys = ['bills', 'taxable', 'exempt', 'vat', 'total', 'import_taxable'];
    const tot = side => Object.fromEntries(keys.map(k => [k, round2(rows.filter(r => !side || r.side === side).reduce((s, r) => s + r[k], 0))]));
    return { rows, totals: { all: tot(), sales: tot('sales'), purchase: tot('purchase') }, included: kinds(q).map(([k]) => k) };
}

module.exports = { annex13, monthlySalesPurchase, partySummary, kinds };
