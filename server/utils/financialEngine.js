// =============================================
// utils/financialEngine.js
// One engine behind Trial Balance, Profit & Loss, Balance Sheet, Ratios,
// Cash Flow and Funds Flow - so every figure agrees across reports.
//
// CLASSIFICATION comes from the account groups (seeded with NFRS data):
// nfrs_category (Assets/Liabilities/Equity/Income/Expenses),
// nfrs_classification (Current/Non-Current, Operating/Non-Operating, Direct),
// cash_flow_category, funds_flow_type, ratio_analysis_category, category_type.
// A user-made sub-group inherits any of these it leaves blank from its parent.
//
// STOCK (periodic): the Balance Sheet shows Closing Stock valued by the
// chosen method instead of the GL balance of Inventory-group ledgers, and
// "Profit & Loss A/c" carries cumulative profit
//     = GL (Income - Expenses) to date + Closing Stock - Inventory GL balance
// which keeps the Balance Sheet balanced whether goods were posted to a
// Purchases (expense) ledger or to an Inventory (asset) ledger. The period
// P&L is exactly the change in that line:
//     COGS = Opening Stock + Purchases + Stock-account movement - Closing Stock
// =============================================

const stockEngine = require('./stockEngine');
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
const dayBefore = d => new Date(new Date(d + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- groups
const INHERIT = ['nfrs_category', 'nfrs_classification', 'cash_flow_category', 'funds_flow_type', 'ratio_analysis_category', 'category_type'];
const ANCHORS = ['CASH_BANK', 'RECEIVABLES', 'INVENTORY', 'PREPAYMENTS', 'DEPOSITS', 'CURRENT_ASSETS', 'FIXED_ASSETS', 'INVESTMENTS',
    'PAYABLES', 'BANK_OVERDRAFT', 'TAX_PAYABLE', 'ACCRUED_EXPENSES', 'CURRENT_LIABILITIES', 'LONG_TERM_LOANS', 'BANK_LOANS',
    'SHARE_CAPITAL', 'RETAINED_EARNINGS', 'RESERVES', 'SALES', 'SALES_RETURN', 'DISCOUNT_ALLOWED', 'OTHER_INCOME', 'INTEREST_INCOME',
    'PURCHASES', 'PURCHASE_RETURN', 'DISCOUNT_RECEIVED', 'INTEREST_EXPENSE', 'BANK_CHARGES'];

async function loadGroups(tenantClient, tenantId) {
    const groups = await fetchAll(() => tenantClient.from('account_groups').select('*').eq('tenant_id', tenantId));
    const byId = Object.fromEntries(groups.map(g => [g.id, { ...g }]));
    const resolve = (g, seen = new Set()) => {
        if (g._resolved || seen.has(g.id)) return g;
        seen.add(g.id);
        const parent = g.parent_group_id && byId[g.parent_group_id] ? resolve(byId[g.parent_group_id], seen) : null;
        INHERIT.forEach(k => { if (!g[k] || g[k] === 'others' && k === 'category_type' && parent && parent[k] !== 'others') g[k] = (parent && parent[k]) || g[k] || null; });
        g.anchor = ANCHORS.includes(g.group_code) ? g.group_code : (parent ? parent.anchor : null);
        g.root_id = parent ? parent.root_id : g.id;
        g._resolved = true;
        return g;
    };
    Object.values(byId).forEach(g => resolve(g));
    return byId;
}

// Where a group lands in the statements.
function sectionOf(g) {
    if (!g) return 'unmapped';
    const cat = g.nfrs_category;
    if (cat === 'Assets') return 'assets';
    if (cat === 'Liabilities') return 'liabilities';
    if (cat === 'Equity') return 'equity';
    const trading = g.category_type === 'sales' || g.category_type === 'purchase' || /direct/i.test(g.nfrs_classification || '') && !/indirect/i.test(g.nfrs_classification || '');
    if (cat === 'Income') return trading ? 'trading_income' : 'indirect_income';
    if (cat === 'Expenses') return trading ? 'trading_expense' : 'indirect_expense';
    return 'unmapped';
}
const isPL = s => /income|expense/.test(s);
const isInventory = g => g && g.anchor === 'INVENTORY';
const isCash = g => g && g.anchor === 'CASH_BANK';

// ---------------------------------------------------------------- balances
// Every ledger's signed (Dr +) master opening, movement before `from`, and
// Dr/Cr within [from, to]. `from` null => everything up to `to` is "before".
async function ledgerBalances(tenantClient, tenantId, { from, to, productCompanyId }) {
    const ledgers = await fetchAll(() => tenantClient.from('ledger_accounts')
        .select('id, account_code, account_name, account_group_id, opening_balance, opening_balance_type').eq('tenant_id', tenantId));
    const bal = {};
    ledgers.forEach(l => {
        bal[l.id] = { ...l, master: productCompanyId ? 0 : (l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0), before: 0, dr: 0, cr: 0 };
    });
    const lines = await fetchAll(() => {
        let q = tenantClient.from('ledger_transaction_lines').select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)')
            .eq('tenant_id', tenantId).lte('batch.batch_date', to);
        if (productCompanyId) q = q.eq('product_company_id', productCompanyId);
        return q;
    });
    lines.forEach(l => {
        const b = bal[l.ledger_account_id]; if (!b) return;
        const dr = Number(l.debit_amount) || 0, cr = Number(l.credit_amount) || 0;
        if (from && l.batch.batch_date >= from) { b.dr += dr; b.cr += cr; } else b.before += dr - cr;
    });
    Object.values(bal).forEach(b => { b.opening = round2(b.master + b.before); b.closing = round2(b.opening + b.dr - b.cr); b.dr = round2(b.dr); b.cr = round2(b.cr); });
    return bal;
}

// ---------------------------------------------------------------- stock valuation
const STOCK_METHODS = {
    weighted_average: 'Weighted Average (periodic)', moving_average: 'Moving Average (perpetual)', fifo: 'FIFO',
    lifo: 'LIFO (not permitted by NFRS / IAS 2 - comparison only)', last_purchase: 'Last Purchase Rate', manual: 'Manual value'
};

// Value of stock on hand at the END of `asOf`. Product opening stock
// (products.opening_qty/rate) is a receipt on the opening fiscal year's
// first day. Stock transfers move stock between warehouses only - they
// change neither quantity nor cost at company level, so they are ignored.
async function stockValuation(tenantClient, tenantId, asOf, method = 'weighted_average', manualValue = null) {
    if (method === 'manual') return { method, method_label: STOCK_METHODS.manual, value: round2(manualValue), lines: [], warnings: [] };
    // Same engine as the Stock Movement report, so Closing Stock here always
    // equals that report's closing value for the same date and method.
    return stockEngine.closingStock(tenantClient, tenantId, asOf, method);
}

// ---------------------------------------------------------------- tree
// Nest ledgers under their group chain. amountOf(ledgerBal) gives the
// figure to show; nodes carry subtotal `amount` and children.
function buildTree(groups, bals, filterLedger, amountOf) {
    const nodes = {};
    const nodeFor = gid => {
        if (nodes[gid]) return nodes[gid];
        const g = groups[gid];
        nodes[gid] = { type: 'group', id: gid, name: g ? g.group_name : '(no group)', code: g?.group_code, display_order: g?.display_order || 0, amount: 0, children: [], parent: g?.parent_group_id && groups[g.parent_group_id] ? g.parent_group_id : null };
        if (nodes[gid].parent) nodeFor(nodes[gid].parent);
        return nodes[gid];
    };
    Object.values(bals).filter(filterLedger).forEach(b => {
        const amt = round2(amountOf(b));
        if (Math.abs(amt) < 0.005) return;
        const n = nodeFor(b.account_group_id);
        n.children.push({ type: 'ledger', id: b.id, name: b.account_name, code: b.account_code, amount: amt });
    });
    Object.values(nodes).forEach(n => { if (n.parent) nodes[n.parent].children.push(n); });
    const total = n => { if (n.type === 'ledger') return n.amount; n.amount = round2(n.children.reduce((s, c) => s + total(c), 0)); return n.amount; };
    const sortTree = n => { if (n.children) { n.children.sort((a, b) => (a.type === b.type ? 0 : a.type === 'group' ? -1 : 1) || (a.display_order || 0) - (b.display_order || 0) || String(a.name).localeCompare(String(b.name))); n.children.forEach(sortTree); } };
    const roots = Object.values(nodes).filter(n => !n.parent);
    roots.forEach(total); roots.forEach(sortTree);
    roots.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    return roots.filter(r => Math.abs(r.amount) > 0.005 || r.children.length);
}
const sumTree = roots => round2(roots.reduce((s, r) => s + r.amount, 0));

// ---------------------------------------------------------------- statements
// Cumulative position at the END of `asOf` (Balance Sheet snapshot).
async function positionAt(tenantClient, tenantId, groups, asOf, stockMethod, manualStock, productCompanyId) {
    const bals = await ledgerBalances(tenantClient, tenantId, { from: null, to: asOf, productCompanyId });
    const stock = await stockValuation(tenantClient, tenantId, asOf, stockMethod, manualStock);
    const secOf = b => sectionOf(groups[b.account_group_id]);
    let plGL = 0, invGL = 0, masterSum = 0;
    Object.values(bals).forEach(b => {
        masterSum += b.master;
        if (isPL(secOf(b))) plGL += b.closing;
        if (isInventory(groups[b.account_group_id])) invGL += b.closing;
    });
    // Signed (Dr +) balance of each BS ledger, inventory ledgers excluded (replaced by valued stock).
    const bsLedger = b => ['assets', 'liabilities', 'equity', 'unmapped'].includes(secOf(b)) && !isInventory(groups[b.account_group_id]);
    // Product opening stock (products.opening_qty x opening_rate) is an opening
    // balance - like a Dr ledger opening - so it enters "Difference in opening
    // balances" (matched by whatever capital/opening the user entered), never profit.
    const { data: prods } = await tenantClient.from('products').select('opening_qty, opening_rate').eq('tenant_id', tenantId);
    const openingStockMaster = productCompanyId ? 0 : round2((prods || []).reduce((s, p) => s + (Number(p.opening_qty) || 0) * (Number(p.opening_rate) || 0), 0));
    const cumulativeProfit = round2(-(plGL) + stock.value - invGL - openingStockMaster);   // Cr positive
    // Sum of all GL balances = sum of master openings (every batch balances), so
    // an unbalanced set of openings (M != 0) shows on the Liabilities side as
    // Tally's "Difference in opening balances" (+M) - the sheet still balances.
    const openingDifference = round2(masterSum + openingStockMaster);
    return { bals, stock, secOf, bsLedger, cumulativeProfit, openingDifference, invGL: round2(invGL) };
}

async function balanceSheet(tenantClient, tenantId, { asOf, stockMethod, manualStock, productCompanyId }) {
    const groups = await loadGroups(tenantClient, tenantId);
    const P = await positionAt(tenantClient, tenantId, groups, asOf, stockMethod, manualStock, productCompanyId);
    const tree = sec => buildTree(groups, P.bals, b => P.bsLedger(b) && P.secOf(b) === sec, b => (sec === 'assets' ? 1 : -1) * b.closing);
    const assets = tree('assets'), liabilities = tree('liabilities'), equity = tree('equity');
    const unmapped = buildTree(groups, P.bals, b => P.bsLedger(b) && P.secOf(b) === 'unmapped', b => b.closing);
    const stockNode = { type: 'stock', id: 'closing_stock', name: `Closing Stock (${P.stock.method_label})`, amount: P.stock.value, children: [] };
    const plNode = { type: 'profit', id: 'pl_account', name: 'Profit & Loss A/c (cumulative)', amount: P.cumulativeProfit, children: [] };
    const totalAssets = round2(sumTree(assets) + P.stock.value + Math.max(0, sumTree(unmapped)));
    const diffNode = Math.abs(P.openingDifference) > 0.005 ? [{ type: 'difference', id: 'opening_difference', name: 'Difference in Opening Balances', amount: P.openingDifference, children: [] }] : [];
    const totalLiabEq = round2(sumTree(liabilities) + sumTree(equity) + P.cumulativeProfit - Math.min(0, sumTree(unmapped)) + P.openingDifference);
    return {
        as_of: asOf, stock: P.stock,
        assets: [...assets, stockNode], liabilities: [...liabilities, ...diffNode], equity: [...equity, plNode],
        unmapped, opening_difference: P.openingDifference,
        total_assets: totalAssets, total_liabilities_equity: totalLiabEq,
        balanced: Math.abs(totalAssets - totalLiabEq) < 0.01
    };
}

async function profitAndLoss(tenantClient, tenantId, { from, to, stockMethod, manualOpening, manualClosing, productCompanyId }) {
    const groups = await loadGroups(tenantClient, tenantId);
    const bals = await ledgerBalances(tenantClient, tenantId, { from, to, productCompanyId });
    const secOf = b => sectionOf(groups[b.account_group_id]);
    const net = (b, incomeSide) => incomeSide ? b.cr - b.dr : b.dr - b.cr;
    const tree = (sec, incomeSide) => buildTree(groups, bals, b => secOf(b) === sec, b => net(b, incomeSide));
    const tradingIncome = tree('trading_income', true), tradingExpense = tree('trading_expense', false);
    const indirectIncome = tree('indirect_income', true), indirectExpense = tree('indirect_expense', false);
    const openingStock = await stockValuation(tenantClient, tenantId, dayBefore(from), stockMethod, manualOpening);
    const closingStock = await stockValuation(tenantClient, tenantId, to, stockMethod, manualClosing);
    const stockAccountMovement = round2(Object.values(bals).filter(b => isInventory(groups[b.account_group_id])).reduce((s, b) => s + b.dr - b.cr, 0));
    const netSales = sumTree(tradingIncome);
    const purchases = sumTree(tradingExpense);
    const cogs = round2(openingStock.value + purchases + stockAccountMovement - closingStock.value);
    const grossProfit = round2(netSales - cogs);
    const otherIncome = sumTree(indirectIncome), overheads = sumTree(indirectExpense);
    const netProfit = round2(grossProfit + otherIncome - overheads);
    const pct = v => netSales ? round2(v * 100 / netSales) : null;
    return {
        from, to, stock_method: stockMethod, stock_method_label: STOCK_METHODS[stockMethod],
        trading_income: tradingIncome, trading_expense: tradingExpense, indirect_income: indirectIncome, indirect_expense: indirectExpense,
        opening_stock: openingStock.value, closing_stock: closingStock.value, stock_account_movement: stockAccountMovement,
        net_sales: netSales, purchases, cogs, gross_profit: grossProfit, other_income: otherIncome, overheads, net_profit: netProfit,
        pct: { cogs: pct(cogs), gross_profit: pct(grossProfit), overheads: pct(overheads), other_income: pct(otherIncome), net_profit: pct(netProfit) },
        stock_warnings: [...openingStock.warnings, ...closingStock.warnings]
    };
}

async function trialBalance(tenantClient, tenantId, { from, to, productCompanyId }) {
    const groups = await loadGroups(tenantClient, tenantId);
    const bals = await ledgerBalances(tenantClient, tenantId, { from, to, productCompanyId });
    const rows = Object.values(bals).filter(b => Math.abs(b.opening) > 0.005 || b.dr > 0.005 || b.cr > 0.005 || Math.abs(b.closing) > 0.005);
    const tree = buildTree(groups, bals, b => rows.includes(b), b => b.closing);
    // attach opening/dr/cr to every node
    const byId = Object.fromEntries(rows.map(b => [b.id, b]));
    const fill = n => {
        if (n.type === 'ledger') { const b = byId[n.id]; Object.assign(n, { opening: b.opening, dr: b.dr, cr: b.cr, closing: b.closing }); return n; }
        n.children.forEach(fill);
        ['opening', 'dr', 'cr', 'closing'].forEach(k => { n[k] = round2(n.children.reduce((s, c) => s + (c[k] || 0), 0)); });
        return n;
    };
    const zeroLedgers = Object.values(bals).filter(b => !rows.includes(b)).length;
    const walk = n => { if (n.type === 'ledger') return [n]; return n.children.flatMap(walk); };
    const leaves = tree.map(fill).flatMap(walk);
    const tot = k => round2(leaves.reduce((s, n) => s + (n[k] || 0), 0));
    const sum = { opening_dr: round2(leaves.reduce((s, n) => s + Math.max(0, n.opening), 0)), opening_cr: round2(leaves.reduce((s, n) => s + Math.max(0, -n.opening), 0)),
        dr: tot('dr'), cr: tot('cr'), closing_dr: round2(leaves.reduce((s, n) => s + Math.max(0, n.closing), 0)), closing_cr: round2(leaves.reduce((s, n) => s + Math.max(0, -n.closing), 0)) };
    const unmappedGroups = Object.values(groups).filter(g => sectionOf(g) === 'unmapped').map(g => g.group_name);
    return { from, to, tree, totals: sum, difference: round2(sum.closing_dr - sum.closing_cr), zero_ledgers_hidden: zeroLedgers, unmapped_groups: unmappedGroups };
}

// Balance of every group anchor / classification at a date, for ratios & flows.
function snapshot(groups, P) {
    const s = { current_assets: 0, cash: 0, receivables: 0, current_liabilities: 0, payables: 0, non_current_assets: 0, non_current_liabilities: 0, equity: 0, inventory: P.stock.value };
    const byGroupSigned = {};
    Object.values(P.bals).forEach(b => {
        if (!P.bsLedger(b)) return;
        const g = groups[b.account_group_id], sec = P.secOf(b), current = /^current$/i.test(g?.nfrs_classification || '');
        byGroupSigned[b.account_group_id] = (byGroupSigned[b.account_group_id] || 0) + b.closing;
        if (sec === 'assets') {
            if (isCash(g)) s.cash += b.closing;
            if (g?.anchor === 'RECEIVABLES') s.receivables += b.closing;
            if (current) s.current_assets += b.closing; else s.non_current_assets += b.closing;
        } else if (sec === 'liabilities') {
            if (g?.anchor === 'PAYABLES') s.payables += -b.closing;
            if (current) s.current_liabilities += -b.closing; else s.non_current_liabilities += -b.closing;
        } else if (sec === 'equity') s.equity += -b.closing;
    });
    s.current_assets += P.stock.value;
    s.equity += P.cumulativeProfit + P.openingDifference;
    Object.keys(s).forEach(k => { s[k] = round2(s[k]); });
    s.total_assets = round2(s.current_assets + s.non_current_assets);
    s.working_capital = round2(s.current_assets - s.current_liabilities);
    s.byGroupSigned = byGroupSigned;
    return s;
}

async function ratiosAndFlows(tenantClient, tenantId, { from, to, stockMethod, productCompanyId }) {
    const groups = await loadGroups(tenantClient, tenantId);
    const P0 = await positionAt(tenantClient, tenantId, groups, dayBefore(from), stockMethod, null, productCompanyId);
    const P1 = await positionAt(tenantClient, tenantId, groups, to, stockMethod, null, productCompanyId);
    const s0 = snapshot(groups, P0), s1 = snapshot(groups, P1);
    const pl = await profitAndLoss(tenantClient, tenantId, { from, to, stockMethod, productCompanyId });
    const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    const div = (a, b) => (b && Math.abs(b) > 1e-9) ? round2(a / b) : null;
    const avg = (a, b) => (a + b) / 2;
    const interest = Object.values(P1.bals).filter(b => groups[b.account_group_id]?.anchor === 'INTEREST_EXPENSE').reduce((s, b) => s + (b.closing - b.master) - ((P0.bals[b.id]?.closing || 0) - (P0.bals[b.id]?.master || 0)), 0);
    const ratio = (key, label, value, formula, category, unit = 'x') => ({ key, label, value, formula, category, unit });
    const ratios = [
        ratio('current_ratio', 'Current Ratio', div(s1.current_assets, s1.current_liabilities), 'Current Assets / Current Liabilities', 'Liquidity'),
        ratio('quick_ratio', 'Quick (Acid-test) Ratio', div(s1.current_assets - s1.inventory, s1.current_liabilities), '(Current Assets - Stock) / Current Liabilities', 'Liquidity'),
        ratio('cash_ratio', 'Cash Ratio', div(s1.cash, s1.current_liabilities), 'Cash & Bank / Current Liabilities', 'Liquidity'),
        ratio('working_capital', 'Working Capital', s1.working_capital, 'Current Assets - Current Liabilities', 'Liquidity', 'amount'),
        ratio('debt_equity', 'Debt-Equity Ratio', div(s1.non_current_liabilities, s1.equity), 'Long-term Liabilities / Equity', 'Solvency'),
        ratio('total_debt_equity', 'Total Debt to Equity', div(s1.non_current_liabilities + s1.current_liabilities, s1.equity), 'Total Liabilities / Equity', 'Solvency'),
        ratio('proprietary', 'Proprietary Ratio', div(s1.equity, s1.total_assets), 'Equity / Total Assets', 'Solvency'),
        ratio('interest_coverage', 'Interest Coverage', div(pl.net_profit + interest, interest), '(Net Profit + Interest) / Interest', 'Solvency'),
        ratio('gp_margin', 'Gross Profit Margin', pl.pct.gross_profit, 'Gross Profit / Net Sales x 100', 'Profitability', '%'),
        ratio('np_margin', 'Net Profit Margin', pl.pct.net_profit, 'Net Profit / Net Sales x 100', 'Profitability', '%'),
        ratio('opex_ratio', 'Operating Expense Ratio', pl.pct.overheads, 'Indirect Expenses / Net Sales x 100', 'Profitability', '%'),
        ratio('roe', 'Return on Equity', div(pl.net_profit * 100, avg(s0.equity, s1.equity)), 'Net Profit / Average Equity x 100', 'Profitability', '%'),
        ratio('roa', 'Return on Assets', div(pl.net_profit * 100, avg(s0.total_assets, s1.total_assets)), 'Net Profit / Average Total Assets x 100', 'Profitability', '%'),
        ratio('stock_turnover', 'Stock Turnover', div(pl.cogs, avg(s0.inventory, s1.inventory)), 'COGS / Average Stock', 'Efficiency'),
        ratio('stock_days', 'Stock Holding Days', div(avg(s0.inventory, s1.inventory) * days, pl.cogs), 'Average Stock / COGS x days', 'Efficiency', 'days'),
        ratio('debtor_turnover', 'Debtors Turnover', div(pl.net_sales, avg(s0.receivables, s1.receivables)), 'Net Sales / Average Receivables', 'Efficiency'),
        ratio('debtor_days', 'Debtors Collection Days', div(avg(s0.receivables, s1.receivables) * days, pl.net_sales), 'Average Receivables / Net Sales x days', 'Efficiency', 'days'),
        ratio('creditor_turnover', 'Creditors Turnover', div(pl.purchases, avg(s0.payables, s1.payables)), 'Purchases / Average Payables', 'Efficiency'),
        ratio('creditor_days', 'Creditors Payment Days', div(avg(s0.payables, s1.payables) * days, pl.purchases), 'Average Payables / Purchases x days', 'Efficiency', 'days'),
        ratio('asset_turnover', 'Asset Turnover', div(pl.net_sales, avg(s0.total_assets, s1.total_assets)), 'Net Sales / Average Total Assets', 'Efficiency')
    ];
    const cashCycle = [ratios.find(r => r.key === 'stock_days').value, ratios.find(r => r.key === 'debtor_days').value, ratios.find(r => r.key === 'creditor_days').value];
    if (cashCycle.every(v => v !== null)) ratios.push(ratio('cash_cycle', 'Cash Conversion Cycle', round2(cashCycle[0] + cashCycle[1] - cashCycle[2]), 'Stock Days + Debtor Days - Creditor Days', 'Efficiency', 'days'));

    // ----- Cash Flow (indirect): every non-cash Balance Sheet item's change is
    // a cash effect of the opposite sign; profit comes from the P&L. This
    // reconciles to the actual change in Cash & Bank by construction.
    const cf = { operating: [], investing: [], financing: [] };
    const push = (bucket, name, amount) => { if (Math.abs(amount) > 0.005) cf[bucket].push({ name, amount: round2(amount) }); };
    const gIds = new Set([...Object.keys(s0.byGroupSigned), ...Object.keys(s1.byGroupSigned)]);
    gIds.forEach(gid => {
        const g = groups[gid];
        if (isCash(g)) return;
        const delta = (s1.byGroupSigned[gid] || 0) - (s0.byGroupSigned[gid] || 0);
        const bucket = (g?.cash_flow_category || '').toLowerCase() === 'investing' ? 'investing' : (g?.cash_flow_category || '').toLowerCase() === 'financing' ? 'financing' : 'operating';
        push(bucket, `${delta > 0 ? 'Increase' : 'Decrease'} in ${g ? g.group_name : 'unmapped ledgers'}`, -delta);
    });
    push('operating', `${s1.inventory > s0.inventory ? 'Increase' : 'Decrease'} in Stock`, -(s1.inventory - s0.inventory));
    const opTotal = round2(pl.net_profit + cf.operating.reduce((s, x) => s + x.amount, 0));
    const invTotal = round2(cf.investing.reduce((s, x) => s + x.amount, 0));
    const finTotal = round2(cf.financing.reduce((s, x) => s + x.amount, 0));
    const netChange = round2(opTotal + invTotal + finTotal);
    const cashFlow = { net_profit: pl.net_profit, operating: cf.operating, investing: cf.investing, financing: cf.financing,
        operating_total: opTotal, investing_total: invTotal, financing_total: finTotal, net_change: netChange,
        opening_cash: s0.cash, closing_cash: s1.cash, reconciles: Math.abs(round2(s0.cash + netChange) - s1.cash) < 0.01 };

    // ----- Funds Flow: sources / applications of working-capital funds from
    // NON-current items, plus funds from operations (net profit).
    const sources = [{ name: 'Funds from Operations (Net Profit)', amount: pl.net_profit }], applications = [];
    gIds.forEach(gid => {
        const g = groups[gid];
        if (/^current$/i.test(g?.nfrs_classification || '')) return;
        const delta = (s1.byGroupSigned[gid] || 0) - (s0.byGroupSigned[gid] || 0);   // Dr +
        if (Math.abs(delta) < 0.005) return;
        const name = g ? g.group_name : 'unmapped ledgers';
        if (delta < 0) sources.push({ name: `${sectionOf(g) === 'assets' ? 'Sale / reduction of' : 'Increase in'} ${name}`, amount: round2(-delta) });
        else applications.push({ name: `${sectionOf(g) === 'assets' ? 'Purchase / increase of' : 'Repayment / decrease of'} ${name}`, amount: round2(delta) });
    });
    const totalSources = round2(sources.reduce((s, x) => s + x.amount, 0)), totalApps = round2(applications.reduce((s, x) => s + x.amount, 0));
    const fundsFlow = { sources, applications, total_sources: totalSources, total_applications: totalApps,
        increase_in_working_capital: round2(totalSources - totalApps), working_capital_opening: s0.working_capital, working_capital_closing: s1.working_capital,
        reconciles: Math.abs(round2(totalSources - totalApps) - round2(s1.working_capital - s0.working_capital)) < 0.01 };

    return { from, to, days, ratios, cash_flow: cashFlow, funds_flow: fundsFlow,
        snapshot_open: { ...s0, byGroupSigned: undefined }, snapshot_close: { ...s1, byGroupSigned: undefined } };
}

// Schedules / Notes to Accounts: one note per top-level group, numbered in
// statement order (Assets, Liabilities, Equity, Income, Expenses), each with
// its sub-groups and ledgers carrying Opening, Debit, Credit and Closing.
const SECTION_ORDER = ['assets', 'liabilities', 'equity', 'trading_income', 'indirect_income', 'trading_expense', 'indirect_expense', 'unmapped'];
const SECTION_TITLE = { assets: 'Assets', liabilities: 'Liabilities', equity: 'Equity', trading_income: 'Revenue', indirect_income: 'Other Income',
    trading_expense: 'Cost of Sales', indirect_expense: 'Expenses', unmapped: 'Unclassified' };
async function schedules(tenantClient, tenantId, { from, to, productCompanyId }) {
    const groups = await loadGroups(tenantClient, tenantId);
    const tb = await trialBalance(tenantClient, tenantId, { from, to, productCompanyId });
    const notes = tb.tree.map(root => ({ root, section: sectionOf(groups[root.id]) }))
        .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || (a.root.display_order || 0) - (b.root.display_order || 0))
        .map((x, i) => ({ note_no: i + 1, section: x.section, section_title: SECTION_TITLE[x.section] || x.section, group_id: x.root.id, title: x.root.name,
            opening: x.root.opening, dr: x.root.dr, cr: x.root.cr, closing: x.root.closing, tree: x.root.children }));
    return { from, to, notes, difference: tb.difference };
}

