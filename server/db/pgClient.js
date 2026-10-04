// =============================================
// db/pgClient.js - the ERP's database client on a plain PostgreSQL server
// The routes were written for @supabase/supabase-js (PostgREST). This file
// gives the same query-builder API straight on PostgreSQL through `pg`, so
// the ERP runs without Supabase (DATABASE_URL set - see utils/dbHelpers):
//
//   c.from('t').select('a, b, alias:fk_col(x, y), child_table(*)', { count: 'exact', head })
//     .eq / neq / gt / gte / lt / lte / like / ilike / in / is / not / or / match / filter
//     .order(col, { ascending, nullsFirst }) .range(from, to) .limit(n)
//     .single() .maybeSingle() .csv()
//   c.from('t').insert(rowOrRows) / upsert(rows, { onConflict, ignoreDuplicates })
//     / update(values) / delete()   [ .select(...) returns the rows ]
//   c.rpc('fn', { arg: value })
// Every call resolves to { data, error, count, status, statusText } like
// supabase-js; errors keep PostgreSQL codes (23505 …) and PostgREST codes
// where the routes look for them (PGRST116 single row, PGRST204 column).
//
// Embedded resources work like PostgREST, from the foreign keys:
//   alias:fk_column(cols)  the row the FK column points to (object or null)
//   table(cols)            to-one when this table points to it, else the list
//                          of its rows that point here
//   …!inner(…)             parent rows without a match are left out
//   .eq('alias.col', v)    filters the embedded rows (with !inner the parents too)
// Values come back as PostgREST sends them: numeric / bigint as numbers,
// dates "YYYY-MM-DD", timestamps "YYYY-MM-DDTHH:MM:SS…+00:00".
// The audit headers (x-erp-user / x-erp-ip / x-erp-route) are handed to the
// audit trigger as request.headers, as PostgREST does.
// =============================================
const { Pool, types } = require('pg');
const { currentContext } = require('../utils/requestContext');

// ---- values as PostgREST returns them ----
const tz = v => (v === null ? null : v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));   // numeric
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));    // bigint
types.setTypeParser(1082, v => v);                                     // date
types.setTypeParser(1114, v => (v === null ? null : v.replace(' ', 'T'))); // timestamp
types.setTypeParser(1184, tz);                                         // timestamptz
types.setTypeParser(1231, v => (v === null ? null : v.replace(/^\{|\}$/g, '').split(',').filter(x => x !== '').map(Number))); // numeric[]

const SCHEMAS = ['tenant_master', 'tenant_trans', 'public'];
const qi = s => `"${String(s).replace(/"/g, '""')}"`;

function pgError(e, status = 400) {
    const err = { message: e.message || String(e), code: e.code || null, details: e.detail || e.details || null, hint: e.hint || null };
    return { data: null, error: err, count: null, status: e.httpStatus || status, statusText: 'Error' };
}
const apiError = (code, message, status = 400, details = null) => ({ httpStatus: status, code, message, details });

