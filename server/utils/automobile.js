// =============================================
// utils/automobile.js
// Automobile dealership (System Control > Business Nature = Automobile).
// Showroom:  enquiry (+ follow-ups, test drive, booking, lost) -> vehicle in
//            stock (by chassis) -> PDI checklist -> delivery to the customer
//            (documents, keys, accessories; free-service reminders made)
// Workshop:  job card (vehicle in, complaints) -> labour, parts issued from
//            stock, outside work -> ready for delivery -> delivered (job
//            invoice posted) -> next service reminder
// =============================================
const P = require('./poultry');
const { defaultVatLedger } = require('./vatLedger');

const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const UUID = /^[0-9a-f-]{36}$/i;
const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const num = v => Number(v) || 0;
const idOrNull = v => (v && UUID.test(String(v)) ? v : null);
const str = (v, n = 200) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
const SA = () => require('../routes/stockAdjustmentRoutes');

async function requireOn(c, t) {
    const f = await P.features(c, t);
    if (!f.automobile?.enabled) throw httpError('Automobile module is off - choose Business Nature "Automobile" in System Control', 403);
    return f;
}

// ---------------------------------------------------------------- settings
const LEDGERS = ['parts_sales_ledger_id', 'labour_income_ledger_id', 'outside_work_income_ledger_id', 'outside_work_cost_ledger_id', 'parts_consumption_ledger_id', 'cash_ledger_id'];
const DEFAULT_FREE = [{ name: '1st free service', days: 30, km: 1000 }, { name: '2nd free service', days: 120, km: 5000 }, { name: '3rd free service', days: 240, km: 10000 }];
const DEFAULT_PDI = ['Exterior body / paint', 'Glass & mirrors', 'Tyres & pressure (incl. spare)', 'Engine oil level', 'Coolant / brake fluid', 'Battery & terminals', 'Lights & indicators',
    'Horn & wipers', 'AC / heater', 'Infotainment / audio', 'Brakes & handbrake', 'Tool kit & jack', 'Owner manual & service book', 'Road test'];
async function getSettings(c, t) {
    const { data } = await c.from('auto_settings').select('*').eq('tenant_id', t).maybeSingle();
    const D = { tenant_id: t, parts_warehouse_id: null, vat_percent: 13, service_interval_days: 120, service_interval_km: 5000, free_services: DEFAULT_FREE, pdi_checklist: DEFAULT_PDI };
    LEDGERS.forEach(k => { D[k] = null; });
    const s = { ...D, ...(data || {}) };
    ['free_services', 'pdi_checklist'].forEach(k => { if (typeof s[k] === 'string') { try { s[k] = JSON.parse(s[k]); } catch { s[k] = D[k]; } } if (!Array.isArray(s[k])) s[k] = D[k]; });
    return s;
}
async function saveSettings(c, t, userId, b) {
    const row = { tenant_id: t, updated_by: userId, updated_at: new Date().toISOString() };
    [...LEDGERS, 'parts_warehouse_id'].forEach(k => { if (k in b) row[k] = idOrNull(b[k]); });
    if ('vat_percent' in b) row.vat_percent = Math.min(50, Math.max(0, num(b.vat_percent)));
    if ('service_interval_days' in b) row.service_interval_days = Math.min(730, Math.max(15, parseInt(b.service_interval_days, 10) || 120));
    if ('service_interval_km' in b) row.service_interval_km = Math.min(100000, Math.max(500, parseInt(b.service_interval_km, 10) || 5000));
    if ('free_services' in b) row.free_services = (Array.isArray(b.free_services) ? b.free_services : []).filter(x => x && str(x.name)).slice(0, 10)
        .map(x => ({ name: str(x.name, 80), days: Math.max(1, parseInt(x.days, 10) || 30), km: Math.max(0, parseInt(x.km, 10) || 0) }));
    if ('pdi_checklist' in b) row.pdi_checklist = (Array.isArray(b.pdi_checklist) ? b.pdi_checklist : []).map(x => str(x, 120)).filter(Boolean).slice(0, 60);
    const { data: ex } = await c.from('auto_settings').select('tenant_id').eq('tenant_id', t).maybeSingle();
    const { error } = ex ? await c.from('auto_settings').update(row).eq('tenant_id', t) : await c.from('auto_settings').insert(row);
    if (error) throw error;
    return getSettings(c, t);
}

// ---------------------------------------------------------------- helpers
async function nextNo(c, t, table, prefix) {
    const { data } = await c.from(table).select('doc_no').eq('tenant_id', t);
    const n = (data || []).reduce((m, r) => { const x = parseInt(String(r.doc_no).replace(/^\D+/, ''), 10); return Number.isFinite(x) && x > m ? x : m; }, 0) + 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
}
async function ledgerName(c, id) {
    if (!id) return null;
    return (await c.from('ledger_accounts').select('account_name').eq('id', id).maybeSingle()).data?.account_name || null;
}
async function postGl(c, t, userId, { type, docId, date, narration, rows }) {
    const lines = rows.filter(r => r.ledger && (round2(r.dr) || round2(r.cr)));
    const dr = round2(lines.reduce((s, r) => s + round2(r.dr), 0)), cr = round2(lines.reduce((s, r) => s + round2(r.cr), 0));
    if (Math.abs(dr - cr) > 0.01) throw httpError(`Posting does not balance (Dr ${dr} / Cr ${cr})`);
    if (!lines.length) return;
    const { data: batch, error } = await c.from('ledger_transaction_batches').insert({ tenant_id: t, document_type: type, document_id: docId, batch_date: date, narration, created_by: userId }).select().single();
    if (error) throw error;
    const { error: e2 } = await c.from('ledger_transaction_lines').insert(lines.map(r => ({ tenant_id: t, batch_id: batch.id, ledger_account_id: r.ledger, debit_amount: round2(r.dr), credit_amount: round2(r.cr), narration: r.narration || null })));
    if (e2) { await c.from('ledger_transaction_batches').delete().eq('id', batch.id); throw e2; }
}
async function unpostGl(c, type, docId) {
    const { data: batches } = await c.from('ledger_transaction_batches').select('id').eq('document_type', type).eq('document_id', docId);
    for (const b of batches || []) {
        await c.from('ledger_transaction_lines').delete().eq('batch_id', b.id);
        await c.from('ledger_transaction_batches').delete().eq('id', b.id);
    }
}
async function postStock(c, t, userId, { date, direction, lines, narration, override_negative }) {
    const S = await getSettings(c, t);
    const details = [];
    for (const l of lines) {
        const rate = l.rate !== undefined && l.rate !== null ? Number(l.rate) : await P.costRate(c, t, l.product_id, l.uom_id, date);
        details.push({ product_id: l.product_id, qty: Number(l.qty), uom_id: l.uom_id || null, warehouse_id: l.warehouse_id || S.parts_warehouse_id || null, direction,
            rate: Math.round(rate * 10000) / 10000, line_reason: direction === 'out' ? 'consumption' : 'production', narration: null });
    }
    if (details.some(d => !d.warehouse_id)) throw httpError('Choose the parts store (warehouse) in Automobile Setup');
    const body = { doc_date: date, reason: direction === 'out' ? 'consumption' : 'production', warehouse_id: details[0].warehouse_id, narration, source_module: 'automobile', details,
        ...(S.parts_consumption_ledger_id ? (direction === 'out' ? { loss_ledger_id: S.parts_consumption_ledger_id } : { gain_ledger_id: S.parts_consumption_ledger_id }) : {}) };
    const doc = await SA().createAdjustment(c, t, userId, body);
    try {
        const out = await SA().setAdjustmentStatus(c, t, userId, doc.id, { status: 'posted', override_negative_stock_warning: !!override_negative }, { forceOwnLedgers: !!S.parts_consumption_ledger_id });
        const { data: det } = await c.from('stock_adjustment_details').select('product_id, qty, uom_id, rate, amount').eq('adjustment_id', doc.id).order('display_order');
        return { id: doc.id, doc_no: doc.doc_no, lines: det || [], warnings: out.warnings };
    } catch (e) {
        await c.from('stock_adjustments').delete().eq('id', doc.id).eq('status', 'draft');
        throw e;
    }
}

