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

// Returns the final formatted document number string, e.g.
// "PREQ-8182-000042-A" for prefix=PREQ-, fy=8182, digits=6, suffix=-A.
// Throws a plain Error with a user-facing message on failure (manual
// mode with no number supplied, duplicate manual number, or numbering
// range exhausted) so route handlers can just catch-and-respond.
async function resolveDocumentNumber(tenantClient, { tenantId, voucherType, userId, categoryId, manualNumber, tableName, currentFiscalYearId, currentFiscalYearName, userDefaultBranchId }) {
    let query = tenantClient.from('document_numbering_categories').select('*').eq('tenant_id', tenantId).eq('voucher_type', voucherType).eq('is_active', true);
    query = categoryId ? query.eq('id', categoryId) : query.eq('is_default', true);
    const { data: category } = await query.maybeSingle();

    // FEATURE: no category configured yet for this voucher type - fall
    // back to the plain 12-char next_master_code() pattern every other
    // master already uses, so the document is never blocked on setup.
    if (!category) return null;

    if (category.numbering_mode === 'manual') {
        if (!manualNumber || !manualNumber.trim()) throw new Error('Document Number is required (this category is set to Manual numbering)');
        const { data: dup } = await tenantClient.from(tableName).select('id').eq('tenant_id', tenantId).eq('doc_no', manualNumber.trim()).maybeSingle();
        if (dup) throw new Error('This Document Number is already used');
        return manualNumber.trim();
    }

    const branchId = category.scope === 'branch_wise' ? (userDefaultBranchId || null) : null;
    const userIdForScope = category.scope === 'user_wise' ? userId : null;
    const fyIdForScope = category.include_fiscal_year ? (currentFiscalYearId || null) : null;

    const { data: seqNumber, error } = await tenantClient.rpc('next_document_number', {
        p_tenant_id: tenantId, p_category_id: category.id, p_branch_id: branchId, p_user_id: userIdForScope, p_fiscal_year_id: fyIdForScope
    });
    if (error) throw new Error(error.message);

    const fyPart = category.include_fiscal_year ? formatFiscalYearPart(currentFiscalYearName, category.fy_digit_format) : '';
    const padded = String(seqNumber).padStart(category.digit_count, '0');
    return `${category.prefix || ''}${fyPart}${padded}${category.suffix || ''}`;
}

/**
 * The number the next document of this type will get - shown read-only on
 * a new entry. Reads the counter only (nothing is used up). null = no
 * numbering category (the plain system series applies), manual = user types it.
 */
async function previewDocumentNumber(tenantClient, { tenantId, voucherType, userId, categoryId, currentFiscalYearId, currentFiscalYearName, userDefaultBranchId }) {
    let query = tenantClient.from('document_numbering_categories').select('*').eq('tenant_id', tenantId).eq('voucher_type', voucherType).eq('is_active', true);
    query = categoryId ? query.eq('id', categoryId) : query.eq('is_default', true);
    const { data: category } = await query.maybeSingle();
    if (!category) return { number: null, mode: 'system' };
    if (category.numbering_mode === 'manual') return { number: null, mode: 'manual', category_id: category.id };
    const branchId = category.scope === 'branch_wise' ? (userDefaultBranchId || null) : null;
    const userIdForScope = category.scope === 'user_wise' ? userId : null;
    const fyIdForScope = category.include_fiscal_year ? (currentFiscalYearId || null) : null;
    let q = tenantClient.from('document_numbering_counters').select('current_number').eq('category_id', category.id);
    q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null);
    q = userIdForScope ? q.eq('user_id', userIdForScope) : q.is('user_id', null);
    q = fyIdForScope ? q.eq('fiscal_year_id', fyIdForScope) : q.is('fiscal_year_id', null);
    const { data: counter } = await q.maybeSingle();
    const next = counter ? Number(counter.current_number) + 1 : Number(category.start_number || 1);
    const fyPart = category.include_fiscal_year ? formatFiscalYearPart(currentFiscalYearName, category.fy_digit_format) : '';
    return { number: `${category.prefix || ''}${fyPart}${String(next).padStart(category.digit_count, '0')}${category.suffix || ''}`, mode: 'auto', category_id: category.id };
}

module.exports = { resolveDocumentNumber, previewDocumentNumber };
