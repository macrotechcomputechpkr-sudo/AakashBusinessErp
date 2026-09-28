// =============================================
// utils/construction.js
// Construction management (System Control > Business Nature = Construction).
//   sites        contract sites - own contracts ('main') and sub-contracts
//                taken from a main contractor ('sub', petti thekka leko);
//                each with its own Cost Center
//   boq          contract items (description, unit, qty, rate)
//   RA bills     running bills to the client / main contractor: work done,
//                VAT, retention, TDS, advance recovery -> posted to the GL
//   materials    issued to the site from store, or straight from a purchase
//                bill at the bill price (consumption Stock Adjustment with the
//                site cost center); returns from the site come back in
//   wages        labour wage sheets (worker, trade, days x rate + OT)
//   sub-contracts petti thekka given out and the sub-contractor's bills
//   other cost   any voucher booked with the site's cost center
// Site profit = work billed + other income - (material + wages + sub-contract
// + other cost). Budget vs actual per head.
// =============================================
const P = require('./poultry');
const { toBaseUnitQty } = require('./unitConversion');
const { defaultVatLedger } = require('./vatLedger');

const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const UUID = /^[0-9a-f-]{36}$/i;
const today = () => new Date().toISOString().slice(0, 10);
const num = v => Number(v) || 0;
const idOrNull = v => (v && UUID.test(String(v)) ? v : null);
const DAY = 86400000;
const iso = n => new Date(n).toISOString().slice(0, 10);
const SA = () => require('../routes/stockAdjustmentRoutes');

async function requireOn(c, t) {
    const f = await P.features(c, t);
    if (!f.construction?.enabled) throw httpError('Construction management is off - choose Business Nature "Construction" in System Control', 403);
    return f;
}

// ---------------------------------------------------------------- settings
const LEDGER_KEYS = ['revenue_ledger_id', 'retention_receivable_ledger_id', 'tds_receivable_ledger_id', 'subcontract_cost_ledger_id', 'retention_payable_ledger_id',
    'tds_payable_ledger_id', 'wages_ledger_id', 'wages_payable_ledger_id', 'material_ledger_id'];
async function getSettings(c, t) {
    const { data } = await c.from('construction_settings').select('*').eq('tenant_id', t).maybeSingle();
    const D = { tenant_id: t, default_warehouse_id: null, default_vat_percent: 13, default_retention_percent: 5, default_tds_percent: 1.5 };
    LEDGER_KEYS.forEach(k => { D[k] = null; });
    return { ...D, ...(data || {}) };
}
async function saveSettings(c, t, userId, b) {
    const row = { tenant_id: t, updated_by: userId, updated_at: new Date().toISOString() };
    [...LEDGER_KEYS, 'default_warehouse_id'].forEach(k => { if (k in b) row[k] = idOrNull(b[k]); });
    [['default_vat_percent', 0, 50], ['default_retention_percent', 0, 50], ['default_tds_percent', 0, 50]].forEach(([k, lo, hi]) => { if (k in b) row[k] = Math.min(hi, Math.max(lo, num(b[k]))); });
    const { data: ex } = await c.from('construction_settings').select('tenant_id').eq('tenant_id', t).maybeSingle();
    const { error } = ex ? await c.from('construction_settings').update(row).eq('tenant_id', t) : await c.from('construction_settings').insert(row);
    if (error) throw error;
    return getSettings(c, t);
}

// ---------------------------------------------------------------- sites
async function loadSite(c, t, id) {
    if (!UUID.test(String(id))) throw httpError('Site not found', 404);
    const { data } = await c.from('construction_sites').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!data) throw httpError('Site not found', 404);
    return data;
}
const SITE_NUM = ['contract_amount', 'vat_percent', 'retention_percent', 'tds_percent', 'advance_amount', 'advance_recovery_percent', 'budget_material', 'budget_labour', 'budget_subcontract', 'budget_other'];
async function saveSite(c, t, userId, b, id) {
    await requireOn(c, t);
    const old = id ? await loadSite(c, t, id) : null;
    const S = await getSettings(c, t);
    const row = { tenant_id: t, updated_by: userId, updated_at: new Date().toISOString() };
    const code = String(b.site_code ?? old?.site_code ?? '').trim().toUpperCase().slice(0, 30);
    const name = String(b.site_name ?? old?.site_name ?? '').trim().slice(0, 200);
    if (!code) throw httpError('Site code is required');
    if (!name) throw httpError('Site name is required');
    Object.assign(row, { site_code: code, site_name: name });
    row.contract_type = (b.contract_type ?? old?.contract_type) === 'sub' ? 'sub' : 'main';
    ['employer_name', 'contract_no', 'location', 'site_engineer', 'remarks'].forEach(k => { if (k in b) row[k] = b[k] ? String(b[k]).slice(0, k === 'remarks' ? 2000 : 200) : null; });
    ['contract_date', 'start_date', 'end_date'].forEach(k => { if (k in b) row[k] = b[k] ? String(b[k]).slice(0, 10) : null; });
    ['client_ledger_id', 'warehouse_id'].forEach(k => { if (k in b) row[k] = idOrNull(b[k]); });
    SITE_NUM.forEach(k => { if (k in b) row[k] = round2(b[k]); else if (!old) row[k] = k === 'vat_percent' ? S.default_vat_percent : k === 'retention_percent' ? S.default_retention_percent : k === 'tds_percent' ? S.default_tds_percent : 0; });
    if ('status' in b) row.status = ['active', 'on_hold', 'completed', 'closed'].includes(b.status) ? b.status : 'active';
    if (row.contract_amount < 0) throw httpError('Contract amount cannot be negative');
    const { data: same } = await c.from('construction_sites').select('id').eq('tenant_id', t).eq('site_code', code);
    if ((same || []).some(x => x.id !== id)) throw httpError(`Site code ${code} is already used`);
    if (!old) {
        if (!row.status) row.status = 'active';
        row.cost_center_id = await P.makeCostCenter(c, t, `SITE-${code}`, `Site ${code} - ${name}`, userId);
        row.created_by = userId;
        const { data, error } = await c.from('construction_sites').insert(row).select().single();
        if (error) { if (error.code === '23505') throw httpError(`Site code ${code} is already used`); throw error; }
        return siteDetail(c, t, data.id);
    }
    const { error } = await c.from('construction_sites').update(row).eq('id', id);
    if (error) { if (error.code === '23505') throw httpError(`Site code ${code} is already used`); throw error; }
    return siteDetail(c, t, id);
}

