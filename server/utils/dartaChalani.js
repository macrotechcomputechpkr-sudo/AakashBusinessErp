// =============================================
// utils/dartaChalani.js
// Darta (incoming) / Chalani (outgoing) register.
//   - numbered per type and fiscal year: D-2082/83-0001, C-2082/83-0001
//     (the fiscal year from Fiscal Years, else worked out from the BS
//     date - the Nepali fiscal year starts on Shrawan 1)
//   - BS dates stored next to AD dates
//   - assign to a user (notification), due date, status, the reply link
//     (a chalani made "in reply to" a darta marks the darta Replied)
//   - confidential entries are seen only by their creator, assignee and
//     users with the Darta / Chalani edit right
// Rights: security group module "darta_chalani".
// =============================================
const { notify, userMap } = require('./notifications');
const { nepaliDateConverter } = require('./nepaliDateUtils');

const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const UUID = /^[0-9a-f-]{36}$/i;
const CHANNELS = ['hand', 'post', 'courier', 'email', 'fax', 'online', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'replied', 'closed', 'cancelled'];
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', replied: 'Replied', closed: 'Closed', cancelled: 'Cancelled' };
const FIELDS = ['entry_type', 'entry_date', 'letter_no', 'letter_date', 'party_name', 'party_address', 'party_phone', 'party_email', 'ledger_id', 'subject',
    'description', 'department_id', 'assigned_to', 'channel', 'tracking_no', 'pages', 'priority', 'status', 'due_date', 'reply_to_id', 'attachment_url',
    'attachment_name', 'is_confidential', 'remarks'];

const isoDate = d => (d ? String(d).slice(0, 10) : null);
function bsOf(ad) {
    if (!ad) return null;
    try { return nepaliDateConverter.toNepali(ad).date; } catch { return null; }
}
async function fiscalYear(c, t, date) {
    const { data } = await c.from('fiscal_years').select('id, fiscal_year_code, fiscal_year_name, fiscal_year_nepali, start_date_eng, end_date_eng').eq('tenant_id', t);
    const hit = (data || []).find(y => isoDate(y.start_date_eng) <= date && date <= isoDate(y.end_date_eng));
    if (hit) return { id: hit.id, label: String(hit.fiscal_year_nepali || hit.fiscal_year_code || hit.fiscal_year_name).replace(/\s+/g, '').slice(0, 20) };
    const bs = bsOf(date);
    if (bs) {
        const [y, m] = bs.split('-').map(Number);
        const start = m >= 4 ? y : y - 1;
        return { id: null, label: `${start}/${String((start + 1) % 100).padStart(2, '0')}` };
    }
    const y = Number(date.slice(0, 4));
    return { id: null, label: `${y}/${String((y + 1) % 100).padStart(2, '0')}` };
}

const privileged = req => !!(req.auth.isSuperAdmin || req.userPermissions?.darta_chalani?.edit);
const mayView = (req, r) => !r.is_confidential || privileged(req) || r.created_by === req.auth.userId || r.assigned_to === req.auth.userId;

function clean(b, partial) {
    const row = {};
    FIELDS.forEach(k => { if (k in b) row[k] = b[k] === '' ? null : b[k]; });
    if (!partial) {
        if (!['darta', 'chalani'].includes(row.entry_type)) throw httpError('Choose Darta (incoming) or Chalani (outgoing)');
        if (!String(row.party_name || '').trim()) throw httpError(row.entry_type === 'darta' ? 'Who is it from? (sender)' : 'Who is it to? (receiver)');
        if (!String(row.subject || '').trim()) throw httpError('Subject is required');
    }
    if ('entry_type' in row && partial) delete row.entry_type;             // the type never changes after numbering
    if ('channel' in row && row.channel && !CHANNELS.includes(row.channel)) throw httpError('Unknown channel');
    if ('priority' in row && row.priority && !PRIORITIES.includes(row.priority)) throw httpError('Unknown priority');
    if ('status' in row && row.status && !STATUSES.includes(row.status)) throw httpError('Unknown status');
    ['ledger_id', 'department_id', 'assigned_to', 'reply_to_id'].forEach(k => { if (k in row && row[k] && !UUID.test(row[k])) throw httpError(`Bad ${k.replace(/_/g, ' ')}`); });
    if ('party_email' in row && row.party_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.party_email)) throw httpError('Invalid email address');
    if ('pages' in row) row.pages = row.pages === null ? null : Math.max(0, parseInt(row.pages, 10) || 0);
    if ('is_confidential' in row) row.is_confidential = !!row.is_confidential;
    if ('entry_date' in row) { row.entry_date = isoDate(row.entry_date) || new Date().toISOString().slice(0, 10); row.entry_date_bs = bsOf(row.entry_date); }
    if ('letter_date' in row) { row.letter_date = isoDate(row.letter_date); row.letter_date_bs = bsOf(row.letter_date); }
    if ('due_date' in row) row.due_date = isoDate(row.due_date);
    ['party_name', 'subject'].forEach(k => { if (k in row && row[k]) row[k] = String(row[k]).trim(); });
    return row;
}