// =============================================
// schema metadata (tables, columns, primary keys, foreign keys) per database
// =============================================
async function loadMeta(pool) {
    const cols = await pool.query(`SELECT c.table_schema s, c.table_name t, c.column_name col, c.udt_name udt, c.data_type dt
        FROM information_schema.columns c WHERE c.table_schema = ANY($1) ORDER BY c.table_schema, c.table_name, c.ordinal_position`, [SCHEMAS]);
    const pks = await pool.query(`SELECT n.nspname s, c.relname t, a.attname col
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
        WHERE i.indisprimary AND n.nspname = ANY($1)`, [SCHEMAS]);
    const fks = await pool.query(`SELECT con.conname name, n1.nspname s, c1.relname t, n2.nspname rs, c2.relname rt,
            (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) cols,
            (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) rcols
        FROM pg_constraint con JOIN pg_class c1 ON c1.oid = con.conrelid JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
        JOIN pg_class c2 ON c2.oid = con.confrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE con.contype = 'f' AND n1.nspname = ANY($1)`, [SCHEMAS]);
    const funcs = await pool.query(`SELECT n.nspname s, p.proname f, p.proretset rs, t.typtype tt, t.typname tn
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_type t ON t.oid = p.prorettype WHERE n.nspname = ANY($1)`, [SCHEMAS]);
    const tables = new Map(); // name -> { schema, cols: Map(col -> udt), pk: [] }  (first schema in the search path wins)
    cols.rows.forEach(r => {
        let t = tables.get(r.t);
        if (t && t.schema !== r.s) { if (SCHEMAS.indexOf(r.s) > SCHEMAS.indexOf(t.schema)) return; }
        if (!t || t.schema !== r.s) { t = { name: r.t, schema: r.s, cols: new Map(), pk: [] }; tables.set(r.t, t); }
        t.cols.set(r.col, r.udt);
    });
    pks.rows.forEach(r => { const t = tables.get(r.t); if (t && t.schema === r.s) t.pk.push(r.col); });
    const fkList = fks.rows.filter(r => tables.get(r.t)?.schema === r.s && tables.get(r.rt)?.schema === r.rs)
        .map(r => ({ name: r.name, table: r.t, cols: r.cols, ref: r.rt, refCols: r.rcols }));
    // views: a column taken straight from a base-table column with a foreign key
    // gets that foreign key too (PostgREST does the same for embedding)
    const vcu = await pool.query(`SELECT u.view_name v, u.table_name bt, u.column_name col FROM information_schema.view_column_usage u
        WHERE u.view_schema = ANY($1)`, [SCHEMAS]);
    vcu.rows.forEach(r => {
        const view = tables.get(r.v);
        if (!view || !view.cols.has(r.col)) return;
        fkList.filter(f => f.table === r.bt && f.cols.length === 1 && f.cols[0] === r.col)
            .forEach(f => { if (!fkList.some(x => x.table === r.v && x.cols[0] === r.col && x.ref === f.ref)) fkList.push({ name: `${r.v}_${r.col}_fkey`, table: r.v, cols: [r.col], ref: f.ref, refCols: f.refCols }); });
    });
    const fnMap = new Map();
    funcs.rows.forEach(r => { if (!fnMap.has(r.f)) fnMap.set(r.f, { schema: r.s, setof: r.rs, composite: r.tt === 'c' || r.tn === 'record', voidRet: r.tn === 'void' }); });
    return { tables, fks: fkList, funcs: fnMap };
}

// =============================================
// select string -> tree
// =============================================
function splitTop(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map(x => x.trim()).filter(Boolean);
}
function parseSelect(str) {
    return splitTop(String(str || '*').replace(/\s+/g, ' ')).map(item => {
        const m = item.match(/^(?:([A-Za-z_][\w]*)\s*:\s*)?([A-Za-z_][\w]*|\*)(?:!([\w]+))?(?:!([\w]+))?\s*(?:\((.*)\))?$/s);
        if (!m) throw apiError('PGRST100', `"failed to parse select parameter (${item})"`);
        const [, alias, name, h1, h2, inner] = m;
        const hints = [h1, h2].filter(Boolean);
        if (inner === undefined) return { kind: 'col', name, alias: alias || name };
        return { kind: 'embed', name, alias: alias || name, inner: hints.includes('inner'), hint: hints.find(h => h !== 'inner') || null, select: parseSelect(inner) };
    });
}

