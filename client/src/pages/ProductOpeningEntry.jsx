// =============================================
// ProductOpeningEntry.jsx
// Mirrors LedgerOpeningEntry.jsx for Products: bulk Excel-style Opening
// Stock grid, restricted to the fiscal year marked has_opening_balance
// (the SAME flag Ledger Opening uses). For products with Batch/Serial/
// Vehicle tracking on, a detail modal lets the opening be broken down
// accordingly - the sum rolls up into the product's own opening figures
// automatically, so the two can never disagree.
// =============================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import Layout from '../components/Layout';

const emptyBatchRow = () => ({ batch_no: '', mfg_date: '', exp_date: '', qty: '', rate: '' });
const emptySerialRow = () => ({ serial_no: '', warranty_expiry_date: '' });
const emptyVehicleRow = () => ({ vehicle_no: '', vehicle_type: '', chassis_no: '', engine_no: '', model_name: '', color: '', qty: 1, rate: '' });

export default function ProductOpeningEntry() {
    const { authFetch } = useAuth();
    const enterAreaRef = useRef(null);
    useEnterKeyNavigation(enterAreaRef);
    const [eligibleFy, setEligibleFy] = useState(null);
    const [products, setProducts] = useState([]);
    const [tracking, setTracking] = useState({});
    const [edits, setEdits] = useState({});
    const [alert, setAlert] = useState(null);
    const [saving, setSaving] = useState(false);

    const [detailModal, setDetailModal] = useState(null); // { product, kind: 'batch'|'serial'|'vehicle' }
    const [batchRows, setBatchRows] = useState([emptyBatchRow()]);
    const [serialRows, setSerialRows] = useState([emptySerialRow()]);
    const [serialRate, setSerialRate] = useState('');
    const [vehicleRows, setVehicleRows] = useState([emptyVehicleRow()]);

    const showAlert = (message, type = 'info') => { setAlert({ message, type }); setTimeout(() => setAlert(null), 6000); };

    const load = useCallback(async () => {
        try {
            const fy = await authFetch('/api/ledger-opening/eligible-fiscal-year');
            setEligibleFy(fy.data);
            if (fy.data) {
                const p = await authFetch(`/api/product-opening/products?fiscal_year_id=${fy.data.id}`);
                setProducts(p.data || []);
                setTracking(p.tracking || {});
                setEdits({});
            }
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    }, [authFetch]);
    useEffect(() => { load(); }, [load]);

    const getValue = (p, field) => edits[p.id]?.[field] ?? p[field];
    const setEdit = (id, field, value) => setEdits(e => ({ ...e, [id]: { ...e[id], [field]: value } }));

    const handleSaveAll = async () => {
        const rows = Object.entries(edits).map(([product_id, v]) => {
            const p = products.find(x => x.id === product_id);
            return { product_id, opening_qty: v.opening_qty ?? p.opening_qty, opening_rate: v.opening_rate ?? p.opening_rate };
        });
        if (rows.length === 0) return showAlert('No changes to save', 'warning');
        setSaving(true);
        try {
            await authFetch('/api/product-opening/bulk-update', { method: 'PUT', body: JSON.stringify({ fiscal_year_id: eligibleFy.id, rows }) });
            showAlert(`Saved ${rows.length} product(s)`, 'success');
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        } finally {
            setSaving(false);
        }
    };

    const openDetail = async (product, kind) => {
        setDetailModal({ product, kind });
        try {
            if (kind === 'batch') {
                const res = await authFetch(`/api/product-opening/batches?product_id=${product.id}`);
                setBatchRows(res.data.length > 0 ? res.data.map(b => ({ batch_no: b.batch_no, mfg_date: b.mfg_date || '', exp_date: b.exp_date || '', qty: b.qty, rate: b.rate })) : [emptyBatchRow()]);
            } else if (kind === 'serial') {
                const res = await authFetch(`/api/product-opening/serials?product_id=${product.id}`);
                setSerialRows(res.data.length > 0 ? res.data.map(s => ({ serial_no: s.serial_no, warranty_expiry_date: s.warranty_expiry_date || '' })) : [emptySerialRow()]);
                setSerialRate(product.opening_rate || '');
            } else if (kind === 'vehicle') {
                const res = await authFetch(`/api/product-opening/vehicles?product_id=${product.id}`);
                setVehicleRows(res.data.length > 0 ? res.data.map(v => ({ ...v })) : [emptyVehicleRow()]);
            }
        } catch {
            if (kind === 'batch') setBatchRows([emptyBatchRow()]);
            if (kind === 'serial') setSerialRows([emptySerialRow()]);
            if (kind === 'vehicle') setVehicleRows([emptyVehicleRow()]);
        }
    };

    const saveDetail = async () => {
        try {
            if (detailModal.kind === 'batch') {
                const valid = batchRows.filter(r => r.batch_no && r.qty !== '');
                if (valid.length === 0) return showAlert('Enter at least one complete batch line', 'danger');
                await authFetch('/api/product-opening/batches', { method: 'PUT', body: JSON.stringify({ product_id: detailModal.product.id, fiscal_year_id: eligibleFy.id, batches: valid }) });
            } else if (detailModal.kind === 'serial') {
                const valid = serialRows.filter(r => r.serial_no);
                if (valid.length === 0) return showAlert('Enter at least one serial number', 'danger');
                await authFetch('/api/product-opening/serials', { method: 'PUT', body: JSON.stringify({ product_id: detailModal.product.id, fiscal_year_id: eligibleFy.id, serials: valid, rate: serialRate }) });
            } else if (detailModal.kind === 'vehicle') {
                const valid = vehicleRows.filter(r => r.vehicle_no);
                if (valid.length === 0) return showAlert('Enter at least one vehicle', 'danger');
                await authFetch('/api/product-opening/vehicles', { method: 'PUT', body: JSON.stringify({ product_id: detailModal.product.id, fiscal_year_id: eligibleFy.id, vehicles: valid }) });
            }
            showAlert('Opening detail saved', 'success');
            setDetailModal(null);
            load();
        } catch (err) {
            showAlert(err.message, 'danger');
        }
    };

    return (
        <Layout>
        <div ref={enterAreaRef} className="max-w-5xl mx-auto p-4">
            <h1 className="text-2xl font-bold mb-1">Product Opening Stock</h1>
            <p className="text-xs text-gray-400 mb-4">
                Same opening fiscal year as Ledger Opening Balance. For products
                with Batch/Serial/Vehicle tracking on, use the button next to the
                row to break the opening down that way instead of a plain Qty+Rate.
            </p>

            {alert && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border-l-4 ${
                    alert.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                    alert.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                    'bg-yellow-50 border-yellow-500 text-yellow-800'
                }`}>{alert.message}</div>
            )}

            {!eligibleFy ? (
                <div className="bg-white border rounded-xl p-6 text-sm text-gray-500">No fiscal year is currently marked for opening balance entry.</div>
            ) : (
                <>
                    <div className="bg-white border rounded-xl overflow-hidden mb-4">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Product</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Group</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Qty</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Rate</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Value</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.map(p => (
                                    <tr key={p.id} className="border-t border-gray-100">
                                        <td className="px-3 py-1.5">{p.product_name} <span className="text-xs text-gray-400">({p.product_code})</span></td>
                                        <td className="px-3 py-1.5 text-xs text-gray-500">{p.product_groups?.group_name}</td>
                                        <td className="px-3 py-1.5">
                                            <input type="number" step="0.0001" className="w-24 border rounded px-2 py-1" value={getValue(p, 'opening_qty') ?? 0} onChange={e => setEdit(p.id, 'opening_qty', e.target.value)} />
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <input type="number" step="0.0001" className="w-24 border rounded px-2 py-1" value={getValue(p, 'opening_rate') ?? 0} onChange={e => setEdit(p.id, 'opening_rate', e.target.value)} />
                                        </td>
                                        <td className="px-3 py-1.5 text-xs text-gray-500">{((Number(getValue(p, 'opening_qty')) || 0) * (Number(getValue(p, 'opening_rate')) || 0)).toFixed(2)}</td>
                                        <td className="px-3 py-1.5 flex gap-2">
                                            {tracking.batch_system && tracking.batch_system !== 'none' && (
                                                <button onClick={() => openDetail(p, 'batch')} className="text-xs text-blue-600 hover:underline">📦 Batch</button>
                                            )}
                                            {tracking.enable_serial_number && (
                                                <button onClick={() => openDetail(p, 'serial')} className="text-xs text-blue-600 hover:underline">🔢 Serial</button>
                                            )}
                                            {tracking.enable_vehicle_options && (
                                                <button onClick={() => openDetail(p, 'vehicle')} className="text-xs text-blue-600 hover:underline">🚗 Vehicle</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {products.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-gray-400 text-sm">No products found.</td></tr>}
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

            {/* ==================== BATCH MODAL ==================== */}
            {detailModal?.kind === 'batch' && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[85vh] overflow-y-auto">
                        <h3 className="font-semibold text-lg mb-4">Batch-wise Opening — {detailModal.product.product_name}</h3>
                        {batchRows.map((row, i) => (
                            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                                <input placeholder="Batch No" className="col-span-3 border rounded px-2 py-1.5 text-sm" value={row.batch_no} onChange={e => setBatchRows(rs => rs.map((r, idx) => idx === i ? { ...r, batch_no: e.target.value } : r))} />
                                <input type="date" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.mfg_date} onChange={e => setBatchRows(rs => rs.map((r, idx) => idx === i ? { ...r, mfg_date: e.target.value } : r))} />
                                <input type="date" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.exp_date} onChange={e => setBatchRows(rs => rs.map((r, idx) => idx === i ? { ...r, exp_date: e.target.value } : r))} />
                                <input type="number" step="0.0001" placeholder="Qty" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.qty} onChange={e => setBatchRows(rs => rs.map((r, idx) => idx === i ? { ...r, qty: e.target.value } : r))} />
                                <input type="number" step="0.0001" placeholder="Rate" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.rate} onChange={e => setBatchRows(rs => rs.map((r, idx) => idx === i ? { ...r, rate: e.target.value } : r))} />
                                <button onClick={() => setBatchRows(rs => rs.filter((_, idx) => idx !== i))} className="col-span-1 text-red-500 text-xs">✕</button>
                            </div>
                        ))}
                        <button onClick={() => setBatchRows(rs => [...rs, emptyBatchRow()])} className="text-xs text-blue-600 mb-4">➕ Add Batch</button>
                        <div className="flex justify-end gap-2 border-t pt-4">
                            <button onClick={() => setDetailModal(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                            <button onClick={saveDetail} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== SERIAL MODAL ==================== */}
            {detailModal?.kind === 'serial' && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
                        <h3 className="font-semibold text-lg mb-1">Serial-wise Opening — {detailModal.product.product_name}</h3>
                        <div className="mb-3">
                            <label className="block text-xs text-gray-500 mb-1">Opening Rate (applies to every serial below)</label>
                            <input type="number" step="0.0001" className="w-40 border rounded px-2 py-1.5 text-sm" value={serialRate} onChange={e => setSerialRate(e.target.value)} />
                        </div>
                        {serialRows.map((row, i) => (
                            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                                <input placeholder="Serial No" className="col-span-6 border rounded px-2 py-1.5 text-sm" value={row.serial_no} onChange={e => setSerialRows(rs => rs.map((r, idx) => idx === i ? { ...r, serial_no: e.target.value } : r))} />
                                <input type="date" placeholder="Warranty Expiry" className="col-span-5 border rounded px-2 py-1.5 text-sm" value={row.warranty_expiry_date} onChange={e => setSerialRows(rs => rs.map((r, idx) => idx === i ? { ...r, warranty_expiry_date: e.target.value } : r))} />
                                <button onClick={() => setSerialRows(rs => rs.filter((_, idx) => idx !== i))} className="col-span-1 text-red-500 text-xs">✕</button>
                            </div>
                        ))}
                        <button onClick={() => setSerialRows(rs => [...rs, emptySerialRow()])} className="text-xs text-blue-600 mb-4">➕ Add Serial</button>
                        <div className="flex justify-end gap-2 border-t pt-4">
                            <button onClick={() => setDetailModal(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                            <button onClick={saveDetail} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== VEHICLE MODAL ==================== */}
            {detailModal?.kind === 'vehicle' && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl p-6 w-full max-w-4xl max-h-[85vh] overflow-y-auto">
                        <h3 className="font-semibold text-lg mb-4">Vehicle-wise Opening — {detailModal.product.product_name}</h3>
                        {vehicleRows.map((row, i) => (
                            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                                <input placeholder="Vehicle No" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.vehicle_no} onChange={e => setVehicleRows(rs => rs.map((r, idx) => idx === i ? { ...r, vehicle_no: e.target.value } : r))} />
                                <input placeholder="Type" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.vehicle_type} onChange={e => setVehicleRows(rs => rs.map((r, idx) => idx === i ? { ...r, vehicle_type: e.target.value } : r))} />
                                <input placeholder="Chassis No" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.chassis_no} onChange={e => setVehicleRows(rs => rs.map((r, idx) => idx === i ? { ...r, chassis_no: e.target.value } : r))} />
                                <input placeholder="Engine No" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.engine_no} onChange={e => setVehicleRows(rs => rs.map((r, idx) => idx === i ? { ...r, engine_no: e.target.value } : r))} />
                                <input placeholder="Model" className="col-span-1 border rounded px-2 py-1.5 text-sm" value={row.model_name} onChange={e => setVehicleRows(rs => rs.map((r, idx) => idx === i ? { ...r, model_name: e.target.value } : r))} />
                                <input type="number" step="0.0001" placeholder="Rate" className="col-span-2 border rounded px-2 py-1.5 text-sm" value={row.rate} onChange={e => setVehicleRows(rs => rs.map((r, idx) => idx === i ? { ...r, rate: e.target.value } : r))} />
                                <button onClick={() => setVehicleRows(rs => rs.filter((_, idx) => idx !== i))} className="col-span-1 text-red-500 text-xs">✕</button>
                            </div>
                        ))}
                        <button onClick={() => setVehicleRows(rs => [...rs, emptyVehicleRow()])} className="text-xs text-blue-600 mb-4">➕ Add Vehicle</button>
                        <div className="flex justify-end gap-2 border-t pt-4">
                            <button onClick={() => setDetailModal(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
                            <button onClick={saveDetail} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
        </Layout>
    );
}