// ---------------------------------------------------------------- vehicles
async function loadVehicle(c, t, id) {
    if (!UUID.test(String(id))) throw httpError('Vehicle not found', 404);
    const { data } = await c.from('auto_vehicles').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!data) throw httpError('Vehicle not found', 404);
    return data;
}
async function saveVehicle(c, t, userId, b, id) {
    await requireOn(c, t);
    const old = id ? await loadVehicle(c, t, id) : null;
    const chassis = str(b.chassis_no ?? old?.chassis_no, 60);
    if (!chassis) throw httpError('Chassis no. is required');
    const { data: same } = await c.from('auto_vehicles').select('id').eq('tenant_id', t).eq('chassis_no', chassis.toUpperCase());
    if ((same || []).some(x => x.id !== id)) throw httpError(`Chassis ${chassis.toUpperCase()} is already entered`);
    const row = { tenant_id: t, chassis_no: chassis.toUpperCase(), updated_at: new Date().toISOString() };
    ['engine_no', 'model_name', 'variant', 'color', 'reg_no', 'customer_name', 'customer_phone', 'remarks'].forEach(k => { if (k in b) row[k] = str(b[k], k === 'remarks' ? 2000 : 150); });
    ['product_id', 'customer_ledger_id', 'purchase_bill_id'].forEach(k => { if (k in b) row[k] = idOrNull(b[k]); });
    if ('model_year' in b) row.model_year = parseInt(b.model_year, 10) || null;
    if ('odometer' in b) row.odometer = Math.max(0, parseInt(b.odometer, 10) || 0);
    if (row.reg_no) row.reg_no = row.reg_no.toUpperCase();
    if (!old) {
        row.ownership = b.ownership === 'customer' ? 'customer' : 'stock';
        row.status = row.ownership === 'customer' ? 'customer' : 'in_stock';
        if (!row.model_name && row.product_id) row.model_name = (await c.from('products').select('product_name').eq('id', row.product_id).maybeSingle()).data?.product_name || null;
        if (row.ownership === 'customer' && !row.customer_name && row.customer_ledger_id) row.customer_name = await ledgerName(c, row.customer_ledger_id);
        row.created_by = userId;
        const { data, error } = await c.from('auto_vehicles').insert(row).select().single();
        if (error) throw error;
        return vehicleDetail(c, t, data.id);
    }
    const { error } = await c.from('auto_vehicles').update(row).eq('id', id);
    if (error) throw error;
    return vehicleDetail(c, t, id);
}
async function listVehicles(c, t, q = {}) {
    await requireOn(c, t);
    let b = c.from('auto_vehicles').select('*').eq('tenant_id', t);
    if (q.ownership === 'stock' || q.ownership === 'customer') b = b.eq('ownership', q.ownership);
    if (q.status && q.status !== 'all') b = b.eq('status', q.status);
    const { data, error } = await b.order('created_at', { ascending: false });
    if (error) throw error;
    const s = String(q.search || '').trim().toLowerCase();
    return (data || []).filter(v => !s || [v.chassis_no, v.engine_no, v.reg_no, v.model_name, v.customer_name, v.customer_phone].some(x => String(x || '').toLowerCase().includes(s)));
}
async function vehicleDetail(c, t, id) {
    const v = await loadVehicle(c, t, id);
    const [{ data: pdis }, { data: dels }, { data: jobs }, { data: rems }] = await Promise.all([
        c.from('auto_pdis').select('*').eq('vehicle_id', id).order('pdi_date'),
        c.from('auto_deliveries').select('*').eq('vehicle_id', id).order('delivery_date'),
        c.from('auto_job_cards').select('id, doc_no, date_in, odometer_in, service_type, status, total_amount, delivered_on').eq('vehicle_id', id).order('date_in', { ascending: false }),
        c.from('auto_service_reminders').select('*').eq('vehicle_id', id).order('due_date')
    ]);
    return { ...v, pdis: pdis || [], deliveries: dels || [], job_cards: jobs || [], reminders: rems || [] };
}

