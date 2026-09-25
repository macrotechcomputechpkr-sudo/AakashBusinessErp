// =============================================
// utils/tasks.js
// Task management: create / assign / update / comment / delete, with the
// change history kept as task comments and notifications to the people
// involved (assignee, assigner, creator, watchers).
// Who sees what: everyone sees tasks they created, were assigned, assigned
// or watch; the "tasks.view" right sees every task. The assignee may
// always update status / progress and comment; editing anything else
// needs "tasks.edit" (or being the creator / assigner).
// Recurring tasks (daily / weekly / monthly) create the next one when
// marked done.
// =============================================
const { notify, userMap } = require('./notifications');

const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const UUID = /^[0-9a-f-]{36}$/i;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['todo', 'in_progress', 'on_hold', 'done', 'cancelled'];
const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', on_hold: 'On hold', done: 'Done', cancelled: 'Cancelled' };
const FIELDS = ['title', 'description', 'priority', 'status', 'start_date', 'due_at', 'progress', 'assigned_to', 'watchers', 'darta_chalani_id', 'related_type', 'related_id', 'related_label', 'tags', 'recurrence'];

const involved = (x, u) => x.assigned_to === u || x.assigned_by === u || x.created_by === u || (x.watchers || []).includes(u);
const canSeeAll = req => !!(req.auth.isSuperAdmin || req.userPermissions?.tasks?.view);
const can = (req, a) => !!(req.auth.isSuperAdmin || req.userPermissions?.tasks?.[a]);

function clean(b, partial) {
    const row = {};
    FIELDS.forEach(k => { if (k in b) row[k] = b[k]; });
    if (!partial && !String(row.title || '').trim()) throw httpError('Title is required');
    if ('title' in row) row.title = String(row.title).trim().slice(0, 300);
    if ('priority' in row && !PRIORITIES.includes(row.priority)) throw httpError('Unknown priority');
    if ('status' in row && !STATUSES.includes(row.status)) throw httpError('Unknown status');
    if ('recurrence' in row && !['none', 'daily', 'weekly', 'monthly'].includes(row.recurrence)) throw httpError('Unknown repeat option');
    if ('progress' in row) row.progress = Math.max(0, Math.min(100, Math.round(Number(row.progress) || 0)));
    if ('assigned_to' in row && row.assigned_to && !UUID.test(row.assigned_to)) throw httpError('Choose a user to assign');
    if ('assigned_to' in row && !row.assigned_to) row.assigned_to = null;
    if ('watchers' in row) row.watchers = [...new Set((Array.isArray(row.watchers) ? row.watchers : []).filter(x => UUID.test(x)))];
    if ('tags' in row) row.tags = [...new Set((Array.isArray(row.tags) ? row.tags : String(row.tags || '').split(',')).map(s => String(s).trim()).filter(Boolean))].slice(0, 20);
    if ('due_at' in row) row.due_at = row.due_at ? new Date(row.due_at).toISOString() : null;
    if ('start_date' in row) row.start_date = row.start_date || null;
    if ('darta_chalani_id' in row) row.darta_chalani_id = row.darta_chalani_id && UUID.test(row.darta_chalani_id) ? row.darta_chalani_id : null;
    return row;
}

async function nextSerial(c, t) {
    const { data } = await c.from('tasks').select('serial_no').eq('tenant_id', t).order('serial_no', { ascending: false }).limit(1);
    return ((data && data[0] && data[0].serial_no) || 0) + 1;
}

async function decorate(c, t, rows) {
    const ids = rows.flatMap(r => [r.assigned_to, r.assigned_by, r.created_by, ...(r.watchers || [])]);
    const U = await userMap(c, t, ids);
    const name = id => (id && U[id] ? U[id].full_name || U[id].email : null);
    const now = Date.now();
    return rows.map(r => ({ ...r, assigned_to_name: name(r.assigned_to), assigned_by_name: name(r.assigned_by), created_by_name: name(r.created_by),
        watcher_names: (r.watchers || []).map(name).filter(Boolean), status_label: STATUS_LABEL[r.status],
        is_overdue: !!(r.due_at && new Date(r.due_at) < now && !['done', 'cancelled'].includes(r.status)) }));
}

