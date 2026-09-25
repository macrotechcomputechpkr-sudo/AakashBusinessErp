// =============================================
// routes/billingTermRoutes.js
// Billing Term master - completes the placeholder referenced by
// product_groups.billing_term_id. Supports three calculation modes
// (fixed amount / percentage / formula) and lets terms reference each
// other (or a running total) so charges can chain, matching how SAP's
// pricing procedure and Odoo's pricelist formulas work, without needing
// SAP-style ABAP routines - formulas are validated and evaluated safely
// via server/utils/formulaEvaluator.js (no eval, no arbitrary code).
// =============================================

const express = require('express');
const { loadTermSubLedgers } = require('../utils/termSubLedgers');
const router = express.Router();
const { getTenantClient, loadUserPermissions, logAudit } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validateFormula, evaluateAllTerms, FormulaError } = require('../utils/formulaEvaluator');

function validateTermBody(body) {
    const { calculation_mode, formula_expression, base_reference, base_reference_term_id, rate_percentage } = body;

    if (!['fixed_amount', 'percentage', 'both', 'formula', 'free_quantity'].includes(calculation_mode)) {
        return 'calculation_mode must be one of: fixed_amount, percentage, both, formula, free_quantity';
    }
    if (calculation_mode === 'formula') {
        if (!formula_expression || !formula_expression.trim()) return 'Formula Expression is required when Calculation Mode is Formula';
        try {
            validateFormula(formula_expression);
        } catch (err) {
            if (err instanceof FormulaError) return `Invalid formula: ${err.message}`;
            throw err;
        }
    }
    if ((calculation_mode === 'percentage' || calculation_mode === 'both') && (rate_percentage === undefined || rate_percentage === null || rate_percentage === '')) {
        return 'Rate/Percentage is required when Calculation Mode is Percentage or Both';
    }
    if (base_reference === 'specific_term' && !base_reference_term_id) {
        return 'Base Reference Term is required when Base Reference is "Specific Term"';
    }
    const salesOk = body.applicable_sales_entry !== undefined ? body.applicable_sales_entry : true;
    if (!salesOk && !body.applicable_purchase_entry && !body.applicable_additional_expense && !body.applicable_production_entry) {
        return 'Select at least one: Sales Entry, Purchase Entry, Additional Expense, or Production Entry';
    }
    return null;
}

