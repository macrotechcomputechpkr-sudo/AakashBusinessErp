// =============================================
// utils/fixedAssets.js
// Fixed asset register and depreciation.
//
// Depreciation of an asset for [from, to] (days counted inclusive):
//   SLM  (cost - salvage) x rate% x days / 365       (straight line)
//   WDV  book value at `from` x rate% x days / 365    (written down value)
//   never below the salvage value.
// An asset is depreciated from the day after `depreciated_upto` (or its
// put-to-use date); a run moves `depreciated_upto` forward, so the same days
// are never charged twice. Cancelling a run reverses its GL and moves the
// date back.
//
// GL (document type 'depreciation'): Dr depreciation expense ledger,
//   Cr accumulated depreciation ledger - or the asset ledger itself when
//   the asset has none (the asset's value goes down directly).
// Disposal (sale / scrap), on its own or automatically when the asset's
//   product is sold on a Sales Bill: depreciation up to the disposal date,
//   then the book value leaves the asset (document type 'asset_disposal'):
//     Dr accumulated depreciation (all of it, when that ledger is used)
//     Dr disposal ledger          (book value)
//     Cr asset ledger             (cost, or book value when charged directly)
//   The sale proceeds come from the Sales Bill (its sales account should be
//   the disposal ledger), so the disposal ledger ends as the gain / loss.
// =============================================

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;   // inclusive
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const d10 = v => (v ? String(v).slice(0, 10) : null);
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

// Pure: depreciation of one asset for [from, to] given its book value at `from`.
function depreciationFor(asset, bookValue, from, to) {
    if (to < from) return 0;
    const n = days(from, to), rate = Number(asset.rate) || 0, salvage = Number(asset.salvage_value) || 0;
    const room = Math.max(0, bookValue - salvage);
    const raw = asset.method === 'slm' ? (Number(asset.cost) - salvage) * rate / 100 * n / 365 : bookValue * rate / 100 * n / 365;
    return round2(Math.min(room, Math.max(0, raw)));
}

async function loadAssets(c, t, q = {}) {
    let assets = await fetchAll(() => { let x = c.from('fixed_assets').select('*').eq('tenant_id', t); return x.order('asset_code'); });
    const ids = csv(q.asset_ids), br = csv(q.branch_ids), cc = csv(q.cost_center_ids), led = csv(q.asset_ledger_ids);
    if (ids.length) assets = assets.filter(a => ids.includes(a.id));
    if (br.length) assets = assets.filter(a => br.includes(a.branch_id));
    if (cc.length) assets = assets.filter(a => cc.includes(a.cost_center_id));
    if (led.length) assets = assets.filter(a => led.includes(a.asset_ledger_id));
    const entries = await inChunks(assets.map(a => a.id), async ch => {
        const { data, error } = await c.from('depreciation_entries').select('*, run:run_id!inner(status, doc_no, run_type, posting_date)').eq('tenant_id', t).in('asset_id', ch).eq('run.status', 'posted');
        if (error) throw error; return data || [];
    });
    const byAsset = {};
    entries.forEach(e => (byAsset[e.asset_id] = byAsset[e.asset_id] || []).push(e));
    return assets.map(a => ({ ...a, cost: Number(a.cost), opening_accumulated_dep: Number(a.opening_accumulated_dep) || 0, entries: (byAsset[a.id] || []).sort((x, y) => String(x.from_date).localeCompare(String(y.from_date))) }));
}
// accumulated depreciation of an asset up to a date (opening + posted entries ending on / before it)
const accumulatedUpto = (a, date) => round2(a.opening_accumulated_dep + a.entries.filter(e => d10(e.to_date) <= date).reduce((s, e) => s + Number(e.depreciation), 0));

// What a run up to `periodTo` would charge (preview) - active assets only.
async function previewDepreciation(c, t, q) {
    if (!q.period_to) throw httpError('Choose the date up to which depreciation is charged');
    const assets = (await loadAssets(c, t, q)).filter(a => a.status === 'active');
    const rows = [];
    assets.forEach(a => {
        const start = a.depreciated_upto ? addDays(d10(a.depreciated_upto), 1) : d10(a.put_to_use_date);
        const from = start > d10(a.put_to_use_date) ? start : d10(a.put_to_use_date);
        if (from > q.period_to) return;
        const bv = round2(a.cost - accumulatedUpto(a, '9999-12-31'));
        const dep = depreciationFor(a, bv, from, q.period_to);
        rows.push({ asset_id: a.id, asset_code: a.asset_code, asset_name: a.asset_name, method: a.method, rate: Number(a.rate), from_date: from, to_date: q.period_to, days: days(from, q.period_to),
            cost: a.cost, opening_value: bv, depreciation: dep, closing_value: round2(bv - dep), dep_expense_ledger_id: a.dep_expense_ledger_id,
            credit_ledger_id: a.accumulated_dep_ledger_id || a.asset_ledger_id, sub_ledger_id: a.sub_ledger_id, direct: !a.accumulated_dep_ledger_id });
    });
    return { period_to: q.period_to, rows, total: round2(rows.reduce((s, r) => s + r.depreciation, 0)) };
}

