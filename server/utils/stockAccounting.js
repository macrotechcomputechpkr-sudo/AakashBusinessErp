// =============================================
// utils/stockAccounting.js
// GL side of Stock Transfer and Stock Adjustment (see
// database/112_stock_transfer_branch_adjustment_schema.sql for the full
// accounting reasoning).
//
// Stock here is PERIODIC: the statements value stock from stock_movements
// (stockEngine) and replace the GL balance of Inventory-group ledgers with
// it, so  COGS = Opening + Purchases + Inventory-GL movement - Closing.
// A ledger in the INVENTORY group or in a PURCHASE / direct-expense group
// is therefore "stock-neutral": whatever is posted to it cancels against
// the stock movement's own effect on COGS.
//   Transfer    Dr receiving stock a/c  Cr sending stock a/c   (both neutral)
//               two-step: Dr Goods in Transit Cr sending, then
//                         Dr receiving Cr Goods in Transit
//   Shortage /  Dr Stock Loss or Damage (expense)  Cr Stock Adjustment (neutral)
//   damage
//   Excess      Dr Stock Adjustment (neutral)      Cr Stock Gain (income)
// Any other choice of ledger would change profit or the Balance Sheet for
// a movement that has no such effect, so posting refuses it.
// =============================================
const fe = require('./financialEngine');
const stockEngine = require('./stockEngine');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

const SETTING_COLS = 'stock_transfer_gl_posting, branch_transfer_receipt, stock_transfer_in_ledger_id, stock_transfer_out_ledger_id, goods_transit_ledger_id, ' +
    'stock_adjustment_gl_posting, stock_adjustment_contra_ledger_id, stock_shortage_ledger_id, stock_damage_ledger_id, stock_excess_ledger_id, stock_posting_allow_ledger_change';

async function loadSettings(c, t) {
    const { data, error } = await c.from('system_control_settings').select(SETTING_COLS).eq('tenant_id', t).maybeSingle();
    if (error) throw error;
    return data || {};
}

// { [ledgerId]: { id, name, group, section, inventory, neutral } }
async function classifyLedgers(c, t, ids) {
    const want = [...new Set(ids.filter(Boolean))];
    if (!want.length) return {};
    const [groups, { data, error }] = await Promise.all([
        fe.loadGroups(c, t),
        c.from('ledger_accounts').select('id, account_name, account_group_id').eq('tenant_id', t).in('id', want)
    ]);
    if (error) throw error;
    return Object.fromEntries((data || []).map(l => {
        const g = groups[l.account_group_id];
        const section = fe.sectionOf(g);
        const inventory = g?.anchor === 'INVENTORY';
        return [l.id, { id: l.id, name: l.account_name, group: g?.group_name || '', section, inventory, neutral: inventory || section === 'trading_expense' }];
    }));
}
const SECTION_LABEL = { assets: 'Balance Sheet asset', liabilities: 'Balance Sheet liability', equity: 'Equity', trading_income: 'Sales / trading income',
    trading_expense: 'Purchase / direct expense', indirect_income: 'Other income', indirect_expense: 'Indirect expense', unmapped: 'Unmapped group' };
const describe = l => (l.inventory ? 'Inventory (stock) group' : SECTION_LABEL[l.section] || l.section);

// ---------------- Stock Transfer ----------------
async function stockLedgersOf(c, t, warehouseIds, branchIds) {
    const [wh, br] = await Promise.all([
        warehouseIds.length ? c.from('warehouses').select('id, stock_ledger_id').eq('tenant_id', t).in('id', warehouseIds) : { data: [] },
        branchIds.length ? c.from('branches').select('id, stock_ledger_id').eq('tenant_id', t).in('id', branchIds) : { data: [] }
    ]);
    return { wh: Object.fromEntries((wh.data || []).map(w => [w.id, w.stock_ledger_id])), br: Object.fromEntries((br.data || []).map(b => [b.id, b.stock_ledger_id])) };
}