// =============================================
// the query builder
// =============================================
class Query {
    constructor(client, table) {
        this.c = client; this.table = table; this.op = 'select';
        this.selectStr = '*'; this.wantRows = true; this.countMode = null; this.head = false;
        this.filters = []; this.orders = []; this.lim = null; this.off = null;
        this.mode = null; this.values = null; this.upsertOpts = null;
    }
    // ---- operations ----
    select(cols = '*', opts = {}) {
        this.selectStr = cols || '*';
        if (this.op !== 'select') this.wantRows = true;
        if (opts.count) this.countMode = opts.count;
        if (opts.head) this.head = true;
        return this;
    }
    insert(values, opts = {}) { this.op = 'insert'; this.values = values; this.wantRows = false; if (opts.count) this.countMode = opts.count; return this; }
    upsert(values, opts = {}) { this.op = 'upsert'; this.values = values; this.upsertOpts = opts; this.wantRows = false; if (opts.count) this.countMode = opts.count; return this; }
    update(values, opts = {}) { this.op = 'update'; this.values = values; this.wantRows = false; if (opts.count) this.countMode = opts.count; return this; }
    delete(opts = {}) { this.op = 'delete'; this.wantRows = false; if (opts.count) this.countMode = opts.count; return this; }
    // ---- filters ----
    _f(col, op, val) { this.filters.push({ col, op, val }); return this; }
    eq(c, v) { return this._f(c, 'eq', v); }
    neq(c, v) { return this._f(c, 'neq', v); }
    gt(c, v) { return this._f(c, 'gt', v); }
    gte(c, v) { return this._f(c, 'gte', v); }
    lt(c, v) { return this._f(c, 'lt', v); }
    lte(c, v) { return this._f(c, 'lte', v); }
    like(c, v) { return this._f(c, 'like', v); }
    ilike(c, v) { return this._f(c, 'ilike', v); }
    in(c, v) { return this._f(c, 'in', v); }
    is(c, v) { return this._f(c, 'is', v); }
    contains(c, v) { return this._f(c, 'cs', v); }
    containedBy(c, v) { return this._f(c, 'cd', v); }
    overlaps(c, v) { return this._f(c, 'ov', v); }
    not(c, op, v) { return this._f(c, `not.${op}`, v); }
    filter(c, op, v) { return this._f(c, op, typeof v === 'string' && /^\(.*\)$/.test(v) && /in$/.test(op) ? v.slice(1, -1).split(',').map(x => x.trim().replace(/^"|"$/g, '')) : v); }
    match(obj) { Object.entries(obj || {}).forEach(([k, v]) => this.eq(k, v)); return this; }
    or(expr, opts = {}) { this.filters.push({ or: String(expr), on: opts.referencedTable || opts.foreignTable || null }); return this; }
    // ---- shape ----
    order(col, opts = {}) {
        const on = opts.referencedTable || opts.foreignTable;
        this.orders.push({ col: on ? `${on}.${col}` : col, asc: opts.ascending !== false, nullsFirst: opts.nullsFirst });
        return this;
    }
    limit(n, opts = {}) { if (!(opts.referencedTable || opts.foreignTable)) this.lim = n; return this; }
    range(from, to) { this.off = from; this.lim = to - from + 1; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    csv() { this.mode = 'csv'; return this; }
    abortSignal() { return this; }
    returns() { return this; }
    throwOnError() { this.throws = true; return this; }
    then(resolve, reject) { return this._run().then(r => { if (this.throws && r.error) throw Object.assign(new Error(r.error.message), r.error); return r; }).then(resolve, reject); }
    catch(fn) { return this.then(undefined, fn); }
    finally(fn) { return this.then(v => { fn(); return v; }, e => { fn(); throw e; }); }

    async _run() {
        try {
            const meta = await this.c.meta();
            const t = meta.tables.get(this.table);
            if (!t) throw apiError('PGRST205', `Could not find the table 'public.${this.table}' in the schema cache`, 404);
            const ctx = new SqlCtx(meta);
            if (this.op === 'select') return await this._select(t, ctx);
            return await this._mutate(t, ctx);
        } catch (e) {
            return pgError(e, e.httpStatus || 400);
        }
    }

    // WHERE for the main table; embedded filters go to the embeds
    _where(t, ctx, alias, embedsByAlias) {
        const parts = [];
        for (const f of this.filters) {
            if (f.or !== undefined) {
                if (f.on) { const e = embedsByAlias[f.on]; if (e) e.extra.push(ctx.orExpr(e.table, e.sqlAlias, f.or)); continue; }
                parts.push(ctx.orExpr(t, alias, f.or));
                continue;
            }
            const dot = f.col.indexOf('.');
            if (dot > 0 && !t.cols.has(f.col)) {
                const eAlias = f.col.slice(0, dot), col = f.col.slice(dot + 1);
                const e = embedsByAlias[eAlias];
                if (!e) throw apiError('PGRST108', `'${eAlias}' is not an embedded resource in this request`);
                e.extra.push(ctx.cond(e.table, e.sqlAlias, col, f.op, f.val));
                continue;
            }
            parts.push(ctx.cond(t, alias, f.col, f.op, f.val));
        }
        // !inner embeds (and embeds that carry filters with !inner) must exist
        Object.values(embedsByAlias).forEach(e => { if (e.inner) parts.push(`EXISTS (${e.existsSql()})`); });
        return parts;
    }

    async _select(t, ctx) {
        const tree = parseSelect(this.selectStr);
        const base = 't0';
        const from = `${qi(t.schema)}.${qi(t.name)} ${base}`;
        const build = c2 => {
            const { list, embeds } = c2.selectList(t, base, tree);
            const where = this._where(t, c2, base, Object.fromEntries(embeds.map(e => [e.alias, e])));
            return { list, whereSql: where.length ? ` WHERE ${where.join(' AND ')}` : '' };
        };
        let count = null;
        if (this.countMode) {
            const cc = new SqlCtx(ctx.meta);
            const { whereSql: w } = build(cc);
            const r = await this.c.query(`SELECT count(*)::bigint n FROM ${from}${w}`, cc.params);
            count = r.rows[0].n;
        }
        const { list: rawList, whereSql } = build(ctx);
        const list = ctx.render(rawList);
        if (this.head) return { data: null, error: null, count, status: 200, statusText: 'OK' };
        const order = this.orders.map(o => {
            const dot = o.col.indexOf('.');
            const ref = dot > 0 && !t.cols.has(o.col) ? null : ctx.col(t, base, o.col);
            if (!ref) return null;
            return `${ref} ${o.asc ? 'ASC' : 'DESC'}${o.nullsFirst === true ? ' NULLS FIRST' : o.nullsFirst === false ? ' NULLS LAST' : (o.asc ? ' NULLS LAST' : ' NULLS FIRST')}`;
        }).filter(Boolean);
        let sql = `SELECT ${list.join(', ')} FROM ${from}${whereSql}`;
        if (order.length) sql += ` ORDER BY ${order.join(', ')}`;
        if (this.mode === 'single' || this.mode === 'maybe') sql += ` LIMIT ${this.lim ? Math.min(this.lim, 2) : 2}${this.off ? ` OFFSET ${Number(this.off)}` : ''}`;
        else {
            if (this.lim !== null && this.lim !== undefined) sql += ` LIMIT ${Math.max(0, Number(this.lim))}`;
            if (this.off) sql += ` OFFSET ${Number(this.off)}`;
        }
        const r = await this.c.query(sql, ctx.params);
        return this._shape(r.rows, count, 200);
    }

    _shape(rows, count, status) {
        if (this.mode === 'single') {
            if (rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null }, count, status: 406, statusText: 'Not Acceptable' };
            return { data: rows[0], error: null, count, status, statusText: 'OK' };
        }
        if (this.mode === 'maybe') {
            if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null }, count, status: 406, statusText: 'Not Acceptable' };
            return { data: rows[0] || null, error: null, count, status, statusText: 'OK' };
        }
        if (this.mode === 'csv') {
            const keys = rows.length ? Object.keys(rows[0]) : [];
            const esc = v => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
            return { data: [keys.join(','), ...rows.map(r => keys.map(k => esc(typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : r[k])).join(','))].join('\n'), error: null, count, status, statusText: 'OK' };
        }
        return { data: rows, error: null, count, status, statusText: 'OK' };
    }

    async _mutate(t, ctx) {
        const base = 't0';
        let sql;
        if (this.op === 'insert' || this.op === 'upsert') {
            const rows = (Array.isArray(this.values) ? this.values : [this.values]).filter(r => r && typeof r === 'object');
            if (!rows.length) return { data: this.wantRows ? [] : null, error: null, count: 0, status: 201, statusText: 'Created' };
            const keys = [];
            rows.forEach(r => Object.keys(r).forEach(k => { if (r[k] !== undefined && !keys.includes(k)) keys.push(k); }));
            keys.forEach(k => { if (!t.cols.has(k)) throw apiError('PGRST204', `Could not find the '${k}' column of '${t.name}' in the schema cache`); });
            const values = rows.map(r => `(${keys.map(k => (r[k] === undefined ? 'DEFAULT' : ctx.val(t, k, r[k]))).join(', ')})`);
            sql = keys.length
                ? `INSERT INTO ${qi(t.schema)}.${qi(t.name)} AS ${base} (${keys.map(qi).join(', ')}) VALUES ${values.join(', ')}`
                : `INSERT INTO ${qi(t.schema)}.${qi(t.name)} AS ${base} DEFAULT VALUES`;
            if (this.op === 'upsert') {
                const target = (this.upsertOpts?.onConflict ? String(this.upsertOpts.onConflict).split(',').map(s => s.trim()) : t.pk);
                const upd = keys.filter(k => !target.includes(k));
                sql += ` ON CONFLICT (${target.map(qi).join(', ')}) DO ${this.upsertOpts?.ignoreDuplicates || !upd.length ? 'NOTHING' : `UPDATE SET ${upd.map(k => `${qi(k)} = EXCLUDED.${qi(k)}`).join(', ')}`}`;
            }
        } else if (this.op === 'update') {
            const v = this.values || {};
            const keys = Object.keys(v).filter(k => v[k] !== undefined);
            keys.forEach(k => { if (!t.cols.has(k)) throw apiError('PGRST204', `Could not find the '${k}' column of '${t.name}' in the schema cache`); });
            if (!keys.length) return { data: this.wantRows ? [] : null, error: null, count: 0, status: 204, statusText: 'No Content' };
            const where = this._where(t, ctx, base, {});
            sql = `UPDATE ${qi(t.schema)}.${qi(t.name)} AS ${base} SET ${keys.map(k => `${qi(k)} = ${ctx.val(t, k, v[k])}`).join(', ')}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
        } else {
            const where = this._where(t, ctx, base, {});
            sql = `DELETE FROM ${qi(t.schema)}.${qi(t.name)} AS ${base}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
        }
        const status = this.op === 'insert' || this.op === 'upsert' ? 201 : this.wantRows ? 200 : 204;
        if (!this.wantRows && !this.countMode) {
            await this.c.query(sql, ctx.params);
            return { data: null, error: null, count: null, status, statusText: 'OK' };
        }
        // the changed rows, shaped like a select of them
        const tree = parseSelect(this.wantRows ? this.selectStr : '*');
        const sel = new SqlCtx(ctx.meta, ctx.params);
        const list = sel.render(sel.selectList(t, 'm', tree).list);
        const r = await this.c.query(`WITH m AS (${sql} RETURNING ${base}.*) SELECT ${list.join(', ')} FROM m`, ctx.params);
        const count = this.countMode ? r.rows.length : null;
        if (!this.wantRows) return { data: null, error: null, count, status, statusText: 'OK' };
        return this._shape(r.rows, count, status);
    }
}

