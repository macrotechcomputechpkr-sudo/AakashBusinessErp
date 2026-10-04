// =============================================
// db/migrate.js - database/*.sql on the ERP's own PostgreSQL server
// Local mode (DATABASE_URL set, no Supabase):
//   * the global database (DATABASE_URL) gets 01_global_master_schema.sql
//     and 124_default_admin_logins_schema.sql (companies list + logins,
//     default super admin)
//   * every company gets its own database erp_<9-digit code> with all the
//     other numbered files, in number order
// Each database remembers what ran in public.erp_schema_migrations, so a
// new database/*.sql file is applied to the global database and to every
// company's database the next time the server starts (or a company is created).
// =============================================
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { SCHEMAS } = require('./pgClient');

const DIR = path.join(__dirname, '..', '..', 'database');
const GLOBAL_FILES = ['01_global_master_schema.sql', '124_default_admin_logins_schema.sql', '156_global_tenants_company_columns_schema.sql'];
const num = f => parseInt(f, 10);

function migrationFiles(kind) {
    const all = fs.readdirSync(DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort((a, b) => num(a) - num(b) || a.localeCompare(b));
    return kind === 'global' ? all.filter(f => GLOBAL_FILES.includes(f)) : all.filter(f => !GLOBAL_FILES.includes(f));
}

/** run the pending files of one database; returns the files applied */
async function migrate(connectionString, kind, log = console.log) {
    const client = new Client({ connectionString, options: `-c search_path=${SCHEMAS.join(',')} -c TimeZone=UTC` });
    await client.connect();
    const applied = [];
    try {
        await client.query('CREATE TABLE IF NOT EXISTS public.erp_schema_migrations (file TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        const done = new Set((await client.query('SELECT file FROM public.erp_schema_migrations')).rows.map(r => r.file));
        for (const file of migrationFiles(kind)) {
            if (done.has(file)) continue;
            const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
            try {
                await client.query(sql);
            } catch (e) {
                throw new Error(`${file}: ${e.message}`);
            }
            await client.query('INSERT INTO public.erp_schema_migrations (file) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
            applied.push(file);
        }
    } finally {
        await client.end().catch(() => {});
    }
    if (applied.length) log(`[db] ${kind} ${new URL(connectionString).pathname.slice(1)}: applied ${applied.length} file(s) (${applied[0]} … ${applied[applied.length - 1]})`);
    return applied;
}

/** the connection string of another database on the same server */
function databaseUrl(baseUrl, dbName) {
    const u = new URL(baseUrl);
    u.pathname = `/${dbName}`;
    return u.toString();
}

/** CREATE DATABASE (if missing) */
async function createDatabase(baseUrl, dbName) {
    if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`bad database name ${dbName}`);
    const client = new Client({ connectionString: baseUrl });
    await client.connect();
    try {
        const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        if (!rows.length) await client.query(`CREATE DATABASE "${dbName}"`);
        return !rows.length;
    } finally {
        await client.end().catch(() => {});
    }
}

/** DROP DATABASE (a company whose creation failed) */
async function dropDatabase(baseUrl, dbName) {
    if (!/^erp_[0-9]{9}$/.test(dbName)) throw new Error(`refusing to drop ${dbName}`);
    const client = new Client({ connectionString: baseUrl });
    await client.connect();
    try { await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`); } finally { await client.end().catch(() => {}); }
}

module.exports = { dropDatabase, migrate, migrationFiles, databaseUrl, createDatabase, GLOBAL_FILES };
