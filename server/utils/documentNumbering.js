// =============================================
// utils/documentNumbering.js
// Resolves a document number for any voucher type using the tenant's
// configured Document Numbering Category (Manual/Auto, Global/Branch-
// wise/User-wise, Prefix/Suffix/Digits/Start-End/FY) - shared by every
// document type in the purchase (and later sales) chain.
// =============================================

function formatFiscalYearPart(fiscalYearName, fyDigitFormat) {
    if (!fiscalYearName) return '';
    const digitsOnly = fiscalYearName.replace(/[^0-9]/g, '');
    return fyDigitFormat === 'full' ? digitsOnly : digitsOnly.slice(-4);
}

// Numbering modes: auto (automatic numeric), manual_numeric, manual_alpha (old 'manual'),
// auto_datewise (restarts each day), auto_monthwise (restarts each month).
const isManual = m => m === 'manual' || m === 'manual_alpha' || m === 'manual_numeric';
const today = () => new Date().toISOString().slice(0, 10);
const inRange = (c, d) => (!c.valid_from || String(c.valid_from).slice(0, 10) <= d) && (!c.valid_to || String(c.valid_to).slice(0, 10) >= d);

// The numbering category an entry uses: the one chosen on the entry, else the default
// one of the voucher type, else (none marked default) its first active one - only
// series whose date range (valid from / to) covers the entry date.
async function pickCategory(tenantClient, tenantId, voucherType, categoryId, docDate) {
    const d = String(docDate || today()).slice(0, 10);
    const base = () => tenantClient.from('document_numbering_categories').select('*').eq('tenant_id', tenantId).eq('voucher_type', voucherType).eq('is_active', true);
    if (categoryId) {
        const c = (await base().eq('id', categoryId).maybeSingle()).data || null;
        if (c && !inRange(c, d)) throw new Error(`Numbering "${c.category_name}" is not valid on ${d}`);
        return c;
    }
    const { data: all } = await base();
    const live = (all || []).filter(c => inRange(c, d));
    return live.find(c => c.is_default) || live.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null;
}

/** date part and counter period of a datewise / monthwise series, in Nepali or English dates */
function datePart(category, docDate) {
    const mode = category.numbering_mode;
    if (mode !== 'auto_datewise' && mode !== 'auto_monthwise') return { text: '', period: '' };
    const ad = String(docDate || today()).slice(0, 10);
    let y, m, dd;
    if (category.date_type === 'english') { [y, m, dd] = ad.split('-').map(Number); }
    else {
        const { nepaliDateConverter } = require('./nepaliDateUtils');
        const bs = nepaliDateConverter.toNepali(ad) || {};
        y = bs.year; m = bs.month; dd = bs.day;
        if (!y) { [y, m, dd] = ad.split('-').map(Number); }
    }
    const p2 = n => String(n).padStart(2, '0');
    const parts = { YYYY: String(y), YY: String(y).slice(-2), MM: p2(m), DD: p2(dd) };
    let fmt = category.date_format || (mode === 'auto_monthwise' ? 'YYMM' : 'YYMMDD');
    // a monthwise series never shows the day
    if (mode === 'auto_monthwise') fmt = fmt.replace('DD', '');
    const text = fmt.replace(/YYYY|YY|MM|DD/g, t => parts[t]);
    return { text, period: mode === 'auto_monthwise' ? `${y}-${p2(m)}` : `${y}${p2(m)}${p2(dd)}` };
}

/** prefix + fiscal year + date part + body (padded with the fill character) + suffix, within the max length */
function buildNumber(category, seq, fyPart, dp) {
    const fill = (category.fill_char || '0').slice(0, 1) || '0';
    const body = String(seq).padStart(Number(category.digit_count) || 6, fill);
    const out = `${category.prefix || ''}${fyPart}${dp}${body}${category.suffix || ''}`;
    const max = Number(category.max_length) || 0;
    if (max && out.length > max && !category.flexible_length) throw new Error(`Document number ${out} is longer than the ${max} characters allowed for "${category.category_name}"`);
    return out;
}

