// =============================================
// utils/documentCatalog.js
// One list of every entry document the ERP prints / reports on, and two
// things built on it:
//   User Defined Field VALUES - read / save the values typed against a
//     document (master) or its lines (detail), and look them up in bulk
//     for any report (by document id / line id - ids are UUIDs, unique
//     across tables, so a report needs no document type to find them).
//   Manual Document Printing - the documents of one type in a date range,
//     filtered by customer / vendor, agent, area, route, branch, status
//     and a From - To document number range.
// The document type keys are the print designer's (print_templates.
// document_type), so a listed document opens straight in its print layout.
// =============================================

const { fetchAll, inChunks, csv } = require('./tradeLines');

const SALES = 'customer_ledger_id', PURCHASE = 'vendor_ledger_id', PARTY = 'party_ledger_id';
const DOC_TYPES = {
    sales_quotation: { label: 'Sales Quotation', table: 'sales_quotations', detail: 'sales_quotation_details', fk: 'quotation_id', party: SALES, udf: 'sales_quotation', group: 'Sales' },
    sales_order: { label: 'Sales Order', table: 'sales_orders', detail: 'sales_order_details', fk: 'order_id', party: SALES, udf: 'sales_order', group: 'Sales' },
    sales_delivery: { label: 'Goods Delivery (GDN)', table: 'sales_deliveries', detail: 'sales_delivery_details', fk: 'delivery_id', party: SALES, udf: 'sales_delivery', group: 'Sales' },
    sales_bill: { label: 'Sales Bill', table: 'sales_bills', detail: 'sales_bill_details', fk: 'bill_id', party: SALES, udf: 'sales_bill', group: 'Sales' },
    sales_return: { label: 'Sales Return', table: 'sales_returns', detail: 'sales_return_details', fk: 'return_id', party: SALES, udf: 'sales_return', group: 'Sales' },
    sales_nonsaleable_return: { label: 'Sales Non-saleable Return', table: 'sales_nonsaleable_returns', detail: 'sales_nonsaleable_return_details', fk: 'return_id', party: SALES, udf: 'sales_nonsalable_return', group: 'Sales' },
    sales_additional_entry: { label: 'Sales Additional Entry', table: 'sales_additional_entries', detail: 'sales_additional_entry_lines', fk: 'entry_id', party: SALES, udf: 'sales_additional', group: 'Sales' },
    purchase_requisition: { label: 'Purchase Requisition', table: 'purchase_requisitions', detail: 'purchase_requisition_details', fk: 'requisition_id', party: PURCHASE, udf: 'purchase_requisition', group: 'Purchase' },
    purchase_quotation: { label: 'Purchase Quotation', table: 'purchase_quotations', detail: 'purchase_quotation_details', fk: 'quotation_id', party: PURCHASE, udf: 'purchase_quotation', group: 'Purchase' },
    purchase_order: { label: 'Purchase Order', table: 'purchase_orders', detail: 'purchase_order_details', fk: 'order_id', party: PURCHASE, udf: 'purchase_order', group: 'Purchase' },
    purchase_grn: { label: 'Goods Receipt (GRN)', table: 'purchase_grns', detail: 'purchase_grn_details', fk: 'grn_id', party: PURCHASE, udf: 'purchase_grn', group: 'Purchase' },
    purchase_bill: { label: 'Purchase Bill', table: 'purchase_bills', detail: 'purchase_bill_details', fk: 'bill_id', party: PURCHASE, udf: 'purchase_bill', group: 'Purchase' },
    purchase_return: { label: 'Purchase Return', table: 'purchase_returns', detail: 'purchase_return_details', fk: 'return_id', party: PURCHASE, udf: 'purchase_return', group: 'Purchase' },
    purchase_nonsaleable_return: { label: 'Purchase Non-saleable Return', table: 'purchase_nonsaleable_returns', detail: 'purchase_nonsaleable_return_details', fk: 'return_id', party: PURCHASE, udf: 'purchase_nonsalable_return', group: 'Purchase' },
    purchase_additional_expense: { label: 'Purchase Additional Expense', table: 'purchase_additional_expenses', detail: 'purchase_additional_expense_lines', fk: 'expense_id', party: PURCHASE, udf: 'purchase_additional', group: 'Purchase' },
    stock_transfer: { label: 'Stock Transfer', table: 'stock_transfers', detail: 'stock_transfer_details', fk: 'transfer_id', udf: 'stock_transfer', group: 'Inventory' },
    production_order: { label: 'Production Order', table: 'production_orders', detail: 'production_raw_materials', fk: 'production_id', udf: 'production', group: 'Inventory' },
    journal_voucher: { label: 'Journal Voucher', table: 'journal_vouchers', detail: 'journal_voucher_details', fk: 'jv_id', udf: 'journal', group: 'Accounts' },
    cash_bank_entry: { label: 'Cash / Bank Entry', table: 'cash_bank_entries', party: PARTY, udf: h => (h && h.payment_mode === 'cash' ? 'cash' : 'bank'), udfAll: ['cash', 'bank'], group: 'Accounts' },
    pdc_voucher: { label: 'PDC Voucher', table: 'pdc_vouchers', party: PARTY, udf: 'pdc', group: 'Accounts' },
    debit_note: { label: 'Debit Note', table: 'debit_notes', detail: 'debit_note_details', fk: 'debit_note_id', party: PARTY, udf: 'debit_note', group: 'Accounts' },
    credit_note: { label: 'Credit Note', table: 'credit_notes', detail: 'credit_note_details', fk: 'credit_note_id', party: PARTY, udf: 'credit_note', group: 'Accounts' }
};
// Report document-type names that differ from the keys above.
const ALIAS = { sales_nonsalable_return: 'sales_nonsaleable_return', purchase_nonsalable_return: 'purchase_nonsaleable_return',
    sales_additional: 'sales_additional_entry', purchase_additional: 'purchase_additional_expense', production: 'production_order',
    journal: 'journal_voucher', pdc: 'pdc_voucher', cash: 'cash_bank_entry', bank: 'cash_bank_entry' };
