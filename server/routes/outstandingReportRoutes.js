// =============================================
// routes/outstandingReportRoutes.js
// "Sales And Purchase Related Document Ko outstanding Report Banau -
// Delivery Huna Baki, Bill Ma Convert Huna Baki, Bill Ko Payment Aauna
// Baaki" - one report engine for every "pending next step" in both
// chains:
//
//   Sales:    Order --(delivery pending)--> Delivery --(billing pending)--> Bill --(payment pending)-->
//   Purchase: Order --(receipt pending)---> GRN ------(billing pending)--> Bill --(payment pending)-->
//
// Quantity stages read the forward counters the posting routes already
// maintain (qty_delivered / qty_billed / qty_received - verified to be
// updated by salesDeliveryRoutes, salesBillRoutes, purchaseGrnRoutes,
// purchaseBillRoutes). Payment stages read bill_wise_references.
// remaining_amount - the same source of truth Bulk Settlement uses.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, loadUserPermissions } = require('../utils/dbHelpers');
const { toBaseQtyFromDual, decomposeToDualDisplay, getDualUomMode } = require('../utils/dualUomCalculation');
const { requireAuth, requirePermission } = require('../middleware/auth');

const QTY_STAGES = {
    sales_pending_delivery: {
        label: 'Sales Order - Delivery Pending', headerTable: 'sales_orders', detailTable: 'sales_order_details', fkColumn: 'order_id',
        convertedColumn: 'qty_delivered', convertedLabel: 'Delivered', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot',
        openStatuses: ['confirmed', 'partially_delivered']
    },
    sales_pending_billing: {
        label: 'Sales Delivery - Billing Pending', headerTable: 'sales_deliveries', detailTable: 'sales_delivery_details', fkColumn: 'delivery_id',
        convertedColumn: 'qty_billed', convertedLabel: 'Billed', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot',
        openStatuses: ['posted']
    },
    purchase_pending_receipt: {
        label: 'Purchase Order - Receipt (GRN) Pending', headerTable: 'purchase_orders', detailTable: 'purchase_order_details', fkColumn: 'order_id',
        convertedColumn: 'qty_received', convertedLabel: 'Received', partyField: 'vendor_ledger_id',
        // Snapshot exists (migration 47); join only backs up older rows.
        headerSelect: '*, vendor:vendor_ledger_id(account_name)', partyNamePath: 'vendor.account_name',
        openStatuses: ['confirmed', 'partially_received']
    },
    purchase_pending_billing: {
        label: 'Purchase GRN - Billing Pending', headerTable: 'purchase_grns', detailTable: 'purchase_grn_details', fkColumn: 'grn_id',
        convertedColumn: 'qty_billed', convertedLabel: 'Billed', partyField: 'vendor_ledger_id', partyNameField: 'vendor_name_snapshot',
        openStatuses: ['received', 'partially_billed']
    }
};

const PAYMENT_STAGES = {
    sales_pending_payment: { label: 'Sales Bill - Payment Pending (Receivable)', headerTable: 'sales_bills', sourceType: 'sales_bill', partyField: 'customer_ledger_id', partyNameField: 'customer_name_snapshot' },
    purchase_pending_payment: { label: 'Purchase Bill - Payment Pending (Payable)', headerTable: 'purchase_bills', sourceType: 'purchase_bill', partyField: 'vendor_ledger_id', partyNameField: 'vendor_name_snapshot' }
};

const daysBetween = (fromDate, toDate) => {
    if (!fromDate) return null;
    return Math.floor((new Date(toDate) - new Date(fromDate)) / 86400000);
};
const round2 = n => Math.round(n * 100) / 100;

router.get('/outstanding-report/stages', requireAuth, (req, res) => {
    const list = [...Object.entries(QTY_STAGES), ...Object.entries(PAYMENT_STAGES)].map(([key, c]) => ({ key, label: c.label, kind: QTY_STAGES[key] ? 'qty' : 'payment' }));
    res.json({ success: true, data: list });
});

