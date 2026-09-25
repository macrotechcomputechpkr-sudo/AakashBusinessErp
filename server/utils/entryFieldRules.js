// =============================================
// utils/entryFieldRules.js
// Entry Field Control on the SERVER. The same precedence the entry screens
// use (User rule > User Group rule > Global rule > enabled), shared by the
// /entry-field-controls/resolve endpoint and by the save routes - so a
// 'compulsory' field can no longer be skipped by calling the API directly.
// =============================================

const empty = v => v === undefined || v === null || String(v).trim() === '';

async function resolveFieldModes(tenantClient, tenantId, voucherType, userId, groupOverride) {
    const { data: userRow } = userId
        ? await tenantClient.from('users').select('security_group_id').eq('id', userId).maybeSingle()
        : { data: null };
    const groupId = groupOverride !== undefined ? groupOverride : (userRow?.security_group_id || null);
    const [{ data: catalog }, { data: controls }] = await Promise.all([
        tenantClient.from('voucher_field_catalog').select('*').eq('voucher_type', voucherType).order('section').order('display_order'),
        tenantClient.from('entry_field_controls').select('*').eq('tenant_id', tenantId).eq('voucher_type', voucherType)
    ]);
    return (catalog || []).map(field => {
        const userRule = userId && (controls || []).find(c => c.scope === 'user' && c.user_id === userId && c.field_key === field.field_key);
        const groupRule = groupId && (controls || []).find(c => c.scope === 'user_group' && c.user_group_id === groupId && c.field_key === field.field_key);
        const globalRule = (controls || []).find(c => c.scope === 'global' && c.field_key === field.field_key);
        const effective = userRule || groupRule || globalRule;
        return { ...field, effective_mode: effective ? effective.mode : 'enabled', resolved_from: userRule ? 'user' : groupRule ? 'user_group' : globalRule ? 'global' : 'default' };
    });
}

// Error message listing compulsory fields left empty, or null.
// Only fields the request actually carries are checked (the screens send
// their whole form), so a field that a screen does not have can never
// block it. Detail rules apply to real lines (a product or a ledger).
// Drafts are not checked, matching the entry screens.
async function checkCompulsoryFields(tenantClient, tenantId, userId, voucherType, body, isDraft) {
    if (isDraft || !body) return null;
    const modes = await resolveFieldModes(tenantClient, tenantId, voucherType, userId);
    const missing = [];
    modes.filter(f => f.effective_mode === 'compulsory').forEach(f => {
        if (f.section === 'master') {
            if (Object.prototype.hasOwnProperty.call(body, f.field_key) && empty(body[f.field_key])) missing.push(f.field_label || f.field_key);
        } else {
            const lines = body.details || body.lines || body.expense_lines || body.raw_materials || [];
            lines.forEach((d, i) => {
                const realLine = d && (d.product_id || d.ledger_id || d.income_ledger_id || d.expense_ledger_id);
                if (realLine && Object.prototype.hasOwnProperty.call(d, f.field_key) && empty(d[f.field_key])) missing.push(`${f.field_label || f.field_key} (line ${i + 1})`);
            });
        }
    });
    return missing.length ? `Required: ${missing.join(', ')}` : null;
}

// On UPDATE, header fields that are 'readonly' or 'disabled' for this user
// keep their stored value whatever the request sends - the entry screen
// doesn't let them be changed either (readonly = locked input, disabled =
// hidden). Mutates and returns `update`. Line fields are not touched.
// Not used on CREATE: the server can't know a hidden/locked field's
// default (a user's default warehouse etc.), so create keeps what it gets.
async function lockProtectedFields(tenantClient, tenantId, userId, voucherType, update, existing) {
    if (!update || !existing) return update;
    const modes = await resolveFieldModes(tenantClient, tenantId, voucherType, userId);
    modes.filter(f => f.section === 'master' && (f.effective_mode === 'readonly' || f.effective_mode === 'disabled'))
        .forEach(f => {
            if (Object.prototype.hasOwnProperty.call(update, f.field_key) && Object.prototype.hasOwnProperty.call(existing, f.field_key)) {
                update[f.field_key] = existing[f.field_key];
            }
        });
    return update;
}

module.exports = { resolveFieldModes, checkCompulsoryFields, lockProtectedFields };
