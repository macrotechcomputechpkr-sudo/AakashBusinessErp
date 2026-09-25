// =============================================
// utils/pdcReport.js
// PDC register / dashboard - post-dated cheques received and issued.
//
// Status as shown:
//   pending          - not yet posted (cheque with us / issued, not cleared)
//   partly_adjusted  - posted, but with bill-to-bill on part of its amount is
//                      still not adjusted against bills (its bill-wise
//                      reference still has a balance) - "partially posted"
//   posted           - posted and fully adjusted (or no bill-wise tracking)
//   returned         - bounced / returned
//   cancelled
// Maturity (pending cheques) as on a date: matured (cheque date on or before
// it - ready to post), due today, due within N days, not matured.
// Filters: received / issued, status, maturity, cheque or entry date range,
// party, bank ledger, bank name, cheque no, amount range, product company.
// Summary cards and optional grouping by party / bank / cheque month / status.
// =============================================
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const csv = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
const days = (from, to) => Math.floor((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000);
async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}
async function inChunks(ids, fn, size = 150) {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
    return out;
}

const STATUS_LABEL = { pending: 'Pending', partly_adjusted: 'Posted - partly adjusted', posted: 'Posted', returned: 'Returned / Bounced', cancelled: 'Cancelled' };

async function pdcReport(c, t, q) {
    const asOn = q.as_on || new Date().toISOString().slice(0, 10);
    const dueWithin = Math.max(0, parseInt(q.due_within, 10) || 7);
    const statuses = csv(q.statuses).filter(s => STATUS_LABEL[s]);
    const maturity = csv(q.maturity);                   // matured, due_today, due_within, not_matured
    const dateBasis = q.date_basis === 'doc_date' ? 'doc_date' : 'cheque_date';
    const f = { type: ['received', 'issued'].includes(q.voucher_type) ? q.voucher_type : null, partyIds: csv(q.party_ids), bankIds: csv(q.bank_ledger_ids),
        companyIds: csv(q.product_company_ids), bankName: (q.bank_name || '').trim().toLowerCase(), chequeNo: (q.cheque_no || '').trim().toLowerCase(),
        min: q.amount_min !== undefined && q.amount_min !== '' ? Number(q.amount_min) : null, max: q.amount_max !== undefined && q.amount_max !== '' ? Number(q.amount_max) : null };

    const rows = await fetchAll(() => {
        let x = c.from('pdc_vouchers').select('*').eq('tenant_id', t).order('cheque_date');
        if (f.type) x = x.eq('voucher_type', f.type);
        if (q.date_from) x = x.gte(dateBasis, q.date_from);
        if (q.date_to) x = x.lte(dateBasis, q.date_to);
        if (f.partyIds.length) x = x.in('party_ledger_id', f.partyIds);
        return x;
    });
    const refs = await inChunks(rows.filter(r => r.status === 'posted').map(r => r.id), async ids => {
        const { data, error } = await c.from('bill_wise_references').select('source_id, total_amount, allocated_amount, remaining_amount').eq('source_type', 'pdc').in('source_id', ids);
        if (error) throw error; return data || [];
    });
    const refOf = Object.fromEntries(refs.map(r => [r.source_id, r]));

    let list = rows.map(r => {
        const ref = refOf[r.id];
        const remaining = ref ? round2(ref.remaining_amount) : 0;
        const view = r.status === 'posted' ? (ref && remaining > 0.005 ? 'partly_adjusted' : 'posted') : r.status;
        const cd = String(r.cheque_date).slice(0, 10);
        const toMature = days(asOn, cd);
        const mat = r.status !== 'pending' ? null : toMature < 0 ? 'matured' : toMature === 0 ? 'due_today' : toMature <= dueWithin ? 'due_within' : 'not_matured';
        return {
            id: r.id, doc_no: r.doc_no, doc_date: String(r.doc_date).slice(0, 10), voucher_type: r.voucher_type, party_ledger_id: r.party_ledger_id,
            party_name: r.party_name_snapshot || '', sub_ledger_name: r.party_sub_ledger_name_snapshot || '', bank_ledger_id: r.bank_ledger_id, bank_ledger_name: r.bank_ledger_name_snapshot || '',
            cheque_no: r.cheque_no, cheque_date: cd, bank_name: r.bank_name || '', bank_branch: r.bank_branch || '', amount: round2(r.amount),
            is_online_pdc: !!r.is_online_pdc, ref_doc_no: r.ref_doc_no || '', narration: r.narration || r.remarks_text || '', branch_name: r.branch_name_snapshot || '',
            status: r.status, view_status: view, status_label: STATUS_LABEL[view], maturity: mat, days_to_maturity: r.status === 'pending' ? toMature : null,
            posting_date: r.posting_date ? String(r.posting_date).slice(0, 10) : null, posting_no: r.posting_no || null,
            adjusted: ref ? round2(ref.allocated_amount) : null, unadjusted: ref ? remaining : null,
            return_reason: r.return_reason || null, cancellation_reason: r.cancellation_reason || null, product_company_id: r.product_company_id || null
        };
    });
    // Summary is over the type / date / party scope, before the status and maturity filters.
    const summarize = (xs, pred) => { const s = xs.filter(pred); return { count: s.length, amount: round2(s.reduce((a, r) => a + r.amount, 0)) }; };
    const summary = {};
    ['received', 'issued'].forEach(type => {
        const xs = list.filter(r => r.voucher_type === type);
        summary[type] = {
            pending: summarize(xs, r => r.status === 'pending'), matured: summarize(xs, r => r.maturity === 'matured' || r.maturity === 'due_today'),
            due_within: summarize(xs, r => r.maturity === 'due_within'), not_matured: summarize(xs, r => r.maturity === 'not_matured'),
            posted: summarize(xs, r => r.view_status === 'posted'), partly_adjusted: summarize(xs, r => r.view_status === 'partly_adjusted'),
            returned: summarize(xs, r => r.status === 'returned'), cancelled: summarize(xs, r => r.status === 'cancelled')
        };
    });

    list = list.filter(r => (!statuses.length || statuses.includes(r.view_status))
        && (!maturity.length || maturity.includes(r.maturity))
        && (!f.bankIds.length || f.bankIds.includes(r.bank_ledger_id))
        && (!f.companyIds.length || f.companyIds.includes(r.product_company_id))
        && (!f.bankName || r.bank_name.toLowerCase().includes(f.bankName))
        && (!f.chequeNo || String(r.cheque_no).toLowerCase().includes(f.chequeNo))
        && (f.min === null || r.amount >= f.min) && (f.max === null || r.amount <= f.max));

    const groupBy = ['party', 'bank', 'cheque_month', 'status'].includes(q.group_by) ? q.group_by : null;
    const keyOf = r => (groupBy === 'party' ? r.party_name : groupBy === 'bank' ? r.bank_name || r.bank_ledger_name || '(no bank)' : groupBy === 'cheque_month' ? r.cheque_date.slice(0, 7) : STATUS_LABEL[r.view_status]);
    const groups = groupBy ? Object.values(list.reduce((g, r) => {
        const k = keyOf(r);
        (g[k] = g[k] || { key: k, rows: [], received: 0, issued: 0 }).rows.push(r);
        g[k][r.voucher_type] = round2(g[k][r.voucher_type] + r.amount);
        return g;
    }, {})).sort((a, b) => String(a.key).localeCompare(String(b.key))) : null;

    return { as_on: asOn, due_within: dueWithin, date_basis: dateBasis, rows: list, groups, group_by: groupBy, summary, status_labels: STATUS_LABEL,
        totals: { count: list.length, received: round2(list.filter(r => r.voucher_type === 'received').reduce((a, r) => a + r.amount, 0)),
            issued: round2(list.filter(r => r.voucher_type === 'issued').reduce((a, r) => a + r.amount, 0)) } };
}

module.exports = { pdcReport, PDC_STATUS_LABEL: STATUS_LABEL };
