// =============================================
// routes/journalVoucherRoutes.js
// Direct multi-line Dr/Cr entries - the SUM(debit) = SUM(credit) rule
// is validated here before save, matching the same balance the shared
// ledger_transaction_lines table enforces at commit. A posted JV's own
// lines are copied straight into that shared table - the single place
// every document's accounting effect lands (GRN, Bill, and now JV).
// =============================================

const express = require('express');
const { checkCompulsoryFields, lockProtectedFields } = require('../utils/entryFieldRules');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveDocumentNumber } = require('../utils/documentNumbering');
const { classifyLedgers, allowed } = require('../utils/ledgerPurpose');
const { allVatLedgerIds } = require('../utils/vatLedger');
const jvTdsBills = require('../utils/jvTdsBills');

// ---------- JV types: taxable / non-taxable goods, assets, services; TDS ----------
// jv_type decides the options of the voucher (JournalVoucher.jsx shows only
// those) and what its lines must be:
//   purchase side  Dr goods / asset / expense (taxable + non-taxable), Dr VAT,
//                  Cr party (total - TDS), Cr TDS payable (TDS)
//   sales side     Dr party (total - TDS), Dr TDS receivable (TDS),
//                  Cr sales / asset / income, Cr VAT
//   tds            tds_side 'purchase' (TDS on purchase) or 'sales' (TDS on sales)
//                  against bills (jv_tds_bills): purchase Dr supplier / Cr TDS
//                  payable, sales Dr TDS receivable / Cr customer - TDS of
//                  the chosen bills; without bills (purchase): Dr expense
//                  (base), Cr TDS payable (TDS), Cr party (base - TDS)
// tax_entry_type stays 'purchase' / 'sales' for the six tax types, so the VAT
// register and VAT return see them; asset purchase is a capital purchase.
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const JV_TYPES = {
    normal: { side: null },
    purchase: { side: 'purchase', purposes: ['purchase_goods', 'expense'], label: 'purchase / expense' },
    asset_purchase: { side: 'purchase', purposes: ['fixed_asset'], label: 'fixed asset', capital: true },
    service_purchase: { side: 'purchase', purposes: ['pl_expense'], label: 'service / expense' },
    sales: { side: 'sales', purposes: ['sales_goods'], label: 'sales' },
    asset_sales: { side: 'sales', purposes: ['fixed_asset', 'income'], label: 'fixed asset (or disposal income)' },
    service_sales: { side: 'sales', purposes: ['income'], label: 'service income' },
    tds: { side: null, tds: true },
    // many small customer / supplier balances nilled against discount (utils/balanceWriteoff.js)
    balance_writeoff: { side: null, writeoff: true }
};
const jvTypeOf = b => (JV_TYPES[b.jv_type] ? b.jv_type
    : b.tax_entry_type === 'purchase' ? (b.is_capital ? 'asset_purchase' : 'purchase') : b.tax_entry_type === 'sales' ? 'sales' : 'normal');
