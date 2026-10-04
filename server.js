// =============================================
// server.js (repo root) - start file for cloud hosts
// Yeti Cloud / Jelastic Node.js runs APP_FILE=server.js from the repo root
// (/home/jelastic/ROOT). The ERP server lives in server/server.js; this file
// only starts it, so both APP_FILE=server.js and `npm start` work.
// See docs/DEPLOY_YETI_CLOUD.md.
// =============================================
const path = require('path');
const fs = require('fs');

if (!fs.existsSync(path.join(__dirname, 'server', 'node_modules'))) {
    console.error('[start] server/node_modules is missing - run `npm install` in the repo root (it installs server + client and builds the app).');
}
if (!process.env.DATABASE_URL && (!process.env.GLOBAL_MASTER_URL || !process.env.GLOBAL_MASTER_KEY)) {
    console.error('[start] set DATABASE_URL (own PostgreSQL) - or GLOBAL_MASTER_URL / GLOBAL_MASTER_KEY (Supabase) - under the Node.js node > Variables.');
}
require('./server/server.js');