async function nextNo(c, t, prefix) {
    const { data } = await c.from('depreciation_runs').select('doc_no').eq('tenant_id', t);
    const n = (data || []).filter(r => String(r.doc_no).startsWith(prefix)).map(r => Number(String(r.doc_no).replace(/\D/g, '')) || 0).reduce((a, b) => Math.max(a, b), 0) + 1;
    return `${prefix}-${String(n).padStart(4, '0')}`;
}
async function postBatch(c, t, userId, docType, docId, date, narration, lines) {
    const { data: batch, error } = await c.from('ledger_transaction_batches').insert({ tenant_id: t, document_type: docType, document_id: docId, batch_date: date, narration, created_by: userId || null }).select().single();
    if (error) throw error;
    const rows = lines.filter(l => (l.debit || 0) > 0.004 || (l.credit || 0) > 0.004).map(l => ({ tenant_id: t, batch_id: batch.id, ledger_account_id: l.ledgerId, sub_ledger_id: l.subLedgerId || null,
        debit_amount: round2(l.debit || 0), credit_amount: round2(l.credit || 0), narration: l.narration || narration }));
    const { error: e2 } = await c.from('ledger_transaction_lines').insert(rows);
    if (e2) throw e2;
}

async function postDepreciation(c, t, userId, body) {
    const pv = await previewDepreciation(c, t, body);
    const chosen = csv(body.post_asset_ids);
    const rows = (chosen.length ? pv.rows.filter(r => chosen.includes(r.asset_id)) : pv.rows).filter(r => r.depreciation > 0);
    if (!rows.length) throw httpError('Nothing to post - no depreciation for the chosen assets and date');
    const postingDate = body.posting_date || body.period_to;
    const docNo = await nextNo(c, t, 'DEP');
    const total = round2(rows.reduce((s, r) => s + r.depreciation, 0));
    const { data: run, error } = await c.from('depreciation_runs').insert({ tenant_id: t, status: 'posted', doc_no: docNo, run_type: 'periodic', period_to: body.period_to, posting_date: postingDate, total_amount: total,
        asset_count: rows.length, narration: body.narration || `Depreciation up to ${body.period_to}`, created_by: userId || null }).select().single();
    if (error) throw error;
    const { error: e2 } = await c.from('depreciation_entries').insert(rows.map(r => ({ tenant_id: t, run_id: run.id, asset_id: r.asset_id, from_date: r.from_date, to_date: r.to_date, days: r.days,
        opening_value: r.opening_value, depreciation: r.depreciation, closing_value: r.closing_value, method: r.method, rate: r.rate })));
    if (e2) throw e2;
    // GL: expense by ledger, credit by asset (keeps the asset sub-ledger)
    const exp = {};
    rows.forEach(r => { exp[r.dep_expense_ledger_id] = round2((exp[r.dep_expense_ledger_id] || 0) + r.depreciation); });
    const lines = [...Object.entries(exp).map(([id, amt]) => ({ ledgerId: id, debit: amt })),
        ...rows.map(r => ({ ledgerId: r.credit_ledger_id, subLedgerId: r.sub_ledger_id, credit: r.depreciation, narration: `Depreciation ${r.asset_code} ${r.from_date} to ${r.to_date}` }))];
    await postBatch(c, t, userId, 'depreciation', run.id, postingDate, `Depreciation ${docNo} up to ${body.period_to}`, lines);
    for (const r of rows) await c.from('fixed_assets').update({ depreciated_upto: r.to_date, updated_at: new Date().toISOString() }).eq('id', r.asset_id);
    return { run_id: run.id, doc_no: docNo, assets: rows.length, total };
}