function taxFields(b) {
    const jvType = jvTypeOf(b), T = JV_TYPES[jvType];
    const blankTds = { tds_ledger_id: null, tds_sub_ledger_id: null, tds_percent: 0, tds_base_amount: 0, tds_amount: 0, tds_side: null };
    if (jvType === 'normal') return { jv_type: 'normal', tax_entry_type: 'none', party_ledger_id: null, party_name_snapshot: null, party_pan: null, party_bill_no: null, party_bill_date: null,
        taxable_amount: 0, non_taxable_amount: 0, vat_percent: null, vat_amount: 0, is_capital: false, ...blankTds };
    const tax = !!T.side;
    const taxable = tax ? r2(b.taxable_amount) : 0, nonTaxable = tax ? r2(b.non_taxable_amount) : 0;
    const percent = Math.max(0, Number(b.tds_percent) || 0);
    const base = Number(b.tds_base_amount) > 0 ? r2(b.tds_base_amount) : tax ? r2(taxable + nonTaxable) : 0;
    const tdsAmount = Number(b.tds_amount) > 0 ? r2(b.tds_amount) : r2(base * percent / 100);
    return { jv_type: jvType, tax_entry_type: T.side || 'none', party_ledger_id: b.party_ledger_id || null, party_pan: b.party_pan ? String(b.party_pan).trim() : null,
        party_bill_no: b.party_bill_no ? String(b.party_bill_no).trim() : null, party_bill_date: b.party_bill_date || null,
        taxable_amount: taxable, non_taxable_amount: nonTaxable, vat_percent: tax ? (b.vat_percent === '' || b.vat_percent == null ? null : Number(b.vat_percent)) : null,
        vat_amount: tax ? r2(b.vat_amount) : 0, is_capital: !!T.capital,
        ...(tdsAmount > 0 ? { tds_ledger_id: b.tds_ledger_id || null, tds_sub_ledger_id: b.tds_sub_ledger_id || null, tds_percent: percent, tds_base_amount: base, tds_amount: tdsAmount } : blankTds),
        tds_side: T.tds ? (b.tds_side === 'sales' ? 'sales' : 'purchase') : null };
}
// TDS ledger of a voucher: the one chosen, else System Control (payable / receivable)
async function withTdsLedger(c, t, f) {
    if (!(f.tds_amount > 0) || f.tds_ledger_id) return f;
    const { data: sc } = await c.from('system_control_settings').select('tds_ledger_id, sales_tds_ledger_id').eq('tenant_id', t).maybeSingle();
    const receivable = JV_TYPES[f.jv_type].side === 'sales' || f.tds_side === 'sales';
    return { ...f, tds_ledger_id: (receivable ? sc?.sales_tds_ledger_id : sc?.tds_ledger_id) || null };
}
// The figures must tie to the voucher's own lines (see the table above).
async function checkJvTax(c, t, b, isDraft) {
    const f = await withTdsLedger(c, t, taxFields(b));
    if (f.jv_type === 'normal' || isDraft) return null;
    const T = JV_TYPES[f.jv_type];
    if (T.writeoff) return null;   // plain Dr / Cr lines, many parties
    const purchase = T.side !== 'sales' && !(T.tds && f.tds_side === 'sales');   // purchase side and TDS on purchase: TDS payable credited
    const who = T.side === 'sales' || f.tds_side === 'sales' ? 'customer' : T.side === 'purchase' || f.tds_side === 'purchase' ? 'supplier' : 'party';
    if (!f.party_ledger_id) return `Choose the ${who}`;
    if (f.tds_amount > 0 && !f.tds_ledger_id) return 'Choose the TDS ledger (or set it in System Control)';
    if (f.tds_percent < 0 || f.tds_amount < 0) return 'TDS cannot be negative';
    const details = (b.details || []).filter(d => d.ledger_id);
    const sideOf = d => (Number(d.debit_amount) || 0) - (Number(d.credit_amount) || 0);      // + debit
    const want = purchase ? -1 : 1;                                                        // party: Cr on purchase side, Dr on sales
    const tdsAmt = r2(details.filter(d => d.ledger_id === f.tds_ledger_id && f.tds_ledger_id).reduce((a, d) => a + sideOf(d), 0) * (purchase ? -1 : 1));
    if (f.tds_amount > 0 && Math.abs(tdsAmt - f.tds_amount) > 0.01) return `TDS ledger line (${tdsAmt.toFixed(2)}) must be ${purchase ? 'credited' : 'debited'} with the TDS ${f.tds_amount.toFixed(2)}`;
    const cls = await classifyLedgers(c, t, [...new Set(details.map(d => d.ledger_id))]);
    if (!allowed(cls[f.party_ledger_id], who === 'customer' ? 'customer' : 'supplier')) return `The ${who} must be a Balance Sheet (party) ledger`;
    if (T.tds) {
        const sales = f.tds_side === 'sales';
        const cat = await partyCategory(c, f.party_ledger_id);
        if (cat && !(sales ? ['sales', 'both'] : ['purchase', 'both']).includes(cat)) return `TDS on ${sales ? 'sales' : 'purchase'}: choose a ${sales ? 'customer' : 'supplier'} (or a ledger that is both)`;
        if (!(f.tds_amount > 0)) return 'Enter the TDS % or TDS amount';
        if (f.tds_amount > f.tds_base_amount && f.tds_base_amount > 0) return 'TDS cannot be more than its base amount';
        const partySide = r2(details.filter(d => d.ledger_id === f.party_ledger_id).reduce((a, d) => a + sideOf(d), 0));   // + debit
        const billMode = Array.isArray(b.tds_bills) && b.tds_bills.length > 0;
        if (billMode || sales) {
            // bills already booked: only the TDS moves - purchase Dr supplier, sales Cr customer
            if (!billMode && !(f.tds_base_amount > 0)) return 'Enter the amount TDS is worked on, or choose the bills';
            const want = sales ? -f.tds_amount : f.tds_amount;
            if (Math.abs(partySide - want) > 0.01) return `${sales ? 'Customer' : 'Supplier'} line must be ${sales ? 'credited' : 'debited'} with the TDS ${f.tds_amount.toFixed(2)} - now ${Math.abs(partySide).toFixed(2)}`;
            return null;
        }
        if (!(f.tds_base_amount > 0)) return 'Enter the amount TDS is worked on, or choose the bills';
        const net = r2(f.tds_base_amount - f.tds_amount);
        if (Math.abs(-partySide - net) > 0.01) return `Party line must be credited with ${net.toFixed(2)} (base less TDS) - now ${(-partySide).toFixed(2)}`;
        return null;
    }
    if (!(f.taxable_amount + f.non_taxable_amount > 0)) return 'Enter the taxable and / or non-taxable amount';
    if (f.vat_amount < 0 || f.taxable_amount < 0 || f.non_taxable_amount < 0) return 'Amounts cannot be negative';
    if (f.vat_amount > 0 && !(f.taxable_amount > 0)) return 'VAT needs a taxable amount';
    if (purchase && !f.party_bill_no) return "Enter the supplier's bill no";
    const total = r2(f.taxable_amount + f.non_taxable_amount + f.vat_amount);
    const partyAmt = r2(details.filter(d => d.ledger_id === f.party_ledger_id).reduce((a, d) => a + sideOf(d), 0) * want);
    const partyWant = r2(total - f.tds_amount);
    if (Math.abs(partyAmt - partyWant) > 0.01) return `${purchase ? 'Supplier' : 'Customer'} line must be ${purchase ? 'credited' : 'debited'} with ${partyWant.toFixed(2)} (bill total ${total.toFixed(2)}${f.tds_amount ? ` less TDS ${f.tds_amount.toFixed(2)}` : ''}) - now ${partyAmt.toFixed(2)}`;
    const vatIds = new Set(await allVatLedgerIds(c, t));
    const vatAmt = r2(details.filter(d => vatIds.has(d.ledger_id)).reduce((a, d) => a + sideOf(d), 0) * -want);
    if (Math.abs(vatAmt - f.vat_amount) > 0.01) return `VAT ledger lines (${vatAmt.toFixed(2)}) must equal the VAT amount ${f.vat_amount.toFixed(2)}`;
    for (const d of details) {
        if (d.ledger_id === f.party_ledger_id || d.ledger_id === f.tds_ledger_id || vatIds.has(d.ledger_id) || Math.sign(sideOf(d)) !== -want) continue;
        const x = cls[d.ledger_id];
        if (!T.purposes.some(p => allowed(x, p))) return `"${x?.name || 'Ledger'}" cannot be the ${T.label} account of this voucher - it is a ${x?.statement === 'pl' ? 'Profit & Loss' : 'Balance Sheet'} ledger under ${x?.group_name || 'its group'}`;
    }
    return null;
}
async function partyCategory(c, id) {
    const { data } = await c.from('ledger_accounts').select('category_type').eq('id', id).maybeSingle();
    return data && ['sales', 'purchase', 'both'].includes(data.category_type) ? data.category_type : null;
}
// TDS journal against bills: the chosen bills re-read and priced; their base / TDS
// become the voucher's (so the lines are checked against real figures)
async function resolveTdsBills(c, t, b, jvId = null) {
    if (jvTypeOf(b) !== 'tds' || !Array.isArray(b.tds_bills) || !b.tds_bills.length) return { bills: [] };
    const side = b.tds_side === 'sales' ? 'sales' : 'purchase';
    const r = await jvTdsBills.checkBills(c, t, side, b.party_ledger_id, b.tds_bills, b.tds_percent, jvId);
    if (r.error) return r;
    return { bills: r.bills, fields: { tds_base_amount: r.base, tds_amount: r.tds, tds_bills: r.bills } };
}
async function partySnapshot(c, f) {
    if (!f.party_ledger_id) return {};
    const { data } = await c.from('ledger_accounts').select('account_name, pan_number, vat_pan_number').eq('id', f.party_ledger_id).maybeSingle();
    return { party_name_snapshot: data?.account_name || null, party_pan: f.party_pan || data?.vat_pan_number || data?.pan_number || null };
}