// =============================================
// SQL pieces: parameters, columns, conditions, embeds
// =============================================
class SqlCtx {
    constructor(meta, params) { this.meta = meta; this.params = params || []; this.n = 0; }
    p(v) { this.params.push(v); return `$${this.params.length}`; }
    alias() { this.n += 1; return `e${this.n}_${Math.random().toString(36).slice(2, 6)}`; }
    col(t, alias, name) {
        const col = String(name).trim();
        if (!t.cols.has(col)) throw apiError('42703', `column ${t.name}.${col} does not exist`);
        return `${alias}.${qi(col)}`;
    }
    val(t, col, v) {
        if (v === null) return 'NULL';
        const udt = t.cols.get(col);
        if (udt === 'json' || udt === 'jsonb') return `${this.p(typeof v === 'string' ? v : JSON.stringify(v))}::${udt}`;
        if (Array.isArray(v)) return `${this.p(v)}::${udt}`;
        if (v instanceof Date) return this.p(v.toISOString());
        if (typeof v === 'object') return this.p(JSON.stringify(v));
        return this.p(v);
    }
    cond(t, alias, colName, op, v) {
        const neg = op.startsWith('not.');
        const o = neg ? op.slice(4) : op;
        const c = this.col(t, alias, colName);
        let s;
        switch (o) {
            case 'eq': s = v === null ? `${c} IS NULL` : `${c} = ${this.p(v)}`; break;
            case 'neq': s = v === null ? `${c} IS NOT NULL` : `${c} <> ${this.p(v)}`; break;
            case 'gt': s = `${c} > ${this.p(v)}`; break;
            case 'gte': s = `${c} >= ${this.p(v)}`; break;
            case 'lt': s = `${c} < ${this.p(v)}`; break;
            case 'lte': s = `${c} <= ${this.p(v)}`; break;
            case 'like': s = `${c}::text LIKE ${this.p(String(v).replace(/\*/g, '%'))}`; break;
            case 'ilike': s = `${c}::text ILIKE ${this.p(String(v).replace(/\*/g, '%'))}`; break;
            case 'in': {
                const arr = (Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, '').split(',')).filter(x => x !== undefined);
                const vals = arr.filter(x => x !== null);
                const parts = [];
                const udt = t.cols.get(String(colName).trim());
                if (vals.length) parts.push(/^(uuid|int2|int4|int8|text|varchar|bpchar|date|numeric|bool)$/.test(udt || '')
                    ? `${c} = ANY(${this.p(vals.map(String))}::${udt}[])`
                    : `${c}::text = ANY(${this.p(vals.map(String))}::text[])`);
                if (arr.some(x => x === null)) parts.push(`${c} IS NULL`);
                s = parts.length ? `(${parts.join(' OR ')})` : 'FALSE';
                break;
            }
            case 'is': {
                const w = v === null || v === 'null' ? 'NULL' : v === true || v === 'true' ? 'TRUE' : v === false || v === 'false' ? 'FALSE' : 'UNKNOWN';
                s = `${c} IS ${w}`; break;
            }
            case 'cs': s = `${c} @> ${this.val(t, colName, v)}`; break;
            case 'cd': s = `${c} <@ ${this.val(t, colName, v)}`; break;
            case 'ov': s = `${c} && ${this.val(t, colName, v)}`; break;
            default: throw apiError('PGRST100', `unknown filter operator ${op}`);
        }
        return neg ? `NOT (${s})` : s;
    }
    /** PostgREST or() / and() string: "a.eq.1,b.ilike.%x%,and(c.gt.1,d.lt.2)" */
    orExpr(t, alias, expr, joiner = 'OR') {
        const parts = splitTop(expr).map(item => {
            const g = item.match(/^(not\.)?(and|or)\((.*)\)$/s);
            if (g) { const inner = this.orExpr(t, alias, g[3], g[2].toUpperCase()); return g[1] ? `NOT ${inner}` : inner; }
            const m = item.match(/^([\w]+)\.(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|in|is|cs|cd|ov)\.(.*)$/s);
            if (!m) throw apiError('PGRST100', `"failed to parse logic tree (${expr})"`);
            const [, col, not, op, raw] = m;
            let v = raw;
            if (op === 'in') v = raw.replace(/^\(|\)$/g, '').split(',').map(x => x.trim().replace(/^"|"$/g, ''));
            else if (op === 'is') v = raw;
            else if (/^".*"$/.test(raw)) v = raw.slice(1, -1);
            return this.cond(t, alias, col, `${not ? 'not.' : ''}${op}`, v);
        });
        return parts.length ? `(${parts.join(` ${joiner} `)})` : 'TRUE';
    }

    /** select list for a table at `alias`; embeds become correlated sub-queries */
    selectList(t, alias, tree) {
        const list = [], embeds = [];
        tree.forEach(node => {
            if (node.kind === 'col') {
                if (node.name === '*') { list.push(`${alias}.*`); return; }
                list.push(`${this.col(t, alias, node.name)} AS ${qi(node.alias)}`);
                return;
            }
            const e = this.embed(t, alias, node);
            embeds.push(e);
            list.push(e);
        });
        return { list, embeds };
    }
    /** the select list as SQL (embeds rendered now, after their filters were added) */
    render(list) { return list.map(x => (typeof x === 'string' ? x : `(${x.sql()}) AS ${qi(x.alias)}`)); }
    /** resolve an embed through the foreign keys */
    embed(t, alias, node) {
        const fks = this.meta.fks;
        let rel = null;
        // alias:fk_column(...) or fk_column!inner(...)
        if (t.cols.has(node.name)) {
            const fk = fks.find(f => f.table === t.name && f.cols.length === 1 && f.cols[0] === node.name);
            if (fk) rel = { many: false, target: fk.ref, on: (a, b) => `${b}.${qi(fk.refCols[0])} = ${a}.${qi(fk.cols[0])}` };
        }
        if (!rel && this.meta.tables.has(node.name)) {
            const out = fks.filter(f => f.table === t.name && f.ref === node.name && (!node.hint || f.name === node.hint || f.cols.includes(node.hint)));
            const inn = fks.filter(f => f.table === node.name && f.ref === t.name && (!node.hint || f.name === node.hint || f.cols.includes(node.hint)));
            if (out.length) { const fk = out[0]; rel = { many: false, target: node.name, on: (a, b) => fk.cols.map((c, i) => `${b}.${qi(fk.refCols[i])} = ${a}.${qi(c)}`).join(' AND ') }; }
            else if (inn.length) { const fk = inn[0]; rel = { many: true, target: node.name, on: (a, b) => fk.cols.map((c, i) => `${b}.${qi(c)} = ${a}.${qi(fk.refCols[i])}`).join(' AND ') }; }
        }
        if (!rel) throw apiError('PGRST200', `Could not find a relationship between '${t.name}' and '${node.name}' in the schema cache`);
        const target = this.meta.tables.get(rel.target);
        const self = this;
        const b = this.alias();
        const e = {
            alias: node.alias, sqlAlias: b, table: target, inner: node.inner, extra: [],
            existsSql() { return `SELECT 1 FROM ${qi(target.schema)}.${qi(target.name)} ${b} WHERE ${[rel.on(alias, b), ...e.extra].join(' AND ')}`; },
            sql() {
                const sub = self.selectList(target, b, node.select);
                const row = `(SELECT x FROM (SELECT ${self.render(sub.list).join(', ')}) x)`;
                const where = [rel.on(alias, b), ...e.extra].join(' AND ');
                const from = `${qi(target.schema)}.${qi(target.name)} ${b}`;
                return rel.many
                    ? `SELECT coalesce(json_agg(row_to_json(${row})), '[]'::json) FROM ${from} WHERE ${where}`
                    : `SELECT row_to_json(${row}) FROM ${from} WHERE ${where} LIMIT 1`;
            }
        };
        return e;
    }
}