async function list(c, t, req, q = {}) {
    const me = req.auth.userId;
    let b = c.from('tasks').select('*').eq('tenant_id', t);
    if (q.status === 'open') b = b.in('status', ['todo', 'in_progress', 'on_hold']);
    else if (q.status && STATUSES.includes(q.status)) b = b.eq('status', q.status);
    if (q.priority && PRIORITIES.includes(q.priority)) b = b.eq('priority', q.priority);
    if (q.assigned_to && UUID.test(q.assigned_to)) b = b.eq('assigned_to', q.assigned_to);
    if (q.darta_chalani_id && UUID.test(q.darta_chalani_id)) b = b.eq('darta_chalani_id', q.darta_chalani_id);
    if (q.due_from) b = b.gte('due_at', `${String(q.due_from).slice(0, 10)}T00:00:00`);
    if (q.due_to) b = b.lte('due_at', `${String(q.due_to).slice(0, 10)}T23:59:59.999`);
    if (q.q) b = b.ilike('title', `%${String(q.q).replace(/[%_,()]/g, ' ').trim()}%`);
    const { data, error } = await b.order('created_at', { ascending: false }).limit(Math.min(2000, Number(q.limit) || 1000));
    if (error) throw error;
    let rows = data || [];
    const view = q.view || 'mine';
    if (view === 'mine') rows = rows.filter(r => r.assigned_to === me);
    else if (view === 'assigned_by_me') rows = rows.filter(r => r.assigned_by === me || r.created_by === me);
    else if (view === 'watching') rows = rows.filter(r => (r.watchers || []).includes(me));
    else if (view === 'involved') rows = rows.filter(r => involved(r, me));
    else if (view === 'overdue') rows = rows.filter(r => r.due_at && new Date(r.due_at) < new Date() && !['done', 'cancelled'].includes(r.status));
    if (!canSeeAll(req)) rows = rows.filter(r => involved(r, me));
    return decorate(c, t, rows);
}

async function load(c, t, req, id, forEdit = false) {
    if (!UUID.test(String(id))) throw httpError('Task not found', 404);
    const { data, error } = await c.from('tasks').select('*').eq('tenant_id', t).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw httpError('Task not found', 404);
    if (!canSeeAll(req) && !involved(data, req.auth.userId)) throw httpError('This task is not yours', 403);
    if (forEdit === 'full' && !can(req, 'edit') && data.created_by !== req.auth.userId && data.assigned_by !== req.auth.userId) throw httpError('Only the creator, the assigner or a user with Task edit right can change this', 403);
    return data;
}

async function get(c, t, req, id) {
    const task = await load(c, t, req, id);
    const { data: comments } = await c.from('task_comments').select('*').eq('tenant_id', t).eq('task_id', id).order('created_at');
    const U = await userMap(c, t, (comments || []).map(x => x.user_id));
    const [dec] = await decorate(c, t, [task]);
    let darta = null;
    if (task.darta_chalani_id) ({ data: darta } = await c.from('darta_chalani').select('id, reg_no, subject, entry_type').eq('id', task.darta_chalani_id).maybeSingle());
    return { ...dec, darta, comments: (comments || []).map(x => ({ ...x, user_name: U[x.user_id]?.full_name || U[x.user_id]?.email || '' })) };
}

const link = id => `/tasks?id=${id}`;
async function create(c, t, req, b) {
    if (!can(req, 'create')) throw httpError('Permission denied: tasks.create', 403);
    const row = clean(b, false);
    const me = req.auth.userId;
    for (let attempt = 0; attempt < 5; attempt++) {
        const serial = await nextSerial(c, t);
        const ins = { tenant_id: t, ...row, serial_no: serial, task_no: `T-${String(serial).padStart(5, '0')}`, status: row.status || 'todo',
            assigned_by: row.assigned_to ? me : null, created_by: me, updated_by: me, completed_at: row.status === 'done' ? new Date().toISOString() : null };
        const { data, error } = await c.from('tasks').insert(ins).select().single();
        if (error && /unique|duplicate/i.test(error.message)) continue;
        if (error) throw error;
        await c.from('task_comments').insert({ tenant_id: t, task_id: data.id, user_id: me, kind: 'change', body: 'Created the task' });
        const n = await notify(c, t, { userIds: [data.assigned_to, ...(data.watchers || [])], actor: me, kind: 'task_assigned', priority: data.priority,
            title: `${data.task_no}: ${data.title}`, body: [data.description, data.due_at ? `Due ${new Date(data.due_at).toLocaleString()}` : null].filter(Boolean).join('\n'),
            link: link(data.id), ref_type: 'task', ref_id: data.id });
        return { ...(await get(c, t, req, data.id)), notify_links: n.links };
    }
    throw httpError('Could not number the task, try again', 409);
}

