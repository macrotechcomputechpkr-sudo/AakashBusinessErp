// =============================================
// utils/creditControl.js
// Resolves the effective Credit Limit Control for a customer (ledger's
// own override, falling back to System Control's customer-specific
// default when the ledger says 'system_default'), and checks whether a
// new Sales Order would push the customer's outstanding past that
// limit.
// =============================================

async function getEffectiveCreditLimitControl(tenantClient, tenantId, customerLedgerId) {
    const { data: ledger } = await tenantClient.from('ledger_accounts').select('credit_limit_control, credit_limit').eq('id', customerLedgerId).maybeSingle();
    const control = ledger?.credit_limit_control || 'system_default';
    if (control !== 'system_default') return { control, creditLimit: Number(ledger?.credit_limit) || 0 };
    const { data: sysControl } = await tenantClient.from('system_control_settings').select('customer_credit_limit_control').eq('tenant_id', tenantId).maybeSingle();
    return { control: sysControl?.customer_credit_limit_control || 'warn', creditLimit: Number(ledger?.credit_limit) || 0 };
}

async function getCurrentOutstanding(tenantClient, customerLedgerId) {
    const { data } = await tenantClient.from('bill_wise_references').select('remaining_amount').eq('ledger_id', customerLedgerId).eq('nature', 'dr').gt('remaining_amount', 0);
    return (data || []).reduce((s, r) => s + Number(r.remaining_amount), 0);
}

async function checkCustomerCredit(tenantClient, tenantId, customerLedgerId, newAmount) {
    const { control, creditLimit } = await getEffectiveCreditLimitControl(tenantClient, tenantId, customerLedgerId);
    if (!creditLimit || creditLimit <= 0) return { result: 'passed', message: null };
    const currentOutstanding = await getCurrentOutstanding(tenantClient, customerLedgerId);
    const projected = currentOutstanding + Number(newAmount);
    if (projected <= creditLimit) return { result: 'passed', message: null };
    const message = `This order would take outstanding to ${projected.toFixed(2)}, exceeding the credit limit of ${creditLimit.toFixed(2)}`;
    if (control === 'block') return { result: 'blocked', message };
    if (control === 'warn') return { result: 'warned', message };
    return { result: 'passed', message: null };
}

module.exports = { getEffectiveCreditLimitControl, getCurrentOutstanding, checkCustomerCredit };
