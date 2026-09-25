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
const bcrypt = require('bcrypt');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { globalMasterDb, logAudit } = require('../utils/dbHelpers');
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
        tenant_code, company_name, registration_number, pan_number, vat_number, cin_number,
        company_type, industry_type, business_category, province, district, municipality,
        ward_number, address_line1, address_line2, contact_person, contact_designation,
        contact_email, contact_phone, contact_mobile, tax_office, tax_payer_type,
        fiscal_year_start_month, fiscal_year_start_day, accounting_standard,
        db_host, db_name, db_anon_key, db_service_key
    } = req.body;

    try {
        const { userId, isSuperAdmin } = req.auth;
        let tenantId = req.auth.tenantId;

        if (isSuperAdmin) {
            if (tenant_code) {
                const { data: existingTenant } = await globalMasterDb
                    .from('tenants')
                    .select('id, is_company_created')
                    .eq('tenant_code', tenant_code.toLowerCase().trim())
                    .single();
                if (!existingTenant) return res.status(404).json({ success: false, error: 'Tenant not found' });
                if (existingTenant.is_company_created) {
                    return res.status(400).json({ success: false, error: 'Company already created for this tenant' });
                }
                tenantId = existingTenant.id;
            } else {
                if (!db_host || !db_name || !db_anon_key) {
                    return res.status(400).json({ success: false, error: 'db_host, db_name and db_anon_key are required to provision a new tenant' });
                }
                const newTenantCode = company_name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString().slice(-6);
                const { data: newTenant, error: insertError } = await globalMasterDb
                    .from('tenants')
                    .insert({
                        tenant_code: newTenantCode,
                        company_name,
                        company_type: company_type || 'private',
                        contact_email,
                        master_db_host: db_host,
                        master_db_name: db_name,
                        master_db_anon_key: db_anon_key,
                        master_db_service_key: db_service_key,
                        subscription_status: 'active',
                        is_company_created: false
                    })
                    .select()
                    .single();
                if (insertError) throw insertError;
                tenantId = newTenant.id;

                const tempPassword = 'Admin@' + Math.floor(1000 + Math.random() * 9000);
                const hashedPassword = await bcrypt.hash(tempPassword, SALT_ROUNDS);
                await globalMasterDb.from('global_users').insert({
                    tenant_id: tenantId,
                    email: `admin@${newTenantCode}.com`,
                    password_hash: hashedPassword,
                    full_name: 'Company Administrator',
                    role: 'admin',
                    status: 'active'
                });
                // NOTE: return the temp password once, out-of-band (e.g. logged for
                // an ops user to relay securely) - never log/store it in plaintext long-term.
                console.log(`[company/create] temp admin password for ${newTenantCode}: ${tempPassword}`);
            }
        } else {
            const { data: tenant } = await globalMasterDb
                .from('tenants')
                .select('id, is_company_created')
                .eq('id', tenantId)
                .single();
            if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });
            if (tenant.is_company_created) {
                return res.status(400).json({ success: false, error: 'Company already created' });
            }
        }

        const { data: tenant, error: tenantError } = await globalMasterDb
            .from('tenants')
            .select('master_db_host, master_db_anon_key')
            .eq('id', tenantId)
            .single();
        if (tenantError || !tenant) {
            return res.status(404).json({ success: false, error: 'Tenant database configuration not found' });
        }

        const tenantClient = createClient(tenant.master_db_host, tenant.master_db_anon_key);

        const { data: companyProfile, error: companyError } = await tenantClient
            .from('company_profile')
            .insert({
                tenant_id: tenantId,
                company_name, company_code: tenant_code, registration_number, pan_number,
                vat_number, cin_number, registration_date: new Date().toISOString(),
                company_type: company_type || 'private', industry_type, business_category,
                province, district, municipality, ward_number, address_line1, address_line2,
                contact_person, contact_designation, contact_email, contact_phone, contact_mobile,
                tax_office, tax_payer_type: tax_payer_type || 'entity',
                fiscal_year_start_month: fiscal_year_start_month || 7,
                fiscal_year_start_day: fiscal_year_start_day || 16,
                accounting_standard: accounting_standard || 'NFRS',
                is_profile_complete: true,
                created_by: userId
            })
            .select()
            .single();

        if (companyError) {
            return res.status(500).json({ success: false, error: 'Failed to create company profile: ' + companyError.message });
        }

        const currentYear = new Date().getFullYear();
        const startDate = new Date(currentYear, 6, 16);
        const endDate = new Date(currentYear + 1, 6, 15);

        const { data: fiscalYear } = await tenantClient
            .from('fiscal_years')
            .insert({
                tenant_id: tenantId,
                fiscal_year_code: `FY${currentYear}-${(currentYear + 1).toString().slice(-2)}`,
                fiscal_year_name: `Fiscal Year ${currentYear}-${(currentYear + 1).toString().slice(-2)}`,
                fiscal_year_nepali: `${currentYear + 56}-${(currentYear + 57).toString().slice(-2)}`,
                start_date_eng: startDate.toISOString().split('T')[0],
                end_date_eng: endDate.toISOString().split('T')[0],
                start_date_nep: `${currentYear + 56}-04-01`,
                end_date_nep: `${currentYear + 57}-03-31`,
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

        await logAudit(tenantId, userId, 'create_company', 'company', companyProfile.id, { new_data: companyProfile });
        res.json({ success: true, message: 'Company created successfully', company: companyProfile, fiscal_year: fiscalYear, tenant_id: tenantId });

    } catch (error) {
        console.error('Company creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/company/profile', requireAuth, async (req, res) => {
    try {
        const targetTenantId = req.auth.isSuperAdmin && req.query.tenantId ? req.query.tenantId : req.auth.tenantId;
        if (!targetTenantId) return res.status(400).json({ success: false, error: 'tenantId required' });

        const { data: tenant, error: tenantError } = await globalMasterDb
            .from('tenants')
            .select('master_db_host, master_db_anon_key, is_company_created')
            .eq('id', targetTenantId)
            .single();
        if (tenantError || !tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });

        if (!tenant.is_company_created) {
            return res.json({ success: true, is_company_created: false, message: 'Company profile not created yet' });
        }

        const tenantClient = createClient(tenant.master_db_host, tenant.master_db_anon_key);
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
