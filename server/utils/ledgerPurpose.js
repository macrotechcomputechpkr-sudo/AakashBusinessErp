// =============================================
// utils/ledgerPurpose.js
// Which ledgers may be used for which job - decided from the ledger's
// ACCOUNT GROUP (Profit & Loss or Balance Sheet, and its NFRS anchor), the
// same classification the financial statements use (financialEngine).
//
//   sales_goods     Sales / goods account of sales documents, product Sales
//                   Account, JV taxable sales          -> P&L income
//   purchase_goods  Goods account of purchase documents, product Purchase
//                   Account, JV taxable purchase       -> P&L expense, or a
//                   Balance Sheet stock / fixed-asset ledger (capital buy)
//   inventory       product Inventory / Stock account  -> BS current asset
//                   (not cash, bank, debtors, deposits, prepayments)
//   cogs            product COGS account               -> P&L expense
//   discount        product Discount account           -> P&L
//   customer        customer of a JV sale              -> Balance Sheet
//   supplier        supplier of a JV purchase / expense bill -> Balance Sheet
//   expense         additional expense line            -> P&L expense, stock /
//                   fixed asset, or a liability (duty, TDS payable)
//   vat             VAT ledger                          -> Balance Sheet
// A ledger whose group has no NFRS category ("unmapped") cannot be judged
// and is allowed, but flagged, so the chart of accounts can be fixed.
// Used by the pickers (GET /api/ledger-purposes) and checked again on save.
// =============================================

const { loadGroups, sectionOf } = require('./financialEngine');

const INCOME = s => s === 'trading_income' || s === 'indirect_income';
const EXPENSE = s => s === 'trading_expense' || s === 'indirect_expense';
const NOT_STOCK = ['CASH_BANK', 'RECEIVABLES', 'DEPOSITS', 'PREPAYMENTS', 'INVESTMENTS', 'FIXED_ASSETS', 'BANK_OVERDRAFT'];

const PURPOSES = {
    sales_goods: { label: 'Sales / goods account', need: 'a Profit & Loss income ledger', ok: x => INCOME(x.section) },
    purchase_goods: { label: 'Purchase / goods account', need: 'a Profit & Loss expense ledger, or a stock / fixed-asset ledger',
        ok: x => EXPENSE(x.section) || (x.section === 'assets' && ['INVENTORY', 'FIXED_ASSETS'].includes(x.anchor)) },
    inventory: { label: 'Inventory / stock account', need: 'a Balance Sheet current-asset (stock) ledger', ok: x => x.section === 'assets' && !NOT_STOCK.includes(x.anchor) },
    cogs: { label: 'Cost of goods sold account', need: 'a Profit & Loss expense ledger', ok: x => EXPENSE(x.section) },
    discount: { label: 'Discount account', need: 'a Profit & Loss ledger', ok: x => INCOME(x.section) || EXPENSE(x.section) },
    customer: { label: 'Customer', need: 'a Balance Sheet (party) ledger', ok: x => x.statement === 'bs' },
    supplier: { label: 'Supplier', need: 'a Balance Sheet (party) ledger', ok: x => x.statement === 'bs' },
    expense: { label: 'Expense ledger', need: 'a Profit & Loss expense, stock / fixed-asset, or liability ledger',
        ok: x => EXPENSE(x.section) || (x.section === 'assets' && ['INVENTORY', 'FIXED_ASSETS'].includes(x.anchor)) || x.section === 'liabilities' },
    vat: { label: 'VAT ledger', need: 'a Balance Sheet ledger', ok: x => x.statement === 'bs' }
};

async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

// id -> { section, statement: 'pl' | 'bs' | 'unmapped', anchor, group_name }
async function classifyLedgers(c, t, ids = null) {
    const groups = await loadGroups(c, t);
    const ledgers = ids && ids.length
        ? ((await c.from('ledger_accounts').select('id, account_name, account_code, account_group_id').eq('tenant_id', t).in('id', ids)).data || [])
        : await fetchAll(() => c.from('ledger_accounts').select('id, account_name, account_code, account_group_id').eq('tenant_id', t).order('id'));
    const out = {};
    ledgers.forEach(l => {
        const g = groups[l.account_group_id];
        const section = sectionOf(g);
        out[l.id] = { id: l.id, name: l.account_name, code: l.account_code || '', section, statement: section === 'unmapped' ? 'unmapped' : /income|expense/.test(section) ? 'pl' : 'bs',
            anchor: g ? g.anchor : null, group_name: g ? g.group_name : '' };
    });
    return out;
}

const allowed = (cls, purpose) => !!cls && (cls.statement === 'unmapped' || PURPOSES[purpose].ok(cls));

// { field: purpose } -> error text, or null. Empty fields are skipped.
async function checkAccountPurposes(c, t, body, fields) {
    const entries = Object.entries(fields).filter(([f, p]) => body && body[f] && PURPOSES[p]);
    if (!entries.length) return null;
    const cls = await classifyLedgers(c, t, [...new Set(entries.map(([f]) => body[f]))]);
    for (const [f, p] of entries) {
        const x = cls[body[f]];
        if (!x) return `${PURPOSES[p].label}: ledger not found`;
        if (!allowed(x, p)) return `${PURPOSES[p].label} must be ${PURPOSES[p].need} - "${x.name}" is under ${x.group_name || 'its group'} (${x.statement === 'pl' ? 'Profit & Loss' : 'Balance Sheet'})`;
    }
    return null;
}

// Every ledger with the purposes it may be used for (for the pickers).
async function ledgerPurposeMap(c, t) {
    const cls = await classifyLedgers(c, t);
    return Object.values(cls).map(x => ({ ...x, purposes: Object.keys(PURPOSES).filter(p => allowed(x, p)), unmapped: x.statement === 'unmapped' }));
}

module.exports = { PURPOSES, classifyLedgers, checkAccountPurposes, ledgerPurposeMap, allowed };
