// =============================================
// utils/requestContext.js
// Remembers WHO is making the current API request (user, IP, route) for
// everything that runs while serving it, using AsyncLocalStorage.
// The tenant database client adds these as x-erp-user / x-erp-ip /
// x-erp-route headers to every call, and the audit trigger (database/121)
// reads them, so each audit row names the user without any route having
// to pass it along.
// =============================================
const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();

/** Run the rest of the request inside a context: runWithContext(ctx, next). */
const runWithContext = (ctx, fn) => store.run(ctx, fn);
const currentContext = () => store.getStore() || null;

// HTTP headers must be plain ASCII.
const ascii = v => String(v ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 200);

/** fetch() for the Supabase client that adds the audit headers. */
function auditFetch(input, init = {}) {
    const ctx = currentContext();
    if (!ctx || !ctx.userId) return fetch(input, init);
    const headers = new Headers(init.headers || (input && input.headers) || undefined);
    headers.set('x-erp-user', ascii(ctx.userId));
    if (ctx.ip) headers.set('x-erp-ip', ascii(ctx.ip));
    if (ctx.route) headers.set('x-erp-route', ascii(ctx.route));
    return fetch(input, { ...init, headers });
}

module.exports = { runWithContext, currentContext, auditFetch };