async function saveBoq(c, t, siteId, items) {
    await loadSite(c, t, siteId);
    const rows = (Array.isArray(items) ? items : []).filter(i => i && String(i.description || '').trim()).map((i, k) => ({
        tenant_id: t, site_id: siteId, item_no: i.item_no ? String(i.item_no).slice(0, 30) : null, description: String(i.description).slice(0, 2000), unit: i.unit ? String(i.unit).slice(0, 20) : null,
        qty: num(i.qty), rate: round2(i.rate), amount: round2(num(i.qty) * num(i.rate)), display_order: k + 1, ...(idOrNull(i.id) ? { id: i.id } : {})
    }));
    const { data: old } = await c.from('construction_boq_items').select('id').eq('site_id', siteId);
    const keep = new Set(rows.filter(r => r.id).map(r => r.id));
    const gone = (old || []).map(o => o.id).filter(x => !keep.has(x));
    if (gone.length) {
        const { data: used } = await c.from('construction_ra_bill_lines').select('boq_item_id').in('boq_item_id', gone);
        if ((used || []).length) throw httpError('A BOQ item already billed in a running bill cannot be removed');
        await c.from('construction_boq_items').delete().in('id', gone);
    }
    for (const r of rows) {
        const { id: rowId, ...fields } = r;
        const { error } = rowId && (old || []).some(o => o.id === rowId)
            ? await c.from('construction_boq_items').update(fields).eq('id', rowId)
            : await c.from('construction_boq_items').insert(fields);
        if (error) throw error;
    }
    return boqWithProgress(c, t, siteId);
}
/** BOQ items with qty / amount billed so far (posted RA bills) */
async function boqWithProgress(c, t, siteId, exceptBillId = null) {
    const { data: items } = await c.from('construction_boq_items').select('*').eq('site_id', siteId).order('display_order');
    const { data: bills } = await c.from('construction_ra_bills').select('id, status').eq('site_id', siteId);
    const ids = (bills || []).filter(b => b.status === 'posted' && b.id !== exceptBillId).map(b => b.id);
    const { data: lines } = ids.length ? await c.from('construction_ra_bill_lines').select('boq_item_id, qty, amount').in('bill_id', ids) : { data: [] };
    const done = {};
    (lines || []).forEach(l => { if (l.boq_item_id) { const d = done[l.boq_item_id] = done[l.boq_item_id] || { qty: 0, amount: 0 }; d.qty += num(l.qty); d.amount += num(l.amount); } });
    return (items || []).map(i => ({ ...i, billed_qty: round2(done[i.id]?.qty || 0), billed_amount: round2(done[i.id]?.amount || 0),
        balance_qty: round2(num(i.qty) - (done[i.id]?.qty || 0)), progress_pct: num(i.qty) ? round2((done[i.id]?.qty || 0) * 100 / num(i.qty)) : 0 }));
}

