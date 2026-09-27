// =============================================
// utils/pendingDocs.js
// "Pull from earlier documents" for every sales / purchase entry: when a
// party is chosen, the entry lists that party's earlier documents that
// still have qty left (a Quotation not yet ordered, an Order not yet
// delivered / billed, a Challan not yet billed ...). The user ticks one
// or many, can view each one, and the pending lines come into the entry
// with their source link, so the earlier document's progress moves and it
// can never be pulled twice.
//   pending qty of a line = qty - <progress counter of that source type>
// Which earlier types an entry offers is set in Entry Field Control
// (field ref_<type>, disabled = not offered).
// =============================================

const CLOSED = ['draft', 'cancelled', 'rejected', 'closed', 'expired', 'pending_approval'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// every document that can be pulled from
const DOCS = {
    sales_quotation: { label: 'Sales Quotation', table: 'sales_quotations', detail: 'sales_quotation_details', fk: 'quotation_id', party: 'customer_ledger_id', partyName: 'customer_name_snapshot' },
    sales_order: { label: 'Sales Order', table: 'sales_orders', detail: 'sales_order_details', fk: 'order_id', party: 'customer_ledger_id', partyName: 'customer_name_snapshot' },
    sales_delivery: { label: 'Sales Challan / Delivery', table: 'sales_deliveries', detail: 'sales_delivery_details', fk: 'delivery_id', party: 'customer_ledger_id', partyName: 'customer_name_snapshot' },
    sales_bill: { label: 'Sales Bill', table: 'sales_bills', detail: 'sales_bill_details', fk: 'bill_id', party: 'customer_ledger_id', partyName: 'customer_name_snapshot' },
    purchase_requisition: { label: 'Purchase Requisition', table: 'purchase_requisitions', detail: 'purchase_requisition_details', fk: 'requisition_id', party: 'vendor_ledger_id', partyName: 'vendor_name_snapshot' },
    purchase_quotation: { label: 'Purchase Quotation', table: 'purchase_quotations', detail: 'purchase_quotation_details', fk: 'quotation_id', party: 'vendor_ledger_id', partyName: 'vendor_name_snapshot' },
    purchase_order: { label: 'Purchase Order', table: 'purchase_orders', detail: 'purchase_order_details', fk: 'order_id', party: 'vendor_ledger_id', partyName: 'vendor_name_snapshot' },
    purchase_grn: { label: 'GRN', table: 'purchase_grns', detail: 'purchase_grn_details', fk: 'grn_id', party: 'vendor_ledger_id', partyName: 'vendor_name_snapshot' },
    purchase_bill: { label: 'Purchase Bill', table: 'purchase_bills', detail: 'purchase_bill_details', fk: 'bill_id', party: 'vendor_ledger_id', partyName: 'vendor_name_snapshot' }
};

// entry -> the earlier types it can pull: [type, progress counter on that type's lines,
//          line link column on the entry, header link column on the entry]
const TARGETS = {
    sales_order: [['sales_quotation', 'qty_ordered', 'source_quotation_detail_id', 'source_quotation_id']],
    sales_delivery: [['sales_order', 'qty_delivered', 'source_order_detail_id', 'source_order_id']],
    sales_bill: [
        ['sales_quotation', 'qty_ordered', 'source_quotation_detail_id', 'source_quotation_id'],
        ['sales_order', 'qty_delivered', 'source_order_detail_id', 'source_order_id'],
        ['sales_delivery', 'qty_billed', 'source_delivery_detail_id', 'source_delivery_id']
    ],
    sales_return: [['sales_bill', 'qty_returned', 'source_bill_detail_id', 'source_bill_id']],
    purchase_quotation: [['purchase_requisition', 'qty_quoted', 'source_requisition_detail_id', 'source_requisition_id']],
    purchase_order: [
        ['purchase_requisition', 'qty_ordered', 'source_requisition_detail_id', 'source_requisition_id'],
        ['purchase_quotation', 'qty_ordered', 'source_quotation_detail_id', 'source_quotation_id']
    ],
    purchase_grn: [['purchase_order', 'qty_received', 'source_order_detail_id', 'source_order_id']],
    purchase_bill: [
        ['purchase_order', 'qty_received', 'source_order_detail_id', 'source_order_id'],
        ['purchase_grn', 'qty_billed', 'source_grn_detail_id', 'source_grn_id']
    ],
    purchase_return: [['purchase_bill', 'qty_returned', 'source_bill_detail_id', 'source_bill_id']]
};

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const sourcesOf = target => {
    const s = TARGETS[target];
    if (!s) throw bad(`Unknown entry type "${target}"`);
    return s;
};

async function pendingLines(c, t, type, counter, headerIds) {
    const D = DOCS[type];
    if (!headerIds.length) return [];
    const { data, error } = await c.from(D.detail).select('*').in(D.fk, headerIds).order('display_order');
    if (error) throw error;
    return (data || []).map(d => {
        const done = Number(d[counter] || 0);
        const pending = round4(Number(d.qty || 0) - done);
        const altDone = Number(d[`alt_${counter}`] || 0);
        const altPending = d.alt_qty ? round4(Number(d.alt_qty) - altDone) : 0;
        return { ...d, done_qty: done, pending_qty: Math.max(0, pending), pending_alt_qty: Math.max(0, altPending) };
    }).filter(d => d.pending_qty > 0 || d.pending_alt_qty > 0);
}

/** documents of this party that still have something to pull, per type the entry allows */
async function list(c, t, { target, party_id: partyId, types }) {
    if (!UUID.test(partyId || '')) return [];
    const allowed = types ? String(types).split(',') : null;
    const out = [];
    for (const [type, counter] of sourcesOf(target)) {
        if (allowed && !allowed.includes(type)) continue;
        const D = DOCS[type];
        const { data: heads, error } = await c.from(D.table).select('*').eq('tenant_id', t).eq(D.party, partyId).order('doc_date', { ascending: false }).limit(200);
        if (error) throw error;
        const open = (heads || []).filter(h => !CLOSED.includes(h.status));
        const lines = await pendingLines(c, t, type, counter, open.map(h => h.id));
        const byHead = {};
        lines.forEach(l => { (byHead[l[D.fk]] = byHead[l[D.fk]] || []).push(l); });
        open.filter(h => byHead[h.id]).forEach(h => out.push({
            type, type_label: D.label, id: h.id, doc_no: h.doc_no, doc_date: h.doc_date, status: h.status, party_name: h[D.partyName] || null,
            total_amount: Number(h.total_amount || 0), pending_lines: byHead[h.id].length,
            pending_value: round4(byHead[h.id].reduce((s, l) => s + l.pending_qty * Number(l.rate || 0), 0)),
            warehouse_id: h.warehouse_id || null
        }));
    }
    return out;
}

/** one earlier document: header + its lines (with what is still pending) - the "view" */
async function detail(c, t, { target, type, id }) {
    const src = sourcesOf(target).find(s => s[0] === type);
    if (!src || !DOCS[type]) throw bad('This document type cannot be pulled into this entry');
    const D = DOCS[type];
    const { data: head, error } = await c.from(D.table).select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!head) throw bad('Document not found', 404);
    const { data: all } = await c.from(D.detail).select('*').eq(D.fk, id).order('display_order');
    const pending = await pendingLines(c, t, type, src[1], [id]);
    const pendingById = Object.fromEntries(pending.map(p => [p.id, p]));
    return { ...head, type, type_label: D.label, lines: (all || []).map(l => ({ ...l, pending_qty: pendingById[l.id]?.pending_qty || 0, pending_alt_qty: pendingById[l.id]?.pending_alt_qty || 0 })) };
}

