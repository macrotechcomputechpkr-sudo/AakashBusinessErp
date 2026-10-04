// =============================================
// utils/yearClosing.js
// Year Closing / Re-closing (Setup > Fiscal Years > Year Closing)
//
// Closing a fiscal year posts ONE closing voucher (GL document_type
// 'year_closing', dated the year's last day):
//   * every Profit & Loss ledger (Income / Expenses groups) is brought to nil
//     - its balance at the year end is reversed
//   * the stock ledger (Closing Stock A/c, Inventory group) is moved to the
//     year's closing stock:  closing stock - inventory GL - product opening
//     stock (what the Balance Sheet's Profit & Loss line counted for stock)
//   * the difference - the year's NET PROFIT (or loss) - goes to the
//     Profit & Loss A/c ledger (Equity)
// so after closing the P&L A/c ledger carries the profit of every closed
// year and the next year starts with nil P&L heads. The closing stock is the
// next year's opening stock: stockEngine starts the next year's weighted
// average from it (closed year ends are boundaries), and the item-wise
// figures are kept in fiscal_year_closings.stock_carried.
//
// Reports keep working on the same figures: the Profit & Loss and Trial
// Balance of a period leave the closing voucher dated inside it out (the
// period's P&L is shown before closing), the Balance Sheet takes it in.
// Net profit here = the Profit & Loss report of that year (same engine).
//
// Re-closing: anything later posted or removed with a date on or before a
// closed year's end (a re-opened year, opening stock) marks that closing
// and every later one "needs re-closing" (migration 159 triggers).
// System Control > Year Re-closing:
//   auto    the out-of-date closings are re-posted in date order by
//           themselves (when the Fiscal Years screen or a financial
//           statement is opened, or right after a year is closed again)
//   manual  they are only marked; Re-close does it.
// Re-closing year N changes the stock ledger, so every later closed year
// is re-closed after it (auto) or marked (manual).
// =============================================

const fe = require('./financialEngine');
const stockEngine = require('./stockEngine');
const masterCodes = require('./masterCodes');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const day = d => String(d || '').slice(0, 10);
const httpError = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function settings(c, t) {
    let { data } = await c.from('system_control_settings').select('*').eq('tenant_id', t).maybeSingle();
    if (!data) {                                       // a new company: the default row (as System Control makes it)
        await c.rpc('ensure_system_control_settings', { p_tenant_id: t });
        ({ data } = await c.from('system_control_settings').select('*').eq('tenant_id', t).maybeSingle());
    }
    return data || {};
}
const reclosingMode = s => (s.year_reclosing_mode === 'manual' ? 'manual' : 'auto');
const methodOf = (s, m) => (stockEngine.METHODS[m] ? m : stockEngine.METHODS[s.stock_valuation_method] ? s.stock_valuation_method : 'weighted_average');

async function years(c, t) {
    const { data, error } = await c.from('fiscal_years').select('*').eq('tenant_id', t).order('start_date_eng');
    if (error) throw error;
    return data || [];
}
async function closings(c, t) {
    const { data, error } = await c.from('fiscal_year_closings').select('*').eq('tenant_id', t).order('doc_date');
    if (error) throw error;
    return data || [];
}