// ---------------------------------------------------------------- GL posting helpers
async function ledgerNames(c, ids) {
    const want = [...new Set(ids.filter(Boolean))];
    const { data } = want.length ? await c.from('ledger_accounts').select('id, account_name').in('id', want) : { data: [] };
    return Object.fromEntries((data || []).map(l => [l.id, l.account_name]));
}
async function postGl(c, t, userId, { type, docId, date, narration, rows }) {
    const lines = rows.filter(r => round2(r.dr) || round2(r.cr));
    const dr = round2(lines.reduce((s, r) => s + round2(r.dr), 0)), cr = round2(lines.reduce((s, r) => s + round2(r.cr), 0));
    if (Math.abs(dr - cr) > 0.01) throw httpError(`Posting does not balance (Dr ${dr} / Cr ${cr})`);
    const { data: batch, error } = await c.from('ledger_transaction_batches').insert({ tenant_id: t, document_type: type, document_id: docId, batch_date: date, narration, created_by: userId }).select().single();
    if (error) throw error;
    const { error: e2 } = await c.from('ledger_transaction_lines').insert(lines.map(r => ({ tenant_id: t, batch_id: batch.id, ledger_account_id: r.ledger, sub_ledger_id: r.sub || null,
        debit_amount: round2(r.dr), credit_amount: round2(r.cr), narration: r.narration || null })));
    if (e2) { await c.from('ledger_transaction_batches').delete().eq('id', batch.id); throw e2; }
}
async function unpostGl(c, type, docId) {
    const { data: batches } = await c.from('ledger_transaction_batches').select('id').eq('document_type', type).eq('document_id', docId);
    for (const b of batches || []) {
        await c.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await c.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}
async function nextNo(c, t, table, prefix, extra = q => q) {
    const { data } = await extra(c.from(table).select('doc_no').eq('tenant_id', t));
    const n = (data || []).reduce((m, r) => { const x = parseInt(String(r.doc_no).replace(/^\D+|.*-/g, ''), 10); return Number.isFinite(x) && x > m ? x : m; }, 0) + 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
}
const need = (S, keys, what) => {
    const miss = keys.filter(([k]) => !S[k]).map(([, l]) => l);
    if (miss.length) throw httpError(`Set ${miss.join(', ')} in Construction Setup before posting ${what}`);
};

// ---------------------------------------------------------------- running (RA) bills
function raTotals(site, b, gross) {
    const pct = (k, d) => (b[k] !== undefined && b[k] !== '' && b[k] !== null ? num(b[k]) : d);
    const vat = b.vat_amount !== undefined && b.vat_amount !== '' ? round2(b.vat_amount) : round2(gross * num(site.vat_percent) / 100);
    const retention = b.retention_amount !== undefined && b.retention_amount !== '' ? round2(b.retention_amount) : round2(gross * pct('retention_percent', num(site.retention_percent)) / 100);
    const tds = b.tds_amount !== undefined && b.tds_amount !== '' ? round2(b.tds_amount) : round2(gross * pct('tds_percent', num(site.tds_percent)) / 100);
    const advance = b.advance_recovery !== undefined && b.advance_recovery !== '' ? round2(b.advance_recovery) : round2(gross * num(site.advance_recovery_percent) / 100);
    const other = round2(b.other_deduction);
    return { vat_amount: vat, retention_amount: retention, tds_amount: tds, advance_recovery: advance, other_deduction: other, net_amount: round2(gross + vat - retention - tds - advance - other) };
}
async function saveRaBill(c, t, userId, siteId, b, id) {
    await requireOn(c, t);
    const site = await loadSite(c, t, siteId);
    const old = id ? (await c.from('construction_ra_bills').select('*').eq('tenant_id', t).eq('id', id).maybeSingle()).data : null;
    if (id && !old) throw httpError('Running bill not found', 404);
    if (old && old.status !== 'draft') throw httpError('Only a draft running bill can be changed');
    const boq = await boqWithProgress(c, t, siteId, id);
    const B = Object.fromEntries(boq.map(i => [i.id, i]));
    const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => l && (num(l.qty) || num(l.amount))).map((l, k) => {
        const it = B[l.boq_item_id];
        const rate = l.rate !== undefined && l.rate !== '' ? round2(l.rate) : round2(it?.rate);
        const amount = it || num(l.qty) ? round2(num(l.qty) * rate) : round2(l.amount);
        return { boq_item_id: it ? it.id : null, description: it ? it.description : String(l.description || '').slice(0, 2000), unit: it ? it.unit : (l.unit || null), qty: num(l.qty), rate, amount, display_order: k + 1 };
    });
    for (const l of lines) if (l.boq_item_id && l.qty > B[l.boq_item_id].balance_qty + 1e-6) throw httpError(`"${B[l.boq_item_id].description.slice(0, 40)}": only ${B[l.boq_item_id].balance_qty} ${B[l.boq_item_id].unit || ''} left of the BOQ qty`);
    const gross = lines.length ? round2(lines.reduce((s, l) => s + l.amount, 0)) : round2(b.gross_amount);
    if (!(gross > 0)) throw httpError('Enter the work done (BOQ quantities or the gross amount)');
    const date = String(b.doc_date || old?.doc_date || today()).slice(0, 10);
    const row = { tenant_id: t, site_id: siteId, doc_date: date, period_from: b.period_from || null, period_to: b.period_to || null, gross_amount: gross, ...raTotals(site, b, gross),
        cost_center_id: site.cost_center_id, narration: b.narration || null, updated_by: userId, updated_at: new Date().toISOString() };
    let billId = id;
    if (!old) {
        const { data: prev } = await c.from('construction_ra_bills').select('ra_no').eq('site_id', siteId);
        const raNo = (prev || []).reduce((m, r) => Math.max(m, r.ra_no), 0) + 1;
        const docNo = `RA-${site.site_code}-${String(raNo).padStart(2, '0')}`;
        const { data, error } = await c.from('construction_ra_bills').insert({ ...row, ra_no: raNo, doc_no: docNo, status: 'draft', created_by: userId }).select().single();
        if (error) throw error;
        billId = data.id;
    } else {
        const { error } = await c.from('construction_ra_bills').update(row).eq('id', id);
        if (error) throw error;
        await c.from('construction_ra_bill_lines').delete().eq('bill_id', id);
    }
    if (lines.length) {
        const { error } = await c.from('construction_ra_bill_lines').insert(lines.map(l => ({ ...l, tenant_id: t, bill_id: billId })));
        if (error) throw error;
    }
    if (b.post) return setRaStatus(c, t, userId, billId, { status: 'posted' });
    return raBillDetail(c, t, billId);
}
async function raBillDetail(c, t, id) {
    const { data: bill } = await c.from('construction_ra_bills').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!bill) throw httpError('Running bill not found', 404);
    const { data: lines } = await c.from('construction_ra_bill_lines').select('*').eq('bill_id', id).order('display_order');
    const { data: prev } = await c.from('construction_ra_bills').select('gross_amount, ra_no, status').eq('site_id', bill.site_id);
    const upto = (prev || []).filter(p => p.status === 'posted' && p.ra_no < bill.ra_no).reduce((s, p) => s + num(p.gross_amount), 0);
    return { ...bill, lines: lines || [], previous_gross: round2(upto), cumulative_gross: round2(upto + num(bill.gross_amount)) };
}
async function setRaStatus(c, t, userId, id, b) {
    await requireOn(c, t);
    const bill = await raBillDetail(c, t, id);
    const site = await loadSite(c, t, bill.site_id);
    if (b.status === 'posted') {
        if (bill.status !== 'draft') throw httpError(`The bill is ${bill.status}`);
        if (!site.client_ledger_id) throw httpError('Set the client / main contractor of this site first');
        const S = await getSettings(c, t);
        need(S, [['revenue_ledger_id', 'the Contract Revenue ledger'], ...(bill.retention_amount ? [['retention_receivable_ledger_id', 'the Retention Receivable ledger']] : []),
            ...(bill.tds_amount ? [['tds_receivable_ledger_id', 'the TDS Receivable ledger']] : [])], 'a running bill');
        const vatLedger = bill.vat_amount ? await defaultVatLedger(c, t, 'sales') : null;
        if (bill.vat_amount && !vatLedger) throw httpError('No VAT ledger - set it in System Control');
        const clientDr = round2(num(bill.gross_amount) + num(bill.vat_amount) - num(bill.retention_amount) - num(bill.tds_amount) - num(bill.other_deduction));
        const rows = [
            { ledger: site.client_ledger_id, dr: clientDr, cr: 0 },
            { ledger: S.retention_receivable_ledger_id, dr: bill.retention_amount, cr: 0, narration: 'Retention held by the client' },
            { ledger: S.tds_receivable_ledger_id, dr: bill.tds_amount, cr: 0, narration: 'TDS deducted by the client' },
            { ledger: S.revenue_ledger_id, dr: 0, cr: round2(num(bill.gross_amount) - num(bill.other_deduction)), narration: bill.other_deduction ? 'Work done less deductions' : 'Work done' },
            { ledger: vatLedger, dr: 0, cr: bill.vat_amount }
        ];
        await postGl(c, t, userId, { type: 'construction_ra_bill', docId: id, date: bill.doc_date, narration: `Running bill ${bill.doc_no} - ${site.site_name}`, rows });
        await c.from('construction_ra_bills').update({ status: 'posted', posted_at: new Date().toISOString(), posted_by: userId }).eq('id', id);
    } else if (b.status === 'cancelled') {
        if (bill.status === 'cancelled') throw httpError('Already cancelled');
        const { data: later } = await c.from('construction_ra_bills').select('doc_no').eq('site_id', bill.site_id).eq('status', 'posted').gt('ra_no', bill.ra_no);
        if ((later || []).length) throw httpError(`Cancel the later running bill(s) ${later.map(l => l.doc_no).join(', ')} first`);
        await unpostGl(c, 'construction_ra_bill', id);
        await c.from('construction_ra_bills').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId, cancellation_reason: b.cancellation_reason || null }).eq('id', id);
    } else throw httpError('Invalid status');
    return raBillDetail(c, t, id);
}
async function deleteRaBill(c, t, id) {
    const { data: bill } = await c.from('construction_ra_bills').select('status').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!bill) throw httpError('Running bill not found', 404);
    if (bill.status !== 'draft') throw httpError('Only a draft can be deleted - cancel a posted bill');
    await c.from('construction_ra_bill_lines').delete().eq('bill_id', id);
    await c.from('construction_ra_bills').delete().eq('id', id);
    return { deleted: true };
}

