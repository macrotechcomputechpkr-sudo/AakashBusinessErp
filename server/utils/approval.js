// =============================================
// utils/approval.js
// Approval system (System Control > "Approval Needed For"):
//   * a module in the list: Save stores the document as waiting for approval
//     (status draft, no ledger / stock effect). Only a user whose Security
//     Rights Group has the approval right for that document (permissions.
//     approvals[<type>]) can approve it - approving posts it through the
//     module's own status route, and only then accounts and inventory move.
//   * any other module: Save posts at once - there is no separate Post step.
// Unfinished work is kept apart as a temporary draft (entry_drafts), never
// in the module's own table.
// guard(): mounted before the module routers on PUT /api/<api>/:id/status.
// =============================================
const { getTenantClient } = require('./dbHelpers');

// list endpoint -> document type, and the statuses that post it
const API_TYPES = {
    'sales-quotations': ['sales_quotation', ['sent', 'accepted']], 'sales-orders': ['sales_order', ['confirmed']],
    'sales-deliveries': ['sales_delivery', ['posted']], 'sales-bills': ['sales_bill', ['posted']], 'sales-returns': ['sales_return', ['posted']],
    'sales-nonsaleable-returns': ['sales_nonsalable_return', ['posted']], 'sales-additional-entries': ['sales_additional', ['posted']],
    'purchase-requisitions': ['purchase_requisition', ['approved']], 'purchase-quotations': ['purchase_quotation', ['sent', 'received', 'accepted']],
    'purchase-orders': ['purchase_order', ['confirmed']], 'purchase-grns': ['purchase_grn', ['received']], 'purchase-bills': ['purchase_bill', ['posted']],
    'purchase-returns': ['purchase_return', ['posted']], 'purchase-nonsaleable-returns': ['purchase_nonsalable_return', ['posted']],
    'purchase-additional-expenses': ['purchase_additional', ['posted']], 'cash-bank-entries': ['cash_bank_entry', ['posted']],
    'journal-vouchers': ['journal', ['posted']], 'stock-transfers': ['stock_transfer', ['approved', 'posted']], 'production-orders': ['production', ['posted']]
};
const APPROVAL_TYPES = [...new Set(Object.values(API_TYPES).map(x => x[0]))];

async function approvalModules(c, tenantId) {
    const { data } = await c.from('system_control_settings').select('approval_modules').eq('tenant_id', tenantId).maybeSingle();
    return Array.isArray(data && data.approval_modules) ? data.approval_modules : [];
}

/** may this user approve documents of this type? (super admin, or the approval right on the security group) */
async function canApprove(c, auth, type) {
    if (auth.isSuperAdmin) return true;
    const { data: user } = await c.from('users').select('security_group_id, security_rights_groups(permissions)').eq('id', auth.userId).maybeSingle();
    const perms = (user && user.security_rights_groups && user.security_rights_groups.permissions) || {};
    return !!(perms.approvals && perms.approvals[type]);
}

/** PUT /api/<api>/:id/status - posting a module that needs approval takes the approval right */
async function guard(req, res, next) {
    try {
        const entry = API_TYPES[req.params.api];
        if (!entry || !req.auth) return next();
        const [type, live] = entry;
        if (!live.includes(req.body && req.body.status)) return next();
        const c = await getTenantClient(req.auth.tenantId);
        if (!(await approvalModules(c, req.auth.tenantId)).includes(type)) return next();
        if (await canApprove(c, req.auth, type)) return next();
        return res.status(403).json({ success: false, error: 'This document needs approval - you do not have the approval right for it (Security Rights Group > Approvals)' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

module.exports = { API_TYPES, APPROVAL_TYPES, approvalModules, canApprove, guard };
