// =============================================
// components/BatchSerialPicker.jsx
// "Batch/Serial number on xa vane stock ma tyo jun saman xa tesko
// popup with qty aunu paryo, tyo select gare paxi tyo batch/serial ko
// details aunu paryo." A small popup button next to the Batch No /
// Serial No field - opens what's actually in stock, selecting fills
// batch_no/mfg_date/exp_date (or serial_no) straight back into the row.
// =============================================

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function BatchSerialPicker({ mode, productId, warehouseId, onSelect }) {
    const { authFetch } = useAuth();
    const [show, setShow] = useState(false);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);

    const open = async () => {
        if (!productId) return;
        setShow(true);
        setLoading(true);
        try {
            const url = mode === 'serial'
                ? `/api/product-serial-stock?product_id=${productId}`
                : `/api/product-batch-stock?product_id=${productId}${warehouseId ? `&warehouse_id=${warehouseId}` : ''}`;
            const res = await authFetch(url);
            setRows(res.data || []);
        } catch {
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    const handlePick = (row) => {
        if (mode === 'serial') {
            onSelect({ serial_no: row.serial_no });
        } else {
            onSelect({ batch_no: row.batch_no, mfg_date: row.mfg_date, exp_date: row.exp_date, warehouse_id: row.warehouse_id || warehouseId });
        }
        setShow(false);
    };

    return (
        <>
            <button type="button" tabIndex={-1} onClick={open} title={mode === 'serial' ? 'Pick Serial No (in stock)' : 'Pick Batch (in stock)'} className="text-blue-500 hover:text-blue-700 text-xs px-1">📦</button>
            {show && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShow(false)}>
                    <div className="bg-white rounded-xl w-full max-w-md max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="erp-header"><span className="erp-header-title">📦 {mode === 'serial' ? 'In-Stock Serial Numbers' : 'In-Stock Batches'}</span></div>
                        <div className="p-4">
                            {loading && <p className="text-sm text-gray-400 text-center py-4">Loading…</p>}
                            {!loading && rows.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nothing currently in stock for this product{warehouseId ? ' at this warehouse' : ''}.</p>}
                            {!loading && rows.length > 0 && (
                                <table className="erp-grid-table">
                                    <thead>
                                        {mode === 'serial' ? (
                                            <tr><th>Serial No</th><th>Warranty Expiry</th></tr>
                                        ) : rows[0]?.on_hand_primary != null ? (
                                            <tr><th>Batch No</th><th>{rows[0].primary_unit_name || 'Primary'}</th><th>{rows[0].secondary_unit_name || 'Secondary'}</th><th>Mfg Date</th><th>Exp Date</th>{!warehouseId && <th>Warehouse</th>}</tr>
                                        ) : (
                                            <tr><th>Batch No</th><th>Qty in Stock</th><th>Mfg Date</th><th>Exp Date</th>{!warehouseId && <th>Warehouse</th>}</tr>
                                        )}
                                    </thead>
                                    <tbody>
                                        {rows.map((r, i) => (
                                            <tr key={i} className="cursor-pointer hover:bg-blue-50" onClick={() => handlePick(r)}>
                                                {mode === 'serial' ? (
                                                    <>
                                                        <td className="font-medium">{r.serial_no}</td>
                                                        <td>{r.warranty_expiry_date || '—'}</td>
                                                    </>
                                                ) : r.on_hand_primary != null ? (
                                                    <>
                                                        <td className="font-medium">{r.batch_no}</td>
                                                        <td>{r.on_hand_primary}</td>
                                                        <td>{r.on_hand_secondary}</td>
                                                        <td>{r.mfg_date || '—'}</td>
                                                        <td>{r.exp_date || '—'}</td>
                                                        {!warehouseId && <td className="text-xs text-gray-400">{r.warehouse_name}</td>}
                                                    </>
                                                ) : (
                                                    <>
                                                        <td className="font-medium">{r.batch_no}</td>
                                                        <td>{r.on_hand_qty}</td>
                                                        <td>{r.mfg_date || '—'}</td>
                                                        <td>{r.exp_date || '—'}</td>
                                                        {!warehouseId && <td className="text-xs text-gray-400">{r.warehouse_name}</td>}
                                                    </>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="erp-bottombar">
                            <div />
                            <div className="erp-bottombar-actions">
                                <button type="button" onClick={() => setShow(false)} className="erp-btn">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