// ---------------------------------------------------------------- materials
async function postSiteAdjustment(c, t, userId, site, { date, direction, lines, narration, override_negative }) {
    const S = await getSettings(c, t);
    const wh = site.warehouse_id || S.default_warehouse_id || null;
    const details = [];
    for (const l of lines) {
        const rate = l.rate !== undefined && l.rate !== null ? Number(l.rate) : await P.costRate(c, t, l.product_id, l.uom_id, date);
        details.push({ product_id: l.product_id, qty: Number(l.qty), uom_id: l.uom_id || null, warehouse_id: l.warehouse_id || wh, direction,
            rate: Math.round(rate * 10000) / 10000, line_reason: direction === 'out' ? 'consumption' : 'production', narration: null });
    }
    if (details.some(d => !d.warehouse_id)) throw httpError('Choose the store (warehouse) - set one on the site or in Construction Setup');
    const body = { doc_date: date, reason: direction === 'out' ? 'consumption' : 'production', warehouse_id: wh, cost_center_id: site.cost_center_id, narration, source_module: 'construction', details,
        ...(S.material_ledger_id ? (direction === 'out' ? { loss_ledger_id: S.material_ledger_id } : { gain_ledger_id: S.material_ledger_id }) : {}) };
    const doc = await SA().createAdjustment(c, t, userId, body);
    try {
        const out = await SA().setAdjustmentStatus(c, t, userId, doc.id, { status: 'posted', override_negative_stock_warning: !!override_negative }, { forceOwnLedgers: !!S.material_ledger_id });
        const { data: det } = await c.from('stock_adjustment_details').select('product_id, qty, uom_id, rate, amount').eq('adjustment_id', doc.id).order('display_order');
        const { data: fresh } = await c.from('stock_adjustments').select('total_in_amount, total_out_amount').eq('id', doc.id).maybeSingle();
        return { id: doc.id, doc_no: doc.doc_no, amount: round2(direction === 'out' ? fresh?.total_out_amount : fresh?.total_in_amount), lines: det || [], warnings: out.warnings };
    } catch (e) {
        await c.from('stock_adjustments').delete().eq('id', doc.id).eq('status', 'draft');
        throw e;
    }
}
/** a posted purchase bill's lines and how much of each is not yet sent to a site */
async function purchaseLinesForSite(c, t, billId) {
    if (!UUID.test(String(billId))) throw httpError('Purchase bill not found', 404);
    const { data: bill } = await c.from('purchase_bills').select('id, doc_no, doc_date, status, vendor_name_snapshot, cash_vendor_name, warehouse_id').eq('tenant_id', t).eq('id', billId).maybeSingle();
    if (!bill) throw httpError('Purchase bill not found', 404);
    if (bill.status !== 'posted') throw httpError(`Purchase bill ${bill.doc_no} is not posted`);
    const { data: det } = await c.from('purchase_bill_details').select('id, product_id, product_name_snapshot, qty, uom_id, uom_name_snapshot, free_qty, amount, tax_amount, warehouse_id').eq('bill_id', bill.id).order('display_order');
    const ids = (det || []).map(d => d.id);
    const { data: used } = ids.length ? await c.from('construction_material_issue_lines').select('bill_detail_id, qty').in('bill_detail_id', ids) : { data: [] };
    const U = {}; (used || []).forEach(u => { U[u.bill_detail_id] = (U[u.bill_detail_id] || 0) + num(u.qty); });
    const unnamed = (det || []).filter(d => !d.product_name_snapshot).map(d => d.product_id);
    const names = {};
    if (unnamed.length) ((await c.from('products').select('id, product_name').in('id', unnamed)).data || []).forEach(p => { names[p.id] = p.product_name; });
    return { ...bill, vendor_name: bill.vendor_name_snapshot || bill.cash_vendor_name || '',
        lines: (det || []).map(d => {
            const qty = num(d.qty) + num(d.free_qty), value = round2(num(d.amount) - num(d.tax_amount));
            return { bill_detail_id: d.id, product_id: d.product_id, product_name: d.product_name_snapshot || names[d.product_id] || '', uom_id: d.uom_id, uom_name: d.uom_name_snapshot || '',
                qty, issued: round2(U[d.id] || 0), left: Math.max(0, Math.round((qty - (U[d.id] || 0)) * 10000) / 10000), rate: qty ? Math.round(value / qty * 10000) / 10000 : 0, warehouse_id: d.warehouse_id || null };
        }) };
}
/**
 * Material to / from a site.
 * b: { issue_date, direction: 'out'|'in', purchase_bill_id?, lines: [{ product_id, qty, uom_id, rate? } | { bill_detail_id, qty }], remarks }
 */
async function issueMaterial(c, t, userId, siteId, b) {
    await requireOn(c, t);
    const site = await loadSite(c, t, siteId);
    if (site.status === 'closed') throw httpError('The site is closed');
    const date = String(b.issue_date || today()).slice(0, 10);
    if (date > today()) throw httpError('The date cannot be in the future');
    const direction = b.direction === 'in' ? 'in' : 'out';
    let lines, billNo = null, purchaseId = null;
    if (b.purchase_bill_id) {
        if (direction === 'in') throw httpError('A return from the site is entered item by item, not from a purchase bill');
        const a = await purchaseLinesForSite(c, t, b.purchase_bill_id);
        if (date < String(a.doc_date).slice(0, 10)) throw httpError(`The date is before the purchase (${String(a.doc_date).slice(0, 10)})`);
        const L = Object.fromEntries(a.lines.map(l => [l.bill_detail_id, l]));
        lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => l && num(l.qty) > 0).map(l => {
            const x = L[l.bill_detail_id];
            if (!x) throw httpError('An item is not on this purchase bill');
            if (num(l.qty) > x.left + 1e-6) throw httpError(`${x.product_name}: only ${x.left} ${x.uom_name} left on ${a.doc_no}`);
            return { bill_detail_id: x.bill_detail_id, product_id: x.product_id, qty: num(l.qty), uom_id: x.uom_id, rate: x.rate, warehouse_id: x.warehouse_id || a.warehouse_id || null };
        });
        billNo = a.doc_no; purchaseId = a.id;
    } else {
        lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => l && idOrNull(l.product_id) && num(l.qty) > 0)
            .map(l => ({ product_id: l.product_id, qty: num(l.qty), uom_id: idOrNull(l.uom_id), rate: l.rate !== undefined && l.rate !== '' && l.rate !== null ? num(l.rate) : undefined, warehouse_id: idOrNull(l.warehouse_id) }));
    }
    if (!lines.length) throw httpError('Enter at least one item with a quantity');
    const adj = await postSiteAdjustment(c, t, userId, site, { date, direction, lines, override_negative: !!b.override_negative_stock,
        narration: `${direction === 'out' ? 'Material to' : 'Material returned from'} site ${site.site_code} - ${site.site_name}${billNo ? ` (purchase ${billNo})` : ''}` });
    const { data: iss, error } = await c.from('construction_material_issues').insert({ tenant_id: t, site_id: siteId, issue_date: date, direction, purchase_bill_id: purchaseId,
        adjustment_id: adj.id, total_amount: adj.amount, remarks: b.remarks || null, created_by: userId }).select().single();
    if (error) { await P.cancelAdjustment(c, t, userId, adj.id, 'Not saved'); throw error; }
    const rows = adj.lines.map((l, i) => ({ tenant_id: t, issue_id: iss.id, bill_detail_id: lines[i]?.bill_detail_id || null, product_id: l.product_id, qty: num(l.qty), uom_id: l.uom_id || null, rate: num(l.rate), amount: round2(l.amount) }));
    const { error: e2 } = await c.from('construction_material_issue_lines').insert(rows);
    if (e2) { await P.cancelAdjustment(c, t, userId, adj.id, 'Not saved'); await c.from('construction_material_issues').delete().eq('id', iss.id); throw e2; }
    return { ...iss, adjustment_no: adj.doc_no, warnings: adj.warnings || [] };
}
async function deleteIssue(c, t, userId, id) {
    const { data: iss } = await c.from('construction_material_issues').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!iss) throw httpError('Entry not found', 404);
    await P.cancelAdjustment(c, t, userId, iss.adjustment_id, 'Site material entry removed');
    await c.from('construction_material_issue_lines').delete().eq('issue_id', id);
    await c.from('construction_material_issues').delete().eq('id', id);
    return { deleted: true };
}
async function sitePurchaseBills(c, t, q = {}) {
    const since = q.since || iso(Date.now() - 180 * DAY);
    const { data: bills } = await c.from('purchase_bills').select('id, doc_no, doc_date, status, vendor_name_snapshot, cash_vendor_name').eq('tenant_id', t).eq('status', 'posted').gte('doc_date', since).order('doc_date', { ascending: false }).limit(200);
    const out = [];
    for (const b of bills || []) {
        const a = await purchaseLinesForSite(c, t, b.id);
        const left = a.lines.filter(l => l.left > 0);
        if (left.length) out.push({ id: b.id, doc_no: b.doc_no, doc_date: b.doc_date, vendor_name: a.vendor_name, items: left.slice(0, 4).map(l => `${l.product_name} ${l.left}`).join(', ') + (left.length > 4 ? ' …' : '') });
    }
    return out;
}

