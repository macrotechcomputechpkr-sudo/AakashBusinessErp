// =============================================
// middleware/auth.js
// FIX: previously every route file re-implemented
//   jwt.verify(token, process.env.JWT_SECRET)
// inline, with two files (companyRoutes.js, fiscalYearRoutes.js) never
// importing jwt at all (ReferenceError -> 500 on every call). A single
// piece of middleware removes that duplication and crash risk, and gives
// consistent 401/403 responses instead of uncaught exceptions.
// =============================================

const jwt = require('jsonwebtoken');
const { runWithContext } = require('../utils/requestContext');
// loaded lazily: dataAccess -> dbHelpers would otherwise load before the env is ready in some tests
let dataAccess = null;

const JWT_SECRET = process.env.JWT_SECRET || 'global-super-secret-key';

// A super admin inside a company is VIEW ONLY: every write is refused except the
// admin / login calls and the read-only POSTs (previews, lookups, print log).
const READ_ONLY_ALLOW = [/^\/api\/auth\//, /^\/api\/admin\//, /^\/api\/company\/create$/, /preview$/, /\/pending-documents\/pull$/, /\/udf-values\/lookup$/, /\/document-print\/log$/];
const isWrite = m => !['GET', 'HEAD', 'OPTIONS'].includes(String(m || '').toUpperCase());
function readOnlyBlocked(req) {
    if (!req.auth || !req.auth.readOnly || !isWrite(req.method)) return false;
    const path = String(req.originalUrl || req.url || '').split('?')[0];
    return !READ_ONLY_ALLOW.some(rx => rx.test(path));
}

function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.auth = {
            userId: decoded.userId,
            email: decoded.email,
            isSuperAdmin: !!decoded.isSuperAdmin,
            tenantId: decoded.tenantId || null,
            // super admin opened a company from the Admin Panel: view only, no entries
            readOnly: !!decoded.isSuperAdmin && !!decoded.tenantId
        };
        if (readOnlyBlocked(req)) {
            return res.status(403).json({ success: false, read_only: true, error: 'Super Admin can only view a company - no entries or changes. Log in as the company\'s own user to make entries.' });
        }
        // who / from where - read by the database audit trigger (utils/requestContext.js)
        const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
        const ctx = { userId: decoded.userId, tenantId: decoded.tenantId || null, isSuperAdmin: !!decoded.isSuperAdmin, method: req.method,
            ip, route: `${req.method} ${String(req.originalUrl || '').split('?')[0]}` };
        // data access rules (utils/dataAccess.js): refuse hidden ids, filter responses
        if (!dataAccess) dataAccess = require('../utils/dataAccess');
        return runWithContext(ctx, () => dataAccess.guard(req, res, next));
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, error: 'Session expired, please log in again' });
        }
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
}

// Use on routes that only super admins may call.
function requireSuperAdmin(req, res, next) {
    if (!req.auth || !req.auth.isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'Super Admin access required' });
    }
    next();
}

// Use on routes that need a resolved tenant (blocks super-admin-without-tenant calls
// unless a tenantId query/body param is supplied).
function requireTenant(req, res, next) {
    const tenantId = req.auth.tenantId || req.query.tenantId || req.body.tenantId;
    if (!tenantId) {
        return res.status(400).json({ success: false, error: 'tenantId is required' });
    }
    req.auth.resolvedTenantId = tenantId;
    next();
}

// Checks a permission on the caller's security-group JSON, e.g.
//   requirePermission('user_management', 'edit')
// Super admins always pass.
function requirePermission(module, action) {
    return (req, res, next) => {
        if (req.auth.isSuperAdmin) return next();
        const perms = req.userPermissions; // populated by loadUserPermissions middleware
        if (perms && perms[module] && perms[module][action]) {
            return next();
        }
        return res.status(403).json({ success: false, error: `Permission denied: ${module}.${action}` });
    };
}

module.exports = { requireAuth, requireSuperAdmin, requireTenant, requirePermission, JWT_SECRET, readOnlyBlocked, READ_ONLY_ALLOW };
