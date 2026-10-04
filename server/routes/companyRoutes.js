// =============================================
// routes/companyRoutes.js (FIXED)
// CRITICAL FIX: this file used `jwt.verify(...)` on every route but never
// did `const jwt = require('jsonwebtoken')`. Every single call to these
// endpoints threw "ReferenceError: jwt is not defined" -> HTTP 500.
// Replaced all manual token decoding with the shared requireAuth
// middleware (see middleware/auth.js), which also fixes inconsistent
// error handling (expired/garbled tokens no longer crash the process).
// =============================================

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { ensureDefaultAdmin, setupTenantAccess, ensureMainBranchWarehouse } = require('../utils/tenantSetup');
const { globalMasterDb, logAudit, LOCAL_DB, DATABASE_URL, clientForTenantRow } = require('../utils/dbHelpers');
const { createDatabase, dropDatabase, migrate, databaseUrl } = require('../db/migrate');

// Local mode: a new company gets a unique 9-digit code (its company code at
// sign-in) and its own database erp_<code>, created and migrated right here.
async function generateTenantCode() {
    for (let i = 0; i < 20; i += 1) {
        const code = String(100000000 + Math.floor(Math.random() * 900000000));
        const { data } = await globalMasterDb.from('tenants').select('id').eq('tenant_code', code).maybeSingle();
        if (!data) return code;
    }
    throw new Error('Could not find a free company code - try again');
}