// ---------------------------------------------------------------- wage sheets
async function saveWageSheet(c, t, userId, siteId, b, id) {
    await requireOn(c, t);
    const site = await loadSite(c, t, siteId);
    const old = id ? (await c.from('construction_wage_sheets').select('*').eq('tenant_id', t).eq('id', id).maybeSingle()).data : null;
    if (id && !old) throw httpError('Wage sheet not found', 404);
    if (old && old.status !== 'draft') throw httpError('Only a draft wage sheet can be changed');
    const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => l && String(l.worker_name || '').trim() && (num(l.days) || num(l.ot_hours))).map((l, k) => ({
        worker_name: String(l.worker_name).trim().slice(0, 120), trade: l.trade ? String(l.trade).slice(0, 60) : null, days: num(l.days), rate: round2(l.rate), ot_hours: num(l.ot_hours), ot_rate: round2(l.ot_rate),
        amount: round2(num(l.days) * num(l.rate) + num(l.ot_hours) * num(l.ot_rate)), display_order: k + 1 }));
    if (!lines.length) throw httpError('Enter at least one worker with days');
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    const row = { tenant_id: t, site_id: siteId, doc_date: String(b.doc_date || today()).slice(0, 10), period_from: b.period_from || null, period_to: b.period_to || null,
        pay_ledger_id: idOrNull(b.pay_ledger_id), total_amount: total, cost_center_id: site.cost_center_id, narration: b.narration || null, updated_by: userId, updated_at: new Date().toISOString() };
    let sheetId = id;
    if (!old) {
        const docNo = await nextNo(c, t, 'construction_wage_sheets', 'WS-');
        const { data, error } = await c.from('construction_wage_sheets').insert({ ...row, doc_no: docNo, status: 'draft', created_by: userId }).select().single();
        if (error) throw error;
        sheetId = data.id;
    } else {
        const { error } = await c.from('construction_wage_sheets').update(row).eq('id', id);
        if (error) throw error;
        await c.from('construction_wage_lines').delete().eq('sheet_id', id);
    }
    const { error } = await c.from('construction_wage_lines').insert(lines.map(l => ({ ...l, tenant_id: t, sheet_id: sheetId })));
    if (error) throw error;
    if (b.post) return setWageStatus(c, t, userId, sheetId, { status: 'posted' });
    return wageDetail(c, t, sheetId);
}
async function wageDetail(c, t, id) {
    const { data: s } = await c.from('construction_wage_sheets').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!s) throw httpError('Wage sheet not found', 404);
    const { data: lines } = await c.from('construction_wage_lines').select('*').eq('sheet_id', id).order('display_order');
    return { ...s, lines: lines || [] };
}
async function setWageStatus(c, t, userId, id, b) {
    await requireOn(c, t);
    const s = await wageDetail(c, t, id);
    const site = await loadSite(c, t, s.site_id);
    if (b.status === 'posted') {
        if (s.status !== 'draft') throw httpError(`The wage sheet is ${s.status}`);
        const S = await getSettings(c, t);
        need(S, [['wages_ledger_id', 'the Wages ledger']], 'a wage sheet');
        const pay = s.pay_ledger_id || S.wages_payable_ledger_id;
        if (!pay) throw httpError('Choose who is paid (cash / bank / wages payable / labour contractor) on the sheet, or set Wages Payable in Construction Setup');
        await postGl(c, t, userId, { type: 'construction_wage', docId: id, date: s.doc_date, narration: `Wages ${s.doc_no} - ${site.site_name}`,
            rows: [{ ledger: S.wages_ledger_id, dr: s.total_amount, cr: 0 }, { ledger: pay, dr: 0, cr: s.total_amount }] });
        await c.from('construction_wage_sheets').update({ status: 'posted', pay_ledger_id: pay, posted_at: new Date().toISOString(), posted_by: userId }).eq('id', id);
    } else if (b.status === 'cancelled') {
        if (s.status === 'cancelled') throw httpError('Already cancelled');
        await unpostGl(c, 'construction_wage', id);
        await c.from('construction_wage_sheets').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId, cancellation_reason: b.cancellation_reason || null }).eq('id', id);
    } else throw httpError('Invalid status');
    return wageDetail(c, t, id);
}
async function deleteWage(c, t, id) {
    const { data: s } = await c.from('construction_wage_sheets').select('status').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!s) throw httpError('Wage sheet not found', 404);
    if (s.status !== 'draft') throw httpError('Only a draft can be deleted - cancel a posted sheet');
    await c.from('construction_wage_lines').delete().eq('sheet_id', id);
    await c.from('construction_wage_sheets').delete().eq('id', id);
    return { deleted: true };
}

