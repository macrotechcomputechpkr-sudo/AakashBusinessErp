// =============================================
// routes/ledgerReportRoutes.js
// "Ledger Report Banau - Group Wise, Customer/Supplier Category Wise,
// Area, Agent, Product Company, Route filter; Document Type (Cash
// Bank, Journal, Purchase, Sale) filter; Summary; Item Details;
// Billing Term Details; LC/BG Details" - plus extras:
//   * Particulars = the CONTRA ledger(s) of each entry (who the money
//     actually came from / went to), not just a doc number
//   * running balance with Dr/Cr, true opening balance
//   * Monthly mode (one row per month per ledger)
//   * credit limit usage and pending bill-wise references per ledger
//
// Source of truth is the general ledger itself (ledger_transaction_
// batches + ledger_transaction_lines), so every posted document of
// every module is covered automatically.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

// GL document_type -> where its doc_no lives, its item lines, and the
// "model" it belongs to for the Document Type filter. document_type
// strings are the exact values the posting routes write (verified
// against every ledger_transaction_batches insert in routes/ and
// utils/grnAccounting.js).
const GL_DOC_TYPES = {
    sales_bill:                 { model: 'sales',     label: 'Sales Bill',               headerTable: 'sales_bills',                  detailTable: 'sales_bill_details',                fk: 'bill_id' },
    sales_return:               { model: 'sales',     label: 'Sales Return',             headerTable: 'sales_returns',                detailTable: 'sales_return_details',              fk: 'return_id' },
    sales_nonsalable_return:    { model: 'sales',     label: 'Sales Non-saleable Return', headerTable: 'sales_nonsaleable_returns',   detailTable: 'sales_nonsaleable_return_details',  fk: 'return_id' },
    sales_additional:           { model: 'sales',     label: 'Sales Additional Entry',   headerTable: 'sales_additional_entries' },
    purchase_grn:               { model: 'purchase',  label: 'Purchase GRN',             headerTable: 'purchase_grns',                detailTable: 'purchase_grn_details',              fk: 'grn_id' },
    purchase_bill:              { model: 'purchase',  label: 'Purchase Bill',            headerTable: 'purchase_bills',               detailTable: 'purchase_bill_details',             fk: 'bill_id' },
    purchase_nonsalable_return: { model: 'purchase',  label: 'Purchase Non-saleable Return', headerTable: 'purchase_nonsaleable_returns', detailTable: 'purchase_nonsaleable_return_details', fk: 'return_id' },
    purchase_return:            { model: 'purchase',  label: 'Purchase Return',          headerTable: 'purchase_returns',             detailTable: 'purchase_return_details',           fk: 'return_id' },
    purchase_additional_expense:{ model: 'purchase',  label: 'Purchase Additional Expense', headerTable: 'purchase_additional_expenses' },
    cash_bank_entry:            { model: 'cash_bank', label: 'Cash / Bank Entry',        headerTable: 'cash_bank_entries' },
    pdc:                        { model: 'cash_bank', label: 'PDC',                      headerTable: 'pdc_vouchers' },
    journal_voucher:            { model: 'journal',   label: 'Journal Voucher',          headerTable: 'journal_vouchers' },
    credit_note:                { model: 'journal',   label: 'Credit Note',              headerTable: 'credit_notes' },
    debit_note:                 { model: 'journal',   label: 'Debit Note',               headerTable: 'debit_notes' },
    production:                 { model: 'production', label: 'Production',              headerTable: 'production_orders',            detailTable: 'production_raw_materials',          fk: 'production_id' },
    interest_posting:           { model: 'journal',   label: 'Interest Posting',         headerTable: 'interest_runs' },
    depreciation:               { model: 'journal',   label: 'Depreciation',             headerTable: 'depreciation_runs' },
    asset_disposal:             { model: 'journal',   label: 'Asset Disposal',           headerTable: 'depreciation_runs' },
    agent_commission:           { model: 'journal',   label: 'Agent Commission',         headerTable: 'agent_commission_postings' }
};
const MODELS = { sales: 'Sales', purchase: 'Purchase', cash_bank: 'Cash / Bank', journal: 'Journal / Notes', production: 'Production' };
// Billing Terms are stored under these same document_type names.
const TERM_DOC_TYPES = new Set(['purchase_grn', 'purchase_bill', 'purchase_nonsalable_return', 'production']);

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const chunk = (arr, size) => { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; };

