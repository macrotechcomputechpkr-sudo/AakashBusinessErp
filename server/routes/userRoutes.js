// =============================================
// routes/userRoutes.js
// FIX: the old Python/Flask version (a) lived in a stack that can't run
// alongside this Express server, (b) generated employee_code by reading
// the "last" row + 1 in app code (race condition under concurrent
// creates), and (c) /list always returned every row with no search, sort
// or pagination - which is the "listing not working properly" complaint.
// This version fixes all three.
// =============================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getTenantClient, logAudit, loadUserPermissions, applyListQuery } = require('../utils/dbHelpers');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { provisionLogin, setLoginStatus } = require('../utils/loginProvision');

const SALT_ROUNDS = 10;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function generateTempPassword() {
    return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '') + '!A1';
}

// GET /api/users?search=&page=&pageSize=&sortBy=&sortDir=&department_id=&is_active=
router.get('/users', requireAuth, loadUserPermissions, requirePermission('user_management', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);

        let base = tenantClient
            .from('users')
            .select(
                'id, email, username, full_name, phone, employee_code, is_active, is_company_admin, ' +
                'department_id, department_name, designation_id, designation_name, ' +
                'security_group_id, security_group_name, employment_type, joining_date, ' +
                'allow_sales_rate_change, rate_increase_percentage, rate_decrease_percentage, ' +
                'last_login, created_at',
                { count: 'exact' }
            )
            .eq('tenant_id', req.auth.tenantId);

        if (req.query.department_id) base = base.eq('department_id', req.query.department_id);
        if (req.query.designation_id) base = base.eq('designation_id', req.query.designation_id);
        if (req.query.security_group_id) base = base.eq('security_group_id', req.query.security_group_id);
        if (req.query.is_active !== undefined) base = base.eq('is_active', req.query.is_active === 'true');

        const { q, page, pageSize } = applyListQuery(base, req, {
            searchColumns: ['full_name', 'email', 'employee_code', 'username'],
            defaultSort: 'full_name',
            allowedSort: ['full_name', 'email', 'employee_code', 'created_at', 'last_login', 'department_name', 'designation_name']
        });

        const { data, error, count } = await q;
        if (error) throw error;

        res.json({
            success: true,
            data,
            pagination: { page, pageSize, total: count, totalPages: Math.ceil((count || 0) / pageSize) }
        });
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/users/:id', requireAuth, loadUserPermissions, requirePermission('user_management', 'view'), async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data, error } = await tenantClient
            .from('users')
            .select('*')
            .eq('id', req.params.id)
            .eq('tenant_id', req.auth.tenantId)
            .single();
        if (error || !data) return res.status(404).json({ success: false, error: 'User not found' });
        delete data.password_hash;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/users', requireAuth, loadUserPermissions, requirePermission('user_management', 'create'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const createdBy = req.auth.userId;
        const data = req.body;

        if (!data.email) return res.status(400).json({ success: false, error: 'Email is required' });
        if (!data.full_name) return res.status(400).json({ success: false, error: 'Full name is required' });
        if (!data.security_group_id) return res.status(400).json({ success: false, error: 'Security group is required' });

        const email = data.email.trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'Invalid email format' });

        const tenantClient = await getTenantClient(tenantId);

        const { data: dupEmail } = await tenantClient.from('users').select('id').eq('tenant_id', tenantId).eq('email', email).maybeSingle();
        if (dupEmail) return res.status(409).json({ success: false, error: 'Email already exists' });

        let username = (data.username || '').trim() || email.split('@')[0];
        const { data: dupUsername } = await tenantClient.from('users').select('id').eq('tenant_id', tenantId).eq('username', username).maybeSingle();
        if (dupUsername) username = `${username}${Date.now().toString().slice(-4)}`;

        // FIX: atomic sequence-backed code generation - no race condition.
        const { data: employeeCode, error: codeErr } = await tenantClient.rpc('next_employee_code');
        if (codeErr) throw codeErr;

        const rawPassword = (data.password || '').trim() || generateTempPassword();
        const password_hash = await bcrypt.hash(rawPassword, SALT_ROUNDS);

        let department_name = null, department_code = null;
        if (data.department_id) {
            const { data: d } = await tenantClient.from('departments').select('department_code, department_name').eq('id', data.department_id).single();
            if (d) { department_code = d.department_code; department_name = d.department_name; }
        }
        let designation_name = null, designation_code = null;
        if (data.designation_id) {
            const { data: d } = await tenantClient.from('designations').select('designation_code, designation_name').eq('id', data.designation_id).single();
            if (d) { designation_code = d.designation_code; designation_name = d.designation_name; }
        }
        let security_group_name = null, security_group_code = null;
        {
            const { data: sg } = await tenantClient.from('security_rights_groups').select('group_code, group_name').eq('id', data.security_group_id).single();
            if (sg) { security_group_code = sg.group_code; security_group_name = sg.group_name; }
        }

        const insertPayload = {
            tenant_id: tenantId,
            company_id: data.company_id || null,
            email, username, password_hash,
            full_name: data.full_name.trim(),
            phone: data.phone || null,
            address: data.address || null,
            department_id: data.department_id || null, department_code, department_name,
            designation_id: data.designation_id || null, designation_code, designation_name,
            default_branch_id: data.default_branch_id || null,
            employee_code: employeeCode,
            citizenship_number: data.citizenship_number || null,
            pan_number: data.pan_number || null,
            date_of_birth: data.date_of_birth || null,
            gender: data.gender || null,
            security_group_id: data.security_group_id, security_group_code, security_group_name,
            is_company_admin: !!data.is_company_admin,
            is_active: data.is_active !== undefined ? !!data.is_active : true,
            email_2fa_enabled: !!data.email_2fa_enabled,
            sms_2fa_enabled: !!data.sms_2fa_enabled,
            authenticator_2fa_enabled: !!data.authenticator_2fa_enabled,
            preferred_2fa_method: data.preferred_2fa_method || 'email',
            allow_sales_rate_change: !!data.allow_sales_rate_change,
            rate_increase_percentage: data.allow_sales_rate_change ? (Number(data.rate_increase_percentage) || 0) : 0,
            rate_decrease_percentage: data.allow_sales_rate_change ? (Number(data.rate_decrease_percentage) || 0) : 0,
            allow_sell_below_cost: data.allow_sales_rate_change ? !!data.allow_sell_below_cost : false,
            backdated_entry_days: Number(data.backdated_entry_days) || 0,
            post_date_entry_days: Number(data.post_date_entry_days) || 0,
            joining_date: data.joining_date || null,
            confirmation_date: data.confirmation_date || null,
            employment_type: data.employment_type || null,
            salary: data.salary || null,
            bank_name: data.bank_name || null,
            bank_account_number: data.bank_account_number || null,
            emergency_contact: data.emergency_contact || null,
            emergency_contact_name: data.emergency_contact_name || null,
            password_expiry_days: Number(data.password_expiry_days) || 90,
            force_password_change: data.force_password_change !== undefined ? !!data.force_password_change : true,
            created_by: createdBy,
            updated_by: createdBy
        };

        const { data: user, error } = await tenantClient.from('users').insert(insertPayload).select().single();
        if (error) {
            if (error.code === '23505') { // unique_violation, e.g. duplicate employee_code under a very rare race
                return res.status(409).json({ success: false, error: 'Duplicate value detected, please retry' });
            }
            throw error;
        }
        // the login itself lives in global_users (same id) - without it the new user could never sign in
        try { await provisionLogin(tenantId, user, password_hash, { active: user.is_active !== false }); }
        catch (loginErr) {
            await tenantClient.from('users').delete().eq('id', user.id);
            return res.status(loginErr.status || 500).json({ success: false, error: `Login could not be created: ${loginErr.message}` });
        }
        delete user.password_hash;

        await logAudit(tenantId, createdBy, 'create_user', 'user', user.id, { new_data: user });

        res.json({
            success: true,
            message: 'User created successfully',
            data: user,
            generated_password: data.password ? undefined : rawPassword
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/users/:id', requireAuth, loadUserPermissions, requirePermission('user_management', 'edit'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);
        const data = req.body;

        const { data: existing } = await tenantClient.from('users').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'User not found' });

        const update = { updated_by: req.auth.userId, updated_at: new Date().toISOString() };
        const passthroughFields = [
            'full_name', 'phone', 'address', 'citizenship_number', 'pan_number', 'date_of_birth', 'gender',
            'is_company_admin', 'is_active', 'email_2fa_enabled', 'sms_2fa_enabled', 'authenticator_2fa_enabled',
            'preferred_2fa_method', 'allow_sales_rate_change', 'allow_sell_below_cost',
            'backdated_entry_days', 'post_date_entry_days', 'joining_date', 'confirmation_date',
            'employment_type', 'salary', 'bank_name', 'bank_account_number', 'emergency_contact',
            'emergency_contact_name', 'password_expiry_days', 'force_password_change', 'default_branch_id'
        ];
        passthroughFields.forEach(f => { if (data[f] !== undefined) update[f] = data[f]; });

        if (update.allow_sales_rate_change) {
            update.rate_increase_percentage = Number(data.rate_increase_percentage) || 0;
            update.rate_decrease_percentage = Number(data.rate_decrease_percentage) || 0;
        } else if (update.allow_sales_rate_change === false) {
            update.rate_increase_percentage = 0;
            update.rate_decrease_percentage = 0;
            update.allow_sell_below_cost = false;
        }

        if (data.department_id !== undefined) {
            update.department_id = data.department_id || null;
            if (data.department_id) {
                const { data: d } = await tenantClient.from('departments').select('department_code, department_name').eq('id', data.department_id).single();
                if (d) { update.department_code = d.department_code; update.department_name = d.department_name; }
            } else {
                update.department_code = null; update.department_name = null;
            }
        }
        if (data.designation_id !== undefined) {
            update.designation_id = data.designation_id || null;
            if (data.designation_id) {
                const { data: d } = await tenantClient.from('designations').select('designation_code, designation_name').eq('id', data.designation_id).single();
                if (d) { update.designation_code = d.designation_code; update.designation_name = d.designation_name; }
            } else {
                update.designation_code = null; update.designation_name = null;
            }
        }
        if (data.security_group_id) {
            update.security_group_id = data.security_group_id;
            const { data: sg } = await tenantClient.from('security_rights_groups').select('group_code, group_name').eq('id', data.security_group_id).single();
            if (sg) { update.security_group_code = sg.group_code; update.security_group_name = sg.group_name; }
        }
        if (data.password) {
            update.password_hash = await bcrypt.hash(data.password, SALT_ROUNDS);
            update.last_password_change = new Date().toISOString();
        }

        const { data: updated, error } = await tenantClient
            .from('users').update(update).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        try { await provisionLogin(tenantId, updated, update.password_hash || null, { active: updated.is_active !== false, fallbackHash: updated.password_hash }); }
        catch (loginErr) { console.error('login sync failed:', loginErr.message); }
        delete updated.password_hash;

        await logAudit(tenantId, req.auth.userId, 'update_user', 'user', req.params.id, { old_data: existing, new_data: update });

        res.json({ success: true, message: 'User updated successfully', data: updated });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// FIX: this is a soft-delete (is_active=false), matching the DB design where
// user rows are referenced by audit logs / transactions and must not be
// hard-deleted.
router.delete('/users/:id', requireAuth, loadUserPermissions, requirePermission('user_management', 'delete'), async (req, res) => {
    try {
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        if (req.params.id === req.auth.userId) {
            return res.status(400).json({ success: false, error: 'You cannot deactivate your own account' });
        }

        const { data: existing } = await tenantClient.from('users').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
        if (!existing) return res.status(404).json({ success: false, error: 'User not found' });

        const { error } = await tenantClient
            .from('users')
            .update({ is_active: false, updated_by: req.auth.userId, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('tenant_id', tenantId);
        if (error) throw error;
        try { await setLoginStatus(req.params.id, false); } catch (loginErr) { console.error('login deactivate failed:', loginErr.message); }

        await logAudit(tenantId, req.auth.userId, 'delete_user', 'user', req.params.id, { old_data: existing });
        res.json({ success: true, message: 'User deactivated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
