// =============================================
// routes/purchaseRegisterReportRoutes.js
// "Report sabai module ko banau - Normal Register pani banau, Outstanding
// pani banau" - ONE generic, reusable report engine spanning every
// module in the purchase chain, instead of 8 separate hand-built pages.
// Each module maps to its own table/column names; the report itself
// (Transaction Qty/Amount, Converted Qty/Amount, Outstanding Qty/
// Amount, plus every practical filter that module's fields support) is
// identical in shape across all of them.
// =============================================

const express = require('express');
const { dualFactors, linePending } = require('../utils/progressCounters');
const { getDualUomMode } = require('../utils/dualUomCalculation');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');

// FEATURE: "whatever fields are available in that module, use them
// maximally as filters" - each module declares its own table/column
// names and which "converted forward" column represents its own
// Outstanding metric, so one query builder can serve all of them.
const MODULE_CONFIG = {
    requisition: {
        masterTable: 'purchase_requisitions', detailTable: 'purchase_requisition_details',
        fkColumn: 'requisition_id', convertedColumn: 'qty_ordered', convertedLabel: 'Ordered',
        label: 'Purchase Requisition'
    },
    quotation: {
        masterTable: 'purchase_quotations', detailTable: 'purchase_quotation_details',
        fkColumn: 'quotation_id', convertedColumn: 'qty_ordered', convertedLabel: 'Ordered',
        label: 'Purchase Quotation'
    },
    order: {
        masterTable: 'purchase_orders', detailTable: 'purchase_order_details',
        fkColumn: 'order_id', convertedColumn: 'qty_received', convertedLabel: 'Received',
        label: 'Purchase Order'
    },
    grn: {
        masterTable: 'purchase_grns', detailTable: 'purchase_grn_details',
        fkColumn: 'grn_id', convertedColumn: 'qty_billed', convertedLabel: 'Billed',
        label: 'Purchase GRN'
    },
    bill: {
        masterTable: 'purchase_bills', detailTable: 'purchase_bill_details',
        fkColumn: 'bill_id', convertedColumn: 'qty_returned', convertedLabel: 'Returned',
        label: 'Purchase Bill'
    }
};

// FEATURE: Register (every transaction line) and Outstanding
// (Transaction - Converted > 0 only) are the SAME underlying query,
// just filtered differently at the end - "outstanding" is a view onto
// the register, not a separate data source.
router.get('/purchase-register-report', requireAuth, loadUserPermissions, requirePermission('ledger', 'view'), async (req, res) => {
    try {
        const {
            module, from_date, to_date, doc_no, vendor_name, product_name, outstanding_only,
            status, agent_name, priority, batch_no, source_doc_no, warehouse_name
        } = req.query;
        const config = MODULE_CONFIG[module];
        if (!config) return res.status(400).json({ success: false, error: 'module must be one of: requisition, quotation, order, grn, bill' });

        const tenantClient = await getTenantClient(req.auth.tenantId);

        // Master-level filter first (date range, doc_no, vendor, status,
        // agent, priority - "maximum available fields") - pull matching
        // master ids, then filter details by those.
        let masterQuery = tenantClient.from(config.masterTable)
            .select('id, doc_no, doc_date, status, vendor_name_snapshot, cash_vendor_name, agent_name_snapshot, priority')
            .eq('tenant_id', req.auth.tenantId);
        if (from_date) masterQuery = masterQuery.gte('doc_date', from_date);
        if (to_date) masterQuery = masterQuery.lte('doc_date', to_date);
        if (doc_no) masterQuery = masterQuery.ilike('doc_no', `%${doc_no}%`);
        if (vendor_name) masterQuery = masterQuery.or(`vendor_name_snapshot.ilike.%${vendor_name}%,cash_vendor_name.ilike.%${vendor_name}%`);
        if (status) masterQuery = masterQuery.eq('status', status);
        if (agent_name) masterQuery = masterQuery.ilike('agent_name_snapshot', `%${agent_name}%`);
        if (priority) masterQuery = masterQuery.eq('priority', priority);
        const { data: masters, error: masterErr } = await masterQuery;
        if (masterErr) throw masterErr;
        if (!masters || masters.length === 0) return res.json({ success: true, data: [] });

        const masterById = Object.fromEntries(masters.map(m => [m.id, m]));
        const masterIds = masters.map(m => m.id);

        let detailQuery = tenantClient.from(config.detailTable).select('*').eq('tenant_id', req.auth.tenantId).in(config.fkColumn, masterIds);
        if (product_name) detailQuery = detailQuery.ilike('product_name_snapshot', `%${product_name}%`);
        if (batch_no) detailQuery = detailQuery.ilike('batch_no', `%${batch_no}%`);
        if (source_doc_no) detailQuery = detailQuery.ilike('source_doc_no', `%${source_doc_no}%`);
        if (warehouse_name) detailQuery = detailQuery.ilike('warehouse_name_snapshot', `%${warehouse_name}%`);
        const { data: details, error: detailErr } = await detailQuery;
        if (detailErr) throw detailErr;

        // Fixed-dual lines are measured in BASE units with the alt_* counters
        // (migration 110), so loose pieces count as converted / outstanding.
        const factorOf = await dualFactors(tenantClient, details || []);
        const dualMode = Object.keys(factorOf).length ? await getDualUomMode(tenantClient) : 'fixed';
        const altCol = 'alt_' + config.convertedColumn;
        let rows = (details || []).map(d => {
            const master = masterById[d[config.fkColumn]];
            const convertedQty = Number(d[config.convertedColumn] || 0);
            const pend = linePending(d, config.convertedColumn, altCol, factorOf[d.product_id], dualMode);
            const outstandingQty = pend.pendingPrimary;
            const convertedAmount = Number(d.amount) * pend.doneShare;
            const outstandingAmount = Number(d.amount) - convertedAmount;
            return {
                detail_id: d.id, doc_no: master?.doc_no, doc_date: master?.doc_date, status: master?.status,
                vendor_name: master?.vendor_name_snapshot || master?.cash_vendor_name,
                agent_name: master?.agent_name_snapshot, priority: master?.priority,
                product_name: d.product_name_snapshot, batch_no: d.batch_no, source_doc_no: d.source_doc_no,
                warehouse_name: d.warehouse_name_snapshot,
                qty: Number(d.qty), amount: Number(d.amount),
                converted_qty: convertedQty, converted_amount: Math.round(convertedAmount * 100) / 100,
                converted_label: config.convertedLabel,
                outstanding_qty: outstandingQty, outstanding_amount: Math.round(outstandingAmount * 100) / 100,
                dual: pend.dual, alt_qty: Number(d.alt_qty) || 0, converted_alt_qty: Number(d[altCol]) || 0, outstanding_alt_qty: pend.pendingAlt, outstanding_base_qty: pend.pendingBase
            };
        });

        if (outstanding_only === 'true') rows = rows.filter(r => r.outstanding_base_qty > 0.00005);
        rows.sort((a, b) => (a.doc_date || '').localeCompare(b.doc_date || ''));

        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