// Dispose an asset (sold / scrapped) on a date.
async function disposeAsset(c, t, userId, assetId, body) {
    const [a] = await loadAssets(c, t, { asset_ids: assetId });
    if (!a) throw httpError('Asset not found', 404);
    if (a.status !== 'active') throw httpError(`${a.asset_code} is already ${a.status}`);
    const date = body.disposal_date;
    if (!date) throw httpError('Give the disposal date');
    if (date < d10(a.put_to_use_date)) throw httpError('Disposal date is before the asset was put to use');
    if (a.depreciated_upto && date < d10(a.depreciated_upto)) throw httpError(`Depreciation is already posted up to ${d10(a.depreciated_upto)} - cancel that run first or choose a later date`);
    if (!a.disposal_ledger_id && !body.disposal_ledger_id) throw httpError('Set the disposal (gain / loss on sale) ledger on the asset');
    const disposalLedger = body.disposal_ledger_id || a.disposal_ledger_id;
    const from = a.depreciated_upto ? addDays(d10(a.depreciated_upto), 1) : d10(a.put_to_use_date);
    const bvBefore = round2(a.cost - accumulatedUpto(a, '9999-12-31'));
    const dep = from <= date ? depreciationFor(a, bvBefore, from, date) : 0;
    const bv = round2(bvBefore - dep);
    const accTotal = round2(a.cost - bv);
    const amount = body.disposal_amount === undefined || body.disposal_amount === '' ? null : round2(body.disposal_amount);
    const docNo = await nextNo(c, t, 'DSP');
    const { data: run, error } = await c.from('depreciation_runs').insert({ tenant_id: t, status: 'posted', doc_no: docNo, run_type: 'disposal', period_to: date, posting_date: date, total_amount: dep, asset_count: 1,
        narration: `${body.scrap ? 'Scrap' : 'Sale'} of ${a.asset_code} ${a.asset_name}${body.sales_bill_no ? ` (bill ${body.sales_bill_no})` : ''}`, created_by: userId || null }).select().single();
    if (error) throw error;
    const { error: e2 } = await c.from('depreciation_entries').insert({ tenant_id: t, run_id: run.id, asset_id: a.id, from_date: from <= date ? from : date, to_date: date, days: from <= date ? days(from, date) : 0,
        opening_value: bvBefore, depreciation: dep, closing_value: 0, method: a.method, rate: a.rate, disposal_amount: amount, gain_loss: amount === null ? null : round2(amount - bv) });
    if (e2) throw e2;
    const credit = a.accumulated_dep_ledger_id || a.asset_ledger_id;
    const lines = [];
    if (dep > 0) lines.push({ ledgerId: a.dep_expense_ledger_id, debit: dep, narration: `Depreciation to disposal ${a.asset_code}` }, { ledgerId: credit, subLedgerId: a.sub_ledger_id, credit: dep, narration: `Depreciation to disposal ${a.asset_code}` });
    if (a.accumulated_dep_ledger_id) {
        lines.push({ ledgerId: a.accumulated_dep_ledger_id, subLedgerId: a.sub_ledger_id, debit: accTotal, narration: `Accumulated depreciation of ${a.asset_code} written off` });
        lines.push({ ledgerId: disposalLedger, debit: bv, narration: `Book value of ${a.asset_code}` });
        lines.push({ ledgerId: a.asset_ledger_id, subLedgerId: a.sub_ledger_id, credit: round2(a.cost), narration: `${a.asset_code} disposed` });
    } else if (bv > 0) {
        lines.push({ ledgerId: disposalLedger, debit: bv, narration: `Book value of ${a.asset_code}` }, { ledgerId: a.asset_ledger_id, subLedgerId: a.sub_ledger_id, credit: bv, narration: `${a.asset_code} disposed` });
    }
    // proceeds received without a sales bill
    if (amount && !body.sales_bill_id && body.receipt_ledger_id) lines.push({ ledgerId: body.receipt_ledger_id, debit: amount, narration: `Sale of ${a.asset_code}` }, { ledgerId: disposalLedger, credit: amount, narration: `Sale of ${a.asset_code}` });
    if (lines.length) await postBatch(c, t, userId, 'asset_disposal', run.id, date, `${docNo} ${a.asset_code} disposal`, lines);
    await c.from('fixed_assets').update({ status: body.scrap ? 'scrapped' : 'disposed', disposal_date: date, disposal_amount: amount, disposal_sales_bill_id: body.sales_bill_id || null,
        depreciated_upto: date, updated_at: new Date().toISOString() }).eq('id', a.id);
    return { run_id: run.id, doc_no: docNo, depreciation: dep, book_value: bv, gain_loss: amount === null ? null : round2(amount - bv) };
}

