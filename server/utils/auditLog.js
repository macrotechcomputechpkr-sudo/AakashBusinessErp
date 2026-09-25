// =============================================
// utils/auditLog.js
// Reads tenant_master.audit_log (written by the database trigger in
// database/121_audit_log_schema.sql for every master and entry table):
//   list      - filter by date, module, table, action, user, record, text
//   history   - one record with its line rows (header + details)
//   tables    - every table, its module and whether it is audited
// =============================================
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s });
const UUID = /^[0-9a-f-]{36}$/i;
const TABLE = /^[a-z0-9_]{1,63}$/;

const MODULE_RULES = [
    ['Sales', /^(sales_|route_plans$|mobile_visits$|agent_)/],
    ['Purchase', /^(purchase_|lc_bill_mappings$)/],
    ['Accounts', /^(journal_|cash_bank_|bulk_cash|pdc_|credit_note|debit_note|bill_wise_|bank_|interest_|depreciation_|fixed_assets$|letters_of_credit$|bank_guarantees$|lc_bg_|budget|opening_balances$|ledger_opening)/],
    ['Inventory', /^(stock_|production_|bom_|product_batches$|product_serial_records$|product_vehicle_records$|product_rack_locations$)/],
    ['Masters', /^(products$|product_|ledger_accounts$|account_groups$|sub_ledgers$|areas$|routes$|route_customers$|salesman_agents$|transport_master$|billing_terms$|remarks_master$|terms_conditions_master$|discount_|rate_categories$|cost_centers$|profit_centers$|customs_offices$|ledger_categories$|ledger_account_categories$)/],
    ['Setup & Users', /./]
];
const moduleOf = t => MODULE_RULES.find(([, re]) => re.test(t))[0];
const labelOf = t => t.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());

async function tables(c) {
    const { data, error } = await c.rpc('audit_coverage');
    if (error) throw httpError(/audit_coverage/.test(error.message) ? 'Run database/121_audit_log_schema.sql first' : error.message, 500);
    return (data || []).map(r => ({ ...r, label: labelOf(r.table_name), module: moduleOf(r.table_name) }));
}

async function userNames(c, t, ids) {
    const list = [...new Set(ids.filter(x => x && UUID.test(x)))];
    if (!list.length) return {};
    const { data } = await c.from('users').select('id, full_name, email').eq('tenant_id', t).in('id', list);
    return Object.fromEntries((data || []).map(u => [u.id, u.full_name || u.email]));
}

// latest known name of each parent document (for line rows)
async function parentLabels(c, t, rows) {
    const need = rows.filter(r => r.parent_id);
    if (!need.length) return {};
    const { data } = await c.from('audit_log').select('table_name, record_id, record_label, id').eq('tenant_id', t)
        .in('table_name', [...new Set(need.map(r => r.parent_table))]).in('record_id', [...new Set(need.map(r => r.parent_id))])
        .order('id', { ascending: false }).limit(2000);
    const m = {};
    (data || []).forEach(r => { const k = `${r.table_name}|${r.record_id}`; if (!m[k] && r.record_label) m[k] = r.record_label; });
    return m;
}

async function decorate(c, t, rows) {
    const [names, parents] = await Promise.all([userNames(c, t, rows.map(r => r.user_id)), parentLabels(c, t, rows)]);
    return rows.map(r => ({
        ...r,
        table_label: labelOf(r.table_name),
        module: moduleOf(r.table_name),
        action_label: { I: 'Created', U: 'Changed', D: 'Deleted' }[r.action] || r.action,
        user_name: r.user_id ? names[r.user_id] || r.user_id.slice(0, 8) : (r.source === 'db' ? '(database)' : ''),
        parent_label: r.parent_id ? parents[`${r.parent_table}|${r.parent_id}`] || null : null
    }));
}

async function list(c, t, q = {}) {
    const page = Math.max(1, Number(q.page) || 1), size = Math.min(1000, Math.max(10, Number(q.page_size) || 200));
    let tbls = String(q.table || '').split(',').map(s => s.trim()).filter(Boolean);
    if (tbls.some(x => !TABLE.test(x))) throw httpError('Bad table name');
    if (q.module) {
        const all = await tables(c);
        const inModule = all.filter(x => x.module === q.module).map(x => x.table_name);
        tbls = tbls.length ? tbls.filter(x => inModule.includes(x)) : inModule;
        if (!tbls.length) return { rows: [], page, page_size: size, has_more: false };
    }
    let b = c.from('audit_log').select('*').eq('tenant_id', t);
    if (q.date_from) b = b.gte('changed_at', `${String(q.date_from).slice(0, 10)}T00:00:00`);
    if (q.date_to) b = b.lte('changed_at', `${String(q.date_to).slice(0, 10)}T23:59:59.999`);
    if (tbls.length) b = b.in('table_name', tbls);
    if (q.action && /^[IUD]$/.test(q.action)) b = b.eq('action', q.action);
    if (q.user_id && UUID.test(q.user_id)) b = b.eq('user_id', q.user_id);
    if (q.record_id) b = b.eq('record_id', String(q.record_id));
    if (q.source === 'db' || q.source === 'api') b = b.eq('source', q.source);
    if (q.q) b = b.ilike('record_label', `%${String(q.q).replace(/[%_,()]/g, ' ').trim()}%`);
    const { data, error } = await b.order('changed_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * size, page * size);
    if (error) throw error;
    const rows = data || [];
    return { rows: await decorate(c, t, rows.slice(0, size)), page, page_size: size, has_more: rows.length > size };
}

async function history(c, t, table, id) {
    if (!TABLE.test(table || '') || !id) throw httpError('Table and record are required');
    const [own, lines] = await Promise.all([
        c.from('audit_log').select('*').eq('tenant_id', t).eq('table_name', table).eq('record_id', String(id)).order('id').limit(2000),
        c.from('audit_log').select('*').eq('tenant_id', t).eq('parent_table', table).eq('parent_id', String(id)).order('id').limit(5000)
    ]);
    if (own.error) throw own.error;
    if (lines.error) throw lines.error;
    const rows = [...(own.data || []), ...(lines.data || [])].sort((a, b) => Number(b.id) - Number(a.id));
    return { table, record_id: String(id), rows: await decorate(c, t, rows) };
}

async function purge(c, t, before) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(before || ''))) throw httpError('Give the date (YYYY-MM-DD) before which entries are removed');
    const { data, error } = await c.rpc('audit_purge', { p_tenant: t, p_before: before });
    if (error) throw httpError(error.message);
    return { removed: Number(data) || 0 };
}

async function users(c, t) {
    const { data, error } = await c.from('users').select('id, full_name, email').eq('tenant_id', t).order('full_name');
    if (error) throw error;
    return (data || []).map(u => ({ id: u.id, name: u.full_name || u.email }));
}

module.exports = { list, history, tables, purge, users, moduleOf, labelOf };