// ---------------------------------------------------------------- sub-contracts given (petti thekka diyeko)
async function saveSubcontract(c, t, userId, siteId, b, id) {
    await requireOn(c, t);
    const site = await loadSite(c, t, siteId);
    const S = await getSettings(c, t);
    if (!idOrNull(b.subcontractor_ledger_id)) throw httpError('Choose the sub-contractor (ledger)');
    if (!String(b.work_description || '').trim()) throw httpError('Describe the work given');
    const row = { tenant_id: t, site_id: site.id, subcontractor_ledger_id: b.subcontractor_ledger_id, work_description: String(b.work_description).slice(0, 2000),
        contract_amount: round2(b.contract_amount), vat_percent: b.vat_percent !== undefined && b.vat_percent !== '' ? num(b.vat_percent) : S.default_vat_percent,
        retention_percent: b.retention_percent !== undefined && b.retention_percent !== '' ? num(b.retention_percent) : S.default_retention_percent,
        tds_percent: b.tds_percent !== undefined && b.tds_percent !== '' ? num(b.tds_percent) : S.default_tds_percent,
        start_date: b.start_date || null, end_date: b.end_date || null, status: ['active', 'completed', 'cancelled'].includes(b.status) ? b.status : 'active', remarks: b.remarks || null, updated_at: new Date().toISOString() };
    const { data, error } = id ? await c.from('construction_subcontracts').update(row).eq('tenant_id', t).eq('id', id).select().single()
        : await c.from('construction_subcontracts').insert({ ...row, created_by: userId }).select().single();
    if (error) throw error;
    return data;
}
async function saveSubBill(c, t, userId, subId, b, id) {
    await requireOn(c, t);
    const { data: sub } = await c.from('construction_subcontracts').select('*').eq('tenant_id', t).eq('id', subId).maybeSingle();
    if (!sub) throw httpError('Sub-contract not found', 404);
    const site = await loadSite(c, t, sub.site_id);
    const old = id ? (await c.from('construction_subcontract_bills').select('*').eq('tenant_id', t).eq('id', id).maybeSingle()).data : null;
    if (id && !old) throw httpError('Bill not found', 404);
    if (old && old.status !== 'draft') throw httpError('Only a draft bill can be changed');
    const gross = round2(b.gross_amount);
    if (!(gross > 0)) throw httpError('Enter the bill amount (work done, without VAT)');
    const tot = raTotals({ vat_percent: sub.vat_percent, retention_percent: sub.retention_percent, tds_percent: sub.tds_percent, advance_recovery_percent: 0 }, b, gross);
    const row = { tenant_id: t, subcontract_id: sub.id, site_id: site.id, party_bill_no: b.party_bill_no || null, doc_date: String(b.doc_date || today()).slice(0, 10), gross_amount: gross, ...tot,
        cost_center_id: site.cost_center_id, narration: b.narration || null, updated_by: userId, updated_at: new Date().toISOString() };
    let billId = id;
    if (!old) {
        const docNo = await nextNo(c, t, 'construction_subcontract_bills', 'SCB-');
        const { data, error } = await c.from('construction_subcontract_bills').insert({ ...row, doc_no: docNo, status: 'draft', created_by: userId }).select().single();
        if (error) throw error;
        billId = data.id;
    } else {
        const { error } = await c.from('construction_subcontract_bills').update(row).eq('id', id);
        if (error) throw error;
    }
    if (b.post) return setSubBillStatus(c, t, userId, billId, { status: 'posted' });
    return (await c.from('construction_subcontract_bills').select('*').eq('id', billId).single()).data;
}
async function setSubBillStatus(c, t, userId, id, b) {
    await requireOn(c, t);
    const { data: bill } = await c.from('construction_subcontract_bills').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!bill) throw httpError('Bill not found', 404);
    const { data: sub } = await c.from('construction_subcontracts').select('*').eq('id', bill.subcontract_id).maybeSingle();
    const site = await loadSite(c, t, bill.site_id);
    if (b.status === 'posted') {
        if (bill.status !== 'draft') throw httpError(`The bill is ${bill.status}`);
        const S = await getSettings(c, t);
        need(S, [['subcontract_cost_ledger_id', 'the Sub-contract Cost ledger'], ...(bill.retention_amount ? [['retention_payable_ledger_id', 'the Retention Payable ledger']] : []),
            ...(bill.tds_amount ? [['tds_payable_ledger_id', 'the TDS Payable ledger']] : [])], 'a sub-contract bill');
        const vatLedger = bill.vat_amount ? await defaultVatLedger(c, t, 'purchase') : null;
        if (bill.vat_amount && !vatLedger) throw httpError('No VAT ledger - set it in System Control');
        const partyCr = round2(num(bill.gross_amount) + num(bill.vat_amount) - num(bill.retention_amount) - num(bill.tds_amount) - num(bill.other_deduction));
        await postGl(c, t, userId, { type: 'construction_sub_bill', docId: id, date: bill.doc_date, narration: `Sub-contract bill ${bill.doc_no} - ${site.site_name}`, rows: [
            { ledger: S.subcontract_cost_ledger_id, dr: round2(num(bill.gross_amount) - num(bill.other_deduction)), cr: 0, narration: sub?.work_description?.slice(0, 200) },
            { ledger: vatLedger, dr: bill.vat_amount, cr: 0 },
            { ledger: sub.subcontractor_ledger_id, dr: 0, cr: partyCr },
            { ledger: S.retention_payable_ledger_id, dr: 0, cr: bill.retention_amount, narration: 'Retention held from the sub-contractor' },
            { ledger: S.tds_payable_ledger_id, dr: 0, cr: bill.tds_amount, narration: 'TDS deducted' }
        ] });
        await c.from('construction_subcontract_bills').update({ status: 'posted', posted_at: new Date().toISOString(), posted_by: userId }).eq('id', id);
    } else if (b.status === 'cancelled') {
        if (bill.status === 'cancelled') throw httpError('Already cancelled');
        await unpostGl(c, 'construction_sub_bill', id);
        await c.from('construction_subcontract_bills').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId, cancellation_reason: b.cancellation_reason || null }).eq('id', id);
    } else throw httpError('Invalid status');
    return (await c.from('construction_subcontract_bills').select('*').eq('id', id).single()).data;
}
async function deleteSubBill(c, t, id) {
    const { data: s } = await c.from('construction_subcontract_bills').select('status').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!s) throw httpError('Bill not found', 404);
    if (s.status !== 'draft') throw httpError('Only a draft can be deleted - cancel a posted bill');
    await c.from('construction_subcontract_bills').delete().eq('id', id);
    return { deleted: true };
}