async function cancelRun(c, t, userId, runId, reason) {
    if (!reason) throw httpError('Give a reason for cancelling');
    const { data: run } = await c.from('depreciation_runs').select('*').eq('tenant_id', t).eq('id', runId).maybeSingle();
    if (!run) throw httpError('Run not found', 404);
    if (run.status === 'cancelled') throw httpError('Already cancelled');
    const { data: entries } = await c.from('depreciation_entries').select('asset_id, to_date').eq('run_id', runId);
    // a later posted run on the same asset must be cancelled first
    const assetIds = [...new Set((entries || []).map(e => e.asset_id))];
    const later = await inChunks(assetIds, async ch => { const { data } = await c.from('depreciation_entries').select('asset_id, to_date, run:run_id!inner(status, doc_no, id)').in('asset_id', ch).eq('run.status', 'posted'); return data || []; });
    const blocking = later.filter(e => e.run.id !== runId && (entries || []).some(x => x.asset_id === e.asset_id && d10(e.to_date) > d10(x.to_date)));
    if (blocking.length) throw httpError(`Cancel the later run ${blocking[0].run.doc_no} first`);
    for (const dt of ['depreciation', 'asset_disposal']) {
        const { data: batches } = await c.from('ledger_transaction_batches').select('id').eq('document_type', dt).eq('document_id', runId);
        for (const b of batches || []) { await c.from('ledger_transaction_lines').delete().eq('batch_id', b.id); await c.from('ledger_transaction_batches').delete().eq('id', b.id); }
    }
    await c.from('depreciation_runs').update({ status: 'cancelled', cancellation_reason: reason, cancelled_at: new Date().toISOString(), cancelled_by: userId || null }).eq('id', runId);
    for (const id of assetIds) {
        const { data: a } = await c.from('fixed_assets').select('dep_charged_upto_at_start').eq('id', id).maybeSingle();
        const rest = later.filter(e => e.asset_id === id && e.run.id !== runId).map(e => d10(e.to_date)).sort();
        const up = { depreciated_upto: rest.length ? rest[rest.length - 1] : (a?.dep_charged_upto_at_start || null), updated_at: new Date().toISOString() };
        if (run.run_type === 'disposal') Object.assign(up, { status: 'active', disposal_date: null, disposal_amount: null, disposal_sales_bill_id: null });
        await c.from('fixed_assets').update(up).eq('id', id);
    }
    return { ok: true };
}

// Sales Bill posted: its fixed-asset products are disposed (oldest assets first, one per unit).
async function disposeOnSale(c, t, userId, bill, details) {
    const productIds = [...new Set((details || []).map(d => d.product_id).filter(Boolean))];
    if (!productIds.length) return [];
    const { data: assets, error } = await c.from('fixed_assets').select('*').eq('tenant_id', t).eq('status', 'active').in('product_id', productIds);
    if (error || !(assets || []).length) return [];
    const out = [];
    for (const pid of productIds) {
        const list = assets.filter(a => a.product_id === pid).sort((a, b) => String(a.put_to_use_date).localeCompare(String(b.put_to_use_date)));
        const lines = details.filter(d => d.product_id === pid);
        const qty = Math.round(lines.reduce((s, d) => s + (Number(d.qty) || 0), 0));
        const value = lines.reduce((s, d) => s + (Number(d.amount) || 0) - (Number(d.tax_amount) || 0), 0);
        const n = Math.min(qty, list.length);
        for (let i = 0; i < n; i++) {
            try {
                const r = await disposeAsset(c, t, userId, list[i].id, { disposal_date: d10(bill.doc_date), disposal_amount: round2(value / (qty || 1)), sales_bill_id: bill.id, sales_bill_no: bill.doc_no });
                out.push({ asset_code: list[i].asset_code, ...r });
            } catch (e) { out.push({ asset_code: list[i].asset_code, error: e.message }); }
        }
    }
    return out;
}
// Sales Bill cancelled: undo the disposals it made.
async function undoSaleDisposals(c, t, userId, billId) {
    const { data: assets } = await c.from('fixed_assets').select('id').eq('tenant_id', t).eq('disposal_sales_bill_id', billId);
    for (const a of assets || []) {
        const { data: ents } = await c.from('depreciation_entries').select('run_id, run:run_id!inner(status, run_type)').eq('asset_id', a.id).eq('run.status', 'posted').eq('run.run_type', 'disposal');
        for (const e of ents || []) await cancelRun(c, t, userId, e.run_id, 'Sales bill cancelled');
    }
}

