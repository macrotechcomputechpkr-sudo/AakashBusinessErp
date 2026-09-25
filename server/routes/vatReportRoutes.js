// =============================================
// routes/vatReportRoutes.js
// Nepal VAT reports: Purchase / Sales / Sales Return / Purchase Return /
// Credit Note / Debit Note registers (bill-wise, party-wise, item-wise,
// month-wise, summary; with/without items; amount & PAN filters),
// monthly summary with bill counts, parties above a threshold (monthly
// or fiscal-year = Annex 13 style), the monthly VAT return figures, and
// an all-in-one VAT ledger.
//
// EVERY report is built from ONE loader (loadTaxDocs) so the same bill
// always shows the same Taxable / Exempt / VAT figures everywhere:
//   * Sales, Sales Return, Purchase, Purchase Return:
//       VAT     = SUM(line tax_amount) + VAT-type billing terms (purchase side)
//       Exempt  = base of lines carrying no VAT (and no line-level VAT term)
//       Taxable = Total - VAT - Exempt
//     (line amount = after-discount base + tax, per the posting routes)
//   * Credit / Debit Note (ledger notes, no tax column):
//       VAT     = note lines posted to System Control's VAT ledger
//       Taxable = Total - VAT when VAT exists, otherwise the note is Exempt
// Returns and notes carry sign -1 so net figures fall out naturally.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getVatTerms, defaultVatLedger, allVatLedgerIds } = require('../utils/vatLedger');
const bsCalendar = require('../utils/bsCalendar');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

const VAT_DOCS = {
    sales:           { label: 'Sales',           label_np: 'बिक्री',           side: 'sales',    sign: 1,  header: 'sales_bills',      detail: 'sales_bill_details',      fk: 'bill_id',        party: 'customer_ledger_id', partyName: 'customer_name_snapshot' },
    sales_return:    { label: 'Sales Return',    label_np: 'बिक्री फिर्ता',     side: 'sales',    sign: -1, header: 'sales_returns',    detail: 'sales_return_details',    fk: 'return_id',      party: 'customer_ledger_id', partyName: 'customer_name_snapshot' },
    credit_note:     { label: 'Credit Note',     label_np: 'क्रेडिट नोट',       side: 'sales',    sign: -1, header: 'credit_notes',     detail: 'credit_note_details',     fk: 'credit_note_id', party: 'party_ledger_id',    partyName: 'party_name_snapshot', ledgerNote: true },
    purchase:        { label: 'Purchase',        label_np: 'खरिद',            side: 'purchase', sign: 1,  header: 'purchase_bills',   detail: 'purchase_bill_details',   fk: 'bill_id',        party: 'vendor_ledger_id',   partyName: 'vendor_name_snapshot', termDocType: 'purchase_bill' },
    purchase_return: { label: 'Purchase Return', label_np: 'खरिद फिर्ता',       side: 'purchase', sign: -1, header: 'purchase_returns', detail: 'purchase_return_details', fk: 'return_id',      party: 'vendor_ledger_id',   partyName: 'vendor_name_snapshot', termDocType: 'purchase_return' },
    // Additional expense bills (transport, clearing ...) - each taxable / non-taxable bill line
    purchase_expense: { label: 'Purchase Expense Bill', label_np: 'खर्च बिल (खरिद)', side: 'purchase', sign: 1, custom: 'expense', party: 'vendor_ledger_id' },
    // Journal Vouchers entered as a taxable / non-taxable purchase or sale
    jv_purchase:     { label: 'Purchase (JV)',   label_np: 'खरिद (जर्नल)',      side: 'purchase', sign: 1,  custom: 'jv', jvType: 'purchase', party: 'party_ledger_id' },
    jv_sales:        { label: 'Sales (JV)',      label_np: 'बिक्री (जर्नल)',     side: 'sales',    sign: 1,  custom: 'jv', jvType: 'sales', party: 'party_ledger_id' },
    debit_note:      { label: 'Debit Note',      label_np: 'डेबिट नोट',         side: 'purchase', sign: -1, header: 'debit_notes',      detail: 'debit_note_details',      fk: 'debit_note_id',  party: 'party_ledger_id',    partyName: 'party_name_snapshot', ledgerNote: true }
};

const BS_MONTHS = [
    ['Shrawan', 'साउन'], ['Bhadra', 'भदौ'], ['Ashwin', 'असोज'], ['Kartik', 'कात्तिक'], ['Mangsir', 'मंसिर'], ['Poush', 'पुस'],
    ['Magh', 'माघ'], ['Falgun', 'फागुन'], ['Chaitra', 'चैत'], ['Baishakh', 'वैशाख'], ['Jestha', 'जेठ'], ['Ashadh', 'असार']
];

// Supabase caps IN() lists / row counts - chunk everything.
async function inChunks(ids, size, fn) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...((await fn(ids.slice(i, i + size))) || []));
    return out;
}

// ---------- Fiscal periods (accurate BS months) ----------
async function loadPeriods(tenantClient, tenantId) {
    const { data: periods } = await tenantClient.from('fiscal_periods').select('*').eq('tenant_id', tenantId).order('start_date');
    const { data: years } = await tenantClient.from('fiscal_years').select('id, fiscal_year_name, fiscal_year_nepali, start_date_eng, end_date_eng, start_date_nep').eq('tenant_id', tenantId);
    const yearById = Object.fromEntries((years || []).map(y => [y.id, y]));
    return (periods || []).map(p => {
        const fy = yearById[p.fiscal_year_id] || {};
        const startBsYear = parseInt(String(fy.start_date_nep || '').slice(0, 4), 10) || null;
        return {
            ...p,
            fiscal_year_name: fy.fiscal_year_nepali || fy.fiscal_year_name || '',
            // Shrawan..Chaitra fall in the FY's starting BS year, Baishakh..Ashadh in the next.
            bs_year: startBsYear ? (p.period_no <= 9 ? startBsYear : startBsYear + 1) : null,
            bs_month: ((p.period_no + 2) % 12) + 1
        };
    });
}