// Budget vs Actual. Actual per target, in the account's natural direction:
// income = Cr - Dr, expense = Dr - Cr (period movement); assets = closing
// Dr, liabilities / equity = closing Cr. A group target covers all its
// sub-groups and ledgers.
async function budgetVsActual(tenantClient, tenantId, budget, lines) {
    const groups = await loadGroups(tenantClient, tenantId);
    const bals = await ledgerBalances(tenantClient, tenantId, { from: budget.date_from, to: budget.date_to });
    const descendants = gid => { const out = new Set([gid]); let grew = true; while (grew) { grew = false; Object.values(groups).forEach(g => { if (g.parent_group_id && out.has(g.parent_group_id) && !out.has(g.id)) { out.add(g.id); grew = true; } }); } return out; };
    const natural = b => {
        const sec = sectionOf(groups[b.account_group_id]);
        if (sec === 'trading_income' || sec === 'indirect_income') return b.cr - b.dr;
        if (sec === 'trading_expense' || sec === 'indirect_expense') return b.dr - b.cr;
        if (sec === 'assets') return b.closing;
        return -b.closing;
    };
    const rows = lines.map(l => {
        let actual = 0, name, section;
        if (l.ledger_id) {
            const b = bals[l.ledger_id];
            actual = b ? natural(b) : 0; name = b ? b.account_name : '(ledger)'; section = b ? sectionOf(groups[b.account_group_id]) : null;
        } else {
            const set = descendants(l.account_group_id);
            actual = Object.values(bals).filter(b => set.has(b.account_group_id)).reduce((s, b) => s + natural(b), 0);
            name = groups[l.account_group_id]?.group_name || '(group)'; section = sectionOf(groups[l.account_group_id]);
        }
        const budgetAmt = Number(l.amount) || 0;
        actual = round2(actual);
        const variance = round2(actual - budgetAmt);
        // For costs, spending MORE than budget is adverse; for everything else, less is adverse.
        const isCost = section === 'trading_expense' || section === 'indirect_expense';
        return { id: l.id, target_type: l.ledger_id ? 'ledger' : 'group', target_id: l.ledger_id || l.account_group_id, name, section, budget: round2(budgetAmt), actual, variance,
            variance_pct: budgetAmt ? round2(variance * 100 / Math.abs(budgetAmt)) : null, achievement_pct: budgetAmt ? round2(actual * 100 / budgetAmt) : null,
            favourable: isCost ? variance <= 0 : variance >= 0, remarks: l.remarks || null };
    });
    const tot = k => round2(rows.reduce((s, r) => s + r[k], 0));
    return { budget, rows, totals: { budget: tot('budget'), actual: tot('actual'), variance: tot('variance') } };
}

// Mapping view for auditors: every group, its effective classification and where it lands.
async function groupMapping(tenantClient, tenantId) {
    const groups = await loadGroups(tenantClient, tenantId);
    return Object.values(groups).map(g => ({
        id: g.id, group_code: g.group_code, group_name: g.group_name, parent_group_id: g.parent_group_id,
        nfrs_category: g.nfrs_category, nfrs_classification: g.nfrs_classification, cash_flow_category: g.cash_flow_category,
        funds_flow_type: g.funds_flow_type, ratio_analysis_category: g.ratio_analysis_category, category_type: g.category_type,
        anchor: g.anchor, section: sectionOf(g)
    })).sort((a, b) => String(a.section).localeCompare(String(b.section)) || String(a.group_name).localeCompare(String(b.group_name)));
}

module.exports = { budgetVsActual, schedules, loadGroups, sectionOf, ledgerBalances, stockValuation, STOCK_METHODS, buildTree, balanceSheet, profitAndLoss, trialBalance, ratiosAndFlows, groupMapping, dayBefore };