// ---------- reports ----------
// Register / schedule for a period: cost and depreciation movement per asset,
// grouped by asset ledger / branch / cost center / tax block / method.
async function assetSchedule(c, t, q) {
    const from = q.from || '1900-01-01', to = q.to || new Date().toISOString().slice(0, 10);
    const assets = await loadAssets(c, t, q);
    const ledgerIds = [...new Set(assets.flatMap(a => [a.asset_ledger_id, a.accumulated_dep_ledger_id, a.dep_expense_ledger_id]).filter(Boolean))];
    const names = Object.fromEntries((await inChunks(ledgerIds, async ch => { const { data } = await c.from('ledger_accounts').select('id, account_name').in('id', ch); return data || []; })).map(x => [x.id, x.account_name]));
    const [branches, ccs] = await Promise.all([fetchAll(() => c.from('branches').select('id, branch_name').eq('tenant_id', t).order('id')), fetchAll(() => c.from('cost_centers').select('id, cost_center_name').eq('tenant_id', t).order('id'))]);
    const brName = Object.fromEntries(branches.map(b => [b.id, b.branch_name])), ccName = Object.fromEntries(ccs.map(x => [x.id, x.cost_center_name]));
    const rows = assets.filter(a => d10(a.put_to_use_date) <= to && !(a.disposal_date && d10(a.disposal_date) < from)).map(a => {
        const inBefore = d10(a.put_to_use_date) < from;
        const disposedIn = a.disposal_date && d10(a.disposal_date) >= from && d10(a.disposal_date) <= to;
        const accOpen = inBefore ? accumulatedUpto(a, addDays(from, -1)) : 0;
        const charge = round2(a.entries.filter(e => d10(e.to_date) >= from && d10(e.to_date) <= to).reduce((s, e) => s + Number(e.depreciation), 0));
        const openCost = inBefore ? a.cost : 0, additions = inBefore ? 0 : a.cost, disposals = disposedIn ? a.cost : 0;
        const accOnDisposal = disposedIn ? round2(accOpen + charge + (inBefore ? 0 : a.opening_accumulated_dep)) : 0;
        const accClose = round2(accOpen + charge + (inBefore ? 0 : a.opening_accumulated_dep) - accOnDisposal);
        const closeCost = round2(openCost + additions - disposals);
        const disp = a.entries.find(e => e.disposal_amount !== null && e.disposal_amount !== undefined);
        return { asset_id: a.id, asset_code: a.asset_code, asset_name: a.asset_name, status: a.status, method: a.method, rate: Number(a.rate), tax_block: a.tax_block || '',
            asset_ledger: names[a.asset_ledger_id] || '', branch: brName[a.branch_id] || '', cost_center: ccName[a.cost_center_id] || '', location: a.location || '',
            put_to_use_date: d10(a.put_to_use_date), depreciated_upto: d10(a.depreciated_upto), disposal_date: d10(a.disposal_date),
            opening_cost: round2(openCost), additions: round2(additions), disposals: round2(disposals), closing_cost: closeCost,
            opening_dep: round2(accOpen + (inBefore ? 0 : 0)), brought_in_dep: inBefore ? 0 : round2(a.opening_accumulated_dep), charge, dep_on_disposal: accOnDisposal, closing_dep: accClose,
            opening_nbv: round2(openCost - accOpen), closing_nbv: round2(closeCost - accClose),
            disposal_amount: disposedIn ? (a.disposal_amount === null ? null : round2(a.disposal_amount)) : null, gain_loss: disposedIn && disp ? round2(disp.gain_loss) : null };
    });
    const groupBy = ['asset_ledger', 'branch', 'cost_center', 'tax_block', 'method', 'status'].includes(q.group_by) ? q.group_by : null;
    const sumKeys = ['opening_cost', 'additions', 'disposals', 'closing_cost', 'opening_dep', 'brought_in_dep', 'charge', 'dep_on_disposal', 'closing_dep', 'opening_nbv', 'closing_nbv'];
    const sum = list => Object.fromEntries(sumKeys.map(k => [k, round2(list.reduce((s, r) => s + (r[k] || 0), 0))]));
    const groups = groupBy ? Object.values(rows.reduce((m, r) => { const k = r[groupBy] || '(none)'; (m[k] = m[k] || { key: k, rows: [] }).rows.push(r); return m; }, {})).map(g => ({ ...g, totals: sum(g.rows) })) : null;
    return { from, to, group_by: groupBy, rows, groups, totals: sum(rows) };
}