// ---------------------------------------------------------------- ledgers
async function groupByAnchor(c, t, anchor) {
    const groups = await fe.loadGroups(c, t);
    const all = Object.values(groups);
    return all.find(g => g.group_code === anchor) || all.find(g => g.anchor === anchor) || null;
}
async function makeLedger(c, t, userId, name, group) {
    const code = await masterCodes.next(c, t, 'ledger');
    const { data, error } = await c.from('ledger_accounts').insert({ tenant_id: t, account_code: code, account_name: name, account_group_id: group.id, category_type: 'others',
        opening_balance: 0, opening_balance_type: 'dr', is_active: true, created_by: userId || null, updated_by: userId || null }).select('id, account_name').single();
    if (error) throw error;
    return data;
}
/** the Profit & Loss A/c (Equity) and Closing Stock A/c (Inventory) ledgers: chosen, saved in System Control, else found / made */
async function closingLedgers(c, t, userId, { plLedgerId, stockLedgerId } = {}, create = true) {
    const s = await settings(c, t);
    const groups = await fe.loadGroups(c, t);
    const byId = async id => (id ? (await c.from('ledger_accounts').select('id, account_name, account_group_id').eq('id', id).eq('tenant_id', t).maybeSingle()).data : null);
    let pl = await byId(plLedgerId || s.year_closing_pl_ledger_id);
    let stock = await byId(stockLedgerId || s.year_closing_stock_ledger_id);
    if (pl && groups[pl.account_group_id]?.nfrs_category !== 'Equity') throw httpError(`${pl.account_name} is not in an Equity group - the Profit & Loss A/c must be a capital / reserve (Equity) ledger`);
    if (stock && groups[stock.account_group_id]?.anchor !== 'INVENTORY') throw httpError(`${stock.account_name} is not in the Inventory group - the closing stock ledger must be a stock (Inventory) ledger`);
    const find = async (names, ok) => {
        const { data } = await c.from('ledger_accounts').select('id, account_name, account_group_id').eq('tenant_id', t);
        return (data || []).find(l => names.some(n => n.test(l.account_name)) && ok(groups[l.account_group_id])) || null;
    };
    if (!pl) pl = await find([/^profit\s*(&|and)\s*loss/i, /^p\s*&\s*l\b/i], g => g?.nfrs_category === 'Equity');
    if (!stock) stock = await find([/closing\s*stock/i, /^stock\s*(in\s*hand|a\/c)?$/i], g => g?.anchor === 'INVENTORY');
    if (create && !pl) {
        const g = await groupByAnchor(c, t, 'RETAINED_EARNINGS') || Object.values(groups).find(x => x.nfrs_category === 'Equity');
        if (!g) throw httpError('No Equity group to hold the Profit & Loss A/c - add one in Chart of Accounts');
        pl = await makeLedger(c, t, userId, 'Profit & Loss A/c', g);
    }
    if (create && !stock) {
        const g = await groupByAnchor(c, t, 'INVENTORY');
        if (!g) throw httpError('No Inventory group for the Closing Stock A/c - add one in Chart of Accounts');
        stock = await makeLedger(c, t, userId, 'Closing Stock A/c', g);
    }
    if (create && (pl?.id !== s.year_closing_pl_ledger_id || stock?.id !== s.year_closing_stock_ledger_id)) {
        await c.from('system_control_settings').update({ year_closing_pl_ledger_id: pl.id, year_closing_stock_ledger_id: stock.id }).eq('tenant_id', t);
    }
    return { pl, stock };
}

// ---------------------------------------------------------------- figures
/**
 * What closing this year posts (the closing voucher of the year itself is
 * left out, so a re-close sees the year as before closing).
 */
async function compute(c, t, fy, method) {
    const end = day(fy.end_date_eng);
    const groups = await fe.loadGroups(c, t);
    const bals = await fe.ledgerBalances(c, t, { from: null, to: end, skipClosingOn: end });
    const sec = b => fe.sectionOf(groups[b.account_group_id]);
    const plRows = [], invRows = [];
    let glResult = 0, invGL = 0;
    Object.values(bals).forEach(b => {
        if (/income|expense/.test(sec(b))) {
            if (Math.abs(b.closing) >= 0.005) { plRows.push({ ledger_id: b.id, code: b.account_code, name: b.account_name, section: sec(b), balance: round2(b.closing) }); glResult -= b.closing; }
        } else if (groups[b.account_group_id]?.anchor === 'INVENTORY') {
            invGL += b.closing;
            if (Math.abs(b.closing) >= 0.005) invRows.push({ ledger_id: b.id, name: b.account_name, balance: round2(b.closing) });
        }
    });
    const { data: prods } = await c.from('products').select('opening_qty, opening_rate').eq('tenant_id', t);
    const openingStockMaster = round2((prods || []).reduce((s, p) => s + (Number(p.opening_qty) || 0) * (Number(p.opening_rate) || 0), 0));
    const cs = await stockEngine.closingStock(c, t, end, method);
    const os = await stockEngine.closingStock(c, t, fe.dayBefore(day(fy.start_date_eng)), method);
    const stockAdjustment = round2(cs.value - invGL - openingStockMaster);
    plRows.sort((a, b) => a.section.localeCompare(b.section) || String(a.name).localeCompare(String(b.name)));
    return {
        fiscal_year_id: fy.id, fiscal_year_name: fy.fiscal_year_name, date: end, stock_method: method, stock_method_label: stockEngine.METHODS[method],
        pl_ledgers: plRows, gl_result: round2(glResult),
        opening_stock: round2(os.value), closing_stock: round2(cs.value), inventory_gl: round2(invGL), inventory_ledgers: invRows, opening_stock_master: openingStockMaster,
        stock_adjustment: stockAdjustment, net_profit: round2(glResult + stockAdjustment),
        stock_carried: cs.lines.map(l => ({ product_id: l.product_id, product_code: l.product_code, product_name: l.product_name, qty: l.qty, rate: l.rate, value: l.value })),
        warnings: cs.warnings || []
    };
}

