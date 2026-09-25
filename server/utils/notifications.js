// =============================================
// utils/notifications.js
// In-app notifications (bell + popup) and the optional copies each user
// asked for by email / SMS / WhatsApp / Viber (sent through the Messaging
// module's gateways, utils/messaging.js - same SMTP / SMS gateway /
// WhatsApp Cloud API settings; WhatsApp / Viber in "link" mode give a
// ready-to-send link to the person who made the change).
// Also the due / overdue reminders for tasks and darta / chalani,
// checked at most every 5 minutes per company while anyone is online.
// =============================================
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const UUID = /^[0-9a-f-]{36}$/i;
const APP_URL = () => String(process.env.APP_URL || process.env.CLIENT_URL || '').replace(/\/$/, '');

const KINDS = {
    task_assigned: 'Task assigned to you', task_status: 'Task status changed', task_comment: 'New comment on a task',
    task_due: 'Task due soon', task_overdue: 'Task overdue',
    darta_assigned: 'Darta / Chalani assigned to you', darta_due: 'Darta / Chalani due soon', darta_overdue: 'Darta / Chalani overdue',
    general: 'General'
};

async function userMap(c, t, ids) {
    const list = [...new Set((ids || []).filter(x => x && UUID.test(x)))];
    if (!list.length) return {};
    const { data } = await c.from('users').select('id, full_name, email, phone').eq('tenant_id', t).in('id', list);
    return Object.fromEntries((data || []).map(u => [u.id, u]));
}

async function getSettings(c, t, userId) {
    const { data } = await c.from('user_notification_settings').select('*').eq('tenant_id', t).eq('user_id', userId).maybeSingle();
    return data || { tenant_id: t, user_id: userId, popup: true, email: false, sms: false, whatsapp: false, viber: false, email_address: null, mobile: null, muted_kinds: [], reminder_hours: 24 };
}
async function saveSettings(c, t, userId, b = {}) {
    const row = { tenant_id: t, user_id: userId, updated_at: new Date().toISOString() };
    ['popup', 'email', 'sms', 'whatsapp', 'viber'].forEach(k => { if (k in b) row[k] = !!b[k]; });
    if ('email_address' in b) row.email_address = String(b.email_address || '').trim() || null;
    if ('mobile' in b) row.mobile = String(b.mobile || '').trim() || null;
    if ('muted_kinds' in b) row.muted_kinds = (Array.isArray(b.muted_kinds) ? b.muted_kinds : []).filter(k => KINDS[k]);
    if ('reminder_hours' in b) row.reminder_hours = Math.min(720, Math.max(1, Number(b.reminder_hours) || 24));
    if (row.email_address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email_address)) throw httpError('Invalid email address');
    const { data: ex } = await c.from('user_notification_settings').select('user_id').eq('tenant_id', t).eq('user_id', userId).maybeSingle();
    const { error } = ex ? await c.from('user_notification_settings').update(row).eq('tenant_id', t).eq('user_id', userId)
        : await c.from('user_notification_settings').insert(row);
    if (error) throw error;
    return getSettings(c, t, userId);
}

/**
 * Notify users. Never throws (a failed notification must not undo the
 * change that caused it). Returns ready-to-send WhatsApp / Viber links
 * (link mode) for the person who made the change.
 * n: { userIds, kind, title, body, link, ref_type, ref_id, priority, actor, includeActor }
 */
async function notify(c, t, n, opts = {}) {
    const out = { created: 0, links: [], sent: [] };
    try {
        let ids = [...new Set((n.userIds || []).filter(x => x && UUID.test(x)))];
        if (!n.includeActor) ids = ids.filter(x => x !== n.actor);
        if (!ids.length) return out;
        const rows = ids.map(user_id => ({ tenant_id: t, user_id, kind: KINDS[n.kind] ? n.kind : 'general', title: String(n.title).slice(0, 300),
            body: n.body ? String(n.body).slice(0, 2000) : null, link: n.link || null, ref_type: n.ref_type || null, ref_id: n.ref_id ? String(n.ref_id) : null,
            priority: n.priority || 'normal', is_read: false, created_by: n.actor || null }));
        const { data: made, error } = await c.from('notifications').insert(rows).select('id, user_id');
        if (error) { console.error('notifications:', error.message); return out; }
        out.created = (made || []).length;
        await external(c, t, n, ids, made || [], out, opts);
    } catch (e) { console.error('notify failed:', e.message); }
    return out;
}

async function external(c, t, n, ids, made, out, opts) {
    const [users, settingsRows] = await Promise.all([
        userMap(c, t, ids),
        c.from('user_notification_settings').select('*').eq('tenant_id', t).in('user_id', ids)
    ]);
    const S = Object.fromEntries((settingsRows.data || []).map(s => [s.user_id, s]));
    const messaging = require('./messaging');
    const text = [n.title, n.body, n.link ? `${APP_URL()}${n.link}` : null].filter(Boolean).join('\n');
    for (const uid of ids) {
        const s = S[uid];
        if (!s || (s.muted_kinds || []).includes(n.kind)) continue;
        const u = users[uid] || {};
        const results = {};
        for (const ch of ['email', 'sms', 'whatsapp', 'viber']) {
            if (!s[ch]) continue;
            const to = ch === 'email' ? (s.email_address || u.email) : (s.mobile || u.phone);
            if (!to && ch !== 'viber') { results[ch] = { status: 'failed', error: ch === 'email' ? 'no email' : 'no mobile number' }; continue; }
            try {
                const r = await messaging.sendMessage(c, t, n.actor, { channel: ch, event: 'custom', to, subject: n.title, body: text }, opts);
                results[ch] = { status: r.status, link: r.link || null };
                if (r.link) out.links.push({ user_id: uid, user_name: u.full_name || u.email, channel: ch, link: r.link });
                else out.sent.push({ user_id: uid, channel: ch });
            } catch (e) { results[ch] = { status: 'failed', error: e.message.slice(0, 200) }; }
        }
        const row = made.find(m => m.user_id === uid);
        if (row && Object.keys(results).length) await c.from('notifications').update({ channels: results }).eq('id', row.id);
    }
}