async function decorate(c, t, rows) {
    const U = await userMap(c, t, rows.flatMap(r => [r.assigned_to, r.created_by]));
    const deptIds = [...new Set(rows.map(r => r.department_id).filter(Boolean))];
    const { data: depts } = deptIds.length ? await c.from('departments').select('id, department_name').eq('tenant_id', t).in('id', deptIds) : { data: [] };
    const D = Object.fromEntries((depts || []).map(d => [d.id, d.department_name]));
    const today = new Date().toISOString().slice(0, 10);
    return rows.map(r => ({ ...r, assigned_to_name: r.assigned_to ? U[r.assigned_to]?.full_name || U[r.assigned_to]?.email || null : null,
        created_by_name: r.created_by ? U[r.created_by]?.full_name || null : null, department_name: r.department_id ? D[r.department_id] || null : null,
        status_label: STATUS_LABEL[r.status], is_overdue: !!(r.due_date && String(r.due_date).slice(0, 10) < today && ['open', 'in_progress'].includes(r.status)) }));
}

async function list(c, t, req, q = {}) {
    let b = c.from('darta_chalani').select('*').eq('tenant_id', t);
    if (q.entry_type === 'darta' || q.entry_type === 'chalani') b = b.eq('entry_type', q.entry_type);
    if (q.date_from) b = b.gte('entry_date', String(q.date_from).slice(0, 10));
    if (q.date_to) b = b.lte('entry_date', String(q.date_to).slice(0, 10));
    if (q.status === 'pending') b = b.in('status', ['open', 'in_progress']);
    else if (q.status && STATUSES.includes(q.status)) b = b.eq('status', q.status);
    if (q.assigned_to && UUID.test(q.assigned_to)) b = b.eq('assigned_to', q.assigned_to);
    if (q.department_id && UUID.test(q.department_id)) b = b.eq('department_id', q.department_id);
    if (q.fiscal_year_label) b = b.eq('fiscal_year_label', String(q.fiscal_year_label));
    const { data, error } = await b.order('entry_date', { ascending: false }).order('serial_no', { ascending: false }).limit(Math.min(5000, Number(q.limit) || 2000));
    if (error) throw error;
    let rows = (data || []).filter(r => mayView(req, r));
    if (q.q) {
        const s = String(q.q).toLowerCase();
        rows = rows.filter(r => [r.reg_no, r.subject, r.party_name, r.letter_no, r.tracking_no].some(v => v && String(v).toLowerCase().includes(s)));
    }
    if (q.mine === 'true') rows = rows.filter(r => r.assigned_to === req.auth.userId);
    return decorate(c, t, rows);
}

async function load(c, t, req, id) {
    if (!UUID.test(String(id))) throw httpError('Entry not found', 404);
    const { data, error } = await c.from('darta_chalani').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || !mayView(req, data)) throw httpError('Entry not found', 404);
    return data;
}
async function get(c, t, req, id) {
    const row = await load(c, t, req, id);
    const [dec] = await decorate(c, t, [row]);
    const [{ data: replies }, { data: replyTo }, { data: tasks }] = await Promise.all([
        c.from('darta_chalani').select('id, reg_no, entry_type, subject, entry_date, status').eq('tenant_id', t).eq('reply_to_id', id),
        row.reply_to_id ? c.from('darta_chalani').select('id, reg_no, entry_type, subject, entry_date, status').eq('id', row.reply_to_id).maybeSingle() : { data: null },
        c.from('tasks').select('id, task_no, title, status, assigned_to, due_at').eq('tenant_id', t).eq('darta_chalani_id', id)
    ]);
    return { ...dec, replies: replies || [], reply_to: replyTo || null, tasks: tasks || [] };
}