const docTypeOf = k => (DOC_TYPES[k] ? k : ALIAS[k] && DOC_TYPES[ALIAS[k]] ? ALIAS[k] : null);
const udfTypesOf = k => { const d = DOC_TYPES[docTypeOf(k)]; return !d ? [] : d.udfAll || [d.udf]; };

const lineLabel = d => d.product_name_snapshot || d.ledger_name_snapshot || d.account_name_snapshot || d.description || d.particulars || d.narration || '';

// ---------- UDF values ----------
async function udfFields(c, t, voucherTypes) {
    let q = c.from('user_defined_fields').select('id, voucher_type, section, field_label, field_type, reference_table, reference_display_field, display_order')
        .eq('tenant_id', t).eq('is_active', true);
    if (voucherTypes && voucherTypes.length) q = q.in('voucher_type', voucherTypes);
    const { data, error } = await q.order('display_order');
    if (error) throw error;
    return data || [];
}

async function readDocUdf(c, t, docType, docId) {
    const key = docTypeOf(docType), cfg = DOC_TYPES[key];
    if (!cfg) throw Object.assign(new Error(`Unknown document type "${docType}"`), { status: 400 });
    const { data: doc, error } = await c.from(cfg.table).select('*').eq('tenant_id', t).eq('id', docId).maybeSingle();
    if (error) throw error;
    if (!doc) throw Object.assign(new Error('Document not found'), { status: 404 });
    const vt = typeof cfg.udf === 'function' ? cfg.udf(doc) : cfg.udf;
    const fields = await udfFields(c, t, [vt]);
    let lines = [];
    if (cfg.detail && fields.some(f => f.section === 'detail')) {
        const { data, error: e2 } = await c.from(cfg.detail).select('*').eq(cfg.fk, docId).order('display_order');
        if (e2) throw e2;
        lines = (data || []).map((d, i) => ({ id: d.id, sn: i + 1, label: lineLabel(d) || `Line ${i + 1}`, qty: d.qty ?? d.quantity ?? null,
            amount: d.amount ?? d.net_amount ?? d.debit_amount ?? d.credit_amount ?? null }));
    }
    const { data: vals, error: e3 } = await c.from('document_udf_values').select('line_id, field_id, value_text, value_number, value_date, value_bool, value_ref_id, display_value')
        .eq('tenant_id', t).eq('document_id', docId);
    if (e3) throw e3;
    const values = { master: {}, detail: {} };
    (vals || []).forEach(v => {
        const has = x => x !== null && x !== undefined;
        const raw = has(v.value_ref_id) ? v.value_ref_id : has(v.value_date) ? String(v.value_date).slice(0, 10) : has(v.value_bool) ? v.value_bool
            : has(v.value_number) ? Number(v.value_number) : v.value_text;
        const cell = { value: raw, display: v.display_value };
        if (v.line_id) (values.detail[v.line_id] = values.detail[v.line_id] || {})[v.field_id] = cell;
        else values.master[v.field_id] = cell;
    });
    return { document_type: key, voucher_type: vt, doc: { id: doc.id, doc_no: doc.doc_no, doc_date: doc.doc_date, status: doc.status,
        party_id: cfg.party ? doc[cfg.party] || null : null, party_name: doc.customer_name_snapshot || doc.vendor_name_snapshot || doc.party_name_snapshot || '' },
        fields: { master: fields.filter(f => f.section === 'master'), detail: fields.filter(f => f.section === 'detail') }, lines, values };
}