// ---------------------------------------------------------------- posting
async function setLock(c, fy, closed) {
    const row = closed
        ? { is_closed: true, is_locked: true, is_current: false, status: 'closed', updated_at: new Date().toISOString() }
        : { is_closed: false, is_locked: false, status: 'active', updated_at: new Date().toISOString() };
    const { error } = await c.from('fiscal_years').update(row).eq('id', fy.id);
    if (error) throw error;
}
const isClosed = fy => !!(fy.is_closed || fy.is_locked || fy.status === 'closed');

async function removeVoucher(c, t, closingId) {
    const { data: batches } = await c.from('ledger_transaction_batches').select('id').eq('tenant_id', t).eq('document_type', 'year_closing').eq('document_id', closingId);
    for (const b of batches || []) {
        await c.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        const { error } = await c.from('ledger_transaction_batches').delete().eq('id', b.id);
        if (error) throw error;
    }
}

async function postVoucher(c, t, userId, closing, fig, ledgers) {
    const lines = [];
    fig.pl_ledgers.forEach(r => {
        // reverse the balance: a Dr balance (expense) is credited, a Cr balance (income) debited
        if (r.balance > 0) lines.push({ ledger_account_id: r.ledger_id, debit_amount: 0, credit_amount: r.balance, narration: 'Transferred to Profit & Loss A/c' });
        else lines.push({ ledger_account_id: r.ledger_id, debit_amount: -r.balance, credit_amount: 0, narration: 'Transferred to Profit & Loss A/c' });
    });
    if (Math.abs(fig.stock_adjustment) >= 0.005) {
        lines.push(fig.stock_adjustment > 0
            ? { ledger_account_id: ledgers.stock.id, debit_amount: fig.stock_adjustment, credit_amount: 0, narration: `Closing stock ${fig.closing_stock} (${fig.stock_method_label})` }
            : { ledger_account_id: ledgers.stock.id, debit_amount: 0, credit_amount: -fig.stock_adjustment, narration: `Closing stock ${fig.closing_stock} (${fig.stock_method_label})` });
    }
    const dr = round2(lines.reduce((s, l) => s + l.debit_amount, 0)), cr = round2(lines.reduce((s, l) => s + l.credit_amount, 0));
    const diff = round2(dr - cr);                      // Dr more than Cr = profit -> Cr Profit & Loss A/c
    if (Math.abs(diff) >= 0.005) lines.push(diff > 0
        ? { ledger_account_id: ledgers.pl.id, debit_amount: 0, credit_amount: diff, narration: `Net profit of ${fig.fiscal_year_name}` }
        : { ledger_account_id: ledgers.pl.id, debit_amount: -diff, credit_amount: 0, narration: `Net loss of ${fig.fiscal_year_name}` });
    if (!lines.length) return null;
    const { data: batch, error } = await c.from('ledger_transaction_batches').insert({ tenant_id: t, document_type: 'year_closing', document_id: closing.id, batch_date: fig.date,
        narration: `Year closing ${fig.fiscal_year_name}: P&L heads to Profit & Loss A/c, closing stock carried forward`, created_by: userId || null }).select('id').single();
    if (error) throw error;
    const { error: e2 } = await c.from('ledger_transaction_lines').insert(lines.map(l => ({ tenant_id: t, batch_id: batch.id, ...l, debit_amount: round2(l.debit_amount), credit_amount: round2(l.credit_amount) })));
    if (e2) { await c.from('ledger_transaction_batches').delete().eq('id', batch.id); throw e2; }
    return batch.id;
}