async function depreciationDetail(c, t, q) {
    const runs = await fetchAll(() => { let x = c.from('depreciation_runs').select('*').eq('tenant_id', t); if (q.from) x = x.gte('posting_date', q.from); if (q.to) x = x.lte('posting_date', q.to); return x.order('posting_date', { ascending: false }); });
    const entries = await inChunks(runs.map(r => r.id), async ch => { const { data } = await c.from('depreciation_entries').select('*').in('run_id', ch); return data || []; });
    const assets = Object.fromEntries((await inChunks([...new Set(entries.map(e => e.asset_id))], async ch => { const { data } = await c.from('fixed_assets').select('id, asset_code, asset_name').in('id', ch); return data || []; })).map(a => [a.id, a]));
    const runById = Object.fromEntries(runs.map(r => [r.id, r]));
    let rows = entries.map(e => ({ ...e, asset_code: assets[e.asset_id]?.asset_code, asset_name: assets[e.asset_id]?.asset_name, run_no: runById[e.run_id]?.doc_no, run_type: runById[e.run_id]?.run_type,
        run_status: runById[e.run_id]?.status, posting_date: runById[e.run_id]?.posting_date }));
    if (q.asset_id) rows = rows.filter(r => r.asset_id === q.asset_id);
    if (q.status) rows = rows.filter(r => r.run_status === q.status);
    return { runs, rows: rows.sort((a, b) => String(a.asset_code).localeCompare(String(b.asset_code)) || String(a.from_date).localeCompare(String(b.from_date))) };
}

const ASSET_FIELDS = ['asset_code', 'asset_name', 'product_id', 'sub_ledger_id', 'asset_ledger_id', 'accumulated_dep_ledger_id', 'dep_expense_ledger_id', 'disposal_ledger_id', 'branch_id', 'cost_center_id',
    'business_unit_id', 'location', 'vendor_ledger_id', 'purchase_bill_id', 'purchase_date', 'put_to_use_date', 'cost', 'opening_accumulated_dep', 'method', 'rate', 'salvage_value', 'tax_block', 'depreciated_upto', 'notes'];
async function saveAsset(c, t, userId, id, body) {
    const row = {};
    ASSET_FIELDS.forEach(k => { if (body[k] !== undefined) row[k] = body[k] === '' ? null : body[k]; });
    if (!id || row.asset_code !== undefined) if (!String(row.asset_code || '').trim()) throw httpError('Asset code is required');
    if (!id) {
        for (const k of ['asset_name', 'asset_ledger_id', 'dep_expense_ledger_id', 'put_to_use_date']) if (!row[k]) throw httpError(`${k.replace(/_/g, ' ')} is required`);
        if (!(Number(row.cost) > 0)) throw httpError('Cost must be more than zero');
    }
    if (row.method && !['slm', 'wdv'].includes(row.method)) throw httpError('Method must be SLM or WDV');
    if (row.rate !== undefined && !(Number(row.rate) >= 0 && Number(row.rate) <= 100)) throw httpError('Rate must be 0 - 100%');
    if (id) {
        const { data: cur } = await c.from('fixed_assets').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
        if (!cur) throw httpError('Asset not found', 404);
        const { data: posted } = await c.from('depreciation_entries').select('id, run:run_id!inner(status)').eq('asset_id', id).eq('run.status', 'posted').limit(1);
        if ((posted || []).length) ['cost', 'opening_accumulated_dep', 'put_to_use_date', 'depreciated_upto', 'method'].forEach(k => { if (row[k] !== undefined && String(row[k]) !== String(cur[k])) throw httpError(`${k.replace(/_/g, ' ')} cannot change after depreciation is posted - cancel those runs first`); });
        const { data, error } = await c.from('fixed_assets').update({ ...row, ...(row.depreciated_upto !== undefined && !(posted || []).length ? { dep_charged_upto_at_start: row.depreciated_upto } : {}), updated_by: userId || null, updated_at: new Date().toISOString() }).eq('id', id).select().single();
        if (error) throw error; return data;
    }
    const { data, error } = await c.from('fixed_assets').insert({ ...row, tenant_id: t, dep_charged_upto_at_start: row.depreciated_upto || null, status: 'active', created_by: userId || null }).select().single();
    if (error) throw error;
    return data;
}

module.exports = { depreciationFor, loadAssets, previewDepreciation, postDepreciation, disposeAsset, cancelRun, disposeOnSale, undoSaleDisposals, assetSchedule, depreciationDetail, saveAsset, accumulatedUpto };
