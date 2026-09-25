// =============================================
// utils/workDashboard.js
// Tasks & Darta / Chalani dashboard: KPIs, charts and lists, each limited
// to what the viewer may see (utils/tasks.js, utils/dartaChalani.js).
// =============================================
const T = require('./tasks');
const DC = require('./dartaChalani');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const count = (arr, keyOf) => { const m = new Map(); arr.forEach(x => { const k = keyOf(x); m.set(k, (m.get(k) || 0) + 1); }); return m; };

async function workDashboard(c, t, req, q = {}) {
    const me = req.auth.userId;
    const now = new Date(), today = now.toISOString().slice(0, 10), monthStart = `${today.slice(0, 7)}-01`;
    const canDarta = !!(req.auth.isSuperAdmin || req.userPermissions?.darta_chalani?.view);
    const [tasks, darta] = await Promise.all([
        T.list(c, t, req, { view: T.canSeeAll(req) && q.scope === 'all' ? 'all' : 'involved', limit: 2000 }),
        canDarta ? DC.list(c, t, req, { date_from: `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-01`, limit: 5000 }) : []
    ]);
    const open = tasks.filter(x => !['done', 'cancelled'].includes(x.status));
    const mine = open.filter(x => x.assigned_to === me);
    const dueToday = open.filter(x => x.due_at && x.due_at.slice(0, 10) === today);
    const doneMonth = tasks.filter(x => x.status === 'done' && x.completed_at && x.completed_at.slice(0, 10) >= monthStart);

    // tasks created vs completed, last 8 weeks
    const weeks = [];
    for (let i = 7; i >= 0; i--) { const s = new Date(now.getTime() - (i * 7 + now.getDay()) * 86400000); weeks.push(s.toISOString().slice(0, 10)); }
    const weekOf = d => { let w = null; weeks.forEach(s => { if (d >= s) w = s; }); return w; };
    const created = count(tasks.filter(x => x.created_at && weekOf(x.created_at.slice(0, 10))), x => weekOf(x.created_at.slice(0, 10)));
    const done = count(tasks.filter(x => x.completed_at && weekOf(x.completed_at.slice(0, 10))), x => weekOf(x.completed_at.slice(0, 10)));

    // darta vs chalani, last 12 months
    const months = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 7)); }
    const dm = count(darta.filter(x => x.entry_type === 'darta'), x => String(x.entry_date).slice(0, 7));
    const cm = count(darta.filter(x => x.entry_type === 'chalani'), x => String(x.entry_date).slice(0, 7));
    const pendingDarta = darta.filter(x => ['open', 'in_progress'].includes(x.status));

    const byStatus = count(tasks.filter(x => x.status !== 'cancelled'), x => x.status_label);
    const byAssignee = count(open, x => x.assigned_to_name || '(unassigned)');
    const byPriority = count(open, x => x.priority);
    const byChannel = count(darta, x => x.channel);
    const byDept = count(pendingDarta, x => x.department_name || '(no department)');
    const top = (m, n = 8) => [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, n);
    const slim = x => ({ id: x.id, task_no: x.task_no, title: x.title, status_label: x.status_label, priority: x.priority, due_at: x.due_at, assigned_to_name: x.assigned_to_name, is_overdue: x.is_overdue, progress: x.progress });
    const slimD = x => ({ id: x.id, reg_no: x.reg_no, entry_type: x.entry_type, subject: x.subject, party_name: x.party_name, entry_date: x.entry_date, entry_date_bs: x.entry_date_bs, due_date: x.due_date, status_label: x.status_label, assigned_to_name: x.assigned_to_name, is_overdue: x.is_overdue });

    return {
        kpis: {
            my_open_tasks: mine.length, my_overdue_tasks: mine.filter(x => x.is_overdue).length, due_today: dueToday.length,
            done_this_month: doneMonth.length, open_tasks: open.length, overdue_tasks: open.filter(x => x.is_overdue).length,
            darta_this_month: darta.filter(x => x.entry_type === 'darta' && String(x.entry_date) >= monthStart).length,
            chalani_this_month: darta.filter(x => x.entry_type === 'chalani' && String(x.entry_date) >= monthStart).length,
            pending_darta: pendingDarta.length, overdue_darta: pendingDarta.filter(x => x.is_overdue).length,
            my_pending_darta: pendingDarta.filter(x => x.assigned_to === me).length
        },
        charts: {
            task_status: [...byStatus.entries()].map(([label, value]) => ({ label, value })),
            task_by_assignee: top(byAssignee),
            task_by_priority: ['urgent', 'high', 'normal', 'low'].map(p => ({ label: p[0].toUpperCase() + p.slice(1), value: byPriority.get(p) || 0 })),
            task_weekly: weeks.map(w => ({ label: w.slice(5), value: created.get(w) || 0, value2: done.get(w) || 0 })),
            darta_monthly: months.map(m => ({ label: `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`, value: dm.get(m) || 0, value2: cm.get(m) || 0 })),
            darta_by_channel: top(byChannel),
            pending_darta_by_department: top(byDept)
        },
        lists: {
            my_tasks: mine.sort((a, b) => String(a.due_at || '9999').localeCompare(String(b.due_at || '9999'))).slice(0, 15).map(slim),
            overdue_tasks: open.filter(x => x.is_overdue).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at))).slice(0, 15).map(slim),
            pending_darta: pendingDarta.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))).slice(0, 15).map(slimD),
            recent_darta: darta.slice(0, 10).map(slimD)
        },
        can_see_all_tasks: T.canSeeAll(req), can_darta: canDarta
    };
}

/** A request-like object for the current API caller (dashboard widgets run without req). */
async function contextRequest(c, t) {
    const { currentContext } = require('./requestContext');
    const ctx = currentContext() || {};
    const req = { auth: { userId: ctx.userId || null, tenantId: t, isSuperAdmin: !!ctx.isSuperAdmin }, userPermissions: {} };
    if (ctx.userId && !ctx.isSuperAdmin) {
        const { data } = await c.from('users').select('security_rights_groups(permissions)').eq('id', ctx.userId).maybeSingle();
        req.userPermissions = data?.security_rights_groups?.permissions || {};
    }
    return req;
}

module.exports = { workDashboard, contextRequest };
