// =============================================
// LedgerOpeningEntry.jsx
// Bulk, Excel-style Opening Balance entry for Balance Sheet ledgers only
// (P&L/Income-Expense ledgers are excluded server-side). Entry is only
// allowed in the fiscal year marked has_opening_balance. Customer/Vendor
// ledgers can optionally be broken down document-wise (Bill Date, Bill
// No, Bill Amount, Agent, Balance Amount) instead of one lump sum - the
// bill-wise total becomes the ledger's opening balance automatically.
// Re-baseline lets an admin move opening entry to a LATER fiscal year
// mid-life, recording the Opening Difference for each ledger.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import SearchablePopupSelect from '../components/SearchablePopupSelect';
import Layout from '../components/Layout';

const emptyBillRow = () => ({ bill_date: '', bill_no: '', bill_amount: '', agent_id: '', balance_amount: '' });

export default function LedgerOpeningEntry() {
    const { authFetch } = useAuth();
    const enterAreaRef = useRef(null);
    useEnterKeyNavigation(enterAreaRef);
    const [eligibleFy, setEligibleFy] = useState(null);
    const [ledgers, setLedgers] = useState([]);
    const [edits, setEdits] = useState({}); // { ledger_id: { opening_balance, opening_balance_type } }
    const [agents, setAgents] = useState([]);
    const [alert, setAlert] = useState(null);
    const [saving, setSaving] = useState(false);

    const [billModalLedger, setBillModalLedger] = useState(null);
    const [billRows, setBillRows] = useState([emptyBillRow()]);

    const [showRebaseline, setShowRebaseline] = useState(false);
    const [allFiscalYears, setAllFiscalYears] = useState([]);
    const [rebaselineFyId, setRebaselineFyId] = useState('');

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const [fy, ag, allFy] = await Promise.all([
                authFetch('/api/ledger-opening/eligible-fiscal-year'),
                authFetch('/api/salesman-agents'),
                authFetch('/api/fiscal-years')
            ]);
            setEligibleFy(fy.data);
            setAgents(ag.data || []);
            setAllFiscalYears(allFy.data || []);
            if (fy.data) {
                const l = await authFetch(`/api/ledger-opening/ledgers?fiscal_year_id=${fy.data.id}`);
                setLedgers(l.data || []);
                setEdits({});
            }
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const getValue = (ledger, field) => edits[ledger.id]?.[field] ?? ledger[field];
    const setEdit = (ledgerId, field, value) => setEdits(e => ({ ...e, [ledgerId]: { ...e[ledgerId], [field]: value } }));

    const handleSaveAll = async () => {
        const rows = Object.entries(edits).map(([ledger_account_id, v]) => {
            const ledger = ledgers.find(l => l.id === ledger_account_id);
            return {
                ledger_account_id,
                opening_balance: v.opening_balance ?? ledger.opening_balance,
                opening_balance_type: v.opening_balance_type ?? ledger.opening_balance_type
            };
        });
        if (rows.length === 0) return showAlert('No changes to save', 'warning');
        setSaving(true);
        try {
            await authFetch('/api/ledger-opening/bulk-update', {
                method: 'PUT',
                body: JSON.stringify({ fiscal_year_id: eligibleFy.id, rows })
            });
            showAlert(`Saved ${rows.length} ledger(s)`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setSaving(false);
        }
    };

    const openBillModal = async (ledger) => {
        setBillModalLedger(ledger);
        try {
            const res = await authFetch(`/api/ledger-opening/bill-details?ledger_account_id=${ledger.id}&fiscal_year_id=${eligibleFy.id}`);
            setBillRows(res.data.length > 0 ? res.data.map(b => ({ bill_date: b.bill_date, bill_no: b.bill_no, bill_amount: b.bill_amount, agent_id: b.agent_id || '', balance_amount: b.balance_amount })) : [emptyBillRow()]);
        } catch {
            setBillRows([emptyBillRow()]);
        }
    };

    const saveBillDetails = async () => {
        const validRows = billRows.filter(r => r.bill_date && r.bill_no && r.bill_amount);
        if (validRows.length === 0) return showAlert('Enter at least one complete bill line', 'danger');
        try {
            const res = await authFetch('/api/ledger-opening/bill-details', {
                method: 'PUT',
                body: JSON.stringify({ ledger_account_id: billModalLedger.id, fiscal_year_id: eligibleFy.id, bills: validRows })
            });
            showAlert(`Bill-wise opening saved - total ${res.data.total} ${res.data.opening_balance_type.toUpperCase()}`, 'success');
            setBillModalLedger(null);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const submitRebaseline = async () => {
        if (!rebaselineFyId) return showAlert('Pick a fiscal year to re-baseline into', 'danger');
        const rows = ledgers.map(l => ({
            ledger_account_id: l.id,
            new_opening_balance: getValue(l, 'opening_balance'),
            new_opening_balance_type: getValue(l, 'opening_balance_type')
        }));
        try {
            const res = await authFetch('/api/ledger-opening/rebaseline', {
                method: 'POST',
                body: JSON.stringify({ new_fiscal_year_id: rebaselineFyId, rows })
            });
            showAlert(res.message, 'success');
            setShowRebaseline(false);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    const isPartyLedger = (l) => ['sales', 'purchase', 'both'].includes(l.category_type);

    return (
        <Layout>
        <div ref={enterAreaRef} className="max-w-5xl mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Ledger Opening Balance</h1>
                <button onClick={() => setShowRebaseline(true)} className="px-3 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                    🔄 Re-baseline to a later fiscal year
                </button>
            </div>

            <p className="text-xs text-gray-400 mb-4">
                Balance Sheet ledgers only - Income/Expense ledgers don't carry an
                opening balance forward. Entry is only allowed in the fiscal year
                marked as the opening year (currently:{' '}
                <span className="font-semibold">{eligibleFy ? eligibleFy.fiscal_year_name : 'none set'}</span>).
                For Customer/Supplier ledgers, use "Bill-wise" to break the total
                down by individual outstanding document instead of one lump sum.
            </p>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {!eligibleFy ? (
                <div className="bg-white border rounded-xl p-6 text-sm text-gray-500">
                    No fiscal year is currently marked for opening balance entry. Set
                    "Has Opening Balance" on the intended fiscal year first (Fiscal
                    Year Management), or use Re-baseline above if this is a mid-life switch.
                </div>
            ) : (
                <>
                    <div className="bg-white border rounded-xl overflow-hidden mb-4">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Ledger</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Group</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Amount</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Dr/Cr</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {ledgers.map(l => (
                                    <tr key={l.id} className="border-t border-gray-100">
                                        <td className="px-3 py-1.5">{l.account_name} <span className="text-xs text-gray-400">({l.account_code})</span></td>
                                        <td className="px-3 py-1.5 text-xs text-gray-500">{l.account_groups?.group_name}</td>
                                        <td className="px-3 py-1.5">
                                            <input
                                                type="number" step="0.01"
                                                className="w-32 border rounded px-2 py-1"
                                                value={getValue(l, 'opening_balance') ?? 0}
                                                onChange={e => setEdit(l.id, 'opening_balance', e.target.value)}
                                            />
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <select
                                                className="border rounded px-2 py-1"
                                                value={getValue(l, 'opening_balance_type') || 'dr'}
                                                onChange={e => setEdit(l.id, 'opening_balance_type', e.target.value)}
                                            >
                                                <option value="dr">Dr</option>
                                                <option value="cr">Cr</option>
                                            </select>
                                        </td>
                                        <td className="px-3 py-1.5">
                                            {isPartyLedger(l) && (
                                                <button onClick={() => openBillModal(l)} className="text-xs text-blue-600 hover:underline">📄 Bill-wise</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {ledgers.length === 0 && (
                                    <tr><td colSpan={5} className="text-center py-6 text-gray-400 text-sm">No Balance Sheet ledgers found.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex justify-end">
                        <button onClick={handleSaveAll} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
                            {saving ? 'Saving...' : `💾 Save Changes (${Object.keys(edits).length})`}
                        </button>
                    </div>
                </>
            )}

            {/* ==================== BILL-WISE MODAL ==================== */}
            {billModalLedger && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[85vh] overflow-y-auto">
                        <h3 className="font-semibold text-lg mb-1">Bill-wise Opening — {billModalLedger.account_name}</h3>
                        <p className="text-xs text-gray-400 mb-4">The sum of Balance Amount below becomes this ledger's opening balance automatically.</p>

                        <div className="space-y-2 mb-3">
                            {billRows.map((row, i) => (
                                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                                    <input type="date" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.bill_date}
                                        onChange={e => setBillRows(rs => rs.map((r, idx) => idx === i ? { ...r, bill_date: e.target.value } : r))} />
                                    <input placeholder="Bill No" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.bill_no}
                                        onChange={e => setBillRows(rs => rs.map((r, idx) => idx === i ? { ...r, bill_no: e.target.value } : r))} />
                                    <input type="number" step="0.01" placeholder="Bill Amt" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.bill_amount}
                                        onChange={e => setBillRows(rs => rs.map((r, idx) => idx === i ? { ...r, bill_amount: e.target.value, balance_amount: r.balance_amount || e.target.value } : r))} />
                                    <div className="col-span-3">
                                        <SearchablePopupSelect
                                            listKey="opening_bill_agent_picker"
                                            columns={[{ key: 'agent_name', label: 'Name' }]}
                                            defaultVisibleKeys={['agent_name']}
                                            items={agents} getId={a => a.id} getLabel={a => a.agent_name}
                                            searchKeys={['agent_name']}
                                            value={row.agent_id} onChange={id => setBillRows(rs => rs.map((r, idx) => idx === i ? { ...r, agent_id: id } : r))}
                                            placeholder="Agent (optional)"
                                        />
                                    </div>
                                    <input type="number" step="0.01" placeholder="Balance Amt" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.balance_amount}
                                        onChange={e => setBillRows(rs => rs.map((r, idx) => idx === i ? { ...r, balance_amount: e.target.value } : r))} />
                                    <button onClick={() => setBillRows(rs => rs.filter((_, idx) => idx !== i))} className="col-span-1 text-red-500 text-xs">✕</button>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => setBillRows(rs => [...rs, emptyBillRow()])} className="text-xs text-blue-600 mb-4">➕ Add Bill Line</button>

                        <div className="flex justify-between items-center border-t pt-4">
                            <span className="text-sm font-medium">
                                Total: {billRows.reduce((s, r) => s + (Number(r.balance_amount) || 0), 0).toFixed(2)}
                            </span>
                            <div className="flex gap-2">
                                <button onClick={() => setBillModalLedger(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                                <button onClick={saveBillDetails} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== RE-BASELINE MODAL ==================== */}
            {showRebaseline && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <h3 className="font-semibold text-lg mb-2">Re-baseline Opening Balance</h3>
                        <p className="text-xs text-gray-400 mb-4">
                            Moves opening-balance entry to a LATER fiscal year (e.g. started
                            in FY75/76, now re-opening from FY80/81). For every Balance Sheet
                            ledger, this records the previous figure, whatever you've typed
                            into the grid above as the new figure, and the computed Opening
                            Difference - visible later in Ledger Opening History.
                        </p>
                        <label className="block text-sm font-medium mb-1">New Opening Fiscal Year</label>
                        <select className="w-full border rounded-lg px-3 py-2 mb-4" value={rebaselineFyId} onChange={e => setRebaselineFyId(e.target.value)}>
                            <option value="">Select fiscal year</option>
                            {allFiscalYears.filter(fy => !eligibleFy || new Date(fy.start_date_eng) > new Date(eligibleFy.start_date_eng)).map(fy => (
                                <option key={fy.id} value={fy.id}>{fy.fiscal_year_name}</option>
                            ))}
                        </select>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowRebaseline(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
                            <button onClick={submitRebaseline} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Re-baseline</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
        </Layout>
    );
}