router.get('/billing-terms', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('billing_terms')
            .select('*, base_reference_term:base_reference_term_id(term_code, term_name), billing_ledger:billing_ledger_id(account_name), return_ledger:return_ledger_id(account_name), sub_ledger:sub_ledger_id(sub_ledger_name, main_ledger_id), return_sub_ledger:return_sub_ledger_id(sub_ledger_name, main_ledger_id)')
            .eq('tenant_id', req.auth.tenantId)
            .eq('is_active', true)
            .order('display_order');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// A term's sub-ledgers must be real sub-ledgers OF the ledger they sit
// under: sub_ledger_id under billing_ledger_id, return_sub_ledger_id
// under return_ledger_id (else billing_ledger_id, like posting uses).
async function checkTermSubLedgers(tenantClient, tenantId, t) {
    const pairs = [
        ['Sub-Ledger', t.sub_ledger_id, t.billing_ledger_id, 'Billing Ledger'],
        ['Return Sub-Ledger', t.return_sub_ledger_id, t.return_ledger_id || t.billing_ledger_id, 'Return Ledger']
    ];
    for (const [label, subId, ledgerId, ledgerLabel] of pairs) {
        if (!subId) continue;
        if (!ledgerId) return `${label} needs a ${ledgerLabel} first`;
        const { data: sub } = await tenantClient.from('sub_ledgers').select('main_ledger_id, sub_ledger_name').eq('id', subId).eq('tenant_id', tenantId).maybeSingle();
        if (!sub) return `${label} not found`;
        if (sub.main_ledger_id !== ledgerId) return `${label} "${sub.sub_ledger_name}" does not belong to the selected ${ledgerLabel}`;
    }
    return null;
}

// The sub-ledger chosen per term on one transaction (for the entry popup on edit).
router.get('/document-term-sub-ledgers', requireAuth, async (req, res) => {
    try {
        const { document_type, document_id } = req.query;
        if (!document_type || !document_id) return res.status(400).json({ success: false, error: 'document_type and document_id are required' });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        res.json({ success: true, data: await loadTermSubLedgers(tenantClient, document_type, document_id) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/billing-terms', requireAuth, loadUserPermissions, requirePermission('ledger', 'create'), async (req, res) => {
    try {
        const { term_name } = req.body;
        if (!term_name || !term_name.trim()) return res.status(400).json({ success: false, error: 'Term Name is required' });

        const validationError = validateTermBody(req.body);
        if (validationError) return res.status(400).json({ success: false, error: validationError });

        const tenantId = req.auth.tenantId;
        const subErr = await checkTermSubLedgers(await getTenantClient(tenantId), tenantId, req.body);
        if (subErr) return res.status(400).json({ success: false, error: subErr });
        const tenantClient = await getTenantClient(tenantId);
        const prefix = term_name.trim().slice(0, 4).toUpperCase();
        const { data: codeRow, error: codeErr } = await tenantClient.rpc('next_billing_term_code', { prefix });
        if (codeErr) throw codeErr;

        const b = req.body;
        const { data, error } = await tenantClient
            .from('billing_terms')
            .insert({
                tenant_id: tenantId,
                term_code: codeRow,
                term_name: term_name.trim(),
                description: b.description,
                term_category: b.term_category || 'general',
                tax_type: b.tax_type || 'none',
                calculation_mode: b.calculation_mode || 'percentage',
                basis: b.basis || 'value',
                quantity_unit: b.quantity_unit || 'primary',
                base_reference: b.base_reference || 'basic_amount',
                base_reference_term_id: b.base_reference_term_id || null,
                rate_percentage: b.rate_percentage || 0,
                fixed_amount: b.fixed_amount || 0,
                maximum_amount: b.maximum_amount || 0,
                formula_expression: b.calculation_mode === 'formula' ? b.formula_expression : null,
                sign: b.sign || '+',
                rounding_method: b.rounding_method || 'none',
                rounding_precision: b.rounding_precision || 1,
                billing_ledger_id: b.billing_ledger_id || null,
                return_ledger_id: b.return_ledger_id || null,
                expiry_return_ledger_id: b.expiry_return_ledger_id || null,
                sub_ledger_id: b.sub_ledger_id || null,
                return_sub_ledger_id: b.return_sub_ledger_id || null,
                manual_override: b.manual_override !== undefined ? !!b.manual_override : true,
                suppress_if_zero: !!b.suppress_if_zero,
                include_in_profitability: !!b.include_in_profitability,
                product_wise: !!b.product_wise,
                show_product_term_summary: !!b.show_product_term_summary,
                allow_summary: !!b.allow_summary,
                applicable_sales_entry: b.applicable_sales_entry !== undefined ? !!b.applicable_sales_entry : true,
                applicable_purchase_entry: !!b.applicable_purchase_entry,
                applicable_additional_expense: !!b.applicable_additional_expense,
                applicable_production_entry: !!b.applicable_production_entry,
                is_enabled: b.is_enabled !== undefined ? !!b.is_enabled : true,
                credit_days: b.credit_days || 0,
                grace_days: b.grace_days || 0,
                discount_percentage: b.discount_percentage || 0,
                display_order: b.display_order || 1,
                created_by: req.auth.userId,
                updated_by: req.auth.userId
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A billing term with this name already exists' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the billing term fields' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'create_billing_term', 'billing_term', data.id, { new_data: data });
        res.json({ success: true, message: 'Billing term created successfully', data });
    } catch (error) {
        console.error('Create billing term error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/billing-terms/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('billing_terms').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'Billing term not found' });

        const merged = { ...existing, ...req.body };
        const validationError = validateTermBody(merged);
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        const subErr = await checkTermSubLedgers(tenantClient, tenantId, merged);
        if (subErr) return res.status(400).json({ success: false, error: subErr });

        // FIX: the edit form sends back the whole GET row, including joined
        // objects (billing_ledger, sub_ledger, ...) and identity columns -
        // strip them or the UPDATE fails on "column does not exist".
        const body = { ...req.body };
        ['id', 'tenant_id', 'created_at', 'created_by', 'base_reference_term', 'billing_ledger', 'return_ledger', 'sub_ledger', 'return_sub_ledger']
            .forEach(k => delete body[k]);
        Object.keys(body).forEach(k => { if (body[k] !== null && typeof body[k] === 'object' && !Array.isArray(body[k])) delete body[k]; });
        const update = {
            ...body,
            formula_expression: merged.calculation_mode === 'formula' ? merged.formula_expression : null,
            updated_by: req.auth.userId,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await tenantClient
            .from('billing_terms').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ success: false, error: 'A billing term with this name already exists' });
            if (error.code === '23514') return res.status(400).json({ success: false, error: 'Invalid value for one of the billing term fields' });
            throw error;
        }
        await logAudit(tenantId, req.auth.userId, 'update_billing_term', 'billing_term', req.params.id, { old_data: existing, new_data: data });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/billing-terms/:id', requireAuth, loadUserPermissions, requirePermission('ledger', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { data: existing } = await tenantClient.from('billing_terms').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        const { error } = await tenantClient.from('billing_terms').update({ is_active: false, updated_by: req.auth.userId }).eq('id', req.params.id).eq('tenant_id', tenantId);
        if (error) throw error;
        await logAudit(tenantId, req.auth.userId, 'delete_billing_term', 'billing_term', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'Billing term deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// FEATURE: live "what would this compute to" preview - lets the Billing
// Term form show a real calculated result while you're still typing the
// formula, using sample basic_amount/quantity you provide. Two modes:
//   1. { formula, basic_amount, quantity } - test a single formula
//      standalone, even before it's been saved (used by the form's
//      "Test Formula" button while you're still typing it).
//   2. { term_ids, basic_amount, quantity } - chain through several
//      already-saved terms in display_order, exactly as real billing
//      would (used to preview the combined effect of multiple terms).
router.post('/billing-terms/preview', requireAuth, async (req, res) => {
    try {
        const { formula, basic_amount, quantity, term_ids } = req.body;
        const tenantClient = await getTenantClient(req.auth.tenantId);

        if (formula) {
            const draftTerm = [{
                term_code: 'DRAFT', is_enabled: true, calculation_mode: 'formula',
                formula_expression: formula, base_reference: 'basic_amount', sign: '+', rounding_method: 'none'
            }];
            const result = evaluateAllTerms(draftTerm, { basic_amount: basic_amount || 0, quantity: quantity || 0 });
            return res.json({ success: true, data: result });
        }

        let terms = [];
        if (Array.isArray(term_ids) && term_ids.length > 0) {
            const { data, error } = await tenantClient
                .from('billing_terms').select('*').in('id', term_ids).eq('tenant_id', req.auth.tenantId).order('display_order');
            if (error) throw error;
            terms = data || [];
            // resolve base_reference_term_id -> term_code for the evaluator
            const byId = Object.fromEntries(terms.map(t => [t.id, t.term_code]));
            terms = terms.map(t => ({ ...t, base_reference_term_code: byId[t.base_reference_term_id] }));
        }

        const result = evaluateAllTerms(terms, { basic_amount: basic_amount || 0, quantity: quantity || 0 });
        res.json({ success: true, data: result });
    } catch (error) {
        if (error instanceof FormulaError) return res.status(400).json({ success: false, error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