// =============================================
// the client
// =============================================
class PgClient {
    constructor(pool) { this.pool = pool; this._meta = null; }
    meta() { if (!this._meta) this._meta = loadMeta(this.pool).catch(e => { this._meta = null; throw e; }); return this._meta; }
    reloadMeta() { this._meta = null; }
    from(table) { return new Query(this, table); }
    /** one statement; the request's audit headers go along as request.headers */
    async query(sql, params) {
        const ctx = currentContext();
        if (!ctx || !ctx.userId) return this.pool.query(sql, params);
        const conn = await this.pool.connect();
        try {
            await conn.query('BEGIN');
            const h = { 'x-erp-user': String(ctx.userId) };
            if (ctx.ip) h['x-erp-ip'] = String(ctx.ip);
            if (ctx.route) h['x-erp-route'] = String(ctx.route);
            await conn.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify(h)]);
            const r = await conn.query(sql, params);
            await conn.query('COMMIT');
            return r;
        } catch (e) {
            await conn.query('ROLLBACK').catch(() => {});
            throw e;
        } finally { conn.release(); }
    }
    async rpc(fn, args = {}) {
        try {
            const meta = await this.meta();
            const f = meta.funcs.get(fn);
            if (!f) throw apiError('PGRST202', `Could not find the function public.${fn} in the schema cache`, 404);
            const params = [];
            const named = Object.entries(args || {}).filter(([, v]) => v !== undefined)
                .map(([k, v]) => { params.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v); return `${qi(k)} => $${params.length}`; });
            const call = `${qi(f.schema)}.${qi(fn)}(${named.join(', ')})`;
            if (f.setof || f.composite) {
                const r = await this.query(`SELECT * FROM ${call}`, params);
                return { data: f.setof ? r.rows : (r.rows[0] || null), error: null, status: 200, statusText: 'OK' };
            }
            const r = await this.query(`SELECT ${call} AS v`, params);
            return { data: f.voidRet ? null : r.rows[0]?.v ?? null, error: null, status: 200, statusText: 'OK' };
        } catch (e) {
            return pgError(e, e.httpStatus || 400);
        }
    }
}

const pools = new Map();
/** one pool per connection string; search_path = tenant_master, tenant_trans, public; UTC */
function poolFor(connectionString) {
    if (!pools.has(connectionString)) {
        const pool = new Pool({
            connectionString, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000,
            options: `-c search_path=${SCHEMAS.join(',')} -c TimeZone=UTC`
        });
        pool.on('error', e => console.error('[pg] idle client error:', e.message));
        pools.set(connectionString, pool);
    }
    return pools.get(connectionString);
}
const clients = new Map();
function createPgClient(connectionString) {
    if (!clients.has(connectionString)) clients.set(connectionString, new PgClient(poolFor(connectionString)));
    return clients.get(connectionString);
}

module.exports = { createPgClient, poolFor, parseSelect, SCHEMAS };
