// =============================================
// routes/registerRoutes.js
// "Sabai module ko register... Date Selection... Filter Variable
// Available Field Sabai Dine... Product, Customer/Supplier, Area,
// Route, Agent, Product Company, Products Group, Ledger Category,
// Products Category" - a universal, filterable register (listing/
// report) covering every transaction and voucher module, with a
// dynamic filter builder rather than one hard-coded report per module.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

// FEATURE: header table/detail table/party info per document type -
// deliberately the SAME shape as Document Designer's own
// DOCUMENT_TYPE_CONFIG (not imported directly, to keep this route
// file independent of the designer's internals, but every value below
// was cross-checked against that file's config for consistency).
const REGISTER_CONFIG = {
    sales_bill: { headerTable: 'sales_bills', detailTable: 'sales_bill_details', fkColumn: 'bill_id', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot', side: 'sales' },
    purchase_bill: { headerTable: 'purchase_bills', detailTable: 'purchase_bill_details', fkColumn: 'bill_id', partyField: 'vendor_ledger_id', partyNameField: 'vendor_name_snapshot', side: 'purchase' },
    sales_delivery: { headerTable: 'sales_deliveries', detailTable: 'sales_delivery_details', fkColumn: 'delivery_id', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot', side: 'sales' },
    sales_return: { headerTable: 'sales_returns', detailTable: 'sales_return_details', fkColumn: 'return_id', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot', side: 'sales' },
    purchase_grn: { headerTable: 'purchase_grns', detailTable: 'purchase_grn_details', fkColumn: 'grn_id', partyField: 'vendor_ledger_id', partyNameField: 'vendor_name_snapshot', side: 'purchase' },
    purchase_return: { headerTable: 'purchase_returns', detailTable: 'purchase_return_details', fkColumn: 'return_id', partyField: 'vendor_ledger_id', partyNameField: 'vendor_name_snapshot', side: 'purchase' },
    sales_order: { headerTable: 'sales_orders', detailTable: 'sales_order_details', fkColumn: 'order_id', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot', side: 'sales' },
    sales_quotation: { headerTable: 'sales_quotations', detailTable: 'sales_quotation_details', fkColumn: 'quotation_id', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot', side: 'sales' },
    purchase_order: { headerTable: 'purchase_orders', detailTable: 'purchase_order_details', fkColumn: 'order_id', partyField: 'vendor_ledger_id', side: 'purchase' },
    purchase_quotation: { headerTable: 'purchase_quotations', detailTable: 'purchase_quotation_details', fkColumn: 'quotation_id', partyField: 'vendor_ledger_id', side: 'purchase' },
    purchase_requisition: { headerTable: 'purchase_requisitions', detailTable: 'purchase_requisition_details', fkColumn: 'requisition_id', partyField: 'vendor_ledger_id', side: 'purchase' },
    sales_nonsaleable_return: { headerTable: 'sales_nonsaleable_returns', detailTable: 'sales_nonsaleable_return_details', fkColumn: 'return_id', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot', side: 'sales' },
    purchase_nonsaleable_return: { headerTable: 'purchase_nonsaleable_returns', detailTable: 'purchase_nonsaleable_return_details', fkColumn: 'return_id', partyField: 'vendor_ledger_id', partyNameField: 'vendor_name_snapshot', side: 'purchase' },
    stock_transfer: { headerTable: 'stock_transfers', detailTable: 'stock_transfer_details', fkColumn: 'transfer_id', side: 'internal' },
    production_order: { headerTable: 'production_orders', detailTable: 'production_raw_materials', fkColumn: 'production_id', side: 'internal' },
    journal_voucher: { headerTable: 'journal_vouchers', detailTable: 'journal_voucher_details', fkColumn: 'jv_id', side: 'ledger' },
    credit_note: { headerTable: 'credit_notes', detailTable: 'credit_note_details', fkColumn: 'credit_note_id', partyField: 'party_ledger_id', partyNameField: 'party_name_snapshot', side: 'ledger' },
    debit_note: { headerTable: 'debit_notes', detailTable: 'debit_note_details', fkColumn: 'debit_note_id', partyField: 'party_ledger_id', partyNameField: 'party_name_snapshot', side: 'ledger' },
    cash_bank_entry: { headerTable: 'cash_bank_entries', partyField: 'party_ledger_id', partyNameField: 'party_name_snapshot', side: 'ledger' },
    pdc_voucher: { headerTable: 'pdc_vouchers', partyField: 'party_ledger_id', partyNameField: 'party_name_snapshot', side: 'ledger' },
    sales_additional_entry: { headerTable: 'sales_additional_entries', detailTable: 'sales_additional_entry_lines', fkColumn: 'entry_id', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot', side: 'sales', noProductLines: true },
    purchase_additional_expense: { headerTable: 'purchase_additional_expenses', detailTable: 'purchase_additional_expense_lines', fkColumn: 'expense_id', partyField: 'vendor_ledger_id', partyNameField: 'vendor_name_snapshot', side: 'purchase', noProductLines: true }
};

// FEATURE: which filters make sense for which document type - a
// voucher with no products (Journal Voucher, Cash/Bank Entry) has no
// Product/Product Company/Product Group/Product Category filters; a
// document with no products but WITH ledger lines (Journal Voucher,
// Credit/Debit Note) gets Ledger Category instead; Stock Transfer/
// Production Order have products but no Customer/Supplier.
function availableFilters(config) {
    const filters = ['date_range'];
    if (config.partyField) filters.push('party');
    if (config.side === 'sales' || config.side === 'purchase') filters.push('area', 'route', 'agent');
    // noProductLines: Sales Additional Entry / Purchase Additional
    // Expense have line tables, but those lines are LEDGER lines with no
    // product_id - product filters/grouping would query a missing column.
    if (config.detailTable && config.side !== 'ledger' && !config.noProductLines) filters.push('product', 'product_company', 'product_group', 'product_category');
    // Ledger Category applies wherever a ledger is involved: the party
    // ledger (Customer/Supplier) on Sales/Purchase documents, or the
    // line ledgers on Journal Voucher / Credit / Debit Note.
    if (config.partyField || config.side === 'ledger') filters.push('ledger_category');
    return filters;
}

// FEATURE: Product Category / Ledger Category are OPTIONAL, tenant-
// customised features (company_profile.enable_custom_*_categories +
// custom_*_category_label) - separate from Customer/Supplier, which is
// always the party ledger itself. A category filter is offered ONLY
// when that feature is enabled, and always under the tenant's own
// label (e.g. "Brand" or "Customer Type"), never a generic name.
router.get('/registers/filter-options', requireAuth, async (req, res) => {
    try {
        const { document_type } = req.query;
        const config = REGISTER_CONFIG[document_type];
        if (!config) return res.status(400).json({ success: false, error: `Register not available yet for "${document_type}"` });
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: profile } = await tenantClient
            .from('company_profile')
            .select('enable_custom_product_categories, custom_product_category_label, enable_custom_ledger_categories, custom_ledger_category_label')
            .eq('tenant_id', req.auth.tenantId).maybeSingle();

        let filters = availableFilters(config);
        if (!profile?.enable_custom_product_categories) filters = filters.filter(f => f !== 'product_category');
        if (!profile?.enable_custom_ledger_categories) filters = filters.filter(f => f !== 'ledger_category');

        res.json({
            success: true,
            data: {
                filters, side: config.side, has_party: !!config.partyField,
                labels: {
                    product_category: profile?.custom_product_category_label || 'Product Category',
                    ledger_category: profile?.custom_ledger_category_label || 'Ledger Category'
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/registers/:documentType/search', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const documentType = req.params.documentType;
        const config = REGISTER_CONFIG[documentType];
        if (!config) return res.status(400).json({ success: false, error: `Register not available yet for "${documentType}"` });
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const { date_from, date_to, party_ledger_id, area_id, route_id, agent_id, product_id, product_company_id, product_group_id, product_category_id, ledger_category_id } = req.query;

        let query = tenantClient.from(config.headerTable).select('*').eq('tenant_id', tenantId);
        if (date_from) query = query.gte('doc_date', date_from);
        if (date_to) query = query.lte('doc_date', date_to);
        if (party_ledger_id && config.partyField) query = query.eq(config.partyField, party_ledger_id);
        if (area_id) query = query.eq('area_id', area_id);
        if (route_id) query = query.eq('route_id', route_id);
        if (agent_id) query = query.eq('agent_id', agent_id);

        // FEATURE: product-side filters (Product / Product Company /
        // Product Group / Product Category) all resolve down to a set
        // of matching product_ids, then narrow to header ids that have
        // at least one detail line among those products.
        const needsProductFilter = product_id || product_company_id || product_group_id || product_category_id;
        if (needsProductFilter && config.detailTable && !config.noProductLines && config.side !== 'ledger') {
            let matchingProductIds = null;
            if (product_id) {
                matchingProductIds = [product_id];
            } else if (product_company_id) {
                const { data } = await tenantClient.from('products').select('id').eq('product_company_id', product_company_id);
                matchingProductIds = (data || []).map(p => p.id);
            } else if (product_group_id) {
                const { data } = await tenantClient.from('products').select('id').eq('product_group_id', product_group_id);
                matchingProductIds = (data || []).map(p => p.id);
            } else if (product_category_id) {
                const { data } = await tenantClient.from('product_category_links').select('product_id').eq('product_category_id', product_category_id);
                matchingProductIds = (data || []).map(l => l.product_id);
            }
            if (!matchingProductIds || matchingProductIds.length === 0) return res.json({ success: true, data: [] });
            const { data: matchingDetails } = await tenantClient.from(config.detailTable).select(config.fkColumn).in('product_id', matchingProductIds);
            const matchingHeaderIds = [...new Set((matchingDetails || []).map(d => d[config.fkColumn]))];
            if (matchingHeaderIds.length === 0) return res.json({ success: true, data: [] });
            query = query.in('id', matchingHeaderIds);
        }

        // FEATURE: Ledger Category filter (Journal Voucher / Credit
        // Note / Debit Note) - resolves to matching ledger_ids via the
        // category's junction table, then narrows to headers that have
        // at least one detail line against one of those ledgers.
        if (ledger_category_id) {
            const { data: catLinks } = await tenantClient.from('ledger_account_categories').select('ledger_account_id').eq('ledger_category_id', ledger_category_id);
            const matchingLedgerIds = [...new Set((catLinks || []).map(l => l.ledger_account_id))];
            if (matchingLedgerIds.length === 0) return res.json({ success: true, data: [] });
            if (config.partyField) {
                // Customer/Supplier documents: the party ledger itself
                // must belong to the chosen category.
                query = query.in(config.partyField, matchingLedgerIds);
            } else if (config.detailTable) {
                // Journal Voucher: any line ledger in the category.
                const { data: matchingDetails } = await tenantClient.from(config.detailTable).select(config.fkColumn).in('ledger_id', matchingLedgerIds);
                const matchingHeaderIds = [...new Set((matchingDetails || []).map(d => d[config.fkColumn]))];
                if (matchingHeaderIds.length === 0) return res.json({ success: true, data: [] });
                query = query.in('id', matchingHeaderIds);
            }
        }

        const groupBy = req.query.group_by;
        const { data, error } = await query.order('doc_date', { ascending: false }).limit(groupBy ? 5000 : 500);
        if (error) throw error;
        if (!groupBy) return res.json({ success: true, data: data || [] });

        // FEATURE: "Customer Wise, Product Wise Xuttai Report" - the same
        // filtered register, summarised by one dimension. Header-level
        // dimensions group the documents; Product groups their lines.
        const rows = data || [];
        const amountOf = r => Number(r.total_amount ?? r.grand_total ?? r.amount ?? r.total_debit ?? r.total_raw_material_cost ?? 0) || 0;
        const groups = {};
        const add = (key, label, amount, qty, docId) => {
            const g = groups[key] = groups[key] || { key, label, doc_ids: new Set(), qty: 0, amount: 0 };
            if (docId) g.doc_ids.add(docId);
            g.amount += amount; g.qty += qty;
        };
        if (groupBy === 'product') {
            if (!config.detailTable || config.side === 'ledger' || config.noProductLines) return res.status(400).json({ success: false, error: 'This module has no product lines to group by product' });
            const ids = rows.map(r => r.id);
            for (let i = 0; i < ids.length; i += 150) {
                const { data: lines, error: lErr } = await tenantClient.from(config.detailTable).select(`${config.fkColumn}, product_id, product_name_snapshot, qty, amount`).in(config.fkColumn, ids.slice(i, i + 150));
                if (lErr) throw lErr;
                (lines || []).forEach(l => add(l.product_id || l.product_name_snapshot, l.product_name_snapshot || '(no product)', Number(l.amount) || 0, Number(l.qty) || 0, l[config.fkColumn]));
            }
        } else {
            const lookupTables = { agent: ['salesman_agents', 'agent_id', 'agent_name'], area: ['areas', 'area_id', 'area_name'], route: ['routes', 'route_id', 'route_name'] };
            let nameById = {};
            if (lookupTables[groupBy]) {
                const [table, col, nameCol] = lookupTables[groupBy];
                const ids = [...new Set(rows.map(r => r[col]).filter(Boolean))];
                if (ids.length) {
                    const { data: names } = await tenantClient.from(table).select(`id, ${nameCol}`).in('id', ids);
                    nameById = Object.fromEntries((names || []).map(n => [n.id, n[nameCol]]));
                }
            }
            rows.forEach(r => {
                let key, label;
                if (groupBy === 'party') { key = config.partyField ? r[config.partyField] : null; label = r.customer_name_snapshot || r.vendor_name_snapshot || r.party_name_snapshot || r.cash_vendor_name || '(no party)'; }
                else if (lookupTables[groupBy]) { const col = lookupTables[groupBy][1]; key = r[col]; label = nameById[r[col]] || '(not set)'; }
                else if (groupBy === 'month') { key = (r.doc_date || '').slice(0, 7); label = key; }
                else if (groupBy === 'status') { key = r.status; label = r.status || '—'; }
                else return;
                add(key || (r.cash_vendor_name ? `cash:${r.cash_vendor_name}` : '__none'), label, amountOf(r), 0, r.id);
            });
        }
        const out = Object.values(groups).map(g => ({ key: g.key, label: g.label, doc_count: g.doc_ids.size, qty: Math.round(g.qty * 10000) / 10000, amount: Math.round(g.amount * 100) / 100 }))
            .sort((a, b) => groupBy === 'month' ? String(a.label).localeCompare(String(b.label)) : b.amount - a.amount);
        res.json({ success: true, data: { grouped: true, group_by: groupBy, rows: out, truncated: rows.length === 5000 } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