// Accounts a transfer posts to, before any change on the entry.
// Receiving (Dr): To warehouse's stock a/c -> To branch's -> System "Transfer In"
// Sending  (Cr): From warehouse's stock a/c -> From branch's -> System "Transfer Out"
async function transferAccounts(c, t, doc, settings) {
    const s = settings || await loadSettings(c, t);
    const isBranch = doc.transfer_type === 'branch';
    const mode = s.stock_transfer_gl_posting || 'none';
    const map = await stockLedgersOf(c, t, [doc.from_warehouse_id, doc.to_warehouse_id].filter(Boolean), isBranch ? [doc.from_branch_id, doc.to_branch_id].filter(Boolean) : []);
    const twoStep = isBranch && s.branch_transfer_receipt === 'in_transit';
    return {
        posts: mode === 'all' || (mode === 'branch_only' && isBranch),
        posting_mode: mode, two_step: twoStep, allow_change: s.stock_posting_allow_ledger_change !== false,
        dr_ledger_id: map.wh[doc.to_warehouse_id] || (isBranch && map.br[doc.to_branch_id]) || s.stock_transfer_in_ledger_id || null,
        cr_ledger_id: map.wh[doc.from_warehouse_id] || (isBranch && map.br[doc.from_branch_id]) || s.stock_transfer_out_ledger_id || null,
        transit_ledger_id: twoStep ? s.goods_transit_ledger_id || null : null
    };
}

// The ledgers actually used at posting: the entry's own when changing them is
// allowed and they are filled, otherwise freshly resolved.
async function finalTransferAccounts(c, t, doc) {
    const auto = await transferAccounts(c, t, doc);
    const pick = k => (auto.allow_change && doc[k]) || auto[k];
    return { ...auto, dr_ledger_id: pick('dr_ledger_id'), cr_ledger_id: pick('cr_ledger_id'), transit_ledger_id: auto.two_step ? pick('transit_ledger_id') : null };
}

// Throws (400) when posting is on and the ledgers are missing or not stock-neutral.
async function checkTransferAccounts(c, t, acc) {
    if (!acc.posts) return;
    const need = [['dr_ledger_id', 'Receiving stock account (Dr)'], ['cr_ledger_id', 'Sending stock account (Cr)']];
    if (acc.two_step) need.push(['transit_ledger_id', 'Goods in Transit account']);
    const missing = need.filter(([k]) => !acc[k]).map(([, l]) => l);
    if (missing.length) throw httpError(`Stock Transfer GL posting is on but no ${missing.join(', ')} is set - map it in System Control > Stock Posting (or on the branch / warehouse)`);
    const cls = await classifyLedgers(c, t, need.map(([k]) => acc[k]));
    const bad = need.filter(([k]) => cls[acc[k]] && !cls[acc[k]].neutral).map(([k, l]) => `${l} "${cls[acc[k]].name}" is a ${describe(cls[acc[k]])} ledger`);
    if (bad.length) throw httpError(`${bad.join('; ')}. A transfer does not change company stock, so both sides must be Inventory-group (or Purchase-group) ledgers - otherwise profit / Balance Sheet would change.`);
}

// ---------------- Stock Adjustment ----------------
async function adjustmentAccounts(c, t, settings) {
    const s = settings || await loadSettings(c, t);
    return {
        posts: !!s.stock_adjustment_gl_posting, allow_change: s.stock_posting_allow_ledger_change !== false,
        loss_ledger_id: s.stock_shortage_ledger_id || null, damage_ledger_id: s.stock_damage_ledger_id || s.stock_shortage_ledger_id || null,
        gain_ledger_id: s.stock_excess_ledger_id || null, contra_ledger_id: s.stock_adjustment_contra_ledger_id || null
    };
}
const isDamage = reason => reason === 'damage' || reason === 'expiry';
// The ledgers actually used at posting. The entry's own ledgers win when
// changing them is allowed; otherwise a damage / expiry line goes to the
// Damage ledger and any other decrease to the Shortage ledger.
async function finalAdjustmentAccounts(c, t, doc) {
    const auto = await adjustmentAccounts(c, t);
    const own = k => auto.allow_change && doc[k];
    return {
        ...auto,
        lossFor: line => own('loss_ledger_id') || (isDamage(line.line_reason || doc.reason) ? auto.damage_ledger_id : auto.loss_ledger_id),
        gain_ledger_id: own('gain_ledger_id') || auto.gain_ledger_id,
        contra_ledger_id: own('contra_ledger_id') || auto.contra_ledger_id
    };
}
// Returns warnings; throws when posting is impossible or would distort the statements.
async function checkAdjustmentAccounts(c, t, acc, lines) {
    if (!acc.posts) return [];
    const outs = lines.filter(l => l.direction === 'out'), ins = lines.filter(l => l.direction === 'in');
    const missing = [];
    if (!acc.contra_ledger_id) missing.push('Stock Adjustment (contra) account');
    if (outs.some(l => !acc.lossFor(l))) missing.push(outs.some(l => isDamage(l.line_reason)) ? 'Stock Damage / Loss account (Dr)' : 'Stock Shortage / Loss account (Dr)');
    if (ins.length && !acc.gain_ledger_id) missing.push('Stock Excess / Gain account (Cr)');
    if (missing.length) throw httpError(`Stock Adjustment GL posting is on but no ${missing.join(', ')} is set - map it in System Control > Stock Posting`);
    const lossIds = [...new Set(outs.map(l => acc.lossFor(l)))];
    const cls = await classifyLedgers(c, t, [acc.contra_ledger_id, acc.gain_ledger_id, ...lossIds]);
    const contra = cls[acc.contra_ledger_id];
    if (contra && !contra.neutral) throw httpError(`Stock Adjustment account "${contra.name}" is a ${describe(contra)} ledger. It must be an Inventory-group (or Purchase-group) ledger, because the stock movement itself already changes closing stock.`);
    const warnings = [];
    [...lossIds, ins.length ? acc.gain_ledger_id : null].filter(Boolean).forEach(id => {
        const l = cls[id];
        if (l && l.neutral) warnings.push(`"${l.name}" is a stock / purchase ledger, so this ${id === acc.gain_ledger_id ? 'gain' : 'loss'} stays inside cost of goods sold instead of showing separately.`);
    });
    return warnings;
}