// One typed value -> the stored columns + what reports print.
function toStored(field, value, refLabels) {
    const empty = value === undefined || value === null || value === '';
    if (empty) return null;
    const row = { value_text: null, value_number: null, value_date: null, value_bool: null, value_ref_id: null, display_value: null };
    switch (field.field_type) {
        case 'number': { const n = Number(String(value).replace(/,/g, '')); if (!Number.isFinite(n)) throw Object.assign(new Error(`"${field.field_label}" must be a number`), { status: 400 }); row.value_number = n; row.display_value = String(n); break; }
        case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw Object.assign(new Error(`"${field.field_label}" must be a date (YYYY-MM-DD)`), { status: 400 }); row.value_date = String(value); row.display_value = String(value); break;
        case 'boolean': { const b = value === true || value === 'true' || value === 'yes' || value === 1 || value === '1'; row.value_bool = b; row.display_value = b ? 'Yes' : 'No'; break; }
        case 'table_reference': row.value_ref_id = String(value); row.display_value = refLabels[String(value)] || String(value); break;
        default: row.value_text = String(value); row.display_value = String(value);
    }
    return row;
}

async function saveDocUdf(c, t, userId, docType, docId, body, referenceMap) {
    const cur = await readDocUdf(c, t, docType, docId);
    const byId = Object.fromEntries([...cur.fields.master, ...cur.fields.detail].map(f => [f.id, f]));
    const lineIds = new Set(cur.lines.map(l => l.id));
    const wanted = [];                                            // [field, lineId, value]
    Object.entries(body.master || {}).forEach(([fid, v]) => { if (byId[fid] && byId[fid].section === 'master') wanted.push([byId[fid], null, v]); });
    Object.entries(body.detail || {}).forEach(([lid, row]) => {
        if (!lineIds.has(lid)) return;
        Object.entries(row || {}).forEach(([fid, v]) => { if (byId[fid] && byId[fid].section === 'detail') wanted.push([byId[fid], lid, v]); });
    });
    // names of the picked records of Table Reference fields (allowlisted tables only)
    const refLabels = {};
    const refs = {};
    wanted.forEach(([f, , v]) => { if (f.field_type === 'table_reference' && v) (refs[f.reference_table] = refs[f.reference_table] || { fields: new Set(), ids: new Set() }).ids.add(String(v)); });
    wanted.forEach(([f]) => { if (f.field_type === 'table_reference' && refs[f.reference_table]) refs[f.reference_table].fields.add(f.reference_display_field || ''); });
    for (const [table, r] of Object.entries(refs)) {
        const m = referenceMap[table];
        if (!m) continue;
        const cols = [...new Set([m.labelField, ...[...r.fields].filter(x => x && m.allowedDisplayFields.includes(x))])];
        const { data, error } = await c.from(table).select(['id', ...cols].join(', ')).eq('tenant_id', t).in('id', [...r.ids]);
        if (error) continue;
        (data || []).forEach(x => { refLabels[x.id] = x[m.labelField]; });
        // per-field display column
        wanted.forEach(w => {
            const f = w[0];
            if (f.field_type === 'table_reference' && f.reference_table === table && f.reference_display_field && m.allowedDisplayFields.includes(f.reference_display_field)) {
                const hit = (data || []).find(x => x.id === String(w[2]));
                if (hit) w[3] = hit[f.reference_display_field];
            }
        });
    }
    const rows = [];
    wanted.forEach(([f, lid, v, disp]) => {
        const s = toStored(f, v, refLabels);
        if (!s) return;
        if (disp) s.display_value = String(disp);
        rows.push({ tenant_id: t, document_type: cur.document_type, document_id: docId, line_id: lid, field_id: f.id, ...s, updated_by: userId || null, updated_at: new Date().toISOString() });
    });
    const { error: delErr } = await c.from('document_udf_values').delete().eq('tenant_id', t).eq('document_id', docId);
    if (delErr) throw delErr;
    if (rows.length) { const { error } = await c.from('document_udf_values').insert(rows); if (error) throw error; }
    return { saved: rows.length };
}