// ---------------------------------------------------------------- site summary / P&L
const OWN_DOCS = ['construction_ra_bill', 'construction_sub_bill', 'construction_wage'];
async function siteSummary(c, t, site, { gl = null } = {}) {
    const [{ data: ras }, { data: wages }, { data: subs }, { data: subBills }, { data: issues }] = await Promise.all([
        c.from('construction_ra_bills').select('status, gross_amount, vat_amount, retention_amount, tds_amount, advance_recovery, other_deduction, net_amount').eq('site_id', site.id),
        c.from('construction_wage_sheets').select('status, total_amount').eq('site_id', site.id),
        c.from('construction_subcontracts').select('id, contract_amount, status').eq('site_id', site.id),
        c.from('construction_subcontract_bills').select('status, gross_amount, other_deduction, retention_amount, tds_amount').eq('site_id', site.id),
        c.from('construction_material_issues').select('direction, total_amount, adjustment_id').eq('site_id', site.id)
    ]);
    const posted = (arr) => (arr || []).filter(x => x.status === 'posted');
    const sum = (arr, k) => round2((arr || []).reduce((s, x) => s + num(x[k]), 0));
    const R = posted(ras), SB = posted(subBills);
    // material: only posted stock adjustments count
    const adjIds = (issues || []).map(i => i.adjustment_id).filter(Boolean);
    const { data: adjs } = adjIds.length ? await c.from('stock_adjustments').select('id, status').in('id', adjIds) : { data: [] };
    const live = new Set((adjs || []).filter(a => a.status === 'posted').map(a => a.id));
    const material = round2((issues || []).filter(i => live.has(i.adjustment_id)).reduce((s, i) => s + (i.direction === 'in' ? -1 : 1) * num(i.total_amount), 0));
    // other cost / income: any voucher with this site's cost center (not the site's own documents)
    const lines = (gl || await P.glByCostCenter(c, t, [site.cost_center_id].filter(Boolean), today())).filter(l => l.cost_center === site.cost_center_id && !OWN_DOCS.includes(l.doc_type));
    const otherCost = round2(lines.filter(l => l.kind === 'expense').reduce((s, l) => s + l.dr - l.cr, 0));
    const otherIncome = round2(lines.filter(l => l.kind === 'income').reduce((s, l) => s + l.cr - l.dr, 0));
    const billed = round2(sum(R, 'gross_amount') - sum(R, 'other_deduction'));
    const cost = { material, wages: sum(posted(wages), 'total_amount'), subcontract: round2(sum(SB, 'gross_amount') - sum(SB, 'other_deduction')), other: otherCost };
    cost.total = round2(cost.material + cost.wages + cost.subcontract + cost.other);
    const revenue = { billed, other_income: otherIncome, total: round2(billed + otherIncome) };
    const profit = round2(revenue.total - cost.total);
    const budget = { material: num(site.budget_material), labour: num(site.budget_labour), subcontract: num(site.budget_subcontract), other: num(site.budget_other) };
    budget.total = round2(budget.material + budget.labour + budget.subcontract + budget.other);
    return {
        contract: { amount: num(site.contract_amount), billed_gross: sum(R, 'gross_amount'), billed_pct: num(site.contract_amount) ? round2(sum(R, 'gross_amount') * 100 / num(site.contract_amount)) : null,
            balance_to_bill: round2(num(site.contract_amount) - sum(R, 'gross_amount')), vat: sum(R, 'vat_amount'), retention_held: sum(R, 'retention_amount'), tds_deducted: sum(R, 'tds_amount'),
            advance_recovered: sum(R, 'advance_recovery'), advance_left: round2(num(site.advance_amount) - sum(R, 'advance_recovery')), net_receivable: sum(R, 'net_amount'), ra_bills: R.length },
        revenue, cost, profit, margin_pct: revenue.total ? round2(profit * 100 / revenue.total) : null,
        budget, budget_used_pct: budget.total ? round2(cost.total * 100 / budget.total) : null,
        subcontracts: { count: (subs || []).length, given: sum(subs, 'contract_amount'), billed: sum(SB, 'gross_amount'), retention_held: sum(SB, 'retention_amount'), tds: sum(SB, 'tds_amount') },
        drafts: { ra: (ras || []).filter(x => x.status === 'draft').length, wages: (wages || []).filter(x => x.status === 'draft').length, sub_bills: (subBills || []).filter(x => x.status === 'draft').length }
    };
}
async function listSites(c, t, q = {}) {
    await requireOn(c, t);
    let b = c.from('construction_sites').select('*').eq('tenant_id', t);
    if (q.status && q.status !== 'all') b = b.eq('status', q.status);
    const { data, error } = await b.order('site_code');
    if (error) throw error;
    const rows = data || [];
    const gl = rows.length ? await P.glByCostCenter(c, t, rows.map(r => r.cost_center_id).filter(Boolean), today()) : [];
    const names = await ledgerNames(c, rows.map(r => r.client_ledger_id));
    const out = [];
    for (const r of rows) out.push({ ...r, client_name: names[r.client_ledger_id] || '', summary: await siteSummary(c, t, r, { gl }) });
    return out;
}
async function siteDetail(c, t, id) {
    const site = await loadSite(c, t, id);
    const [boq, { data: ras }, { data: wages }, { data: subs }, { data: subBills }, { data: issues }] = await Promise.all([
        boqWithProgress(c, t, id),
        c.from('construction_ra_bills').select('*').eq('site_id', id).order('ra_no'),
        c.from('construction_wage_sheets').select('*').eq('site_id', id).order('doc_date'),
        c.from('construction_subcontracts').select('*').eq('site_id', id).order('created_at'),
        c.from('construction_subcontract_bills').select('*').eq('site_id', id).order('doc_date'),
        c.from('construction_material_issues').select('*').eq('site_id', id).order('issue_date')
    ]);
    const issueIds = (issues || []).map(i => i.id);
    const { data: iLines } = issueIds.length ? await c.from('construction_material_issue_lines').select('*').in('issue_id', issueIds) : { data: [] };
    const pids = [...new Set((iLines || []).map(l => l.product_id))];
    const { data: ps } = pids.length ? await c.from('products').select('id, product_name').in('id', pids) : { data: [] };
    const PN = Object.fromEntries((ps || []).map(p => [p.id, p.product_name]));
    const adjIds = (issues || []).map(i => i.adjustment_id).filter(Boolean);
    const { data: adjs } = adjIds.length ? await c.from('stock_adjustments').select('id, doc_no, status').in('id', adjIds) : { data: [] };
    const A = Object.fromEntries((adjs || []).map(a => [a.id, a]));
    const billIds = (issues || []).map(i => i.purchase_bill_id).filter(Boolean);
    const { data: pbs } = billIds.length ? await c.from('purchase_bills').select('id, doc_no').in('id', billIds) : { data: [] };
    const PB = Object.fromEntries((pbs || []).map(p => [p.id, p.doc_no]));
    const names = await ledgerNames(c, [site.client_ledger_id, ...(subs || []).map(s => s.subcontractor_ledger_id), ...(wages || []).map(w => w.pay_ledger_id)]);
    // other cost / income lines of the site (vouchers with its cost center)
    const gl = await P.glByCostCenter(c, t, [site.cost_center_id].filter(Boolean), today());
    const otherLines = gl.filter(l => l.cost_center === site.cost_center_id && !OWN_DOCS.includes(l.doc_type))
        .map(l => ({ date: l.date, doc_label: l.doc_label, doc_no: l.doc_no, ledger_name: l.ledger_name, narration: l.narration, kind: l.kind, amount: round2(l.kind === 'income' ? l.cr - l.dr : l.dr - l.cr) }));
    // material by item
    const byItem = {};
    (iLines || []).forEach(l => {
        const iss = (issues || []).find(i => i.id === l.issue_id);
        if (!iss || A[iss.adjustment_id]?.status !== 'posted') return;
        const s = iss.direction === 'in' ? -1 : 1;
        const r = byItem[l.product_id] = byItem[l.product_id] || { product_id: l.product_id, product_name: PN[l.product_id] || '', qty_out: 0, qty_in: 0, amount: 0 };
        if (s > 0) r.qty_out += num(l.qty); else r.qty_in += num(l.qty);
        r.amount = round2(r.amount + s * num(l.amount));
    });
    const summary = await siteSummary(c, t, site, { gl });
    return {
        ...site, client_name: names[site.client_ledger_id] || '', summary, boq,
        ra_bills: ras || [],
        wage_sheets: (wages || []).map(w => ({ ...w, pay_ledger_name: names[w.pay_ledger_id] || '' })),
        subcontracts: (subs || []).map(s => {
            const bills = (subBills || []).filter(x => x.subcontract_id === s.id);
            const p = bills.filter(x => x.status === 'posted');
            const billed = round2(p.reduce((x, y) => x + num(y.gross_amount), 0));
            return { ...s, subcontractor_name: names[s.subcontractor_ledger_id] || '', bills, billed, balance: round2(num(s.contract_amount) - billed),
                retention_held: round2(p.reduce((x, y) => x + num(y.retention_amount), 0)), tds: round2(p.reduce((x, y) => x + num(y.tds_amount), 0)), progress_pct: num(s.contract_amount) ? round2(billed * 100 / num(s.contract_amount)) : null };
        }),
        material_issues: (issues || []).map(i => ({ ...i, adjustment_no: A[i.adjustment_id]?.doc_no || null, adjustment_status: A[i.adjustment_id]?.status || null, bill_no: PB[i.purchase_bill_id] || null,
            lines: (iLines || []).filter(l => l.issue_id === i.id).map(l => ({ ...l, product_name: PN[l.product_id] || '' })) })),
        material_by_item: Object.values(byItem).map(r => ({ ...r, net_qty: Math.round((r.qty_out - r.qty_in) * 1000) / 1000 })).sort((a, b) => b.amount - a.amount),
        other_lines: otherLines
    };
}