// ---------------- GL batch ----------------
// lines: [{ ledgerId, dr, cr, narration }] - amounts merged per ledger and side.
async function postGlBatch(c, t, { documentType, documentId, date, narration, lines, userId }) {
    const merged = {};
    lines.forEach(l => {
        if (!l.ledgerId) return;
        const k = l.ledgerId;
        merged[k] = merged[k] || { dr: 0, cr: 0, narration: l.narration || null };
        merged[k].dr += Number(l.dr) || 0; merged[k].cr += Number(l.cr) || 0;
    });
    const rows = Object.entries(merged).map(([ledgerId, m]) => {
        const net = round2(m.dr - m.cr);
        return net ? { ledger_account_id: ledgerId, debit_amount: net > 0 ? net : 0, credit_amount: net < 0 ? -net : 0, narration: m.narration } : null;
    }).filter(Boolean);
    if (rows.length < 2) return null;                     // same ledger both sides, or nothing to post
    const dr = round2(rows.reduce((s, r) => s + r.debit_amount, 0)), cr = round2(rows.reduce((s, r) => s + r.credit_amount, 0));
    if (dr !== cr) throw httpError(`GL entry does not balance (Dr ${dr} / Cr ${cr})`, 500);
    const { data: batch, error } = await c.from('ledger_transaction_batches')
        .insert({ tenant_id: t, document_type: documentType, document_id: documentId, batch_date: date, narration, created_by: userId }).select().single();
    if (error) throw error;
    const { error: lineErr } = await c.from('ledger_transaction_lines').insert(rows.map(r => ({ tenant_id: t, batch_id: batch.id, ...r })));
    if (lineErr) { await c.from('ledger_transaction_batches').delete().eq('id', batch.id); throw lineErr; }
    return batch.id;
}
async function reverseGlBatches(c, documentTypes, documentId) {
    const { data: batches } = await c.from('ledger_transaction_batches').select('id').in('document_type', documentTypes).eq('document_id', documentId);
    for (const b of batches || []) {
        await c.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await c.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

// ---------------- current cost ----------------
// Cost per BASE unit on `date`: moving-average value of stock on hand, else
// the last purchase rate on the product's base unit.
async function currentCost(c, t, productId, date) {
    const r = await stockEngine.stockMovement(c, t, { from: null, to: date, method: 'moving_average', productId, hideZero: false });
    const row = r.rows[0];
    if (row && row.closing_rate > 0) return { rate: row.closing_rate, on_hand: row.closing_qty, source: 'moving_average' };
    const { data } = await c.from('product_unit_rates').select('last_purchase_rate, purchase_rate').eq('tenant_id', t).eq('product_id', productId).eq('is_base_unit', true).maybeSingle();
    const rate = Number(data?.last_purchase_rate) || Number(data?.purchase_rate) || 0;
    return { rate, on_hand: row ? row.closing_qty : 0, source: rate ? 'purchase_rate' : 'none' };
}

module.exports = { loadSettings, classifyLedgers, describe, transferAccounts, finalTransferAccounts, checkTransferAccounts,
    adjustmentAccounts, finalAdjustmentAccounts, checkAdjustmentAccounts, postGlBatch, reverseGlBatches, currentCost, httpError };