function validateBody(b, isDraft) {
    if (!b.doc_date) return 'Date is required';
    if (isDraft) return null;
    if (!Array.isArray(b.details) || b.details.length < 2) return 'A Journal Voucher needs at least two lines';
    let totalDr = 0, totalCr = 0;
    for (const d of b.details) {
        if (!d.ledger_id) return 'Every line needs a Ledger';
        const dr = Number(d.debit_amount) || 0, cr = Number(d.credit_amount) || 0;
        if (dr > 0 && cr > 0) return 'A line cannot be both Debit and Credit';
        if (dr === 0 && cr === 0) return 'Every line needs either a Debit or a Credit amount';
        totalDr += dr; totalCr += cr;
    }
    if (Math.abs(totalDr - totalCr) > 0.01) return `Voucher does not balance - Debit ${totalDr.toFixed(2)} vs Credit ${totalCr.toFixed(2)}`;
    return null;
}

async function captureMasterSnapshots(tenantClient, b) {
    const lookups = [
        b.cost_center_id && tenantClient.from('cost_centers').select('cost_center_name').eq('id', b.cost_center_id).maybeSingle(),
        b.business_unit_id && tenantClient.from('business_units').select('unit_name').eq('id', b.business_unit_id).maybeSingle()
    ];
    const [costCenter, businessUnit] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        cost_center_name_snapshot: costCenter.data?.cost_center_name || null,
        business_unit_name_snapshot: businessUnit.data?.unit_name || null
    };
}