// ---------------------------------------------------------------- reports & dashboard
async function report(c, t, view, q = {}) {
    await requireOn(c, t);
    const sites = await listSites(c, t, { status: q.status || 'all' });
    if (view === 'profitability') {
        return sites.map(s => ({ id: s.id, site_code: s.site_code, site_name: s.site_name, contract_type: s.contract_type, client_name: s.client_name, status: s.status,
            contract_amount: s.summary.contract.amount, billed: s.summary.revenue.billed, billed_pct: s.summary.contract.billed_pct, other_income: s.summary.revenue.other_income,
            material: s.summary.cost.material, wages: s.summary.cost.wages, subcontract: s.summary.cost.subcontract, other_cost: s.summary.cost.other, total_cost: s.summary.cost.total,
            profit: s.summary.profit, margin_pct: s.summary.margin_pct, budget: s.summary.budget.total, budget_used_pct: s.summary.budget_used_pct,
            retention_held: s.summary.contract.retention_held, tds_deducted: s.summary.contract.tds_deducted }));
    }
    if (view === 'subcontractors') {
        const out = [];
        for (const s of sites) {
            const d = await siteDetail(c, t, s.id);
            d.subcontracts.forEach(x => out.push({ site_code: s.site_code, site_name: s.site_name, id: x.id, subcontractor_name: x.subcontractor_name, work_description: x.work_description,
                contract_amount: num(x.contract_amount), billed: x.billed, balance: x.balance, progress_pct: x.progress_pct, retention_held: x.retention_held, tds: x.tds, status: x.status, bills: x.bills.filter(b => b.status === 'posted').length }));
        }
        return out;
    }
    if (view === 'material') {
        const out = [];
        for (const s of sites) {
            const d = await siteDetail(c, t, s.id);
            d.material_by_item.forEach(m => out.push({ site_code: s.site_code, site_name: s.site_name, ...m }));
        }
        return out;
    }
    if (view === 'ra_register') {
        const ids = sites.map(s => s.id);
        const { data } = ids.length ? await c.from('construction_ra_bills').select('*').in('site_id', ids).order('doc_date', { ascending: false }) : { data: [] };
        const S = Object.fromEntries(sites.map(s => [s.id, s]));
        return (data || []).filter(r => (!q.date_from || r.doc_date >= q.date_from) && (!q.date_to || r.doc_date <= q.date_to))
            .map(r => ({ ...r, site_code: S[r.site_id]?.site_code, site_name: S[r.site_id]?.site_name, client_name: S[r.site_id]?.client_name }));
    }
    if (view === 'wages') {
        const ids = sites.map(s => s.id);
        const { data: sheets } = ids.length ? await c.from('construction_wage_sheets').select('*').in('site_id', ids).eq('status', 'posted') : { data: [] };
        const list = (sheets || []).filter(r => (!q.date_from || r.doc_date >= q.date_from) && (!q.date_to || r.doc_date <= q.date_to));
        const { data: lines } = list.length ? await c.from('construction_wage_lines').select('*').in('sheet_id', list.map(s => s.id)) : { data: [] };
        const SH = Object.fromEntries(list.map(s => [s.id, s])), ST = Object.fromEntries(sites.map(s => [s.id, s]));
        const g = {};
        (lines || []).forEach(l => {
            const site = ST[SH[l.sheet_id].site_id];
            const k = `${site.id}|${l.trade || ''}`;
            const r = g[k] = g[k] || { site_code: site.site_code, site_name: site.site_name, trade: l.trade || '(not given)', workers: new Set(), days: 0, ot_hours: 0, amount: 0 };
            r.workers.add(l.worker_name); r.days += num(l.days); r.ot_hours += num(l.ot_hours); r.amount += num(l.amount);
        });
        return Object.values(g).map(r => ({ ...r, workers: r.workers.size, days: round2(r.days), ot_hours: round2(r.ot_hours), amount: round2(r.amount), avg_per_day: r.days ? round2(r.amount / r.days) : null }));
    }
    throw httpError('Unknown construction report', 404);
}
async function dashboard(c, t) {
    const sites = await listSites(c, t, {});
    const active = sites.filter(s => s.status === 'active');
    const sum = (arr, f) => round2(arr.reduce((s, x) => s + f(x), 0));
    return {
        kpis: { sites: sites.length, active: active.length, contract_value: sum(active, s => s.summary.contract.amount), billed: sum(sites, s => s.summary.revenue.billed),
            cost: sum(sites, s => s.summary.cost.total), profit: sum(sites, s => s.summary.profit), retention_held: sum(sites, s => s.summary.contract.retention_held),
            to_bill: sum(active, s => Math.max(0, s.summary.contract.balance_to_bill)) },
        sites: sites.map(s => ({ id: s.id, site_code: s.site_code, site_name: s.site_name, contract_type: s.contract_type, client_name: s.client_name, status: s.status,
            contract_amount: s.summary.contract.amount, billed_pct: s.summary.contract.billed_pct, billed: s.summary.revenue.billed, cost: s.summary.cost.total, profit: s.summary.profit,
            budget_used_pct: s.summary.budget_used_pct, end_date: s.end_date, drafts: s.summary.drafts }))
    };
}

module.exports = {
    requireOn, getSettings, saveSettings, saveSite, siteDetail, listSites, saveBoq, boqWithProgress,
    saveRaBill, raBillDetail, setRaStatus, deleteRaBill, issueMaterial, deleteIssue, purchaseLinesForSite, sitePurchaseBills,
    saveWageSheet, wageDetail, setWageStatus, deleteWage, saveSubcontract, saveSubBill, setSubBillStatus, deleteSubBill,
    siteSummary, report, dashboard
};