router.get('/outstanding-report', requireAuth, loadUserPermissions, requirePermission('reports', 'view'), async (req, res) => {
    try {
        const { stage, date_from, date_to, as_of, party_ledger_id, agent_id, area_id, route_id, product_company_id } = req.query;
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const asOf = as_of || new Date().toISOString().slice(0, 10);

        const applyHeaderFilters = (q, cfg) => {
            if (date_from) q = q.gte('doc_date', date_from);
            if (date_to) q = q.lte('doc_date', date_to);
            if (party_ledger_id) q = q.eq(cfg.partyField, party_ledger_id);
            if (agent_id) q = q.eq('agent_id', agent_id);
            if (area_id) q = q.eq('area_id', area_id);
            if (route_id) q = q.eq('route_id', route_id);
            if (product_company_id) q = q.eq('product_company_id', product_company_id);
            return q;
        };
        // snapshot -> cash vendor name -> live join (pre-snapshot rows)
        const partyNameOf = (h, cfg) => h.vendor_name_snapshot || h.customer_name_snapshot || h.cash_vendor_name
            || (cfg.partyNamePath ? cfg.partyNamePath.split('.').reduce((o, k) => o?.[k], h) : null);

        // ---------- Quantity stages (Delivery / Receipt / Billing pending) ----------
        if (QTY_STAGES[stage]) {
            const cfg = QTY_STAGES[stage];
            let hq = tenantClient.from(cfg.headerTable).select(cfg.headerSelect || '*').eq('tenant_id', tenantId).in('status', cfg.openStatuses);
            hq = applyHeaderFilters(hq, cfg);
            const { data: headers, error: hErr } = await hq.order('doc_date').limit(1000);
            if (hErr) throw hErr;
            if (!headers || headers.length === 0) return res.json({ success: true, data: { rows: [], totals: { qty: 0, converted_qty: 0, outstanding_qty: 0, outstanding_amount: 0 } } });

            const headerById = Object.fromEntries(headers.map(h => [h.id, h]));
            const { data: details, error: dErr } = await tenantClient.from(cfg.detailTable).select('*').in(cfg.fkColumn, headers.map(h => h.id)).order('display_order');
            if (dErr) throw dErr;

            // Dual-unit (fixed_dual) lines are measured in BASE units using the
            // alt_* progress counters (migration 110): loose pieces and the
            // pieces part of "5 Carton + 7 Pcs" now count as done / pending.
            const dualProductIds = [...new Set((details || []).filter(d => d.product_id && d.alt_qty != null).map(d => d.product_id))];
            const factorOf = {};
            if (dualProductIds.length) {
                const { data: prods } = await tenantClient.from('products').select('id, uom_mode, dual_uom_primary_unit_id').in('id', dualProductIds);
                for (const pr of (prods || []).filter(x => x.uom_mode === 'fixed_dual' && x.dual_uom_primary_unit_id)) {
                    const { data: ur } = await tenantClient.from('product_unit_rates').select('conversion_factor').eq('product_id', pr.id).eq('unit_id', pr.dual_uom_primary_unit_id).maybeSingle();
                    factorOf[pr.id] = Number(ur?.conversion_factor) || 1;
                }
            }
            const dualMode = Object.keys(factorOf).length ? await getDualUomMode(tenantClient) : 'fixed';
            const altCol = 'alt_' + cfg.convertedColumn;

            const rows = (details || []).map(d => {
                const h = headerById[d[cfg.fkColumn]];
                const qty = Number(d.qty) || 0;
                const converted = Number(d[cfg.convertedColumn]) || 0;
                const base = {
                    header_id: h.id, doc_no: h.doc_no, doc_date: h.doc_date, due_date: h.due_date || null,
                    party_name: partyNameOf(h, cfg) || '—',
                    product_name: d.product_name_snapshot, uom: d.uom_name_snapshot, batch_no: d.batch_no || null,
                    qty, converted_qty: converted, converted_label: cfg.convertedLabel, rate: Number(d.rate) || 0,
                    days_pending: daysBetween(h.doc_date, asOf),
                    days_overdue: h.due_date ? Math.max(0, daysBetween(h.due_date, asOf)) : null
                };
                const factor = factorOf[d.product_id];
                if (factor) {
                    const totalBase = toBaseQtyFromDual(qty, d.alt_qty, factor, dualMode);
                    const doneBase = toBaseQtyFromDual(converted, d[altCol], factor, dualMode);
                    const pendingBase = Math.max(0, totalBase - doneBase);
                    const split = decomposeToDualDisplay(pendingBase, factor);
                    return {
                        ...base, dual: true, alt_qty: Number(d.alt_qty) || 0, converted_alt_qty: Number(d[altCol]) || 0,
                        outstanding_qty: split.primary, outstanding_alt_qty: round2(split.secondary), outstanding_base_qty: round2(pendingBase),
                        outstanding_amount: round2(totalBase ? (Number(d.amount) || 0) * pendingBase / totalBase : 0)
                    };
                }
                const outstandingQty = qty - converted;
                return { ...base, outstanding_qty: round2(outstandingQty), outstanding_alt_qty: 0,
                         outstanding_amount: round2(qty === 0 ? 0 : (Number(d.amount) || 0) * (outstandingQty / qty)) };
            }).filter(r => r.dual ? r.outstanding_base_qty > 0.00005 : r.outstanding_qty > 0.00005);

            const totals = rows.reduce((t, r) => ({
                qty: t.qty + r.qty, converted_qty: t.converted_qty + r.converted_qty,
                outstanding_qty: t.outstanding_qty + r.outstanding_qty, outstanding_alt_qty: t.outstanding_alt_qty + (r.outstanding_alt_qty || 0), outstanding_amount: t.outstanding_amount + r.outstanding_amount
            }), { qty: 0, converted_qty: 0, outstanding_qty: 0, outstanding_alt_qty: 0, outstanding_amount: 0 });
            Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });
            return res.json({ success: true, data: { kind: 'qty', rows, totals } });
        }

        // ---------- Payment stages (Receivable / Payable) ----------
        if (PAYMENT_STAGES[stage]) {
            const cfg = PAYMENT_STAGES[stage];
            let hq = tenantClient.from(cfg.headerTable).select('*').eq('tenant_id', tenantId).eq('status', 'posted');
            hq = applyHeaderFilters(hq, cfg);
            const { data: bills, error: bErr } = await hq.order('doc_date').limit(2000);
            if (bErr) throw bErr;
            if (!bills || bills.length === 0) return res.json({ success: true, data: { kind: 'payment', rows: [], totals: { bill_amount: 0, settled_amount: 0, outstanding_amount: 0 }, aging: {} } });

            const { data: refs, error: rErr } = await tenantClient
                .from('bill_wise_references').select('source_id, total_amount, remaining_amount')
                .eq('tenant_id', tenantId).eq('source_type', cfg.sourceType).in('source_id', bills.map(b => b.id)).gt('remaining_amount', 0);
            if (rErr) throw rErr;
            const refByBill = Object.fromEntries((refs || []).map(r => [r.source_id, r]));

            const rows = bills.filter(b => refByBill[b.id]).map(b => {
                const ref = refByBill[b.id];
                const total = Number(ref.total_amount) || 0, remaining = Number(ref.remaining_amount) || 0;
                const overdue = b.due_date ? daysBetween(b.due_date, asOf) : null;
                return {
                    header_id: b.id, doc_no: b.doc_no, doc_date: b.doc_date, due_date: b.due_date || null,
                    party_name: b[cfg.partyNameField] || '—',
                    bill_amount: round2(total), settled_amount: round2(total - remaining), outstanding_amount: round2(remaining),
                    days_pending: daysBetween(b.doc_date, asOf),
                    days_overdue: overdue !== null ? Math.max(0, overdue) : null
                };
            });

            // FEATURE: aging buckets on days since bill date - the
            // standard receivable/payable aging view.
            const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
            rows.forEach(r => {
                const d = r.days_pending ?? 0;
                const bucket = d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
                aging[bucket] = round2(aging[bucket] + r.outstanding_amount);
            });
            const totals = rows.reduce((t, r) => ({
                bill_amount: t.bill_amount + r.bill_amount, settled_amount: t.settled_amount + r.settled_amount, outstanding_amount: t.outstanding_amount + r.outstanding_amount
            }), { bill_amount: 0, settled_amount: 0, outstanding_amount: 0 });
            Object.keys(totals).forEach(k => { totals[k] = round2(totals[k]); });
            return res.json({ success: true, data: { kind: 'payment', rows, totals, aging } });
        }

        return res.status(400).json({ success: false, error: `Unknown stage "${stage}"` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