// Bulk read for reports: { docs: { docId: { fieldId: display } }, lines: { lineId: { fieldId: display } } }
async function lookupUdf(c, t, { documentIds = [], lineIds = [], fieldIds = [] }) {
    const out = { docs: {}, lines: {} };
    const put = v => {
        if (fieldIds.length && !fieldIds.includes(v.field_id)) return;
        if (v.line_id) (out.lines[v.line_id] = out.lines[v.line_id] || {})[v.field_id] = v.display_value;
        else (out.docs[v.document_id] = out.docs[v.document_id] || {})[v.field_id] = v.display_value;
    };
    const docs = [...new Set(documentIds.filter(Boolean))];
    (await inChunks(docs, async ids => {
        const { data, error } = await c.from('document_udf_values').select('document_id, line_id, field_id, display_value').eq('tenant_id', t).in('document_id', ids);
        if (error) throw error;
        return data || [];
    })).forEach(put);
    return out;
}

// UDF values saved on EARLIER documents of the same type - for the same
// customer / vendor first - so while making the next transaction the user
// can see what was entered before and copy it. Returns the recent documents
// with their master values, and per field the last value used (same party
// preferred) plus the distinct values used recently (for suggestions).
async function udfHistory(c, t, { docType, partyId = null, excludeId = null, limit = 10 }) {
    const key = docTypeOf(docType), cfg = DOC_TYPES[key];
    if (!cfg) throw Object.assign(new Error(`Unknown document type "${docType}"`), { status: 400 });
    const { data: vals, error } = await c.from('document_udf_values')
        .select('document_id, line_id, field_id, value_text, value_number, value_date, value_bool, value_ref_id, display_value, updated_at')
        .eq('tenant_id', t).eq('document_type', key).is('line_id', null).order('updated_at', { ascending: false }).limit(2000);
    if (error) throw error;
    const docIds = [...new Set((vals || []).map(v => v.document_id).filter(id => id !== excludeId))];
    const cols = ['id', 'doc_no', 'doc_date', 'status', ...(cfg.party ? [cfg.party] : []), 'customer_name_snapshot', 'vendor_name_snapshot', 'party_name_snapshot'];
    const heads = await inChunks(docIds, async ids => {
        const { data, error: e2 } = await c.from(cfg.table).select('*').eq('tenant_id', t).in('id', ids);
        if (e2) throw e2;
        return (data || []).map(h => Object.fromEntries(cols.filter(k => k in h).map(k => [k, h[k]])));
    });
    const headById = Object.fromEntries(heads.map(h => [h.id, h]));
    const has = x => x !== null && x !== undefined;
    const cell = v => ({ value: has(v.value_ref_id) ? v.value_ref_id : has(v.value_date) ? String(v.value_date).slice(0, 10) : has(v.value_bool) ? v.value_bool : has(v.value_number) ? Number(v.value_number) : v.value_text, display: v.display_value });
    const docs = new Map();
    (vals || []).forEach(v => {
        const h = headById[v.document_id];
        if (!h || h.status === 'cancelled') return;
        if (!docs.has(h.id)) docs.set(h.id, { doc_id: h.id, doc_no: h.doc_no, doc_date: String(h.doc_date || '').slice(0, 10), party_id: cfg.party ? h[cfg.party] || null : null,
            party_name: h.customer_name_snapshot || h.vendor_name_snapshot || h.party_name_snapshot || '', updated_at: v.updated_at, values: {} });
        docs.get(h.id).values[v.field_id] = cell(v);
    });
    const all = [...docs.values()].sort((a, b) => String(b.doc_date).localeCompare(String(a.doc_date)) || String(b.updated_at).localeCompare(String(a.updated_at)));
    const same = partyId ? all.filter(d => d.party_id === partyId) : [];
    const last = {}, suggestions = {};
    [...same, ...all].forEach(d => Object.entries(d.values).forEach(([fid, v]) => {
        if (!last[fid] && v.display !== null && v.display !== '') last[fid] = { ...v, doc_no: d.doc_no, doc_date: d.doc_date, same_party: !!partyId && d.party_id === partyId };
        const list = suggestions[fid] = suggestions[fid] || [];
        if (v.display && list.length < 15 && !list.some(x => x.display === v.display)) list.push(v);
    }));
    const n = Math.max(1, Math.min(50, Number(limit) || 10));
    return { document_type: key, party_id: partyId, same_party: same.slice(0, n), recent: all.slice(0, n), last, suggestions };
}