/**
 * Close (or re-close) one year. keepLock: the year's lock state after posting
 * (closing locks it; a re-close leaves a re-opened year open).
 */
async function closeOne(c, t, userId, fy, { method, plLedgerId, stockLedgerId, lock = true, narration } = {}) {
    const s = await settings(c, t);
    method = methodOf(s, method);
    const ledgers = await closingLedgers(c, t, userId, { plLedgerId, stockLedgerId });
    const { data: existing } = await c.from('fiscal_year_closings').select('*').eq('fiscal_year_id', fy.id).maybeSingle();
    const wasLocked = isClosed(fy);
    if (wasLocked) await setLock(c, fy, false);      // the closing voucher is dated inside the year (146 lock)
    try {
        let closing = existing;
        if (!closing) {
            const { data, error } = await c.from('fiscal_year_closings').insert({ tenant_id: t, fiscal_year_id: fy.id, doc_no: `YC-${fy.fiscal_year_code || fy.fiscal_year_nepali || ''}`.replace(/-$/, ''),
                doc_date: day(fy.end_date_eng), closed_by: userId || null, stock_method: method }).select().single();
            if (error) throw error;
            closing = data;
        } else await removeVoucher(c, t, closing.id);
        const fig = await compute(c, t, fy, method);
        const batchId = await postVoucher(c, t, userId, closing, fig, ledgers);
        const row = { doc_date: fig.date, narration: narration || closing.narration || null, batch_id: batchId, pl_ledger_id: ledgers.pl.id, stock_ledger_id: ledgers.stock.id, stock_method: method,
            gl_result: fig.gl_result, opening_stock: fig.opening_stock, closing_stock: fig.closing_stock, stock_adjustment: fig.stock_adjustment, net_profit: fig.net_profit,
            ledgers_closed: fig.pl_ledgers.length, stock_carried: fig.stock_carried, needs_reclosing: false, reclosing_reason: null };
        if (existing) Object.assign(row, { reclosed_count: (existing.reclosed_count || 0) + 1, last_reclosed_at: new Date().toISOString() });
        const { error } = await c.from('fiscal_year_closings').update(row).eq('id', closing.id);
        if (error) throw error;
        if (lock) {
            const { error: e2 } = await c.from('fiscal_years').update({ closing_date: new Date().toISOString().slice(0, 10), closed_by: userId || null }).eq('id', fy.id);
            if (e2) throw e2;
        }
        return { ...fig, closing_id: closing.id, batch_id: batchId, reclosed: !!existing, pl_ledger: ledgers.pl, stock_ledger: ledgers.stock };
    } finally {
        if (lock || wasLocked) await setLock(c, fy, true);
    }
}

/** later closed years, in date order, after `fy` */
async function laterClosings(c, t, fy) {
    return (await closings(c, t)).filter(x => day(x.doc_date) > day(fy.end_date_eng));
}

/** re-post every out-of-date closing (oldest first), each keeping its year's lock state */
async function recloseStale(c, t, userId, { all = false } = {}) {
    const ys = await years(c, t);
    const done = [];
    for (;;) {
        const stale = (await closings(c, t)).filter(x => x.needs_reclosing || all && !done.includes(x.fiscal_year_id));
        if (!stale.length) break;
        const x = stale[0];
        const fy = ys.find(y => y.id === x.fiscal_year_id);
        if (!fy) { await c.from('fiscal_year_closings').update({ needs_reclosing: false }).eq('id', x.id); continue; }
        const before = Number(x.stock_adjustment) || 0;
        const r = await closeOne(c, t, userId, fy, { method: x.stock_method, plLedgerId: x.pl_ledger_id, stockLedgerId: x.stock_ledger_id, lock: isClosed(fy) });
        done.push(fy.id);
        // a changed stock posting moves the stock ledger every later closing started from
        if (Math.abs(before - r.stock_adjustment) >= 0.005) {
            const ids = (await laterClosings(c, t, fy)).map(l => l.id);
            if (ids.length) await c.from('fiscal_year_closings').update({ needs_reclosing: true, reclosing_reason: `${fy.fiscal_year_name} was re-closed` }).in('id', ids).eq('needs_reclosing', false);
        }
        if (done.length > 50) break;
    }
    return done;
}