async function captureDetailSnapshots(tenantClient, d) {
    const lookups = [
        d.ledger_id && tenantClient.from('ledger_accounts').select('account_name').eq('id', d.ledger_id).maybeSingle(),
        d.sub_ledger_id && tenantClient.from('sub_ledgers').select('sub_ledger_name').eq('id', d.sub_ledger_id).maybeSingle(),
        d.agent_id && tenantClient.from('salesman_agents').select('agent_name').eq('id', d.agent_id).maybeSingle()
    ];
    const [ledger, subLedger, agent] = await Promise.all(lookups.map(l => l || Promise.resolve({ data: null })));
    return {
        ledger_name_snapshot: ledger.data?.account_name || null,
        sub_ledger_name_snapshot: subLedger.data?.sub_ledger_name || null,
        agent_name_snapshot: agent.data?.agent_name || null
    };
}

async function syncDetails(tenantClient, tenantId, jvId, details) {
    await tenantClient.from('journal_voucher_details').delete().eq('jv_id', jvId);
    if (!Array.isArray(details) || details.length === 0) return { totalDebit: 0, totalCredit: 0 };
    const rows = await Promise.all(details.map(async (d, i) => {
        const snapshots = await captureDetailSnapshots(tenantClient, d);
        const debit = Number(d.debit_amount) || 0, credit = Number(d.credit_amount) || 0;
        return {
            tenant_id: tenantId, jv_id: jvId, display_order: i + 1,
            ledger_id: d.ledger_id, sub_ledger_id: d.sub_ledger_id || null, product_company_id: d.product_company_id || null, agent_id: d.agent_id || null,
            debit_amount: debit, credit_amount: credit, tds_percent: d.tds_percent || null,
            narration: d.narration || null,
            cost_center_id: d.cost_center_id || null, business_unit_id: d.business_unit_id || null,
            ...snapshots
        };
    }));
    const { error } = await tenantClient.from('journal_voucher_details').insert(rows);
    if (error) throw error;
    return {
        totalDebit: rows.reduce((s, r) => s + Number(r.debit_amount), 0),
        totalCredit: rows.reduce((s, r) => s + Number(r.credit_amount), 0)
    };
}

async function logDocumentAudit(tenantClient, tenantId, documentType, documentId, action, userId) {
    const { error } = await tenantClient.from('document_audit_trail').insert({ tenant_id: tenantId, document_type: documentType, document_id: documentId, action, performed_by: userId });
    if (error) console.error('document_audit_trail insert failed:', error.message);
}

