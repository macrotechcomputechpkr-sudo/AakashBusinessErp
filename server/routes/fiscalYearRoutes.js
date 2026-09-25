// =============================================
// routes/fiscalYearRoutes.js (FIXED)
// CRITICAL FIX: same missing `jwt` import bug as companyRoutes.js - fixed
// by using requireAuth middleware everywhere instead of manual jwt.verify.
// ALSO FIXED: overlapping fiscal years are now rejected with a clear 400
// message (translating the DB exclusion-constraint error) instead of
// silently succeeding or throwing a raw Postgres error.
// =============================================

const express = require('express');
const router = express.Router();
const { getTenantClient, logAudit } = require('../utils/dbHelpers');
const { nepaliDateConverter } = require('../utils/nepaliDateUtils');
const { requireAuth } = require('../middleware/auth');

router.get('/fiscal-years', requireAuth, async (req, res) => {
    try {
        const tenantClient = await getTenantClient(req.auth.tenantId);
        const { data: fiscalYears, error } = await tenantClient
            .from('fiscal_years')
            .select('*')
            .eq('tenant_id', req.auth.tenantId)
            .order('start_date_eng', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: fiscalYears });
    } catch (error) {
        console.error('Error fetching fiscal years:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/fiscal-years/create', requireAuth, async (req, res) => {
    const {
        fiscal_year_code, fiscal_year_nepali, start_date_eng, end_date_eng,
        has_opening_balance = false, opening_balance_date = null, opening_balances = []
    } = req.body;

    try {
        const tenantId = req.auth.tenantId;
        const userId = req.auth.userId;
        const tenantClient = await getTenantClient(tenantId);

        if (!start_date_eng || !end_date_eng) {
            return res.status(400).json({ success: false, error: 'start_date_eng and end_date_eng are required' });
        }
        if (new Date(start_date_eng) >= new Date(end_date_eng)) {
            return res.status(400).json({ success: false, error: 'Start date must be before end date' });
        }

        const startNepali = nepaliDateConverter.toNepali(start_date_eng);
        const endNepali = nepaliDateConverter.toNepali(end_date_eng);
        if (!startNepali || !endNepali) {
            return res.status(400).json({ success: false, error: 'Invalid date conversion' });
        }

        const { data: existingFY } = await tenantClient
            .from('fiscal_years')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('fiscal_year_code', fiscal_year_code)
            .maybeSingle();
        if (existingFY) {
            return res.status(400).json({ success: false, error: 'Fiscal year code already exists' });
        }

        const { count } = await tenantClient
            .from('fiscal_years')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);
        const isFirst = count === 0;

        const fyData = {
            tenant_id: tenantId,
            fiscal_year_code,
            fiscal_year_name: `Fiscal Year ${fiscal_year_code}`,
            fiscal_year_nepali: fiscal_year_nepali || String(startNepali.year),
            start_date_eng, end_date_eng,
            start_date_nep: startNepali.date,
            end_date_nep: endNepali.date,
            is_current: isFirst,
            is_closed: false,
            is_locked: false,
            status: 'active',
            has_opening_balance,
            created_by: userId
        };

        if (has_opening_balance && opening_balance_date) {
            const openingNepali = nepaliDateConverter.toNepali(opening_balance_date);
            fyData.opening_balance_date = opening_balance_date;
            fyData.opening_balance_date_nep = openingNepali ? openingNepali.date : null;
        }

        const { data: fy, error: fyError } = await tenantClient
            .from('fiscal_years')
            .insert(fyData)
            .select()
            .single();

        if (fyError) {
            // FIX: translate the DB exclusion-constraint violation (overlapping
            // fiscal year date range for this tenant) into a friendly message.
            if (fyError.code === '23P01' || /exclusion/i.test(fyError.message || '')) {
                return res.status(400).json({ success: false, error: 'This date range overlaps with an existing fiscal year' });
            }
            return res.status(500).json({ success: false, error: 'Failed to create fiscal year: ' + fyError.message });
        }

        if (has_opening_balance && opening_balances.length > 0) {
            const openingData = opening_balances.map(ob => ({
                tenant_id: tenantId,
                fiscal_year_id: fy.id,
                account_code: ob.account_code,
                account_name: ob.account_name,
                account_type: ob.account_type,
                debit_amount: ob.debit_amount || 0,
                credit_amount: ob.credit_amount || 0,
                balance_type: ob.balance_type || 'debit',
                opening_date: opening_balance_date,
                opening_date_nep: fy.opening_balance_date_nep,
                reference_number: ob.reference_number || null,
                notes: ob.notes || null,
                is_active: true,
                is_posted: true,
                posted_date: new Date().toISOString(),
                posted_by: userId,
                created_by: userId
            }));
            const { error: openingError } = await tenantClient.from('opening_balances').insert(openingData);
            if (openingError) console.error('Opening balance insertion error:', openingError);
        }

        if (isFirst) {
            await tenantClient.from('fiscal_years').update({ is_current: false }).neq('id', fy.id).eq('tenant_id', tenantId);
        }

        await logAudit(tenantId, userId, 'create_fiscal_year', 'fiscal_year', fy.id, { new_data: fy });
        res.json({ success: true, message: 'Fiscal year created successfully', data: fy });

    } catch (error) {
        console.error('Error creating fiscal year:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/fiscal-years/:id/set-current', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.auth.tenantId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: fy, error: fyError } = await tenantClient
            .from('fiscal_years')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();
        if (fyError || !fy) return res.status(404).json({ success: false, error: 'Fiscal year not found' });
        if (fy.is_closed || fy.status === 'closed') {
            return res.status(400).json({ success: false, error: 'Cannot set a closed fiscal year as current' });
        }

        await tenantClient.from('fiscal_years').update({ is_current: false }).eq('tenant_id', tenantId);
        await tenantClient.from('fiscal_years').update({ is_current: true, updated_at: new Date().toISOString() }).eq('id', id);

        await logAudit(tenantId, req.auth.userId, 'set_current_fiscal_year', 'fiscal_year', id, { previous_current_id: fy.id });
        res.json({ success: true, message: 'Fiscal year set as current' });
    } catch (error) {
        console.error('Error setting current fiscal year:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/fiscal-years/:id/close', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.auth.tenantId;
        const userId = req.auth.userId;
        const tenantClient = await getTenantClient(tenantId);

        const { data: fy, error: fyError } = await tenantClient
            .from('fiscal_years')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();
        if (fyError || !fy) return res.status(404).json({ success: false, error: 'Fiscal year not found' });
        if (fy.is_closed) return res.status(400).json({ success: false, error: 'Fiscal year is already closed' });

        const closingDate = new Date();
        const closingNepali = nepaliDateConverter.toNepali(closingDate);

        await tenantClient.from('fiscal_years').update({
            is_closed: true, is_locked: true, is_current: false,
            closing_date: closingDate.toISOString().split('T')[0],
            closing_date_nep: closingNepali ? closingNepali.date : null,
            closed_by: userId, status: 'closed', updated_at: new Date().toISOString()
        }).eq('id', id);

        // FIX: closing a fiscal year is irreversible (is_locked=true, no
        // "reopen" endpoint exists) - definitely audit-logged.
        await logAudit(tenantId, userId, 'close_fiscal_year', 'fiscal_year', id, { old_data: fy });
        res.json({ success: true, message: 'Fiscal year closed successfully' });
    } catch (error) {
        console.error('Error closing fiscal year:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
