// =============================================
// components/entry/BillReceiptTds.jsx
// Money settled on the bill itself (server: utils/billExtras.js)
//   TDS      - sales: TDS the customer withholds (Dr TDS receivable, Cr
//              customer); purchase: TDS we withhold (Dr supplier, Cr TDS
//              payable). Type % (base = the VAT-exclusive bill value, can be
//              changed) or the TDS amount; ledger defaults from System Control.
//   Receipt  - sales only: how the money came in - cash in hand and / or any
//              bank, one line each (Dr that cash / bank, Cr customer).
//              Cash bill: received + TDS = bill total (blank = all to the
//              default cash ledger). Credit bill: part payment allowed, the
//              rest stays outstanding.
// <BillReceiptTds side form setForm ledgers subLedgers billTotal tax sysCtl lp />
// receiptSummary(form, billTotal) -> { received, tds, balance } for the footer.
// =============================================
import React from 'react';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const fmt = n => r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyReceipt = () => ({ ledger_id: '', sub_ledger_id: '', amount: '', ref_no: '' });

export function receiptSummary(form, billTotal) {
    const received = r2((form.receipts || []).reduce((s, r) => s + (r.ledger_id ? Number(r.amount) || 0 : 0), 0));
    const tds = r2(form.tds_amount);
    return { received, tds, balance: r2(Number(billTotal || 0) - received - tds) };
}

