// =============================================
// utils/docAgent.js - "Doc. Agent" for GL based reports
// Reports offer two agent filters:
//   Agent       the party's master agent (ledger_accounts.agent_id)
//   Doc. Agent  the agent chosen on the transaction (header agent_id)
// agentOfDocs() returns the transaction agent of GL documents
// ({ document_type, document_id } of ledger_transaction_batches), so a
// report can keep only the lines of that agent's documents.
// =============================================
const HEADER = {
    sales_bill: 'sales_bills', sales_return: 'sales_returns', sales_nonsalable_return: 'sales_nonsaleable_returns', sales_additional: 'sales_additional_entries',
    purchase_grn: 'purchase_grns', purchase_bill: 'purchase_bills', purchase_return: 'purchase_returns', purchase_nonsalable_return: 'purchase_nonsaleable_returns',
    purchase_additional_expense: 'purchase_additional_expenses', cash_bank_entry: 'cash_bank_entries', pdc: 'pdc_vouchers', journal_voucher: 'journal_vouchers',
    credit_note: 'credit_notes', debit_note: 'debit_notes'
};

/** docs: [{ document_type, document_id }] -> { 'type:id': agent_id | null } */
async function agentOfDocs(c, docs) {
    const byType = {};
    docs.forEach(d => { if (HEADER[d.document_type] && d.document_id) (byType[d.document_type] = byType[d.document_type] || new Set()).add(d.document_id); });
    const out = {};
    for (const [type, set] of Object.entries(byType)) {
        const ids = [...set];
        for (let i = 0; i < ids.length; i += 150) {
            const { data } = await c.from(HEADER[type]).select('*').in('id', ids.slice(i, i + 150));
            (data || []).forEach(h => { out[`${type}:${h.id}`] = h.agent_id || h.salesman_agent_id || null; });
        }
    }
    return out;
}

module.exports = { agentOfDocs, HEADER };