async function postJvToLedger(tenantClient, tenantId, jv, details, userId) {
    const { data: batch, error } = await tenantClient
        .from('ledger_transaction_batches')
        .insert({ tenant_id: tenantId, document_type: 'journal_voucher', document_id: jv.id, batch_date: jv.doc_date, narration: jv.narration || `JV ${jv.doc_no}`, created_by: userId })
        .select().single();
    if (error) throw error;
    const rows = details.map(d => ({
        tenant_id: tenantId, batch_id: batch.id, ledger_account_id: d.ledger_id, sub_ledger_id: d.sub_ledger_id || null, product_company_id: d.product_company_id || null,
        debit_amount: d.debit_amount || 0, credit_amount: d.credit_amount || 0, narration: d.narration || jv.narration
    }));
    const { error: lineErr } = await tenantClient.from('ledger_transaction_lines').insert(rows);
    if (lineErr) throw lineErr;
}

async function reverseJvLedgerBatch(tenantClient, jvId) {
    const { data: batches } = await tenantClient.from('ledger_transaction_batches').select('id').eq('document_type', 'journal_voucher').eq('document_id', jvId);
    for (const b of (batches || [])) {
        await tenantClient.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await tenantClient.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}

router.get('/journal-vouchers', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('journal_vouchers').select('*').eq('tenant_id', req.auth.tenantId).order('doc_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// TDS journal: the party's bills still open for TDS (newest first)
router.get('/journal-vouchers/tds-bills', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const data = await jvTdsBills.listBills(tenantClient, req.auth.tenantId, req.query.side === 'sales' ? 'sales' : 'purchase', req.query.party_id, req.query.jv_id || null);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/journal-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient.from('journal_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', req.auth.tenantId).single();
        if (error) return res.status(404).json({ success: false, error: 'Journal Voucher not found' });
        const { data: details } = await tenantClient.from('journal_voucher_details').select('*').eq('jv_id', req.params.id).order('display_order');
        data.details = details || [];
        const { data: tdsBillRows } = await tenantClient.from('jv_tds_bills').select('*').eq('jv_id', req.params.id);
        data.tds_bills = (tdsBillRows || []).map(x => ({ source_type: x.source_type, source_id: x.source_id, doc_no: x.source_doc_no, doc_date: x.source_date, label: jvTdsBills.LABEL[x.source_type],
            bill_amount: Number(x.bill_amount), base_amount: Number(x.base_amount), tds_percent: Number(x.tds_percent), tds_amount: Number(x.tds_amount) }));
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/journal-vouchers', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const isDraft = req.body.status === 'draft' && req.body.save_as_draft === true;
        const tdsBills = await resolveTdsBills(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.body);
        if (tdsBills.error) return res.status(400).json({ success: false, error: tdsBills.error });
        Object.assign(req.body, tdsBills.fields || {});
        const validationError = validateBody(req.body, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'journal', req.body, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const taxError = await checkJvTax(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.body, isDraft);
        if (taxError) return res.status(400).json({ success: false, error: taxError });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;

        const { data: currentUser } = await tenantClient.from('users').select('default_branch_id').eq('id', req.auth.userId).single();
        let branchNameSnapshot = null;
        if (currentUser?.default_branch_id) {
            const { data: branch } = await tenantClient.from('branches').select('branch_name').eq('id', currentUser.default_branch_id).maybeSingle();
            branchNameSnapshot = branch?.branch_name || null;
        }
        const { data: currentFy } = await tenantClient.from('fiscal_years').select('id, fiscal_year_name').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();

        let docNo;
        try {
            docNo = await resolveDocumentNumber(tenantClient, {
                tenantId, voucherType: 'journal', userId: req.auth.userId,
                categoryId: b.numbering_category_id, manualNumber: b.doc_no, docDate: b.doc_date || b.voucher_date || b.entry_date, tableName: 'journal_vouchers',
                currentFiscalYearId: currentFy?.id, currentFiscalYearName: currentFy?.fiscal_year_name,
                userDefaultBranchId: currentUser?.default_branch_id
            });
        } catch (numErr) {
            return res.status(400).json({ success: false, error: numErr.message });
        }
        if (!docNo) {
            const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_master_code', { seq_name: 'tenant_master.seq_journal_voucher_code', type_prefix: 'JV' });
            if (codeErr) throw codeErr;
            docNo = codeRow;
        }

        const snapshots = await captureMasterSnapshots(tenantClient, b);

        const { data: doc, error } = await tenantClient
            .from('journal_vouchers')
            .insert({
                tenant_id: tenantId, branch_id: currentUser?.default_branch_id || null, branch_name_snapshot: branchNameSnapshot,
                doc_no: docNo, doc_date: b.doc_date, fiscal_year_id: currentFy?.id || null,
                ref_doc_no: b.ref_doc_no || null, ref_doc_date: b.ref_doc_date || null,
                cost_center_id: b.cost_center_id || null, business_unit_id: b.business_unit_id || null,
                remarks_id: b.remarks_id || null, remarks_text: b.remarks_text || null, narration: b.narration || null,
                is_memo: !!b.is_memo,
                ...snapshots,
                ...(await withTdsLedger(tenantClient, tenantId, taxFields(b))), ...(await partySnapshot(tenantClient, taxFields(b))),
                status: b.status || 'draft', created_by: req.auth.userId, updated_by: req.auth.userId
            })
            .select().single();
        if (error) throw error;

        try {
            const detailsToSave = Array.isArray(b.details) ? b.details : [];
            const { totalDebit, totalCredit } = await syncDetails(tenantClient, tenantId, doc.id, detailsToSave);
            await tenantClient.from('journal_vouchers').update({ total_debit: totalDebit, total_credit: totalCredit }).eq('id', doc.id);
            await jvTdsBills.syncBills(tenantClient, tenantId, doc.id, doc.party_ledger_id, tdsBills.bills);
        } catch (syncErr) {
            await tenantClient.from('journal_voucher_details').delete().eq('jv_id', doc.id);
            await tenantClient.from('jv_tds_bills').delete().eq('jv_id', doc.id);
            await tenantClient.from('journal_vouchers').delete().eq('id', doc.id);
            return res.status(400).json({ success: false, error: syncErr.message || 'Could not save voucher lines' });
        }

        await logAudit(tenantId, req.auth.userId, 'create_journal_voucher', 'journal_voucher', doc.id, { doc_no: doc.doc_no });
        await logDocumentAudit(tenantClient, tenantId, 'journal_voucher', doc.id, 'create', req.auth.userId);
        res.json({ success: true, message: `Journal Voucher ${doc.doc_no} created`, data: doc });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/journal-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const b = req.body;
        const { data: existing } = await tenantClient.from('journal_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Journal Voucher not found' });
        if (existing.audit_locked) return res.status(400).json({ success: false, error: 'This voucher is audit-locked and cannot be edited' });
        if (['posted', 'cancelled'].includes(existing.status)) {
            return res.status(400).json({ success: false, error: `Cannot edit a ${existing.status} voucher` });
        }

        const isDraft = b.status === 'draft' && b.save_as_draft === true;
        const tdsBills = await resolveTdsBills(tenantClient, tenantId, b, req.params.id);
        if (tdsBills.error) return res.status(400).json({ success: false, error: tdsBills.error });
        Object.assign(b, tdsBills.fields || {});
        const validationError = validateBody(b, isDraft);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const fieldError = await checkCompulsoryFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'journal', b, isDraft);
        if (fieldError) return res.status(400).json({ success: false, error: fieldError });
        const taxError = await checkJvTax(tenantClient, tenantId, b, isDraft);
        if (taxError) return res.status(400).json({ success: false, error: taxError });
        // Readonly / disabled header fields keep their stored value (before snapshots + update).
        await lockProtectedFields(await getTenantClient(req.auth.tenantId), req.auth.tenantId, req.auth.userId, 'journal', b, existing);

        const snapshots = (b.cost_center_id || b.business_unit_id) ? await captureMasterSnapshots(tenantClient, b) : {};        const update = { ...b, ...snapshots, ...(b.tax_entry_type !== undefined || b.jv_type !== undefined ? { ...(await withTdsLedger(tenantClient, tenantId, taxFields(b))), ...(await partySnapshot(tenantClient, taxFields(b))) } : {}), updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        delete update.branch_id;
        delete update.details;
        delete update.save_as_draft;
        delete update.tds_bills;

        const { data, error } = await tenantClient.from('journal_vouchers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (b.details) {
            const { totalDebit, totalCredit } = await syncDetails(tenantClient, tenantId, req.params.id, b.details);
            await tenantClient.from('journal_vouchers').update({ total_debit: totalDebit, total_credit: totalCredit }).eq('id', req.params.id);
        }
        if (b.tds_bills !== undefined || b.jv_type !== undefined) await jvTdsBills.syncBills(tenantClient, tenantId, req.params.id, data.party_ledger_id, data.jv_type === 'tds' ? tdsBills.bills : []);

        await logAudit(tenantId, req.auth.userId, 'update_journal_voucher', 'journal_voucher', req.params.id, { old_data: existing, new_data: data });
        await logDocumentAudit(tenantClient, tenantId, 'journal_voucher', req.params.id, 'update', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/journal-vouchers/:id/status', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { status, cancellation_reason } = req.body;
        if (!['draft', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
        if (status === 'cancelled' && !cancellation_reason) return res.status(400).json({ success: false, error: 'A cancellation reason is required' });

        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('journal_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Journal Voucher not found' });
        if (existing.audit_locked) return res.status(400).json({ success: false, error: 'This voucher is audit-locked' });
        if (existing.is_memo && status === 'posted') return res.status(400).json({ success: false, error: 'A Memo voucher is never posted to the ledger' });

        if (status === 'posted' && existing.status !== 'posted') {
            const { data: existingDetails } = await tenantClient.from('journal_voucher_details').select('*').eq('jv_id', req.params.id);
            const bodyErr = validateBody({ ...existing, details: existingDetails || [] }, false);
            if (bodyErr) return res.status(400).json({ success: false, error: bodyErr });
            const { data: billRows } = await tenantClient.from('jv_tds_bills').select('*').eq('jv_id', req.params.id);
            const chosen = (billRows || []).map(x => ({ source_type: x.source_type, source_id: x.source_id, doc_no: x.source_doc_no, tds_percent: x.tds_percent }));
            if (chosen.length) {
                const chk = await jvTdsBills.checkBills(tenantClient, tenantId, existing.tds_side || 'purchase', existing.party_ledger_id, chosen, existing.tds_percent, req.params.id);
                if (chk.error) return res.status(400).json({ success: false, error: chk.error });
            }
            const taxErr = await checkJvTax(tenantClient, tenantId, { ...existing, details: existingDetails || [], tds_bills: chosen }, false);
            if (taxErr) return res.status(400).json({ success: false, error: taxErr });
        }

        const update = { status, updated_by: req.auth.userId };
        if (status === 'cancelled') {
            update.cancellation_reason = cancellation_reason;
            update.cancelled_at = new Date().toISOString();
            update.cancelled_by = req.auth.userId;
        }
        if (status === 'posted') {
            update.posted_by = req.auth.userId;
            update.posted_at = new Date().toISOString();
        }
        const { data, error } = await tenantClient.from('journal_vouchers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;

        if (status === 'posted' && existing.status !== 'posted') {
            const { data: details } = await tenantClient.from('journal_voucher_details').select('*').eq('jv_id', req.params.id);
            await postJvToLedger(tenantClient, tenantId, data, details || [], req.auth.userId);
        } else if (status === 'cancelled' && existing.status === 'posted') {
            await reverseJvLedgerBatch(tenantClient, req.params.id);
            if (existing.jv_type === 'balance_writeoff') await require('../utils/balanceWriteoff').reverseWriteoffSettlements(tenantClient, req.params.id);
        }

        await logAudit(tenantId, req.auth.userId, 'change_jv_status', 'journal_voucher', req.params.id, { new_status: status, cancellation_reason });
        await logDocumentAudit(tenantClient, tenantId, 'journal_voucher', req.params.id, 'status_change', req.auth.userId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/journal-vouchers/:id/audit-lock', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const { locked } = req.body;
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const update = locked
            ? { audit_locked: true, audit_locked_by: req.auth.userId, audit_locked_at: new Date().toISOString() }
            : { audit_locked: false, audit_locked_by: null, audit_locked_at: null };
        const { data, error } = await tenantClient.from('journal_vouchers').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, locked ? 'audit_lock_jv' : 'audit_unlock_jv', 'journal_voucher', req.params.id, {});
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/journal-vouchers/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('journal_vouchers').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Journal Voucher not found' });
        if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only a Draft can be deleted - use Cancel for a posted voucher' });
        const { error } = await tenantClient.from('journal_vouchers').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_draft_jv', 'journal_voucher', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Draft deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/journal-vouchers/:id/audit-trail', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('document_audit_trail').select('*, performer:performed_by(full_name)')
            .eq('tenant_id', req.auth.tenantId).eq('document_type', 'journal_voucher').eq('document_id', req.params.id)
            .order('performed_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
module.exports.checkJvTax = checkJvTax;
module.exports.taxFields = taxFields;
module.exports.JV_TYPES = JV_TYPES;