export default function BillReceiptTds({ side = 'sales', form, setForm, ledgers = [], subLedgers = [], billTotal = 0, tax = 0, sysCtl = {}, lp }) {
    const sales = side === 'sales';
    const receipts = Array.isArray(form.receipts) ? form.receipts : [];
    const baseDefault = r2(Number(billTotal || 0) - Number(tax || 0));
    const base = Number(form.tds_base_amount) > 0 ? Number(form.tds_base_amount) : baseDefault;
    const defaultTdsLedger = sales ? sysCtl.sales_tds_ledger_id : sysCtl.tds_ledger_id;
    const tdsLedgers = lp ? lp.filter(ledgers, 'tds', form.tds_ledger_id) : ledgers;
    const cashBank = lp ? lp.filter(ledgers, 'cash_bank') : ledgers;
    const { received, tds, balance } = receiptSummary(form, billTotal);
    const cashBill = sales && form.invoice_type === 'cash';

    const setTds = patch => setForm(f => {
        const next = { ...f, ...patch };
        const b = Number(next.tds_base_amount) > 0 ? Number(next.tds_base_amount) : baseDefault;
        if ('tds_percent' in patch || 'tds_base_amount' in patch) next.tds_amount = Number(next.tds_percent) > 0 ? r2(b * Number(next.tds_percent) / 100) : next.tds_amount;
        if ('tds_amount' in patch) next.tds_percent = b > 0 && Number(patch.tds_amount) > 0 ? r2(Number(patch.tds_amount) * 100 / b) : 0;
        if ((Number(next.tds_amount) > 0 || Number(next.tds_percent) > 0) && !next.tds_ledger_id && defaultTdsLedger) next.tds_ledger_id = defaultTdsLedger;
        return next;
    });
    const setReceipt = (i, patch) => setForm(f => ({ ...f, receipts: (f.receipts || []).map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
    const addReceipt = (ledgerId = '') => setForm(f => {
        const list = f.receipts || [];
        const left = r2(Number(billTotal || 0) - Number(f.tds_amount || 0) - list.reduce((s, r) => s + (Number(r.amount) || 0), 0));
        return { ...f, receipts: [...list, { ...emptyReceipt(), ledger_id: ledgerId, amount: left > 0 ? left : '' }] };
    });
    const removeReceipt = i => setForm(f => ({ ...f, receipts: (f.receipts || []).filter((_, k) => k !== i) }));

    return (
        <div className="space-y-4">
            <fieldset className="border rounded-lg p-3">
                <legend className="px-1 text-xs font-semibold text-gray-600 uppercase">TDS {sales ? '(deducted by the customer)' : '(withheld from the supplier)'}</legend>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                    <div className="erp-field">
                        <label className="erp-label">TDS %</label>
                        <input type="number" step="0.001" min="0" className="erp-input" value={form.tds_percent || ''} onChange={e => setTds({ tds_percent: e.target.value })} placeholder="0" />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">Base <span className="hint">(excl. VAT)</span></label>
                        <input type="number" step="0.01" min="0" className="erp-input" value={form.tds_base_amount || ''} onChange={e => setTds({ tds_base_amount: e.target.value })} placeholder={fmt(baseDefault)} />
                    </div>
                    <div className="erp-field">
                        <label className="erp-label">TDS Amount</label>
                        <input type="number" step="0.01" min="0" className="erp-input" value={form.tds_amount || ''} onChange={e => setTds({ tds_amount: e.target.value })} placeholder="0.00" />
                    </div>
                    <div className="erp-field md:col-span-2">
                        <label className="erp-label">TDS Ledger <span className="hint">({sales ? 'receivable' : 'payable'}; blank = System Control)</span></label>
                        <select className="erp-select" value={form.tds_ledger_id || ''} onChange={e => setForm(f => ({ ...f, tds_ledger_id: e.target.value, tds_sub_ledger_id: '' }))}>
                            <option value="">{defaultTdsLedger ? `System Control: ${ledgers.find(l => l.id === defaultTdsLedger)?.account_name || 'default'}` : 'Choose'}</option>
                            {tdsLedgers.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}
                        </select>
                    </div>
                    {subLedgers.some(s => s.main_ledger_id === (form.tds_ledger_id || defaultTdsLedger)) && (
                        <div className="erp-field md:col-span-2">
                            <label className="erp-label">TDS Sub-Ledger</label>
                            <select className="erp-select" value={form.tds_sub_ledger_id || ''} onChange={e => setForm(f => ({ ...f, tds_sub_ledger_id: e.target.value }))}>
                                <option value="">None</option>
                                {subLedgers.filter(s => s.main_ledger_id === (form.tds_ledger_id || defaultTdsLedger)).map(s => <option key={s.id} value={s.id}>{s.sub_ledger_name}</option>)}
                            </select>
                        </div>
                    )}
                </div>
                {Number(form.tds_percent) > 0 && <p className="ent-note mt-1">TDS = {fmt(base)} × {Number(form.tds_percent)}% = {fmt(tds)}. {sales ? 'Dr TDS receivable, Cr customer.' : 'Dr supplier, Cr TDS payable.'}</p>}
            </fieldset>

            {sales && (
                <fieldset className="border rounded-lg p-3">
                    <legend className="px-1 text-xs font-semibold text-gray-600 uppercase">Received with this bill (cash / bank)</legend>
                    <table className="erp-grid-table">
                        <thead><tr><th style={{ width: '38%' }}>Cash / Bank Ledger</th><th>Sub-Ledger</th><th>Cheque / Ref No.</th><th className="text-right">Amount</th><th /></tr></thead>
                        <tbody>
                            {receipts.map((r, i) => (
                                <tr key={i}>
                                    <td>
                                        <select className="erp-select" value={r.ledger_id || ''} onChange={e => setReceipt(i, { ledger_id: e.target.value, sub_ledger_id: '' })}>
                                            <option value="">Choose cash / bank</option>
                                            {cashBank.map(l => <option key={l.id} value={l.id}>{l.account_name}</option>)}
                                        </select>
                                    </td>
                                    <td>
                                        <select className="erp-select" value={r.sub_ledger_id || ''} disabled={!subLedgers.some(s => s.main_ledger_id === r.ledger_id)} onChange={e => setReceipt(i, { sub_ledger_id: e.target.value })}>
                                            <option value="">None</option>
                                            {subLedgers.filter(s => s.main_ledger_id === r.ledger_id).map(s => <option key={s.id} value={s.id}>{s.sub_ledger_name}</option>)}
                                        </select>
                                    </td>
                                    <td><input className="erp-input" value={r.ref_no || ''} onChange={e => setReceipt(i, { ref_no: e.target.value })} placeholder="optional" /></td>
                                    <td><input type="number" step="0.01" min="0" className="erp-input text-right" value={r.amount} onChange={e => setReceipt(i, { amount: e.target.value })} /></td>
                                    <td className="text-center"><button type="button" className="nav-btn small" onClick={() => removeReceipt(i)} title="Remove">✕</button></td>
                                </tr>
                            ))}
                            {receipts.length === 0 && <tr><td colSpan={5} className="text-center text-gray-400">{cashBill ? `Nothing entered - the whole bill is taken as received in the default Cash ledger${sysCtl.default_cash_ledger_id ? ` (${ledgers.find(l => l.id === sysCtl.default_cash_ledger_id)?.account_name || ''})` : ' (set it in System Control)'}.` : 'Nothing received - the whole bill stays on credit.'}</td></tr>}
                        </tbody>
                    </table>
                    <div className="flex gap-2 mt-2 flex-wrap">
                        <button type="button" className="nav-btn small" onClick={() => addReceipt(sysCtl.default_cash_ledger_id || '')}>💵 + Cash</button>
                        <button type="button" className="nav-btn small" onClick={() => addReceipt(sysCtl.default_bank_ledger_id || '')}>🏦 + Bank</button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-sm">
                        <div>Bill total <b className="block">{fmt(billTotal)}</b></div>
                        <div>Received <b className="block">{fmt(received)}</b></div>
                        <div>TDS <b className="block">{fmt(tds)}</b></div>
                        <div>{balance < 0 ? 'Over-received' : 'Balance (credit)'} <b className={`block ${balance < -0.005 || (cashBill && receipts.length && Math.abs(balance) > 0.005) ? 'text-red-600' : ''}`}>{fmt(balance)}</b></div>
                    </div>
                    <p className="ent-note mt-1">{cashBill
                        ? 'Cash bill: cash + bank + TDS must equal the bill total. For part payment make the bill Credit.'
                        : 'Credit bill: enter what was paid now (e.g. 300 of a 500 bill) - the balance stays outstanding on the customer.'}</p>
                </fieldset>
            )}
        </div>
    );
}
