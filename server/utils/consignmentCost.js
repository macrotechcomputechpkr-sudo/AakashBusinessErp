// =============================================
// utils/consignmentCost.js
// Consignment-wise cost (purchase) / consignment-wise sales, with the GL
// reconciliation of the purchase / sales accounts.
//
// Purchase (each Purchase Bill = a consignment; Purchase Returns optional):
//   product level - qty, rate, basic, discount, line VAT, each line billing
//                   term, the bill-level terms and linked Purchase Additional
//                   Expenses (by Bill, or by the Bill's GRN) spread over the
//                   lines by value, landed cost and landed rate per base unit
//   bill level    - basic, discount, each term, VAT, additional expenses,
//                   bill total, landed cost
//   goods account - the ledger each line posts to (product's Purchase
//                   Account -> the bill's Goods Account -> System default;
//                   bill-level terms -> the bill's account) - the same rule
//                   the posting uses (utils/accountResolver.js)
// Sales (each Sales Bill; Sales Returns / Non-saleable Returns optional):
//   the same with the Sales Account, and linked Sales Additional Entries
//   as bill-level terms on their own income ledgers.
//
// Ledger summary: per purchase / sales ledger - what the documents should
// post, what the GL holds for those documents, the difference, and GL
// entries on the same ledgers in the period from other documents
// (journals, notes ...). Mismatches: each document (a GRN and the bills
// made from it together) whose GL on those ledgers differs from what it
// should post, or that has no GL entry at all. Party, VAT and GRN clearing
// ledgers are left out of the comparison.
// =============================================
const { parseTradeQuery, loadTradeLines, round2, round4 } = require('./tradeLines');
const { docInfo } = require('./ageing');

const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
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
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}
const byIds = (c, table, col, ids, cols = '*', extra = q => q) => inChunks([...new Set(ids)].filter(Boolean), async chunk => {
    const { data, error } = await extra(c.from(table).select(cols).in(col, chunk));
    if (error) throw error; return data || [];
});

const SIDES = {
    purchase: {
        docs: { purchase_bill: { header: 'purchase_bills', detail: 'purchase_bill_details', fk: 'bill_id', sign: 1, kind: 'main' },
            purchase_return: { header: 'purchase_returns', detail: 'purchase_return_details', fk: 'return_id', sign: -1, kind: 'return' } },
        productAcct: 'purchase_account_ledger_id', docAcct: 'goods_account_ledger_id', party: 'vendor_ledger_id',
        sys: ['purchase_account_ledger_id'], sysReturn: ['purchase_return_account_ledger_id', 'purchase_account_ledger_id'], glSign: 1   // Dr - Cr
    },
    sales: {
        docs: { sales_bill: { header: 'sales_bills', detail: 'sales_bill_details', fk: 'bill_id', sign: 1, kind: 'main' },
            sales_return: { header: 'sales_returns', detail: 'sales_return_details', fk: 'return_id', sign: -1, kind: 'return' },
            sales_nonsalable_return: { header: 'sales_nonsaleable_returns', detail: 'sales_nonsaleable_return_details', fk: 'return_id', sign: -1, kind: 'nonsalable' } },
        productAcct: 'sales_account_ledger_id', docAcct: 'sales_account_ledger_id', party: 'customer_ledger_id',
        sys: ['sales_account_ledger_id'], sysReturn: ['sales_return_account_ledger_id', 'sales_account_ledger_id'], glSign: -1   // Cr - Dr
    }
};