const link = id => `/darta-chalani?id=${id}`;
async function create(c, t, req, b) {
    const row = clean(b, false);
    const me = req.auth.userId;
    row.entry_date = row.entry_date || new Date().toISOString().slice(0, 10);
    row.entry_date_bs = bsOf(row.entry_date);
    const fy = await fiscalYear(c, t, row.entry_date);
    for (let attempt = 0; attempt < 5; attempt++) {
        const { data: last } = await c.from('darta_chalani').select('serial_no').eq('tenant_id', t).eq('entry_type', row.entry_type).eq('fiscal_year_label', fy.label)
            .order('serial_no', { ascending: false }).limit(1);
        const serial = ((last && last[0] && last[0].serial_no) || 0) + 1;
        const ins = { tenant_id: t, ...row, fiscal_year_id: fy.id, fiscal_year_label: fy.label, serial_no: serial,
            reg_no: `${row.entry_type === 'darta' ? 'D' : 'C'}-${fy.label}-${String(serial).padStart(4, '0')}`,
            status: row.status || 'open', channel: row.channel || 'hand', priority: row.priority || 'normal', created_by: me, updated_by: me };
        const { data, error } = await c.from('darta_chalani').insert(ins).select().single();
        if (error && /unique|duplicate/i.test(error.message)) continue;
        if (error) throw error;
        if (data.reply_to_id) await c.from('darta_chalani').update({ status: 'replied', updated_by: me, updated_at: new Date().toISOString() }).eq('tenant_id', t).eq('id', data.reply_to_id).in('status', ['open', 'in_progress']);
        const n = await notify(c, t, { userIds: [data.assigned_to], actor: me, kind: 'darta_assigned', priority: data.priority,
            title: `${data.entry_type === 'darta' ? 'Darta' : 'Chalani'} ${data.reg_no}: ${data.subject}`,
            body: [`${data.entry_type === 'darta' ? 'From' : 'To'}: ${data.party_name}`, data.due_date ? `Due ${data.due_date}` : null].filter(Boolean).join('\n'),
            link: link(data.id), ref_type: 'darta_chalani', ref_id: data.id });
        return { ...(await get(c, t, req, data.id)), notify_links: n.links };
    }
    throw httpError('Could not number the entry, try again', 409);
}

async function update(c, t, req, id, b) {
    const old = await load(c, t, req, id);
    const row = clean(b, true);
    const me = req.auth.userId;
    if (row.status && ['closed', 'replied', 'cancelled'].includes(row.status) && !['closed', 'replied', 'cancelled'].includes(old.status)) row.closed_at = new Date().toISOString();
    if (row.status && ['open', 'in_progress'].includes(row.status)) row.closed_at = null;
    if ('due_date' in row && row.due_date !== (old.due_date && String(old.due_date).slice(0, 10))) { row.reminder_sent_at = null; row.overdue_sent_at = null; }
    if ('entry_date' in row && row.entry_date !== String(old.entry_date).slice(0, 10)) {
        const fy = await fiscalYear(c, t, row.entry_date);
        if (fy.label !== old.fiscal_year_label) throw httpError(`The date is in fiscal year ${fy.label}; the number ${old.reg_no} belongs to ${old.fiscal_year_label}. Cancel this entry and make a new one instead.`);
    }
    const { error } = await c.from('darta_chalani').update({ ...row, updated_by: me, updated_at: new Date().toISOString() }).eq('tenant_id', t).eq('id', id);
    if (error) throw error;
    let links = [];
    if (row.assigned_to && row.assigned_to !== old.assigned_to) {
        const n = await notify(c, t, { userIds: [row.assigned_to], actor: me, kind: 'darta_assigned', priority: row.priority || old.priority,
            title: `${old.entry_type === 'darta' ? 'Darta' : 'Chalani'} ${old.reg_no}: ${row.subject || old.subject}`, body: 'Assigned to you', link: link(id), ref_type: 'darta_chalani', ref_id: id });
        links = n.links;
    } else if (row.status && row.status !== old.status && old.created_by && old.created_by !== me) {
        await notify(c, t, { userIds: [old.created_by], actor: me, kind: 'darta_assigned', title: `${old.reg_no}: ${STATUS_LABEL[row.status]}`, body: old.subject, link: link(id), ref_type: 'darta_chalani', ref_id: id });
    }
    return { ...(await get(c, t, req, id)), notify_links: links };
}

async function remove(c, t, req, id) {
    const row = await load(c, t, req, id);
    // numbers must stay continuous: only the latest entry of its series may be deleted, others are cancelled
    const { data: last } = await c.from('darta_chalani').select('id').eq('tenant_id', t).eq('entry_type', row.entry_type).eq('fiscal_year_label', row.fiscal_year_label)
        .order('serial_no', { ascending: false }).limit(1);
    if (!last || !last[0] || last[0].id !== id) throw httpError(`Only the last ${row.entry_type} number can be deleted - set this one to Cancelled so the register has no gaps`);
    const { error } = await c.from('darta_chalani').delete().eq('tenant_id', t).eq('id', id);
    if (error) throw error;
    return { deleted: true };
}

module.exports = { list, get, create, update, remove, fiscalYear, bsOf, STATUS_LABEL, CHANNELS };