// Returns the final formatted document number string, e.g. "PREQ-8182-000042-A".
// Throws a plain Error with a user-facing message on failure (manual mode with no
// number, a manual-numeric number with letters, duplicate manual number, series not
// valid on the date, range exhausted, or too long) so route handlers catch-and-respond.
async function resolveDocumentNumber(tenantClient, { tenantId, voucherType, userId, categoryId, manualNumber, tableName, currentFiscalYearId, currentFiscalYearName, userDefaultBranchId, docDate }) {
    const category = await pickCategory(tenantClient, tenantId, voucherType, categoryId, docDate);

    // no category configured yet for this voucher type - the plain system series applies
    if (!category) return null;

    if (isManual(category.numbering_mode)) {
        const n = String(manualNumber || '').trim();
        if (!n) throw new Error('Document Number is required (this category is set to Manual numbering)');
        if (category.numbering_mode === 'manual_numeric' && !/^[0-9]+$/.test(n)) throw new Error('Document Number must be digits only (Manual - Numeric)');
        const max = Number(category.max_length) || 0;
        if (max && n.length > max && !category.flexible_length) throw new Error(`Document Number can be at most ${max} characters`);
        const { data: dup } = await tenantClient.from(tableName).select('id').eq('tenant_id', tenantId).eq('doc_no', n).maybeSingle();
        if (dup) throw new Error('This Document Number is already used');
        return n;
    }

    const branchId = category.scope === 'branch_wise' ? (userDefaultBranchId || null) : null;
    const userIdForScope = category.scope === 'user_wise' ? userId : null;
    const fyIdForScope = category.include_fiscal_year ? (currentFiscalYearId || null) : null;
    const dp = datePart(category, docDate);

    const { data: seqNumber, error } = await tenantClient.rpc('next_document_number_p', {
        p_tenant_id: tenantId, p_category_id: category.id, p_branch_id: branchId, p_user_id: userIdForScope, p_fiscal_year_id: fyIdForScope, p_period_key: dp.period
    });
    if (error) throw new Error(error.message);

    const fyPart = category.include_fiscal_year ? formatFiscalYearPart(currentFiscalYearName, category.fy_digit_format) : '';
    return buildNumber(category, seqNumber, fyPart, dp.text);
}

/**
 * The number the next document of this type will get - shown read-only on
 * a new entry. Reads the counter only (nothing is used up). null = no
 * numbering category (the plain system series applies), manual = user types it.
 */
async function previewDocumentNumber(tenantClient, { tenantId, voucherType, userId, categoryId, currentFiscalYearId, currentFiscalYearName, userDefaultBranchId, docDate }) {
    let category;
    try { category = await pickCategory(tenantClient, tenantId, voucherType, categoryId, docDate); } catch (e) { return { number: null, mode: 'invalid', error: e.message }; }
    if (!category) return { number: null, mode: 'system' };
    if (isManual(category.numbering_mode)) return { number: null, mode: 'manual', numeric: category.numbering_mode === 'manual_numeric', category_id: category.id };
    const branchId = category.scope === 'branch_wise' ? (userDefaultBranchId || null) : null;
    const userIdForScope = category.scope === 'user_wise' ? userId : null;
    const fyIdForScope = category.include_fiscal_year ? (currentFiscalYearId || null) : null;
    const dp = datePart(category, docDate);
    let q = tenantClient.from('document_numbering_counters').select('current_number').eq('category_id', category.id);
    q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null);
    q = userIdForScope ? q.eq('user_id', userIdForScope) : q.is('user_id', null);
    q = fyIdForScope ? q.eq('fiscal_year_id', fyIdForScope) : q.is('fiscal_year_id', null);
    q = q.eq('period_key', dp.period);
    const { data: counter } = await q.maybeSingle();
    const next = counter ? Number(counter.current_number) + 1 : Number(category.start_number || 1);
    const fyPart = category.include_fiscal_year ? formatFiscalYearPart(currentFiscalYearName, category.fy_digit_format) : '';
    let number;
    try { number = buildNumber(category, next, fyPart, dp.text); } catch (e) { return { number: null, mode: 'invalid', error: e.message }; }
    return { number, mode: 'auto', category_id: category.id };
}

module.exports = { resolveDocumentNumber, previewDocumentNumber, datePart, buildNumber, isManual };