// ---------------------------------------------------------------- enquiries
const SOURCES = ['walk_in', 'phone', 'referral', 'social', 'event', 'web', 'other'];
async function saveEnquiry(c, t, userId, b, id) {
    await requireOn(c, t);
    const old = id ? (await c.from('auto_enquiries').select('*').eq('tenant_id', t).eq('id', id).maybeSingle()).data : null;
    if (id && !old) throw httpError('Enquiry not found', 404);
    const name = str(b.customer_name ?? old?.customer_name, 150);
    if (!name) throw httpError('Customer name is required');
    const row = { tenant_id: t, customer_name: name, updated_at: new Date().toISOString() };
    ['phone', 'email', 'address', 'model_name', 'variant', 'color', 'exchange_vehicle', 'remarks'].forEach(k => { if (k in b) row[k] = str(b[k], k === 'address' || k === 'remarks' ? 1000 : 150); });
    ['customer_ledger_id', 'product_id', 'salesperson_id'].forEach(k => { if (k in b) row[k] = idOrNull(b[k]); });
    ['enquiry_date', 'test_drive_date', 'follow_up_date'].forEach(k => { if (k in b) row[k] = b[k] ? String(b[k]).slice(0, 10) : null; });
    if ('budget' in b) row.budget = b.budget === '' || b.budget === null ? null : round2(b.budget);
    if ('finance_required' in b) row.finance_required = !!b.finance_required;
    if ('source' in b) row.source = SOURCES.includes(b.source) ? b.source : 'other';
    if ('temperature' in b) row.temperature = ['hot', 'warm', 'cold'].includes(b.temperature) ? b.temperature : 'warm';
    if (!row.phone && !old?.phone) throw httpError('Phone number is required (for follow-up)');
    if (!row.model_name && row.product_id) row.model_name = (await c.from('products').select('product_name').eq('id', row.product_id).maybeSingle()).data?.product_name || null;
    if (!old) {
        Object.assign(row, { doc_no: await nextNo(c, t, 'auto_enquiries', 'ENQ-'), enquiry_date: row.enquiry_date || today(), status: 'open', source: row.source || 'walk_in', temperature: row.temperature || 'warm', created_by: userId });
        const { data, error } = await c.from('auto_enquiries').insert(row).select().single();
        if (error) throw error;
        return enquiryDetail(c, t, data.id);
    }
    const { error } = await c.from('auto_enquiries').update(row).eq('id', id);
    if (error) throw error;
    return enquiryDetail(c, t, id);
}
async function enquiryDetail(c, t, id) {
    const { data: e } = await c.from('auto_enquiries').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!e) throw httpError('Enquiry not found', 404);
    const { data: f } = await c.from('auto_enquiry_followups').select('*').eq('enquiry_id', id).order('followup_date');
    const v = e.vehicle_id ? (await c.from('auto_vehicles').select('id, chassis_no, model_name, color, status').eq('id', e.vehicle_id).maybeSingle()).data : null;
    return { ...e, followups: f || [], vehicle: v };
}
async function addFollowup(c, t, userId, id, b) {
    await requireOn(c, t);
    const e = await enquiryDetail(c, t, id);
    if (!str(b.note, 2000)) throw httpError('Write what was discussed');
    const date = String(b.followup_date || today()).slice(0, 10);
    const { error } = await c.from('auto_enquiry_followups').insert({ tenant_id: t, enquiry_id: id, followup_date: date, mode: str(b.mode, 12) || 'call', note: str(b.note, 2000), next_date: b.next_date || null, created_by: userId });
    if (error) throw error;
    const up = { follow_up_date: b.next_date || null, updated_at: new Date().toISOString() };
    if (['hot', 'warm', 'cold'].includes(b.temperature)) up.temperature = b.temperature;
    await c.from('auto_enquiries').update(up).eq('id', e.id);
    return enquiryDetail(c, t, id);
}
/** book (with a vehicle / booking amount), mark lost, or reopen */
async function setEnquiryStatus(c, t, userId, id, b) {
    await requireOn(c, t);
    const e = await enquiryDetail(c, t, id);
    if (e.status === 'delivered') throw httpError('This enquiry is already delivered');
    const up = { updated_at: new Date().toISOString() };
    if (b.status === 'booked') {
        const vid = idOrNull(b.vehicle_id);
        if (vid) {
            const v = await loadVehicle(c, t, vid);
            if (v.ownership !== 'stock' || !['in_stock', 'pdi_done'].includes(v.status) && !(v.status === 'booked' && e.vehicle_id === v.id)) throw httpError(`Vehicle ${v.chassis_no} is not free in stock`);
            await c.from('auto_vehicles').update({ status: 'booked', updated_at: new Date().toISOString() }).eq('id', vid);
        }
        if (e.vehicle_id && e.vehicle_id !== vid) await c.from('auto_vehicles').update({ status: 'in_stock' }).eq('id', e.vehicle_id).eq('status', 'booked');
        Object.assign(up, { status: 'booked', vehicle_id: vid, booking_amount: round2(b.booking_amount), booking_date: b.booking_date || today(), temperature: 'hot' });
    } else if (b.status === 'lost') {
        if (!str(b.lost_reason, 500)) throw httpError('Give the reason it was lost');
        if (e.vehicle_id) await c.from('auto_vehicles').update({ status: 'in_stock' }).eq('id', e.vehicle_id).eq('status', 'booked');
        Object.assign(up, { status: 'lost', lost_reason: str(b.lost_reason, 500), vehicle_id: null });
    } else if (b.status === 'open') {
        Object.assign(up, { status: 'open', lost_reason: null });
    } else throw httpError('Invalid status');
    await c.from('auto_enquiries').update(up).eq('id', id);
    return enquiryDetail(c, t, id);
}
async function listEnquiries(c, t, q = {}) {
    await requireOn(c, t);
    let b = c.from('auto_enquiries').select('*').eq('tenant_id', t);
    if (q.status && q.status !== 'all') b = b.eq('status', q.status);
    if (q.date_from) b = b.gte('enquiry_date', q.date_from);
    if (q.date_to) b = b.lte('enquiry_date', q.date_to);
    const { data, error } = await b.order('enquiry_date', { ascending: false });
    if (error) throw error;
    let rows = data || [];
    if (q.due === 'today') rows = rows.filter(r => r.status === 'open' && r.follow_up_date && String(r.follow_up_date).slice(0, 10) <= today());
    const s = String(q.search || '').trim().toLowerCase();
    if (s) rows = rows.filter(r => [r.doc_no, r.customer_name, r.phone, r.model_name].some(x => String(x || '').toLowerCase().includes(s)));
    return rows;
}

// ---------------------------------------------------------------- PDI & delivery
async function savePdi(c, t, userId, vehicleId, b) {
    await requireOn(c, t);
    const v = await loadVehicle(c, t, vehicleId);
    if (v.ownership !== 'stock' || v.status === 'delivered') throw httpError('PDI is done on a new vehicle before delivery');
    const checklist = (Array.isArray(b.checklist) ? b.checklist : []).filter(x => x && str(x.item)).map(x => ({ item: str(x.item, 120), ok: !!x.ok, remark: str(x.remark, 300) }));
    if (!checklist.length) throw httpError('Fill the PDI checklist');
    const failed = checklist.filter(x => !x.ok);
    const result = failed.length ? 'fail' : 'pass';
    const { data, error } = await c.from('auto_pdis').insert({ tenant_id: t, vehicle_id: v.id, doc_no: await nextNo(c, t, 'auto_pdis', 'PDI-'), pdi_date: String(b.pdi_date || today()).slice(0, 10),
        inspector: str(b.inspector, 120), odometer: Math.max(0, parseInt(b.odometer, 10) || 0), fuel_level: str(b.fuel_level, 20), checklist, result, remarks: str(b.remarks, 1000), created_by: userId }).select().single();
    if (error) throw error;
    if (result === 'pass' && v.status === 'in_stock') await c.from('auto_vehicles').update({ status: 'pdi_done', odometer: data.odometer || v.odometer }).eq('id', v.id);
    return { ...data, failed: failed.map(x => x.item) };
}
async function deliverVehicle(c, t, userId, vehicleId, b) {
    await requireOn(c, t);
    const v = await loadVehicle(c, t, vehicleId);
    if (v.ownership !== 'stock' || v.status === 'delivered') throw httpError('This vehicle is already delivered');
    const { data: pdis } = await c.from('auto_pdis').select('result').eq('vehicle_id', v.id);
    if (!(pdis || []).some(p => p.result === 'pass') && !b.skip_pdi) throw httpError('PDI is not passed for this vehicle - do the PDI first');
    const enquiry = idOrNull(b.enquiry_id) ? (await c.from('auto_enquiries').select('*').eq('tenant_id', t).eq('id', b.enquiry_id).maybeSingle()).data : null;
    const custLedger = idOrNull(b.customer_ledger_id) || enquiry?.customer_ledger_id || null;
    const name = str(b.customer_name, 150) || enquiry?.customer_name || await ledgerName(c, custLedger);
    if (!name) throw httpError('Customer is required');
    const date = String(b.delivery_date || today()).slice(0, 10);
    const docs = (Array.isArray(b.documents) ? b.documents : []).filter(x => x && str(x.item)).map(x => ({ item: str(x.item, 120), given: !!x.given }));
    const odo = Math.max(0, parseInt(b.odometer, 10) || v.odometer || 0);
    const { data: del, error } = await c.from('auto_deliveries').insert({ tenant_id: t, doc_no: await nextNo(c, t, 'auto_deliveries', 'DLV-'), vehicle_id: v.id, enquiry_id: enquiry?.id || null,
        customer_ledger_id: custLedger, customer_name: name, customer_phone: str(b.customer_phone, 40) || enquiry?.phone || null, delivery_date: date, sales_bill_id: idOrNull(b.sales_bill_id),
        finance_company: str(b.finance_company, 150), reg_no: str(b.reg_no, 40)?.toUpperCase() || null, odometer: odo, keys_given: parseInt(b.keys_given, 10) || 2,
        accessories: str(b.accessories, 1000), documents: docs, delivered_by: str(b.delivered_by, 120), status: 'delivered', remarks: str(b.remarks, 1000), created_by: userId }).select().single();
    if (error) throw error;
    await c.from('auto_vehicles').update({ ownership: 'customer', status: 'delivered', customer_ledger_id: custLedger, customer_name: name, customer_phone: del.customer_phone,
        sale_date: date, reg_no: del.reg_no || v.reg_no, odometer: odo, updated_at: new Date().toISOString() }).eq('id', v.id);
    if (enquiry) await c.from('auto_enquiries').update({ status: 'delivered', vehicle_id: v.id, updated_at: new Date().toISOString() }).eq('id', enquiry.id);
    const S = await getSettings(c, t);
    const rems = S.free_services.map(f => ({ tenant_id: t, vehicle_id: v.id, title: f.name, service_type: 'free', due_date: addDays(date, f.days), due_km: odo + (f.km || 0), status: 'pending', source: 'delivery' }));
    if (rems.length) await c.from('auto_service_reminders').insert(rems);
    return { ...del, reminders_made: rems.length };
}
async function cancelDelivery(c, t, userId, id, b) {
    const { data: d } = await c.from('auto_deliveries').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!d) throw httpError('Delivery not found', 404);
    if (d.status === 'cancelled') throw httpError('Already cancelled');
    const { data: jobs } = await c.from('auto_job_cards').select('doc_no').eq('vehicle_id', d.vehicle_id).neq('status', 'cancelled');
    if ((jobs || []).length) throw httpError(`The vehicle already has job card(s) ${jobs.map(j => j.doc_no).join(', ')}`);
    await c.from('auto_deliveries').update({ status: 'cancelled', remarks: [d.remarks, `Cancelled: ${b.reason || ''}`].filter(Boolean).join(' | ') }).eq('id', id);
    await c.from('auto_vehicles').update({ ownership: 'stock', status: 'pdi_done', customer_ledger_id: null, customer_name: null, customer_phone: null, sale_date: null }).eq('id', d.vehicle_id);
    await c.from('auto_service_reminders').delete().eq('vehicle_id', d.vehicle_id).eq('source', 'delivery').eq('status', 'pending');
    if (d.enquiry_id) await c.from('auto_enquiries').update({ status: 'booked' }).eq('id', d.enquiry_id);
    return { cancelled: true };
}