// PostgREST caps a response (1000 rows by default) - page through it.
async function fetchAll(buildQuery) {
    const pageSize = 1000;
    let from = 0, all = [];
    for (;;) {
        const { data, error } = await buildQuery().range(from, from + pageSize - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

router.get('/ledger-report/meta', requireAuth, (req, res) => {
    res.json({
        success: true,
        data: {
            models: Object.entries(MODELS).map(([key, label]) => ({ key, label })),
            document_types: Object.entries(GL_DOC_TYPES).map(([key, c]) => ({ key, label: c.label, model: c.model }))
        }
    });
});

router.get('/ledger-report', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const q = req.query;
        const today = new Date().toISOString().slice(0, 10);
        const dateFrom = q.date_from || `${today.slice(0, 4)}-01-01`;
        const dateTo = q.date_to || today;
        const mode = ['detail', 'summary', 'monthly'].includes(q.mode) ? q.mode : 'detail';
        const flag = k => q[k] === 'true';

        // ---------- 1. Which ledgers ----------
        let ledgerQuery = () => {
            let lq = tenantClient.from('ledger_accounts')
                .select('id, account_code, account_name, account_group_id, group_name, opening_balance, opening_balance_type, area_id, agent_id, route_id, credit_limit, credit_days, lc_number, lc_bank_name, lc_amount, lc_issue_date, lc_expiry_date, bg_number, bg_bank_name, bg_amount, bg_issue_date, bg_expiry_date')
                .eq('tenant_id', tenantId);
            if (q.area_id) lq = lq.eq('area_id', q.area_id);
            if (q.agent_id) lq = lq.eq('agent_id', q.agent_id);
            if (q.route_id) lq = lq.eq('route_id', q.route_id);
            return lq.order('account_name');
        };
        let ledgers = await fetchAll(ledgerQuery);

        if (q.ledger_ids) {
            const wanted = new Set(String(q.ledger_ids).split(',').filter(Boolean));
            ledgers = ledgers.filter(l => wanted.has(l.id));
        }
        // Group filter includes every sub-group underneath it.
        if (q.account_group_id) {
            const groups = await fetchAll(() => tenantClient.from('account_groups').select('id, parent_group_id').eq('tenant_id', tenantId));
            const childrenOf = {};
            groups.forEach(g => { (childrenOf[g.parent_group_id] = childrenOf[g.parent_group_id] || []).push(g.id); });
            const inGroup = new Set([q.account_group_id]);
            const stack = [q.account_group_id];
            while (stack.length) (childrenOf[stack.pop()] || []).forEach(c => { if (!inGroup.has(c)) { inGroup.add(c); stack.push(c); } });
            ledgers = ledgers.filter(l => inGroup.has(l.account_group_id));
        }
        if (q.ledger_category_id) {
            const links = await fetchAll(() => tenantClient.from('ledger_account_categories').select('ledger_account_id').eq('ledger_category_id', q.ledger_category_id));
            const inCat = new Set(links.map(l => l.ledger_account_id));
            ledgers = ledgers.filter(l => inCat.has(l.id));
        }
        if (ledgers.length === 0) return res.json({ success: true, data: { ledgers: [], groups: [], totals: {}, period: { date_from: dateFrom, date_to: dateTo } } });
        if (ledgers.length > 2000 && mode === 'detail') {
            return res.status(400).json({ success: false, error: `${ledgers.length} ledgers match - narrow the filters or use Summary mode` });
        }
        const ledgerIds = ledgers.map(l => l.id);

        // Document Type filter: explicit types win; otherwise models.
        let allowedTypes = null;
        if (q.document_types) allowedTypes = String(q.document_types).split(',').filter(t => GL_DOC_TYPES[t]);
        else if (q.models) {
            const models = new Set(String(q.models).split(','));
            allowedTypes = Object.keys(GL_DOC_TYPES).filter(t => models.has(GL_DOC_TYPES[t].model));
        }

        // ---------- 2. True opening balance (ALL document types) ----------
        const openingMovement = {};
        for (const ids of chunk(ledgerIds, 150)) {
            const rows = await fetchAll(() => tenantClient.from('ledger_transaction_lines')
                .select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date)')
                .eq('tenant_id', tenantId).in('ledger_account_id', ids).lt('batch.batch_date', dateFrom)
                .match(q.product_company_id ? { product_company_id: q.product_company_id } : {}));
            rows.forEach(r => { openingMovement[r.ledger_account_id] = (openingMovement[r.ledger_account_id] || 0) + Number(r.debit_amount) - Number(r.credit_amount); });
        }

        // ---------- 3. Period movement ----------
        let periodLines = [];
        for (const ids of chunk(ledgerIds, 150)) {
            const rows = await fetchAll(() => {
                let lq = tenantClient.from('ledger_transaction_lines')
                    .select('id, ledger_account_id, sub_ledger_id, product_company_id, debit_amount, credit_amount, narration, batch_id, batch:batch_id!inner(id, batch_date, document_type, document_id, narration)')
                    .eq('tenant_id', tenantId).in('ledger_account_id', ids)
                    .gte('batch.batch_date', dateFrom).lte('batch.batch_date', dateTo);
                if (allowedTypes) lq = lq.in('batch.document_type', allowedTypes);
                if (q.product_company_id) lq = lq.eq('product_company_id', q.product_company_id);
                return lq;
            });
            periodLines = periodLines.concat(rows);
        }
        if (q.narration) {
            const needle = String(q.narration).toLowerCase();
            periodLines = periodLines.filter(l => `${l.narration || ''} ${l.batch?.narration || ''}`.toLowerCase().includes(needle));
        }

        // Documents touched in the period, grouped by type.
        const docsByType = {};
        periodLines.forEach(l => {
            const t = l.batch.document_type;
            (docsByType[t] = docsByType[t] || new Set()).add(l.batch.document_id);
        });

        // Product Company filter: by each GL line's OWN company. Every sales /
        // purchase / JV / cash-bank / note line now carries it, so this gives a
        // true company-wise party ledger (the old approach matched documents by
        // their items, which dropped JV / cash-bank / notes entirely and pulled
        // in every line of a mixed-company document).
        if (q.product_company_id) periodLines = periodLines.filter(l => l.product_company_id === q.product_company_id);

        // ---------- 4. Doc numbers + contra ledgers ----------
        const docNoByKey = {};
        for (const [type, idSet] of Object.entries(docsByType)) {
            const cfg = GL_DOC_TYPES[type];
            if (!cfg) continue;
            for (const ids of chunk([...idSet], 150)) {
                const { data } = await tenantClient.from(cfg.headerTable).select('id, doc_no').in('id', ids);
                (data || []).forEach(h => { docNoByKey[`${type}:${h.id}`] = h.doc_no; });
            }
        }
        const batchIds = [...new Set(periodLines.map(l => l.batch_id))];
        const linesByBatch = {};
        for (const ids of chunk(batchIds, 150)) {
            const rows = await fetchAll(() => tenantClient.from('ledger_transaction_lines').select('batch_id, ledger_account_id, debit_amount, credit_amount').in('batch_id', ids));
            rows.forEach(r => { (linesByBatch[r.batch_id] = linesByBatch[r.batch_id] || []).push(r); });
        }
        const allLedgerIdsInBatches = [...new Set(Object.values(linesByBatch).flat().map(r => r.ledger_account_id))];
        const ledgerNameById = Object.fromEntries(ledgers.map(l => [l.id, l.account_name]));
        const missingNames = allLedgerIdsInBatches.filter(id => !ledgerNameById[id]);
        for (const ids of chunk(missingNames, 150)) {
            const { data } = await tenantClient.from('ledger_accounts').select('id, account_name').in('id', ids);
            (data || []).forEach(l => { ledgerNameById[l.id] = l.account_name; });
        }
        // Contra = ledgers on the OPPOSITE side of the same batch.
        const contraFor = (line) => {
            const isDebit = Number(line.debit_amount) > 0;
            const others = (linesByBatch[line.batch_id] || []).filter(o => o.ledger_account_id !== line.ledger_account_id && (isDebit ? Number(o.credit_amount) > 0 : Number(o.debit_amount) > 0));
            const names = [...new Set(others.map(o => ledgerNameById[o.ledger_account_id] || '—'))];
            return names;
        };

        // ---------- 5. Optional drill-down payloads ----------
        const itemsByDoc = {};
        if (flag('include_items') && mode === 'detail') {
            for (const [type, idSet] of Object.entries(docsByType)) {
                const cfg = GL_DOC_TYPES[type];
                if (!cfg?.detailTable) continue;
                for (const ids of chunk([...idSet], 150)) {
                    const rows = await fetchAll(() => tenantClient.from(cfg.detailTable).select('*').in(cfg.fk, ids).order('display_order'));
                    rows.forEach(d => {
                        (itemsByDoc[`${type}:${d[cfg.fk]}`] = itemsByDoc[`${type}:${d[cfg.fk]}`] || []).push({
                            product_name: d.product_name_snapshot, batch_no: d.batch_no || null,
                            qty: Number(d.qty) || 0, uom: d.uom_name_snapshot || null,
                            alt_qty: d.alt_qty ? Number(d.alt_qty) : null, free_qty: d.free_qty ? Number(d.free_qty) : null,
                            rate: Number(d.rate ?? d.cost_rate) || 0,
                            discount_percent: d.discount_percent !== undefined ? Number(d.discount_percent) || 0 : null,
                            discount_amount: d.discount_amount !== undefined ? Number(d.discount_amount) || 0 : null,
                            amount: Number(d.amount) || 0
                        });
                    });
                }
            }
        }
        const termsByDoc = {};
        if (flag('include_terms') && mode === 'detail') {
            const termTypes = Object.keys(docsByType).filter(t => TERM_DOC_TYPES.has(t));
            const termRows = [];
            for (const type of termTypes) {
                for (const ids of chunk([...docsByType[type]], 150)) {
                    const [{ data: docTerms }, { data: lineTerms }] = await Promise.all([
                        tenantClient.from('document_billing_terms').select('document_id, billing_term_id, computed_amount').eq('document_type', type).in('document_id', ids),
                        tenantClient.from('document_line_billing_terms').select('document_id, billing_term_id, computed_amount').eq('document_type', type).in('document_id', ids)
                    ]);
                    (docTerms || []).forEach(t => termRows.push({ ...t, type, level: 'Document' }));
                    (lineTerms || []).forEach(t => termRows.push({ ...t, type, level: 'Line' }));
                }
            }
            const termIds = [...new Set(termRows.map(t => t.billing_term_id))];
            const termById = {};
            for (const ids of chunk(termIds, 150)) {
                const { data } = await tenantClient.from('billing_terms').select('id, term_name, term_code, calculation_mode, rate_percentage').in('id', ids);
                (data || []).forEach(t => { termById[t.id] = t; });
            }
            // Line-level terms are summed per term per document so the
            // report shows "Freight 1,200" once, not once per item.
            const agg = {};
            termRows.forEach(t => {
                const key = `${t.type}:${t.document_id}`;
                const k2 = `${key}|${t.billing_term_id}|${t.level}`;
                if (!agg[k2]) {
                    const def = termById[t.billing_term_id] || {};
                    agg[k2] = { key, term_name: def.term_name || '—', term_code: def.term_code || '', level: t.level,
                        rate_percent: ['percentage', 'both'].includes(def.calculation_mode) ? Number(def.rate_percentage) || 0 : null, amount: 0 };
                }
                agg[k2].amount += Number(t.computed_amount) || 0;
            });
            Object.values(agg).forEach(a => { (termsByDoc[a.key] = termsByDoc[a.key] || []).push({ ...a, amount: round2(a.amount) }); });
        }

        // ---------- 6. Assemble per ledger ----------
        const linesByLedger = {};
        periodLines.forEach(l => { (linesByLedger[l.ledger_account_id] = linesByLedger[l.ledger_account_id] || []).push(l); });

        let lcByVendor = {};
        if (flag('include_lc_bg')) {
            const lcs = await fetchAll(() => tenantClient.from('letters_of_credit').select('*').eq('tenant_id', tenantId).in('vendor_ledger_id', ledgerIds.slice(0, 1000)));
            const maps = lcs.length ? await fetchAll(() => tenantClient.from('lc_bill_mappings').select('lc_id, mapped_amount').in('lc_id', lcs.map(l => l.id).slice(0, 1000))) : [];
            const used = {};
            maps.forEach(m => { used[m.lc_id] = (used[m.lc_id] || 0) + Number(m.mapped_amount); });
            lcs.forEach(lc => {
                (lcByVendor[lc.vendor_ledger_id] = lcByVendor[lc.vendor_ledger_id] || []).push({
                    lc_number: lc.lc_number, bank: lc.lc_bank_name, amount: round2(lc.lc_amount), utilized: round2(used[lc.id] || 0),
                    remaining: round2(Number(lc.lc_amount) - (used[lc.id] || 0)), issue_date: lc.issue_date, expiry_date: lc.expiry_date, status: lc.status,
                    is_expired: !!(lc.expiry_date && lc.expiry_date < today)
                });
            });
        }
        // BG register (received from / issued for the party) and PDCs of each party
        const bgByParty = {}, pdcByParty = {};
        if (flag('include_lc_bg')) {
            for (const ids of chunk(ledgerIds, 150)) {
                const { data: bgs } = await tenantClient.from('bank_guarantees').select('*').eq('tenant_id', tenantId).in('party_ledger_id', ids);
                (bgs || []).forEach(b => (bgByParty[b.party_ledger_id] = bgByParty[b.party_ledger_id] || []).push({ bg_number: b.bg_number, direction: b.direction, bg_type: b.bg_type, bank: b.bank_name,
                    amount: round2(b.amount), issue_date: b.issue_date, expiry_date: b.expiry_date, status: b.status, is_expired: !!(b.expiry_date && b.expiry_date < today) }));
                const { data: pdcs } = await tenantClient.from('pdc_vouchers').select('doc_no, voucher_type, cheque_no, cheque_date, amount, bank_name, status, party_ledger_id').eq('tenant_id', tenantId).in('party_ledger_id', ids);
                (pdcs || []).forEach(x => (pdcByParty[x.party_ledger_id] = pdcByParty[x.party_ledger_id] || []).push({ doc_no: x.doc_no, voucher_type: x.voucher_type, cheque_no: x.cheque_no,
                    cheque_date: x.cheque_date, amount: round2(x.amount), bank: x.bank_name, status: x.status, matured: x.status === 'pending' && String(x.cheque_date) <= today }));
            }
        }
        let billsByLedger = {};
        if (flag('include_bill_wise')) {
            for (const ids of chunk(ledgerIds, 150)) {
                const refs = await fetchAll(() => tenantClient.from('bill_wise_references').select('ledger_id, source_type, source_doc_no, source_date, nature, total_amount, remaining_amount').eq('tenant_id', tenantId).in('ledger_id', ids).gt('remaining_amount', 0));
                refs.forEach(r => { (billsByLedger[r.ledger_id] = billsByLedger[r.ledger_id] || []).push({ doc_no: r.source_doc_no, date: r.source_date, source_type: r.source_type, nature: r.nature, total_amount: round2(r.total_amount), remaining_amount: round2(r.remaining_amount), days: r.source_date ? Math.floor((new Date(today) - new Date(r.source_date)) / 86400000) : null }); });
            }
        }

        // PDC shown separately: pending (not yet deposited / not in the GL) cheques per party as on To date
        const pdcPending = {};
        if (flag('pdc_separate')) {
            for (const ids of chunk(ledgerIds, 150)) {
                const { data: pdcs } = await tenantClient.from('pdc_vouchers').select('party_ledger_id, voucher_type, amount, doc_date, cheque_date').eq('tenant_id', tenantId).eq('status', 'pending').in('party_ledger_id', ids).lte('doc_date', dateTo);
                (pdcs || []).forEach(x => { const a = (pdcPending[x.party_ledger_id] = pdcPending[x.party_ledger_id] || { received: 0, issued: 0, count: 0 }); a[x.voucher_type === 'issued' ? 'issued' : 'received'] += Number(x.amount) || 0; a.count++; });
            }
        }
        const signedOpeningOf = l => (l.opening_balance_type === 'cr' ? -1 : 1) * (Number(l.opening_balance) || 0);
        let outLedgers = ledgers.map(l => {
            const opening = round2(signedOpeningOf(l) + (openingMovement[l.id] || 0));
            const lines = (linesByLedger[l.id] || []).sort((a, b) => (a.batch.batch_date).localeCompare(b.batch.batch_date) || String(a.id).localeCompare(String(b.id)));
            let running = opening, totalDr = 0, totalCr = 0;
            const entries = lines.map(line => {
                const dr = Number(line.debit_amount) || 0, cr = Number(line.credit_amount) || 0;
                running += dr - cr; totalDr += dr; totalCr += cr;
                const key = `${line.batch.document_type}:${line.batch.document_id}`;
                return {
                    date: line.batch.batch_date, document_type: line.batch.document_type,
                    document_label: GL_DOC_TYPES[line.batch.document_type]?.label || line.batch.document_type,
                    document_id: line.batch.document_id, doc_no: docNoByKey[key] || null,
                    particulars: contraFor(line), narration: line.narration || line.batch.narration || null,
                    debit: round2(dr), credit: round2(cr), balance: round2(running),
                    items: itemsByDoc[key] || undefined, terms: termsByDoc[key] || undefined
                };
            });
            const monthly = {};
            if (mode === 'monthly') {
                entries.forEach(e => {
                    const m = e.date.slice(0, 7);
                    monthly[m] = monthly[m] || { month: m, debit: 0, credit: 0 };
                    monthly[m].debit += e.debit; monthly[m].credit += e.credit;
                });
                let run = opening;
                Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)).forEach(m => { run += m.debit - m.credit; m.debit = round2(m.debit); m.credit = round2(m.credit); m.closing = round2(run); });
            }
            const closing = round2(opening + totalDr - totalCr);
            const creditLimit = Number(l.credit_limit) || 0;
            let pdc;
            if (flag('pdc_separate')) {
                const pl = lines.filter(x => x.batch.document_type === 'pdc');
                const pdr = pl.reduce((t2, x) => t2 + (Number(x.debit_amount) || 0), 0), pcr = pl.reduce((t2, x) => t2 + (Number(x.credit_amount) || 0), 0);
                const pend = pdcPending[l.id] || { received: 0, issued: 0, count: 0 };
                pdc = { posted_debit: round2(pdr), posted_credit: round2(pcr), debit_excl_pdc: round2(totalDr - pdr), credit_excl_pdc: round2(totalCr - pcr),
                    pending_received: round2(pend.received), pending_issued: round2(pend.issued), pending_count: pend.count,
                    closing_after_pending: round2(closing - pend.received + pend.issued) };
            }
            return {
                ledger_id: l.id, account_code: l.account_code, account_name: l.account_name,
                group_id: l.account_group_id, group_name: l.group_name,
                opening, total_debit: round2(totalDr), total_credit: round2(totalCr), closing,
                credit_limit: creditLimit || null,
                credit_limit_used_percent: creditLimit > 0 && closing > 0 ? round2((closing / creditLimit) * 100) : null,
                entry_count: entries.length,
                entries: mode === 'detail' ? entries : undefined,
                monthly: mode === 'monthly' ? Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)) : undefined,
                lc_bg: flag('include_lc_bg') ? {
                    legacy_lc: l.lc_number ? { lc_number: l.lc_number, bank: l.lc_bank_name, amount: l.lc_amount, issue_date: l.lc_issue_date, expiry_date: l.lc_expiry_date } : null,
                    bg: l.bg_number ? { bg_number: l.bg_number, bank: l.bg_bank_name, amount: l.bg_amount, issue_date: l.bg_issue_date, expiry_date: l.bg_expiry_date, is_expired: !!(l.bg_expiry_date && l.bg_expiry_date < today) } : null,
                    lcs: lcByVendor[l.id] || [],
                    bgs: bgByParty[l.id] || [],
                    pdcs: pdcByParty[l.id] || []
                } : undefined,
                pending_bills: flag('include_bill_wise') ? (billsByLedger[l.id] || []) : undefined,
                pdc
            };
        });

        if (q.hide_zero !== 'false') outLedgers = outLedgers.filter(l => l.opening !== 0 || l.entry_count > 0);
        // FEATURE: balance filters - "only customers who owe us" (Dr) /
        // "only suppliers we owe" (Cr), and a minimum absolute closing
        // balance (e.g. receivables above 50,000 only).
        if (q.balance_side === 'dr') outLedgers = outLedgers.filter(l => l.closing > 0.005);
        if (q.balance_side === 'cr') outLedgers = outLedgers.filter(l => l.closing < -0.005);
        if (q.min_balance && Number(q.min_balance) > 0) outLedgers = outLedgers.filter(l => Math.abs(l.closing) >= Number(q.min_balance));
        // If a document filter is active, ledgers with no matching
        // movement are noise - show only those that moved.
        if (allowedTypes || q.product_company_id || q.narration) outLedgers = outLedgers.filter(l => l.entry_count > 0);

        // Group-wise subtotals (always computed; the UI decides whether to show).
        const groups = {};
        outLedgers.forEach(l => {
            const g = groups[l.group_id || 'none'] = groups[l.group_id || 'none'] || { group_id: l.group_id, group_name: l.group_name || '(No Group)', opening: 0, total_debit: 0, total_credit: 0, closing: 0, ledger_count: 0 };
            g.opening += l.opening; g.total_debit += l.total_debit; g.total_credit += l.total_credit; g.closing += l.closing; g.ledger_count += 1;
        });
        const groupRows = Object.values(groups).map(g => ({ ...g, opening: round2(g.opening), total_debit: round2(g.total_debit), total_credit: round2(g.total_credit), closing: round2(g.closing) }))
            .sort((a, b) => a.group_name.localeCompare(b.group_name));
        const totals = outLedgers.reduce((t, l) => ({ opening: t.opening + l.opening, total_debit: t.total_debit + l.total_debit, total_credit: t.total_credit + l.total_credit, closing: t.closing + l.closing }), { opening: 0, total_debit: 0, total_credit: 0, closing: 0 });
        Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });

        res.json({ success: true, data: { period: { date_from: dateFrom, date_to: dateTo }, mode, ledgers: outLedgers, groups: groupRows, totals } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