const show = (k, v) => (v === null || v === undefined || v === '' ? '—' : k === 'status' ? STATUS_LABEL[v] : k === 'due_at' ? new Date(v).toLocaleString() : Array.isArray(v) ? v.join(', ') : String(v));
async function update(c, t, req, id, b) {
    const me = req.auth.userId;
    const old = await load(c, t, req, id);
    const assigneeOnly = old.assigned_to === me && !can(req, 'edit') && old.created_by !== me && old.assigned_by !== me;
    let row = clean(b, true);
    if (assigneeOnly) {
        const extra = Object.keys(row).filter(k => !['status', 'progress'].includes(k));
        if (extra.length) throw httpError('As the assignee you can change status and progress; ask the assigner to change the rest', 403);
    } else if (!can(req, 'edit') && old.created_by !== me && old.assigned_by !== me && old.assigned_to !== me) throw httpError('Permission denied: tasks.edit', 403);
    if (row.status === 'done' && old.status !== 'done') { row.completed_at = new Date().toISOString(); row.progress = 100; }
    if (row.status && row.status !== 'done' && old.status === 'done') row.completed_at = null;
    if ('assigned_to' in row && row.assigned_to !== old.assigned_to) row.assigned_by = row.assigned_to ? me : null;
    if ('due_at' in row && row.due_at !== old.due_at) { row.reminder_sent_at = null; row.overdue_sent_at = null; }
    const changed = Object.keys(row).filter(k => !['completed_at', 'assigned_by', 'reminder_sent_at', 'overdue_sent_at'].includes(k) && JSON.stringify(row[k] ?? null) !== JSON.stringify(old[k] ?? null));
    if (!changed.length) return get(c, t, req, id);
    row = { ...row, updated_by: me, updated_at: new Date().toISOString() };
    const { error } = await c.from('tasks').update(row).eq('tenant_id', t).eq('id', id);
    if (error) throw error;
    const U = await userMap(c, t, [old.assigned_to, row.assigned_to]);
    const nm = x => (x && U[x] ? U[x].full_name || U[x].email : '—');
    const lines = changed.map(k => k === 'assigned_to' ? `Assigned: ${nm(old.assigned_to)} → ${nm(row.assigned_to)}` : k === 'description' ? 'Description changed'
        : `${k.replace(/_/g, ' ').replace(/^\w/, s => s.toUpperCase())}: ${show(k, old[k])} → ${show(k, row[k])}`);
    await c.from('task_comments').insert({ tenant_id: t, task_id: id, user_id: me, kind: 'change', body: lines.join('\n') });
    const out = { links: [] };
    if (changed.includes('assigned_to') && row.assigned_to) {
        const n = await notify(c, t, { userIds: [row.assigned_to], actor: me, kind: 'task_assigned', priority: row.priority || old.priority,
            title: `${old.task_no}: ${row.title || old.title}`, body: 'This task is now assigned to you', link: link(id), ref_type: 'task', ref_id: id });
        out.links.push(...n.links);
    }
    if (changed.includes('status') || changed.includes('progress') || changed.some(k => ['due_at', 'priority', 'title'].includes(k))) {
        const n = await notify(c, t, { userIds: [old.assigned_to, old.assigned_by, old.created_by, ...(old.watchers || [])], actor: me, kind: 'task_status',
            title: `${old.task_no}: ${row.title || old.title}`, body: lines.join('\n'), link: link(id), ref_type: 'task', ref_id: id });
        out.links.push(...n.links);
    }
    if (row.status === 'done' && old.status !== 'done' && old.recurrence && old.recurrence !== 'none') await repeat(c, t, req, { ...old, ...row });
    return { ...(await get(c, t, req, id)), notify_links: out.links };
}

async function repeat(c, t, req, x) {
    const step = { daily: d => d.setDate(d.getDate() + 1), weekly: d => d.setDate(d.getDate() + 7), monthly: d => d.setMonth(d.getMonth() + 1) }[x.recurrence];
    const next = x.due_at ? new Date(x.due_at) : new Date();
    step(next);
    const serial = await nextSerial(c, t);
    const { data } = await c.from('tasks').insert({ tenant_id: t, serial_no: serial, task_no: `T-${String(serial).padStart(5, '0')}`, title: x.title, description: x.description,
        priority: x.priority, status: 'todo', due_at: next.toISOString(), assigned_to: x.assigned_to, assigned_by: x.assigned_by, watchers: x.watchers || [],
        darta_chalani_id: x.darta_chalani_id, related_type: x.related_type, related_id: x.related_id, related_label: x.related_label, tags: x.tags || [],
        recurrence: x.recurrence, created_by: req.auth.userId, updated_by: req.auth.userId }).select().single();
    if (data) await c.from('task_comments').insert({ tenant_id: t, task_id: data.id, user_id: req.auth.userId, kind: 'change', body: `Repeats ${x.recurrence} - created from ${x.task_no}` });
    return data;
}

async function comment(c, t, req, id, body) {
    const text = String(body || '').trim();
    if (!text) throw httpError('Write a comment');
    const task = await load(c, t, req, id);
    const { data, error } = await c.from('task_comments').insert({ tenant_id: t, task_id: id, user_id: req.auth.userId, kind: 'comment', body: text.slice(0, 5000) }).select().single();
    if (error) throw error;
    const n = await notify(c, t, { userIds: [task.assigned_to, task.assigned_by, task.created_by, ...(task.watchers || [])], actor: req.auth.userId, kind: 'task_comment',
        title: `${task.task_no}: ${task.title}`, body: text.slice(0, 500), link: link(id), ref_type: 'task', ref_id: id });
    return { ...data, notify_links: n.links };
}

async function remove(c, t, req, id) {
    const task = await load(c, t, req, id);
    if (!can(req, 'delete') && task.created_by !== req.auth.userId) throw httpError('Permission denied: tasks.delete', 403);
    const { error } = await c.from('tasks').delete().eq('tenant_id', t).eq('id', id);
    if (error) throw error;
    return { deleted: true };
}

module.exports = { list, get, create, update, comment, remove, STATUS_LABEL, PRIORITIES, STATUSES, involved, canSeeAll };