/** auto mode: re-close what is out of date (called when the Fiscal Years screen / a statement opens) */
async function autoReclose(c, t, userId) {
    try {
        const { data } = await c.from('fiscal_year_closings').select('id').eq('tenant_id', t).eq('needs_reclosing', true).limit(1);
        if (!(data || []).length) return [];
        if (reclosingMode(await settings(c, t)) !== 'auto') return [];
        return await recloseStale(c, t, userId);
    } catch (e) {
        if (/fiscal_year_closings|year_reclosing_mode/.test(e.message || '')) return [];   // migration 159 not run yet
        console.error('auto re-closing failed:', e.message);
        return [];
    }
}

// ---------------------------------------------------------------- actions
async function fyOf(c, t, id) {
    const { data } = await c.from('fiscal_years').select('*').eq('id', id).eq('tenant_id', t).maybeSingle();
    if (!data) throw httpError('Fiscal year not found', 404);
    return data;
}

async function status(c, t, userId, { readOnly = false } = {}) {
    const reclosed = readOnly ? [] : await autoReclose(c, t, userId);
    const s = await settings(c, t);
    const ys = await years(c, t), cl = await closings(c, t);
    const ledgers = await closingLedgers(c, t, userId, {}, false).catch(() => ({}));
    return {
        reclosing_mode: reclosingMode(s), auto_reclosed: reclosed.length, pl_ledger: ledgers.pl || null, stock_ledger: ledgers.stock || null,
        stock_method: methodOf(s), stock_methods: stockEngine.METHODS,
        years: ys.map(y => {
            const x = cl.find(z => z.fiscal_year_id === y.id);
            return { id: y.id, fiscal_year_name: y.fiscal_year_name, fiscal_year_code: y.fiscal_year_code, start_date_eng: y.start_date_eng, end_date_eng: y.end_date_eng,
                start_date_nep: y.start_date_nep, end_date_nep: y.end_date_nep, is_current: y.is_current, locked: isClosed(y),
                closing: x ? { id: x.id, doc_no: x.doc_no, doc_date: x.doc_date, net_profit: Number(x.net_profit), gl_result: Number(x.gl_result), opening_stock: Number(x.opening_stock),
                    closing_stock: Number(x.closing_stock), stock_adjustment: Number(x.stock_adjustment), ledgers_closed: x.ledgers_closed, stock_method: x.stock_method,
                    needs_reclosing: x.needs_reclosing, reclosing_reason: x.reclosing_reason, reclosed_count: x.reclosed_count, closed_at: x.closed_at, last_reclosed_at: x.last_reclosed_at,
                    items_carried: (x.stock_carried || []).length } : null };
        })
    };
}

async function preview(c, t, fyId, method) {
    const fy = await fyOf(c, t, fyId);
    const s = await settings(c, t);
    const fig = await compute(c, t, fy, methodOf(s, method));
    const ys = await years(c, t), cl = await closings(c, t);
    const earlierOpen = ys.filter(y => day(y.end_date_eng) < day(fy.start_date_eng) && !cl.some(x => x.fiscal_year_id === y.id));
    return { ...fig, earlier_not_closed: earlierOpen.map(y => y.fiscal_year_name), already_closed: cl.some(x => x.fiscal_year_id === fy.id) };
}

async function close(c, t, userId, fyId, body = {}) {
    const fy = await fyOf(c, t, fyId);
    const ys = await years(c, t), cl = await closings(c, t);
    const earlierOpen = ys.filter(y => day(y.end_date_eng) < day(fy.start_date_eng) && !cl.some(x => x.fiscal_year_id === y.id));
    if (earlierOpen.length) throw httpError(`Close ${earlierOpen.map(y => y.fiscal_year_name).join(', ')} first - years are closed in order`);
    const result = await closeOne(c, t, userId, fy, { method: body.stock_method, plLedgerId: body.pl_ledger_id, stockLedgerId: body.stock_ledger_id, lock: body.lock !== false, narration: body.narration });
    // closing an old year again changes what later closings started from
    const later = await laterClosings(c, t, fy);
    if (later.length) {
        await c.from('fiscal_year_closings').update({ needs_reclosing: true, reclosing_reason: `${fy.fiscal_year_name} was closed again` }).in('id', later.map(x => x.id));
        if (reclosingMode(await settings(c, t)) === 'auto') result.later_reclosed = (await recloseStale(c, t, userId)).length;
        else result.later_need_reclosing = later.length;
    }
    // the next year becomes the working year
    const next = ys.find(y => day(y.start_date_eng) > day(fy.end_date_eng) && !isClosed(y));
    if (next && fy.is_current) {
        await c.from('fiscal_years').update({ is_current: false }).eq('tenant_id', t);
        await c.from('fiscal_years').update({ is_current: true }).eq('id', next.id);
        result.current_year = next.fiscal_year_name;
    }
    return result;
}

