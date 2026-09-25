// =============================================
// utils/accountResolver.js
// Which ledger (and sub-ledger) each LINE of a Sales / Purchase document
// posts to. Priority, per line:
//   1. the product's own account   (products.sales_/purchase_account_ledger_id
//                                   + its sales_/purchase_sub_ledger_id)
//   2. the document's account      (sales_account_ledger_id / goods_account_ledger_id
//                                   + sales_sub_ledger_id / goods_sub_ledger_id)
//   3. System Control default      (sales_[return_]account_ledger_id /
//                                   purchase_[return_]account_ledger_id)
// A sub-ledger is only ever attached to the account it belongs to.
// Anything on the document that is not a line (document-level terms such as
// freight or a bill discount) goes to the document-level account (2 -> 3).
// =============================================

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

const SIDE = {
    sales:    { productAcct: 'sales_account_ledger_id',    productSub: 'sales_sub_ledger_id',    docAcct: 'sales_account_ledger_id', docSub: 'sales_sub_ledger_id', sys: ['sales_account_ledger_id'],    sysReturn: ['sales_return_account_ledger_id', 'sales_account_ledger_id'] },
    purchase: { productAcct: 'purchase_account_ledger_id', productSub: 'purchase_sub_ledger_id', docAcct: 'goods_account_ledger_id', docSub: 'goods_sub_ledger_id', sys: ['purchase_account_ledger_id'], sysReturn: ['purchase_return_account_ledger_id', 'purchase_account_ledger_id'] }
};

async function systemDefault(tenantClient, tenantId, side, isReturn) {
    const keys = isReturn ? SIDE[side].sysReturn : SIDE[side].sys;
    const { data } = await tenantClient.from('system_control_settings').select(keys.join(', ')).eq('tenant_id', tenantId).maybeSingle();
    for (const k of keys) if (data?.[k]) return data[k];
    return null;
}

// The document-level account (priority 2 -> 3) with its sub-ledger.
async function documentAccount(tenantClient, tenantId, side, doc, { isReturn = false } = {}) {
    const cfg = SIDE[side];
    if (doc[cfg.docAcct]) return { ledgerId: doc[cfg.docAcct], subLedgerId: doc[cfg.docSub] || null };
    const sys = await systemDefault(tenantClient, tenantId, side, isReturn);
    return sys ? { ledgerId: sys, subLedgerId: null } : null;
}

// Split a document's VAT-exclusive value by destination account.
// lines: [{ product_id, amount, tax_amount }]  (amount = base + line tax)
// netTotal: the document's total EXCLUDING VAT (so document-level terms are
//           the gap between netTotal and the sum of line bases)
// Returns [{ ledgerId, subLedgerId, amount }] - amount may be negative for a
// document-level discount; null ledgerId means nothing resolved (caller blocks).
async function splitByAccount(tenantClient, tenantId, side, doc, lines, netTotal, opts = {}) {
    const cfg = SIDE[side];
    const docAcct = await documentAccount(tenantClient, tenantId, side, doc, opts);
    const productIds = [...new Set(lines.map(l => l.product_id).filter(Boolean))];
    const { data: products } = productIds.length
        ? await tenantClient.from('products').select(`id, ${cfg.productAcct}, ${cfg.productSub}`).in('id', productIds)
        : { data: [] };
    const productById = Object.fromEntries((products || []).map(p => [p.id, p]));

    const buckets = {};
    const add = (acct, amt) => {
        const key = `${acct?.ledgerId || ''}|${acct?.subLedgerId || ''}`;
        buckets[key] = round2((buckets[key] || 0) + amt);
    };
    let linesTotal = 0;
    for (const l of lines) {
        const base = round2(Number(l.amount || 0) - Number(l.tax_amount || 0));
        linesTotal = round2(linesTotal + base);
        const p = productById[l.product_id];
        const acct = p?.[cfg.productAcct] ? { ledgerId: p[cfg.productAcct], subLedgerId: p[cfg.productSub] || null } : docAcct;
        add(acct, base);
    }
    const remainder = round2(Number(netTotal) - linesTotal);
    if (remainder !== 0) add(docAcct, remainder);
    return Object.entries(buckets).filter(([, a]) => a !== 0).map(([k, amount]) => {
        const [ledgerId, subLedgerId] = k.split('|');
        return { ledgerId: ledgerId || null, subLedgerId: subLedgerId || null, amount };
    });
}

module.exports = { documentAccount, splitByAccount, systemDefault };