// ---------------------------------------------------------------- job cards
const JOB_TYPES = ['free', 'paid', 'warranty', 'accident', 'running'];
async function loadJob(c, t, id) {
    if (!UUID.test(String(id))) throw httpError('Job card not found', 404);
    const { data } = await c.from('auto_job_cards').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!data) throw httpError('Job card not found', 404);
    return data;
}
function cleanLabour(list) {
    return (Array.isArray(list) ? list : []).filter(l => l && str(l.description)).slice(0, 100).map(l => {
        const hours = num(l.hours), rate = round2(l.rate);
        const amount = l.amount !== undefined && l.amount !== '' && !hours ? round2(l.amount) : round2(hours * rate);
        return { description: str(l.description, 300), hours, rate, amount, chargeable: l.chargeable !== false };
    });
}
async function createJob(c, t, userId, b) {
    await requireOn(c, t);
    let vid = idOrNull(b.vehicle_id);
    if (!vid) {
        // a customer's vehicle not yet in the list: add it by chassis / registration
        if (!str(b.chassis_no) && !str(b.reg_no)) throw httpError('Choose the vehicle, or enter its chassis / registration no.');
        const chassis = (str(b.chassis_no, 60) || `REG-${str(b.reg_no, 40)}`).toUpperCase();
        const { data: ex } = await c.from('auto_vehicles').select('id').eq('tenant_id', t).eq('chassis_no', chassis).maybeSingle();
        vid = ex?.id || (await saveVehicle(c, t, userId, { chassis_no: chassis, reg_no: b.reg_no, model_name: b.model_name, customer_ledger_id: b.customer_ledger_id, customer_name: b.customer_name, customer_phone: b.customer_phone, ownership: 'customer' })).id;
    }
    const v = await loadVehicle(c, t, vid);
    if (v.ownership === 'stock' && v.status !== 'delivered') {
        // a new vehicle in stock can come in for pre-sale work too (accessory fitting, repair)
    }
    const { data: open } = await c.from('auto_job_cards').select('doc_no').eq('tenant_id', t).eq('vehicle_id', vid).in('status', ['open', 'in_progress', 'outside_work', 'ready']);
    if ((open || []).length) throw httpError(`This vehicle already has an open job card ${open[0].doc_no}`);
    const odo = Math.max(0, parseInt(b.odometer_in, 10) || 0);
    if (odo && v.odometer && odo < v.odometer) throw httpError(`Odometer ${odo} is less than the last reading ${v.odometer}`);
    // a pending reminder this visit answers
    const { data: rems } = await c.from('auto_service_reminders').select('id, due_date, title').eq('vehicle_id', vid).in('status', ['pending', 'contacted', 'booked']).order('due_date');
    const labour = cleanLabour(b.labour);
    const row = { tenant_id: t, doc_no: await nextNo(c, t, 'auto_job_cards', 'JC-'), vehicle_id: vid, customer_ledger_id: idOrNull(b.customer_ledger_id) || v.customer_ledger_id || null,
        customer_name: str(b.customer_name, 150) || v.customer_name, customer_phone: str(b.customer_phone, 40) || v.customer_phone, date_in: String(b.date_in || today()).slice(0, 10),
        odometer_in: odo, fuel_level: str(b.fuel_level, 20), service_type: JOB_TYPES.includes(b.service_type) ? b.service_type : 'paid', complaints: str(b.complaints, 4000),
        advisor: str(b.advisor, 120), technician: str(b.technician, 120), promised_date: b.promised_date || null, status: 'open', reminder_id: (rems || [])[0]?.id || null,
        labour, labour_amount: round2(labour.filter(l => l.chargeable).reduce((s, l) => s + l.amount, 0)), created_by: userId, updated_by: userId };
    const { data, error } = await c.from('auto_job_cards').insert(row).select().single();
    if (error) throw error;
    if (odo > (v.odometer || 0)) await c.from('auto_vehicles').update({ odometer: odo }).eq('id', vid);
    if (row.reminder_id) await c.from('auto_service_reminders').update({ status: 'booked', job_id: data.id }).eq('id', row.reminder_id);
    return jobDetail(c, t, data.id);
}
async function updateJob(c, t, userId, id, b) {
    await requireOn(c, t);
    const j = await loadJob(c, t, id);
    if (['delivered', 'cancelled'].includes(j.status)) throw httpError(`The job card is ${j.status}`);
    const up = { updated_by: userId, updated_at: new Date().toISOString() };
    ['complaints', 'work_done'].forEach(k => { if (k in b) up[k] = str(b[k], 4000); });
    ['advisor', 'technician', 'fuel_level', 'customer_name', 'customer_phone'].forEach(k => { if (k in b) up[k] = str(b[k], 150); });
    if ('promised_date' in b) up.promised_date = b.promised_date || null;
    if ('service_type' in b) up.service_type = JOB_TYPES.includes(b.service_type) ? b.service_type : j.service_type;
    if ('customer_ledger_id' in b) up.customer_ledger_id = idOrNull(b.customer_ledger_id);
    if ('labour' in b) { up.labour = cleanLabour(b.labour); up.labour_amount = round2(up.labour.filter(l => l.chargeable).reduce((s, l) => s + l.amount, 0)); }
    if ('discount_amount' in b) up.discount_amount = Math.max(0, round2(b.discount_amount));
    const { error } = await c.from('auto_job_cards').update(up).eq('id', id);
    if (error) throw error;
    await refreshTotals(c, t, id);
    return jobDetail(c, t, id);
}
async function refreshTotals(c, t, id) {
    const j = await loadJob(c, t, id);
    const S = await getSettings(c, t);
    const [{ data: parts }, { data: outs }] = await Promise.all([
        c.from('auto_job_parts').select('sale_amount, chargeable').eq('job_id', id),
        c.from('auto_outside_works').select('charge_amount').eq('job_id', id)
    ]);
    const labour = (Array.isArray(j.labour) ? j.labour : []).filter(l => l.chargeable !== false).reduce((s, l) => s + num(l.amount), 0);
    const partsAmt = (parts || []).filter(p => p.chargeable).reduce((s, p) => s + num(p.sale_amount), 0);
    const outside = (outs || []).reduce((s, o) => s + num(o.charge_amount), 0);
    const taxable = Math.max(0, partsAmt + labour + outside - num(j.discount_amount));
    const vat = round2(taxable * num(S.vat_percent) / 100);
    const tot = { parts_amount: round2(partsAmt), labour_amount: round2(labour), outside_amount: round2(outside), vat_amount: vat, total_amount: round2(taxable + vat) };
    await c.from('auto_job_cards').update(tot).eq('id', id);
    return tot;
}
async function jobDetail(c, t, id) {
    const j = await loadJob(c, t, id);
    const [v, { data: parts }, { data: outs }] = await Promise.all([
        loadVehicle(c, t, j.vehicle_id),
        c.from('auto_job_parts').select('*').eq('job_id', id).order('created_at'),
        c.from('auto_outside_works').select('*').eq('job_id', id).order('sent_date')
    ]);
    const pids = [...new Set((parts || []).map(p => p.product_id))];
    const { data: ps } = pids.length ? await c.from('products').select('id, product_name, product_code').in('id', pids) : { data: [] };
    const PN = Object.fromEntries((ps || []).map(p => [p.id, p]));
    const adjIds = (parts || []).map(p => p.adjustment_id).filter(Boolean);
    const { data: adjs } = adjIds.length ? await c.from('stock_adjustments').select('id, doc_no').in('id', adjIds) : { data: [] };
    const AN = Object.fromEntries((adjs || []).map(a => [a.id, a.doc_no]));
    const partsCost = round2((parts || []).reduce((s, p) => s + num(p.cost_amount), 0));
    const outsideCost = round2((outs || []).reduce((s, o) => s + num(o.cost_amount), 0));
    const income = round2(num(j.total_amount) - num(j.vat_amount));
    return { ...j, vehicle: v, parts: (parts || []).map(p => ({ ...p, product_name: PN[p.product_id]?.product_name || '', product_code: PN[p.product_id]?.product_code || '', adjustment_no: AN[p.adjustment_id] || null })),
        outside_works: outs || [], parts_cost: partsCost, outside_cost: outsideCost, margin: round2(income - partsCost - outsideCost) };
}
/** item issue for the job card (qty < 0 or return: back to the store) */
async function issueParts(c, t, userId, id, b) {
    await requireOn(c, t);
    const j = await loadJob(c, t, id);
    if (['ready', 'delivered', 'cancelled'].includes(j.status)) throw httpError(`The job card is ${j.status} - no more parts`);
    const date = String(b.issue_date || today()).slice(0, 10);
    const ret = !!b.return;
    const lines = (Array.isArray(b.lines) ? b.lines : []).filter(l => l && idOrNull(l.product_id) && num(l.qty) > 0);
    if (!lines.length) throw httpError('Enter at least one part with a quantity');
    if (ret) {
        const { data: had } = await c.from('auto_job_parts').select('product_id, qty').eq('job_id', id);
        for (const l of lines) {
            const net = (had || []).filter(h => h.product_id === l.product_id).reduce((s, h) => s + num(h.qty), 0);
            if (num(l.qty) > net + 1e-6) throw httpError('Cannot return more of a part than was issued to this job');
        }
    }
    const products = (await c.from('products').select('id, product_name, sales_rate_sr1, mrp').in('id', lines.map(l => l.product_id))).data || [];
    const adj = await postStock(c, t, userId, { date, direction: ret ? 'in' : 'out', override_negative: !!b.override_negative_stock,
        lines: lines.map(l => ({ product_id: l.product_id, qty: num(l.qty), uom_id: idOrNull(l.uom_id), rate: ret ? l.cost_rate : undefined })),
        narration: `Job card ${j.doc_no} - parts ${ret ? 'returned' : 'issued'}` });
    const rows = adj.lines.map((a, i) => {
        const l = lines[i], p = products.find(x => x.id === l.product_id) || {};
        const sale = l.sale_rate !== undefined && l.sale_rate !== '' ? round2(l.sale_rate) : round2(p.sales_rate_sr1 || p.mrp || 0);
        const sign = ret ? -1 : 1;
        const chargeable = l.chargeable !== undefined ? !!l.chargeable : !['free', 'warranty'].includes(j.service_type);
        return { tenant_id: t, job_id: id, issue_date: date, product_id: a.product_id, qty: sign * num(a.qty), uom_id: a.uom_id || null, cost_rate: num(a.rate), cost_amount: sign * round2(a.amount),
            sale_rate: sale, sale_amount: sign * round2(num(a.qty) * sale), chargeable, adjustment_id: adj.id, created_by: userId };
    });
    const { error } = await c.from('auto_job_parts').insert(rows);
    if (error) { await P.cancelAdjustment(c, t, userId, adj.id, 'Not saved'); throw error; }
    if (j.status === 'open') await c.from('auto_job_cards').update({ status: 'in_progress' }).eq('id', id);
    await refreshTotals(c, t, id);
    return { ...(await jobDetail(c, t, id)), warnings: adj.warnings || [] };
}
async function deletePartIssue(c, t, userId, partId) {
    const { data: p } = await c.from('auto_job_parts').select('*').eq('tenant_id', t).eq('id', partId).maybeSingle();
    if (!p) throw httpError('Entry not found', 404);
    const j = await loadJob(c, t, p.job_id);
    if (['delivered', 'cancelled'].includes(j.status)) throw httpError(`The job card is ${j.status}`);
    const { data: same } = await c.from('auto_job_parts').select('id').eq('adjustment_id', p.adjustment_id);
    await P.cancelAdjustment(c, t, userId, p.adjustment_id, `Job card ${j.doc_no} part entry removed`);
    await c.from('auto_job_parts').delete().in('id', (same || []).map(x => x.id));
    await refreshTotals(c, t, j.id);
    return jobDetail(c, t, j.id);
}
async function addOutsideWork(c, t, userId, id, b) {
    await requireOn(c, t);
    const j = await loadJob(c, t, id);
    if (['ready', 'delivered', 'cancelled'].includes(j.status)) throw httpError(`The job card is ${j.status}`);
    if (!str(b.work_description)) throw httpError('Describe the outside work');
    const vendor = idOrNull(b.vendor_ledger_id);
    const { error } = await c.from('auto_outside_works').insert({ tenant_id: t, job_id: id, doc_no: await nextNo(c, t, 'auto_outside_works', 'OW-'), vendor_ledger_id: vendor,
        vendor_name: str(b.vendor_name, 150) || await ledgerName(c, vendor), work_description: str(b.work_description, 1000), sent_date: String(b.sent_date || today()).slice(0, 10),
        cost_amount: round2(b.cost_amount), charge_amount: round2(b.charge_amount), status: 'sent', created_by: userId });
    if (error) throw error;
    await c.from('auto_job_cards').update({ status: 'outside_work' }).eq('id', id);
    await refreshTotals(c, t, id);
    return jobDetail(c, t, id);
}
/** outside work back: final cost / charge; cost is posted to the outside workshop */
async function receiveOutsideWork(c, t, userId, owId, b) {
    await requireOn(c, t);
    const { data: o } = await c.from('auto_outside_works').select('*').eq('tenant_id', t).eq('id', owId).maybeSingle();
    if (!o) throw httpError('Outside work not found', 404);
    if (o.status === 'received') throw httpError('Already received');
    const j = await loadJob(c, t, o.job_id);
    const given = v => v !== undefined && v !== null && String(v).trim() !== '';
    if ((given(b.cost_amount) && !Number.isFinite(Number(b.cost_amount))) || (given(b.charge_amount) && !Number.isFinite(Number(b.charge_amount)))) throw httpError('Cost and charge must be numbers');
    const cost = given(b.cost_amount) ? round2(b.cost_amount) : num(o.cost_amount);
    const charge = given(b.charge_amount) ? round2(b.charge_amount) : num(o.charge_amount);
    const date = String(b.received_date || today()).slice(0, 10);
    let posted = false;
    if (cost > 0 && o.vendor_ledger_id) {
        const S = await getSettings(c, t);
        if (!S.outside_work_cost_ledger_id) throw httpError('Set the Outside Work Cost ledger in Automobile Setup');
        await postGl(c, t, userId, { type: 'auto_outside_work', docId: o.id, date, narration: `Outside work ${o.doc_no} - job ${j.doc_no}: ${o.work_description.slice(0, 100)}`,
            rows: [{ ledger: S.outside_work_cost_ledger_id, dr: cost, cr: 0 }, { ledger: o.vendor_ledger_id, dr: 0, cr: cost }] });
        posted = true;
    }
    await c.from('auto_outside_works').update({ status: 'received', received_date: date, cost_amount: cost, charge_amount: charge, posted }).eq('id', owId);
    const { data: pending } = await c.from('auto_outside_works').select('id').eq('job_id', j.id).eq('status', 'sent');
    if (!(pending || []).length && j.status === 'outside_work') await c.from('auto_job_cards').update({ status: 'in_progress' }).eq('id', j.id);
    await refreshTotals(c, t, j.id);
    return jobDetail(c, t, j.id);
}
async function deleteOutsideWork(c, t, owId) {
    const { data: o } = await c.from('auto_outside_works').select('*').eq('tenant_id', t).eq('id', owId).maybeSingle();
    if (!o) throw httpError('Outside work not found', 404);
    const j = await loadJob(c, t, o.job_id);
    if (['delivered', 'cancelled'].includes(j.status)) throw httpError(`The job card is ${j.status}`);
    await unpostGl(c, 'auto_outside_work', o.id);
    await c.from('auto_outside_works').delete().eq('id', owId);
    await refreshTotals(c, t, j.id);
    return jobDetail(c, t, j.id);
}
/**
 * Status flow: open -> in_progress -> (outside_work) -> ready (vehicle ready for delivery)
 * -> delivered (vehicle delivery complete: job invoice posted, next service reminder made).
 * 'reopen' takes a delivered job back to ready (invoice reversed); 'cancelled' before delivery.
 */