async function consignmentCost(c, t, q) {
    const side = q.side === 'sales' ? 'sales' : 'purchase';
    const S = SIDES[side];
    const withReturns = q.include_returns === 'true';
    const kinds = withReturns ? (side === 'sales' ? 'main,return,nonsalable' : 'main,return') : 'main';
    const f = parseTradeQuery({ ...q, side, kinds });
    if (!f.from || !f.to) throw httpError('Choose From and To dates');
    const ledgerFilter = csv(q.ledger_ids);

    const [{ lines, masters: M }, { data: sc }, terms, ledgers] = await Promise.all([
        loadTradeLines(c, t, f),
        c.from('system_control_settings').select('*').eq('tenant_id', t).maybeSingle(),
        fetchAll(() => c.from('billing_terms').select('id, term_name, tax_type, billing_ledger_id, return_ledger_id, applicable_sales_entry, applicable_purchase_entry, is_enabled, is_active, display_order').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('ledger_accounts').select('id, account_code, account_name').eq('tenant_id', t).order('id'))
    ]);
    const settings = sc || {};
    const ledgerName = Object.fromEntries(ledgers.map(l => [l.id, l.account_name]));
    const termById = Object.fromEntries(terms.map(x => [x.id, x]));
    const isVatTerm = id => termById[id]?.tax_type === 'vat';
    const vatLedgers = new Set([settings.vat_ledger_id, ...terms.filter(x => x.tax_type === 'vat').flatMap(x => [x.billing_ledger_id, x.return_ledger_id])].filter(Boolean));
    const sysVatLedger = settings.vat_ledger_id || terms.find(x => x.tax_type === 'vat' && x.is_enabled !== false && x.is_active !== false && x.billing_ledger_id
        && (side === 'sales' ? x.applicable_sales_entry : x.applicable_purchase_entry))?.billing_ledger_id || null;
    const excluded = new Set([settings.grn_clearing_ledger_id, ...vatLedgers].filter(Boolean));
    const sysAcct = isReturn => (isReturn ? S.sysReturn : S.sys).map(k => settings[k]).find(Boolean) || null;

    // ---- documents in the report (by type) ----
    const docIdsByType = {};
    lines.forEach(l => { if (S.docs[l.doc_type]) (docIdsByType[l.doc_type] = docIdsByType[l.doc_type] || new Set()).add(l.doc_id); });
    const headers = {}, rawLines = {};
    for (const [type, ids] of Object.entries(docIdsByType)) {
        const cfg = S.docs[type];
        (await byIds(c, cfg.header, 'id', [...ids])).forEach(h => { headers[`${type}:${h.id}`] = { ...h, _type: type }; });
        (await byIds(c, cfg.detail, cfg.fk, [...ids], '*')).forEach(d => { (rawLines[`${type}:${d[cfg.fk]}`] = rawLines[`${type}:${d[cfg.fk]}`] || []).push(d); });
    }
    const productIds = [...new Set(Object.values(rawLines).flat().map(d => d.product_id).filter(Boolean))];
    const productAcct = Object.fromEntries((await byIds(c, 'products', 'id', productIds, `id, ${S.productAcct}`)).map(p => [p.id, p[S.productAcct] || null]));

    // ---- billing terms (purchase documents keep them) ----
    const docTerms = {}, lineTerms = {};
    if (side === 'purchase') {
        for (const type of Object.keys(docIdsByType)) {
            const ids = [...docIdsByType[type]];
            (await byIds(c, 'document_billing_terms', 'document_id', ids, 'document_id, billing_term_id, computed_amount', x => x.eq('document_type', type)))
                .forEach(r => (docTerms[`${type}:${r.document_id}`] = docTerms[`${type}:${r.document_id}`] || []).push(r));
            (await byIds(c, 'document_line_billing_terms', 'document_id', ids, 'document_id, detail_id, billing_term_id, computed_amount', x => x.eq('document_type', type)))
                .forEach(r => (lineTerms[r.detail_id] = lineTerms[r.detail_id] || []).push(r));
        }
    }
    // ---- additional expenses / entries linked to the bills ----
    const additional = {};                              // `${type}:${id}` -> [{ doc_type, doc_id, doc_no, ledger_id, amount }]
    const billIds = [...(docIdsByType[side === 'purchase' ? 'purchase_bill' : 'sales_bill'] || [])];
    if (billIds.length && q.include_additional !== 'false') {
        if (side === 'purchase') {
            const grnToBill = {};
            billIds.forEach(id => { const h = headers[`purchase_bill:${id}`]; if (h?.source_grn_id) grnToBill[h.source_grn_id] = id; });
            const exps = [...await byIds(c, 'purchase_additional_expenses', 'source_bill_id', billIds, 'id, doc_no, doc_date, source_bill_id, source_grn_id', x => x.eq('status', 'posted')),
                ...await byIds(c, 'purchase_additional_expenses', 'source_grn_id', Object.keys(grnToBill), 'id, doc_no, doc_date, source_bill_id, source_grn_id', x => x.eq('status', 'posted'))];
            const uniq = Object.values(Object.fromEntries(exps.map(e => [e.id, e])));
            const expLines = await byIds(c, 'purchase_additional_expense_lines', 'expense_id', uniq.map(e => e.id), 'expense_id, expense_ledger_id, description, entry_sign, amount');
            uniq.forEach(e => {
                const bill = e.source_bill_id && billIds.includes(e.source_bill_id) ? e.source_bill_id : grnToBill[e.source_grn_id];
                if (!bill) return;
                expLines.filter(x => x.expense_id === e.id).forEach(x => (additional[`purchase_bill:${bill}`] = additional[`purchase_bill:${bill}`] || []).push({
                    doc_type: 'purchase_additional_expense', doc_id: e.id, doc_no: e.doc_no, ledger_id: x.expense_ledger_id, name: ledgerName[x.expense_ledger_id] || x.description || 'Additional expense',
                    amount: round2((x.entry_sign === 'deduct' ? -1 : 1) * Number(x.amount || 0)) }));
            });
        } else {
            const ents = await byIds(c, 'sales_additional_entries', 'source_bill_id', billIds, 'id, doc_no, doc_date, source_bill_id', x => x.eq('status', 'posted'));
            const entLines = await byIds(c, 'sales_additional_entry_lines', 'entry_id', ents.map(e => e.id), 'entry_id, income_ledger_id, description, entry_sign, amount');
            ents.forEach(e => entLines.filter(x => x.entry_id === e.id).forEach(x => (additional[`sales_bill:${e.source_bill_id}`] = additional[`sales_bill:${e.source_bill_id}`] || []).push({
                doc_type: 'sales_additional', doc_id: e.id, doc_no: e.doc_no, ledger_id: x.income_ledger_id, name: ledgerName[x.income_ledger_id] || x.description || 'Additional entry',
                amount: round2((x.entry_sign === 'deduct' ? -1 : 1) * Number(x.amount || 0)) })));
        }
    }

    // ---- per document: terms, allocation, landed cost, expected posting ----
    const linesByDoc = {};
    lines.forEach(l => { if (S.docs[l.doc_type]) (linesByDoc[`${l.doc_type}:${l.doc_id}`] = linesByDoc[`${l.doc_type}:${l.doc_id}`] || []).push(l); });
    const termNames = new Set();
    const docs = Object.entries(linesByDoc).map(([key, shown]) => {
        const h = headers[key], cfg = S.docs[h._type], raw = rawLines[key] || [];
        const isReturn = cfg.kind !== 'main';
        const docAcct = h[S.docAcct] || sysAcct(isReturn);
        const rawNet = raw.reduce((s, d) => s + (Number(d.amount) || 0) - (Number(d.tax_amount) || 0), 0);
        const dTerms = (docTerms[key] || []).map(r => ({ name: termById[r.billing_term_id]?.term_name || 'Term', vat: isVatTerm(r.billing_term_id), amount: round2(r.computed_amount),
            ledger_id: isVatTerm(r.billing_term_id) ? null : docAcct }));
        const addl = additional[key] || [];
        const nonVatDocTerms = dTerms.filter(x => !x.vat).reduce((s, x) => s + x.amount, 0);
        const addlTotal = addl.reduce((s, x) => s + x.amount, 0);
        // VAT as the posting splits it out
        const lineTax = raw.reduce((s, d) => s + (Number(d.tax_amount) || 0), 0);
        const lineVatTerms = raw.flatMap(d => lineTerms[d.id] || []).filter(r => isVatTerm(r.billing_term_id)).reduce((s, r) => s + Number(r.computed_amount || 0), 0);
        const total = Number(h.total_amount) || 0;
        let vat = side === 'purchase' ? lineTax + lineVatTerms + dTerms.filter(x => x.vat).reduce((s, x) => s + x.amount, 0) : Number(h.total_tax_amount) || 0;
        if (side === 'purchase' ? !(vat > 0 && vat < total) : !(vat > 0 && sysVatLedger)) vat = 0;

        const docLines = shown.map(l => {
            const share = rawNet ? l.net / rawNet : 0;
            const lt = (lineTerms[l.line_id] || []).map(r => ({ name: termById[r.billing_term_id]?.term_name || 'Term', vat: isVatTerm(r.billing_term_id), amount: round2(r.computed_amount) }));
            const lineTermsNonVat = lt.filter(x => !x.vat).reduce((s, x) => s + x.amount, 0);
            const terms = {};
            lt.filter(x => !x.vat).forEach(x => { terms[x.name] = round2((terms[x.name] || 0) + x.amount); termNames.add(x.name); });
            dTerms.filter(x => !x.vat).forEach(x => { terms[x.name] = round2((terms[x.name] || 0) + x.amount * share); termNames.add(x.name); });
            const lineVat = l.tax + lt.filter(x => x.vat).reduce((s, x) => s + x.amount, 0) + dTerms.filter(x => x.vat).reduce((s, x) => s + x.amount * share, 0);
            const addlAlloc = round2(addlTotal * share);
            const landed = round2(l.net + lineTermsNonVat + nonVatDocTerms * share + addlAlloc);
            const acct = productAcct[l.product_id] || docAcct;
            return {
                product_id: l.product_id, product_code: l.product_code, product_name: l.product_name, group_name: l.group_name, company_name: l.company_name,
                qty: l.qty, unit: l.unit, alt_qty: l.alt_qty, alt_unit: l.alt_unit, base_qty: l.base_qty, base_unit: l.base_unit, free_qty: l.free_base_qty, rate: l.rate,
                basic: l.gross, discount: l.discount, net: l.net, terms, vat: round2(lineVat), additional: addlAlloc, landed,
                landed_rate: l.base_qty ? round4(landed / l.base_qty) : 0, account_id: acct, account_name: ledgerName[acct] || '(no account)'
            };
        });
        // Expected posting on purchase / sales ledgers (document direction; returns negative).
        const expected = {};
        const addExp = (ledger, amt) => { if (!ledger || !amt) return; expected[ledger] = round2((expected[ledger] || 0) + cfg.sign * amt); };
        if (h._type === 'sales_nonsalable_return') addExp(h.sales_account_ledger_id, total);
        else {
            let base = 0;
            raw.forEach(d => { const b = (Number(d.amount) || 0) - (Number(d.tax_amount) || 0); base += b; addExp(productAcct[d.product_id] || docAcct, b); });
            addExp(docAcct, round2(total - vat - base));
        }
        addl.forEach(x => addExp(x.ledger_id, x.amount));
        return {
            key, doc_type: h._type, kind: cfg.kind, doc_id: h.id, doc_no: h.doc_no, doc_date: String(h.doc_date).slice(0, 10), party_bill_no: h.party_bill_no || null,
            party_name: h.vendor_name_snapshot || h.customer_name_snapshot || h.cash_vendor_name || ledgerName[h[S.party]] || '', party_id: h[S.party] || null,
            source_grn_id: h.source_grn_id || null, doc_account_id: docAcct, doc_account_name: ledgerName[docAcct] || '(no account)',
            lines: docLines, doc_terms: dTerms, additional: addl,
            basic: round2(docLines.reduce((s, x) => s + x.basic, 0)), discount: round2(docLines.reduce((s, x) => s + x.discount, 0)),
            net: round2(docLines.reduce((s, x) => s + x.net, 0)), vat: round2(docLines.reduce((s, x) => s + x.vat, 0)),
            terms_total: round2(docLines.reduce((s, x) => s + Object.values(x.terms).reduce((a, b) => a + b, 0), 0)),
            additional_total: round2(addlTotal), bill_total: round2(total), landed: round2(docLines.reduce((s, x) => s + x.landed, 0)),
            partial: shown.length !== raw.length, expected, sign: cfg.sign
        };
    }).filter(d => !ledgerFilter.length || d.lines.some(l => ledgerFilter.includes(l.account_id)) || Object.keys(d.expected).some(id => ledgerFilter.includes(id)))
        .sort((a, b) => a.doc_date.localeCompare(b.doc_date) || String(a.doc_no).localeCompare(String(b.doc_no)));

    // ---- GL of those documents (+ their GRN, + additional docs) ----
    const glKeys = [];
    docs.forEach(d => {
        glKeys.push([d.doc_type, d.doc_id]);
        if (d.source_grn_id) glKeys.push(['purchase_grn', d.source_grn_id]);
        d.additional.forEach(x => glKeys.push([x.doc_type, x.doc_id]));
    });
    const batches = [];
    const byType = {};
    glKeys.forEach(([type, id]) => (byType[type] = byType[type] || new Set()).add(id));
    for (const [type, ids] of Object.entries(byType)) {
        batches.push(...await byIds(c, 'ledger_transaction_batches', 'document_id', [...ids], 'id, document_type, document_id, batch_date', x => x.eq('document_type', type).eq('tenant_id', t)));
    }
    const glLines = await byIds(c, 'ledger_transaction_lines', 'batch_id', batches.map(b => b.id), 'batch_id, ledger_account_id, debit_amount, credit_amount');
    const batchById = Object.fromEntries(batches.map(b => [b.id, b]));
    const partyLedgers = new Set(docs.map(d => d.party_id).filter(Boolean));
    const glByDoc = {};                                 // `${type}:${id}` -> { ledger: amount }
    glLines.forEach(l => {
        if (excluded.has(l.ledger_account_id) || partyLedgers.has(l.ledger_account_id)) return;
        const b = batchById[l.batch_id], k = `${b.document_type}:${b.document_id}`;
        const amt = S.glSign * ((Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0));
        (glByDoc[k] = glByDoc[k] || {})[l.ledger_account_id] = round2(((glByDoc[k] || {})[l.ledger_account_id] || 0) + amt);
    });

    // Families: a GRN and every bill made from it compare together.
    const families = new Map();
    docs.forEach(d => {
        const fk = d.source_grn_id ? `grn:${d.source_grn_id}` : d.key;
        if (!families.has(fk)) families.set(fk, { key: fk, docs: [], expected: {}, gl: {}, glKeys: new Set() });
        const fam = families.get(fk);
        fam.docs.push(d);
        Object.entries(d.expected).forEach(([l, a]) => { fam.expected[l] = round2((fam.expected[l] || 0) + a); });
        [d.key, ...(d.source_grn_id ? [`purchase_grn:${d.source_grn_id}`] : []), ...d.additional.map(x => `${x.doc_type}:${x.doc_id}`)].forEach(k => fam.glKeys.add(k));
    });
    const mismatches = [];
    const summary = {};
    const sumTo = (ledger, k, amt) => { summary[ledger] = summary[ledger] || { ledger_id: ledger, ledger_name: ledgerName[ledger] || '(unknown)', expected: 0, gl: 0, other_gl: 0 }; summary[ledger][k] = round2(summary[ledger][k] + amt); };
    families.forEach(fam => {
        fam.glKeys.forEach(k => Object.entries(glByDoc[k] || {}).forEach(([l, a]) => { fam.gl[l] = round2((fam.gl[l] || 0) + a); }));
        const hasGl = [...fam.glKeys].some(k => glByDoc[k] || batches.some(b => `${b.document_type}:${b.document_id}` === k));
        const ledgerIds = new Set([...Object.keys(fam.expected), ...Object.keys(fam.gl)]);
        ledgerIds.forEach(l => {
            const exp = fam.expected[l] || 0, gl = fam.gl[l] || 0;
            sumTo(l, 'expected', exp); sumTo(l, 'gl', gl);
            if (Math.abs(exp - gl) > 0.01) mismatches.push({ family: fam.key, doc_nos: fam.docs.map(d => d.doc_no).join(', '), doc_date: fam.docs[0].doc_date,
                party_name: fam.docs[0].party_name, ledger_id: l, ledger_name: ledgerName[l] || '(unknown)', expected: round2(exp), gl: round2(gl), difference: round2(gl - exp),
                reason: !hasGl ? 'No GL entry for this document' : !fam.expected[l] ? 'Posted to a ledger this document should not use' : !fam.gl[l] ? 'Nothing posted to this ledger' : 'Amount differs' });
        });
    });

    // ---- other GL entries on the same ledgers in the period ----
    const ledgerSet = Object.keys(summary);
    const ours = new Set(batches.map(b => b.id));
    const others = [];
    if (ledgerSet.length && q.include_other_gl !== 'false') {
        const other = await inChunks(ledgerSet, chunk => fetchAll(() => c.from('ledger_transaction_lines')
            .select('ledger_account_id, debit_amount, credit_amount, narration, batch:batch_id!inner(id, batch_date, document_type, document_id, narration)')
            .eq('tenant_id', t).in('ledger_account_id', chunk).gte('batch.batch_date', f.from).lte('batch.batch_date', f.to).order('id')), 100);
        const rest = other.filter(l => !ours.has(l.batch.id));
        const info = await docInfo(c, t, rest.map(l => [l.batch.document_type, l.batch.document_id]));
        rest.forEach(l => {
            const amt = round2(S.glSign * ((Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0)));
            sumTo(l.ledger_account_id, 'other_gl', amt);
            others.push({ ledger_id: l.ledger_account_id, ledger_name: ledgerName[l.ledger_account_id] || '', date: String(l.batch.batch_date).slice(0, 10),
                document_type: l.batch.document_type, doc_no: info[`${l.batch.document_type}:${l.batch.document_id}`]?.doc_no || '', narration: l.narration || l.batch.narration || '', amount: amt });
        });
    }
    const ledgerSummary = Object.values(summary).map(s => ({ ...s, difference: round2(s.gl - s.expected), gl_total: round2(s.gl + s.other_gl) }))
        .sort((a, b) => a.ledger_name.localeCompare(b.ledger_name));

    // ---- product level ----
    const prod = new Map();
    docs.forEach(d => d.lines.forEach(l => {
        if (!prod.has(l.product_id)) prod.set(l.product_id, { product_id: l.product_id, product_code: l.product_code, product_name: l.product_name, group_name: l.group_name,
            company_name: l.company_name, base_unit: l.base_unit, base_qty: 0, free_qty: 0, basic: 0, discount: 0, net: 0, terms: {}, vat: 0, additional: 0, landed: 0, docs: new Set(), accounts: new Set() });
        const p = prod.get(l.product_id), sg = d.sign;
        p.base_qty += sg * l.base_qty; p.free_qty += sg * l.free_qty; p.basic += sg * l.basic; p.discount += sg * l.discount; p.net += sg * l.net;
        p.vat += sg * l.vat; p.additional += sg * l.additional; p.landed += sg * l.landed; p.docs.add(d.doc_id); p.accounts.add(l.account_name);
        Object.entries(l.terms).forEach(([n, a]) => { p.terms[n] = (p.terms[n] || 0) + sg * a; });
    }));
    const products = [...prod.values()].map(p => ({ ...p, base_qty: round4(p.base_qty), free_qty: round4(p.free_qty),
        ...Object.fromEntries(['basic', 'discount', 'net', 'vat', 'additional', 'landed'].map(k => [k, round2(p[k])])),
        terms: Object.fromEntries(Object.entries(p.terms).map(([n, a]) => [n, round2(a)])),
        landed_rate: p.base_qty ? round4(p.landed / p.base_qty) : 0, docs: p.docs.size, accounts: [...p.accounts].join(', ') }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name));

    docs.forEach(d => { delete d.expected; });
    const tot = k => round2(docs.reduce((s, d) => s + d.sign * d[k], 0));
    const warnings = [];
    if (docs.some(d => d.partial)) warnings.push('Item filters are on - some bills show only part of their lines; the GL check always uses the whole bill.');
    if (side === 'purchase' && withReturns) warnings.push('Purchase Non-saleable Returns are written off / credited outside the purchase accounts, so they are not part of this report.');
    return {
        side, from: f.from, to: f.to, with_returns: withReturns, term_names: [...termNames].sort(), docs, products, ledger_summary: ledgerSummary,
        mismatches: mismatches.sort((a, b) => a.doc_date.localeCompare(b.doc_date)), other_gl: others.sort((a, b) => a.date.localeCompare(b.date)),
        totals: { docs: docs.length, basic: tot('basic'), discount: tot('discount'), net: tot('net'), terms_total: tot('terms_total'), vat: tot('vat'),
            additional_total: tot('additional_total'), bill_total: tot('bill_total'), landed: tot('landed'), mismatches: mismatches.length,
            difference: round2(ledgerSummary.reduce((s, l) => s + l.difference, 0)) },
        warnings, masters_ok: !!M
    };
}

module.exports = { consignmentCost };