const COPY = ['product_id', 'uom_id', 'alt_unit_id', 'rate', 'rate_basis', 'discount_percent', 'tax_percent', 'warehouse_id', 'batch_no', 'serial_no', 'mfg_date', 'exp_date', 'free_uom_id', 'barcode', 'narration'];

/** pending lines of the chosen documents, shaped as lines of the entry (with their source link) */
async function pull(c, t, { target, docs }) {
    const sources = sourcesOf(target);
    const picked = (Array.isArray(docs) ? docs : []).filter(d => d && UUID.test(d.id || '') && DOCS[d.type]);
    if (!picked.length) throw bad('Tick at least one document');
    const lines = [], header = {}, used = [];
    let party = null;
    for (const [type, counter, lineLink, headLink] of sources) {
        const ids = picked.filter(d => d.type === type).map(d => d.id);
        if (!ids.length) continue;
        const D = DOCS[type];
        const { data: heads } = await c.from(D.table).select('*').eq('tenant_id', t).in('id', ids);
        for (const h of heads || []) {
            if (CLOSED.includes(h.status)) throw bad(`${D.label} ${h.doc_no} is ${h.status} - it cannot be pulled`);
            if (party && party !== h[D.party]) throw bad('All the documents must be of the same party');
            party = h[D.party];
            if (!header[headLink]) header[headLink] = h.id;
            used.push({ type, id: h.id, doc_no: h.doc_no });
            ['warehouse_id', 'agent_id', 'cost_center_id', 'business_unit_id', 'area_id', 'route_id', 'product_company_id'].forEach(k => { if (h[k] && header[k] === undefined) header[k] = h[k]; });
        }
        const pending = await pendingLines(c, t, type, counter, ids);
        pending.forEach(p => {
            const row = {};
            COPY.forEach(k => { if (p[k] !== undefined && p[k] !== null) row[k] = p[k]; });
            row.qty = p.pending_qty;
            if (p.alt_qty) row.alt_qty = p.pending_alt_qty || '';
            if (p.free_qty) row.free_qty = p.free_qty;
            row[lineLink] = p.id;
            lines.push(row);
        });
    }
    return { party_id: party, header, lines, documents: used };
}

module.exports = { DOCS, TARGETS, list, detail, pull };