async function setJobStatus(c, t, userId, id, b) {
    await requireOn(c, t);
    const j = await loadJob(c, t, id);
    const to = b.status;
    const now = new Date().toISOString();
    if (to === 'in_progress') {
        if (!['open', 'ready'].includes(j.status)) throw httpError(`A ${j.status} job cannot go back to work`);
        await c.from('auto_job_cards').update({ status: 'in_progress', ready_at: null, updated_at: now }).eq('id', id);
    } else if (to === 'ready') {
        if (!['open', 'in_progress', 'outside_work'].includes(j.status)) throw httpError(`A ${j.status} job cannot be made ready`);
        const { data: pending } = await c.from('auto_outside_works').select('doc_no').eq('job_id', id).eq('status', 'sent');
        if ((pending || []).length) throw httpError(`Outside work ${pending.map(p => p.doc_no).join(', ')} is not back yet`);
        const up = { status: 'ready', ready_at: now, updated_at: now };
        if ('work_done' in b) up.work_done = str(b.work_done, 4000);
        await c.from('auto_job_cards').update(up).eq('id', id);
    } else if (to === 'delivered') {
        if (j.status !== 'ready') throw httpError('Mark the vehicle "Ready for delivery" first');
        const tot = await refreshTotals(c, t, id);
        const S = await getSettings(c, t);
        const billTo = idOrNull(b.bill_to_ledger_id) || j.customer_ledger_id || S.cash_ledger_id;
        const date = String(b.delivered_on || today()).slice(0, 10);
        if (tot.total_amount > 0) {
            if (!billTo) throw httpError('Choose who pays (customer ledger or cash)');
            const need = [];
            if (tot.parts_amount && !S.parts_sales_ledger_id) need.push('Parts Sales');
            if (tot.labour_amount && !S.labour_income_ledger_id) need.push('Labour Income');
            if (tot.outside_amount && !S.outside_work_income_ledger_id) need.push('Outside Work Income');
            if (need.length) throw httpError(`Set the ${need.join(', ')} ledger in Automobile Setup`);
            const vatLedger = tot.vat_amount ? await defaultVatLedger(c, t, 'sales') : null;
            if (tot.vat_amount && !vatLedger) throw httpError('No VAT ledger - set it in System Control');
            // discount comes off the income heads in proportion
            const gross = tot.parts_amount + tot.labour_amount + tot.outside_amount;
            const k = gross ? (gross - num(j.discount_amount)) / gross : 1;
            const heads = [[S.parts_sales_ledger_id, tot.parts_amount * k, 'Parts'], [S.labour_income_ledger_id, tot.labour_amount * k, 'Labour'], [S.outside_work_income_ledger_id, tot.outside_amount * k, 'Outside work']]
                .map(([l, a, n]) => ({ ledger: l, dr: 0, cr: round2(a), narration: n }));
            const diff = round2(tot.total_amount - tot.vat_amount - heads.reduce((s, h) => s + h.cr, 0));
            const last = heads.filter(h => h.cr).pop(); if (last) last.cr = round2(last.cr + diff);
            await postGl(c, t, userId, { type: 'auto_job_invoice', docId: id, date, narration: `Job card ${j.doc_no} invoice`,
                rows: [{ ledger: billTo, dr: tot.total_amount, cr: 0 }, ...heads, { ledger: vatLedger, dr: 0, cr: tot.vat_amount }] });
        }
        const v = await loadVehicle(c, t, j.vehicle_id);
        const nextDate = b.next_service_date || addDays(date, S.service_interval_days);
        const nextKm = b.next_service_km !== undefined && b.next_service_km !== '' ? parseInt(b.next_service_km, 10) : (num(j.odometer_in) || v.odometer || 0) + num(S.service_interval_km);
        await c.from('auto_job_cards').update({ status: 'delivered', delivered_on: date, bill_to_ledger_id: billTo || null, next_service_date: nextDate, next_service_km: nextKm, updated_at: now,
            ...('work_done' in b ? { work_done: str(b.work_done, 4000) } : {}) }).eq('id', id);
        if (j.reminder_id) await c.from('auto_service_reminders').update({ status: 'done', job_id: id }).eq('id', j.reminder_id);
        // the next free service still ahead stays; otherwise the next paid service is reminded
        const { data: ahead } = await c.from('auto_service_reminders').select('id').eq('vehicle_id', v.id).eq('status', 'pending').gt('due_date', date);
        if (!(ahead || []).length) await c.from('auto_service_reminders').insert({ tenant_id: t, vehicle_id: v.id, title: 'Periodic service', service_type: 'paid', due_date: nextDate, due_km: nextKm, status: 'pending', source: 'job', job_id: id });
    } else if (to === 'reopen') {
        if (j.status !== 'delivered') throw httpError('Only a delivered job card can be reopened');
        await unpostGl(c, 'auto_job_invoice', id);
        await c.from('auto_service_reminders').delete().eq('job_id', id).eq('source', 'job').eq('status', 'pending');
        if (j.reminder_id) await c.from('auto_service_reminders').update({ status: 'booked' }).eq('id', j.reminder_id);
        await c.from('auto_job_cards').update({ status: 'ready', delivered_on: null, updated_at: now }).eq('id', id);
    } else if (to === 'cancelled') {
        if (['delivered', 'cancelled'].includes(j.status)) throw httpError(`The job card is ${j.status}`);
        const { data: parts } = await c.from('auto_job_parts').select('qty').eq('job_id', id);
        if ((parts || []).reduce((s, p) => s + num(p.qty), 0) > 1e-6) throw httpError('Return or remove the parts issued before cancelling');
        const { data: outs } = await c.from('auto_outside_works').select('id').eq('job_id', id);
        if ((outs || []).length) throw httpError('Remove the outside work entries before cancelling');
        await c.from('auto_job_cards').update({ status: 'cancelled', cancellation_reason: str(b.reason, 500), updated_at: now }).eq('id', id);
        if (j.reminder_id) await c.from('auto_service_reminders').update({ status: 'pending', job_id: null }).eq('id', j.reminder_id);
    } else throw httpError('Invalid status');
    return jobDetail(c, t, id);
}
async function listJobs(c, t, q = {}) {
    await requireOn(c, t);
    let b = c.from('auto_job_cards').select('*').eq('tenant_id', t);
    if (q.status === 'open_all') b = b.in('status', ['open', 'in_progress', 'outside_work', 'ready']);
    else if (q.status && q.status !== 'all') b = b.eq('status', q.status);
    if (q.date_from) b = b.gte('date_in', q.date_from);
    if (q.date_to) b = b.lte('date_in', q.date_to);
    const { data, error } = await b.order('date_in', { ascending: false });
    if (error) throw error;
    const vids = [...new Set((data || []).map(j => j.vehicle_id))];
    const { data: vs } = vids.length ? await c.from('auto_vehicles').select('id, chassis_no, reg_no, model_name').in('id', vids) : { data: [] };
    const V = Object.fromEntries((vs || []).map(v => [v.id, v]));
    const s = String(q.search || '').trim().toLowerCase();
    return (data || []).map(j => ({ ...j, reg_no: V[j.vehicle_id]?.reg_no, chassis_no: V[j.vehicle_id]?.chassis_no, model_name: V[j.vehicle_id]?.model_name }))
        .filter(j => !s || [j.doc_no, j.customer_name, j.customer_phone, j.reg_no, j.chassis_no].some(x => String(x || '').toLowerCase().includes(s)));
}