async function list(c, t, userId, q = {}) {
    let b = c.from('notifications').select('*').eq('tenant_id', t).eq('user_id', userId);
    if (q.unread === 'true' || q.unread === true) b = b.eq('is_read', false);
    if (q.since) b = b.gt('created_at', String(q.since));
    const { data, error } = await b.order('created_at', { ascending: false }).limit(Math.min(200, Number(q.limit) || 50));
    if (error) throw error;
    const { data: unread } = await c.from('notifications').select('id').eq('tenant_id', t).eq('user_id', userId).eq('is_read', false).limit(1000);
    return { rows: data || [], unread: (unread || []).length };
}
async function markRead(c, t, userId, ids) {
    let b = c.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('tenant_id', t).eq('user_id', userId).eq('is_read', false);
    if (Array.isArray(ids) && ids.length) b = b.in('id', ids.filter(x => UUID.test(x)));
    const { error } = await b;
    if (error) throw error;
    return { ok: true };
}

// ---------- due / overdue reminders ----------
const lastRun = new Map();
async function runDue(c, t, { force = false, now = new Date() } = {}) {
    const k = String(t);
    if (!force && lastRun.get(k) && now - lastRun.get(k) < 5 * 60000) return { skipped: true };
    lastRun.set(k, now);
    const out = { task_due: 0, task_overdue: 0, darta_due: 0, darta_overdue: 0 };
    const iso = now.toISOString();
    const horizon = new Date(now.getTime() + 30 * 86400000).toISOString();
    const { data: tasks } = await c.from('tasks').select('id, task_no, title, due_at, assigned_to, assigned_by, created_by, reminder_sent_at, overdue_sent_at, priority')
        .eq('tenant_id', t).in('status', ['todo', 'in_progress', 'on_hold']).lte('due_at', horizon).limit(2000);
    const hours = {};
    for (const x of tasks || []) {
        if (!x.due_at || !x.assigned_to) continue;
        if (hours[x.assigned_to] === undefined) hours[x.assigned_to] = (await getSettings(c, t, x.assigned_to)).reminder_hours || 24;
        const due = new Date(x.due_at);
        if (due <= now && !x.overdue_sent_at) {
            await notify(c, t, { userIds: [x.assigned_to, x.assigned_by, x.created_by], includeActor: true, kind: 'task_overdue', priority: 'high',
                title: `Overdue: ${x.task_no} ${x.title}`, body: `Was due ${due.toLocaleString()}`, link: `/tasks?id=${x.id}`, ref_type: 'task', ref_id: x.id });
            await c.from('tasks').update({ overdue_sent_at: iso }).eq('id', x.id);
            out.task_overdue++;
        } else if (due > now && due - now <= hours[x.assigned_to] * 3600000 && !x.reminder_sent_at) {
            await notify(c, t, { userIds: [x.assigned_to], includeActor: true, kind: 'task_due', priority: x.priority,
                title: `Due soon: ${x.task_no} ${x.title}`, body: `Due ${due.toLocaleString()}`, link: `/tasks?id=${x.id}`, ref_type: 'task', ref_id: x.id });
            await c.from('tasks').update({ reminder_sent_at: iso }).eq('id', x.id);
            out.task_due++;
        }
    }
    const today = iso.slice(0, 10), tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
    const { data: dc } = await c.from('darta_chalani').select('id, reg_no, subject, due_date, assigned_to, created_by, reminder_sent_at, overdue_sent_at')
        .eq('tenant_id', t).in('status', ['open', 'in_progress']).lte('due_date', tomorrow).limit(2000);
    for (const x of dc || []) {
        if (!x.due_date) continue;
        const d = String(x.due_date).slice(0, 10);
        if (d < today && !x.overdue_sent_at) {
            await notify(c, t, { userIds: [x.assigned_to, x.created_by], includeActor: true, kind: 'darta_overdue', priority: 'high',
                title: `Overdue: ${x.reg_no} ${x.subject}`, body: `Was due ${d}`, link: `/darta-chalani?id=${x.id}`, ref_type: 'darta_chalani', ref_id: x.id });
            await c.from('darta_chalani').update({ overdue_sent_at: iso }).eq('id', x.id);
            out.darta_overdue++;
        } else if (d >= today && !x.reminder_sent_at) {
            await notify(c, t, { userIds: [x.assigned_to || x.created_by], includeActor: true, kind: 'darta_due',
                title: `Due ${d === today ? 'today' : 'tomorrow'}: ${x.reg_no} ${x.subject}`, link: `/darta-chalani?id=${x.id}`, ref_type: 'darta_chalani', ref_id: x.id });
            await c.from('darta_chalani').update({ reminder_sent_at: iso }).eq('id', x.id);
            out.darta_due++;
        }
    }
    return out;
}

module.exports = { KINDS, notify, list, markRead, getSettings, saveSettings, runDue, userMap };
