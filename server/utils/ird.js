// =============================================
// utils/ird.js
// IRD (Nepal) e-billing:
//   * Materialized sales register - ird_sales_materialized, kept by the
//     database triggers of migration 118 (one row per posted / cancelled
//     sales bill or sales return); here we only read it, fill the BS date /
//     fiscal year text and report it in the IRD column layout.
//   * CBMS push - POST {api}/api/bill and {api}/api/billreturn with the
//     seller's CBMS credentials. Every attempt is written to ird_sync_log;
//     failures stay in the queue and are retried (manually or on the next
//     posting) up to max_attempts.
//   CBMS response codes: 200 saved, 100 credentials do not match, 101 bill
//   already exists, 102 exception while saving, 103 unknown exception,
//   104 model invalid, 105 bill does not exist (return of an unknown bill).
// =============================================
const { nepaliDateConverter } = require('./nepaliDateUtils');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const RESPONSE = {
    200: 'Saved in CBMS', 100: 'API credentials do not match', 101: 'Bill already exists in CBMS', 102: 'Exception while saving bill details',
    103: 'Unknown exception', 104: 'Model invalid (check the fields)', 105: 'Bill does not exist (for sales return)'
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
const missingTable = e => /ird_|relation .* does not exist|Could not find the table/i.test(e?.message || '');
const guard = async p => { try { return await p; } catch (e) { if (missingTable(e)) throw httpError('IRD tables are missing - run database migration 118 first', 400); throw e; } };

// BS date "YYYY.MM.DD" and IRD fiscal year "2081.082" for an AD date.
function bsOf(ad) {
    const n = nepaliDateConverter.toNepali(String(ad).slice(0, 10));
    if (!n) return { bs: null, fy: null };
    const p = x => String(x).padStart(2, '0');
    const start = n.month >= 4 ? n.year : n.year - 1;
    return { bs: `${n.year}.${p(n.month)}.${p(n.day)}`, fy: `${start}.${String(start + 1).slice(-3)}` };
}

async function settings(c, t) {
    const { data, error } = await c.from('ird_settings').select('*').eq('tenant_id', t).maybeSingle();
    if (error && missingTable(error)) throw httpError('IRD tables are missing - run database migration 118 first', 400);
    return data || { tenant_id: t, enabled: false, api_base_url: 'https://cbapi.ird.gov.np', is_realtime: true, auto_sync_on_post: true, max_attempts: 5 };
}
async function saveSettings(c, t, userId, b) {
    const row = { tenant_id: t, enabled: !!b.enabled, api_base_url: String(b.api_base_url || 'https://cbapi.ird.gov.np').replace(/\/+$/, ''), username: b.username || null,
        seller_pan: b.seller_pan || null, is_realtime: b.is_realtime !== false, auto_sync_on_post: b.auto_sync_on_post !== false,
        max_attempts: Math.min(Math.max(Number(b.max_attempts) || 5, 1), 50), updated_by: userId, updated_at: new Date().toISOString() };
    if (b.password) row.password = b.password;                  // blank keeps the stored password
    const { data: existing } = await c.from('ird_settings').select('tenant_id').eq('tenant_id', t).maybeSingle();
    const { error } = existing ? await c.from('ird_settings').update(row).eq('tenant_id', t) : await c.from('ird_settings').insert(row);
    if (error) throw error;
    const s = await settings(c, t);
    return { ...s, password: s.password ? '********' : '' };
}

// Rows of the materialized register (BS date / FY filled and persisted when missing).
async function materialized(c, t, q = {}) {
    const rows = await guard(fetchAll(() => {
        let x = c.from('ird_sales_materialized').select('*').eq('tenant_id', t);
        if (q.date_from) x = x.gte('bill_date', q.date_from);
        if (q.date_to) x = x.lte('bill_date', q.date_to);
        if (q.doc_type) x = x.eq('doc_type', q.doc_type);
        if (q.sync === 'synced') x = x.eq('sync_with_ird', true);
        if (q.sync === 'not_synced') x = x.eq('sync_with_ird', false);
        if (q.active === 'active') x = x.eq('is_bill_active', true);
        if (q.active === 'cancelled') x = x.eq('is_bill_active', false);
        return x.order('bill_date').order('bill_no');
    }));
    const fill = rows.filter(r => !r.bill_date_bs || !r.fiscal_year);
    for (const r of fill) {
        const { bs, fy } = bsOf(r.bill_date);
        r.bill_date_bs = bs; r.fiscal_year = fy;
        await c.from('ird_sales_materialized').update({ bill_date_bs: bs, fiscal_year: fy }).eq('id', r.id);
    }
    return rows;
}

// The IRD "materialized view" columns.
async function materializedReport(c, t, q) {
    const rows = (await materialized(c, t, q)).map(r => ({
        id: r.id, doc_type: r.doc_type, source_id: r.source_id, Fiscal_Year: r.fiscal_year, Bill_no: r.bill_no, Ref_Bill_no: r.ref_bill_no || '', Customer_name: r.customer_name, Customer_pan: r.customer_pan || '',
        Bill_Date: String(r.bill_date).slice(0, 10), Bill_Date_BS: r.bill_date_bs, Amount: round2(r.amount), Discount: round2(r.discount), Taxable_Amount: round2(r.taxable_amount),
        Non_Taxable_Amount: round2(r.non_taxable_amount), Tax_Amount: round2(r.tax_amount), Total_Amount: round2(r.total_amount), Sync_with_IRD: !!r.sync_with_ird,
        IS_Bill_Printed: !!r.is_bill_printed, Print_Count: r.print_count || 0, Is_Bill_Active: !!r.is_bill_active, Printed_Time: r.printed_time, Entered_By: r.entered_by,
        Printed_By: r.printed_by, Is_realtime: !!r.is_realtime, Payment_Method: r.payment_method || '', VAT_Refund_Amount: round2(r.vat_refund_amount), Transaction_Id: r.transaction_id || '',
        Return_Reason: r.return_reason || '', Cancel_Reason: r.cancel_reason || ''
    }));
    const users = [...new Set(rows.flatMap(r => [r.Entered_By, r.Printed_By]).filter(Boolean))];
    if (users.length) {
        const { data } = await c.from('users').select('id, full_name').in('id', users);
        const N = Object.fromEntries((data || []).map(u => [u.id, u.full_name]));
        rows.forEach(r => { r.Entered_By = N[r.Entered_By] || r.Entered_By || ''; r.Printed_By = N[r.Printed_By] || r.Printed_By || ''; });
    }
    const sign = r => (r.doc_type === 'sales_return' ? -1 : 1);
    const tot = k => round2(rows.filter(r => r.Is_Bill_Active).reduce((s, r) => s + sign(r) * r[k], 0));
    return { rows, totals: { Amount: tot('Amount'), Discount: tot('Discount'), Taxable_Amount: tot('Taxable_Amount'), Non_Taxable_Amount: tot('Non_Taxable_Amount'), Tax_Amount: tot('Tax_Amount'), Total_Amount: tot('Total_Amount') },
        counts: { bills: rows.filter(r => r.doc_type === 'sales_bill').length, returns: rows.filter(r => r.doc_type === 'sales_return').length, cancelled: rows.filter(r => !r.Is_Bill_Active).length,
            not_synced: rows.filter(r => !r.Sync_with_IRD && r.Is_Bill_Active).length, not_printed: rows.filter(r => !r.IS_Bill_Printed && r.Is_Bill_Active).length } };
}

// IRD Sales Book (Annex 13 style): date, bill no, buyer, PAN, total, non-taxable, export, taxable, VAT.
async function salesBook(c, t, q) {
    const rows = (await materialized(c, t, { ...q, active: 'active' })).map(r => {
        const s = r.doc_type === 'sales_return' ? -1 : 1;
        return { date: String(r.bill_date).slice(0, 10), date_bs: r.bill_date_bs, bill_no: r.bill_no, ref_bill_no: r.ref_bill_no || '', type: r.doc_type === 'sales_return' ? 'Return' : 'Sales',
            buyer: r.customer_name, pan: r.customer_pan || '', total: round2(s * r.total_amount), non_taxable: round2(s * r.non_taxable_amount), export: 0,
            taxable: round2(s * r.taxable_amount), vat: round2(s * r.tax_amount) };
    });
    const tot = k => round2(rows.reduce((s, r) => s + r[k], 0));
    return { rows, totals: { total: tot('total'), non_taxable: tot('non_taxable'), export: 0, taxable: tot('taxable'), vat: tot('vat') } };
}

async function auditLog(c, t, q) {
    const rows = await guard(fetchAll(() => {
        let x = c.from('ird_bill_audit_log').select('*').eq('tenant_id', t);
        if (q.date_from) x = x.gte('performed_at', `${q.date_from}T00:00:00`);
        if (q.date_to) x = x.lte('performed_at', `${q.date_to}T23:59:59`);
        if (q.action) x = x.eq('action', q.action);
        return x.order('performed_at', { ascending: false });
    }));
    const users = [...new Set(rows.map(r => r.performed_by).filter(Boolean))];
    const { data } = users.length ? await c.from('users').select('id, full_name').in('id', users) : { data: [] };
    const N = Object.fromEntries((data || []).map(u => [u.id, u.full_name]));
    // bill no for print rows (the print trigger does not know it)
    const need = [...new Set(rows.filter(r => !r.bill_no).map(r => r.source_id))];
    const { data: mats } = need.length ? await c.from('ird_sales_materialized').select('source_id, bill_no').in('source_id', need) : { data: [] };
    const B = Object.fromEntries((mats || []).map(m => [m.source_id, m.bill_no]));
    return rows.map(r => ({ ...r, bill_no: r.bill_no || B[r.source_id] || '', user: N[r.performed_by] || '' }));
}

async function syncLog(c, t, q) {
    return guard(fetchAll(() => {
        let x = c.from('ird_sync_log').select('id, doc_type, source_id, bill_no, status, attempts, response_code, response_message, last_attempt_at, synced_at, created_at').eq('tenant_id', t);
        if (q.status) x = x.eq('status', q.status);
        return x.order('created_at', { ascending: false });
    }));
}

function buildPayload(s, r, ret) {
    const base = {
        username: s.username, password: s.password, seller_pan: s.seller_pan, buyer_pan: r.customer_pan || '', buyer_name: r.customer_name || '',
        fiscal_year: r.fiscal_year, total_sales: round2(r.total_amount), taxable_sales_vat: round2(r.taxable_amount), vat: round2(r.tax_amount),
        excisable_amount: 0, excise: 0, taxable_sales_hst: 0, hst: 0, amount_for_esf: 0, esf: 0, export_sales: 0, tax_exempted_sales: round2(r.non_taxable_amount),
        isrealtime: !!s.is_realtime, datetimeClient: new Date().toISOString().replace('T', ' ').slice(0, 19)
    };
    if (!ret) return { ...base, invoice_number: r.bill_no, invoice_date: r.bill_date_bs };
    return { ...base, ref_invoice_number: r.ref_bill_no || '', credit_note_number: r.bill_no, credit_note_date: r.bill_date_bs, reason_for_return: r.return_reason || 'Sales return' };
}

// Push one document to CBMS. `fetchImpl` is injectable for tests.
async function pushOne(c, t, docType, sourceId, { fetchImpl = globalThis.fetch, force = false } = {}) {
    const s = await settings(c, t);
    if (!s.enabled) throw httpError('CBMS sync is not enabled - fill IRD Settings first');
    if (!s.username || !s.password || !s.seller_pan) throw httpError('CBMS username, password and seller PAN are required in IRD Settings');
    const [r] = await materialized(c, t, { doc_type: docType }).then(rows => rows.filter(x => x.source_id === sourceId));
    if (!r) throw httpError('Document is not in the IRD register (only posted documents are)', 404);
    const { data: logRow } = await c.from('ird_sync_log').select('*').eq('doc_type', docType).eq('source_id', sourceId).maybeSingle();
    if (r.sync_with_ird && !force) return { status: 'success', code: '200', message: 'Already synced' };
    if (logRow && logRow.attempts >= s.max_attempts && !force) return { status: 'failed', code: logRow.response_code, message: `Stopped after ${logRow.attempts} attempts - use Retry` };
    if (!r.is_bill_active && docType === 'sales_bill' && !r.sync_with_ird) {
        await upsertLog(c, t, r, { status: 'skipped', response_message: 'Cancelled before sync', attempts: logRow?.attempts || 0 });
        return { status: 'skipped', message: 'Cancelled before sync' };
    }
    const ret = docType === 'sales_return';
    const payload = buildPayload(s, r, ret);
    const url = `${String(s.api_base_url || 'https://cbapi.ird.gov.np').replace(/\/+$/, '')}/api/${ret ? 'billreturn' : 'bill'}`;
    let code = null, message = null;
    try {
        const resp = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const text = await resp.text();
        const n = Number(String(text).trim().replace(/^"|"$/g, ''));
        code = Number.isFinite(n) && String(text).trim() !== '' ? String(n) : String(resp.status);
        message = RESPONSE[code] || String(text).slice(0, 300);
    } catch (e) { code = 'NET'; message = `Network error: ${e.message}`; }
    const ok = code === '200' || code === '101';
    const safe = { ...payload, password: '********' };
    await upsertLog(c, t, r, { status: ok ? 'success' : 'failed', attempts: (logRow?.attempts || 0) + 1, response_code: code, response_message: message, request_payload: safe, synced_at: ok ? new Date().toISOString() : null });
    if (ok) await c.from('ird_sales_materialized').update({ sync_with_ird: true, is_realtime: !!s.is_realtime, updated_at: new Date().toISOString() }).eq('id', r.id);
    return { status: ok ? 'success' : 'failed', code, message };
}
async function upsertLog(c, t, r, fields) {
    const row = { tenant_id: t, doc_type: r.doc_type, source_id: r.source_id, bill_no: r.bill_no, last_attempt_at: new Date().toISOString(), ...fields };
    const { data: ex } = await c.from('ird_sync_log').select('id').eq('doc_type', r.doc_type).eq('source_id', r.source_id).maybeSingle();
    const { error } = ex ? await c.from('ird_sync_log').update(row).eq('id', ex.id) : await c.from('ird_sync_log').insert(row);
    if (error) throw error;
}

// Push everything not yet synced (bills before returns, oldest first).
async function syncPending(c, t, { limit = 200, fetchImpl, force = false } = {}) {
    const s = await settings(c, t);
    if (!s.enabled) throw httpError('CBMS sync is not enabled');
    const rows = (await materialized(c, t, { sync: 'not_synced' })).sort((a, b) => (a.doc_type === b.doc_type ? 0 : a.doc_type === 'sales_bill' ? -1 : 1) || String(a.bill_date).localeCompare(String(b.bill_date)));
    const out = [];
    for (const r of rows.slice(0, limit)) {
        try { out.push({ bill_no: r.bill_no, doc_type: r.doc_type, ...(await pushOne(c, t, r.doc_type, r.source_id, { fetchImpl, force })) }); }
        catch (e) { out.push({ bill_no: r.bill_no, doc_type: r.doc_type, status: 'failed', message: e.message }); }
    }
    return { attempted: out.length, success: out.filter(x => x.status === 'success').length, failed: out.filter(x => x.status === 'failed').length, results: out };
}

// Called after a sales bill / return is posted: never blocks or fails the posting.
function autoSync(c, t, docType, sourceId) {
    (async () => {
        try {
            const s = await settings(c, t);
            if (s.enabled && s.auto_sync_on_post) await pushOne(c, t, docType, sourceId);
        } catch (e) { console.error('IRD auto sync:', e.message); }
    })();
}

async function printInfo(c, t, docType, sourceId) {
    try {
        const { data } = await c.from('ird_sales_materialized').select('print_count, is_bill_printed, is_bill_active').eq('doc_type', docType).eq('source_id', sourceId).maybeSingle();
        return data ? { print_count: data.print_count || 0, is_active: data.is_bill_active } : { print_count: 0, is_active: true };
    } catch { return { print_count: 0, is_active: true }; }
}

module.exports = { settings, saveSettings, materializedReport, salesBook, auditLog, syncLog, pushOne, syncPending, autoSync, printInfo, buildPayload, bsOf, RESPONSE };