// ---------------------------------------------------------------- service reminders
async function listReminders(c, t, q = {}) {
    await requireOn(c, t);
    const days = parseInt(q.days, 10) || 15;
    let b = c.from('auto_service_reminders').select('*').eq('tenant_id', t);
    if (q.status && q.status !== 'all') b = b.eq('status', q.status);
    else if (!q.status) b = b.in('status', ['pending', 'contacted', 'booked']);
    if (q.view === 'overdue') b = b.lt('due_date', today());
    else if (q.view !== 'all') b = b.lte('due_date', addDays(today(), days));
    const { data, error } = await b.order('due_date');
    if (error) throw error;
    const vids = [...new Set((data || []).map(r => r.vehicle_id))];
    const { data: vs } = vids.length ? await c.from('auto_vehicles').select('id, chassis_no, reg_no, model_name, customer_name, customer_phone, odometer').in('id', vids) : { data: [] };
    const V = Object.fromEntries((vs || []).map(v => [v.id, v]));
    return (data || []).map(r => ({ ...r, ...(V[r.vehicle_id] ? { chassis_no: V[r.vehicle_id].chassis_no, reg_no: V[r.vehicle_id].reg_no, model_name: V[r.vehicle_id].model_name,
        customer_name: V[r.vehicle_id].customer_name, customer_phone: V[r.vehicle_id].customer_phone, last_km: V[r.vehicle_id].odometer } : {}),
        days_left: Math.round((Date.parse(`${String(r.due_date).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / DAY) }));
}
async function updateReminder(c, t, id, b) {
    await requireOn(c, t);
    const { data: r } = await c.from('auto_service_reminders').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (!r) throw httpError('Reminder not found', 404);
    const up = {};
    if (b.status) {
        if (!['pending', 'contacted', 'booked', 'done', 'not_interested'].includes(b.status)) throw httpError('Invalid status');
        up.status = b.status;
    }
    if ('contact_note' in b) { up.contact_note = str(b.contact_note, 1000); up.last_contact_date = today(); }
    if (b.due_date) up.due_date = String(b.due_date).slice(0, 10);
    const { error } = await c.from('auto_service_reminders').update(up).eq('id', id);
    if (error) throw error;
    return { ...r, ...up };
}
async function addReminder(c, t, b) {
    await requireOn(c, t);
    const v = await loadVehicle(c, t, b.vehicle_id);
    if (!b.due_date) throw httpError('Due date is required');
    const { data, error } = await c.from('auto_service_reminders').insert({ tenant_id: t, vehicle_id: v.id, title: str(b.title, 120) || 'Service', service_type: JOB_TYPES.includes(b.service_type) ? b.service_type : 'paid',
        due_date: String(b.due_date).slice(0, 10), due_km: parseInt(b.due_km, 10) || null, status: 'pending', source: 'manual' }).select().single();
    if (error) throw error;
    return data;
}

// ---------------------------------------------------------------- dashboard & reports
async function dashboard(c, t) {
    await requireOn(c, t);
    const monthStart = `${today().slice(0, 7)}-01`;
    const [{ data: enq }, { data: veh }, { data: dels }, { data: jobs }, rem] = await Promise.all([
        c.from('auto_enquiries').select('status, temperature, follow_up_date, enquiry_date').eq('tenant_id', t),
        c.from('auto_vehicles').select('ownership, status').eq('tenant_id', t),
        c.from('auto_deliveries').select('delivery_date, status').eq('tenant_id', t).gte('delivery_date', monthStart),
        c.from('auto_job_cards').select('status, date_in, delivered_on, total_amount, vat_amount').eq('tenant_id', t),
        listReminders(c, t, { days: 7 })
    ]);
    const E = enq || [], V = veh || [], J = jobs || [];
    const cnt = (arr, f) => arr.filter(f).length;
    return {
        showroom: { open_enquiries: cnt(E, e => e.status === 'open'), hot: cnt(E, e => e.status === 'open' && e.temperature === 'hot'),
            follow_up_due: cnt(E, e => e.status === 'open' && e.follow_up_date && String(e.follow_up_date).slice(0, 10) <= today()),
            enquiries_month: cnt(E, e => String(e.enquiry_date) >= monthStart), booked: cnt(E, e => e.status === 'booked'),
            in_stock: cnt(V, v => v.ownership === 'stock' && ['in_stock', 'booked', 'pdi_done'].includes(v.status)), pdi_pending: cnt(V, v => v.ownership === 'stock' && ['in_stock', 'booked'].includes(v.status)),
            delivered_month: cnt(dels || [], d => d.status === 'delivered') },
        workshop: { open: cnt(J, j => j.status === 'open'), in_progress: cnt(J, j => j.status === 'in_progress'), outside_work: cnt(J, j => j.status === 'outside_work'), ready: cnt(J, j => j.status === 'ready'),
            delivered_month: cnt(J, j => j.status === 'delivered' && String(j.delivered_on) >= monthStart),
            revenue_month: round2(J.filter(j => j.status === 'delivered' && String(j.delivered_on) >= monthStart).reduce((s, j) => s + num(j.total_amount) - num(j.vat_amount), 0)) },
        reminders: { due_7_days: rem.filter(r => r.days_left >= 0).length, overdue: rem.filter(r => r.days_left < 0).length, list: rem.slice(0, 10) }
    };
}
async function report(c, t, view, q = {}) {
    await requireOn(c, t);
    const inRange = d => (!q.date_from || String(d) >= q.date_from) && (!q.date_to || String(d).slice(0, 10) <= q.date_to);
    if (view === 'enquiries') {
        const rows = (await listEnquiries(c, t, { status: 'all' })).filter(e => inRange(e.enquiry_date));
        const { data: ag } = await c.from('salesman_agents').select('id, agent_name').eq('tenant_id', t);
        const AN = Object.fromEntries((ag || []).map(a => [a.id, a.agent_name]));
        const g = key => {
            const m = {};
            rows.forEach(e => { const k = key(e) || '(not given)'; const r = m[k] = m[k] || { label: k, total: 0, open: 0, booked: 0, delivered: 0, lost: 0 }; r.total++; r[e.status]++; });
            return Object.values(m).map(r => ({ ...r, conversion_pct: r.total ? round2(r.delivered * 100 / r.total) : 0 })).sort((a, b) => b.total - a.total);
        };
        return { by_source: g(e => e.source), by_model: g(e => e.model_name), by_salesperson: g(e => AN[e.salesperson_id]), by_status: g(e => e.status),
            lost_reasons: g(e => (e.status === 'lost' ? e.lost_reason : null)).filter(x => x.label !== '(not given)') };
    }
    if (view === 'vehicle_sales') {
        const { data } = await c.from('auto_deliveries').select('*').eq('tenant_id', t).eq('status', 'delivered').order('delivery_date', { ascending: false });
        const list = (data || []).filter(d => inRange(d.delivery_date));
        const vids = list.map(d => d.vehicle_id);
        const { data: vs } = vids.length ? await c.from('auto_vehicles').select('id, chassis_no, engine_no, model_name, variant, color').in('id', vids) : { data: [] };
        const V = Object.fromEntries((vs || []).map(v => [v.id, v]));
        return list.map(d => ({ ...d, ...(V[d.vehicle_id] || {}), id: d.id }));
    }
    if (view === 'job_cards') {
        const rows = (await listJobs(c, t, { status: 'all' })).filter(j => inRange(j.date_in));
        const m = {};
        rows.filter(j => j.status !== 'cancelled').forEach(j => {
            const r = m[j.service_type] = m[j.service_type] || { service_type: j.service_type, jobs: 0, delivered: 0, parts: 0, labour: 0, outside: 0, discount: 0, net: 0 };
            r.jobs++; if (j.status === 'delivered') { r.delivered++; r.parts += num(j.parts_amount); r.labour += num(j.labour_amount); r.outside += num(j.outside_amount); r.discount += num(j.discount_amount); r.net += num(j.total_amount) - num(j.vat_amount); }
        });
        return { by_type: Object.values(m).map(r => ({ ...r, parts: round2(r.parts), labour: round2(r.labour), outside: round2(r.outside), discount: round2(r.discount), net: round2(r.net) })), jobs: rows };
    }
    if (view === 'parts') {
        const { data: jobs } = await c.from('auto_job_cards').select('id, doc_no, service_type').eq('tenant_id', t);
        const ids = (jobs || []).map(j => j.id);
        const { data: parts } = ids.length ? await c.from('auto_job_parts').select('*').in('job_id', ids) : { data: [] };
        const list = (parts || []).filter(p => inRange(p.issue_date));
        const pids = [...new Set(list.map(p => p.product_id))];
        const { data: ps } = pids.length ? await c.from('products').select('id, product_name, product_code').in('id', pids) : { data: [] };
        const PN = Object.fromEntries((ps || []).map(p => [p.id, p]));
        const m = {};
        list.forEach(p => {
            const r = m[p.product_id] = m[p.product_id] || { product_id: p.product_id, product_code: PN[p.product_id]?.product_code || '', product_name: PN[p.product_id]?.product_name || '', qty: 0, cost: 0, sale: 0, free_qty: 0 };
            r.qty += num(p.qty); r.cost += num(p.cost_amount); if (p.chargeable) r.sale += num(p.sale_amount); else r.free_qty += num(p.qty);
        });
        return Object.values(m).map(r => ({ ...r, qty: round2(r.qty), cost: round2(r.cost), sale: round2(r.sale), free_qty: round2(r.free_qty), margin: round2(r.sale - r.cost) })).sort((a, b) => b.sale - a.sale);
    }
    if (view === 'outside_work') {
        const { data: jobs } = await c.from('auto_job_cards').select('id, doc_no, customer_name').eq('tenant_id', t);
        const J = Object.fromEntries((jobs || []).map(j => [j.id, j]));
        const ids = Object.keys(J);
        const { data } = ids.length ? await c.from('auto_outside_works').select('*').in('job_id', ids).order('sent_date', { ascending: false }) : { data: [] };
        return (data || []).filter(o => inRange(o.sent_date)).map(o => ({ ...o, job_no: J[o.job_id]?.doc_no, customer_name: J[o.job_id]?.customer_name, margin: round2(num(o.charge_amount) - num(o.cost_amount)) }));
    }
    if (view === 'technicians') {
        const rows = (await listJobs(c, t, { status: 'delivered' })).filter(j => inRange(j.delivered_on));
        const m = {};
        rows.forEach(j => {
            const k = j.technician || '(not given)';
            const r = m[k] = m[k] || { technician: k, jobs: 0, labour_hours: 0, labour: 0, parts: 0 };
            r.jobs++; r.labour += num(j.labour_amount); r.parts += num(j.parts_amount);
            r.labour_hours += (Array.isArray(j.labour) ? j.labour : []).reduce((s, l) => s + num(l.hours), 0);
        });
        return Object.values(m).map(r => ({ ...r, labour_hours: round2(r.labour_hours), labour: round2(r.labour), parts: round2(r.parts) })).sort((a, b) => b.labour - a.labour);
    }
    throw httpError('Unknown automobile report', 404);
}

module.exports = {
    requireOn, getSettings, saveSettings, saveVehicle, listVehicles, vehicleDetail, saveEnquiry, enquiryDetail, addFollowup, setEnquiryStatus, listEnquiries,
    savePdi, deliverVehicle, cancelDelivery, createJob, updateJob, jobDetail, issueParts, deletePartIssue, addOutsideWork, receiveOutsideWork, deleteOutsideWork,
    setJobStatus, listJobs, listReminders, updateReminder, addReminder, dashboard, report
};