// ---------- Manual Document Printing ----------
const cmpDocNo = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });

async function printList(c, t, q, userId) {
    const key = docTypeOf(q.document_type), cfg = DOC_TYPES[key];
    if (!cfg) throw Object.assign(new Error('Choose a document type'), { status: 400 });
    const f = {
        from: q.from_date || null, to: q.to_date || null, partyIds: csv(q.party_ids), agentIds: csv(q.agent_ids), areaIds: csv(q.area_ids), routeIds: csv(q.route_ids),
        branchIds: csv(q.branch_ids), statuses: csv(q.statuses), docFrom: (q.doc_no_from || '').trim(), docTo: (q.doc_no_to || '').trim(),
        search: (q.search || '').trim().toLowerCase(), printed: q.printed || 'all'
    };
    const headers = await fetchAll(() => {
        let x = c.from(cfg.table).select('*').eq('tenant_id', t);
        if (f.from) x = x.gte('doc_date', f.from);
        if (f.to) x = x.lte('doc_date', f.to);
        if (f.statuses.length) x = x.in('status', f.statuses);
        if (f.branchIds.length) x = x.in('branch_id', f.branchIds);
        if (cfg.party && f.partyIds.length) x = x.in(cfg.party, f.partyIds);
        return x.order('doc_date').order('id');
    });
    // party master for the name and the area / route / agent a document doesn't carry itself
    const partyIds = cfg.party ? [...new Set(headers.map(h => h[cfg.party]).filter(Boolean))] : [];
    const parties = Object.fromEntries((await inChunks(partyIds, async ids => {
        const { data, error } = await c.from('ledger_accounts').select('id, account_code, account_name, area_id, route_id, agent_id, billing_address, city, phone_office, contact_person_mobile')
            .eq('tenant_id', t).in('id', ids);
        if (error) throw error;
        return data || [];
    })).map(p => [p.id, p]));
    const [areas, routes, agents] = await Promise.all([
        fetchAll(() => c.from('areas').select('id, area_name, parent_area_id').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('routes').select('id, route_name').eq('tenant_id', t).order('id')),
        fetchAll(() => c.from('salesman_agents').select('id, agent_name').eq('tenant_id', t).order('id'))
    ]);
    const areaById = Object.fromEntries(areas.map(a => [a.id, a])), routeById = Object.fromEntries(routes.map(r => [r.id, r])), agentById = Object.fromEntries(agents.map(a => [a.id, a]));
    // an area includes the areas under it
    let areaSet = null;
    if (f.areaIds.length) {
        areaSet = new Set(f.areaIds);
        for (let grew = true; grew;) { grew = false; areas.forEach(a => { if (a.parent_area_id && areaSet.has(a.parent_area_id) && !areaSet.has(a.id)) { areaSet.add(a.id); grew = true; } }); }
    }
    let rows = headers.map(h => {
        const p = cfg.party ? parties[h[cfg.party]] : null;
        const areaId = h.area_id || p?.area_id || null, routeId = h.route_id || p?.route_id || null, agentId = h.agent_id || p?.agent_id || null;
        return {
            id: h.id, doc_no: h.doc_no, doc_date: String(h.doc_date || '').slice(0, 10), status: h.status, branch_id: h.branch_id || null, branch_name: h.branch_name_snapshot || '',
            party_id: cfg.party ? h[cfg.party] || null : null,
            party_name: h.customer_name_snapshot || h.vendor_name_snapshot || h.party_name_snapshot || p?.account_name || h.cash_vendor_name || h.cash_customer_name || '',
            party_address: p ? p.billing_address || p.city || '' : '', party_phone: p ? p.phone_office || p.contact_person_mobile || '' : '',
            area_id: areaId, area_name: h.area_name_snapshot || areaById[areaId]?.area_name || '', route_id: routeId, route_name: h.route_name_snapshot || routeById[routeId]?.route_name || '',
            agent_id: agentId, agent_name: h.agent_name_snapshot || agentById[agentId]?.agent_name || '',
            amount: Number(h.net_amount ?? h.grand_total ?? h.total_amount ?? h.amount ?? h.cheque_amount ?? h.total_debit ?? 0) || 0,
            narration: h.narration || h.remarks_text || '',
            extra: key === 'production_order' ? h.output_product_name_snapshot || '' : key === 'stock_transfer' ? [h.from_warehouse_name_snapshot, h.to_warehouse_name_snapshot].filter(Boolean).join(' → ') : ''
        };
    });
    rows = rows.filter(r => {
        if (areaSet && !areaSet.has(r.area_id)) return false;
        if (f.routeIds.length && !f.routeIds.includes(r.route_id)) return false;
        if (f.agentIds.length && !f.agentIds.includes(r.agent_id)) return false;
        if (f.docFrom && cmpDocNo(r.doc_no, f.docFrom) < 0) return false;
        if (f.docTo && cmpDocNo(r.doc_no, f.docTo) > 0) return false;
        if (f.search && ![r.doc_no, r.party_name, r.narration, r.extra].some(v => String(v || '').toLowerCase().includes(f.search))) return false;
        return true;
    });
    // how often each was printed
    const logs = await inChunks(rows.map(r => r.id), async ids => {
        const { data, error } = await c.from('document_print_log').select('document_id, printed_at').eq('tenant_id', t).in('document_id', ids);
        if (error) return [];                                  // log table missing -> no counts, list still works
        return data || [];
    });
    const printed = {};
    logs.forEach(l => { const p = printed[l.document_id] = printed[l.document_id] || { count: 0, last: null }; p.count++; if (!p.last || l.printed_at > p.last) p.last = l.printed_at; });
    rows.forEach(r => { r.print_count = printed[r.id]?.count || 0; r.last_printed_at = printed[r.id]?.last || null; });
    if (f.printed === 'printed') rows = rows.filter(r => r.print_count > 0);
    if (f.printed === 'not_printed') rows = rows.filter(r => r.print_count === 0);
    rows.sort((a, b) => cmpDocNo(a.doc_no, b.doc_no) || a.doc_date.localeCompare(b.doc_date));
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return { document_type: key, label: cfg.label, has_party: !!cfg.party, rows,
        summary: { count: rows.length, doc_no_from: rows[0]?.doc_no || '', doc_no_to: rows[rows.length - 1]?.doc_no || '', amount: Math.round(total * 100) / 100 },
        udf_voucher_types: cfg.udfAll || [cfg.udf] };
}

async function logPrints(c, t, userId, docType, ids, templateId) {
    const key = docTypeOf(docType);
    if (!key || !ids.length) return { logged: 0 };
    const rows = ids.map(id => ({ tenant_id: t, document_type: key, document_id: id, template_id: templateId || null, printed_by: userId || null }));
    const { error } = await c.from('document_print_log').insert(rows);
    if (error) throw error;
    return { logged: rows.length };
}

const docTypeList = () => Object.entries(DOC_TYPES).map(([k, d]) => ({ key: k, label: d.label, group: d.group, has_party: !!d.party,
    party_side: d.party === SALES ? 'customer' : d.party === PURCHASE ? 'vendor' : d.party ? 'party' : null, udf_voucher_types: d.udfAll || [d.udf] }));

module.exports = { DOC_TYPES, docTypeOf, udfTypesOf, udfFields, readDocUdf, saveDocUdf, lookupUdf, udfHistory, toStored, printList, logPrints, docTypeList, cmpDocNo };
