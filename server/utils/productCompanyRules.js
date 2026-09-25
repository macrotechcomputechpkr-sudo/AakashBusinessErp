// =============================================
// utils/productCompanyRules.js
// System Control can make Product Company COMPULSORY for sales-side
// (customer) and/or purchase-side (vendor) transactions. When it is:
//   * the document header must carry one product_company_id;
//   * every line's product must belong to that company
//     (multiple companies' products are not allowed in one transaction).
// When it isn't, a company chosen on the header is still honoured as a
// filter (lines must match it) but nothing is required.
// =============================================

const SIDE_FLAG = { sales: 'product_company_compulsory_sales', purchase: 'product_company_compulsory_purchase' };

async function companyRules(tenantClient, tenantId) {
    const { data } = await tenantClient.from('system_control_settings')
        .select('product_company_compulsory_sales, product_company_compulsory_purchase').eq('tenant_id', tenantId).maybeSingle();
    return { sales: !!data?.product_company_compulsory_sales, purchase: !!data?.product_company_compulsory_purchase };
}

// Returns an error message, or null when the document is fine.
async function checkProductCompany(tenantClient, tenantId, side, body, isDraft) {
    const compulsory = (await companyRules(tenantClient, tenantId))[side];
    const companyId = body.product_company_id || null;
    // Required even on drafts: the product list depends on the company, and a
    // company-less draft could otherwise be posted later around this rule.
    if (compulsory && !companyId) return 'Product Company is compulsory for this transaction - choose it first';
    if (!companyId) return null;
    const productIds = [...new Set((body.details || []).map(d => d.product_id).filter(Boolean))];
    if (!productIds.length) return null;
    const { data: products } = await tenantClient.from('products').select('id, product_name, product_company_id').in('id', productIds);
    const wrong = (products || []).filter(p => p.product_company_id !== companyId);
    if (wrong.length) {
        const names = wrong.slice(0, 3).map(p => p.product_name).join(', ');
        return `Only products of the selected Product Company are allowed in one transaction. Not in this company: ${names}${wrong.length > 3 ? ` (+${wrong.length - 3} more)` : ''}`;
    }
    return null;
}

module.exports = { companyRules, checkProductCompany, SIDE_FLAG };