/** <abc> for a company inside a tenant: its initials (or the short code given), unique in the tenant */
async function pickCompanySuffix(rootCode, from) {
    const words = String(from || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    let base = /^[a-z0-9]{2,12}$/.test(String(from || '').toLowerCase()) ? String(from).toLowerCase()
        : (words.map(w => w[0]).join('') || 'co').slice(0, 6);
    if (base.length < 2) base = (words[0] || 'co').slice(0, 4);
    for (let i = 0; i < 50; i += 1) {
        const suffix = i ? `${base}${i + 1}` : base;
        const { data } = await globalMasterDb.from('tenants').select('id').eq('tenant_code', `${rootCode}_${suffix}`).maybeSingle();
        if (!data) return suffix;
    }
    throw new Error('Could not find a free company short code - give one');
}

/**
 * The company's first fiscal year from a BS start year + month (Shrawan = 4
 * by default; no year = the fiscal year running today), with its AD dates.
 */
function fiscalYearFrom(bsYear, bsMonth) {
    const { bsToAd, adToBs } = require('../utils/bsCalendar');
    const pad = n => String(n).padStart(2, '0');
    const month = Math.min(12, Math.max(1, Number(bsMonth) || 4));
    let year = Number(bsYear) || 0;
    if (!year) {
        const t = adToBs(new Date().toISOString().slice(0, 10));
        year = t ? (t.month >= month ? t.year : t.year - 1) : 2082;
    }
    const start = bsToAd(year, month, 1);
    const next = bsToAd(year + 1, month, 1);
    const yy = String(year + 1).slice(-2);
    if (!start || !next) {
        const y = year - 57;   // no BS calendar: Shrawan 1 ~ 16 July
        return { month, code: `FY${year}-${yy}`, name: `Fiscal Year ${year}/${yy}`, nepali: `${year}-${yy}`, start: `${y}-07-16`, end: `${y + 1}-07-15`, startNep: `${year}-${pad(month)}-01`, endNep: null };
    }
    const endD = new Date(`${next}T00:00:00Z`); endD.setUTCDate(endD.getUTCDate() - 1);
    const end = endD.toISOString().slice(0, 10);
    const e = adToBs(end);
    return { month, code: `FY${year}-${yy}`, name: `Fiscal Year ${year}/${yy}`, nepali: `${year}-${yy}`, start, end,
        startNep: `${year}-${pad(month)}-01`, endNep: e ? `${e.year}-${pad(e.month)}-${pad(e.day)}` : null };
}
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

const SALT_ROUNDS = 10;

router.get('/tenants', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { data: tenants, error } = await globalMasterDb
            .from('tenants')
            .select('id, tenant_code, company_name, subscription_status, is_company_created, created_at')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: tenants });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/company/create', requireAuth, async (req, res) => {
    const {
        tenant_code, company_name, registration_number, cin_number,
        company_type, industry_type, business_category, province, district, municipality,
        ward_number, address_line1, address_line2, contact_person, contact_designation,
        contact_email, contact_phone, contact_mobile, tax_office, tax_payer_type,
        fiscal_year_start_day, accounting_standard,
        db_host, db_name, db_anon_key, db_service_key, company_suffix, fy_start_year, fy_start_month
    } = req.body;
    // one PAN / VAT number: VAT registration uses the PAN
    const pan_number = String(req.body.pan_number || req.body.vat_number || '').trim();
    const vat_number = String(req.body.vat_number || req.body.pan_number || '').trim();
    // the fiscal year the company starts with (BS year + month, default Shrawan)
    const fy = fiscalYearFrom(fy_start_year, fy_start_month);
    const fiscal_year_start_month = fy.month;

    // a new local company whose setup fails half-way is removed again (its row and database)
    let createdLocal = null;
    try {
        const { userId, isSuperAdmin } = req.auth;
        let tenantId = req.auth.tenantId;
        let parentForChild = null;   // a tenant that already has its company: the new one goes under it
        const extraAdminIds = [];    // the user who creates a company inside a tenant becomes its admin

        if (isSuperAdmin) {
            if (tenant_code) {
                const { data: existingTenant } = await globalMasterDb
                    .from('tenants')
                    .select('id, tenant_code, parent_tenant_id, is_company_created')
                    .eq('tenant_code', tenant_code.toLowerCase().trim())
                    .single();
                if (!existingTenant) return res.status(404).json({ success: false, error: 'Tenant not found' });
                if (existingTenant.is_company_created) parentForChild = existingTenant;
                else tenantId = existingTenant.id;
            } else {
                if (!company_name) return res.status(400).json({ success: false, error: 'Company name is required' });
                let dbConfig;
                let newTenantCode;
                if (LOCAL_DB) {
                    // own PostgreSQL: create the company's database and its tables now
                    newTenantCode = await generateTenantCode();
                    const dbNameLocal = `erp_${newTenantCode}`;
                    await createDatabase(DATABASE_URL, dbNameLocal);
                    createdLocal = { tenantId: null, dbName: dbNameLocal };
                    await migrate(databaseUrl(DATABASE_URL, dbNameLocal), 'tenant');
                    dbConfig = { master_db_host: 'local', master_db_name: dbNameLocal, master_db_anon_key: 'local', master_db_service_key: null };
                } else {
                    if (!db_host || !db_name || !db_anon_key) {
                        return res.status(400).json({ success: false, error: 'db_host, db_name and db_anon_key are required to provision a new tenant' });
                    }
                    newTenantCode = company_name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString().slice(-6);
                    dbConfig = { master_db_host: db_host, master_db_name: db_name, master_db_anon_key: db_anon_key, master_db_service_key: db_service_key };
                }
                const { data: newTenant, error: insertError } = await globalMasterDb
                    .from('tenants')
                    .insert({
                        tenant_code: newTenantCode,
                        company_name,
                        company_type: company_type || 'private',
                        contact_email,
                        ...dbConfig,
                        subscription_status: 'active',
                        is_company_created: false
                    })
                    .select()
                    .single();
                if (insertError) throw insertError;
                tenantId = newTenant.id;
                if (createdLocal) createdLocal.tenantId = tenantId;
            }
        } else {
            const { data: tenant } = await globalMasterDb
                .from('tenants')
                .select('id, tenant_code, parent_tenant_id, is_company_created')
                .eq('id', tenantId)
                .single();
            if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });
            if (tenant.is_company_created) {
                // only a company administrator opens a further company in the tenant
                const { data: me } = await globalMasterDb.from('global_users').select('role').eq('id', userId).single();
                if (!me || me.role !== 'admin') return res.status(403).json({ success: false, error: 'Only a company administrator can create another company' });
                parentForChild = tenant;
                extraAdminIds.push(userId);
            }
        }

        // a further company inside a tenant: <tenant code>_<abc>, database erp_<tenant code>_<abc>
        if (parentForChild) {
            if (!company_name) return res.status(400).json({ success: false, error: 'Company name is required' });
            if (!LOCAL_DB) return res.status(400).json({ success: false, error: 'This tenant already has its company. More companies in one tenant need the own PostgreSQL mode (DATABASE_URL).' });
            let root = parentForChild;
            if (root.parent_tenant_id) {
                const { data: p } = await globalMasterDb.from('tenants').select('id, tenant_code, parent_tenant_id').eq('id', root.parent_tenant_id).single();
                if (p) root = p;
            }
            const suffix = await pickCompanySuffix(root.tenant_code, company_suffix || company_name);
            const childCode = `${root.tenant_code}_${suffix}`;
            const dbNameLocal = `erp_${childCode}`;
            await createDatabase(DATABASE_URL, dbNameLocal);
            createdLocal = { tenantId: null, dbName: dbNameLocal };
            await migrate(databaseUrl(DATABASE_URL, dbNameLocal), 'tenant');
            const { data: child, error: childErr } = await globalMasterDb.from('tenants').insert({
                tenant_code: childCode, company_name, company_type: company_type || 'private', contact_email,
                master_db_host: 'local', master_db_name: dbNameLocal, master_db_anon_key: 'local', master_db_service_key: null,
                parent_tenant_id: root.id, company_suffix: suffix, subscription_status: 'active', is_company_created: false
            }).select().single();
            if (childErr) throw childErr;
            tenantId = child.id;
            createdLocal.tenantId = tenantId;
            // no separate login: the tenant's admins (and the creator) are the new company's admins
            // and get it in the company switcher / sign in with its code
            const { data: rootAdmins, error: raErr } = await globalMasterDb.from('global_users').select('id').eq('tenant_id', root.id).eq('role', 'admin').eq('status', 'active');
            if (raErr) throw raErr;
            for (const a of rootAdmins || []) if (!extraAdminIds.includes(a.id)) extraAdminIds.push(a.id);
            for (const id of extraAdminIds) {
                const { error: accErr } = await globalMasterDb.from('user_tenant_access').upsert(
                    { user_id: id, tenant_id: tenantId, access_level: 'admin', is_active: true, created_by: userId },
                    { onConflict: 'user_id,tenant_id' });
                if (accErr) throw accErr;
            }
            createdLocal.accessUserIds = extraAdminIds.slice();
        }

        // every (main) company gets the same default admin login (utils/tenantSetup.js)
        const defaultAdmin = parentForChild ? null : await ensureDefaultAdmin(tenantId);

        const { data: tenant, error: tenantError } = await globalMasterDb
            .from('tenants')
            .select('tenant_code, master_db_host, master_db_name, master_db_anon_key')
            .eq('id', tenantId)
            .single();
        if (tenantError || !tenant) {
            return res.status(404).json({ success: false, error: 'Tenant database configuration not found' });
        }

        const tenantClient = clientForTenantRow(tenant);

        const { data: companyProfile, error: companyError } = await tenantClient
            .from('company_profile')
            .insert({
                tenant_id: tenantId,
                company_name, company_code: tenant.tenant_code, registration_number, pan_number,
                vat_number, cin_number, registration_date: new Date().toISOString(),
                company_type: company_type || 'private', industry_type, business_category,
                province, district, municipality, ward_number, address_line1, address_line2,
                // company_profile names them email / phone / mobile
                contact_person, contact_designation, email: contact_email, phone: contact_phone, mobile: contact_mobile,
                tax_office, tax_payer_type: tax_payer_type || 'entity',
                fiscal_year_start_month,
                fiscal_year_start_day: fiscal_year_start_day || 16,
                accounting_standard: accounting_standard || 'NFRS',
                is_profile_complete: true,
                created_by: userId
            })
            .select()
            .single();

        if (companyError) throw new Error('Failed to create company profile: ' + companyError.message);

        const { data: fiscalYear } = await tenantClient
            .from('fiscal_years')
            .insert({
                tenant_id: tenantId,
                fiscal_year_code: fy.code,
                fiscal_year_name: fy.name,
                fiscal_year_nepali: fy.nepali,
                start_date_eng: fy.start,
                end_date_eng: fy.end,
                start_date_nep: fy.startNep,
                end_date_nep: fy.endNep,
                is_current: true,
                created_by: userId
            })
            .select()
            .single();

        await globalMasterDb.from('tenants').update({
            company_name, pan_number, vat_number,
            company_type: company_type || 'private',
            contact_person, contact_email, contact_phone,
            is_company_created: true,
            subscription_status: 'active'
        }).eq('id', tenantId);

        // FIX: tenant_master.seed_default_account_groups() existed in the
        // schema but was never actually called anywhere - a brand new
        // company ended up with zero account groups/ledgers, silently.
        // Mirrors the fiscal-year auto-creation right above it.
        const { error: seedError } = await tenantClient.rpc('seed_default_account_groups', {
            p_tenant_id: tenantId,
            p_company_id: companyProfile.id,
            p_created_by: userId
        });
        if (seedError) {
            // Non-fatal: the company itself was created successfully: log
            // and let the user seed/create account groups manually via
            // Chart of Accounts if this one-time step failed.
            console.error('seed_default_account_groups failed:', seedError);
        }

        // security groups + the admin's users row, or the admin could sign in but have no rights
        let access = null;
        try { access = await setupTenantAccess(tenantClient, tenantId, companyProfile.id, userId, extraAdminIds); }
        catch (e) { console.error('setupTenantAccess failed:', e.message); }

        // one branch + warehouse (MAIN) so stock entries post from day one
        try { await ensureMainBranchWarehouse(tenantClient, tenantId, companyProfile); }
        catch (e) { console.error('ensureMainBranchWarehouse failed:', e.message); }

        await logAudit(tenantId, userId, 'create_company', 'company', companyProfile.id, { new_data: companyProfile });
        res.json({ success: true, message: 'Company created successfully', company: companyProfile, fiscal_year: fiscalYear, tenant_id: tenantId, company_code: tenant.tenant_code, access,
            // shown once to the super admin who created the company; the admin must change it at first sign-in
            admin_login: isSuperAdmin && defaultAdmin ? { company_code: tenant.tenant_code, email: defaultAdmin.email, password: defaultAdmin.created ? defaultAdmin.password : '(unchanged - already set)', must_change_password: true } : undefined });

    } catch (error) {
        console.error('Company creation error:', error);
        if (createdLocal) {
            if (createdLocal.tenantId) {
                await globalMasterDb.from('user_tenant_access').delete().eq('tenant_id', createdLocal.tenantId);
                await globalMasterDb.from('global_users').delete().eq('tenant_id', createdLocal.tenantId);
                await globalMasterDb.from('tenants').delete().eq('id', createdLocal.tenantId);
            }
            await dropDatabase(DATABASE_URL, createdLocal.dbName).catch(e => console.error('drop database failed:', e.message));
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/company/profile', requireAuth, async (req, res) => {
    try {
        const targetTenantId = req.auth.isSuperAdmin && req.query.tenantId ? req.query.tenantId : req.auth.tenantId;
        if (!targetTenantId) return res.status(400).json({ success: false, error: 'tenantId required' });

        const { data: tenant, error: tenantError } = await globalMasterDb
            .from('tenants')
            .select('master_db_host, master_db_name, master_db_anon_key, is_company_created')
            .eq('id', targetTenantId)
            .single();
        if (tenantError || !tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });

        if (!tenant.is_company_created) {
            return res.json({ success: true, is_company_created: false, message: 'Company profile not created yet' });
        }

        const tenantClient = clientForTenantRow(tenant);
        const { data: profile, error: profileError } = await tenantClient
            .from('company_profile')
            .select('*')
            .eq('tenant_id', targetTenantId)
            .single();
        if (profileError) return res.status(404).json({ success: false, error: 'Company profile not found' });

        const { data: fiscalYears } = await tenantClient
            .from('fiscal_years')
            .select('*')
            .eq('tenant_id', targetTenantId)
            .order('start_date_eng', { ascending: false });

        res.json({ success: true, is_company_created: true, profile, fiscal_years: fiscalYears || [] });
    } catch (error) {
        console.error('Get company profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