// Exact BS date for an AD date - ONLY when it lies inside a configured
// period (period start = day 1 of that BS month). Otherwise null, and
// callers show the AD date instead of guessing.
function bsDateOf(adDate, periods) {
    if (!adDate) return null;
    const p = periods.find(x => adDate >= x.start_date && adDate <= x.end_date);
    if (!p || !p.bs_year) return null;
    const day = Math.round((new Date(adDate + 'T00:00:00Z') - new Date(p.start_date + 'T00:00:00Z')) / 86400000) + 1;
    return `${p.bs_year}-${String(p.bs_month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function periodKeyOf(adDate, periods) {
    const p = periods.find(x => adDate >= x.start_date && adDate <= x.end_date);
    if (p) return { key: `${p.bs_year}-${String(p.period_no).padStart(2, '0')}`, label: `${p.period_name} ${p.bs_year}`, label_np: `${p.period_name_np || BS_MONTHS[p.period_no - 1][1]} ${p.bs_year}`, start: p.start_date, end: p.end_date, exact: true };
    const m = String(adDate).slice(0, 7);
    return { key: m, label: m + ' (AD)', label_np: m + ' (AD)', start: m + '-01', end: null, exact: false };
}

// ---------- Expense bills and JV tax entries ----------
async function loadCustomTaxDocs(tenantClient, tenantId, docType, cfg, { dateFrom, dateTo, partyId, withLines }) {
    const table = cfg.custom === 'expense' ? 'purchase_additional_expenses' : 'journal_vouchers';
    let q = tenantClient.from(table).select('*').eq('tenant_id', tenantId).eq('status', 'posted');
    if (cfg.custom === 'jv') q = q.eq('tax_entry_type', cfg.jvType);
    if (dateFrom) q = q.gte('doc_date', dateFrom);
    if (dateTo) q = q.lte('doc_date', dateTo);
    const { data: headers, error } = await q.order('doc_date').limit(20000);
    if (error) throw error;
    if (!headers || !headers.length) return [];
    const defaultLedger = await defaultVatLedger(tenantClient, tenantId, cfg.side);
    const out = [];
    if (cfg.custom === 'expense') {
        const lines = await inChunks(headers.map(h => h.id), 200, async chunk => (await tenantClient.from('purchase_additional_expense_lines').select('*').in('expense_id', chunk).in('bill_type', ['taxable', 'non_taxable'])).data);
        const partyIds = [...new Set([...lines.map(l => l.party_ledger_id), ...headers.map(h => h.vendor_ledger_id)].filter(Boolean))];
        const parties = await inChunks(partyIds, 200, async chunk => (await tenantClient.from('ledger_accounts').select('id, account_name, pan_number, vat_pan_number').in('id', chunk)).data);
        const partyById = Object.fromEntries(parties.map(x => [x.id, x]));
        const byId = Object.fromEntries(headers.map(h => [h.id, h]));
        const bills = new Map();
        lines.filter(l => l.entry_sign !== 'deduct').forEach(l => {
            const h = byId[l.expense_id], pid = l.party_ledger_id || h.vendor_ledger_id || null;
            if (partyId && pid !== partyId) return;
            const k = `${h.id}|${pid}|${String(l.party_bill_no || '').trim().toLowerCase()}`;
            if (!bills.has(k)) {
                const party = partyById[pid];
                bills.set(k, { doc_type: docType, doc_label: cfg.label, side: cfg.side, sign: cfg.sign, id: k, document_id: h.id, doc_no: h.doc_no, doc_date: h.doc_date,
                    party_ledger_id: pid, party_name: l.party_name_snapshot || (l.party_ledger_id ? party?.account_name : h.vendor_name_snapshot || h.cash_vendor_name) || party?.account_name || '(Cash)',
                    party_pan: l.party_pan || party?.vat_pan_number || party?.pan_number || null, party_bill_no: l.party_bill_no || null, party_bill_date: l.party_bill_date || null,
                    invoice_type: h.invoice_type || null, taxable: 0, exempt: 0, vat: 0, total: 0, import_taxable: 0, vat_by_ledger: {}, lines: withLines ? [] : undefined });
            }
            const b = bills.get(k), base = round2(l.amount), vat = l.bill_type === 'taxable' ? round2(l.vat_amount) : 0;
            if (l.bill_type === 'taxable') b.taxable = round2(b.taxable + base); else b.exempt = round2(b.exempt + base);
            b.vat = round2(b.vat + vat); b.total = round2(b.total + base + vat);
            if (vat) { const lk = l.vat_in_cost ? 'not_claimed' : (l.vat_ledger_id || defaultLedger || 'unassigned'); b.vat_by_ledger[lk] = round2((b.vat_by_ledger[lk] || 0) + vat); }
            if (withLines) b.lines.push({ product_name: l.description || 'Expense', qty: null, uom: null, rate: null, taxable: l.bill_type === 'taxable' ? base : 0, exempt: l.bill_type === 'taxable' ? 0 : base, vat, amount: round2(base + vat) });
        });
        out.push(...bills.values());
    } else {
        const vatIds = new Set(await allVatLedgerIds(tenantClient, tenantId));
        const details = await inChunks(headers.map(h => h.id), 200, async chunk => (await tenantClient.from('journal_voucher_details').select('jv_id, ledger_id, ledger_name_snapshot, debit_amount, credit_amount, narration').in('jv_id', chunk)).data);
        const partyIds = [...new Set(headers.map(h => h.party_ledger_id).filter(Boolean))];
        const parties = await inChunks(partyIds, 200, async chunk => (await tenantClient.from('ledger_accounts').select('id, account_name, pan_number, vat_pan_number').in('id', chunk)).data);
        const partyById = Object.fromEntries(parties.map(x => [x.id, x]));
        headers.filter(h => !partyId || h.party_ledger_id === partyId).forEach(h => {
            const party = partyById[h.party_ledger_id];
            const taxable = round2(h.taxable_amount), exempt = round2(h.non_taxable_amount), vat = round2(h.vat_amount);
            const byLedger = {};
            details.filter(d => d.jv_id === h.id && vatIds.has(d.ledger_id)).forEach(d => { byLedger[d.ledger_id] = round2((byLedger[d.ledger_id] || 0) + Math.abs(Number(d.debit_amount) - Number(d.credit_amount))); });
            if (vat && !Object.keys(byLedger).length) byLedger[defaultLedger || 'unassigned'] = vat;
            out.push({ doc_type: docType, doc_label: cfg.label, side: cfg.side, sign: cfg.sign, id: h.id, document_id: h.id, doc_no: h.doc_no, doc_date: h.doc_date,
                party_ledger_id: h.party_ledger_id, party_name: h.party_name_snapshot || party?.account_name || '', party_pan: h.party_pan || party?.vat_pan_number || party?.pan_number || null,
                party_bill_no: h.party_bill_no || h.ref_doc_no || null, party_bill_date: h.party_bill_date || h.ref_doc_date || null, invoice_type: null, is_capital: !!h.is_capital,
                taxable, exempt, vat, total: round2(taxable + exempt + vat), import_taxable: 0, vat_by_ledger: byLedger,
                lines: withLines ? details.filter(d => d.jv_id === h.id).map(d => ({ product_name: d.ledger_name_snapshot || d.narration, qty: null, uom: null, rate: null, taxable: 0, vat: vatIds.has(d.ledger_id) ? round2(Math.abs(d.debit_amount - d.credit_amount)) : 0, amount: round2(Math.abs(d.debit_amount - d.credit_amount)) })) : undefined });
        });
    }
    return out;
}

// ---------- The one loader ----------
async function loadTaxDocs(tenantClient, tenantId, docType, { dateFrom, dateTo, partyId, withLines }) {
    const cfg = VAT_DOCS[docType];
    if (cfg.custom) return loadCustomTaxDocs(tenantClient, tenantId, docType, cfg, { dateFrom, dateTo, partyId, withLines });
    let q = tenantClient.from(cfg.header).select('*').eq('tenant_id', tenantId).eq('status', 'posted');
    if (dateFrom) q = q.gte('doc_date', dateFrom);
    if (dateTo) q = q.lte('doc_date', dateTo);
    if (partyId) q = q.eq(cfg.party, partyId);
    const { data: headers, error } = await q.order('doc_date').limit(20000);
    if (error) throw error;
    if (!headers || headers.length === 0) return [];
    const ids = headers.map(h => h.id);

    const lines = await inChunks(ids, 200, async chunk => (await tenantClient.from(cfg.detail).select('*').in(cfg.fk, chunk)).data);
    const linesByDoc = {};
    lines.forEach(l => { (linesByDoc[l[cfg.fk]] = linesByDoc[l[cfg.fk]] || []).push(l); });

    // Purchase-side VAT delivered through Billing Terms (tax_type = 'vat').
    // Which ledger each VAT amount goes to - same rule as posting (utils/vatLedger).
    const vatTerms = await getVatTerms(tenantClient, tenantId);
    const defaultLedger = await defaultVatLedger(tenantClient, tenantId, cfg.side, vatTerms);
    const vatByLedgerByDoc = {};
    const addVat = (docId, ledgerId, amt) => { const k = ledgerId || 'unassigned'; const m = vatByLedgerByDoc[docId] = vatByLedgerByDoc[docId] || {}; m[k] = round2((m[k] || 0) + amt); };

    const termVatByDoc = {}, docLevelVat = new Set(), lineVatDetailIds = new Set();
    if (cfg.termDocType) {
        const termById = Object.fromEntries(vatTerms.map(t => [t.id, t]));
        const isReturn = cfg.sign < 0;
        const termLedger = t => (isReturn ? (t.return_ledger_id || t.billing_ledger_id) : t.billing_ledger_id) || defaultLedger;
        if (vatTerms.length) {
            const docTerms = await inChunks(ids, 200, async chunk => (await tenantClient.from('document_billing_terms').select('document_id, billing_term_id, computed_amount').eq('document_type', cfg.termDocType).in('document_id', chunk)).data);
            const lineTerms = await inChunks(ids, 200, async chunk => (await tenantClient.from('document_line_billing_terms').select('document_id, detail_id, billing_term_id, computed_amount').eq('document_type', cfg.termDocType).in('document_id', chunk)).data);
            docTerms.filter(t => termById[t.billing_term_id]).forEach(t => { termVatByDoc[t.document_id] = (termVatByDoc[t.document_id] || 0) + Number(t.computed_amount || 0); docLevelVat.add(t.document_id); addVat(t.document_id, termLedger(termById[t.billing_term_id]), Number(t.computed_amount || 0)); });
            lineTerms.filter(t => termById[t.billing_term_id]).forEach(t => { termVatByDoc[t.document_id] = (termVatByDoc[t.document_id] || 0) + Number(t.computed_amount || 0); lineVatDetailIds.add(t.detail_id); addVat(t.document_id, termLedger(termById[t.billing_term_id]), Number(t.computed_amount || 0)); });
        }
    }

    // Credit/Debit Notes: a line is VAT when it posts to ANY VAT ledger.
    const vatLedgerSet = cfg.ledgerNote ? new Set(await allVatLedgerIds(tenantClient, tenantId)) : new Set();

    const partyIds = [...new Set(headers.map(h => h[cfg.party]).filter(Boolean))];
    const parties = await inChunks(partyIds, 200, async chunk => (await tenantClient.from('ledger_accounts').select('id, account_name, pan_number, vat_pan_number').in('id', chunk)).data);
    const partyById = Object.fromEntries(parties.map(p => [p.id, p]));

    return headers.map(h => {
        const docLines = linesByDoc[h.id] || [];
        const total = round2(h.total_amount);
        let vat, exempt, lineOut = [];
        if (cfg.ledgerNote) {
            const vatLines = docLines.filter(l => vatLedgerSet.has(l.ledger_id));
            vatLines.forEach(l => addVat(h.id, l.ledger_id, Number(l.amount || 0)));
            vat = round2(vatLines.reduce((s, l) => s + Number(l.amount || 0), 0));
            exempt = vat > 0 ? 0 : total;
            if (withLines) lineOut = docLines.map(l => ({ product_name: l.ledger_name_snapshot, qty: null, uom: null, rate: null, taxable: 0, vat: vatLedgerSet.has(l.ledger_id) ? round2(l.amount) : 0, amount: round2(l.amount) }));
        } else {
            const lineVat = docLines.reduce((s, l) => s + Number(l.tax_amount || 0), 0);
            if (lineVat) addVat(h.id, defaultLedger, lineVat);
            vat = round2(lineVat + (termVatByDoc[h.id] || 0));
            exempt = docLevelVat.has(h.id) ? 0 : round2(docLines
                .filter(l => !(Number(l.tax_amount) > 0) && !lineVatDetailIds.has(l.id))
                .reduce((s, l) => s + Number(l.amount || 0) - Number(l.tax_amount || 0), 0));
            if (withLines) lineOut = docLines.map(l => {
                const tax = round2(l.tax_amount), base = round2(Number(l.amount || 0) - Number(l.tax_amount || 0));
                const isExempt = !(tax > 0) && !lineVatDetailIds.has(l.id) && !docLevelVat.has(h.id);
                return { product_name: l.product_name_snapshot, qty: Number(l.qty) || 0, uom: l.uom_name_snapshot, rate: Number(l.rate) || 0, discount: round2(l.discount_amount), taxable: isExempt ? 0 : base, exempt: isExempt ? base : 0, vat: tax, amount: round2(l.amount) };
            });
        }
        const taxable = round2(Math.max(0, total - vat - exempt));
        const party = partyById[h[cfg.party]];
        const importTaxable = docType === 'purchase'
            ? round2(h.import_detail_mode === 'item_wise' ? docLines.reduce((s, l) => s + Number(l.item_import_taxable_amount || 0), 0) : h.bill_wise_import_taxable_amount)
            : 0;
        return {
            doc_type: docType, doc_label: cfg.label, side: cfg.side, sign: cfg.sign,
            id: h.id, doc_no: h.doc_no, doc_date: h.doc_date,
            party_ledger_id: h[cfg.party] || null,
            party_name: h[cfg.partyName] || h.cash_vendor_name || party?.account_name || '(Cash)',
            party_pan: party?.vat_pan_number || party?.pan_number || null,
            party_bill_no: h.party_bill_no || h.ref_doc_no || null,
            party_bill_date: h.party_bill_date || h.ref_doc_date || null,
            invoice_type: h.invoice_type || null,
            taxable, exempt, vat, total, import_taxable: importTaxable,
            vat_by_ledger: vatByLedgerByDoc[h.id] || {},
            lines: withLines ? lineOut : undefined
        };
    });
}

function parseTypes(q) {
    const list = String(q.doc_types || 'sales').split(',').filter(t => VAT_DOCS[t]);
    return list.length ? list : ['sales'];
}

function applyDocFilters(docs, q) {
    let out = docs;
    const min = Number(q.min_amount), max = Number(q.max_amount);
    if (min > 0) out = out.filter(d => d.total >= min);
    if (max > 0) out = out.filter(d => d.total <= max);
    if (q.pan === 'with') out = out.filter(d => d.party_pan);
    if (q.pan === 'without') out = out.filter(d => !d.party_pan);
    if (q.vat === 'taxable') out = out.filter(d => d.vat > 0);
    if (q.vat === 'exempt') out = out.filter(d => d.vat === 0);
    if (q.invoice_type) out = out.filter(d => d.invoice_type === q.invoice_type);
    return out;
}

// Output / input VAT from every document type of that side (returns and notes carry sign -1).
const sideVat = (byType, side) => round2(Object.entries(VAT_DOCS).filter(([, c]) => c.side === side).reduce((a, [k, c]) => a + c.sign * (byType[k] || 0), 0));
const sumOf = rows => rows.reduce((t, d) => ({
    count: t.count + 1, taxable: round2(t.taxable + d.taxable), exempt: round2(t.exempt + d.exempt), vat: round2(t.vat + d.vat), total: round2(t.total + d.total), import_taxable: round2(t.import_taxable + (d.import_taxable || 0))
}), { count: 0, taxable: 0, exempt: 0, vat: 0, total: 0, import_taxable: 0 });

// ---------- Meta / periods ----------
router.get('/vat-reports/meta', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const periods = await loadPeriods(tenantClient, req.auth.tenantId);
        const { data: years } = await tenantClient.from('fiscal_years').select('id, fiscal_year_name, fiscal_year_nepali, start_date_eng, end_date_eng, start_date_nep, is_current').eq('tenant_id', req.auth.tenantId).order('start_date_eng', { ascending: false });
        const vIds = await allVatLedgerIds(tenantClient, req.auth.tenantId);
        const { data: vatLedgers } = vIds.length ? await tenantClient.from('ledger_accounts').select('id, account_name').in('id', vIds) : { data: [] };
        res.json({ success: true, data: { bs_calendar: bsCalendar.status(), doc_types: Object.entries(VAT_DOCS).map(([key, c]) => ({ key, label: c.label, label_np: c.label_np, side: c.side })), periods, fiscal_years: years || [], bs_months: BS_MONTHS, vat_ledgers: vatLedgers || [] } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Suggest the 12 VAT month start dates from the official BS calendar
// (nepali-date-converter). Only a suggestion - the user reviews and saves,
// and the save still enforces the 29-32 day rule.
router.get('/vat-reports/periods/suggest/:fiscalYearId', requireAuth, async (req, res) => {
    try {
        if (!bsCalendar.available()) return res.status(400).json({ success: false, error: `Nepali calendar package not available (${bsCalendar.status().reason}). Run npm install in the server folder, or enter the dates manually.` });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: fy } = await tenantClient.from('fiscal_years').select('start_date_eng, start_date_nep').eq('id', req.params.fiscalYearId).eq('tenant_id', req.auth.tenantId).maybeSingle();
        if (!fy) return res.status(404).json({ success: false, error: 'Fiscal year not found' });
        const startBs = bsCalendar.adToBs(String(fy.start_date_eng).slice(0, 10));
        // FY starts on Shrawan 1; use its BS year (trust the calendar over a typed start_date_nep).
        const y = startBs && startBs.month === 4 && startBs.day === 1 ? startBs.year : parseInt(String(fy.start_date_nep || '').slice(0, 4), 10);
        if (!y) return res.status(400).json({ success: false, error: 'Could not work out the BS year of this fiscal year' });
        const starts = BS_MONTHS.map((_, i) => { const m = ((i + 3) % 12) + 1; return bsCalendar.bsToAd(i <= 8 ? y : y + 1, m, 1); });
        const warning = starts[0] !== String(fy.start_date_eng).slice(0, 10)
            ? `Calendar says Shrawan 1, ${y} is ${starts[0]}, but this fiscal year starts on ${String(fy.start_date_eng).slice(0, 10)}. Please correct the fiscal year dates first.` : null;
        res.json({ success: true, data: { start_dates: starts, bs_year: y, warning } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save the 12 period start dates for one fiscal year. End dates are
// derived (next start - 1; last = fiscal year end) so gaps/overlaps
// between months are impossible.
router.put('/vat-reports/periods/:fiscalYearId', requireAuth, loadUserPermissions, requirePermission('company_settings', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: fy } = await tenantClient.from('fiscal_years').select('*').eq('id', req.params.fiscalYearId).eq('tenant_id', tenantId).maybeSingle();
        if (!fy) return res.status(404).json({ success: false, error: 'Fiscal year not found' });
        const starts = req.body.start_dates || [];
        if (starts.length !== 12 || starts.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d || ''))) return res.status(400).json({ success: false, error: 'Enter all 12 month start dates' });
        if (starts[0] !== fy.start_date_eng) return res.status(400).json({ success: false, error: `Shrawan must start on the fiscal year start date (${fy.start_date_eng})` });
        for (let i = 1; i < 12; i++) {
            if (starts[i] <= starts[i - 1]) return res.status(400).json({ success: false, error: `${BS_MONTHS[i][0]} must start after ${BS_MONTHS[i - 1][0]}` });
            const gap = (new Date(starts[i]) - new Date(starts[i - 1])) / 86400000;
            if (gap < 29 || gap > 32) return res.status(400).json({ success: false, error: `${BS_MONTHS[i - 1][0]} would have ${gap} days - a BS month has 29 to 32 days. Please re-check the date.` });
        }
        const lastDays = (new Date(fy.end_date_eng) - new Date(starts[11])) / 86400000 + 1;
        if (lastDays < 29 || lastDays > 32) return res.status(400).json({ success: false, error: `Ashadh would have ${lastDays} days (to fiscal year end ${fy.end_date_eng}) - please re-check.` });
        const dayBefore = d => new Date(new Date(d + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
        const { data: existing } = await tenantClient.from('fiscal_periods').select('period_no, is_locked').eq('fiscal_year_id', fy.id);
        if ((existing || []).some(p => p.is_locked)) return res.status(400).json({ success: false, error: 'Some months are locked (VAT filed) - unlock them before changing dates' });
        const rows = starts.map((s, i) => ({
            tenant_id: tenantId, fiscal_year_id: fy.id, period_no: i + 1, period_name: BS_MONTHS[i][0], period_name_np: BS_MONTHS[i][1],
            start_date: s, end_date: i < 11 ? dayBefore(starts[i + 1]) : fy.end_date_eng, updated_by: req.auth.userId, updated_at: new Date().toISOString()
        }));
        const { error } = await tenantClient.from('fiscal_periods').upsert(rows, { onConflict: 'fiscal_year_id,period_no' });
        if (error) throw error;
        res.json({ success: true, message: 'VAT months saved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Register ----------
// view: bill | party | item | month | summary ; include_items=true adds lines to bill view.
router.get('/vat-reports/register', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const q = req.query, tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const view = q.view || 'bill';
        const periods = await loadPeriods(tenantClient, tenantId);
        const withLines = view === 'item' || q.include_items === 'true';
        let docs = [];
        for (const t of parseTypes(q)) docs.push(...await loadTaxDocs(tenantClient, tenantId, t, { dateFrom: q.date_from, dateTo: q.date_to, partyId: q.party_ledger_id, withLines }));
        docs = applyDocFilters(docs, q).sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)) || String(a.doc_no).localeCompare(String(b.doc_no)));
        docs.forEach(d => { d.bs_date = bsDateOf(d.doc_date, periods); });

        let rows;
        if (view === 'bill') rows = docs;
        else if (view === 'item') {
            rows = [];
            docs.forEach(d => (d.lines || []).forEach(l => rows.push({ doc_type: d.doc_type, doc_label: d.doc_label, doc_no: d.doc_no, doc_date: d.doc_date, bs_date: d.bs_date, party_name: d.party_name, party_pan: d.party_pan, ...l })));
            if (q.product_name) rows = rows.filter(r => String(r.product_name || '').toLowerCase().includes(String(q.product_name).toLowerCase()));
        } else {
            const groups = {};
            docs.forEach(d => {
                let key, label, extra = {};
                if (view === 'party') { key = `${d.doc_type}|${d.party_ledger_id || d.party_name}`; label = d.party_name; extra = { party_pan: d.party_pan, doc_label: d.doc_label, doc_type: d.doc_type }; }
                else if (view === 'month') { const p = periodKeyOf(d.doc_date, periods); key = `${p.key}|${d.doc_type}`; label = p.label; extra = { label_np: p.label_np, period_key: p.key, doc_label: d.doc_label, doc_type: d.doc_type, exact_bs: p.exact }; }
                else { key = d.doc_type; label = d.doc_label; extra = { doc_type: d.doc_type }; }
                const g = groups[key] = groups[key] || { key, label, ...extra, docs: [] };
                g.docs.push(d);
            });
            rows = Object.values(groups).map(g => { const { docs: gd, ...rest } = g; return { ...rest, ...sumOf(gd) }; });
            if (view === 'month') rows.sort((a, b) => String(a.period_key).localeCompare(String(b.period_key)) || String(a.doc_type).localeCompare(String(b.doc_type)));
            else rows.sort((a, b) => b.total - a.total);
        }
        res.json({ success: true, data: { view, rows, totals: sumOf(docs), periods_configured: periods.length > 0 } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Monthly summary (every doc type, bill counts) ----------
router.get('/vat-reports/monthly-summary', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const q = req.query, tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const periods = await loadPeriods(tenantClient, tenantId);
        const months = {};
        for (const t of Object.keys(VAT_DOCS)) {
            const docs = await loadTaxDocs(tenantClient, tenantId, t, { dateFrom: q.date_from, dateTo: q.date_to });
            docs.forEach(d => {
                const p = periodKeyOf(d.doc_date, periods);
                const m = months[p.key] = months[p.key] || { period_key: p.key, label: p.label, label_np: p.label_np, exact_bs: p.exact, types: {} };
                const s = m.types[t] = m.types[t] || { count: 0, taxable: 0, exempt: 0, vat: 0, total: 0 };
                s.count += 1; s.taxable = round2(s.taxable + d.taxable); s.exempt = round2(s.exempt + d.exempt); s.vat = round2(s.vat + d.vat); s.total = round2(s.total + d.total);
            });
        }
        const rows = Object.values(months).sort((a, b) => String(a.period_key).localeCompare(String(b.period_key))).map(m => {
            const vats = Object.fromEntries(Object.keys(VAT_DOCS).map(t => [t, m.types[t]?.vat || 0]));
            const out = sideVat(vats, 'sales'), inp = sideVat(vats, 'purchase');
            return { ...m, output_vat: out, input_vat: inp, net_vat: round2(out - inp) };
        });
        res.json({ success: true, data: { rows, doc_types: Object.entries(VAT_DOCS).map(([k, c]) => ({ key: k, label: c.label, label_np: c.label_np })), periods_configured: periods.length > 0 } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Parties above a threshold (monthly upload / Annex 13) ----------
// Per party, NET of returns and notes. basis = excl_vat (default) | incl_vat.
router.get('/vat-reports/above-threshold', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const q = req.query, tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const threshold = Number(q.threshold) > 0 ? Number(q.threshold) : 100000;
        const basis = q.basis === 'incl_vat' ? 'incl_vat' : 'excl_vat';
        const sides = q.side === 'purchase' ? ['purchase'] : q.side === 'sales' ? ['sales'] : ['sales', 'purchase'];
        const byParty = {};
        for (const [t, cfg] of Object.entries(VAT_DOCS)) {
            if (!sides.includes(cfg.side)) continue;
            const docs = await loadTaxDocs(tenantClient, tenantId, t, { dateFrom: q.date_from, dateTo: q.date_to });
            docs.forEach(d => {
                const key = `${cfg.side}|${d.party_ledger_id || 'cash:' + d.party_name}`;
                const p = byParty[key] = byParty[key] || { side: cfg.side, party_ledger_id: d.party_ledger_id, party_name: d.party_name, party_pan: d.party_pan, bill_count: 0, taxable: 0, exempt: 0, vat: 0, total: 0 };
                if (cfg.sign > 0) p.bill_count += 1;
                p.taxable = round2(p.taxable + cfg.sign * d.taxable); p.exempt = round2(p.exempt + cfg.sign * d.exempt);
                p.vat = round2(p.vat + cfg.sign * d.vat); p.total = round2(p.total + cfg.sign * d.total);
            });
        }
        const rows = Object.values(byParty)
            .map(p => ({ ...p, basis_amount: basis === 'incl_vat' ? p.total : round2(p.taxable + p.exempt) }))
            .filter(p => p.basis_amount > threshold)
            .sort((a, b) => a.side.localeCompare(b.side) || b.basis_amount - a.basis_amount);
        res.json({ success: true, data: { rows, threshold, basis, without_pan: rows.filter(r => !r.party_pan).length } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- Monthly VAT return figures ----------
router.get('/vat-reports/vat-return', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const q = req.query, tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        if (!q.date_from || !q.date_to) return res.status(400).json({ success: false, error: 'Choose the VAT month (or a date range)' });
        const s = {};
        for (const t of Object.keys(VAT_DOCS)) s[t] = sumOf(await loadTaxDocs(tenantClient, tenantId, t, { dateFrom: q.date_from, dateTo: q.date_to }));
        const carry = round2(q.carry_forward_credit);
        const vats = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.vat]));
        const output = sideVat(vats, 'sales');
        // input credit: VAT that went to a VAT ledger (expense-bill VAT added to cost is not claimed)
        const notClaimed = round2((await loadTaxDocs(tenantClient, tenantId, 'purchase_expense', { dateFrom: q.date_from, dateTo: q.date_to })).reduce((a, d) => a + (d.vat_by_ledger.not_claimed || 0), 0));
        const input = round2(sideVat(vats, 'purchase') - notClaimed);
        const addUp = (...keys) => keys.reduce((o, k) => ({ taxable: round2(o.taxable + s[k].taxable), exempt: round2(o.exempt + s[k].exempt), vat: round2(o.vat + s[k].vat), count: o.count + s[k].count, import_taxable: round2(o.import_taxable + (s[k].import_taxable || 0)) }), { taxable: 0, exempt: 0, vat: 0, count: 0, import_taxable: 0 });
        const salesAll = addUp('sales', 'jv_sales'), purchaseAll = addUp('purchase', 'purchase_expense', 'jv_purchase');
        const net = round2(output - input - carry);

        // Reconciliation against the GL for the same dates, across EVERY
        // VAT ledger (System Control's + each VAT billing term's ledgers).
        const vatLedgerIds = await allVatLedgerIds(tenantClient, tenantId);
        let gl = null;
        if (vatLedgerIds.length) {
            const { data: glLines } = await tenantClient.from('ledger_transaction_lines')
                .select('ledger_account_id, debit_amount, credit_amount, batch:batch_id!inner(batch_date, document_type)')
                .eq('tenant_id', tenantId).in('ledger_account_id', vatLedgerIds)
                .gte('batch.batch_date', q.date_from).lte('batch.batch_date', q.date_to).limit(50000);
            const { data: names } = await tenantClient.from('ledger_accounts').select('id, account_name').in('id', vatLedgerIds);
            const nameById = Object.fromEntries((names || []).map(n => [n.id, n.account_name]));
            const byType = {}, byLedger = {};
            (glLines || []).forEach(l => {
                const net = Number(l.credit_amount) - Number(l.debit_amount);
                byType[l.batch.document_type] = round2((byType[l.batch.document_type] || 0) + net);
                const n = nameById[l.ledger_account_id] || l.ledger_account_id;
                byLedger[n] = round2((byLedger[n] || 0) + net);
            });
            gl = { by_document_type: byType, by_ledger: byLedger, net_credit: round2(Object.values(byType).reduce((a, b) => a + b, 0)) };
        }
        res.json({
            success: true,
            data: {
                period: { from: q.date_from, to: q.date_to },
                sales: { taxable: salesAll.taxable, exempt: salesAll.exempt, vat: salesAll.vat, count: salesAll.count },
                sales_breakdown: { sales_bill: s.sales, jv_sales: s.jv_sales },
                purchase_breakdown: { purchase_bill: s.purchase, purchase_expense: s.purchase_expense, jv_purchase: s.jv_purchase, expense_vat_not_claimed: notClaimed },
                sales_return: { taxable: s.sales_return.taxable, exempt: s.sales_return.exempt, vat: s.sales_return.vat, count: s.sales_return.count },
                credit_note: { taxable: s.credit_note.taxable, exempt: s.credit_note.exempt, vat: s.credit_note.vat, count: s.credit_note.count },
                purchase: { taxable: round2(purchaseAll.taxable - purchaseAll.import_taxable), import_taxable: purchaseAll.import_taxable, exempt: purchaseAll.exempt, vat: purchaseAll.vat, count: purchaseAll.count },
                purchase_return: { taxable: s.purchase_return.taxable, exempt: s.purchase_return.exempt, vat: s.purchase_return.vat, count: s.purchase_return.count },
                debit_note: { taxable: s.debit_note.taxable, exempt: s.debit_note.exempt, vat: s.debit_note.vat, count: s.debit_note.count },
                output_vat: output, input_vat: input, carry_forward_credit: carry,
                net_vat_payable: net > 0 ? net : 0, credit_to_carry_forward: net < 0 ? -net : 0,
                gl_check: gl, vat_ledger_configured: vatLedgerIds.length > 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- All-in-one VAT ledger ----------
router.get('/vat-reports/vat-ledger', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const q = req.query, tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const periods = await loadPeriods(tenantClient, tenantId);
        let docs = [];
        for (const t of Object.keys(VAT_DOCS)) docs.push(...await loadTaxDocs(tenantClient, tenantId, t, { dateFrom: q.date_from, dateTo: q.date_to, partyId: q.party_ledger_id }));
        // VAT Account filter: keep only documents touching that ledger and
        // count ONLY that ledger's share of their VAT.
        const vatOf = d => q.vat_ledger_id ? Number(d.vat_by_ledger[q.vat_ledger_id] || 0) : round2(d.vat - Number(d.vat_by_ledger.not_claimed || 0));
        docs = applyDocFilters(docs, q).filter(d => q.include_exempt === 'true' || vatOf(d) !== 0)
            .filter(d => !q.vat_ledger_id || d.vat_by_ledger[q.vat_ledger_id] !== undefined)
            .sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)) || String(a.doc_no).localeCompare(String(b.doc_no)));
        const ledgerIds = [...new Set(docs.flatMap(d => Object.keys(d.vat_by_ledger)).filter(k => k !== 'unassigned' && k !== 'not_claimed'))];
        const { data: ledgerNames } = ledgerIds.length ? await tenantClient.from('ledger_accounts').select('id, account_name').in('id', ledgerIds) : { data: [] };
        const nameOf = Object.fromEntries((ledgerNames || []).map(l => [l.id, l.account_name]));
        let running = round2(q.opening);
        const rows = docs.map(d => {
            // Output VAT (sales side) increases payable; input VAT reduces it. Returns/notes reverse.
            const v = vatOf(d);
            const vatOut = d.side === 'sales' ? round2(d.sign * v) : 0;
            const vatIn = d.side === 'purchase' ? round2(d.sign * v) : 0;
            running = round2(running + vatOut - vatIn);
            const accounts = Object.entries(d.vat_by_ledger).map(([k, a]) => `${k === 'unassigned' ? '(no VAT ledger)' : k === 'not_claimed' ? '(added to cost, not claimed)' : (nameOf[k] || k)}${Object.keys(d.vat_by_ledger).length > 1 ? ' ' + round2(a).toFixed(2) : ''}`).join(', ');
            return { doc_date: d.doc_date, bs_date: bsDateOf(d.doc_date, periods), doc_label: d.doc_label, doc_type: d.doc_type, doc_no: d.doc_no, party_name: d.party_name, party_pan: d.party_pan, party_bill_no: d.party_bill_no, vat_accounts: accounts, taxable: round2(d.sign * d.taxable), exempt: round2(d.sign * d.exempt), vat_out: vatOut, vat_in: vatIn, running_payable: running };
        });
        const totals = rows.reduce((t, r) => ({ taxable: round2(t.taxable + r.taxable), exempt: round2(t.exempt + r.exempt), vat_out: round2(t.vat_out + r.vat_out), vat_in: round2(t.vat_in + r.vat_in) }), { taxable: 0, exempt: 0, vat_out: 0, vat_in: 0 });
        res.json({ success: true, data: { rows, totals, opening: round2(q.opening), closing: running } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------- TDS (Journal Voucher lines with TDS %) ----------
router.get('/vat-reports/tds', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const q = req.query, tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        let hq = tenantClient.from('journal_vouchers').select('id, doc_no, doc_date').eq('tenant_id', tenantId).eq('status', 'posted');
        if (q.date_from) hq = hq.gte('doc_date', q.date_from);
        if (q.date_to) hq = hq.lte('doc_date', q.date_to);
        const { data: jvs } = await hq.limit(20000);
        const jvById = Object.fromEntries((jvs || []).map(j => [j.id, j]));
        const lines = await inChunks((jvs || []).map(j => j.id), 200, async chunk => (await tenantClient.from('journal_voucher_details').select('jv_id, ledger_id, ledger_name_snapshot, debit_amount, credit_amount, tds_percent').in('jv_id', chunk).gt('tds_percent', 0)).data);
        const ledgerIds = [...new Set(lines.map(l => l.ledger_id))];
        const ledgers = await inChunks(ledgerIds, 200, async chunk => (await tenantClient.from('ledger_accounts').select('id, pan_number, vat_pan_number').in('id', chunk)).data);
        const panById = Object.fromEntries(ledgers.map(l => [l.id, l.vat_pan_number || l.pan_number || null]));
        const rows = lines.map(l => {
            const base = round2(Number(l.debit_amount || 0) || Number(l.credit_amount || 0));
            return { doc_label: 'Journal', doc_date: jvById[l.jv_id]?.doc_date, doc_no: jvById[l.jv_id]?.doc_no, party_name: l.ledger_name_snapshot, party_pan: panById[l.ledger_id], base_amount: base, tds_percent: Number(l.tds_percent), tds_amount: round2(base * Number(l.tds_percent) / 100) };
        });
        // Additional expense entries: a "deduct" line with a rate % is TDS withheld from that
        // line's party; its base is the party's (VAT-exclusive) expense amount in the entry.
        let eq = tenantClient.from('purchase_additional_expenses').select('id, doc_no, doc_date, vendor_ledger_id, vendor_name_snapshot').eq('tenant_id', tenantId).eq('status', 'posted');
        if (q.date_from) eq = eq.gte('doc_date', q.date_from);
        if (q.date_to) eq = eq.lte('doc_date', q.date_to);
        const { data: exps } = await eq.limit(20000);
        const expById = Object.fromEntries((exps || []).map(e => [e.id, e]));
        const expLines = await inChunks((exps || []).map(e => e.id), 200, async chunk => (await tenantClient.from('purchase_additional_expense_lines').select('*').in('expense_id', chunk)).data);
        const tdsLines = expLines.filter(l => l.entry_sign === 'deduct' && Number(l.rate_percent) > 0);
        const expPartyIds = [...new Set(tdsLines.map(l => l.party_ledger_id || expById[l.expense_id]?.vendor_ledger_id).filter(Boolean))];
        const expParties = await inChunks(expPartyIds, 200, async chunk => (await tenantClient.from('ledger_accounts').select('id, account_name, pan_number, vat_pan_number').in('id', chunk)).data);
        const expPartyById = Object.fromEntries(expParties.map(x => [x.id, x]));
        tdsLines.forEach(l => {
            const h = expById[l.expense_id], pid = l.party_ledger_id || h.vendor_ledger_id, party = expPartyById[pid];
            const base = round2(expLines.filter(x => x.expense_id === l.expense_id && x.entry_sign !== 'deduct' && (x.party_ledger_id || h.vendor_ledger_id) === pid).reduce((a, x) => a + Number(x.amount || 0), 0));
            rows.push({ doc_label: 'Additional Expense', doc_date: h.doc_date, doc_no: h.doc_no, party_name: party?.account_name || h.vendor_name_snapshot || '', party_pan: party?.vat_pan_number || party?.pan_number || null,
                base_amount: base, tds_percent: Number(l.rate_percent), tds_amount: round2(l.amount) });
        });
        rows.sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)));
        const totals = rows.reduce((t, r) => ({ base_amount: round2(t.base_amount + r.base_amount), tds_amount: round2(t.tds_amount + r.tds_amount) }), { base_amount: 0, tds_amount: 0 });
        res.json({ success: true, data: { rows, totals } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
module.exports._internals = { loadTaxDocs, bsDateOf, periodKeyOf, sumOf, applyDocFilters, VAT_DOCS };