/** re-close one year (and, in auto mode, every later closed year after it) */
async function reclose(c, t, userId, fyId, body = {}) {
    const fy = await fyOf(c, t, fyId);
    const { data: x } = await c.from('fiscal_year_closings').select('*').eq('fiscal_year_id', fy.id).maybeSingle();
    if (!x) throw httpError(`${fy.fiscal_year_name} has not been closed yet - use Close`);
    const result = await closeOne(c, t, userId, fy, { method: body.stock_method || x.stock_method, plLedgerId: body.pl_ledger_id || x.pl_ledger_id, stockLedgerId: body.stock_ledger_id || x.stock_ledger_id, lock: isClosed(fy) });
    const later = await laterClosings(c, t, fy);
    if (later.length && Math.abs(Number(x.stock_adjustment) - result.stock_adjustment) >= 0.005) {
        await c.from('fiscal_year_closings').update({ needs_reclosing: true, reclosing_reason: `${fy.fiscal_year_name} was re-closed` }).in('id', later.map(l => l.id)).eq('needs_reclosing', false);
    }
    if (body.cascade !== false && (reclosingMode(await settings(c, t)) === 'auto' || body.cascade)) result.later_reclosed = (await recloseStale(c, t, userId)).length;
    return result;
}

/** open a closed year again for changes; its closing voucher stays (re-closed when it is closed again / auto) */
async function reopen(c, t, userId, fyId) {
    const fy = await fyOf(c, t, fyId);
    if (!isClosed(fy)) throw httpError(`${fy.fiscal_year_name} is not closed`);
    const later = (await years(c, t)).filter(y => day(y.start_date_eng) > day(fy.end_date_eng) && isClosed(y));
    await setLock(c, fy, false);
    return { reopened: fy.fiscal_year_name, later_closed_years: later.map(y => y.fiscal_year_name) };
}

/** undo a closing completely: voucher removed, year open, record gone */
async function cancelClosing(c, t, userId, fyId) {
    const fy = await fyOf(c, t, fyId);
    const { data: x } = await c.from('fiscal_year_closings').select('*').eq('fiscal_year_id', fy.id).maybeSingle();
    if (!x) throw httpError(`${fy.fiscal_year_name} has no year closing`);
    const later = await laterClosings(c, t, fy);
    if (later.length) throw httpError('Cancel the closing of the later years first');
    if (isClosed(fy)) await setLock(c, fy, false);
    await removeVoucher(c, t, x.id);
    await c.from('fiscal_year_closings').delete().eq('id', x.id);
    return { cancelled: fy.fiscal_year_name };
}

async function setMode(c, t, mode) {
    if (!['auto', 'manual'].includes(mode)) throw httpError('Re-closing is auto or manual');
    await settings(c, t);
    const { error } = await c.from('system_control_settings').update({ year_reclosing_mode: mode }).eq('tenant_id', t);
    if (error) throw error;
    return { reclosing_mode: mode };
}

/** the item-wise closing stock a closed year carried into the next one */
async function carried(c, t, fyId) {
    const fy = await fyOf(c, t, fyId);
    const { data: x } = await c.from('fiscal_year_closings').select('*').eq('fiscal_year_id', fy.id).maybeSingle();
    if (!x) throw httpError(`${fy.fiscal_year_name} has not been closed`);
    return { fiscal_year_name: fy.fiscal_year_name, stock_method: x.stock_method, closing_stock: Number(x.closing_stock), lines: x.stock_carried || [] };
}

module.exports = { compute, preview, close, reclose, reopen, cancelClosing, status, autoReclose, recloseStale, setMode, carried, closingLedgers };
